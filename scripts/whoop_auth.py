#!/usr/bin/env python3
"""
One-time WHOOP OAuth flow — run this locally to get your initial refresh token.

Usage:
  python scripts/whoop_auth.py

You will be prompted for your WHOOP client_id and client_secret, then your
browser will open for you to log in and authorise the app. The script catches
the redirect automatically and prints your refresh token.

After running this once:
  1. Add WHOOP_CLIENT_ID      as a GitHub Actions secret
  2. Add WHOOP_CLIENT_SECRET  as a GitHub Actions secret
  3. Add WHOOP_REFRESH_TOKEN  as a GitHub Actions secret  (the token printed here)
  4. Add GH_PAT               as a GitHub Actions secret  (PAT with secrets:write)
  5. Add GH_REPO              as a GitHub Actions secret  (e.g. "dicksonluong/macros-dashboard")
"""

from __future__ import annotations

import json
import sys
import threading
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

import secrets

import requests

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


def main() -> None:
    print("=== WHOOP One-Time OAuth Setup ===\n")
    client_id     = input("Paste your WHOOP client_id:     ").strip()
    client_secret = input("Paste your WHOOP client_secret: ").strip()

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

    print("\n" + "=" * 60)
    print("SUCCESS — save these as GitHub Actions secrets:")
    print("=" * 60)
    print(f"\n  WHOOP_CLIENT_ID      = {client_id}")
    print(f"  WHOOP_CLIENT_SECRET  = {client_secret}")
    print(f"  WHOOP_REFRESH_TOKEN  = {refresh_token}")
    print(f"\n  (access token expires in {expires_in}s — the sync script rotates it automatically)")
    print("\nAlso add:")
    print("  GH_PAT   = a GitHub PAT with repo + secrets:write scopes")
    print("  GH_REPO  = owner/repo  e.g. dicksonluong/macros-dashboard")
    print("=" * 60)


if __name__ == "__main__":
    main()
