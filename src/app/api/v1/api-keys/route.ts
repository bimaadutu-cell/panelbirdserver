import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { ensureAuthDatabaseReady } from "@/db/bootstrap";
import { pool } from "@/db";
import { cryptoRandomString } from "@/lib/utils";
import { createAuditLog } from "@/lib/audit";
import bcrypt from "bcryptjs";

type ColumnInfo = {
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: string;
  column_default: string | null;
};

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  const apiSession = await authenticateApiKey(authHeader);
  return apiSession ?? await getSessionUser();
}

async function getApiKeyColumns(): Promise<Map<string, ColumnInfo>> {
  const result = await pool.query<ColumnInfo>(`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
  `);
  return new Map(result.rows.map((row) => [row.column_name, row]));
}

async function ensureApiKeysTable() {
  // Do not recreate/alter the primary-key type of an existing Railway table.
  // Old deployments may have id INTEGER/SERIAL while the current schema uses TEXT.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      expires_at TIMESTAMP NULL,
      last_used_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const columns = await getApiKeyColumns();

  // Legacy deployments sometimes created api_keys.user_id as INTEGER while
  // BirdServer users use TEXT ids such as usr_xxx. Normalize that column so
  // API keys can authenticate the same account on every deployment.
  const legacyUserColumn = columns.get("user_id");
  if (legacyUserColumn && ["integer", "bigint", "smallint"].includes(legacyUserColumn.data_type)) {
    // Drop legacy FK constraints first. PostgreSQL cannot change the type of a
    // referencing column while an FK to an integer users.id is still attached.
    const fkRows = await pool.query<{ constraint_name: string }>(`
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
       AND kcu.table_name = tc.table_name
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'api_keys'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'user_id'
    `);
    for (const row of fkRows.rows) {
      await pool.query(`ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS "${row.constraint_name.replace(/"/g, '""')}"`);
    }
    await pool.query(`ALTER TABLE api_keys ALTER COLUMN user_id TYPE TEXT USING user_id::text`);
  }

  const required: Array<[string, string]> = [
    ["user_id", "TEXT"],
    ["name", "TEXT NOT NULL DEFAULT 'API Key'"],
    ["key_hash", "TEXT NOT NULL DEFAULT ''"],
    ["key_prefix", "TEXT NOT NULL DEFAULT ''"],
    ["scopes", "JSONB NOT NULL DEFAULT '[]'::jsonb"],
    ["expires_at", "TIMESTAMP NULL"],
    ["last_used_at", "TIMESTAMP NULL"],
    ["created_at", "TIMESTAMP NOT NULL DEFAULT NOW()"],
  ];

  for (const [name, definition] of required) {
    if (!columns.has(name)) {
      await pool.query(`ALTER TABLE api_keys ADD COLUMN "${name}" ${definition}`);
    }
  }

  // If a legacy table has an unexpected NOT NULL column with no default,
  // it would reject the INSERT. Such legacy columns are safe to make nullable.
  const fresh = await getApiKeyColumns();
  const managed = new Set([
    "id", "user_id", "name", "key_hash", "key_prefix",
    "scopes", "expires_at", "last_used_at", "created_at"
  ]);

  for (const [name, info] of fresh) {
    if (!managed.has(name) && info.is_nullable === "NO" && !info.column_default) {
      await pool.query(`ALTER TABLE api_keys ALTER COLUMN "${name}" DROP NOT NULL`);
    }
  }

  await pool.query(`ALTER TABLE api_keys ALTER COLUMN scopes SET DEFAULT '[]'::jsonb`);
  await pool.query(`ALTER TABLE api_keys ALTER COLUMN created_at SET DEFAULT NOW()`);
}

function adminRequired() {
  return NextResponse.json(
    { success: false, error: { code: "FORBIDDEN", message: "Only admin can access API keys" } },
    { status: 403 }
  );
}

