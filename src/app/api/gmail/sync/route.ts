import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-helpers";
import { runGmailSync } from "@/lib/gmail-sync";

/** POST /api/gmail/sync — the Settings "Sync now" button. */
export async function POST() {
  const { error } = await requireAuth();
  if (error) return error;

  try {
    const result = await runGmailSync();
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
