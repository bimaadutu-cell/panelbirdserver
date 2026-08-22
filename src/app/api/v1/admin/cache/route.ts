import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server-access";
import { cleanSafeCache, getCacheSummary } from "@/lib/agent/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getRequestSession(req);
  if (!session || session.role !== "admin") {
    return NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
      { status: 403 },
    );
  }
  return NextResponse.json({ success: true, data: getCacheSummary() });
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
    const body = await req.json().catch(() => ({}));
    const action = body.action as string;
    const mode = action === "clean_orphan" ? "orphan" : action === "clean_temp" ? "temp" : action === "clean_cache" ? "cache" : action === "clean_all" ? "all" : null;
    if (!mode) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_CACHE_ACTION", message: "Use clean_cache, clean_orphan, clean_temp, or clean_all." } },
        { status: 400 },
      );
    }
    const result = await cleanSafeCache(mode);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "CACHE_CLEAN_FAILED", message: error instanceof Error ? error.message : String(error) } },
      { status: 500 },
    );
  }
}
