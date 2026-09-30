import { UserError } from "@/lib/user-error";
/** One outcome for account status and scheduled-job failure reporting. */
export function describeSyncOutcome(result: { rosterSize: number; fetchErrors: number; truncated?: boolean }): string {
  if (result.fetchErrors > 0) return `partial: ${result.fetchErrors} message or search fetch(es) skipped`;
  if (result.truncated) return "partial: more mail than one check can download — the next check continues";
  return result.rosterSize === 0 ? "idle: no creator addresses to match" : "ok";
}

/** Called after the account summary is saved, so successful work stays recorded. */
export function requireCompleteSync(result: { fetchErrors: number; truncated?: boolean }): void {
  if (result.fetchErrors > 0) {
    throw new UserError(`Email check incomplete: ${result.fetchErrors} message${result.fetchErrors === 1 ? "" : "s"} couldn't be fetched. Everything else was saved — press Check email now again.`);
  }
  if (result.truncated) {
    throw new UserError("Email check incomplete: more mail than one check can download. Everything so far was saved; the next check carries on.");
  }
}
