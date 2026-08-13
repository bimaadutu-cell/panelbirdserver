import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";
import { createAuditLog } from "@/lib/audit";

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

    const nodeList = await db.select().from(nodes);
    return NextResponse.json({ success: true, data: nodeList });
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
    const { name, fqdnIp, port = 8080, memoryMb = 32768, diskMb = 512000, cpuPercent = 800 } = body;

    if (!name || !fqdnIp) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Name and IP address required" } },
        { status: 400 }
      );
    }

    const nodeId = "node_" + cryptoRandomString(8);
    const agentToken = "bs_tok_" + cryptoRandomString(24);

    await db.insert(nodes).values({
      id: nodeId,
      name,
      fqdnIp,
      port,
      memoryMb,
      diskMb,
      cpuPercent,
      isEnabled: true,
      agentToken,
      status: "online",
    });

    await createAuditLog(session.id, "admin.node_create", { nodeId, name, fqdnIp });

    return NextResponse.json({ success: true, data: { id: nodeId, name, fqdnIp, agentToken } });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
