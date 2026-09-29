import { and, eq, inArray, max, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmOutreachEvents, cmPartnerships } from "@/lib/db/schema";

/**
 * Archiving and restoring (the rule itself is in archive-rules.ts). The
 * stage it's archived at is each row's own, copied in the database — never
 * taken from the browser; updatedAt is left alone (the email check files
 * mail by it).
 */
export async function setArchived(ids: string[], opts: { until: Date | null; reason: string | null; byName: string | null }): Promise<number> {
  if (!ids.length) return 0;
  const done = await db
    .update(cmPartnerships)
    .set({
      archivedAt: new Date(),
      archivedUntil: opts.until,
      archiveStage: sql`${cmPartnerships.stage}`,
      archiveReason: opts.reason?.trim().slice(0, 200) || null,
      archivedByName: opts.byName,
    })
    .where(inArray(cmPartnerships.id, ids))
    .returning({ id: cmPartnerships.id });
  return done.length;
}

/** Back on the lists: clears the archive (and a "back from the archive" line). */
export async function restoreArchived(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const done = await db
    .update(cmPartnerships)
    .set({ archivedAt: null, archivedUntil: null, archiveStage: null, archiveReason: null, archivedByName: null })
    .where(inArray(cmPartnerships.id, ids))
    .returning({ id: cmPartnerships.id });
  return done.length;
}

/** When the latest inbound message (not a note) was stored, per deal — what brings an archived creator back. */
export async function getLastInboundStoredAt(partnershipIds: string[]): Promise<Map<string, Date>> {
  if (!partnershipIds.length) return new Map();
  const rows = await db
    .select({ id: cmOutreachEvents.partnershipId, at: max(cmOutreachEvents.createdAt) })
    .from(cmOutreachEvents)
    .where(and(inArray(cmOutreachEvents.partnershipId, partnershipIds), eq(cmOutreachEvents.direction, "inbound"), ne(cmOutreachEvents.kind, "note")))
    .groupBy(cmOutreachEvents.partnershipId);
  return new Map(rows.filter((r) => r.at).map((r) => [r.id, r.at as Date]));
}
