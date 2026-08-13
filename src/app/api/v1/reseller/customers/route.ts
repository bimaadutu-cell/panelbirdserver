import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey, hashPassword } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";
import { createAuditLog } from "@/lib/audit";
import { eq, and } from "drizzle-orm";

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
    if (!session || (session.role !== "reseller" && session.role !== "admin")) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Reseller or Admin access required" } },
        { status: 403 }
      );
    }

    const customers = await db
      .select({
        id: users.id,
        username: users.username,
        email: users.email,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.resellerId, session.id));

    return NextResponse.json({ success: true, data: customers });
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
        { success: false, error: { code: "FORBIDDEN", message: "Only admin can create accounts" } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { username, email, password } = body;

    if (!username || !email || !password) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Username, email and password required" } },
        { status: 400 }
      );
    }

    const passHash = await hashPassword(password);
    const customerId = "usr_cust_" + cryptoRandomString(12);

    await db.insert(users).values({
      id: customerId,
      email,
      username,
      passwordHash: passHash,
      role: "user",
      status: "active",
      resellerId: session.id,
      permissions: ["server.create", "server.console", "server.files"],
    });

    await createAuditLog(session.id, "reseller.customer_create", { customerId, username, email });

    return NextResponse.json({
      success: true,
      data: { id: customerId, username, email, role: "user", status: "active" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
