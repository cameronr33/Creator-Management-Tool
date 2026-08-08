/**
 * Provisional content-type summary for the instant "Full Analysis" pass.
 *
 * Uses the official Anthropic SDK (not raw fetch — the TypeScript default per
 * the claude-api skill) on Haiku 4.5, the cheap/fast tier appropriate for a
 * short caption-based summary (fractions of a cent per creator).
 *
 * This is deliberately lighter than Step 11 of the creator-research skill,
 * which writes from vision descriptions of the reels themselves. Here we only
 * have captions, so the result is provisional — the accurate Tier-2 run
 * overwrites it with the richer version once your local machine processes it.
 *
 * Returns null (never throws for a missing key) when ANTHROPIC_API_KEY is
 * unset, so the instant pass degrades to "no summary yet" instead of failing
 * the whole request.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-haiku-4-5";
const MAX_CAPTIONS = 30;
const CAPTION_EXCERPT_LEN = 300;

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const SYSTEM_PROMPT = `You write a short, factual content-type summary for a creator being vetted for a brand partnership.

Mirror this brief: draw only on the follower count and the reel captions given. Focus on what they post (build content, install tutorials, lifestyle, comedy, motorsport coverage, etc.), what vehicles or brands appear, and any signals of buyer intent or professional context (shop owner, athlete, verified creator). Report what's observably true — do not editorialize about whether the creator is a good fit, and do not invent details the captions don't support.

Write 2-3 sentences, plain prose, no preamble. Note in the first sentence that this summary is caption-based (not derived from watching the videos), e.g. "Captions suggest..." or "Based on captions,...".`;

export interface SummarizeInput {
  name: string;
  followers: number | null;
  captions: string[];
}

export async function summarizeCreator(input: SummarizeInput): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const captions = input.captions.filter((c) => c && c.trim()).slice(0, MAX_CAPTIONS);
  if (captions.length === 0) return null;

  const captionsBlock = captions
    .map((c, i) => `${i + 1}. ${c.trim().slice(0, CAPTION_EXCERPT_LEN)}`)
    .join("\n");

  const response = await client().messages.create({
    model: MODEL,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Creator: ${input.name}\nFollowers: ${input.followers ?? "unknown"}\n\nRecent reel captions:\n${captionsBlock}`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const text = textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
  return text || null;
}
