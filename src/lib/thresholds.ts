import { z } from "zod";

/**
 * Today's timing, per client — one table that the defaults, the settings
 * route's schema, the Settings form and the Help page are all built from
 * (frozen node 7: the explanation can't drift from the behaviour). Stored
 * overrides in cm_client_settings.follow_up_thresholds (JSON) fall back to
 * these defaults key by key, so a new key needs no migration.
 *
 * nudgeAfterDays and videoDueAfterDays: owner decision, 2026-09-28 ("nudge
 * 5, video 14").
 */
export const THRESHOLD_FIELDS = [
  { key: "initialOutreachAfterDays", label: "First message due", hint: "days after shortlisting with nothing sent", default: 3, min: 0 },
  { key: "followUp1AfterDays", label: "Follow-up 1 due", hint: "days of silence after the first message", default: 5, min: 1 },
  { key: "followUp2AfterDays", label: "Follow-up 2 due", hint: "days of silence after follow-up 1", default: 7, min: 1 },
  { key: "markNoResponseAfterDays", label: "Review unanswered outreach", hint: "days after follow-up 2 before a teammate reviews whether to close", default: 10, min: 1 },
  { key: "nudgeAfterDays", label: "Nudge a quiet deal", hint: "days with no reply at Talking, Agreed or Finalizing before it comes back to Follow up", default: 5, min: 1 },
  { key: "videoDueAfterDays", label: "Video due", hint: "days after the product arrives before the video counts as late", default: 14, min: 1 },
] as const;

export type ThresholdKey = (typeof THRESHOLD_FIELDS)[number]["key"];

/** Every key, always present (overrides merged over the defaults). */
export type FollowUpThresholds = Record<ThresholdKey, number>;

export const DEFAULT_THRESHOLDS: FollowUpThresholds = Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, f.default])) as FollowUpThresholds;

/** The settings route's schema: whole days, only known keys (strict — a typo is refused, not stored). */
export const THRESHOLDS_SCHEMA = z
  .object(Object.fromEntries(THRESHOLD_FIELDS.map((f) => [f.key, z.number().int().min(f.min).max(365).optional()])) as Record<ThresholdKey, z.ZodOptional<z.ZodNumber>>)
  .strict();
