/**
 * Railway cron worker — triggers the scheduled loops by POSTing to the app's
 * /api/cron/* routes with the CRON_SECRET bearer.
 *
 * Run as a separate Railway worker service:
 *   npx tsx scripts/cron-worker.ts
 *
 * Schedule (UTC, pinned explicitly):
 *   - 12:30 & 21:30 daily → email sync (Gmail → outreach timelines)
 *   - 13:00 daily         → follow-up due sweep (after the morning sync)
 *   - 05:00 Sunday        → tier-1 metric refresh (followers only)
 */
import cron from "node-cron";

// Fail at boot, not at the first 13:00 fire, when the worker is misconfigured.
const cronSecret = process.env.CRON_SECRET;
const appUrl = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
if (!appUrl || !cronSecret) {
  console.error("Cron worker cannot start: APP_URL (or NEXTAUTH_URL) and CRON_SECRET must be set.");
  process.exit(1);
}

// Every schedule below is pinned to UTC explicitly — node-cron otherwise uses
// the container's timezone, so a TZ env var would silently shift all jobs.
const TZ = { timezone: "UTC" };

async function trigger(path: string): Promise<void> {
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

// Twice-daily email sync at 12:30 and 21:30 UTC (morning + late afternoon
// US Central). The morning run lands BEFORE the 13:00 follow-up sweep so
// overnight replies are counted before anyone is flagged as silent.
cron.schedule("30 12,21 * * *", () => {
  console.log("Running email sync…");
  trigger("/api/cron/email-sync");
}, TZ);

// Daily follow-up sweep at 13:00 UTC.
cron.schedule("0 13 * * *", () => {
  console.log("Running follow-up sweep…");
  trigger("/api/cron/follow-ups");
}, TZ);

// Weekly tier-1 metric refresh, Sundays 05:00 UTC.
cron.schedule("0 5 * * 0", () => {
  console.log("Running tier-1 metric refresh…");
  trigger("/api/cron/refresh-metrics");
}, TZ);

console.log("Cron worker started (schedules pinned to UTC; container tz is",
  Intl.DateTimeFormat().resolvedOptions().timeZone + "):");
console.log("  - Email sync:      12:30 & 21:30 UTC daily");
console.log("  - Follow-up sweep: 13:00 UTC daily");
console.log("  - Metric refresh:  05:00 UTC Sundays");
