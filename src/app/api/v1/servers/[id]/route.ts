import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { ensureDatabaseReady } from "@/db/bootstrap";
import { db } from "@/db";
import { servers, allocations } from "@/db/schema";
import { stopServer, deleteServerItem, getServerMetrics } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id || id.trim().length < 3) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_SERVER_ID", message: "Invalid server ID" } },
        { status: 400 }
      );
    }

    // Deep links to /servers/:id can be opened before /api/v1/servers has
    // initialized the database. Make the schema ready here as well.
    await ensureDatabaseReady();

    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { server } = auth;
    const allocation = server.allocationId
      ? await db.query.allocations.findFirst({ where: eq(allocations.id, server.allocationId) })
      : null;

    const metrics = getServerMetrics(server.id);
    const actualStatus = metrics.status;

    // IMPORTANT: do not write runtime status during a read request.
    // The detail page polls this endpoint every few seconds. A read-time
    // database UPDATE can fail independently of the page itself (and was the
    // source of the "update servers set status=$1, pid=$2..." error seen on
    // hosted Postgres). Runtime state is already available from the agent
    // metrics, while power actions persist their own state explicitly.
    // Keeping GET side-effect free makes /servers/:id safe to open and poll.

    return NextResponse.json({
      success: true,
      data: {
        ...server,
        status: actualStatus,
        allocation,
        metrics,
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { session, server } = auth;
    const body = await req.json();
    const { name, dockerImage, startupCommand, workingDirectory, envVars, memoryMb, cpuPercent, diskMb, status } = body;

    const updates: Partial<typeof servers.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (name) updates.name = name;
    if (dockerImage) updates.dockerImage = dockerImage;
    if (startupCommand) updates.startupCommand = startupCommand;
    if (workingDirectory) updates.workingDirectory = workingDirectory;
    if (envVars) updates.envVars = envVars;
    if (memoryMb) updates.memoryMb = memoryMb;
    if (cpuPercent) updates.cpuPercent = cpuPercent;
    if (diskMb) updates.diskMb = diskMb;
    if (status) updates.status = status;

    await db.update(servers).set(updates).where(eq(servers.id, id));
    await createAuditLog(session.id, "server.update", { serverId: id, updates });

    return NextResponse.json({ success: true, message: "Server updated successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
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

    const { session, server } = auth;
    await stopServer(id);

    if (server.allocationId) {
      await db
        .update(allocations)
        .set({ isAssigned: false, serverId: null })
        .where(eq(allocations.id, server.allocationId));
    }

    deleteServerItem(id, "");
    await db.delete(servers).where(eq(servers.id, id));

    await createAuditLog(session.id, "server.delete", { serverId: id, name: server.name });
    await dispatchWebhook("server.deleted", { serverId: id, name: server.name });

    return NextResponse.json({ success: true, message: "Server deleted successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
