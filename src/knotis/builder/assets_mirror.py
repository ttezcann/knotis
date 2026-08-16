#!/usr/bin/env python3
from __future__ import annotations
"""
assets_mirror.py — Mirror Knotis runtime assets into a site's asset dirs.

Fresh scaffolded sites keep package-owned JS/CSS/data out of docs/assets/ and
sync them into site/assets/ for the built product. Existing sites that still
load assets/knotis-* paths through zensical.toml keep the legacy docs/assets/
mirror for compatibility. Legacy root assets/ folders are also mirrored for
local workspace compatibility. The module seeds the per-site knotis-theme.css
where the site config expects it, and — for sites that do not load the packaged
markdown extensions — drops knotis_slide_markers.py at the site root.
"""

import shutil
import sys
import tomllib
from pathlib import Path

KNOTIS_DIR = Path(__file__).resolve().parents[1]
FRESH_SITE_ASSET_SUBDIR = "knotis"

# Runtime browser assets mirrored into every site.
KNOTIS_ASSET_FILES = (
    "knotis-core.js",
    "knotis-wikilinks.js",
    "knotis-wikilinks.css",
    "knotis-pane.css",
    "knotis-graph.css",
    "knotis-graph.js",
    "d3.min.js",
    "dev-reload.js",
    "knotis-preview-bridge.js",
    "knotis-palette.css",
    "knotis-content-tags.css",
    "knotis-content.css",
    "knotis-search.js",
    "knotis-search.css",
    "knotis-slides.js",
    "knotis-slides.css",
    "knotis-readaloud.js",
    "knotis-readaloud.css",
    "knotis-media.js",
    "knotis-media.css",
    "lunr.min.js",
    "lunr.LICENSE",
)

GENERATED_ASSET_FILES = (
    "content-tags.json",
    "graph.json",
    "knotis-icon-map.js",
    "knotis-search.json",
    "nav_order.json",
    "references.json",
    "wikilinks.json",
)

# Auto-generated pages skipped when scanning: indexing them would create
# circular wikilink references. Generated glossary pages are identified by
# their front matter marker so authored glossary.md pages can still be scanned.
SKIP_FILES = {"glossary.md", "roadmap.md", "zensical-features-demo.md"}

VENDOR_ASSET_FILES = (
    "gifuct-js.min.js",
    "mathjax-3.2.2-tex-mml-chtml.js",
    "mathjax-3.2.2.LICENSE",
    "mermaid-10.9.6.min.js",
    "mermaid-10.9.6.LICENSE",
)


SITE_THEME_OVERRIDE_HEADER = """\
/* Knotis site theme overrides.
 * Color palette defaults ship in assets/knotis-palette.css (synced from the extension).
 * Edit docs/stylesheets/knotis-theme.css for fresh sites, or assets/knotis-theme.css for legacy root-theme sites.
 */

"""


def _project_asset_paths(repo_root: Path) -> list[str]:
    toml_path = repo_root / "zensical.toml"
    try:
        with toml_path.open("rb") as handle:
            data = tomllib.load(handle)
    except (FileNotFoundError, OSError, tomllib.TOMLDecodeError):
        return []

    project = data.get("project", {})
    if not isinstance(project, dict):
        return []

    paths: list[str] = []
    for key in ("extra_css", "extra_javascript"):
        values = project.get(key, [])
        if isinstance(values, list):
            paths.extend(str(value).replace("\\", "/") for value in values)
    return paths


def site_uses_legacy_asset_layout(repo_root: Path) -> bool:
    paths = _project_asset_paths(repo_root)
    if (repo_root / "assets").is_dir():
        return True
    for path in paths:
        if path.startswith("assets/knotis-"):
            return True
        if path.startswith("assets/vendor/"):
            return True
        if path in {"assets/d3.min.js", "assets/lunr.min.js", "assets/lunr.LICENSE"}:
            return True
    return False


def runtime_asset_output_dir(repo_root: Path, docs_dir: Path) -> Path:
    if site_uses_legacy_asset_layout(repo_root):
        return docs_dir / "assets"
    return repo_root / ".knotis" / "assets"


def site_runtime_assets_dir(repo_root: Path, docs_dir: Path | None = None) -> Path:
    site_assets_dir = repo_root / "site" / "assets"
    docs = docs_dir or repo_root / "docs"
    if site_uses_legacy_asset_layout(repo_root):
        return site_assets_dir
    return site_assets_dir / FRESH_SITE_ASSET_SUBDIR


