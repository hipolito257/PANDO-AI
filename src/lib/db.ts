import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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

// Type-safe singleton — preserves schema generics for db.query.*
const globalForDb = globalThis as unknown as {
  __pandoDb: ReturnType<typeof createDb> | undefined;
};

export const db = globalForDb.__pandoDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pandoDb = db;
}

export * from "./schema";
