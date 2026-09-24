/**
 * The email check against a mocked Gmail, on the isolated preview database.
 *
 *   npm run preview:verify -- scripts/verify-gmail-sync-partial.ts
 *
 * Asserts the coverage model end to end: a partial check keeps its work but
 * fails the scheduled heartbeat and does NOT advance coverage; the retry
 * doesn't re-download stored mail or duplicate it; a first-time address gets
 * the 180-day search and a covered one only the incremental window; the lease
 * blocks a second check; the button leaves the same heartbeat.
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db, schema } from "./db";
import { encrypt } from "../src/lib/encryption";
import { POST } from "../src/app/api/cron/email-sync/route";
import { runEmailCheck, runGmailSync, SyncBusyError } from "../src/lib/gmail-sync";

if (process.env.CREATOR_LOCAL_PREVIEW !== "1" || process.env.DATABASE_URL !== "postgresql://preview:preview@localhost:5544/creator_preview") {
  throw new Error("Run npm run preview:verify -- scripts/verify-gmail-sync-partial.ts against the isolated preview database.");
}

async function main() {
  assert.equal((await db.select().from(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.isActive, true))).length, 0, "This test needs the isolated preview mailbox disconnected");
  const prefix = `__verify_partial_${Date.now()}`;
  const [client] = await db.insert(schema.clients).values({ name: prefix, slug: prefix }).returning();
  const oldFetch = globalThis.fetch;
  const oldGoogleId = process.env.GOOGLE_CLIENT_ID;
  const oldGoogleSecret = process.env.GOOGLE_CLIENT_SECRET;
  const beforeJobs = new Set((await db.select({ id: schema.cmJobRuns.id }).from(schema.cmJobRuns).where(eq(schema.cmJobRuns.job, "email_sync"))).map(r => r.id));
  let accountId: string | null = null;
  try {
    const [campaign] = await db.insert(schema.cmCampaigns).values({ clientId: client.id, name: prefix }).returning();
    const address = `${prefix}@creator.example.test`;
    const second = `${prefix}_two@creator.example.test`;
    const mailbox = `${prefix}@agency.example.test`;
    const [creator] = await db.insert(schema.cmCreators).values({ clientId: client.id, name: prefix, username: prefix, profileUrl: "https://example.test/creator", businessEmail: address }).returning();
    const [partnership] = await db.insert(schema.cmPartnerships).values({ creatorId: creator.id, campaignId: campaign.id, stage: "contacted" }).returning();
    const [account] = await db.insert(schema.cmGmailAccounts).values({ email: mailbox, refreshTokenEnc: encrypt("synthetic-test-token"), isActive: true }).returning();
    accountId = account.id;
    process.env.GOOGLE_CLIENT_ID = "synthetic-client";
    process.env.GOOGLE_CLIENT_SECRET = "synthetic-secret";

    let fail = true;
    const queries: string[] = [];
    const downloads: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "synthetic-access" });
      if (url.hostname === "gmail.googleapis.com") {
        if (url.pathname.endsWith("/messages")) {
          // Two pages: the failing message is only reachable by following nextPageToken,
          // so the partial below also proves the listing pages to the end.
          if (url.searchParams.get("pageToken") === "page2") return Response.json({ messages: fail ? [{ id: `${prefix}_bad` }] : [] });
          queries.push(url.searchParams.get("q") ?? "");
          return Response.json({ messages: [{ id: `${prefix}_good` }], nextPageToken: "page2" });
        }
        downloads.push(url.pathname.split("/").pop() ?? "");
        if (url.pathname.endsWith(`${prefix}_bad`)) return new Response("synthetic failed message", { status: 503 });
        return Response.json({ id: `${prefix}_good`, threadId: `${prefix}_thread`, internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: address }, { name: "To", value: mailbox }, { name: "Subject", value: "Synthetic test reply" }], mimeType: "text/plain", body: { data: Buffer.from("Synthetic reply").toString("base64url") } } });
      }
      return oldFetch(input, init); // the preload allows only the isolated local DB
    };
    const request = () => new NextRequest("http://localhost:3003/api/cron/email-sync", { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const accountNow = async () => (await db.select().from(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.id, account.id)))[0];

    // 1. Partial: one download fails.
    const failedResponse = await POST(request());
    assert.equal(failedResponse.status, 500, "Cron workers must see partial fetch failures");
    const partial = await accountNow();
    assert.match(partial.lastSyncStatus ?? "", /^partial:/);
    // One failed download. (This read 2 while the unmatched-sender discovery
    // pass existed: it fetched the same broken message a second time.
    // Discovery was removed by owner decision, 2026-09-22.)
    assert.equal((partial.lastSyncSummary as { fetchErrors: number }).fetchErrors, 1);
    assert.equal((partial.lastSyncSummary as { inserted: number }).inserted, 1, "Successful fetched work must survive the partial result");
    assert.equal(partial.syncedThrough, null, "A partial check must not advance coverage");
    assert.deepEqual(partial.backfilledAddresses, [], "A partial check must not mark addresses as searched");
    assert.ok(queries.every(q => q.endsWith("newer_than:180d")), "A first-time address gets the 180-day search");
    assert.equal(partial.syncLeaseUntil, null, "The lease is released after the check");
    const messages = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, partnership.id));
    assert.equal(messages.length, 1);
    const failedJobs = await db.select().from(schema.cmJobRuns).where(and(eq(schema.cmJobRuns.job, "email_sync"), eq(schema.cmJobRuns.status, "error")));
    assert.ok(failedJobs.some(j => !beforeJobs.has(j.id) && j.error?.includes("incomplete")));

    // 2. Recovery: stored mail isn't downloaded again; coverage advances.
    fail = false;
    queries.length = 0;
    downloads.length = 0;
    const recoveredResponse = await POST(request());
    assert.equal(recoveredResponse.status, 200);
    const recovered = await accountNow();
    assert.equal(recovered.lastSyncStatus, "ok");
    assert.equal(downloads.length, 0, "Stored messages are never downloaded again");
    assert.equal((await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, partnership.id))).length, 1, "Retry must not duplicate successful messages");
    assert.ok(recovered.syncedThrough, "A complete check advances coverage");
    assert.ok(recovered.backfilledAddresses.includes(address), "…and marks the address as searched");

    // 3. Incremental: a covered address only needs mail since the last check;
    //    a newly added one gets its 180-day search.
    await db.insert(schema.cmCreatorEmails).values({ creatorId: creator.id, email: second, source: "manual" });
    queries.length = 0;
    const r3 = await runGmailSync({ trigger: "address" });
    assert.equal(r3.backfilled, 1, "The new address is the only first-time search");
    assert.ok(queries.some(q => q.includes(`"${second}"`) && q.endsWith("newer_than:180d")), "New address: 180 days");
    assert.ok(queries.some(q => q.includes(`"${address}"`) && /after:\d+$/.test(q)), "Covered address: incremental window");

    // 4. The lease serialises every trigger.
    await db.update(schema.cmGmailAccounts).set({ syncLeaseUntil: new Date(Date.now() + 60_000) }).where(eq(schema.cmGmailAccounts.id, account.id));
    await assert.rejects(() => runGmailSync({ trigger: "visit" }), SyncBusyError);
    const busyJobsBefore = await db.select({ id: schema.cmJobRuns.id }).from(schema.cmJobRuns).where(eq(schema.cmJobRuns.job, "email_sync"));
    await assert.rejects(() => runEmailCheck("button"), SyncBusyError);
    const busyJob = (await db.select().from(schema.cmJobRuns).where(eq(schema.cmJobRuns.job, "email_sync"))).find(j => !busyJobsBefore.some(b => b.id === j.id));
    assert.equal(busyJob?.status, "idle", "A check blocked by the lease is healthy, not an error");
    await db.update(schema.cmGmailAccounts).set({ syncLeaseUntil: null }).where(eq(schema.cmGmailAccounts.id, account.id));

    // 5. The button leaves the same heartbeat as the schedule.
    const beforeButton = await db.select({ id: schema.cmJobRuns.id }).from(schema.cmJobRuns).where(eq(schema.cmJobRuns.job, "email_sync"));
    await runEmailCheck("button");
    const buttonJob = (await db.select().from(schema.cmJobRuns).where(eq(schema.cmJobRuns.job, "email_sync"))).find(j => !beforeButton.some(b => b.id === j.id));
    assert.equal(buttonJob?.status, "ok");
    assert.equal((buttonJob?.summary as { trigger?: string } | null)?.trigger, "button");
  } finally {
    globalThis.fetch = oldFetch;
    process.env.GOOGLE_CLIENT_ID = oldGoogleId;
    process.env.GOOGLE_CLIENT_SECRET = oldGoogleSecret;
    if (accountId) await db.delete(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.id, accountId));
    await db.delete(schema.clients).where(eq(schema.clients.id, client.id));
    const createdJobIds = (await db.select({ id: schema.cmJobRuns.id }).from(schema.cmJobRuns).where(eq(schema.cmJobRuns.job, "email_sync"))).filter(j => !beforeJobs.has(j.id)).map(j => j.id);
    if (createdJobIds.length) await db.delete(schema.cmJobRuns).where(inArray(schema.cmJobRuns.id, createdJobIds));
  }
  console.log("PASS: mocked Gmail checks keep partial work but fail the schedule and hold coverage, never re-download stored mail, backfill new addresses, serialise on the lease, and clean up.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
