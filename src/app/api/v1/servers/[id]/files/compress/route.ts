import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { compressServerItems } from "@/lib/agent/engine";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { sources, archiveName = "archive.zip" } = body;

    if (!Array.isArray(sources) || sources.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Sources array required" } },
        { status: 400 }
      );
    }

    const archiveRelPath = await compressServerItems(id, sources, archiveName);
    return NextResponse.json({
      success: true,
      data: { archivePath: archiveRelPath },
      message: "Archive created successfully",
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "COMPRESS_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
