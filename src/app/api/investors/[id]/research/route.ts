// POST — research the investor with AI (web search) and score it. Runs in the
// background; the page polls the investor until researchStatus is done/error.
// POST { addPerson: {...} } — add a person the research found as a contact.
import { NextRequest, NextResponse, after } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, investors, userSettings } from "@/lib/db";
import { addResearchedContact, researchInvestor } from "@/lib/investorResearch";

export const maxDuration = 300;
type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const [inv] = await db.select({ id: investors.id, researchStatus: investors.researchStatus, updatedAt: investors.updatedAt })
    .from(investors).where(eq(investors.id, id)).limit(1);
  if (!inv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  if (b.addPerson && typeof b.addPerson.name === "string") {
    const cid = await addResearchedContact(id, b.addPerson);
    return NextResponse.json({ id: cid }, { status: 201 });
  }

  const setting = await db.query.userSettings.findFirst({ where: eq(userSettings.userId, session.user.id) });
  const apiKey = setting?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Add your Anthropic API key in Settings to research with AI." }, { status: 400 });
  // A run marked "running" for over 10 minutes died: allow a new one.
  if (inv.researchStatus === "running" && Date.now() - new Date(inv.updatedAt).getTime() < 10 * 60_000) {
    return NextResponse.json({ status: "running" }, { status: 202 });
  }
  await db.update(investors).set({ researchStatus: "running", researchError: null, updatedAt: new Date().toISOString() }).where(eq(investors.id, id));
  after(() => researchInvestor(id, apiKey));
  return NextResponse.json({ status: "running" }, { status: 202 });
}
