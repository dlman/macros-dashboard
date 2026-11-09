#!/usr/bin/env python3

import tempfile
import unittest
from pathlib import Path

from sync_steps import _load_apple_health_export


def record(source: str, start: str, end: str, value: int) -> str:
    return (
        f'<Record type="HKQuantityTypeIdentifierStepCount" sourceName="{source}" unit="count" '
        f'startDate="{start}" endDate="{end}" value="{value}"/>'
    )


class AppleHealthStepMergeTests(unittest.TestCase):
    def write_export(self, records: list[str]) -> str:
        temp = tempfile.NamedTemporaryFile(mode="w", suffix=".xml", delete=False, encoding="utf-8")
        with temp:
            temp.write("<HealthData>" + "".join(records) + "</HealthData>")
        self.addCleanup(Path(temp.name).unlink)
        return temp.name

    def test_single_source_totals_are_unchanged(self):
        path = self.write_export([
            record("Phone", "2026-11-08 09:00:00 -0500", "2026-11-08 09:10:00 -0500", 500),
            record("Phone", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 700),
        ])
        self.assertEqual(_load_apple_health_export(path), [{"date": "2026-11-08", "steps": 1200}])

    def test_preferred_source_replaces_overlapping_phone_steps(self):
        path = self.write_export([
            record("Phone", "2026-11-08 09:00:00 -0500", "2026-11-08 09:10:00 -0500", 500),
            record("Phone", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 1000),
            record("UREVO", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 2000),
        ])
        self.assertEqual(
            _load_apple_health_export(path, preferred_source="UREVO"),
            [{"date": "2026-11-08", "steps": 2500}],
        )

    def test_partial_overlap_keeps_the_uncovered_phone_fraction(self):
        path = self.write_export([
            record("Phone", "2026-11-08 09:50:00 -0500", "2026-11-08 10:10:00 -0500", 1000),
            record("UREVO", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 2000),
        ])
        self.assertEqual(
            _load_apple_health_export(path, preferred_source="UREVO"),
            [{"date": "2026-11-08", "steps": 2500}],
        )

    def test_multiple_sources_require_an_explicit_preference(self):
        path = self.write_export([
            record("Phone", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 1000),
            record("UREVO", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 2000),
        ])
        with self.assertRaisesRegex(SystemExit, "Pass --preferred-source"):
            _load_apple_health_export(path)


if __name__ == "__main__":
    unittest.main()
