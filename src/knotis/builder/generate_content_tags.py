#!/usr/bin/env python3
from __future__ import annotations

import sys
from copy import deepcopy

from . import knotis_site_io as site_io

CONTENT_TAGS_PAGE = "content-tags.md"
CONTENT_TAGS_PAGE_MARKER = "content-tags-page"


def maybe_generate(knotis_config: dict | None) -> None:
    generate_content_tags_page(knotis_config)
    sync_content_tags_nav(knotis_config)


def _content_tags_page_path() -> str:
    return site_io.nav_path_for_filename(CONTENT_TAGS_PAGE) or CONTENT_TAGS_PAGE


def _is_generated_content_tags_page(raw: str) -> bool:
    return (
        site_io.is_generated_page(raw, CONTENT_TAGS_PAGE_MARKER)
        or '<div id="knotis-content-tags-page"' in raw
    )


def _remove_generated_content_tags_pages(target_path) -> None:
    for candidate in site_io.DOCS_DIR.rglob(CONTENT_TAGS_PAGE):
        if candidate == target_path:
            continue
        try:
            existing_raw = candidate.read_text(encoding="utf-8")
        except Exception:
            continue
        if _is_generated_content_tags_page(existing_raw):
            candidate.unlink()
            print(f"[build_wikilinks] Removed generated {candidate.relative_to(site_io.DOCS_DIR)}", file=sys.stderr)


def cleanup_generated_pages() -> None:
    _remove_generated_content_tags_pages(site_io.DOCS_DIR / _content_tags_page_path())


def _nav_list_contains_page(nav_items: list, page_path: str) -> bool:
    target = page_path.replace("\\", "/")

    def walk(items: list) -> bool:
        for item in items:
            if isinstance(item, str):
                if item.replace("\\", "/") == target:
                    return True
            elif isinstance(item, dict):
                for _label, value in item.items():
                    if isinstance(value, str):
                        if value.replace("\\", "/") == target:
                            return True
                    elif isinstance(value, list) and walk(value):
                        return True
        return False

    return walk(nav_items)


def _nav_remove_page(nav_items: list, page_path: str) -> list:
    target = page_path.replace("\\", "/")
    updated: list = []

    for item in nav_items:
        if isinstance(item, str):
            if item.replace("\\", "/") != target:
                updated.append(item)
            continue
        if not isinstance(item, dict):
            continue
        new_item: dict = {}
        for label, value in item.items():
            if isinstance(value, str):
                if value.replace("\\", "/") != target:
                    new_item[label] = value
            elif isinstance(value, list):
                filtered = _nav_remove_page(value, page_path)
                if filtered:
                    new_item[label] = filtered
            else:
                new_item[label] = value
        if new_item:
            updated.append(new_item)
    return updated


def _infer_nav_section(page_path: str, nav_items: list) -> str | None:
    parts = page_path.replace("\\", "/").strip("/").split("/")
    if len(parts) < 2:
        return None
    folder = parts[0].lower()
    for item in nav_items:
        if not isinstance(item, dict):
            continue
        for label, value in item.items():
            if isinstance(value, list) and str(label).strip().lower() == folder:
                return str(label)
    return None


def _nav_add_page(nav_items: list, section_label: str | None, label: str, page_path: str) -> list:
    if _nav_list_contains_page(nav_items, page_path):
        return nav_items

    entry = {label: page_path.replace("\\", "/")}
    if section_label:
        for item in nav_items:
            if isinstance(item, dict) and section_label in item and isinstance(item[section_label], list):
                item[section_label].append(entry)
                return nav_items
        nav_items.append({section_label: [entry]})
        return nav_items

    nav_items.append(entry)
    return nav_items


