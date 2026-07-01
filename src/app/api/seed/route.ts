import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, dataSources, companies, signals, companyTags, mandates, mandateMatches } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const DATA_SOURCES = [
  { name: "google_news",    displayName: "Google News",              category: "news",         description: "Public news via Google News RSS. No cost or registration.",                                       website: "https://news.google.com",           logoColor: "#ea4335", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "No configuration required." },
  { name: "el_economista",  displayName: "El Economista",            category: "news",         description: "Leading financial and business news outlet in Mexico.",                                      website: "https://eleconomista.com.mx",       logoColor: "#1d4ed8", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Public RSS feed available without registration." },
  { name: "expansion",      displayName: "Expansión",                category: "news",         description: "Business news from Mexico and LATAM: startups, investments, economy, and companies.",                    website: "https://expansion.mx",              logoColor: "#16a34a", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Public RSS feed available without registration." },
  { name: "sat_mexico",     displayName: "SAT Mexico",               category: "registry",     description: "Public lookup of tax ID (RFC) and tax status of Mexican companies.",                                        website: "https://www.sat.gob.mx",            logoColor: "#b45309", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Public access without credentials." },
  { name: "rpc",            displayName: "Public Commerce Registry", category: "registry",     description: "Registry of legal entities in Mexico.",                                                                  website: "https://www.rpc.economia.gob.mx",   logoColor: "#6b7280", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Public access via the Ministry of Economy portal." },
  { name: "patent_office",  displayName: "IMPI — Patents",          category: "registry",     description: "Patent and trademark registry in Mexico (IMPI).",                                                         website: "https://www.impi.gob.mx",           logoColor: "#8b5cf6", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Free public lookup at impi.gob.mx." },
  { name: "capital_iq",     displayName: "Capital IQ",               category: "financial",    description: "Standard reference for historical financials, valuation multiples, and M&A transactions.",            website: "https://capitaliq.spglobal.com",    logoColor: "#2563eb", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Request access from your S&P Global representative (~$15k–$40k/year)." },
  { name: "pitchbook",      displayName: "PitchBook",                category: "financial",    description: "Private company database: funding rounds, valuations, investors, and founders.",                   website: "https://pitchbook.com",             logoColor: "#7c3aed", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Requires Enterprise subscription (~$10k–$25k/year)." },
  { name: "crunchbase",     displayName: "Crunchbase",               category: "financial",    description: "Startup profiles, funding rounds, founders, and investors.",                                  website: "https://crunchbase.com",            logoColor: "#0369a1", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Free plan (200 searches/day). API Pro from $29/month." },
  { name: "bloomberg",      displayName: "Bloomberg Terminal",        category: "financial",    description: "Real-time financial terminal: market data, news, debt and equity pricing.",               website: "https://bloomberg.com",             logoColor: "#dc2626", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Requires a Bloomberg Terminal subscription (~$25k/year per user)." },
  { name: "dealroom",       displayName: "Dealroom",                 category: "financial",    description: "Startup and scale-up intelligence with strong coverage of Europe and LATAM.",                              website: "https://dealroom.co",               logoColor: "#059669", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Annual subscription ~$5k–$12k." },
  { name: "news_api",       displayName: "NewsAPI",                  category: "news",         description: "Aggregates headlines from 150,000+ global sources in real time.",                                            website: "https://newsapi.org",               logoColor: "#d97706", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Free Developer plan (100 req/day). Business plan $449/month." },
  { name: "linkedin_sales", displayName: "LinkedIn Sales Nav",       category: "intelligence", description: "Employee data, org charts, founder work history, and hiring signals.",                     website: "https://business.linkedin.com",     logoColor: "#0a66c2", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Sales Navigator Team ~$1,000/year per user." },
  { name: "similarweb",     displayName: "SimilarWeb",               category: "alternative",  description: "Monthly web traffic, acquisition channels, and digital benchmarking.",                                      website: "https://similarweb.com",            logoColor: "#f97316", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Basic data free on the site. API from ~$250/month." },
  { name: "glassdoor",      displayName: "Glassdoor",                category: "alternative",  description: "Employee reviews, workplace culture, salary ranges, and leadership ratings.",                           website: "https://glassdoor.com",             logoColor: "#22c55e", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Basic public data free on the site." },
];

const DEMO_COMPANIES = [
  { id: "comp_konfio",    name: "Konfío",    slug: "konfio",    sector: "Fintech",   subsector: "SME Lending",          country: "Mexico",   city: "CDMX",       stage: "growth",    website: "https://konfio.mx",       description: "Credit and financial services platform for SMEs in Mexico.",                          revenueUsd: 120000, revenueGrowth: 35,  ebitdaUsd: 18000,  ebitdaMargin: 15, employees: 1200, employeeGrowth: 22, totalFunding: 475000, lastFundingAmt: 110000, fundingStage: "Series D", score: 87, confidence: 0.85, status: "pipeline" },
  { id: "comp_auronix",   name: "Auronix",   slug: "auronix",   sector: "Software",  subsector: "CPaaS / Messaging",    country: "Mexico",   city: "CDMX",       stage: "growth",    website: "https://auronix.com",     description: "Omnichannel enterprise communications platform. Leader in notifications in Mexico.",     revenueUsd: 32000,  revenueGrowth: 42,  ebitdaUsd: 9600,   ebitdaMargin: 30, employees: 280,  employeeGrowth: 30, totalFunding: 25000,  lastFundingAmt: 15000,  fundingStage: "Series A", score: 91, confidence: 0.88, status: "pipeline" },
  { id: "comp_simetrik",  name: "Simetrik",  slug: "simetrik",  sector: "Software",  subsector: "Finance Automation",   country: "Colombia", city: "Bogotá",     stage: "series-b",  website: "https://simetrik.com",    description: "No-code financial reconciliation platform. Automates accounting close processes.",       revenueUsd: 15000,  revenueGrowth: 95,  ebitdaUsd: 1500,   ebitdaMargin: 10, employees: 180,  employeeGrowth: 55, totalFunding: 30000,  lastFundingAmt: 20000,  fundingStage: "Series B", score: 88, confidence: 0.82, status: "pipeline" },
  { id: "comp_clip",      name: "Clip",      slug: "clip",      sector: "Fintech",   subsector: "Payments",             country: "Mexico",   city: "CDMX",       stage: "growth",    website: "https://clip.mx",         description: "Card payment solution for SMEs and entrepreneurs in Mexico.",                          revenueUsd: 85000,  revenueGrowth: 28,  ebitdaUsd: 8500,   ebitdaMargin: 10, employees: 950,  employeeGrowth: 18, totalFunding: 250000, lastFundingAmt: 70000,  fundingStage: "Series C", score: 82, confidence: 0.80, status: "monitoring" },
  { id: "comp_nowports",  name: "Nowports",  slug: "nowports",  sector: "Logistics", subsector: "Digital Freight",      country: "Mexico",   city: "Monterrey",  stage: "series-b",  website: "https://nowports.com",    description: "Digital freight forwarder for LATAM. Automates imports/exports.",                 revenueUsd: 45000,  revenueGrowth: 80,  ebitdaUsd: -3000,  ebitdaMargin: -7, employees: 600,  employeeGrowth: 45, totalFunding: 120000, lastFundingAmt: 90000,  fundingStage: "Series B", score: 74, confidence: 0.75, status: "monitoring" },
  { id: "comp_moons",     name: "Moons",     slug: "moons",     sector: "Healthcare",subsector: "Dental / D2C",         country: "Mexico",   city: "CDMX",       stage: "growth",    website: "https://mymoons.mx",      description: "Direct-to-consumer invisible orthodontics with its own clinic network in LATAM.",                   revenueUsd: 28000,  revenueGrowth: 65,  ebitdaUsd: 2800,   ebitdaMargin: 10, employees: 450,  employeeGrowth: 40, totalFunding: 60000,  lastFundingAmt: 25000,  fundingStage: "Series B", score: 79, confidence: 0.78, status: "monitoring" },
  { id: "comp_truora",    name: "Truora",    slug: "truora",    sector: "Software",  subsector: "Identity / KYC",       country: "Colombia", city: "Bogotá",     stage: "series-a",  website: "https://truora.com",      description: "Identity verification and background check APIs for LATAM. Integrated in 20+ countries.",   revenueUsd: 8000,   revenueGrowth: 110, ebitdaUsd: -500,   ebitdaMargin: -6, employees: 120,  employeeGrowth: 70, totalFunding: 15000,  lastFundingAmt: 12000,  fundingStage: "Series A", score: 75, confidence: 0.72, status: "monitoring" },
  { id: "comp_urbvan",    name: "Urbvan",    slug: "urbvan",    sector: "Mobility",  subsector: "Mass Transit",         country: "Mexico",   city: "CDMX",       stage: "series-b",  website: "https://urbvan.com",      description: "Last-mile collective transportation for companies. Shared van network.",                  revenueUsd: 18000,  revenueGrowth: 55,  ebitdaUsd: -1200,  ebitdaMargin: -7, employees: 380,  employeeGrowth: 60, totalFunding: 40000,  lastFundingAmt: 18000,  fundingStage: "Series B", score: 68, confidence: 0.70, status: "monitoring" },
];

const DEMO_SIGNALS = [
  { id: "sig1", companyId: "comp_auronix",  type: "funding_due",           title: "Series B round in progress",         detail: "Sources indicate a $30-40M round with a lead investor from the US.",                      severity: "high",   date: "2026-06-01" },
  { id: "sig2", companyId: "comp_simetrik", type: "competitor_acquired",   title: "Nuvei acquired Conciliac",         detail: "Direct competitor acquired by Nuvei for $18M. Could accelerate a sale decision.", severity: "high",   date: "2026-05-28" },
  { id: "sig3", companyId: "comp_konfio",   type: "hiring_surge",          title: "+40 open positions in LATAM", detail: "Expansion into Colombia and Chile. Hiring in sales, product, and tech.",              severity: "medium", date: "2026-05-20" },
  { id: "sig4", companyId: "comp_moons",    type: "revenue_inflection",    title: "Accelerated growth in Q1 2026",    detail: "Sources indicate >80% YoY in Q1 vs. 65% in 2025.",                                  severity: "medium", date: "2026-05-15" },
  { id: "sig5", companyId: "comp_truora",   type: "exec_change",           title: "New CFO with exit experience",    detail: "Hired former Kavak CFO. Signal of preparation for a funding round or sale process.",  severity: "medium", date: "2026-06-03" },
  { id: "sig6", companyId: "comp_nowports", type: "strategic_buyer_interest",title: "DHL explored acquisition",        detail: "Informal conversations reported at a logistics conference in Panama.",         severity: "high",   date: "2026-06-05" },
];

const DEMO_TAGS = [
  { companyId: "comp_konfio",   tag: "Fintech" }, { companyId: "comp_konfio",   tag: "High Growth" }, { companyId: "comp_konfio",   tag: "Pipeline" },
  { companyId: "comp_auronix",  tag: "SaaS" },    { companyId: "comp_auronix",  tag: "High Margin" }, { companyId: "comp_auronix",  tag: "Pipeline" },
  { companyId: "comp_simetrik", tag: "SaaS" },    { companyId: "comp_simetrik", tag: "Series B" },
  { companyId: "comp_clip",     tag: "Fintech" },
  { companyId: "comp_nowports", tag: "Logistics" },
  { companyId: "comp_moons",    tag: "Healthcare" },
];

const DEMO_MANDATES = [
  { id: "mand_mx_tech",        name: "Tech & SaaS Mexico",    description: "B2B software, vertical platforms, digital infrastructure", sectors: ["Software","SaaS","Fintech","Proptech"],                            countries: ["Mexico"],                              stages: ["series-a","series-b","growth"], minRevenue: 1000,  maxRevenue: 50000, thesis: "Software platforms with economies of scale, high retention, and subscription models." },
  { id: "mand_latam_consumer", name: "Consumer LATAM",        description: "Mass consumer brands and retail, LATAM",                      sectors: ["Consumer","Retail","Food & Beverage","Healthcare"],                countries: ["Mexico","Colombia","Chile","Peru"],     stages: ["growth","mature"],              minRevenue: 5000,  maxRevenue: null,  thesis: "Brands with high market penetration, stable margins, and regional expansion potential." },
];

const DEMO_MATCHES = [
  { companyId: "comp_auronix",  mandateId: "mand_mx_tech",        score: 94, tier: "strong",    rationale: "B2B SaaS with >30% margins, high retention, vertical market in enterprise communications." },
  { companyId: "comp_konfio",   mandateId: "mand_mx_tech",        score: 82, tier: "strong",    rationale: "Credit fintech with 35% YoY growth. Proprietary data model with competitive advantage." },
  { companyId: "comp_simetrik", mandateId: "mand_mx_tech",        score: 88, tier: "strong",    rationale: "Finance automation SaaS, 95% YoY growth, natural expansion into LATAM." },
  { companyId: "comp_clip",     mandateId: "mand_mx_tech",        score: 75, tier: "candidate", rationale: "Payments in Mexico with good growth, though competition with Conekta/Stripe is intense." },
  { companyId: "comp_moons",    mandateId: "mand_latam_consumer", score: 79, tier: "strong",    rationale: "D2C healthcare with natural LATAM expansion. Improving margins and scalable model." },
  { companyId: "comp_nowports", mandateId: "mand_latam_consumer", score: 62, tier: "candidate", rationale: "Digital logistics with strong growth, though negative EBITDA is a risk." },
];

// GET /api/seed — create initial data
export async function GET() {
  const results: string[] = [];
  try {
    // ── User ─────────────────────────────────────────────────────────────────────
    const existing = await db.query.users.findFirst({ where: eq(users.email, "pablo.morincon@gmail.com") });
    if (!existing) {
      const pw = await bcrypt.hash("pando2026", 10);
      await db.insert(users).values({ id: randomUUID(), name: "Pablo Morincon", email: "pablo.morincon@gmail.com", password: pw, role: "admin" });
      results.push("✓ User created: pablo.morincon@gmail.com / pando2026");
    } else {
      results.push("✓ User already exists");
    }

    // ── Data Sources ──────────────────────────────────────────────────────────────
    let dsCreated = 0;
    for (const src of DATA_SOURCES) {
      const exists = await db.query.dataSources.findFirst({ where: eq(dataSources.name, src.name) });
      if (!exists) { await db.insert(dataSources).values({ id: randomUUID(), ...src }); dsCreated++; }
    }
    results.push(`✓ Data sources: ${dsCreated} created`);

    // ── Mandates ──────────────────────────────────────────────────────────────────
    let mandCreated = 0;
    for (const m of DEMO_MANDATES) {
      const exists = await db.query.mandates.findFirst({ where: eq(mandates.id, m.id) });
      if (!exists) {
        await db.insert(mandates).values({ ...m, sectors: JSON.stringify(m.sectors), countries: JSON.stringify(m.countries), stages: JSON.stringify(m.stages), maxRevenue: m.maxRevenue ?? null, isActive: true, createdBy: "PANDO System", updatedBy: "PANDO System" });
        mandCreated++;
      }
    }
    results.push(`✓ Mandates: ${mandCreated} created`);

    // ── Companies ─────────────────────────────────────────────────────────────────
    let coCreated = 0;
    for (const co of DEMO_COMPANIES) {
      const exists = await db.query.companies.findFirst({ where: eq(companies.id, co.id) });
      if (!exists) { await db.insert(companies).values({ ...co, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: "PANDO System", updatedBy: "PANDO System" }); coCreated++; }
    }
    results.push(`✓ Companies: ${coCreated} created`);

    // ── Signals ───────────────────────────────────────────────────────────────────
    let sigCreated = 0;
    for (const s of DEMO_SIGNALS) {
      const exists = await db.query.signals.findFirst({ where: eq(signals.id, s.id) });
      if (!exists) { await db.insert(signals).values({ ...s, isRead: false }); sigCreated++; }
    }
    results.push(`✓ Signals: ${sigCreated} created`);

    // ── Tags ──────────────────────────────────────────────────────────────────────
    for (const t of DEMO_TAGS) {
      const exists = await db.query.companyTags.findFirst({
        where: (ct, { and, eq }) => and(eq(ct.companyId, t.companyId), eq(ct.tag, t.tag)),
      });
      if (!exists) {
        try { await db.insert(companyTags).values({ id: uid(), ...t }); } catch { /* skip */ }
      }
    }
    results.push("✓ Tags created");

    // ── Mandate Matches ───────────────────────────────────────────────────────────
    let matchCreated = 0;
    for (const mm of DEMO_MATCHES) {
      const exists = await db.query.mandateMatches.findFirst({
        where: (m, { and, eq }) => and(eq(m.companyId, mm.companyId), eq(m.mandateId, mm.mandateId)),
      });
      if (!exists) {
        try { await db.insert(mandateMatches).values({ id: uid(), ...mm, updatedAt: new Date().toISOString() }); matchCreated++; } catch { /* skip */ }
      }
    }
    results.push(`✓ Mandate matches: ${matchCreated} created`);

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), results }, { status: 500 });
  }
}

export async function POST() { return GET(); }
