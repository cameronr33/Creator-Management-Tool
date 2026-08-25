#!/usr/bin/env python3
"""
Client for the Creator Manager email sync — the app side of the Gmail
tracking loop. Claude reads mail through the connected Gmail MCP tools (this
script can NOT — MCP is only available to Claude interactively); this script
only talks to the Creator Manager API.

Subcommands:
    email_client.py --roster              print the creator contact list (JSON)
    email_client.py --push <json-file>    POST normalized messages to /api/emails/ingest

Environment (same as queue_client.py / push_to_creator_manager.py):
    CM_API_URL   base URL of the app (e.g. http://localhost:3002)
    CM_API_KEY   an API key created under Settings -> API keys

The push file is a JSON array of message objects:
    [{"externalId": "<gmail message id>", "threadId": "<gmail thread id>",
      "occurredAt": "<ISO date>", "from": "addr", "to": ["addr"], "cc": ["addr"],
      "subject": "...", "bodyText": "..."}]

Pushing is idempotent — the server dedupes on externalId, so re-sending a
window of messages is safe and expected.
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
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        print(f"HTTP {e.code} from {path}: {detail}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Could not reach {api_url}: {e.reason}", file=sys.stderr)
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Creator Manager email-sync client")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--roster", action="store_true", help="print the creator contact list")
    group.add_argument("--push", metavar="JSON_FILE", help="push a normalized message batch")
    args = parser.parse_args()

    api_url, api_key = _env()

    if args.roster:
        data = _request("GET", "/api/emails/roster", api_url, api_key)
        contacts = data.get("contacts", [])
        print(json.dumps(contacts, indent=2))
        print(f"\n{len(contacts)} contact(s) with a business email and an open partnership.", file=sys.stderr)
        return

    if args.push:
        with open(args.push, "r", encoding="utf-8") as f:
            messages = json.load(f)
        if not isinstance(messages, list):
            print("Push file must be a JSON array of message objects.", file=sys.stderr)
            sys.exit(1)
        data = _request("POST", "/api/emails/ingest", api_url, api_key, {"messages": messages})
        print(json.dumps(data, indent=2))
        summary = (
            f"inserted={data.get('inserted', 0)} skipped={data.get('skipped', 0)} "
            f"unmatched={len(data.get('unmatched', []))} "
            f"stage_changes={len(data.get('stageChanges', []))}"
        )
        print(f"\n{summary}", file=sys.stderr)


if __name__ == "__main__":
    main()
