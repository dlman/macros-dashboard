#!/usr/bin/env python3
"""
Merge Apple Health step rows into js/data.js.

Supports either:
  1. a single day update via --date / --steps
  2. a JSON payload via --payload-json

Examples:
  python scripts/sync_steps.py --date 2026-04-21 --steps 8450
  python scripts/sync_steps.py --payload-json '[{"date":"2026-04-20","steps":7544},{"date":"2026-04-21","steps":8450}]'

Environment variables are also supported so GitHub Actions and Apple Shortcuts
can pass values without shell-escaping headaches:
  APPLE_STEPS_DATE
  APPLE_STEPS_VALUE
  APPLE_STEPS_PAYLOAD_JSON
"""

from __future__ import annotations

import argparse
import json
import os
from collections import OrderedDict
from pathlib import Path
from typing import Any

from sync_google_sheets import (
    DATA_JS_PATH,
    extract_bayes_block,
    parse_date,
    parse_existing_macro_data,
    parse_existing_recovery_data,
    parse_existing_sleep_data,
    parse_existing_steps_data,
    render_data_js,
)


def _parse_steps_value(value: Any) -> int:
    if value in (None, "", "null"):
        raise SystemExit("Step payload is missing a steps value.")
    try:
        steps = int(round(float(str(value).strip().replace(",", ""))))
    except ValueError as exc:
        raise SystemExit(f"Invalid steps value: {value!r}") from exc
    if steps < 0:
        raise SystemExit(f"Steps must be non-negative, got {steps}.")
    return steps


def _normalize_entry(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise SystemExit(f"Each step payload entry must be an object, got {type(raw).__name__}.")
    raw_date = raw.get("date")
    date = parse_date(str(raw_date).strip()) if raw_date is not None else None
    if not date:
        raise SystemExit(f"Invalid or missing date in step payload: {raw!r}")
    raw_steps = raw.get("steps", raw.get("value", raw.get("count")))
    return {"date": date, "steps": _parse_steps_value(raw_steps)}


def _load_payload_entries(payload_json: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(payload_json)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Could not parse payload JSON: {exc}") from exc

    if isinstance(parsed, dict):
        if isinstance(parsed.get("entries"), list):
            entries = parsed["entries"]
        elif isinstance(parsed.get("rows"), list):
            entries = parsed["rows"]
        else:
            entries = [parsed]
    elif isinstance(parsed, list):
        entries = parsed
    else:
        raise SystemExit("Step payload JSON must be either an object or a list of objects.")

    return [_normalize_entry(entry) for entry in entries]


def collect_updates(args: argparse.Namespace) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []

    payload_json = (
        args.payload_json
        or os.getenv("APPLE_STEPS_PAYLOAD_JSON")
        or os.getenv("STEP_ROWS_JSON")
    )
    if payload_json:
        updates.extend(_load_payload_entries(payload_json))

    raw_date = args.date or os.getenv("APPLE_STEPS_DATE")
    raw_steps = (
        args.steps
        if args.steps is not None
        else os.getenv("APPLE_STEPS_VALUE", os.getenv("APPLE_STEPS_STEPS"))
    )
    if raw_date is not None or raw_steps is not None:
        if raw_date is None or raw_steps is None:
            raise SystemExit("Single-day step sync requires both date and steps.")
        updates.append(_normalize_entry({"date": raw_date, "steps": raw_steps}))

    if not updates:
        raise SystemExit("No step updates provided. Use --date/--steps or --payload-json.")

    merged: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for entry in sorted(updates, key=lambda row: row["date"]):
        merged[entry["date"]] = entry
    return list(merged.values())


def merge_steps(existing_rows: list[dict[str, Any]], updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {row["date"]: {"date": row["date"], "steps": int(row["steps"])} for row in existing_rows}
    for entry in updates:
        merged[entry["date"]] = {"date": entry["date"], "steps": int(entry["steps"])}
    return [merged[date] for date in sorted(merged)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge Apple Health steps into js/data.js.")
    parser.add_argument("--output", default=str(DATA_JS_PATH))
    parser.add_argument("--date", help="Single date to update, e.g. 2026-04-21")
    parser.add_argument("--steps", help="Single steps value to merge for --date")
    parser.add_argument("--payload-json", help="JSON list/object of step rows")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()

    output_path = Path(args.output).resolve()
    updates = collect_updates(args)

    print("Reading existing data.js …")
    macro_buckets = parse_existing_macro_data(output_path)
    existing_sleep = parse_existing_sleep_data(output_path)
    existing_steps = parse_existing_steps_data(output_path)
    existing_recovery = parse_existing_recovery_data(output_path)
    bayes_block = extract_bayes_block(output_path)

    merged_steps = merge_steps(existing_steps, updates)
    output = render_data_js(macro_buckets, existing_sleep, merged_steps, existing_recovery, bayes_block)

    latest = updates[-1]
    print(
        f"Merging {len(updates)} Apple step row(s): "
        f"{updates[0]['date']} → {latest['date']} "
        f"(latest {latest['steps']:,} steps)"
    )

    if args.dry_run:
        print("\n--- DRY RUN ---")
        for entry in updates:
            print(f"  {entry['date']}: {entry['steps']:,} steps")
        print(f"\nWould write {len(merged_steps)} total step rows to {output_path}")
        return

    output_path.write_text(output, encoding="utf-8")
    print(f"✓ Wrote {len(merged_steps)} total step rows → {output_path}")
    print("Next: run  python update_bayes.py js/data.js  to refresh Bayesian estimates.")


if __name__ == "__main__":
    main()