def _render_nav_entry(item, indent: int) -> str:
    pad = "  " * indent
    if isinstance(item, str):
        return f'{pad}"{item.replace("\\", "/")}"'
    if isinstance(item, dict):
        lines = []
        for label, value in item.items():
            if isinstance(value, str):
                lines.append(f'{pad}{{ "{label}" = "{value.replace("\\", "/")}" }}')
            elif isinstance(value, list):
                child_lines = [_render_nav_entry(child, indent + 1) for child in value]
                inner = ",\n".join(child_lines)
                lines.append(f'{pad}{{ "{label}" = [\n{inner},\n{pad}] }}')
        return ",\n".join(lines)
    raise TypeError(f"Unsupported nav item: {item!r}")


def _render_nav_block(nav_items: list) -> str:
    entries = [_render_nav_entry(item, 1) for item in nav_items]
    inner = ",\n".join(entries)
    return f"nav = [\n{inner},\n]"


def _replace_zensical_nav(nav_items: list) -> None:
    toml_path = site_io.REPO_ROOT / "zensical.toml"
    if not toml_path.exists():
        return

    text = toml_path.read_text(encoding="utf-8")
    start = text.find("nav = [")
    if start == -1:
        site_io.warn_config("Could not find nav = [ in zensical.toml; skipping content tags nav sync")
        return

    depth = 0
    idx = start + len("nav = ")
    while idx < len(text) and text[idx] != "[":
        idx += 1
    if idx >= len(text):
        return

    depth = 1
    idx += 1
    while idx < len(text) and depth > 0:
        if text[idx] == "[":
            depth += 1
        elif text[idx] == "]":
            depth -= 1
        idx += 1

    new_text = text[:start] + _render_nav_block(nav_items) + text[idx:]
    if new_text != text:
        toml_path.write_text(new_text, encoding="utf-8")
        print("[build_wikilinks] Updated zensical.toml nav for content tags", file=sys.stderr)


def sync_content_tags_nav(knotis_config: dict | None) -> None:
    content_tags_config = knotis_config.get("content_tags", {}) if isinstance(knotis_config, dict) else {}
    if not content_tags_config.get("sync_nav", True):
        return

    page_path = _content_tags_page_path()
    label = "Content tags"
    original_nav = site_io.load_site_nav()
    section = _infer_nav_section(page_path, original_nav)
    if not original_nav:
        return

    nav_items = deepcopy(original_nav)
    if content_tags_config.get("enabled", False):
        _nav_add_page(nav_items, section, label, page_path)
    else:
        nav_items = _nav_remove_page(nav_items, page_path)

    if nav_items != original_nav:
        _replace_zensical_nav(nav_items)


def generate_content_tags_page(knotis_config: dict | None) -> None:
    content_tags_config = knotis_config.get("content_tags", {}) if isinstance(knotis_config, dict) else {}
    page_rel = _content_tags_page_path()
    page_path = site_io.DOCS_DIR / page_rel

    if not content_tags_config.get("enabled", False):
        for candidate in site_io.DOCS_DIR.rglob(CONTENT_TAGS_PAGE):
            try:
                existing_raw = candidate.read_text(encoding="utf-8")
            except Exception:
                continue
            if _is_generated_content_tags_page(existing_raw):
                candidate.unlink()
                print(f"[build_wikilinks] Removed generated {candidate.relative_to(site_io.DOCS_DIR)}", file=sys.stderr)
        return

    front_matter_lines = []
    if page_path.exists():
        try:
            existing_raw = page_path.read_text(encoding="utf-8")
            front_matter_lines = site_io.extract_raw_front_matter_lines(existing_raw)
        except Exception:
            pass

    front_matter_lines = site_io.ensure_front_matter(front_matter_lines)
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "title",
        ['title: "Content tags"'],
    )
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "icon",
        ["icon: lucide/hash"],
    )
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "tags",
        ["tags:", "  -"],
    )
    front_matter_lines = site_io.ensure_generated_page_marker(
        front_matter_lines,
        CONTENT_TAGS_PAGE_MARKER,
    )

    lines = [
        *front_matter_lines,
        "",
        '<div id="knotis-content-tags-page" class="wikilink-content-tags-page"></div>',
        "",
    ]
    site_io.write_if_changed(page_path, "\n".join(lines))
    _remove_generated_content_tags_pages(page_path)
