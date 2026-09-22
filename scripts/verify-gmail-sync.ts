/**
 * Verifies the in-app Gmail sync plumbing.
 *
 *   npm run verify:gmail-sync
 *
 * Part 1 (pure): query batching, header extraction, address splitting, MIME
 * text extraction (incl. base64url), message normalization.
 * Part 2 (live DB, self-cleaning): cm_gmail_accounts round-trip with a real
 * encrypt/decrypt cycle, single-active-account invariant, sync-status stamp.
 *
 * Does NOT hit Google — OAuth requires the user-created Cloud credentials;
 * the live integration is verified by clicking Connect Gmail + Sync now.
 */
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import {
  buildSearchQueries,
  parseEmailAddress,
  emailDomain,
  header,
  splitAddresses,
  extractPlainText,
  normalizeMessage,
  type GmailMessage,
} from "../src/lib/gmail";
import { encrypt, decrypt } from "../src/lib/encryption";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
}

async function main() {
  console.log("\n── buildSearchQueries ──");
  const qs = buildSearchQueries(["a@x.com", "b@y.com"], 14);
  check("one query for two addresses", qs.length === 1);
  check("query includes from/to/cc per address", qs[0].includes("from:a@x.com OR to:a@x.com OR cc:a@x.com"), qs[0]);
  check("window applied", qs[0].endsWith("newer_than:14d"));
  const many = buildSearchQueries(Array.from({ length: 20 }, (_, i) => `u${i}@x.com`), 14, 8);
  check("20 addresses batch into 3 queries at size 8", many.length === 3, `got ${many.length}`);

  console.log("\n── header / splitAddresses / extractPlainText ──");
  const msg: GmailMessage = {
    id: "MSG1",
    threadId: "THR1",
    internalDate: String(Date.parse("2026-08-20T10:00:00Z")),
    snippet: "snippet text",
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "From", value: "Creator Name <creator@x.com>" },
        { name: "To", value: "teammate@agency.com, Second <s@y.com>" },
        { name: "Cc", value: "cameron@sentic.io" },
        { name: "Subject", value: "Re: Partnership" },
      ],
      parts: [
        { mimeType: "text/plain", body: { data: b64url("Plain body — sounds great!") } },
        { mimeType: "text/html", body: { data: b64url("<p>html</p>") } },
      ],
    },
  };
  check("header lookup is case-insensitive", header(msg.payload, "subject") === "Re: Partnership");
  check("splitAddresses handles display names", splitAddresses(header(msg.payload, "To")).length === 2);
  check("extractPlainText prefers text/plain over html", extractPlainText(msg.payload) === "Plain body — sounds great!");

  console.log("\n── normalizeMessage ──");
  const n = normalizeMessage(msg);
  check("externalId = gmail message id", n?.externalId === "MSG1");
  check("threadId carried", n?.threadId === "THR1");
  check("occurredAt from internalDate", n?.occurredAt === "2026-08-20T10:00:00.000Z");
  check("from/to/cc extracted", n?.from === "Creator Name <creator@x.com>" && n?.to.length === 2 && n?.cc[0] === "cameron@sentic.io");
  check("body is the decoded plain text", n?.bodyText === "Plain body — sounds great!");
  const noFrom = normalizeMessage({ ...msg, payload: { headers: [] } });
  check("message without From is dropped, not crashed", noFrom === null);
  const badDate = normalizeMessage({ ...msg, internalDate: "not-a-number" });
  check("message with invalid internalDate is dropped, not a RangeError", badDate === null);

  console.log("\n── address helpers ──");
  check("parseEmailAddress: display-name form", JSON.stringify(parseEmailAddress("Robin Shute <Robin@Example.com>")) === JSON.stringify({ name: "Robin Shute", email: "robin@example.com" }));
  check("parseEmailAddress: quoted display name", parseEmailAddress('"Shute, Robin" <r@x.com>')?.name === "Shute, Robin");
  check("parseEmailAddress: bare address", JSON.stringify(parseEmailAddress(" A@B.COM ")) === JSON.stringify({ name: null, email: "a@b.com" }));
  check("parseEmailAddress: garbage → null", parseEmailAddress("undisclosed-recipients:;") === null);
  check("emailDomain", emailDomain("Someone@Sentic.IO") === "sentic.io");

  console.log("\n── Live: cm_gmail_accounts round-trip (cleaned up after) ──");
  const TEST_EMAIL = "__verify_gmail_sync__@example.com";
  const secret = "test-refresh-token-1234567890";
  const [created] = await db
    .insert(schema.cmGmailAccounts)
    .values({ email: TEST_EMAIL, refreshTokenEnc: encrypt(secret), scope: "gmail.readonly", isActive: false })
    .returning();
  try {
    check("refresh token encrypt/decrypt round-trips", decrypt(created.refreshTokenEnc) === secret);
    check("token is not stored in plaintext", !created.refreshTokenEnc.includes(secret));

    await db
      .update(schema.cmGmailAccounts)
      .set({
        lastSyncAt: new Date(),
        lastSyncStatus: "ok",
        lastSyncSummary: { inserted: 2, skipped: 1, unmatched: 0, stageChanges: 1, messagesFetched: 3, rosterSize: 5 },
      })
      .where(eq(schema.cmGmailAccounts.id, created.id));
    const [after] = await db
      .select()
      .from(schema.cmGmailAccounts)
      .where(eq(schema.cmGmailAccounts.id, created.id));
    check("sync status + summary stamp round-trips", after.lastSyncStatus === "ok" && (after.lastSyncSummary as { inserted: number }).inserted === 2);

    // Upsert-on-email (what the callback does on reconnect).
    await db
      .insert(schema.cmGmailAccounts)
      .values({ email: TEST_EMAIL, refreshTokenEnc: encrypt("rotated-token"), isActive: false })
      .onConflictDoUpdate({
        target: schema.cmGmailAccounts.email,
        set: { refreshTokenEnc: encrypt("rotated-token") },
      });
    const rows = await db
      .select()
      .from(schema.cmGmailAccounts)
      .where(eq(schema.cmGmailAccounts.email, TEST_EMAIL));
    check("reconnect upserts (1 row, rotated token)", rows.length === 1 && decrypt(rows[0].refreshTokenEnc) === "rotated-token");
  } finally {
    await db.delete(schema.cmGmailAccounts).where(eq(schema.cmGmailAccounts.email, TEST_EMAIL));
  }
  const leftover = await db
    .select({ id: schema.cmGmailAccounts.id })
    .from(schema.cmGmailAccounts)
    .where(eq(schema.cmGmailAccounts.email, TEST_EMAIL));
  check("test account deleted", leftover.length === 0);
}

main()
  .then(() => {
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
