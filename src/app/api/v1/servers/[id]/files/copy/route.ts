import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { copyServerItem } from "@/lib/agent/engine";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { srcPath, destPath } = body;

    if (!srcPath || !destPath) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "srcPath and destPath required" } },
        { status: 400 }
      );
    }

    copyServerItem(id, srcPath, destPath);
    return NextResponse.json({ success: true, message: "Item copied successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "COPY_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
