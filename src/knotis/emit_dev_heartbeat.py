#!/usr/bin/env python3
from __future__ import annotations

import json
import time
from pathlib import Path


def emit(repo_root: Path) -> None:
    heartbeat_path = repo_root / "site" / "assets" / "dev-heartbeat.json"
    heartbeat_path.parent.mkdir(parents=True, exist_ok=True)
    heartbeat_path.write_text(
        json.dumps({"updated_at_ns": time.time_ns()}, separators=(",", ":")),
        encoding="utf-8",
    )


def main() -> int:
    import sys

    repo_root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    emit(repo_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
