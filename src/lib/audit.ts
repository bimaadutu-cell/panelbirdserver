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

    const createdAtField = columns.has("created_at") ? "created_at" : columns.has("createdAt") ? '"createdAt"' : null;
    const userIdField = columns.has("user_id") ? "user_id" : columns.has("userId") ? '"userId"' : null;
    const detailsField = columns.has("details") ? "details" : columns.has("metadata") ? "metadata" : null;

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

    if (userIdField) push(userIdField, userId || null);
    push("action", action);
    if (detailsField) push(detailsField, JSON.stringify(sanitizedDetails));
    if (columns.has("ip_address")) push("ip_address", ipAddress || "127.0.0.1");
    if (createdAtField) push(createdAtField, new Date());

    await pool.query(
      `insert into audit_logs (${fieldNames.join(", ")}) values (${placeholders.join(", ")})`,
      values
    );
  } catch (err) {
    console.error("Failed to create audit log:", err);
  }
}
