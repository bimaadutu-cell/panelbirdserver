import { db } from "@/db";
import { ensureDatabaseReady } from "@/db/bootstrap";
import { servers } from "@/db/schema";
import { getServerMetrics } from "@/lib/agent/engine";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabaseReady();
    await db.execute(sql`select 1`);
    const allServers = await db.select().from(servers);
    const runningCount = allServers.reduce((count, server) => count + (getServerMetrics(server.id).status === "running" ? 1 : 0), 0);

    return Response.json({
      status: "online",
      database: "connected",
      agent: "active",
      activeContainersCount: runningCount,
      activeRuntimesCount: runningCount,
      runtimeScope: "host-process",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Birdserver] health check degraded:", error);
    return Response.json(
      {
        status: "degraded",
        database: "disconnected",
        agent: "degraded",
        activeContainersCount: 0,
        activeRuntimesCount: 0,
        runtimeScope: "host-process",
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }
}
