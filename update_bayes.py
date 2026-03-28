#!/usr/bin/env python3
"""
Bayesian TDEE estimation + Gaussian Process weight trend
Run: python3 update_bayes.py

Parses js/data.js, runs Bayesian conjugate inference for TDEE and a
Gaussian Process regression for the weight trend + 30-day forecast,
then writes the results back into data.js so the dashboard can use them.
"""

import re, json, sys
import numpy as np
from datetime import datetime, timedelta


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
        r'(?:,notes:".*?")?'
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
            'calories': maybe_num(calories),
            'weight':   maybe_num(weight),
            'lifting':  maybe_str(lifting),
            'drinks':   maybe_str(drinks),
        })

    # Steps
    step_re = re.compile(r'\{date:"(\d{4}-\d{2}-\d{2})",steps:(\d+)\}')
    steps_map = {m.group(1): int(m.group(2)) for m in step_re.finditer(src)}

    print(f"  Parsed {len(days)} macro days, {len(steps_map)} step days")
    return days, steps_map, src


# ─────────────────────────────────────────────────────────────────
# 2. Drink calorie estimation (mirrors JS exactly)
# ─────────────────────────────────────────────────────────────────

DRINK_PATTERNS = [
    (r'(\d+(?:\.\d+)?)\s*(?:jameson|jamesons|whiskey|whiskeys)', 110),
    (r'(\d+(?:\.\d+)?)\s*(?:tequila|tequilas)',                  100),
    (r'(\d+(?:\.\d+)?)\s*(?:beer|beers)',                        150),
    (r'(\d+(?:\.\d+)?)\s*(?:wine)',                              125),
    (r'(\d+(?:\.\d+)?)\s*(?:champagne)',                         125),
    (r"(\d+(?:\.\d+)?)\s*(?:sake|sake's)",                       135),
    (r'(\d+(?:\.\d+)?)\s*(?:white claw|white claws)',            100),
    (r'(\d+(?:\.\d+)?)\s*(?:old fashioned|old fashioneds)',      170),
    (r'(\d+(?:\.\d+)?)\s*(?:highball|highballs)',                130),
    (r'(\d+(?:\.\d+)?)\s*(?:negroni|negronis)',                  180),
    (r'(\d+(?:\.\d+)?)\s*(?:drink|drinks)',                      140),
]

def estimate_drink_calories(drinks):
    if not drinks:
        return 0
    text = drinks.lower()
    total = 0.0
    for pattern, kcal in DRINK_PATTERNS:
        for m in re.finditer(pattern, text):
            total += float(m.group(1)) * kcal
    soju_m = re.search(r'(?:(half)|(\d+(?:\.\d+)?))\s*soju bottle', text)
    if soju_m:
        count = 0.5 if soju_m.group(1) else float(soju_m.group(2) or '1')
        total += count * 540
    elif 'soju' in text and total == 0:
        total += 270
    if not total and text.strip():
        total += 140
    return round(total)

def effective_calories(day):
    return (day['calories'] or 0) + estimate_drink_calories(day.get('drinks'))


# ─────────────────────────────────────────────────────────────────
# 3. Bayesian conjugate TDEE inference
# ─────────────────────────────────────────────────────────────────

DIET_BREAK_START  = '2026-02-27'
DIET_BREAK_END    = '2026-03-07'
KCAL_PER_STEP     = 0.04
# Systematic calorie-logging bias floor (kcal) — portion of uncertainty that
# does NOT shrink with more data (logging errors, label inaccuracies, etc.)
SIGMA_CAL_BIAS    = 150.0

def is_diet_break(date_str):
    return DIET_BREAK_START <= date_str <= DIET_BREAK_END

