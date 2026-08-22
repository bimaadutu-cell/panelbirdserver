import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { authorizeServerRequest } from "@/lib/server-access";
import { getServerMetrics } from "@/lib/agent/engine";
import { servers } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const metrics = getServerMetrics(id);
    const limits = {
      cpuPercent: auth.server.cpuPercent,
      memoryBytes: auth.server.memoryMb * 1024 * 1024,
      diskBytes: auth.server.diskMb * 1024 * 1024,
    };
    const data = {
      ...metrics,
      limits,
      memoryPercent: limits.memoryBytes > 0 ? Math.min(100, (metrics.memoryBytes / limits.memoryBytes) * 100) : null,
      diskPercent: limits.diskBytes > 0 ? Math.min(100, (metrics.diskBytes / limits.diskBytes) * 100) : null,
      resourceScope: "server-process-on-host",
    };

    if (auth.server.status !== metrics.status) {
      await db.update(servers).set({
        status: metrics.status,
        pid: metrics.status === "stopped" ? 0 : auth.server.pid,
        updatedAt: new Date(),
      }).where(eq(servers.id, id)).catch(() => undefined);
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: { code: "METRICS_FAILED", message: error instanceof Error ? error.message : String(error) } },
      { status: 500 },
    );
  }
}
