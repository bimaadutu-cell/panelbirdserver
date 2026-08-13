import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { db } from "@/db";
import { ensureAuthDatabaseReady } from "@/db/bootstrap";
import { users, apiKeys } from "@/db/schema";
import { eq } from "drizzle-orm";

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

export async function getSessionUser(): Promise<UserSession | null> {
  try {
    await ensureAuthDatabaseReady();
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    
    if (!token) {
      return null;
    }

    const decoded = verifyToken(token);
    if (!decoded) return null;

    // Refresh user status from DB to ensure not suspended
    const user = await db.query.users.findFirst({
      where: eq(users.id, decoded.id),
    });

    if (!user || user.status === "suspended") {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as "admin" | "reseller" | "user",
      permissions: user.permissions || [],
      status: user.status,
      resellerId: user.resellerId,
    };
  } catch {
    return null;
  }
}

export async function authenticateApiKey(authHeader: string | null): Promise<UserSession | null> {
  await ensureAuthDatabaseReady();
  if (!authHeader || !authHeader.startsWith("Bearer bs_")) {
    return null;
  }

  const tokenStr = authHeader.replace("Bearer ", "").trim();
  const prefix = tokenStr.slice(0, 10); // bs_xxxxxx

  const keys = await db.select().from(apiKeys).where(eq(apiKeys.keyPrefix, prefix));
  for (const key of keys) {
    const match = await bcrypt.compare(tokenStr, key.keyHash);
    if (match) {
      // Check expiry
      if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
        return null;
      }

      // Fetch key owner
      const user = await db.query.users.findFirst({
        where: eq(users.id, key.userId),
      });

      if (!user || user.status === "suspended") {
        return null;
      }

      // Update last used
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id));

      return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role as "admin" | "reseller" | "user",
        permissions: user.permissions || [],
        status: user.status,
        resellerId: user.resellerId,
      };
    }
  }

  return null;
}
