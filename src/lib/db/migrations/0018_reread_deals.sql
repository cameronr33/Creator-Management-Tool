-- One-time (2026-09-24): the email reader now reads the deal (product, fee,
-- terms) and fills blank fields. Mark every conversation with email as unread
-- so it is read once more under the new rules. Applied by the deploy's
-- db:deploy together with the code that reads without skipping on an outage —
-- older code would have marked them read again while the API had no credit.
UPDATE "cm_partnerships" SET "email_assessed_at" = NULL
WHERE "email_assessed_at" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "cm_outreach_events" e WHERE e."partnership_id" = "cm_partnerships"."id" AND e."channel" = 'email');
