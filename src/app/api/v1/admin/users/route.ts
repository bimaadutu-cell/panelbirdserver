import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey, hashPassword } from "@/lib/auth";
import { db } from "@/db";
import { users, resellers } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";
import { createAuditLog } from "@/lib/audit";
import { eq } from "drizzle-orm";

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  let session = await authenticateApiKey(authHeader);
  if (!session) {
    session = await getSessionUser();
  }
  return session;
}

export async function GET(req: Request) {
  try {
    const session = await getAuthSession(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
        { status: 403 }
      );
    }

    const allUsers = await db.select().from(users);
    return NextResponse.json({ success: true, data: allUsers });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAuthSession(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { username, email, password, role = "user", ramLimitMb, cpuLimitPercent, diskLimitMb, maxServers, maxCustomers, balance } = body;

    if (!username || !email || !password) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Username, email and password required" } },
        { status: 400 }
      );
    }

    const passHash = await hashPassword(password);
    const userId = "usr_" + cryptoRandomString(12);

    await db.insert(users).values({
      id: userId,
      email,
      username,
      passwordHash: passHash,
      role,
      status: "active",
      permissions: role === "admin" ? ["*"] : ["server.create", "server.console"],
    });

    if (role === "reseller") {
      await db.insert(resellers).values({
        id: "res_" + cryptoRandomString(12),
        userId,
        balance: balance || 100000,
        ramLimitMb: ramLimitMb || 10240,
        cpuLimitPercent: cpuLimitPercent || 500,
        diskLimitMb: diskLimitMb || 102400,
        maxServers: maxServers || 20,
        maxCustomers: maxCustomers || 50,
      });
    }

    await createAuditLog(session.id, "admin.user_create", { userId, username, role });

    return NextResponse.json({ success: true, message: `User ${username} created as ${role}` });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
