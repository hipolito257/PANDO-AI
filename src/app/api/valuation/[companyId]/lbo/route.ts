import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { db, financialModels, companies } from "@/lib/db";
import { normalizeLbo, type LboInputs } from "@/lib/lboCalc";

// POST { name, assumptions } — save a new LBO case on the company
export async function POST(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { companyId } = await params;
  const body = (await req.json().catch(() => ({}))) as { name?: string; assumptions?: Partial<LboInputs> };
  const company = await db.query.companies.findFirst({ where: eq(companies.id, companyId), columns: { name: true } });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });
  const a = normalizeLbo({ ...body.assumptions, companyName: company.name });
  if (!(a.entryEbitda > 0) || !(a.revenueYear0 > 0)) return NextResponse.json({ error: "Entry EBITDA and revenue must be greater than 0" }, { status: 400 });
  const id = randomUUID();
  const name = (body.name?.trim() || "LBO case").slice(0, 120);
  await db.insert(financialModels).values({
    id, companyId, companyName: company.name, modelType: "lbo", name,
    status: "built", assumptions: JSON.stringify(a), contextFiles: "[]", createdBy: session.user.id, updatedBy: session.user.id,
  });
  return NextResponse.json({ id, name, assumptions: a }, { status: 201 });
}

// PATCH { id, name?, assumptions? } — update a saved case
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { companyId } = await params;
  const body = (await req.json().catch(() => ({}))) as { id?: string; name?: string; assumptions?: Partial<LboInputs> };
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const where = and(eq(financialModels.id, body.id), eq(financialModels.companyId, companyId));
  const row = await db.query.financialModels.findFirst({ where });
  if (!row) return NextResponse.json({ error: "Model not found" }, { status: 404 });
  const set: Record<string, unknown> = { updatedAt: new Date().toISOString(), updatedBy: session.user.id };
  if (body.name?.trim()) set.name = body.name.trim().slice(0, 120);
  if (body.assumptions) {
    let prev: Partial<LboInputs> = {};
    try { prev = JSON.parse(row.assumptions || "{}"); } catch { prev = {}; }
    set.assumptions = JSON.stringify(normalizeLbo({ ...prev, ...body.assumptions }));
  }
  await db.update(financialModels).set(set).where(where);
  return NextResponse.json({ ok: true });
}

// DELETE ?id= — remove a saved case
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { companyId } = await params;
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(financialModels).where(and(eq(financialModels.id, id), eq(financialModels.companyId, companyId)));
  return NextResponse.json({ ok: true });
}
