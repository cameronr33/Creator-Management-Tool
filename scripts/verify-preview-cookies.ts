import assert from "node:assert/strict";
import type { CookieOption } from "@auth/core/types";
import { getPreviewAuthCookies } from "../src/lib/auth-cookies";

assert.equal(getPreviewAuthCookies(undefined), undefined, "Normal auth must use Auth.js default cookies");
assert.equal(getPreviewAuthCookies("0"), undefined, "Only the explicit preview flag enables namespacing");
const cookies = getPreviewAuthCookies("1");
assert.ok(cookies, "Preview auth must isolate cookies from the ordinary localhost app");
const defaultNames = ["authjs.session-token", "authjs.callback-url", "authjs.csrf-token"];
for (const key of ["sessionToken", "callbackUrl", "csrfToken"] as const) {
  const cookie: Partial<CookieOption> | undefined = cookies[key];
  assert.ok(cookie, `${key} must be isolated`);
  assert.ok(cookie.name);
  assert.ok(cookie.options);
  assert.ok(!defaultNames.includes(cookie.name), `${key} must not overwrite a regular app cookie`);
  assert.equal(cookie.options.httpOnly, true);
  assert.equal(cookie.options.sameSite, "lax");
  assert.equal(cookie.options.path, "/");
  assert.equal(cookie.options.secure, false, "The preview is restricted to HTTP loopback");
}
assert.equal(new Set(Object.values(cookies).map(cookie => cookie?.name)).size, 3);
console.log("PASS: preview session, callback and CSRF cookies are isolated; normal auth defaults remain unchanged.");
