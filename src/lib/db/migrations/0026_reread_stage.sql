-- One-time (2026-09-29): the email reader now also says where the deal stands from the
-- messages alone (the stale-stage flag). Mark every conversation with mail the mailbox
-- holds as unread, so the next check reads it once more — the same test as
-- partnershipsNeedingRead (synced mail only).
UPDATE "cm_partnerships" SET "email_assessed_at" = NULL
WHERE "email_assessed_at" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "cm_outreach_events" e WHERE e."partnership_id" = "cm_partnerships"."id" AND e."channel" = 'email' AND e."external_id" IS NOT NULL);
