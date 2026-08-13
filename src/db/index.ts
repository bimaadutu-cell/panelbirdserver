import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Resolve the PostgreSQL connection string at runtime.
 *
 * Railway normally exposes DATABASE_URL, but accepting the common aliases
 * makes deployments more resilient when a project/plugin uses a different
 * variable name. We intentionally do NOT silently fall back to localhost in
 * production: that hides a broken Railway database configuration.
 */
function getDatabaseUrl(): string {
  const raw =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_PRIVATE_URL ??
    process.env.DATABASE_PUBLIC_URL;

  if (!raw || !raw.trim()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "[Birdserver] DATABASE_URL is missing. Set DATABASE_URL to your Railway PostgreSQL connection string."
      );
    }

    return "postgresql://postgres:postgres@127.0.0.1:5432/app_db";
  }

  // Users sometimes paste the value with surrounding quotes into Railway.
  return raw.trim().replace(/^(['"])(.*)\1$/s, "$2");
}

const databaseUrl = getDatabaseUrl();

let parsedDatabaseUrl: URL;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
    throw new Error(`Unsupported protocol "${parsedDatabaseUrl.protocol}"`);
  }
  if (!parsedDatabaseUrl.hostname) {
    throw new Error("Database hostname is empty");
  }
} catch (error) {
  throw new Error(
    `[Birdserver] Invalid PostgreSQL DATABASE_URL. ${
      error instanceof Error ? error.message : String(error)
    }`
  );
}

const sslMode = parsedDatabaseUrl.searchParams.get("sslmode")?.toLowerCase();
const isLocalDatabaseHost = ["127.0.0.1", "localhost", "::1"].includes(
  parsedDatabaseUrl.hostname
);

// Railway/public PostgreSQL commonly requires TLS. Respect an explicit
// sslmode=disable when supplied, otherwise enable TLS for non-local hosts.
const useSsl =
  sslMode === "disable"
    ? false
    : sslMode === "require" || !isLocalDatabaseHost
      ? { rejectUnauthorized: false }
      : undefined;

const globalForDb = globalThis as typeof globalThis & {
  __birdserverPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__birdserverPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    ssl: useSsl,
    max: Number(process.env.DB_POOL_MAX || 10),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 10000),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    keepAlive: true,
  });

globalForDb.__birdserverPostgresqlPool = pool;

pool.on("error", (error) => {
  console.error("[Birdserver] PostgreSQL pool error:", error);
});

export const db = drizzle(pool, { schema });
