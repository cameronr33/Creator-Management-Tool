#!/usr/bin/env python3
"""
Step 12 of the creator-research pipeline: push a finished research CSV into the
Creator Manager app via its ingest API.

Usage:
    python push_to_creator_manager.py \
        --csv "<CLIENT> - Creator Research - YYYY-MM-DD.csv" \
        --client <client-slug> \
        --campaign "<Campaign name>"

Environment:
    CM_API_URL   base URL of the app (e.g. http://localhost:3002)
    CM_API_KEY   an API key created under Settings -> API keys

The CSV write is the fallback: if this push fails, the file is still on disk and
can be uploaded via the app's Import page.
"""
import argparse
import csv
import json
import os
import re
import sys
import urllib.request
import urllib.error


def to_int(value):
    if value is None:
        return None
    cleaned = re.sub(r"[,\s]", "", str(value))
    if cleaned == "":
        return None
    try:
        return int(round(float(cleaned)))
    except ValueError:
        return None


def to_float(value):
    if value is None:
        return None
    cleaned = re.sub(r"[,\s]", "", str(value))
    if cleaned == "":
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def to_views(value):
    """'11.9M' -> 11900000, '324K' -> 324000, '1,204' -> 1204."""
    if value is None:
        return None
    raw = str(value).strip()
    if raw == "":
        return None
    m = re.match(r"^([\d.,]+)\s*([KMB])?$", raw, re.IGNORECASE)
    if not m:
        return to_int(raw)
    n = float(m.group(1).replace(",", ""))
    suffix = (m.group(2) or "").upper()
    mult = {"B": 1e9, "M": 1e6, "K": 1e3}.get(suffix, 1)
    return int(round(n * mult))


def parse_date_range(value):
    raw = (value or "").strip()
    if not raw:
        return None, None
    parts = re.split(r"\s+to\s+", raw, flags=re.IGNORECASE)
    is_date = lambda s: bool(re.match(r"^\d{4}-\d{2}-\d{2}$", (s or "").strip()))
    start = parts[0].strip() if parts and is_date(parts[0]) else None
    end = parts[1].strip() if len(parts) > 1 and is_date(parts[1]) else None
    return start, end


def views_source(raw):
    s = (raw or "").lower()
    if "chrome" in s or "ig public" in s:
        return "ig_public_chrome"
    if "apify" in s:
        return "apify"
    return None


def row_to_creator(row):
    reels = []
    for rank in (1, 2, 3):
        url = (row.get(f"Top Reel #{rank} Link") or "").strip()
        if not url:
            continue
        reels.append({
            "rank": rank,
            "url": url,
            "views": to_views(row.get(f"Top Reel #{rank} Views")),
            "description": (row.get(f"Top Reel #{rank} Description") or "").strip() or None,
        })
    start, end = parse_date_range(row.get("Date Range"))
    return {
        "name": (row.get("Name") or row.get("Username") or "").strip(),
        "username": (row.get("Username") or "").strip(),
        "profileUrl": (row.get("Instagram Link") or "").strip() or None,
        "businessEmail": (row.get("Business Email") or "").strip() or None,
        "contentPillar": (row.get("Content Pillar") or "").strip() or None,
        "followers": to_int(row.get("Followers")),
        "reelsPulled": to_int(row.get("Reels Pulled")),
        "cadencePerWeek": to_float(row.get("Posting Cadence (reels/wk)")),
        "dateRangeStart": start,
        "dateRangeEnd": end,
        "avgViews": to_int(row.get("Avg Views (IG)")),
        "medianViews": to_int(row.get("Median Views (IG)")),
        "maxViews": to_int(row.get("Max Views (IG)")),
        "viewsSource": views_source(row.get("Views Source")),
        "contentTypeSummary": (row.get("Content Type Summary") or "").strip() or None,
        "reels": reels,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--client", required=True, help="client slug, e.g. 'hella'")
    ap.add_argument("--campaign", required=True)
    args = ap.parse_args()

    api_url = os.environ.get("CM_API_URL")
    api_key = os.environ.get("CM_API_KEY")
    if not api_url or not api_key:
        print("CM_API_URL and CM_API_KEY must be set in the environment.", file=sys.stderr)
        sys.exit(1)

    with open(args.csv, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if (r.get("Username") or "").strip()]

    creators = [row_to_creator(r) for r in rows]
    if not creators:
        print("No creator rows found in CSV.", file=sys.stderr)
        sys.exit(1)

    payload = {"client": args.client, "campaign": args.campaign, "creators": creators}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{api_url.rstrip('/')}/api/ingest/research",
        data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            print(f"Pushed {len(creators)} creators: "
                  f"+{body.get('created', 0)} new, {body.get('updated', 0)} updated.")
    except urllib.error.HTTPError as e:
        print(f"Ingest failed (HTTP {e.code}): {e.read().decode('utf-8')[:400]}", file=sys.stderr)
        print("The CSV is still on disk — upload it via the app's Import page instead.", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Could not reach {api_url}: {e.reason}", file=sys.stderr)
        print("The CSV is still on disk — upload it via the app's Import page instead.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
