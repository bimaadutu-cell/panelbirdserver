import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey, COOKIE_NAME } from "@/lib/auth";
import { ensureAuthSeedData } from "@/lib/seed";
import { getResellerQuotaAndUsage } from "@/lib/reseller";

export async function GET(req: Request) {
  try {
    await ensureAuthSeedData();

    // Check header for API key auth or fallback to session cookie
    const authHeader = req.headers.get("authorization");
    let session = await authenticateApiKey(authHeader);
    if (!session) {
      session = await getSessionUser();
    }

    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }

    let resellerUsage = null;
    if (session.role === "reseller") {
      try {
        resellerUsage = await getResellerQuotaAndUsage(session.id);
      } catch {
        resellerUsage = null;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        user: session,
        resellerUsage,
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
