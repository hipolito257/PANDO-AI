import { NextRequest, NextResponse } from "next/server";
import { db, companies, signals, companyTags, mandateMatches, activityLog } from "@/lib/db";
import { auth } from "@/lib/auth";
import { eq, desc, like, and, type SQL } from "drizzle-orm";
import { slugify } from "@/lib/utils";
import { randomUUID } from "crypto";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

async function logActivity(userId: string, userName: string, action: string, entityType: string, entityId: string, entityName: string, detail?: string) {
  try {
    await db.insert(activityLog).values({
      id: randomUUID(), userId, userName, action, entityType, entityId, entityName, detail: detail ?? null,
    });
  } catch { /* non-blocking */ }
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status    = searchParams.get("status");
  const sector    = searchParams.get("sector");
  const country   = searchParams.get("country");
  const stage     = searchParams.get("stage");
  const mandateId = searchParams.get("mandate");
  const q         = searchParams.get("q");
  const limit     = Number(searchParams.get("limit") ?? 100);

  const conditions: SQL[] = [];
  if (status)  conditions.push(eq(companies.status, status));
  if (sector)  conditions.push(eq(companies.sector, sector));
  if (country) conditions.push(eq(companies.country, country));
  if (stage)   conditions.push(eq(companies.stage, stage));
  if (q)       conditions.push(like(companies.name, `%${q}%`));

  const rows = await db.query.companies.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: {
      signals:        { orderBy: [desc(signals.date)], limit: 3 },
      tags:           true,
      mandateMatches: { with: { mandate: true } },
    },
    orderBy: [desc(companies.score)],
    limit,
  });

  let result = rows;
  if (mandateId) {
    result = rows.filter(c => c.mandateMatches.some((m: any) => m.mandateId === mandateId));
  }

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, ...rest } = body;
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const userId   = session.user.id;
  const userName = session.user.name ?? session.user.email ?? "User";
  const id       = uid();
  const slug     = `${slugify(name)}-${Date.now().toString(36)}`;

  await db.insert(companies).values({
    id, name, slug,
    sector:         rest.sector        ?? null,
    subsector:      rest.subsector     ?? null,
    country:        rest.country       ?? "Mexico",
    city:           rest.city          ?? null,
    stage:          rest.stage         ?? null,
    website:        rest.website       ?? null,
    linkedinUrl:    rest.linkedinUrl   ?? null,
    description:    rest.description   ?? null,
    revenueUsd:     rest.revenueUsd    != null ? Number(rest.revenueUsd)    : null,
    revenueGrowth:  rest.revenueGrowth != null ? Number(rest.revenueGrowth) : null,
    ebitdaUsd:      rest.ebitdaUsd     != null ? Number(rest.ebitdaUsd)     : null,
    ebitdaMargin:   rest.ebitdaMargin  != null ? Number(rest.ebitdaMargin)  : null,
    employees:      rest.employees     != null ? Number(rest.employees)     : null,
    employeeGrowth: rest.employeeGrowth!= null ? Number(rest.employeeGrowth): null,
    totalFunding:   rest.totalFunding  != null ? Number(rest.totalFunding)  : null,
    lastFundingAmt: rest.lastFundingAmt!= null ? Number(rest.lastFundingAmt): null,
    fundingStage:   rest.fundingStage  ?? null,
    score:          rest.score         != null ? Number(rest.score)         : 0,
    status:         rest.status        ?? "monitoring",
    createdBy:      userName,
    updatedBy:      userName,
  });

  await logActivity(userId, userName, "added_company", "company", id, name);

  const company = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  return NextResponse.json(company, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, ...rest } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const userId   = session.user.id;
  const userName = session.user.name ?? session.user.email ?? "User";

  const update: Record<string, unknown> = {};
  const numFields = ["revenueUsd","revenueGrowth","ebitdaUsd","ebitdaMargin","employees","employeeGrowth","totalFunding","lastFundingAmt","score"];
  const strFields = ["name","sector","subsector","country","city","stage","website","linkedinUrl","description","fundingStage","status"];

  for (const f of strFields) {
    if (f in rest) update[f] = rest[f] === "" ? null : rest[f];
  }
  for (const f of numFields) {
    if (f in rest) update[f] = rest[f] === "" || rest[f] == null ? null : Number(rest[f]);
  }

  if (Object.keys(update).length > 0) {
    update.updatedBy = userName;
    await db.update(companies).set(update as any).where(eq(companies.id, id));
  }

  const company = await db.query.companies.findFirst({
    where: eq(companies.id, id),
    with: { signals: { limit: 3 }, tags: true, mandateMatches: { with: { mandate: true } } },
  });

  await logActivity(userId, userName, "edited_company", "company", id, company?.name ?? id);

  return NextResponse.json(company);
}
