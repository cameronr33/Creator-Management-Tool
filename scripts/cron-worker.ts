/**
 * Railway cron worker — triggers the scheduled loops by POSTing to the app's
 * /api/cron/* routes with the CRON_SECRET bearer.
 *
 * Run as a separate Railway worker service:
 *   npx tsx scripts/cron-worker.ts
 *
 * Schedule (UTC, pinned explicitly):
 *   - 12:30 & 21:30 daily → email check (Gmail → creator timelines)
 *
 * The app also checks email on page visits (at most every 15 minutes), so
 * this worker only covers the hours nobody has the app open.
 */
import cron from "node-cron";

// Fail at boot, not at the first scheduled fire, when the worker is misconfigured.
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

// Twice-daily email check at 12:30 and 21:30 UTC (morning + late afternoon
// US Central).
cron.schedule("30 12,21 * * *", () => {
  console.log("Running email sync…");
  trigger("/api/cron/email-sync");
}, TZ);
