import { db, pool } from "@/db";
import { users, resellers, allocations, templates, packages } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { generateServerIdentifier } from "@/lib/utils";
import { initializeServerFiles, DEFAULT_NODE_STARTUP_COMMAND, getDefaultServerEnv } from "@/lib/agent/engine";
import { ensureAuthDatabaseReady, ensureDatabaseReady } from "@/db/bootstrap";
import { eq, or } from "drizzle-orm";

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
  const result = await pool.query<{ column_name: string; data_type: string }>(`
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
        `update users
         set email = $1, username = $2, password = $3, password_hash = $4, role = $5, status = $6,
             reseller_id = $7, permissions = $8::jsonb, updated_at = now()
         where id::text = $9`,
        [user.email, user.username, user.password, user.passwordHash, user.role, user.status, user.resellerId, JSON.stringify(user.permissions), existing.rows[0].id]
      );
    } else {
      await pool.query(
        `update users
         set email = $1, username = $2, password_hash = $3, role = $4, status = $5,
             reseller_id = $6, permissions = $7::jsonb, updated_at = now()
         where id::text = $8`,
        [user.email, user.username, user.passwordHash, user.role, user.status, user.resellerId, JSON.stringify(user.permissions), existing.rows[0].id]
      );
    }
    return;
  }

  if (metadata.idType === "integer") {
    if (metadata.hasLegacyPasswordColumn) {
      await pool.query(
        `insert into users (email, username, password, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())`,
        [user.email, user.username, user.password, user.passwordHash, user.role, user.status, user.resellerId, JSON.stringify(user.permissions)]
      );
    } else {
      await pool.query(
        `insert into users (email, username, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, now(), now())`,
        [user.email, user.username, user.passwordHash, user.role, user.status, user.resellerId, JSON.stringify(user.permissions)]
      );
    }
  } else {
    if (metadata.hasLegacyPasswordColumn) {
      await pool.query(
        `insert into users (id, email, username, password, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now())`,
        [user.id, user.email, user.username, user.password, user.passwordHash, user.role, user.status, user.resellerId, JSON.stringify(user.permissions)]
      );
    } else {
      await pool.query(
        `insert into users (id, email, username, password_hash, role, status, reseller_id, permissions, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, now(), now())`,
        [user.id, user.email, user.username, user.passwordHash, user.role, user.status, user.resellerId, JSON.stringify(user.permissions)]
      );
    }
  }
}

async function getColumnNames(tableName: string) {
  const result = await pool.query<{ column_name: string; udt_name?: string }>(
    `select column_name, udt_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [tableName]
  );
  return result.rows;
}

