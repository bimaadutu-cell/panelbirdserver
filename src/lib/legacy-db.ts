import { pool } from "@/db";

export type ColumnMeta = {
  column_name: string;
  data_type: string;
  udt_name: string | null;
  is_nullable: string;
  column_default: string | null;
};

export async function getTableColumns(tableName: string): Promise<Map<string, ColumnMeta>> {
  const result = await pool.query<ColumnMeta>(
    `select column_name, data_type, udt_name, is_nullable, column_default
     from information_schema.columns
     where table_schema='public' and table_name=$1`,
    [tableName]
  );
  return new Map(result.rows.map((row) => [row.column_name, row]));
}

export function isNumericColumn(column: ColumnMeta | undefined) {
  return !!column && ["integer", "bigint", "smallint", "numeric", "bigint"].includes(column.data_type);
}

export function normalizeDbValue(value: unknown, column: ColumnMeta | undefined) {
  if (value === null || value === undefined || !column) return value;
  if (isNumericColumn(column)) {
    const text = String(value);
    if (!/^-?\d+$/.test(text)) {
      throw new Error(`Legacy database column ${column.column_name} expects a number, received: ${text}`);
    }
    return Number(text);
  }
  return value;
}


async function relaxUnexpectedRequiredColumns(tableName: string, columns: Map<string, ColumnMeta>, managed: Set<string>) {
  for (const [name, info] of columns) {
    if (!managed.has(name) && info.is_nullable === "NO" && !info.column_default) {
      await pool.query(`alter table ${tableName} alter column "${name}" drop not null`);
    }
  }
}

