#!/usr/bin/env python3
"""
Bayesian TDEE estimation, current-maintenance pooling, and walk-forward validation
Run: python3 update_bayes.py

Parses js/data.js, runs creatine-adjusted Bayesian inference for historical
and current TDEE, evaluates 28-day projections, then writes the generated
results back into data.js for the dashboard.
"""

import re, json, sys
import numpy as np
from datetime import datetime, timedelta
from functools import lru_cache

KCAL_PER_STEP = 0.04


# ─────────────────────────────────────────────────────────────────
# 1. Parse data.js
# ─────────────────────────────────────────────────────────────────

def parse_data_js(path):
    with open(path, encoding='utf-8') as f:
        src = f.read()

    # Match every day entry (handles optional notes field)
    day_re = re.compile(
        r'\{date:"(\d{4}-\d{2}-\d{2})"'
        r',protein:(\d+|null)'
        r',carbs:(\d+|null)'
        r',fat:(\d+|null)'
        r',calories:(\d+|null)'
        r',weight:([0-9.]+|null)'
        r',lifting:("Y"|null)'
        r',drinks:(".*?"|null)'
        r'(?:,notes:(?:".*?"|null))?'
        r'\}'
    )

    def maybe_num(s):
        return float(s) if s != 'null' else None

    def maybe_str(s):
        return s.strip('"') if s != 'null' else None

    days = []
    for m in day_re.finditer(src):
        date, protein, carbs, fat, calories, weight, lifting, drinks = m.groups()
        days.append({
            'date':     date,
            'protein':  maybe_num(protein),
            'carbs':    maybe_num(carbs),
            'fat':      maybe_num(fat),
            'calories': maybe_num(calories),
            'weight':   maybe_num(weight),
            'lifting':  maybe_str(lifting),
            'drinks':   maybe_str(drinks),
        })

    # Steps
    step_re = re.compile(r'\{date:"(\d{4}-\d{2}-\d{2})",steps:(\d+)(?P<extra>[^}]*)\}')
    steps_map = {}
    for match in step_re.finditer(src):
        raw_steps = int(match.group(2))
        incline_match = re.search(r',inclineExtraKcal:([0-9.]+)', match.group('extra'))
        incline_kcal = float(incline_match.group(1)) if incline_match else 0.0
        steps_map[match.group(1)] = raw_steps + incline_kcal / KCAL_PER_STEP

    vacation_match = re.search(r'const vacationDates\s*=\s*\[(.*?)\];', src, re.DOTALL)
    vacation_dates = set(re.findall(r'"(\d{4}-\d{2}-\d{2})"', vacation_match.group(1))) if vacation_match else set()

    print(f"  Parsed {len(days)} macro days, {len(steps_map)} step days, {len(vacation_dates)} vacation dates")
    return days, steps_map, vacation_dates, src


# ─────────────────────────────────────────────────────────────────
# 2. Drink calorie estimation (mirrors JS exactly)
# ─────────────────────────────────────────────────────────────────

DRINK_RULES = [
    (r'(?:jamesons?|whiskeys?|whiskies)', 110, None),
    (r'tequilas?', 100, None), (r'beers?', 150, None), (r'wines?', 125, None),
    (r'champagnes?', 125, None), (r"sake(?:'s)?(?: shots?)?", 135, None),
    (r'white claws?', 100, None), (r'old fashioneds?', 170, None),
    (r'(?:whiskey )?highballs?', 130, None), (r'negronis?', 180, None),
    (r'soju bottles?', 540, None), (r'soju', 270, 'soju_half_bottle'),
    (r'(?:drinks?|cocktails?)', 140, 'generic_serving'),
]

def parse_drinks(drinks):
    """Mirror JS parseDrinks, including provisional estimates and review reasons."""
    result = {'calories': 0, 'needsReview': False, 'assumptions': [], 'unparsed': []}
    text = re.sub(r'\s+', ' ', str(drinks if drinks is not None else '')).lower().strip()
    counts = dict(a=1, an=1, one=1, two=2, three=3, four=4, five=5,
                  six=6, seven=7, eight=8, nine=9, ten=10, half=0.5)
    no_alcohol = r'(?:0|none|no|n/a|no (?:alcohol|drinks?)|zero (?:alcohol|drinks?))'
    if not text or re.fullmatch(no_alcohol, text):
        return result
    for part in filter(None, re.split(r'\s*(?:[,;+&]|\band\b)\s*', text)):
        if re.fullmatch(no_alcohol, part):
            continue
        bare_count = re.fullmatch(r'(\d+(?:\.\d+)?|\.\d+)', part)
        match = re.fullmatch(r'(\d+/\d+|\d+(?:\.\d+)?|\.\d+|half|one|two|three|four|five|six|seven|eight|nine|ten|an?)(?:\s+(?:a|an))?\s+(.+)', part)
        count, name = 1, part
        if bare_count:
            count = float(bare_count.group(1))
            name = 'drinks'
        elif match:
            token, name = match.groups()
            if token in counts:
                count = counts[token]
            elif '/' in token:
                numerator, denominator = map(float, token.split('/'))
                count = numerator / denominator if denominator else float('inf')
            else:
                count = float(token)
        rule = next((rule for rule in DRINK_RULES if re.fullmatch(rule[0], name)), None)
        if rule is None or not np.isfinite(count) or count < 0 or count > 100:
            result['calories'] += 140
            result['unparsed'].append(part)
            continue
        result['calories'] += count * rule[1]
        if count > 0:
            if not match and not bare_count:
                result['assumptions'].append('quantity_one')
            if rule[2]:
                result['assumptions'].append(rule[2])
    # Match JS Math.round for nonnegative calorie totals, not Python's ties-to-even.
    result['calories'] = int(np.floor(result['calories'] + 0.5))
    result['assumptions'] = list(dict.fromkeys(result['assumptions']))
    result['needsReview'] = bool(result['assumptions'] or result['unparsed'])
    return result


@lru_cache(maxsize=1024)
def estimate_drink_calories(drinks):
    return parse_drinks(drinks)['calories']

def effective_calories(day):
    return (day['calories'] or 0) + estimate_drink_calories(day.get('drinks'))


SCALE_STATE_SCAN_DATE = '2026-09-23'
SCALE_STATE_FIXED_SCAN_GAP = 1.3
SCALE_STATE_RIDGE_ALPHA = 12.0
SCALE_STATE_MIN_TRAIN_ROWS = 70
SCALE_STATE_MIN_VALIDATION_ROWS = 35


def previous_date(date_str, days=1):
    return (datetime.strptime(date_str, '%Y-%m-%d') - timedelta(days=days)).strftime('%Y-%m-%d')


