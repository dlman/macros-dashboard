#!/usr/bin/env python3
"""
Sync published Google Sheets CSV tabs into js/data.js.

No credentials or secrets required — just publish each macro tab via
File → Share → Publish to web → CSV, then paste the URL below.

Add a new entry to PUBLISHED_CSV_URLS whenever you start a new month.
Sleep and steps data are preserved from the existing js/data.js (update
those manually via WHOOP/Health exports as usual).

Usage:
  python scripts/sync_google_sheets.py
  python scripts/sync_google_sheets.py --output js/data.js
  python scripts/sync_google_sheets.py --dry-run
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
from collections import OrderedDict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA_JS_PATH = ROOT / "js" / "data.js"

# ─── Published CSV URLs ────────────────────────────────────────────────────────
# Add a new entry here whenever you publish a new month's macro tab.
# File → Share → Publish to web → select the sheet tab → CSV → Copy link
PUBLISHED_CSV_URLS: dict[str, str] = {
    "Apr": "https://docs.google.com/spreadsheets/d/e/2PACX-1vTJUvbmg1S1K_Db8iKiNs8CxNDsyn0W8kSAqC1mMJezQHi9JTFP2gvWP-943ybVdWIFSgRmHPsC2IE4/pub?gid=321773998&single=true&output=csv",
    "May": "https://docs.google.com/spreadsheets/d/e/2PACX-1vTJUvbmg1S1K_Db8iKiNs8CxNDsyn0W8kSAqC1mMJezQHi9JTFP2gvWP-943ybVdWIFSgRmHPsC2IE4/pub?gid=2042134160&single=true&output=csv",
}
# ──────────────────────────────────────────────────────────────────────────────

MONTH_BUCKETS = OrderedDict([
    ("Jan",   "2026-01"),
    ("Feb",   "2026-02"),
    ("March", "2026-03"),
    ("Apr",   "2026-04"),
    ("May",   "2026-05"),
    ("Jun",   "2026-06"),
    ("Jul",   "2026-07"),
    ("Aug",   "2026-08"),
    ("Sep",   "2026-09"),
    ("Oct",   "2026-10"),
    ("Nov",   "2026-11"),
    ("Dec",   "2026-12"),
])

MACRO_ALIASES = {
    "date":     {"date", "day", "datestr", "daydate"},
    "protein":  {"protein", "proteing", "proteingrams", "proteingram", "p"},
    "carbs":    {"carbs", "carb", "carbsg", "carbsgrams", "c"},
    "fat":      {"fat", "fatg", "fatgrams", "f"},
    "calories": {"calories", "calorie", "cals", "kcal", "energy"},
    "weight":   {"weight", "bodyweight", "scaleweight", "bw"},
    "lifting":  {"lifting", "lift", "lifted", "training", "workout"},
    "drinks":   {"drinks", "drink", "alcohol", "alcoholnotes"},
    "notes":    {"notes", "foodnotes", "food", "meals", "mealnotes"},
}


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def fetch_csv(url: str, label: str) -> list[list[str]]:
    """Fetch a published Google Sheets CSV and return rows as list[list[str]]."""
    print(f"  Fetching {label} …")
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    reader = csv.reader(io.StringIO(response.text))
    rows = [row for row in reader if any(cell.strip() for cell in row)]
    print(f"  {label}: {len(rows) - 1} data rows")
    return rows


def map_headers(header_row: list[str], aliases: dict[str, set[str]]) -> dict[str, int]:
    normalized = {normalize_header(v): idx for idx, v in enumerate(header_row)}
    mapped: dict[str, int] = {}
    for canonical, candidates in aliases.items():
        for candidate in candidates:
            if candidate in normalized:
                mapped[canonical] = normalized[candidate]
                break
    return mapped


def cell(row: list[str], idx: int | None) -> str | None:
    if idx is None or idx >= len(row):
        return None
    value = str(row[idx]).strip()
    return value or None


def parse_date(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    excel_serial = parse_float(value)
    if excel_serial is not None and 40000 <= excel_serial <= 60000:
        return (datetime(1899, 12, 30) + timedelta(days=excel_serial)).strftime("%Y-%m-%d")
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value).strftime("%Y-%m-%d")
    except ValueError:
        return None


def parse_float(value: str | None) -> float | None:
    if value in (None, "", "-", "—"):
        return None
    try:
        return float(str(value).strip().replace(",", "").replace("%", ""))
    except ValueError:
        return None


def parse_int(value: str | None) -> int | None:
    n = parse_float(value)
    return None if n is None else int(round(n))


def parse_lifting(value: str | None) -> str | None:
    if not value:
        return None
    if value.strip().lower() in {"y", "yes", "true", "1", "lift", "lifting", "workout", "trained"}:
        return "Y"
    return None


def format_number(value: float | int | None) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if float(value).is_integer():
        return str(int(value))
    return format(float(value), ".2f").rstrip("0").rstrip(".")


def js_string(value: str | None) -> str:
    return "null" if value is None else json.dumps(value, ensure_ascii=False)


def serialize_object(obj: OrderedDict[str, Any]) -> str:
    parts = []
    for key, value in obj.items():
        rendered = js_string(value) if (isinstance(value, str) or value is None) else format_number(value)
        parts.append(f"{key}:{rendered}")
    return "{" + ",".join(parts) + "}"


def parse_existing_macro_data(path: Path) -> OrderedDict[str, list[OrderedDict[str, Any]]]:
    """Read the existing data.js macro buckets so unchanged months are preserved."""
    src = path.read_text(encoding="utf-8")
    day_re = re.compile(
        r'\{date:"(\d{4}-\d{2}-\d{2})"'
        r',protein:(\d+|null),carbs:(\d+|null),fat:(\d+|null),calories:(\d+|null)'
        r',weight:([0-9.]+|null),lifting:("Y"|null),drinks:(".*?"|null)'
        r'(?:,notes:(?:".*?"|null))?\}'
    )
    buckets: OrderedDict[str, list[OrderedDict[str, Any]]] = OrderedDict(
        (name, []) for name in MONTH_BUCKETS
    )
    for m in day_re.finditer(src):
        date = m.group(1)
        prefix = date[:7]
        month = next((name for name, p in MONTH_BUCKETS.items() if p == prefix), None)
        if month is None:
            continue

        def maybe_int(s: str) -> int | None:
            return None if s == "null" else int(s)

        def maybe_float(s: str) -> float | None:
            return None if s == "null" else float(s)

        def maybe_str(s: str) -> str | None:
            return None if s == "null" else s.strip('"')

        # Re-extract notes separately since the regex above doesn't capture it
        notes_match = re.search(r'\{date:"' + date + r'"[^}]+,notes:(".*?"|null)\}', src)
        notes = maybe_str(notes_match.group(1)) if notes_match else None

        buckets[month].append(OrderedDict([
            ("date",     date),
            ("protein",  maybe_int(m.group(2))),
            ("carbs",    maybe_int(m.group(3))),
            ("fat",      maybe_int(m.group(4))),
            ("calories", maybe_int(m.group(5))),
            ("weight",   maybe_float(m.group(6))),
            ("lifting",  maybe_str(m.group(7))),
            ("drinks",   maybe_str(m.group(8))),
            ("notes",    notes),
        ]))
    return buckets


def parse_existing_sleep_data(path: Path) -> list[dict[str, Any]]:
    src = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{date:"(?P<date>\d{4}-\d{2}-\d{2})",perf:(?P<perf>[0-9.]+),hours:(?P<hours>[0-9.]+),'
        r'bedtime:"(?P<bedtime>[^"]+)",bedtime_hour:(?P<bedtime_hour>[0-9.]+),deep:(?P<deep>[0-9.]+),'
        r'rem:(?P<rem>[0-9.]+),light:(?P<light>[0-9.]+),efficiency:(?P<efficiency>[0-9.]+),resp:(?P<resp>[0-9.]+)\}'
    )
    return [
        {
            "date": m.group("date"), "perf": float(m.group("perf")),
            "hours": float(m.group("hours")), "bedtime": m.group("bedtime"),
            "bedtime_hour": float(m.group("bedtime_hour")), "deep": float(m.group("deep")),
            "rem": float(m.group("rem")), "light": float(m.group("light")),
            "efficiency": int(round(float(m.group("efficiency")))), "resp": float(m.group("resp")),
        }
        for m in pattern.finditer(src)
    ]


def parse_existing_steps_data(path: Path) -> list[dict[str, Any]]:
    src = path.read_text(encoding="utf-8")
    return [
        {"date": m.group(1), "steps": int(m.group(2))}
        for m in re.finditer(r'\{date:"(\d{4}-\d{2}-\d{2})",steps:(\d+)\}', src)
    ]


def parse_existing_recovery_data(path: Path) -> list[dict[str, Any]]:
    src = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{date:"(?P<date>\d{4}-\d{2}-\d{2})"'
        r',recovery:(?P<recovery>\d+)'
        r',hrv:(?P<hrv>[0-9.]+|null)'
        r',rhr:(?P<rhr>[0-9]+|null)'
        r',spo2:(?P<spo2>[0-9.]+|null)\}'
    )
    rows = []
    for m in pattern.finditer(src):
        hrv  = m.group("hrv");  hrv  = float(hrv)  if hrv  != "null" else None
        rhr  = m.group("rhr");  rhr  = int(rhr)    if rhr  != "null" else None
        spo2 = m.group("spo2"); spo2 = float(spo2) if spo2 != "null" else None
        rows.append({
            "date":     m.group("date"),
            "recovery": int(m.group("recovery")),
            "hrv":      hrv,
            "rhr":      rhr,
            "spo2":     spo2,
        })
    return rows


def extract_bayes_block(path: Path) -> str:
    src = path.read_text(encoding="utf-8")
    start = src.find("// BAYES_START")
    end = src.find("// BAYES_END")
    if start == -1 or end == -1 or end < start:
        return ""
    end = src.find("\n", end)
    return src[start:end].rstrip() + "\n"


def apply_csv_to_bucket(
    buckets: OrderedDict[str, list[OrderedDict[str, Any]]],
    rows: list[list[str]],
    month_name: str,
) -> None:
    """Overwrite a single month bucket with rows from a CSV fetch."""
    headers = map_headers(rows[0], MACRO_ALIASES)
    missing = [f for f in ("date", "protein", "carbs", "fat", "calories") if f not in headers]
    if missing:
        raise SystemExit(f"{month_name} CSV is missing required columns: {', '.join(missing)}")

    new_rows: list[OrderedDict[str, Any]] = []
    for row in rows[1:]:
        date = parse_date(cell(row, headers.get("date")))
        if not date:
            continue
        protein = parse_int(cell(row, headers.get("protein")))
        if protein is None:
            continue  # skip empty/future rows
        new_rows.append(OrderedDict([
            ("date",     date),
            ("protein",  protein),
            ("carbs",    parse_int(cell(row, headers.get("carbs")))),
            ("fat",      parse_int(cell(row, headers.get("fat")))),
            ("calories", parse_int(cell(row, headers.get("calories")))),
            ("weight",   parse_float(cell(row, headers.get("weight")))),
            ("lifting",  parse_lifting(cell(row, headers.get("lifting")))),
            ("drinks",   cell(row, headers.get("drinks"))),
            ("notes",    cell(row, headers.get("notes"))),
        ]))

    new_rows.sort(key=lambda r: r["date"])
    buckets[month_name] = new_rows
    print(f"  {month_name}: {len(new_rows)} rows loaded from CSV")


def _fmt_recovery_val(v: Any) -> str:
    if v is None:         return "null"
    if isinstance(v, int): return str(v)
    f = float(v)
    if f.is_integer():    return str(int(f))
    return format(f, ".1f")


def _serialize_recovery_row(row: dict) -> str:
    return (
        '{date:' + json.dumps(row["date"])
        + ',recovery:' + str(int(row["recovery"]))
        + ',hrv:'      + _fmt_recovery_val(row.get("hrv"))
        + ',rhr:'      + _fmt_recovery_val(row.get("rhr"))
        + ',spo2:'     + _fmt_recovery_val(row.get("spo2"))
        + '}'
    )


def render_data_js(
    macro_buckets: OrderedDict[str, list[OrderedDict[str, Any]]],
    sleep_rows: list[Any],
    steps_rows: list[Any],
    recovery_rows: list[Any],
    bayes_block: str,
) -> str:
    macro_lines = []
    for month, entries in macro_buckets.items():
        serialized = ",\n    ".join(serialize_object(e) for e in entries)
        macro_lines.append(
            f"  {month}: [\n    {serialized}\n  ]" if serialized else f"  {month}: []"
        )
    sleep_ser    = ",\n  ".join(serialize_object(OrderedDict(e)) for e in sleep_rows)
    steps_ser    = ",\n  ".join(serialize_object(OrderedDict(e)) for e in steps_rows)
    recovery_ser = ",\n  ".join(_serialize_recovery_row(r) for r in recovery_rows)

    return (
        "(() => {\n// Raw data\nconst data = {\n"
        + ",\n".join(macro_lines)
        + "\n};\n\nconst sleepData = [\n  " + sleep_ser + "\n];\n\n"
        + "const stepsData = [\n  " + steps_ser + "\n];\n\n"
        + "const recoveryData = [\n  " + recovery_ser + "\n];\n\n"
        + "window.dashboardData = { data, sleepData, stepsData, recoveryData };\n"
        + (bayes_block if bayes_block else "")
        + "\n})();\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync published Google Sheets CSVs into js/data.js.")
    parser.add_argument("--output", default=str(DATA_JS_PATH))
    parser.add_argument("--dry-run", action="store_true", help="Print what would change without writing")
    args = parser.parse_args()

    output_path = Path(args.output).resolve()

    print("Reading existing data.js …")
    macro_buckets     = parse_existing_macro_data(output_path)
    existing_sleep    = parse_existing_sleep_data(output_path)
    existing_steps    = parse_existing_steps_data(output_path)
    existing_recovery = parse_existing_recovery_data(output_path)
    bayes_block       = extract_bayes_block(output_path)

    print(f"\nFetching {len(PUBLISHED_CSV_URLS)} published CSV tab(s) …")
    for month_name, url in PUBLISHED_CSV_URLS.items():
        if month_name not in MONTH_BUCKETS:
            print(f"  WARNING: '{month_name}' not in MONTH_BUCKETS — skipping")
            continue
        rows = fetch_csv(url, f"{month_name} Macros")
        apply_csv_to_bucket(macro_buckets, rows, month_name)

    output = render_data_js(macro_buckets, existing_sleep, existing_steps, existing_recovery, bayes_block)

    if args.dry_run:
        print("\n--- DRY RUN: would write ---")
        print(output[:500] + "\n…")
        return

    output_path.write_text(output, encoding="utf-8")
    macro_count = sum(len(v) for v in macro_buckets.values())
    print(f"\n✓ Wrote {macro_count} macro rows, {len(existing_sleep)} sleep rows, "
          f"{len(existing_steps)} step rows, {len(existing_recovery)} recovery rows → {output_path}")
    print("Next: run  python update_bayes.py js/data.js  to refresh Bayesian estimates.")


if __name__ == "__main__":
    main()
