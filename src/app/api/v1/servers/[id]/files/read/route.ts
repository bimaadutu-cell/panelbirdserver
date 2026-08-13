import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { readServerFile } from "@/lib/agent/engine";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const path = searchParams.get("path");

    if (!path) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "File path parameter required" } },
        { status: 400 }
      );
    }

    const content = readServerFile(id, path);
    return NextResponse.json({ success: true, data: { path, content } });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "FILE_READ_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
