import { NextResponse } from "next/server";
import { comparePassword, signToken, COOKIE_NAME, findAuthUserByLogin } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";
import { ensureAuthSeedData } from "@/lib/seed";

async function ensureSeedDataWithRetry(attempts: number = 5) {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await ensureAuthSeedData();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50 * (index + 1)));
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

    const user = await findAuthUserByLogin(usernameOrEmail);
    if (!user) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid username/email or password" } },
        { status: 401 }
      );
    }

    const normalizedRole = (user.role || "user").toLowerCase() === "pengguna" ? "user" : (user.role || "user").toLowerCase();
    const normalizedStatus = user.status || "active";

    if (normalizedStatus === "suspended") {
      return NextResponse.json(
        { success: false, error: { code: "ACCOUNT_SUSPENDED", message: "Your account is suspended. Please contact administrator." } },
        { status: 403 }
      );
    }

    let isValid = false;
    if (user.password_hash) {
      isValid = await comparePassword(password, user.password_hash);
    }
    if (!isValid && user.password) {
      isValid = user.password === password;
    }

    if (!isValid) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_CREDENTIALS", message: "Invalid username/email or password" } },
        { status: 401 }
      );
    }

    const sessionPayload = {
      id: String(user.id),
      email: user.email || "",
      username: user.username,
      role: normalizedRole as "admin" | "reseller" | "user",
      permissions: Array.isArray(user.permissions) ? (user.permissions as string[]) : [],
      status: normalizedStatus,
      resellerId: user.reseller_id,
    };

    const token = signToken(sessionPayload);
    await createAuditLog(sessionPayload.id, "user.login", { username: sessionPayload.username, role: sessionPayload.role });

    const res = NextResponse.json({ success: true, data: { user: sessionPayload } });
    res.cookies.set(COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
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
