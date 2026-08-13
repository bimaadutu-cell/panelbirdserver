import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { writeServerFile } from "@/lib/agent/engine";
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
    const { path, content } = body;

    if (!path || typeof content !== "string") {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "File path and content are required" } },
        { status: 400 }
      );
    }

    writeServerFile(id, path, content);
    await createAuditLog(session.id, "file.write", { serverId: id, path });

    return NextResponse.json({ success: true, message: "File saved successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "FILE_WRITE_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
