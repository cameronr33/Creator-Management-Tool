import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmPartnerships } from "@/lib/db/schema";

/**
 * "Mark done" on an open promise (promises.ts), and its Undo. Compare-and-set
 * statements: Mark done only while a promise is open; Undo only while it's
 * still the moment this press set.
 */
export async function markPromiseDone(partnershipId: string, now = new Date()): Promise<Date | null> {
  const r = await db
    .update(cmPartnerships)
    .set({ promiseDoneAt: now })
    .where(
      and(
        eq(cmPartnerships.id, partnershipId),
        isNotNull(cmPartnerships.promiseText),
        isNotNull(cmPartnerships.promiseAt),
        or(isNull(cmPartnerships.promiseDoneAt), lt(cmPartnerships.promiseDoneAt, cmPartnerships.promiseAt)),
      ),
    )
    .returning({ id: cmPartnerships.id });
  return r.length ? now : null;
}

export async function undoPromiseDone(partnershipId: string, doneAt: Date): Promise<boolean> {
  const r = await db
    .update(cmPartnerships)
    .set({ promiseDoneAt: null })
    // Millisecond-exact: the browser sends back what the press returned.
    .where(and(eq(cmPartnerships.id, partnershipId), sql`date_trunc('milliseconds', ${cmPartnerships.promiseDoneAt}) = ${doneAt.toISOString()}::timestamp`))
    .returning({ id: cmPartnerships.id });
  return r.length > 0;
}
