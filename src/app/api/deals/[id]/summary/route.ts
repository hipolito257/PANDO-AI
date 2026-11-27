import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { asc, desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, deals, companies, companyFiles, financialSnapshots, userSettings } from "@/lib/db";
import type { ExtractionResult } from "@/lib/companyFileExtract";
import { logDeal, nowIso } from "@/lib/deals";
import { companyFileBlocks } from "@/lib/companyContext";
import { DRAFT_SYSTEM, autoCagr, emptySummary, normalizeSummary, parseSummary, type DealSummary } from "@/lib/dealSummary";

export const maxDuration = 120;
type Params = { params: Promise<{ id: string }> };

// The yearly figures read from the company's documents when they were uploaded
// (deck, CIM, model): every year they give, actual and projected, in their own
// currency, exactly as printed. Newer documents win for the same year.
async function docFinancials(companyId: string): Promise<DealSummary["financial"] | null> {
  const files = await db.select({ filename: companyFiles.filename, extraction: companyFiles.extraction, status: companyFiles.extractionStatus })
    .from(companyFiles).where(eq(companyFiles.companyId, companyId)).orderBy(desc(companyFiles.createdAt)).catch(() => []);
  type Row = { year: number; projected: boolean; revenue: number | null; ebitda: number | null; currency: string; file: string; source: string };
  const rows: Row[] = [];
  for (const f of files) {
    if (f.status !== "done" || !f.extraction) continue;
    let x: ExtractionResult;
    try { x = JSON.parse(f.extraction); } catch { continue; }
    for (const r of x.financials ?? []) {
      if (!r.year || (r.revenue == null && r.ebitda == null)) continue;
      rows.push({ year: r.year, projected: r.period === "forecast" || r.period === "budget", revenue: r.revenue, ebitda: r.ebitda,
        currency: (r.currency || "").toUpperCase(), file: f.filename, source: r.source });
    }
  }
  if (!rows.length) return null;
  // One currency for the chart: the one most of the figures use.
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  // One row per year: an actual beats a projection; otherwise the newest document wins.
  const byYear = new Map<number, Row>();
  for (const r of rows.filter(r => r.currency === currency)) {
    const cur = byYear.get(r.year);
    if (!cur || (cur.projected && !r.projected)) byYear.set(r.year, r);
  }
  const list = [...byYear.values()].sort((a, b) => a.year - b.year);
  // Amounts come in full units; show millions (documents already in millions stay as they are).
  const max = Math.max(...list.map(r => Math.abs(r.revenue ?? r.ebitda ?? 0)));
  const div = max >= 100_000 ? 1_000_000 : 1;
  const round = (n: number) => Math.round(n * 10) / 10;
  const years = list.map(r => ({
    label: `${r.projected ? "E" : ""}${r.year}`,
    revenue: r.revenue != null ? round(r.revenue / div) : null,
    margin: r.revenue && r.ebitda != null ? round((r.ebitda / r.revenue) * 100) : null,
    projected: r.projected,
  }));
  const sources = [...new Set(list.map(r => `${r.file}${r.source ? ` (${r.source})` : ""}`))].slice(0, 3);
  return {
    unit: `${currency || "USD"} $m`, scenario: "Base Case", years, rows: [], cagr: autoCagr(years),
    footnote: `Source: ${sources.join("; ")}. EBITDA margin = EBITDA / revenue.`,
  };
}

