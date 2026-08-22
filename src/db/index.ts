import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
const parsedDatabaseUrl = (() => {
  try {
    return new URL(databaseUrl);
  } catch {
    return null;
  }
})();

const isLocalDatabaseHost = parsedDatabaseUrl
  ? ["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname)
  : true;
const shouldUseSsl = process.env.PGSSLMODE !== "disable" && !isLocalDatabaseHost;
const queryTimeoutMs = Math.max(1_000, Number(process.env.DB_QUERY_TIMEOUT_MS || 15_000));
const connectionTimeoutMs = Math.max(1_000, Number(process.env.DB_CONNECTION_TIMEOUT_MS || 8_000));
const maxPoolSize = Math.max(2, Math.min(30, Number(process.env.DB_POOL_MAX || 10)));

const globalForDb = globalThis as typeof globalThis & {
  __birdserverPostgresqlPool?: Pool;
  __birdserverDatabaseReadyPromise?: Promise<void>;
};

if (!process.env.DATABASE_URL) {
  console.warn("[Birdserver] DATABASE_URL not set; local fallback is for build/dev only.");
}

const poolConfig: PoolConfig = {
  connectionString: databaseUrl,
  max: maxPoolSize,
  min: 0,
  connectionTimeoutMillis: connectionTimeoutMs,
  idleTimeoutMillis: 30_000,
  allowExitOnIdle: false,
  maxUses: 10_000,
  statement_timeout: queryTimeoutMs,
  query_timeout: queryTimeoutMs,
  ssl: shouldUseSsl
    ? { rejectUnauthorized: process.env.PGSSL_REJECT_UNAUTHORIZED === "true" }
    : undefined,
};

export const pool = globalForDb.__birdserverPostgresqlPool ?? new Pool(poolConfig);

globalForDb.__birdserverPostgresqlPool = pool;

pool.on("error", (error) => {
  console.warn("[Birdserver] PostgreSQL idle client error:", error instanceof Error ? error.message : error);
});

export const db = drizzle(pool, { schema });

/**
 * One shared connection gate prevents every request from trying to reconnect or
 * issue queries while PostgreSQL is still unavailable. The promise is reset on
 * failure so a later request can recover after Railway/Postgres reconnects.
 */
export async function ensureDatabaseConnection(): Promise<void> {
  if (globalForDb.__birdserverDatabaseReadyPromise) {
    return globalForDb.__birdserverDatabaseReadyPromise;
  }

  const readiness = (async () => {
    const client = await pool.connect();
    try {
      await client.query({ text: "select 1", values: [] });
    } finally {
      client.release();
    }
  })();

  globalForDb.__birdserverDatabaseReadyPromise = readiness.catch((error) => {
    globalForDb.__birdserverDatabaseReadyPromise = undefined;
    throw error;
  });

  return globalForDb.__birdserverDatabaseReadyPromise;
}

export function getDatabaseConfig() {
  return {
    host: parsedDatabaseUrl?.hostname || "unknown",
    poolMax: maxPoolSize,
    queryTimeoutMs,
    connectionTimeoutMs,
    ssl: shouldUseSsl,
  };
}

export async function closeDatabase(): Promise<void> {
  globalForDb.__birdserverDatabaseReadyPromise = undefined;
  await pool.end();
}
