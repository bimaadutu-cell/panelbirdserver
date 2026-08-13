import { db } from "@/db";
import { servers } from "@/db/schema";
import { sql, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
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
  } catch {
    return Response.json({ status: "degraded", database: "disconnected" }, { status: 500 });
  }
}