async function ensureLegacyCompatibleNodes() {
  const columnRows = await getColumnNames("nodes");
  const columns = new Set(columnRows.map((row) => row.column_name));
  const statusEnum = columnRows.find((row) => row.column_name === "status")?.udt_name === "node_status";
  const statusValue = statusEnum ? "ONLINE" : "online";

  const nodeRows = [
    ["node_01", "Node 01 - Borealis Compute", "Primary Linux Execution Node", "127.0.0.1", 8080, 65536, 112640, 1200, true, "bs_agent_token_secret_998877", statusValue],
    ["node_02", "Node 02 - Vega Hyper", "High frequency task node", "127.0.0.1", 8081, 49152, 112640, 1000, true, "bs_agent_token_secret_998878", statusValue],
    ["node_03", "Node 03 - Orion Storage", "Large disk automation node", "127.0.0.1", 8082, 65536, 112640, 1000, true, "bs_agent_token_secret_998879", statusValue],
    ["node_04", "Node 04 - Nova Digital", "Digital burst workload node", "127.0.0.1", 8083, 32768, 112640, 900, true, "bs_agent_token_secret_998880", statusValue],
    ["node_05", "Node 05 - Quantum Edge", "Edge runtime node", "127.0.0.1", 8084, 32768, 112640, 900, true, "bs_agent_token_secret_998881", statusValue],
  ];

  for (const row of nodeRows) {
    const [id, name, description, fqdnIp, port, memoryMb, diskMb, cpuPercent, isEnabled, agentToken, status] = row;
    const hasExisting = await pool.query(`select 1 from nodes where id = $1 limit 1`, [id]);
    if (hasExisting.rowCount && hasExisting.rowCount > 0) continue;

    const fields = ["id", "name"];
    const values: unknown[] = [id, name];
    const push = (field: string, value: unknown) => {
      fields.push(field);
      values.push(value);
    };

    if (columns.has("description")) push("description", description);
    if (columns.has("fqdn_ip")) push("fqdn_ip", fqdnIp);
    if (columns.has("fqdn")) push("fqdn", fqdnIp);
    if (columns.has("port")) push("port", port);
    if (columns.has("memory_mb")) push("memory_mb", memoryMb);
    if (columns.has("disk_mb")) push("disk_mb", diskMb);
    if (columns.has("cpu_percent")) push("cpu_percent", cpuPercent);
    if (columns.has("is_enabled")) push("is_enabled", isEnabled);
    if (columns.has("agent_token")) push("agent_token", agentToken);
    if (columns.has("auth_token")) push("auth_token", agentToken);
    if (columns.has("status")) push("status", status);
    if (columns.has("total_ram_mb")) push("total_ram_mb", memoryMb);
    if (columns.has("total_storage_mb")) push("total_storage_mb", diskMb);
    if (columns.has("total_cpu_percent")) push("total_cpu_percent", cpuPercent);
    if (columns.has("used_ram_mb")) push("used_ram_mb", 0);
    if (columns.has("used_storage_mb")) push("used_storage_mb", 0);
    if (columns.has("used_cpu_percent")) push("used_cpu_percent", 0);
    if (columns.has("docker_socket")) push("docker_socket", "/var/run/docker.sock");

    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await pool.query(`insert into nodes (${fields.join(", ")}) values (${placeholders})`, values);
  }
}

