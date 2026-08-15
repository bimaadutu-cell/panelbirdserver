import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { getSecurePath } from "@/lib/agent/engine";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

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

    const stat = fs.statSync(fullPath);
    const fileName = path.basename(fullPath);
    const stream = Readable.toWeb(fs.createReadStream(fullPath)) as unknown as ReadableStream<Uint8Array>;

    return new Response(stream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
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
