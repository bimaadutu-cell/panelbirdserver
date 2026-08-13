import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { cryptoRandomString } from "@/lib/utils";

export async function createAuditLog(
  userId: string | null | undefined,
  action: string,
  details?: Record<string, unknown>,
  ipAddress?: string
) {
  try {
    // Sanitize details to avoid logging sensitive keys
    const sanitizedDetails = { ...details };
    const sensitiveKeys = ["password", "secret", "token", "apiKey", "authHeader", "dbPassword"];
    
    for (const key of Object.keys(sanitizedDetails)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s.toLowerCase()))) {
        sanitizedDetails[key] = "********";
      }
    }

    await db.insert(auditLogs).values({
      id: "log_" + cryptoRandomString(12),
      userId: userId || null,
      action,
      details: sanitizedDetails,
      ipAddress: ipAddress || "127.0.0.1",
    });
  } catch (err) {
    console.error("Failed to create audit log:", err);
  }
}
