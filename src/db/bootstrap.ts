import { sql } from "drizzle-orm";
import { db } from "@/db";

const globalForBootstrap = globalThis as typeof globalThis & {
  __birdserverDbBootstrapPromise?: Promise<void>;
};

const createStatements = [
  `create table if not exists users (
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
  `create table if not exists resellers (
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
  `create table if not exists nodes (
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
  `create table if not exists allocations (
    id text primary key,
    node_id text not null,
    ip text not null,
    port integer not null,
    alias text,
    is_assigned boolean not null default false,
    server_id text,
    created_at timestamp default now() not null
  )`,
  `create table if not exists templates (
    id text primary key,
    name text not null,
    category text not null,
    docker_image text not null,
    startup_cmd text not null,
    description text,
    default_env jsonb default '{}'::jsonb,
    created_at timestamp default now() not null
  )`,
  `create table if not exists servers (
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
  `create table if not exists subusers (
    id text primary key,
    server_id text not null,
    user_id text not null,
    permissions jsonb not null default '[]'::jsonb,
    created_at timestamp default now() not null
  )`,
  `create table if not exists api_keys (
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
  `create table if not exists backups (
    id text primary key,
    server_id text not null,
    name text not null,
    file_path text not null,
    file_size integer not null default 0,
    is_successful boolean not null default true,
    created_at timestamp default now() not null
  )`,
  `create table if not exists schedules (
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
  `create table if not exists packages (
    id text primary key,
    name text not null,
    memory_mb integer not null,
    cpu_percent integer not null,
    disk_mb integer not null,
    price integer not null,
    duration_days integer not null default 30,
    created_at timestamp default now() not null
  )`,
  `create table if not exists orders (
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
  `create table if not exists transactions (
    id text primary key,
    reseller_id text not null,
    type text not null,
    amount integer not null,
    description text,
    created_at timestamp default now() not null
  )`,
  `create table if not exists databases (
    id text primary key,
    server_id text not null,
    db_name text not null,
    db_user text not null,
    db_password text not null,
    host text not null default '127.0.0.1',
    port integer not null default 5432,
    created_at timestamp default now() not null
  )`,
  `create table if not exists webhooks (
    id text primary key,
    name text not null,
    url text not null,
    secret text not null,
    events jsonb default '[]'::jsonb,
    is_active boolean not null default true,
    created_at timestamp default now() not null
  )`,
  `create table if not exists audit_logs (
    id text primary key,
    user_id text,
    action text not null,
    details jsonb,
    ip_address text,
    created_at timestamp default now() not null
  )`,
];

const patchStatements = [
  `alter table if exists users add column if not exists password_hash text not null default ''`,
  `alter table if exists users add column if not exists role text not null default 'user'`,
  `alter table if exists users add column if not exists status text not null default 'active'`,
  `alter table if exists users add column if not exists reseller_id text`,
  `alter table if exists users add column if not exists permissions jsonb default '[]'::jsonb`,
  `alter table if exists users add column if not exists two_factor_enabled boolean default false`,
  `alter table if exists users add column if not exists two_factor_secret text`,
  `alter table if exists users add column if not exists recovery_codes jsonb default '[]'::jsonb`,
  `alter table if exists users add column if not exists avatar text`,
  `alter table if exists users add column if not exists created_at timestamp default now() not null`,
  `alter table if exists users add column if not exists updated_at timestamp default now() not null`,

  `alter table if exists resellers add column if not exists user_id text`,
  `alter table if exists resellers add column if not exists balance integer not null default 0`,
  `alter table if exists resellers add column if not exists ram_limit_mb integer not null default 10240`,
  `alter table if exists resellers add column if not exists cpu_limit_percent integer not null default 500`,
  `alter table if exists resellers add column if not exists disk_limit_mb integer not null default 102400`,
  `alter table if exists resellers add column if not exists max_servers integer not null default 20`,
  `alter table if exists resellers add column if not exists max_customers integer not null default 50`,
  `alter table if exists resellers add column if not exists created_at timestamp default now() not null`,
  `alter table if exists resellers add column if not exists updated_at timestamp default now() not null`,

  `alter table if exists nodes add column if not exists description text`,
  `alter table if exists nodes add column if not exists fqdn_ip text not null default '127.0.0.1'`,
  `alter table if exists nodes add column if not exists port integer not null default 8080`,
  `alter table if exists nodes add column if not exists memory_mb integer not null default 32768`,
  `alter table if exists nodes add column if not exists disk_mb integer not null default 512000`,
  `alter table if exists nodes add column if not exists cpu_percent integer not null default 800`,
  `alter table if exists nodes add column if not exists is_enabled boolean not null default true`,
  `alter table if exists nodes add column if not exists agent_token text not null default 'missing-token'`,
  `alter table if exists nodes add column if not exists status text not null default 'online'`,
  `alter table if exists nodes add column if not exists created_at timestamp default now() not null`,
  `alter table if exists nodes add column if not exists updated_at timestamp default now() not null`,

  `alter table if exists allocations add column if not exists alias text`,
  `alter table if exists allocations add column if not exists is_assigned boolean not null default false`,
  `alter table if exists allocations add column if not exists server_id text`,
  `alter table if exists allocations add column if not exists created_at timestamp default now() not null`,

  `alter table if exists templates add column if not exists description text`,
  `alter table if exists templates add column if not exists default_env jsonb default '{}'::jsonb`,
  `alter table if exists templates add column if not exists created_at timestamp default now() not null`,

  `alter table if exists servers add column if not exists reseller_id text`,
  `alter table if exists servers add column if not exists allocation_id text`,
  `alter table if exists servers add column if not exists template_id text`,
  `alter table if exists servers add column if not exists working_directory text default '/app'`,
  `alter table if exists servers add column if not exists env_vars jsonb default '{}'::jsonb`,
  `alter table if exists servers add column if not exists memory_mb integer not null default 1024`,
  `alter table if exists servers add column if not exists cpu_percent integer not null default 100`,
  `alter table if exists servers add column if not exists disk_mb integer not null default 5120`,
  `alter table if exists servers add column if not exists status text not null default 'stopped'`,
  `alter table if exists servers add column if not exists pid integer`,
  `alter table if exists servers add column if not exists expires_at timestamp`,
  `alter table if exists servers add column if not exists created_at timestamp default now() not null`,
  `alter table if exists servers add column if not exists updated_at timestamp default now() not null`,

  `alter table if exists subusers add column if not exists permissions jsonb not null default '[]'::jsonb`,
  `alter table if exists subusers add column if not exists created_at timestamp default now() not null`,

  `alter table if exists api_keys add column if not exists name text not null default 'API Key'`,
  `alter table if exists api_keys add column if not exists key_hash text not null default ''`,
  `alter table if exists api_keys add column if not exists key_prefix text not null default ''`,
  `alter table if exists api_keys add column if not exists scopes jsonb not null default '[]'::jsonb`,
  `alter table if exists api_keys add column if not exists expires_at timestamp`,
  `alter table if exists api_keys add column if not exists last_used_at timestamp`,
  `alter table if exists api_keys add column if not exists created_at timestamp default now() not null`,

  `alter table if exists backups add column if not exists file_path text not null default ''`,
  `alter table if exists backups add column if not exists file_size integer not null default 0`,
  `alter table if exists backups add column if not exists is_successful boolean not null default true`,
  `alter table if exists backups add column if not exists created_at timestamp default now() not null`,

  `alter table if exists schedules add column if not exists cron_expression text not null default '* * * * *'`,
  `alter table if exists schedules add column if not exists action_type text not null default 'command'`,
  `alter table if exists schedules add column if not exists payload text`,
  `alter table if exists schedules add column if not exists is_active boolean not null default true`,
  `alter table if exists schedules add column if not exists last_run_at timestamp`,
  `alter table if exists schedules add column if not exists next_run_at timestamp`,
  `alter table if exists schedules add column if not exists created_at timestamp default now() not null`,

  `alter table if exists packages add column if not exists price integer not null default 0`,
  `alter table if exists packages add column if not exists duration_days integer not null default 30`,
  `alter table if exists packages add column if not exists created_at timestamp default now() not null`,

  `alter table if exists orders add column if not exists duration_days integer not null default 30`,
  `alter table if exists orders add column if not exists status text not null default 'pending'`,
  `alter table if exists orders add column if not exists expires_at timestamp`,
  `alter table if exists orders add column if not exists created_at timestamp default now() not null`,

  `alter table if exists transactions add column if not exists description text`,
  `alter table if exists transactions add column if not exists created_at timestamp default now() not null`,

  `alter table if exists databases add column if not exists host text not null default '127.0.0.1'`,
  `alter table if exists databases add column if not exists port integer not null default 5432`,
  `alter table if exists databases add column if not exists created_at timestamp default now() not null`,

  `alter table if exists webhooks add column if not exists events jsonb default '[]'::jsonb`,
  `alter table if exists webhooks add column if not exists is_active boolean not null default true`,
  `alter table if exists webhooks add column if not exists created_at timestamp default now() not null`,

  `alter table if exists audit_logs add column if not exists details jsonb`,
  `alter table if exists audit_logs add column if not exists ip_address text`,
  `alter table if exists audit_logs add column if not exists created_at timestamp default now() not null`,
];

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

async function runBootstrap() {
  await executeWithRetry("select 1");
  for (const statement of createStatements) {
    await executeWithRetry(statement);
  }
  for (const statement of patchStatements) {
    await executeWithRetry(statement);
  }
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
