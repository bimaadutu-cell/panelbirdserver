import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { comparePassword, signToken, COOKIE_NAME } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { ensureAuthSeedData } from "@/lib/seed";
import { eq, or } from "drizzle-orm";

async function ensureSeedDataWithRetry(attempts: number = 5) {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await ensureAuthSeedData();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (index + 1)));
    }
  }
  throw lastError;
}

export async function POST(req: Request) {
  try {
    await ensureSeedDataWithRetry();

    const body = await req.json();
    const { usernameOrEmail, password } = body;

    if (!usernameOrEmail || !password) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Username/Email and Password are required" } },
        { status: 400 }
      );
    }

    const user = await db.query.users.findFirst({
      where: or(eq(users.email, usernameOrEmail), eq(users.username, usernameOrEmail)),
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid username/email or password" } },
        { status: 401 }
      );
    }

    if (user.status === "suspended") {
      return NextResponse.json(
        { success: false, error: { code: "ACCOUNT_SUSPENDED", message: "Your account is suspended. Please contact administrator." } },
        { status: 403 }
      );
    }

    const isValid = await comparePassword(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid username/email or password" } },
        { status: 401 }
      );
    }

    const sessionPayload = {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role as "admin" | "reseller" | "user",
      permissions: user.permissions || [],
      status: user.status,
      resellerId: user.resellerId,
    };

    const token = signToken(sessionPayload);

    await createAuditLog(user.id, "user.login", { username: user.username, role: user.role });

    const res = NextResponse.json({
      success: true,
      data: {
        user: sessionPayload,
      },
    });

    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      sameSite: "lax",
    });

    return res;
  } catch (err: unknown) {
    console.error("[Birdserver] login error:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "AUTH_SERVICE_UNAVAILABLE",
          message: "Layanan login sedang menyiapkan database atau koneksi. Silakan coba lagi beberapa saat.",
        },
      },
      { status: 500 }
    );
  }
}
