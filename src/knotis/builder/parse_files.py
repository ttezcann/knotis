#!/usr/bin/env python3
from __future__ import annotations
"""
parse_files.py — Parse wikilink/content-tag/reference occurrences from Markdown.
"""

import re
import sys
from pathlib import Path

from .frontmatter import _split_front_matter
from . import knotis_site_io
from .scan_context import (
    CONTENT_TAG_RE,
    WIKILINK_RE,
    _build_code_block_ranges,
    _build_inline_code_ranges,
    _inside_any_range,
    _inside_code_block,
    _is_markdown_heading_marker,
    _line_index_for_pos,
    _mask_html_comments,
    build_current_heading_line_map,
    build_heading_keyword_map,
    build_heading_parent_keyword_map,
    build_heading_path_map,
    build_linked_list_ancestor_chain_map,
    build_list_parent_line_map,
    build_paragraph_group_map,
    build_parent_chain_map,
    extract_wikilink_targets,
    find_transparent_list_parent_keyword,
    get_bullet_context,
    get_context,
    get_extended_context,
    get_content_tag_section_content,
    get_section_content,
    heading_has_single_keyword_definition,
    infer_paragraph_parent_keyword,
    iter_wikilink_matches,
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
    wikilink_mode,
)


def parse_md_file(md_path: Path) -> list[dict]:
    """
    Parse a single Markdown file and return a list of occurrence dicts:
      { keyword, page_title, page_url, context, parent_item, child_items }
    """
    _meta, raw = _split_front_matter(md_path.read_text(encoding="utf-8"))
    scan_raw = _mask_html_comments(raw)
    lines = raw.splitlines()
    code_ranges = _build_code_block_ranges(raw)
    inline_code_ranges = _build_inline_code_ranges(raw)
    list_parent_line_map = build_list_parent_line_map(lines)
    parent_map = parse_list_hierarchy(lines)
    heading_parent_map = build_heading_parent_keyword_map(lines)
    heading_keyword_map = build_heading_keyword_map(lines)
    heading_path_map = build_heading_path_map(lines)
    current_heading_line_map = build_current_heading_line_map(lines)
    parent_chain_map = build_parent_chain_map(lines)
    linked_list_ancestor_chain_map = build_linked_list_ancestor_chain_map(lines)
    paragraph_group_map = build_paragraph_group_map(lines)

    page_title = page_title_from_path(md_path)
    page_url = knotis_site_io.page_url_from_path(md_path)

    occurrences = []
    # Track char offset of each line start for context extraction
    line_starts = []
    offset = 0
    for line in lines:
        line_starts.append(offset)
        offset += len(line) + 1  # +1 for newline

    for m in WIKILINK_RE.finditer(scan_raw):
        if _inside_code_block(m.start(), code_ranges) or _inside_any_range(m.start(), inline_code_ranges):
            continue

        raw_keyword = m.group(1)
        if not is_valid_wikilink_raw(raw_keyword):
            continue
        keyword = normalize(raw_keyword)
        mode = wikilink_mode(raw_keyword)
        keyword_title, _keyword_label = split_wikilink_parts(raw_keyword)

        # Determine which line this match falls on
        char_pos = m.start()
        line_idx = 0
        for idx, ls in enumerate(line_starts):
            if ls <= char_pos:
                line_idx = idx
            else:
                break

        # Use full bullet text + children when in a list; sentence window otherwise
        bullet_ctx, child_items = get_bullet_context(lines, line_idx)
        context = bullet_ctx if bullet_ctx is not None else get_context(raw, m)
        parent_item = parent_map.get(line_idx)
        parsed_heading = parse_heading_line(lines[line_idx])
        is_heading_line = parsed_heading is not None
        current_heading_idx = current_heading_line_map.get(line_idx)
        current_heading_kw = heading_keyword_map.get(current_heading_idx) if current_heading_idx is not None else None
        current_heading_parent_kw = (
            heading_parent_map.get(current_heading_idx) if current_heading_idx is not None else None
        )
        is_section_keyword = current_heading_kw == keyword

        list_parent_kw = find_transparent_list_parent_keyword(
            lines,
            line_idx,
            list_parent_line_map,
            keyword,
        )
        if is_heading_line:
            heading_parent_kw = heading_parent_map.get(line_idx)
        elif is_section_keyword and current_heading_idx is not None:
            heading_parent_kw = heading_parent_map.get(current_heading_idx)
        else:
            heading_parent_kw = None

        if heading_parent_kw == keyword:
            heading_parent_kw = None
        paragraph_parent_kw = None
        if list_parent_kw is None and heading_parent_kw is None:
            paragraph_parent_kw = infer_paragraph_parent_keyword(
                lines,
                line_idx,
                current_heading_line_map,
            )
            if paragraph_parent_kw == keyword:
                paragraph_parent_kw = None
        current_item = parse_list_item(lines[line_idx])
        list_sibling_key = None
        if current_item is not None:
            list_sibling_key = (
                current_heading_idx,
                list_parent_line_map.get(line_idx),
                current_item["indent"],
            )
        linked_list_ancestor_chain = linked_list_ancestor_chain_map.get(line_idx, [])
        heading_line_keywords = (
            list(dict.fromkeys(extract_wikilink_targets(lines[current_heading_idx])))
            if current_heading_idx is not None
            else []
        )
        explicit_heading_parent_kw = None
        if (
            not is_heading_line
            and current_item is not None
            and current_heading_kw is not None
            and current_heading_kw != keyword
            and current_heading_kw in heading_line_keywords
            and list_parent_kw is None
            and paragraph_parent_kw is None
            and heading_parent_kw is None
        ):
            explicit_heading_parent_kw = current_heading_kw
        section_heading_parent_kw = None
        is_comparison_heading_bullet = (
            current_heading_idx is not None
            and current_item is not None
            and current_item["indent"] == 0
            and list_parent_kw is None
            and is_comparison_heading_section(lines, current_heading_idx)
        )
        if (
            not is_heading_line
            and current_item is not None
            and (current_item["indent"] == 0 or not linked_list_ancestor_chain)
            and current_heading_idx is not None
            and current_heading_parent_kw is not None
            and current_heading_kw is not None
            and current_heading_kw != keyword
            and heading_has_single_keyword_definition(lines, current_heading_idx)
            and list_parent_kw is None
            and paragraph_parent_kw is None
            and heading_parent_kw is None
            and explicit_heading_parent_kw is None
            and not is_comparison_heading_bullet
        ):
            section_heading_parent_kw = current_heading_kw

        inherited_heading_parent_kw = None
        if (
            not is_heading_line
            and current_item is not None
            and current_heading_idx is not None
            and current_heading_parent_kw is not None
            and list_parent_kw is None
            and paragraph_parent_kw is None
            and heading_parent_kw is None
            and explicit_heading_parent_kw is None
            and section_heading_parent_kw is None
            and (
                current_heading_kw is None
                or (
                    is_comparison_heading_bullet
                    and current_heading_kw != keyword
                )
            )
        ):
            inherited_heading_parent_kw = current_heading_parent_kw

        heading_section_parent_kw = inherited_heading_parent_kw or section_heading_parent_kw
        hierarchy_parent_kw = (
            list_parent_kw
            or paragraph_parent_kw
            or heading_parent_kw
            or explicit_heading_parent_kw
            or inherited_heading_parent_kw
            or section_heading_parent_kw
        )
        if mode == "reference" and linked_list_ancestor_chain:
            if heading_section_parent_kw and not list_parent_kw:
                hierarchy_parent_kw = heading_section_parent_kw
            else:
                hierarchy_parent_kw = linked_list_ancestor_chain[0]

        hierarchy_parent_source = None
        if hierarchy_parent_kw:
            if mode == "reference":
                if heading_section_parent_kw and hierarchy_parent_kw == heading_section_parent_kw:
                    hierarchy_parent_source = "section_heading"
                else:
                    hierarchy_parent_source = "reference"
            elif list_parent_kw:
                hierarchy_parent_source = "list"
            elif paragraph_parent_kw:
                hierarchy_parent_source = "paragraph"
            elif heading_parent_kw:
                explicit_heading_keywords = list(dict.fromkeys(extract_wikilink_targets(lines[line_idx])))
                hierarchy_parent_source = (
                    "heading_explicit"
                    if is_heading_line and keyword in explicit_heading_keywords
                    else "heading_inferred"
                )
            elif explicit_heading_parent_kw:
                hierarchy_parent_source = "list"
            elif inherited_heading_parent_kw:
                hierarchy_parent_source = "section_heading"
            elif section_heading_parent_kw:
                hierarchy_parent_source = "section_heading"

        extended_ctx = get_extended_context(lines, line_idx, raw, m)

        is_structural_list_keyword = False
        if current_item is not None:
            line_text = lines[line_idx]
            parent_line_idx = list_parent_line_map.get(line_idx)
            parent_list_item = (
                parse_list_item(lines[parent_line_idx]) if parent_line_idx is not None else None
            )
            item_text = current_item["text"]
            first_wl = next(iter_wikilink_matches(item_text), None)
            if first_wl and normalize(first_wl.group(1)) == keyword:
                before = item_text[: first_wl.start()].strip()
                if before in {"", "**"}:
                    is_structural_list_keyword = True
            wikilinks_on_line = [normalize(m.group(1)) for m in iter_wikilink_matches(line_text)]
            if (
                not is_structural_list_keyword
                and list_parent_kw
                and list_parent_kw == hierarchy_parent_kw
                and keyword != list_parent_kw
                and wikilinks_on_line == [keyword]
                and parent_list_item is not None
                and current_item["indent"] > parent_list_item["indent"]
            ):
                is_structural_list_keyword = True

        sec_lines, sec_lines_raw, sec_offset = get_section_content(lines, line_idx)
        occurrences.append(
            {
                "keyword": keyword,
                "title": keyword_title,
                "mode": mode,
                "page_title": page_title,
                "page_url": page_url,
                "context": context,
                "extended_context": extended_ctx,
                "parent_item": parent_item,
                "child_items": child_items,
                "list_parent_kw": list_parent_kw,
                "paragraph_parent_kw": paragraph_parent_kw,
                "heading_parent_kw": heading_parent_kw,
                "section_heading_parent_kw": section_heading_parent_kw,
                "hierarchy_parent_kw": hierarchy_parent_kw,
                "hierarchy_parent_source": hierarchy_parent_source,
                "heading_path": heading_path_map.get(line_idx, []),
                "parent_chain": parent_chain_map.get(line_idx, []),
                "linked_list_ancestor_chain": linked_list_ancestor_chain,
                "list_sibling_key": list_sibling_key,
                "paragraph_group": paragraph_group_map.get(line_idx),
                "is_section_keyword": is_section_keyword,
                "section_lines": sec_lines,
                "section_lines_raw": sec_lines_raw,
                "section_kw_offset": sec_offset,
                "line_idx": line_idx,
                "is_heading_line": is_heading_line,
                "is_structural_list_keyword": is_structural_list_keyword,
            }
        )

    return occurrences


