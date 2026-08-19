#!/usr/bin/env python3
from __future__ import annotations
"""
build_wikilinks.py — Parse [[wikilinks]] from all docs/**/*.md files and emit:
  - site/assets/wikilinks.json  (backlinks index; docs/assets on legacy sites)
  - site/assets/graph.json      (nodes + edges for graph view; docs/assets on legacy sites)
"""

import json
import re
import shutil
import sys
import tomllib
from copy import deepcopy
from html import escape as html_escape
from html import unescape as html_unescape
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from . import generate_glossary
from . import generate_content_tags
from . import generate_site_graph
from . import content_tag_colors
from . import knotis_site_io
from . import moc_nav
from .knotis_site_io import write_if_changed as _write_if_changed
from .config_defaults import (
    KNOTIS_BASE_VIEW_DEFAULTS,
    KNOTIS_CONCEPT_GRAPH_DEFAULTS,
    KNOTIS_DEFAULT_CONFIG,
    KNOTIS_DEPRECATED_RUNTIME_COLOR_KEYS,
    KNOTIS_PAGE_GRAPH_DEFAULTS,
    KNOTIS_RUNTIME_COLOR_KEYS,
    KNOTIS_SITE_GRAPH_DEFAULTS,
    VALID_BOOL_AUTO,
    VALID_CONCEPT_GRAPH_VIEWS,
    VALID_CONCEPT_PRIMARY_PAGES,
    VALID_CONTEXT_SCOPES,
    VALID_FIT_MODES,
    VALID_GLOSSARY_DEFAULT_VIEWS,
    VALID_HOVER_MODES,
    VALID_LABEL_MODES,
    VALID_PAGE_EDGE_MODES,
    VALID_PAGE_FILTERS,
    VALID_PANE_EDGE_CONTEXT_MODES,
    VALID_PANE_EDGE_GAP_MODES,
    VALID_PANE_KEYWORD_CONTEXT_MODES,
    VALID_RELATIONS,
    VALID_SEEDS,
    VALID_SIZE_METRICS,
    VALID_SLIDE_FIT_MODES,
    VALID_SORT_METRICS,
    _deep_merge_dicts,
)
from .config_normalize import (
    _build_graph_meta,
    _display_graph_tag_label,
    _finalize_graph_exclusions,
    _finalize_content_tag_colors,
    _finalize_slides_page_scope,
    _load_site_knotis_config,
    _load_site_nav,
    _load_toml_knotis_config,
    _load_toml_nav,
    _normalize_bool,
    _normalize_bool_auto,
    _normalize_content_config,
    _normalize_css_value,
    _normalize_enum,
    _normalize_float,
    _normalize_graph_tag_key,
    _normalize_int,
    _normalize_knotis_config,
    _normalize_page_exclusion_config,
    _normalize_wikilink_exclusion_keywords,
    _normalize_path_config,
    _normalize_percent,
    _normalize_readaloud_config,
    _normalize_search_config,
    _normalize_site_graph_config,
    _normalize_site_graph_tag_descriptor,
    _normalize_slides_config,
    _normalize_string_list,
    _normalize_view_config,
    _warn_knotis_config,
)
from .knotis_site_io import nav_path_to_url as _nav_path_to_url
from .scan_context import (
    ADMONITION_RE,
    FENCE_RE,
    CONTENT_TAG_RE,
    HTML_COMMENT_RE,
    KNOTIS_METADATA_ATTR_RE,
    LIST_ITEM_RE,
    WIKILINK_RE,
    _build_code_block_ranges,
    _build_fenced_code_line_mask,
    _build_inline_code_ranges,
    _flatten_special_blocks,
    _inside_any_range,
    _inside_code_block,
    _is_markdown_heading_marker,
    _line_indent,
    _line_index_for_pos,
    _list_marker,
    _mask_html_comments,
    _strip_knotis_metadata_attrs,
    _strip_markdown,
    _strip_slide_anchor_markers,
    _strip_trailing_heading_attrs,
    _trim_trailing_blank_lines,
    build_current_heading_line_map,
    build_heading_keyword_map,
    build_heading_parent_keyword_map,
    build_heading_path_map,
    build_linked_list_ancestor_chain_map,
    build_list_parent_line_map,
    build_paragraph_group_map,
    build_parent_chain_map,
    extract_nonreference_wikilink_targets,
    extract_wikilink_targets,
    find_transparent_list_parent_keyword,
    get_bullet_context,
    get_context,
    get_extended_context,
    get_content_tag_section_content,
    get_section_content,
    heading_has_single_keyword_definition,
    heading_line_label,
    infer_keyword_from_plain_heading,
    infer_paragraph_parent_keyword,
    is_comparison_heading_section,
    is_css_hex_color_token,
    is_valid_wikilink_raw,
    normalize,
    normalize_content_tag,
    page_title_from_path,
    parse_heading_line,
    parse_list_hierarchy,
    parse_list_item,
    split_wikilink_parts,
    wikilink_label,
    wikilink_mode,
)
from .parse_files import (
    parse_content_tags_file,
    parse_md_file,
)
from .graph_build import (
    build_graph,
    build_nav_hierarchy,
    build_nav_order,
)
from .search_index import (
    SEARCH_MAX_SECTION_LEVEL,
    SEARCH_SEPARATOR,
    _best_wikilink_entry_for_section,
    _clean_search_context_line,
    _clean_search_match_text,
    _clean_search_render_inline,
    _clean_search_text,
    _compact_context_lines,
    _enrich_search_doc_with_wikilink_section,
    _extract_search_concepts,
    _extract_search_content_tags,
    _knotis_search_id,
    _remove_search_excluded_markdown_sections,
    _search_breadcrumb_from_stack,
    _search_context_lines,
    _search_fence_stripped,
    _search_heading_from_line,
    _search_key,
    _search_line_parts,
    _search_metadata_from_lines,
    _search_render_context_lines,
    _slugify_search_heading,
    _strip_wikilink_markup,
    _wikilink_entry_rank,
    _reference_search_occurrence_doc,
    _wikilink_search_mention_doc,
    build_knotis_search_index,
    build_knotis_search_shell,
    parse_search_page_entries,
    write_knotis_search_index,
)
from .assets_mirror import (
    KNOTIS_ASSET_FILES,
    SITE_THEME_OVERRIDE_HEADER,
    SKIP_FILES,
    _default_site_theme_template,
    _ensure_site_theme_css,
    _mirror_site_theme_css,
    clean_managed_docs_assets_for_site_only,
    mirror_runtime_assets,
    mirror_vendor_assets,
    mirror_generated_assets,
    runtime_asset_output_dir,
    site_uses_legacy_asset_layout,
)
from .frontmatter import (
    _front_matter_tags,
    _page_excluded_from_search,
    _split_front_matter,
    _extract_knotis_block,
    _next_yaml_content_line,
    _parse_yaml_list_block,
    _parse_yaml_map_block,
    _parse_yaml_scalar_value,
    _split_inline_yaml_list,
    _strip_yaml_comment,
    _yaml_scalar,
)

