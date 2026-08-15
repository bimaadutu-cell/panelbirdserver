import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { getSecurePath } from "@/lib/agent/engine";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const formData = await req.formData();
    const directory = (formData.get("directory") as string) || "";
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "No files uploaded" } },
        { status: 400 }
      );
    }

    for (const file of files) {
      const targetPath = getSecurePath(id, path.join(directory, file.name));
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      await pipeline(
        Readable.fromWeb(file.stream() as any),
        fs.createWriteStream(targetPath)
      );
    }

    return NextResponse.json({ success: true, message: `${files.length} file(s) uploaded successfully` });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "UPLOAD_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