def bayesian_tdee_profile(days, steps_map, end_date=None, prior_mean=2500.0, prior_sigma=400.0, verbose=True):
    """
    Bayesian linear regression for TDEE over a supplied day slice.

    For every weight observation w[i] at calendar day t_i (days since first
    weight-in), define:

        Y[i] = (w[i] − w_ref) × 3500 − cumNetCal[i]   [kcal]

    where cumNetCal[i] = Σ (effectiveCal[t] − stepNEAT[t]) for t < t_i.

    Energy balance gives:  Y[i] ≈ −TDEE × t_i + noise[i]

    Fitting a line through all Y[i] vs t[i] simultaneously lets water-weight
    noise average out (instead of blowing up each 1-day pair estimate).

    Model:
        Y = α + β × t + ε,   ε ~ N(0, σ_resid²)
        TDEE_MLE = −β

    Bayesian update with prior TDEE ~ N(prior_mean, prior_sigma²),
    then add SIGMA_CAL_BIAS in quadrature as an irreducible floor.
    """
    yesterday = end_date or (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

    # Average steps (exclude today)
    valid_steps = [v for k, v in steps_map.items() if k <= yesterday]
    avg_steps   = float(np.mean(valid_steps)) if valid_steps else 6000.0

    # All days sorted, capped at yesterday
    all_days_sorted = sorted([d for d in days if d['date'] <= yesterday],
                             key=lambda d: d['date'])

    # Build a per-date net-calorie map; impute missing with mean later
    cal_by_date = {}
    for d in all_days_sorted:
        if d['calories']:
            steps    = steps_map.get(d['date'], avg_steps)
            neat_adj = (steps - avg_steps) * KCAL_PER_STEP
            cal_by_date[d['date']] = effective_calories(d) - neat_adj

    # Mean net calories for imputation (use only logged days)
    mean_net_cal = float(np.mean(list(cal_by_date.values()))) if cal_by_date else 1900.0

    # Reference point: first day that has a weight reading
    weight_days = [d for d in all_days_sorted if d['weight'] is not None]
    if len(weight_days) < 5:
        raise ValueError("Need at least 5 weight observations")

    ref_date = datetime.strptime(weight_days[0]['date'], '%Y-%m-%d')
    w_ref    = weight_days[0]['weight']

    # Build cumulative net-cal from ref_date forward (1 entry per calendar day)
    def to_t(date_str):
        return (datetime.strptime(date_str, '%Y-%m-%d') - ref_date).days

    # Cumulative cal up to (but not including) day t
    cum_net_cal = {}         # date → cumulative net kcal from ref_date
    running = 0.0
    cur = ref_date
    last_date = datetime.strptime(weight_days[-1]['date'], '%Y-%m-%d')
    while cur <= last_date:
        ds = cur.strftime('%Y-%m-%d')
        cum_net_cal[ds] = running
        running += cal_by_date.get(ds, mean_net_cal)
        cur += timedelta(days=1)

    # Assemble regression inputs: one row per weight observation
    t_vals, Y_vals = [], []
    obs_details    = []
    for d in weight_days[1:]:          # skip the anchor (Y[0] = 0 by construction)
        t_i = to_t(d['date'])
        if t_i <= 0:
            continue
        cum = cum_net_cal.get(d['date'], 0.0)
        Y_i = (d['weight'] - w_ref) * 3500.0 - cum   # ≈ -TDEE * t_i
        t_vals.append(t_i)
        Y_vals.append(Y_i)
        obs_details.append({'date': d['date'], 't': t_i, 'Y': round(Y_i), 'implied': round(-Y_i / t_i)})

    t_arr = np.array(t_vals, dtype=float)
    Y_arr = np.array(Y_vals, dtype=float)

    # ── Weighted least squares (no intercept; the intercept absorbs w[0] noise)
    # Design: [1, t]
    X_mat = np.column_stack([np.ones_like(t_arr), t_arr])
    coef, residuals, rank, sv = np.linalg.lstsq(X_mat, Y_arr, rcond=None)
    alpha_hat, beta_hat = coef          # β ≈ −TDEE
    TDEE_mle = -beta_hat

    # Residual std (scatter of weight around the linear trend)
    y_pred   = X_mat @ coef
    resids   = Y_arr - y_pred
    n, p     = len(t_arr), 2
    sigma_resid = float(np.std(resids, ddof=p))

    # Standard error of β from the covariance matrix of OLS
    cov_mat  = sigma_resid**2 * np.linalg.inv(X_mat.T @ X_mat)
    SE_beta  = float(np.sqrt(cov_mat[1, 1]))   # SE of the slope
    SE_TDEE  = SE_beta                           # same magnitude, sign flipped

    # ── Bayesian update (Normal prior on TDEE) ────────────────────────────────
    mu_prior    = float(prior_mean)
    sigma_prior = float(prior_sigma)
    prec_prior  = 1.0 / sigma_prior**2
    prec_data   = 1.0 / SE_TDEE**2

    sigma_post  = float(np.sqrt(1.0 / (prec_prior + prec_data)))
    mu_post     = sigma_post**2 * (mu_prior * prec_prior + TDEE_mle * prec_data)

    # ── Add systematic calorie-logging bias in quadrature ─────────────────────
    sigma_final = float(np.sqrt(sigma_post**2 + SIGMA_CAL_BIAS**2))

    if verbose:
        print(f"  OLS TDEE: {round(TDEE_mle)} kcal  SE={round(SE_TDEE)} kcal  resid_std={round(sigma_resid)} kcal")
        print(f"  Bayesian posterior (before bias floor): {round(mu_post)} ± {round(sigma_post)}")
        print(f"  After +{SIGMA_CAL_BIAS} kcal bias floor: ± {round(sigma_final)}")

    return {
        'date':        yesterday,
        'mean':        round(mu_post),
        'sigma':       round(sigma_final, 1),
        'ci95Low':     round(mu_post - 1.96 * sigma_final),
        'ci95High':    round(mu_post + 1.96 * sigma_final),
        'ci68Low':     round(mu_post - sigma_final),
        'ci68High':    round(mu_post + sigma_final),
        'nObs':        len(obs_details),
        'avgSteps':    round(avg_steps),
        'SE_TDEE':     round(SE_TDEE),
        'windowStart': weight_days[0]['date'],
        'windowEnd':   weight_days[-1]['date'],
        'spanDays':    to_t(weight_days[-1]['date']),
        'observations': obs_details,
    }


def bayesian_tdee(days, steps_map):
    return bayesian_tdee_profile(days, steps_map)


def bayesian_tdee_timeline(days, steps_map, window_days=35, min_weight_obs=5, min_span_days=14):
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
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
            profile = bayesian_tdee_profile(window_slice, steps_map, end_date=target_date, verbose=False)
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
            'windowStart': profile['windowStart'],
            'windowEnd': profile['windowEnd'],
            'spanDays': profile['spanDays'],
            'windowDays': window_days
        })
    return timeline


