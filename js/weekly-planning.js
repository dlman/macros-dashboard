// Calendar-based planning calculations, shared by the dashboard and regression tests.
(function(root) {
  'use strict';
  const DAY = 86400000;
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const shift = (date, offset) => new Date(Date.parse(`${date}T12:00:00Z`) + offset * DAY).toISOString().slice(0, 10);
  const dates = (start, count) => Array.from({ length: count }, (_, index) => shift(start, index));
  const hasFood = day => finite(day?.calories) && day.calories > 0;

  function weekStart(today) {
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    return shift(today, -((weekday + 6) % 7));
  }

  function planWeek({ today, days, drafts = {}, foodGoal = 2100, maintenance, baselineSteps, kcalPerStep = 0.04 }) {
    const start = weekStart(today);
    const byDate = new Map(days.map(day => [day.date, day]));
    const modelReady = finite(maintenance?.mean) && finite(baselineSteps);
    const rows = dates(start, 7).map(date => {
      const day = byDate.get(date);
      const draft = drafts[date] || {};
      const past = date < today;
      const logged = past && hasFood(day);
      const isToday = date === today;
      const foodSoFar = isToday && hasFood(day) ? day.calories : 0;
      const drinksSoFar = isToday && finite(day?.drinkCalories) ? day.drinkCalories : 0;
      const stepSoFar = isToday && finite(day?.steps) ? day.steps : 0;
      const defaultFood = past ? null : Math.max(foodGoal, foodSoFar);
      const food = logged ? day.calories : (draft.food === undefined ? defaultFood : draft.food);
      const drinkCount = draft.drinkCount === undefined ? 0 : draft.drinkCount;
      const drinkRate = finite(draft.drinkRate) ? draft.drinkRate : 110;
      const alcoholKnown = logged || !past || finite(draft.drinkCount);
      const alcohol = logged ? (day.drinkCalories || 0)
        : alcoholKnown && finite(drinkCount) ? drinksSoFar + drinkCount * drinkRate : null;
      const recordedSteps = past && finite(day?.steps) ? day.steps : null;
      const stepInput = recordedSteps ?? draft.steps ?? null;
      const stepsAssumed = stepInput === null;
      const steps = stepsAssumed ? (modelReady ? Math.max(baselineSteps, stepSoFar) : null) : stepInput;
      const errors = [];
      if (!finite(food) || food < 0 || food > 10000) errors.push(past ? 'Add missing food estimate' : 'Enter full-day food calories');
      if (isToday && food < foodSoFar) errors.push('Food plan is below already logged food');
      if (!finite(alcohol) || alcohol < 0 || alcohol > 10000) errors.push('Add drink count (0 if none)');
      if (!finite(steps) || steps < stepSoFar || steps < 0 || steps > 100000) errors.push('Enter valid full-day steps');
      const burn = modelReady && finite(steps) ? maintenance.mean + (steps - baselineSteps) * kcalPerStep : null;
      const intake = !errors.length ? food + alcohol : null;
      return {
        date, past, logged, isToday, excluded: !!day?.excluded, food, alcohol, drinkCount, drinkRate,
        foodSoFar, drinksSoFar, steps, stepInput, recordedSteps, stepsAssumed, errors, intake, burn,
        deficit: intake !== null && burn !== null ? burn - intake : null
      };
    });
    const sum = (subset, key) => subset.reduce((total, row) => total + (row[key] || 0), 0);
    const complete = modelReady && rows.every(row => row.deficit !== null);
    const loggedRows = rows.filter(row => row.logged);
    const loggedComplete = modelReady && loggedRows.length > 0 && loggedRows.every(row => row.deficit !== null);
    const remainingRows = rows.filter(row => !row.past);
    const remainingComplete = modelReady && remainingRows.every(row => row.deficit !== null);
    const totalDeficit = complete ? sum(rows, 'deficit') : null;
    const uncertainty = finite(maintenance?.low) && finite(maintenance?.high) ? {
      low: complete ? totalDeficit + (maintenance.low - maintenance.mean) * 7 : null,
      high: complete ? totalDeficit + (maintenance.high - maintenance.mean) * 7 : null
    } : null;
    return {
      start, end: shift(start, 6), rows, complete, totalDeficit, uncertainty,
      loggedDays: loggedRows.length,
      loggedDeficit: loggedComplete ? sum(loggedRows, 'deficit') : null,
      remainingDeficit: remainingComplete ? sum(remainingRows, 'deficit') : null,
      totalFood: complete ? sum(rows, 'food') : null,
      totalAlcohol: complete ? sum(rows, 'alcohol') : null,
      totalBurn: complete ? sum(rows, 'burn') : null,
      assumedStepDays: rows.filter(row => row.stepsAssumed).length,
      estimatedPastDays: rows.filter(row => row.past && !row.logged).length
    };
  }

  function periodPace(rows) {
    if (rows.some(row => row.excluded)) return null;
    const first = rows.slice(0, 7).map((row, index) => ({ row, index })).filter(({ row }) => finite(row.weight) && row.weight > 0);
    const last = rows.slice(-7).map((row, index) => ({ row, index: rows.length - 7 + index })).filter(({ row }) => finite(row.weight) && row.weight > 0);
    if (first.length < 4 || last.length < 4) return null;
    const elapsed = mean(last.map(point => point.index)) - mean(first.map(point => point.index));
    if (elapsed <= 0) return null;
    return (mean(last.map(point => point.row.weight)) - mean(first.map(point => point.row.weight))) * 7 / elapsed;
  }

  function progressChanges({ endDate, days, windowDays = 14, kcalPerStep = 0.04 }) {
    const length = windowDays === 28 ? 28 : 14;
    const byDate = new Map(days.map(day => [day.date, day]));
    const priorStart = shift(endDate, -(2 * length - 1));
    const rows = dates(priorStart, 2 * length).map(date => ({ date, ...byDate.get(date) }));
    const prior = rows.slice(0, length);
    const current = rows.slice(length);
    // Pair equivalent weekdays so missing logs cannot change the weekday mix.
    const eligiblePairs = current.map((row, index) => [prior[index], row]).filter(pair => pair.every(day => !day.excluded));
    const foodPairs = eligiblePairs.filter(pair => pair.every(hasFood));
    const stepPairs = eligiblePairs.filter(pair => pair.every(day => finite(day.steps)));
    const minimum = Math.ceil(length * 0.8);
    const foodReady = foodPairs.length >= minimum;
    const stepsReady = stepPairs.length >= minimum;
    function metric(pairs, key, ready, multiplier) {
      const before = mean(pairs.map(pair => pair[0][key] ?? 0));
      const after = mean(pairs.map(pair => pair[1][key] ?? 0));
      return { before, after, delta: before === null ? null : after - before, count: pairs.length,
        impact: ready ? (after - before) * multiplier : null };
    }
    const food = metric(foodPairs, 'calories', foodReady, -1);
    const alcohol = metric(foodPairs, 'drinkCalories', foodReady, -1);
    const steps = metric(stepPairs, 'steps', stepsReady, kcalPerStep);
    const priorPace = periodPace(prior);
    const currentPace = periodPace(current);
    const observedChange = priorPace !== null && currentPace !== null ? currentPace - priorPace : null;
    const intakeImpact = foodReady ? food.impact + alcohol.impact : null;
    const combinedImpact = foodReady && stepsReady ? intakeImpact + steps.impact : null;
    const impliedPaceChange = combinedImpact === null ? null : -combinedImpact / 500;
    return {
      length, priorStart, priorEnd: prior.at(-1).date, currentStart: current[0].date, endDate,
      food, alcohol, steps, foodReady, stepsReady, intakeImpact, combinedImpact,
      priorPace, currentPace, observedChange, impliedPaceChange,
      unexplainedChange: impliedPaceChange !== null && observedChange !== null ? observedChange - impliedPaceChange : null,
      priorCoverage: prior.filter(row => !row.excluded && hasFood(row)).length,
      currentCoverage: current.filter(row => !row.excluded && hasFood(row)).length,
      priorEligible: prior.filter(row => !row.excluded).length,
      currentEligible: current.filter(row => !row.excluded).length,
      excludedDays: rows.filter(row => row.excluded).length,
      creatineChange: mean(current.map(row => row.creatineWater || 0)) - mean(prior.map(row => row.creatineWater || 0))
    };
  }

  function successfulWeeks({ endDate, days, lookbackWeeks = 12 }) {
    const byDate = new Map(days.filter(day => day.date <= endDate).map(day => [day.date, day]));
    const latestStart = shift(weekStart(shift(endDate, 1)), -7);
    const firstDate = [...byDate.keys()].sort()[0] || endDate;
    const earliest = lookbackWeeks === 0 ? `${endDate.slice(0, 4)}-01-01` : shift(latestStart, -7 * (lookbackWeeks - 1));
    const rowsFor = start => dates(start, 7).map(date => ({ ...byDate.get(date), date }));
    function describe(start) {
      const rows = rowsFor(start);
      const food = rows.filter(hasFood);
      const weights = rows.filter(row => finite(row.weight) && row.weight > 0);
      const steps = rows.filter(row => finite(row.steps) && row.steps >= 0);
      const sleep = rows.filter(row => finite(row.sleepHours) && row.sleepHours > 0);
      // Unmarked lifting is null in the source; only a missing daily log is unknown.
      const events = rows.filter(hasFood);
      return {
        start, end: shift(start, 6), foodDays: food.length, weightDays: weights.length,
        stepDays: steps.length, sleepDays: sleep.length, eventDays: events.length,
        food: food.length === 7 ? mean(food.map(row => row.calories)) : null,
        alcohol: food.length === 7 ? mean(food.map(row => row.drinkCalories || 0)) : null,
        weight: weights.length >= 4 ? mean(weights.map(row => row.weight)) : null,
        steps: steps.length >= 5 ? mean(steps.map(row => row.steps)) : null,
        sleep: sleep.length >= 5 ? mean(sleep.map(row => row.sleepHours)) : null,
        lifts: events.length === 7 ? events.filter(row => row.lifting === 'Y').length : null,
        drinkNights: food.length === 7 ? food.filter(row => row.drinkCalories > 0).length : null,
        excluded: rows.some(row => row.excluded)
      };
    }
    const recent = describe(latestStart);
    const matches = [];
    const skipped = { pending: 0, vacation: 0, food: 0, weight: 0, creatine: 0, trend: 0 };
    let considered = 0;
    for (let start = latestStart; start >= earliest && start >= firstDate; start = shift(start, -7)) {
      considered++;
      const current = describe(start);
      const prior = describe(shift(start, -7));
      const next = describe(shift(start, 7));
      if (next.end > endDate) { skipped.pending++; continue; }
      if (prior.excluded || current.excluded || next.excluded) { skipped.vacation++; continue; }
      if (current.food === null) { skipped.food++; continue; }
      if ([prior, current, next].some(week => week.weight === null)) { skipped.weight++; continue; }
      const context = [...rowsFor(prior.start), ...rowsFor(start), ...rowsFor(next.start)];
      const creatine = context.map(row => row.creatineWater).filter(finite);
      if (creatine.length && Math.max(...creatine) - Math.min(...creatine) > 0.25) { skipped.creatine++; continue; }
      const change = current.weight - prior.weight;
      if (change > -0.2 + 1e-9 || next.weight > current.weight + 1e-9) { skipped.trend++; continue; }
      matches.push({ ...current, change, priorWeight: prior.weight, nextWeight: next.weight,
        priorWeightDays: prior.weightDays, nextWeightDays: next.weightDays });
    }
    // Rank food, not total intake: alcohol calories should not improve the ranking.
    matches.sort((a, b) => b.food - a.food || b.start.localeCompare(a.start));
    return { matches, recent, considered, skipped, earliest, endDate };
  }

  const api = { weekStart, shift, planWeek, progressChanges, successfulWeeks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WeeklyPlanning = api;
})(typeof window === 'undefined' ? globalThis : window);
