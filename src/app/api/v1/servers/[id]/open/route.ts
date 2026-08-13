import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { inspectProjectDirectory } from "@/lib/agent/engine";
import { db } from "@/db";
import { servers } from "@/db/schema";
import { createAuditLog } from "@/lib/audit";
import { eq } from "drizzle-orm";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeServerRequest(req, id);
    if (!auth.ok) return auth.response;

    const { session, server } = auth;
    const body = await req.json().catch(() => ({}));
    const relPath = typeof body.path === "string" ? body.path : "";

    const project = inspectProjectDirectory(id, relPath);
    const mergedEnv = {
      ...((server.envVars as Record<string, string>) || {}),
      MAIN_FILE: project.mainFile,
    };

    await db
      .update(servers)
      .set({
        workingDirectory: project.containerPath,
        envVars: mergedEnv,
        updatedAt: new Date(),
      })
      .where(eq(servers.id, id));

    await createAuditLog(session.id, "server.open_project_root", {
      serverId: id,
      path: relPath,
      workingDirectory: project.containerPath,
      mainFile: project.mainFile,
    });

    return NextResponse.json({
      success: true,
      message: "Folder opened as project root successfully",
      data: {
        path: relPath,
        workingDirectory: project.containerPath,
        mainFile: project.mainFile,
        hasPackageJson: project.hasPackageJson,
      },
    });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "OPEN_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}
