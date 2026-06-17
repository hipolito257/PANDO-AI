import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, dataSources, companies, signals, companyTags, mandates, mandateMatches } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

const DATA_SOURCES = [
  { name: "google_news",    displayName: "Google News",              category: "news",         description: "Noticias públicas vía RSS de Google News. Sin costo ni registro.",                                       website: "https://news.google.com",           logoColor: "#ea4335", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Sin configuración necesaria." },
  { name: "el_economista",  displayName: "El Economista",            category: "news",         description: "Principal medio de noticias financieras y empresariales de México.",                                      website: "https://eleconomista.com.mx",       logoColor: "#1d4ed8", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Feed RSS público disponible sin registro." },
  { name: "expansion",      displayName: "Expansión",                category: "news",         description: "Noticias de negocios de México y LATAM: startups, inversiones, economía y empresas.",                    website: "https://expansion.mx",              logoColor: "#16a34a", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Feed RSS público disponible sin registro." },
  { name: "sat_mexico",     displayName: "SAT México",               category: "registry",     description: "Consulta pública del RFC y estatus fiscal de empresas mexicanas.",                                        website: "https://www.sat.gob.mx",            logoColor: "#b45309", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Acceso público sin credenciales." },
  { name: "rpc",            displayName: "Reg. Público de Comercio", category: "registry",     description: "Registro de personas morales en México.",                                                                  website: "https://www.rpc.economia.gob.mx",   logoColor: "#6b7280", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Acceso público vía portal de la Secretaría de Economía." },
  { name: "patent_office",  displayName: "IMPI — Patentes",          category: "registry",     description: "Registro de patentes y marcas en México (IMPI).",                                                         website: "https://www.impi.gob.mx",           logoColor: "#8b5cf6", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Consulta pública gratuita en impi.gob.mx." },
  { name: "capital_iq",     displayName: "Capital IQ",               category: "financial",    description: "Referencia estándar para financieros históricos, múltiplos de valuación y transacciones M&A.",            website: "https://capitaliq.spglobal.com",    logoColor: "#2563eb", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Solicita acceso a tu representante de S&P Global (~$15k–$40k/año)." },
  { name: "pitchbook",      displayName: "PitchBook",                category: "financial",    description: "Base de datos de empresas privadas: rondas, valuaciones, inversionistas y fundadores.",                   website: "https://pitchbook.com",             logoColor: "#7c3aed", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Requiere suscripción Enterprise (~$10k–$25k/año)." },
  { name: "crunchbase",     displayName: "Crunchbase",               category: "financial",    description: "Perfiles de startups, rondas de inversión, fundadores e inversionistas.",                                  website: "https://crunchbase.com",            logoColor: "#0369a1", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Plan gratuito (200 búsquedas/día). API Pro desde $29/mes." },
  { name: "bloomberg",      displayName: "Bloomberg Terminal",        category: "financial",    description: "Terminal financiero en tiempo real: datos de mercado, noticias, pricing de deuda y equity.",               website: "https://bloomberg.com",             logoColor: "#dc2626", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Requiere suscripción al Bloomberg Terminal (~$25k/año por usuario)." },
  { name: "dealroom",       displayName: "Dealroom",                 category: "financial",    description: "Inteligencia de startups y scale-ups con buena cobertura de Europa y LATAM.",                              website: "https://dealroom.co",               logoColor: "#059669", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Suscripción anual ~$5k–$12k." },
  { name: "news_api",       displayName: "NewsAPI",                  category: "news",         description: "Agrega titulares de +150,000 fuentes globales en tiempo real.",                                            website: "https://newsapi.org",               logoColor: "#d97706", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Plan Developer gratis (100 req/día). Plan Business $449/mes." },
  { name: "linkedin_sales", displayName: "LinkedIn Sales Nav",       category: "intelligence", description: "Datos de empleados, org charts, historial laboral de fundadores y señales de hiring.",                     website: "https://business.linkedin.com",     logoColor: "#0a66c2", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Sales Navigator Team ~$1,000/año por usuario." },
  { name: "similarweb",     displayName: "SimilarWeb",               category: "alternative",  description: "Tráfico web mensual, canales de adquisición y benchmarking digital.",                                      website: "https://similarweb.com",            logoColor: "#f97316", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Datos básicos gratis en el sitio. API desde ~$250/mes." },
  { name: "glassdoor",      displayName: "Glassdoor",                category: "alternative",  description: "Reseñas de empleados, clima laboral, rango de salarios y rating de liderazgo.",                           website: "https://glassdoor.com",             logoColor: "#22c55e", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Datos públicos básicos gratis en el sitio." },
];

const DEMO_COMPANIES = [
  { id: "comp_konfio",    name: "Konfío",    slug: "konfio",    sector: "Fintech",   subsector: "SME Lending",          country: "México",   city: "CDMX",       stage: "growth",    website: "https://konfio.mx",       description: "Plataforma de crédito y servicios financieros para PyMEs en México.",                          revenueUsd: 120000, revenueGrowth: 35,  ebitdaUsd: 18000,  ebitdaMargin: 15, employees: 1200, employeeGrowth: 22, totalFunding: 475000, lastFundingAmt: 110000, fundingStage: "Series D", score: 87, confidence: 0.85, status: "pipeline" },
  { id: "comp_auronix",   name: "Auronix",   slug: "auronix",   sector: "Software",  subsector: "CPaaS / Messaging",    country: "México",   city: "CDMX",       stage: "growth",    website: "https://auronix.com",     description: "Plataforma omnicanal de comunicaciones empresariales. Líder en México en notificaciones.",     revenueUsd: 32000,  revenueGrowth: 42,  ebitdaUsd: 9600,   ebitdaMargin: 30, employees: 280,  employeeGrowth: 30, totalFunding: 25000,  lastFundingAmt: 15000,  fundingStage: "Series A", score: 91, confidence: 0.88, status: "pipeline" },
  { id: "comp_simetrik",  name: "Simetrik",  slug: "simetrik",  sector: "Software",  subsector: "Finance Automation",   country: "Colombia", city: "Bogotá",     stage: "series-b",  website: "https://simetrik.com",    description: "Plataforma no-code de conciliación financiera. Automatiza procesos de cierre contable.",       revenueUsd: 15000,  revenueGrowth: 95,  ebitdaUsd: 1500,   ebitdaMargin: 10, employees: 180,  employeeGrowth: 55, totalFunding: 30000,  lastFundingAmt: 20000,  fundingStage: "Series B", score: 88, confidence: 0.82, status: "pipeline" },
  { id: "comp_clip",      name: "Clip",      slug: "clip",      sector: "Fintech",   subsector: "Payments",             country: "México",   city: "CDMX",       stage: "growth",    website: "https://clip.mx",         description: "Solución de pagos con tarjeta para PyMEs y emprendedores en México.",                          revenueUsd: 85000,  revenueGrowth: 28,  ebitdaUsd: 8500,   ebitdaMargin: 10, employees: 950,  employeeGrowth: 18, totalFunding: 250000, lastFundingAmt: 70000,  fundingStage: "Series C", score: 82, confidence: 0.80, status: "monitoring" },
  { id: "comp_nowports",  name: "Nowports",  slug: "nowports",  sector: "Logistics", subsector: "Digital Freight",      country: "México",   city: "Monterrey",  stage: "series-b",  website: "https://nowports.com",    description: "Freight forwarder digital para LATAM. Automatiza importaciones/exportaciones.",                 revenueUsd: 45000,  revenueGrowth: 80,  ebitdaUsd: -3000,  ebitdaMargin: -7, employees: 600,  employeeGrowth: 45, totalFunding: 120000, lastFundingAmt: 90000,  fundingStage: "Series B", score: 74, confidence: 0.75, status: "monitoring" },
  { id: "comp_moons",     name: "Moons",     slug: "moons",     sector: "Healthcare",subsector: "Dental / D2C",         country: "México",   city: "CDMX",       stage: "growth",    website: "https://mymoons.mx",      description: "Ortodoncia invisible directa al consumidor con red clínica propia en LATAM.",                   revenueUsd: 28000,  revenueGrowth: 65,  ebitdaUsd: 2800,   ebitdaMargin: 10, employees: 450,  employeeGrowth: 40, totalFunding: 60000,  lastFundingAmt: 25000,  fundingStage: "Series B", score: 79, confidence: 0.78, status: "monitoring" },
  { id: "comp_truora",    name: "Truora",    slug: "truora",    sector: "Software",  subsector: "Identity / KYC",       country: "Colombia", city: "Bogotá",     stage: "series-a",  website: "https://truora.com",      description: "APIs de verificación de identidad y background checks para LATAM. Integrado en 20+ países.",   revenueUsd: 8000,   revenueGrowth: 110, ebitdaUsd: -500,   ebitdaMargin: -6, employees: 120,  employeeGrowth: 70, totalFunding: 15000,  lastFundingAmt: 12000,  fundingStage: "Series A", score: 75, confidence: 0.72, status: "monitoring" },
  { id: "comp_urbvan",    name: "Urbvan",    slug: "urbvan",    sector: "Mobility",  subsector: "Mass Transit",         country: "México",   city: "CDMX",       stage: "series-b",  website: "https://urbvan.com",      description: "Transporte colectivo de última milla para empresas. Red de vans compartidas.",                  revenueUsd: 18000,  revenueGrowth: 55,  ebitdaUsd: -1200,  ebitdaMargin: -7, employees: 380,  employeeGrowth: 60, totalFunding: 40000,  lastFundingAmt: 18000,  fundingStage: "Series B", score: 68, confidence: 0.70, status: "monitoring" },
];

const DEMO_SIGNALS = [
  { id: "sig1", companyId: "comp_auronix",  type: "funding_due",           title: "Ronda Serie B en proceso",         detail: "Sources señalan ronda de $30-40M con lead investor de EE.UU.",                      severity: "high",   date: "2026-06-01" },
  { id: "sig2", companyId: "comp_simetrik", type: "competitor_acquired",   title: "Nuvei adquirió Conciliac",         detail: "Competidor directo adquirido por Nuvei en $18M. Puede acelerar decisión de venta.", severity: "high",   date: "2026-05-28" },
  { id: "sig3", companyId: "comp_konfio",   type: "hiring_surge",          title: "+40 posiciones abiertas en LATAM", detail: "Expansión a Colombia y Chile. Contratando en ventas, producto y tech.",              severity: "medium", date: "2026-05-20" },
  { id: "sig4", companyId: "comp_moons",    type: "revenue_inflection",    title: "Crecimiento acelerado Q1 2026",    detail: "Fuentes señalan >80% YoY en Q1 vs. 65% en 2025.",                                  severity: "medium", date: "2026-05-15" },
  { id: "sig5", companyId: "comp_truora",   type: "exec_change",           title: "Nuevo CFO con exp. en salidas",    detail: "Contrataron ex-CFO de Kavak. Señal de preparación para ronda o proceso de venta.",  severity: "medium", date: "2026-06-03" },
  { id: "sig6", companyId: "comp_nowports", type: "strategic_buyer_interest",title: "DHL exploró adquisición",        detail: "Conversations informales reportadas en conferencia de logística en Panamá.",         severity: "high",   date: "2026-06-05" },
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
  { id: "mand_mx_tech",        name: "Tech & SaaS México",    description: "Software B2B, plataformas verticales, infraestructura digital", sectors: ["Software","SaaS","Fintech","Proptech"],                            countries: ["México"],                              stages: ["series-a","series-b","growth"], minRevenue: 1000,  maxRevenue: 50000, thesis: "Plataformas de software con economías de escala, alta retención y modelos de suscripción." },
  { id: "mand_latam_consumer", name: "Consumer LATAM",        description: "Marcas y retail de consumo masivo, LATAM",                      sectors: ["Consumer","Retail","Food & Beverage","Healthcare"],                countries: ["México","Colombia","Chile","Perú"],     stages: ["growth","mature"],              minRevenue: 5000,  maxRevenue: null,  thesis: "Marcas con alta penetración de mercado, márgenes estables y potencial de expansión regional." },
];

const DEMO_MATCHES = [
  { companyId: "comp_auronix",  mandateId: "mand_mx_tech",        score: 94, tier: "strong",    rationale: "SaaS B2B con márgenes >30%, alta retención, mercado vertical en comunicaciones empresariales." },
  { companyId: "comp_konfio",   mandateId: "mand_mx_tech",        score: 82, tier: "strong",    rationale: "Fintech de crédito con crecimiento 35% YoY. Modelo de datos propietario con ventaja competitiva." },
  { companyId: "comp_simetrik", mandateId: "mand_mx_tech",        score: 88, tier: "strong",    rationale: "Finance automation SaaS, crecimiento 95% YoY, expansión a LATAM natural." },
  { companyId: "comp_clip",     mandateId: "mand_mx_tech",        score: 75, tier: "candidate", rationale: "Payments en México con buen crecimiento, aunque competencia con Conekta/Stripe es alta." },
  { companyId: "comp_moons",    mandateId: "mand_latam_consumer", score: 79, tier: "strong",    rationale: "D2C healthcare con expansión LATAM natural. Márgenes en mejora y modelo escalable." },
  { companyId: "comp_nowports", mandateId: "mand_latam_consumer", score: 62, tier: "candidate", rationale: "Logística digital con fuerte crecimiento, aunque EBITDA negativo es riesgo." },
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
      results.push("✓ Usuario creado: pablo.morincon@gmail.com / pando2026");
    } else {
      results.push("✓ Usuario ya existe");
    }

    // ── Data Sources ──────────────────────────────────────────────────────────────
    let dsCreated = 0;
    for (const src of DATA_SOURCES) {
      const exists = await db.query.dataSources.findFirst({ where: eq(dataSources.name, src.name) });
      if (!exists) { await db.insert(dataSources).values({ id: randomUUID(), ...src }); dsCreated++; }
    }
    results.push(`✓ Data sources: ${dsCreated} creados`);

    // ── Mandates ──────────────────────────────────────────────────────────────────
    let mandCreated = 0;
    for (const m of DEMO_MANDATES) {
      const exists = await db.query.mandates.findFirst({ where: eq(mandates.id, m.id) });
      if (!exists) {
        await db.insert(mandates).values({ ...m, sectors: JSON.stringify(m.sectors), countries: JSON.stringify(m.countries), stages: JSON.stringify(m.stages), maxRevenue: m.maxRevenue ?? null, isActive: true, createdBy: "Sistema PANDO", updatedBy: "Sistema PANDO" });
        mandCreated++;
      }
    }
    results.push(`✓ Mandatos: ${mandCreated} creados`);

    // ── Companies ─────────────────────────────────────────────────────────────────
    let coCreated = 0;
    for (const co of DEMO_COMPANIES) {
      const exists = await db.query.companies.findFirst({ where: eq(companies.id, co.id) });
      if (!exists) { await db.insert(companies).values({ ...co, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: "Sistema PANDO", updatedBy: "Sistema PANDO" }); coCreated++; }
    }
    results.push(`✓ Empresas: ${coCreated} creadas`);

    // ── Signals ───────────────────────────────────────────────────────────────────
    let sigCreated = 0;
    for (const s of DEMO_SIGNALS) {
      const exists = await db.query.signals.findFirst({ where: eq(signals.id, s.id) });
      if (!exists) { await db.insert(signals).values({ ...s, isRead: false }); sigCreated++; }
    }
    results.push(`✓ Señales: ${sigCreated} creadas`);

    // ── Tags ──────────────────────────────────────────────────────────────────────
    for (const t of DEMO_TAGS) {
      const exists = await db.query.companyTags.findFirst({
        where: (ct, { and, eq }) => and(eq(ct.companyId, t.companyId), eq(ct.tag, t.tag)),
      });
      if (!exists) {
        try { await db.insert(companyTags).values({ id: uid(), ...t }); } catch { /* skip */ }
      }
    }
    results.push("✓ Tags creados");

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
    results.push(`✓ Mandate matches: ${matchCreated} creados`);

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), results }, { status: 500 });
  }
}

export async function POST() { return GET(); }
