import { auth } from "@/lib/auth";
import { scheduleEmailCheck } from "@/lib/gmail-sync";

/**
 * The page-visit email check, only for a signed-in visitor. A signed-out one
 * is being redirected to /login by the layout, which ends the response while
 * the page is still rendering — a check scheduled then runs mid-render (Next
 * rejects the page's later cookies() calls) and lets anyone start a check.
 * Kept apart from gmail-sync.ts so the cron worker doesn't load auth.
 */
export async function scheduleEmailCheckForVisitor(): Promise<void> {
  if ((await auth())?.user) scheduleEmailCheck();
}
