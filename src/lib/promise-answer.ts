import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmOutreachEvents, cmPartnerships } from "@/lib/db/schema";

/**
 * "Mark done" on an open promise (promises.ts), and its Undo. Compare-and-set
 * statements: Mark done only while a promise is open; Undo only while it's
 * still the moment this press set.
 *
 * Mark done also answers whose turn it is, like "No reply needed": the
 * reader said it was our turn because of the promise (review 2026-09-30), so
 * without this the row would drop straight into Your turn — unless they
 * wrote after the promise, which Mark done never answers for anyone. What No
 * reply needed was before is kept for Undo.
 */
export async function markPromiseDone(partnershipId: string, now = new Date()): Promise<Date | null> {
  // Did anyone on their side — the creator or someone else on the thread — write after the promise?
  // (The brand's mail is stored as notes, so it's left out by kind.)
  const theyWroteSince = sql`exists (
      select 1 from ${cmOutreachEvents} e
      where e.partnership_id = ${cmPartnerships.id} and e.direction = 'inbound' and e.kind <> 'note'
        and coalesce(e.sender_role, 'creator') in ('creator', 'other') and e.occurred_at > ${cmPartnerships.promiseAt}
    )`;
  const r = await db
    .update(cmPartnerships)
    .set({
      promiseDoneAt: now,
      promiseDoneEventId: sql`${cmPartnerships.promiseEventId}`,
      promiseReplyHandledWas: sql`${cmPartnerships.replyHandledAt}`,
      // Nothing from them since: the promise was the only reason it was our turn — settled now.
      // Something from them since: Mark done can't tell a thank-you from a question, so it never answers
      // it (second review) — it asks for one fresh read instead, told the promise is done, and the reader
      // settles whose turn it is (third review, 2026-09-30: Michael Dey's "I'll be here when you're ready!").
      replyHandledAt: sql`case when ${theyWroteSince} then ${cmPartnerships.replyHandledAt} else ${now.toISOString()}::timestamp end`,
      emailAssessedAt: sql`case when ${theyWroteSince} then null else ${cmPartnerships.emailAssessedAt} end`,
    })
    .where(
      and(
        eq(cmPartnerships.id, partnershipId),
        isNotNull(cmPartnerships.promiseText),
        isNotNull(cmPartnerships.promiseAt),
        // Open — the same rule as openPromise: by the message when there is one, else by the clock.
        sql`(case when ${cmPartnerships.promiseEventId} is not null
                  then ${cmPartnerships.promiseDoneEventId} is distinct from ${cmPartnerships.promiseEventId}
                  else ${cmPartnerships.promiseDoneAt} is null or ${cmPartnerships.promiseDoneAt} < ${cmPartnerships.promiseAt} end)`,
      ),
    )
    .returning({ id: cmPartnerships.id });
  return r.length ? now : null;
}

export async function undoPromiseDone(partnershipId: string, doneAt: Date): Promise<boolean> {
  const at = doneAt.toISOString();
  const r = await db
    .update(cmPartnerships)
    .set({
      promiseDoneAt: null,
      promiseDoneEventId: null,
      // Back to what it was — unless someone pressed No reply needed since.
      replyHandledAt: sql`case when date_trunc('milliseconds', ${cmPartnerships.replyHandledAt}) = ${at}::timestamp then ${cmPartnerships.promiseReplyHandledWas} else ${cmPartnerships.replyHandledAt} end`,
      promiseReplyHandledWas: null,
    })
    // Millisecond-exact: the browser sends back what the press returned.
    .where(and(eq(cmPartnerships.id, partnershipId), sql`date_trunc('milliseconds', ${cmPartnerships.promiseDoneAt}) = ${at}::timestamp`))
    .returning({ id: cmPartnerships.id });
  return r.length > 0;
}
