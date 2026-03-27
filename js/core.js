// =====================================================================
// DATA LAYER
// =====================================================================
const COLORS = { jan: '#f59e0b', feb: '#38bdf8', mar: '#34d399' };
const EVENT_COLORS = { normal: '#f59e0b', drink: '#ef4444', lift: '#06b6d4' };
const GRID = () => ({ color: getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim() || 'rgba(255,255,255,0.05)' });
const TICK = () => ({ color: getComputedStyle(document.documentElement).getPropertyValue('--tick-color').trim() || '#64748b', font: { size: 11 } });

// Goals (editable via settings)
let goals = { calories: 2100, protein: null, carbs: 150, fat: 80, sleep: 7, sleepPerf: 70, bedtime: '12:30 AM' };
const STORAGE_KEY = 'macros_dashboard_v4_state';

// Units
const BUILD_VERSION = '2026.03.21.2';
let useMetric = false; // false = lbs/kcal, true = kg/kJ
let themePreference = 'system';
function convWeight(lbs) { return useMetric ? (lbs * 0.453592).toFixed(1) : lbs; }
function convEnergy(kcal) { return useMetric ? Math.round(kcal * 4.184) : kcal; }
function weightUnit() { return useMetric ? 'kg' : 'lbs'; }
function energyUnit() { return useMetric ? 'kJ' : 'kcal'; }
function energyLabel(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  const val = useMetric ? v * 4.184 : v;
  return `${Number(val.toFixed(digits)).toLocaleString()} ${energyUnit()}`;
}
function weightLabel(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  const val = useMetric ? v * 0.453592 : v;
  return `${Number(val.toFixed(digits)).toLocaleString()} ${weightUnit()}`;
}
function energyValue(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return null;
  const val = useMetric ? v * 4.184 : v;
  return +val.toFixed(digits);
}
function weightValue(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return null;
  const val = useMetric ? v * 0.453592 : v;
  return +val.toFixed(digits);
}
function calcAxisBounds(values, padding = 1) {
  const clean = values.filter(v => v != null && Number.isFinite(v));
  if (!clean.length) return { min: 0, max: 10 };
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  if (min === max) return { min: min - padding, max: max + padding };
  return { min: min - padding, max: max + padding };
}
function ratioLabel(g, lbs) {
  if (!g || !lbs) return '—';
  const denom = useMetric ? lbs * 0.453592 : lbs;
  return `${(g / denom).toFixed(2)} g/${useMetric ? 'kg' : 'lb'}`;
}

// Annotations
let annotations = [
  { date: '2026-02-27', label: 'Diet Break begins' },
  { date: '2026-03-07', label: 'Diet Break ends' }
];

function loadPersistedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (saved.goals) {
      const { protein, ...savedGoals } = saved.goals;
      goals = { ...goals, ...savedGoals };
    }
    goals.protein = null;
    if (goals.calories < 1) goals.calories = 2100;
    if (goals.calories === 2050) goals.calories = 2100;
    if (Array.isArray(saved.annotations)) annotations = saved.annotations;
    if (typeof saved.useMetric === 'boolean') useMetric = saved.useMetric;
    if (saved.recoveryWeights) recoveryWeights = saved.recoveryWeights;
    if (typeof saved.themePreference === 'string') themePreference = saved.themePreference;
    else if (typeof saved.theme === 'string') themePreference = saved.theme;
    return saved;
  } catch {
    return {};
  }
}

function persistState(extra = {}) {
  try {
    const savedGoals = { ...goals };
    delete savedGoals.protein;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      goals: savedGoals,
      annotations,
      useMetric,
      recoveryWeights,
      ...extra
    }));
  } catch {}
}

const persistedState = loadPersistedState();
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: light)');

function resolvedTheme(preference = themePreference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return systemThemeQuery.matches ? 'light' : 'dark';
}

function applyTheme(preference = themePreference) {
  themePreference = preference;
  document.documentElement.setAttribute('data-theme', resolvedTheme(preference));
}

// Shared dataset loaded from js/data.js

const { data, sleepData, stepsData } = window.dashboardData;



// =====================================================================
// COMPUTED DATA & HELPERS
// =====================================================================
// Flatten all days
const allDays = [...data.Jan, ...data.Feb, ...data.March];
const allDates = allDays.map(d => d.date);
const LEGACY_DEFAULT_RANGE_END = '2026-03-18';
const macroByDate = {};
allDays.forEach(d => { macroByDate[d.date] = d; });
const sleepByDate = {};
sleepData.forEach(d => { sleepByDate[d.date] = d; });
const drinkDates = new Set(allDays.filter(d => d.drinks).map(d => d.date));
const liftDates = new Set(allDays.filter(d => d.lifting === 'Y').map(d => d.date));

function prevDay(dateStr) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }
function nextDayStr(dateStr) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }
// Never include today — partial days skew every metric
function analyticsCutoffDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString().slice(0, 10);
}
const YESTERDAY_ISO = analyticsCutoffDate();
function maxAnalyticsIndex() {
  const cutoff = analyticsCutoffDate();
  const idx = allDates.findLastIndex(d => d <= cutoff);
  return idx >= 0 ? idx : allDates.length - 1;
}
const MAX_ANALYTICS_IDX = maxAnalyticsIndex();

function defaultRangeEndIndex() {
  return maxAnalyticsIndex();
}
function dayLabel(d) { return d.date.slice(5); }
function avg(arr, key) { const vals = arr.filter(d => d[key] != null).map(d => d[key]); return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : 0; }
function avgOrNull(arr, key) { const vals = arr.filter(d => d[key] != null).map(d => d[key]); return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null; }
function perfColor(p, alpha=1) {
  if (p >= 70) return `rgba(52,211,153,${alpha})`;
  if (p >= 50) return `rgba(251,191,36,${alpha})`;
  return `rgba(248,113,113,${alpha})`;
}

function monthKey(dateStr) {
  const month = dateStr.slice(5, 7);
  if (month === '01') return 'Jan';
  if (month === '02') return 'Feb';
  return 'March';
}

function monthBuckets(days) {
  return {
    Jan: days.filter(d => d.date.startsWith('2026-01')),
    Feb: days.filter(d => d.date.startsWith('2026-02')),
    March: days.filter(d => d.date.startsWith('2026-03'))
  };
}

function getAnalyticsDays(days = allDays) {
  const cutoff = analyticsCutoffDate();
  return days.filter(d => d.date <= cutoff);
}

const PROTEIN_FLOOR_RATIO = 0.9;
const DEFAULT_PROTEIN_FLOOR = 153;

function proteinGoalForDay(dateStr) {
  const dayIdx = allDates.indexOf(dateStr);
  if (dayIdx < 0) return DEFAULT_PROTEIN_FLOOR;
  const upto = allDays.slice(0, dayIdx + 1).reverse().find(d => d.weight);
  return upto ? Math.round(upto.weight * PROTEIN_FLOOR_RATIO) : DEFAULT_PROTEIN_FLOOR;
}

function currentProteinGoal(days = getFilteredDays()) {
  const latestWeight = [...days].reverse().find(d => d.weight);
  return latestWeight ? Math.round(latestWeight.weight * PROTEIN_FLOOR_RATIO) : DEFAULT_PROTEIN_FLOOR;
}

function hitProteinFloor(day) {
  return (day.protein || 0) >= proteinGoalForDay(day.date);
}

function proteinGoalRangeLabel(days = getFilteredDays()) {
  const targets = days.map(d => proteinGoalForDay(d.date)).filter(Number.isFinite);
  if (!targets.length) return `${DEFAULT_PROTEIN_FLOOR}g`;
  const minGoal = Math.min(...targets);
  const maxGoal = Math.max(...targets);
  return minGoal === maxGoal ? `${minGoal}g` : `${minGoal}-${maxGoal}g`;
}

// Rolling average
function rollingAvg(arr, window) {
  return arr.map((v, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = arr.slice(start, i + 1).filter(x => x != null);
    return slice.length ? slice.reduce((a,b)=>a+b,0)/slice.length : null;
  });
}

// Recovery score: configurable weights
let recoveryWeights = { sleep: 0.4, efficiency: 0.2, resp: 0.2, drink: 0.2 };
function recoveryScore(sleepDay) {
  if (!sleepDay || sleepDay.perf == null || sleepDay.efficiency == null) return null;
  const prev = prevDay(sleepDay.date);
  const drinkPenalty = drinkDates.has(prev) ? 0 : 100;
  const resp = sleepDay.resp != null ? sleepDay.resp : 15;
  const respNorm = Math.max(0, Math.min(100, (20 - resp) / (20 - 13) * 100));
  return Math.round(recoveryWeights.sleep * sleepDay.perf + recoveryWeights.efficiency * sleepDay.efficiency + recoveryWeights.resp * respNorm + recoveryWeights.drink * drinkPenalty);
}

function recoveryBottleneck(sleepDay) {
  if (!sleepDay || sleepDay.perf == null || sleepDay.efficiency == null) return null;
  const prev = prevDay(sleepDay.date);
  const drinkPenalty = drinkDates.has(prev) ? 0 : 100;
  const resp = sleepDay.resp != null ? sleepDay.resp : 15;
  const respNorm = Math.max(0, Math.min(100, (20 - resp) / (20 - 13) * 100));
  const components = [
    { name: 'Sleep Perf', value: sleepDay.perf, weight: recoveryWeights.sleep, contribution: recoveryWeights.sleep * sleepDay.perf },
    { name: 'Efficiency', value: sleepDay.efficiency, weight: recoveryWeights.efficiency, contribution: recoveryWeights.efficiency * sleepDay.efficiency },
    { name: 'Resp Rate', value: respNorm, weight: recoveryWeights.resp, contribution: recoveryWeights.resp * respNorm },
    { name: 'No-Drink', value: drinkPenalty, weight: recoveryWeights.drink, contribution: recoveryWeights.drink * drinkPenalty }
  ];
  components.sort((a, b) => a.value - b.value);
  return components;
}

