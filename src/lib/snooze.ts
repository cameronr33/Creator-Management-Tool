import { and, eq, inArray, max, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmOutreachEvents, cmPartnerships } from "@/lib/db/schema";

/**
 * Setting and clearing a snooze (the rule itself is in snooze-rules.ts). The
 * stage it's snoozed at is read from the database, never taken from the
 * browser; updatedAt is left alone (the email check files mail by it).
 */
export async function setSnooze(partnershipId: string, until: Date | null, reason: string | null, byName: string | null): Promise<boolean> {
  if (!until) {
    const done = await db
      .update(cmPartnerships)
      .set({ snoozedUntil: null, snoozedAt: null, snoozeStage: null, snoozeReason: null, snoozedByName: null })
      .where(eq(cmPartnerships.id, partnershipId))
      .returning({ id: cmPartnerships.id });
    return done.length > 0;
  }
  const [p] = await db.select({ stage: cmPartnerships.stage }).from(cmPartnerships).where(eq(cmPartnerships.id, partnershipId)).limit(1);
  if (!p) return false;
  await db
    .update(cmPartnerships)
    .set({ snoozedUntil: until, snoozedAt: new Date(), snoozeStage: p.stage, snoozeReason: reason?.trim().slice(0, 200) || null, snoozedByName: byName })
    .where(eq(cmPartnerships.id, partnershipId));
  return true;
}

/** When the latest inbound message (not a note) was stored, per deal — what wakes a snooze. */
export async function getLastInboundStoredAt(partnershipIds: string[]): Promise<Map<string, Date>> {
  if (!partnershipIds.length) return new Map();
  const rows = await db
    .select({ id: cmOutreachEvents.partnershipId, at: max(cmOutreachEvents.createdAt) })
    .from(cmOutreachEvents)
    .where(and(inArray(cmOutreachEvents.partnershipId, partnershipIds), eq(cmOutreachEvents.direction, "inbound"), ne(cmOutreachEvents.kind, "note")))
    .groupBy(cmOutreachEvents.partnershipId);
  return new Map(rows.filter((r) => r.at).map((r) => [r.id, r.at as Date]));
}
