import { NextResponse } from "next/server";
import { getSessionUser, COOKIE_NAME } from "@/lib/auth";
import { createAuditLog } from "@/lib/audit";

export async function POST() {
  try {
    const session = await getSessionUser();
    if (session) {
      await createAuditLog(session.id, "user.logout", { username: session.username });
    }

    const res = NextResponse.json({ success: true, message: "Logged out successfully" });
    res.cookies.delete(COOKIE_NAME);
    return res;
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
