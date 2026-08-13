import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { deleteServerItem } from "@/lib/agent/engine";
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
    const { paths } = body;

    const itemsToDelete: string[] = Array.isArray(paths) ? paths : body.path ? [body.path] : [];
    if (itemsToDelete.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "No items specified for deletion" } },
        { status: 400 }
      );
    }

    for (const itemPath of itemsToDelete) {
      deleteServerItem(id, itemPath);
    }

    await createAuditLog(session.id, "file.delete", { serverId: id, paths: itemsToDelete });
    return NextResponse.json({ success: true, message: `${itemsToDelete.length} item(s) deleted` });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "DELETE_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
