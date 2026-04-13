#!/usr/bin/env python3
"""
One-time WHOOP OAuth flow — run this locally to get your initial refresh token.

Usage:
  python scripts/whoop_auth.py

Your browser will open for you to log in and authorise the app. The script:
  - Catches the redirect automatically
  - Writes WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REFRESH_TOKEN to .env.local
  - Prints the values for copy-pasting into GitHub Actions secrets

Run this again any time your refresh token is stale (401 errors during sync).
"""

from __future__ import annotations

import json
import os
import secrets
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import requests

ROOT      = Path(__file__).resolve().parents[1]
ENV_LOCAL = ROOT / ".env.local"

REDIRECT_URI = "http://localhost:8080/callback"
TOKEN_URL    = "https://api.prod.whoop.com/oauth/oauth2/token"
AUTH_URL     = "https://api.prod.whoop.com/oauth/oauth2/auth"
SCOPES       = "offline read:sleep read:recovery read:cycles read:body_measurement read:workout"

# Shared state between HTTP handler and main thread
_auth_code: str | None = None
_state_value: str = secrets.token_urlsafe(16)   # CSRF token
_server_done = threading.Event()


class _CallbackHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        global _auth_code
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        # Validate state parameter to prevent CSRF
        returned_state = params.get("state", [None])[0]
        if returned_state != _state_value:
            body = b"<h2>Error: state mismatch. Please try again.</h2>"
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            _server_done.set()
            return

        if "code" in params:
            _auth_code = params["code"][0]
            body = b"<h2>Authorised! You can close this tab.</h2>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif "error" in params:
            error = params.get("error", ["unknown"])[0]
            body = f"<h2>Error: {error}</h2>".encode()
            self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

        _server_done.set()

    def log_message(self, *_):  # silence request logs
        pass


def _start_local_server() -> HTTPServer:
    server = HTTPServer(("localhost", 8080), _CallbackHandler)
    t = threading.Thread(target=server.handle_request, daemon=True)
    t.start()
    return server


def exchange_code(client_id: str, client_secret: str, code: str) -> dict:
    resp = requests.post(TOKEN_URL, data={
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  REDIRECT_URI,
        "client_id":     client_id,
        "client_secret": client_secret,
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


def _read_env_local() -> dict[str, str]:
    """Return key→value pairs from .env.local (if it exists)."""
    result: dict[str, str] = {}
    if not ENV_LOCAL.exists():
        return result
    with ENV_LOCAL.open() as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            result[key.strip()] = val.strip().strip('"').strip("'")
    return result


def write_env_local(updates: dict[str, str]) -> None:
    """
    Upsert keys into .env.local.  Existing lines for those keys are replaced;
    keys not already present are appended.  Comment lines are preserved.
    """
    lines: list[str] = []
    replaced: set[str] = set()

    if ENV_LOCAL.exists():
        for raw in ENV_LOCAL.read_text().splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key = line.partition("=")[0].strip()
                if key in updates:
                    lines.append(f"{key}={updates[key]}")
                    replaced.add(key)
                    continue
            lines.append(raw.rstrip())

    for key, val in updates.items():
        if key not in replaced:
            lines.append(f"{key}={val}")

    ENV_LOCAL.write_text("\n".join(lines) + "\n")


def main() -> None:
    print("=== WHOOP One-Time OAuth Setup ===\n")

    # Pre-fill from .env.local so re-auth doesn't require re-typing credentials
    existing = _read_env_local()

    def prompt(label: str, env_key: str) -> str:
        current = existing.get(env_key, "").strip()
        if current:
            print(f"{label} [found in .env.local, press Enter to keep]: ", end="", flush=True)
            entered = input().strip()
            return entered if entered else current
        return input(f"{label}: ").strip()

    client_id     = prompt("WHOOP client_id    ", "WHOOP_CLIENT_ID")
    client_secret = prompt("WHOOP client_secret", "WHOOP_CLIENT_SECRET")

    if not client_id or not client_secret:
        sys.exit("Both client_id and client_secret are required.")

    params = urllib.parse.urlencode({
        "client_id":     client_id,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "scope":         SCOPES,
        "state":         _state_value,
    })
    auth_url = f"{AUTH_URL}?{params}"

    print("\nStarting local callback server on http://localhost:8080 …")
    _start_local_server()

    print(f"Opening browser → {auth_url}\n")
    webbrowser.open(auth_url)

    print("Waiting for WHOOP to redirect back …")
    _server_done.wait(timeout=120)

    if not _auth_code:
        sys.exit("No auth code received within 2 minutes. Please try again.")

    print("Auth code received. Exchanging for tokens …")
    tokens = exchange_code(client_id, client_secret, _auth_code)

    access_token  = tokens.get("access_token", "")
    refresh_token = tokens.get("refresh_token", "")
    expires_in    = tokens.get("expires_in", "?")

    if not refresh_token:
        print("\nFull token response:")
        print(json.dumps(tokens, indent=2))
        sys.exit("No refresh_token in response — did you include the 'offline' scope?")

    # ── Write credentials to .env.local ──────────────────────────────────────
    write_env_local({
        "WHOOP_CLIENT_ID":     client_id,
        "WHOOP_CLIENT_SECRET": client_secret,
        "WHOOP_REFRESH_TOKEN": refresh_token,
    })
    print(f"\n✓  Credentials written to .env.local")
    print(f"   You can now run:  python scripts/dev_sync.py\n")

    print("=" * 60)
    print("Also update these GitHub Actions secrets (if not already set):")
    print("=" * 60)
    print(f"\n  WHOOP_CLIENT_ID      = {client_id}")
    print(f"  WHOOP_CLIENT_SECRET  = {client_secret}")
    print(f"  WHOOP_REFRESH_TOKEN  = {refresh_token}")
    print(f"\n  (access token expires in {expires_in}s — sync script rotates it automatically)")
    print("=" * 60)


if __name__ == "__main__":
    main()
