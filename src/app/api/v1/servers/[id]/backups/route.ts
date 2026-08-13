import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { db } from "@/db";
import { backups } from "@/db/schema";
import { createServerBackup } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";
import { eq, and } from "drizzle-orm";
import fs from "fs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const backupList = await db.select().from(backups).where(eq(backups.serverId, id));
    return NextResponse.json({ success: true, data: backupList });
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

    const { session } = auth;
    const body = await req.json().catch(() => ({}));
    const { name } = body;

    const result = await createServerBackup(id, name);
    await createAuditLog(session.id, "backup.create", { serverId: id, backupId: result.backupId });

    return NextResponse.json({ success: true, data: result, message: "Backup created successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "BACKUP_FAILED", message: errorMessage } },
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

    const { session } = auth;
    const { searchParams } = new URL(req.url);
    const backupId = searchParams.get("backupId");

    if (!backupId) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "backupId parameter required" } },
        { status: 400 }
      );
    }

    const backupRecord = await db.query.backups.findFirst({
      where: and(eq(backups.id, backupId), eq(backups.serverId, id)),
    });

    if (backupRecord) {
      if (fs.existsSync(backupRecord.filePath)) fs.unlinkSync(backupRecord.filePath);
      await db.delete(backups).where(eq(backups.id, backupId));
    }

    await createAuditLog(session.id, "backup.delete", { serverId: id, backupId });
    return NextResponse.json({ success: true, message: "Backup deleted successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "BACKUP_DELETE_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
