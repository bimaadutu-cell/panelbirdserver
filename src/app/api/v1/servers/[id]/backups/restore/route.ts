import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { restoreServerBackup } from "@/lib/agent/engine";
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
    const { backupId } = body;

    if (!backupId) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "backupId required" } },
        { status: 400 }
      );
    }

    await restoreServerBackup(id, backupId);
    await createAuditLog(session.id, "backup.restore", { serverId: id, backupId });

    return NextResponse.json({ success: true, message: "Backup restored successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "RESTORE_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
