import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { getSecurePath } from "@/lib/agent/engine";
import fs from "fs";
import path from "path";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const filePathRel = searchParams.get("path");

    if (!filePathRel) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "File path parameter required" } },
        { status: 400 }
      );
    }

    const fullPath = getSecurePath(id, filePathRel);
    if (!fs.existsSync(fullPath)) {
      return NextResponse.json(
        { success: false, error: { code: "FILE_NOT_FOUND", message: "File not found" } },
        { status: 404 }
      );
    }

    const fileBuffer = fs.readFileSync(fullPath);
    const fileName = path.basename(fullPath);
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "DOWNLOAD_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
