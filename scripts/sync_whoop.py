#!/usr/bin/env python3
"""
Sync WHOOP sleep data into js/data.js.

Reads WHOOP_REFRESH_TOKEN from the environment (or .env.local for local dev),
fetches sleep records via the WHOOP v2 API, maps them to the dashboard schema,
and overwrites the sleepData array in js/data.js.  After a successful token
refresh the new refresh token is persisted automatically:
  - In CI (GitHub Actions): written back to the WHOOP_REFRESH_TOKEN secret
  - Locally: written back to .env.local in the project root

Required credentials (GitHub Actions secrets or .env.local):
  WHOOP_CLIENT_ID      - WHOOP app client ID
  WHOOP_CLIENT_SECRET  - WHOOP app client secret
  WHOOP_REFRESH_TOKEN  - current refresh token (auto-rotated each run)

Required only in CI (for GitHub Secrets rotation):
  GH_PAT               - GitHub PAT with repo + secrets:write scopes
  GH_REPO              - "owner/repo"  e.g. "dlman/macros-dashboard"

Usage:
  python scripts/sync_whoop.py            # works locally with .env.local
  python scripts/sync_whoop.py --dry-run  # preview without writing
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import requests

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TOKEN_URL    = "https://api.prod.whoop.com/oauth/oauth2/token"
SLEEP_URL    = "https://api.prod.whoop.com/developer/v2/activity/sleep"
GITHUB_API   = "https://api.github.com"

# Fetch sleep back to this date (covers full dashboard history)
FETCH_FROM   = "2026-01-01T00:00:00.000Z"
DEFAULT_TIMEZONE = "America/New_York"

ROOT         = Path(__file__).resolve().parents[1]
DATA_JS_PATH = ROOT / "js" / "data.js"
ENV_LOCAL    = ROOT / ".env.local"


# ---------------------------------------------------------------------------
# Local dev: .env.local loader
# ---------------------------------------------------------------------------

def load_env_local() -> None:
    """
    Load KEY=VALUE pairs from .env.local into os.environ (without overwriting
    values already set by the shell or CI).  Called once at startup so the
    script works identically whether run via GitHub Actions or locally.
    """
    if not ENV_LOCAL.exists():
        return
    with ENV_LOCAL.open() as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


def persist_token_locally(new_token: str) -> None:
    """
    Write the rotated WHOOP_REFRESH_TOKEN back to .env.local so subsequent
    local runs use the fresh token automatically.
    """
    lines: list[str] = []
    replaced = False
    if ENV_LOCAL.exists():
        for raw in ENV_LOCAL.read_text().splitlines():
            if raw.startswith("WHOOP_REFRESH_TOKEN="):
                lines.append(f"WHOOP_REFRESH_TOKEN={new_token}")
                replaced = True
            else:
                lines.append(raw)
    if not replaced:
        lines.append(f"WHOOP_REFRESH_TOKEN={new_token}")
    ENV_LOCAL.write_text("\n".join(lines) + "\n")
    print(f"  ✓ Rotated WHOOP_REFRESH_TOKEN written to .env.local")


# ---------------------------------------------------------------------------
# WHOOP auth
# ---------------------------------------------------------------------------

def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    """Exchange a refresh token for a fresh access + refresh token pair."""
    resp = requests.post(TOKEN_URL, data={
        "grant_type":    "refresh_token",
        "refresh_token": refresh_token,
        "client_id":     client_id,
        "client_secret": client_secret,
        "scope":         "offline read:sleep read:recovery read:cycles read:body_measurement",
    }, timeout=15)
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# GitHub Secrets update  (keeps the rotated refresh token alive)
# ---------------------------------------------------------------------------

def _encrypt_secret(public_key_b64: str, secret_value: str) -> str:
    """Encrypt secret_value with the repo's libsodium public key."""
    try:
        from nacl import encoding, public as nacl_public
    except ImportError:
        sys.exit("PyNaCl is required to update GitHub Secrets. Run: pip install PyNaCl")

    pk = nacl_public.PublicKey(public_key_b64.encode(), encoding.Base64Encoder())
    box = nacl_public.SealedBox(pk)
    encrypted = box.encrypt(secret_value.encode())
    return base64.b64encode(encrypted).decode()


