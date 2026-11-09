#!/usr/bin/env python3

import unittest
import sys
import tempfile
from contextlib import redirect_stdout
from datetime import datetime, timedelta
from io import StringIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from update_bayes import (
    bayesian_tdee_profile,
    clean_tdee_segments,
    creatine_water_adjustment,
    estimate_drink_calories,
    fit_scale_state_model,
    parse_data_js,
    partially_pooled_current_tdee,
    tdee_backtest,
    tdee_logging_sensitivity,
    update_data_js,
)
from copy import deepcopy


class BayesianTdeeSegmentationTests(unittest.TestCase):
    def test_data_parser_converts_incline_energy_to_activity_equivalent_steps(self):
        source = '''(() => {
const data = {};
const stepsData = [
  {date:"2026-11-08",steps:2500,inclineSteps:2000,inclinePct:12,inclineDistanceMi:1,inclineExtraKcal:118}
];
const vacationDates = [];
})();
'''
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.js"
            path.write_text(source, encoding="utf-8")
            with redirect_stdout(StringIO()):
                _, steps, _, _ = parse_data_js(path)
        self.assertEqual(steps["2026-11-08"], 5450)

    def test_data_js_update_is_idempotent(self):
        source = "(() => {\nwindow.dashboardData = { data: {}, sleepData: [], stepsData: [] };\n})();\n"
        posterior = {
            "mean": 2500,
            "sigma": 150,
            "ci95Low": 2200,
            "ci95High": 2800,
            "nObs": 30,
            "observations": [],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "data.js"
            path.write_text(source, encoding="utf-8")
            with redirect_stdout(StringIO()):
                update_data_js(path, path.read_text(), posterior, [], {"mean": 2450}, {"mae": 0.8})
                first = path.read_text()
                update_data_js(path, first, posterior, [], {"mean": 2450}, {"mae": 0.8})
                second = path.read_text()
        self.assertEqual(first, second)
        self.assertNotIn('gpWeightTrend', first)
        self.assertIn('currentTDEE', first)
        self.assertIn('backtest', first)
        self.assertIn('scaleState', first)

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

    def test_unexplained_gap_longer_than_two_days_starts_new_segment(self):
        days = [
            {'date': f'2026-01-{day:02d}', 'calories': 2000, 'weight': 170, 'lifting': None, 'drinks': None}
            for day in (1, 2, 3, 7, 8, 9)
        ]
        segments = clean_tdee_segments(days, set(), '2026-01-09')
        self.assertEqual([[day['date'] for day in segment] for segment in segments], [
            ['2026-01-01', '2026-01-02', '2026-01-03'],
            ['2026-01-07', '2026-01-08', '2026-01-09'],
        ])

    def test_three_consecutive_null_calorie_rows_start_new_segment(self):
        days = [
            {
                'date': f'2026-01-{day:02d}',
                'calories': None if day in (4, 5, 6) else 2000,
                'weight': 170,
                'lifting': None,
                'drinks': None,
            }
            for day in range(1, 10)
        ]
        segments = clean_tdee_segments(days, set(), '2026-01-09')
        self.assertEqual([[day['date'] for day in segment] for segment in segments], [
            ['2026-01-01', '2026-01-02', '2026-01-03'],
            ['2026-01-07', '2026-01-08', '2026-01-09'],
        ])

    def test_creatine_ramp_is_removed_before_tdee_fit(self):
        intake = 2100
        expected_tdee = 2500
        start = datetime(2026, 6, 20)
        days = []
        for offset in range(45):
            date = (start + timedelta(days=offset)).strftime('%Y-%m-%d')
            tissue_weight = 165 + ((intake - expected_tdee) / 3500 * offset)
            days.append({
                'date': date,
                'calories': intake,
                'weight': tissue_weight + creatine_water_adjustment(date),
                'lifting': None,
                'drinks': None,
            })
        result = bayesian_tdee_profile(
            days, {}, end_date=days[-1]['date'], verbose=False, bootstrap_samples=100,
        )
        self.assertAlmostEqual(result['mean'], expected_tdee, delta=25)
        self.assertTrue(result['creatineAdjusted'])
        self.assertGreater(result['SE_TDEE'], 0)
        self.assertEqual(result['loggingSigma'], 150.0)

    def test_current_tdee_is_partially_pooled_and_weight_adjusted(self):
        days = [
            {'date': f'2026-01-{day:02d}', 'weight': 170 - day * 0.2}
            for day in range(1, 15)
        ]
        full = {'mean': 2500, 'statisticalSigma': 100, 'loggingSigma': 150}
        recent = {'date': '2026-01-14', 'mean': 2300, 'statisticalSigma': 90, 'windowDays': 35}
        current = partially_pooled_current_tdee(full, recent, days)
        self.assertGreater(current['mean'], recent['mean'])
        self.assertLess(current['mean'], full['mean'])
        self.assertLess(current['weightAdjustment'], 0)
        self.assertEqual(current['historicalMean'], 2500)

    def test_walk_forward_backtest_tracks_exact_synthetic_energy_balance(self):
        days = []
        start = datetime(2026, 1, 1)
        intake = 2100
        tdee = 2500
        for offset in range(110):
            date = (start + timedelta(days=offset)).strftime('%Y-%m-%d')
            days.append({
                'date': date,
                'calories': intake,
                'weight': 175 + ((intake - tdee) / 3500 * offset),
                'lifting': None,
                'drinks': None,
            })
        steps = {day['date']: 7000 for day in days}
        result = tdee_backtest(days, steps, set())
        self.assertIsNotNone(result)
        self.assertGreater(result['count'], 0)
        self.assertLess(result['mae'], 0.25)
        self.assertTrue(result['creatineAdjusted'])

    def test_scale_state_uses_prior_intake_and_beats_constant_baseline(self):
        rng = __import__('numpy').random.default_rng(7)
        start = datetime(2026, 1, 1)
        days = []
        tissue_weight = 170.0
        prior_rows = []
        for offset in range(310):
            date = (start + timedelta(days=offset)).strftime('%Y-%m-%d')
            carbs = 90 + int(rng.integers(0, 190))
            calories = 1650 + int(rng.integers(0, 1500))
            if date == '2026-09-22':
                carbs, calories = 350, 4000
            lifting = 'Y' if offset % 4 == 0 else None
            drinks = '3 whiskey' if offset % 13 == 0 else None
            tissue_weight -= 0.045
            prior_rows.append((carbs, calories))
            if len(prior_rows) >= 2:
                prior_carbs, prior_calories = prior_rows[-2]
                water = ((prior_carbs - 150) / 100 * 0.7) + ((prior_calories - 2200) / 500 * 0.45)
            else:
                water = 0
            noise = float(rng.normal(0, 0.18))
            days.append({
                'date': date,
                'protein': 170,
                'carbs': carbs,
                'fat': 70,
                'calories': calories,
                'weight': tissue_weight + water + noise + creatine_water_adjustment(date),
                'lifting': lifting,
                'drinks': drinks,
            })
        steps = {day['date']: 7000 for day in days}
        result = fit_scale_state_model(days, steps, set(), 2600)
        selected = result['metrics'][result['selectedModel']]
        self.assertTrue(result['usableForBodyComp'])
        self.assertLess(selected['mae'], result['metrics']['constant']['mae'])
        self.assertGreater(selected['correlation'], 0.25)
        self.assertEqual(result['current']['date'], days[-1]['date'])


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
