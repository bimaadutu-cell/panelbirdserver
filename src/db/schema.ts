import { pgTable, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("user"), // 'admin' | 'reseller' | 'user'
  status: text("status").notNull().default("active"), // 'active' | 'suspended'
  resellerId: text("reseller_id"), // null if not under a reseller
  permissions: jsonb("permissions").$type<string[]>().default([]),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  twoFactorSecret: text("two_factor_secret"),
  recoveryCodes: jsonb("recovery_codes").$type<string[]>().default([]),
  avatar: text("avatar"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const resellers = pgTable("resellers", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  balance: integer("balance").notNull().default(0), // Integer minor units (e.g. Cents or IDR)
  ramLimitMb: integer("ram_limit_mb").notNull().default(10240), // e.g. 10GB
  cpuLimitPercent: integer("cpu_limit_percent").notNull().default(500), // e.g. 500%
  diskLimitMb: integer("disk_limit_mb").notNull().default(102400), // e.g. 100GB
  maxServers: integer("max_servers").notNull().default(20),
  maxCustomers: integer("max_customers").notNull().default(50),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const nodes = pgTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  fqdnIp: text("fqdn_ip").notNull(),
  port: integer("port").notNull().default(8080),
  memoryMb: integer("memory_mb").notNull().default(32768),
  diskMb: integer("disk_mb").notNull().default(512000),
  cpuPercent: integer("cpu_percent").notNull().default(800),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  agentToken: text("agent_token").notNull(),
  status: text("status").notNull().default("online"), // 'online' | 'offline'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const allocations = pgTable("allocations", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  ip: text("ip").notNull(),
  port: integer("port").notNull(),
  alias: text("alias"),
  isAssigned: boolean("is_assigned").default(false).notNull(),
  serverId: text("server_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const templates = pgTable("templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // Node.js, Python, PHP, Java, Telegram Bot, WhatsApp Bot, Discord Bot, Generic
  dockerImage: text("docker_image").notNull(),
  startupCmd: text("startup_cmd").notNull(),
  description: text("description"),
  defaultEnv: jsonb("default_env").$type<Record<string, string>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const servers = pgTable("servers", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(), // Short 8-char code
  name: text("name").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  resellerId: text("reseller_id").references(() => users.id, { onDelete: "set null" }),
  nodeId: text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  allocationId: text("allocation_id").references(() => allocations.id, { onDelete: "set null" }),
  templateId: text("template_id").references(() => templates.id, { onDelete: "set null" }),
  dockerImage: text("docker_image").notNull(),
  startupCommand: text("startup_command").notNull(),
  workingDirectory: text("working_directory").default("/app"),
  envVars: jsonb("env_vars").$type<Record<string, string>>().default({}),
  memoryMb: integer("memory_mb").notNull().default(1024),
  cpuPercent: integer("cpu_percent").notNull().default(100),
  diskMb: integer("disk_mb").notNull().default(5120),
  status: text("status").notNull().default("stopped"), // 'running' | 'stopped' | 'starting' | 'stopping' | 'suspended' | 'error'
  pid: integer("pid"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const subusers = pgTable("subusers", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  expiresAt: timestamp("expires_at"),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const backups = pgTable("backups", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  isSuccessful: boolean("is_successful").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const schedules = pgTable("schedules", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cronExpression: text("cron_expression").notNull(),
  actionType: text("action_type").notNull(), // 'command' | 'power' | 'backup'
  payload: text("payload"),
  isActive: boolean("is_active").default(true).notNull(),
  lastRunAt: timestamp("last_run_at"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const packages = pgTable("packages", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  memoryMb: integer("memory_mb").notNull(),
  cpuPercent: integer("cpu_percent").notNull(),
  diskMb: integer("disk_mb").notNull(),
  price: integer("price").notNull(), // Minor units (e.g. Rp 50,000 = 50000)
  durationDays: integer("duration_days").notNull().default(30),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: text("id").primaryKey(),
  resellerId: text("reseller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  customerId: text("customer_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  packageId: text("package_id").references(() => packages.id, { onDelete: "set null" }),
  serverId: text("server_id").references(() => servers.id, { onDelete: "set null" }),
  amount: integer("amount").notNull(),
  durationDays: integer("duration_days").notNull().default(30),
  status: text("status").notNull().default("pending"), // 'pending' | 'paid' | 'provisioning' | 'active' | 'expired' | 'cancelled' | 'failed'
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  resellerId: text("reseller_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // 'topup' | 'deduction' | 'refund' | 'order_payment'
  amount: integer("amount").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const databases = pgTable("databases", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  dbName: text("db_name").notNull(),
  dbUser: text("db_user").notNull(),
  dbPassword: text("db_password").notNull(),
  host: text("host").notNull().default("127.0.0.1"),
  port: integer("port").notNull().default(5432),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const webhooks = pgTable("webhooks", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").$type<string[]>().default([]),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const serverJobs = pgTable("server_jobs", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull().references(() => servers.id, { onDelete: "cascade" }),
  ownerId: text("owner_id"),
  kind: text("kind").notNull(), // 'install' | 'extract' | 'backup' | 'restore' | 'cleanup'
  status: text("status").notNull().default("queued"), // queued | running | succeeded | failed | cancelled
  phase: text("phase").notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  pid: integer("pid"),
  command: text("command"),
  lastOutput: text("last_output"),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  cancelledAt: timestamp("cancelled_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  action: text("action").notNull(),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
