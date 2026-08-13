import fs from "fs";
import path from "path";
import { getThemeMediaPath } from "@/lib/theme-settings";

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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  const { file } = await params;
  const safeFile = path.basename(file);
  const mediaPath = getThemeMediaPath(safeFile);

  if (!fs.existsSync(mediaPath)) {
    return new Response("Not Found", { status: 404 });
  }

  const ext = path.extname(mediaPath).toLowerCase();
  const contentType = contentTypeMap[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(mediaPath);

  return new Response(buffer, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=60",
    },
  });
}
