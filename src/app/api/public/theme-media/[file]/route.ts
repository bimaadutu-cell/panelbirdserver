import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getThemeMediaPath } from "@/lib/theme-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contentTypeMap: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function parseRange(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) return "invalid" as const;

  const requestedStart = match[1] ? Number(match[1]) : NaN;
  const requestedEnd = match[2] ? Number(match[2]) : NaN;
  let start = Number.isFinite(requestedStart) ? requestedStart : Math.max(0, size - requestedEnd);
  let end = Number.isFinite(requestedEnd) ? requestedEnd : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return "invalid" as const;
  end = Math.min(end, size - 1);
  return { start, end };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ file: string }> },
) {
  try {
    const { file } = await params;
    const safeFile = path.basename(file);
    const mediaPath = getThemeMediaPath(safeFile);
    if (!fs.existsSync(mediaPath)) return new Response("Not Found", { status: 404 });

    const stat = await fs.promises.stat(mediaPath);
    if (!stat.isFile()) return new Response("Not Found", { status: 404 });

    const ext = path.extname(mediaPath).toLowerCase();
    const contentType = contentTypeMap[ext] || "application/octet-stream";
    const range = parseRange(req.headers.get("range"), stat.size);
    const baseHeaders = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=3600, must-revalidate",
      "Content-Disposition": "inline",
    };

    if (range === "invalid") {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${stat.size}` },
      });
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    const stream = fs.createReadStream(mediaPath, { start, end });
    const body = Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
    const headers = {
      ...baseHeaders,
      "Content-Length": String(end - start + 1),
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
    };

    return new Response(body, { status: range ? 206 : 200, headers });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "THEME_MEDIA_READ_FAILED", message: error instanceof Error ? error.message : String(error) } },
      { status: 500 },
    );
  }
}
