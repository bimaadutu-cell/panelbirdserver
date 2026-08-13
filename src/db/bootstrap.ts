import { sql } from "drizzle-orm";
import { db } from "@/db";

const globalForBootstrap = globalThis as typeof globalThis & {
  __birdserverDbBootstrapPromise?: Promise<void>;
};

async function runBootstrap() {
  await db.execute(sql.raw(`
    create table if not exists users (
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
    );

    create table if not exists resellers (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      balance integer not null default 0,
      ram_limit_mb integer not null default 10240,
      cpu_limit_percent integer not null default 500,
      disk_limit_mb integer not null default 102400,
      max_servers integer not null default 20,
      max_customers integer not null default 50,
      created_at timestamp default now() not null,
      updated_at timestamp default now() not null
    );

    create table if not exists nodes (
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
    );

    create table if not exists allocations (
      id text primary key,
      node_id text not null references nodes(id) on delete cascade,
      ip text not null,
      port integer not null,
      alias text,
      is_assigned boolean not null default false,
      server_id text,
      created_at timestamp default now() not null
    );

    create table if not exists templates (
      id text primary key,
      name text not null,
      category text not null,
      docker_image text not null,
      startup_cmd text not null,
      description text,
      default_env jsonb default '{}'::jsonb,
      created_at timestamp default now() not null
    );

    create table if not exists servers (
      id text primary key,
      identifier text not null unique,
      name text not null,
      user_id text not null references users(id) on delete cascade,
      reseller_id text references users(id) on delete set null,
      node_id text not null references nodes(id) on delete cascade,
      allocation_id text references allocations(id) on delete set null,
      template_id text references templates(id) on delete set null,
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
    );

    create table if not exists subusers (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      user_id text not null references users(id) on delete cascade,
      permissions jsonb not null default '[]'::jsonb,
      created_at timestamp default now() not null
    );

    create table if not exists api_keys (
      id text primary key,
      user_id text not null references users(id) on delete cascade,
      name text not null,
      key_hash text not null,
      key_prefix text not null,
      scopes jsonb not null default '[]'::jsonb,
      expires_at timestamp,
      last_used_at timestamp,
      created_at timestamp default now() not null
    );

    create table if not exists backups (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      name text not null,
      file_path text not null,
      file_size integer not null default 0,
      is_successful boolean not null default true,
      created_at timestamp default now() not null
    );

    create table if not exists schedules (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      name text not null,
      cron_expression text not null,
      action_type text not null,
      payload text,
      is_active boolean not null default true,
      last_run_at timestamp,
      next_run_at timestamp,
      created_at timestamp default now() not null
    );

    create table if not exists packages (
      id text primary key,
      name text not null,
      memory_mb integer not null,
      cpu_percent integer not null,
      disk_mb integer not null,
      price integer not null,
      duration_days integer not null default 30,
      created_at timestamp default now() not null
    );

    create table if not exists orders (
      id text primary key,
      reseller_id text not null references users(id) on delete cascade,
      customer_id text not null references users(id) on delete cascade,
      package_id text references packages(id) on delete set null,
      server_id text references servers(id) on delete set null,
      amount integer not null,
      duration_days integer not null default 30,
      status text not null default 'pending',
      expires_at timestamp,
      created_at timestamp default now() not null
    );

    create table if not exists transactions (
      id text primary key,
      reseller_id text not null references users(id) on delete cascade,
      type text not null,
      amount integer not null,
      description text,
      created_at timestamp default now() not null
    );

    create table if not exists databases (
      id text primary key,
      server_id text not null references servers(id) on delete cascade,
      db_name text not null,
      db_user text not null,
      db_password text not null,
      host text not null default '127.0.0.1',
      port integer not null default 5432,
      created_at timestamp default now() not null
    );

    create table if not exists webhooks (
      id text primary key,
      name text not null,
      url text not null,
      secret text not null,
      events jsonb default '[]'::jsonb,
      is_active boolean not null default true,
      created_at timestamp default now() not null
    );

    create table if not exists audit_logs (
      id text primary key,
      user_id text,
      action text not null,
      details jsonb,
      ip_address text,
      created_at timestamp default now() not null
    );
  `));
}

export async function ensureDatabaseReady() {
  if (!globalForBootstrap.__birdserverDbBootstrapPromise) {
    globalForBootstrap.__birdserverDbBootstrapPromise = runBootstrap().catch((error) => {
      globalForBootstrap.__birdserverDbBootstrapPromise = undefined;
      throw error;
    });
  }

  await globalForBootstrap.__birdserverDbBootstrapPromise;
}