def glycogen_mass_series(days, tdee_est=2400.0, glycogen_max_g=500.0):
    """Mirror the client glycogen model for an apples-to-apples validation baseline."""
    water_per_g = 3.5
    glycogen = glycogen_max_g * 0.75
    results = {}
    for day in sorted(days, key=lambda item: item['date']):
        drink_kcal = estimate_drink_calories(day.get('drinks'))
        food_cals = day.get('calories') if day.get('calories') is not None else tdee_est
        total_cals = food_cals + drink_kcal
        carbs = day.get('carbs') if day.get('carbs') is not None else round(food_cals * 0.35 / 4)
        deficit = max(0.0, tdee_est - total_cals)
        deficit_ratio = deficit / tdee_est if tdee_est else 0.0
        depletion_factor = 1.0 - (glycogen / glycogen_max_g)
        carb_oxidation = max(0.5, min(0.95, (0.82 - 0.32 * depletion_factor) + deficit_ratio * 0.22))
        carbs_to_glycogen = max(0.0, min(carbs * (1.0 - carb_oxidation), glycogen_max_g - glycogen))
        if drink_kcal > 0:
            carbs_to_glycogen *= 0.65
        fill_fraction = glycogen / glycogen_max_g
        mobilized = min((deficit * 0.18 * fill_fraction) / 4.0, glycogen * 0.10)
        liver_depletion = min((drink_kcal / 100.0) * 8.0, glycogen * 0.15) if drink_kcal > 0 else 0.0
        delta = carbs_to_glycogen - mobilized - liver_depletion
        if day.get('lifting') == 'Y':
            delta -= 35.0
        carb_boost = max(0.0, carbs - 120.0) * 0.18
        deficit_boost = min(30.0, deficit / 25.0)
        lift_boost = 12.0 if day.get('lifting') == 'Y' else 0.0
        max_gain = min(glycogen_max_g - glycogen, 45.0 + depletion_factor * 95.0 + carb_boost)
        max_loss = min(glycogen, 55.0 + fill_fraction * 70.0 + deficit_boost + lift_boost)
        glycogen = max(0.0, min(glycogen_max_g, glycogen + max(-max_loss, min(max_gain, delta))))
        results[day['date']] = (glycogen * (1.0 + water_per_g)) / 453.592
    return results


def scale_state_feature_row(date_str, day_by_date, steps_map, average_steps):
    """Inputs known before the morning weigh-in; today itself is never consulted."""
    prior = [day_by_date.get(previous_date(date_str, lag)) for lag in (1, 2)]
    if any(day is None or day.get('calories') is None or day.get('carbs') is None for day in prior):
        return None
    weights = (0.65, 0.35)
    carbs = sum(weight * day['carbs'] for weight, day in zip(weights, prior))
    food = sum(weight * day['calories'] for weight, day in zip(weights, prior))
    alcohol = sum(weight * estimate_drink_calories(day.get('drinks')) for weight, day in zip(weights, prior))
    lifting = sum(weight * (1.0 if day.get('lifting') == 'Y' else 0.0) for weight, day in zip(weights, prior))
    step_values = [steps_map.get(day['date'], average_steps) for day in prior]
    steps = sum(weight * value for weight, value in zip(weights, step_values))
    return {
        'values': np.array([carbs / 100.0, food / 500.0, alcohol / 500.0, lifting, steps / 5000.0], dtype=float),
        'raw': {
            'carbs2d': round(carbs),
            'foodCalories2d': round(food),
            'alcoholCalories2d': round(alcohol),
            'liftLoad2d': round(lifting, 2),
            'steps2d': round(steps),
            'priorDayCarbs': round(prior[0]['carbs']),
            'priorDayCalories': round(prior[0]['calories']),
        },
    }


def causal_weight_innovations(days):
    """One-step scale residuals from a causal local linear trend."""
    weight_days = [day for day in sorted(days, key=lambda item: item['date']) if model_weight(day) is not None]
    if not weight_days:
        return {}
    diffs = [abs(model_weight(weight_days[i]) - model_weight(weight_days[i - 1])) for i in range(1, len(weight_days))]
    median_diff = float(np.median(diffs)) if diffs else 0.9
    measurement_var = max(0.3, min(2.4, median_diff or 0.9))
    state_weight = model_weight(weight_days[0])
    state_velocity = 0.0
    p00, p01, p11 = 0.8 ** 2, 0.0, 0.11 ** 2
    results = {
        weight_days[0]['date']: {
            'observed': model_weight(weight_days[0]),
            'predicted': model_weight(weight_days[0]),
            'innovation': 0.0,
        }
    }
    for index in range(1, len(weight_days)):
        previous = weight_days[index - 1]
        current = weight_days[index]
        dt = max(1, days_between(previous['date'], current['date']))
        predicted_weight = state_weight + state_velocity * dt
        predicted_velocity = state_velocity * 0.985
        pred_p00 = p00 + dt * (2.0 * p01 + dt * p11) + 0.08 * dt
        pred_p01 = p01 + dt * p11
        pred_p11 = p11 + 0.004 * dt
        observed = model_weight(current)
        innovation = observed - predicted_weight
        innovation_var = pred_p00 + measurement_var
        k0 = pred_p00 / innovation_var if innovation_var else 0.0
        k1 = pred_p01 / innovation_var if innovation_var else 0.0
        state_weight = predicted_weight + k0 * innovation
        state_velocity = predicted_velocity + k1 * innovation
        p00 = max(0.01, (1.0 - k0) * pred_p00)
        p01 = (1.0 - k0) * pred_p01
        p11 = max(0.00005, pred_p11 - k1 * pred_p01)
        results[current['date']] = {
            'observed': observed,
            'predicted': predicted_weight,
            'innovation': innovation,
        }
    return results


def ridge_scale_state_fit(rows, feature_key='values', alpha=SCALE_STATE_RIDGE_ALPHA):
    matrix = np.vstack([row[feature_key] for row in rows])
    target = np.array([row['target'] for row in rows], dtype=float)
    means = np.mean(matrix, axis=0)
    scales = np.std(matrix, axis=0)
    scales[scales < 1e-8] = 1.0
    standardized = (matrix - means) / scales
    centered_target = target - float(np.mean(target))
    coefficients = np.linalg.solve(
        standardized.T @ standardized + np.eye(standardized.shape[1]) * alpha,
        standardized.T @ centered_target,
    )
    return {
        'intercept': float(np.mean(target)),
        'coefficients': coefficients,
        'means': means,
        'scales': scales,
    }


def ridge_scale_state_predict(model, values):
    standardized = (np.asarray(values, dtype=float) - model['means']) / model['scales']
    return model['intercept'] + float(standardized @ model['coefficients'])


def correlation(values_a, values_b):
    if len(values_a) < 3 or np.std(values_a) < 1e-8 or np.std(values_b) < 1e-8:
        return 0.0
    return float(np.corrcoef(values_a, values_b)[0, 1])


def scale_state_training_rows(days, steps_map, excluded_dates, tdee_est):
    sorted_days = sorted(days, key=lambda item: item['date'])
    day_by_date = {day['date']: day for day in sorted_days}
    valid_steps = [value for date, value in steps_map.items() if date not in excluded_dates]
    average_steps = float(np.median(valid_steps)) if valid_steps else 6000.0
    innovations = causal_weight_innovations(sorted_days)
    glycogen = glycogen_mass_series(sorted_days, tdee_est)
    rows = []
    for date_str, innovation in innovations.items():
        feature = scale_state_feature_row(date_str, day_by_date, steps_map, average_steps)
        lag_dates = [previous_date(date_str, lag) for lag in (0, 1, 2)]
        if not feature or any(date in excluded_dates for date in lag_dates):
            continue
        if any(day_by_date.get(previous_date(date_str, lag), {}).get('calories') is None for lag in (1, 2, 3)):
            cut_qualified = False
        else:
            cut_qualified = all(
                effective_calories(day_by_date[previous_date(date_str, lag)]) <= tdee_est
                for lag in (1, 2, 3)
            )
        prior_day = previous_date(date_str)
        row = {
            'date': date_str,
            'target': innovation['innovation'],
            'values': feature['values'],
            'simpleValues': np.array([
                feature['raw']['priorDayCarbs'] / 100.0,
                feature['raw']['priorDayCalories'] / 500.0,
            ], dtype=float),
            'raw': feature['raw'],
            'glycogenMass': glycogen.get(prior_day, 0.0),
            'cutQualified': cut_qualified,
            'weight': day_by_date[date_str].get('weight'),
        }
        rows.append(row)
    return rows


