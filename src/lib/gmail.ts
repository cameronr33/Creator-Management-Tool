/**
 * Gmail OAuth + REST client for the in-app email sync.
 *
 * The app holds its own READ-ONLY Gmail grant (scope gmail.readonly) so the
 * sync works for every teammate with no Claude session involved. Tokens are
 * stored encrypted (src/lib/encryption.ts); this module never logs them.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL (for the redirect URI).
 */

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export function gmailConfigured(): boolean {
  return !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
}

function clientCreds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  return { id, secret };
}

export function redirectUri(): string {
  const base = process.env.APP_URL ?? process.env.NEXTAUTH_URL;
  if (!base) throw new Error("APP_URL is not set");
  return `${base.replace(/\/$/, "")}/api/gmail/callback`;
}

/** The Google consent-screen URL. `state` is the CSRF token we set in a cookie. */
export function buildAuthUrl(state: string): string {
  const { id } = clientCreds();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPE,
    // offline + consent force a refresh token even on re-connects.
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

export async function exchangeCode(code: string): Promise<TokenResponse> {
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const { id, secret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function api<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API ${path} failed (HTTP ${res.status}): ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

export async function getProfile(accessToken: string): Promise<{ emailAddress: string }> {
  return api(accessToken, "/profile");
}

export async function listMessageIds(accessToken: string, query: string, max = 200): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < max) {
    const params = new URLSearchParams({ q: query, maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(
      accessToken,
      `/messages?${params}`,
    );
    ids.push(...(data.messages ?? []).map((m) => m.id));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids.slice(0, max);
}

export interface GmailPayload {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPayload[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  snippet?: string;
  payload?: GmailPayload;
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return api(accessToken, `/messages/${id}?format=full`);
}

/** Headers only — ~10x cheaper than format=full; used by address discovery. */
export async function getMessageMetadata(accessToken: string, id: string): Promise<GmailMessage> {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["From", "To", "Cc", "Subject", "Date"]) params.append("metadataHeaders", h);
  return api(accessToken, `/messages/${id}?${params}`);
}

/**
 * Discovery query: every message where the connected mailbox is cc'd —
 * i.e. the outreach threads themselves, regardless of whether the app knows
 * the counterpart address yet. Both directions land here.
 */
export function buildDiscoveryQuery(mailbox: string, windowDays: number): string {
  return `cc:${mailbox} newer_than:${windowDays}d`;
}

/** "Name <a@b.com>" | "\"Name\" <a@b.com>" | "a@b.com" → { name, email } (email lowercased). */
export function parseEmailAddress(raw: string): { name: string | null; email: string } | null {
  const m = raw.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  if (m) {
    const email = m[2].trim().toLowerCase();
    if (!email.includes("@")) return null;
    const name = m[1]?.trim() || null;
    return { name, email };
  }
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? { name: null, email } : null;
}

export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/* ── Pure normalization helpers (unit-tested offline) ─────────── */

/**
 * Batch roster addresses into Gmail search queries. Gmail caps query length,
 * so we group a handful of addresses per query.
 */
export function buildSearchQueries(addresses: string[], windowDays = 14, batchSize = 8): string[] {
  const queries: string[] = [];
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const clause = batch.map((a) => `from:${a} OR to:${a} OR cc:${a}`).join(" OR ");
    queries.push(`(${clause}) newer_than:${windowDays}d`);
  }
  return queries;
}

export function header(payload: GmailPayload | undefined, name: string): string | null {
  const h = payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/** "A <a@x.com>, b@y.com" → ["A <a@x.com>", "b@y.com"] (comma-split, quote-aware enough). */
export function splitAddresses(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

/** Depth-first search of the MIME tree for the first text/plain part. */
export function extractPlainText(payload: GmailPayload | undefined): string | null {
  if (!payload) return null;
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const found = extractPlainText(part);
    if (found) return found;
  }
  // Single-part non-multipart messages sometimes carry text at the root
  // without an explicit text/plain mimeType.
  if (!payload.parts && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  return null;
}

export interface NormalizedGmailMessage {
  externalId: string;
  threadId: string | null;
  occurredAt: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string | null;
  bodyText: string | null;
}

/** GmailMessage → the shape /api/emails/ingest (ingestEmails) consumes. */
export function normalizeMessage(msg: GmailMessage): NormalizedGmailMessage | null {
  const from = header(msg.payload, "From");
  if (!from) return null;
  const ts = Number(msg.internalDate);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const bodyText = extractPlainText(msg.payload) ?? msg.snippet ?? null;
  return {
    externalId: msg.id,
    threadId: msg.threadId ?? null,
    occurredAt: new Date(ts).toISOString(),
    from,
    to: splitAddresses(header(msg.payload, "To")),
    cc: splitAddresses(header(msg.payload, "Cc")),
    subject: header(msg.payload, "Subject"),
    bodyText: bodyText ? bodyText.slice(0, 10_000) : null,
  };
}