// A starting point from the platform's data when nothing has been written yet.
async function prefill(companyId: string): Promise<DealSummary> {
  const s = emptySummary();
  const [company, snaps] = await Promise.all([
    db.query.companies.findFirst({ where: eq(companies.id, companyId) }),
    db.select().from(financialSnapshots).where(eq(financialSnapshots.companyId, companyId)).orderBy(asc(financialSnapshots.year)),
  ]);
  if (company?.description) {
    s.companyOverview = company.description.split(/(?<=[.!?])\s+(?=[A-Z])/).map(t => t.trim()).filter(Boolean).slice(0, 6).map(text => ({ text, level: 0 as const }));
  }
  const thisYear = new Date().getFullYear();
  const annual = snaps.filter(r => !r.quarter && r.revenueUsd);
  s.financial.years = annual.slice(-10).map(r => ({
    label: r.year > thisYear ? `E${r.year}` : String(r.year),
    revenue: Math.round((r.revenueUsd! / 1e6) * 10) / 10,
    margin: r.ebitdaUsd != null && r.revenueUsd ? Math.round((r.ebitdaUsd / r.revenueUsd) * 1000) / 10 : null,
    projected: r.year > thisYear,
  }));
  s.financial.cagr = autoCagr(s.financial.years);
  return s;
}

// GET — the saved summary, or a prefill from the company's data
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [deal] = await db.select({ companyId: deals.companyId, summary: deals.summary }).from(deals).where(eq(deals.id, id)).limit(1);
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const saved = parseSummary(deal.summary);
  const summary = saved ?? await prefill(deal.companyId);
  // No numbers yet: take them straight from the documents (all the years they give).
  let fromDocs = false;
  if (!saved?.financial.years.length) {
    const fin = await docFinancials(deal.companyId);
    if (fin) { summary.financial = fin; fromDocs = true; }
  }
  return NextResponse.json({ summary, saved: !!saved, fromDocs });
}

// PUT { summary } — save the team's edits
export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const [deal] = await db.select({ codeName: deals.codeName, summary: deals.summary }).from(deals).where(eq(deals.id, id)).limit(1);
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const summary = { ...normalizeSummary(body.summary), updatedAt: nowIso(), updatedBy: session.user.name ?? "User" };
  await db.update(deals).set({ summary: JSON.stringify(summary), updatedAt: nowIso() }).where(eq(deals.id, id));
  if (!deal.summary) await logDeal(session.user.id, session.user.name ?? "User", "edited_deal", id, deal.codeName, "wrote the executive summary");
  return NextResponse.json({ summary });
}

// POST — draft the summary with Claude from the company's documents (not saved until the user saves it)
export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const onlyFinancials = (await req.json().catch(() => ({}))).section === "financial";
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, id), with: { company: true } });
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Add your Anthropic API key in Settings to draft with AI." }, { status: 400 });

  const c = deal.company;
  if (onlyFinancials) {
    const fin = await docFinancials(c.id);
    if (fin) return NextResponse.json({ summary: { ...emptySummary(), financial: fin }, fromDocs: true });
  }
  // The documents themselves (CIM, teaser, model…), not just their summaries, so
  // transaction terms, KPIs and figures come straight from the source.
  const files = await companyFileBlocks(c.id, null);
  const base = await prefill(c.id);
  const context = [
    `Company: ${c.name} · ${c.sector ?? ""} · ${c.country}`,
    c.description && `Description: ${c.description}`,
    `Deal: ${deal.codeName} (${deal.type})${deal.dealSize ? `, size ${deal.dealSize} ${deal.currency}` : ""}${deal.description ? `. ${deal.description}` : ""}`,
    base.financial.years.length && `Financials on the platform (USD $m): ${JSON.stringify(base.financial.years)}`,
    files.blocks.length ? `The company's documents follow${files.names.length ? `: ${files.names.join(", ")}` : ""}. Use them as the main source.` : "No documents have been uploaded for this company yet.",
  ].filter(Boolean).join("\n\n");

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 8000,
      output_config: { effort: "medium" },
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: context }, ...files.blocks, { type: "text", text: onlyFinancials
        ? "Only the financial part matters now: extract the historical and projected years exactly as the documents give them. Return the full JSON shape anyway."
        : "Write the executive summary JSON now." }] }],
    });
    const text = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const draft = normalizeSummary(json);
    if (!draft.financial.cagr.length) draft.financial.cagr = autoCagr(draft.financial.years);
    return NextResponse.json({ summary: draft });
  } catch (err) {
    console.error("[deal summary draft]", err);
    return NextResponse.json({ error: "Couldn't write the draft. Try again." }, { status: 502 });
  }
}
