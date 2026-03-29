#!/usr/bin/env python3
"""
Sync private Google Sheets data into js/data.js.

Designed for GitHub Actions or local use with a Google service account.

Required:
  - GOOGLE_SHEET_ID
  - GOOGLE_SERVICE_ACCOUNT_JSON   (raw JSON secret), or
  - GOOGLE_SERVICE_ACCOUNT_FILE   (path to credentials JSON)

Optional:
  - GOOGLE_SHEET_MACROS_TAB   (default: Macros)
  - GOOGLE_SHEET_SLEEP_TAB    (default: Sleep)
  - GOOGLE_SHEET_STEPS_TAB    (default: Steps)

This script rewrites the raw dashboard datasets and preserves any existing
Bayesian block between // BAYES_START and // BAYES_END. The workflow should run
update_bayes.py immediately afterward so the derived Bayesian artifacts match
the newly synced raw data.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Any

from google.oauth2 import service_account
from googleapiclient.discovery import build


ROOT = Path(__file__).resolve().parents[1]
DATA_JS_PATH = ROOT / "js" / "data.js"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]

MONTH_BUCKETS = OrderedDict([
    ("Jan", "2026-01"),
    ("Feb", "2026-02"),
    ("March", "2026-03"),
])

MACRO_ALIASES = {
    "date": {"date", "day", "datestr", "daydate"},
    "protein": {"protein", "proteing", "proteingrams", "proteingram", "p"},
    "carbs": {"carbs", "carb", "carbsg", "carbsgrams", "c"},
    "fat": {"fat", "fatg", "fatgrams", "f"},
    "calories": {"calories", "calorie", "cals", "kcal", "energy"},
    "weight": {"weight", "bodyweight", "scaleweight", "bw"},
    "lifting": {"lifting", "lift", "lifted", "training", "workout"},
    "drinks": {"drinks", "drink", "alcohol", "alcoholnotes"},
    "notes": {"notes", "foodnotes", "food", "meals", "mealnotes"},
}

SLEEP_ALIASES = {
    "date": {"date", "day", "datestr"},
    "perf": {"perf", "sleepperf", "sleepperformance", "recovery", "score"},
    "hours": {"hours", "sleephours", "totalsleephours", "sleepduration"},
    "bedtime": {"bedtime", "bedtimeclock", "timeinbed"},
    "bedtime_hour": {"bedtimehour", "bedtimehours", "bedtimehr"},
    "deep": {"deep", "deepsleep", "deep_hours"},
    "rem": {"rem", "remsleep", "rem_hours"},
    "light": {"light", "lightsleep", "light_hours"},
    "efficiency": {"efficiency", "sleepefficiency"},
    "resp": {"resp", "respiratory", "respiratoryrate", "breathingrate"},
}

STEPS_ALIASES = {
    "date": {"date", "day", "datestr"},
    "steps": {"steps", "stepcount", "dailysteps"},
}


def normalize_header(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def env_or_default(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def read_credentials():
    raw_json = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    json_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_FILE", "").strip()
    if raw_json:
        info = json.loads(raw_json)
        return service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    if json_path:
        return service_account.Credentials.from_service_account_file(json_path, scopes=SCOPES)
    raise SystemExit("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_FILE.")


def sheets_service():
    creds = read_credentials()
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def get_values(service, spreadsheet_id: str, tab_name: str) -> list[list[str]]:
    response = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=tab_name
    ).execute()
    return response.get("values", [])


def map_headers(header_row: list[str], aliases: dict[str, set[str]]) -> dict[str, int]:
    normalized = {normalize_header(value): idx for idx, value in enumerate(header_row)}
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
    value = row[idx]
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def parse_date(value: str | None) -> str | None:
    if not value:
        return None
    value = value.strip()
    formats = [
        "%Y-%m-%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%Y/%m/%d",
        "%b %d, %Y",
        "%B %d, %Y",
    ]
    for fmt in formats:
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
    cleaned = str(value).strip().replace(",", "")
    cleaned = cleaned.replace("%", "")
    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_int(value: str | None) -> int | None:
    number = parse_float(value)
    return None if number is None else int(round(number))


def parse_lifting(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower()
    if normalized in {"y", "yes", "true", "1", "lift", "lifting", "workout", "trained"}:
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
        if isinstance(value, str) or value is None:
            rendered = js_string(value)
        else:
            rendered = format_number(value)
        parts.append(f"{key}:{rendered}")
    return "{" + ",".join(parts) + "}"


def parse_existing_sleep_data(path: Path) -> list[dict[str, Any]]:
    src = path.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\{date:"(?P<date>\d{4}-\d{2}-\d{2})",perf:(?P<perf>[0-9.]+),hours:(?P<hours>[0-9.]+),'
        r'bedtime:"(?P<bedtime>[^"]+)",bedtime_hour:(?P<bedtime_hour>[0-9.]+),deep:(?P<deep>[0-9.]+),'
        r'rem:(?P<rem>[0-9.]+),light:(?P<light>[0-9.]+),efficiency:(?P<efficiency>[0-9.]+),resp:(?P<resp>[0-9.]+)\}'
    )
    rows = []
    for match in pattern.finditer(src):
        rows.append({
            "date": match.group("date"),
            "perf": float(match.group("perf")),
            "hours": float(match.group("hours")),
            "bedtime": match.group("bedtime"),
            "bedtime_hour": float(match.group("bedtime_hour")),
            "deep": float(match.group("deep")),
            "rem": float(match.group("rem")),
            "light": float(match.group("light")),
            "efficiency": int(round(float(match.group("efficiency")))),
            "resp": float(match.group("resp")),
        })
    return rows


def parse_existing_steps_data(path: Path) -> list[dict[str, Any]]:
    src = path.read_text(encoding="utf-8")
    return [
        {"date": m.group(1), "steps": int(m.group(2))}
        for m in re.finditer(r'\{date:"(\d{4}-\d{2}-\d{2})",steps:(\d+)\}', src)
    ]


def extract_bayes_block(path: Path) -> str:
    src = path.read_text(encoding="utf-8")
    start = src.find("// BAYES_START")
    end = src.find("// BAYES_END")
    if start == -1 or end == -1 or end < start:
        return ""
    end = src.find("\n", end)
    return src[start:end].rstrip() + "\n"


def load_macros(rows: list[list[str]]) -> OrderedDict[str, list[OrderedDict[str, Any]]]:
    if not rows:
        raise SystemExit("Macros tab is empty.")
    headers = map_headers(rows[0], MACRO_ALIASES)
    missing = [field for field in ("date", "protein", "carbs", "fat", "calories") if field not in headers]
    if missing:
        raise SystemExit(f"Macros tab is missing required headers: {', '.join(missing)}")

    buckets: OrderedDict[str, list[OrderedDict[str, Any]]] = OrderedDict((name, []) for name in MONTH_BUCKETS)
    for row in rows[1:]:
        date = parse_date(cell(row, headers.get("date")))
        if not date:
            continue
        month_prefix = date[:7]
        bucket_name = next((name for name, prefix in MONTH_BUCKETS.items() if prefix == month_prefix), None)
        if bucket_name is None:
            raise SystemExit(
                f"Found unsupported date {date}. The current dashboard code is still hard-coded to Jan/Feb/March 2026."
            )
        buckets[bucket_name].append(OrderedDict([
            ("date", date),
            ("protein", parse_int(cell(row, headers.get("protein")))),
            ("carbs", parse_int(cell(row, headers.get("carbs")))),
            ("fat", parse_int(cell(row, headers.get("fat")))),
            ("calories", parse_int(cell(row, headers.get("calories")))),
            ("weight", parse_float(cell(row, headers.get("weight")))),
            ("lifting", parse_lifting(cell(row, headers.get("lifting")))),
            ("drinks", cell(row, headers.get("drinks"))),
            ("notes", cell(row, headers.get("notes"))),
        ]))

    for items in buckets.values():
        items.sort(key=lambda item: item["date"])
    return buckets


def load_sleep(rows: list[list[str]] | None, existing: list[dict[str, Any]]) -> list[OrderedDict[str, Any]]:
    if not rows:
        return [OrderedDict(item) for item in existing]
    headers = map_headers(rows[0], SLEEP_ALIASES)
    missing = [field for field in ("date", "perf", "hours", "bedtime") if field not in headers]
    if missing:
        raise SystemExit(f"Sleep tab is missing required headers: {', '.join(missing)}")

    result: list[OrderedDict[str, Any]] = []
    for row in rows[1:]:
        date = parse_date(cell(row, headers.get("date")))
        if not date:
            continue
        bedtime = cell(row, headers.get("bedtime"))
        result.append(OrderedDict([
            ("date", date),
            ("perf", parse_int(cell(row, headers.get("perf")))),
            ("hours", parse_float(cell(row, headers.get("hours")))),
            ("bedtime", bedtime),
            ("bedtime_hour", parse_float(cell(row, headers.get("bedtime_hour")))),
            ("deep", parse_float(cell(row, headers.get("deep")))),
            ("rem", parse_float(cell(row, headers.get("rem")))),
            ("light", parse_float(cell(row, headers.get("light")))),
            ("efficiency", parse_int(cell(row, headers.get("efficiency")))),
            ("resp", parse_float(cell(row, headers.get("resp")))),
        ]))
    result.sort(key=lambda item: item["date"])
    return result


def load_steps(rows: list[list[str]] | None, existing: list[dict[str, Any]]) -> list[OrderedDict[str, Any]]:
    if not rows:
        return [OrderedDict(item) for item in existing]
    headers = map_headers(rows[0], STEPS_ALIASES)
    missing = [field for field in ("date", "steps") if field not in headers]
    if missing:
        raise SystemExit(f"Steps tab is missing required headers: {', '.join(missing)}")

    result: list[OrderedDict[str, Any]] = []
    for row in rows[1:]:
        date = parse_date(cell(row, headers.get("date")))
        if not date:
            continue
        steps = parse_int(cell(row, headers.get("steps")))
        if steps is None:
            continue
        result.append(OrderedDict([
            ("date", date),
            ("steps", steps),
        ]))
    result.sort(key=lambda item: item["date"])
    return result


def render_data_js(
    macro_buckets: OrderedDict[str, list[OrderedDict[str, Any]]],
    sleep_rows: list[OrderedDict[str, Any]],
    steps_rows: list[OrderedDict[str, Any]],
    bayes_block: str,
) -> str:
    macro_lines = []
    for idx, (month, entries) in enumerate(macro_buckets.items()):
        serialized = ",\n    ".join(serialize_object(entry) for entry in entries)
        macro_lines.append(
            f"  {month}: [\n    {serialized}\n  ]" if serialized else f"  {month}: []"
        )
    sleep_serialized = ",\n  ".join(serialize_object(entry) for entry in sleep_rows)
    steps_serialized = ",\n  ".join(serialize_object(entry) for entry in steps_rows)

    return (
        "(() => {\n"
        "// Raw data\n"
        "const data = {\n"
        + ",\n".join(macro_lines)
        + "\n};\n\n"
        + "const sleepData = [\n  "
        + sleep_serialized
        + "\n];\n\n"
        + "const stepsData = [\n  "
        + steps_serialized
        + "\n];\n\n"
        + "window.dashboardData = { data, sleepData, stepsData };\n"
        + (bayes_block if bayes_block else "")
        + "\n})();\n"
    )


def main():
    parser = argparse.ArgumentParser(description="Sync dashboard data from a private Google Sheet.")
    parser.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    parser.add_argument("--macros-tab", default=env_or_default("GOOGLE_SHEET_MACROS_TAB", "Macros"))
    parser.add_argument("--sleep-tab", default=env_or_default("GOOGLE_SHEET_SLEEP_TAB", "Sleep"))
    parser.add_argument("--steps-tab", default=env_or_default("GOOGLE_SHEET_STEPS_TAB", "Steps"))
    parser.add_argument("--skip-sleep", action="store_true", help="Keep existing sleepData from js/data.js")
    parser.add_argument("--skip-steps", action="store_true", help="Keep existing stepsData from js/data.js")
    parser.add_argument("--output", default=str(DATA_JS_PATH))
    args = parser.parse_args()

    if not args.sheet_id:
        raise SystemExit("Missing --sheet-id or GOOGLE_SHEET_ID.")

    output_path = Path(args.output).resolve()
    existing_sleep = parse_existing_sleep_data(output_path)
    existing_steps = parse_existing_steps_data(output_path)
    bayes_block = extract_bayes_block(output_path)

    service = sheets_service()
    macro_rows = get_values(service, args.sheet_id, args.macros_tab)
    sleep_rows = None if args.skip_sleep else get_values(service, args.sheet_id, args.sleep_tab)
    steps_rows = None if args.skip_steps else get_values(service, args.sheet_id, args.steps_tab)

    macro_buckets = load_macros(macro_rows)
    sleep_data = load_sleep(sleep_rows, existing_sleep)
    steps_data = load_steps(steps_rows, existing_steps)

    output = render_data_js(macro_buckets, sleep_data, steps_data, bayes_block)
    output_path.write_text(output, encoding="utf-8")

    macro_count = sum(len(items) for items in macro_buckets.values())
    print(f"Synced {macro_count} macro rows, {len(sleep_data)} sleep rows, and {len(steps_data)} step rows into {output_path}.")
    if args.skip_sleep:
        print("Kept existing sleepData because --skip-sleep was used.")
    if args.skip_steps:
        print("Kept existing stepsData because --skip-steps was used.")
    print("Next step: run update_bayes.py so the Bayesian artifacts match the newly synced raw data.")


if __name__ == "__main__":
    main()