def clean_managed_docs_assets_for_site_only(docs_assets_dir: Path) -> None:
    if not docs_assets_dir.is_dir():
        return
    for fname in (*KNOTIS_ASSET_FILES, *GENERATED_ASSET_FILES, "hashtags.json", "knotis-hashtag.css"):
        path = docs_assets_dir / fname
        if path.is_file():
            path.unlink()
            print(f"[build_wikilinks] Removed managed {path}", file=sys.stderr)
    vendor_dir = docs_assets_dir / "vendor"
    if vendor_dir.is_dir():
        for fname in VENDOR_ASSET_FILES:
            path = vendor_dir / fname
            if path.is_file():
                path.unlink()
                print(f"[build_wikilinks] Removed managed {path}", file=sys.stderr)
        try:
            vendor_dir.rmdir()
        except OSError:
            pass


def clean_managed_site_root_assets_for_fresh_site(site_assets_dir: Path) -> None:
    if not site_assets_dir.is_dir():
        return
    for fname in (*KNOTIS_ASSET_FILES, *GENERATED_ASSET_FILES, "hashtags.json", "knotis-hashtag.css"):
        path = site_assets_dir / fname
        if path.is_file():
            path.unlink()
            print(f"[build_wikilinks] Removed managed {path}", file=sys.stderr)
    vendor_dir = site_assets_dir / "vendor"
    if vendor_dir.is_dir():
        for fname in VENDOR_ASSET_FILES:
            path = vendor_dir / fname
            if path.is_file():
                path.unlink()
                print(f"[build_wikilinks] Removed managed {path}", file=sys.stderr)
        try:
            vendor_dir.rmdir()
        except OSError:
            pass


def mirror_generated_assets(source_assets_dir: Path, site_assets_dir: Path | None) -> None:
    if site_assets_dir is None:
        return
    site_assets_dir.mkdir(parents=True, exist_ok=True)
    for fname in GENERATED_ASSET_FILES:
        src = source_assets_dir / fname
        if not src.is_file():
            continue
        dst = site_assets_dir / fname
        if dst.exists() and src.read_bytes() == dst.read_bytes():
            continue
        shutil.copy2(src, dst)
        print(
            f"[build_wikilinks] Copied {fname} → {_asset_label(site_assets_dir, 'site/assets')}/",
            file=sys.stderr,
        )


def _asset_label(dst_dir: Path, default: str) -> str:
    if dst_dir.parent.name == "docs":
        return "docs/assets"
    if dst_dir.parent.name == ".knotis":
        return ".knotis/assets"
    if dst_dir.parent.name == "assets" and dst_dir.parent.parent.name == "site":
        return f"site/assets/{dst_dir.name}"
    if dst_dir.parent.name not in {"", "."}:
        return f"{dst_dir.parent.name}/{dst_dir.name}"
    return default


def sync_site_runtime_assets(repo_root: Path, docs_dir: Path | None = None) -> None:
    docs = docs_dir or repo_root / "docs"
    output_assets_dir = runtime_asset_output_dir(repo_root, docs)
    root_site_assets_dir = repo_root / "site" / "assets"
    site_assets_dir = site_runtime_assets_dir(repo_root, docs)
    if site_assets_dir != root_site_assets_dir:
        clean_managed_site_root_assets_for_fresh_site(root_site_assets_dir)
    site_assets_dir.mkdir(parents=True, exist_ok=True)

    runtime_assets_candidate = repo_root / "assets"
    runtime_assets_dir = runtime_assets_candidate if runtime_assets_candidate.is_dir() else None
    mirror_runtime_assets(runtime_assets_dir, None, site_assets_dir)
    mirror_vendor_assets(runtime_assets_dir, None, site_assets_dir)
    mirror_generated_assets(output_assets_dir, site_assets_dir)


def _default_site_theme_template() -> Path | None:
    for candidate in (
        KNOTIS_DIR / "scaffold" / "assets" / "knotis-theme.css",
        KNOTIS_DIR / "assets" / "knotis-theme.css",
    ):
        if candidate.is_file() and candidate.stat().st_size > len(SITE_THEME_OVERRIDE_HEADER) + 20:
            return candidate
    return None


def _ensure_site_theme_css(theme_css_path: Path) -> Path | None:
    theme_css_path.parent.mkdir(parents=True, exist_ok=True)
    dst = theme_css_path
    if not dst.exists():
        template = _default_site_theme_template()
        if template is not None:
            shutil.copy2(template, dst)
        else:
            dst.write_text(SITE_THEME_OVERRIDE_HEADER, encoding="utf-8")
        print(f"[build_wikilinks] Seeded {dst}", file=sys.stderr)
    return dst if dst.is_file() else None


