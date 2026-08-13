import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { db } from "@/db";
import { transactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

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
        { success: false, error: { code: "FORBIDDEN", message: "Reseller access required" } },
        { status: 403 }
      );
    }

    const list = await db
      .select()
      .from(transactions)
      .where(eq(transactions.resellerId, session.id))
      .orderBy(desc(transactions.createdAt));

    return NextResponse.json({ success: true, data: list });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