// Food parsing
function parseFoods(notes) {
  if (!notes) return [];
  const items = notes.split(/,\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return items;
}

const FOOD_REPLACEMENTS = [
  [/protein shake(?:s)?/g, 'protein shake'],
  [/greek yogurts?/g, 'greek yogurt'],
  [/rotisserie chicken breasts?/g, 'rotisserie chicken'],
  [/mexican steak bowls?/g, 'mexican steak bowl'],
  [/chipotle chicken bowls?/g, 'chipotle chicken bowl'],
  [/boiled eggs?/g, 'boiled eggs'],
  [/^(lunch\s+)?pho$/g, 'pho']
];

function normalizeFoodItem(item) {
  let norm = item.replace(/\d+x\s*/g,'').replace(/^\d+\s*/,'').replace(/\s*\d+x$/,'').trim();
  norm = norm.replace(/^(diet break\.?\s*)/i, '').trim();
  FOOD_REPLACEMENTS.forEach(([pattern, value]) => { norm = norm.replace(pattern, value); });
  norm = norm.replace(/\s{2,}/g, ' ').trim();
  return norm.length >= 3 ? norm : null;
}

function foodsForDay(day) {
  return [...new Set(parseFoods(day.notes).map(normalizeFoodItem).filter(Boolean))];
}

function monthlyProgression(filtered) {
  const months = ['Jan', 'Feb', 'March'];
  const labels = ['Jan', 'Feb', 'Mar'];
  const summaries = months.map((mo, i) => {
    const d = filtered[mo];
    if (!d.length) return null;
    const avgCal = Math.round(avg(d, 'calories'));
    const avgPro = Math.round(avg(d, 'protein'));
    const liftRate = +(d.filter(dd => dd.lifting === 'Y').length / Math.max(d.length / 7, 1)).toFixed(1);
    const proteinHit = Math.round(d.filter(hitProteinFloor).length / d.length * 100);
    const drinkNights = d.filter(dd => dd.drinks).length;
    const wDays = d.filter(dd => dd.weight);
    const wChange = wDays.length >= 2 ? wDays[wDays.length - 1].weight - wDays[0].weight : null;
    const calCon = consistencyScore(d, 'calories');
    return { label: labels[i], avgCal, avgPro, liftRate, proteinHit, drinkNights, wChange, calCon, days: d.length };
  }).filter(Boolean);
  if (summaries.length < 2) return null;

  const trends = [];
  for (let i = 1; i < summaries.length; i++) {
    const prev = summaries[i - 1], cur = summaries[i];
    const calDelta = cur.avgCal - prev.avgCal;
    const proDelta = cur.proteinHit - prev.proteinHit;
    const liftDelta = cur.liftRate - prev.liftRate;
    const drinkDelta = cur.drinkNights - prev.drinkNights;

    const parts = [];
    if (cur.wChange != null) parts.push(`scale ${cur.wChange < 0 ? '↓' : '↑'} ${weightLabel(Math.abs(cur.wChange), 1)}`);
    if (Math.abs(calDelta) > 30) parts.push(`intake ${calDelta < 0 ? '↓' : '↑'} ${energyLabel(Math.abs(calDelta))}/day`);
    if (Math.abs(proDelta) > 5) parts.push(`protein ${proDelta > 0 ? '↑' : '↓'} ${prev.proteinHit}→${cur.proteinHit}%`);

    if (parts.length) {
      trends.push(`<strong>${prev.label} → ${cur.label}:</strong> ${parts.join(', ')}.`);
    }
  }
  return trends.length ? trends.join(' ') : null;
}

function consistencyScore(days, key) {
  const vals = days.map(d => d[key]).filter(v => v != null && v > 0);
  if (vals.length < 3) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (!mean) return null;
  const stdDev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
  const cv = stdDev / mean;
  return Math.round(Math.max(0, Math.min(100, (1 - cv) * 100)));
}

function dayOfWeekMacroAverages(days) {
  const DOW_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const buckets = [[], [], [], [], [], [], []];
  days.forEach(d => {
    const idx = (new Date(d.date + 'T12:00:00').getDay() + 6) % 7;
    buckets[idx].push(d);
  });
  return buckets.map((group, i) => ({
    day: DOW_LABELS[i],
    avgCal: group.length ? Math.round(avg(group, 'calories')) : null,
    avgPro: group.length ? Math.round(avg(group, 'protein')) : null,
    avgCarbs: group.length ? Math.round(avg(group, 'carbs')) : null,
    avgFat: group.length ? Math.round(avg(group, 'fat')) : null,
    drinkPct: group.length ? Math.round(group.filter(d => d.drinks).length / group.length * 100) : null,
    liftPct: group.length ? Math.round(group.filter(d => d.lifting === 'Y').length / group.length * 100) : null,
    count: group.length
  }));
}

// Carb/fat ratio → sleep quality (same-day and lag-1)
function macroSleepCorrelations(days, sleep) {
  const pairs = [];
  days.forEach(d => {
    if (!d.calories || d.calories === 0) return;
    const s = sleepByDate[d.date];
    if (!s || s.perf == null) return;
    pairs.push({
      carbPct: (d.carbs * 4) / d.calories,
      fatPct: (d.fat * 9) / d.calories,
      proteinPct: (d.protein * 4) / d.calories,
      calories: d.calories,
      perf: s.perf
    });
  });
  if (pairs.length < 5) return null;
  return {
    carbPctVsPerf: pearson(pairs.map(p => p.carbPct), pairs.map(p => p.perf)),
    fatPctVsPerf: pearson(pairs.map(p => p.fatPct), pairs.map(p => p.perf)),
    proteinPctVsPerf: pearson(pairs.map(p => p.proteinPct), pairs.map(p => p.perf)),
    caloriesVsPerf: pearson(pairs.map(p => p.calories), pairs.map(p => p.perf)),
    sampleSize: pairs.length,
    // Quartile analysis for carbs
    carbQuartiles: (() => {
      const sorted = [...pairs].sort((a, b) => a.carbPct - b.carbPct);
      const q = Math.floor(sorted.length / 4);
      return [
        { label: 'Low carb', range: `${Math.round(sorted[0].carbPct * 100)}–${Math.round(sorted[q - 1]?.carbPct * 100 || 0)}%`, avgPerf: Math.round(sorted.slice(0, q).reduce((s, p) => s + p.perf, 0) / q) },
        { label: 'High carb', range: `${Math.round(sorted[sorted.length - q]?.carbPct * 100 || 0)}–${Math.round(sorted[sorted.length - 1].carbPct * 100)}%`, avgPerf: Math.round(sorted.slice(-q).reduce((s, p) => s + p.perf, 0) / q) }
      ];
    })()
  };
}

// Multi-day alcohol rebound (calorie lag at day+1, +2, +3)
function alcoholRebound(days) {
  const drinkDayDates = days.filter(d => d.drinks).map(d => d.date);
  const cleanDayDates = days.filter(d => !d.drinks).map(d => d.date);
  if (!drinkDayDates.length || !cleanDayDates.length) return null;

  function lagCalories(sourceDates, lag) {
    const vals = sourceDates.map(date => {
      let d = date;
      for (let i = 0; i < lag; i++) d = nextDayStr(d);
      return macroByDate[d];
    }).filter(Boolean).map(d => effectiveCalories(d));
    return vals.length >= 2 ? { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), n: vals.length } : null;
  }

  function lagSleep(sourceDates, lag) {
    const vals = sourceDates.map(date => {
      let d = date;
      for (let i = 0; i < lag; i++) d = nextDayStr(d);
      return sleepByDate[d];
    }).filter(Boolean).map(s => s.perf);
    return vals.length >= 2 ? { avg: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), n: vals.length } : null;
  }

  return [1, 2, 3].map(lag => {
    const drinkLag = lagCalories(drinkDayDates, lag);
    const cleanLag = lagCalories(cleanDayDates, lag);
    const drinkSleepLag = lagSleep(drinkDayDates, lag);
    const cleanSleepLag = lagSleep(cleanDayDates, lag);
    return {
      lag,
      drinkNextCal: drinkLag,
      cleanNextCal: cleanLag,
      calDelta: drinkLag && cleanLag ? drinkLag.avg - cleanLag.avg : null,
      drinkNextSleep: drinkSleepLag,
      cleanNextSleep: cleanSleepLag,
      sleepDelta: drinkSleepLag && cleanSleepLag ? drinkSleepLag.avg - cleanSleepLag.avg : null
    };
  });
}

// Bedtime quintile optimization
function bedtimeQuintileAnalysis(sleep) {
  if (sleep.length < 10) return null;
  // Normalize so PM hours (e.g. 22 = 10 PM) sort before AM hours (e.g. 2 AM)
  const normBedtime = h => h > 12 ? h - 24 : h; // 22→-2, 23→-1, 0→0, 1→1, 4→4
  const sorted = [...sleep].sort((a, b) => normBedtime(a.bedtime_hour) - normBedtime(b.bedtime_hour));
  const qSize = Math.floor(sorted.length / 4);
  if (qSize < 2) return null;
  const quartiles = [
    sorted.slice(0, qSize),
    sorted.slice(qSize, qSize * 2),
    sorted.slice(qSize * 2, qSize * 3),
    sorted.slice(qSize * 3)
  ];
  const formatHour = h => {
    const hr24 = Math.floor(h % 24);
    const min = Math.round((h % 1) * 60) % 60;
    const ampm = hr24 >= 12 ? 'PM' : 'AM';
    const hr12 = hr24 === 0 ? 12 : hr24 > 12 ? hr24 - 12 : hr24;
    return `${hr12}:${min.toString().padStart(2, '0')} ${ampm}`;
  };
  return quartiles.map((group, i) => {
    const hours = group.map(d => d.bedtime_hour > 12 ? d.bedtime_hour - 24 : d.bedtime_hour);
    return {
      quartile: i + 1,
      label: ['Earliest', 'Early-mid', 'Late-mid', 'Latest'][i],
      hourRange: `${formatHour(group[0].bedtime_hour)}–${formatHour(group[group.length - 1].bedtime_hour)}`,
      avgPerf: Math.round(group.reduce((s, d) => s + d.perf, 0) / group.length),
      avgHours: +(group.reduce((s, d) => s + d.hours, 0) / group.length).toFixed(1),
      count: group.length
    };
  });
}

// Adherence momentum — weekly trend within months
function adherenceMomentum(days) {
  if (days.length < 14) return null;
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    if (week.length < 3) continue;
    weeks.push({
      weekNum: weeks.length + 1,
      startDate: week[0].date.slice(5),
      endDate: week[week.length - 1].date.slice(5),
      avgCal: Math.round(avg(week, 'calories')),
      calHitRate: Math.round(week.filter(d => d.calories <= goals.calories).length / week.length * 100),
      proHitRate: Math.round(week.filter(hitProteinFloor).length / week.length * 100),
      consistency: consistencyScore(week, 'calories'),
      days: week.length
    });
  }
  if (weeks.length < 2) return null;
  const calHitSlope = weeks.length >= 3
    ? linearRegression(weeks.map((_, i) => i), weeks.map(w => w.calHitRate)).slope
    : weeks[weeks.length - 1].calHitRate - weeks[0].calHitRate;
  const proHitSlope = weeks.length >= 3
    ? linearRegression(weeks.map((_, i) => i), weeks.map(w => w.proHitRate)).slope
    : weeks[weeks.length - 1].proHitRate - weeks[0].proHitRate;
  return {
    weeks,
    calHitTrend: calHitSlope > 2 ? 'improving' : calHitSlope < -2 ? 'declining' : 'stable',
    proHitTrend: proHitSlope > 2 ? 'improving' : proHitSlope < -2 ? 'declining' : 'stable',
    calHitSlope: +calHitSlope.toFixed(1),
    proHitSlope: +proHitSlope.toFixed(1)
  };
}

// Deficit-to-scale lag: cross-correlate daily deficit with weight change at lags 1–7
function deficitToScaleLag(days) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length < 10) return null;
  // Build a date→deficit map and date→weight-change map
  const deficitByDate = {};
  days.forEach(d => { deficitByDate[d.date] = estimatedTDEE - effectiveCalories(d); });
  const weightChangeByDate = {};
  for (let i = 1; i < weightDays.length; i++) {
    weightChangeByDate[weightDays[i].date] = weightDays[i].weight - weightDays[i - 1].weight;
  }
  const results = [];
  for (let lag = 1; lag <= 7; lag++) {
    const pairs = [];
    Object.entries(weightChangeByDate).forEach(([date, wChange]) => {
      // Find the deficit from `lag` days before this weigh-in
      let d = date;
      for (let i = 0; i < lag; i++) d = prevDay(d);
      if (deficitByDate[d] != null) {
        pairs.push({ deficit: deficitByDate[d], wChange });
      }
    });
    if (pairs.length >= 5) {
      const r = pearson(pairs.map(p => p.deficit), pairs.map(p => p.wChange));
      results.push({ lag, r: +r.toFixed(3), n: pairs.length });
    }
  }
  if (!results.length) return null;
  const strongest = results.reduce((a, b) => Math.abs(a.r) > Math.abs(b.r) ? a : b);
  return { lags: results, strongest };
}

// Rolling adherence rate: 7-day rolling % of days hitting calorie target
function rollingAdherence(days, window = 7) {
  if (days.length < window) return null;
  const calHit = [];
  const proHit = [];
  const labels = [];
  for (let i = window - 1; i < days.length; i++) {
    const slice = days.slice(i - window + 1, i + 1);
    calHit.push(Math.round(slice.filter(d => d.calories <= goals.calories).length / slice.length * 100));
    proHit.push(Math.round(slice.filter(hitProteinFloor).length / slice.length * 100));
    labels.push(days[i].date.slice(5));
  }
  return { labels, calHit, proHit, window };
}

// ── STEP ANALYTICS ──────────────────────────────────────────────────────
const KCAL_PER_STEP = 0.04; // ~40 kcal per 1,000 steps — mid-range estimate

const stepsByDate = (() => {
  const map = {};
  if (stepsData) stepsData.forEach(s => { map[s.date] = s.steps; });
  return map;
})();

function getStepForDate(date) {
  return stepsByDate[date] ?? null;
}

function stepStats(days, goalSteps = 8000) {
  const daysWithSteps = days.map(d => ({ date: d.date, steps: getStepForDate(d.date) })).filter(d => d.steps != null);
  if (daysWithSteps.length < 3) return null;
  const allStepVals = daysWithSteps.map(d => d.steps);
  const avg = Math.round(allStepVals.reduce((a, b) => a + b, 0) / allStepVals.length);
  const max = Math.max(...allStepVals);
  const goalHit = Math.round(allStepVals.filter(s => s >= goalSteps).length / allStepVals.length * 100);
  // 7-day rolling average
  const rollingAvg = [];
  const rollingLabels = [];
  for (let i = 6; i < daysWithSteps.length; i++) {
    const slice = daysWithSteps.slice(i - 6, i + 1);
    rollingAvg.push(Math.round(slice.reduce((s, d) => s + d.steps, 0) / 7));
    rollingLabels.push(daysWithSteps[i].date.slice(5));
  }
  // Weekly trend in steps/week
  const reg = linearRegression(daysWithSteps.map((_, i) => i), allStepVals);
  const trendPerWeek = Math.round(reg.slope * 7);
  return {
    avg, max, goalHit,
    allSteps: allStepVals,
    allLabels: daysWithSteps.map(d => d.date.slice(5)),
    rollingAvg, rollingLabels,
    trendPerWeek,
    daysWithSteps,
    goalSteps
  };
}

// Step NEAT delta relative to a baseline (positive = walked more than avg → burned more)
function stepNEATDelta(date, avgSteps) {
  const s = getStepForDate(date);
  if (s == null || avgSteps == null) return 0;
  return (s - avgSteps) * KCAL_PER_STEP;
}

// Step-adjusted effective calories: normalises each day's intake to "what if you walked avgSteps"
// Subtracting extra burn when steps > avg reduces noise in TDEE regression
function stepAdjustedCalories(day, avgSteps) {
  const base = effectiveCalories(day);
  const s = getStepForDate(day.date);
  if (s == null || avgSteps == null) return base;
  return base - (s - avgSteps) * KCAL_PER_STEP;
}