# ─────────────────────────────────────────────────────────────────
# 4. Gaussian Process weight trend + forecast
# ─────────────────────────────────────────────────────────────────

def gp_weight_trend(days, forecast_days=42):
    from sklearn.gaussian_process import GaussianProcessRegressor
    from sklearn.gaussian_process.kernels import RBF, WhiteKernel, ConstantKernel as C

    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    weight_days = [d for d in days
                   if d['weight'] is not None and d['date'] <= yesterday]
    weight_days.sort(key=lambda d: d['date'])

    if len(weight_days) < 5:
        print("  Not enough weight data for GP — skipping")
        return []

    ref = datetime.strptime(weight_days[0]['date'], '%Y-%m-%d')

    def to_t(date_str):
        return (datetime.strptime(date_str, '%Y-%m-%d') - ref).days

    X = np.array([to_t(d['date']) for d in weight_days], dtype=float).reshape(-1, 1)
    y = np.array([d['weight']     for d in weight_days], dtype=float)

    # Two-component kernel:
    #   1. Slow RBF (length scale ≥ 40 days) — captures the overall cut trend
    #   2. Fast RBF (10–30 days) — captures week-to-week fluctuations
    #   3. WhiteKernel — measurement noise
    kernel = (
        C(5.0, (1.0, 20.0)) * RBF(length_scale=60,  length_scale_bounds=(40, 250))
        + C(1.0, (0.1,  5.0)) * RBF(length_scale=14,  length_scale_bounds=(7,  35))
        + WhiteKernel(noise_level=0.5, noise_level_bounds=(0.05, 2.0))
    )

    gp = GaussianProcessRegressor(
        kernel=kernel,
        n_restarts_optimizer=10,
        normalize_y=True,
        alpha=1e-6,
    )
    gp.fit(X, y)
    print(f"  GP kernel (fitted): {gp.kernel_}")

    # Prediction grid: first weight day → yesterday + forecast
    last_t = to_t(yesterday)
    t_grid = np.arange(0, last_t + forecast_days + 1, dtype=float)
    y_pred, y_std = gp.predict(t_grid.reshape(-1, 1), return_std=True)

    results = []
    for t_val, yp, ys in zip(t_grid, y_pred, y_std):
        date_str = (ref + timedelta(days=int(t_val))).strftime('%Y-%m-%d')
        results.append({
            'date':     date_str,
            'mean':     round(float(yp), 2),
            'ci95Low':  round(float(yp - 1.96 * ys), 2),
            'ci95High': round(float(yp + 1.96 * ys), 2),
            'forecast': date_str > yesterday,
        })

    return results


