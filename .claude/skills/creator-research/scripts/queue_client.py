#!/usr/bin/env python3
"""
Client for the Creator Manager research-request queue — the "Full Analysis"
button's Tier-2 half. Someone clicks Full Analysis in the app; the server runs
an instant Apify-only pass immediately (labelled `est` throughout the UI) and
queues a request here for the real creator-research pipeline (Chrome grid
scrape, vision descriptions) to run wherever this script executes.

Subcommands:
    queue_client.py --list                       list open (queued) requests
    queue_client.py --claim <request-id>          mark a request "running"
    queue_client.py --complete <request-id> [--research-run-id <id>]
    queue_client.py --fail <request-id> --error "<message>"

Environment (same as push_to_creator_manager.py):
    CM_API_URL   base URL of the app (e.g. http://localhost:3002)
    CM_API_KEY   an API key created under Settings -> API keys

Typical loop (see SKILL.md "Queue mode"): --list, then for each request run
the 11-step pipeline for that one handle under the given campaign, push via
push_to_creator_manager.py, then --complete (or --fail on error).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def _env():
    api_url = os.environ.get("CM_API_URL")
    api_key = os.environ.get("CM_API_KEY")
    if not api_url or not api_key:
        print("CM_API_URL and CM_API_KEY must be set in the environment.", file=sys.stderr)
        sys.exit(1)
    return api_url.rstrip("/"), api_key


def _request(method, path, api_url, api_key, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        f"{api_url}{path}",
        data=data,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"{method} {path} failed (HTTP {e.code}): {e.read().decode('utf-8')[:400]}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Could not reach {api_url}: {e.reason}", file=sys.stderr)
        sys.exit(1)


def cmd_list(api_url, api_key):
    body = _request("GET", "/api/research-requests", api_url, api_key)
    requests_ = body.get("requests", [])
    if not requests_:
        print("No queued requests.")
        return
    for r in requests_:
        print(
            f"{r['requestId']}\t{r['clientSlug']}\t{r['campaignName']}\t"
            f"@{r['username']}\t{r['name']}\t{r.get('contentPillar') or ''}"
        )


def cmd_patch(request_id, status, api_url, api_key, error=None, research_run_id=None):
    payload = {"status": status}
    if error is not None:
        payload["error"] = error
    if research_run_id is not None:
        payload["researchRunId"] = research_run_id
    body = _request("PATCH", f"/api/research-requests/{request_id}", api_url, api_key, payload)
    print(f"{request_id} -> {body['request']['status']}")


def main():
    ap = argparse.ArgumentParser()
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--list", action="store_true", help="list queued requests, tab-separated")
    group.add_argument("--claim", metavar="REQUEST_ID", help="mark a request running")
    group.add_argument("--complete", metavar="REQUEST_ID", help="mark a request completed")
    group.add_argument("--fail", metavar="REQUEST_ID", help="mark a request failed")
    ap.add_argument("--error", help="error message for --fail")
    ap.add_argument("--research-run-id", help="cm_research_runs id produced by the push step, for --complete")
    args = ap.parse_args()

    api_url, api_key = _env()

    if args.list:
        cmd_list(api_url, api_key)
    elif args.claim:
        cmd_patch(args.claim, "running", api_url, api_key)
    elif args.complete:
        cmd_patch(args.complete, "completed", api_url, api_key, research_run_id=args.research_run_id)
    elif args.fail:
        if not args.error:
            print("--fail requires --error \"<message>\"", file=sys.stderr)
            sys.exit(1)
        cmd_patch(args.fail, "failed", api_url, api_key, error=args.error)


if __name__ == "__main__":
    main()
