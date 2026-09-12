const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function fixture() {
  const context = vm.createContext({ console,
    window: { matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: () => null }, document: { getElementById: () => null } });
  for (const file of ['js/data.js', 'js/core.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  const run = source => vm.runInContext(source, context);
  run(`const food = [3000,1000,2000].map((calories,i) => ({
    date:addDaysToDate('2026-08-01',i), calories, drinks:'', weight:160-i, lifting:i===0?'Y':'N'}));
    const nights = [{date:'2026-08-01',perf:20,bedtime_hour:1},{date:'2026-08-02',perf:90,bedtime_hour:2}];`);
  return run;
}

test('sleep ending Monday pairs with Monday food, not Tuesday food', () => {
  const result = fixture()('getLagMetrics(food,nights)');
  assert.equal(result.poorSleepNextDayAvg, 3000);
  assert.equal(result.goodSleepNextDayAvg, 1000);
  assert.equal(result.poorSleepNextDayGap, 2000);
  assert.equal(result.nextDayCalCorr, 0); // Existing Pearson helper requires at least three pairs.
  assert.equal(result.nextDayCalSample, 2);
});

test('scatter and summaries share food plus alcohol intake, counted once', () => {
  const run = fixture();
  const result = run(`food[0].drinks='2 whiskey';
    ({pairs:sleepIntakePairs(food,nights),lag:getLagMetrics(food,nights),expected:effectiveCalories(food[0])})`);
  assert.equal(result.pairs[0].intake, result.expected);
  assert.equal(result.lag.poorSleepNextDayAvg, result.expected);
});

test('supplied range wins over global records and missing calories are not zero intake', () => {
  const run = fixture();
  assert.equal(run('sleepIntakePairs(food.slice(1),nights).length'), 1);
  assert.equal(run('sleepIntakePairs([],nights).length'), 0);
  assert.equal(run('sleepIntakePairs(food.map(d=>({...d,calories:null})),nights).length'), 0);
  assert.equal(run('sleepIntakePairs(food,nights.map(d=>({...d,perf:null}))).length'), 0);
});

test('unknown, unlogged and vacation prior nights are not classified as clean', () => {
  const run = fixture();
  assert.equal(run('getLagMetrics(food,nights).afterCleanCount'), 1);
  assert.equal(run('getLagMetrics([],nights).afterCleanCount'), 0);
  assert.equal(run('getLagMetrics(food.map(d=>({...d,calories:0})),nights).afterCleanCount'), 0);
  assert.equal(run(`inferredVacationDateSet.add('2026-08-01'); getLagMetrics(food,nights).afterCleanCount`), 0);
});

test('drink effect uses the prior calendar day and matches the summary', () => {
  const run = fixture();
  const result = run(`food[0].drinks='2 whiskey'; nights.push({date:'2026-08-03',perf:100,bedtime_hour:1});
    ({lag:getLagMetrics(food,nights),effects:historicalDrinkEffects(food,nights)})`);
  assert.equal(result.lag.afterDrinkAvg, 90);
  assert.equal(result.lag.afterCleanAvg, 100);
  assert.equal(result.effects.drinkSleepPenalty, 10);
});

test('daytime macros pair with the following wake date and honor the sleep range', () => {
  const run = fixture();
  const result = run(`const macros = Array.from({length:6},(_,i)=>({date:addDaysToDate('2026-08-01',i),
    calories:1500+i*100,carbs:100+i*10,protein:150,fat:50}));
    const sleeps = macros.map((d,i)=>({date:nextDayStr(d.date),perf:20+i*10}));
    ({corr:macroSleepCorrelations(macros,sleeps),short:macroSleepCorrelations(macros,sleeps.slice(0,4))})`);
  assert.equal(result.corr.sampleSize, 6);
  assert.equal(result.corr.caloriesVsPerf, 1);
  assert.equal(result.short, null);
});

test('steps pair with ensuing sleep in both correlation and high/low cohorts', () => {
  const run = fixture();
  const result = run(`getStepForDate = date => Number(date.slice(-2))*1000;
    const stepDays = Array.from({length:6},(_,i)=>({date:addDaysToDate('2026-08-01',i)}));
    const stepSleep = stepDays.map((d,i)=>({date:nextDayStr(d.date),perf:20+i*10}));
    stepsCorrelations(stepDays,stepSleep)`);
  assert.equal(result.n_sleep, 6);
  assert.equal(result.r_sleep, 1);
  assert.equal(result.highSleepAvg, 60);
  assert.equal(result.lowSleepAvg, 30);
  assert.equal(run('stepsCorrelations(stepDays,[]).n_sleep'), 0);
});

test('next-day lifting and step comparisons do not bridge missing calendar days', () => {
  const run = fixture();
  const result = run(`getStepForDate = () => 5000;
    ({lag:getLagMetrics([food[0],food[2]],nights),steps:stepsCorrelations([food[0],food[2]],nights),
      consecutive:getLagMetrics(food,nights)})`);
  assert.equal(result.lag.liftWeightSample, 0);
  assert.equal(result.steps.n_weight, 0);
  assert.equal(result.consecutive.liftWeightSample, 2);
});

test('calendar joins cross month and daylight-saving boundaries without shifting dates', () => {
  const run = fixture();
  assert.equal(run(`sleepDayPairs([{date:'2026-02-28'}],[{date:'2026-03-01',perf:70}],-1).length`), 1);
  assert.equal(run(`sleepDayPairs([{date:'2026-03-07'}],[{date:'2026-03-08',perf:70}],-1).length`), 1);
});
