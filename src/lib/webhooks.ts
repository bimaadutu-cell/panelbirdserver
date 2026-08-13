import { db } from "@/db";
import { webhooks } from "@/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export async function dispatchWebhook(event: string, payload: Record<string, unknown>) {
  try {
    const activeWebhooks = await db.select().from(webhooks).where(eq(webhooks.isActive, true));
    
    for (const hook of activeWebhooks) {
      if (hook.events && hook.events.includes(event)) {
        const timestamp = Date.now().toString();
        const bodyStr = JSON.stringify({ event, timestamp, payload });
        const signature = crypto
          .createHmac("sha256", hook.secret)
          .update(bodyStr)
          .digest("hex");

        fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Birdserver-Event": event,
            "X-Birdserver-Signature": signature,
          },
          body: bodyStr,
        }).catch((err) => {
          console.error(`Webhook delivery to ${hook.url} failed:`, err);
        });
      }
    }
  } catch (err) {
    console.error("Error dispatching webhook:", err);
  }
}
