import { db } from "@/db";
import { resellers, servers, users, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { cryptoRandomString } from "@/lib/utils";

export interface ResellerQuotaUsage {
  ramUsedMb: number;
  ramLimitMb: number;
  cpuUsedPercent: number;
  cpuLimitPercent: number;
  diskUsedMb: number;
  diskLimitMb: number;
  serversCount: number;
  maxServers: number;
  customersCount: number;
  maxCustomers: number;
  balance: number;
}

export async function getResellerQuotaAndUsage(resellerUserId: string): Promise<ResellerQuotaUsage | null> {
  const resellerRecord = await db.query.resellers.findFirst({
    where: eq(resellers.userId, resellerUserId),
  });

  if (!resellerRecord) return null;

  // Get active servers owned by this reseller or reseller's customers
  const resellerServers = await db
    .select()
    .from(servers)
    .where(eq(servers.resellerId, resellerUserId));

  let ramUsedMb = 0;
  let cpuUsedPercent = 0;
  let diskUsedMb = 0;

  for (const s of resellerServers) {
    ramUsedMb += s.memoryMb || 0;
    cpuUsedPercent += s.cpuPercent || 0;
    diskUsedMb += s.diskMb || 0;
  }

  // Get customers under this reseller
  const customersList = await db
    .select()
    .from(users)
    .where(eq(users.resellerId, resellerUserId));

  return {
    ramUsedMb,
    ramLimitMb: resellerRecord.ramLimitMb,
    cpuUsedPercent,
    cpuLimitPercent: resellerRecord.cpuLimitPercent,
    diskUsedMb,
    diskLimitMb: resellerRecord.diskLimitMb,
    serversCount: resellerServers.length,
    maxServers: resellerRecord.maxServers,
    customersCount: customersList.length,
    maxCustomers: resellerRecord.maxCustomers,
    balance: resellerRecord.balance,
  };
}

export async function verifyResellerQuotaForNewServer(
  resellerUserId: string,
  reqMemoryMb: number,
  reqCpuPercent: number,
  reqDiskMb: number
): Promise<{ allowed: boolean; reason?: string }> {
  const usage = await getResellerQuotaAndUsage(resellerUserId);
  if (!usage) return { allowed: true }; // Admin or direct user bypasses

  if (usage.serversCount + 1 > usage.maxServers) {
    return {
      allowed: false,
      reason: `RESELLER_QUOTA_EXCEEDED: Maximum servers limit reached (${usage.serversCount}/${usage.maxServers})`,
    };
  }

  if (usage.ramUsedMb + reqMemoryMb > usage.ramLimitMb) {
    return {
      allowed: false,
      reason: `RESELLER_QUOTA_EXCEEDED: RAM quota limit reached (${usage.ramUsedMb + reqMemoryMb}MB / ${usage.ramLimitMb}MB)`,
    };
  }

  if (usage.cpuUsedPercent + reqCpuPercent > usage.cpuLimitPercent) {
    return {
      allowed: false,
      reason: `RESELLER_QUOTA_EXCEEDED: CPU quota limit reached (${usage.cpuUsedPercent + reqCpuPercent}% / ${usage.cpuLimitPercent}%)`,
    };
  }

  if (usage.diskUsedMb + reqDiskMb > usage.diskLimitMb) {
    return {
      allowed: false,
      reason: `RESELLER_QUOTA_EXCEEDED: Disk quota limit reached (${usage.diskUsedMb + reqDiskMb}MB / ${usage.diskLimitMb}MB)`,
    };
  }

  return { allowed: true };
}

export async function verifyResellerQuotaForNewCustomer(
  resellerUserId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const usage = await getResellerQuotaAndUsage(resellerUserId);
  if (!usage) return { allowed: true };

  if (usage.customersCount + 1 > usage.maxCustomers) {
    return {
      allowed: false,
      reason: `RESELLER_QUOTA_EXCEEDED: Maximum customers limit reached (${usage.customersCount}/${usage.maxCustomers})`,
    };
  }

  return { allowed: true };
}

export async function adjustResellerBalance(
  resellerUserId: string,
  amount: number,
  type: "topup" | "deduction" | "refund" | "order_payment",
  description: string
): Promise<boolean> {
  const resellerRecord = await db.query.resellers.findFirst({
    where: eq(resellers.userId, resellerUserId),
  });

  if (!resellerRecord) return false;

  const newBalance = resellerRecord.balance + amount;
  if (newBalance < 0) {
    throw new Error("INSUFFICIENT_BALANCE");
  }

  await db
    .update(resellers)
    .set({ balance: newBalance, updatedAt: new Date() })
    .where(eq(resellers.id, resellerRecord.id));

  await db.insert(transactions).values({
    id: "tx_" + cryptoRandomString(12),
    resellerId: resellerUserId,
    type,
    amount,
    description,
  });

  return true;
}
