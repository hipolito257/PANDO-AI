import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { companies, compSets, publicComps, userSettings, financialSnapshots } from "@/lib/schema";
import { eq, inArray, desc } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 120;

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}
function fmt(n: unknown, suffix = ""): string {
  if (n == null) return "N/D";
  const v = Number(n);
  if (isNaN(v)) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B${suffix}`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M${suffix}`;
  return `$${v.toFixed(0)}${suffix}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  try {
    const formData = await req.formData();
    const companyId  = formData.get("companyId")  as string | null;
    const userPrompt = (formData.get("userPrompt") as string | null)?.trim() || null;
    const feedback   = (formData.get("feedback")   as string | null)?.trim() || null;
    const blobUrlsRaw = (formData.get("blobUrls") as string | null) || null;
    const blobUrls: { name: string; url: string; type: string }[] = blobUrlsRaw ? JSON.parse(blobUrlsRaw) : [];

    const [settings] = await db.select().from(userSettings).where(eq(userSettings.userId, session.user.id)).limit(1);
    const apiKey = settings?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "API key no configurada" }, { status: 400 });

    // Load company + peers
    let companyCard = "No se seleccionó empresa.";
    let peersCard   = "Sin peers configurados.";
    let companyName = "La Empresa";

    if (companyId) {
      const [co] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
      if (co) {
        companyName = co.name;
        const [snap] = await db.select().from(financialSnapshots).where(eq(financialSnapshots.companyId, companyId)).orderBy(desc(financialSnapshots.year)).limit(1);
        companyCard = `
Empresa: ${co.name} | Sector: ${co.sector ?? "N/D"} | País: ${co.country ?? "N/D"} | Stage: ${co.stage ?? "N/D"}
Revenue: ${fmt(co.revenueUsd ?? snap?.revenueUsd)} | Crecimiento: ${co.revenueGrowth != null ? `${(co.revenueGrowth * 100).toFixed(0)}%` : "N/D"} YoY
EBITDA: ${fmt(co.ebitdaUsd ?? snap?.ebitdaUsd)} | Margen: ${co.ebitdaMargin != null ? `${(co.ebitdaMargin * 100).toFixed(0)}%` : "N/D"}
Empleados: ${co.employees ?? "N/D"} | Fondeo: ${fmt(co.totalFunding)} | Descripción: ${co.description ?? "N/D"}`.trim();

        const [cs] = await db.select().from(compSets).where(eq(compSets.companyId, companyId)).limit(1);
        if (cs?.tickers) {
          let tickers: string[] = [];
          try { tickers = JSON.parse(cs.tickers); } catch { /* ignore */ }
          if (tickers.length) {
            const peers = await db.select().from(publicComps).where(inArray(publicComps.ticker, tickers));
            const evRev = peers.map(p => p.evRevenue).filter((n): n is number => n != null);
            const evEbt = peers.map(p => p.evEbitda).filter((n): n is number => n != null);
            peersCard = `Peers: ${peers.map(p => p.ticker).join(", ")} | EV/Rev mediana: ${median(evRev)?.toFixed(1) ?? "N/D"}x | EV/EBITDA mediana: ${median(evEbt)?.toFixed(1) ?? "N/D"}x`;
          }
        }
      }
    }

    const today = new Date().toLocaleDateString("es-MX", { month: "long", year: "numeric" });

    // Download blob files and build multimodal content parts
    const msgContent: Anthropic.MessageParam["content"] = [];
    for (const bf of blobUrls.slice(0, 5)) {
      try {
        const r = await fetch(bf.url);
        const buf = Buffer.from(await r.arrayBuffer());
        const mime = bf.type || "application/octet-stream";
        if (mime === "application/pdf") {
          msgContent.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } } as never);
        } else if (mime.startsWith("image/")) {
          msgContent.push({ type: "image", source: { type: "base64", media_type: mime as "image/png", data: buf.toString("base64") } });
        }
        // xlsx/docx/pptx: skip binary, just note file name (Claude can't read them)
      } catch { /* skip unreadable files */ }
    }

    const userText = [
      userPrompt ? `INSTRUCCIONES DEL USUARIO:\n${userPrompt}` : null,
      blobUrls.length ? `ARCHIVOS DE RESPALDO ADJUNTOS: ${blobUrls.map(b => b.name).join(", ")}` : null,
      feedback   ? `FEEDBACK SOBRE EL PLAN ANTERIOR:\n${feedback}` : null,
      "Genera el plan de presentación.",
    ].filter(Boolean).join("\n\n");

    msgContent.push({ type: "text", text: userText });

    const claude = new Anthropic({ apiKey });
    const resp = await claude.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: `Eres un analista senior de PANDO, un fondo de private equity. Tu tarea es planear una presentación de inversión (NO construirla todavía — solo el plan).

DATOS DE LA EMPRESA:
${companyCard}

PEERS:
${peersCard}

FECHA: ${today}

INSTRUCCIONES:
- Decide la estructura completa de la presentación basándote en los datos disponibles.
- La presentación SIEMPRE empieza con portada (cover) y termina con contraportada (back_cover).
- Entre portada y contraportada: secciones (divider) y slides de datos.
- Sé específico: para cada slide indica el título, el mensaje clave (takeaway), y qué tipo de gráfica o tabla usarías.
- Usa datos reales. Si no tienes un dato, elige un ángulo diferente.
- Típico: 10-16 slides totales incluyendo portada, contraportada y dividers.

TIPOS DE ELEMENTOS (para indicar en el plan):
- bar chart: comparación de 2+ series por categoría
- line chart: tendencia en el tiempo
- line_multi: múltiples series en el tiempo
- donut: partes de un todo (market share, mix)
- hbar_float: rangos o waterfall (ej. valuation)
- scatter: posicionamiento XY (ej. growth vs margen)
- quadrant: matriz 2x2
- table: datos tabulares (comparables, financials)
- textboxes: texto/estadísticas clave (para overview o thesis)

FORMATO DE RESPUESTA — devuelve ÚNICAMENTE este JSON (sin texto extra, sin markdown):
{
  "deck_title": "Nombre Empresa — Investment Overview",
  "deck_subtitle": "Private & Confidential | ${today}",
  "company": "${companyName}",
  "slides": [
    { "index": 0, "type": "cover", "title": "Nombre Empresa", "subtitle": "Investment Overview | ${today}" },
    { "index": 1, "type": "divider", "section": "LA EMPRESA" },
    { "index": 2, "type": "slide", "section": "LA EMPRESA", "title": "OVERVIEW DE LA EMPRESA", "takeaway": "Mensaje clave específico con datos reales", "chart": "textboxes: métricas clave (Revenue, EBITDA, empleados, founded)" },
    { "index": 3, "type": "slide", "section": "LA EMPRESA", "title": "POSICIONAMIENTO DE MARCA", "takeaway": "...", "chart": "bar: percepción vs experiencia + table: NPS vs peers" },
    { "index": 4, "type": "divider", "section": "EL MERCADO" },
    { "index": 5, "type": "slide", "section": "EL MERCADO", "title": "TAMAÑO Y CRECIMIENTO DEL MERCADO", "takeaway": "...", "chart": "line: evolución TAM 2020-2025" },
    { "index": 6, "type": "divider", "section": "FINANCIALS" },
    { "index": 7, "type": "slide", "section": "FINANCIALS", "title": "EVOLUCIÓN FINANCIERA", "takeaway": "...", "chart": "line_multi: revenue y EBITDA 2021-2025" },
    { "index": 8, "type": "divider", "section": "INVERSIÓN" },
    { "index": 9, "type": "slide", "section": "INVERSIÓN", "title": "TESIS DE INVERSIÓN", "takeaway": "...", "chart": "textboxes: 4 pilares de inversión" },
    { "index": 10, "type": "slide", "section": "INVERSIÓN", "title": "VALUACIÓN", "takeaway": "...", "chart": "hbar_float: rangos de valuación por metodología" },
    { "index": 11, "type": "back_cover" }
  ]
}`,
      messages: [{ role: "user", content: msgContent }],
    });

    const raw = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map(b => b.text).join("");

    // Extract JSON — strip markdown fences if present
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = fenced ? fenced[1] : (raw.match(/\{[\s\S]*\}/) ?? [null])[0];
    if (!jsonStr) return NextResponse.json({ error: "Claude no devolvió un plan válido", raw: raw.slice(0, 300) }, { status: 500 });

    // Repair common Claude JSON issues: trailing commas before ] or }
    const repaired = jsonStr
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}");

    let plan: unknown;
    try {
      plan = JSON.parse(repaired);
    } catch (parseErr) {
      return NextResponse.json({
        error: `Error de formato en el plan: ${(parseErr as Error).message}`,
        raw: jsonStr.slice(0, 400),
      }, { status: 500 });
    }
    return NextResponse.json({ success: true, plan });

  } catch (err) {
    console.error("[plan]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error inesperado" }, { status: 500 });
  }
}
