import assert from "node:assert/strict";
import { summarizeGmailHealth } from "../src/lib/gmail-health";

const now = new Date("2026-09-17T18:00:00Z");
const recent = new Date("2026-09-17T17:00:00Z");
const account = { lastSyncAt: recent, lastSyncStatus: "ok", lastSyncSummary: { messagesFetched: 12 } };

// Regression: a success-shaped status must not conceal skipped message fetches.
const partial = summarizeGmailHealth({ ...account, lastSyncSummary: { fetchErrors: 1 } }, now);
assert.equal(partial.state, "partial");
assert.equal(partial.tone, "warn");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "ok (1 message fetch(es) skipped)", lastSyncSummary: null }, now).state, "partial");

// Regression: old successes and empty queues are not evidence of current coverage.
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-14T10:00:00Z" }, now).state, "stale");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: null }, now).state, "never");
assert.equal(summarizeGmailHealth(null, now).state, "disconnected");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "not-a-date" }, now).state, "unknown");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "error: token expired" }, now).state, "error");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "idle: no creator addresses to match" }, now).state, "idle");
assert.equal(summarizeGmailHealth({ ...account, lastSyncSummary: { messagesFetched: 0 } }, now).state, "checked");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "unexpected" }, now).state, "unknown");
assert.equal(summarizeGmailHealth(account, now).state, "checked");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-18T18:00:00Z" }, now).state, "unknown");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-17T00:00:00Z" }, now).stale, false);
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-16T23:59:59Z" }, now).stale, true);

console.log("PASS: Gmail health distinguishes partial, stale, failed, missing and recent checks.");
