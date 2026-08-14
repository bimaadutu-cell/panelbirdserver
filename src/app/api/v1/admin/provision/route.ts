import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server-access";
import { db } from "@/db";
import { users, templates, nodes, allocations } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { cryptoRandomString, generateServerIdentifier } from "@/lib/utils";
import { DEFAULT_NODE_STARTUP_COMMAND, getDefaultServerEnv, initializeServerFiles } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";
import { eq, or } from "drizzle-orm";
import { insertCompatibleUser, insertCompatibleServer, insertCompatibleReseller } from "@/lib/legacy-db";
import { ensureDatabaseReady } from "@/db/bootstrap";

const provisionRequests = new Map<string, unknown>();

function getPublicBaseUrl(req: Request) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/$/, "");
  }

  const url = new URL(req.url);
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (forwardedHost) {
    return `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost}`;
  }
  return url.origin;
}

function getProvisionDocs(baseUrl: string) {
  return {
    success: true,
    data: {
      endpoint: `${baseUrl}/api/v1/admin/provision`,
      method: "POST",
      description: "Admin provisioning endpoint to create account + optional server in one request.",
      authentication: {
        sessionCookie: "birdserver_session",
        apiKey: "Authorization: Bearer bs_xxxxx",
        requiredRole: "admin",
      },
      supportedMethods: ["GET", "POST", "OPTIONS"],
      exampleHeaders: {
        "Content-Type": "application/json",
        "Idempotency-Key": "provision-123456",
        Authorization: "Bearer bs_xxxxxxxxxxxxxxxxx",
      },
      exampleBody: {
        username: "customerbaru",
        email: "customerbaru@example.com",
        password: "SecurePass123!",
        role: "user",
        createServer: true,
        serverName: "WhatsApp Bot Production",
        templateId: "egg_whatsapp",
        nodeId: "node_01",
        memoryMb: 2048,
        cpuPercent: 200,
        diskMb: 10240,
      },
      note: "Open this endpoint with GET for docs, but use POST to actually provision.",
    },
  };
}

export async function GET(req: Request) {
  const baseUrl = getPublicBaseUrl(req);
  return NextResponse.json(getProvisionDocs(baseUrl));
}

export async function OPTIONS(req: Request) {
  const baseUrl = getPublicBaseUrl(req);
  return NextResponse.json(getProvisionDocs(baseUrl), {
    headers: {
      Allow: "GET, POST, OPTIONS",
    },
  });
}

export async function POST(req: Request) {
  try {
    await ensureDatabaseReady();
    const session = await getRequestSession(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
        { status: 403 }
      );
    }

    const idempotencyKey = req.headers.get("idempotency-key");
    if (idempotencyKey && provisionRequests.has(idempotencyKey)) {
      return NextResponse.json(provisionRequests.get(idempotencyKey));
    }

    const body = await req.json();
    const {
      username,
      email,
      password,
      role = "user",
      createServer = true,
      serverName,
      templateId,
      nodeId,
      memoryMb = 1024,
      cpuPercent = 100,
      diskMb = 5120,
    } = body;

    if (!username || !email || !password) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Username, email, and password are required" } },
        { status: 400 }
      );
    }

    const existingUser = await db.query.users.findFirst({
      where: or(eq(users.email, email), eq(users.username, username)),
    });
    if (existingUser) {
      return NextResponse.json(
        { success: false, error: { code: "USER_EXISTS", message: "Username or email is already registered" } },
        { status: 409 }
      );
    }

    const requestedUserId = "usr_" + cryptoRandomString(12);
    const passwordHash = await hashPassword(password);
    const userId = await insertCompatibleUser({
      id: requestedUserId,
      username,
      email,
      passwordHash,
      password,
      role,
      status: "active",
      permissions: role === "admin" ? ["*"] : ["server.console", "server.files", "server.create"],
    });

    if (role === "reseller") {
      await insertCompatibleReseller({
        id: "res_" + cryptoRandomString(12),
        userId,
        balance: 0,
        ramLimitMb: 10240,
        cpuLimitPercent: 500,
        diskLimitMb: 102400,
        maxServers: 20,
        maxCustomers: 50,
      });
    }

    let createdServer: Record<string, unknown> | null = null;

    if (createServer) {
      let targetNodeId = nodeId;
      if (!targetNodeId) {
        const availableNode = await db.query.nodes.findFirst({ where: eq(nodes.isEnabled, true) });
        if (!availableNode) {
          throw new Error("No active nodes available");
        }
        targetNodeId = availableNode.id;
      }

      let finalImage = "node:23-alpine";
      let finalStartup = DEFAULT_NODE_STARTUP_COMMAND;
      let templateCategory = "Node.js";
      let finalEnvVars = getDefaultServerEnv("Node.js");

      if (templateId) {
        const tmpl = await db.query.templates.findFirst({ where: eq(templates.id, templateId) });
        if (tmpl) {
          finalImage = tmpl.dockerImage;
          finalStartup = tmpl.startupCmd;
          templateCategory = tmpl.category;
          finalEnvVars = {
            ...getDefaultServerEnv(tmpl.category),
            ...((tmpl.defaultEnv as Record<string, string>) || {}),
          };
        }
      }

      const freeAlloc = await db.query.allocations.findFirst({ where: eq(allocations.isAssigned, false) });
      const serverId = "srv_" + cryptoRandomString(12);
      const identifier = generateServerIdentifier();

      const storedServerId = await insertCompatibleServer({
        id: serverId,
        identifier,
        name: serverName || `${username}-server`,
        userId,
        resellerId: role === "reseller" ? userId : null,
        nodeId: targetNodeId,
        allocationId: freeAlloc?.id || null,
        templateId: templateId || null,
        dockerImage: finalImage,
        startupCommand: finalStartup,
        workingDirectory: "/home/container",
        envVars: finalEnvVars,
        memoryMb,
        cpuPercent,
        diskMb,
        status: "stopped",
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      if (freeAlloc) {
        await db.update(allocations).set({ isAssigned: true, serverId: storedServerId }).where(eq(allocations.id, freeAlloc.id));
      }

      initializeServerFiles(storedServerId, templateCategory);

      createdServer = {
        id: storedServerId,
        identifier,
        name: serverName || `${username}-server`,
        nodeId: targetNodeId,
        templateId: templateId || null,
      };
    }

    await createAuditLog(session.id, "admin.provision", { userId, email, role, server: createdServer });

    const response = {
      success: true,
      data: {
        user: { id: userId, username, email, role },
        server: createdServer,
      },
    };

    if (idempotencyKey) provisionRequests.set(idempotencyKey, response);
    return NextResponse.json(response);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: { code: "PROVISION_FAILED", message: errorMessage } }, { status: 500 });
  }
}
