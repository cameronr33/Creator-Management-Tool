// Test-process boundary: only this synthetic database and loopback fetches.
const PREVIEW_URL = 'postgresql://preview:preview@localhost:5544/creator_preview';
if (process.env.DATABASE_URL !== PREVIEW_URL) {
  throw new Error('Isolated preview refused a non-preview DATABASE_URL');
}
if (process.env.NODE_ENV === 'production' && process.env.CREATOR_PREVIEW_BUILD !== '1') {
  throw new Error('Isolated preview cannot serve in production mode');
}
for (const name of ['APIFY_TOKEN', 'ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
  process.env[name] = '';
}
const originalFetch = globalThis.fetch;
globalThis.fetch = async function isolatedFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === 'localhost' && url.pathname === '/sql') {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (headers.get('Neon-Connection-String') !== PREVIEW_URL) {
      throw new Error('Isolated preview rejected a non-preview database request');
    }
    return originalFetch('http://127.0.0.1:5544/sql', { ...init, redirect: 'error' });
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(`External fetch disabled in isolated preview: ${url.hostname}`);
  }
  // Undici follows redirects internally, bypassing this host check. Reject all
  // redirects, overriding both Request.redirect and init.redirect.
  return originalFetch(input, { ...init, redirect: 'error' });
};

// Windows + Node 24: exiting while fetch's keep-alive sockets are still closing
// trips a libuv assertion (exit 127) *after* a script has passed, and the suite
// stops at the first non-zero exit — silently skipping every later script. Each
// verify script calls process.exit only as its last act, so let the handles
// settle briefly first; the exit code is unchanged.
const realExit = process.exit.bind(process);
process.exit = function settledExit(code) {
  if (code !== undefined) process.exitCode = code;
  setTimeout(() => realExit(), 150);
};
