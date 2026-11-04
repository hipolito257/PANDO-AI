// Applies pending SQL migrations from /migrations before a production build.
//
//   npm run build  →  tsx scripts/migrate.ts && next build
//
// - Runs only for production deploys on Vercel (VERCEL_ENV=production), or
//   locally when MIGRATE=1 is set; preview builds never touch the database.
// - Applies every pending file in one transaction under an advisory lock and
//   records it in "_Migration". If any statement fails, everything is rolled
//   back and the script exits non-zero, which stops the deploy.
// - Afterwards it compares the tables/columns declared in src/lib/schema.ts
//   with the database and warns about anything missing (drift).
import fs from "fs";
import path from "path";
import { Client } from "pg";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../src/lib/schema";

const DIR = path.join(process.cwd(), "migrations");
const LOCK_KEY = 482_917_311; // arbitrary, constant across deploys

function shouldRun(): { run: boolean; why: string } {
  if (process.env.VERCEL) {
    return process.env.VERCEL_ENV === "production"
      ? { run: true, why: "production deploy" }
      : { run: false, why: `${process.env.VERCEL_ENV ?? "non-production"} build: migrations only run on production deploys` };
  }
  return process.env.MIGRATE === "1" ? { run: true, why: "MIGRATE=1" } : { run: false, why: "local build (set MIGRATE=1 to apply)" };
}

function connectionString(raw: string): string {
  try {
    const u = new URL(raw);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return raw.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  }
}

async function main() {
  const { run, why } = shouldRun();
  if (!run) { console.log(`[migrate] skipped: ${why}`); return; }
  const raw = process.env.DATABASE_URL;
  if (!raw || !/^postgres(ql)?:\/\//.test(raw)) throw new Error("[migrate] DATABASE_URL is missing or not a Postgres URL");

  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort() : [];
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(raw);
  const client = new Client({ connectionString: connectionString(raw), ssl: local ? false : { rejectUnauthorized: false }, statement_timeout: 120_000 });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS "_Migration" ("name" text PRIMARY KEY, "appliedAt" timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ name: string }>(`SELECT "name" FROM "_Migration"`)).rows.map(r => r.name));
    const pending = files.filter(f => !done.has(f));
    for (const f of pending) {
      console.log(`[migrate] applying ${f}`);
      await client.query(fs.readFileSync(path.join(DIR, f), "utf-8"));
      await client.query(`INSERT INTO "_Migration" ("name") VALUES ($1)`, [f]);
    }
    await client.query("COMMIT");
    console.log(pending.length ? `[migrate] applied ${pending.length} migration(s)` : "[migrate] database is up to date");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }

  // ── Drift check: every table/column the code expects must exist ──
  try {
    const cols = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    );
    const have = new Map<string, Set<string>>();
    for (const r of cols.rows) {
      if (!have.has(r.table_name)) have.set(r.table_name, new Set());
      have.get(r.table_name)!.add(r.column_name);
    }
    const missing: string[] = [];
    for (const value of Object.values(schema)) {
      if (!(value instanceof PgTable)) continue;
      const cfg = getTableConfig(value);
      const existing = have.get(cfg.name);
      if (!existing) { missing.push(`table "${cfg.name}"`); continue; }
      for (const c of cfg.columns) if (!existing.has(c.name)) missing.push(`column "${cfg.name}"."${c.name}"`);
    }
    if (missing.length) {
      console.warn(`[migrate] WARNING: the code expects ${missing.length} thing(s) the database doesn't have. Add a migration for:\n  ${missing.join("\n  ")}`);
    } else {
      console.log("[migrate] schema check: database matches src/lib/schema.ts");
    }
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
