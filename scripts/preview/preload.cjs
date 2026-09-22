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
