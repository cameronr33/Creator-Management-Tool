import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireAuth } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmGmailAccounts } from "@/lib/db/schema";

/** POST /api/gmail/disconnect — deactivates the connected mailbox. */
export async function POST() {
  const { error } = await requireAuth();
  if (error) return error;

  await db
    .update(cmGmailAccounts)
    .set({ isActive: false })
    .where(eq(cmGmailAccounts.isActive, true));

  return NextResponse.json({ ok: true });
}
