/*
 * scrape_grid_views.js
 *
 * Paste this into the Claude in Chrome MCP javascript_tool while sitting on
 * an Instagram profile's /reels/ tab. It scrolls the grid to hydrate all
 * tiles, then reads the "Views" overlay from each reel tile and returns a
 * { shortcode: "11.9M" } map.
 *
 * How the extraction works:
 *   - Each reel tile in the grid is an anchor: <a href="/reel/{shortCode}/">
 *   - Instagram overlays the public "Views" count on the tile, marked by a
 *     child <svg aria-label="View Count Icon"> whose sibling <span> holds the
 *     view string (e.g. "11.9M", "324K", "1,204").
 *   - Small accounts and reels that Instagram has not yet activated the
 *     metric on do NOT render the overlay. Those tiles simply won't appear
 *     in the returned map.
 *
 * Usage from Claude in Chrome:
 *   await run_this_file_as_a_single_expression_returning_json();
 *
 * The script is written as an async IIFE that resolves to a JSON-serialisable
 * object, so it works as the sole expression passed to javascript_tool.
 */

(async () => {
  const SCROLL_ROUNDS = 8;             // Enough for ~300 reels; safe cap.
  const SCROLL_PAUSE_MS = 2500;        // Time to let Instagram hydrate tiles.
  const INITIAL_WAIT_MS = 3000;        // Initial page settle.

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  await sleep(INITIAL_WAIT_MS);

  // Scroll to the bottom repeatedly to force lazy-loaded tiles to render.
  let lastHeight = 0;
  let stableRounds = 0;
  for (let i = 0; i < SCROLL_ROUNDS; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(SCROLL_PAUSE_MS);
    const h = document.body.scrollHeight;
    if (h === lastHeight) {
      stableRounds++;
      if (stableRounds >= 2) break; // Two consecutive no-growths = done.
    } else {
      stableRounds = 0;
    }
    lastHeight = h;
  }

  // Extract shortcode -> views map.
  const out = {};
  const anchors = document.querySelectorAll('a[href*="/reel/"]');

  anchors.forEach((a) => {
    // Pull the shortcode out of the href.
    const m = a.getAttribute("href").match(/\/reel\/([^/]+)\//);
    if (!m) return;
    const shortcode = m[1];
    if (out[shortcode]) return; // First occurrence wins.

    // The Views overlay lives near a <svg aria-label="View Count Icon"> inside
    // the tile. Its sibling <span> contains the display string.
    const svg = a.querySelector('svg[aria-label="View Count Icon"]');
    if (!svg) return;

    // Walk up to the icon's parent and look for a span nearby.
    let container = svg.parentElement;
    let text = null;
    for (let depth = 0; depth < 4 && container && !text; depth++) {
      const span = container.querySelector("span");
      if (span && span.textContent && span.textContent.trim()) {
        text = span.textContent.trim();
        break;
      }
      container = container.parentElement;
    }
    if (text) out[shortcode] = text;
  });

  return {
    profileUrl: window.location.href,
    tileCount: anchors.length,
    viewMap: out,
    extractedCount: Object.keys(out).length,
  };
})();
