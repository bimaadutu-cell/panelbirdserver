import { sql } from "drizzle-orm";
import { db } from "@/db";

type TableDefinition = {
  create: string;
  columns: Record<string, string>;
};

const globalForBootstrap = globalThis as typeof globalThis & {
  __birdserverDbBootstrapPromise?: Promise<void>;
};

const tables: Record<string, TableDefinition> = {
  users: {
    create: `create table if not exists users (
      id text primary key,
      email text not null unique,
      username text not null unique,
      password_hash text not null,
      role text not null default 'user',
      status text not null default 'active',
      reseller_id text,
      permissions jsonb default '[]'::jsonb,
      two_factor_enabled boolean default false,
      two_factor_secret text,
      recovery_codes jsonb default '[]'::jsonb,
      avatar text,
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    )`,
    columns: {
      password_hash: `alter table users add column if not exists password_hash text not null default ''`,
      role: `alter table users add column if not exists role text not null default 'user'`,
      status: `alter table users add column if not exists status text not null default 'active'`,
      reseller_id: `alter table users add column if not exists reseller_id text`,
      permissions: `alter table users add column if not exists permissions jsonb default '[]'::jsonb`,
      two_factor_enabled: `alter table users add column if not exists two_factor_enabled boolean default false`,
      two_factor_secret: `alter table users add column if not exists two_factor_secret text`,
      recovery_codes: `alter table users add column if not exists recovery_codes jsonb default '[]'::jsonb`,
      avatar: `alter table users add column if not exists avatar text`,
      created_at: `alter table users add column if not exists created_at timestamp default now() not null`,
      updated_at: `alter table users add column if not exists updated_at timestamp default now() not null`,
    },
  },
  resellers: {
    create: `create table if not exists resellers (
      id text primary key,
      user_id text not null,
      balance integer not null default 0,
      ram_limit_mb integer not null default 10240,
      cpu_limit_percent integer not null default 500,
      disk_limit_mb integer not null default 102400,
      max_servers integer not null default 20,
      max_customers integer not null default 50,
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    )`,
    columns: {
      user_id: `alter table resellers add column if not exists user_id text`,
      balance: `alter table resellers add column if not exists balance integer not null default 0`,
      ram_limit_mb: `alter table resellers add column if not exists ram_limit_mb integer not null default 10240`,
      cpu_limit_percent: `alter table resellers add column if not exists cpu_limit_percent integer not null default 500`,
      disk_limit_mb: `alter table resellers add column if not exists disk_limit_mb integer not null default 102400`,
      max_servers: `alter table resellers add column if not exists max_servers integer not null default 20`,
      max_customers: `alter table resellers add column if not exists max_customers integer not null default 50`,
      created_at: `alter table resellers add column if not exists created_at timestamp default now() not null`,
      updated_at: `alter table resellers add column if not exists updated_at timestamp default now() not null`,
    },
  },
  nodes: {
    create: `create table if not exists nodes (
      id text primary key,
      name text not null,
      description text,
      fqdn_ip text not null,
      port integer not null default 8080,
      memory_mb integer not null default 32768,
      disk_mb integer not null default 512000,
      cpu_percent integer not null default 800,
      is_enabled boolean not null default true,
      agent_token text not null,
      status text not null default 'online',
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    )`,
    columns: {
      description: `alter table nodes add column if not exists description text`,
      fqdn_ip: `alter table nodes add column if not exists fqdn_ip text not null default '127.0.0.1'`,
      port: `alter table nodes add column if not exists port integer not null default 8080`,
      memory_mb: `alter table nodes add column if not exists memory_mb integer not null default 32768`,
      disk_mb: `alter table nodes add column if not exists disk_mb integer not null default 512000`,
      cpu_percent: `alter table nodes add column if not exists cpu_percent integer not null default 800`,
      is_enabled: `alter table nodes add column if not exists is_enabled boolean not null default true`,
      agent_token: `alter table nodes add column if not exists agent_token text not null default 'missing-token'`,
      status: `alter table nodes add column if not exists status text not null default 'online'`,
      created_at: `alter table nodes add column if not exists created_at timestamp default now() not null`,
      updated_at: `alter table nodes add column if not exists updated_at timestamp default now() not null`,
    },
  },
  allocations: {
    create: `create table if not exists allocations (
      id text primary key,
      node_id text not null,
      ip text not null,
      port integer not null,
      alias text,
      is_assigned boolean not null default false,
      server_id text,
      created_at timestamp default now() not null
    )`,
    columns: {
      alias: `alter table allocations add column if not exists alias text`,
      is_assigned: `alter table allocations add column if not exists is_assigned boolean not null default false`,
      server_id: `alter table allocations add column if not exists server_id text`,
      created_at: `alter table allocations add column if not exists created_at timestamp default now() not null`,
    },
  },
  templates: {
    create: `create table if not exists templates (
      id text primary key,
      name text not null,
      category text not null,
      docker_image text not null,
      startup_cmd text not null,
      description text,
      default_env jsonb default '{}'::jsonb,
      created_at timestamp default now() not null
    )`,
    columns: {
      description: `alter table templates add column if not exists description text`,
      default_env: `alter table templates add column if not exists default_env jsonb default '{}'::jsonb`,
      created_at: `alter table templates add column if not exists created_at timestamp default now() not null`,
    },
  },
  servers: {
    create: `create table if not exists servers (
      id text primary key,
      identifier text not null unique,
      name text not null,
      user_id text not null,
      reseller_id text,
      node_id text not null,
      allocation_id text,
      template_id text,
      docker_image text not null,
      startup_command text not null,
      working_directory text default '/app',
      env_vars jsonb default '{}'::jsonb,
      memory_mb integer not null default 1024,
      cpu_percent integer not null default 100,
      disk_mb integer not null default 5120,
      status text not null default 'stopped',
      pid integer,
      expires_at timestamp,
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    )`,
    columns: {
      identifier: `alter table servers add column if not exists identifier text`,
      user_id: `alter table servers add column if not exists user_id text`,
      reseller_id: `alter table servers add column if not exists reseller_id text`,
      allocation_id: `alter table servers add column if not exists allocation_id text`,
      template_id: `alter table servers add column if not exists template_id text`,
      docker_image: `alter table servers add column if not exists docker_image text not null default 'node:23-alpine'`,
      startup_command: `alter table servers add column if not exists startup_command text not null default ''`,
      working_directory: `alter table servers add column if not exists working_directory text default '/app'`,
      env_vars: `alter table servers add column if not exists env_vars jsonb default '{}'::jsonb`,
      memory_mb: `alter table servers add column if not exists memory_mb integer not null default 1024`,
      cpu_percent: `alter table servers add column if not exists cpu_percent integer not null default 100`,
      disk_mb: `alter table servers add column if not exists disk_mb integer not null default 5120`,
      status: `alter table servers add column if not exists status text not null default 'stopped'`,
      pid: `alter table servers add column if not exists pid integer`,
      expires_at: `alter table servers add column if not exists expires_at timestamp`,
      created_at: `alter table servers add column if not exists created_at timestamp default now() not null`,
      updated_at: `alter table servers add column if not exists updated_at timestamp default now() not null`,
    },
  },
  subusers: {
    create: `create table if not exists subusers (
      id text primary key,
      server_id text not null,
      user_id text not null,
      permissions jsonb not null default '[]'::jsonb,
      created_at timestamp default now() not null
    )`,
    columns: {
      permissions: `alter table subusers add column if not exists permissions jsonb not null default '[]'::jsonb`,
      created_at: `alter table subusers add column if not exists created_at timestamp default now() not null`,
    },
  },
  api_keys: {
    create: `create table if not exists api_keys (
      id text primary key,
      user_id text not null,
      name text not null,
      key_hash text not null,
      key_prefix text not null,
      scopes jsonb not null default '[]'::jsonb,
      expires_at timestamp,
      last_used_at timestamp,
      created_at timestamp default now() not null
    )`,
    columns: {
      user_id: `alter table api_keys add column if not exists user_id text`,
      name: `alter table api_keys add column if not exists name text not null default 'API Key'`,
      key_hash: `alter table api_keys add column if not exists key_hash text not null default ''`,
      key_prefix: `alter table api_keys add column if not exists key_prefix text not null default ''`,
      scopes: `alter table api_keys add column if not exists scopes jsonb not null default '[]'::jsonb`,
      expires_at: `alter table api_keys add column if not exists expires_at timestamp`,
      last_used_at: `alter table api_keys add column if not exists last_used_at timestamp`,
      created_at: `alter table api_keys add column if not exists created_at timestamp default now() not null`,
      _created_at_default_fix: `alter table api_keys alter column created_at set default now()`,
    },
  },
  backups: {
    create: `create table if not exists backups (
      id text primary key,
      server_id text not null,
      name text not null,
      file_path text not null,
      file_size integer not null default 0,
      is_successful boolean not null default true,
      created_at timestamp default now() not null
    )`,
    columns: {
      file_path: `alter table backups add column if not exists file_path text not null default ''`,
      file_size: `alter table backups add column if not exists file_size integer not null default 0`,
      is_successful: `alter table backups add column if not exists is_successful boolean not null default true`,
      created_at: `alter table backups add column if not exists created_at timestamp default now() not null`,
    },
  },
  schedules: {
    create: `create table if not exists schedules (
      id text primary key,
      server_id text not null,
      name text not null,
      cron_expression text not null,
      action_type text not null,
      payload text,
      is_active boolean not null default true,
      last_run_at timestamp,
      next_run_at timestamp,
      created_at timestamp default now() not null
    )`,
    columns: {
      cron_expression: `alter table schedules add column if not exists cron_expression text not null default '* * * * *'`,
      action_type: `alter table schedules add column if not exists action_type text not null default 'command'`,
      payload: `alter table schedules add column if not exists payload text`,
      is_active: `alter table schedules add column if not exists is_active boolean not null default true`,
      last_run_at: `alter table schedules add column if not exists last_run_at timestamp`,
      next_run_at: `alter table schedules add column if not exists next_run_at timestamp`,
      created_at: `alter table schedules add column if not exists created_at timestamp default now() not null`,
    },
  },
  packages: {
    create: `create table if not exists packages (
      id text primary key,
      name text not null,
      memory_mb integer not null,
      cpu_percent integer not null,
      disk_mb integer not null,
      price integer not null,
      duration_days integer not null default 30,
      created_at timestamp default now() not null
    )`,
    columns: {
      price: `alter table packages add column if not exists price integer not null default 0`,
      duration_days: `alter table packages add column if not exists duration_days integer not null default 30`,
      created_at: `alter table packages add column if not exists created_at timestamp default now() not null`,
    },
  },
  orders: {
    create: `create table if not exists orders (
      id text primary key,
      reseller_id text not null,
      customer_id text not null,
      package_id text,
      server_id text,
      amount integer not null,
      duration_days integer not null default 30,
      status text not null default 'pending',
      expires_at timestamp,
      created_at timestamp default now() not null
    )`,
    columns: {
      duration_days: `alter table orders add column if not exists duration_days integer not null default 30`,
      status: `alter table orders add column if not exists status text not null default 'pending'`,
      expires_at: `alter table orders add column if not exists expires_at timestamp`,
      created_at: `alter table orders add column if not exists created_at timestamp default now() not null`,
    },
  },
  transactions: {
    create: `create table if not exists transactions (
      id text primary key,
      reseller_id text not null,
      type text not null,
      amount integer not null,
      description text,
      created_at timestamp default now() not null
    )`,
    columns: {
      description: `alter table transactions add column if not exists description text`,
      created_at: `alter table transactions add column if not exists created_at timestamp default now() not null`,
    },
  },
  databases: {
    create: `create table if not exists databases (
      id text primary key,
      server_id text not null,
      db_name text not null,
      db_user text not null,
      db_password text not null,
      host text not null default '127.0.0.1',
      port integer not null default 5432,
      created_at timestamp default now() not null
    )`,
    columns: {
      host: `alter table databases add column if not exists host text not null default '127.0.0.1'`,
      port: `alter table databases add column if not exists port integer not null default 5432`,
      created_at: `alter table databases add column if not exists created_at timestamp default now() not null`,
    },
  },
  webhooks: {
    create: `create table if not exists webhooks (
      id text primary key,
      name text not null,
      url text not null,
      secret text not null,
      events jsonb default '[]'::jsonb,
      is_active boolean not null default true,
      created_at timestamp default now() not null
    )`,
    columns: {
      events: `alter table webhooks add column if not exists events jsonb default '[]'::jsonb`,
      is_active: `alter table webhooks add column if not exists is_active boolean not null default true`,
      created_at: `alter table webhooks add column if not exists created_at timestamp default now() not null`,
    },
  },
  audit_logs: {
    create: `create table if not exists audit_logs (
      id text primary key,
      user_id text,
      action text not null,
      details jsonb,
      ip_address text,
      created_at timestamp default now() not null
    )`,
    columns: {
      details: `alter table audit_logs add column if not exists details jsonb`,
      ip_address: `alter table audit_logs add column if not exists ip_address text`,
      created_at: `alter table audit_logs add column if not exists created_at timestamp default now() not null`,
    },
  },
};