def parse_content_tags_file(md_path: Path) -> list[dict]:
    """
    Parse plain content_tags such as #code from Markdown source.

    Content tags are indexed for the backlinks pane only; they do not become graph
    nodes or glossary concepts.
    """
    _meta, raw = _split_front_matter(md_path.read_text(encoding="utf-8"))
    scan_raw = _mask_html_comments(raw)
    lines = raw.splitlines()
    code_ranges = _build_code_block_ranges(raw)
    inline_code_ranges = _build_inline_code_ranges(raw)
    parent_map = parse_list_hierarchy(lines)
    heading_path_map = build_heading_path_map(lines)
    current_heading_line_map = build_current_heading_line_map(lines)
    parent_chain_map = build_parent_chain_map(lines)
    page_title = page_title_from_path(md_path)
    page_url = knotis_site_io.page_url_from_path(md_path)

    line_starts = []
    offset = 0
    for line in lines:
        line_starts.append(offset)
        offset += len(line) + 1

    occurrences = []
    for m in CONTENT_TAG_RE.finditer(scan_raw):
        if _inside_code_block(m.start(), code_ranges) or _inside_any_range(m.start(), inline_code_ranges):
            continue

        line_idx = _line_index_for_pos(line_starts, m.start())
        line_start = line_starts[line_idx] if line_idx < len(line_starts) else 0
        column = m.start() - line_start
        if _is_markdown_heading_marker(lines[line_idx], column):
            continue
        if is_css_hex_color_token(m.group(1)):
            continue

        content_tag = normalize_content_tag(m.group(1))
        bullet_ctx, child_items = get_bullet_context(lines, line_idx)
        context = bullet_ctx if bullet_ctx is not None else get_context(raw, m)
        extended_ctx = get_extended_context(lines, line_idx, raw, m)
        sec_lines, sec_lines_raw, sec_offset = get_content_tag_section_content(lines, line_idx)
        parsed_heading = parse_heading_line(lines[line_idx])
        is_heading_line = parsed_heading is not None
        current_heading_idx = current_heading_line_map.get(line_idx)

        occurrences.append(
            {
                "content_tag": content_tag,
                "page_title": page_title,
                "page_url": page_url,
                "context": context,
                "extended_context": extended_ctx,
                "parent_item": parent_map.get(line_idx),
                "child_items": child_items,
                "heading_path": heading_path_map.get(line_idx, []),
                "parent_chain": parent_chain_map.get(line_idx, []),
                "section_lines": sec_lines,
                "section_lines_raw": sec_lines_raw,
                "section_kw_offset": sec_offset,
                "line_idx": line_idx,
                "is_heading_line": is_heading_line,
                "current_heading_idx": current_heading_idx,
            }
        )

    return occurrences

# ── Graph builder ─────────────────────────────────────────────────────────────
