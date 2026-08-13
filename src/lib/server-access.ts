import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, servers, subusers } from "@/db/schema";
import { authenticateApiKey, getSessionUser, UserSession } from "@/lib/auth";
import { eq, and } from "drizzle-orm";

export async function getRequestSession(req: Request): Promise<UserSession | null> {
  const authHeader = req.headers.get("authorization");
  let session = await authenticateApiKey(authHeader);
  if (!session) {
    session = await getSessionUser();
  }
  return session;
}

export async function authorizeServerRequest(req: Request, serverId: string) {
  const session = await getRequestSession(req);
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      ),
    };
  }

  const server = await db.query.servers.findFirst({ where: eq(servers.id, serverId) });
  if (!server) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: { code: "SERVER_NOT_FOUND", message: "Server not found" } },
        { status: 404 }
      ),
    };
  }

  if (session.role === "admin") {
    return { ok: true as const, session, server };
  }

  if (session.role === "reseller") {
    if (server.resellerId === session.id || server.userId === session.id) {
      return { ok: true as const, session, server };
    }

    const owner = await db.query.users.findFirst({ where: eq(users.id, server.userId) });
    if (owner?.resellerId === session.id) {
      return { ok: true as const, session, server };
    }

    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "You do not have access to this server" } },
        { status: 403 }
      ),
    };
  }

  if (server.userId === session.id) {
    return { ok: true as const, session, server };
  }

  const subuser = await db.query.subusers.findFirst({
    where: and(eq(subusers.serverId, serverId), eq(subusers.userId, session.id)),
  });

  if (subuser) {
    return { ok: true as const, session, server, subuser };
  }

  return {
    ok: false as const,
    response: NextResponse.json(
      { success: false, error: { code: "FORBIDDEN", message: "You do not have access to this server" } },
      { status: 403 }
    ),
  };
}
