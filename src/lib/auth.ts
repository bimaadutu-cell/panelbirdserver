import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { pool } from "@/db";
import { ensureAuthDatabaseReady } from "@/db/bootstrap";

const JWT_SECRET = process.env.JWT_SECRET || "birdserver-super-secret-jwt-key-v1-2026";
export const COOKIE_NAME = "birdserver_session";

export interface UserSession {
  id: string;
  email: string;
  username: string;
  role: "admin" | "reseller" | "user";
  permissions: string[];
  status: string;
  resellerId?: string | null;
}

type AuthUserRow = {
  id: string;
  email: string | null;
  username: string;
  password_hash: string | null;
  password?: string | null;
  role: string | null;
  status: string | null;
  reseller_id: string | null;
  permissions: unknown;
};

async function getTableColumns(tableName: string) {
  const result = await pool.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

export async function hashPassword(password: string): Promise<string> {
  return await bcrypt.hash(password, 10);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return await bcrypt.compare(password, hash);
}

export function signToken(session: UserSession): string {
  return jwt.sign(session, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): UserSession | null {
  try {
    return jwt.verify(token, JWT_SECRET) as UserSession;
  } catch {
    return null;
  }
}

function normalizeRole(rawRole: string | null | undefined) {
  const normalized = (rawRole || "user").toLowerCase();
  return normalized === "pengguna" ? "user" : normalized;
}

function normalizeUserRow(user: AuthUserRow | undefined | null): UserSession | null {
  if (!user) return null;
  return {
    id: String(user.id),
    email: user.email || "",
    username: user.username,
    role: normalizeRole(user.role) as "admin" | "reseller" | "user",
    permissions: Array.isArray(user.permissions) ? (user.permissions as string[]) : [],
    status: user.status || "active",
    resellerId: user.reseller_id,
  };
}

export async function findAuthUserByLogin(usernameOrEmail: string) {
  await ensureAuthDatabaseReady();
  const columns = await getTableColumns("users");
  const passwordSelect = columns.has("password") ? `password,` : `null::text as password,`;

  const result = await pool.query<AuthUserRow>(
    `
      select
        id::text as id,
        email,
        username,
        password_hash,
        ${passwordSelect}
        role,
        status,
        reseller_id,
        coalesce(permissions, '[]'::jsonb) as permissions
      from users
      where email = $1 or username = $1
      limit 1
    `,
    [usernameOrEmail]
  );
  return result.rows[0] || null;
}

export async function findAuthUserByIdText(id: string) {
  await ensureAuthDatabaseReady();
  const result = await pool.query<AuthUserRow>(
    `
      select
        id::text as id,
        email,
        username,
        password_hash,
        role,
        status,
        reseller_id,
        coalesce(permissions, '[]'::jsonb) as permissions
      from users
      where id::text = $1
      limit 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

export async function getSessionUser(): Promise<UserSession | null> {
  try {
    await ensureAuthDatabaseReady();
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const decoded = verifyToken(token);
    if (!decoded) return null;

    const user = await findAuthUserByIdText(decoded.id);
    const normalized = normalizeUserRow(user);
    if (!normalized || normalized.status === "suspended") return null;
    return normalized;
  } catch {
    return null;
  }
}

export async function authenticateApiKey(authHeader: string | null): Promise<UserSession | null> {
  await ensureAuthDatabaseReady();
  if (!authHeader || !authHeader.startsWith("Bearer bs_")) return null;

  const tokenStr = authHeader.replace("Bearer ", "").trim();
  const prefix = tokenStr.slice(0, 10);
  const columns = await getTableColumns("api_keys");
  const userIdExpr = columns.has("user_id") ? `user_id::text as owner_ref` : columns.has("owner_id") ? `owner_id::text as owner_ref` : `null::text as owner_ref`;
  const keyHashExpr = columns.has("key_hash") ? `key_hash` : `null::text as key_hash`;
  const keyPrefixExpr = columns.has("key_prefix") ? `key_prefix` : columns.has("prefix") ? `prefix as key_prefix` : `null::text as key_prefix`;
  const expiresAtExpr = columns.has("expires_at") ? `expires_at` : `null::timestamp as expires_at`;

  const keys = await pool.query<{
    id: string;
    owner_ref: string | null;
    key_hash: string | null;
    key_prefix: string | null;
    expires_at: Date | null;
  }>(
    `
      select
        id::text as id,
        ${userIdExpr},
        ${keyHashExpr},
        ${keyPrefixExpr},
        ${expiresAtExpr}
      from api_keys
      where ${keyPrefixExpr.split(" as ")[0]} = $1
    `,
    [prefix]
  );

  for (const key of keys.rows) {
    if (!key.key_hash) continue;
    const match = await bcrypt.compare(tokenStr, key.key_hash);
    if (!match) continue;
    if (key.expires_at && new Date(key.expires_at) < new Date()) return null;

    const ownerId = key.owner_ref;
    if (!ownerId) return null;

    const user = await findAuthUserByIdText(ownerId);
    const normalized = normalizeUserRow(user);
    if (!normalized || normalized.status === "suspended") return null;

    if (columns.has("last_used_at")) {
      await pool.query(`update api_keys set last_used_at = now() where id::text = $1`, [key.id]);
    }
    return normalized;
  }

  return null;
}
