import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { adjustResellerBalance } from "@/lib/reseller";

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  let session = await authenticateApiKey(authHeader);
  if (!session) {
    session = await getSessionUser();
  }
  return session;
}

export async function POST(req: Request) {
  try {
    const session = await getAuthSession(req);
    if (!session || (session.role !== "reseller" && session.role !== "admin")) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Reseller access required" } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { amount } = body;

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Positive amount required" } },
        { status: 400 }
      );
    }

    await adjustResellerBalance(session.id, Number(amount), "topup", `Manual topup ${amount}`);

    return NextResponse.json({ success: true, message: `Successfully topped up ${amount}` });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
