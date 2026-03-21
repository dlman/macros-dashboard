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

const { data, sleepData } = window.dashboardData;



// =====================================================================
// COMPUTED DATA & HELPERS
// =====================================================================
// Flatten all days
const allDays = [...data.Jan, ...data.Feb, ...data.March];
const allDates = allDays.map(d => d.date);
const macroByDate = {};
allDays.forEach(d => { macroByDate[d.date] = d; });
const sleepByDate = {};
sleepData.forEach(d => { sleepByDate[d.date] = d; });
const drinkDates = new Set(allDays.filter(d => d.drinks).map(d => d.date));
const liftDates = new Set(allDays.filter(d => d.lifting === 'Y').map(d => d.date));

function prevDay(dateStr) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }
function nextDayStr(dateStr) { const d = new Date(dateStr + 'T12:00:00'); d.setDate(d.getDate()+1); return d.toISOString().slice(0,10); }
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
  const prev = prevDay(sleepDay.date);
  const drinkPenalty = drinkDates.has(prev) ? 0 : 100;
  const respNorm = Math.max(0, Math.min(100, (20 - sleepDay.resp) / (20 - 13) * 100));
  return Math.round(recoveryWeights.sleep * sleepDay.perf + recoveryWeights.efficiency * sleepDay.efficiency + recoveryWeights.resp * respNorm + recoveryWeights.drink * drinkPenalty);
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