# ── Config ────────────────────────────────────────────────────────────────────

# Package source directory; `main()` resolves the active site root at runtime.
KNOTIS_DIR = Path(__file__).resolve().parents[1]


def _read_zensical_toml() -> dict:
    return knotis_site_io.read_zensical_toml()


REPO_ROOT = Path(__file__).parent.parent
DOCS_DIR = REPO_ROOT / "docs"
ASSETS_DIR = DOCS_DIR / "assets"


def _nav_markdown_files(nav_items: list | None) -> list[Path]:
    files: list[Path] = []
    docs_root = DOCS_DIR.resolve()

    def add(path_value: str) -> None:
        normalized = path_value.replace("\\", "/")
        if not normalized.endswith(".md"):
            return
        path = DOCS_DIR / normalized
        try:
            path.resolve().relative_to(docs_root)
        except ValueError:
            return
        if path.is_file():
            files.append(path)

    def walk(items: list) -> None:
        for item in items:
            if isinstance(item, str):
                add(item)
            elif isinstance(item, list):
                walk(item)
            elif isinstance(item, dict):
                for value in item.values():
                    if isinstance(value, str):
                        add(value)
                    elif isinstance(value, list):
                        walk(value)

    walk(nav_items or [])
    return files


def _is_scan_skipped_md_file(md_path: Path) -> bool:
    if md_path.name in {"roadmap.md", "zensical-features-demo.md"}:
        return True
    if md_path.name not in SKIP_FILES:
        return False
    try:
        raw = md_path.read_text(encoding="utf-8")
    except OSError:
        return False
    return "knotis_generated: glossary-page" in raw


