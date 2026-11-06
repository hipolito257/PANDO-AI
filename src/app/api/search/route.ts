import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, userSettings } from "@/lib/db";
import { expandQuery, searchChunks, type SearchHit } from "@/lib/docIndex";

export const maxDuration = 60;
const ANSWER_MODEL = "claude-sonnet-5-5";

// POST { query, companyId?, answer? } — search over company documents,
// optionally with an answer written by Claude that cites the passages [n].
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { query, companyId, answer } = (await req.json().catch(() => ({}))) as { query?: string; companyId?: string; answer?: boolean };
  const q = query?.trim().slice(0, 1000);
  if (!q) return NextResponse.json({ error: "Write something to search for" }, { status: 400 });

  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;

  let hits: SearchHit[];
  try {
    const terms = await expandQuery(q, apiKey);
    hits = await searchChunks(q, { companyId: companyId || null, limit: answer ? 12 : 20, terms });
  } catch (err) {
    console.error("[search]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Search failed" }, { status: 502 });
  }
  if (!answer || !hits.length) return NextResponse.json({ hits, answer: null });
  if (!apiKey) return NextResponse.json({ hits, answer: null, answerError: "Add your Anthropic API key in Settings to get answers." });

  const sources = hits.map((h, i) => `[${i + 1}] ${h.companyName} · ${h.filename} · ${h.locator ?? ""}\n${h.text}`).join("\n\n");
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({
      model: ANSWER_MODEL,
      max_tokens: 1200,
      system: "You answer questions for a private equity team using only the document passages provided. Cite every claim with the passage number in square brackets, e.g. [2] or [1][4]. If the passages don't contain the answer, say so plainly and mention what they do cover. Be concise and precise with numbers, currencies, periods and units. Answer in the language of the question.",
      messages: [{ role: "user", content: `Passages:\n\n${sources}\n\nQuestion: ${q}` }],
    });
    const text = msg.content.flatMap(b => (b.type === "text" ? [b.text] : [])).join("\n").trim();
    return NextResponse.json({ hits, answer: text });
  } catch (err) {
    console.error("[search answer]", err);
    return NextResponse.json({ hits, answer: null, answerError: "Couldn't write an answer; the matching passages are below." });
  }
}