// Body composition estimate anchored to the Jan 6, 2026 DXA scan.
function bodyCompEstimate(days = allDays) {
  const weightDays = days.filter(d => d.weight);
  const scanDay = macroByDate[DXA_SCAN.date];
  const includeScan = isDateInRange(DXA_SCAN.date) && (!scanDay || matchesDayEvent(scanDay));
  if (!weightDays.length && !includeScan) return [];
  const points = weightDays.map((d) => ({ date: d.date, ...estimateBodyCompAtWeight(d.weight, days) }));
  if (includeScan) {
    points.push({
      date: DXA_SCAN.date,
      weight: DXA_SCAN.totalMass,
      lean: DXA_SCAN.leanMass,
      fat: DXA_FAT_MASS,
      bodyFatPct: DXA_SCAN.bodyFatPct,
      measured: true
    });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

// Sleep debt
function sleepDebt(days = sleepData) {
  let cumDebt = 0;
  return days.map(d => {
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

function latestWeightForScenario(days = allDays) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length) return weightDays[weightDays.length - 1].weight;
  const fallback = [...allDays].reverse().find(d => d.weight);
  return fallback ? fallback.weight : 162;
}

// What-if calculation
function calculateWhatIf(dailyCal, weeks, avgSleep, drinkNightsPerWeek = 0, days = allDays, sleep = sleepData) {
  const currentWeight = latestWeightForScenario(days);
  const tdee = estimatedTDEE;
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
  const weights = Array.from({ length: weeks + 1 }, (_, week) => {
    const projected = projection.currentWeight - ((projection.effectiveDeficit * 7 * week) / 3500);
    return projected;
  });
  const bodyComp = weights.map(weight => estimateBodyCompAtWeight(weight, days));
  return {
    label,
    values,
    projection,
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

// Date range state
let rangeStartIdx = 0;
let rangeEndIdx = allDates.length - 1;
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

function expectedWeightLoss(days) {
  if (!days.length) return null;
  return days.reduce((sum, d) => sum + (estimatedTDEE - effectiveCalories(d)), 0) / 3500;
}

function weightTrendReality(days) {
  const expectedLoss = expectedWeightLoss(days);
  const actualLoss = actualWeightLoss(days);
  const gap = expectedLoss != null && actualLoss != null ? actualLoss - expectedLoss : null;
  const efficiency = expectedLoss && actualLoss != null ? (actualLoss / expectedLoss) * 100 : null;
  return { expectedLoss, actualLoss, gap, efficiency };
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
  const scaleLoss = weightDays[0].weight - weightDays[weightDays.length - 1].weight;
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
    daySpan: Math.max(1, Math.round((new Date(weightDays[weightDays.length - 1].date + 'T12:00:00') - new Date(weightDays[0].date + 'T12:00:00')) / 86400000))
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
  return {
    current: { calories: Math.round(avgCalories / 25) * 25, weeks: 4, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
    maintain: { calories: Math.round(estimatedTDEE / 25) * 25, weeks: 4, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
    mild_cut: { calories: Math.round((estimatedTDEE - 350) / 25) * 25, weeks: 6, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
    aggressive_cut: { calories: Math.round((estimatedTDEE - 650) / 25) * 25, weeks: 4, sleep: +avgSleep.toFixed(1), drinks: drinkPerWeek },
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
  const labels = Array.from({ length: weeks + 1 }, (_, week) => week === 0 ? 'Now' : `Week ${week}`);
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

  chart.data.labels = labels;
  chart.data.datasets = [
    ...(!isCurrentEquivalent ? [{
      label: currentSeries.label,
      data: currentSeries.data,
      bodyFatPcts: currentSeries.bodyComp.map(point => point.bodyFatPct),
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
    const bfText = Number.isFinite(bfPct) ? ` · ~${bfPct.toFixed(1)}% BF` : '';
    return `${ctx.dataset.label}: ${ctx.parsed.y} ${weightUnit()}${bfText}`;
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

function observedWeightProjection(days, horizonDays = 30) {
  const weightDays = days.filter(d => d.weight);
  if (weightDays.length < 2) return null;
  const first = weightDays[0];
  const last = weightDays[weightDays.length - 1];
  const spanDays = Math.max(1, Math.round((new Date(last.date + 'T12:00:00') - new Date(first.date + 'T12:00:00')) / (1000 * 60 * 60 * 24)));
  const dailySlope = (last.weight - first.weight) / spanDays;
  return {
    latestWeight: last.weight,
    dailySlope,
    spanDays,
    sampleSize: weightDays.length,
    confidence: projectionConfidence(Math.min(1, (weightDays.length / 8) * 0.45 + (spanDays / 30) * 0.55)),
    projectedDelta: dailySlope * horizonDays,
    projectedWeight: last.weight + (dailySlope * horizonDays)
  };
}

function deficitProjection(days, horizonDays = 30) {
  if (!days.length) return null;
  const avgDeficit = avgOrNull(days.map(d => ({ v: estimatedTDEE - effectiveCalories(d) })), 'v');
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

function getDriverRanking(days, sleep) {
  const afterDrink = [];
  const afterClean = [];
  sleep.forEach(d => (drinkDates.has(prevDay(d.date)) ? afterDrink : afterClean).push(d.perf));
  const afterDrinkAvg = avgOrNull(afterDrink.map(v => ({ v })), 'v');
  const afterCleanAvg = avgOrNull(afterClean.map(v => ({ v })), 'v');
  const bedtimeCorr = pearson(sleep.map(normalizedBedtimeHour), sleep.map(d => d.perf));
  const sleepVsNextDayCalories = sleep.map(d => {
    const nextMacro = macroByDate[nextDayStr(d.date)];
    return nextMacro ? { x: d.perf, y: nextMacro.calories } : null;
  }).filter(Boolean);
  const nextDayCalCorr = pearson(sleepVsNextDayCalories.map(p => p.x), sleepVsNextDayCalories.map(p => p.y));
  const liftDays = days.filter(d => d.lifting === 'Y');
  const restDays = days.filter(d => d.lifting !== 'Y');
  const liftProteinDiff = (avgOrNull(liftDays, 'protein') ?? 0) - (avgOrNull(restDays, 'protein') ?? 0);
  return [
    {
      title: 'Alcohol has the biggest direct sleep penalty',
      score: Math.abs((afterDrinkAvg ?? 0) - (afterCleanAvg ?? 0)),
      text: `${afterDrinkAvg?.toFixed(1) ?? '—'}% after drink nights vs ${afterCleanAvg?.toFixed(1) ?? '—'}% after clean nights`,
      sample: `n=${afterDrink.length} drink-following mornings / ${afterClean.length} clean mornings`
    },
    {
      title: 'Later bedtimes strongly drag sleep quality',
      score: Math.abs(bedtimeCorr),
      text: `r=${bedtimeCorr.toFixed(2)} between normalized bedtime and same-night sleep performance`,
      sample: `n=${sleep.length}`
    },
    {
      title: 'Poor sleep predicts higher next-day calories',
      score: Math.abs(nextDayCalCorr),
      text: `r=${nextDayCalCorr.toFixed(2)} between sleep performance and next-day calorie intake`,
      sample: `n=${sleepVsNextDayCalories.length}`
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
  const afterDrink = sleep.filter(d => drinkDates.has(prevDay(d.date))).map(d => d.perf);
  const cleanSleep = sleep.filter(d => !drinkDates.has(prevDay(d.date))).map(d => d.perf);
  const drinkGap = (cleanSleep.length ? avgOrNull(cleanSleep.map(v => ({ v })), 'v') : 0) - (afterDrink.length ? avgOrNull(afterDrink.map(v => ({ v })), 'v') : 0);
  const trendReality = weightTrendReality(days);
  if (drinkGap > 15 && current.drinkNights > 0) recs.push({ title: 'Cut drink nights first', text: `They are costing roughly ${drinkGap.toFixed(1)} sleep-performance points the next morning.` });
  if (current.bedtimeHitRate < 45) recs.push({ title: 'Move bedtime earlier', text: `Bedtime goal hit rate is only ${current.bedtimeHitRate.toFixed(0)}%, which is likely suppressing recovery more than calories are.` });
  if (current.proteinHitRate < 70) recs.push({ title: 'Protect protein before cutting calories harder', text: `Protein goal hit rate is ${current.proteinHitRate.toFixed(0)}%; fixing that will make the cut more stable.` });
  if ((current.avgCalories ?? 0) <= goals.calories && (current.weightChange ?? 0) >= 0 && previous.daysCount) recs.push({ title: 'Do not cut deeper yet', text: 'The range is light on weight signal despite decent calorie adherence. Keep the plan stable and reduce noise first.' });
  if ((current.avgSleepPerf ?? 0) < goals.sleepPerf && current.avgCalories && current.avgCalories > goals.calories) recs.push({ title: 'Treat sleep as an intake-control lever', text: 'Poor sleep and calorie creep are showing up together. Sleep is not secondary here.' });
  if ((trendReality.expectedLoss ?? 0) > 1 && (trendReality.actualLoss ?? 0) < ((trendReality.expectedLoss ?? 0) * 0.5)) recs.push({ title: 'The scale is lagging the math', text: `Expected loss is about ${weightValue(trendReality.expectedLoss)} ${weightUnit()} but the scale only shows ${weightValue(trendReality.actualLoss || 0)} ${weightUnit()}. Keep the plan stable and reduce water-weight noise.` });
  if (!recs.length) recs.push({ title: 'Stay consistent with the current setup', text: 'The range looks broadly on-track. Keep alcohol low, protein high, and bedtime steady.' });
  return recs.slice(0, 4);
}
