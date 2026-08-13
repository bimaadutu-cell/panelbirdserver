import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { db } from "@/db";
import { subusers, users } from "@/db/schema";
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

    const subList = await db.select().from(subusers).where(eq(subusers.serverId, id));
    return NextResponse.json({ success: true, data: subList });
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
    const { email, permissions = [] } = body;
    if (!email) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "User email required" } },
        { status: 400 }
      );
    }

    const targetUser = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: { code: "USER_NOT_FOUND", message: "User with this email not found" } },
        { status: 404 }
      );
    }

    const subId = "sub_" + cryptoRandomString(8);
    await db.insert(subusers).values({ id: subId, serverId: id, userId: targetUser.id, permissions });
    return NextResponse.json({ success: true, message: "Subuser added successfully" });
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
    const subId = searchParams.get("subId");
    if (!subId) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "subId required" } },
        { status: 400 }
      );
    }

    await db.delete(subusers).where(and(eq(subusers.id, subId), eq(subusers.serverId, id)));
    return NextResponse.json({ success: true, message: "Subuser removed successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
