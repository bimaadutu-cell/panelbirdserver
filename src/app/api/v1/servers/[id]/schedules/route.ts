import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { db } from "@/db";
import { schedules } from "@/db/schema";
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

    const list = await db.select().from(schedules).where(eq(schedules.serverId, id));
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
    const { name, cronExpression, actionType, payload } = body;

    if (!name || !cronExpression || !actionType) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Name, cronExpression and actionType required" } },
        { status: 400 }
      );
    }

    const schedId = "sch_" + cryptoRandomString(8);
    await db.insert(schedules).values({
      id: schedId,
      serverId: id,
      name,
      cronExpression,
      actionType,
      payload,
      isActive: true,
    });

    return NextResponse.json({ success: true, message: "Schedule created successfully" });
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
    const schedId = searchParams.get("schedId");
    if (!schedId) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "schedId required" } },
        { status: 400 }
      );
    }

    await db.delete(schedules).where(and(eq(schedules.id, schedId), eq(schedules.serverId, id)));
    return NextResponse.json({ success: true, message: "Schedule deleted successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
