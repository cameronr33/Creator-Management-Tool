/**
 * Verifies email body cleaning against the shapes real synced messages take.
 *
 *   npm run verify:email-body
 *
 * Fixtures are modeled on actual HELLA outreach threads (names kept, content
 * trimmed): an Outlook-for-iOS reply with an underscore-rule header block, and
 * a Gmail reply whose attribution line wraps onto two lines above ">" quotes.
 * Pure — no database.
 */
import { cleanEmailBody, displayNames } from "../src/lib/email-body";

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${!cond && detail ? ` — ${detail}` : ""}`);
  if (!cond) failures++;
}

const OUTLOOK_REPLY = `It is,

312 Onyx Dr
Little Elm, TX  75068
United States

Get Outlook for iOS<https://aka.ms/o0ukef>
________________________________
From: Kieran Keliher-Burke <kieran@sentic.io>
Sent: Friday, 11 September 2026 14:40:31
To: Tatum Maciejack <tatum@nosincustoms.com>
Cc: Cameron Rahmati <cameron@sentic.io>
Subject: Re: Content Proposal for Hella

Hey Tatum,

What is your address so we can put it in the contract?`;

const GMAIL_REPLY = `Hey Tatum,

What is your address so we can put it in the contract?

Thank you,

Kieran

On Fri, Sep 11, 2026 at 11:43 AM Tatum Maciejack <tatum@nosincustoms.com>
wrote:

> Sounds great!!
>
> Get Outlook for iOS <https://aka.ms/o0ukef>`;

const INLINE_LINK = `Sweet! Let's do the Rallye 4000 route.

Thanks!

Get Outlook for iOS<https://urldefense.proofpoint.com/v2/url?u=https-3A__aka.ms_o0ukef&d=DwMFaQ>
________________________________
From: Cameron Rahmati <cameron@sentic.io<mailto:cameron@sentic.io>>
Sent: Friday, 11 September 2026 12:46:53`;

function main() {
  console.log("\n── cleanEmailBody: real reply shapes ──");
  const outlook = cleanEmailBody(OUTLOOK_REPLY);
  check("Outlook reply keeps the new text", !!outlook?.startsWith("It is,") && !!outlook?.includes("Little Elm, TX"), outlook ?? "null");
  check("Outlook reply drops the quoted From/Sent/To/Cc block", !/From:|Sent:|Cc:|Subject:/.test(outlook ?? ""), outlook ?? "");
  check("Outlook reply drops the earlier message", !(outlook ?? "").includes("What is your address"));
  check("'Get Outlook for iOS' removed", !(outlook ?? "").includes("Get Outlook"));

  const gmail = cleanEmailBody(GMAIL_REPLY);
  check("Gmail reply keeps the new text and sign-off", !!gmail?.startsWith("Hey Tatum,") && !!gmail?.endsWith("Kieran"), gmail ?? "null");
  check("Gmail wrapped 'On … wrote:' attribution removed", !(gmail ?? "").includes("wrote:") && !(gmail ?? "").includes("On Fri"), gmail ?? "");
  check("Gmail '>' quoted history removed", !(gmail ?? "").includes("Sounds great"));

  const inline = cleanEmailBody(INLINE_LINK);
  check("tracking-link tails and mailto artifacts removed", !(inline ?? "").includes("urldefense") && !(inline ?? "").includes("<"), inline ?? "");
  check("content before the quote survives", inline === "Sweet! Let's do the Rallye 4000 route.\n\nThanks!", JSON.stringify(inline));

  console.log("\n── cleanEmailBody: edges ──");
  check("null/empty → null", cleanEmailBody(null) === null && cleanEmailBody("") === null);
  check("a message that is only quoted history → null", cleanEmailBody("On Mon, Sep 1, 2026 at 9:00 AM A <a@b.com> wrote:\n> hi") === null);
  check("'-- ' signature block dropped", cleanEmailBody("Sounds good.\n\n-- \nJane Doe\nCEO, Acme\n555-1234") === "Sounds good.");
  check("'Sent from my iPhone' removed", cleanEmailBody("Yes please\n\nSent from my iPhone") === "Yes please");
  check(
    "legal footer dropped",
    cleanEmailBody("Approved.\n\nCONFIDENTIALITY NOTICE: This email may contain privileged information.") === "Approved.",
  );
  check("3+ blank lines collapse to one", cleanEmailBody("a\n\n\n\n\nb") === "a\n\nb");
  check(
    "a normal sentence starting 'On' is not mistaken for a quote",
    cleanEmailBody("On second thought, let's do two lights.\nThanks") === "On second thought, let's do two lights.\nThanks",
  );

  console.log("\n── readability ──");
  check(
    "hard-wrapped sentence is rejoined",
    cleanEmailBody("Okay, great! We will get the contract signed on our end and send it over as\nsoon as possible.") ===
      "Okay, great! We will get the contract signed on our end and send it over as soon as possible.",
  );
  check(
    "address lines are NOT joined (short lines)",
    cleanEmailBody("It is,\n\n312 Onyx Dr\nLittle Elm, TX  75068\nUnited States") === "It is,\n\n312 Onyx Dr\nLittle Elm, TX  75068\nUnited States",
  );
  check(
    "a line ending in ':' is not joined to the link below it",
    cleanEmailBody("Here is the driving beam listing that we talked about on the call:\nhttps://x.com/p") ===
      "Here is the driving beam listing that we talked about on the call:\nhttps://x.com/p",
  );
  check(
    "Google redirect link unwrapped to the real destination",
    cleanEmailBody(
      "Pencil beam:\nhttps://www.google.com/url?q=https://www.myhellalights.com/products/rallye-4000&source=gmail&ust=178&sa=E",
    ) === "Pencil beam:\nhttps://www.myhellalights.com/products/rallye-4000",
  );

  console.log("\n── displayNames ──");
  check("name form", displayNames("Kieran Keliher-Burke <kieran@sentic.io>") === "Kieran Keliher-Burke");
  check("bare address", displayNames("tatum@nosincustoms.com") === "tatum@nosincustoms.com");
  check("multiple recipients", displayNames("Tatum Maciejack <tatum@nosincustoms.com>, b@x.com") === "Tatum Maciejack, b@x.com");
  check("quoted display name", displayNames('"Rahmati, Cameron" <cameron@sentic.io>') === "Rahmati, Cameron");
  check("empty → empty", displayNames(null) === "");
}

main();
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
