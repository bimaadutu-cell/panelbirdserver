import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server-access";
import { saveThemeMedia, writeThemeSettings } from "@/lib/theme-settings";

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_INPUT", message: "Media file required" } },
      { status: 400 }
    );
  }

  const allowed = ["image/", "video/"];
  if (!allowed.some((prefix) => file.type.startsWith(prefix))) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_MEDIA_TYPE", message: "Only image or video files are allowed" } },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const backgroundUrl = saveThemeMedia(file.name, bytes);
  const backgroundType = file.type.startsWith("video/") ? "video" : "image";
  const data = writeThemeSettings({ backgroundType, backgroundUrl });

  return NextResponse.json({ success: true, data });
}
