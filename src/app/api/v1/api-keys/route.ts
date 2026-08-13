import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { ensureAuthDatabaseReady } from "@/db/bootstrap";
import { pool } from "@/db";
import { cryptoRandomString } from "@/lib/utils";
import { createAuditLog } from "@/lib/audit";
import bcrypt from "bcryptjs";

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  let session = await authenticateApiKey(authHeader);
  if (!session) session = await getSessionUser();
  return session;
}

function forbidden() {
  return NextResponse.json(
    { success: false, error: { code: "FORBIDDEN", message: "Only admin can access API keys" } },
    { status: 403 }
  );
}

async function repairApiKeysTable() {
  // Self-heal common legacy Railway schemas before any API-key write.
  await pool.query(`
    create table if not exists api_keys (
      id text primary key,
      user_id text not null,
      name text not null,
      key_hash text not null,
      key_prefix text not null,
      scopes jsonb not null default '[]'::jsonb,
      expires_at timestamp,
      last_used_at timestamp,
      created_at timestamp default now() not null
    )
  `);

  const cols = await pool.query<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(`
    select column_name, data_type, udt_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'api_keys'
  `);

  const have = new Set(cols.rows.map(r => r.column_name));

  const required = [
    ["id", "text"],
    ["user_id", "text"],
    ["name", "text"],
    ["key_hash", "text"],
    ["key_prefix", "text"],
    ["scopes", "jsonb"],
    ["expires_at", "timestamp"],
    ["last_used_at", "timestamp"],
    ["created_at", "timestamp"],
  ] as const;

  for (const [name, type] of required) {
    if (!have.has(name)) {
      const nullable = ["expires_at", "last_used_at"].includes(name) ? "" : " not null";
      const def = name === "scopes" ? " default '[]'::jsonb" : name === "created_at" ? " default now()" : "";
      await pool.query(`alter table api_keys add column "${name}" ${type}${def}${nullable}`);
    }
  }

  // Legacy schemas sometimes contain extra NOT NULL columns with no default.
  // They are not part of BirdServer's current API-key model, so make them nullable.
  const fresh = await pool.query<{
    column_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(`
    select column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public' and table_name = 'api_keys'
  `);

  const managed = new Set(required.map(x => x[0]));
  for (const c of fresh.rows) {
    if (!managed.has(c.column_name) && c.is_nullable === "NO" && !c.column_default) {
      await pool.query(`alter table api_keys alter column "${c.column_name}" drop not null`);
    }
  }

  // Ensure the required defaults exist even if an older deployment created the table.
  await pool.query(`alter table api_keys alter column scopes set default '[]'::jsonb`);
  await pool.query(`alter table api_keys alter column created_at set default now()`);
}

export async function GET(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    await repairApiKeysTable();

    const session = await getAuthSession(req);
    if (!session) return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
    if (session.role !== "admin") return forbidden();

    const result = await pool.query(`
      select
        id::text as "id",
        name,
        key_prefix as "keyPrefix",
        scopes,
        expires_at as "expiresAt",
        last_used_at as "lastUsedAt",
        created_at as "createdAt"
      from api_keys
      where user_id::text = $1
      order by created_at desc
    `, [String(session.id)]);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[Birdserver] API key list failed:", err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: message || "Unable to load API keys" } },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    await repairApiKeysTable();

    const session = await getAuthSession(req);
    if (!session) return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
    if (session.role !== "admin") return forbidden();

    const body = await req.json().catch(() => ({}));
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const scopes = Array.isArray(body?.scopes) && body.scopes.length ? body.scopes : ["*"];
    const days = Number(body?.expiresInDays);

    if (!name) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Key name is required" } },
        { status: 400 }
      );
    }

    const rawSecret = `bs_${cryptoRandomString(32)}`;
    const keyPrefix = rawSecret.slice(0, 10);
    const keyHash = await bcrypt.hash(rawSecret, 10);
    const keyId = `apk_${cryptoRandomString(16)}`;
    const expiresAt = Number.isFinite(days) && days > 0
      ? new Date(Date.now() + days * 86400000)
      : null;

    // Use pg directly instead of Drizzle here. This avoids stale Drizzle
    // metadata/type assumptions on Railway after previous schema versions.
    const inserted = await pool.query(
      `insert into api_keys
        (id, user_id, name, key_hash, key_prefix, scopes, expires_at, last_used_at, created_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
       returning id::text as id`,
      [
        keyId,
        String(session.id),
        name,
        keyHash,
        keyPrefix,
        JSON.stringify(scopes),
        expiresAt,
        null,
        new Date(),
      ]
    );

    if (!inserted.rows[0]) {
      throw new Error("API key was not saved by the database");
    }

    await createAuditLog(session.id, "apikey.create", { keyId, name });

    return NextResponse.json({
      success: true,
      data: {
        id: keyId,
        name,
        secretKey: rawSecret,
        keyPrefix,
        scopes,
        expiresAt,
      },
    });
  } catch (err: any) {
    console.error("[Birdserver] API key create failed:", err);

    const dbMessage = err?.detail
      ? `${err.message || "Database error"}: ${err.detail}`
      : (err?.message || String(err));

    return NextResponse.json({
      success: false,
      error: {
        code: "API_KEY_CREATE_FAILED",
        message: `Gagal membuat API Key: ${dbMessage}`,
      },
    }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    await repairApiKeysTable();

    const session = await getAuthSession(req);
    if (!session) return NextResponse.json(
      { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
    if (session.role !== "admin") return forbidden();

    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: "API Key ID required" } },
      { status: 400 }
    );

    await pool.query(
      `delete from api_keys where id::text = $1 and user_id::text = $2`,
      [id, String(session.id)]
    );

    await createAuditLog(session.id, "apikey.revoke", { keyId: id });
    return NextResponse.json({ success: true, message: "API key revoked successfully" });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: err?.message || String(err) }
    }, { status: 500 });
  }
}

export async function PATCH() {
  return NextResponse.json(
    { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "PATCH not supported on API keys" } },
    { status: 405 }
  );
}