def scale_state_walk_forward(rows):
    records = []
    for index in range(SCALE_STATE_MIN_TRAIN_ROWS, len(rows)):
        train = rows[:index]
        test = rows[index]
        candidate = ridge_scale_state_fit(train)
        simple = ridge_scale_state_fit(train, 'simpleValues', alpha=8.0)
        cut_targets = [row['target'] for row in train if row['cutQualified']]
        cut_level = float(np.median(cut_targets)) if cut_targets else float(np.median([row['target'] for row in train]))
        glyco_intercept = float(np.mean([row['target'] - row['glycogenMass'] for row in train]))
        records.append({
            'date': test['date'],
            'actual': test['target'],
            'candidate': ridge_scale_state_predict(candidate, test['values']),
            'simple': ridge_scale_state_predict(simple, test['simpleValues']),
            'constant': float(np.mean([row['target'] for row in train])),
            'glycogen': glyco_intercept + test['glycogenMass'],
            'fixed': cut_level + SCALE_STATE_FIXED_SCAN_GAP,
        })
    return records


def scale_state_metric(records, key):
    actual = np.array([record['actual'] for record in records], dtype=float)
    predicted = np.array([record[key] for record in records], dtype=float)
    errors = predicted - actual
    return {
        'mae': round(float(np.mean(np.abs(errors))), 3),
        'rmse': round(float(np.sqrt(np.mean(errors ** 2))), 3),
        'correlation': round(correlation(predicted, actual), 3),
    }


def fit_scale_state_model(days, steps_map, excluded_dates, tdee_est):
    """Fit and validate a signed scale-water estimate from pre-weigh-in behavior."""
    rows = scale_state_training_rows(days, steps_map, set(excluded_dates or []), tdee_est)
    if len(rows) <= SCALE_STATE_MIN_TRAIN_ROWS:
        return {
            'usableForBodyComp': False,
            'reason': 'not_enough_training_rows',
            'trainingRows': len(rows),
            'minimumTrainingRows': SCALE_STATE_MIN_TRAIN_ROWS,
        }

    records = scale_state_walk_forward(rows)
    metrics = {
        key: scale_state_metric(records, key)
        for key in ('candidate', 'simple', 'constant', 'glycogen', 'fixed')
    }
    selected_key = min(('candidate', 'simple'), key=lambda key: metrics[key]['mae'])
    selected_mae = metrics[selected_key]['mae']
    best_baseline_mae = min(metrics[key]['mae'] for key in ('constant', 'glycogen'))
    improvement = best_baseline_mae - selected_mae
    relative_improvement = improvement / best_baseline_mae if best_baseline_mae else 0.0

    prediction_by_date = {record['date']: record[selected_key] for record in records}
    cut_predictions = [
        prediction_by_date[row['date']]
        for row in rows
        if row['cutQualified'] and row['date'] in prediction_by_date
    ]
    all_predictions = [record[selected_key] for record in records]
    cut_level = float(np.median(cut_predictions)) if cut_predictions else float(np.median(all_predictions))
    scan_prediction = prediction_by_date.get(SCALE_STATE_SCAN_DATE)
    scan_gap = scan_prediction - cut_level if scan_prediction is not None else None
    latest = records[-1]
    latest_row = next(row for row in reversed(rows) if row['date'] == latest['date'])
    latest_offset = latest[selected_key] - cut_level

    recent_records = records[-7:]
    rolling_offset = float(np.mean([record[selected_key] - cut_level for record in recent_records]))
    validation_errors = np.array([record[selected_key] - record['actual'] for record in records], dtype=float)
    prediction_sigma = float(np.std(validation_errors, ddof=1)) if len(validation_errors) > 1 else selected_mae

    fit_rows = rows[:-1] if len(rows) > SCALE_STATE_MIN_TRAIN_ROWS else rows
    feature_key = 'simpleValues' if selected_key == 'simple' else 'values'
    fitted = ridge_scale_state_fit(fit_rows, feature_key, alpha=8.0 if selected_key == 'simple' else SCALE_STATE_RIDGE_ALPHA)
    latest_values = latest_row[feature_key]
    standardized_latest = (latest_values - fitted['means']) / fitted['scales']
    contributions = standardized_latest * fitted['coefficients']
    if selected_key == 'simple':
        feature_names = ('Prior-day carbs', 'Prior-day calories')
        feature_details = (
            f"{latest_row['raw']['priorDayCarbs']}g",
            f"{latest_row['raw']['priorDayCalories']} kcal",
        )
    else:
        feature_names = ('Two-day carbs', 'Food intake', 'Alcohol', 'Lifting', 'Steps')
        feature_details = (
            f"{latest_row['raw']['carbs2d']}g weighted avg",
            f"{latest_row['raw']['foodCalories2d']} kcal weighted avg",
            f"{latest_row['raw']['alcoholCalories2d']} kcal weighted avg",
            f"{latest_row['raw']['liftLoad2d']} weighted sessions",
            f"{latest_row['raw']['steps2d']:,} weighted avg",
        )
    drivers = sorted([
        {
            'label': label,
            'detail': detail,
            'effectLbs': round(float(effect), 2),
        }
        for label, detail, effect in zip(feature_names, feature_details, contributions)
    ], key=lambda item: abs(item['effectLbs']), reverse=True)[:3]

    enough_validation = len(records) >= SCALE_STATE_MIN_VALIDATION_ROWS
    beats_baselines = improvement >= 0.02 and relative_improvement >= 0.05
    useful_correlation = metrics[selected_key]['correlation'] >= 0.10
    plausible_scan_gap = scan_gap is not None and 0.20 <= scan_gap <= 3.00
    enough_cut_states = len(cut_predictions) >= 15
    usable = all((enough_validation, beats_baselines, useful_correlation, plausible_scan_gap, enough_cut_states))
    failed_gates = []
    if not enough_validation:
        failed_gates.append('validation_sample')
    if not beats_baselines:
        failed_gates.append('baseline_improvement')
    if not useful_correlation:
        failed_gates.append('predictive_correlation')
    if not plausible_scan_gap:
        failed_gates.append('scan_gap')
    if not enough_cut_states:
        failed_gates.append('cut_state_sample')

    current_status = (
        'below-cut' if latest_offset < -0.25
        else 'cut-like' if latest_offset <= 0.25
        else 'fed-like' if scan_gap and latest_offset >= scan_gap * 0.75
        else 'between'
    )
    current_weight = latest_row.get('weight')
    history = []
    for record in records[-14:]:
        row = next(item for item in reversed(rows) if item['date'] == record['date'])
        history.append({
            'date': record['date'],
            'offsetAboveCut': round(record[selected_key] - cut_level, 2),
            'weight': row.get('weight'),
        })

    return {
        'method': 'causal_ridge_scale_residual',
        'selectedModel': selected_key,
        'usableForBodyComp': usable,
        'failedGates': failed_gates,
        'trainingRows': len(rows),
        'validationRows': len(records),
        'cutStateRows': len(cut_predictions),
        'featureLagDays': 1 if selected_key == 'simple' else 2,
        'target': 'creatine-adjusted one-step weight innovation',
        'metrics': metrics,
        'bestBaselineMae': round(best_baseline_mae, 3),
        'maeImprovement': round(improvement, 3),
        'maeImprovementPct': round(relative_improvement * 100, 1),
        'predictionSigma': round(prediction_sigma, 2),
        'cutStateResidual': round(cut_level, 2),
        'scanDate': SCALE_STATE_SCAN_DATE,
        'estimatedScanGap': round(scan_gap, 2) if scan_gap is not None else None,
        'bodyCompGap': round(scan_gap, 2) if usable else SCALE_STATE_FIXED_SCAN_GAP,
        'fallbackGap': SCALE_STATE_FIXED_SCAN_GAP,
        'current': {
            'date': latest['date'],
            'status': current_status,
            'predictedResidual': round(latest[selected_key], 2),
            'offsetAboveCut': round(latest_offset, 2),
            'offsetLow': round(latest_offset - prediction_sigma, 2),
            'offsetHigh': round(latest_offset + prediction_sigma, 2),
            'rollingOffsetAboveCut': round(rolling_offset, 2),
            'cutStateEquivalentWeight': round(current_weight - latest_offset, 1) if current_weight is not None else None,
            'inputs': latest_row['raw'],
            'drivers': drivers,
        },
        'recentHistory': history,
    }