function normalizeUserIdForColumn(sessionId: unknown, column: ColumnInfo | undefined) {
  const value = String(sessionId);
  if (!column) return value;
  if (["integer", "bigint", "smallint"].includes(column.data_type) && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  // The self-healing migration normally makes this TEXT. Keeping a string here
  // also prevents a fake numeric conversion from breaking modern usr_xxx IDs.
  return value;
}

export async function GET(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    await ensureApiKeysTable();

    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }
    if (session.role !== "admin") return adminRequired();

    const result = await pool.query(`
      SELECT
        id::text AS "id",
        name,
        key_prefix AS "keyPrefix",
        scopes,
        expires_at AS "expiresAt",
        last_used_at AS "lastUsedAt",
        created_at AS "createdAt"
      FROM api_keys
      WHERE user_id::text = $1
      ORDER BY created_at DESC
    `, [String(session.id)]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[BirdServer] API key GET error:", error);
    return NextResponse.json(
      { success: false, error: { code: "API_KEY_ERROR", message } },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    await ensureApiKeysTable();

    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }
    if (session.role !== "admin") return adminRequired();

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const scopes = Array.isArray(body?.scopes) && body.scopes.length > 0 ? body.scopes : ["*"];
    const days = Number(body?.expiresInDays);

    if (!name) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Key name is required" } },
        { status: 400 }
      );
    }

    const secretKey = `bs_${cryptoRandomString(48)}`;
    const keyId = `apk_${cryptoRandomString(16)}`;
    const keyPrefix = secretKey.slice(0, 10);
    const keyHash = await bcrypt.hash(secretKey, 10);
    const expiresAt = Number.isFinite(days) && days > 0
      ? new Date(Date.now() + days * 86400000)
      : null;

    const columns = await getApiKeyColumns();
    const idColumn = columns.get("id");
    const userColumn = columns.get("user_id");

    // IMPORTANT: Railway's current screenshot proves that the live DB has
    // api_keys.id as INTEGER. Never send "apk_xxx" into an INTEGER column.
    // If id is INTEGER/BIGINT/SERIAL, omit it and let PostgreSQL generate it.
    const numericId = idColumn && ["integer", "bigint", "smallint"].includes(idColumn.data_type);
    const userId = normalizeUserIdForColumn(session.id, userColumn);

    let result;
    if (numericId) {
      // Existing INTEGER/SERIAL primary key: PostgreSQL generates the ID.
      result = await pool.query(
        `INSERT INTO api_keys
          (user_id, name, key_hash, key_prefix, scopes, expires_at, last_used_at, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, NULL, NOW())
         RETURNING id::text AS id`,
        [userId, name, keyHash, keyPrefix, JSON.stringify(scopes), expiresAt]
      );
    } else {
      // Current schema: TEXT primary key, so use our apk_... identifier.
      result = await pool.query(
        `INSERT INTO api_keys
          (id, user_id, name, key_hash, key_prefix, scopes, expires_at, last_used_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NULL, NOW())
         RETURNING id::text AS id`,
        [keyId, userId, name, keyHash, keyPrefix, JSON.stringify(scopes), expiresAt]
      );
    }

    const storedId = result.rows[0]?.id;
    if (!storedId) throw new Error("Database tidak mengembalikan ID API Key setelah INSERT");

    await createAuditLog(session.id, "apikey.create", { keyId: storedId, name });

    return NextResponse.json({
      success: true,
      data: {
        id: storedId,
        name,
        secretKey,
        keyPrefix,
        scopes,
        expiresAt
      }
    });
  } catch (error: any) {
    console.error("[BirdServer] API key POST error:", error);
    const message = error?.detail
      ? `${error?.message || "Database error"}: ${error.detail}`
      : (error?.message || String(error));

    return NextResponse.json(
      {
        success: false,
        error: {
          code: "API_KEY_CREATE_FAILED",
          message: `Gagal membuat API Key: ${message}`
        }
      },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    await ensureApiKeysTable();

    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }
    if (session.role !== "admin") return adminRequired();

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "API Key ID required" } },
        { status: 400 }
      );
    }

    await pool.query(
      `DELETE FROM api_keys WHERE id::text = $1 AND user_id::text = $2`,
      [id, String(session.id)]
    );

    await createAuditLog(session.id, "apikey.revoke", { keyId: id });

    return NextResponse.json({ success: true, message: "API key revoked successfully" });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "API_KEY_DELETE_FAILED",
          message: error?.message || String(error)
        }
      },
      { status: 500 }
    );
  }
}
