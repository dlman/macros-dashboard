#!/usr/bin/env python3

import tempfile
import unittest
from pathlib import Path

from update_data_asset_version import expected_version, versioned_index


ROOT = Path(__file__).resolve().parents[1]


class LocalAssetVersionTests(unittest.TestCase):
    def test_all_local_js_and_css_assets_receive_content_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "js").mkdir()
            style = root / "styles.css"
            app = root / "js" / "app.js"
            style.write_text("body { color: red; }\n", encoding="utf-8")
            app.write_text("console.log('ready');\n", encoding="utf-8")
            source = (
                '<link rel="stylesheet" href="./styles.css?v=old-style">\n'
                '<script src="./js/app.js?v=old-script"></script>\n'
                '<script src="https://example.com/vendor.js"></script>\n'
            )

            updated, versions = versioned_index(source, root)

            self.assertIn(f"styles.css?v={expected_version(style)}", updated)
            self.assertIn(f"js/app.js?v={expected_version(app)}", updated)
            self.assertIn("https://example.com/vendor.js", updated)
            self.assertEqual(set(versions), {"styles.css", "js/app.js"})

    def test_missing_local_asset_fails_instead_of_silently_skipping(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = '<script src="./js/missing.js?v=old"></script>'
            with self.assertRaisesRegex(SystemExit, "does not exist"):
                versioned_index(source, Path(tmp))

    def test_steps_workflow_refreshes_and_commits_the_data_cache_key(self):
        workflow = (ROOT / ".github" / "workflows" / "sync-steps.yml").read_text(encoding="utf-8")
        rebuild = workflow.index("python update_bayes.py js/data.js")
        refresh = workflow.index("python scripts/update_data_asset_version.py")
        validate = workflow.index("python scripts/validate_dashboard_build.py")

        self.assertLess(rebuild, refresh)
        self.assertLess(refresh, validate)
        self.assertIn("git diff --stat js/data.js index.html", workflow)
        self.assertIn("git diff --quiet js/data.js index.html", workflow)
        self.assertIn("git add js/data.js index.html", workflow)


if __name__ == "__main__":
    unittest.main()
