/**
 * Our own note on where things stand with a creator, beside the email
 * reader's summary (owner, 2026-09-28). Plain data for the client
 * components: who wrote it and when travel with the text.
 */
export interface StatusNoteView {
  text: string;
  by: string | null;
  /** ISO time it was written. */
  at: string | null;
}

export function statusNoteView(p: { statusNote: string | null; statusNoteBy: string | null; statusNoteAt: Date | null }): StatusNoteView | null {
  return p.statusNote ? { text: p.statusNote, by: p.statusNoteBy, at: p.statusNoteAt?.toISOString() ?? null } : null;
}