function stepsCorrelations(days) {
  const avgStepsVal = (() => {
    const vals = days.map(d => getStepForDate(d.date)).filter(s => s != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  })();

  // Steps vs same-night sleep performance
  const stepSleepPairs = [];
  days.forEach(d => {
    const s = getStepForDate(d.date);
    const sl = sleepByDate[d.date];
    if (s != null && sl?.perf != null) stepSleepPairs.push([s, sl.perf]);
  });

  // Steps vs next-day weight change (more steps → usually lower next-day weight)
  const weightDays = days.filter(d => d.weight);
  const stepWeightPairs = [];
  for (let i = 0; i < weightDays.length - 1; i++) {
    const s = getStepForDate(weightDays[i].date);
    const wDelta = weightDays[i + 1].weight - weightDays[i].weight;
    if (s != null) stepWeightPairs.push([s, wDelta]);
  }

  // Steps vs calorie intake (high step days → eat more or less?)
  const stepCalPairs = [];
  days.forEach(d => {
    const s = getStepForDate(d.date);
    if (s != null && d.calories) stepCalPairs.push([s, effectiveCalories(d)]);
  });

  // High-step vs low-step sleep cohort
  const allStepVals = days.map(d => getStepForDate(d.date)).filter(s => s != null).sort((a, b) => a - b);
  const medianSteps = allStepVals.length ? allStepVals[Math.floor(allStepVals.length / 2)] : null;
  let highSleepAvg = null, lowSleepAvg = null;
  if (medianSteps != null) {
    const high = [], low = [];
    days.forEach(d => {
      const s = getStepForDate(d.date);
      const sl = sleepByDate[d.date];
      if (s != null && sl?.perf != null) {
        if (s >= medianSteps) high.push(sl.perf); else low.push(sl.perf);
      }
    });
    highSleepAvg = high.length ? Math.round(high.reduce((a, b) => a + b, 0) / high.length) : null;
    lowSleepAvg = low.length ? Math.round(low.reduce((a, b) => a + b, 0) / low.length) : null;
  }

  const r_sleep = stepSleepPairs.length >= 5 ? +pearson(stepSleepPairs.map(p => p[0]), stepSleepPairs.map(p => p[1])).toFixed(2) : null;
  const r_weight = stepWeightPairs.length >= 5 ? +pearson(stepWeightPairs.map(p => p[0]), stepWeightPairs.map(p => p[1])).toFixed(2) : null;
  const r_cal = stepCalPairs.length >= 5 ? +pearson(stepCalPairs.map(p => p[0]), stepCalPairs.map(p => p[1])).toFixed(2) : null;

  return {
    r_sleep, r_weight, r_cal,
    n_sleep: stepSleepPairs.length,
    n_weight: stepWeightPairs.length,
    n_cal: stepCalPairs.length,
    medianSteps, highSleepAvg, lowSleepAvg,
    avgSteps: avgStepsVal
  };
}

// Step-adjusted TDEE: returns the base TDEE ± step NEAT for a specific day
function stepAdjustedTDEE(baseTDEE, date) {
  if (!baseTDEE) return null;
  const s = getStepForDate(date);
  if (s == null) return baseTDEE;
  const allStepVals = stepsData.map(d => d.steps);
  const avg = allStepVals.reduce((a, b) => a + b, 0) / allStepVals.length;
  return Math.round(baseTDEE + (s - avg) * KCAL_PER_STEP);
}

function foodFrequency(days = allDays) {
  const freq = {};
  days.forEach(d => {
    foodsForDay(d).forEach(norm => {
      freq[norm] = (freq[norm] || 0) + 1;
    });
  });
  return Object.entries(freq).sort((a,b) => b[1]-a[1]);
}

// Protein foods detection
const proteinKeywords = ['protein shake','protein chips','protein bar','protein popcorn','protein noodles','protein ramen','protein pretzels','greek yogurt','yogurt','chicken','steak','salmon','fish','eggs','pho','beef','pork','turkey','edamame','edamame snack'];

function isFoodProteinRich(food) {
  return proteinKeywords.some(k => food.includes(k));
}

// Correlation helper
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return 0;
  const mx = x.reduce((a,b)=>a+b)/n, my = y.reduce((a,b)=>a+b)/n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i]-mx)*(y[i]-my);
    dx += (x[i]-mx)**2;
    dy += (y[i]-my)**2;
  }
  return dx && dy ? num / Math.sqrt(dx*dy) : 0;
}

const DXA_SCAN = {
  date: '2026-01-06',
  totalMass: 174,
  bodyFatPct: 25.1,
  leanMass: 124
};

const DXA_FAT_MASS = DXA_SCAN.totalMass * (DXA_SCAN.bodyFatPct / 100);
const DXA_BONE_MASS = Math.max(DXA_SCAN.totalMass - DXA_SCAN.leanMass - DXA_FAT_MASS, 0);
const DXA_FAT_FREE_MASS = DXA_SCAN.leanMass + DXA_BONE_MASS;

function bodyCompModelShares(days = allDays) {
  const liftPerWeek = days.filter(d => d.lifting === 'Y').length / Math.max(days.length / 7, 1);
  const proteinHitRate = days.filter(hitProteinFloor).length / Math.max(days.length, 1);
  return {
    cutFatFreeShare: Math.max(0.16, Math.min(0.24, 0.24 - (Math.min(liftPerWeek, 4) * 0.015) - (proteinHitRate * 0.03))),
    gainFatFreeShare: Math.max(0.08, Math.min(0.14, 0.14 - (Math.min(liftPerWeek, 4) * 0.01) - (proteinHitRate * 0.01)))
  };
}

function bodyCompConfidenceScore(days = allDays) {
  const weightDays = days.filter(d => d.weight);
  if (!weightDays.length) return 0.2;
  const spanDays = Math.max(1, Math.round((new Date(weightDays[weightDays.length - 1].date + 'T12:00:00') - new Date(weightDays[0].date + 'T12:00:00')) / 86400000));
  return Math.max(0.2, Math.min(0.95, (weightDays.length / 14) * 0.45 + (spanDays / 70) * 0.35 + 0.2));
}

function estimateBodyCompAtWeight(weight, days = allDays) {
  const { cutFatFreeShare, gainFatFreeShare } = bodyCompModelShares(days);
  const weightDelta = weight - DXA_SCAN.totalMass;
  const fatFreeShare = weightDelta < 0 ? cutFatFreeShare : gainFatFreeShare;
  const fatFreeMass = Math.max(DXA_FAT_FREE_MASS + (weightDelta * fatFreeShare), 0);
  const lean = Math.max(fatFreeMass - DXA_BONE_MASS, 0);
  const fat = Math.max(weight - fatFreeMass, 0);
  return {
    weight,
    lean,
    fat,
    fatFreeShare,
    bodyFatPct: weight ? (fat / weight) * 100 : 0
  };
}

function estimateBodyCompRangeAtWeight(weight, days = allDays) {
  const base = estimateBodyCompAtWeight(weight, days);
  const confidenceScore = bodyCompConfidenceScore(days);
  const { cutFatFreeShare, gainFatFreeShare } = bodyCompModelShares(days);
  const weightDelta = weight - DXA_SCAN.totalMass;
  const baseShare = weightDelta < 0 ? cutFatFreeShare : gainFatFreeShare;
  const sharePad = 0.018 + ((1 - confidenceScore) * 0.03);
  const shareOptions = [
    Math.max(0.02, baseShare - sharePad),
    baseShare,
    Math.min(0.4, baseShare + sharePad)
  ];
  const variants = shareOptions.map(fatFreeShare => {
    const fatFreeMass = Math.max(DXA_FAT_FREE_MASS + (weightDelta * fatFreeShare), 0);
    const lean = Math.max(fatFreeMass - DXA_BONE_MASS, 0);
    const fat = Math.max(weight - fatFreeMass, 0);
    const bodyFatPct = weight ? (fat / weight) * 100 : 0;
    return { fatFreeShare, fatFreeMass, lean, fat, bodyFatPct };
  });
  const fatVals = variants.map(v => v.fat);
  const leanVals = variants.map(v => v.lean);
  const bfVals = variants.map(v => v.bodyFatPct);
  return {
    ...base,
    fatLow: Math.min(...fatVals),
    fatHigh: Math.max(...fatVals),
    leanLow: Math.min(...leanVals),
    leanHigh: Math.max(...leanVals),
    bodyFatPctLow: Math.min(...bfVals),
    bodyFatPctHigh: Math.max(...bfVals),
    confidence: projectionConfidence(confidenceScore),
    confidenceScore
  };
}

