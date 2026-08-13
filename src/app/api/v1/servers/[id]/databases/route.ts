import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { db } from "@/db";
import { databases } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";
import { eq, and } from "drizzle-orm";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const list = await db.select().from(databases).where(eq(databases.serverId, id));
    return NextResponse.json({ success: true, data: list });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const body = await req.json();
    const { name } = body;
    const dbName = `s_${id.slice(-6)}_${name || "db"}`;
    const dbUser = `u_${cryptoRandomString(6)}`;
    const dbPassword = cryptoRandomString(16);
    const dbId = "sdb_" + cryptoRandomString(8);

    await db.insert(databases).values({
      id: dbId,
      serverId: id,
      dbName,
      dbUser,
      dbPassword,
      host: "127.0.0.1",
      port: 5432,
    });

    return NextResponse.json({ success: true, data: { id: dbId, dbName, dbUser, dbPassword, host: "127.0.0.1", port: 5432 } });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const dbId = searchParams.get("dbId");
    if (!dbId) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "dbId parameter required" } },
        { status: 400 }
      );
    }

    await db.delete(databases).where(and(eq(databases.id, dbId), eq(databases.serverId, id)));
    return NextResponse.json({ success: true, message: "Database deleted successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
