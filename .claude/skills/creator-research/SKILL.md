---
name: creator-research
description: Research and vet Instagram content creators for brand partnerships — produces a spreadsheet of profile metrics, real public view counts, top-3 reels with visual descriptions, and a content-type summary per creator. Use this skill whenever the user provides a list of Instagram handles or reel/profile links and asks to analyze, vet, evaluate, research, or shortlist them for a campaign or partnership. Also trigger when the user says things like "run creator research on these accounts", "vet these creators", "analyze these Instagram handles", "creator vetting", "look up view counts for these reels", "give me a shortlist from this handle list", or asks about a creator's max views / posting cadence / top posts across a partnership shortlist.
---

# Instagram Creator Research

This skill runs a battle-tested pipeline that turns a list of Instagram handles into a fully-populated creator research spreadsheet. Follow the 11 steps in order — each has been hardened against a real mistake from a previous run.

## Inputs

Ask the user for (or confirm) two things before starting:

1. **A list of Instagram handles.** Accept plain usernames (`@handle`, `handle`) or profile URLs (`https://www.instagram.com/handle/`). Normalize everything to the canonical profile URL form `https://www.instagram.com/{username}/`.
2. **A campaign name.** This is a free-text label the user picks (e.g., "HELLA Overlanding Q3 2026"). It goes into the Campaign column so the same creator can appear under multiple campaigns over time.

Also confirm the **content pillar** for the shortlist (e.g., "Off-road / Overlanding", "Motorsport", "JDM tuning"). This gets written verbatim into the Content Pillar column.

## Output

A single CSV at `C:\Users\camer\Downloads\COWORK\CLAUDE OUTPUTS\<CLIENT>\<CLIENT> - Creator Research - YYYY-MM-DD.csv` with one row per creator and the following columns in this exact order:

- Name
- Username
- Instagram Link
- Content Pillar
- Campaign
- Business Email
- Followers
- Reels Pulled
- Posting Cadence (reels/wk)
- Date Range
- Avg Views (IG)
- Median Views (IG)
- Max Views (IG)
- Views Source
- Content Type Summary
- Top Reel #1 Link
- Top Reel #1 Views
- Top Reel #1 Description
- Top Reel #2 Link
- Top Reel #2 Views
- Top Reel #2 Description
- Top Reel #3 Link
- Top Reel #3 Views
- Top Reel #3 Description

Creators that fall below the cadence cut go into a second sheet or CSV suffixed `- below-cadence.csv`.

## Working directory

Create a scratch folder for the run at `C:\Users\camer\Downloads\COWORK\CLAUDE OUTPUTS\<CLIENT>\_creator-research-scratch\<YYYY-MM-DD>\`. Everything intermediate (Apify JSON dumps, downloaded mp4s, montage jpgs, per-creator JSON summaries) lives there. Do not surface these to the user.

---

## The 11-step pipeline

### Step 1 — Bulk scrape reels via Apify

Use the Apify Actor `apify/instagram-scraper`. Run it once with all profile URLs batched together:

```json
{
  "directUrls": ["https://www.instagram.com/handle1/", "https://www.instagram.com/handle2/", "..."],
  "resultsType": "posts",
  "resultsLimit": 30,
  "addParentData": false
}
```

Retain these fields per reel: `shortCode`, `timestamp`, `videoPlayCount`, `likesCount`, `commentsCount`, `videoDuration`, `caption`, `videoUrl`, `ownerUsername`, `hashtags`, `mentions`.

Save the raw output as `scratch/<date>/apify_reels_raw.json`. Rough cost: ~$0.03 per creator.

### Step 2 — Aggregate metrics

Run `scripts/aggregate_metrics.py`:

```bash
python scripts/aggregate_metrics.py \
  --apify-json scratch/<date>/apify_reels_raw.json \
  --out-json scratch/<date>/creator_summary.json
