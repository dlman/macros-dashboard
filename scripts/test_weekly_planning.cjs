const assert = require('node:assert/strict');
const { test } = require('node:test');
const { weekStart, shift, planWeek, progressChanges } = require('../js/weekly-planning.js');

const settings = { today: '2026-09-04', days: [], foodGoal: 2000, maintenance: { mean: 2500, low: 2300, high: 2700 }, baselineSteps: 7000 };
const loggedDays = Array.from({ length: 4 }, (_, i) => ({ date: shift('2026-08-31', i), calories: 2000, drinkCalories: 0, steps: 7000 }));

test('week boundaries include Sunday and handle a year boundary', () => {
  assert.equal(weekStart('2026-09-06'), '2026-08-31');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(weekStart('2026-09-07'), '2026-09-07');
});

test('weekly totals reconcile without counting baseline steps as extra burn', () => {
  const plan = planWeek({ ...settings, days: loggedDays });
  assert.equal(plan.totalDeficit, 3500);
  assert.equal(plan.loggedDeficit, 2000);
  assert.equal(plan.remainingDeficit, 1500);
  assert.equal(plan.totalBurn - plan.totalFood - plan.totalAlcohol, plan.totalDeficit);
  assert.deepEqual(plan.uncertainty, { low: 2100, high: 4900 });
});

test('six planned whiskeys reduce the weekly deficit by 660 kcal', () => {
  const plan = planWeek({ ...settings, days: loggedDays, drafts: { '2026-09-05': { drinkCount: 6, drinkRate: 110 } } });
  assert.equal(plan.totalDeficit, 2840);
  assert.equal(plan.totalAlcohol, 660);
});

test('only extra walking above baseline adjusts maintenance', () => {
  const plan = planWeek({ ...settings, days: loggedDays, drafts: { '2026-09-05': { steps: 10000 } } });
  assert.equal(plan.totalDeficit, 3620);
});

test('invalid steps cannot silently disappear from the completed-days total', () => {
  const days = loggedDays.map((day, index) => ({ ...day, steps: index === 0 ? null : day.steps }));
  const plan = planWeek({ ...settings, days, drafts: { '2026-08-31': { steps: -1 } } });
  assert.equal(plan.complete, false);
  assert.equal(plan.loggedDeficit, null);
  assert.equal(plan.remainingDeficit, 1500);
});

test('upcoming vacation tags are retained without treating future logs as completed', () => {
  const days = loggedDays.concat({ date: '2026-09-05', excluded: true, calories: 9000, drinkCalories: 1000 });
  const plan = planWeek({ ...settings, days });
  const vacation = plan.rows.find(row => row.date === '2026-09-05');
  assert.equal(vacation.excluded, true);
  assert.equal(vacation.logged, false);
  assert.equal(vacation.food, 2000);
  assert.equal(vacation.alcohol, 0);
});

test('today uses full-day food and adds only planned extra alcohol', () => {
  const days = [...loggedDays, { date: settings.today, calories: 880, drinkCalories: 110, steps: 3000 }];
  const plan = planWeek({ ...settings, days, drafts: { [settings.today]: { food: 2000, drinkCount: 2, drinkRate: 110 } } });
  const today = plan.rows.find(row => row.isToday);
  assert.equal(today.intake, 2330);
  assert.equal(plan.totalDeficit, 3170);
  const invalid = planWeek({ ...settings, days, drafts: { [settings.today]: { food: 800 } } });
  assert.equal(invalid.complete, false);
  assert.match(invalid.rows.find(row => row.isToday).errors.join(' '), /below already logged/);
});

test('missing past food/alcohol is unresolved until explicitly estimated, including vacations', () => {
  const days = loggedDays.slice(1).concat({ date: '2026-08-31', excluded: true });
  assert.equal(planWeek({ ...settings, days }).totalDeficit, null);
  assert.equal(planWeek({ ...settings, days, drafts: { '2026-08-31': { food: 2200 } } }).totalDeficit, null);
  assert.equal(planWeek({ ...settings, days, drafts: { '2026-08-31': { food: 2200, drinkCount: 0 } } }).totalDeficit, 3300);
});

test('imported completed logs replace saved estimates and preserve zero recorded steps', () => {
  const days = loggedDays.map(day => ({ ...day, steps: 0 }));
  const plan = planWeek({ ...settings, days, drafts: { '2026-08-31': { food: 6000, drinkCount: 8, steps: 30000 } } });
  assert.equal(plan.rows[0].food, 2000);
  assert.equal(plan.rows[0].alcohol, 0);
  assert.equal(plan.rows[0].steps, 0);
  assert.equal(plan.totalDeficit, 2380);
});

function comparisonDays() {
  return Array.from({ length: 28 }, (_, i) => ({
    date: shift('2026-08-07', i), calories: i < 14 ? 2000 : 2100,
    drinkCalories: i < 14 ? 100 : 200, steps: 7000,
    weight: i < 14 ? 160 - i * 0.5 / 7 : 159 - (i - 14) * 0.1 / 7
  }));
}

test('separates food and alcohol changes and reconciles an explanatory residual', () => {
  const result = progressChanges({ endDate: '2026-09-03', days: comparisonDays() });
  assert.equal(result.food.impact, -100);
  assert.equal(result.alcohol.impact, -100);
  assert.equal(result.steps.impact, 0);
  assert.equal(result.combinedImpact, -200);
  assert.ok(Math.abs(result.priorPace + 0.5) < 1e-9);
  assert.ok(Math.abs(result.currentPace + 0.1) < 1e-9);
  assert.ok(Math.abs(result.unexplainedChange) < 1e-9);
});

test('pairs matching weekdays and excludes vacation calories from both comparison sides', () => {
  const days = comparisonDays();
  days[2].excluded = true;
  days[2].calories = 9000;
  days[17].calories = null;
  const result = progressChanges({ endDate: '2026-09-03', days });
  assert.equal(result.food.count, 12);
  assert.equal(result.food.delta, 100);
  assert.equal(result.excludedDays, 1);
  assert.equal(result.priorPace, null);
  assert.equal(result.unexplainedChange, null);
});

test('sparse steps never look like lower activity or explain away weight change', () => {
  const days = comparisonDays().map((day, i) => ({ ...day, steps: i < 14 ? day.steps : null }));
  const result = progressChanges({ endDate: '2026-09-03', days });
  assert.equal(result.steps.impact, null);
  assert.equal(result.combinedImpact, null);
  assert.equal(result.intakeImpact, -200);
  assert.equal(result.unexplainedChange, null);
});

test('sparse food logs suppress the combined explanation', () => {
  const days = comparisonDays().filter((day, i) => i < 14 || i > 18);
  const result = progressChanges({ endDate: '2026-09-03', days });
  assert.equal(result.foodReady, false);
  assert.equal(result.combinedImpact, null);
});

test('calendar windows stay fixed and ignore data after their end date', () => {
  const days = comparisonDays().concat({ date: '2026-09-04', calories: 100, weight: 20, steps: 50000 });
  const result = progressChanges({ endDate: '2026-09-03', days });
  assert.equal(result.currentStart, '2026-08-21');
  assert.equal(result.priorStart, '2026-08-07');
  assert.equal(result.currentCoverage, 14);
  assert.equal(result.food.after, 2100);
});
