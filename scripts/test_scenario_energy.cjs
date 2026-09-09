const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console,
  window: { matchMedia: () => ({matches: false}) },
  localStorage: {getItem: () => null}, document: {getElementById: () => null} });
for (const file of ['js/data.js', 'js/core.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, {filename:file});
}
const run = source => vm.runInContext(source, context);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
run(`const energyFixture = Array.from({length:7}, (_,i) => ({date:addDaysToDate('2026-08-01',i),
  weight:160-i*0.1, calories:2000, protein:160, drinks:i === 1 ? '6 whiskey' : i === 5 ? '2 white claws' : ''}));`);

test('scenario alcohol uses the dashboard parser average per drinking night', () => {
  const p = run('scenarioAlcoholCalories(2, energyFixture)');
  near(p.caloriesPerNight, (660 + 200) / 2);
  near(p.dailyAlcoholCalories, 860 / 7);
  assert.equal(p.sampleSize, 2);
  assert.equal(p.source, 'logged');
});

test('food differences between clean and drinking days do not change alcohol estimates', () => {
  const p = run(`scenarioAlcoholCalories(2, energyFixture.map(d => ({...d,calories:d.drinks ? 1000 : 5000})))`);
  near(p.dailyAlcoholCalories, 860 / 7);
});

test('alcohol is added exactly once and seven-day intake reconciles with dashboard logs', () => {
  const p = run(`({scenario:calculateWhatIf(2000,1,5,2,energyFixture,[]),
    logged:energyFixture.reduce((sum,d) => sum+effectiveCalories(d),0)})`);
  near(p.scenario.totalDailyIntake * 7, p.logged);
  near(p.scenario.totalDeficit, p.scenario.tdee * 7 - p.logged);
  near(p.scenario.foodCalories, 2000);
});

test('sleep alone changes neither energy balance, horizon weight nor goal ETA', () => {
  const cases = run(`[4,5.5,6.5,8].map(sleep => ({
    forecast:calculateWhatIf(1800,4,sleep,2,energyFixture,[]),
    goal:scenarioTimeToBodyFatGoal({calories:1800,sleep,drinks:2},15,energyFixture,[])
  }))`);
  for (const p of cases) {
    near(p.forecast.effectiveDeficit, cases[0].forecast.effectiveDeficit);
    near(p.forecast.projectedWeightExact, cases[0].forecast.projectedWeightExact);
    assert.equal(p.goal.daysToTarget, cases[0].goal.daysToTarget);
  }
});

test('total intake at maintenance predicts no tissue change, with or without alcohol', () => {
  const cases = run(`[0,2,7].map(nights => {
    const tdee = workingTDEEProfile(energyFixture).maintenance;
    const alcohol = scenarioAlcoholCalories(nights,energyFixture);
    return calculateWhatIf(tdee-alcohol.dailyAlcoholCalories,4,5.5,nights,energyFixture,[]);
  })`);
  for (const p of cases) {
    near(p.effectiveDeficit, 0);
    near(p.totalDeficit, 0);
    near(Number(p.tissueWeightChange), 0);
    near(p.projectedWeightExact, p.currentWeight);
  }
});

test('maintenance during creatine loading adds only modeled water', () => {
  const p = run(`(() => {
    const days = [{date:'2026-07-03',weight:160,calories:2000,protein:160}];
    return calculateWhatIf(workingTDEEProfile(days).maintenance,4,5,0,days,[]);
  })()`);
  near(p.totalDeficit, 0);
  assert.ok(p.creatineScaleDelta > 0);
  near(p.projectedWeightExact - p.currentWeight, p.creatineScaleDelta);
});

test('True Maintenance preset balances its own food and alcohol without 25-kcal rounding', () => {
  for (const p of run(`[energyFixture, allDays].map(days => {
    const preset = getScenarioDefaults(days,[]).maintain;
    return calculateWhatIf(preset.calories,4,preset.sleep,preset.drinks,days,[]);
  })`)) assert.ok(Math.abs(p.effectiveDeficit) <= 0.005);
});

test('dry scenario saves only estimated alcohol calories, not an extra behavior penalty', () => {
  const p = run(`({wet:calculateWhatIf(2000,4,5,2,energyFixture,[]),
    dry:calculateWhatIf(2000,4,5,0,energyFixture,[])})`);
  near(p.dry.effectiveDeficit-p.wet.effectiveDeficit, 860/7);
  near(p.dry.totalDeficit-p.wet.totalDeficit, 860*4);
});

test('vacation, diet-break and future records cannot inflate the per-night baseline', () => {
  const p = run(`scenarioAlcoholCalories(2, energyFixture.concat([
    {date:'2026-05-06',drinks:'100 whiskey'},
    {date:'2026-02-28',drinks:'100 whiskey'},
    {date:'2099-08-01',drinks:'100 whiskey'}
  ]))`);
  near(p.caloriesPerNight, 430);
  assert.equal(p.sampleSize, 2);
});

test('missing history has an explicit assumption and zero nights adds zero alcohol', () => {
  const p = run('scenarioAlcoholCalories(2, [])');
  assert.equal(p.source, 'assumed_one_drink');
  assert.equal(p.sampleSize, 0);
  near(p.caloriesPerNight, 140);
  near(run('scenarioAlcoholCalories(0, []).dailyAlcoholCalories'), 0);
  near(run('scenarioAlcoholCalories(-1, energyFixture).dailyAlcoholCalories'), 0);
  near(run('scenarioAlcoholCalories(20, energyFixture).dailyAlcoholCalories'), 430);
});

test('forecast envelope and comparison series use the same energy ledger as the goal solver', () => {
  const p = run(`(() => {
    const values = {calories:1800,weeks:4,sleep:5,drinks:2};
    const series = scenarioForecastSeries('test',values,energyFixture,[]);
    const goal = scenarioTimeToBodyFatGoal(values,15,energyFixture,[]);
    return {series,goal};
  })()`);
  const {series,goal} = p;
  near(series.envelope.effectiveDeficitMid, series.projection.effectiveDeficit);
  near(goal.effectiveDeficit, series.projection.effectiveDeficit);
  near(series.bodyComp.at(-1).weight, series.projection.projectedWeightExact);
  near(series.envelope.effectiveDeficitLow,
    series.envelope.tdeeProfile.rangeLow - series.projection.totalDailyIntake);
  near(series.envelope.effectiveDeficitHigh,
    series.envelope.tdeeProfile.rangeHigh - series.projection.totalDailyIntake);
});