def page_url_from_path(md_path: Path) -> str:
    """Convert a docs-relative md path to a site URL fragment."""
    rel = md_path.relative_to(DOCS_DIR)
    # index.md → parent dir URL; other files → dir with stem
    if rel.stem == "index":
        url = str(rel.parent) + "/"
    else:
        url = str(rel.parent / rel.stem) + "/"
    # Normalise Windows separators
    return url.replace("\\", "/")


# ── Main ──────────────────────────────────────────────────────────────────────

def main(docs_dir: Path | None = None, skip_site_mirror: bool = False) -> None:
    global DOCS_DIR, ASSETS_DIR, REPO_ROOT
    if docs_dir is not None and docs_dir.is_dir():
        DOCS_DIR = docs_dir
        ASSETS_DIR = docs_dir / "assets"
        REPO_ROOT = docs_dir.parent
    else:
        # Package imports point at knotis/src/knotis, not the active site root.
        # Find the site root by searching upward from CWD for a directory that
        # contains both zensical.toml and docs/.
        candidate = Path.cwd()
        found = None
        for _ in range(6):
            if (candidate / "zensical.toml").exists() and (candidate / "docs").is_dir():
                found = candidate
                break
            candidate = candidate.parent
        if found is None:
            # Fallback for direct script-style invocation.
            found = Path(sys.argv[0]).absolute().parent.parent
        REPO_ROOT = found
        DOCS_DIR = REPO_ROOT / "docs"
        ASSETS_DIR = DOCS_DIR / "assets"
    DOCS_ASSETS_DIR = DOCS_DIR / "assets"
    legacy_asset_layout = site_uses_legacy_asset_layout(REPO_ROOT)
    ASSETS_DIR = runtime_asset_output_dir(REPO_ROOT, DOCS_DIR)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    DOCS_ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    if not legacy_asset_layout:
        clean_managed_docs_assets_for_site_only(DOCS_ASSETS_DIR)
    site_assets_dir = None if skip_site_mirror else REPO_ROOT / "site" / "assets"
    site_asset_output_dir = site_assets_dir if site_assets_dir and site_assets_dir.is_dir() else None
    knotis_site_io.configure(docs_dir=DOCS_DIR, repo_root=REPO_ROOT)

    site_config = _read_zensical_toml()
    project_config = site_config.get("project", {}) if isinstance(site_config.get("project"), dict) else {}
    extra_css = project_config.get("extra_css", []) if isinstance(project_config, dict) else []
    if not isinstance(extra_css, list):
        extra_css = []
    uses_root_theme_css = "assets/knotis-theme.css" in extra_css
    uses_docs_theme_css = "stylesheets/knotis-theme.css" in extra_css

    runtime_assets_candidate = REPO_ROOT / "assets"
    runtime_assets_dir = runtime_assets_candidate if runtime_assets_candidate.is_dir() or uses_root_theme_css else None
    if runtime_assets_dir is not None:
        runtime_assets_dir.mkdir(parents=True, exist_ok=True)

    mirror_runtime_assets(runtime_assets_dir, ASSETS_DIR, site_asset_output_dir)
    mirror_vendor_assets(runtime_assets_dir, ASSETS_DIR, site_asset_output_dir)

    from .generate_icon_map import write_icon_map

    if not legacy_asset_layout:
        _ensure_site_theme_css(DOCS_DIR / "stylesheets" / "knotis-theme.css")
    elif uses_docs_theme_css:
        _ensure_site_theme_css(DOCS_DIR / "stylesheets" / "knotis-theme.css")
    elif runtime_assets_dir is not None:
        theme_css = _ensure_site_theme_css(runtime_assets_dir / "knotis-theme.css")
        if theme_css is not None:
            _mirror_site_theme_css(theme_css, ASSETS_DIR, site_asset_output_dir)

    generate_site_graph.cleanup_generated_pages()
    generate_glossary.cleanup_generated_pages()
    generate_content_tags.cleanup_generated_pages()

    # Skip auto-generated files that would create circular wikilink references
    md_files = sorted(
        p for p in DOCS_DIR.rglob("*.md") if not _is_scan_skipped_md_file(p)
    )
    write_icon_map(md_files, ASSETS_DIR, runtime_assets_dir, site_asset_output_dir)
    print(f"[build_wikilinks] Scanning {len(md_files)} Markdown files…", file=sys.stderr)

    all_occurrences: list[dict] = []
    all_content_tag_occurrences: list[dict] = []
    for md_path in md_files:
        try:
            all_occurrences.extend(parse_md_file(md_path))
            all_content_tag_occurrences.extend(parse_content_tags_file(md_path))
        except Exception as exc:
            print(f"  WARNING: could not parse {md_path}: {exc}", file=sys.stderr)

    print(f"[build_wikilinks] Found {len(all_occurrences)} wikilink occurrences.", file=sys.stderr)
    print(f"[build_wikilinks] Found {len(all_content_tag_occurrences)} content tag occurrences.", file=sys.stderr)

    # ── wikilinks.json ────────────────────────────────────────────────────────
    # Count per-(page, keyword) occurrences so the frontend can build deep-link anchors
    occ_counter: dict[tuple[str, str], int] = {}
    for occ in all_occurrences:
        key = (occ["page_url"], occ["keyword"])
        idx = occ_counter.get(key, 0)
        occ["occurrence_index"] = idx
        occ_counter[key] = idx + 1

    reference_keywords = {
        occ["keyword"]
        for occ in all_occurrences
        if occ.get("mode") == "reference"
    }
    print(f"[build_wikilinks] Found {len(reference_keywords)} reference concepts.", file=sys.stderr)
    indexed_occurrences = [
        occ for occ in all_occurrences
        if occ["keyword"] not in reference_keywords or occ.get("mode") == "reference"
    ]

    def _build_wikilinks_index(occurrences: list[dict]) -> dict[str, list[dict]]:
        index: dict[str, list[dict]] = {}
        for occ in occurrences:
            kw = occ["keyword"]
            entry = {
                "title": occ.get("title", kw),
                "page_title": occ["page_title"],
                "page_url": occ["page_url"],
                "context": occ["context"],
                "extended_context": occ.get("extended_context"),
                "parent_item": occ["parent_item"],
                "child_items": occ["child_items"],
                "occurrence_index": occ["occurrence_index"],
                "mode": occ.get("mode", "concept"),
                "heading_path": occ.get("heading_path", []),
                "parent_chain": occ.get("parent_chain", []),
                "section_lines": occ.get("section_lines", []),
                "section_lines_raw": occ.get("section_lines_raw", []),
                "section_kw_offset": occ.get("section_kw_offset", 0),
                "line_idx": occ.get("line_idx", 0),
            }
            index.setdefault(kw, []).append(entry)
        # Sort: current-page-first ordering is done client-side; here sort by page_title
        for kw in index:
            index[kw].sort(key=lambda e: e["page_title"])
        return index

    wikilinks_index = _build_wikilinks_index(indexed_occurrences)

    wikilinks_out = ASSETS_DIR / "wikilinks.json"
    wikilinks_json = json.dumps(wikilinks_index, indent=2, ensure_ascii=False)
    _write_if_changed(wikilinks_out, wikilinks_json)
    if site_asset_output_dir:
        _write_if_changed(site_asset_output_dir / "wikilinks.json", wikilinks_json)

    # ── content-tags.json ─────────────────────────────────────────────────────
    content_tag_counter: dict[tuple[str, str], int] = {}
    for occ in all_content_tag_occurrences:
        key = (occ["page_url"], occ["content_tag"])
        idx = content_tag_counter.get(key, 0)
        occ["occurrence_index"] = idx
        content_tag_counter[key] = idx + 1

    content_tags_index: dict[str, list[dict]] = {}
    for occ in all_content_tag_occurrences:
        tag = occ["content_tag"]
        entry = {
            "page_title": occ["page_title"],
            "page_url": occ["page_url"],
            "context": occ["context"],
            "extended_context": occ.get("extended_context"),
            "parent_item": occ["parent_item"],
            "child_items": occ["child_items"],
            "occurrence_index": occ["occurrence_index"],
            "heading_path": occ.get("heading_path", []),
            "parent_chain": occ.get("parent_chain", []),
            "section_lines": occ.get("section_lines", []),
            "section_lines_raw": occ.get("section_lines_raw", []),
            "section_kw_offset": occ.get("section_kw_offset", 0),
        }
        content_tags_index.setdefault(tag, []).append(entry)

    for tag in content_tags_index:
        content_tags_index[tag].sort(key=lambda e: e["page_title"])

    content_tags_out = ASSETS_DIR / "content-tags.json"
    content_tags_json = json.dumps(content_tags_index, indent=2, ensure_ascii=False)
    _write_if_changed(content_tags_out, content_tags_json)
    legacy_content_tags_out = ASSETS_DIR / "hashtags.json"
    if legacy_content_tags_out.exists():
        legacy_content_tags_out.unlink()
        print(f"[build_wikilinks] Removed legacy {legacy_content_tags_out}", file=sys.stderr)
    if site_asset_output_dir:
        _write_if_changed(site_asset_output_dir / "content-tags.json", content_tags_json)
        legacy_site_content_tags_out = site_asset_output_dir / "hashtags.json"
        if legacy_site_content_tags_out.exists():
            legacy_site_content_tags_out.unlink()
            print(f"[build_wikilinks] Removed legacy {legacy_site_content_tags_out}", file=sys.stderr)

    # ── references.json ───────────────────────────────────────────────────────
    references_index: dict[str, list[dict]] = {}
    for occ in indexed_occurrences:
        if occ.get("mode") != "reference":
            continue
        kw = occ["keyword"]
        references_index.setdefault(kw, []).append(
            {
                "title": occ.get("title", kw),
                "page_title": occ["page_title"],
                "page_url": occ["page_url"],
                "context": occ["context"],
                "extended_context": occ.get("extended_context"),
                "parent_item": occ["parent_item"],
                "child_items": occ["child_items"],
                "occurrence_index": occ["occurrence_index"],
                "mode": "reference",
                "heading_path": occ.get("heading_path", []),
                "parent_chain": occ.get("parent_chain", []),
                "section_lines": occ.get("section_lines", []),
                "section_lines_raw": occ.get("section_lines_raw", []),
                "section_kw_offset": occ.get("section_kw_offset", 0),
                "line_idx": occ.get("line_idx", 0),
            }
        )
    for kw in references_index:
        references_index[kw].sort(key=lambda e: e["page_title"])

    references_out = ASSETS_DIR / "references.json"
    references_json = json.dumps(references_index, indent=2, ensure_ascii=False)
    _write_if_changed(references_out, references_json)
    if site_asset_output_dir:
        _write_if_changed(site_asset_output_dir / "references.json", references_json)

    raw_nav_items = _load_site_nav()
    moc_configs = moc_nav.load_moc_configs(REPO_ROOT, DOCS_DIR)
    nav_items = moc_nav.apply_moc_nav_to_items(raw_nav_items, moc_configs)
    graph_page_files = sorted(
        {*md_files, *(p for p in _nav_markdown_files(nav_items) if _is_scan_skipped_md_file(p))}
    )
    nav_order = build_nav_order(nav_items)
    raw_knotis_config = _load_site_knotis_config()
    normalized_knotis_config = _normalize_knotis_config(raw_knotis_config)
    _finalize_content_tag_colors(normalized_knotis_config, content_tags_index, all_content_tag_occurrences)

    # ── knotis-search.json ───────────────────────────────────────────────
    search_config = normalized_knotis_config.get("search", {})
    search_excluded_urls = knotis_site_io.resolve_skip_page_urls(
        search_config,
        md_files,
        config_prefix="knotis.search",
    )
    if search_excluded_urls or search_config.get("exclude_wikilinks"):
        print(
            "[build_wikilinks] Search exclusions:"
            f" paths={sorted(search_excluded_urls)}"
            f" wikilinks={search_config.get('exclude_wikilinks', [])}",
            file=sys.stderr,
        )

    excluded_keywords = set(
        _normalize_wikilink_exclusion_keywords(
            search_config.get("exclude_wikilinks", []),
            "knotis.search.exclude_wikilinks",
            {occ["keyword"] for occ in indexed_occurrences},
        )
    )

    if search_config.get("enabled", True):
        search_index = build_knotis_search_index(
            md_files,
            wikilinks_index,
            references_index,
            content_tags_index,
            search_config,
            nav_order,
            excluded_page_urls=search_excluded_urls,
            excluded_keywords=excluded_keywords,
            knotis_defaults=normalized_knotis_config.get("defaults"),
        )
    else:
        search_index = build_knotis_search_shell(
            search_config,
            [],
            knotis_defaults=normalized_knotis_config.get("defaults"),
        )
    write_knotis_search_index(search_index, search_config, site_asset_output_dir, ASSETS_DIR)

    # ── graph.json ────────────────────────────────────────────────────────────
    _finalize_graph_exclusions(
        normalized_knotis_config,
        md_files,
        indexed_occurrences,
    )
    site_exclusions = normalized_knotis_config.get("site_graph", {}).get("graph", {})
    page_exclusions = normalized_knotis_config.get("page_graph", {}).get("graph", {})
    concept_exclusions = normalized_knotis_config.get("concept_graph", {}).get("graph", {})
    if (
        site_exclusions.get("exclude_paths")
        or site_exclusions.get("exclude_wikilinks")
        or page_exclusions.get("exclude_paths")
        or page_exclusions.get("exclude_wikilinks")
        or concept_exclusions.get("exclude_paths")
        or concept_exclusions.get("exclude_wikilinks")
    ):
        print(
            "[build_wikilinks] Graph exclusions:"
            f" site_paths={site_exclusions.get('exclude_paths', [])}"
            f" site_wikilinks={site_exclusions.get('exclude_wikilinks', [])}"
            f" page_paths={page_exclusions.get('exclude_paths', [])}"
            f" page_wikilinks={page_exclusions.get('exclude_wikilinks', [])}"
            f" concept_paths={concept_exclusions.get('exclude_paths', [])}"
            f" concept_wikilinks={concept_exclusions.get('exclude_wikilinks', [])}",
            file=sys.stderr,
        )

    graph = build_graph(
        indexed_occurrences,
        graph_page_files,
        nav_items,
        graph_view_config=normalized_knotis_config,
        page_graph_occurrences=all_occurrences,
        moc_page_urls=moc_nav.moc_page_urls(moc_configs),
    )
    graph_out = ASSETS_DIR / "graph.json"
    graph_json = json.dumps(graph, indent=2, ensure_ascii=False)
    _write_if_changed(graph_out, graph_json)
    if site_asset_output_dir:
        _write_if_changed(site_asset_output_dir / "graph.json", graph_json)

    # ── nav_order.json ────────────────────────────────────────────────────────
    nav_order_out = ASSETS_DIR / "nav_order.json"
    nav_order_json = json.dumps(nav_order, indent=2, ensure_ascii=False)
    _write_if_changed(nav_order_out, nav_order_json)
    if site_asset_output_dir:
        _write_if_changed(site_asset_output_dir / "nav_order.json", nav_order_json)
    mirror_generated_assets(ASSETS_DIR, site_asset_output_dir)

    # ── generated pages ──────────────────────────────────────────────────────
    generate_site_graph.maybe_generate(normalized_knotis_config)
    generate_glossary.maybe_generate(
        normalized_knotis_config,
        wikilinks_index,
        nav_order,
        indexed_occurrences,
        md_files,
    )
    generate_content_tags.maybe_generate(normalized_knotis_config)