# ─────────────────────────────────────────────────────────────────
# 3. Bayesian conjugate TDEE inference
# ─────────────────────────────────────────────────────────────────

DIET_BREAK_START  = '2026-02-27'
DIET_BREAK_END    = '2026-03-07'
CREATINE_START_DATE = '2026-07-02'
CREATINE_FULL_WATER_LBS = 1.8
CREATINE_RAMP_DAYS = 21
MAX_UNLOGGED_DAYS = 2
BOOTSTRAP_BLOCK_OBS = 7
BOOTSTRAP_SAMPLES = 600
BOOTSTRAP_SEED = 42
# Systematic calorie-logging bias floor (kcal) — portion of uncertainty that
# does NOT shrink with more data (logging errors, label inaccuracies, etc.)
SIGMA_CAL_BIAS    = 150.0


def days_between(start_date, end_date):
    return (datetime.strptime(end_date, '%Y-%m-%d') - datetime.strptime(start_date, '%Y-%m-%d')).days


def creatine_water_adjustment(date_str):
    """Mirror the client-side 21-day creatine scale-water ramp."""
    if not date_str or date_str < CREATINE_START_DATE:
        return 0.0
    days_since_start = days_between(CREATINE_START_DATE, date_str)
    progress = min(1.0, max(0.0, (days_since_start + 1) / CREATINE_RAMP_DAYS))
    return CREATINE_FULL_WATER_LBS * progress


def model_weight(day):
    weight = day.get('weight')
    return None if weight is None else weight - creatine_water_adjustment(day['date'])

def is_diet_break(date_str):
    return DIET_BREAK_START <= date_str <= DIET_BREAK_END


def daterange(start_dt, end_dt_exclusive):
    cur = start_dt
    while cur < end_dt_exclusive:
        yield cur
        cur += timedelta(days=1)


def default_tdee_exclusions(vacation_dates=None):
    excluded = set(vacation_dates or [])
    break_start = datetime.strptime(DIET_BREAK_START, '%Y-%m-%d')
    break_end = datetime.strptime(DIET_BREAK_END, '%Y-%m-%d') + timedelta(days=1)
    excluded.update(day.strftime('%Y-%m-%d') for day in daterange(break_start, break_end))
    return excluded


