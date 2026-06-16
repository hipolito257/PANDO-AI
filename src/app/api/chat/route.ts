import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { userSettings, companies, compSets, publicComps, signals, notes } from "@/lib/schema";
import { eq, desc } from "drizzle-orm";

function fmtB(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  if (isNaN(v)) return "N/D";
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}
function fmtPct(n: unknown): string {
  if (n == null) return "N/D";
  const v = Number(n);
  return isNaN(v) ? "N/D" : `${(v * 100).toFixed(1)}%`;
}

// Build rich system context from DB
async function buildContext(): Promise<string> {
  const allCompanies = await db.query.companies.findMany({
    with: { signals: { limit: 3, orderBy: (s, { desc }) => [desc(s.date)] }, notes: { limit: 2 } },
    orderBy: [desc(companies.score)],
    limit: 50,
  });

  const companySummaries = allCompanies.map(c => {
    const lines = [
      `• ${c.name} (${c.sector ?? "N/D"} | ${c.country} | ${c.stage ?? "N/D"} | Score: ${c.score?.toFixed(1) ?? "N/D"})`,
      `  Revenue: ${fmtB(c.revenueUsd)} | Crec: ${fmtPct(c.revenueGrowth)} | EBITDA: ${fmtB(c.ebitdaUsd)} | Margen: ${fmtPct(c.ebitdaMargin)}`,
      `  Empleados: ${c.employees ?? "N/D"} | Fondeo total: ${fmtB(c.totalFunding)} | Última ronda: ${fmtB(c.lastFundingAmt)} | Stage fondeo: ${c.fundingStage ?? "N/D"}`,
      c.description ? `  Descripción: ${c.description.slice(0, 150)}` : "",
      c.signals?.length ? `  Señales recientes: ${c.signals.map((s: any) => s.title).join("; ")}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  }).join("\n\n");

  const sectorCounts = allCompanies.reduce((acc, c) => {
    acc[c.sector ?? "Sin sector"] = (acc[c.sector ?? "Sin sector"] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const stageCounts = allCompanies.reduce((acc, c) => {
    acc[c.stage ?? "Sin etapa"] = (acc[c.stage ?? "Sin etapa"] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return `Eres PANDO AI, el asistente inteligente de una plataforma de Private Equity.
Tienes acceso completo al radar de empresas del fondo y sus métricas.

FECHA ACTUAL: ${new Date().toLocaleDateString("es-MX", { year: "numeric", month: "long", day: "numeric" })}

RESUMEN DEL RADAR:
- Total empresas monitoreadas: ${allCompanies.length}
- Por sector: ${Object.entries(sectorCounts).map(([k, v]) => `${k}(${v})`).join(", ")}
- Por etapa: ${Object.entries(stageCounts).map(([k, v]) => `${k}(${v})`).join(", ")}

EMPRESAS EN EL RADAR:
${companySummaries}

INSTRUCCIONES:
- Responde en español, de forma concisa y directa como lo haría un analista senior de PE
- Puedes comparar empresas, calcular métricas, identificar oportunidades, analizar tendencias
- Si te preguntan sobre una empresa específica, usa todos los datos disponibles
- Si no tienes datos de algo, dilo claramente
- Usa bullet points y formato limpio cuando sea útil
- Mantén respuestas enfocadas — no más de 300 palabras salvo que se pida más detalle`;
}

// POST /api/chat
// Body: { message: string, history: { role: "user"|"assistant", content: string }[] }
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { message, history = [] } = await req.json() as {
    message: string;
    history: { role: "user" | "assistant"; content: string }[];
  };

  if (!message?.trim()) return NextResponse.json({ error: "message required" }, { status: 400 });

  // Get user's API key
  const userId = session.user.id;
  const userSetting = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  });
  const apiKey = userSetting?.anthropicApiKey || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json({
      error: "no_key",
      message: "Configura tu API key de Anthropic en Configuración para usar el chat.",
    }, { status: 400 });
  }

  // Build context
  const systemPrompt = await buildContext();

  // Build message history
  const messages = [
    ...history.slice(-10), // Keep last 10 turns for context
    { role: "user" as const, content: message },
  ];

  // Stream response from Claude Haiku
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: systemPrompt,
      messages,
      stream: true,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const err = await response.text();
    return NextResponse.json({ error: "Anthropic API error", detail: err }, { status: 500 });
  }

  // Stream back to client
  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter(l => l.startsWith("data: "));

          for (const line of lines) {
            const data = line.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                controller.enqueue(new TextEncoder().encode(parsed.delta.text));
              }
            } catch { /* skip malformed */ }
          }
        }
      } finally {
        controller.close();
        reader.releaseLock();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
