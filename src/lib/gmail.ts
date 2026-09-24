/**
 * Gmail OAuth + REST client for the in-app email sync.
 *
 * The app holds its own READ-ONLY Gmail grant (scope gmail.readonly) so the
 * sync works for every teammate with no Claude session involved. Tokens are
 * stored encrypted (src/lib/encryption.ts); this module never logs them.
 *
 * Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL (for the redirect URI).
 */
import { htmlToText } from "@/lib/email-body";

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

/**
 * Every message id a search matches, paging to the end (up to `max`). Gmail
 * lists newest first, so stopping early would return the same newest page
 * forever and older mail would never be reached; the caller filters out
 * what's already stored, so paging to the end is what lets a big backfill
 * converge over a few checks.
 */
export async function listMessageIds(
  accessToken: string,
  query: string,
  max = 5000,
): Promise<{ ids: string[]; truncated: boolean }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let more = false;
  while (ids.length < max) {
    // Trash included: a deleted thread is still the history. Spam is listed too
    // but never stored (email-ingest drops it — a spoofed "creator" lands there).
    const params = new URLSearchParams({ q: query, maxResults: "100", includeSpamTrash: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const data = await api<{ messages?: { id: string }[]; nextPageToken?: string }>(
      accessToken,
      `/messages?${params}`,
    );
    ids.push(...(data.messages ?? []).map((m) => m.id));
    more = !!data.nextPageToken;
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  // Hitting the cap is reported, never silent: the caller marks the run partial.
  return { ids: ids.slice(0, max), truncated: more || ids.length > max };
}

export interface GmailPayload {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPayload[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  internalDate: string;
  snippet?: string;
  labelIds?: string[];
  payload?: GmailPayload;
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return api(accessToken, `/messages/${id}?format=full`);
}

/** One attachment's bytes. Gmail's attachment ids change per fetch, so pass a fresh one. */
export async function getAttachment(accessToken: string, messageId: string, attachmentId: string): Promise<Uint8Array> {
  const data = await api<{ data?: string }>(accessToken, `/messages/${messageId}/attachments/${attachmentId}`);
  return new Uint8Array(Buffer.from((data.data ?? "").replace(/-/g, "+").replace(/_/g, "/"), "base64"));
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

/** Which mail a search covers: everything since an instant, or the last N days. */
export type SearchWindow = { afterEpochSeconds: number } | { newerThanDays: number };

/**
 * Batch roster addresses into Gmail search queries. Gmail caps query length,
 * so a handful of addresses go in each. Addresses are quoted so plus-tags and
 * other punctuation match literally.
 */
export function buildSearchQueries(addresses: string[], window: SearchWindow, batchSize = 8): string[] {
  const suffix =
    "afterEpochSeconds" in window ? `after:${Math.floor(window.afterEpochSeconds)}` : `newer_than:${window.newerThanDays}d`;
  const queries: string[] = [];
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    const clause = batch.map((a) => `from:"${a}" OR to:"${a}" OR cc:"${a}"`).join(" OR ");
    // Drafts aren't sent mail: an unsent draft must never count as "we messaged them".
    queries.push(`(${clause}) -in:draft ${suffix}`);
  }
  return queries;
}

export function header(payload: GmailPayload | undefined, name: string): string | null {
  const h = payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? null;
}

/**
 * Split an address header on commas that are outside quotes, so a display
 * name like "Last, First" stays one person.
 */
export function splitAddresses(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findPart(payload: GmailPayload | undefined, mimeType: string): GmailPayload | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) return payload;
  for (const part of payload.parts ?? []) {
    const found = findPart(part, mimeType);
    if (found) return found;
  }
  return null;
}

/** Depth-first search of the MIME tree for the first text/plain part. */
export function extractPlainText(payload: GmailPayload | undefined): string | null {
  if (!payload) return null;
  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) return decodeBase64Url(plain.body.data);
  // Single-part messages sometimes carry text at the root without an explicit
  // text/plain type — but HTML is never passed off as text.
  if (!payload.parts && payload.body?.data && payload.mimeType !== "text/html") {
    return decodeBase64Url(payload.body.data);
  }
  return null;
}

/** The message's own words: text/plain when there is one, else its HTML turned into text. */
export function extractBodyText(payload: GmailPayload | undefined): string | null {
  const plain = extractPlainText(payload);
  if (plain) return plain;
  const html = findPart(payload, "text/html");
  return html?.body?.data ? htmlToText(decodeBase64Url(html.body.data)) : null;
}

/** True when the message carries a calendar invitation (text/calendar or an .ics part). */
export function hasCalendarPart(payload: GmailPayload | undefined): boolean {
  if (!payload) return false;
  const type = (payload.mimeType ?? "").toLowerCase();
  if (type === "text/calendar" || type === "application/ics") return true;
  return (payload.parts ?? []).some(hasCalendarPart);
}

export interface PdfAttachment {
  /** The MIME part id — stable across fetches. */
  partId: string;
  filename: string;
  size: number;
  /** Valid for this fetch only. */
  attachmentId: string;
}

/** PDF attachments in the MIME tree (by type or by a .pdf name — some mailers send octet-stream). */
export function pdfAttachments(payload: GmailPayload | undefined): PdfAttachment[] {
  const out: PdfAttachment[] = [];
  const walk = (p: GmailPayload | undefined) => {
    if (!p) return;
    const name = (p.filename ?? "").trim();
    const type = (p.mimeType ?? "").toLowerCase();
    if (name && p.body?.attachmentId && p.partId && (type === "application/pdf" || /\.pdf$/i.test(name))) {
      out.push({ partId: p.partId, filename: name, size: p.body.size ?? 0, attachmentId: p.body.attachmentId });
    }
    for (const c of p.parts ?? []) walk(c);
  };
  walk(payload);
  return out;
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
  /** Gmail labels — "SENT" marks mail the connected mailbox itself sent. */
  labelIds: string[];
  /** RFC 822 Message-ID, for "Open in Gmail". */
  messageId: string | null;
  /** Auto-Submitted / X-Autoreply / Precedence — how auto-replies announce themselves. */
  autoSubmitted: string | null;
  autoReplyHeader: boolean;
  precedence: string | null;
  hasCalendar: boolean;
  /** PDFs attached — possible contracts (recorded by ingest, downloaded by the check). */
  pdfs: PdfAttachment[];
}

/** GmailMessage → the shape ingestEmails consumes. */
export function normalizeMessage(msg: GmailMessage): NormalizedGmailMessage | null {
  const from = header(msg.payload, "From");
  if (!from) return null;
  const ts = Number(msg.internalDate);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const bodyText = extractBodyText(msg.payload) ?? msg.snippet ?? null;
  return {
    externalId: msg.id,
    threadId: msg.threadId ?? null,
    occurredAt: new Date(ts).toISOString(),
    from,
    to: splitAddresses(header(msg.payload, "To")),
    cc: splitAddresses(header(msg.payload, "Cc")),
    subject: header(msg.payload, "Subject"),
    bodyText: bodyText ? bodyText.slice(0, 10_000) : null,
    labelIds: msg.labelIds ?? [],
    messageId: header(msg.payload, "Message-ID"),
    autoSubmitted: header(msg.payload, "Auto-Submitted"),
    autoReplyHeader: !!(header(msg.payload, "X-Autoreply") || header(msg.payload, "X-Autorespond")),
    precedence: header(msg.payload, "Precedence"),
    hasCalendar: hasCalendarPart(msg.payload),
    pdfs: pdfAttachments(msg.payload),
  };
}