async function executeWithRetry(statement: string, attempts = 3) {
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    try {
      await db.execute(sql.raw(statement));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (index + 1)));
    }
  }
  throw lastError;
}

async function getExistingTables() {
  const result = await db.execute(sql.raw(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
  `));
  const rows = Array.isArray(result)
    ? result
    : (((result as unknown) as { rows?: Array<{ table_name: string }> }).rows || []);
  return new Set(rows.map((row) => row.table_name));
}

async function getExistingColumns(tableName: string) {
  const result = await db.execute(sql.raw(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = '${tableName}'
  `));
  const rows = Array.isArray(result)
    ? result
    : (((result as unknown) as { rows?: Array<{ column_name: string }> }).rows || []);
  return new Set(rows.map((row) => row.column_name));
}

async function runBootstrapForTables(tableNames: string[]) {
  await executeWithRetry("select 1");

  const existingTables = await getExistingTables();
  for (const tableName of tableNames) {
    const definition = tables[tableName];
    if (!definition) continue;

    if (!existingTables.has(tableName)) {
      await executeWithRetry(definition.create);
      continue;
    }

    const existingColumns = await getExistingColumns(tableName);
    for (const [columnName, alterStatement] of Object.entries(definition.columns)) {
      if (columnName.startsWith('_')) {
        await executeWithRetry(alterStatement);
        continue;
      }
      if (!existingColumns.has(columnName)) {
        await executeWithRetry(alterStatement);
      }
    }
  }
}

async function runBootstrap() {
  await runBootstrapForTables(Object.keys(tables));
}

export async function ensureAuthDatabaseReady() {
  await runBootstrapForTables(["users", "api_keys", "audit_logs"]);
  // The API-key route performs the final legacy-schema self-heal immediately
  // before reading/writing, so existing Railway databases do not need a manual
  // migration command.
}

export async function ensureDatabaseReady() {
  if (!globalForBootstrap.__birdserverDbBootstrapPromise) {
    globalForBootstrap.__birdserverDbBootstrapPromise = runBootstrap().catch((error) => {
      console.error("[Birdserver] database bootstrap failed:", error);
      globalForBootstrap.__birdserverDbBootstrapPromise = undefined;
      throw error;
    });
  }

  await globalForBootstrap.__birdserverDbBootstrapPromise;
}
