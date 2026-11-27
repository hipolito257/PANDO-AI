// Cap table of a company: GET it, PUT the team's edits, POST to draft it with
// Claude from the company's documents (returned for review, not saved).
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, companies, userSettings } from "@/lib/db";
import { nowIso } from "@/lib/deals";
import { companyFileBlocks } from "@/lib/companyContext";
import { CAP_DRAFT_SYSTEM, emptyCapTable, normalizeCapTable, parseCapTable } from "@/lib/capTable";

export const maxDuration = 120;
type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [c] = await db.select({ capTable: companies.capTable }).from(companies).where(eq(companies.id, id)).limit(1);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ capTable: parseCapTable(c.capTable) ?? emptyCapTable() });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const capTable = { ...normalizeCapTable(body.capTable), updatedAt: nowIso(), updatedBy: session.user.name ?? "User" };
  const total = capTable.holders.reduce((n, h) => n + (h.pct ?? 0), 0);
  if (total > 100.5) return NextResponse.json({ error: `The percentages add up to ${total.toFixed(1)}%. They can't pass 100%.` }, { status: 400 });
  const res = await db.update(companies).set({ capTable: JSON.stringify(capTable), updatedAt: nowIso() }).where(eq(companies.id, id)).returning({ id: companies.id });
  if (!res.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ capTable });
}

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const company = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Add your Anthropic API key in Settings to use AI." }, { status: 400 });

  const files = await companyFileBlocks(company.id, null);
  if (!files.blocks.length) return NextResponse.json({ error: "Upload the company's documents first (Documents tab), then try again." }, { status: 400 });
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      output_config: { effort: "medium" },
      system: CAP_DRAFT_SYSTEM,
      messages: [{ role: "user", content: [...files.blocks, { type: "text", text: `Extract the cap table of ${company.name}.` }] }],
    });
    const text = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("");
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const draft = normalizeCapTable(json);
    if (!draft.holders.length) return NextResponse.json({ error: `The documents don't say who owns ${company.name}. Add the holders by hand.` }, { status: 422 });
    return NextResponse.json({ capTable: draft, files: files.names });
  } catch (err) {
    console.error("[cap table draft]", err);
    return NextResponse.json({ error: "Couldn't read the cap table from the documents. Try again." }, { status: 502 });
  }
}
