import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireAuth } from "@/lib/api-helpers";
import { buildAuthUrl, gmailConfigured } from "@/lib/gmail";

/**
 * GET /api/gmail/connect — starts the Google OAuth flow for the app's own
 * read-only Gmail grant. The `state` value is double-submitted via an
 * httpOnly cookie and verified in the callback (CSRF).
 */
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;

  if (!gmailConfigured()) {
    return NextResponse.json(
      { error: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not configured — see README." },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("gmail_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600,
    path: "/",
  });
  return res;
}
