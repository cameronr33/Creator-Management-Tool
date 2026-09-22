import type { NextAuthConfig } from "next-auth";

export function getPreviewAuthCookies(previewFlag: string | undefined): NextAuthConfig["cookies"] {
  if (previewFlag !== "1") return undefined;
  // Cookies are shared across localhost ports. Keep synthetic preview auth from
  // replacing the normal app's session while preserving Auth.js cookie options.
  const options = { httpOnly: true, sameSite: "lax" as const, path: "/", secure: false };
  return {
    sessionToken: { name: "cm-preview.session-token", options },
    callbackUrl: { name: "cm-preview.callback-url", options },
    csrfToken: { name: "cm-preview.csrf-token", options },
  };
}