export async function insertCompatibleUser(input: {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  password?: string | null;
  role: string;
  status?: string;
  resellerId?: string | null;
  permissions?: string[];
}) {
  const columns = await getTableColumns("users");
  const idColumn = columns.get("id");
  await relaxUnexpectedRequiredColumns("users", columns, new Set(["id", "email", "username", "password_hash", "password", "role", "status", "reseller_id", "permissions", "created_at", "updated_at"]));
  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (field: string, value: unknown) => {
    fields.push(field);
    values.push(value);
  };

  if (idColumn && !isNumericColumn(idColumn)) push("id", input.id);
  if (columns.has("email")) push("email", input.email);
  if (columns.has("username")) push("username", input.username);
  if (columns.has("password_hash")) push("password_hash", input.passwordHash);
  if (columns.has("password")) push("password", input.password ?? input.passwordHash);
  if (columns.has("role")) push("role", input.role);
  if (columns.has("status")) push("status", input.status || "active");
  if (columns.has("reseller_id")) push("reseller_id", normalizeDbValue(input.resellerId ?? null, columns.get("reseller_id")));
  if (columns.has("permissions")) push("permissions", JSON.stringify(input.permissions || []));
  if (columns.has("created_at")) push("created_at", new Date());
  if (columns.has("updated_at")) push("updated_at", new Date());

  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query<{ id: string }>(
    `insert into users (${fields.join(", ")}) values (${placeholders}) returning id::text as id`,
    values
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Database did not return the created user ID");
  return id;
}

export async function insertCompatibleServer(input: {
  id: string;
  identifier: string;
  name: string;
  userId: string;
  resellerId?: string | null;
  nodeId: string;
  allocationId?: string | null;
  templateId?: string | null;
  dockerImage: string;
  startupCommand: string;
  workingDirectory?: string;
  envVars?: Record<string, string>;
  memoryMb?: number;
  cpuPercent?: number;
  diskMb?: number;
  status?: string;
  expiresAt?: Date | null;
}) {
  const columns = await getTableColumns("servers");
  const idColumn = columns.get("id");
  await relaxUnexpectedRequiredColumns("servers", columns, new Set(["id", "identifier", "name", "user_id", "owner_id", "reseller_id", "node_id", "allocation_id", "template_id", "docker_image", "startup_command", "working_directory", "env_vars", "memory_mb", "ram_mb", "cpu_percent", "disk_mb", "storage_mb", "status", "pid", "expires_at", "created_at", "updated_at"]));
  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (field: string, value: unknown) => {
    if (!columns.has(field)) return;
    fields.push(field);
    values.push(value);
  };

  if (idColumn && !isNumericColumn(idColumn)) push("id", input.id);
  push("identifier", input.identifier);
  push("name", input.name);
  push("user_id", normalizeDbValue(input.userId, columns.get("user_id")));
  push("owner_id", normalizeDbValue(input.userId, columns.get("owner_id")));
  push("reseller_id", normalizeDbValue(input.resellerId ?? null, columns.get("reseller_id")));
  push("node_id", normalizeDbValue(input.nodeId, columns.get("node_id")));
  push("allocation_id", normalizeDbValue(input.allocationId ?? null, columns.get("allocation_id")));
  push("template_id", normalizeDbValue(input.templateId ?? null, columns.get("template_id")));
  push("docker_image", input.dockerImage);
  push("startup_command", input.startupCommand);
  push("working_directory", input.workingDirectory || "/home/container");
  if (columns.has("env_vars")) push("env_vars", JSON.stringify(input.envVars || {}));
  if (columns.has("memory_mb")) push("memory_mb", input.memoryMb ?? 1024);
  if (columns.has("ram_mb")) push("ram_mb", input.memoryMb ?? 1024);
  if (columns.has("cpu_percent")) push("cpu_percent", input.cpuPercent ?? 100);
  if (columns.has("disk_mb")) push("disk_mb", input.diskMb ?? 5120);
  if (columns.has("storage_mb")) push("storage_mb", input.diskMb ?? 5120);
  if (columns.has("status")) {
    const statusColumn = columns.get("status");
    const statusValue = statusColumn?.udt_name === "server_status"
      ? (input.status || "stopped").toUpperCase()
      : (input.status || "stopped");
    push("status", statusValue);
  }
  push("expires_at", input.expiresAt ?? null);
  if (columns.has("created_at")) push("created_at", new Date());
  if (columns.has("updated_at")) push("updated_at", new Date());

  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query<{ id: string }>(
    `insert into servers (${fields.join(", ")}) values (${placeholders}) returning id::text as id`,
    values
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Database did not return the created server ID");
  return id;
}

export async function insertCompatibleReseller(input: {
  id: string;
  userId: string;
  balance?: number;
  ramLimitMb?: number;
  cpuLimitPercent?: number;
  diskLimitMb?: number;
  maxServers?: number;
  maxCustomers?: number;
}) {
  const columns = await getTableColumns("resellers");
  const idColumn = columns.get("id");
  await relaxUnexpectedRequiredColumns("resellers", columns, new Set([
    "id", "user_id", "balance", "ram_limit_mb", "cpu_limit_percent", "disk_limit_mb",
    "max_servers", "max_customers", "created_at", "updated_at",
  ]));
  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (field: string, value: unknown) => {
    if (!columns.has(field)) return;
    fields.push(field);
    values.push(value);
  };
  if (idColumn && !isNumericColumn(idColumn)) push("id", input.id);
  push("user_id", normalizeDbValue(input.userId, columns.get("user_id")));
  push("balance", input.balance ?? 0);
  push("ram_limit_mb", input.ramLimitMb ?? 10240);
  push("cpu_limit_percent", input.cpuLimitPercent ?? 500);
  push("disk_limit_mb", input.diskLimitMb ?? 102400);
  push("max_servers", input.maxServers ?? 20);
  push("max_customers", input.maxCustomers ?? 50);
  if (columns.has("created_at")) push("created_at", new Date());
  if (columns.has("updated_at")) push("updated_at", new Date());

  const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
  const result = await pool.query<{ id: string }>(
    `insert into resellers (${fields.join(", ")}) values (${placeholders}) returning id::text as id`,
    values
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Database did not return the created reseller ID");
  return id;
}

export async function updateCompatibleServer(
  id: string,
  input: {
    dockerImage?: string;
    startupCommand?: string;
    workingDirectory?: string;
    envVars?: Record<string, string>;
    status?: string;
    pid?: number;
  }
) {
  const columns = await getTableColumns("servers");
  const fields: string[] = [];
  const values: unknown[] = [];
  const push = (field: string, value: unknown) => {
    if (!columns.has(field)) return;
    fields.push(`"${field}" = $${fields.length + 1}`);
    const colMeta = columns.get(field);
    if (field === "env_vars") {
      const valStr = typeof value === "string" ? value : JSON.stringify(value || {});
      if (colMeta && ["text", "varchar"].includes(colMeta.data_type)) {
        values.push(valStr);
      } else {
        values.push(value || {});
      }
    } else if (field === "updated_at") {
      if (colMeta && ["text", "varchar"].includes(colMeta.data_type)) {
        values.push(new Date().toISOString());
      } else {
        values.push(new Date());
      }
    } else {
      values.push(normalizeDbValue(value, colMeta));
    }
  };

  if (input.dockerImage !== undefined) push("docker_image", input.dockerImage);
  if (input.startupCommand !== undefined) push("startup_command", input.startupCommand);
  if (input.workingDirectory !== undefined) push("working_directory", input.workingDirectory);
  if (input.envVars !== undefined) push("env_vars", input.envVars);
  if (input.status !== undefined) {
    const statusCol = columns.get("status");
    const statusVal = statusCol?.udt_name === "server_status" ? input.status.toUpperCase() : input.status;
    push("status", statusVal);
  }
  if (input.pid !== undefined) push("pid", input.pid);
  push("updated_at", new Date());

  if (fields.length === 0) return;

  values.push(id);
  const query = `update servers set ${fields.join(", ")} where id = $${values.length}`;
  await pool.query(query, values);
}
