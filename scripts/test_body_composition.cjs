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
