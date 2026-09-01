#!/usr/bin/env python3

import unittest
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_bayes import bayesian_tdee_profile


class BayesianTdeeSegmentationTests(unittest.TestCase):
    def test_vacation_weight_shift_does_not_change_tdee_slope(self):
        intake = 2000
        expected_tdee = 2500
        daily_change = (intake - expected_tdee) / 3500
        excluded = {'2026-01-08', '2026-01-09', '2026-01-10'}
        days = []

        def add_segment(start_date, start_weight, noise_sign):
            start = datetime.strptime(start_date, '%Y-%m-%d')
            for offset in range(7):
                noise = noise_sign * (0.02 if offset % 2 else -0.02)
                days.append({
                    'date': (start + timedelta(days=offset)).strftime('%Y-%m-%d'),
                    'calories': intake,
                    'weight': start_weight + (daily_change * offset) + noise,
                    'lifting': None,
                    'drinks': None,
                })

        add_segment('2026-01-01', 170.0, 1)
        add_segment('2026-01-11', 174.1, -1)
        result = bayesian_tdee_profile(
            days,
            steps_map={},
            end_date='2026-01-17',
            excluded_dates=excluded,
            verbose=False,
        )

        self.assertEqual(result['segmentCount'], 2)
        self.assertEqual(result['excludedDays'], 3)
        self.assertAlmostEqual(result['mean'], expected_tdee, delta=35)
        self.assertTrue(all(obs['segment'] in (1, 2) for obs in result['observations']))


if __name__ == '__main__':
    unittest.main()
