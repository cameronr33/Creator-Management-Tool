import { NextResponse, type NextRequest } from "next/server";
import { requireAgency } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { cmGmailAccounts } from "@/lib/db/schema";
import { encrypt } from "@/lib/encryption";
import { exchangeCode, getProfile } from "@/lib/gmail";

/**
 * GET /api/gmail/callback — Google redirects here after consent. Exchanges
 * the code, stores the encrypted refresh token, and lands back on Settings.
 * Connecting again (any mailbox) replaces the previous connection — the app
 * keeps exactly one active account.
 */
export async function GET(req: NextRequest) {
  const { session, error } = await requireAgency();
  if (error) return error;

  const url = new URL(req.url);
  // Every exit clears the one-shot state cookie, success or not.
  const settings = (msg: string) => {
    const res = NextResponse.redirect(new URL(`/settings?gmail=${encodeURIComponent(msg)}`, url.origin));
    res.cookies.delete("gmail_oauth_state");
    return res;
  };

  const oauthError = url.searchParams.get("error");
  if (oauthError) return settings(`error:${oauthError}`);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("gmail_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return settings("error:invalid_state");
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      // Should not happen with prompt=consent, but fail loudly rather than
      // storing a connection the cron can't refresh.
      return settings("error:no_refresh_token");
    }
    const profile = await getProfile(tokens.access_token);

    // One active connection: deactivate everything, then upsert this mailbox.
    await db.update(cmGmailAccounts).set({ isActive: false });
    await db
      .insert(cmGmailAccounts)
      .values({
        email: profile.emailAddress.toLowerCase(),
        refreshTokenEnc: encrypt(tokens.refresh_token),
        scope: tokens.scope,
        connectedBy: session.user.id,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: cmGmailAccounts.email,
        set: {
          refreshTokenEnc: encrypt(tokens.refresh_token),
          scope: tokens.scope,
          connectedBy: session.user.id,
          connectedAt: new Date(),
          isActive: true,
        },
      });

    return settings("connected");
  } catch (err) {
    console.error("[gmail/callback]", err);
    return settings("error:exchange_failed");
  }
}
