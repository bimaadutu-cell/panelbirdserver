import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { startServer, stopServer, restartServer, killServer } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { session } = auth;
    const body = await req.json();
    const { action } = body;

    if (!["start", "stop", "restart", "kill"].includes(action)) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_ACTION", message: "Action must be start, stop, restart, or kill" } },
        { status: 400 }
      );
    }

    let success = false;
    if (action === "start") {
      success = await startServer(id);
      try {
        await dispatchWebhook("server.started", { serverId: id });
      } catch (webhookError) {
        console.warn("[Birdserver] start webhook skipped:", webhookError);
      }
    } else if (action === "stop") {
      success = await stopServer(id);
      try {
        await dispatchWebhook("server.stopped", { serverId: id });
      } catch (webhookError) {
        console.warn("[Birdserver] stop webhook skipped:", webhookError);
      }
    } else if (action === "restart") {
      success = await restartServer(id);
    } else if (action === "kill") {
      success = await killServer(id);
    }

    try {
      await createAuditLog(session.id, `server.${action}`, { serverId: id });
    } catch (auditError) {
      console.warn("[Birdserver] power audit log skipped:", auditError);
    }

    return NextResponse.json({
      success,
      message: `Server power action '${action}' completed successfully`,
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "POWER_ACTION_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
