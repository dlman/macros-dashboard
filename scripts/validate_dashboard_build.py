#!/usr/bin/env python3
"""
Pre-publish validation for generated dashboard artifacts.

This keeps the sync/build pipeline from pushing a broken js/data.js or
syntax-invalid app bundle to GitHub Pages.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PY_FILES = [
    ROOT / "update_bayes.py",
    ROOT / "scripts" / "sync_google_sheets.py",
    ROOT / "scripts" / "sync_whoop.py",
    ROOT / "scripts" / "dev_sync.py",
    ROOT / "scripts" / "validate_dashboard_build.py",
]

JS_FILES = [
    ROOT / "js" / "data.js",
    ROOT / "js" / "core.js",
    ROOT / "js" / "charts.js",
    ROOT / "js" / "interactions.js",
]


def run_check(cmd: list[str], label: str) -> None:
    print(f"\n▶ {label}")
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(result.returncode)
    print(f"✓ {label}")


def validate_data_footer() -> None:
    path = ROOT / "js" / "data.js"
    src = path.read_text(encoding="utf-8")

    required_snippets = [
        "const data = {",
        "const sleepData = [",
        "const stepsData = [",
        "const recoveryData = [",
        "window.dashboardData = { data, sleepData, stepsData, recoveryData };",
        "})();",
    ]
    missing = [snippet for snippet in required_snippets if snippet not in src]
    if missing:
        raise SystemExit(f"Missing required data.js snippets: {missing}")

    bayes_starts = src.count("// BAYES_START")
    bayes_ends = src.count("// BAYES_END")
    if bayes_starts != bayes_ends:
        raise SystemExit(f"Mismatched BAYES markers: {bayes_starts} starts vs {bayes_ends} ends")

    bad_footer = re.search(
        r"window\.dashboardData\s*=\s*\{ data, sleepData, stepsData, recoveryData \};\s*\}\s*// BAYES_START",
        src,
    )
    if bad_footer:
        raise SystemExit("Invalid data.js footer: stray closing brace before BAYES_START")

    print("✓ data.js structural footer checks")


def main() -> None:
    print("Validating dashboard build artifacts...")
    for py_file in PY_FILES:
        run_check([sys.executable, "-m", "py_compile", str(py_file)], f"Python syntax: {py_file.relative_to(ROOT)}")
    for js_file in JS_FILES:
        run_check(["node", "--check", str(js_file)], f"JS syntax: {js_file.relative_to(ROOT)}")
    validate_data_footer()
    print("\nAll dashboard validation checks passed.")


if __name__ == "__main__":
    main()
