#!/usr/bin/env python3

import unittest
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_bayes import bayesian_tdee_profile, tdee_logging_sensitivity, estimate_drink_calories
from copy import deepcopy


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


class TdeeLoggingSensitivityTests(unittest.TestCase):
    def setUp(self):
        self.days = []
        for i in range(35):
            self.days.append({
                'date': (datetime(2026, 8, 1) + timedelta(days=i)).strftime('%Y-%m-%d'),
                'calories': 2000 + (i % 3) * 100,
                'weight': 160 - i * 0.1 + (0.08 if i % 2 else -0.06),
                'lifting': None, 'drinks': '2 whiskey' if i % 7 == 0 else None,
            })
        self.steps = {d['date']: 6000 + i * 100 for i, d in enumerate(self.days)}

    def calculate(self, days=None, excluded=None):
        days = self.days if days is None else days
        profile = bayesian_tdee_profile(days, self.steps, end_date=self.days[-1]['date'],
                                        excluded_dates=excluded, verbose=False)
        return tdee_logging_sensitivity(days, self.steps, profile, excluded), profile

    def test_food_only_refits_match_direct_model_and_do_not_mutate_data(self):
        original = deepcopy(self.days)
        sensitivity, base = self.calculate()
        for row in sensitivity['rows']:
            factor = row['foodMultiplier']
            scaled = [{**d, 'calories': d['calories'] * factor} for d in self.days]
            fitted = bayesian_tdee_profile(scaled, self.steps, end_date=base['date'], verbose=False)
            steps_adjustment = sum((self.steps[d['date']] - fitted['avgSteps']) * 0.04
                                   for d in self.days[:-1]) / 34
            self.assertAlmostEqual(row['tdee'], fitted['mean'] + steps_adjustment, delta=0.01)
            self.assertAlmostEqual(row['intake'], row['food'] + row['alcohol'], delta=0.02)
            self.assertAlmostEqual(row['netDeficit'], row['tdee'] - row['intake'], delta=0.02)
        self.assertEqual(self.days, original)
        self.assertEqual(len({r['alcohol'] for r in sensitivity['rows']}), 1)
        expected_alcohol = sum(estimate_drink_calories(d['drinks']) for d in self.days[:-1]) / 34
        self.assertAlmostEqual(sensitivity['rows'][0]['alcohol'], expected_alcohol, delta=0.01)
        self.assertGreater(sensitivity['rows'][2]['tdee'], sensitivity['rows'][0]['tdee'])

    def test_net_is_not_calculated_by_holding_tdee_fixed(self):
        sensitivity, _ = self.calculate()
        logged, _, high = sensitivity['rows']
        naive = logged['tdee'] - high['intake']
        self.assertGreater(high['netDeficit'], naive + 100)

    def test_missing_food_days_have_explicit_coverage_and_are_not_zero_intake(self):
        days = deepcopy(self.days)
        days[4]['calories'] = None
        sensitivity, _ = self.calculate(days)
        self.assertEqual(sensitivity['eligibleDays'], 34)
        self.assertEqual(sensitivity['loggedDays'], 33)
        self.assertEqual(sensitivity['end'], self.days[-2]['date'])
        self.assertGreater(sensitivity['rows'][0]['food'], 2000)

    def test_exclusions_and_segment_endpoints_are_omitted_from_net_budget(self):
        excluded = {self.days[i]['date'] for i in range(10, 15)}
        changed = deepcopy(self.days)
        for d in changed:
            if d['date'] in excluded:
                d.update(calories=99999, drinks='100 whiskey', weight=999)
        first, _ = self.calculate(excluded=excluded)
        second, _ = self.calculate(changed, excluded)
        self.assertEqual(first, second)
        self.assertEqual(first['eligibleDays'], 28)

    def test_data_after_cutoff_is_ignored(self):
        first, _ = self.calculate()
        future = {**self.days[-1], 'date': '2099-01-01', 'calories': 99999, 'weight': 999}
        second, _ = self.calculate(self.days + [future])
        self.assertEqual(first, second)


if __name__ == '__main__':
    unittest.main()
