import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { attachDatabasePool } from "@vercel/functions";
import * as schema from "./schema";

// Why this setup: Vercel suspends a function instance between requests while
// its pooled database sockets stay open; Supabase's pooler drops them in the
// meantime, so the next query goes out on a dead socket and never returns,
// leaving pages stuck on "Loading…". Three things prevent that:
//  - attachDatabasePool keeps the instance alive until idle connections are
//    closed, so they are released before it suspends;
//  - query_timeout fails a query client-side when no answer arrives (a dead
//    socket sends no error), and pool.query then discards that connection;
//  - pg doesn't use named prepared statements, which Supabase's transaction
//    pooler (port 6543) can't route reliably.
function createDb() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");

  // Supabase requires TLS; its certificate isn't in Node's trust store. An
  // sslmode in the URL would make pg verify it, so TLS is configured here instead.
  let connectionString: string;
  try {
    const url = new URL(raw);
    url.searchParams.delete("sslmode");
    connectionString = url.toString();
  } catch {
    // Unparseable as a URL (e.g. unescaped characters in the password): strip it textually.
    connectionString = raw.replace(/([?&])sslmode=[^&]*&?/, "$1").replace(/[?&]$/, "");
  }

  // A local Postgres (development) has no TLS.
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(raw);

  const pool = new Pool({
    connectionString,
    ssl: local ? false : { rejectUnauthorized: false },
    max: Number(process.env.DB_POOL_MAX ?? 5),   // a local single-connection Postgres sets 1
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 10_000,   // server side: stops slow queries
    query_timeout: 12_000,       // client side: gives up on a silent connection
    keepAlive: true,
  });
  pool.on("error", err => console.error("[db pool]", err.message));
  attachDatabasePool(pool);

  return drizzle(pool, { schema });
}

// Type-safe singleton — preserves schema generics for db.query.*
const globalForDb = globalThis as unknown as {
  __pandoDb: ReturnType<typeof createDb> | undefined;
};

export const db = globalForDb.__pandoDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pandoDb = db;
}

export * from "./schema";