```

For each creator this produces: `reel_count`, `avg_views`, `median_views`, `max_views` (initially from `videoPlayCount` — these will be replaced in Step 5), `date_oldest`, `date_newest`, `span_days`, `cadence_per_week`, and a first-pass `top_3_shortcodes` list.

### Step 3 — Filter by cadence

Default threshold: **≥ 1 reel per week**. Split creators into `kept` and `below_cadence`. Note the threshold in the output.

Keep the `below_cadence` group in a separate CSV so the user can override the cut — do not silently drop them.

### Step 4 — Fetch profile-level metadata

Run the Apify Actor a second time with `resultsType = "details"` on the profile URLs to get: `fullName`, `followersCount`, `businessEmail` (or the public contact email), `verified`, `biography`.

Merge into the per-creator record. Save as `scratch/<date>/profile_details.json`.

### Step 5 — CRITICAL: Replace view counts via Chrome grid scrape

**This is the single most important step. Apify's `videoPlayCount` does NOT match the "Views" number Instagram displays on the reel grid.** Post-2024 the public Views metric is a different signal (reels distribution impressions). For viral reels the two numbers can differ by 100× or more.

For each creator:

1. Confirm the Claude in Chrome extension is connected (`mcp__Claude_in_Chrome__list_connected_browsers`). If not, ask the user to install it before continuing.
2. Navigate to `https://www.instagram.com/{username}/reels/`.
3. Wait 3 seconds for initial render.
4. Scroll to the bottom 5 times with ~2.5 second pauses between scrolls. For profiles that load slowly (e.g., accounts with 300+ reels), scroll up to 8 times.
5. Execute the JavaScript in `scripts/scrape_grid_views.js` via `mcp__Claude_in_Chrome__javascript_tool`. It returns a `{shortcode: "11.9M"}` mapping.
6. Parse each string into an integer (`"11.9M"` → 11,900,000; `"324K"` → 324,000; `"1,204"` → 1204).
7. **Sanity check the selector before trusting the run.** Pick three known reel shortcodes from the profile and confirm their grid overlays match the parsed values. The current selector (`a[href*="/reel/"] svg[aria-label="View Count Icon"]`) may drift as Instagram updates the DOM.

**Fallback for small accounts.** Instagram does not render the Views overlay on some profiles (usually under ~2K followers, or accounts where the metric has not been activated). When the scrape returns fewer than half the visible reels or an empty map:

- Fall back to Apify `videoPlayCount` for that creator.
- Set `Views Source = "Apify videoPlayCount (small acct)"`.

For all other creators, set `Views Source = "IG public (Chrome scrape)"`.

### Step 6 — Recompute top-3 with real views

Once real view counts are in, re-sort each creator's reels by Chrome-scraped views. Recompute `avg_views`, `median_views`, `max_views`, and produce a new `top_3_shortcodes` list.

### Step 7 — Fetch metadata for new top-3 reels

The re-sort will surface reels whose caption / `videoUrl` were not in the original Apify pull (e.g., if the Apify limit of 30 clipped them). Run Apify a third time in `resultsType = "details"` mode against only the new top-3 reel URLs. Merge back in.

If Apify returns only `{"url": "..."}` with no metadata for a specific reel (this happens occasionally), skip and use the Chrome-scraped caption if any is available on the grid tile.

### Step 8 — Download top-3 videos immediately

Apify's `videoUrl` fields are signed CDN links that expire within a few hours. Download them in the same session as the Apify pull:

```bash
curl -sS -L --max-time 60 -o "scratch/<date>/videos/{username}_{shortcode}.mp4" "$videoUrl"
```

Parallelize with a thread pool (8 workers is safe). After each download check the file size — a 22-byte file whose body is `URL signature mismatch` means the link expired. Re-run Step 7 for that shortcode.

### Step 9 — Extract 6-frame montages

For each downloaded mp4 run `scripts/download_and_frame.py`:

```bash
python scripts/download_and_frame.py \
  --video-url "" \
  --local-video "scratch/<date>/videos/{username}_{shortcode}.mp4" \
  --out-dir "scratch/<date>/montages" \
  --basename "{username}_{shortcode}" \
  --duration <videoDuration>
```

Frame timestamps are `duration * i / 7` for i=1..6, producing a 2×3 montage. For videos longer than 90 seconds, use 9 frames (3×3) — the script handles this automatically via the `--duration` argument.

### Step 10 — Describe each reel from its montage

