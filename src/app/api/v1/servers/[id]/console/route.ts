import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { sendCommandToServer } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";

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
    const { command } = body;

    if (typeof command !== "string") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Command must be a string" } },
        { status: 400 }
      );
    }

    const sent = await sendCommandToServer(id, command);
    if (!sent) {
      return NextResponse.json(
        { success: false, error: { code: "SERVER_OFFLINE", message: "Server is offline or process stdin unavailable" } },
        { status: 400 }
      );
    }

    await createAuditLog(session.id, "server.console_command", { serverId: id, command });
    return NextResponse.json({ success: true, message: "Command sent to server console" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
