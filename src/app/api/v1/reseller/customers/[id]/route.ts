import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey, hashPassword } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createAuditLog } from "@/lib/audit";
import { eq, and } from "drizzle-orm";

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  let session = await authenticateApiKey(authHeader);
  if (!session) {
    session = await getSessionUser();
  }
  return session;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAuthSession(req);
    if (!session || (session.role !== "reseller" && session.role !== "admin")) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Reseller access required" } },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await req.json();
    const { status, password } = body;

    const updates: Partial<typeof users.$inferInsert> = {};
    if (status) updates.status = status;
    if (password) updates.passwordHash = await hashPassword(password);

    await db
      .update(users)
      .set(updates)
      .where(and(eq(users.id, id), eq(users.resellerId, session.id)));

    await createAuditLog(session.id, "reseller.customer_update", { customerId: id, updates });

    return NextResponse.json({ success: true, message: "Customer updated successfully" });
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
    const session = await getAuthSession(req);
    if (!session || (session.role !== "reseller" && session.role !== "admin")) {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Reseller access required" } },
        { status: 403 }
      );
    }

    const { id } = await params;
    await db.delete(users).where(and(eq(users.id, id), eq(users.resellerId, session.id)));

    await createAuditLog(session.id, "reseller.customer_delete", { customerId: id });

    return NextResponse.json({ success: true, message: "Customer deleted successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
