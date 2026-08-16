#!/usr/bin/env python3
from __future__ import annotations

import sys
from collections import defaultdict
from html import escape as html_escape
from pathlib import Path

from . import knotis_site_io as site_io

VALID_GLOSSARY_DEFAULT_VIEWS = {"alphabetical", "by_page", "module"}
GLOSSARY_SKIP_URLS = {"graph/", "glossary/"}
GLOSSARY_PAGE = "glossary.md"
GLOSSARY_PAGE_MARKER = "glossary-page"


def _glossary_page_path() -> Path:
    page_rel = site_io.nav_path_for_filename(GLOSSARY_PAGE) or GLOSSARY_PAGE
    return site_io.DOCS_DIR / page_rel


def _is_generated_glossary_page(raw: str) -> bool:
    return (
        site_io.is_generated_page(raw, GLOSSARY_PAGE_MARKER)
        or (
            '<div class="glossary-view-toggle"' in raw
            and '<div id="glossary-alpha"' in raw
            and '<div id="glossary-module"' in raw
        )
    )


def _remove_generated_glossary_pages(target_path: Path) -> None:
    for candidate in site_io.DOCS_DIR.rglob(GLOSSARY_PAGE):
        if candidate == target_path:
            continue
        try:
            existing_raw = candidate.read_text(encoding="utf-8")
        except Exception:
            continue
        if _is_generated_glossary_page(existing_raw):
            candidate.unlink()
            print(f"[build_wikilinks] Removed generated {candidate.relative_to(site_io.DOCS_DIR)}", file=sys.stderr)


def cleanup_generated_pages() -> None:
    _remove_generated_glossary_pages(_glossary_page_path())


def _static_wikilink_html(keyword: str, *, bold: bool = False) -> str:
    label = html_escape(keyword)
    span = (
        f'<span class="wikilink" data-keyword="{html_escape(keyword.lower())}" '
        f'role="button" tabindex="0">{label}</span>'
    )
    return f"<strong>{span}</strong>" if bold else span


def _normalize_default_view(raw_view: object) -> str:
    default_view = str(raw_view or "alphabetical").strip().lower()
    if default_view == "module":
        default_view = "by_page"
    if default_view not in VALID_GLOSSARY_DEFAULT_VIEWS - {"module"}:
        return "alphabetical"
    return default_view


def _resolve_glossary_skip_urls(glossary_config: dict, md_files: list[Path]) -> set[str]:
    return site_io.resolve_skip_page_urls(
        glossary_config,
        md_files,
        config_prefix="knotis.glossary",
        extra_skip_urls=GLOSSARY_SKIP_URLS,
    )


def _filter_wikilinks_index(
    wikilinks_index: dict[str, list[dict]],
    skip_urls: set[str],
) -> dict[str, list[dict]]:
    filtered: dict[str, list[dict]] = {}
    for keyword, entries in wikilinks_index.items():
        kept = [entry for entry in entries if entry["page_url"] not in skip_urls]
        if kept:
            filtered[keyword] = kept
    return filtered


def _filter_occurrences(all_occurrences: list[dict], skip_urls: set[str]) -> list[dict]:
    return [occ for occ in all_occurrences if occ["page_url"] not in skip_urls]


def _path_token_matches_page_url(token: str, page_url: str) -> bool:
    cleaned = str(token or "").strip().strip("/")
    if not cleaned or not page_url:
        return False
    return page_url == f"{cleaned}/" or page_url.startswith(f"{cleaned}/")


def _pinned_path_rank(page_url: str, configured_paths: list[str]) -> int:
    for index, token in enumerate(configured_paths):
        if _path_token_matches_page_url(token, page_url):
            return index
    return -1


def _ordered_path_rank(page_url: str, order: list[str]) -> int:
    rank = _pinned_path_rank(page_url, order)
    return rank if rank >= 0 else len(order)


def _sort_glossary_page_urls(
    page_urls: list[str],
    nav_order: dict[str, int],
    *,
    order: list[str] | None = None,
) -> list[str]:
    order = order or []

    def sort_key(page_url: str) -> tuple[int, int]:
        return (_ordered_path_rank(page_url, order), nav_order.get(page_url, 999999))

    return sorted(page_urls, key=sort_key)


def maybe_generate(
    knotis_config: dict | None,
    wikilinks_index: dict[str, list[dict]],
    nav_order: dict[str, int],
    all_occurrences: list[dict],
    md_files: list[Path],
) -> None:
    glossary_config = knotis_config.get("glossary", {}) if isinstance(knotis_config, dict) else {}
    if not glossary_config.get("enabled", True):
        return
    generate_glossary(wikilinks_index, nav_order, all_occurrences, knotis_config, md_files)