async function ensureDemoServerCompat() {
  const serverId = "srv_demo_01";
  const existing = await pool.query(`select 1 from servers where id = $1 limit 1`, [serverId]);
  if (existing.rowCount && existing.rowCount > 0) return;

  const columnRows = await getColumnNames("servers");
  const columns = new Set(columnRows.map((row) => row.column_name));
  const statusEnum = columnRows.find((row) => row.column_name === "status")?.udt_name === "server_status";
  const statusValue = statusEnum ? "STOPPED" : "stopped";
  const identifier = generateServerIdentifier();

  const fields = ["id", "name"];
  const values: unknown[] = [serverId, "Demo Node.js Application"];
  const push = (field: string, value: unknown) => {
    fields.push(field);
    values.push(value);
  };

  if (columns.has("identifier")) push("identifier", identifier);
  if (columns.has("user_id")) push("user_id", "1");
  if (columns.has("owner_id")) push("owner_id", "1");
  if (columns.has("reseller_id")) push("reseller_id", null);
  if (columns.has("node_id")) push("node_id", "node_01");
  if (columns.has("allocation_id")) push("allocation_id", "alloc_25565");
  if (columns.has("template_id")) push("template_id", "egg_nodejs");
  if (columns.has("docker_image")) push("docker_image", "node:20-alpine");
  if (columns.has("startup_command")) push("startup_command", DEFAULT_NODE_STARTUP_COMMAND);
  if (columns.has("working_directory")) push("working_directory", "/home/container");
  if (columns.has("env_vars")) push("env_vars", JSON.stringify(getDefaultServerEnv("Node.js")));
  if (columns.has("memory_mb")) push("memory_mb", 1024);
  if (columns.has("ram_mb")) push("ram_mb", 1024);
  if (columns.has("cpu_percent")) push("cpu_percent", 100);
  if (columns.has("disk_mb")) push("disk_mb", 5120);
  if (columns.has("storage_mb")) push("storage_mb", 5120);
  if (columns.has("status")) push("status", statusValue);
  if (columns.has("expires_at")) push("expires_at", new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

  const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
  await pool.query(`insert into servers (${fields.join(", ")}) values (${placeholders})`, values);
  initializeServerFiles(serverId, "Node.js");
}

export async function ensureAuthSeedData() {
  await ensureAuthDatabaseReady();

  const adminPassHash = await hashPassword("Admin123!");
  const resellerPassHash = await hashPassword("Reseller123!");
  const userPassHash = await hashPassword("User123!");

  const authUsers: AuthSeedUser[] = [
    { id: "usr_admin_01", email: "admin@birdserver.local", username: "admin", password: "Admin123!", passwordHash: adminPassHash, role: "admin", status: "active", resellerId: null, permissions: ["*"] },
    { id: "usr_reseller_01", email: "reseller@birdserver.local", username: "reseller", password: "Reseller123!", passwordHash: resellerPassHash, role: "reseller", status: "active", resellerId: null, permissions: ["reseller.manage"] },
    { id: "usr_user_01", email: "user@birdserver.local", username: "user", password: "User123!", passwordHash: userPassHash, role: "user", status: "active", resellerId: "usr_reseller_01", permissions: ["server.create", "server.console", "server.files"] },
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

    await ensureLegacyCompatibleNodes();

    const nodeId = "node_01";
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

    const nodeEggId = "egg_nodejs";
    await db.insert(templates).values([
      { id: nodeEggId, name: "Node.js Application", category: "Node.js", dockerImage: "node:20-alpine", startupCmd: DEFAULT_NODE_STARTUP_COMMAND, description: "Standard Node.js runtime environment with Pterodactyl-style startup variables", defaultEnv: { ...getDefaultServerEnv("Node.js"), NODE_ENV: "production" } },
      { id: "egg_telegram", name: "Telegram Bot (Node.js)", category: "Telegram Bot", dockerImage: "node:20-alpine", startupCmd: DEFAULT_NODE_STARTUP_COMMAND, description: "Pre-configured environment for Telegram bots with real grammy runtime support", defaultEnv: { ...getDefaultServerEnv("Telegram Bot"), BOT_TOKEN: "" } },
      { id: "egg_whatsapp", name: "WhatsApp Bot (Baileys / WhatsApp-Web)", category: "WhatsApp Bot", dockerImage: "node:20-alpine", startupCmd: DEFAULT_NODE_STARTUP_COMMAND, description: "WhatsApp Bot environment with terminal QR output and persistent auth session folder", defaultEnv: { ...getDefaultServerEnv("WhatsApp Bot"), SESSION_NAME: "birdserver-wa-session" } },
      { id: "egg_python", name: "Python Application", category: "Python", dockerImage: "python:3.11-alpine", startupCmd: "python main.py", description: "Python 3.11 execution runtime for FastAPI, Flask, and scripts", defaultEnv: { PYTHONUNBUFFERED: "1" } },
      { id: "egg_generic", name: "Generic Shell Application", category: "Generic Application", dockerImage: "alpine:latest", startupCmd: "sh run.sh", description: "Lightweight shell script executor", defaultEnv: { RUN_ENV: "production" } },
    ]).onConflictDoNothing();

    await db.insert(packages).values([
      { id: "pkg_basic", name: "BOT BASIC", memoryMb: 1024, cpuPercent: 100, diskMb: 5120, price: 50000, durationDays: 30 },
      { id: "pkg_pro", name: "BOT PRO", memoryMb: 2048, cpuPercent: 200, diskMb: 10240, price: 100000, durationDays: 30 },
      { id: "pkg_ultra", name: "BOT ULTRA", memoryMb: 4096, cpuPercent: 400, diskMb: 20480, price: 200000, durationDays: 30 },
    ]).onConflictDoNothing();

    try {
      await ensureDemoServerCompat();
    } catch (error) {
      console.error("[Birdserver] demo server seed skipped:", error);
    }

    console.log("[Birdserver] Seed completed successfully!");
  } catch (err) {
    console.error("[Birdserver] Seed error:", err);
    throw err;
  }
}