def on_pre_build(config, **kwargs):
    """Build hook — called automatically before every build and hot-reload."""
    docs = Path(config.get("docs_dir", ""))
    if not docs.is_dir():
        print(f"[build_wikilinks] WARNING: docs_dir '{docs}' not found, using default", file=sys.stderr)
        docs = None
    main(docs_dir=docs)


def on_serve(server, config, builder, **kwargs):
    """Serve hook — watch source inputs that should refresh graph/context data locally."""
    docs = Path(config.get("docs_dir", "")) if config else DOCS_DIR
    if not docs.is_dir():
        docs = DOCS_DIR
    repo_root = docs.parent if docs else REPO_ROOT
    shared_script = Path(__file__).resolve()
    watch_targets = [
        docs / "**" / "*.md",
        repo_root / "zensical.toml",
        shared_script,
        KNOTIS_DIR / "assets" / "*.js",
        KNOTIS_DIR / "assets" / "*.css",
        KNOTIS_DIR / "assets" / "*.min.js",
        KNOTIS_DIR / "builder" / "*.py",
        KNOTIS_DIR / "markdown" / "*.py",
    ]

    for target in watch_targets:
        try:
            server.watch(str(target), builder)
            print(f"[build_wikilinks] Watching {target}", file=sys.stderr)
        except Exception as exc:
            print(f"[build_wikilinks] WARNING: could not watch {target}: {exc}", file=sys.stderr)
    return server


if __name__ == "__main__":
    main(skip_site_mirror="--skip-site-mirror" in sys.argv[1:])
