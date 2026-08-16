#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

from . import knotis_site_io as site_io

GRAPH_PAGE = "site-graph.md"
LEGACY_GRAPH_PAGE = "graph.md"
GRAPH_PAGE_FILENAMES = (GRAPH_PAGE, LEGACY_GRAPH_PAGE)
GRAPH_PAGE_MARKER = "site-graph-page"


def _graph_page_path() -> Path:
    for filename in GRAPH_PAGE_FILENAMES:
        page_rel = site_io.nav_path_for_filename(filename)
        if page_rel:
            return site_io.DOCS_DIR / page_rel

    legacy_path = site_io.DOCS_DIR / LEGACY_GRAPH_PAGE
    if legacy_path.is_file():
        try:
            if _is_generated_graph_page(legacy_path.read_text(encoding="utf-8")):
                return legacy_path
        except OSError:
            pass

    return site_io.DOCS_DIR / GRAPH_PAGE


def _is_generated_graph_page(raw: str) -> bool:
    return (
        site_io.is_generated_page(raw, GRAPH_PAGE_MARKER)
        or '<div id="graph-container"' in raw
    )


def _remove_generated_graph_pages(target_path: Path) -> None:
    for filename in GRAPH_PAGE_FILENAMES:
        for candidate in site_io.DOCS_DIR.rglob(filename):
            if candidate == target_path:
                continue
            try:
                existing_raw = candidate.read_text(encoding="utf-8")
            except Exception:
                continue
            if _is_generated_graph_page(existing_raw):
                candidate.unlink()
                print(f"[build_wikilinks] Removed generated {candidate.relative_to(site_io.DOCS_DIR)}", file=sys.stderr)


def cleanup_generated_pages() -> None:
    _remove_generated_graph_pages(_graph_page_path())


def _front_matter_for_page(page_path: Path) -> list[str]:
    front_matter_lines: list[str] = []
    if page_path.exists():
        try:
            existing_raw = page_path.read_text(encoding="utf-8")
            front_matter_lines = site_io.extract_raw_front_matter_lines(existing_raw)
        except Exception:
            front_matter_lines = []

    front_matter_lines = site_io.ensure_front_matter(front_matter_lines)
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "title",
        ['title: "Site graph"'],
    )
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "icon",
        ["icon: fontawesome/solid/circle-nodes"],
    )
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "tags",
        ["tags:", "  -"],
    )
    front_matter_lines = site_io.ensure_front_matter_list_item(front_matter_lines, "hide", "toc")
    return site_io.ensure_generated_page_marker(front_matter_lines, GRAPH_PAGE_MARKER)


def maybe_generate(knotis_config: dict | None) -> None:
    site_graph_config = knotis_config.get("site_graph", {}) if isinstance(knotis_config, dict) else {}
    graph_config = site_graph_config.get("graph", {}) if isinstance(site_graph_config, dict) else {}
    page_path = _graph_page_path()

    if not graph_config.get("enabled", True):
        for filename in GRAPH_PAGE_FILENAMES:
            for candidate in site_io.DOCS_DIR.rglob(filename):
                try:
                    existing_raw = candidate.read_text(encoding="utf-8")
                except Exception:
                    continue
                if _is_generated_graph_page(existing_raw):
                    candidate.unlink()
                    print(f"[build_wikilinks] Removed generated {candidate.relative_to(site_io.DOCS_DIR)}", file=sys.stderr)
        return

    lines = [
        *_front_matter_for_page(page_path),
        "",
        '<div id="graph-container" style="width:100%;height:80vh;border:1px solid var(--md-default-fg-color--lightest, rgba(0,0,0,0.12));border-radius:8px;"></div>',
        "",
    ]
    site_io.write_if_changed(page_path, "\n".join(lines))
    _remove_generated_graph_pages(page_path)
