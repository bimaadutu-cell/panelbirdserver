import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { ensureDatabaseReady } from "@/db/bootstrap";
import { serverJobs } from "@/db/schema";
import { authorizeServerRequest } from "@/lib/server-access";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureDatabaseReady();
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const jobs = await db.query.serverJobs.findMany({
      where: eq(serverJobs.serverId, id),
      orderBy: [desc(serverJobs.updatedAt)],
      limit: 30,
    });

    return NextResponse.json({ success: true, data: jobs });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "SERVER_JOBS_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 500 },
    );
  }
}
