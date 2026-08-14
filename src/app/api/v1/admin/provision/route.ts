import { NextResponse } from "next/server";
import { getRequestSession } from "@/lib/server-access";
import { ensureSeedData } from "@/lib/seed";
import { db } from "@/db";
import { users, resellers, servers, templates, nodes, allocations } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { cryptoRandomString, generateServerIdentifier } from "@/lib/utils";
import { DEFAULT_NODE_STARTUP_COMMAND, getDefaultServerEnv, initializeServerFiles } from "@/lib/agent/engine";
import { createAuditLog } from "@/lib/audit";
import { dispatchWebhook } from "@/lib/webhooks";
import { eq } from "drizzle-orm";

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
    // Provisioning must work from a clean Railway database too.
    // Seed only the application prerequisites; this is idempotent.
    await ensureSeedData();
    const session = await getRequestSession(req);
    if (!session || session.role !== "admin") {
      return NextResponse.json(
        { success: false, error: { code: "FORBIDDEN", message: "Admin access required" } },
        { status: 403 }
      );
    }

    const idempotencyKey = (req.headers.get("idempotency-key") || "").trim();
    if (idempotencyKey && provisionRequests.has(idempotencyKey)) {
      return NextResponse.json(provisionRequests.get(idempotencyKey));
    }

    const body = await req.json().catch(() => ({}));
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = ["user", "reseller", "admin"].includes(body.role) ? body.role : "user";
    const createServer = body.createServer !== false;

    if (!username || !email || !password) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Username, email, and password are required" } },
        { status: 400 }
      );
    }
    if (username.length < 3 || username.length > 64) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Username must be 3-64 characters" } },
        { status: 400 }
      );
    }
    if (password.length < 6) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_INPUT", message: "Password must be at least 6 characters" } },
        { status: 400 }
      );
    }

    // Check duplicates before creating anything. This makes both the manual UI
    // and API provisioning return a useful 409 instead of a generic 500.
    const duplicate = await db.query.users.findFirst({
      where: (u, { or, eq }) => or(eq(u.username, username), eq(u.email, email)),
    });
    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "USER_ALREADY_EXISTS",
            message: duplicate.username === username
              ? `Username "${username}" sudah digunakan`
              : `Email "${email}" sudah digunakan`,
          },
        },
        { status: 409 }
      );
    }

    let targetNodeId: string | null = null;
    let freeAlloc: typeof allocations.$inferSelect | null = null;
    let createdServer: Record<string, unknown> | null = null;
    const userId = "usr_" + cryptoRandomString(12);
    const passwordHash = await hashPassword(password);

    if (createServer) {
      const requestedNodeId = typeof body.nodeId === "string" && body.nodeId.trim()
        ? body.nodeId.trim()
        : null;

      if (requestedNodeId) {
        const node = await db.query.nodes.findFirst({
          where: eq(nodes.id, requestedNodeId),
        });
        if (!node || !node.isEnabled) {
          return NextResponse.json(
            { success: false, error: { code: "NODE_UNAVAILABLE", message: "Node yang dipilih tidak ditemukan atau sedang disabled" } },
            { status: 400 }
          );
        }
        targetNodeId = node.id;
      } else {
        const node = await db.query.nodes.findFirst({ where: eq(nodes.isEnabled, true) });
        if (!node) {
          return NextResponse.json(
            { success: false, error: { code: "NO_NODES_AVAILABLE", message: "Tidak ada node aktif. Tambahkan/aktifkan node terlebih dahulu." } },
            { status: 503 }
          );
        }
        targetNodeId = node.id;
      }

      freeAlloc = await db.query.allocations.findFirst({
        where: (a, { and, eq }) => and(eq(a.nodeId, targetNodeId!), eq(a.isAssigned, false)),
      }) || null;

      // If the node exists but has no free allocation, create a safe automatic
      // allocation instead of forcing the admin to configure a port manually.
      if (!freeAlloc) {
        const node = await db.query.nodes.findFirst({ where: eq(nodes.id, targetNodeId!) });
        if (!node) {
          return NextResponse.json(
            { success: false, error: { code: "NODE_UNAVAILABLE", message: "Node tidak ditemukan." } },
            { status: 400 }
          );
        }

        const usedPorts = await db.select({ port: allocations.port }).from(allocations).where(eq(allocations.nodeId, targetNodeId!));
        const used = new Set(usedPorts.map((row) => Number(row.port)));
        let port = 30000;
        while (used.has(port) && port < 60000) port += 1;
        if (port >= 60000) {
          return NextResponse.json(
            { success: false, error: { code: "NO_PORT_AVAILABLE", message: "Tidak ada port kosong yang dapat dibuat otomatis pada node ini." } },
            { status: 409 }
          );
        }

        const allocId = "alloc_" + cryptoRandomString(8);
        const inserted = await db.insert(allocations).values({
          id: allocId,
          nodeId: targetNodeId!,
          ip: node.fqdnIp || "127.0.0.1",
          port,
          alias: `${username}-${port}`,
          isAssigned: false,
        }).returning();
        freeAlloc = inserted[0] || null;
      }

      if (!freeAlloc) {
        return NextResponse.json(
          { success: false, error: { code: "NO_ALLOCATION_AVAILABLE", message: "Allocation otomatis gagal dibuat." } },
          { status: 409 }
        );
      }
    }

    const serverName = typeof body.serverName === "string" && body.serverName.trim()
      ? body.serverName.trim()
      : `${username}-server`;

    const rawMemoryMb = Number(body.memoryMb ?? 1024);
    const rawCpuPercent = Number(body.cpuPercent ?? 100);
    const rawDiskMb = Number(body.diskMb ?? 5120);

    if (![rawMemoryMb, rawCpuPercent, rawDiskMb].every((value) => Number.isFinite(value) && value > 0)) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_RESOURCES", message: "memoryMb, cpuPercent, dan diskMb harus berupa angka positif yang valid." } },
        { status: 400 }
      );
    }

    const memoryMb = Math.max(128, Math.floor(rawMemoryMb));
    const cpuPercent = Math.max(1, Math.floor(rawCpuPercent));
    const diskMb = Math.max(256, Math.floor(rawDiskMb));

    if (![memoryMb, cpuPercent, diskMb].every(Number.isFinite)) {
      return NextResponse.json(
        { success: false, error: { code: "INVALID_RESOURCES", message: "memoryMb, cpuPercent, dan diskMb harus berupa angka valid." } },
        { status: 400 }
      );
    }

    // One database transaction: an account is never left behind when server
    // creation fails. The server is initialized on disk only after commit.
    const result = await db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        username,
        email,
        passwordHash,
        role,
        status: "active",
        permissions: role === "admin"
          ? ["*"]
          : ["server.create", "server.console", "server.files"],
      });

      if (role === "reseller") {
        await tx.insert(resellers).values({
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

      if (!createServer) {
        return { server: null as Record<string, unknown> | null };
      }

      let finalImage = "node:20-alpine";
      let finalStartup = DEFAULT_NODE_STARTUP_COMMAND;
      let templateCategory = "Node.js";
      let finalEnvVars = getDefaultServerEnv("Node.js");
      const templateId = typeof body.templateId === "string" && body.templateId.trim()
        ? body.templateId.trim()
        : null;

      if (templateId) {
        const tmpl = await tx.query.templates.findFirst({ where: eq(templates.id, templateId) });
        if (!tmpl) throw new Error(`Template "${templateId}" tidak ditemukan`);
        finalImage = tmpl.dockerImage;
        finalStartup = tmpl.startupCmd;
        templateCategory = tmpl.category;
        finalEnvVars = {
          ...getDefaultServerEnv(tmpl.category),
          ...((tmpl.defaultEnv as Record<string, string>) || {}),
        };
      }

      const serverId = "srv_" + cryptoRandomString(12);
      const identifier = generateServerIdentifier();

      await tx.insert(servers).values({
        id: serverId,
        identifier,
        name: serverName,
        userId,
        resellerId: role === "reseller" ? userId : null,
        nodeId: targetNodeId!,
        allocationId: freeAlloc!.id,
        templateId,
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

      await tx.update(allocations)
        .set({ isAssigned: true, serverId })
        .where(eq(allocations.id, freeAlloc!.id));

      return {
        templateCategory,
        server: {
          id: serverId,
          identifier,
          name: serverName,
          nodeId: targetNodeId,
          templateId,
          memoryMb,
          cpuPercent,
          diskMb,
          status: "stopped",
        } as Record<string, unknown>,
      };
    });

    createdServer = result.server;
    if (createdServer) {
      initializeServerFiles(String(createdServer.id), String((result as any).templateCategory || "Node.js"));
      await dispatchWebhookSafe("server.created", {
        serverId: createdServer.id,
        name: createdServer.name,
        userId,
      });
    }

    await createAuditLog(session.id, "admin.provision", {
      userId, email, role, server: createdServer, via: req.headers.get("authorization") ? "api-key-or-bearer" : "session",
    });

    const response = {
      success: true,
      data: {
        user: { id: userId, username, email, role },
        server: createdServer,
      },
    };

    if (idempotencyKey) provisionRequests.set(idempotencyKey, response);
    return NextResponse.json(response, { status: 201 });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[BirdServer] provision error:", err);
    return NextResponse.json(
      { success: false, error: { code: "PROVISION_FAILED", message: errorMessage } },
      { status: 500 }
    );
  }
}

// Webhooks must never turn a successful DB provisioning into a failed request.
async function dispatchWebhookSafe(event: string, payload: Record<string, unknown>) {
  try {
    await dispatchWebhook(event, payload);
  } catch (error) {
    console.error("[BirdServer] webhook dispatch failed:", error);
  }
}
