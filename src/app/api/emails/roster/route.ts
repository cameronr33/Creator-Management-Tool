import { NextResponse, type NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-helpers";
import { getEmailRoster } from "@/lib/email-ingest";

/**
 * GET /api/emails/roster — API-key auth, for the email-sync skill.
 * Returns the creators whose email threads are worth syncing.
 */
export async function GET(req: NextRequest) {
  const { error } = await requireApiKey(req);
  if (error) return error;

  const contacts = await getEmailRoster();
  return NextResponse.json({ contacts });
}
