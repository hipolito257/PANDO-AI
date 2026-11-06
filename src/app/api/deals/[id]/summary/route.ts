import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { asc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, deals, companies, financialSnapshots, userSettings } from "@/lib/db";
import { logDeal, nowIso } from "@/lib/deals";
import { companyKnowledgeText } from "@/lib/companyContext";
import { DRAFT_SYSTEM, autoCagr, emptySummary, normalizeSummary, parseSummary, type DealSummary } from "@/lib/dealSummary";

export const maxDuration = 120;
type Params = { params: Promise<{ id: string }> };

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
  return NextResponse.json({ summary: saved ?? await prefill(deal.companyId), saved: !!saved });
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
export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const deal = await db.query.deals.findFirst({ where: eq(deals.id, id), with: { company: true } });
  if (!deal) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Add your Anthropic API key in Settings to draft with AI." }, { status: 400 });

  const c = deal.company;
  const knowledge = await companyKnowledgeText(c.id, 30000);
  const base = await prefill(c.id);
  const context = [
    `Company: ${c.name} · ${c.sector ?? ""} · ${c.country}`,
    c.description && `Description: ${c.description}`,
    `Deal: ${deal.codeName} (${deal.type})${deal.dealSize ? `, size ${deal.dealSize} ${deal.currency}` : ""}${deal.description ? `. ${deal.description}` : ""}`,
    base.financial.years.length && `Financials on the platform (USD $m): ${JSON.stringify(base.financial.years)}`,
    knowledge || "No documents have been analysed for this company yet.",
  ].filter(Boolean).join("\n\n");

  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      system: DRAFT_SYSTEM,
      messages: [{ role: "user", content: context }],
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
