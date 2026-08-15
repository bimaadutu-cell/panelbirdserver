import { NextResponse } from "next/server";
import { getSessionUser, authenticateApiKey } from "@/lib/auth";
import { db } from "@/db";
import { servers, subusers, nodes, allocations, templates, users } from "@/db/schema";
import { generateServerIdentifier, cryptoRandomString } from "@/lib/utils";
import { initializeServerFiles, getServerMetrics, DEFAULT_NODE_STARTUP_COMMAND, getDefaultServerEnv } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { ensureSeedData } from "@/lib/seed";

import { eq, or, inArray } from "drizzle-orm";
import { insertCompatibleServer } from "@/lib/legacy-db";

// In-memory Idempotency map
const processedIdempotencyKeys = new Map<string, any>();

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
    await ensureSeedData();
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }

    let serverList = [];

    if (session.role === "admin") {
      serverList = await db.select().from(servers);
    } else if (session.role === "reseller") {
      // Reseller sees servers owned by reseller or created for their customers
      const customers = await db.select({ id: users.id }).from(users).where(eq(users.resellerId, session.id));
      const customerIds = customers.map((c) => c.id);
      customerIds.push(session.id);

      serverList = await db
        .select()
        .from(servers)
        .where(or(eq(servers.resellerId, session.id), inArray(servers.userId, customerIds)));
    } else {
      // User sees servers they own OR subuser access
      const userSubuserAccess = await db
        .select({ serverId: subusers.serverId })
        .from(subusers)
        .where(eq(subusers.userId, session.id));
      const subServerIds = userSubuserAccess.map((s) => s.serverId);

      if (subServerIds.length > 0) {
        serverList = await db
          .select()
          .from(servers)
          .where(or(eq(servers.userId, session.id), inArray(servers.id, subServerIds)));
      } else {
        serverList = await db.select().from(servers).where(eq(servers.userId, session.id));
      }
    }

    const normalizedServers = serverList.map((server) => ({
      ...server,
      status: getServerMetrics(server.id).status,
    }));

    return NextResponse.json({ success: true, data: normalizedServers });
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
    await ensureSeedData();
    const session = await getAuthSession(req);
    if (!session) {
      return NextResponse.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
        { status: 401 }
      );
    }

    if (session.role !== "admin" && session.role !== "reseller") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Only admin and reseller can create servers directly" } },
        { status: 403 }
      );
    }

    // Idempotency Key check
    const idempotencyKey = req.headers.get("idempotency-key");
    if (idempotencyKey && processedIdempotencyKeys.has(idempotencyKey)) {
      return NextResponse.json(processedIdempotencyKeys.get(idempotencyKey));
    }

    const body = await req.json();
    const {
      name,
      userId = session.id,
      nodeId,
      templateId,
      memoryMb = 1024,
      cpuPercent = 100,
      diskMb = 5120,
      dockerImage,
      startupCommand,
      envVars = {},
    } = body;

    if (!name) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Server name is required" } },
        { status: 400 }
      );
    }


    // Select node
    let targetNodeId = nodeId;
    if (!targetNodeId) {
      const availableNode = await db.query.nodes.findFirst({
        where: eq(nodes.isEnabled, true),
      });
      if (!availableNode) {
        return NextResponse.json(
          { success: false, error: { code: "NO_NODES_AVAILABLE", message: "No active nodes available in cluster" } },
          { status: 500 }
        );
      }
      targetNodeId = availableNode.id;
    }

    // Select template / default specs
    let finalImage = dockerImage || "node:23-alpine";
    let finalStartup = startupCommand || DEFAULT_NODE_STARTUP_COMMAND;
    let templateCategory = "Node.js";
    let finalEnvVars: Record<string, string> = { ...envVars };

    if (templateId) {
      const tmpl = await db.query.templates.findFirst({
        where: eq(templates.id, templateId),
      });
      if (tmpl) {
        finalImage = dockerImage || tmpl.dockerImage;
        finalStartup = startupCommand || tmpl.startupCmd;
        templateCategory = tmpl.category;
        finalEnvVars = {
          ...getDefaultServerEnv(tmpl.category),
          ...((tmpl.defaultEnv as Record<string, string>) || {}),
          ...envVars,
        };
      }
    } else {
      finalEnvVars = {
        ...getDefaultServerEnv(templateCategory),
        ...envVars,
      };
    }

    // Select allocation
    const freeAlloc = await db.query.allocations.findFirst({
      where: eq(allocations.isAssigned, false),
    });

    const serverId = "srv_" + cryptoRandomString(12);
    const identifier = generateServerIdentifier();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const storedServerId = await insertCompatibleServer({
      id: serverId,
      identifier,
      name,
      userId: String(userId),
      resellerId: null,
      nodeId: String(targetNodeId),
      allocationId: freeAlloc ? freeAlloc.id : null,
      templateId: templateId || null,
      dockerImage: finalImage,
      startupCommand: finalStartup,
      workingDirectory: "/home/container",
      envVars: finalEnvVars,
      memoryMb: Number(memoryMb),
      cpuPercent: Number(cpuPercent),
      diskMb: Number(diskMb),
      status: "stopped",
      expiresAt,
    });
    if (freeAlloc) {
      await db
        .update(allocations)
        .set({ isAssigned: true, serverId: storedServerId })
        .where(eq(allocations.id, freeAlloc.id));
    }

    // Initialize server files on disk
    initializeServerFiles(storedServerId, templateCategory);

    await createAuditLog(session.id, "server.create", { serverId: storedServerId, name, userId });
    await dispatchWebhook("server.created", { serverId: storedServerId, name, userId });

    const responseData = {
      success: true,
      data: {
        id: storedServerId,
        identifier,
        name,
        userId,
        nodeId: targetNodeId,
        dockerImage: finalImage,
        startupCommand: finalStartup,
        memoryMb,
        cpuPercent,
        diskMb,
        status: "stopped",
      },
    };

    if (idempotencyKey) {
      processedIdempotencyKeys.set(idempotencyKey, responseData);
    }

    return NextResponse.json(responseData, { status: 201 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: errorMessage } },
      { status: 500 }
    );
  }
}
