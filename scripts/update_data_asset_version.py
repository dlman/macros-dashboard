#!/usr/bin/env python3
"""Keep the dashboard's data.js cache key aligned with its contents."""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "js" / "data.js"
INDEX_PATH = ROOT / "index.html"
DATA_SCRIPT_RE = re.compile(r'(src="\./js/data\.js\?v=)[^"]+("[^>]*></script>)')


def expected_version(data_path: Path = DATA_PATH) -> str:
    return hashlib.sha256(data_path.read_bytes()).hexdigest()[:12]


def versioned_index(source: str, version: str) -> str:
    updated, count = DATA_SCRIPT_RE.subn(rf"\g<1>{version}\g<2>", source)
    if count != 1:
        raise SystemExit(f"Expected one versioned data.js script tag, found {count}")
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail when index.html has a stale data.js version")
    args = parser.parse_args()

    version = expected_version()
    current = INDEX_PATH.read_text(encoding="utf-8")
    updated = versioned_index(current, version)

    if args.check:
        if updated != current:
            raise SystemExit(f"index.html data.js cache key is stale; expected {version}")
        print(f"data.js cache key is current ({version})")
        return

    if updated == current:
        print(f"data.js cache key already current ({version})")
        return

    INDEX_PATH.write_text(updated, encoding="utf-8")
    print(f"Updated data.js cache key to {version}")


if __name__ == "__main__":
    main()
