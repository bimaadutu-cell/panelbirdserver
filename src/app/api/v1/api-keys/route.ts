import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { ensureAuthDatabaseReady } from "@/db/bootstrap";
import { db } from "@/db";
import { apiKeys } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";
import { createAuditLog } from "@/lib/audit";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  let session = await authenticateApiKey(authHeader);
  if (!session) {
    session = await getSessionUser();
  }
  return session;
}

function forbidden() {
  return NextResponse.json(
    { success: false, error: { code: "FORBIDDEN", message: "Only admin can access API keys" } },
    { status: 403 }
  );
}

export async function GET(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }
    if (session.role !== "admin") return forbidden();

    const keys = await db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        expiresAt: apiKeys.expiresAt,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, session.id));

    return NextResponse.json({ success: true, data: keys });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Birdserver] API key list failed:", err);
    return NextResponse.json({ success: false, error: { code: "INTERNAL_ERROR", message: errorMessage || "Unable to load API keys" } }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureAuthDatabaseReady();
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }
    if (session.role !== "admin") return forbidden();

    const body = await req.json();
    const { name, scopes = ["*"], expiresInDays } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Key name is required" } },
        { status: 400 }
      );
    }

    const rawSecret = `bs_${cryptoRandomString(32)}`;
    const keyPrefix = rawSecret.slice(0, 10);
    const keyHash = await bcrypt.hash(rawSecret, 10);
    const keyId = "apk_" + cryptoRandomString(12);
    const now = new Date();
    const normalizedScopes = Array.isArray(scopes) && scopes.length > 0 ? scopes : ["*"];
    const expiresAt = Number.isFinite(Number(expiresInDays)) && Number(expiresInDays) > 0
      ? new Date(now.getTime() + Number(expiresInDays) * 24 * 60 * 60 * 1000)
      : null;

    // Write every non-null field explicitly. This also works with older Railway
    // databases where created_at was present but had no DEFAULT constraint.
    await db.insert(apiKeys).values({
      id: keyId,
      userId: session.id,
      name: String(name).trim(),
      keyHash,
      keyPrefix,
      scopes: normalizedScopes,
      expiresAt,
      lastUsedAt: null,
      createdAt: now,
    });

    await createAuditLog(session.id, "apikey.create", { keyId, name });
    return NextResponse.json({ success: true, data: { id: keyId, name, secretKey: rawSecret, keyPrefix, scopes, expiresAt } });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[Birdserver] API key create failed:", err);
    return NextResponse.json({ success: false, error: { code: "INTERNAL_ERROR", message: errorMessage || "Unable to create API key" } }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }
    if (session.role !== "admin") return forbidden();

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "API Key ID required" } },
        { status: 400 }
      );
    }

    await db.delete(apiKeys).where(and(eq(apiKeys.id, id), eq(apiKeys.userId, session.id)));
    await createAuditLog(session.id, "apikey.revoke", { keyId: id });
    return NextResponse.json({ success: true, message: "API key revoked successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getAuthSession(req);
  if (!session || session.role !== "admin") return forbidden();
  return NextResponse.json(
    { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "PATCH not supported on API keys" } },
    { status: 405 }
  );
}
