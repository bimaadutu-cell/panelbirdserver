import { db, pool } from "@/db";
import { users, resellers, nodes, allocations, templates, packages, servers } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { generateServerIdentifier } from "@/lib/utils";
import { initializeServerFiles, DEFAULT_NODE_STARTUP_COMMAND, getDefaultServerEnv } from "@/lib/agent/engine";
import { ensureAuthDatabaseReady, ensureDatabaseReady } from "@/db/bootstrap";

type AuthSeedUser = {
  id: string;
  email: string;
  username: string;
  password: string;
  passwordHash: string;
  role: "admin" | "reseller" | "user";
  status: string;
  resellerId: string | null;
  permissions: string[];
};

async function getUsersTableMetadata() {
  const result = await pool.query<{
    column_name: string;
    data_type: string;
  }>(`
    select column_name, data_type
    from information_schema.columns
    where table_schema = 'public' and table_name = 'users'
  `);

  const idType = result.rows.find((row) => row.column_name === "id")?.data_type || "text";
  const hasLegacyPasswordColumn = result.rows.some((row) => row.column_name === "password");
  return { idType, hasLegacyPasswordColumn };
}

async function upsertAuthSeedUser(user: AuthSeedUser) {
  const metadata = await getUsersTableMetadata();
  const existing = await pool.query<{ id: string }>(
    `select id::text as id from users where email = $1 or username = $2 limit 1`,
    [user.email, user.username]
  );

  if (existing.rows[0]) {
    if (metadata.hasLegacyPasswordColumn) {
      await pool.query(
        `
          update users
          set email = $1,
              username = $2,
              password = $3,
              password_hash = $4,
              role = $5,
              status = $6,
              reseller_id = $7,
              permissions = $8::jsonb,
              updated_at = now()
          where id::text = $9
        `,
        [
          user.email,
          user.username,
          user.password,
          user.passwordHash,
          user.role,
          user.status,
          user.resellerId,
          JSON.stringify(user.permissions),
          existing.rows[0].id,
        ]
      );
    } else {
      await pool.query(
        `
          update users
          set email = $1,
              username = $2,
              password_hash = $3,
              role = $4,
              status = $5,
              reseller_id = $6,
              permissions = $7::jsonb,
              updated_at = now()
          where id::text = $8
        `,
        [
          user.email,
          user.username,
          user.passwordHash,
          user.role,
          user.status,
          user.resellerId,
          JSON.stringify(user.permissions),
          existing.rows[0].id,
        ]
      );
    }
    return;
  }

  if (metadata.idType === "integer") {
    if (metadata.hasLegacyPasswordColumn) {
      await pool.query(
        `
          insert into users (email, username, password, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())
        `,
        [
          user.email,
          user.username,
          user.password,
          user.passwordHash,
          user.role,
          user.status,
          user.resellerId,
          JSON.stringify(user.permissions),
        ]
      );
    } else {
      await pool.query(
        `
          insert into users (email, username, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())
        `,
        [
          user.email,
          user.username,
          user.passwordHash,
          user.role,
          user.status,
          user.resellerId,
          JSON.stringify(user.permissions),
        ]
      );
    }
  } else {
    if (metadata.hasLegacyPasswordColumn) {
      await pool.query(
        `
          insert into users (id, email, username, password, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now())
        `,
        [
          user.id,
          user.email,
          user.username,
          user.password,
          user.passwordHash,
          user.role,
          user.status,
          user.resellerId,
          JSON.stringify(user.permissions),
        ]
      );
    } else {
      await pool.query(
        `
          insert into users (id, email, username, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())
        `,
        [
          user.id,
          user.email,
          user.username,
          user.passwordHash,
          user.role,
          user.status,
          user.resellerId,
          JSON.stringify(user.permissions),
        ]
      );
    }
  }
}

