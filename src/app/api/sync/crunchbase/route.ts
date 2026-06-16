import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { companies, dataSources } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { slugify } from "@/lib/utils";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const CB_BASE = "https://api.crunchbase.com/api/v4";

// Employee range → midpoint number
const EMP_MAP: Record<string, number> = {
  "c_00001_00010":  5,   "c_00011_00050":  30,  "c_00051_00100":  75,
  "c_00101_00250":  175, "c_00251_00500":  375, "c_00501_01000":  750,
  "c_01001_05000":  3000,"c_05001_10000":  7500,"c_10001_max":    15000,
};

// Country name normalizer
function normalizeCountry(loc: string): string {
  const l = loc.toLowerCase();
  if (l.includes("mexico") || l.includes("méxico")) return "México";
  if (l.includes("colombia"))  return "Colombia";
  if (l.includes("chile"))     return "Chile";
  if (l.includes("peru") || l.includes("perú")) return "Perú";
  if (l.includes("brazil") || l.includes("brasil")) return "Brasil";
  if (l.includes("argentina")) return "Argentina";
  return loc.split(",").pop()?.trim() ?? loc;
}

// Get Crunchbase API key from DB
async function getCBKey(): Promise<string | null> {
  const src = await db.query.dataSources.findFirst({ where: eq(dataSources.name, "crunchbase") });
  return (src as any)?.apiKey ?? null;
}

// ── GET — search Crunchbase ───────────────────────────────────────────────────
// ?q=fintech+mexico&limit=20
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const apiKey = await getCBKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Crunchbase API key not configured. Agrégala en Conectores → Crunchbase." },
      { status: 400 }
    );
  }

  const q     = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 25), 50);

  if (!q.trim()) return NextResponse.json([]);

  // Step 1 — autocomplete search (free tier)
  const acRes = await fetch(
    `${CB_BASE}/autocompletes?user_key=${apiKey}&query=${encodeURIComponent(q)}&collection_ids=organizations&limit=${limit}`,
    { headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(10000) }
  );

  if (!acRes.ok) {
    const msg = await acRes.text();
    return NextResponse.json({ error: `Crunchbase error ${acRes.status}: ${msg.slice(0, 200)}` }, { status: acRes.status });
  }

  const acData = await acRes.json();
  const entities: any[] = acData.entities ?? [];

  // Step 2 — enrich each result with entity details
  const results = await Promise.all(
    entities.slice(0, 15).map(async (e: any) => {
      const permalink = e.identifier?.permalink;
      if (!permalink) return null;

      try {
        const detailRes = await fetch(
          `${CB_BASE}/entities/organizations/${permalink}?user_key=${apiKey}&field_ids=short_description,website,location_identifiers,categories,funding_total,last_funding_type,num_employees_enum,founded_on`,
          { signal: AbortSignal.timeout(6000) }
        );
        if (!detailRes.ok) return null;
        const d = await detailRes.json();
        const props = d.properties ?? {};

        const locationRaw = props.location_identifiers?.[0]?.value ?? "";
        const country     = normalizeCountry(locationRaw);
        const sector      = props.categories?.[0]?.value ?? null;
        const employees   = EMP_MAP[props.num_employees_enum?.value ?? ""] ?? null;

        // Check if already in our DB
        const existingSlug = slugify(e.identifier.value);
        const alreadyIn = await db.query.companies.findFirst({
          where: eq(companies.name, e.identifier.value),
        });

        return {
          cbPermalink:    permalink,
          name:           e.identifier.value,
          description:    props.short_description ?? e.short_description ?? null,
          website:        props.website?.value ?? null,
          country,
          city:           locationRaw.split(",")[0]?.trim() ?? null,
          sector,
          fundingStage:   props.last_funding_type?.value ?? null,
          totalFunding:   props.funding_total?.value_usd ?? null,
          employees,
          alreadyImported: !!alreadyIn,
        };
      } catch {
        return null;
      }
    })
  );

  return NextResponse.json(results.filter(Boolean));
}

// ── POST — import a company from Crunchbase ───────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { name, description, website, country, city, sector, fundingStage, totalFunding, employees } = body;

  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  // Prevent duplicates
  const existing = await db.query.companies.findFirst({ where: eq(companies.name, name) });
  if (existing) {
    return NextResponse.json({ alreadyExists: true, company: existing });
  }

  const id   = uid();
  const slug = `${slugify(name)}-${Date.now().toString(36)}`;

  await db.insert(companies).values({
    id, name, slug,
    description:    description ?? null,
    website:        website     ?? null,
    country:        country     ?? "México",
    city:           city        ?? null,
    sector:         sector      ?? null,
    fundingStage:   fundingStage?? null,
    totalFunding:   totalFunding?? null,
    employees:      employees   ?? null,
    score:          0,
    status:         "monitoring",
  });

  const company = await db.query.companies.findFirst({ where: eq(companies.id, id) });
  return NextResponse.json({ imported: true, company }, { status: 201 });
}
