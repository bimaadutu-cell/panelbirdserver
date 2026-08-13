import { ensureDatabaseReady } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabaseReady();
    return Response.json({
      ready: true,
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Birdserver] readiness check failed:", error);
    return Response.json(
      {
        ready: false,
        database: "disconnected",
        code: "DATABASE_UNAVAILABLE",
        message:
          process.env.NODE_ENV === "production"
            ? "Database connection/bootstrap failed. Check Railway deployment logs."
            : error instanceof Error
              ? error.message
              : String(error),
      },
      { status: 503 }
    );
  }
}