export async function ensureAuthSeedData() {
  await ensureAuthDatabaseReady();

  const adminPassHash = await hashPassword("Admin123!");
  const resellerPassHash = await hashPassword("Reseller123!");
  const userPassHash = await hashPassword("User123!");

  const authUsers: AuthSeedUser[] = [
    {
      id: "usr_admin_01",
      email: "admin@birdserver.local",
      username: "admin",
      password: "Admin123!",
      passwordHash: adminPassHash,
      role: "admin",
      status: "active",
      resellerId: null,
      permissions: ["*"],
    },
    {
      id: "usr_reseller_01",
      email: "reseller@birdserver.local",
      username: "reseller",
      password: "Reseller123!",
      passwordHash: resellerPassHash,
      role: "reseller",
      status: "active",
      resellerId: null,
      permissions: ["reseller.manage"],
    },
    {
      id: "usr_user_01",
      email: "user@birdserver.local",
      username: "user",
      password: "User123!",
      passwordHash: userPassHash,
      role: "user",
      status: "active",
      resellerId: "usr_reseller_01",
      permissions: ["server.create", "server.console", "server.files"],
    },
  ];

  for (const item of authUsers) {
    await upsertAuthSeedUser(item);
  }
}

export async function ensureSeedData() {
  try {
    await ensureAuthSeedData();
    await ensureDatabaseReady();
    console.log("[Birdserver] Ensuring seed data...");

    // 2. Create Reseller Profile
    await db.insert(resellers).values({
      id: "res_01",
      userId: "usr_reseller_01",
      balance: 1000000,
      ramLimitMb: 10240,
      cpuLimitPercent: 500,
      diskLimitMb: 102400,
      maxServers: 20,
      maxCustomers: 50,
    }).onConflictDoNothing();

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
    ]).onConflictDoNothing();

    // 4. Create Allocations
    const alloc1Id = "alloc_25565";
    await db.insert(allocations).values([
      { id: alloc1Id, nodeId, ip: "127.0.0.1", port: 25565, alias: "minecraft.birdserver.local", isAssigned: true },
      { id: "alloc_3000", nodeId, ip: "127.0.0.1", port: 3000, alias: "app.birdserver.local", isAssigned: false },
      { id: "alloc_8080", nodeId, ip: "127.0.0.1", port: 8080, alias: "api.birdserver.local", isAssigned: false },
      { id: "alloc_8000", nodeId, ip: "127.0.0.1", port: 8000, alias: "python.birdserver.local", isAssigned: false },
      { id: "alloc_25566", nodeId: "node_02", ip: "127.0.0.1", port: 25566, alias: "node2.birdserver.local", isAssigned: false },
      { id: "alloc_25567", nodeId: "node_03", ip: "127.0.0.1", port: 25567, alias: "node3.birdserver.local", isAssigned: false },
      { id: "alloc_25568", nodeId: "node_04", ip: "127.0.0.1", port: 25568, alias: "node4.birdserver.local", isAssigned: false },
      { id: "alloc_25569", nodeId: "node_05", ip: "127.0.0.1", port: 25569, alias: "node5.birdserver.local", isAssigned: false },
    ]).onConflictDoNothing();

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
    ]).onConflictDoNothing();

    // 6. Create Packages
    await db.insert(packages).values([
      { id: "pkg_basic", name: "BOT BASIC", memoryMb: 1024, cpuPercent: 100, diskMb: 5120, price: 50000, durationDays: 30 },
      { id: "pkg_pro", name: "BOT PRO", memoryMb: 2048, cpuPercent: 200, diskMb: 10240, price: 100000, durationDays: 30 },
      { id: "pkg_ultra", name: "BOT ULTRA", memoryMb: 4096, cpuPercent: 400, diskMb: 20480, price: 200000, durationDays: 30 },
    ]).onConflictDoNothing();

    // 7. Create Demo Server
    const server1Id = "srv_demo_01";
    const identifier = generateServerIdentifier();
    await db.insert(servers).values({
      id: server1Id,
      identifier,
      name: "Demo Node.js Application",
      userId: "usr_admin_01",
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
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    }).onConflictDoNothing();

    initializeServerFiles(server1Id, "Node.js");
    console.log("[Birdserver] Seed completed successfully!");
  } catch (err) {
    console.error("[Birdserver] Seed error:", err);
    throw err;
  }
}
