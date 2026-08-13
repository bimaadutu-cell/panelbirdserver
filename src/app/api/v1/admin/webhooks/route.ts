import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";

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

    const hooks = await db.select().from(webhooks);
    return NextResponse.json({ success: true, data: hooks });
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
    const { name, url, events = [] } = body;

    if (!name || !url) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Name and URL required" } },
        { status: 400 }
      );
    }

    const hookId = "wh_" + cryptoRandomString(8);
    const secret = "whsec_" + cryptoRandomString(24);

    await db.insert(webhooks).values({
      id: hookId,
      name,
      url,
      secret,
      events,
      isActive: true,
    });

    return NextResponse.json({ success: true, data: { id: hookId, name, url, secret } });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
