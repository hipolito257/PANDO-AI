import { NextRequest, NextResponse } from "next/server";
import { db, companies, activityLog } from "@/lib/db";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// DELETE /api/companies/[id] — hard delete. Child rows (signals, notes,
// financialModels, companyTags, mandateMatches, compSets, founders) cascade
// via the FK constraints already defined on those tables in schema.ts.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const company = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.delete(companies).where(eq(companies.id, id));

  const userName = session.user.name ?? session.user.email ?? "User";
  try {
    await db.insert(activityLog).values({
      id: randomUUID(),
      userId: session.user.id,
      userName,
      action: "deleted_company",
      entityType: "company",
      entityId: id,
      entityName: company.name,
    });
  } catch { /* non-blocking */ }

  return NextResponse.json({ ok: true });
}
