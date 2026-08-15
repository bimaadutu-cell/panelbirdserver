import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { allocations, servers } from "@/db/schema";
import { authorizeServerRequest } from "@/lib/server-access";
import { getServerMetrics, stopServer } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";

/**
 * IMPORTANT: This route file must only export Next.js HTTP handlers.
 * Runtime/FS/process helpers live in src/lib/agent/engine.ts.
 * This keeps Next.js 16 route type-checking and Turbopack NFT tracing happy.
 */

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { server } = auth;
    const allocation = server.allocationId
      ? await db.query.allocations.findFirst({
          where: eq(allocations.id, server.allocationId),
        })
      : null;

    const metrics = getServerMetrics(id);
    const status = metrics.status === "running" ? "running" : "stopped";

    // Runtime process state is the source of truth. Do not leave the DB showing
    // running when the actual process has already exited.
    if (server.status !== status) {
      await db
        .update(servers)
        .set({
          status,
          pid: status === "running" ? server.pid : 0,
          updatedAt: new Date(),
        })
        .where(eq(servers.id, id))
        .catch((error) => {
          console.warn(`[Birdserver] status reconciliation skipped for ${id}:`, error);
        });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...server,
        status,
        allocation: allocation
          ? {
              id: allocation.id,
              ip: allocation.ip,
              port: allocation.port,
              alias: allocation.alias,
            }
          : null,
        metrics,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_DETAIL_FAILED", message } },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    if (auth.session.role !== "admin" && auth.session.role !== "reseller") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Only admin or reseller can delete a server" } },
        { status: 403 }
      );
    }

    const { server, session } = auth;
    await stopServer(id).catch((error) => {
      console.warn(`[Birdserver] stop before delete skipped for ${id}:`, error);
    });

    if (server.allocationId) {
      await db
        .update(allocations)
        .set({ isAssigned: false, serverId: null })
        .where(eq(allocations.id, server.allocationId));
    }

    await db.delete(servers).where(eq(servers.id, id));

    await createAuditLog(session.id, "server.delete", { serverId: id, name: server.name }).catch(
      (error) => console.warn("[Birdserver] delete audit log skipped:", error)
    );

    return NextResponse.json({
      success: true,
      message: "Server deleted successfully",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "SERVER_DELETE_FAILED", message } },
      { status: 500 }
    );
  }
}
