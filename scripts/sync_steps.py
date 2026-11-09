#!/usr/bin/env python3
"""
Merge Apple Health step rows into js/data.js.

Supports either:
  1. a single day update via --date / --steps
  2. a JSON payload via --payload-json
  3. an Apple Health export.xml via --apple-health-export

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
import re
import xml.etree.ElementTree as ET
from collections import OrderedDict, defaultdict
from datetime import datetime
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

UREVO_DEFAULT_INCLINE_PCT = 12.0
INCLINE_REFERENCE_WEIGHT_LBS = 150.0
METERS_PER_MILE = 1609.344
KILOGRAMS_PER_POUND = 0.45359237
KCAL_PER_FLAT_STEP = 0.04
UREVO_DEFAULT_MILES_PER_STEP = 0.000255


def parse_existing_vacation_dates(path: Path) -> list[str]:
    src = path.read_text(encoding="utf-8")
    match = re.search(r"const vacationDates = \[(.*?)\];", src, re.S)
    if not match:
        return []
    return re.findall(r'"(\d{4}-\d{2}-\d{2})"', match.group(1))


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


def _parse_nonnegative_float(value: Any, label: str) -> float:
    try:
        parsed = float(str(value).strip().replace(",", ""))
    except ValueError as exc:
        raise SystemExit(f"Invalid {label}: {value!r}") from exc
    if parsed < 0:
        raise SystemExit(f"{label} must be non-negative, got {parsed}.")
    return parsed


def _normalize_entry(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise SystemExit(f"Each step payload entry must be an object, got {type(raw).__name__}.")
    raw_date = raw.get("date")
    date = parse_date(str(raw_date).strip()) if raw_date is not None else None
    if not date:
        raise SystemExit(f"Invalid or missing date in step payload: {raw!r}")
    raw_steps = raw.get("steps", raw.get("value", raw.get("count")))
    steps = _parse_steps_value(raw_steps)
    row: dict[str, Any] = {"date": date, "steps": steps}
    raw_incline_steps = raw.get("inclineSteps", raw.get("urevoSteps"))
    if raw_incline_steps is None and str(raw.get("source", "")).upper() == "UREVO":
        raw_incline_steps = steps
    if raw_incline_steps not in (None, ""):
        incline_steps = _parse_steps_value(raw_incline_steps)
        if incline_steps > steps:
            raise SystemExit(f"UREVO incline steps ({incline_steps}) cannot exceed total steps ({steps}) for {date}.")
        incline_pct = _parse_nonnegative_float(raw.get("inclinePct", UREVO_DEFAULT_INCLINE_PCT), "incline percent")
        distance_miles = _parse_nonnegative_float(
            raw.get("inclineDistanceMi", raw.get("urevoDistanceMi", incline_steps * UREVO_DEFAULT_MILES_PER_STEP)),
            "UREVO incline distance",
        )
        explicit_extra = raw.get("inclineExtraKcal")
        extra_kcal = (_parse_nonnegative_float(explicit_extra, "incline calories") if explicit_extra not in (None, "")
                      else _incline_extra_kcal(distance_miles, incline_steps, incline_pct, INCLINE_REFERENCE_WEIGHT_LBS))
        row.update({
            "inclineSteps": incline_steps,
            "inclinePct": round(incline_pct, 1),
            "inclineDistanceMi": round(distance_miles, 3),
            "inclineExtraKcal": round(extra_kcal),
        })
    return row


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


def _health_timestamp(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S %z")
    except ValueError as exc:
        raise SystemExit(f"Invalid Apple Health timestamp: {value!r}") from exc


def _merged_intervals(samples: list[dict[str, Any]]) -> list[tuple[datetime, datetime]]:
    intervals = sorted((sample["start"], sample["end"]) for sample in samples)
    merged: list[tuple[datetime, datetime]] = []
    for start, end in intervals:
        if not merged or start > merged[-1][1]:
            merged.append((start, end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
    return merged


def _uncovered_fraction(sample: dict[str, Any], preferred_intervals: list[tuple[datetime, datetime]]) -> float:
    start, end = sample["start"], sample["end"]
    duration = (end - start).total_seconds()
    if duration <= 0:
        return 0.0 if any(interval_start <= start <= interval_end for interval_start, interval_end in preferred_intervals) else 1.0
    overlap = sum(
        max(0.0, (min(end, interval_end) - max(start, interval_start)).total_seconds())
        for interval_start, interval_end in preferred_intervals
    )
    return max(0.0, min(1.0, 1.0 - overlap / duration))


def _source_aware_totals(
    samples: list[dict[str, Any]],
    preferred_source: str | None,
) -> tuple[dict[str, float], float, dict[str, float]]:
    sources = {sample["source"] for sample in samples}
    if len(sources) == 1:
        totals: defaultdict[str, float] = defaultdict(float)
        for sample in samples:
            totals[sample["date"]] += sample["value"]
        preferred_totals = dict(totals) if preferred_source in sources else {}
        return dict(totals), 0.0, preferred_totals

    if not preferred_source:
        source_list = ", ".join(sorted(sources))
        raise SystemExit(
            "Apple Health export contains multiple step sources, which may overlap and double-count. "
            f"Found: {source_list}. Pass --preferred-source for an interval-aware merge."
        )
    if preferred_source not in sources:
        raise SystemExit(f"Preferred step source {preferred_source!r} was not found. Available: {', '.join(sorted(sources))}")
    secondary_sources = sources - {preferred_source}
    if len(secondary_sources) > 1:
        raise SystemExit(
            "Interval-aware merging supports one preferred and one secondary step source; "
            f"found secondary sources: {', '.join(sorted(secondary_sources))}"
        )

    preferred_by_date: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for sample in samples:
        if sample["source"] == preferred_source:
            preferred_by_date[sample["date"]].append(sample)

    preferred_intervals = {
        date: _merged_intervals(date_samples)
        for date, date_samples in preferred_by_date.items()
    }
    totals: defaultdict[str, float] = defaultdict(float)
    preferred_totals: defaultdict[str, float] = defaultdict(float)
    excluded_overlap = 0.0
    for sample in samples:
        if sample["source"] == preferred_source:
            totals[sample["date"]] += sample["value"]
            preferred_totals[sample["date"]] += sample["value"]
            continue
        fraction = _uncovered_fraction(sample, preferred_intervals.get(sample["date"], []))
        totals[sample["date"]] += sample["value"] * fraction
        excluded_overlap += sample["value"] * (1.0 - fraction)
    return dict(totals), excluded_overlap, dict(preferred_totals)


def _distance_miles(value: float, unit: str) -> float:
    normalized = unit.strip().lower()
    if normalized == "mi":
        return value
    if normalized == "km":
        return value * 0.621371192
    if normalized == "m":
        return value / METERS_PER_MILE
    raise SystemExit(f"Unsupported Apple Health walking-distance unit: {unit!r}")


def _incline_extra_kcal(
    distance_miles: float,
    incline_steps: float,
    incline_pct: float,
    reference_weight_lbs: float,
) -> float:
    grade = incline_pct / 100.0
    if distance_miles > 0:
        # ACSM walking equation vertical component: 1.8 * speed * grade.
        distance_meters = distance_miles * METERS_PER_MILE
        weight_kg = reference_weight_lbs * KILOGRAMS_PER_POUND
        return 1.8 * distance_meters * grade * weight_kg / 200.0
    # Apple Shortcuts can omit distance; use the observed UREVO stride as fallback.
    estimated_distance_miles = incline_steps * UREVO_DEFAULT_MILES_PER_STEP
    return _incline_extra_kcal(estimated_distance_miles, incline_steps, incline_pct, reference_weight_lbs)


def _load_apple_health_export(
    path: str,
    start_date: str | None = None,
    end_date: str | None = None,
    preferred_source: str | None = None,
    incline_pct: float | None = None,
    reference_weight_lbs: float = INCLINE_REFERENCE_WEIGHT_LBS,
) -> list[dict[str, Any]]:
    export_path = Path(path).expanduser().resolve()
    if not export_path.is_file():
        raise SystemExit(f"Apple Health export not found: {export_path}")

    samples: list[dict[str, Any]] = []
    preferred_distance_miles: defaultdict[str, float] = defaultdict(float)
    sources: set[str] = set()
    for _, element in ET.iterparse(export_path, events=("end",)):
        attrs = element.attrib
        record_type = attrs.get("type")
        if element.tag == "Record" and record_type == "HKQuantityTypeIdentifierStepCount":
            date = parse_date(attrs.get("startDate", "")[:10])
            if date and (not start_date or date >= start_date) and (not end_date or date <= end_date):
                try:
                    value = float(attrs.get("value", "0"))
                except ValueError as exc:
                    raise SystemExit(f"Invalid step value in Apple Health export: {attrs.get('value')!r}") from exc
                source = attrs.get("sourceName", "unknown")
                samples.append({
                    "date": date,
                    "source": source,
                    "start": _health_timestamp(attrs.get("startDate", "")),
                    "end": _health_timestamp(attrs.get("endDate", "")),
                    "value": value,
                })
                sources.add(source)
        elif (
            element.tag == "Record"
            and record_type == "HKQuantityTypeIdentifierDistanceWalkingRunning"
            and preferred_source
            and attrs.get("sourceName") == preferred_source
        ):
            date = parse_date(attrs.get("startDate", "")[:10])
            if date and (not start_date or date >= start_date) and (not end_date or date <= end_date):
                try:
                    distance = float(attrs.get("value", "0"))
                except ValueError as exc:
                    raise SystemExit(f"Invalid walking distance in Apple Health export: {attrs.get('value')!r}") from exc
                preferred_distance_miles[date] += _distance_miles(distance, attrs.get("unit", ""))
        element.clear()

    if not samples:
        raise SystemExit(f"No Apple Health step records found in {export_path}")
    totals, excluded_overlap, preferred_totals = _source_aware_totals(samples, preferred_source)
    if incline_pct is None and (preferred_source or "").upper() == "UREVO":
        incline_pct = UREVO_DEFAULT_INCLINE_PCT
    source_label = " + ".join(sorted(sources))
    if len(sources) > 1:
        source_label += f" ({preferred_source} preferred during overlaps; ~{excluded_overlap:,.0f} secondary steps excluded)"
    print(f"Parsed {len(totals)} Apple Health step days from {source_label}")
    rows = []
    for date in sorted(totals):
        row: dict[str, Any] = {"date": date, "steps": round(totals[date])}
        incline_steps = preferred_totals.get(date, 0.0)
        if incline_steps > 0 and incline_pct and incline_pct > 0:
            distance_miles = preferred_distance_miles.get(date, 0.0)
            row.update({
                "inclineSteps": round(incline_steps),
                "inclinePct": round(incline_pct, 1),
                "inclineDistanceMi": round(distance_miles, 3),
                "inclineExtraKcal": round(_incline_extra_kcal(
                    distance_miles, incline_steps, incline_pct, reference_weight_lbs
                )),
            })
        rows.append(row)
    return rows


def collect_updates(args: argparse.Namespace) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []

    if args.apple_health_export:
        start_date = parse_date(args.start_date) if args.start_date else None
        end_date = parse_date(args.end_date) if args.end_date else None
        if args.start_date and not start_date:
            raise SystemExit(f"Invalid Apple Health start date: {args.start_date!r}")
        if args.end_date and not end_date:
            raise SystemExit(f"Invalid Apple Health end date: {args.end_date!r}")
        if start_date and end_date and start_date > end_date:
            raise SystemExit("Apple Health start date must be on or before the end date.")
        updates.extend(_load_apple_health_export(
            args.apple_health_export,
            start_date,
            end_date,
            args.preferred_source,
            args.incline_pct,
            args.incline_reference_weight_lbs,
        ))

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
        single_entry = {"date": raw_date, "steps": raw_steps}
        raw_incline_steps = args.incline_steps or os.getenv("APPLE_STEPS_UREVO_VALUE")
        raw_incline_distance = args.incline_distance_mi or os.getenv("APPLE_STEPS_UREVO_DISTANCE_MI")
        if raw_incline_steps not in (None, ""):
            single_entry.update({
                "inclineSteps": raw_incline_steps,
                "inclinePct": args.incline_pct if args.incline_pct is not None else UREVO_DEFAULT_INCLINE_PCT,
            })
            if raw_incline_distance not in (None, ""):
                single_entry["inclineDistanceMi"] = raw_incline_distance
        updates.append(_normalize_entry(single_entry))

    if not updates:
        raise SystemExit("No step updates provided. Use --apple-health-export, --date/--steps, or --payload-json.")

    merged: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for entry in sorted(updates, key=lambda row: row["date"]):
        merged[entry["date"]] = entry
    return list(merged.values())


def merge_steps(existing_rows: list[dict[str, Any]], updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {row["date"]: dict(row) for row in existing_rows}
    for entry in updates:
        merged[entry["date"]] = {**merged.get(entry["date"], {}), **entry}
    return [merged[date] for date in sorted(merged)]


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge Apple Health steps into js/data.js.")
    parser.add_argument("--output", default=str(DATA_JS_PATH))
    parser.add_argument("--date", help="Single date to update, e.g. 2026-04-21")
    parser.add_argument("--steps", help="Single steps value to merge for --date")
    parser.add_argument("--payload-json", help="JSON list/object of step rows")
    parser.add_argument("--apple-health-export", help="Path to an Apple Health export.xml file")
    parser.add_argument("--preferred-source", help="Preferred source during overlapping Apple Health step intervals")
    parser.add_argument("--incline-pct", type=float, help="Grade assigned to preferred-source steps (UREVO defaults to 12)")
    parser.add_argument("--incline-steps", help="UREVO steps included within the single-day total")
    parser.add_argument("--incline-distance-mi", help="UREVO walking distance included within the single-day total")
    parser.add_argument(
        "--incline-reference-weight-lbs",
        type=float,
        default=INCLINE_REFERENCE_WEIGHT_LBS,
        help="Body weight used for the ACSM incline-energy estimate",
    )
    parser.add_argument("--start-date", help="Optional first date to import from Apple Health")
    parser.add_argument("--end-date", help="Optional last date to import from Apple Health")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()

    output_path = Path(args.output).resolve()
    updates = collect_updates(args)

    print("Reading existing data.js …")
    macro_buckets = parse_existing_macro_data(output_path)
    existing_sleep = parse_existing_sleep_data(output_path)
    existing_steps = parse_existing_steps_data(output_path)
    existing_recovery = parse_existing_recovery_data(output_path)
    existing_vacation_dates = parse_existing_vacation_dates(output_path)
    bayes_block = extract_bayes_block(output_path)

    merged_steps = merge_steps(existing_steps, updates)
    output = render_data_js(
        macro_buckets,
        existing_sleep,
        merged_steps,
        existing_recovery,
        existing_vacation_dates,
        bayes_block,
    )

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
