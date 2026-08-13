import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server-access";
import { readThemeSettings, writeThemeSettings } from "@/lib/theme-settings";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true, data: readThemeSettings() });
}

export async function POST(req: Request) {
  const session = await getRequestSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 }
    );
  }

  const body = await req.json();
  const { preset, overlayOpacity } = body;
  const data = writeThemeSettings({ preset, overlayOpacity: Number(overlayOpacity) });
  return NextResponse.json({ success: true, data });
}
