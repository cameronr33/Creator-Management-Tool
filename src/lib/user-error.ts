/**
 * An error whose message is written for the person using the app — it says
 * what happened and what to do next. Routes pass these to the toast as they
 * are; any other error is logged and replaced with a plain fallback, so a
 * database or network message never reaches a teammate (interface review R3).
 */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/** The words a person sees for a caught error: a UserError's own, or the fallback — with the real error in the log. */
export function userMessage(e: unknown, fallback: string, context = "[error]"): string {
  if (e instanceof UserError) return e.message;
  console.error(context, e);
  return fallback;
}
