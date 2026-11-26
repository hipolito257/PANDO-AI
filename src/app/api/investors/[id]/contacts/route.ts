// People at an investor: add, edit, remove, mark the primary contact.
import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db, investorContacts } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
function fields(b: Record<string, unknown>) {
  const out: Partial<typeof investorContacts.$inferInsert> = {};
  if (b.name !== undefined) { const v = str(b.name, 120); if (v) out.name = v; }
  for (const [k, max] of [["role", 120], ["email", 160], ["phone", 60], ["linkedinUrl", 300], ["notes", 2000]] as const) if (b[k] !== undefined) out[k] = str(b[k], max);
  if (out.email) out.email = out.email.toLowerCase();
  return out;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const f = fields(b);
  if (!f.name) return NextResponse.json({ error: "Write the person's name" }, { status: 400 });
  const existing = await db.select({ id: investorContacts.id }).from(investorContacts).where(eq(investorContacts.investorId, id));
  const t = new Date().toISOString();
  const cid = randomUUID();
  await db.insert(investorContacts).values({ ...f, name: f.name, id: cid, investorId: id, isPrimary: existing.length === 0,
    source: b.source === "ai" ? "ai" : "manual", createdAt: t, updatedAt: t });
  return NextResponse.json({ id: cid }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  if (typeof b.contactId !== "string") return NextResponse.json({ error: "contactId required" }, { status: 400 });
  const where = and(eq(investorContacts.id, b.contactId), eq(investorContacts.investorId, id));
  if (b.isPrimary === true) {
    await db.update(investorContacts).set({ isPrimary: false }).where(eq(investorContacts.investorId, id));
    await db.update(investorContacts).set({ isPrimary: true }).where(where);
  }
  const f = fields(b);
  if (Object.keys(f).length) await db.update(investorContacts).set({ ...f, updatedAt: new Date().toISOString() }).where(where);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  if (typeof b.contactId !== "string") return NextResponse.json({ error: "contactId required" }, { status: 400 });
  await db.delete(investorContacts).where(and(eq(investorContacts.id, b.contactId), eq(investorContacts.investorId, id)));
  return NextResponse.json({ ok: true });
}
