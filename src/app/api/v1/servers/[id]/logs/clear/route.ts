import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { authorizeServerRequest } from "@/lib/server-access";
import { getServerConsolePaths } from "@/lib/agent/engine";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await authorizeServerRequest(req, id);
  if (!auth.ok) return auth.response;

  const { outputLogPath } = getServerConsolePaths(id);
  fs.mkdirSync(path.dirname(outputLogPath), { recursive: true });
  fs.writeFileSync(outputLogPath, "", "utf-8");

  return NextResponse.json({ success: true, message: "Console logs cleared successfully" });
}
