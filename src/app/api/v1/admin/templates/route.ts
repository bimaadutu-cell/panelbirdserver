import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { db } from "@/db";
import { templates } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";

async function getAuthSession(req: Request) {
  const authHeader = req.headers.get("authorization");
  let session = await authenticateApiKey(authHeader);
  if (!session) {
    session = await getSessionUser();
  }
  return session;
}

export async function GET(req: Request) {
  try {
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }

    const tmplList = await db.select().from(templates);
    return NextResponse.json({ success: true, data: tmplList });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getAuthSession(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { name, category, dockerImage, startupCmd, description, defaultEnv } = body;

    if (!name || !category || !dockerImage || !startupCmd) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Missing required egg/template parameters" } },
        { status: 400 }
      );
    }

    const tmplId = "egg_" + cryptoRandomString(8);
    await db.insert(templates).values({
      id: tmplId,
      name,
      category,
      dockerImage,
      startupCmd,
      description,
      defaultEnv: defaultEnv || {},
    });

    return NextResponse.json({ success: true, message: "Egg Template created successfully" });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
