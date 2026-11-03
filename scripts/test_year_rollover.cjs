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
