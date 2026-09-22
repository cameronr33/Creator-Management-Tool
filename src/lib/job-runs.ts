import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmJobRuns } from "@/lib/db/schema";

/**
 * Heartbeat for the background loops. `runJob` wraps a cron handler's work:
 * it records start, records the outcome — distinguishing "did work" from
 * "nothing to do" from "failed" — and never swallows the error.
 */

/** The email check is the only background loop left; follow-ups are computed, not swept. */
export type JobName = "email_sync";

export interface JobOutcome {
  /** "idle" means the run was healthy but had nothing to do. */
  status: "ok" | "idle";
  /**
   * Free-form; stored as jsonb and rendered as key/value on the health panel.
   * `object` rather than Record<string, unknown> so plain result interfaces
   * are assignable without an index signature.
   */
  summary: object;
}

export async function runJob(
  job: JobName,
  work: () => Promise<JobOutcome>,
): Promise<JobOutcome> {
  const [run] = await db.insert(cmJobRuns).values({ job, status: "running" }).returning({ id: cmJobRuns.id });
  try {
    const outcome = await work();
    await db
      .update(cmJobRuns)
      .set({ status: outcome.status, summary: outcome.summary, finishedAt: new Date() })
      .where(eq(cmJobRuns.id, run.id));
    return outcome;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(cmJobRuns)
      .set({ status: "error", error: message.slice(0, 2000), finishedAt: new Date() })
      .where(eq(cmJobRuns.id, run.id));
    throw err;
  }
}