// Body composition estimate anchored to the Jan 6, 2026 DXA scan.
function bodyCompEstimate(days = allDays) {
  const weightDays = days.filter(d => d.weight);
  const scanDay = macroByDate[DXA_SCAN.date];
  const includeScan = isDateInRange(DXA_SCAN.date) && (!scanDay || matchesDayEvent(scanDay));
  if (!weightDays.length && !includeScan) return [];
  const points = weightDays.map((d) => ({ date: d.date, ...estimateBodyCompRangeAtWeight(d.weight, days) }));
  if (includeScan) {
    points.push({
      date: DXA_SCAN.date,
      weight: DXA_SCAN.totalMass,
      lean: DXA_SCAN.leanMass,
      fat: DXA_FAT_MASS,
      bodyFatPct: DXA_SCAN.bodyFatPct,
      fatLow: DXA_FAT_MASS,
      fatHigh: DXA_FAT_MASS,
      leanLow: DXA_SCAN.leanMass,
      leanHigh: DXA_SCAN.leanMass,
      bodyFatPctLow: DXA_SCAN.bodyFatPct,
      bodyFatPctHigh: DXA_SCAN.bodyFatPct,
      confidence: projectionConfidence(1),
      confidenceScore: 1,
      measured: true
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

// Sleep debt
function sleepDebt(days = sleepData) {
  let cumDebt = 0;
  return days.filter(d => d.hours != null).map(d => {
    cumDebt += (d.hours - goals.sleep);
    return { date: d.date, debt: cumDebt };
  });
}

function estimateDrinkCalories(drinks) {
  if (!drinks) return 0;
  const text = String(drinks).toLowerCase();
  let total = 0;
  const drinkPatterns = [
    { re: /(\d+(?:\.\d+)?)\s*(?:jameson|jamesons|whiskey|whiskeys)/g, kcal: 110 },
    { re: /(\d+(?:\.\d+)?)\s*(?:tequila|tequilas)/g, kcal: 100 },
    { re: /(\d+(?:\.\d+)?)\s*(?:beer|beers)/g, kcal: 150 },
    { re: /(\d+(?:\.\d+)?)\s*(?:wine)/g, kcal: 125 },
    { re: /(\d+(?:\.\d+)?)\s*(?:champagne)/g, kcal: 125 },
    { re: /(\d+(?:\.\d+)?)\s*(?:sake|sake's)/g, kcal: 135 },
    { re: /(\d+(?:\.\d+)?)\s*(?:white claw|white claws)/g, kcal: 100 },
    { re: /(\d+(?:\.\d+)?)\s*(?:old fashioned|old fashioneds)/g, kcal: 170 },
    { re: /(\d+(?:\.\d+)?)\s*(?:highball|highballs)/g, kcal: 130 },
    { re: /(\d+(?:\.\d+)?)\s*(?:negroni|negronis)/g, kcal: 180 },
    { re: /(\d+(?:\.\d+)?)\s*(?:drink|drinks)/g, kcal: 140 }
  ];
  drinkPatterns.forEach(({ re, kcal }) => {
    for (const match of text.matchAll(re)) total += parseFloat(match[1]) * kcal;
  });
  const sojuMatch = text.match(/(?:(half)|(\d+(?:\.\d+)?))\s*soju bottle/);
  if (sojuMatch) {
    const count = sojuMatch[1] ? 0.5 : parseFloat(sojuMatch[2] || '1');
    total += count * 540;
  }
  if (!total && text.includes('soju')) total += 270;
  if (!total && text.trim()) total += 140;
  return Math.round(total);
}

function effectiveCalories(day) {
  return (day?.calories || 0) + estimateDrinkCalories(day?.drinks);
}

function avgEffectiveCalories(days) {
  return days.length ? days.reduce((sum, day) => sum + effectiveCalories(day), 0) / days.length : null;
}

function latestWeightPointForScenario(days = allDays) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length) return weightDays[weightDays.length - 1];
  return [...allDays].reverse().find(d => d.weight) || null;
}

function latestWeightForScenario(days = allDays) {
  return latestWeightPointForScenario(days)?.weight ?? 162;
}

function addDaysToDate(dateStr, daysToAdd) {
  const date = new Date(`${dateStr}T12:00:00`);
  date.setDate(date.getDate() + daysToAdd);
  return date.toISOString().slice(0, 10);
}

// What-if calculation
function calculateWhatIf(dailyCal, weeks, avgSleep, drinkNightsPerWeek = 0, days = allDays, sleep = sleepData) {
  const currentWeight = latestWeightForScenario(days);
  const tdee = workingTDEEProfile(days).maintenance;
  const dailyDeficit = tdee - dailyCal;
  const sleepPenalty = avgSleep < 5 ? 170 : (avgSleep < 6 ? 90 : (avgSleep < 7 ? 30 : 0));
  const drinkEffect = historicalDrinkEffects(days, sleep);
  const drinkPenalty = (drinkEffect.calorieDelta || 0) * (Math.max(0, drinkNightsPerWeek) / 7);
  const effectiveDeficit = dailyDeficit - sleepPenalty - drinkPenalty;
  const totalDeficit = effectiveDeficit * weeks * 7;
  const weightChange = totalDeficit / 3500;
  const projectedWeight = currentWeight - weightChange;
  return {
    currentWeight,
    projectedWeight: projectedWeight.toFixed(1),
    weightChange: weightChange.toFixed(1),
    totalDeficit,
    sleepPenalty,
    drinkPenalty,
    drinkSleepPenalty: drinkEffect.drinkSleepPenalty,
    effectiveDeficit,
    tdee
  };
}

function scenarioForecastSeries(label, values, days, sleep) {
  const projection = calculateWhatIf(values.calories, values.weeks, values.sleep, values.drinks, days, sleep);
  const weeks = Math.max(1, values.weeks);
  const anchorDate = latestWeightPointForScenario(days)?.date || allDays[allDays.length - 1]?.date || DXA_SCAN.date;
  const weights = Array.from({ length: weeks + 1 }, (_, week) => {
    const projected = projection.currentWeight - ((projection.effectiveDeficit * 7 * week) / 3500);
    return projected;
  });
  const dates = Array.from({ length: weeks + 1 }, (_, week) => addDaysToDate(anchorDate, week * 7));
  const bodyComp = weights.map(weight => estimateBodyCompRangeAtWeight(weight, days));
  return {
    label,
    values,
    projection,
    dates,
    bodyComp,
    data: weights.map(weight => weightValue(weight))
  };
}

// Weekly report
function generateWeeklyReport() {
  const filteredDays = getFilteredDays();
  const filteredSleep = getFilteredSleep();
  const lastDays = filteredDays.slice(-7);
  const lastSleep = filteredSleep.slice(-7);
  if (!lastDays.length) {
    return {
      text: 'No data in the selected range.',
      avgCal: 0,
      avgPro: 0,
      liftCount: 0,
      drinkCount: 0,
      avgSleepPerf: 0,
      hiProDays: 0,
      lastDays: [],
      lastSleep: [],
      prevWeek: [],
      prevSleep: [],
      currentSummary: null,
      previousSummary: null,
      avgSleepHrs: null,
      rangeStr: '',
      weightChange: null,
      prevWeightChange: null
    };
  }
  const avgCal = Math.round(avg(lastDays, 'calories'));
  const avgPro = Math.round(avg(lastDays, 'protein'));
  const liftCount = lastDays.filter(d => d.lifting === 'Y').length;
  const drinkCount = lastDays.filter(d => d.drinks).length;
  const avgSleepPerf = Math.round(avg(lastSleep, 'perf'));
  const avgSleepHrs = avg(lastSleep, 'hours').toFixed(1);
  const prevWeek = filteredDays.slice(-14, -7);
  const prevSleep = filteredSleep.slice(-14, -7);
  const prevAvgCal = Math.round(avg(prevWeek, 'calories'));
  const calDelta = avgCal - prevAvgCal;
  const calDir = calDelta > 0 ? '↑' : '↓';

  const startDate = new Date(lastDays[0].date + 'T12:00:00');
  const endDate = new Date(lastDays[lastDays.length-1].date + 'T12:00:00');
  const rangeStr = `${startDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${endDate.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  const hiProDays = lastDays.filter(hitProteinFloor).length;
  const proteinFloorLabel = proteinGoalRangeLabel(lastDays);
  const text = `Range ${currentRangeLabel()}. Latest 7 logged days (${rangeStr}): averaged ${energyLabel(avgCal)} (${calDir}${convEnergy(Math.abs(calDelta)).toLocaleString()} ${energyUnit()} vs prior 7 days), hit the 90%-of-body-weight protein floor (${proteinFloorLabel}) on ${hiProDays}/${lastDays.length} days, lifted ${liftCount}x, drank on ${drinkCount} night${drinkCount!==1?'s':''}, sleep averaged ${avgSleepPerf}% perf / ${avgSleepHrs}h.`;
  const currentSummary = summarizeRange(lastDays, lastSleep);
  const previousSummary = summarizeRange(prevWeek, prevSleep);
  const weightChange = actualWeightLoss(lastDays);
  const prevWeightChange = actualWeightLoss(prevWeek);

  return {
    text,
    avgCal,
    avgPro,
    liftCount,
    drinkCount,
    avgSleepPerf,
    hiProDays,
    lastDays,
    lastSleep,
    prevWeek,
    prevSleep,
    currentSummary,
    previousSummary,
    avgSleepHrs: Number(avgSleepHrs),
    rangeStr,
    weightChange,
    prevWeightChange
  };
}

function generateWeeklyMarkdown() {
  const r = generateWeeklyReport();
  if (!r.lastDays.length) return 'No data in the selected range.';
  const current = r.currentSummary;
  const previous = r.previousSummary;
  const wc = r.weightChange;
  const lines = [
    `# Weekly Review — ${r.rangeStr}`,
    '',
    `## Overview`,
    r.text,
    '',
    `## Key Metrics`,
    `- Average Intake: ${energyLabel(r.avgCal)}`,
    `- Protein Floor: ${r.hiProDays}/${r.lastDays.length} days`,
    `- Lift Sessions: ${r.liftCount}x`,
    `- Drink Nights: ${r.drinkCount}`,
    `- Sleep: ${r.avgSleepPerf}% perf / ${r.avgSleepHrs}h avg`,
    wc != null ? `- Weight Change: ${wc >= 0 ? '+' : ''}${weightLabel(wc, 1)}` : '',
    '',
    `## Comparison vs Prior Week`,
    current && previous ? [
      `- Calories: ${energyLabel(current.avgCalories)} vs ${energyLabel(previous.avgCalories)}`,
      `- Protein Hit Rate: ${Math.round(current.proteinHitRate)}% vs ${Math.round(previous.proteinHitRate)}%`,
      current.avgSleepPerf != null && previous.avgSleepPerf != null ? `- Sleep Perf: ${Math.round(current.avgSleepPerf)}% vs ${Math.round(previous.avgSleepPerf)}%` : '',
    ].filter(Boolean).join('\n') : 'Not enough data for comparison.',
    '',
    `## Day-by-Day`,
    ...r.lastDays.map(d => {
      const s = sleepByDate[d.date];
      return `- **${d.date}**: ${energyLabel(d.calories)} · ${d.protein}g pro · ${d.lifting === 'Y' ? 'Lifted' : 'Rest'}${d.drinks ? ' · 🍹 ' + d.drinks : ''}${d.weight ? ' · ' + weightLabel(d.weight) : ''}${s ? ' · ' + s.perf + '% sleep' : ''}`;
    }),
    ''
  ];
  return lines.filter(l => l !== undefined).join('\n');
}

// Date range state
let rangeStartIdx = 0;
let rangeEndIdx = defaultRangeEndIndex();
let compareMode = persistedState.compareMode || 'equal_span';
let eventFilter = persistedState.eventFilter || 'all';
let activeTab = persistedState.activeTab || 'overview';
let scenarioPreset = 'current';
let scenarioFormInitialized = false;
let suppressEventFilter = false;

const TAB_CHROME = {
  overview: {
    title: 'Overview',
    summary: 'Start here for the fastest read on trend, forecast, and the current range.',
    jumps: [
      { label: 'Hero', selector: '.hero-stage[data-tab-section="overview"]' },
      { label: 'Summary', selector: '#overviewSummarySection' },
      { label: 'Latest Week', selector: '#weeklyReportShell' }
    ]
  },
  progress: {
    title: 'Progress',
    summary: 'Outcome-first view: scale trend, body composition, and monthly progress signals.',
    jumps: [
      { label: 'Heatmap', selector: '#progressHeatmapSection' },
      { label: 'Weight', selector: '#weightChart' },
      { label: 'Body Comp', selector: '#bodyCompChart' }
    ]
  },
  nutrition: {
    title: 'Nutrition & Behavior',
    summary: 'Use this tab to see whether intake, training, and food patterns are supporting the cut.',
    jumps: [
      { label: 'Calories', selector: '#caloriesChart' },
      { label: 'Deficit', selector: '#waterfallChart' },
      { label: 'Food', selector: '#nutritionFoodSection' }
    ]
  },
  sleep: {
    title: 'Sleep & Recovery',
    summary: 'This tab isolates the previous-night behaviors and next-day effects driving recovery.',
    jumps: [
      { label: 'Core Sleep', selector: '#sleepCoreSection' },
      { label: 'Insights', selector: '#sleepInsightSection' },
      { label: 'Overlay', selector: '#sleepAnnotatedChart' }
    ]
  },
  explore: {
    title: 'Explore',
    summary: 'Diagnostic tools live here: correlations, decomposition, data quality, and scenario planning.',
    jumps: [
      { label: 'Correlations', selector: '#exploreCorrSection' },
      { label: 'Trend', selector: '#exploreTrendSection' },
      { label: 'Food', selector: '#exploreFoodSection' },
      { label: 'Audit', selector: '#exploreAuditSection' },
      { label: 'Scenario', selector: '#exploreScenarioSection' }
    ]
  }
};

function getRangeState() {
  const startEl = document.getElementById('rangeStart');
  const endEl = document.getElementById('rangeEnd');
  const start = Math.min(parseInt(startEl?.value ?? rangeStartIdx), parseInt(endEl?.value ?? rangeEndIdx));
  const end = Math.max(parseInt(startEl?.value ?? rangeStartIdx), parseInt(endEl?.value ?? rangeEndIdx));
  rangeStartIdx = start;
  rangeEndIdx = end;
  return { start, end };
}

function isDateInRange(dateStr) {
  const idx = allDates.indexOf(dateStr);
  if (idx < 0) return false;
  const { start, end } = getRangeState();
  return idx >= start && idx <= end;
}

function isWeekendDate(dateStr) {
  const weekday = new Date(dateStr + 'T12:00:00').getDay();
  return weekday === 0 || weekday === 6;
}

function filterLabel() {
  return ({
    all: 'all days',
    lift_days: 'lift days',
    alcohol: 'alcohol-affected days',
    weekends: 'weekends',
    clean_days: 'clean days'
  })[eventFilter] || 'all days';
}

function compareModeLabel() {
  return ({
    equal_span: 'the previous equal-length span',
    prior_7: 'the previous 7 days',
    prior_28: 'the previous 28 days',
    prior_month: 'the previous month with the same day-count'
  })[compareMode] || 'the previous equal-length span';
}

function matchesDayEvent(day) {
  if (suppressEventFilter) return true;
  switch (eventFilter) {
    case 'lift_days': return day.lifting === 'Y';
    case 'alcohol': return !!day.drinks;
    case 'weekends': return isWeekendDate(day.date);
    case 'clean_days': return !day.drinks;
    default: return true;
  }
}

function matchesSleepEvent(day) {
  if (suppressEventFilter) return true;
  switch (eventFilter) {
    case 'lift_days': return liftDates.has(day.date);
    case 'alcohol': return drinkDates.has(prevDay(day.date));
    case 'weekends': return isWeekendDate(day.date);
    case 'clean_days': return !drinkDates.has(prevDay(day.date));
    default: return true;
  }
}

function getRangeDays() {
  const { start, end } = getRangeState();
  return allDays.slice(start, end + 1);
}

function getFilteredDays() {
  return getRangeDays().filter(matchesDayEvent);
}

function getFilteredSleep() {
  const dateSet = new Set(getRangeDays().map(d => d.date));
  return sleepData.filter(d => dateSet.has(d.date) && matchesSleepEvent(d));
}

function currentRangeLabel() {
  const days = getRangeDays();
  if (!days.length) return 'No range selected';
  const first = new Date(days[0].date + 'T12:00:00');
  const last = new Date(days[days.length - 1].date + 'T12:00:00');
  return `${first.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${last.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function formatShortDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function labelForDays(days) {
  if (!days.length) return 'No data';
  return `${formatShortDate(days[0].date)} - ${formatShortDate(days[days.length - 1].date)}`;
}

function getComparisonCurrentBaseDays() {
  const rangeDays = getRangeDays();
  if (!rangeDays.length) return [];
  if (compareMode === 'prior_7') return rangeDays.slice(-7);
  if (compareMode === 'prior_28') return rangeDays.slice(-28);
  if (compareMode === 'prior_month') {
    const endDate = new Date(rangeDays[rangeDays.length - 1].date + 'T12:00:00');
    return rangeDays.filter(d => {
      const dt = new Date(d.date + 'T12:00:00');
      return dt.getFullYear() === endDate.getFullYear() && dt.getMonth() === endDate.getMonth() && dt <= endDate;
    });
  }
  return rangeDays;
}

function getComparisonCurrentDays() {
  return getComparisonCurrentBaseDays().filter(matchesDayEvent);
}

function getPreviousPeriodBaseDays() {
  const currentBaseDays = getComparisonCurrentBaseDays();
  if (!currentBaseDays.length) return [];
  const currentStartIdx = allDates.indexOf(currentBaseDays[0].date);
  const currentLen = currentBaseDays.length;
  if (compareMode === 'prior_month') {
    const currentEnd = new Date(currentBaseDays[currentBaseDays.length - 1].date + 'T12:00:00');
    const prevMonthStart = new Date(currentEnd.getFullYear(), currentEnd.getMonth() - 1, 1, 12);
    const prevMonthEnd = new Date(prevMonthStart);
    prevMonthEnd.setDate(prevMonthEnd.getDate() + currentLen - 1);
    return allDays.filter(d => {
      const dt = new Date(d.date + 'T12:00:00');
      return dt >= prevMonthStart && dt <= prevMonthEnd;
    });
  }
  return allDays.slice(Math.max(0, currentStartIdx - currentLen), currentStartIdx);
}

function getPreviousPeriodDays() {
  return getPreviousPeriodBaseDays().filter(matchesDayEvent);
}

function getSleepForDays(days) {
  const dateSet = new Set(days.map(d => d.date));
  return sleepData.filter(d => dateSet.has(d.date) && matchesSleepEvent(d));
}

function getSleepForDaysUnfiltered(days) {
  const dateSet = new Set(days.map(d => d.date));
  return sleepData.filter(d => dateSet.has(d.date));
}

function pct(part, total) {
  return total ? (part / total) * 100 : 0;
}

function bedtimeGoalHour() {
  const m = goals.bedtime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return 0.5;
  let hour = parseInt(m[1], 10) % 12;
  const minute = parseInt(m[2], 10) / 60;
  if (m[3].toUpperCase() === 'PM') hour += 12;
  return hour >= 12 ? hour - 24 + minute : hour + minute;
}

function normalizedBedtimeHour(sleepDay) {
  return sleepDay.bedtime_hour > 12 ? sleepDay.bedtime_hour - 24 : sleepDay.bedtime_hour;
}

function topFoodsForDays(days, limit = 3) {
  return foodFrequency(days).slice(0, limit).map(([name, count]) => `${name} (${count})`);
}

function currentStreak(items, predicate) {
  let streak = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    if (!predicate(items[i])) break;
    streak++;
  }
  return streak;
}

function bestStreak(items, predicate) {
  let best = 0;
  let current = 0;
  items.forEach(item => {
    if (predicate(item)) {
      current++;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  });
  return best;
}

function latestWeighInDelta(days) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length < 2) return null;
  const latest = weightDays[weightDays.length - 1];
  const prior = weightDays[weightDays.length - 2];
  return { latest, prior, delta: latest.weight - prior.weight };
}

function overallOnTrack(day) {
  return !!day && day.calories <= goals.calories && hitProteinFloor(day) && !day.drinks;
}

function compareDelta(current, previous, betterDirection = 'up', formatter = v => v.toString(), suffix = '') {
  if (current == null) return { text: '—', cls: 'neutral', detail: 'No current data' };
  if (previous == null || Number.isNaN(previous)) return { text: formatter(current), cls: 'neutral', detail: 'No prior period available' };
  const delta = current - previous;
  const better = delta === 0 ? null : ((betterDirection === 'up' && delta > 0) || (betterDirection === 'down' && delta < 0));
  return {
    text: `${delta > 0 ? '+' : ''}${formatter(delta)}${suffix}`,
    cls: delta === 0 ? 'neutral' : (better ? 'good' : 'bad'),
    detail: `${formatter(current)} vs ${formatter(previous)}`
  };
}

function summarizeRange(days, sleep) {
  const weightDays = days.filter(d => d.weight);
  const lastWeight = weightDays.length ? weightDays[weightDays.length - 1].weight : null;
  const firstWeight = weightDays.length ? weightDays[0].weight : null;
  const avgCalories = avgOrNull(days, 'calories');
  const avgProtein = avgOrNull(days, 'protein');
  const avgSleepPerf = avgOrNull(sleep, 'perf');
  const avgSleepHours = avgOrNull(sleep, 'hours');
  const proteinHits = days.filter(hitProteinFloor).length;
  const calorieHits = days.filter(d => d.calories <= goals.calories).length;
  const sleepHits = sleep.filter(d => d.perf >= goals.sleepPerf).length;
  const bedtimeHits = sleep.filter(d => normalizedBedtimeHour(d) <= bedtimeGoalHour()).length;
  const drinkNights = days.filter(d => d.drinks).length;
  const lifts = days.filter(d => d.lifting === 'Y').length;
  const weekends = days.filter(d => {
    const weekday = new Date(d.date + 'T12:00:00').getDay();
    return weekday === 0 || weekday === 6;
  });
  const weekdays = days.filter(d => {
    const weekday = new Date(d.date + 'T12:00:00').getDay();
    return weekday > 0 && weekday < 6;
  });
  const avgWeekendSleep = avgOrNull(getSleepForDays(weekends), 'perf');
  const avgWeekdaySleep = avgOrNull(getSleepForDays(weekdays), 'perf');
  return {
    daysCount: days.length,
    sleepCount: sleep.length,
    firstWeight,
    lastWeight,
    weightChange: firstWeight != null && lastWeight != null ? lastWeight - firstWeight : null,
    avgCalories,
    avgProtein,
    avgSleepPerf,
    avgSleepHours,
    proteinHitRate: pct(proteinHits, days.length),
    calorieHitRate: pct(calorieHits, days.length),
    sleepHitRate: pct(sleepHits, sleep.length),
    bedtimeHitRate: pct(bedtimeHits, sleep.length),
    drinkNights,
    liftCount: lifts,
    cleanRate: pct(days.length - drinkNights, days.length),
    avgWeekendSleep,
    avgWeekdaySleep,
    topFoods: topFoodsForDays(days)
  };
}

function actualWeightLoss(days) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length < 2) return null;
  return weightDays[0].weight - weightDays[weightDays.length - 1].weight;
}

function projectionConfidence(level) {
  if (level >= 0.75) return { label: 'High confidence', cls: 'high' };
  if (level >= 0.45) return { label: 'Medium confidence', cls: 'medium' };
  return { label: 'Low confidence', cls: 'low' };
}

function projectionFreshness() {
  const latestMacro = allDays[allDays.length - 1]?.date || null;
  const latestSleep = sleepData[sleepData.length - 1]?.date || null;
  const latestWeight = [...allDays].reverse().find(d => d.weight)?.date || null;
  return { latestMacro, latestSleep, latestWeight };
}

function energyBalanceSummary(days, tdee = estimatedTDEE) {
  const activeTdee = Number.isFinite(tdee) ? tdee : workingTDEEProfile(days).maintenance;
  if (!days.length || !Number.isFinite(activeTdee)) return null;
  const totalIntake = days.reduce((sum, day) => sum + effectiveCalories(day), 0);
  const totalMaintenance = activeTdee * days.length;
  const totalDeficit = totalMaintenance - totalIntake;
  return {
    totalIntake,
    totalMaintenance,
    totalDeficit,
    avgDailyDeficit: totalDeficit / Math.max(days.length, 1),
    weeklyPace: (totalDeficit / Math.max(days.length, 1)) * 7,
    fatEquivalent: totalDeficit / 3500
  };
}

function expectedWeightLoss(days) {
  if (!days.length) return null;
  const rangeTdee = workingTDEEProfile(days).maintenance;
  return days.reduce((sum, d) => sum + (rangeTdee - effectiveCalories(d)), 0) / 3500;
}

function weightTrendReality(days) {
  const expectedLoss = expectedWeightLoss(days);
  const projection = observedWeightProjection(days, 0);
  const actualLoss = projection ? (projection.startTrendWeight - projection.latestTrendWeight) : actualWeightLoss(days);
  const gap = expectedLoss != null && actualLoss != null ? actualLoss - expectedLoss : null;
  const efficiency = expectedLoss && actualLoss != null ? (actualLoss / expectedLoss) * 100 : null;
  return {
    expectedLoss,
    actualLoss,
    gap,
    efficiency,
    observedTrend: projection
  };
}

function formatSignedWeight(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${weightLabel(Math.abs(v), digits)}`;
}

function formatSignedPct(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}%`;
}

function trendDecomposition(days) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length < 2) return null;
  const observedTrend = observedWeightProjection(days, 0);
  const scaleLoss = observedTrend ? (observedTrend.startTrendWeight - observedTrend.latestTrendWeight) : (weightDays[0].weight - weightDays[weightDays.length - 1].weight);
  const expectedLoss = expectedWeightLoss(days);
  const compPoints = bodyCompEstimate(days).filter(p => !p.measured);
  const firstComp = compPoints[0] || null;
  const lastComp = compPoints[compPoints.length - 1] || null;
  const fatLoss = firstComp && lastComp ? firstComp.fat - lastComp.fat : null;
  const leanLoss = firstComp && lastComp ? firstComp.lean - lastComp.lean : null;
  const nonFatShift = scaleLoss != null && fatLoss != null ? scaleLoss - fatLoss : null;
  const residual = nonFatShift != null && leanLoss != null ? nonFatShift - leanLoss : null;
  const modelGap = scaleLoss != null && expectedLoss != null ? scaleLoss - expectedLoss : null;
  return {
    scaleLoss,
    expectedLoss,
    fatLoss,
    leanLoss,
    nonFatShift,
    residual,
    modelGap,
    weightSpan: weightDays.length,
    daySpan: Math.max(1, Math.round((new Date(weightDays[weightDays.length - 1].date + 'T12:00:00') - new Date(weightDays[0].date + 'T12:00:00')) / 86400000)),
    observedTrend
  };
}

function historicalDrinkEffects(days, sleep) {
  const drinkDays = days.filter(d => d.drinks);
  const cleanDays = days.filter(d => !d.drinks);
  const avgDrinkCalories = avgEffectiveCalories(drinkDays);
  const avgCleanCalories = avgEffectiveCalories(cleanDays);
  const calorieDelta = avgDrinkCalories != null && avgCleanCalories != null ? Math.max(0, avgDrinkCalories - avgCleanCalories) : 0;

  const afterDrink = sleep.filter(d => drinkDates.has(prevDay(d.date))).map(d => d.perf);
  const afterClean = sleep.filter(d => !drinkDates.has(prevDay(d.date))).map(d => d.perf);
  const drinkSleepPenalty = afterDrink.length && afterClean.length
    ? Math.max(0, avgOrNull(afterClean.map(v => ({ v })), 'v') - avgOrNull(afterDrink.map(v => ({ v })), 'v'))
    : 0;

  return { calorieDelta, drinkSleepPenalty };
}

function getScenarioDefaults(days, sleep) {
  const avgCalories = avgEffectiveCalories(days) ?? goals.calories;
  const avgSleep = avgOrNull(sleep, 'hours') ?? goals.sleep;
  const drinkPerWeek = days.length ? +(days.filter(d => d.drinks).length / Math.max(days.length / 7, 1)).toFixed(1) : 0;
  const rangeTdee = workingTDEEProfile(days).maintenance;
  return {
    current: { calories: Math.round(avgCalories / 25) * 25, weeks: 4, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
    maintain: { calories: Math.round(rangeTdee / 25) * 25, weeks: 4, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
    mild_cut: { calories: Math.round((rangeTdee - 350) / 25) * 25, weeks: 6, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
    aggressive_cut: { calories: Math.round((rangeTdee - 650) / 25) * 25, weeks: 4, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
    better_sleep: { calories: Math.round(avgCalories / 25) * 25, weeks: 4, sleep: +Math.min(8, Math.max(goals.sleep, avgSleep + 1)).toFixed(1), drinks: drinkPerWeek },
    no_drinks: { calories: Math.round(avgCalories / 25) * 25, weeks: 4, sleep: +avgSleep.toFixed(1), drinks: 0 }
  };
}

function scenarioPresetLabel(key) {
  const labels = {
    current: 'Current pace',
    maintain: 'Maintain',
    mild_cut: 'Mild cut',
    aggressive_cut: 'Aggressive cut',
    better_sleep: 'Better sleep',
    no_drinks: 'No drinks'
  };
  return labels[key] || 'Active scenario';
}

function updateScenarioForecastChart(activeValues, days, sleep) {
  const chart = allCharts.scenarioForecastChart;
  const weeks = Math.max(1, activeValues.weeks);
  const avgCalories = avgEffectiveCalories(days) ?? goals.calories;
  const avgSleep = avgOrNull(sleep, 'hours') ?? goals.sleep;
  const avgDrinks = days.length ? +(days.filter(d => d.drinks).length / Math.max(days.length / 7, 1)).toFixed(1) : 0;
  const defaults = getScenarioDefaults(days, sleep);
  const activeLabel = scenarioPreset ? scenarioPresetLabel(scenarioPreset) : 'Active scenario';
  const activeSeries = scenarioForecastSeries(activeLabel, { ...activeValues, weeks }, days, sleep);
  const currentSeries = scenarioForecastSeries('Current pace', { calories: avgCalories, weeks, sleep: avgSleep, drinks: avgDrinks }, days, sleep);
  const comparisonKeys = ['maintain', 'mild_cut', 'aggressive_cut'].filter(key => key !== scenarioPreset);
  const isCurrentEquivalent =
    Math.abs(activeValues.calories - avgCalories) < 1 &&
    Math.abs(activeValues.sleep - avgSleep) < 0.11 &&
    Math.abs(activeValues.drinks - avgDrinks) < 0.11;
  const colorMap = {
    current: '#60a5fa',
    active: '#fbbf24',
    maintain: '#94a3b8',
    mild_cut: '#2dd4bf',
    aggressive_cut: '#c084fc'
  };

  chart.data.labels = activeSeries.dates.map(formatShortDate);
  chart.data.datasets = [
    ...(!isCurrentEquivalent ? [{
      label: currentSeries.label,
      data: currentSeries.data,
      bodyFatPcts: currentSeries.bodyComp.map(point => point.bodyFatPct),
      bodyFatRanges: currentSeries.bodyComp.map(point => [point.bodyFatPctLow, point.bodyFatPctHigh]),
      borderColor: colorMap.current,
      backgroundColor: 'transparent',
      borderDash: [6, 5],
      pointStyle: 'circle',
      pointRadius: 0,
      borderWidth: 2
    }] : [{
      label: currentSeries.label,
      data: currentSeries.data,
      bodyFatPcts: currentSeries.bodyComp.map(point => point.bodyFatPct),
      bodyFatRanges: currentSeries.bodyComp.map(point => [point.bodyFatPctLow, point.bodyFatPctHigh]),
      borderColor: colorMap.active,
      backgroundColor: 'transparent',
      pointStyle: 'circle',
      pointRadius: 0,
      borderWidth: 3
    }]),
    ...comparisonKeys.map(key => {
      const values = { ...defaults[key], weeks };
      const series = scenarioForecastSeries(scenarioPresetLabel(key), values, days, sleep);
      return {
        label: scenarioPresetLabel(key),
        data: series.data,
        bodyFatPcts: series.bodyComp.map(point => point.bodyFatPct),
        bodyFatRanges: series.bodyComp.map(point => [point.bodyFatPctLow, point.bodyFatPctHigh]),
        borderColor: colorMap[key],
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.8,
        borderDash: [3, 4]
      };
    }),
    ...(!isCurrentEquivalent ? [{
      label: activeSeries.label,
      data: activeSeries.data,
      bodyFatPcts: activeSeries.bodyComp.map(point => point.bodyFatPct),
      bodyFatRanges: activeSeries.bodyComp.map(point => [point.bodyFatPctLow, point.bodyFatPctHigh]),
      borderColor: colorMap.active,
      backgroundColor: 'rgba(251,191,36,0.08)',
      pointStyle: 'rectRounded',
      pointRadius: 0,
      borderWidth: 3,
      fill: false
    }] : [])
  ];

  const allValues = chart.data.datasets.flatMap(ds => ds.data).filter(v => Number.isFinite(v));
  const bounds = calcAxisBounds(allValues, useMetric ? 0.6 : 1.2);
  chart.options.scales.y.min = Math.floor(bounds.min);
  chart.options.scales.y.max = Math.ceil(bounds.max);
  chart.options.scales.y.ticks.callback = v => `${v} ${weightUnit()}`;
  chart.options.plugins.tooltip.callbacks.label = ctx => {
    const bfPct = ctx.dataset.bodyFatPcts?.[ctx.dataIndex];
    const bfRange = ctx.dataset.bodyFatRanges?.[ctx.dataIndex];
    const bfText = Number.isFinite(bfPct) ? ` · ~${bfPct.toFixed(1)}% BF` : '';
    const bfRangeText = Array.isArray(bfRange) && Number.isFinite(bfRange[0]) && Number.isFinite(bfRange[1]) ? ` (${bfRange[0].toFixed(1)}%–${bfRange[1].toFixed(1)}%)` : '';
    return `${ctx.dataset.label}: ${ctx.parsed.y} ${weightUnit()}${bfText}${bfRangeText}`;
  };
  chart.options.plugins.tooltip.callbacks.footer = items => {
    const point = items[0];
    if (!point) return '';
    if (point.dataIndex === 0) return 'Latest weigh-in in selected range';
    return `Projected ${point.label.toLowerCase()} path using the DXA-anchored body-comp model`;
  };
  chart.update();
}

function qualityAudit(days, sleep) {
  const sleepCoverage = pct(sleep.length, days.length);
  const weightDays = days.filter(d => d.weight);
  const weightCoverage = pct(weightDays.length, days.length);
  const noteDays = days.filter(d => foodsForDay(d).length);
  const noteCoverage = pct(noteDays.length, days.length);
  const mismatchDays = days.map(d => {
    const macroCalories = d.protein * 4 + d.carbs * 4 + d.fat * 9;
    const gapPct = d.calories ? ((macroCalories - d.calories) / d.calories) * 100 : 0;
    return { date: d.date, logged: d.calories, macroCalories, gapPct };
  }).filter(d => d.logged > 0);
  const mismatchFlagged = mismatchDays.filter(d => Math.abs(d.gapPct) > 8).sort((a, b) => Math.abs(b.gapPct) - Math.abs(a.gapPct));
  const macroAgreement = mismatchDays.length ? 100 - (mismatchFlagged.length / mismatchDays.length) * 100 : 100;
  const missingSleepDates = days.filter(d => !sleepByDate[d.date]).map(d => d.date);
  let longestGap = null;
  for (let i = 1; i < weightDays.length; i++) {
    const prev = weightDays[i - 1];
    const curr = weightDays[i];
    const gapDays = Math.round((new Date(curr.date + 'T12:00:00') - new Date(prev.date + 'T12:00:00')) / 86400000);
    if (!longestGap || gapDays > longestGap.days) longestGap = { days: gapDays, start: prev.date, end: curr.date };
  }
  return {
    sleepCoverage,
    weightCoverage,
    noteCoverage,
    macroAgreement,
    mismatchFlagged,
    missingSleepDates,
    longestGap,
    noteMissing: days.length - noteDays.length,
    missingWeight: days.length - weightDays.length
  };
}

function linearRegression(xArr, yArr) {
  const n = xArr.length;
  if (n < 2) return { slope: 0, intercept: yArr[0] || 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xArr[i]; sumY += yArr[i];
    sumXY += xArr[i] * yArr[i]; sumX2 += xArr[i] * xArr[i];
  }
  const denom = n * sumX2 - sumX * sumX;
  if (!denom) return { slope: 0, intercept: sumY / n };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function weightedLinearRegression(xArr, yArr, weights) {
  const n = xArr.length;
  if (n < 2) return { slope: 0, intercept: yArr[0] || 0 };
  const safeWeights = weights?.length === n ? weights : Array.from({ length: n }, () => 1);
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0) || 1;
  const meanX = safeWeights.reduce((sum, weight, idx) => sum + (weight * xArr[idx]), 0) / weightSum;
  const meanY = safeWeights.reduce((sum, weight, idx) => sum + (weight * yArr[idx]), 0) / weightSum;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const dx = xArr[i] - meanX;
    num += safeWeights[i] * dx * (yArr[i] - meanY);
    den += safeWeights[i] * dx * dx;
  }
  const slope = den ? num / den : 0;
  const intercept = meanY - (slope * meanX);
  return { slope, intercept };
}

function weightedAverage(values, weights) {
  if (!values.length) return null;
  const safeWeights = weights?.length === values.length ? weights : Array.from({ length: values.length }, () => 1);
  const weightSum = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (!weightSum) return null;
  return values.reduce((sum, value, idx) => sum + (value * safeWeights[idx]), 0) / weightSum;
}

function recencyWeights(length, start = 0.8, end = 1.3) {
  if (!length) return [];
  if (length === 1) return [end];
  return Array.from({ length }, (_, idx) => start + (((end - start) * idx) / (length - 1)));
}

function regressionFitStats(xArr, yArr, reg, weights) {
  const safeWeights = weights?.length === xArr.length ? weights : Array.from({ length: xArr.length }, () => 1);
  const preds = xArr.map(x => reg.intercept + (reg.slope * x));
  const meanY = weightedAverage(yArr, safeWeights) ?? 0;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < yArr.length; i++) {
    ssRes += safeWeights[i] * ((yArr[i] - preds[i]) ** 2);
    ssTot += safeWeights[i] * ((yArr[i] - meanY) ** 2);
  }
  const residualStdDev = Math.sqrt(ssRes / Math.max(1, yArr.length - 1));
  const r2 = ssTot ? Math.max(0, 1 - (ssRes / ssTot)) : 0;
  return { residualStdDev, r2 };
}

const weightStateCache = new Map();
const tdeeProfileCache = new Map();

function clearAnalyticsCaches() {
  weightStateCache.clear();
  tdeeProfileCache.clear();
}

function daysSignature(days) {
  return days.map(d => d.date).join('|');
}

function stateSpaceMaintenanceSeed(days, weightedIntake) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length < 2 || weightedIntake == null) return Math.round(weightedIntake ?? goals.calories);
  const first = weightDays[0];
  const last = weightDays[weightDays.length - 1];
  const spanDays = Math.max(1, Math.round((new Date(last.date + 'T12:00:00') - new Date(first.date + 'T12:00:00')) / 86400000));
  const dailySlope = (last.weight - first.weight) / spanDays;
  return Math.round(weightedIntake + ((-dailySlope) * 3500));
}

function stateSpaceWeightTrendPoints(days, maintenanceGuess = null) {
  const key = `${daysSignature(days)}::${maintenanceGuess == null ? 'auto' : Math.round(maintenanceGuess)}`;
  if (weightStateCache.has(key)) return weightStateCache.get(key);

  const weightDays = days.filter(d => d.weight);
  if (weightDays.length < 2) {
    const sparse = weightDays.map((day, idx) => ({
      date: day.date,
      rawWeight: day.weight,
      trendWeight: day.weight,
      trendVelocity: 0,
      predictedWeight: day.weight,
      innovation: 0,
      variance: 0.6 ** 2,
      dayOffset: idx ? Math.round((new Date(day.date + 'T12:00:00') - new Date(weightDays[0].date + 'T12:00:00')) / 86400000) : 0
    }));
    weightStateCache.set(key, sparse);
    return sparse;
  }

  const intakeDays = days.filter(d => Number.isFinite(effectiveCalories(d)));
  const intakeValues = intakeDays.map(day => effectiveCalories(day));
  const intakeWeights = recencyWeights(intakeValues.length, 0.85, 1.35);
  const weightedIntake = weightedAverage(intakeValues, intakeWeights) ?? goals.calories;
  const firstTime = new Date(weightDays[0].date + 'T12:00:00').getTime();
  const rawDiffs = [];
  for (let i = 1; i < weightDays.length; i++) rawDiffs.push(Math.abs(weightDays[i].weight - weightDays[i - 1].weight));
  const medianDiff = rawDiffs.length ? rawDiffs.slice().sort((a, b) => a - b)[Math.floor(rawDiffs.length / 2)] : 0.9;
  const measurementVar = Math.max(0.3, Math.min(2.4, medianDiff || 0.9)) ** 2;
  const baseMaintenance = maintenanceGuess ?? stateSpaceMaintenanceSeed(days, weightedIntake);
  const first = weightDays[0];
  const second = weightDays[1];
  const initialSpan = Math.max(1, Math.round((new Date(second.date + 'T12:00:00') - new Date(first.date + 'T12:00:00')) / 86400000));
  const initialVelocity = (second.weight - first.weight) / initialSpan;

  let stateWeight = first.weight;
  let stateVelocity = initialVelocity;
  let p00 = 0.8 ** 2;
  let p01 = 0;
  let p11 = 0.11 ** 2;
  const points = [{
    date: first.date,
    rawWeight: first.weight,
    trendWeight: first.weight,
    trendVelocity: initialVelocity,
    predictedWeight: first.weight,
    innovation: 0,
    variance: p00,
    maintenanceSeed: baseMaintenance,
    dayOffset: 0
  }];

  for (let i = 1; i < weightDays.length; i++) {
    const prevPoint = weightDays[i - 1];
    const currentPoint = weightDays[i];
    const dt = Math.max(1, Math.round((new Date(currentPoint.date + 'T12:00:00') - new Date(prevPoint.date + 'T12:00:00')) / 86400000));

    const predictedWeight = stateWeight + (stateVelocity * dt);
    const predictedVelocity = stateVelocity * 0.985;

    const processWeight = 0.08 * dt;
    const processVelocity = 0.004 * dt;
    const predP00 = p00 + (dt * (2 * p01 + (dt * p11))) + processWeight;
    const predP01 = p01 + (dt * p11);
    const predP11 = p11 + processVelocity;

    const innovation = currentPoint.weight - predictedWeight;
    const innovationVar = predP00 + measurementVar;
    const k0 = innovationVar ? predP00 / innovationVar : 0;
    const k1 = innovationVar ? predP01 / innovationVar : 0;

    stateWeight = predictedWeight + (k0 * innovation);
    stateVelocity = predictedVelocity + (k1 * innovation);
    p00 = Math.max(0.01, (1 - k0) * predP00);
    p01 = (1 - k0) * predP01;
    p11 = Math.max(0.00005, predP11 - (k1 * predP01));

    points.push({
      date: currentPoint.date,
      rawWeight: currentPoint.weight,
      trendWeight: stateWeight,
      trendVelocity: stateVelocity,
      predictedWeight,
      innovation,
      variance: p00,
      maintenanceSeed: baseMaintenance,
      dayOffset: (new Date(currentPoint.date + 'T12:00:00').getTime() - firstTime) / 86400000
    });
  }

  weightStateCache.set(key, points);
  return points;
}

function smoothedWeightTrendPoints(days, window = 5) {
  return stateSpaceWeightTrendPoints(days);
}

function estimateTDEEProfile(days = allDays) {
  const signature = daysSignature(days);
  if (tdeeProfileCache.has(signature)) return tdeeProfileCache.get(signature);

  const intakeDays = days.filter(d => Number.isFinite(effectiveCalories(d)));
  const intakeValues = intakeDays.map(day => effectiveCalories(day));
  const intakeWeights = recencyWeights(intakeValues.length, 0.85, 1.35);
  const weightedIntake = weightedAverage(intakeValues, intakeWeights);
  const weightPoints = stateSpaceWeightTrendPoints(days);
  if (weightPoints.length < 3 || weightedIntake == null) {
    const fallback = Math.round(weightedIntake ?? goals.calories);
    const profile = {
      maintenance: fallback,
      weightedIntake: fallback,
      dailySlope: 0,
      weeklyLoss: 0,
      sampleSize: weightPoints.length,
      spanDays: 0,
      residualStdDev: null,
      r2: 0,
      scaleNoise: null,
      confidence: projectionConfidence(0.25),
      confidenceScore: 0.25,
      rangeLow: Math.max(0, fallback - 220),
      rangeHigh: fallback + 220,
      method: 'Fallback from average effective intake because the filtered weight trend is too sparse.'
    };
    tdeeProfileCache.set(signature, profile);
    return profile;
  }

  const weights = recencyWeights(weightPoints.length, 0.85, 1.45);
  const recentVelocities = weightPoints.slice(1).map(point => point.trendVelocity);
  const recentWeights = weights.slice(1);
  const dailySlope = weightedAverage(recentVelocities, recentWeights) ?? weightPoints[weightPoints.length - 1].trendVelocity ?? 0;
  const weeklyLoss = -dailySlope * 7;
  const maintenance = Math.round(weightedIntake + ((-dailySlope) * 3500));
  const spanDays = Math.max(1, Math.round(weightPoints[weightPoints.length - 1].dayOffset));
  const innovations = weightPoints.slice(1).map(point => point.innovation).filter(v => Number.isFinite(v));
  const residualStdDev = innovations.length
    ? Math.sqrt(innovations.reduce((sum, value) => sum + (value ** 2), 0) / innovations.length)
    : null;
  const xArr = weightPoints.map(point => point.dayOffset);
  const yArr = weightPoints.map(point => point.trendWeight);
  const reg = weightedLinearRegression(xArr, yArr, weights);
  const fit = regressionFitStats(xArr, yArr, reg, weights);
  const scaleNoise = residualStdDev ?? fit.residualStdDev;
  const noisePenalty = scaleNoise != null ? Math.max(0, 1 - (scaleNoise / 2.2)) : 0.45;
  const confidenceScore = Math.max(
    0.24,
    Math.min(
      0.97,
      (Math.min(weightPoints.length, 14) / 14) * 0.32 +
      (Math.min(spanDays, 70) / 70) * 0.28 +
      noisePenalty * 0.22 +
      (fit.r2 || 0) * 0.18
    )
  );
  const uncertainty = Math.round(Math.max(110, 255 - (confidenceScore * 120) + ((scaleNoise || 0) * 65)));
  const profile = {
    maintenance,
    weightedIntake,
    dailySlope,
    weeklyLoss,
    sampleSize: weightPoints.length,
    spanDays,
    residualStdDev,
    r2: fit.r2,
    scaleNoise,
    confidence: projectionConfidence(confidenceScore),
    confidenceScore,
    rangeLow: Math.max(0, maintenance - uncertainty),
    rangeHigh: maintenance + uncertainty,
    method: 'Estimated from recency-weighted effective intake plus a state-space filtered weight trend.'
  };
  tdeeProfileCache.set(signature, profile);
  return profile;
}

function endpointTDEEProfile(days = allDays) {
  const weightDays = days.filter(d => d.weight);
  const intakeDays = days.filter(d => Number.isFinite(effectiveCalories(d)));
  const intakeValues = intakeDays.map(day => effectiveCalories(day));
  const intakeWeights = recencyWeights(intakeValues.length, 0.85, 1.35);
  const weightedIntake = weightedAverage(intakeValues, intakeWeights);
  if (weightDays.length < 2 || weightedIntake == null) {
    const fallback = Math.round(weightedIntake ?? goals.calories);
    return {
      maintenance: fallback,
      weightedIntake: fallback,
      dailySlope: 0,
      weeklyLoss: 0,
      sampleSize: weightDays.length,
      spanDays: 0,
      confidence: projectionConfidence(0.25),
      confidenceScore: 0.25,
      rangeLow: Math.max(0, fallback - 250),
      rangeHigh: fallback + 250,
      method: 'Fallback from average effective intake because endpoint weigh-ins are too sparse.'
    };
  }
  const first = weightDays[0];
  const last = weightDays[weightDays.length - 1];
  const spanDays = Math.max(1, Math.round((new Date(last.date + 'T12:00:00') - new Date(first.date + 'T12:00:00')) / 86400000));
  const dailySlope = (last.weight - first.weight) / spanDays;
  const weeklyLoss = -dailySlope * 7;
  const maintenance = Math.round(weightedIntake + ((-dailySlope) * 3500));
  const confidenceScore = Math.max(
    0.3,
    Math.min(
      0.78,
      (Math.min(weightDays.length, 12) / 12) * 0.4 +
      (Math.min(spanDays, 84) / 84) * 0.35 +
      0.1
    )
  );
  const uncertainty = Math.round(Math.max(140, 310 - (confidenceScore * 140)));
  return {
    maintenance,
    weightedIntake,
    dailySlope,
    weeklyLoss,
    sampleSize: weightDays.length,
    spanDays,
    confidence: projectionConfidence(confidenceScore),
    confidenceScore,
    rangeLow: Math.max(0, maintenance - uncertainty),
    rangeHigh: maintenance + uncertainty,
    method: 'Estimated from recency-weighted effective intake plus endpoint scale change across the full span.'
  };
}

function tdeeEnsembleProfile(days = allDays, recentWindow = 28) {
  const filtered = estimateTDEEProfile(days);
  const endpoint = endpointTDEEProfile(days);
  const recentSlice = days.slice(-Math.min(recentWindow, days.length));
  const recent = recentSlice.length >= 10 ? estimateTDEEProfile(recentSlice) : filtered;
  const candidates = [filtered, endpoint, recent].filter(Boolean);
  const low = Math.round(Math.min(...candidates.map(profile => profile.maintenance)));
  const high = Math.round(Math.max(...candidates.map(profile => profile.maintenance)));
  const working = Math.round((filtered.maintenance * 0.5) + (endpoint.maintenance * 0.3) + (recent.maintenance * 0.2));
  return {
    working,
    rangeLow: low,
    rangeHigh: high,
    filtered,
    endpoint,
    recent
  };
}

function latestHistoricalBayesDate() {
  const gp = window.dashboardData?.bayesian?.gpWeightTrend;
  if (!Array.isArray(gp) || !gp.length) return null;
  const historical = gp.filter(point => !point.forecast);
  return historical.length ? historical[historical.length - 1].date : null;
}

function isWholeAnalyticsRange(days = allDays) {
  const analyticsDays = getAnalyticsDays();
  if (!analyticsDays.length || days.length !== analyticsDays.length) return false;
  return days[0]?.date === analyticsDays[0]?.date && days[days.length - 1]?.date === analyticsDays[analyticsDays.length - 1]?.date;
}

function freshBayesianPosterior(days = allDays) {
  if (!isWholeAnalyticsRange(days)) return null;
  const posterior = window.dashboardData?.bayesian?.tdeePosterior;
  const latestBayesDate = latestHistoricalBayesDate();
  const latestAnalyticsDate = getAnalyticsDays().at(-1)?.date || null;
  if (!posterior || !latestBayesDate || latestBayesDate !== latestAnalyticsDate) return null;
  return posterior;
}

function workingTDEEProfile(days = allDays) {
  const bayes = freshBayesianPosterior(days);
  if (bayes) {
    return {
      maintenance: bayes.mean,
      weightedIntake: null,
      dailySlope: null,
      weeklyLoss: null,
      sampleSize: bayes.nObs,
      spanDays: getAnalyticsDays(days).length,
      confidence: projectionConfidence(0.82),
      confidenceScore: 0.82,
      rangeLow: bayes.ci68Low,
      rangeHigh: bayes.ci68High,
      method: 'Bayesian posterior from full-range weight-change intervals and step-adjusted intake.',
      source: 'bayesian',
      posterior: bayes
    };
  }
  const endpoint = endpointTDEEProfile(days);
  return { ...endpoint, source: 'endpoint' };
}

function observedWeightProjection(days, horizonDays = 30) {
  const weightDays = days.filter(d => d.weight);
  const trendPoints = stateSpaceWeightTrendPoints(days);
  if (trendPoints.length < 2) return null;
  const latestPoint = trendPoints[trendPoints.length - 1];
  const startPoint = trendPoints[0];
  const spanDays = Math.max(1, Math.round(latestPoint.dayOffset));
  const recentVelocity = weightedAverage(
    trendPoints.slice(1).map(point => point.trendVelocity),
    recencyWeights(Math.max(trendPoints.length - 1, 1), 0.85, 1.45)
  ) ?? latestPoint.trendVelocity ?? 0;
  const innovations = trendPoints.slice(1).map(point => point.innovation).filter(v => Number.isFinite(v));
  const residualStdDev = innovations.length
    ? Math.sqrt(innovations.reduce((sum, value) => sum + (value ** 2), 0) / innovations.length)
    : null;
  const xArr = trendPoints.map(point => point.dayOffset);
  const yArr = trendPoints.map(point => point.trendWeight);
  const weights = recencyWeights(trendPoints.length, 0.85, 1.45);
  const reg = weightedLinearRegression(xArr, yArr, weights);
  const fit = regressionFitStats(xArr, yArr, reg, weights);
  const confidenceScore = Math.max(
    0.24,
    Math.min(
      0.97,
      (Math.min(trendPoints.length, 12) / 12) * 0.34 +
      (Math.min(spanDays, 56) / 56) * 0.28 +
      Math.max(0, 1 - ((residualStdDev || fit.residualStdDev || 0) / 2.1)) * 0.22 +
      (fit.r2 || 0) * 0.16
    )
  );
  return {
    latestWeight: weightDays[weightDays.length - 1]?.weight ?? latestPoint.rawWeight,
    latestFitted: latestPoint.trendWeight,
    latestTrendWeight: latestPoint.trendWeight,
    startTrendWeight: startPoint.trendWeight,
    dailySlope: recentVelocity,
    spanDays,
    sampleSize: trendPoints.length,
    residualStdDev: residualStdDev ?? fit.residualStdDev,
    confidence: projectionConfidence(confidenceScore),
    confidenceScore,
    projectedDelta: recentVelocity * horizonDays,
    projectedWeight: latestPoint.trendWeight + (recentVelocity * horizonDays)
  };
}

function bodyFatTargetProjection(days, targetBfPct = 18) {
  const wp = observedWeightProjection(days, 1);
  if (!wp || !wp.dailySlope || wp.dailySlope >= 0) return null;
  const currentWeight = wp.latestTrendWeight;
  const current = estimateBodyCompAtWeight(currentWeight, days);
  if (current.bodyFatPct <= targetBfPct) return { daysToTarget: 0, targetWeight: current.weight, currentBfPct: current.bodyFatPct, targetBfPct, confidence: wp.confidence };
  // Binary search for the weight at which BF% hits target
  let lo = 100, hi = currentWeight;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const est = estimateBodyCompAtWeight(mid, days);
    if (est.bodyFatPct > targetBfPct) hi = mid; else lo = mid;
  }
  const targetWeight = (lo + hi) / 2;
  const weightToDrop = currentWeight - targetWeight;
  const daysToTarget = Math.ceil(weightToDrop / Math.abs(wp.dailySlope));
  return {
    daysToTarget,
    targetWeight,
    currentBfPct: current.bodyFatPct,
    targetBfPct,
    currentWeight,
    dailySlope: wp.dailySlope,
    confidence: wp.confidence
  };
}

function deficitProjection(days, horizonDays = 30) {
  if (!days.length) return null;
  const rangeTdee = workingTDEEProfile(days).maintenance;
  const avgDeficit = avgOrNull(days.map(d => ({ v: rangeTdee - effectiveCalories(d) })), 'v');
  if (avgDeficit == null) return null;
  return {
    avgDeficit,
    confidence: projectionConfidence(Math.min(1, days.length / 28)),
    projectedLoss: (avgDeficit * horizonDays) / 3500
  };
}

function sleepTargetProjection(sleep, horizonNights = 14) {
  if (!sleep.length) return null;
  const hitRate = pct(sleep.filter(d => d.perf >= goals.sleepPerf).length, sleep.length);
  return {
    avgPerf: avgOrNull(sleep, 'perf'),
    hitRate,
    horizonNights,
    confidence: projectionConfidence(Math.min(1, sleep.length / 21)),
    expectedHits: Math.round((hitRate / 100) * horizonNights)
  };
}

function topAssociatedFoods(days, predicate, limit = 3) {
  if (!days.length) return [];
  const subset = days.filter(predicate);
  if (!subset.length) return [];
  const overallCounts = new Map();
  const subsetCounts = new Map();
  days.forEach(day => {
    foodsForDay(day).forEach(food => overallCounts.set(food, (overallCounts.get(food) || 0) + 1));
  });
  subset.forEach(day => {
    foodsForDay(day).forEach(food => subsetCounts.set(food, (subsetCounts.get(food) || 0) + 1));
  });
  return [...subsetCounts.entries()]
    .map(([food, subsetCount]) => {
      const overallCount = overallCounts.get(food) || 0;
      const subsetRate = subsetCount / subset.length;
      const overallRate = overallCount / days.length;
      return { food, subsetCount, overallCount, lift: subsetRate - overallRate, subsetRate, overallRate };
    })
    .filter(item => item.subsetCount >= 2 && item.lift > 0)
    .sort((a, b) => (b.lift - a.lift) || (b.subsetCount - a.subsetCount))
    .slice(0, limit)
    .map(item => ({
      ...item,
      liftPoints: Math.round(item.lift * 100)
    }));
}

function formatFoodAssoc(item) {
  return `${item.food} (+${item.liftPoints}pp, n=${item.subsetCount})`;
}

function foodPatternSummary(days) {
  const onTrack = days.filter(d => d.calories <= goals.calories && hitProteinFloor(d) && !d.drinks);
  const overTarget = days.filter(d => d.calories > goals.calories);
  const poorNextSleepDays = days.filter(d => {
    const nextSleep = sleepByDate[nextDayStr(d.date)];
    return nextSleep && nextSleep.perf < goals.sleepPerf;
  });
  const strongProteinDays = days.filter(d => hitProteinFloor(d));
  return {
    onTrackFoods: topAssociatedFoods(days, d => onTrack.includes(d)),
    overTargetFoods: topAssociatedFoods(days, d => overTarget.includes(d)),
    poorNextSleepFoods: topAssociatedFoods(days, d => poorNextSleepDays.includes(d)),
    strongProteinFoods: topAssociatedFoods(days, d => strongProteinDays.includes(d)),
    stapleFoods: topFoodsForDays(days),
    onTrackCount: onTrack.length,
    overTargetCount: overTarget.length,
    poorNextSleepCount: poorNextSleepDays.length,
    strongProteinCount: strongProteinDays.length
  };
}

function getLagMetrics(days, sleep) {
  const afterDrink = [];
  const afterClean = [];
  sleep.forEach(day => (drinkDates.has(prevDay(day.date)) ? afterDrink : afterClean).push(day.perf));
  const afterDrinkAvg = avgOrNull(afterDrink.map(v => ({ v })), 'v');
  const afterCleanAvg = avgOrNull(afterClean.map(v => ({ v })), 'v');
  const poorSleepPairs = sleep.map(day => {
    const nextMacro = macroByDate[nextDayStr(day.date)];
    return nextMacro ? { perf: day.perf, intake: effectiveCalories(nextMacro) } : null;
  }).filter(Boolean);
  const poorSleepDays = poorSleepPairs.filter(pair => pair.perf < goals.sleepPerf);
  const goodSleepDays = poorSleepPairs.filter(pair => pair.perf >= goals.sleepPerf);
  const poorSleepNextDayAvg = avgOrNull(poorSleepDays.map(pair => ({ v: pair.intake })), 'v');
  const goodSleepNextDayAvg = avgOrNull(goodSleepDays.map(pair => ({ v: pair.intake })), 'v');
  const nextDayCalCorr = pearson(poorSleepPairs.map(pair => pair.perf), poorSleepPairs.map(pair => pair.intake));
  const bedtimeCorr = pearson(sleep.map(normalizedBedtimeHour), sleep.map(day => day.perf));
  const nextDayWeightMoves = days.map((day, idx) => {
    if (idx >= days.length - 1 || day.weight == null || days[idx + 1].weight == null) return null;
    return { lift: day.lifting === 'Y', delta: days[idx + 1].weight - day.weight };
  }).filter(Boolean);
  const liftFollowUps = nextDayWeightMoves.filter(move => move.lift).map(move => move.delta);
  const restFollowUps = nextDayWeightMoves.filter(move => !move.lift).map(move => move.delta);
  const liftNextDayWeightAvg = avgOrNull(liftFollowUps.map(v => ({ v })), 'v');
  const restNextDayWeightAvg = avgOrNull(restFollowUps.map(v => ({ v })), 'v');
  return {
    afterDrinkCount: afterDrink.length,
    afterCleanCount: afterClean.length,
    afterDrinkAvg,
    afterCleanAvg,
    drinkSleepGap: afterDrinkAvg != null && afterCleanAvg != null ? afterCleanAvg - afterDrinkAvg : null,
    bedtimeCorr,
    nextDayCalCorr,
    poorSleepNextDayAvg,
    goodSleepNextDayAvg,
    poorSleepNextDayGap: poorSleepNextDayAvg != null && goodSleepNextDayAvg != null ? poorSleepNextDayAvg - goodSleepNextDayAvg : null,
    nextDayCalSample: poorSleepPairs.length,
    liftNextDayWeightAvg,
    restNextDayWeightAvg,
    liftNextDayWeightGap: liftNextDayWeightAvg != null && restNextDayWeightAvg != null ? liftNextDayWeightAvg - restNextDayWeightAvg : null,
    liftWeightSample: nextDayWeightMoves.length
  };
}

function plateauNoiseAssessment(days, sleep) {
  const trend = weightTrendReality(days);
  const decomp = trendDecomposition(days);
  const lag = getLagMetrics(days, sleep);
  if (trend.expectedLoss == null || trend.actualLoss == null) {
    return {
      status: 'unclear',
      cls: 'warn',
      title: 'Not enough weight signal yet',
      text: 'Need at least two weigh-ins in this range before the dashboard can separate true plateau risk from normal water noise.'
    };
  }
  const expectedLoss = trend.expectedLoss;
  const actualLoss = trend.actualLoss;
  const residualAbs = Math.abs(decomp?.residual ?? 0);
  const shortfall = expectedLoss - actualLoss;
  if (expectedLoss <= 0.5) {
    return {
      status: 'small_signal',
      cls: 'warn',
      title: 'The deficit signal is still small',
      text: `The logged deficit only implies about ${weightLabel(Math.abs(expectedLoss))} of movement in this range, so flat scale action can still be normal noise.`
    };
  }
  if (actualLoss >= expectedLoss * 0.7) {
    return {
      status: 'on_track',
      cls: 'good',
      title: 'This does not look like a real plateau',
      text: `The filtered scale trend is showing ${weightLabel(Math.abs(actualLoss))} of loss versus ${weightLabel(Math.abs(expectedLoss))} implied by the logged deficit, which is close enough to be on-track.`
    };
  }
  if (
    residualAbs >= 0.8 ||
    (lag.drinkSleepGap ?? 0) >= 10 ||
    (lag.liftNextDayWeightGap ?? 0) >= 0.35
  ) {
    return {
      status: 'noise',
      cls: 'warn',
      title: 'This looks more like noise than a true stall',
      text: `The scale is lagging the logged deficit by ${weightLabel(Math.abs(shortfall))}, but residual non-fat movement is still ${weightLabel(residualAbs)}. Recovery and training noise are likely masking part of the fat-loss signal.`
    };
  }
  return {
    status: 'plateau',
    cls: 'bad',
    title: 'This may be a real plateau signal',
    text: `The logged deficit implies about ${weightLabel(Math.abs(expectedLoss))} of loss, but the filtered trend only shows ${weightLabel(Math.abs(actualLoss))} and there is not much residual noise left to explain the gap.`
  };
}

function getDriverRanking(days, sleep) {
  const lag = getLagMetrics(days, sleep);
  const liftDays = days.filter(d => d.lifting === 'Y');
  const restDays = days.filter(d => d.lifting !== 'Y');
  const liftProteinDiff = (avgOrNull(liftDays, 'protein') ?? 0) - (avgOrNull(restDays, 'protein') ?? 0);
  return [
    {
      title: 'Alcohol has the biggest direct sleep penalty',
      score: Math.abs(lag.drinkSleepGap ?? 0),
      text: `${lag.afterDrinkAvg?.toFixed(1) ?? '—'}% on drink-following mornings vs ${lag.afterCleanAvg?.toFixed(1) ?? '—'}% after clean nights`,
      sample: `n=${lag.afterDrinkCount} drink-following mornings / ${lag.afterCleanCount} clean mornings`
    },
    {
      title: 'Later bedtimes strongly drag sleep quality',
      score: Math.abs(lag.bedtimeCorr),
      text: `r=${lag.bedtimeCorr.toFixed(2)} between normalized bedtime and same-night sleep performance`,
      sample: `n=${sleep.length}`
    },
    {
      title: 'Poor sleep predicts higher next-day calories',
      score: Math.abs(lag.poorSleepNextDayGap ?? lag.nextDayCalCorr ?? 0),
      text: lag.poorSleepNextDayGap != null
        ? `${energyLabel(lag.poorSleepNextDayAvg)} after poor sleep vs ${energyLabel(lag.goodSleepNextDayAvg)} after good sleep`
        : `r=${lag.nextDayCalCorr.toFixed(2)} between sleep performance and next-day calorie intake`,
      sample: `n=${lag.nextDayCalSample}`
    },
    {
      title: 'Lift days change fueling behavior',
      score: Math.abs(liftProteinDiff),
      text: `${liftProteinDiff >= 0 ? '+' : ''}${liftProteinDiff.toFixed(0)}g protein on lift days vs rest days`,
      sample: `n=${liftDays.length} lift / ${restDays.length} rest`
    }
  ].sort((a, b) => b.score - a.score);
}

function getOutliers(days, sleep) {
  const highCal = days.reduce((a, b) => (a.calories > b.calories ? a : b));
  const lowSleep = sleep.length ? sleep.reduce((a, b) => (a.perf < b.perf ? a : b)) : null;
  const highProtein = days.reduce((a, b) => (a.protein > b.protein ? a : b));
  const biggestWeightDrop = days.filter(d => d.weight).map((d, idx, arr) => {
    if (!idx) return null;
    return { date: d.date, delta: d.weight - arr[idx - 1].weight };
  }).filter(Boolean).sort((a, b) => a.delta - b.delta)[0];
  return { highCal, lowSleep, highProtein, biggestWeightDrop };
}

function getWeekdayPatternText(sleep) {
  const averages = dayOfWeekAverages(sleep);
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const best = averages.indexOf(Math.max(...averages));
  const valid = averages.map((v, i) => ({ v, i })).filter(x => x.v > 0);
  const worst = valid.length ? valid.sort((a, b) => a.v - b.v)[0].i : 0;
  return `${labels[best]} is strongest at ${averages[best].toFixed(1)}%; ${labels[worst]} is weakest at ${averages[worst].toFixed(1)}%.`;
}

function recommendationList(current, previous, days, sleep) {
  const recs = [];
  const lag = getLagMetrics(days, sleep);
  const drinkGap = lag.drinkSleepGap ?? 0;
  const trendReality = weightTrendReality(days);
  const plateau = plateauNoiseAssessment(days, sleep);
  if (drinkGap > 15 && current.drinkNights > 0) recs.push({ title: 'Cut drink nights first', text: `They are costing roughly ${drinkGap.toFixed(1)} sleep-performance points the next morning.` });
  if (current.bedtimeHitRate < 45) recs.push({ title: 'Move bedtime earlier', text: `Bedtime goal hit rate is only ${current.bedtimeHitRate.toFixed(0)}%, which is likely suppressing recovery more than calories are.` });
  if (current.proteinHitRate < 70) recs.push({ title: 'Protect protein before cutting calories harder', text: `Protein goal hit rate is ${current.proteinHitRate.toFixed(0)}%; fixing that will make the cut more stable.` });
  if ((current.avgCalories ?? 0) <= goals.calories && (current.weightChange ?? 0) >= 0 && previous.daysCount) recs.push({ title: 'Do not cut deeper yet', text: 'The range is light on weight signal despite decent calorie adherence. Keep the plan stable and reduce noise first.' });
  if ((current.avgSleepPerf ?? 0) < goals.sleepPerf && current.avgCalories && current.avgCalories > goals.calories) recs.push({ title: 'Treat sleep as an intake-control lever', text: 'Poor sleep and calorie creep are showing up together. Sleep is not secondary here.' });
  if ((trendReality.expectedLoss ?? 0) > 1 && (trendReality.actualLoss ?? 0) < ((trendReality.expectedLoss ?? 0) * 0.5)) recs.push({ title: 'The scale is lagging the math', text: `Expected loss is about ${weightValue(trendReality.expectedLoss)} ${weightUnit()} but the scale only shows ${weightValue(trendReality.actualLoss || 0)} ${weightUnit()}. Keep the plan stable and reduce water-weight noise.` });
  if (plateau.status === 'plateau') recs.push({ title: 'Sanity-check maintenance and intake accuracy', text: 'The filtered scale trend is underperforming the logged deficit without much residual noise left. This is the point to recheck maintenance and calorie logging, not just cut harder automatically.' });
  if (!recs.length) recs.push({ title: 'Stay consistent with the current setup', text: 'The range looks broadly on-track. Keep alcohol low, protein high, and bedtime steady.' });
  return recs.slice(0, 4);
}
