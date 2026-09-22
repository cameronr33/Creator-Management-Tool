import assert from "node:assert/strict";
import { summarizeGmailHealth, summarizeJobHealth } from "../src/lib/gmail-health";

const now = new Date("2026-09-17T18:00:00Z");
const recent = new Date("2026-09-17T17:00:00Z");
const account = { lastSyncAt: recent, lastSyncStatus: "ok", lastSyncSummary: { messagesFetched: 12 } };

// Regression: a success-shaped status must not conceal skipped message fetches.
const partial = summarizeGmailHealth({ ...account, lastSyncSummary: { fetchErrors: 1 } }, 0, now);
assert.equal(partial.state, "partial");
assert.equal(partial.tone, "warn");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "ok (1 message fetch(es) skipped)", lastSyncSummary: null }, 0, now).state, "partial");

// Regression: old successes and empty queues are not evidence of current coverage.
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-14T10:00:00Z" }, 0, now).state, "stale");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: null }, 0, now).state, "never");
assert.equal(summarizeGmailHealth(null, 0, now).state, "disconnected");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "not-a-date" }, 0, now).state, "unknown");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "error: token expired" }, 0, now).state, "error");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "idle: no creator addresses to match" }, 0, now).state, "idle");
assert.equal(summarizeGmailHealth({ ...account, lastSyncSummary: { messagesFetched: 0 } }, 4, now).state, "review");
assert.equal(summarizeGmailHealth({ ...account, lastSyncSummary: { messagesFetched: 0 } }, 0, now).state, "checked");
assert.equal(summarizeGmailHealth({ ...account, lastSyncStatus: "unexpected" }, 0, now).state, "unknown");
assert.equal(summarizeGmailHealth(account, 0, now).state, "checked");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-18T18:00:00Z" }, 0, now).state, "unknown");
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-17T00:00:00Z" }, 0, now).stale, false);
assert.equal(summarizeGmailHealth({ ...account, lastSyncAt: "2026-09-16T23:59:59Z" }, 0, now).stale, true);

// Regression: heartbeat "ok" can also contain failures. Running is never green.
assert.equal(summarizeJobHealth({ overdue: false, failing: false, lastRun: { status: "ok", summary: { fetchErrors: 1 } } }).label, "partial");
assert.equal(summarizeJobHealth({ overdue: false, failing: false, lastRun: { status: "running" } }).tone, "info");
assert.equal(summarizeJobHealth({ overdue: true, failing: false, lastRun: null }).label, "never ran");
assert.equal(summarizeJobHealth({ overdue: false, failing: false, lastRun: { status: "ok" } }).tone, "good");

console.log("PASS: Gmail health distinguishes partial, stale, failed, missing and recent checks; heartbeat does not hide skipped fetches.");