def generate_glossary(
    wikilinks_index: dict[str, list[dict]],
    nav_order: dict[str, int],
    all_occurrences: list[dict],
    knotis_config: dict | None = None,
    md_files: list[Path] | None = None,
) -> None:
    """
    Auto-generate docs/glossary.md with three views toggled by buttons:

    • Alphabetical — one entry per keyword, A–Z, with page links.
    • By page — one section per page (in nav order), keywords listed in the
      order they first appear in that page's source.
    • By importance — one entry per keyword, ranked by total mention count.

    Keywords use [[brackets]] so they are clickable in the wikilinks pane.
    """
    glossary_path = _glossary_page_path()
    front_matter_lines: list[str] = []
    if glossary_path.exists():
        try:
            existing_raw = glossary_path.read_text(encoding="utf-8")
            front_matter_lines = site_io.extract_raw_front_matter_lines(existing_raw)
        except Exception:
            front_matter_lines = []
    front_matter_lines = site_io.ensure_front_matter(front_matter_lines)
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "title",
        ['title: "Glossary"'],
    )
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "icon",
        ["icon: lucide/arrow-down-a-z"],
    )
    front_matter_lines = site_io.ensure_front_matter_key_lines(
        front_matter_lines,
        "tags",
        ["tags:", "  -"],
    )
    front_matter_lines = site_io.ensure_front_matter_knotis_content(
        front_matter_lines,
        {"heading_numbering": False, "heading_guides": False},
    )
    front_matter_lines = site_io.order_front_matter_key_blocks(
        front_matter_lines,
        ["title", "knotis_content", "icon", "tags"],
    )
    front_matter_lines = site_io.ensure_generated_page_marker(
        front_matter_lines,
        GLOSSARY_PAGE_MARKER,
    )

    glossary_config = knotis_config.get("glossary", {}) if isinstance(knotis_config, dict) else {}
    default_view = _normalize_default_view(glossary_config.get("default_view", "alphabetical"))
    page_view_label = str(glossary_config.get("page_view_label", "By page")).strip() or "By page"
    order = list(glossary_config.get("order", []))

    skip_urls = _resolve_glossary_skip_urls(glossary_config, md_files or [])
    wikilinks_index = _filter_wikilinks_index(wikilinks_index, skip_urls)
    all_occurrences = _filter_occurrences(all_occurrences, skip_urls)

    alpha_lines: list[str] = []
    sorted_keywords = sorted(wikilinks_index.keys(), key=str.lower)
    current_letter = ""

    for kw in sorted_keywords:
        entries = wikilinks_index[kw]
        first_letter = kw[0].upper() if kw else "?"
        if first_letter != current_letter:
            current_letter = first_letter
            alpha_lines.append(f"## {current_letter}")
            alpha_lines.append("")

        page_map: dict[str, str] = {}
        for entry in entries:
            page_map[entry["page_url"]] = entry["page_title"]
        sorted_pages = sorted(page_map.items(), key=lambda p: nav_order.get(p[0], 999999))

        page_count = len(sorted_pages)
        page_label = "page" if page_count == 1 else "pages"
        page_links = " · ".join(f"[{title}]({url})" for url, title in sorted_pages)

        alpha_lines.append(f"{_static_wikilink_html(kw, bold=True)} — *{page_count} {page_label}*  ")
        alpha_lines.append(page_links)
        alpha_lines.append("")

    importance_lines: list[str] = ["## Most mentioned concepts", ""]
    ranked_keywords = sorted(
        wikilinks_index.items(),
        key=lambda item: (-len(item[1]), item[0].lower(), item[0]),
    )

    for kw, entries in ranked_keywords:
        page_map = {}
        for entry in entries:
            page_map[entry["page_url"]] = entry["page_title"]
        sorted_pages = sorted(page_map.items(), key=lambda p: nav_order.get(p[0], 999999))

        mention_count = len(entries)
        mention_label = "mention" if mention_count == 1 else "mentions"
        page_count = len(sorted_pages)
        page_label = "page" if page_count == 1 else "pages"
        page_links = " · ".join(f"[{title}]({url})" for url, title in sorted_pages)

        importance_lines.append(
            f"{_static_wikilink_html(kw, bold=True)} — *{mention_count} {mention_label} · "
            f"{page_count} {page_label}*  "
        )
        importance_lines.append(page_links)
        importance_lines.append("")

    page_pairs: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for occ in all_occurrences:
        url = occ["page_url"]
        if url not in skip_urls:
            page_pairs[url].append((occ["line_idx"], occ["keyword"]))

    page_kw_map: dict[str, list[str]] = {}
    for url, pairs in page_pairs.items():
        seen: set[str] = set()
        ordered: list[str] = []
        for _line, kw in sorted(pairs):
            if kw not in seen:
                seen.add(kw)
                ordered.append(kw)
        if ordered:
            page_kw_map[url] = ordered

    page_titles: dict[str, str] = {}
    for entries in wikilinks_index.values():
        for entry in entries:
            page_titles[entry["page_url"]] = entry["page_title"]

    first_page: dict[str, str] = {}
    seen_concepts: set[str] = set()
    for url in sorted(page_pairs.keys(), key=lambda u: nav_order.get(u, 999999)):
        for _line, kw in sorted(page_pairs[url]):
            if kw not in seen_concepts:
                seen_concepts.add(kw)
                first_page[kw] = url

    page_lines: list[str] = []
    sorted_pages = _sort_glossary_page_urls(
        list(page_kw_map.keys()),
        nav_order,
        order=order,
    )
    for url in sorted_pages:
        title = page_titles.get(url, url)
        kws = page_kw_map[url]
        new_count = sum(1 for kw in kws if first_page.get(kw) == url)
        recurring_count = len(kws) - new_count
        count_line = f"> {new_count} new"
        if recurring_count:
            count_line += (
                f'<span class="glossary-module-count--recurring"> + {recurring_count} recurring</span>'
            )

        page_lines.append(f"## {title}")
        page_lines.append("")
        page_lines.append(count_line)
        page_lines.append("")
        tag_spans = "".join(
            '<span class="glossary-tag'
            + (" glossary-tag--recurring" if first_page.get(kw, url) != url else "")
            + f'">{_static_wikilink_html(kw, bold=True)}</span>'
            for kw in kws
        )
        page_lines.append(f'<div class="glossary-module-concepts">{tag_spans}</div>')
        page_lines.append("")

    def view_button(button_id: str, view: str, label: str, icon_path: str) -> str:
        active = default_view == view
        active_class = " glossary-view__button--active" if active else ""
        aria_pressed = "true" if active else "false"
        return (
            '<button type="button" class="knotis-toggle-button glossary-view__button'
            + active_class
            + f'" id="{button_id}" data-glossary-view="{view}" aria-pressed="{aria_pressed}">'
            + html_escape(label)
            + '<svg class="glossary-view__icon" viewBox="0 0 24 24" aria-hidden="true">'
            + f'<path d="{icon_path}"/></svg>'
            + "</button>"
        )

    lines: list[str] = [
        *front_matter_lines,
        "",
        "All concepts tracked across the site.",
        "Click any keyword to see every occurrence with full context.",
        "",
        '<div class="glossary-view-toggle" aria-label="Glossary view">',
        view_button(
            "glossary-btn-module",
            "by_page",
            page_view_label,
            "M9 5v4h12V5M9 19h12v-4H9m0-1h12v-4H9M4 9h4V5H4m0 14h4v-4H4m0-1h4v-4H4z",
        )
        + "  "
        + view_button(
            "glossary-btn-alpha",
            "alphabetical",
            "Alphabetical",
            "M19 17h3l-4 4-4-4h3V3h2m-8 10v2l-3.33 4H11v2H5v-2l3.33-4H5v-2M9 3H7c-1.1 0-2 .9-2 2v6h2V9h2v2h2V5a2 2 0 0 0-2-2m0 4H7V5h2Z",
        )
        + "  "
        + view_button(
            "glossary-btn-importance",
            "importance",
            "By importance",
            "M19 7h3l-4-4-4 4h3v14h2M2 17h10v2H2M6 5v2H2V5m0 6h7v2H2z",
        ),
        "</div>",
        "",
        "---",
        "",
        '<div id="glossary-alpha" data-default-view="'
        + default_view
        + '"'
        + (' style="display:none"' if default_view == "by_page" else "")
        + " markdown>",
        "",
        *alpha_lines,
        "</div>",
        "",
        '<div id="glossary-importance" data-default-view="'
        + default_view
        + '" style="display:none" markdown>',
        "",
        *importance_lines,
        "</div>",
        "",
        '<div id="glossary-module" data-default-view="'
        + default_view
        + '"'
        + ("" if default_view == "by_page" else ' style="display:none"')
        + " markdown>",
        "",
        *page_lines,
        "</div>",
        "",
    ]

    site_io.write_if_changed(glossary_path, "\n".join(lines))
    _remove_generated_glossary_pages(glossary_path)
