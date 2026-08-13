import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { db } from "@/db";
import { allocations } from "@/db/schema";
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

    const allocList = await db.select().from(allocations);
    return NextResponse.json({ success: true, data: allocList });
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
    const { nodeId, ip = "127.0.0.1", port, alias } = body;

    if (!nodeId || !port) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Node ID and Port required" } },
        { status: 400 }
      );
    }

    const allocId = "alloc_" + cryptoRandomString(8);
    await db.insert(allocations).values({
      id: allocId,
      nodeId,
      ip,
      port: Number(port),
      alias,
      isAssigned: false,
    });

    return NextResponse.json({ success: true, message: "Allocation created successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
