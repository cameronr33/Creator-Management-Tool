/**
 * Railway cron worker — triggers the scheduled loops by POSTing to the app's
 * /api/cron/* routes with the CRON_SECRET bearer.
 *
 * Run as a separate Railway worker service:
 *   npx tsx scripts/cron-worker.ts
 *
 * Schedule (UTC):
 *   - 13:00 daily  → follow-up due sweep
 *   - 05:00 Sunday → tier-1 metric refresh (followers only)
 */
import cron from "node-cron";

async function trigger(path: string): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  const appUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  if (!appUrl || !cronSecret) {
    console.error("APP_URL/NEXTAUTH_URL and CRON_SECRET must be set");
    return;
  }
  try {
    const res = await fetch(`${appUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cronSecret}` },
      body: JSON.stringify({}),
    });
    const text = await res.text();
    if (!res.ok) console.error(`${path} failed (HTTP ${res.status}): ${text}`);
    else console.log(`${path} ok at ${new Date().toISOString()}: ${text}`);
  } catch (err) {
    console.error(`${path} request failed:`, err);
  }
}

// Daily follow-up sweep at 13:00 UTC.
cron.schedule("0 13 * * *", () => {
  console.log("Running follow-up sweep…");
  trigger("/api/cron/follow-ups");
});

// Weekly tier-1 metric refresh, Sundays 05:00 UTC.
cron.schedule("0 5 * * 0", () => {
  console.log("Running tier-1 metric refresh…");
  trigger("/api/cron/refresh-metrics");
});

console.log("Cron worker started:");
console.log("  - Follow-up sweep: 13:00 UTC daily");
console.log("  - Metric refresh:  05:00 UTC Sundays");
