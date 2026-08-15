import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { db } from "@/db";
import { orders, packages, servers, resellers } from "@/db/schema";
import { adjustResellerBalance, verifyResellerQuotaForNewServer } from "@/lib/reseller";
import { cryptoRandomString, generateServerIdentifier } from "@/lib/utils";
import { initializeServerFiles } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";
import { eq } from "drizzle-orm";

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

    const orderList = await db
      .select()
      .from(orders)
      .where(eq(orders.resellerId, session.id));

    return NextResponse.json({ success: true, data: orderList });
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
        { success: false, error: { code: "FORBIDDEN", message: "Only admin can provision new servers" } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { customerId, packageId, serverName } = body;

    if (!customerId || !packageId || !serverName) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Customer ID, Package ID and Server Name required" } },
        { status: 400 }
      );
    }

    const pkg = await db.query.packages.findFirst({
      where: eq(packages.id, packageId),
    });

    if (!pkg) {
      return NextResponse.json(
        { success: false, error: { code: "PACKAGE_NOT_FOUND", message: "Package not found" } },
        { status: 404 }
      );
    }

    // Check reseller quota
    const quotaCheck = await verifyResellerQuotaForNewServer(
      session.id,
      pkg.memoryMb,
      pkg.cpuPercent,
      pkg.diskMb
    );

    if (!quotaCheck.allowed) {
      return NextResponse.json(
        { success: false, error: { code: "RESELLER_QUOTA_EXCEEDED", message: quotaCheck.reason } },
        { status: 403 }
      );
    }

    // Deduct balance
    await adjustResellerBalance(
      session.id,
      -pkg.price,
      "order_payment",
      `Provision server '${serverName}' for customer ${customerId}`
    );

    // Create Server
    const serverId = "srv_" + cryptoRandomString(12);
    const identifier = generateServerIdentifier();

    await db.insert(servers).values({
      id: serverId,
      identifier,
      name: serverName,
      userId: customerId,
      resellerId: session.id,
      nodeId: "node_01",
      dockerImage: "node:20-alpine",
      startupCommand: "node index.js",
      memoryMb: pkg.memoryMb,
      cpuPercent: pkg.cpuPercent,
      diskMb: pkg.diskMb,
      status: "stopped",
      expiresAt: new Date(Date.now() + pkg.durationDays * 24 * 60 * 60 * 1000),
    });

    initializeServerFiles(serverId, "Node.js");

    // Record order
    const orderId = "ord_" + cryptoRandomString(12);
    await db.insert(orders).values({
      id: orderId,
      resellerId: session.id,
      customerId,
      packageId,
      serverId,
      amount: pkg.price,
      durationDays: pkg.durationDays,
      status: "active",
      expiresAt: new Date(Date.now() + pkg.durationDays * 24 * 60 * 60 * 1000),
    });

    await createAuditLog(session.id, "reseller.order_create", { orderId, serverId, amount: pkg.price });

    return NextResponse.json({
      success: true,
      data: { orderId, serverId, status: "active" },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "ORDER_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
