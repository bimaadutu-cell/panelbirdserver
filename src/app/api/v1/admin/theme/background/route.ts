import Busboy from "busboy";
import { Readable } from "stream";
import type { ReadableStream as NodeWebReadableStream } from "stream/web";
import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server-access";
import { MAX_THEME_MEDIA_BYTES, saveThemeMediaStream, writeThemeSettings } from "@/lib/theme-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseSize(value: string | null) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function streamMultipartUpload(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new Error("Content-Type must be multipart/form-data.");
  }

  const declaredLength = parseSize(req.headers.get("content-length"));
  if (declaredLength > MAX_THEME_MEDIA_BYTES + 1_048_576) {
    throw new Error("Media file exceeds the 2 GiB maximum size.");
  }
  if (!req.body) throw new Error("Upload body is empty.");

  return new Promise<{ fileName: string; mimeType: string; bytes: number; backgroundUrl: string }>((resolve, reject) => {
    let filePromise: Promise<{ backgroundUrl: string; bytes: number; extension: string }> | null = null;
    let fileName = "";
    let mimeType = "";
    let uploadError: Error | null = null;
    let fileSeen = false;

    const parser = Busboy({
      headers: { "content-type": contentType },
      limits: { files: 1, fileSize: MAX_THEME_MEDIA_BYTES + 1 },
    });

    parser.on("file", (_fieldName, file, info) => {
      fileSeen = true;
      fileName = info.filename || "background.bin";
      mimeType = info.mimeType || "application/octet-stream";
      if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
        uploadError = new Error("Only image or video files are allowed.");
        file.resume();
        return;
      }

      file.on("limit", () => {
        uploadError = new Error("Media file exceeds the 2 GiB maximum size.");
      });
      file.on("error", (error) => {
        uploadError = error instanceof Error ? error : new Error(String(error));
      });
      filePromise = saveThemeMediaStream(fileName, file).catch((error) => {
        uploadError = error instanceof Error ? error : new Error(String(error));
        throw error;
      });
    });

    parser.once("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
    parser.once("finish", async () => {
      try {
        const saved = filePromise ? await filePromise : null;
        if (uploadError) throw uploadError;
        if (!fileSeen || !saved) throw new Error("Media file required.");
        resolve({
          fileName,
          mimeType,
          bytes: saved.bytes,
          backgroundUrl: saved.backgroundUrl,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });

    Readable.fromWeb(req.body as unknown as NodeWebReadableStream).pipe(parser);
  });
}

export async function POST(req: Request) {
  try {
    const session = await getRequestSession(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
        { status: 403 },
      );
    }

    const upload = await streamMultipartUpload(req);
    const backgroundType = upload.mimeType.startsWith("video/") ? "video" : "image";
    const data = writeThemeSettings({
      backgroundType,
      backgroundUrl: upload.backgroundUrl,
    });

    return NextResponse.json({ success: true, data, bytes: upload.bytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /maximum size|2 GiB/i.test(message) ? 413 : /Content-Type|file required|allowed|empty/i.test(message) ? 400 : 500;
    return NextResponse.json(
      { success: false, error: { code: "THEME_MEDIA_UPLOAD_FAILED", message } },
      { status },
    );
  }
}