def update_github_secret(repo: str, secret_name: str, value: str, pat: str) -> None:
    """Upsert a GitHub Actions secret via the REST API."""
    headers = {
        "Authorization":        f"Bearer {pat}",
        "Accept":               "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    # Fetch the repo's public key (needed to encrypt the secret)
    key_resp = requests.get(
        f"{GITHUB_API}/repos/{repo}/actions/secrets/public-key",
        headers=headers, timeout=10,
    )
    key_resp.raise_for_status()
    key_data = key_resp.json()

    encrypted = _encrypt_secret(key_data["key"], value)

    put_resp = requests.put(
        f"{GITHUB_API}/repos/{repo}/actions/secrets/{secret_name}",
        headers=headers,
        json={"encrypted_value": encrypted, "key_id": key_data["key_id"]},
        timeout=10,
    )
    put_resp.raise_for_status()
    print(f"  ✓ GitHub secret {secret_name} updated")


# ---------------------------------------------------------------------------
# WHOOP sleep fetch
# ---------------------------------------------------------------------------

def fetch_all_sleep(access_token: str, start: str) -> list[dict]:
    """Fetch all sleep records since `start` (ISO-8601), skipping naps."""
    headers = {"Authorization": f"Bearer {access_token}"}
    records: list[dict] = []
    next_token: str | None = None

    while True:
        params: dict[str, Any] = {"limit": 25, "start": start}
        if next_token:
            params["nextToken"] = next_token

        resp = requests.get(SLEEP_URL, headers=headers, params=params, timeout=15)
        resp.raise_for_status()
        body = resp.json()

        for rec in body.get("records", []):
            if rec.get("nap"):
                continue  # skip naps — only track main sleep
            if rec.get("score_state") != "SCORED":
                continue  # skip unscored / pending records
            records.append(rec)

        next_token = body.get("next_token")
        if not next_token:
            break

    print(f"  Fetched {len(records)} scored main-sleep records from WHOOP")
    return records


# ---------------------------------------------------------------------------
# Schema mapping
# ---------------------------------------------------------------------------

def _ms_to_hours(ms: int | None) -> float | None:
    if ms is None:
        return None
    return round(ms / 3_600_000, 2)


def _parse_timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError:
        sys.exit(f"Invalid WHOOP_TIMEZONE value: {name}")


def _format_bedtime(iso: str, tzinfo: ZoneInfo) -> tuple[str, float]:
    """Return ("01:44 AM", 1.73) from an ISO-8601 timestamp."""
    dt = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(tzinfo)
    label = dt.strftime("%-I:%M %p")          # e.g. "1:44 AM"
    label = label.replace(" 0", " ")          # normalise single-digit hours
    hour_decimal = round(dt.hour + dt.minute / 60, 2)
    return label, hour_decimal


def whoop_record_to_row(rec: dict, tzinfo: ZoneInfo) -> dict | None:
    """Map a WHOOP sleep record to the dashboard sleepData schema."""
    score = rec.get("score") or {}
    stages = score.get("stage_summary") or {}

    # Use the wake-up date (end of sleep) as the record's date
    end_iso = rec.get("end")
    if not end_iso:
        return None
    end_dt  = datetime.fromisoformat(end_iso.replace("Z", "+00:00")).astimezone(tzinfo)
    date    = end_dt.strftime("%Y-%m-%d")

    start_iso = rec.get("start")
    if not start_iso:
        return None
    bedtime, bedtime_hour = _format_bedtime(start_iso, tzinfo)

    deep  = _ms_to_hours(stages.get("total_slow_wave_sleep_time_milli"))
    rem   = _ms_to_hours(stages.get("total_rem_sleep_time_milli"))
    light = _ms_to_hours(stages.get("total_light_sleep_time_milli"))

    # Total sleep = sum of sleep stages (excludes time awake in bed)
    if deep is not None and rem is not None and light is not None:
        hours = round(deep + rem + light, 2)
    else:
        hours = None

    perf       = score.get("sleep_performance_percentage")
    efficiency = score.get("sleep_efficiency_percentage")
    resp       = score.get("respiratory_rate")

    # Require the fields the dashboard always renders
    if any(v is None for v in [perf, hours, efficiency, resp]):
        return None

    return {
        "date":         date,
        "perf":         int(round(perf)),
        "hours":        hours,
        "bedtime":      bedtime,
        "bedtime_hour": bedtime_hour,
        "deep":         deep,
        "rem":          rem,
        "light":        light,
        "efficiency":   int(round(efficiency)),
        "resp":         round(resp, 1),
    }


# ---------------------------------------------------------------------------
# js/data.js patch
# ---------------------------------------------------------------------------

def _serialize_sleep_row(row: dict) -> str:
    """Serialise a sleep row to the compact JS object literal format."""
    def fmt(v: Any) -> str:
        if v is None:        return "null"
        if isinstance(v, str): return json.dumps(v)
        if isinstance(v, bool): return "true" if v else "false"
        if isinstance(v, int): return str(v)
        f = float(v)
        if f.is_integer(): return str(int(f))
        return format(f, ".2f").rstrip("0").rstrip(".")

    fields = [
        f'date:{fmt(row["date"])}',
        f'perf:{fmt(row["perf"])}',
        f'hours:{fmt(row["hours"])}',
        f'bedtime:{fmt(row["bedtime"])}',
        f'bedtime_hour:{fmt(row["bedtime_hour"])}',
        f'deep:{fmt(row["deep"])}',
        f'rem:{fmt(row["rem"])}',
        f'light:{fmt(row["light"])}',
        f'efficiency:{fmt(row["efficiency"])}',
        f'resp:{fmt(row["resp"])}',
    ]
    return "{" + ",".join(fields) + "}"


def patch_sleep_data(path: Path, rows: list[dict], dry_run: bool = False) -> bool:
    """Replace the sleepData array in data.js. Returns True if file changed."""
    src = path.read_text(encoding="utf-8")

    serialized = ",\n  ".join(_serialize_sleep_row(r) for r in rows)
    new_block   = f"const sleepData = [\n  {serialized}\n];"

    # Replace existing sleepData block
    patched, n = re.subn(
        r"const sleepData = \[[\s\S]*?\];",
        new_block,
        src,
        count=1,
    )
    if n == 0:
        print("  WARNING: could not find sleepData block in data.js — no changes written")
        return False

    if patched == src:
        print("  sleepData unchanged — nothing to write")
        return False

    if dry_run:
        print("  DRY RUN — would update sleepData with", len(rows), "rows")
        return True

    path.write_text(patched, encoding="utf-8")
    print(f"  ✓ Wrote {len(rows)} sleep rows → {path}")
    return True


# ---------------------------------------------------------------------------
# Merge: keep existing rows that WHOOP doesn't cover
# ---------------------------------------------------------------------------

def parse_existing_sleep(path: Path) -> list[dict]:
    src = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{date:"(?P<date>\d{4}-\d{2}-\d{2})",perf:(?P<perf>[0-9.]+),hours:(?P<hours>[0-9.]+),'
        r'bedtime:"(?P<bedtime>[^"]+)",bedtime_hour:(?P<bedtime_hour>[0-9.]+),'
        r'deep:(?P<deep>[0-9.]+),rem:(?P<rem>[0-9.]+),light:(?P<light>[0-9.]+),'
        r'efficiency:(?P<efficiency>[0-9.]+),resp:(?P<resp>[0-9.]+)\}'
    )
    return [
        {
            "date":         m.group("date"),
            "perf":         int(round(float(m.group("perf")))),
            "hours":        float(m.group("hours")),
            "bedtime":      m.group("bedtime"),
            "bedtime_hour": float(m.group("bedtime_hour")),
            "deep":         float(m.group("deep")),
            "rem":          float(m.group("rem")),
            "light":        float(m.group("light")),
            "efficiency":   int(round(float(m.group("efficiency")))),
            "resp":         float(m.group("resp")),
        }
        for m in pattern.finditer(src)
    ]


def merge_sleep_rows(existing: list[dict], fresh: list[dict]) -> list[dict]:
    """
    WHOOP data takes precedence.  Existing rows for dates not covered by
    WHOOP (e.g. manual entries before the API integration) are kept.
    """
    by_date: dict[str, dict] = {r["date"]: r for r in existing}
    for row in fresh:
        by_date[row["date"]] = row  # overwrite with WHOOP data
    merged = sorted(by_date.values(), key=lambda r: r["date"])
    return merged


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Sync WHOOP sleep data into js/data.js")
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing")
    args = parser.parse_args()

    # ── Load .env.local for local dev (no-op in CI where secrets are injected) ─
    load_env_local()

    # ── Read secrets from environment ────────────────────────────────────────
    def require_env(name: str) -> str:
        v = os.environ.get(name, "").strip()
        if not v:
            sys.exit(f"Missing required environment variable: {name}")
        return v

    def optional_env(name: str) -> str:
        return os.environ.get(name, "").strip()

    client_id     = require_env("WHOOP_CLIENT_ID")
    client_secret = require_env("WHOOP_CLIENT_SECRET")
    refresh_token = require_env("WHOOP_REFRESH_TOKEN")
    gh_pat        = optional_env("GH_PAT")
    gh_repo       = optional_env("GH_REPO")

    # Detect local vs CI mode
    is_local = not (gh_pat and gh_repo)
    if is_local:
        print("Running in LOCAL mode — rotated tokens will be saved to .env.local")
    else:
        print(f"Running in CI mode — rotated tokens will update GitHub secret ({gh_repo})")

    whoop_timezone = os.environ.get("WHOOP_TIMEZONE", DEFAULT_TIMEZONE).strip() or DEFAULT_TIMEZONE
    tzinfo = _parse_timezone(whoop_timezone)
    print(f"Using WHOOP timezone: {whoop_timezone}")

    # ── Refresh access token ──────────────────────────────────────────────────
    print("Refreshing WHOOP access token …")
    try:
        tokens = refresh_access_token(client_id, client_secret, refresh_token)
    except requests.HTTPError as exc:
        sys.exit(f"Token refresh failed: {exc}\nYou may need to re-run whoop_auth.py to get a new refresh token.")

    access_token      = tokens["access_token"]
    new_refresh_token = tokens.get("refresh_token", refresh_token)
    print(f"  ✓ Access token valid for {tokens.get('expires_in', '?')}s")

    # ── Persist the rotated refresh token ────────────────────────────────────
    if new_refresh_token != refresh_token:
        if is_local:
            print("Refresh token rotated — saving to .env.local …")
            if not args.dry_run:
                persist_token_locally(new_refresh_token)
            else:
                print("  DRY RUN — would update WHOOP_REFRESH_TOKEN in .env.local")
        else:
            print("Refresh token rotated — updating GitHub secret …")
            if not args.dry_run:
                update_github_secret(gh_repo, "WHOOP_REFRESH_TOKEN", new_refresh_token, gh_pat)
            else:
                print("  DRY RUN — would update WHOOP_REFRESH_TOKEN secret")

    # ── Fetch sleep data ──────────────────────────────────────────────────────
    print(f"Fetching WHOOP sleep data since {FETCH_FROM} …")
    records = fetch_all_sleep(access_token, FETCH_FROM)

    # ── Map to dashboard schema ───────────────────────────────────────────────
    fresh_rows: list[dict] = []
    skipped = 0
    for rec in records:
        row = whoop_record_to_row(rec, tzinfo)
        if row:
            fresh_rows.append(row)
        else:
            skipped += 1

    fresh_rows.sort(key=lambda r: r["date"])
    print(f"  Mapped {len(fresh_rows)} rows ({skipped} skipped — incomplete score data)")

    # ── Merge with existing data ──────────────────────────────────────────────
    print("Reading existing sleep data from js/data.js …")
    existing_rows = parse_existing_sleep(DATA_JS_PATH)
    print(f"  Found {len(existing_rows)} existing rows")

    merged = merge_sleep_rows(existing_rows, fresh_rows)
    print(f"  Merged total: {len(merged)} rows")

    # ── Patch data.js ─────────────────────────────────────────────────────────
    print("Patching js/data.js …")
    patch_sleep_data(DATA_JS_PATH, merged, dry_run=args.dry_run)

    print("\nDone. Run  python update_bayes.py js/data.js  to refresh Bayesian estimates.")


if __name__ == "__main__":
    main()
