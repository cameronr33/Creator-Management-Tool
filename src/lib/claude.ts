import Anthropic from "@anthropic-ai/sdk";

/** The model that reads email and contracts. */
export const READER_MODEL = process.env.EMAIL_STATUS_MODEL ?? "claude-opus-5-5";
const FALLBACK_MODEL = "claude-opus-5";

let _client: Anthropic | null = null;
export function anthropic(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
  return _client;
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
