from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tomllib
from pathlib import Path

from .builder.assets_mirror import (
    GENERATED_ASSET_FILES,
    runtime_asset_output_dir,
    site_runtime_assets_dir,
    sync_site_runtime_assets,
)
from .builder.zensical_config import resolve_zensical_config_path
from .zensical_runtime import resolve_zensical_command

KNOTIS_STAMPED_ASSETS = (
    "knotis-core.js",
    "knotis-icon-map.js",
    "knotis-content.css",
    "knotis-wikilinks.js",
    "knotis-wikilinks.css",
    "knotis-pane.css",
    "knotis-graph.css",
    "knotis-graph.js",
    "knotis-search.js",
    "knotis-search.css",
    "knotis-slides.js",
    "knotis-slides.css",
    "knotis-palette.css",
    "knotis-content-tags.css",
    "knotis-readaloud.js",
    "knotis-readaloud.css",
    "knotis-media.js",
    "knotis-media.css",
    "knotis-theme.css",
)
GENERATED_PAGE_FILENAMES = ("site-graph.md", "graph.md", "glossary.md", "content-tags.md")


def knotis_asset_versions(assets_dir: Path) -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in KNOTIS_STAMPED_ASSETS:
        path = assets_dir / name
        if path.is_file():
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            versions[name] = digest[:12]
    return versions


def stamp_knotis_asset_cache_busters(site_dir: Path, assets_dir: Path) -> None:
    versions = knotis_asset_versions(assets_dir)
    if not versions:
        return
    for html_path in site_dir.rglob("*.html"):
        text = html_path.read_text(encoding="utf-8")
        updated = text
        for name, version in versions.items():
            pattern = rf'((?:href|src)="[^"]*/{re.escape(name)})(?:\?v=[^"]*)?(")'
            updated = re.sub(pattern, rf"\1?v={version}\2", updated)
        if updated != text:
            html_path.write_text(updated, encoding="utf-8")


def knotis_search_enabled(repo_root: Path) -> bool:
    toml_path = repo_root / "zensical.toml"
    try:
        with toml_path.open("rb") as handle:
            data = tomllib.load(handle)
    except (FileNotFoundError, OSError, tomllib.TOMLDecodeError):
        return True

    project = data.get("project", {})
    extra = project.get("extra", {}) if isinstance(project, dict) else {}
    knotis = extra.get("knotis", {}) if isinstance(extra, dict) else {}
    search = knotis.get("search", {}) if isinstance(knotis, dict) else {}
    enabled = search.get("enabled") if isinstance(search, dict) else None
    return enabled if isinstance(enabled, bool) else True


def clean_search_index(site_dir: Path, repo_root: Path | None = None) -> None:
    """Remove Zensical search artifacts when Knotis search owns the search UI."""
    if repo_root is not None and not knotis_search_enabled(repo_root):
        return

    legacy_script = site_dir / "javascripts" / "search-cleanup.js"
    if legacy_script.exists():
        legacy_script.unlink()

    search_path = site_dir / "search.json"
    if search_path.exists():
        search_path.unlink()

    workers_dir = site_dir / "assets" / "javascripts" / "workers"
    if workers_dir.is_dir():
        for worker_path in workers_dir.glob("search*.js"):
            worker_path.unlink()
        try:
            workers_dir.rmdir()
        except OSError:
            pass


def _iter_nav_paths(nav_items: list) -> list[str]:
    paths: list[str] = []
    for item in nav_items:
        if isinstance(item, str):
            paths.append(item.replace("\\", "/"))
        elif isinstance(item, dict):
            for _label, value in item.items():
                if isinstance(value, str):
                    paths.append(value.replace("\\", "/"))
                elif isinstance(value, list):
                    paths.extend(_iter_nav_paths(value))
    return paths


def _nav_path_for_filename(repo_root: Path, filename: str) -> str | None:
    toml_path = repo_root / "zensical.toml"
    try:
        with toml_path.open("rb") as handle:
            data = tomllib.load(handle)
    except (FileNotFoundError, OSError, tomllib.TOMLDecodeError):
        return None

    project = data.get("project", {})
    nav = project.get("nav", []) if isinstance(project, dict) else []
    if not isinstance(nav, list):
        return None

    for path in _iter_nav_paths(nav):
        if path.split("/")[-1] == filename:
            return path
    return None


