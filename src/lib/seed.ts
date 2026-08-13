import { db } from "@/db";
import { users, resellers, nodes, allocations, templates, packages, servers } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { generateServerIdentifier } from "@/lib/utils";
import { initializeServerFiles, DEFAULT_NODE_STARTUP_COMMAND, getDefaultServerEnv } from "@/lib/agent/engine";
import { eq } from "drizzle-orm";

export async function ensureSeedData() {
  try {
    const existingUsers = await db.select().from(users);
    if (existingUsers.length > 0) {
      return; // Already seeded
    }

    console.log("[Birdserver] Seeding initial production data...");

    // 1. Create Users
    const adminPassHash = await hashPassword("Admin123!");
    const resellerPassHash = await hashPassword("Reseller123!");
    const userPassHash = await hashPassword("User123!");

    const adminId = "usr_admin_01";
    const resellerUserId = "usr_reseller_01";
    const regularUserId = "usr_user_01";

    await db.insert(users).values([
      {
        id: adminId,
        email: "admin@birdserver.local",
        username: "admin",
        passwordHash: adminPassHash,
        role: "admin",
        status: "active",
        permissions: ["*"],
      },
      {
        id: resellerUserId,
        email: "reseller@birdserver.local",
        username: "reseller",
        passwordHash: resellerPassHash,
        role: "reseller",
        status: "active",
        permissions: ["reseller.manage"],
      },
      {
        id: regularUserId,
        email: "user@birdserver.local",
        username: "user",
        passwordHash: userPassHash,
        role: "user",
        status: "active",
        resellerId: resellerUserId,
        permissions: ["server.create", "server.console", "server.files"],
      },
    ]);

    // 2. Create Reseller Profile
    await db.insert(resellers).values({
      id: "res_01",
      userId: resellerUserId,
      balance: 1000000, // 1,000,000 IDR minor units
      ramLimitMb: 10240, // 10 GB
      cpuLimitPercent: 500, // 500%
      diskLimitMb: 102400, // 100 GB
      maxServers: 20,
      maxCustomers: 50,
    });

    // 3. Create Nodes
    const nodeId = "node_01";
    await db.insert(nodes).values([
      {
        id: "node_01",
        name: "Node 01 - Borealis Compute",
        description: "Primary Linux Execution Node",
        fqdnIp: "127.0.0.1",
        port: 8080,
        memoryMb: 65536,
        diskMb: 112640,
        cpuPercent: 1200,
        isEnabled: true,
        agentToken: "bs_agent_token_secret_998877",
        status: "online",
      },
      {
        id: "node_02",
        name: "Node 02 - Vega Hyper",
        description: "High frequency task node",
        fqdnIp: "127.0.0.1",
        port: 8081,
        memoryMb: 49152,
        diskMb: 112640,
        cpuPercent: 1000,
        isEnabled: true,
        agentToken: "bs_agent_token_secret_998878",
        status: "online",
      },
      {
        id: "node_03",
        name: "Node 03 - Orion Storage",
        description: "Large disk automation node",
        fqdnIp: "127.0.0.1",
        port: 8082,
        memoryMb: 65536,
        diskMb: 112640,
        cpuPercent: 1000,
        isEnabled: true,
        agentToken: "bs_agent_token_secret_998879",
        status: "online",
      },
      {
        id: "node_04",
        name: "Node 04 - Nova Digital",
        description: "Digital burst workload node",
        fqdnIp: "127.0.0.1",
        port: 8083,
        memoryMb: 32768,
        diskMb: 112640,
        cpuPercent: 900,
        isEnabled: true,
        agentToken: "bs_agent_token_secret_998880",
        status: "online",
      },
      {
        id: "node_05",
        name: "Node 05 - Quantum Edge",
        description: "Edge runtime node",
        fqdnIp: "127.0.0.1",
        port: 8084,
        memoryMb: 32768,
        diskMb: 112640,
        cpuPercent: 900,
        isEnabled: true,
        agentToken: "bs_agent_token_secret_998881",
        status: "online",
      },
    ]);

    // 4. Create Allocations
    const alloc1Id = "alloc_25565";
    await db.insert(allocations).values([
      {
        id: alloc1Id,
        nodeId,
        ip: "127.0.0.1",
        port: 25565,
        alias: "minecraft.birdserver.local",
        isAssigned: true,
      },
      {
        id: "alloc_3000",
        nodeId,
        ip: "127.0.0.1",
        port: 3000,
        alias: "app.birdserver.local",
        isAssigned: false,
      },
      {
        id: "alloc_8080",
        nodeId,
        ip: "127.0.0.1",
        port: 8080,
        alias: "api.birdserver.local",
        isAssigned: false,
      },
      {
        id: "alloc_8000",
        nodeId,
        ip: "127.0.0.1",
        port: 8000,
        alias: "python.birdserver.local",
        isAssigned: false,
      },
      {
        id: "alloc_25566",
        nodeId: "node_02",
        ip: "127.0.0.1",
        port: 25566,
        alias: "node2.birdserver.local",
        isAssigned: false,
      },
      {
        id: "alloc_25567",
        nodeId: "node_03",
        ip: "127.0.0.1",
        port: 25567,
        alias: "node3.birdserver.local",
        isAssigned: false,
      },
      {
        id: "alloc_25568",
        nodeId: "node_04",
        ip: "127.0.0.1",
        port: 25568,
        alias: "node4.birdserver.local",
        isAssigned: false,
      },
      {
        id: "alloc_25569",
        nodeId: "node_05",
        ip: "127.0.0.1",
        port: 25569,
        alias: "node5.birdserver.local",
        isAssigned: false,
      },
    ]);

    // 5. Create Templates (Eggs)
    const nodeEggId = "egg_nodejs";
    await db.insert(templates).values([
      {
        id: nodeEggId,
        name: "Node.js Application",
        category: "Node.js",
        dockerImage: "node:20-alpine",
        startupCmd: DEFAULT_NODE_STARTUP_COMMAND,
        description: "Standard Node.js runtime environment with Pterodactyl-style startup variables",
        defaultEnv: { ...getDefaultServerEnv("Node.js"), NODE_ENV: "production" },
      },
      {
        id: "egg_telegram",
        name: "Telegram Bot (Node.js)",
        category: "Telegram Bot",
        dockerImage: "node:20-alpine",
        startupCmd: DEFAULT_NODE_STARTUP_COMMAND,
        description: "Pre-configured environment for Telegram bots with real grammy runtime support",
        defaultEnv: { ...getDefaultServerEnv("Telegram Bot"), BOT_TOKEN: "" },
      },
      {
        id: "egg_whatsapp",
        name: "WhatsApp Bot (Baileys / WhatsApp-Web)",
        category: "WhatsApp Bot",
        dockerImage: "node:20-alpine",
        startupCmd: DEFAULT_NODE_STARTUP_COMMAND,
        description: "WhatsApp Bot environment with terminal QR output and persistent auth session folder",
        defaultEnv: { ...getDefaultServerEnv("WhatsApp Bot"), SESSION_NAME: "birdserver-wa-session" },
      },
      {
        id: "egg_python",
        name: "Python Application",
        category: "Python",
        dockerImage: "python:3.11-alpine",
        startupCmd: "python main.py",
        description: "Python 3.11 execution runtime for FastAPI, Flask, and scripts",
        defaultEnv: { PYTHONUNBUFFERED: "1" },
      },
      {
        id: "egg_generic",
        name: "Generic Shell Application",
        category: "Generic Application",
        dockerImage: "alpine:latest",
        startupCmd: "sh run.sh",
        description: "Lightweight shell script executor",
        defaultEnv: { RUN_ENV: "production" },
      },
    ]);

    // 6. Create Packages
    await db.insert(packages).values([
      {
        id: "pkg_basic",
        name: "BOT BASIC",
        memoryMb: 1024,
        cpuPercent: 100,
        diskMb: 5120,
        price: 50000, // 50,000 IDR
        durationDays: 30,
      },
      {
        id: "pkg_pro",
        name: "BOT PRO",
        memoryMb: 2048,
        cpuPercent: 200,
        diskMb: 10240,
        price: 100000, // 100,000 IDR
        durationDays: 30,
      },
      {
        id: "pkg_ultra",
        name: "BOT ULTRA",
        memoryMb: 4096,
        cpuPercent: 400,
        diskMb: 20480,
        price: 200000, // 200,000 IDR
        durationDays: 30,
      },
    ]);

    // 7. Create Demo Server
    const server1Id = "srv_demo_01";
    const identifier = generateServerIdentifier();

    await db.insert(servers).values({
      id: server1Id,
      identifier,
      name: "Demo Node.js Application",
      userId: adminId,
      resellerId: null,
      nodeId,
      allocationId: alloc1Id,
      templateId: nodeEggId,
      dockerImage: "node:20-alpine",
      startupCommand: DEFAULT_NODE_STARTUP_COMMAND,
      envVars: getDefaultServerEnv("Node.js"),
      memoryMb: 1024,
      cpuPercent: 100,
      diskMb: 5120,
      status: "stopped",
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // +30 days
    });

    // Initialize server files on disk
    initializeServerFiles(server1Id, "Node.js");

    console.log("[Birdserver] Seed completed successfully!");
  } catch (err) {
    console.error("[Birdserver] Seed error:", err);
  }
}
