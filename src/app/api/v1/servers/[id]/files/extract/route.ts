import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { extractServerArchive } from "@/lib/agent/engine";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { archivePath, targetFolder = "" } = body;

    if (!archivePath) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "archivePath parameter required" } },
        { status: 400 }
      );
    }

    await extractServerArchive(id, archivePath, targetFolder);
    return NextResponse.json({ success: true, message: "Archive extracted successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "EXTRACT_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
