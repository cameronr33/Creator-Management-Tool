import { NextResponse } from "next/server";
import { requireAgency } from "@/lib/api-helpers";
import { runEmailCheck, SyncBusyError } from "@/lib/gmail-sync";

/** POST /api/gmail/sync — "Check email now". Leaves the same heartbeat as the schedule. */
export async function POST() {
  const { error } = await requireAgency();
  if (error) return error;

  try {
    // Reading the conversations can take a minute: it finishes after the response.
    const result = await runEmailCheck("button", { read: "later" });
    return NextResponse.json({ ok: true, ...(result ?? {}) });
  } catch (err) {
    if (err instanceof SyncBusyError) {
      return NextResponse.json({ ok: false, error: "An email check is already running — give it a minute." }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Sync failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