def clean_generated_page_routes(repo_root: Path) -> None:
    site_dir = repo_root / "site"
    docs_dir = repo_root / "docs"
    for filename in GENERATED_PAGE_FILENAMES:
        nav_path = _nav_path_for_filename(repo_root, filename)
        if not nav_path or nav_path == filename or (docs_dir / filename).exists():
            continue

        route_name = filename.removesuffix(".md")
        stale_dir = site_dir / route_name
        if stale_dir.is_dir():
            shutil.rmtree(stale_dir)
            print(f"[knotis] Removed stale generated route {stale_dir}")

        stale_file = site_dir / f"{route_name}.html"
        if stale_file.is_file():
            stale_file.unlink()
            print(f"[knotis] Removed stale generated route {stale_file}")


def _normalize_generated_page_front_matter_text(text: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return text

    end = None
    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            end = idx
            break
    if end is None:
        return text

    inner: list[str] = []
    for line in lines[1:end]:
        if line.strip().startswith("knotis_generated:"):
            while inner and not inner[-1].strip():
                inner.pop()
        inner.append(line)

    updated = "\n".join([lines[0], *inner, *lines[end:]])
    if text.endswith("\n"):
        updated += "\n"
    return updated


def normalize_generated_page_front_matter(repo_root: Path) -> None:
    docs_dir = repo_root / "docs"
    if not docs_dir.is_dir():
        return

    for filename in GENERATED_PAGE_FILENAMES:
        for path in docs_dir.rglob(filename):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            updated = _normalize_generated_page_front_matter_text(text)
            if updated != text:
                path.write_text(updated, encoding="utf-8")
                print(f"[knotis] Normalized generated page front matter {path}")


def sync_source_styles(repo_root: Path) -> None:
    """Knotis CSS is mirrored by the builder."""
    return


def zensical_env(repo_root: Path) -> dict[str, str]:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH")
    root_path = str(repo_root)
    env["PYTHONPATH"] = root_path if not existing else f"{root_path}{os.pathsep}{existing}"
    return env


def _snapshot_generated_runtime_assets(repo_root: Path) -> dict[str, bytes]:
    source_dir = runtime_asset_output_dir(repo_root, repo_root / "docs")
    snapshots: dict[str, bytes] = {}
    for name in GENERATED_ASSET_FILES:
        path = source_dir / name
        if path.is_file():
            snapshots[name] = path.read_bytes()
    return snapshots


def _restore_generated_runtime_assets(repo_root: Path, snapshots: dict[str, bytes]) -> None:
    if not snapshots:
        return
    source_dir = runtime_asset_output_dir(repo_root, repo_root / "docs")
    source_dir.mkdir(parents=True, exist_ok=True)
    for name, content in snapshots.items():
        path = source_dir / name
        if path.is_file() and path.read_bytes() == content:
            continue
        path.write_bytes(content)


def refresh_zensical_build_overlay(repo_root: Path) -> bool:
    """Regenerate .zensical.knotis.build.toml from zensical.toml without running Zensical."""
    source = repo_root / "zensical.toml"
    if not source.is_file():
        return False

    dest = repo_root / ".zensical.knotis.build.toml"
    previous = dest.read_text(encoding="utf-8") if dest.is_file() else None
    resolved = resolve_zensical_config_path(repo_root)
    if resolved == source:
        return False
    if not dest.is_file():
        return False
    current = dest.read_text(encoding="utf-8")
    return current != previous


def run_zensical_build(repo_root: Path, extra_args: list[str] | None = None) -> int:
    extra_args = list(extra_args or [])
    clean_cache = "--no-clean" not in extra_args
    extra_args = [arg for arg in extra_args if arg != "--no-clean"]
    generated_asset_snapshots = _snapshot_generated_runtime_assets(repo_root)

    args = [*resolve_zensical_command(), "build"]
    if clean_cache and "--clean" not in extra_args and "-c" not in extra_args:
        args.append("--clean")
    args.extend(["-f", str(resolve_zensical_config_path(repo_root)), *extra_args])

    result = subprocess.run(args, env=zensical_env(repo_root))
    if result.returncode == 0:
        _restore_generated_runtime_assets(repo_root, generated_asset_snapshots)
        sync_site_runtime_assets(repo_root)
        clean_search_index(repo_root / "site", repo_root)
        stamp_knotis_asset_cache_busters(repo_root / "site", site_runtime_assets_dir(repo_root))
    return result.returncode
