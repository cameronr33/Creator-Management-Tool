import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cmJobRuns, type CmJobRun } from "@/lib/db/schema";

/**
 * Heartbeat for the background loops. `runJob` wraps a cron handler's work:
 * it records start, records the outcome — distinguishing "did work" from
 * "nothing to do" from "failed" — and never swallows the error.
 */

export type JobName = "follow_ups" | "email_sync" | "refresh_metrics";

/** How often each job is expected to run; used to flag an overdue loop. */
export const JOB_EXPECTED_EVERY_HOURS: Record<JobName, number> = {
  email_sync: 12,
  follow_ups: 24,
  refresh_metrics: 24 * 7,
};

export const JOB_LABELS: Record<JobName, string> = {
  email_sync: "Email sync",
  follow_ups: "Follow-up sweep",
  refresh_metrics: "Metric refresh",
};

export interface JobOutcome {
  /** "idle" means the run was healthy but had nothing to do. */
  status: "ok" | "idle";
  /**
   * Free-form; stored as jsonb and rendered as key/value on the health panel.
   * `object` rather than Record<string, unknown> so plain result interfaces
   * (SweepResult, RefreshResult) are assignable without an index signature.
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

export interface JobHealth {
  job: JobName;
  label: string;
  expectedEveryHours: number;
  lastRun: CmJobRun | null;
  /** Hours since the last finished run, or null if it never ran. */
  hoursSince: number | null;
  /** True when the loop hasn't completed within 1.5× its expected interval. */
  overdue: boolean;
  /** True when the most recent run errored. */
  failing: boolean;
}

/** Latest run per job with an overdue/failing verdict — the Settings health panel. */
export async function getJobHealth(now = new Date()): Promise<JobHealth[]> {
  const jobs = Object.keys(JOB_EXPECTED_EVERY_HOURS) as JobName[];
  const out: JobHealth[] = [];
  for (const job of jobs) {
    const [lastRun] = await db
      .select()
      .from(cmJobRuns)
      .where(eq(cmJobRuns.job, job))
      .orderBy(desc(cmJobRuns.startedAt))
      .limit(1);
    const expected = JOB_EXPECTED_EVERY_HOURS[job];
    const ref = lastRun?.finishedAt ?? lastRun?.startedAt ?? null;
    const hoursSince = ref ? (now.getTime() - ref.getTime()) / 3_600_000 : null;
    out.push({
      job,
      label: JOB_LABELS[job],
      expectedEveryHours: expected,
      lastRun: lastRun ?? null,
      hoursSince,
      overdue: hoursSince == null || hoursSince > expected * 1.5,
      failing: lastRun?.status === "error",
    });
  }
  return out;
}
