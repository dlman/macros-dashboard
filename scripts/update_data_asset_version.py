#!/usr/bin/env python3
"""Keep every local JavaScript and stylesheet cache key aligned with its contents."""

from __future__ import annotations

import argparse
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_PATH = ROOT / "index.html"
LOCAL_ASSET_RE = re.compile(
    r'(?P<prefix>(?:src|href)=")(?P<path>\./[^"?]+\.(?:js|css))\?v=(?P<version>[^"]+)(?P<suffix>")'
)


def expected_version(asset_path: Path) -> str:
    return hashlib.sha256(asset_path.read_bytes()).hexdigest()[:12]


def versioned_index(source: str, root: Path = ROOT) -> tuple[str, dict[str, tuple[str, str]]]:
    versions: dict[str, tuple[str, str]] = {}

    def replace(match: re.Match[str]) -> str:
        relative = match.group("path").removeprefix("./")
        asset_path = root / relative
        if not asset_path.is_file():
            raise SystemExit(f"Versioned local asset does not exist: {relative}")
        version = expected_version(asset_path)
        versions[relative] = (match.group("version"), version)
        return f'{match.group("prefix")}{match.group("path")}?v={version}{match.group("suffix")}'

    updated, count = LOCAL_ASSET_RE.subn(replace, source)
    if count == 0:
        raise SystemExit("No versioned local JavaScript or CSS assets found in index.html")
    if count != len(versions):
        raise SystemExit("Duplicate versioned local asset references found in index.html")
    return updated, versions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail when any local JS/CSS cache key is stale")
    args = parser.parse_args()

    current = INDEX_PATH.read_text(encoding="utf-8")
    updated, versions = versioned_index(current)
    stale = {
        path: (old, expected)
        for path, (old, expected) in versions.items()
        if old != expected
    }

    if args.check:
        if stale:
            detail = ", ".join(f"{path}: {old} -> {expected}" for path, (old, expected) in stale.items())
            raise SystemExit(f"index.html has stale local asset cache keys: {detail}")
        print(f"All {len(versions)} local JS/CSS cache keys are current")
        return

    if not stale:
        print(f"All {len(versions)} local JS/CSS cache keys already current")
        return

    INDEX_PATH.write_text(updated, encoding="utf-8")
    for path, (old, expected) in stale.items():
        print(f"Updated {path} cache key: {old} -> {expected}")


if __name__ == "__main__":
    main()
