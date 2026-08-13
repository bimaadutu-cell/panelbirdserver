import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { ensureAuthDatabaseReady } from "@/db/bootstrap";
import { pool } from "@/db";
import { cryptoRandomString } from "@/lib/utils";
import { createAuditLog } from "@/lib/audit";
import bcrypt from "bcryptjs";

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  const apiSession = await authenticateApiKey(authHeader);
  return apiSession ?? await getSessionUser();
}

async function ensureApiKeysTable() {
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

  const result = await pool.query<{ column_name: string; is_nullable: string; column_default: string | null }>(`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
  `);

  const columns = new Set(result.rows.map((row) => row.column_name));

  if (!columns.has("id")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN id TEXT`);
  }
  if (!columns.has("user_id")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN user_id TEXT`);
  }
  if (!columns.has("name")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN name TEXT`);
  }
  if (!columns.has("key_hash")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN key_hash TEXT`);
  }
  if (!columns.has("key_prefix")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN key_prefix TEXT`);
  }
  if (!columns.has("scopes")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN scopes JSONB DEFAULT '[]'::jsonb`);
  }
  if (!columns.has("expires_at")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN expires_at TIMESTAMP NULL`);
  }
  if (!columns.has("last_used_at")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN last_used_at TIMESTAMP NULL`);
  }
  if (!columns.has("created_at")) {
    await pool.query(`ALTER TABLE api_keys ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT NOW()`);
  }

  // Legacy extra NOT NULL fields can block inserts. Make only those
  // unexpected legacy fields nullable; current fields stay protected.
  const currentColumns = new Set([
    "id", "user_id", "name", "key_hash", "key_prefix",
    "scopes", "expires_at", "last_used_at", "created_at"
  ]);

  const fresh = await pool.query<{ column_name: string; is_nullable: string; column_default: string | null }>(`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'api_keys'
  `);

  for (const row of fresh.rows) {
    if (
      !currentColumns.has(row.column_name) &&
      row.is_nullable === "NO" &&
      row.column_default === null
    ) {
      await pool.query(`ALTER TABLE api_keys ALTER COLUMN "${row.column_name}" DROP NOT NULL`);
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
    `, [session.id]);

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

    let expiresAt: Date | null = null;
    if (Number.isFinite(days) && days > 0) {
      expiresAt = new Date(Date.now() + days * 86400000);
    }

    await pool.query(
      `INSERT INTO api_keys
        (id, user_id, name, key_hash, key_prefix, scopes, expires_at, last_used_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NULL, NOW())`,
      [
        keyId,
        session.id,
        name,
        keyHash,
        keyPrefix,
        JSON.stringify(scopes),
        expiresAt
      ]
    );

    await createAuditLog(session.id, "apikey.create", { keyId, name });

    return NextResponse.json({
      success: true,
      data: {
        id: keyId,
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
      [id, session.id]
    );

    await createAuditLog(session.id, "apikey.revoke", { keyId: id });

    return NextResponse.json({
      success: true,
      message: "API key revoked successfully"
    });
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
