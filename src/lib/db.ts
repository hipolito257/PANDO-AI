import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Singleton pattern for serverless (Vercel) — reuse connection across invocations
declare global {
  // eslint-disable-next-line no-var
  var __pandoDb: ReturnType<typeof drizzle> | undefined;
}

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const client = postgres(connectionString, {
    max: 1,          // Serverless: max 1 connection per function instance
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: "require",  // Supabase requires SSL
  });

  return drizzle(client, { schema });
}

export const db = globalThis.__pandoDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalThis.__pandoDb = db;
}

export * from "./schema";
