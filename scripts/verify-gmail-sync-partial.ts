import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db, schema } from "./db";
import { encrypt } from "../src/lib/encryption";
import { POST } from "../src/app/api/cron/email-sync/route";

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
    const mailbox = `${prefix}@agency.example.test`;
    const [creator] = await db.insert(schema.cmCreators).values({ clientId: client.id, name: prefix, username: prefix, profileUrl: "https://example.test/creator", businessEmail: address }).returning();
    const [partnership] = await db.insert(schema.cmPartnerships).values({ creatorId: creator.id, campaignId: campaign.id, stage: "contacted" }).returning();
    const [account] = await db.insert(schema.cmGmailAccounts).values({ email: mailbox, refreshTokenEnc: encrypt("synthetic-test-token"), isActive: true }).returning();
    accountId = account.id;
    process.env.GOOGLE_CLIENT_ID = "synthetic-client";
    process.env.GOOGLE_CLIENT_SECRET = "synthetic-secret";
    let fail = true;
    globalThis.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: "synthetic-access" });
      if (url.hostname === "gmail.googleapis.com") {
        if (url.pathname.endsWith("/messages")) return Response.json({ messages: [{ id: `${prefix}_good` }, ...(fail ? [{ id: `${prefix}_bad` }] : [])] });
        if (url.pathname.endsWith(`${prefix}_bad`)) return new Response("synthetic failed message", { status: 503 });
        return Response.json({ id: `${prefix}_good`, threadId: `${prefix}_thread`, internalDate: String(Date.now()), payload: { headers: [{ name: "From", value: address }, { name: "To", value: mailbox }, { name: "Subject", value: "Synthetic test reply" }], mimeType: "text/plain", body: { data: Buffer.from("Synthetic reply").toString("base64url") } } });
      }
      return oldFetch(input, init); // the preload allows only the isolated local DB
    };
    function request() {
      return new NextRequest("http://localhost:3003/api/cron/email-sync", { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    }
    const failedResponse = await POST(request());
    assert.equal(failedResponse.status, 500, "Cron workers must see partial fetch failures");
    const [partial] = await db.select().from(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.id, account.id));
    assert.match(partial.lastSyncStatus ?? "", /^partial:/);
    // One failed message fetch. (This read 2 while the unmatched-sender
    // discovery pass existed: it fetched the same broken message a second
    // time. Discovery was removed by owner decision, 2026-09-22.)
    assert.equal((partial.lastSyncSummary as { fetchErrors: number }).fetchErrors, 1);
    assert.equal((partial.lastSyncSummary as { inserted: number }).inserted, 1, "Successful fetched work must survive the partial result");
    const messages = await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, partnership.id));
    assert.equal(messages.length, 1);
    const failedJobs = await db.select().from(schema.cmJobRuns).where(and(eq(schema.cmJobRuns.job, "email_sync"), eq(schema.cmJobRuns.status, "error")));
    assert.ok(failedJobs.some(j => !beforeJobs.has(j.id) && j.error?.includes("incomplete")));

    fail = false;
    const recoveredResponse = await POST(request());
    assert.equal(recoveredResponse.status, 200);
    const [recovered] = await db.select().from(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.id, account.id));
    assert.equal(recovered.lastSyncStatus, "ok");
    assert.equal((await db.select().from(schema.cmOutreachEvents).where(eq(schema.cmOutreachEvents.partnershipId, partnership.id))).length, 1, "Retry must not duplicate successful messages");
  } finally {
    globalThis.fetch = oldFetch;
    process.env.GOOGLE_CLIENT_ID = oldGoogleId;
    process.env.GOOGLE_CLIENT_SECRET = oldGoogleSecret;
    if (accountId) await db.delete(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.id, accountId));
    await db.delete(schema.clients).where(eq(schema.clients.id, client.id));
    const createdJobIds = (await db.select({ id: schema.cmJobRuns.id }).from(schema.cmJobRuns).where(eq(schema.cmJobRuns.job, "email_sync"))).filter(j => !beforeJobs.has(j.id)).map(j => j.id);
    if (createdJobIds.length) await db.delete(schema.cmJobRuns).where(inArray(schema.cmJobRuns.id, createdJobIds));
  }
  console.log("PASS: mocked partial Gmail check persists successful work, fails cron visibly, recovers without duplicates, and cleans up.");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
