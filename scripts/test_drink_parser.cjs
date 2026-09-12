const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console,
  window: { matchMedia: () => ({ matches: false }) },
  localStorage: { getItem: () => null }, document: { getElementById: () => null } });
for (const file of ['js/data.js', 'js/core.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/drink_parsing.json'),'utf8'));
const parse = text => JSON.parse(JSON.stringify(vm.runInContext(`parseDrinks(${JSON.stringify(text)})`, context)));

if (process.argv.includes('--parity-json')) {
  const logs = vm.runInContext('allDays.map(d=>d.drinks)', context);
  process.stdout.write(JSON.stringify({fixtures:fixtures.map(f=>parse(f.text)),logs:logs.map(text=>({text,result:parse(text)}))}));
} else {
  for (const fixture of fixtures) test(`drink parser: ${JSON.stringify(fixture.text)}`, () => {
    const result = parse(fixture.text);
    assert.equal(result.calories,fixture.calories);
    assert.equal(result.needsReview,fixture.review);
    assert.deepEqual(result.unparsed,fixture.unparsed || []);
  });
  test('current logs have finite estimates and unresolved text is always flagged', () => {
    const logs=vm.runInContext('allDays.map(d=>d.drinks)',context);
    for (const text of logs) {
      const result = parse(text);
      assert.ok(Number.isFinite(result.calories) && result.calories >= 0, text);
      if (result.unparsed.length) assert.equal(result.needsReview,true,text);
    }
  });
  test('calorie wrapper and quality review use the same detailed result', () => {
    assert.equal(vm.runInContext(`estimateDrinkCalories('Negroni, half soju bottle')`,context),450);
    const flags=vm.runInContext(`qualityAudit([{date:'2026-08-01',drinks:'mystery punch'}],[]).drinkReview`,context);
    assert.equal(flags.length,1);
    assert.equal(flags[0].calories,140);
    assert.equal(flags[0].unparsed[0],'mystery punch');
  });
}
