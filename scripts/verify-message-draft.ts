/** Offline safeguards for the exact text logged by the outreach composer. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { selectMessageTemplate, validateMessageDraft } from "../src/lib/message-draft";
import { renderTemplate } from "../src/lib/outreach";

const composer = readFileSync(join(__dirname, "../src/components/message-composer.tsx"), "utf8");
assert.ok(!composer.includes("const template = templates[channel]"), "Follow-ups must not reuse the first-contact pitch without considering message purpose");
assert.ok(composer.includes("validateMessageDraft"), "Both copy and manual logging must reject empty or unfinished messages");

const firstContact = { subject: "A new partnership", body: "Hi {{name}}, first-contact-pitch {{reason}}" };
for (const channel of ["email", "ig_dm"] as const) {
  const templates = { email: firstContact, ig_dm: firstContact };
  assert.equal(selectMessageTemplate(templates, channel, "initial"), firstContact, "Client's initial template must be preserved");
  const followUp = selectMessageTemplate(templates, channel, "follow_up")!;
  assert.ok(!followUp.body.includes("first-contact-pitch"), "Follow-ups must not repeat the original sales pitch");
  const text = renderTemplate(followUp.body, { name: "Maya" });
  assert.equal(validateMessageDraft(followUp.subject, text), null, "Neutral follow-up must be ready to tailor without an invented reason");
  assert.ok(selectMessageTemplate({ email: null, ig_dm: null }, channel, "follow_up"), "Follow-ups remain available without an initial template");
}
assert.ok(validateMessageDraft(null, "   "), "A blank manual draft must not be logged");
assert.ok(validateMessageDraft("[subject]", "Complete body"), "An unfinished subject must not be copied or logged");
assert.ok(validateMessageDraft(null, "Hi Maya, [watching / following / enjoying] your posts"));
assert.equal(validateMessageDraft("Following up", "Hi Maya, have you had a chance to review?"), null);
assert.equal((composer.match(/validateMessageDraft\(subject, message\)/g) ?? []).length, 2, "Both copy and log paths must apply the same guard");
console.log("PASS purpose-specific outreach drafts and copy/log safeguards");
