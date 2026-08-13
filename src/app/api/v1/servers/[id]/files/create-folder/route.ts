import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { createServerFolder } from "@/lib/agent/engine";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { path } = body;

    if (!path) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Folder path required" } },
        { status: 400 }
      );
    }

    createServerFolder(id, path);
    return NextResponse.json({ success: true, message: "Folder created successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "FOLDER_CREATE_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
