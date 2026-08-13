import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

if (!process.env.DATABASE_URL) {
  console.warn("[Birdserver] DATABASE_URL not set, using local fallback connection string.");
}

const parsedDatabaseUrl = (() => {
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
})();

const isLocalDatabaseHost = parsedDatabaseUrl
  ? ["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname)
  : true;

const shouldUseSsl = !isLocalDatabaseHost;

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl ? { rejectUnauthorized: false } : undefined,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });
