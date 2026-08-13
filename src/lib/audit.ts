import { pool } from "@/db";
import { cryptoRandomString } from "@/lib/utils";

export async function createAuditLog(
  userId: string | null | undefined,
  action: string,
  details?: Record<string, unknown>,
  ipAddress?: string
) {
  try {
    const sanitizedDetails = { ...details };
    const sensitiveKeys = ["password", "secret", "token", "apiKey", "authHeader", "dbPassword"];

    for (const key of Object.keys(sanitizedDetails)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        sanitizedDetails[key] = "********";
      }
    }

    const columnsResult = await pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='audit_logs'`
    );
    const columns = new Set(columnsResult.rows.map((row) => row.column_name));
    const idType = columnsResult.rows.find((row) => row.column_name === "id")?.data_type || "text";

    const fieldNames: string[] = [];
    const placeholders: string[] = [];
    const values: unknown[] = [];

    const push = (field: string, value: unknown) => {
      fieldNames.push(field);
      values.push(value);
      placeholders.push(`$${values.length}`);
    };

    if (idType !== "integer") {
      push("id", "log_" + cryptoRandomString(12));
    }

    if (columns.has("user_id")) push("user_id", userId || null);
    if (columns.has("userId")) push('"userId"', userId || "system");

    push("action", action);

    if (columns.has("details")) push("details", JSON.stringify(sanitizedDetails));
    if (columns.has("metadata")) push("metadata", JSON.stringify(sanitizedDetails));

    if (columns.has("ip_address")) push("ip_address", ipAddress || "127.0.0.1");
    if (columns.has("target")) push("target", null);
    if (columns.has("resource")) push("resource", null);
    if (columns.has("resource_id")) push("resource_id", null);
    if (columns.has("endpoint")) push("endpoint", null);
    if (columns.has("method")) push("method", null);
    if (columns.has("status_code")) push("status_code", null);
    if (columns.has("api_key_id")) push("api_key_id", null);
    if (columns.has("user_agent")) push("user_agent", null);

    if (columns.has("created_at")) push("created_at", new Date());
    if (columns.has("createdAt")) push('"createdAt"', new Date());

    await pool.query(
      `insert into audit_logs (${fieldNames.join(", ")}) values (${placeholders.join(", ")})`,
      values
    );
  } catch (err) {
    console.error("Failed to create audit log:", err);
  }
}
