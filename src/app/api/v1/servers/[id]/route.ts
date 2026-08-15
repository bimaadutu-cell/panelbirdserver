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


export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { server, session } = auth;
    const body = await req.json().catch(() => ({}));

    const dockerImage =
      typeof body.dockerImage === "string" && body.dockerImage.trim()
        ? body.dockerImage.trim()
        : server.dockerImage;

    const startupCommand =
      typeof body.startupCommand === "string" && body.startupCommand.trim()
        ? body.startupCommand.trim()
        : server.startupCommand;

    const workingDirectory =
      typeof body.workingDirectory === "string" && body.workingDirectory.trim()
        ? body.workingDirectory.trim()
        : (server.workingDirectory || "/home/container");

    let envVars: Record<string, string> = {};
    if (body.envVars && typeof body.envVars === "object" && !Array.isArray(body.envVars)) {
      for (const [key, value] of Object.entries(body.envVars as Record<string, unknown>)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          return NextResponse.json(
            { success: false, error: { code: "INVALID_ENV_KEY", message: `Invalid environment variable name: ${key}` } },
            { status: 400 }
          );
        }
        if (typeof value !== "string") {
          return NextResponse.json(
            { success: false, error: { code: "INVALID_ENV_VALUE", message: `Environment variable ${key} must be a string` } },
            { status: 400 }
          );
        }
        envVars[key] = value;
      }
    } else {
      envVars = (server.envVars as Record<string, string>) || {};
    }

    // Startup changes are persisted even when the server is offline. If a
    // process is currently running, stop it first so the new configuration
    // cannot be mixed with the old process.
    if (getServerMetrics(id).status !== "stopped") {
      await stopServer(id);
    }

    await db
      .update(servers)
      .set({
        dockerImage,
        startupCommand,
        workingDirectory,
        envVars,
        status: "stopped",
        pid: 0,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id));

    await createAuditLog(session.id, "server.startup.update", {
      serverId: id,
      dockerImage,
      startupCommand,
      workingDirectory,
    }).catch((error) => {
      console.warn(`[Birdserver] startup audit log skipped for ${id}:`, error);
    });

    return NextResponse.json({
      success: true,
      message: "Startup configuration saved successfully. Press START to apply it.",
      data: {
        id,
        dockerImage,
        startupCommand,
        workingDirectory,
        envVars,
        status: "stopped",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "STARTUP_UPDATE_FAILED", message } },
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