def _mirror_site_theme_css(src: Path, *target_dirs: Path | None) -> None:
    if not src.is_file():
        return
    src_bytes = src.read_bytes()
    for dst_dir in target_dirs:
        if dst_dir is None:
            continue
        dst_dir.mkdir(parents=True, exist_ok=True)
        dst = dst_dir / "knotis-theme.css"
        if src.resolve() == dst.resolve():
            continue
        if dst.exists() and src_bytes == dst.read_bytes():
            continue
        dst.write_bytes(src_bytes)
        label = dst_dir.name
        if dst_dir.parent.name == "docs":
            label = "docs/assets"
        elif dst_dir.parent.name not in {"", "."}:
            label = f"{dst_dir.parent.name}/{dst_dir.name}"
        print(f"[build_wikilinks] Mirrored knotis-theme.css → {label}/", file=sys.stderr)


def mirror_runtime_assets(
    runtime_assets_dir: Path | None,
    assets_dir: Path | None,
    site_assets_dir: Path | None,
) -> None:
    for fname in KNOTIS_ASSET_FILES:
        src = KNOTIS_DIR / "assets" / fname
        if not src.exists():
            continue
        src_bytes = src.read_bytes()
        for label, dst_dir in (
            ("assets", runtime_assets_dir if runtime_assets_dir and runtime_assets_dir.is_dir() else None),
            ("docs/assets", assets_dir),
            ("site/assets", site_assets_dir if site_assets_dir and site_assets_dir.is_dir() else None),
        ):
            if dst_dir is None:
                continue
            dst = dst_dir / fname
            if src.resolve() == dst.resolve():
                continue
            # Only copy if content differs — avoids triggering file-watch rebuild loops
            if dst.exists() and src_bytes == dst.read_bytes():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            print(f"[build_wikilinks] Copied {fname} → {_asset_label(dst_dir, label)}/", file=sys.stderr)

    legacy_css_names = ("knotis-hashtag.css",)
    for dst_dir in (
        runtime_assets_dir if runtime_assets_dir and runtime_assets_dir.is_dir() else None,
        assets_dir,
        site_assets_dir if site_assets_dir and site_assets_dir.is_dir() else None,
    ):
        if dst_dir is None:
            continue
        for legacy_name in legacy_css_names:
            legacy_path = dst_dir / legacy_name
            if legacy_path.is_file():
                legacy_path.unlink()
                label = dst_dir.name
                if dst_dir.parent.name == "docs":
                    label = "docs/assets"
                elif dst_dir.parent.name not in {"", "."}:
                    label = f"{dst_dir.parent.name}/{dst_dir.name}"
                print(f"[build_wikilinks] Removed legacy {legacy_name} from {label}/", file=sys.stderr)


def mirror_vendor_assets(
    runtime_assets_dir: Path | None,
    assets_dir: Path | None,
    site_assets_dir: Path | None,
) -> None:
    for fname in VENDOR_ASSET_FILES:
        src = KNOTIS_DIR / "assets" / "vendor" / fname
        if not src.exists():
            continue
        src_bytes = src.read_bytes()
        for label, dst_dir in (
            ("assets/vendor", runtime_assets_dir if runtime_assets_dir and runtime_assets_dir.is_dir() else None),
            ("docs/assets/vendor", assets_dir),
            ("site/assets/vendor", site_assets_dir if site_assets_dir and site_assets_dir.is_dir() else None),
        ):
            if dst_dir is None:
                continue
            dst = dst_dir / "vendor" / fname
            if src.resolve() == dst.resolve():
                continue
            if dst.exists() and src_bytes == dst.read_bytes():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            print(f"[build_wikilinks] Copied vendor/{fname} → {_asset_label(dst_dir, label)}/vendor/", file=sys.stderr)


def mirror_markdown_extension_fallback(repo_root: Path) -> None:
    extensions_dir = KNOTIS_DIR / "markdown"
    src = extensions_dir / "knotis_slide_markers.py"
    if not src.exists():
        return
    dst = repo_root / src.name
    src_bytes = src.read_bytes()
    if not dst.exists() or src_bytes != dst.read_bytes():
        shutil.copy2(src, dst)
        print(f"[build_wikilinks] Copied {src.name} → site root/", file=sys.stderr)
