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

test('month identity includes the year', () => {
  assert.equal(run("monthKey('2027-01-02')"), '2027-01');
  assert.deepEqual(
    run("JSON.parse(JSON.stringify(monthMetaForKey('2027-01')))").year,
    '2027',
  );
});

test('December and January rows remain in separate year-month buckets', () => {
  const result = JSON.parse(run(`JSON.stringify(monthBuckets(
    [{date:'2026-12-31'},{date:'2027-01-01'}],
    [monthMetaForKey('2026-12'), monthMetaForKey('2027-01')]
  ))`));
  assert.deepEqual(result['2026-12'].map(row => row.date), ['2026-12-31']);
  assert.deepEqual(result['2027-01'].map(row => row.date), ['2027-01-01']);
});

test('source freshness uses each feed independently and flags data older than two days', () => {
  const result = JSON.parse(run(`JSON.stringify([
    dataSourceFreshness('fresh', 'Fresh', [{date:'2027-01-02'}], '2027-01-04'),
    dataSourceFreshness('stale', 'Stale', [{date:'2027-01-01'}], '2027-01-04'),
    dataSourceFreshness('missing', 'Missing', [], '2027-01-04')
  ])`));
  assert.equal(result[0].ageDays, 2);
  assert.equal(result[0].stale, false);
  assert.equal(result[1].ageDays, 3);
  assert.equal(result[1].stale, true);
  assert.equal(result[2].latestDate, null);
  assert.equal(result[2].stale, true);
});

test('range presets use calendar boundaries and keep YTD available', () => {
  const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-31', '2026-02-01', '2026-02-02'];
  const result = JSON.parse(run(`JSON.stringify([
    rangeIndicesForPreset('3', ${JSON.stringify(dates)}, 7),
    rangeIndicesForPreset('month', ${JSON.stringify(dates)}, 7),
    rangeIndicesForPreset('ytd', ${JSON.stringify(dates)}, 7)
  ])`));
  assert.deepEqual(result[0], { start: 5, end: 7 });
  assert.deepEqual(result[1], { start: 6, end: 7 });
  assert.deepEqual(result[2], { start: 0, end: 7 });
});

test('missing prior data never becomes a zero-valued comparison', () => {
  const missing = JSON.parse(run(`JSON.stringify(compareDelta(88, null, 'down', value => String(value)))`));
  const real = JSON.parse(run(`JSON.stringify(compareDelta(8, 5, 'down', value => String(value)))`));
  assert.equal(missing.text, '—');
  assert.equal(missing.available, false);
  assert.equal(missing.detail, 'No prior period available');
  assert.equal(real.text, '+3');
  assert.equal(real.available, true);
});
