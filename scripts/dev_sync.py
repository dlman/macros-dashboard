#!/usr/bin/env python3
"""
Local development sync — mirrors the GitHub Actions pipeline.

Runs the same three steps as update-data.yml, in order:
  1. sync_google_sheets.py  — pull macro data from Google Sheets CSVs
  2. sync_whoop.py          — pull sleep data from WHOOP API
  3. update_bayes.py        — rebuild Bayesian TDEE estimates

Credentials are read from .env.local in the project root (for WHOOP).
Google Sheets sync needs no credentials (public CSV URLs).

Setup (one-time):
  1. Run  python scripts/whoop_auth.py  to get your first refresh token
  2. Copy .env.local.example → .env.local and fill in your credentials
  3. Install deps:  pip install -r requirements-sync.txt

Usage:
  python scripts/dev_sync.py              # full sync
  python scripts/dev_sync.py --dry-run    # preview only, no writes
  python scripts/dev_sync.py --skip-whoop # sheets + bayes only
  python scripts/dev_sync.py --skip-bayes # sheets + whoop only
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str], label: str) -> bool:
    """Run a command, print output, return True on success."""
    print(f"\n{'─' * 60}")
    print(f"▶  {label}")
    print(f"{'─' * 60}")
    start = time.monotonic()
    result = subprocess.run(cmd, cwd=ROOT)
    elapsed = time.monotonic() - start
    status = "✓" if result.returncode == 0 else "✗"
    print(f"{status}  {label} ({elapsed:.1f}s)")
    return result.returncode == 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Local dashboard sync (mirrors CI pipeline)")
    parser.add_argument("--dry-run",    action="store_true", help="Preview changes without writing files")
    parser.add_argument("--skip-whoop", action="store_true", help="Skip WHOOP sleep sync")
    parser.add_argument("--skip-bayes", action="store_true", help="Skip Bayesian rebuild")
    args = parser.parse_args()

    python = sys.executable
    dry = ["--dry-run"] if args.dry_run else []
    results: dict[str, bool] = {}

    # ── Step 1: Google Sheets ────────────────────────────────────────────────
    ok = run([python, "scripts/sync_google_sheets.py"] + dry, "Sync Google Sheets → macro data")
    results["sheets"] = ok

    # ── Step 2: WHOOP sleep ──────────────────────────────────────────────────
    if not args.skip_whoop:
        env_local = ROOT / ".env.local"
        if not env_local.exists():
            print("\n⚠  .env.local not found — skipping WHOOP sync")
            print(   "   Copy .env.local.example → .env.local and fill in your credentials,")
            print(   "   then run  python scripts/whoop_auth.py  to get a refresh token.")
            results["whoop"] = False
        else:
            ok = run([python, "scripts/sync_whoop.py"] + dry, "Sync WHOOP → sleep data")
            results["whoop"] = ok
    else:
        print("\n⏭  Skipping WHOOP sync (--skip-whoop)")

    # ── Step 3: Bayesian rebuild ─────────────────────────────────────────────
    if not args.skip_bayes:
        if not args.dry_run:
            ok = run([python, "update_bayes.py", "js/data.js"], "Rebuild Bayesian TDEE estimates")
            results["bayes"] = ok
        else:
            print("\n⏭  Skipping Bayesian rebuild in --dry-run mode")
    else:
        print("\n⏭  Skipping Bayesian rebuild (--skip-bayes)")

    # ── Summary ──────────────────────────────────────────────────────────────
    print(f"\n{'═' * 60}")
    print("SYNC SUMMARY")
    print(f"{'═' * 60}")
    for step, ok in results.items():
        icon = "✓" if ok else "✗"
        print(f"  {icon}  {step}")

    any_failed = any(not ok for ok in results.values())
    if any_failed:
        print("\nSome steps failed — check output above.")
        sys.exit(1)
    else:
        if args.dry_run:
            print("\nDry run complete — no files were modified.")
        else:
            print("\nAll done! Open index.html in your browser to verify.")
            print("Tip: python -m http.server 8000  →  http://localhost:8000")


if __name__ == "__main__":
    main()
