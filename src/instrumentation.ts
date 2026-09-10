/**
 * Boot-time environment validation (Next.js instrumentation hook — runs once
 * when the server starts, before any request).
 *
 * Every secret here is load-bearing for a background loop: a missing or
 * malformed TOKEN_ENCRYPTION_KEY would otherwise surface only when the
 * 03:30 email sync tries to decrypt the Gmail refresh token — an error nobody
 * reads. Fail the boot loudly instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const required = ["DATABASE_URL", "NEXTAUTH_SECRET", "CRON_SECRET", "TOKEN_ENCRYPTION_KEY"] as const;
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Refusing to start: missing required env ${missing.join(", ")}`);
  }
  if (!/^[0-9a-f]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY ?? "")) {
    throw new Error("Refusing to start: TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  }
  if ((process.env.APP_URL ?? process.env.NEXTAUTH_URL) == null) {
    console.warn("[env] APP_URL/NEXTAUTH_URL not set — Gmail OAuth redirect URI cannot be built");
  }
  const optional = ["APIFY_TOKEN", "ANTHROPIC_API_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
  const off = optional.filter((k) => !process.env[k]);
  if (off.length) console.warn(`[env] optional integrations disabled (unset): ${off.join(", ")}`);
}
