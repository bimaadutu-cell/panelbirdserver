import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { renameServerItem } from "@/lib/agent/engine";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { oldPath, newPath } = body;

    if (!oldPath || !newPath) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "oldPath and newPath are required" } },
        { status: 400 }
      );
    }

    renameServerItem(id, oldPath, newPath);
    return NextResponse.json({ success: true, message: "Renamed successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "RENAME_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
