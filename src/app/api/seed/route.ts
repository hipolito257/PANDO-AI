import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, dataSources } from "@/lib/schema";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const DATA_SOURCES = [
  { name: "google_news",   displayName: "Google News",             category: "news",         description: "Noticias públicas vía RSS de Google News. Sin costo ni registro. Cobertura amplia en español para México y LATAM.",                                                         website: "https://news.google.com",             logoColor: "#ea4335", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Sin configuración necesaria." },
  { name: "el_economista", displayName: "El Economista",           category: "news",         description: "Principal medio de noticias financieras y empresariales de México.",                                                                                                          website: "https://eleconomista.com.mx",         logoColor: "#1d4ed8", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Feed RSS público disponible sin registro." },
  { name: "expansion",     displayName: "Expansión",               category: "news",         description: "Noticias de negocios de México y LATAM: startups, inversiones, economía y empresas.",                                                                                        website: "https://expansion.mx",                logoColor: "#16a34a", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Feed RSS público disponible sin registro." },
  { name: "sat_mexico",    displayName: "SAT México",              category: "registry",     description: "Consulta pública del RFC y estatus fiscal de empresas mexicanas.",                                                                                                           website: "https://www.sat.gob.mx",              logoColor: "#b45309", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Acceso público sin credenciales." },
  { name: "rpc",           displayName: "Reg. Público de Comercio",category: "registry",     description: "Registro de personas morales en México: socios, representantes legales, actos corporativos y capital social.",                                                               website: "https://www.rpc.economia.gob.mx",     logoColor: "#6b7280", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Acceso público vía portal de la Secretaría de Economía." },
  { name: "patent_office", displayName: "IMPI — Patentes",         category: "registry",     description: "Registro de patentes y marcas en México (IMPI).",                                                                                                                            website: "https://www.impi.gob.mx",             logoColor: "#8b5cf6", isSubscribed: true,  isEnabled: true,  costType: "free",     requiresApiKey: false, accessHint: "Consulta pública gratuita en impi.gob.mx." },
  { name: "capital_iq",    displayName: "Capital IQ",              category: "financial",    description: "Referencia estándar para financieros históricos, múltiplos de valuación, transacciones M&A y rondas de capital privado en LATAM y global.",                                 website: "https://capitaliq.spglobal.com",      logoColor: "#2563eb", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Solicita acceso a tu representante de S&P Global (~$15k–$40k/año)." },
  { name: "pitchbook",     displayName: "PitchBook",               category: "financial",    description: "Base de datos de empresas privadas: rondas, valuaciones, inversionistas y fundadores.",                                                                                      website: "https://pitchbook.com",               logoColor: "#7c3aed", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Requiere suscripción Enterprise (~$10k–$25k/año)." },
  { name: "crunchbase",    displayName: "Crunchbase",              category: "financial",    description: "Perfiles de startups, rondas de inversión, fundadores e inversionistas. Buena cobertura de LATAM.",                                                                          website: "https://crunchbase.com",              logoColor: "#0369a1", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Plan gratuito (200 búsquedas/día). API Pro desde $29/mes." },
  { name: "bloomberg",     displayName: "Bloomberg Terminal",      category: "financial",    description: "Terminal financiero en tiempo real: datos de mercado, noticias, pricing de deuda y equity.",                                                                                  website: "https://bloomberg.com",               logoColor: "#dc2626", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Requiere suscripción al Bloomberg Terminal (~$25k/año por usuario)." },
  { name: "dealroom",      displayName: "Dealroom",                category: "financial",    description: "Inteligencia de startups y scale-ups con buena cobertura de Europa y LATAM.",                                                                                                website: "https://dealroom.co",                 logoColor: "#059669", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Suscripción anual ~$5k–$12k." },
  { name: "news_api",      displayName: "NewsAPI",                 category: "news",         description: "Agrega titulares de +150,000 fuentes globales en tiempo real.",                                                                                                               website: "https://newsapi.org",                 logoColor: "#d97706", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Plan Developer gratis (100 req/día). Plan Business $449/mes." },
  { name: "linkedin_sales",displayName: "LinkedIn Sales Nav",      category: "intelligence", description: "Datos de empleados, org charts, historial laboral de fundadores y señales de hiring.",                                                                                       website: "https://business.linkedin.com",       logoColor: "#0a66c2", isSubscribed: false, isEnabled: false, costType: "paid",     requiresApiKey: true,  accessHint: "Sales Navigator Team ~$1,000/año por usuario." },
  { name: "similarweb",    displayName: "SimilarWeb",              category: "alternative",  description: "Tráfico web mensual, canales de adquisición y benchmarking digital.",                                                                                                         website: "https://similarweb.com",              logoColor: "#f97316", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Datos básicos gratis en el sitio. API desde ~$250/mes." },
  { name: "glassdoor",     displayName: "Glassdoor",               category: "alternative",  description: "Reseñas de empleados, clima laboral, rango de salarios y rating de liderazgo.",                                                                                              website: "https://glassdoor.com",               logoColor: "#22c55e", isSubscribed: false, isEnabled: false, costType: "freemium", requiresApiKey: true,  accessHint: "Datos públicos básicos gratis en el sitio. API requiere acuerdo de partner." },
];

// GET /api/seed — create initial data (users + data sources)
export async function GET() {
  const results: string[] = [];
  try {
    // ── User ────────────────────────────────────────────────────────────────────
    const existing = await db.query.users.findFirst({
      where: eq(users.email, "pablo.morincon@gmail.com"),
    });

    if (!existing) {
      const pw = await bcrypt.hash("pando2026", 10);
      await db.insert(users).values({
        id: randomUUID(),
        name: "Pablo Morincon",
        email: "pablo.morincon@gmail.com",
        password: pw,
        role: "admin",
      });
      results.push("✓ Usuario creado: pablo.morincon@gmail.com / pando2026");
    } else {
      results.push("✓ Usuario ya existe");
    }

    // ── Data Sources ─────────────────────────────────────────────────────────────
    let dsCreated = 0;
    for (const src of DATA_SOURCES) {
      const exists = await db.query.dataSources.findFirst({
        where: eq(dataSources.name, src.name),
      });
      if (!exists) {
        await db.insert(dataSources).values({ id: randomUUID(), ...src });
        dsCreated++;
      }
    }
    results.push(`✓ Data sources: ${dsCreated} creados, ${DATA_SOURCES.length - dsCreated} ya existían`);

    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e), results }, { status: 500 });
  }
}

export async function POST() {
  return GET();
}
