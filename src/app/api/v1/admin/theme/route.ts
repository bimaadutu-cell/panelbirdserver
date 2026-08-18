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
  const allowedPresets = new Set(["spidey-neon", "neon-grid", "aurora-digital", "sunset-cyber", "matrix-wave"]);
  const opacity = Number(overlayOpacity);

  if (typeof preset !== "string" || !allowedPresets.has(preset)) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_THEME", message: "Theme preset is not supported." } },
      { status: 400 }
    );
  }

  if (!Number.isFinite(opacity) || opacity < 0.2 || opacity > 0.9) {
    return NextResponse.json(
      { success: false, error: { code: "INVALID_OVERLAY", message: "Overlay opacity must be between 0.2 and 0.9." } },
      { status: 400 }
    );
  }

  const data = writeThemeSettings({ preset: preset as any, overlayOpacity: opacity });
  return NextResponse.json({ success: true, data });
}
