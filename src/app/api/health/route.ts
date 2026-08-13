import { db } from "@/db";
import { ensureDatabaseReady } from "@/db/bootstrap";
import { servers } from "@/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabaseReady();
    await db.execute(sql`select 1`);
    const allServers = await db.select().from(servers);
    const runningCount = allServers.filter((server) => server.status === "running").length;

    return Response.json({
      status: "online",
      database: "connected",
      agent: "active",
      activeContainersCount: runningCount,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Birdserver] health check degraded:", error);
    return Response.json(
      {
        status: "degraded",
        database: "disconnected",
        agent: "active",
        activeContainersCount: 0,
        code: "DATABASE_UNAVAILABLE",
        message:
          process.env.NODE_ENV === "production"
            ? "Database connection/bootstrap failed. Check Railway deployment logs."
            : error instanceof Error
              ? error.message
              : String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
