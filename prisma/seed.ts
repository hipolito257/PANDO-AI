import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../src/lib/schema";
import bcrypt from "bcryptjs";
import path from "path";

const dbPath = path.join(__dirname, "..", "pando.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

// ── Create tables ─────────────────────────────────────────────────────────────
function setupTables() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "User" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'analyst',
      avatarUrl TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS "Company" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      sector TEXT,
      subsector TEXT,
      country TEXT NOT NULL DEFAULT 'México',
      city TEXT,
      stage TEXT,
      website TEXT,
      linkedinUrl TEXT,
      description TEXT,
      revenueUsd REAL,
      revenueGrowth REAL,
      ebitdaUsd REAL,
      ebitdaMargin REAL,
      employees INTEGER,
      employeeGrowth REAL,
      totalFunding REAL,
      lastFundingAmt REAL,
      lastFundingDate TEXT,
      fundingStage TEXT,
      score REAL NOT NULL DEFAULT 0,
      confidence REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'monitoring',
      addedAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS "FinancialSnapshot" (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      quarter INTEGER DEFAULT 0,
      revenueUsd REAL,
      ebitdaUsd REAL,
      employees INTEGER,
      UNIQUE(companyId, year, quarter)
    );

    CREATE TABLE IF NOT EXISTS "Founder" (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      title TEXT,
      linkedinUrl TEXT,
      bio TEXT
    );

    CREATE TABLE IF NOT EXISTS "Signal" (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      severity TEXT NOT NULL DEFAULT 'medium',
      isRead INTEGER NOT NULL DEFAULT 0,
      date TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS "CompanyTag" (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      UNIQUE(companyId, tag)
    );

    CREATE TABLE IF NOT EXISTS "NewsItem" (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      source TEXT,
      url TEXT,
      summary TEXT,
      date TEXT NOT NULL,
      sentiment TEXT
    );

    CREATE TABLE IF NOT EXISTS "Mandate" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sectors TEXT NOT NULL DEFAULT '[]',
      countries TEXT NOT NULL DEFAULT '["México"]',
      stages TEXT NOT NULL DEFAULT '[]',
      minRevenue REAL,
      maxRevenue REAL,
      minEbitda REAL,
      minEmployees INTEGER,
      maxEmployees INTEGER,
      thesis TEXT,
      isActive INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS "MandateMatch" (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      mandateId TEXT NOT NULL REFERENCES "Mandate"(id) ON DELETE CASCADE,
      score REAL NOT NULL DEFAULT 0,
      rationale TEXT,
      tier TEXT NOT NULL DEFAULT 'candidate',
      updatedAt TEXT DEFAULT (datetime('now')),
      UNIQUE(companyId, mandateId)
    );

    CREATE TABLE IF NOT EXISTS "PublicComp" (
      id TEXT PRIMARY KEY,
      ticker TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      sector TEXT,
      exchange TEXT,
      description TEXT,
      marketCapUsd REAL,
      evUsd REAL,
      revenueUsd REAL,
      ebitdaUsd REAL,
      revenueGrowth REAL,
      grossMargin REAL,
      ebitdaMargin REAL,
      evRevenue REAL,
      evEbitda REAL,
      peRatio REAL,
      lastRefreshed TEXT,
      addedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS "CompSet" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      companyId TEXT REFERENCES "Company"(id) ON DELETE SET NULL,
      tickers TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS "Note" (
      id TEXT PRIMARY KEY,
      companyId TEXT NOT NULL REFERENCES "Company"(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      authorName TEXT NOT NULL DEFAULT 'Equipo PANDO',
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS "DataSource" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      category TEXT NOT NULL,
      isSubscribed INTEGER NOT NULL DEFAULT 0,
      isEnabled INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      website TEXT,
      logoColor TEXT,
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `);
}

// ── Helper: upsert via raw SQL ─────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

async function main() {
  console.log("🌱 Seeding PANDO database...");

  setupTables();

  // ── Users ──────────────────────────────────────────────────────────────────
  const pw = await bcrypt.hash("pando2026", 10);
  sqlite.prepare(`INSERT OR IGNORE INTO "User" (id, name, email, password, role) VALUES (?,?,?,?,?)`).run(
    uid(), "Pablo Morincon", "pablo.morincon@gmail.com", pw, "admin"
  );
  console.log("✓ Users");

  // ── Data Sources — migrate new columns if they don't exist ────────────────
  try { sqlite.exec(`ALTER TABLE "DataSource" ADD COLUMN costType TEXT NOT NULL DEFAULT 'paid'`); } catch {}
  try { sqlite.exec(`ALTER TABLE "DataSource" ADD COLUMN requiresApiKey INTEGER NOT NULL DEFAULT 1`); } catch {}
  try { sqlite.exec(`ALTER TABLE "DataSource" ADD COLUMN accessHint TEXT`); } catch {}
  try { sqlite.exec(`ALTER TABLE "DataSource" ADD COLUMN apiKey TEXT`); } catch {}

  // Re-insert with full data (INSERT OR REPLACE overwrites existing rows)
  // Columns: name, displayName, category, description, website, logoColor, isSubscribed, isEnabled, costType, requiresApiKey, accessHint
  const sources: [string, string, string, string, string, string, number, number, string, number, string][] = [
    [
      "capital_iq", "Capital IQ", "financial",
      "Referencia estándar del mercado para financieros históricos, múltiplos de valuación, transacciones M&A y rondas de capital privado en LATAM y global. Indispensable en diligencia formal.",
      "https://capitaliq.spglobal.com", "#2563eb", 0, 0,
      "paid", 1, "Solicita acceso a tu representante de S&P Global. Precio varía según módulos (~$15k–$40k/año).",
    ],
    [
      "pitchbook", "PitchBook", "financial",
      "Base de datos de empresas privadas: rondas, valuaciones post-money, inversionistas, fundadores y comparables de transacciones. Mejor cobertura de VC/PE que Capital IQ para etapas tempranas.",
      "https://pitchbook.com", "#7c3aed", 0, 0,
      "paid", 1, "Requiere suscripción Enterprise. Contactar a ventas de PitchBook para pricing (~$10k–$25k/año).",
    ],
    [
      "crunchbase", "Crunchbase", "financial",
      "Perfiles de startups, rondas de inversión, fundadores e inversionistas. Buena cobertura de LATAM para primeras etapas. Alternativa más accesible a PitchBook.",
      "https://crunchbase.com", "#0369a1", 0, 0,
      "freemium", 1, "Plan gratuito (200 búsquedas/día). API Pro desde $29/mes en crunchbase.com/settings/api-key.",
    ],
    [
      "bloomberg", "Bloomberg Terminal", "financial",
      "Terminal financiero en tiempo real: datos de mercado, noticias, pricing de deuda y equity. El más completo para análisis de públicas y comps de transacciones globales.",
      "https://bloomberg.com", "#dc2626", 0, 0,
      "paid", 1, "Requiere suscripción al Bloomberg Terminal (~$25k/año por usuario). Acceso vía B-PIPE API.",
    ],
    [
      "dealroom", "Dealroom", "financial",
      "Inteligencia de startups y scale-ups con buena cobertura de Europa y LATAM. Útil para mapear el ecosistema de un sector antes de entrar a un mandato nuevo.",
      "https://dealroom.co", "#059669", 0, 0,
      "paid", 1, "Suscripción anual ~$5k–$12k. Solicita demo en dealroom.co y negocia API access.",
    ],
    [
      "news_api", "NewsAPI", "news",
      "Agrega titulares de +150,000 fuentes globales en tiempo real. Útil para monitorear menciones de una empresa en múltiples medios simultáneamente.",
      "https://newsapi.org", "#d97706", 0, 0,
      "freemium", 1, "Plan Developer gratis (100 req/día, solo noticias de 1 mes). Plan Business $449/mes en newsapi.org/register.",
    ],
    [
      "google_news", "Google News", "news",
      "Noticias públicas vía RSS de Google News. Sin costo ni registro. Cobertura amplia en español para México y LATAM. Ya activo por defecto.",
      "https://news.google.com", "#ea4335", 1, 1,
      "free", 0, "Sin configuración necesaria. Usa el feed RSS público de Google News.",
    ],
    [
      "el_economista", "El Economista", "news",
      "Principal medio de noticias financieras y empresariales de México. Cobertura de mercados, regulación (SAT, CNBV, COFECE) y movimientos corporativos.",
      "https://eleconomista.com.mx", "#1d4ed8", 1, 1,
      "free", 0, "Feed RSS público disponible sin registro en eleconomista.com.mx/rss.",
    ],
    [
      "expansion", "Expansión", "news",
      "Noticias de negocios de México y LATAM: startups, inversiones, economía y empresas. Buena cobertura de rondas de financiamiento en la región.",
      "https://expansion.mx", "#16a34a", 1, 1,
      "free", 0, "Feed RSS público disponible sin registro en expansion.mx.",
    ],
    [
      "sat_mexico", "SAT México", "registry",
      "Consulta pública del RFC y estatus fiscal de empresas mexicanas. Primer paso de diligencia básica para confirmar existencia legal y situación tributaria.",
      "https://www.sat.gob.mx", "#b45309", 1, 1,
      "free", 0, "Acceso público sin credenciales. Usa el portal de consulta de RFC del SAT.",
    ],
    [
      "rpc", "Reg. Público de Comercio", "registry",
      "Registro de personas morales en México: socios, representantes legales, actos corporativos y capital social. Útil para confirmar estructura accionaria en diligencia.",
      "https://www.rpc.economia.gob.mx", "#6b7280", 1, 1,
      "free", 0, "Acceso público sin credenciales vía portal de la Secretaría de Economía.",
    ],
    [
      "linkedin_sales", "LinkedIn Sales Nav", "intelligence",
      "Datos de empleados, org charts, historial laboral de fundadores y señales de hiring (cuánto y en qué áreas está contratando la empresa). Proxy de crecimiento y expansión.",
      "https://business.linkedin.com", "#0a66c2", 0, 0,
      "paid", 1, "Sales Navigator Team ~$1,000/año por usuario. Activa en linkedin.com/sales. Requiere API partner para integración.",
    ],
    [
      "similarweb", "SimilarWeb", "alternative",
      "Tráfico web mensual, canales de adquisición y benchmarking digital. Proxy de tracción para empresas B2C o con presencia digital fuerte, sin necesitar estados financieros.",
      "https://similarweb.com", "#f97316", 0, 0,
      "freemium", 1, "Datos básicos gratis en el sitio. API desde ~$250/mes. API key en similarweb.com/corp/developer.",
    ],
    [
      "glassdoor", "Glassdoor", "alternative",
      "Reseñas de empleados, clima laboral, rango de salarios y rating de liderazgo. Señal de cultura organizacional y riesgo de retención del equipo fundador.",
      "https://glassdoor.com", "#22c55e", 0, 0,
      "freemium", 1, "Datos públicos básicos gratis en el sitio. API de datos requiere acuerdo de partner con Glassdoor.",
    ],
    [
      "patent_office", "IMPI — Patentes", "registry",
      "Registro de patentes y marcas en México (IMPI). Útil para evaluar propiedad intelectual en empresas de tecnología, salud o manufactura avanzada.",
      "https://www.impi.gob.mx", "#8b5cf6", 1, 1,
      "free", 0, "Consulta pública gratuita en impi.gob.mx. Sin API oficial — búsqueda manual.",
    ],
  ];

  // Update metadata on existing rows (preserve user's isSubscribed/isEnabled toggles)
  const updateSource = sqlite.prepare(`
    UPDATE "DataSource" SET
      displayName = ?, category = ?, description = ?, website = ?, logoColor = ?,
      costType = ?, requiresApiKey = ?, accessHint = ?
    WHERE name = ?
  `);
  // Insert fresh rows that don't exist yet
  const insertSource = sqlite.prepare(`
    INSERT OR IGNORE INTO "DataSource"
      (id, name, displayName, category, description, website, logoColor,
       isSubscribed, isEnabled, costType, requiresApiKey, accessHint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const [name, displayName, category, description, website, logoColor, isSubscribed, isEnabled, costType, requiresApiKey, accessHint] of sources) {
    const updated = updateSource.run(displayName, category, description, website, logoColor, costType, requiresApiKey, accessHint, name);
    if (updated.changes === 0) {
      insertSource.run(uid(), name, displayName, category, description, website, logoColor, isSubscribed, isEnabled, costType, requiresApiKey, accessHint);
    }
  }
  console.log("✓ Data sources");

  // ── Mandates ───────────────────────────────────────────────────────────────
  sqlite.prepare(`INSERT OR IGNORE INTO "Mandate" (id,name,description,sectors,countries,stages,minRevenue,maxRevenue,thesis,isActive) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run("mand_mx_tech","Tech & SaaS México","Software B2B, plataformas verticales, infraestructura digital",
      JSON.stringify(["Software","SaaS","Fintech","Proptech"]),JSON.stringify(["México"]),
      JSON.stringify(["series-a","series-b","growth"]),1000,50000,
      "Buscamos plataformas de software con economías de escala, alta retención y modelos de suscripción en mercados verticales de México con ventajas regulatorias o de red.",1);
  sqlite.prepare(`INSERT OR IGNORE INTO "Mandate" (id,name,description,sectors,countries,stages,minRevenue,thesis,isActive) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run("mand_latam_consumer","Consumer LATAM","Marcas y retail de consumo masivo, LATAM",
      JSON.stringify(["Consumer","Retail","Food & Beverage","Healthcare"]),
      JSON.stringify(["México","Colombia","Chile","Perú"]),
      JSON.stringify(["growth","mature"]),5000,
      "Marcas con alta penetración de mercado, márgenes estables y potencial de expansión regional.",1);
  console.log("✓ Mandates");

  // ── Companies ──────────────────────────────────────────────────────────────
  const insertCompany = sqlite.prepare(`INSERT OR IGNORE INTO "Company"
    (id,name,slug,sector,subsector,country,city,stage,website,description,
     revenueUsd,revenueGrowth,ebitdaUsd,ebitdaMargin,employees,employeeGrowth,
     totalFunding,lastFundingAmt,fundingStage,score,confidence,status) VALUES
    (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const cos = [
    ["comp_konfio","Konfío","konfio","Fintech","SME Lending","México","CDMX","growth","https://konfio.mx","Plataforma de crédito y servicios financieros para PyMEs en México. Usa datos alternativos para underwriting.",120000,35,18000,15,1200,22,475000,110000,"Series D",87,0.85,"pipeline"],
    ["comp_nowports","Nowports","nowports","Logistics","Digital Freight","México","Monterrey","series-b","https://nowports.com","Freight forwarder digital para LATAM. Automatiza importaciones/exportaciones con visibilidad en tiempo real.",45000,80,-3000,-7,600,45,120000,90000,"Series B",74,0.75,"monitoring"],
    ["comp_clip","Clip","clip","Fintech","Payments","México","CDMX","growth","https://clip.mx","Solución de pagos con tarjeta para PyMEs y emprendedores en México.",85000,28,8500,10,950,18,250000,70000,"Series C",82,0.8,"monitoring"],
    ["comp_auronix","Auronix","auronix","Software","CPaaS / Messaging","México","CDMX","growth","https://auronix.com","Plataforma omnicanal de comunicaciones empresariales. Líder en México en notificaciones transaccionales.",32000,42,9600,30,280,30,25000,15000,"Series A",91,0.88,"pipeline"],
    ["comp_urbvan","Urbvan","urbvan","Mobility","Mass Transit","México","CDMX","series-b","https://urbvan.com","Transporte colectivo de última milla para empresas. Red de vans compartidas en zonas metropolitanas.",18000,55,-1200,-7,380,60,40000,18000,"Series B",68,0.7,"monitoring"],
    ["comp_moons","Moons","moons","Healthcare","Dental / D2C","México","CDMX","growth","https://mymoons.mx","Ortodoncia invisible directa al consumidor. Modelo digital de alineadores con red clínica propia en LATAM.",28000,65,2800,10,450,40,60000,25000,"Series B",79,0.78,"monitoring"],
    ["comp_simetrik","Simetrik","simetrik","Software","Finance Automation","Colombia","Bogotá","series-b","https://simetrik.com","Plataforma no-code de conciliación financiera. Automatiza procesos de cierre contable para empresas en LATAM.",15000,95,1500,10,180,55,30000,20000,"Series B",88,0.82,"pipeline"],
    ["comp_truora","Truora","truora","Software","Identity / KYC","Colombia","Bogotá","series-a","https://truora.com","APIs de verificación de identidad y background checks para LATAM. Integrado en 20+ países.",8000,110,-500,-6,120,70,15000,12000,"Series A",75,0.72,"monitoring"],
  ];

  for (const c of cos) insertCompany.run(...c);
  console.log("✓ Companies");

  // ── Financials ─────────────────────────────────────────────────────────────
  const insertSnap = sqlite.prepare(`INSERT OR IGNORE INTO "FinancialSnapshot" (id,companyId,year,quarter,revenueUsd,ebitdaUsd,employees) VALUES (?,?,?,?,?,?,?)`);
  [
    ["snap1","comp_konfio",2022,0,60000,3000,700],
    ["snap2","comp_konfio",2023,0,89000,10000,980],
    ["snap3","comp_konfio",2024,0,120000,18000,1200],
    ["snap4","comp_auronix",2022,0,16000,3200,165],
    ["snap5","comp_auronix",2023,0,22500,6300,215],
    ["snap6","comp_auronix",2024,0,32000,9600,280],
    ["snap7","comp_simetrik",2022,0,3800,-100,75],
    ["snap8","comp_simetrik",2023,0,7700,500,116],
    ["snap9","comp_simetrik",2024,0,15000,1500,180],
  ].forEach(r => insertSnap.run(...r));

  // ── Founders ───────────────────────────────────────────────────────────────
  const insertFounder = sqlite.prepare(`INSERT OR IGNORE INTO "Founder" (id,companyId,name,title,bio) VALUES (?,?,?,?,?)`);
  [
    [uid(),"comp_konfio","David Arana","CEO & Co-founder","Ex-McKinsey, Harvard MBA. Fundó Konfío en 2013."],
    [uid(),"comp_auronix","Óscar Jiménez","CEO & Co-founder","Ingeniero ITESM, 15 años en telecomunicaciones."],
    [uid(),"comp_auronix","Rodrigo Díaz","CTO & Co-founder","Ex-Telcel, arquitecto de plataformas de mensajería a escala."],
    [uid(),"comp_simetrik","Alejandro Casas","CEO & Co-founder","Ex-Goldman Sachs, fundó Simetrik en 2019."],
  ].forEach(r => insertFounder.run(...r));

  // ── Tags ───────────────────────────────────────────────────────────────────
  const insertTag = sqlite.prepare(`INSERT OR IGNORE INTO "CompanyTag" (id,companyId,tag) VALUES (?,?,?)`);
  [
    ["comp_konfio","Fintech"],["comp_konfio","High Growth"],["comp_konfio","Pipeline"],
    ["comp_auronix","SaaS"],["comp_auronix","High Margin"],["comp_auronix","Pipeline"],
    ["comp_simetrik","SaaS"],["comp_simetrik","Series B"],
    ["comp_clip","Fintech"],["comp_nowports","Logistics"],["comp_moons","Healthcare"],
  ].forEach(([cid, tag]) => insertTag.run(uid(), cid, tag));

  // ── Signals ────────────────────────────────────────────────────────────────
  const insertSig = sqlite.prepare(`INSERT OR IGNORE INTO "Signal" (id,companyId,type,title,detail,severity,date) VALUES (?,?,?,?,?,?,?)`);
  [
    ["sig1","comp_auronix","funding_due","Ronda Serie B en proceso","Sources señalan ronda de $30-40M con lead investor de EE.UU.","high","2026-06-01"],
    ["sig2","comp_simetrik","competitor_acquired","Nuvei adquirió Conciliac","Competidor directo adquirido por Nuvei en $18M. Puede acelerar decisión de venta.","high","2026-05-28"],
    ["sig3","comp_konfio","hiring_surge","+40 posiciones abiertas en Latam","Expansion a Colombia y Chile. Contratando en ventas, producto y tech.","medium","2026-05-20"],
    ["sig4","comp_moons","revenue_inflection","Crecimiento acelerado Q1 2026","Fuentes de la industria señalan >80% YoY en Q1 vs. 65% en 2025.","medium","2026-05-15"],
    ["sig5","comp_truora","exec_change","Nuevo CFO con experiencia en salidas","Contrataron ex-CFO de Kavak. Señal de preparación para ronda o proceso de venta.","medium","2026-06-03"],
    ["sig6","comp_nowports","strategic_buyer_interest","DHL Express exploró adquisición","Conversations informales reportadas en conferencia de logística en Panamá.","high","2026-06-05"],
    ["sig7","comp_clip","regulatory_change","Nuevas reglas CNBV para adquirentes","Cambio regulatorio puede afectar modelo. Monitorear impacto en márgenes.","low","2026-05-10"],
  ].forEach(r => insertSig.run(...r));
  console.log("✓ Signals");

  // ── News ───────────────────────────────────────────────────────────────────
  const insertNews = sqlite.prepare(`INSERT OR IGNORE INTO "NewsItem" (id,companyId,title,source,date,sentiment) VALUES (?,?,?,?,?,?)`);
  [
    ["news1","comp_konfio","Konfío expande crédito PyME a Colombia y Chile","El Economista","2026-05-20","positive"],
    ["news2","comp_auronix","Auronix logra integración nativa con WhatsApp Business API v3","Expansión","2026-06-01","positive"],
    ["news3","comp_simetrik","Simetrik procesa $1T en transacciones reconciliadas","Forbes México","2026-05-28","positive"],
    ["news4","comp_nowports","Nowports reporta 3x crecimiento en rutas transpacíficas","Expansión","2026-05-15","positive"],
    ["news5","comp_clip","Clip lanza terminales con crédito embebido para comercios","El Economista","2026-06-02","positive"],
  ].forEach(r => insertNews.run(...r));
  console.log("✓ News");

  // ── Mandate Matches ────────────────────────────────────────────────────────
  const insertMatch = sqlite.prepare(`INSERT OR IGNORE INTO "MandateMatch" (id,companyId,mandateId,score,tier,rationale) VALUES (?,?,?,?,?,?)`);
  [
    [uid(),"comp_auronix","mand_mx_tech",94,"strong","SaaS B2B con márgenes >30%, alta retención, mercado vertical en comunicaciones empresariales. Cumple todos los criterios del mandato Tech México."],
    [uid(),"comp_konfio","mand_mx_tech",82,"strong","Fintech de crédito con crecimiento 35% YoY. Modelo de datos propietario con ventaja competitiva."],
    [uid(),"comp_simetrik","mand_mx_tech",88,"strong","Finance automation SaaS, crecimiento 95% YoY, expansión a LATAM natural."],
    [uid(),"comp_clip","mand_mx_tech",75,"candidate","Payments en México con buen crecimiento, aunque competencia con Conekta/Stripe es alta."],
    [uid(),"comp_nowports","mand_latam_consumer",62,"candidate","Logística digital con fuerte crecimiento, aunque EBITDA negativo es riesgo."],
    [uid(),"comp_moons","mand_latam_consumer",79,"strong","D2C healthcare con expansión LATAM natural. Márgenes en mejora y modelo escalable."],
  ].forEach(r => insertMatch.run(...r));
  console.log("✓ Mandate matches");

  // ── Public Comparables ────────────────────────────────────────────────────
  const insertPub = sqlite.prepare(`INSERT OR IGNORE INTO "PublicComp"
    (id,ticker,name,sector,exchange,description) VALUES (?,?,?,?,?,?)`);

  // CPaaS / Messaging
  insertPub.run(uid(),"TWLO","Twilio","CPaaS","NASDAQ","Plataforma líder de comunicaciones en la nube. APIs de SMS, voz, email y WhatsApp para empresas.");
  insertPub.run(uid(),"BAND","Bandwidth","CPaaS","NASDAQ","Proveedor de infraestructura de comunicaciones CPaaS. Directo a empresas.");
  insertPub.run(uid(),"BRZE","Braze","SaaS","NASDAQ","Plataforma de customer engagement omnicanal con automatización y personalización.");
  insertPub.run(uid(),"IRDM","Sinch (proxy)","CPaaS","NASDAQ","Comunicaciones empresariales omnicanal. Comparable regional de Auronix.");

  // Fintech LATAM
  insertPub.run(uid(),"NU","Nubank","Fintech","NYSE","Neobank líder en LATAM (Brasil, México, Colombia). 100M+ clientes.");
  insertPub.run(uid(),"STNE","StoneCo","Fintech","NASDAQ","Soluciones financieras para PyMEs en Brasil. Pagos, crédito, gestión.");
  insertPub.run(uid(),"PAGS","PagSeguro Digital","Fintech","NYSE","Pagos y servicios financieros para pequeños comercios en Brasil.");
  insertPub.run(uid(),"DLO","dLocal","Fintech","NASDAQ","Procesamiento de pagos transfronterizos en mercados emergentes de LATAM, África y Asia.");

  // Payments / SMB
  insertPub.run(uid(),"SQ","Block (Square)","Fintech","NYSE","Ecosistema de pagos y servicios financieros para PyMEs y consumidores.");
  insertPub.run(uid(),"ADYEY","Adyen ADR","Payments","OTC","Procesador de pagos global enterprise. Alto margen, bajo churn.");

  // Finance Automation SaaS
  insertPub.run(uid(),"BILL","Bill.com","SaaS","NYSE","Automatización de cuentas por pagar/cobrar para PyMEs. Alto NRR.");
  insertPub.run(uid(),"ZUO","Zuora","SaaS","NYSE","Plataforma de billing para modelos de suscripción.");
  insertPub.run(uid(),"MNDY","Monday.com","SaaS","NASDAQ","Work OS flexible con alta penetración en enterprise. Modelo de expansión via seats.");

  // Logistics
  insertPub.run(uid(),"CHRW","C.H. Robinson","Logistics","NASDAQ","Mayor freight broker de EE.UU. por volumen. Comparable de operaciones para Nowports.");
  insertPub.run(uid(),"EXPD","Expeditors Intl","Logistics","NASDAQ","Freight forwarding y logística internacional. Asset-light, alto margen.");
  insertPub.run(uid(),"XPO","XPO Logistics","Logistics","NYSE","Logística de transporte terrestre y gestión de cadena de suministro.");

  // Healthcare / D2C
  insertPub.run(uid(),"ALGN","Align Technology","Healthcare","NASDAQ","Fabricante de Invisalign. Líder global en ortodoncia invisible. Modelo D2C + clínicas.");
  insertPub.run(uid(),"HIMS","Hims & Hers","Healthcare","NYSE","Plataforma D2C de salud y bienestar. Comparable de modelo digital directo al consumidor.");

  // Mobility
  insertPub.run(uid(),"LYFT","Lyft","Mobility","NASDAQ","Rideshare en EE.UU. Comparable de modelo de movilidad compartida para Urbvan.");
  insertPub.run(uid(),"GRAB","Grab Holdings","Mobility","NASDAQ","Super-app de movilidad, delivery y fintech en SE Asia. Comparable de expansión regional.");

  console.log("✓ Public comps");

  // ── Comp Sets ─────────────────────────────────────────────────────────────
  const insertCS = sqlite.prepare(`INSERT OR IGNORE INTO "CompSet" (id,name,companyId,tickers,notes) VALUES (?,?,?,?,?)`);

  insertCS.run(uid(),"Auronix vs. CPaaS Global","comp_auronix",
    JSON.stringify(["TWLO","BAND","BRZE"]),
    "Comparables de plataformas CPaaS y engagement. Twilio es el benchmark directo.");

  insertCS.run(uid(),"Konfío vs. Fintech LATAM","comp_konfio",
    JSON.stringify(["NU","STNE","PAGS","DLO"]),
    "Fintechs públicas en LATAM con modelo de crédito o pagos para PyMEs.");

  insertCS.run(uid(),"Clip vs. Pagos SMB","comp_clip",
    JSON.stringify(["SQ","PAGS","DLO"]),
    "Procesadores de pago enfocados en pequeños comercios. Block/Square es el benchmark global.");

  insertCS.run(uid(),"Simetrik vs. Finance SaaS","comp_simetrik",
    JSON.stringify(["BILL","ZUO","MNDY"]),
    "SaaS de automatización financiera con modelos de suscripción y alto NRR.");

  console.log("✓ Comp sets");

  console.log("\n✅ PANDO database ready!");
  console.log("   Login: pablo.morincon@gmail.com / pando2026");

  sqlite.close();
}

main().catch(e => { console.error(e); process.exit(1); });
