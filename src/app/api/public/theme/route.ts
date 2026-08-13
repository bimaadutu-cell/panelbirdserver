import { NextResponse } from "next/server";
import { readThemeSettings } from "@/lib/theme-settings";

export async function GET() {
  return NextResponse.json({ success: true, data: readThemeSettings() });
}
