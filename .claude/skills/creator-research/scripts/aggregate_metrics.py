#!/usr/bin/env python3
"""
aggregate_metrics.py

Reads a raw Apify `apify/instagram-scraper` dataset (a JSON list of reel dicts)
and emits per-creator summary stats + a first-pass top-3 shortlist. The rest of
the creator-research pipeline consumes this JSON.

The output view counts here are based on Apify's videoPlayCount. Step 5 of the
skill replaces them with real Instagram public "Views" via Chrome scrape; this
script only produces the pre-scrape shortlist and cadence stats.

Usage:
    python aggregate_metrics.py \\
        --apify-json ./scratch/apify_reels_raw.json \\
        --out-json ./scratch/creator_summary.json

Output shape:
    {
      "generated_at": "2026-07-01T18:00:00Z",
      "source_reel_count": 240,
      "creators": {
        "someuser": {
          "reel_count": 30,
          "avg_views_apify": 12345,
          "median_views_apify": 9876,
          "max_views_apify": 100000,
          "date_oldest": "2025-01-14",
          "date_newest": "2026-06-27",
          "span_days": 529,
          "cadence_per_week": 0.4,
          "top_3_shortcodes_apify": ["ABC", "DEF", "GHI"],
          "reels": [
            {"shortCode": "...", "timestamp": "...", "videoPlayCount": 123,
             "likesCount": 1, "commentsCount": 0, "videoDuration": 15.0,
             "caption": "...", "videoUrl": "...", "hashtags": [], "mentions": []}
          ]
        },
        ...
      }
    }
"""

import argparse
import datetime as dt
import json
import statistics
import sys
from collections import defaultdict


KEEP_FIELDS = (
    "shortCode",
    "timestamp",
    "videoPlayCount",
    "likesCount",
    "commentsCount",
    "videoDuration",
    "caption",
    "videoUrl",
    "ownerUsername",
    "hashtags",
    "mentions",
)


def parse_timestamp(ts):
    if not ts:
        return None
    try:
        # Apify emits ISO 8601 with a "Z" suffix.
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def summarize_creator(username: str, reels: list) -> dict:
    reels_kept = []
    for r in reels:
        reels_kept.append({k: r.get(k) for k in KEEP_FIELDS})

    view_counts = [
        (r.get("videoPlayCount") or 0) for r in reels_kept
    ]
    timestamps = [parse_timestamp(r.get("timestamp")) for r in reels_kept]
    timestamps = [t for t in timestamps if t]

    if timestamps:
        oldest = min(timestamps)
        newest = max(timestamps)
        span_days = max((newest - oldest).days, 1)
        cadence = round(len(reels_kept) / (span_days / 7.0), 2) if span_days else 0.0
        date_oldest = oldest.date().isoformat()
        date_newest = newest.date().isoformat()
    else:
        span_days = 0
        cadence = 0.0
        date_oldest = None
        date_newest = None

    avg_views = int(statistics.fmean(view_counts)) if view_counts else 0
    median_views = int(statistics.median(view_counts)) if view_counts else 0
    max_views = max(view_counts) if view_counts else 0

    top_3 = sorted(
        reels_kept,
        key=lambda r: (r.get("videoPlayCount") or 0),
        reverse=True,
    )[:3]

    return {
        "reel_count": len(reels_kept),
        "avg_views_apify": avg_views,
        "median_views_apify": median_views,
        "max_views_apify": max_views,
        "date_oldest": date_oldest,
        "date_newest": date_newest,
        "span_days": span_days,
        "cadence_per_week": cadence,
        "top_3_shortcodes_apify": [r.get("shortCode") for r in top_3 if r.get("shortCode")],
        "reels": reels_kept,
    }


def main():
    p = argparse.ArgumentParser(description="Aggregate Apify reel dumps into per-creator stats.")
    p.add_argument("--apify-json", required=True, help="Path to the raw Apify dataset JSON.")
    p.add_argument("--out-json", required=True, help="Where to write the summary JSON.")
    args = p.parse_args()

    with open(args.apify_json, "r", encoding="utf-8") as f:
        raw = json.load(f)

    if not isinstance(raw, list):
        print("ERROR: expected Apify JSON to be a list of reel dicts.", file=sys.stderr)
        sys.exit(2)

    # Filter out non-reel entries defensively (e.g., stray posts).
    reels = [r for r in raw if isinstance(r, dict) and r.get("shortCode")]

    grouped = defaultdict(list)
    for r in reels:
        owner = r.get("ownerUsername")
        if not owner:
            continue
        grouped[owner].append(r)

    creators = {u: summarize_creator(u, rs) for u, rs in grouped.items()}

    out = {
        "generated_at": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "source_reel_count": len(reels),
        "creators": creators,
    }

    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"Wrote {args.out_json} — {len(creators)} creators, {len(reels)} reels.")


if __name__ == "__main__":
    main()
