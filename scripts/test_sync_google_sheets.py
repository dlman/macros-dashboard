#!/usr/bin/env python3

import tempfile
import unittest
from collections import OrderedDict
from pathlib import Path

from sync_google_sheets import apply_csv_to_bucket, parse_existing_macro_data, render_data_js


HEADERS = ["Date", "Protein", "Carbs", "Fat", "Calories", "Weight", "Lifting", "Drinks", "Notes"]


def csv_row(date: str, protein: str = "160") -> list[str]:
    return [date, protein, "150", "70", "1900", "155.0", "", "", ""]


def stored_row(date: str) -> OrderedDict:
    return OrderedDict([
        ("date", date), ("protein", 160), ("carbs", 150), ("fat", 70),
        ("calories", 1900), ("weight", 155.0), ("lifting", None),
        ("drinks", None), ("notes", None),
    ])


class GoogleSheetsSyncSafetyTests(unittest.TestCase):
    def test_year_month_buckets_do_not_collide_across_years(self):
        source = """(() => {
const data = {
  \"2026-12\": [{date:\"2026-12-31\",protein:160,carbs:150,fat:70,calories:1900,weight:155,lifting:null,drinks:null,notes:null}],
  \"2027-01\": [{date:\"2027-01-01\",protein:161,carbs:151,fat:71,calories:1910,weight:154.8,lifting:null,drinks:null,notes:null}]
};
})();
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.js"
            path.write_text(source, encoding="utf-8")
            buckets = parse_existing_macro_data(path)
        self.assertEqual(list(buckets), ["2026-12", "2027-01"])
        self.assertEqual(buckets["2026-12"][0]["date"], "2026-12-31")
        self.assertEqual(buckets["2027-01"][0]["date"], "2027-01-01")

    def test_missing_existing_date_is_rejected_without_override(self):
        buckets = OrderedDict({"2026-11": [stored_row("2026-11-01"), stored_row("2026-11-02")]})
        with self.assertRaisesRegex(SystemExit, "would remove 1 existing date"):
            apply_csv_to_bucket(buckets, [HEADERS, csv_row("2026-11-02")], "2026-11")

    def test_intentional_shrink_requires_explicit_override(self):
        buckets = OrderedDict({"2026-11": [stored_row("2026-11-01"), stored_row("2026-11-02")]})
        apply_csv_to_bucket(
            buckets,
            [HEADERS, csv_row("2026-11-02")],
            "2026-11",
            allow_shrink=True,
        )
        self.assertEqual([row["date"] for row in buckets["2026-11"]], ["2026-11-02"])

    def test_out_of_month_and_duplicate_dates_are_rejected(self):
        with self.assertRaisesRegex(SystemExit, "out-of-month date"):
            apply_csv_to_bucket(OrderedDict(), [HEADERS, csv_row("2026-12-01")], "2026-11")
        with self.assertRaisesRegex(SystemExit, "duplicate dates"):
            apply_csv_to_bucket(
                OrderedDict(),
                [HEADERS, csv_row("2026-11-01"), csv_row("2026-11-01")],
                "2026-11",
            )

    def test_rendered_bucket_keys_are_quoted_year_month_values(self):
        output = render_data_js(
            OrderedDict({"2027-01": [stored_row("2027-01-01")]}),
            [], [], [], [], "",
        )
        self.assertIn('"2027-01": [', output)


if __name__ == "__main__":
    unittest.main()
