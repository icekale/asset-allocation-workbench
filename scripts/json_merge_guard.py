"""Merge-write helpers for collector scripts that must preserve manual sections."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


class MergeGuardError(RuntimeError):
    """Raised when a write would drop keys or shrink owned series too much."""


def load_existing(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text())
    if not isinstance(data, dict):
        raise MergeGuardError(f"{path} is not a JSON object")
    return data


def merge_preserve(
    existing: dict[str, Any],
    owned: dict[str, Any],
    *,
    owned_keys: set[str],
    force: bool = False,
    shrink_ratio: float = 0.8,
    series_paths: list[tuple[str, ...]] | None = None,
) -> dict[str, Any]:
    """Return merged payload: keep unknown top-level keys, overlay owned keys."""
    unknown = {key: value for key, value in existing.items() if key not in owned_keys}
    merged = {**unknown, **owned}

    dropped = sorted(set(existing) - set(merged))
    if dropped and not force:
        raise MergeGuardError(f"refusing to drop existing top-level keys: {', '.join(dropped)}")

    for path in series_paths or ():
        old_len = _series_len(existing, path)
        new_len = _series_len(merged, path)
        if old_len and new_len < old_len * shrink_ratio and not force:
            joined = ".".join(path)
            raise MergeGuardError(
                f"refusing to shrink {joined} from {old_len} to {new_len} "
                f"(below {shrink_ratio:.0%}); pass --force to override"
            )
    return merged


def never_move_updated_backwards(existing: dict[str, Any], owned: dict[str, Any], key: str = "updated") -> None:
    old = existing.get(key)
    new = owned.get(key)
    if isinstance(old, str) and isinstance(new, str) and new < old:
        owned[key] = old


def write_merged(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def add_force_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--force",
        action="store_true",
        help="Allow dropping preserved keys or large series shrinks",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Write to this path instead of the default app/data target",
    )


def _series_len(payload: dict[str, Any], path: tuple[str, ...]) -> int:
    node: Any = payload
    for part in path:
        if not isinstance(node, dict) or part not in node:
            return 0
        node = node[part]
    if isinstance(node, list):
        return len(node)
    if isinstance(node, dict) and isinstance(node.get("rows"), list):
        return len(node["rows"])
    return 0


def self_test() -> None:
    existing = {
        "unit": "%",
        "rows": [{"period": f"2020-{i:02d}"} for i in range(1, 11)],
        "flowComponents": {"rows": [1, 2, 3]},
        "updated": "2026-10-05",
    }
    owned = {
        "unit": "%",
        "rows": [{"period": f"2020-{i:02d}"} for i in range(1, 11)],
        "updated": "2026-10-01",
    }
    never_move_updated_backwards(existing, owned)
    assert owned["updated"] == "2026-10-05"
    merged = merge_preserve(
        existing,
        owned,
        owned_keys={"unit", "rows", "updated"},
        series_paths=[("rows",)],
    )
    assert "flowComponents" in merged
    assert merged["updated"] == "2026-10-05"
    try:
        merge_preserve(
            existing,
            {"unit": "%", "rows": [{"period": "2020-01"}]},
            owned_keys={"unit", "rows"},
            series_paths=[("rows",)],
        )
        raise AssertionError("expected shrink guard")
    except MergeGuardError:
        pass
    forced = merge_preserve(
        existing,
        {"unit": "%", "rows": [{"period": "2020-01"}]},
        owned_keys={"unit", "rows"},
        series_paths=[("rows",)],
        force=True,
    )
    assert len(forced["rows"]) == 1
    assert "flowComponents" in forced
    print("json_merge_guard self-test ok")


if __name__ == "__main__":
    self_test()
