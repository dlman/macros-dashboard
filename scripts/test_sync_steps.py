#!/usr/bin/env python3

import tempfile
import unittest
from pathlib import Path

from sync_google_sheets import parse_existing_steps_data, render_data_js
from sync_steps import _load_apple_health_export, _load_payload_entries, merge_steps


def record(source: str, start: str, end: str, value: int) -> str:
    return (
        f'<Record type="HKQuantityTypeIdentifierStepCount" sourceName="{source}" unit="count" '
        f'startDate="{start}" endDate="{end}" value="{value}"/>'
    )


def distance_record(source: str, start: str, end: str, value: float, unit: str = "mi") -> str:
    return (
        f'<Record type="HKQuantityTypeIdentifierDistanceWalkingRunning" sourceName="{source}" unit="{unit}" '
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
            record("Pad", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 2000),
        ])
        self.assertEqual(
            _load_apple_health_export(path, preferred_source="Pad"),
            [{"date": "2026-11-08", "steps": 2500}],
        )

    def test_partial_overlap_keeps_the_uncovered_phone_fraction(self):
        path = self.write_export([
            record("Phone", "2026-11-08 09:50:00 -0500", "2026-11-08 10:10:00 -0500", 1000),
            record("Pad", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 2000),
        ])
        self.assertEqual(
            _load_apple_health_export(path, preferred_source="Pad"),
            [{"date": "2026-11-08", "steps": 2500}],
        )

    def test_urevo_defaults_to_twelve_percent_incline(self):
        path = self.write_export([
            record("Phone", "2026-11-08 09:00:00 -0500", "2026-11-08 09:10:00 -0500", 500),
            record("UREVO", "2026-11-08 10:00:00 -0500", "2026-11-08 10:30:00 -0500", 2000),
            distance_record("UREVO", "2026-11-08 10:00:00 -0500", "2026-11-08 10:30:00 -0500", 1.0),
        ])
        self.assertEqual(
            _load_apple_health_export(path, preferred_source="UREVO"),
            [{
                "date": "2026-11-08", "steps": 2500, "inclineSteps": 2000,
                "inclinePct": 12.0, "inclineDistanceMi": 1.0, "inclineExtraKcal": 118,
            }],
        )

    def test_incline_metadata_survives_merge_and_serialization(self):
        rows = merge_steps(
            [{
                "date": "2026-11-08", "steps": 2500, "inclineSteps": 2000,
                "inclinePct": 12.0, "inclineDistanceMi": 1.0, "inclineExtraKcal": 118,
            }],
            [{"date": "2026-11-08", "steps": 2600}],
        )
        temp = tempfile.NamedTemporaryFile(mode="w", suffix=".js", delete=False, encoding="utf-8")
        with temp:
            temp.write(render_data_js({}, [], rows, [], [], ""))
        self.addCleanup(Path(temp.name).unlink)
        self.assertEqual(parse_existing_steps_data(Path(temp.name)), [{
            "date": "2026-11-08", "steps": 2600, "inclineSteps": 2000,
            "inclinePct": 12.0, "inclineDistanceMi": 1.0, "inclineExtraKcal": 118,
        }])

    def test_shortcut_payload_accepts_urevo_subset(self):
        self.assertEqual(_load_payload_entries(
            '[{"date":"2026-11-08","steps":7620,"urevoSteps":3489,"urevoDistanceMi":0.932}]'
        ), [{
            "date": "2026-11-08", "steps": 7620, "inclineSteps": 3489,
            "inclinePct": 12.0, "inclineDistanceMi": 0.932, "inclineExtraKcal": 110,
        }])

    def test_multiple_sources_require_an_explicit_preference(self):
        path = self.write_export([
            record("Phone", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 1000),
            record("UREVO", "2026-11-08 10:00:00 -0500", "2026-11-08 10:10:00 -0500", 2000),
        ])
        with self.assertRaisesRegex(SystemExit, "Pass --preferred-source"):
            _load_apple_health_export(path)


if __name__ == "__main__":
    unittest.main()
