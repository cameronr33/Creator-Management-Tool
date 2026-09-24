import Anthropic from "@anthropic-ai/sdk";

/** The model that reads email and contracts. */
export const READER_MODEL = process.env.EMAIL_STATUS_MODEL ?? "claude-opus-5-5";
const FALLBACK_MODEL = "claude-opus-5";

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  return _client;
}

/**
 * Pure: the model service itself is unavailable — no credit, a bad key,
 * rate-limited, overloaded — rather than something wrong with this one
 * conversation or file. Such a failure says nothing about the item, so it
 * must not use up its attempts or mark it read: it's tried again later.
 */
export function serviceUnavailable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (status === 401 || status === 403 || status === 429 || (typeof status === "number" && status >= 500)) return true;
  return /credit balance|billing|overloaded|rate.?limit/i.test(message);
}

/** Calls with the configured model, once more with the fallback if this key doesn't have it. */
export async function withModelFallback<T>(call: (model: string) => Promise<T>): Promise<T> {
  try {
    return await call(READER_MODEL);
  } catch (err) {
    // Only when this key doesn't have the model — not for a bad request (e.g. a PDF too long).
    const status = (err as { status?: number }).status;
    const aboutModel = status === 404 || (status === 400 && /model/i.test(err instanceof Error ? err.message : ""));
    if (!aboutModel) throw err;
    return call(FALLBACK_MODEL);
  }
}
