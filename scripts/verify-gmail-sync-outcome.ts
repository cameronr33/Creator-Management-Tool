import assert from "node:assert/strict";
import { describeSyncOutcome, requireCompleteSync } from "../src/lib/gmail-sync-outcome";

// Regressions: skipped fetches used to be called "ok", including with an empty roster.
assert.equal(describeSyncOutcome({ rosterSize: 1, fetchErrors: 2 }), "partial: 2 message or search fetch(es) skipped");
assert.equal(describeSyncOutcome({ rosterSize: 0, fetchErrors: 1 }), "partial: 1 message or search fetch(es) skipped");
assert.throws(() => requireCompleteSync({ fetchErrors: 2 }), /incomplete/i);
assert.doesNotThrow(() => requireCompleteSync({ fetchErrors: 0 }));
assert.equal(describeSyncOutcome({ rosterSize: 0, fetchErrors: 0 }), "idle: no creator addresses to match");
assert.equal(describeSyncOutcome({ rosterSize: 1, fetchErrors: 0 }), "ok");
console.log("PASS: partial Gmail runs never report ok; scheduled jobs fail visibly while preserving fetched results.");
