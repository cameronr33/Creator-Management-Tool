/** One outcome for account status and scheduled-job failure reporting. */
export function describeSyncOutcome(result: { rosterSize: number; fetchErrors: number; truncated?: boolean }): string {
  if (result.fetchErrors > 0) return `partial: ${result.fetchErrors} message or search fetch(es) skipped`;
  if (result.truncated) return "partial: more mail than one check can download — the next check continues";
  return result.rosterSize === 0 ? "idle: no creator addresses to match" : "ok";
}

/** Called after the account summary is saved, so successful work stays recorded. */
export function requireCompleteSync(result: { fetchErrors: number; truncated?: boolean }): void {
  if (result.fetchErrors > 0) {
    throw new Error(`Email check incomplete: ${result.fetchErrors} message or search fetch(es) skipped. Successful results were saved; retry the check.`);
  }
  if (result.truncated) {
    throw new Error("Email check incomplete: more mail than one check can download. Successful results were saved; the next check continues.");
  }
}
