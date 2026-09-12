import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from update_bayes import parse_drinks, estimate_drink_calories


class DrinkParserTests(unittest.TestCase):
    def test_fixtures_and_javascript_parity(self):
        fixtures = json.loads((ROOT / 'scripts/fixtures/drink_parsing.json').read_text())
        js = json.loads(subprocess.check_output(
            ['node', str(ROOT / 'scripts/test_drink_parser.cjs'), '--parity-json'], text=True))
        for fixture, js_result in zip(fixtures, js['fixtures'], strict=True):
            with self.subTest(text=fixture['text']):
                result = parse_drinks(fixture['text'])
                self.assertEqual(result['calories'], fixture['calories'])
                self.assertEqual(result['needsReview'], fixture['review'])
                self.assertEqual(result['unparsed'], fixture.get('unparsed', []))
                self.assertEqual(result, js_result)
                self.assertEqual(estimate_drink_calories(fixture['text']), result['calories'])
        for entry in js['logs']:
            with self.subTest(log=entry['text']):
                self.assertEqual(parse_drinks(entry['text']), entry['result'])


if __name__ == '__main__':
    unittest.main()
