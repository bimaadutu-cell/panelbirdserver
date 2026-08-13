import { db } from "@/db";
import { ensureDatabaseReady } from "@/db/bootstrap";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureDatabaseReady();
    await db.execute(sql`select 1`);
    return Response.json({ ready: true });
  } catch {
    return Response.json({ ready: false }, { status: 500 });
  }
}
