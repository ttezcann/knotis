from __future__ import annotations

import os
import time
from pathlib import Path

from . import emit_dev_heartbeat
from .builder.assets_mirror import site_runtime_assets_dir
from .build_site import (
    clean_generated_page_routes,
    clean_search_index,
    normalize_generated_page_front_matter,
    refresh_zensical_build_overlay,
    stamp_knotis_asset_cache_busters,
    sync_site_runtime_assets,
)
from .builder import run_build

POLL_INTERVAL = 1.0


def sync_served_runtime_assets(repo_root: Path) -> None:
    sync_site_runtime_assets(repo_root)
    clean_search_index(repo_root / "site", repo_root)
    stamp_knotis_asset_cache_busters(repo_root / "site", site_runtime_assets_dir(repo_root))


def get_mtimes(repo_root: Path) -> dict[Path, float]:
    docs_dir = repo_root / "docs"
    assets_dir = repo_root / "assets"
    tracked: list[Path] = [
        repo_root / "zensical.toml",
        repo_root / "assets" / "knotis-theme.css",
    ]
    if docs_dir.is_dir():
        tracked.extend(docs_dir.rglob("*.md"))
    if assets_dir.is_dir():
        tracked.extend(assets_dir.glob("*.js"))
        tracked.extend(assets_dir.glob("*.css"))
        tracked.extend(assets_dir.glob("*.min.js"))
    return {path: path.stat().st_mtime for path in tracked if path.exists()}


def run_watch_build(repo_root: Path, changed_paths: set[Path]) -> None:
    print("[watch] Change detected - rebuilding...", flush=True)
    run_build(repo_root)
    sync_served_runtime_assets(repo_root)
    normalize_generated_page_front_matter(repo_root)

    toml_path = repo_root / "zensical.toml"
    if toml_path in changed_paths:
        if refresh_zensical_build_overlay(repo_root):
            print(
                "[watch] Refreshed .zensical.knotis.build.toml for zensical serve...",
                flush=True,
            )

    site_refresh_paths = {
        repo_root / "assets" / "knotis-theme.css",
        toml_path,
    }
    if any(path in site_refresh_paths for path in changed_paths) or any(
        repo_root / "assets" in path.parents and path.suffix in {".js", ".css"} for path in changed_paths
    ):
        clean_generated_page_routes(repo_root)

    if os.environ.get("KNOTIS_NO_RELOAD") != "1":
        emit_dev_heartbeat.emit(repo_root)

    clean_search_index(repo_root / "site", repo_root)
    print("[watch] Done.", flush=True)


def watch(repo_root: Path, *, skip_initial_build: bool = False) -> None:
    docs_dir = repo_root / "docs"
    print(f"[watch] Watching {docs_dir} and zensical.toml for changes...", flush=True)
    if not skip_initial_build:
        run_watch_build(repo_root, {repo_root / "assets" / "knotis-theme.css"})
    else:
        normalize_generated_page_front_matter(repo_root)
        clean_generated_page_routes(repo_root)
        sync_served_runtime_assets(repo_root)
    mtimes = get_mtimes(repo_root)

    try:
        while True:
            time.sleep(POLL_INTERVAL)
            sync_served_runtime_assets(repo_root)
            current = get_mtimes(repo_root)
            if current != mtimes:
                changed = {path for path, mtime in current.items() if mtimes.get(path) != mtime}
                changed.update(path for path in mtimes if path not in current)
                mtimes = current
                run_watch_build(repo_root, changed)
    except KeyboardInterrupt:
        print("\n[watch] Stopped.", flush=True)
