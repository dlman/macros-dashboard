const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  console,
  window: { matchMedia: () => ({ matches: false }) },
  localStorage: { getItem: () => null },
  document: { getElementById: () => null },
});
for (const file of ['js/data.js', 'js/core.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const run = source => vm.runInContext(source, context);
const near = (actual, expected, label = '') => assert.ok(
  Math.abs(actual - expected) < 1e-8, `${label}: ${actual} != ${expected}`
);

test('April scan anchor and existing main-model estimate are preserved', () => {
  const scan = run('estimateBodyCompAtWeight(DXA_SCAN.totalMass, allDays, DXA_SCAN.date)');
  near(scan.bodyFatPct, 21.2);
  near(scan.lean, 120.6);
  const cases = run(`allDays.filter(d => d.weight).map(d => {
    const p = estimateBodyCompAtWeight(d.weight, allDays, d.date);
    const shares = bodyCompModelShares(allDays);
    const delta = d.weight - p.creatineWater - DXA_SCAN.totalMass;
    const ffm = DXA_FAT_FREE_MASS + delta * (delta < 0 ? shares.cutFatFreeShare : shares.gainFatFreeShare);
    return { actual: p.bodyFatPct, expected: (d.weight - p.creatineWater - ffm) / d.weight * 100 };
  })`);
  for (const p of cases) near(p.actual, p.expected);
});

test('scenario and main estimates agree before, during and after creatine, in both weight branches', () => {
  const cases = run(`['2026-04-08', '2026-07-10', '2026-09-03'].flatMap(date =>
    [145, 155, 160.6, 175].flatMap(weight => [allDays, allDays.slice(-28)].map(days => ({
      main: estimateBodyCompRangeAtWeight(weight, days, date),
      scenario: scenarioProjectedBodyComp(weight, days, date).cutState
    }))))`);
  for (const { main, scenario } of cases) {
    for (const key of ['fat', 'lean', 'fatFreeMass', 'bodyFatPct', 'leanLow', 'leanHigh', 'fatLow', 'fatHigh']) {
      near(scenario[key], main[key], key);
    }
  }
});

test('cut and fed target weights round-trip through their displayed models', () => {
  const cases = run(`[allDays, allDays.slice(-28), []].flatMap(days =>
    [10, 15, 16, 17, 18, 21.2, 30, 40].map(target => {
      const current = estimateBodyCompAtWeight(154, days, '2026-09-03');
      const weights = bodyFatTargetWeightsFromCurrent(current, target, days);
      const delta = DXA_PREV_FAT_FREE_MASS - DXA_FAT_FREE_MASS;
      return { target,
        cut: scenarioProjectedBodyComp(weights.cutStateTarget, days, '2026-09-03').cutState.bodyFatPct,
        fed: scenarioProjectedBodyComp(weights.fedStateTarget - delta, days, '2026-09-03').fedState.bodyFatPct
      };
    }))`);
  for (const p of cases) {
    near(p.cut, p.target, 'cut target');
    near(p.fed, p.target, 'fed target');
  }
});

test('target solver uses the supplied range model, not a hidden all-history default', () => {
  const result = run(`(() => {
    const days = [{ date: '2026-09-03', weight: 154, protein: 0, lifting: 'N' }];
    const current = estimateBodyCompAtWeight(154, days, days[0].date);
    const target = bodyFatTargetWeightsFromCurrent(current, 15, days).cutStateTarget;
    return { bf: estimateBodyCompAtWeight(target, days, days[0].date).bodyFatPct,
      differs: Math.abs(target - bodyFatTargetWeightsFromCurrent(current, 15, allDays).cutStateTarget) > 0.01 };
  })()`);
  near(result.bf, 15);
  assert.equal(result.differs, true);
});

test('future target retains the existing full-creatine assumption without changing current BF', () => {
  const result = run(`(() => {
    const current = estimateBodyCompAtWeight(159, allDays, '2026-07-03');
    const target = bodyFatTargetWeightsFromCurrent(current, 15, allDays).cutStateTarget;
    return { water: current.creatineWater, full: CREATINE_FULL_WATER_LBS,
      future: estimateBodyCompAtWeight(target, allDays, '2026-09-03').bodyFatPct };
  })()`);
  assert.ok(result.water < result.full);
  near(result.future, 15);
});

test('invalid targets and missing current state return unavailable targets', () => {
  const results = run(`[null, NaN, Infinity, -1, 0, 100, 101].map(target =>
    bodyFatTargetWeightsFromCurrent(estimateBodyCompAtWeight(154), target)).concat([
      bodyFatTargetWeightsFromCurrent(null, 15), bodyFatTargetWeightsFromCurrent({weight: NaN, fat: 20}, 15)
    ])`);
  for (const result of results) {
    assert.equal(result.cutStateTarget, null);
    assert.equal(result.fedStateTarget, null);
    assert.equal(result.scanStateGap, null);
  }
});

test('lower BF goals require lower target weights', () => {
  const targets = run(`[15, 16, 17, 18].map(target =>
    bodyFatTargetWeightsFromCurrent(estimateBodyCompAtWeight(154), target))`);
  for (let i = 1; i < targets.length; i++) {
    assert.ok(targets[i].cutStateTarget > targets[i - 1].cutStateTarget);
    assert.ok(targets[i].fedStateTarget > targets[i - 1].fedStateTarget);
  }
});

test('modeled lean intervals contain their point estimates and exclude bone', () => {
  const cases = run(`allDays.filter(d => d.weight).flatMap(d => {
    const scenario = scenarioProjectedBodyComp(d.weight, allDays, d.date);
    return [scenario.cutState, scenario.fedState];
  }).concat([estimateBodyCompRangeAtWeight(DXA_SCAN.totalMass, allDays, DXA_SCAN.date)])`);
  const bone = run('DXA_BONE_MASS');
  for (const p of cases) {
    assert.ok(p.leanLow <= p.lean && p.lean <= p.leanHigh);
    near(p.lean + p.fat + bone, p.weight, 'point mass');
    near(p.leanLow + p.fatHigh + bone, p.weight, 'lower lean mass');
    near(p.leanHigh + p.fatLow + bone, p.weight, 'upper lean mass');
    near(p.fatFreeMass, p.weight - p.fat, 'fat-free mass');
  }
});

test('scan-anchored intervals exclude each scan\'s bone mass', () => {
  const cases = run(`[
    { scan: DXA_SCAN, ffm: DXA_FAT_FREE_MASS, bone: DXA_BONE_MASS },
    { scan: DXA_SCAN_PREV, ffm: DXA_PREV_FAT_FREE_MASS, bone: DXA_PREV_BONE_MASS }
  ].flatMap(({scan, ffm, bone}) => [0, 1.8].map(water => ({ bone,
    p: scanAnchoredBodyCompRange(scan.totalMass + water, ffm, bone, 0.95, water)
  })))`);
  for (const { p, bone } of cases) {
    assert.ok(p.leanLow <= p.lean && p.lean <= p.leanHigh);
    near(p.leanLow + p.fatHigh + bone, p.weight);
    near(p.leanHigh + p.fatLow + bone, p.weight);
  }
});

test('fed-state conversion adds only non-fat mass and keeps interval arithmetic consistent', () => {
  const { cut, fed, delta } = run(`(() => {
    const p = scenarioProjectedBodyComp(154, allDays, '2026-09-03');
    return { cut: p.cutState, fed: p.fedState, delta: p.fedDelta };
  })()`);
  near(fed.fat, cut.fat);
  near(fed.weight - cut.weight, delta);
  near(fed.lean - cut.lean, delta);
  near(fed.fatFreeMass - cut.fatFreeMass, delta);
  assert.ok(fed.bodyFatPct < cut.bodyFatPct);
});

test('milestones, scenario goals and year-end runway use the same target model for their ranges', () => {
  const cases = run(`[allDays, allDays.slice(-60)].map(days => {
    const projection = bodyFatTargetProjection(days, 15);
    const scenario = scenarioTimeToBodyFatGoal({ calories: 1800, sleep: 7, drinks: 0 }, 15, days, []);
    const baseline = baselineAnalyticsDays(getAnalyticsDays(days));
    const runway = yearEndBodyFatRunway(days, 15);
    const anchor = latestRollingWeightAnchor(baseline);
    const expected = bodyFatTargetWeightsFromCurrent(
      estimateBodyCompAtWeight(anchor.weight, baseline, anchor.date), 15, baseline);
    return { projection, scenario, runway, expected };
  })`);
  for (const { projection, scenario, runway, expected } of cases) {
    assert.ok(projection && scenario && runway);
    near(projection.targetWeight, scenario.cutTargetWeight);
    near(runway.targetWeight, Number(expected.cutStateTarget.toFixed(1)));
    near(runway.targetFedWeight, Number(expected.fedStateTarget.toFixed(1)));
  }
});

test('goal ETA is the first dated body-fat crossing before, during and after the creatine ramp', () => {
  const cases = run(`['2026-06-01', '2026-07-03', '2026-07-15', '2026-09-03'].flatMap(date =>
    [0.03, 0.1, 0.25].map(pace => {
      const target = 18;
      const timeline = bodyFatGoalTimeline(159.9, date, pace, target, allDays);
      const prevDate = addDaysToDate(date, timeline.daysToTarget - 1);
      const prevWeight = 159.9 - pace * (timeline.daysToTarget - 1) + creatineScaleDeltaFromAnchor(date, prevDate);
      return { timeline, target,
        previous: estimateBodyCompAtWeight(prevWeight, allDays, prevDate).bodyFatPct,
        expectedDate: addDaysToDate(date, timeline.daysToTarget) };
    }))`);
  for (const p of cases) {
    assert.ok(p.timeline.daysToTarget > 0);
    assert.ok(p.timeline.bodyComp.bodyFatPct <= p.target + 1e-10);
    assert.ok(p.previous > p.target);
    assert.equal(p.timeline.projectedDate, p.expectedDate);
  }
});

test('a future loaded target above current weight cannot imply zero days now', () => {
  const p = run(`(() => {
    const date = '2026-07-03';
    const weight = 159.9;
    const current = estimateBodyCompAtWeight(weight, allDays, date);
    const target = current.bodyFatPct - 0.1;
    const future = bodyFatTargetWeightsFromCurrent(current, target, allDays);
    return { future: future.cutStateTarget, weight,
      timeline: bodyFatGoalTimeline(weight, date, 0.05, target, allDays) };
  })()`);
  assert.ok(p.future > p.weight);
  assert.ok(p.timeline.daysToTarget > 0);
  assert.equal(p.timeline.alreadyThere, false);
});

test('already reached goals remain zero days even with no loss pace', () => {
  const cases = run(`[null, NaN, Infinity, 0, -0.1, 0.1].map(pace =>
    bodyFatGoalTimeline(147, '2026-09-03', pace, 18, allDays))`);
  for (const p of cases) {
    assert.equal(p.daysToTarget, 0);
    assert.equal(p.alreadyThere, true);
    assert.equal(p.projectedDate, '2026-09-03');
    near(p.projectedWeight, 147);
  }
});

test('unreached goals with invalid, zero or gaining pace have no ETA', () => {
  const cases = run(`[null, NaN, Infinity, 0, -0.1].map(pace =>
    bodyFatGoalTimeline(160, '2026-09-03', pace, 15, allDays)).concat([
      bodyFatGoalTimeline(160, '2026-09-03', 0.001, 15, allDays, 0, 30),
      bodyFatGoalTimeline(160, 'invalid', 0.1, 15, allDays),
      bodyFatGoalTimeline(160, '2026-09-03', 0.1, NaN, allDays)
    ])`);
  for (const p of cases) {
    assert.equal(p.achievable, false);
    assert.equal(p.daysToTarget, null);
    assert.equal(p.projectedDate, null);
  }
});

test('scenario ETA, projected weight, BF and date all describe the same point', () => {
  const cases = run(`['2026-07-03', '2026-09-03'].flatMap(date => [18, 20.5].map(target => {
    const days = [{date, weight: 163, calories: 1900, protein: 160}];
    const goal = scenarioTimeToBodyFatGoal({calories: 1500, sleep: 7, drinks: 0}, target, days, []);
    const forecast = calculateWhatIf(1500, goal.daysToTarget / 7, 7, 0, days, []);
    const state = scenarioProjectedBodyComp(forecast.projectedWeightExact, days, forecast.projectedDate);
    const before = calculateWhatIf(1500, (goal.daysToTarget - 1) / 7, 7, 0, days, []);
    return {goal, forecast, state,
      before: scenarioProjectedBodyComp(before.projectedWeightExact, days, before.projectedDate).cutState.bodyFatPct};
  }))`);
  for (const {goal, forecast, state, before} of cases) {
    assert.ok(goal.daysToTarget > 0);
    near(goal.projectedWeight, forecast.projectedWeightExact);
    assert.equal(goal.projectedDate, forecast.projectedDate);
    near(goal.targetStates.cutState.bodyFatPct, state.cutState.bodyFatPct);
    assert.ok(state.cutState.bodyFatPct <= goal.targetBfPct + 1e-10);
    assert.ok(before > goal.targetBfPct);
  }
});

test('date-specific target weights round-trip during the ramp instead of assuming full water', () => {
  const p = run(`(() => {
    const date = '2026-07-05';
    const current = estimateBodyCompAtWeight(160, allDays, date);
    const target = bodyFatTargetWeightsFromCurrent(current, 20, allDays, date);
    return {actual: estimateBodyCompAtWeight(target.cutStateTarget, allDays, date).bodyFatPct};
  })()`);
  near(p.actual, 20);
});

test('stable creatine reproduces the ordinary weight-gap ETA including year rollover', () => {
  const p = run(`(() => {
    const weight = 155;
    const date = '2026-12-28';
    const current = estimateBodyCompAtWeight(weight, allDays, date);
    const target = bodyFatTargetWeightsFromCurrent(current, 15, allDays, date).cutStateTarget;
    return {expected: Math.ceil((weight - target) / 0.1),
      timeline: bodyFatGoalTimeline(weight, date, 0.1, 15, allDays)};
  })()`);
  assert.equal(p.timeline.daysToTarget, p.expected);
  assert.ok(p.timeline.projectedDate.startsWith('2027-'));
});

test('raw and creatine-adjusted trend inputs cannot collide in the cache', () => {
  const p = run(`(() => {
    const days = Array.from({length: 21}, (_, i) => ({date: addDaysToDate('2026-07-02', i),
      weight: 160 - i * 0.04 + creatineScaleAdjustmentForDate(addDaysToDate('2026-07-02', i)), calories: 2000}));
    const raw = stateSpaceWeightTrendPoints(days);
    const adjusted = stateSpaceWeightTrendPoints(creatineAdjustedWeightDays(days));
    const rawAgain = stateSpaceWeightTrendPoints(days);
    return {same: raw === adjusted, cached: raw === rawAgain,
      rawWeight: raw.at(-1).rawWeight, adjustedWeight: adjusted.at(-1).rawWeight};
  })()`);
  assert.equal(p.same, false);
  assert.equal(p.cached, true);
  near(p.rawWeight - p.adjustedWeight, 1.8);
});

test('milestone ETA ranges bracket the point estimate and never report negative days', () => {
  const cases = run(`['2026-07-03', '2026-09-03'].flatMap(date => [18, 20.5].map(target => {
    const days = Array.from({length: 14}, (_, i) => ({date: addDaysToDate(date, i - 13),
      weight: 161 - i * 0.1, calories: 1900, protein: 160}));
    return bodyFatTargetProjection(days, target);
  }))`);
  for (const p of cases) {
    assert.ok(p);
    if (p.daysToTarget != null) {
      assert.ok(p.daysToTarget >= 0);
      assert.ok(p.targetRange.daysLow <= p.daysToTarget);
      assert.ok(p.targetRange.daysHigh >= p.daysToTarget);
    }
  }
});

test('sparse unreached milestones stay visible without inventing an ETA', () => {
  const p = run(`bodyFatTargetProjection([{date:'2026-09-03', weight:160}], 15)`);
  assert.ok(p);
  assert.equal(p.daysToTarget, null);
  assert.equal(p.alreadyThere, false);
  assert.equal(p.targetRange.daysLow, null);
});

test('year-end ETA uses the dated path and deadline budget counts tissue, not future water', () => {
  const p = run(`(() => {
    const days = Array.from({length: 40}, (_, i) => ({date: addDaysToDate('2026-05-25', i),
      weight: 163 - i * 0.08 + creatineScaleAdjustmentForDate(addDaysToDate('2026-05-25', i)), calories: 2000, protein: 160}));
    const result = yearEndBodyFatRunway(days, 18, '2026-07-15');
    const baseline = baselineAnalyticsDays(getAnalyticsDays(days));
    const timeline = bodyFatGoalTimeline(result.currentWeight, result.currentWeightDate, result.actualWeeklyLoss / 7, 18, baseline);
    return {result, timeline, waterDelta: creatineScaleDeltaFromAnchor(result.currentWeightDate, '2026-07-15')};
  })()`);
  assert.equal(p.result.projectedDate, p.timeline.projectedDate);
  near(p.result.requiredDailyDeficit * p.result.daysRemaining / 3500, p.result.tissueWeightRemaining);
  near(p.result.tissueWeightRemaining - p.result.weightRemaining, p.waterDelta);
});