Open each montage.jpg with the Read tool (Claude's native vision handles this). Use this prompt template:

> This is a 2×3 (or 3×3) frame montage from a single Instagram Reel by @{handle}. In one to two sentences under 30 words, describe what the reel is showing. Mention any on-screen text you can read. Do not invent audio content — you only have the visual frames.

Store the description keyed by `shortCode` in `scratch/<date>/reel_descriptions.json`.

### Step 11 — Write the Content Type Summary

For each creator, write 2-3 sentences drawing on:

- Their bio (from Step 4).
- The three top-reel descriptions (Step 10).
- Follower count and posting cadence.

Focus on:

- **What they post** — build content, install tutorials, lifestyle, comedy, motorsport coverage, etc.
- **What vehicles or brands appear.**
- **Signals of buyer intent or professional context** — shop owner, athlete, verified creator, official team affiliation.
- **Cross-platform pull if visible** — TikTok, YouTube, podcasts.

Do not editorialize about whether the creator is a good fit — that's the user's call. Report what's observably true.

## Assemble the CSV

Build the final CSV with the exact column order listed under "Output" above. Values:

- **Name** — `fullName` from Step 4 (fall back to Username if empty).
- **Username** — no `@` prefix.
- **Instagram Link** — `https://www.instagram.com/{username}/`.
- **Content Pillar** — verbatim from user input.
- **Campaign** — verbatim from user input.
- **Business Email** — `businessEmail` from Step 4, or `""` if none.
- **Followers** — integer, comma-formatted in the CSV (e.g., `123,456`).
- **Reels Pulled** — integer count.
- **Posting Cadence (reels/wk)** — one decimal place.
- **Date Range** — `YYYY-MM-DD to YYYY-MM-DD`.
- **Avg / Median / Max Views** — integers from Step 6.
- **Views Source** — from Step 5.
- **Content Type Summary** — from Step 11.
- **Top Reel #N Link** — `https://www.instagram.com/reel/{shortCode}/`.
- **Top Reel #N Views** — integer.
- **Top Reel #N Description** — from Step 10.

Save the CSV to `C:\Users\camer\Downloads\COWORK\CLAUDE OUTPUTS\<CLIENT>\<CLIENT> - Creator Research - YYYY-MM-DD.csv`, and the below-cadence set to `<CLIENT> - Creator Research - YYYY-MM-DD - below-cadence.csv` if any exist.

Present both files to the user with `mcp__cowork__present_files`.

---

## Step 12 — Import into Creator Manager

The CSV is the hand-off. In the Creator Manager app, open **Creators → Import CSV**, pick the file, check the preview (it shows which creators are new, which campaigns it will create from the `Campaign` column, and any rows it can't read), then click **Import**.

The import matches creators on their Instagram handle within the client and never overwrites stage, conversation, agreement, shipping or posted videos — re-importing research for a creator who is already shipping leaves their pipeline untouched. New creators start in **To contact**.

**View-count caveat.** The `Views Source` column carries through: rows scraped from the Chrome grid land as `ig_public_chrome` (trustworthy), Apify fallbacks as `apify` (provisional, shown as "estimated"). The app never replaces a verified number with an estimate — do not relabel them.

---

## Guardrails and gotchas

1. **Apify videoPlayCount ≠ Instagram public Views.** THE #1 mistake. Always run the Chrome grid scrape in Step 5.
2. **Signed CDN links expire.** Download videos immediately after each Apify pull — do not defer.
3. **Chrome grid overlays only render on active-Reels accounts.** Small or new accounts fall back to Apify with `Views Source` labelled accordingly.
4. **Reel metadata sometimes missing.** Instagram occasionally returns a page for a reel URL while Apify only echoes back `{"url": ...}`. Skip cleanly.
5. **Grid selector drift.** The selector `a[href*="/reel/"] svg[aria-label="View Count Icon"]` is current as of writing. Spot-check three known reels per profile before trusting the run.
6. **Long-load profiles.** Some profiles (802garage-style, 300+ reels) need 8+ scrolls before the grid is fully hydrated. If the parsed map has fewer entries than the visible grid, scroll more.
7. **Output location.** All deliverables land under `C:\Users\camer\Downloads\COWORK\CLAUDE OUTPUTS\<CLIENT>\`. Follow the file naming convention `<CLIENT> - Creator Research - YYYY-MM-DD.csv`.