# ─────────────────────────────────────────────────────────────────
# 5. Write results back into data.js
# ─────────────────────────────────────────────────────────────────

BAYES_START = '// BAYES_START'
BAYES_END   = '// BAYES_END'

def update_data_js(path, src, bayes_tdee_result, gp_trend, tdee_timeline):
    # Strip old block if present
    src = re.sub(
        r'\n' + re.escape(BAYES_START) + r'.*?' + re.escape(BAYES_END) + r'\n',
        '\n',
        src,
        flags=re.DOTALL,
    )

    # Serialize — strip 'observations' from the JSON written to data.js to keep it slim
    tdee_out = {k: v for k, v in bayes_tdee_result.items() if k != 'observations'}
    tdee_json = json.dumps(tdee_out, separators=(',', ':'))
    gp_json   = json.dumps(gp_trend,  separators=(',', ':'))
    timeline_json = json.dumps(tdee_timeline, separators=(',', ':'))

    block = (
        f"\n{BAYES_START}\n"
        f"window.dashboardData.bayesian = {{\n"
        f"  tdeePosterior: {tdee_json},\n"
        f"  tdeeTimeline: {timeline_json},\n"
        f"  gpWeightTrend: {gp_json}\n"
        f"}};\n"
        f"{BAYES_END}\n"
    )

    # Insert just before the closing })();
    if 'window.dashboardData = { data, sleepData, stepsData };' in src:
        src = src.replace(
            'window.dashboardData = { data, sleepData, stepsData };',
            'window.dashboardData = { data, sleepData, stepsData };' + block,
        )
    else:
        # Fallback: append before last })();
        src = src.rstrip()
        src = src[:-4] + block + '\n})();\n'

    with open(path, 'w', encoding='utf-8') as f:
        f.write(src)

    print(f"\n✓ {path} updated")
    print(f"  Bayesian TDEE: {bayes_tdee_result['mean']} kcal  "
          f"95% CI [{bayes_tdee_result['ci95Low']}–{bayes_tdee_result['ci95High']}]  "
          f"(σ={bayes_tdee_result['sigma']}  n={bayes_tdee_result['nObs']} intervals)")
    print(f"  TDEE timeline: {len(tdee_timeline)} rolling points")
    print(f"  GP trend: {len(gp_trend)} points  "
          f"({sum(1 for p in gp_trend if p['forecast'])} forecast days)")


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    data_js = sys.argv[1] if len(sys.argv) > 1 else 'js/data.js'

    print("── Parsing data.js ──────────────────────────────────────")
    days, steps_map, src = parse_data_js(data_js)

    print("\n── Bayesian TDEE (full-trajectory regression) ───────────")
    bt = bayesian_tdee(days, steps_map)
    print(f"  Posterior: {bt['mean']} ± {bt['sigma']} kcal")
    print(f"  68% CI:   [{bt['ci68Low']}, {bt['ci68High']}]")
    print(f"  95% CI:   [{bt['ci95Low']}, {bt['ci95High']}]")
    print(f"  n weight obs: {bt['nObs']}  (avg {bt['avgSteps']:,} steps/day)")
    print("  Last 5 weight observations (implied TDEE):")
    for obs in bt['observations'][-5:]:
        print(f"    {obs['date']} (t={obs['t']}d): implied {obs['implied']} kcal")

    print("\n── Rolling Bayesian TDEE timeline ───────────────────────")
    timeline = bayesian_tdee_timeline(days, steps_map)
    if timeline:
        print(f"  Timeline points: {len(timeline)}")
        print(f"  First point: {timeline[0]['date']}  ~{timeline[0]['mean']} kcal")
        print(f"  Last point:  {timeline[-1]['date']}  ~{timeline[-1]['mean']} kcal")

    print("\n── Gaussian Process weight trend ────────────────────────")
    gp = gp_weight_trend(days)
    if gp:
        hist = [p for p in gp if not p['forecast']]
        fcast = [p for p in gp if p['forecast']]
        print(f"  Historical: {len(hist)} days  |  Forecast: {len(fcast)} days")
        print(f"  Last historical point: {hist[-1]}")
        print(f"  Forecast end: {fcast[-1]}")

    print("\n── Writing data.js ──────────────────────────────────────")
    update_data_js(data_js, src, bt, gp, timeline)