def contiguous_exclusion_ranges(excluded_dates, end_date=None):
    dates = sorted(date for date in set(excluded_dates or []) if not end_date or date <= end_date)
    if not dates:
        return []
    ranges = []
    start = previous = dates[0]
    for date_str in dates[1:]:
        expected = (datetime.strptime(previous, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
        if date_str != expected:
            ranges.append((start, previous))
            start = date_str
        previous = date_str
    ranges.append((start, previous))
    return ranges


def clean_tdee_segments(days, excluded_dates, end_date):
    exclusion_ranges = contiguous_exclusion_ranges(excluded_dates, end_date)
    segments = []
    current_segment = []
    previous_date = None
    for day in sorted(days, key=lambda item: item['date']):
        if day['date'] > end_date or day['date'] in excluded_dates:
            continue
        if day.get('calories') is None:
            continue
        crosses_exclusion = previous_date is not None and any(
            previous_date < range_end < day['date'] or previous_date < range_start <= day['date']
            for range_start, range_end in exclusion_ranges
        )
        missing_days = days_between(previous_date, day['date']) - 1 if previous_date else 0
        if current_segment and (crosses_exclusion or missing_days > MAX_UNLOGGED_DAYS):
            segments.append(current_segment)
            current_segment = []
        current_segment.append(day)
        previous_date = day['date']
    if current_segment:
        segments.append(current_segment)
    return segments


def interval_crosses_exclusion(start_date, end_date, excluded_dates):
    return any(start_date <= date_str < end_date for date_str in excluded_dates)


def moving_block_bootstrap_se(design, y_values, coefficients, segment_ids,
                              block_size=BOOTSTRAP_BLOCK_OBS,
                              samples=BOOTSTRAP_SAMPLES,
                              seed=BOOTSTRAP_SEED):
    """Estimate slope uncertainty while preserving short-range residual correlation."""
    fitted = design @ coefficients
    residuals = y_values - fitted
    rng = np.random.default_rng(seed)
    segment_ids = np.asarray(segment_ids, dtype=int)
    boot_slopes = []
    for _ in range(samples):
        sampled = np.zeros_like(residuals)
        for segment_id in np.unique(segment_ids):
            idx = np.flatnonzero(segment_ids == segment_id)
            values = residuals[idx]
            values = values - float(np.mean(values))
            if len(values) == 1:
                sampled[idx] = values
                continue
            width = min(block_size, len(values))
            rebuilt = []
            while len(rebuilt) < len(values):
                start = int(rng.integers(0, len(values)))
                rebuilt.extend(values[(start + offset) % len(values)] for offset in range(width))
            sampled[idx] = np.asarray(rebuilt[:len(values)])
        boot_coef, _, _, _ = np.linalg.lstsq(design, fitted + sampled, rcond=None)
        boot_slopes.append(-float(boot_coef[-1]))
    return float(np.std(boot_slopes, ddof=1)) if len(boot_slopes) > 1 else 0.0


def complete_week_rows(days, steps_map, end_date, excluded_dates):
    """Build complete Monday-Sunday observations with smoothed boundary weights."""
    included = {
        day['date']: day for day in days
        if day['date'] <= end_date and day['date'] not in excluded_dates
        and day.get('calories') is not None
    }
    if not included:
        return []
    valid_steps = [steps_map[d] for d in included if d in steps_map]
    avg_steps = float(np.mean(valid_steps)) if valid_steps else 6000.0
    first = datetime.strptime(min(included), '%Y-%m-%d')
    cursor = first - timedelta(days=first.weekday())
    final = datetime.strptime(max(included), '%Y-%m-%d')
    rows = []
    while cursor + timedelta(days=6) <= final:
        dates = [(cursor + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(7)]
        week = [included.get(date) for date in dates]
        if all(week):
            weights = [model_weight(day) for day in week]
            if sum(weight is not None for weight in weights) >= 5:
                start_weights = [weight for weight in weights[:3] if weight is not None]
                end_weights = [weight for weight in weights[-3:] if weight is not None]
                if start_weights and end_weights:
                    intake = float(np.mean([effective_calories(day) for day in week]))
                    step_dev = float(np.mean([
                        (steps_map.get(day['date'], avg_steps) - avg_steps) / 1000.0
                        for day in week
                    ]))
                    weight_change = float(np.mean(end_weights) - np.mean(start_weights))
                    rows.append({
                        'start': dates[0],
                        'end': dates[-1],
                        'implied_tdee': intake - (weight_change * 3500.0 / 4.0),
                        'step_dev_k': step_dev,
                        'lift_days': sum(day.get('lifting') == 'Y' for day in week),
                        'drink_days': sum(bool(day.get('drinks')) for day in week),
                    })
        cursor += timedelta(days=7)
    return rows


def weekly_block_bootstrap_se(days, steps_map, end_date, excluded_dates,
                              samples=BOOTSTRAP_SAMPLES, seed=BOOTSTRAP_SEED):
    """Estimate TDEE sampling error from complete weekly energy-balance blocks."""
    rows = complete_week_rows(days, steps_map, end_date, excluded_dates)
    values = np.array([row['implied_tdee'] for row in rows], dtype=float)
    if len(values) < 3 or not samples:
        return None
    rng = np.random.default_rng(seed)
    width = min(2, len(values))
    means = []
    for _ in range(samples):
        rebuilt = []
        while len(rebuilt) < len(values):
            start = int(rng.integers(0, len(values)))
            rebuilt.extend(values[(start + offset) % len(values)] for offset in range(width))
        means.append(float(np.mean(rebuilt[:len(values)])))
    return float(np.std(means, ddof=1))


def estimate_activity_terms(days, steps_map, end_date=None, excluded_dates=None):
    yesterday = end_date or (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    excluded_dates = set(excluded_dates or [])
    valid_steps = [
        value for date_str, value in steps_map.items()
        if date_str <= yesterday and date_str not in excluded_dates
    ]
    avg_steps = float(np.mean(valid_steps)) if valid_steps else 6000.0
    rows = complete_week_rows(days, steps_map, yesterday, excluded_dates)
    if len(rows) < 8:
        return None

    y = np.array([r['implied_tdee'] for r in rows], dtype=float)
    X = np.column_stack([
        np.ones(len(rows)),
        np.array([r['step_dev_k'] for r in rows], dtype=float),
        np.array([r['lift_days'] for r in rows], dtype=float),
        np.array([r['drink_days'] for r in rows], dtype=float)
    ])
    ridge = np.diag([0.0, 0.5, 1.5, 1.5])
    coef = np.linalg.solve(X.T @ X + ridge, X.T @ y)
    y_hat = X @ coef
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2)) or 1.0
    r2 = max(0.0, 1.0 - (ss_res / ss_tot))

    raw_step = float(np.clip(coef[1], -120, 140))
    raw_lift = float(np.clip(coef[2], -250, 250))
    raw_drink = float(np.clip(coef[3], -250, 250))
    trust = max(0.0, min(1.0, ((r2 - 0.08) / 0.32))) * max(0.0, min(1.0, (len(rows) - 8) / 18.0))
    priors = {'stepPer1k': 35.0, 'liftDay': 95.0, 'drinkDay': 65.0}
    step_per_1k = (raw_step * trust) + (priors['stepPer1k'] * (1 - trust))
    lift_day = (raw_lift * trust) + (priors['liftDay'] * (1 - trust))
    drink_day = (raw_drink * trust) + (priors['drinkDay'] * (1 - trust))
    confidence = 'high' if trust >= 0.7 else 'moderate' if trust >= 0.4 else 'low'

    return {
        'baseline': round(float(coef[0])),
        'rawStepPer1k': round(raw_step),
        'rawLiftDay': round(raw_lift),
        'rawDrinkDay': round(raw_drink),
        'stepPer1k': round(step_per_1k),
        'liftDay': round(lift_day),
        'drinkDay': round(drink_day),
        'intervalCount': len(rows),
        'avgIntervalDays': 7,
        'aggregation': 'complete_weeks',
        'r2': round(r2, 3),
        'trust': round(trust, 3),
        'confidence': confidence,
        'avgSteps': round(avg_steps)
    }

def bayesian_tdee_profile(days, steps_map, end_date=None, prior_mean=2500.0, prior_sigma=400.0,
                          verbose=True, excluded_dates=None, bootstrap_samples=BOOTSTRAP_SAMPLES):
    """Estimate one TDEE slope across clean, separately anchored diet segments."""
    yesterday = end_date or (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    candidate_days = [day for day in days if day['date'] <= yesterday]
    if not candidate_days:
        raise ValueError("Need macro data inside the requested TDEE window")
    range_start = min(day['date'] for day in candidate_days)
    excluded_dates = {
        date for date in set(excluded_dates or [])
        if range_start <= date <= yesterday
    }

    valid_steps = [
        value for date_str, value in steps_map.items()
        if range_start <= date_str <= yesterday and date_str not in excluded_dates
    ]
    avg_steps = float(np.mean(valid_steps)) if valid_steps else 6000.0
    all_days_sorted = sorted(
        [d for d in days if d['date'] <= yesterday and d['date'] not in excluded_dates],
        key=lambda d: d['date']
    )

    cal_by_date = {}
    for day in all_days_sorted:
        if day['calories']:
            steps = steps_map.get(day['date'], avg_steps)
            neat_adj = (steps - avg_steps) * KCAL_PER_STEP
            cal_by_date[day['date']] = effective_calories(day) - neat_adj
    mean_net_cal = float(np.mean(list(cal_by_date.values()))) if cal_by_date else 1900.0

    usable_segments = []
    for segment in clean_tdee_segments(days, excluded_dates, yesterday):
        weight_days = [day for day in segment if day['weight'] is not None]
        if len(weight_days) >= 3:
            usable_segments.append(weight_days)
    if sum(len(weight_days) - 1 for weight_days in usable_segments) < 5:
        raise ValueError("Need at least 5 clean weight observations outside excluded ranges")

    t_vals, y_vals, segment_ids = [], [], []
    obs_details, used_weight_days, segment_spans = [], [], []
    for segment_id, weight_days in enumerate(usable_segments):
        ref_date = datetime.strptime(weight_days[0]['date'], '%Y-%m-%d')
        last_date = datetime.strptime(weight_days[-1]['date'], '%Y-%m-%d')
        ref_weight = model_weight(weight_days[0])
        segment_spans.append((last_date - ref_date).days)
        used_weight_days.extend(weight_days)

        cum_net_cal = {}
        running = 0.0
        current = ref_date
        while current <= last_date:
            date_str = current.strftime('%Y-%m-%d')
            cum_net_cal[date_str] = running
            running += cal_by_date.get(date_str, mean_net_cal)
            current += timedelta(days=1)

        for day in weight_days[1:]:
            t_i = (datetime.strptime(day['date'], '%Y-%m-%d') - ref_date).days
            if t_i <= 0:
                continue
            adjusted_weight = model_weight(day)
            y_i = (adjusted_weight - ref_weight) * 3500.0 - cum_net_cal.get(day['date'], 0.0)
            t_vals.append(t_i)
            y_vals.append(y_i)
            segment_ids.append(segment_id)
            obs_details.append({
                'date': day['date'],
                'segment': segment_id + 1,
                't': t_i,
                'Y': round(y_i),
                'implied': round(-y_i / t_i),
                'creatineAdjustment': round(creatine_water_adjustment(day['date']), 3),
            })

    t_arr = np.array(t_vals, dtype=float)
    y_arr = np.array(y_vals, dtype=float)
    segment_count = len(usable_segments)
    intercepts = np.zeros((len(t_arr), segment_count), dtype=float)
    intercepts[np.arange(len(t_arr)), np.array(segment_ids, dtype=int)] = 1.0
    design = np.column_stack([intercepts, t_arr])
    coef, _, _, _ = np.linalg.lstsq(design, y_arr, rcond=None)
    tdee_mle = -coef[-1]

    residuals = y_arr - (design @ coef)
    n, p = len(t_arr), segment_count + 1
    sigma_resid = float(np.std(residuals, ddof=p))
    covariance = sigma_resid**2 * np.linalg.inv(design.T @ design)
    iid_se_tdee = float(np.sqrt(covariance[-1, -1]))
    bootstrap_se_tdee = moving_block_bootstrap_se(
        design,
        y_arr,
        coef,
        segment_ids,
        samples=bootstrap_samples,
        seed=BOOTSTRAP_SEED + int(yesterday.replace('-', '')),
    ) if bootstrap_samples else iid_se_tdee
    weekly_se_tdee = weekly_block_bootstrap_se(
        days,
        steps_map,
        yesterday,
        excluded_dates,
        samples=bootstrap_samples,
        seed=(BOOTSTRAP_SEED * 2) + int(yesterday.replace('-', '')),
    )
    se_tdee = max(bootstrap_se_tdee, weekly_se_tdee or 0.0, 1.0)

    prior_precision = 1.0 / float(prior_sigma)**2
    data_precision = 1.0 / se_tdee**2
    sigma_post = float(np.sqrt(1.0 / (prior_precision + data_precision)))
    mu_post = sigma_post**2 * (float(prior_mean) * prior_precision + tdee_mle * data_precision)
    sigma_final = float(np.sqrt(sigma_post**2 + SIGMA_CAL_BIAS**2))
    activity_terms = estimate_activity_terms(days, steps_map, yesterday, excluded_dates)

    if verbose:
        print(f"  OLS TDEE: {round(tdee_mle)} kcal  iid_SE={round(iid_se_tdee)} kcal  "
              f"cumulative_bootstrap_SE={round(bootstrap_se_tdee)} kcal  "
              f"weekly_bootstrap_SE={round(weekly_se_tdee) if weekly_se_tdee is not None else 'n/a'} kcal")
        print(f"  Clean segments: {segment_count}; excluded dates: {len(excluded_dates)}")
        print(f"  Bayesian posterior (before bias floor): {round(mu_post)} ± {round(sigma_post)}")
        print(f"  After +{SIGMA_CAL_BIAS} kcal bias floor: ± {round(sigma_final)}")
        if activity_terms:
            print(f"  Activity terms: {activity_terms['stepPer1k']} kcal/1k steps, {activity_terms['liftDay']} kcal lift-day, {activity_terms['drinkDay']} kcal drink-day (R²={activity_terms['r2']})")

    return {
        'date': yesterday,
        'mean': round(mu_post),
        'sigma': round(sigma_final, 1),
        'ci95Low': round(mu_post - 1.96 * sigma_final),
        'ci95High': round(mu_post + 1.96 * sigma_final),
        'ci68Low': round(mu_post - sigma_final),
        'ci68High': round(mu_post + sigma_final),
        'nObs': len(obs_details),
        'avgSteps': round(avg_steps),
        'SE_TDEE': round(se_tdee),
        'iidSE_TDEE': round(iid_se_tdee),
        'cumulativeBootstrapSE': round(bootstrap_se_tdee),
        'weeklyBootstrapSE': round(weekly_se_tdee) if weekly_se_tdee is not None else None,
        'statisticalSigma': round(sigma_post, 1),
        'loggingSigma': round(SIGMA_CAL_BIAS, 1),
        'uncertaintyMethod': 'complete-week block bootstrap with cumulative-residual cross-check',
        'bootstrapSamples': bootstrap_samples,
        'creatineAdjusted': True,
        'creatineStart': CREATINE_START_DATE,
        'creatineFullWaterLbs': CREATINE_FULL_WATER_LBS,
        'windowStart': used_weight_days[0]['date'],
        'windowEnd': used_weight_days[-1]['date'],
        'spanDays': sum(segment_spans),
        'segmentCount': segment_count,
        'excludedDays': len(excluded_dates),
        'excludedRanges': [
            {'start': start, 'end': end}
            for start, end in contiguous_exclusion_ranges(excluded_dates, yesterday)
        ],
        'activityTerms': activity_terms,
        'observations': obs_details,
    }


def tdee_logging_sensitivity(days, steps_map, base_profile, excluded_dates=None):
    """Refit food-only bias assumptions; compare intake and burn on matched days."""
    end_date = base_profile['date']
    excluded = set(excluded_dates or [])
    budget_dates = set()
    for segment in clean_tdee_segments(days, excluded, end_date):
        weights = [day for day in segment if day['weight'] is not None]
        if len(weights) < 3:
            continue
        # Morning-to-morning weight changes use food before the ending weigh-in.
        start = datetime.strptime(weights[0]['date'], '%Y-%m-%d')
        end = datetime.strptime(weights[-1]['date'], '%Y-%m-%d')
        budget_dates.update(day.strftime('%Y-%m-%d') for day in daterange(start, end))
    logged = [day for day in days if day['date'] in budget_dates
              and day['calories'] is not None and np.isfinite(day['calories']) and day['calories'] > 0]
    if not logged:
        return None
    mean_food = float(np.mean([day['calories'] for day in logged]))
    mean_alcohol = float(np.mean([estimate_drink_calories(day.get('drinks')) for day in logged]))
    rows = []
    for factor in (1.0, 1.10, 1.15):
        scaled = [{**day, 'calories': None if day['calories'] is None else day['calories'] * factor}
                  for day in days]
        profile = base_profile if factor == 1.0 else bayesian_tdee_profile(
            scaled, steps_map, end_date=end_date, excluded_dates=excluded,
            verbose=False, bootstrap_samples=base_profile.get('bootstrapSamples', BOOTSTRAP_SAMPLES))
        # Match burn to the activity of the same logged days used for intake.
        step_adjustment = float(np.mean([
            (steps_map.get(day['date'], profile['avgSteps']) - profile['avgSteps']) * KCAL_PER_STEP
            for day in logged
        ]))
        intake = mean_food * factor + mean_alcohol
        tdee = profile['mean'] + step_adjustment
        rows.append({
            'foodMultiplier': factor,
            'tdee': round(tdee, 2),
            'intake': round(intake, 2),
            'food': round(mean_food * factor, 2),
            'alcohol': round(mean_alcohol, 2),
            'netDeficit': round(tdee - intake, 2),
        })
    return {
        'start': min(budget_dates), 'end': max(budget_dates),
        'asOf': end_date, 'loggedDays': len(logged), 'eligibleDays': len(budget_dates),
        'stepDays': sum(day['date'] in steps_map for day in logged),
        'rows': rows,
    }


def bayesian_tdee(days, steps_map, excluded_dates=None):
    profile = bayesian_tdee_profile(days, steps_map, excluded_dates=excluded_dates)
    profile['loggingSensitivity'] = tdee_logging_sensitivity(days, steps_map, profile, excluded_dates)
    return profile


def bayesian_tdee_timeline(days, steps_map, excluded_dates=None, window_days=35, min_weight_obs=5, min_span_days=14):
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    excluded_dates = set(excluded_dates or [])
    all_days_sorted = sorted([d for d in days if d['date'] <= yesterday], key=lambda d: d['date'])
    if not all_days_sorted:
        return []

    timeline = []
    all_dates = [d['date'] for d in all_days_sorted]
    for target_date in all_dates:
        target_dt = datetime.strptime(target_date, '%Y-%m-%d')
        start_dt = target_dt - timedelta(days=window_days - 1)
        start_date = start_dt.strftime('%Y-%m-%d')
        window_slice = [d for d in all_days_sorted if start_date <= d['date'] <= target_date]
        weight_days = [d for d in window_slice if d['weight'] is not None]
        if len(weight_days) < min_weight_obs:
            continue
        span_days = (datetime.strptime(weight_days[-1]['date'], '%Y-%m-%d') - datetime.strptime(weight_days[0]['date'], '%Y-%m-%d')).days
        if span_days < min_span_days:
            continue
        try:
            profile = bayesian_tdee_profile(
                window_slice,
                steps_map,
                end_date=target_date,
                verbose=False,
                excluded_dates=excluded_dates,
                bootstrap_samples=200,
            )
        except Exception:
            continue
        timeline.append({
            'date': profile['date'],
            'mean': profile['mean'],
            'sigma': profile['sigma'],
            'ci68Low': profile['ci68Low'],
            'ci68High': profile['ci68High'],
            'ci95Low': profile['ci95Low'],
            'ci95High': profile['ci95High'],
            'nObs': profile['nObs'],
            'avgSteps': profile['avgSteps'],
            'SE_TDEE': profile['SE_TDEE'],
            'iidSE_TDEE': profile['iidSE_TDEE'],
            'cumulativeBootstrapSE': profile['cumulativeBootstrapSE'],
            'weeklyBootstrapSE': profile['weeklyBootstrapSE'],
            'statisticalSigma': profile['statisticalSigma'],
            'loggingSigma': profile['loggingSigma'],
            'uncertaintyMethod': profile['uncertaintyMethod'],
            'creatineAdjusted': profile['creatineAdjusted'],
            'windowStart': profile['windowStart'],
            'windowEnd': profile['windowEnd'],
            'spanDays': profile['spanDays'],
            'windowDays': window_days,
            'segmentCount': profile.get('segmentCount', 1),
            'excludedDays': profile.get('excludedDays', 0),
            'excludedRanges': profile.get('excludedRanges', []),
            'activityTerms': profile.get('activityTerms'),
            'loggingSensitivity': tdee_logging_sensitivity(window_slice, steps_map, profile, excluded_dates),
        })
    return timeline


def partially_pooled_current_tdee(full_profile, recent_profile, days):
    """Pool recent evidence toward a weight-adjusted full-history prior."""
    weights = [(day['date'], model_weight(day)) for day in days if model_weight(day) is not None]
    historical_weight = float(np.mean([weight for _, weight in weights])) if weights else None
    current_weights = [weight for _, weight in weights[-7:]]
    current_weight = float(np.mean(current_weights)) if current_weights else historical_weight
    weight_adjustment = 0.0 if historical_weight is None else (current_weight - historical_weight) * 10.0
    historical_prior_mean = full_profile['mean'] + weight_adjustment
    drift_sigma = 180.0
    recent_sigma = max(float(recent_profile.get('statisticalSigma') or recent_profile.get('SE_TDEE') or 180), 35.0)
    prior_sigma = float(np.sqrt(float(full_profile.get('statisticalSigma', 100)) ** 2 + drift_sigma ** 2))
    prior_precision = 1.0 / prior_sigma ** 2
    recent_precision = 1.0 / recent_sigma ** 2
    statistical_sigma = float(np.sqrt(1.0 / (prior_precision + recent_precision)))
    mean = (historical_prior_mean * prior_precision + recent_profile['mean'] * recent_precision) / (prior_precision + recent_precision)
    logging_sigma = float(full_profile.get('loggingSigma', SIGMA_CAL_BIAS))
    sigma = float(np.sqrt(statistical_sigma ** 2 + logging_sigma ** 2))
    return {
        'date': recent_profile['date'],
        'mean': round(mean),
        'sigma': round(sigma, 1),
        'ci68Low': round(mean - sigma),
        'ci68High': round(mean + sigma),
        'ci95Low': round(mean - 1.96 * sigma),
        'ci95High': round(mean + 1.96 * sigma),
        'statisticalSigma': round(statistical_sigma, 1),
        'loggingSigma': round(logging_sigma, 1),
        'historicalMean': full_profile['mean'],
        'recentMean': recent_profile['mean'],
        'historicalWeight': round(historical_weight, 1) if historical_weight is not None else None,
        'currentWeight': round(current_weight, 1) if current_weight is not None else None,
        'weightAdjustment': round(weight_adjustment),
        'kcalPerLbPrior': 10,
        'recentWindowDays': recent_profile.get('windowDays', 35),
        'method': 'Recent block-bootstrap estimate partially pooled toward the weight-adjusted historical average',
    }


def tdee_backtest(days, steps_map, excluded_dates=None, horizon_days=28):
    """Walk forward without future leakage and compare 28-day projections to outcomes."""
    excluded = set(excluded_dates or [])
    ordered = sorted(days, key=lambda day: day['date'])
    by_date = {day['date']: day for day in ordered}
    if len(ordered) < 70:
        return None
    first_dt = datetime.strptime(ordered[0]['date'], '%Y-%m-%d') + timedelta(days=49)
    final_dt = datetime.strptime(ordered[-1]['date'], '%Y-%m-%d') - timedelta(days=horizon_days)
    records = []
    cursor = first_dt
    while cursor <= final_dt:
        cutoff = cursor.strftime('%Y-%m-%d')
        future_dates = [(cursor + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(horizon_days)]
        outcome_dates = [(cursor + timedelta(days=i)).strftime('%Y-%m-%d') for i in range(horizon_days - 6, horizon_days + 1)]
        if any(date in excluded or date not in by_date for date in future_dates):
            cursor += timedelta(days=7)
            continue
        history = [day for day in ordered if day['date'] <= cutoff]
        future = [by_date[date] for date in future_dates]
        baseline_weights = [model_weight(day) for day in history[-7:] if model_weight(day) is not None]
        outcome_weights = [model_weight(by_date[date]) for date in outcome_dates if date in by_date and model_weight(by_date[date]) is not None]
        if len(baseline_weights) < 4 or len(outcome_weights) < 4:
            cursor += timedelta(days=7)
            continue
        try:
            full = bayesian_tdee_profile(
                history, steps_map, end_date=cutoff, excluded_dates=excluded,
                verbose=False, bootstrap_samples=200,
            )
            recent_start = (cursor - timedelta(days=41)).strftime('%Y-%m-%d')
            recent_days = [day for day in history if day['date'] >= recent_start]
            recent = bayesian_tdee_profile(
                recent_days, steps_map, end_date=cutoff, excluded_dates=excluded,
                verbose=False, bootstrap_samples=200,
            )
        except (ValueError, np.linalg.LinAlgError):
            cursor += timedelta(days=7)
            continue
        recent['windowDays'] = 42
        current = partially_pooled_current_tdee(full, recent, history)
        baseline = float(np.mean(baseline_weights))
        avg_steps = full['avgSteps']
        energy_change = sum(
            effective_calories(day) - ((steps_map.get(day['date'], avg_steps) - avg_steps) * KCAL_PER_STEP) - current['mean']
            for day in future
        )
        projected = baseline + energy_change / 3500.0
        actual = float(np.mean(outcome_weights))
        sigma_weight = float(np.sqrt(((current['sigma'] * horizon_days) / 3500.0) ** 2 + 0.5 ** 2))
        error = projected - actual
        records.append({
            'asOf': cutoff,
            'outcomeDate': (cursor + timedelta(days=horizon_days)).strftime('%Y-%m-%d'),
            'projected': round(projected, 2),
            'actual': round(actual, 2),
            'error': round(error, 2),
            'inside68': abs(error) <= sigma_weight,
            'inside95': abs(error) <= 1.96 * sigma_weight,
        })
        cursor += timedelta(days=7)
    if not records:
        return None
    return {
        'horizonDays': horizon_days,
        'count': len(records),
        'meanError': round(float(np.mean([row['error'] for row in records])), 2),
        'mae': round(float(np.mean([abs(row['error']) for row in records])), 2),
        'coverage68': round(100 * sum(row['inside68'] for row in records) / len(records)),
        'coverage95': round(100 * sum(row['inside95'] for row in records) / len(records)),
        'creatineAdjusted': True,
        'records': records,
    }


# ─────────────────────────────────────────────────────────────────
# 5. Write results back into data.js
# ─────────────────────────────────────────────────────────────────

BAYES_START = '// BAYES_START'
BAYES_END   = '// BAYES_END'

def update_data_js(path, src, bayes_tdee_result, tdee_timeline, current_tdee=None, backtest=None, scale_state=None):
    # Strip old block if present
    src = re.sub(
        r'\n' + re.escape(BAYES_START) + r'.*?' + re.escape(BAYES_END) + r'\n',
        '\n',
        src,
        flags=re.DOTALL,
    )
    src = re.sub(
        r'(window\.dashboardData\s*=\s*\{[^;\n]*\};)\s*(?=\}\)\(\);\s*$)',
        r'\1\n',
        src,
        count=1,
    )

    # Serialize — strip 'observations' from the JSON written to data.js to keep it slim
    tdee_out = {k: v for k, v in bayes_tdee_result.items() if k != 'observations'}
    tdee_json = json.dumps(tdee_out, separators=(',', ':'))
    timeline_json = json.dumps(tdee_timeline, separators=(',', ':'))
    current_json = json.dumps(current_tdee, separators=(',', ':'))
    backtest_json = json.dumps(backtest, separators=(',', ':'))
    scale_state_json = json.dumps(scale_state, separators=(',', ':'))

    block = (
        f"\n{BAYES_START}\n"
        f"window.dashboardData.bayesian = {{\n"
        f"  tdeePosterior: {tdee_json},\n"
        f"  tdeeTimeline: {timeline_json},\n"
        f"  currentTDEE: {current_json},\n"
        f"  backtest: {backtest_json},\n"
        f"  scaleState: {scale_state_json}\n"
        f"}};\n"
        f"{BAYES_END}\n"
    )

    # Insert after the dashboardData export if present, regardless of fields.
    src, export_replacements = re.subn(
        r'(window\.dashboardData\s*=\s*\{[^;\n]*\};)',
        lambda m: m.group(1) + block,
        src,
        count=1,
    )
    if export_replacements == 0:
        # Fallback: append immediately before the closing IIFE.
        src, close_replacements = re.subn(
            r'\n\}\)\(\);\s*$',
            block + '\n})();\n',
            src,
            count=1,
        )
        if close_replacements == 0:
            raise RuntimeError("Could not find dashboardData export or closing IIFE in js/data.js")

    src = src.rstrip() + '\n'

    with open(path, 'w', encoding='utf-8') as f:
        f.write(src)

    print(f"\n✓ {path} updated")
    print(f"  Bayesian TDEE: {bayes_tdee_result['mean']} kcal  "
          f"95% CI [{bayes_tdee_result['ci95Low']}–{bayes_tdee_result['ci95High']}]  "
          f"(σ={bayes_tdee_result['sigma']}  n={bayes_tdee_result['nObs']} intervals)")
    print(f"  TDEE timeline: {len(tdee_timeline)} rolling points")
    if current_tdee:
        print(f"  Current TDEE: {current_tdee['mean']} kcal  "
              f"(recent {current_tdee.get('recentMean', 'n/a')}, "
              f"historical {current_tdee.get('historicalMean', 'n/a')})")
    if backtest:
        print(f"  28-day backtest: MAE {backtest['mae']} lbs across "
              f"{backtest.get('count', 'n/a')} checkpoints")
    if scale_state:
        selected_key = scale_state.get('selectedModel', 'candidate')
        metrics = scale_state.get('metrics', {}).get(selected_key, {})
        print(f"  Scale state: {'active' if scale_state.get('usableForBodyComp') else 'diagnostic only'}  "
              f"MAE {metrics.get('mae', 'n/a')} lbs  "
              f"current {scale_state.get('current', {}).get('offsetAboveCut', 'n/a')} lbs vs cut-state")


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    data_js = sys.argv[1] if len(sys.argv) > 1 else 'js/data.js'

    print("── Parsing data.js ──────────────────────────────────────")
    days, steps_map, vacation_dates, src = parse_data_js(data_js)
    excluded_dates = default_tdee_exclusions(vacation_dates)

    print("\n── Bayesian TDEE (full-trajectory regression) ───────────")
    bt = bayesian_tdee(days, steps_map, excluded_dates)
    print(f"  Posterior: {bt['mean']} ± {bt['sigma']} kcal")
    print(f"  68% CI:   [{bt['ci68Low']}, {bt['ci68High']}]")
    print(f"  95% CI:   [{bt['ci95Low']}, {bt['ci95High']}]")
    print(f"  n weight obs: {bt['nObs']}  (avg {bt['avgSteps']:,} steps/day)")
    print("  Last 5 weight observations (implied TDEE):")
    for obs in bt['observations'][-5:]:
        print(f"    {obs['date']} (t={obs['t']}d): implied {obs['implied']} kcal")

    print("\n── Rolling Bayesian TDEE timeline ───────────────────────")
    timeline = bayesian_tdee_timeline(days, steps_map, excluded_dates)
    if timeline:
        print(f"  Timeline points: {len(timeline)}")
        print(f"  First point: {timeline[0]['date']}  ~{timeline[0]['mean']} kcal")
        print(f"  Last point:  {timeline[-1]['date']}  ~{timeline[-1]['mean']} kcal")

    latest_recent = timeline[-1] if timeline else bt
    current_tdee = partially_pooled_current_tdee(bt, latest_recent, days)

    print("\n── Empirical scale-state model ──────────────────────────")
    scale_state = fit_scale_state_model(days, steps_map, excluded_dates, current_tdee['mean'])
    if scale_state.get('metrics'):
        selected = scale_state['metrics'][scale_state['selectedModel']]
        print(f"  {scale_state['validationRows']} walk-forward points  "
              f"selected={scale_state['selectedModel']}  MAE={selected['mae']} lbs  r={selected['correlation']}  "
              f"body-comp use={'yes' if scale_state['usableForBodyComp'] else 'no'}")
        if scale_state.get('failedGates'):
            print(f"  Guarded fallback: {', '.join(scale_state['failedGates'])}")
    else:
        print(f"  Not enough data: {scale_state.get('trainingRows', 0)} training rows")

    print("\n── 28-day walk-forward backtest ─────────────────────────")
    backtest = tdee_backtest(days, steps_map, excluded_dates)
    if backtest:
        print(f"  {backtest['count']} checkpoints  MAE={backtest['mae']} lbs  "
              f"68% coverage={backtest['coverage68']}%  95% coverage={backtest['coverage95']}%")

    print("\n── Writing data.js ──────────────────────────────────────")
    update_data_js(data_js, src, bt, timeline, current_tdee, backtest, scale_state)
