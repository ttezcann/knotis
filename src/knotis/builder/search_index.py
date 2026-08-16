#!/usr/bin/env python3
from __future__ import annotations
"""
search_index.py — Build knotis-search.json from Markdown pages.
"""

KNOTIS_SEARCH_INDEX_PATH = "assets/knotis-search.json"

import json
import re
import sys
from html import escape as html_escape
from html import unescape as html_unescape
from pathlib import Path

from . import knotis_site_io
from .knotis_site_io import write_if_changed as _write_if_changed
from .scan_context import (
    CONTENT_TAG_RE,
    LIST_ITEM_RE,
    WIKILINK_RE,
    _mask_html_comments,
    _strip_knotis_metadata_attrs,
    _strip_slide_anchor_markers,
    extract_wikilink_targets,
    page_title_from_path,
    split_wikilink_parts,
    wikilink_mode,
)
from .frontmatter import (
    _front_matter_tags,
    _page_excluded_from_search,
    _split_front_matter,
)

SEARCH_SEPARATOR = r"[\s\u200b\-_,:!=\[\]()`\"/]+|\.(?!\d)|&[lg]t;|(?!\b)(?=[A-Z][a-z])"
SEARCH_MAX_SECTION_LEVEL = 4


def _strip_wikilink_markup(value: str) -> str:
    def replace(match: re.Match) -> str:
        _target, label = split_wikilink_parts(match.group(1))
        return label

    return WIKILINK_RE.sub(replace, value)


def _clean_search_text(value: str) -> str:
    text = html_unescape(str(value or ""))
    text = _strip_slide_anchor_markers(text)
    text = _mask_html_comments(text)
    text = re.sub(r"^\s*```.*$", " ", text, flags=re.MULTILINE)
    text = _strip_wikilink_markup(text)
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)(?:\{[^}]*\})?", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = _strip_knotis_metadata_attrs(text)
    text = re.sub(r"(^|\n)\s{0,3}#{1,6}\s+", r"\1", text)
    text = re.sub(r"`([^`\n]+)`", r"\1", text)
    text = re.sub(
        r"</?(?:br|p|li|ul|ol|pre|code|td|th|tr|table|blockquote|strong|em|span|a)\b[^>]*>",
        " ",
        text,
        flags=re.I,
    )
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"^[ \t]*[|: -]{3,}[|: -]*$", " ", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~>|]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _clean_search_match_text(value: str) -> str:
    """Return only genuine plain text, excluding all wikilink tokens and labels."""
    text = WIKILINK_RE.sub(" ", str(value or ""))
    text = re.sub(r":[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*:", " ", text)
    return _clean_search_text(text)


def _search_line_parts(value: str) -> tuple[str, str, str]:
    text = html_unescape(str(value or "")).rstrip()
    leading_match = re.match(r"^[ \t]*", text)
    leading = leading_match.group() if leading_match else ""
    rest = text[len(leading):]
    if not LIST_ITEM_RE.match(rest):
        return leading, "", rest
    list_match = re.match(r"^((?:[-*+]|\d+(?:\.\d+)*\.?)\s+)", rest)
    list_prefix = list_match.group(1) if list_match else ""
    body = LIST_ITEM_RE.sub("", rest, count=1)
    return leading, list_prefix, body


def _clean_search_render_inline(value: str) -> str:
    rest = str(value or "")
    rest = _strip_slide_anchor_markers(_strip_knotis_metadata_attrs(rest))
    rest = re.sub(r"!\[[^\]]*\]\([^)]+\)(?:\{[^}]*\})?", "", rest)
    rest = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", rest)
    rest = re.sub(r"</?(?:p|li|ul|ol|pre|td|th|tr|table|blockquote|strong|em|span|a)\b[^>]*>", " ", rest, flags=re.I)
    rest = re.sub(r"<(?!br\b)[^>]+>", " ", rest, flags=re.I)
    rest = re.sub(r"[ \t]+", " ", rest).strip()
    return rest


def _clean_search_context_line(
    value: str,
    *,
    preserve_table: bool = False,
    preserve_media: bool = False,
    preserve_wikilinks: bool = False,
) -> str:
    leading, list_prefix, body = _search_line_parts(value)
    stripped_body = body.strip()

    if preserve_media:
        markdown_image = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?\s*$", stripped_body)
        if markdown_image:
            return leading + list_prefix + stripped_body
        html_image = re.match(r"^<img\b[^>]*>\s*$", stripped_body, flags=re.I)
        if html_image:
            return leading + list_prefix + stripped_body

    if preserve_table and re.match(r"^\|.*\|\s*$", stripped_body):
        cells = [cell.strip() for cell in stripped_body.strip("|").split("|")]
        if cells and all(re.match(r"^:?-{3,}:?$", cell.replace(" ", "")) for cell in cells):
            return leading + list_prefix + ("| " + " | ".join("---" for _ in cells) + " |")
        if preserve_wikilinks:
            cleaned_cells = [_clean_search_render_inline(cell) for cell in cells]
        else:
            cleaned_cells = [_clean_search_text(cell) for cell in cells]
        return leading + list_prefix + ("| " + " | ".join(cleaned_cells) + " |")

    if re.match(r"^\|.*\|\s*$", stripped_body):
        cells = [cell.strip() for cell in stripped_body.strip("|").split("|")]
        return leading + " ".join(cell for cell in cells if cell)

    if re.match(r"^(?:!!!|\?\?\?)\s+\w+", stripped_body):
        cleaned = stripped_body if preserve_wikilinks else _strip_wikilink_markup(stripped_body)
        cleaned = _strip_knotis_metadata_attrs(cleaned)
        return leading + list_prefix + cleaned

    if preserve_wikilinks:
        rest = _clean_search_render_inline(body)
        if list_prefix and not rest:
            return ""
        return leading + list_prefix + rest

    rest = _strip_wikilink_markup(body)
    rest = _strip_knotis_metadata_attrs(rest)
    rest = re.sub(r"!\[[^\]]*\]\([^)]+\)(?:\{[^}]*\})?", "", rest)
    rest = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", rest)
    rest = re.sub(r":[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*:", " ", rest)
    rest = re.sub(r"\+\+([^+]+)\+\+", r"\1", rest)
    rest = rest.replace("++", "")
    rest = re.sub(r"</?(?:p|li|ul|ol|pre|td|th|tr|table|blockquote|strong|em|span|a)\b[^>]*>", " ", rest, flags=re.I)
    rest = re.sub(r"<(?!br\b)[^>]+>", " ", rest, flags=re.I)
    rest = re.sub(r"[ \t]+", " ", rest).strip()

    if list_prefix and not rest:
        return ""
    return leading + list_prefix + rest


def _extract_search_concepts(
    value: str,
    shadowed_reference_keys: set[str] | None = None,
) -> list[str]:
    concepts: list[str] = []
    seen: set[str] = set()
    shadowed_reference_keys = shadowed_reference_keys or set()
    for match in WIKILINK_RE.finditer(str(value or "")):
        raw = match.group(1)
        if wikilink_mode(raw) == "reference":
            continue
        target, label = split_wikilink_parts(raw)
        if _search_key(target) in shadowed_reference_keys:
            continue
        for candidate in (target, label):
            clean = _clean_search_text(candidate)
            key = clean.lower()
            if clean and key not in seen:
                concepts.append(clean)
                seen.add(key)
    return concepts


def _search_key(value: str) -> str:
    return _clean_search_text(value).lower()


def _extract_search_content_tags(value: str) -> list[str]:
    tags: list[str] = []
    seen: set[str] = set()
    for match in CONTENT_TAG_RE.finditer(str(value or "")):
        tag = f"#{match.group(1)}"
        key = tag.lower()
        if key not in seen:
            tags.append(tag)
            seen.add(key)
    return tags


def _search_metadata_from_lines(
    lines: list[str],
    shadowed_reference_keys: set[str] | None = None,
) -> tuple[list[str], list[str], list[str]]:
    clean_source = _remove_search_excluded_markdown_sections("\n".join(lines))
    concepts = _extract_search_concepts(clean_source, shadowed_reference_keys)
    return (
        concepts,
        _extract_search_content_tags(clean_source),
        [],
    )


def _search_breadcrumb_from_stack(stack: list[tuple[int, str]]) -> list[str]:
    return [_clean_search_text(title) for _level, title in stack if _clean_search_text(title)]


def _search_context_lines(lines: list[str], *, limit: int = 80) -> list[str]:
    context: list[str] = []
    in_fence = False
    for line in _remove_search_excluded_markdown_sections("\n".join(lines)).splitlines():
        stripped = line.strip()
        if stripped.startswith("```"):
            in_fence = not in_fence
            continue
        if not stripped:
            continue
        if re.match(r"^[|: -]{3,}[|: -]*$", stripped):
            continue

        if in_fence:
            cleaned = _clean_search_context_line(stripped)
            if cleaned:
                context.append(f"`{cleaned}`")
        else:
            cleaned = _clean_search_context_line(line)
            if cleaned:
                context.append(cleaned)
        if len(context) >= limit:
            break
    return context


def _search_fence_stripped(line: str) -> str:
    if LIST_ITEM_RE.match(line):
        return LIST_ITEM_RE.sub("", line, count=1).strip()
    return line.strip()


def _search_render_context_lines(lines: list[str], *, limit: int = 80) -> list[str]:
    context: list[str] = []
    in_fence = False
    fence_info = ""
    for line in _remove_search_excluded_markdown_sections("\n".join(lines)).splitlines():
        stripped = line.strip()
        fence_stripped = _search_fence_stripped(line)
        if fence_stripped.startswith("```"):
            if not in_fence:
                in_fence = True
                fence_info = fence_stripped[3:].strip()
                cleaned = _clean_search_context_line(
                    line, preserve_table=True, preserve_media=True, preserve_wikilinks=True
                )
                context.append(cleaned if cleaned else line.rstrip())
            else:
                cleaned = _clean_search_context_line(
                    line, preserve_table=True, preserve_media=True, preserve_wikilinks=True
                )
                context.append(cleaned if cleaned else "```")
                in_fence = False
                fence_info = ""
            continue
        if in_fence:
            if not stripped:
                context.append("")
                if len(context) >= limit:
                    break
                continue
            cleaned = _clean_search_context_line(
                stripped, preserve_table=True, preserve_media=True, preserve_wikilinks=True
            )
            if cleaned:
                context.append(cleaned)
        else:
            if not stripped:
                continue
            cleaned = _clean_search_context_line(
                line, preserve_table=True, preserve_media=True, preserve_wikilinks=True
            )
            if cleaned:
                context.append(cleaned)
        if len(context) >= limit:
            break
    return context


def _search_heading_from_line(line: str) -> tuple[int, str, bool, str] | None:
    match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
    if not match:
        return None

    raw_title = match.group(2).strip()
    excluded = bool(re.search(r"\{[^}]*\bdata-search-exclude\b[^}]*\}\s*$", raw_title))
    raw_title = re.sub(r"\s*\{[^}]*\}\s*$", "", raw_title).strip()
    anchor_title = raw_title
    title = _clean_search_text(raw_title)
    if not title:
        return None
    return len(match.group(1)), title, excluded, anchor_title


def _slugify_search_heading(title: str, counts: dict[str, int]) -> str:
    base = title.lower()
    base = re.sub(r"[^\w\s-]", "", base, flags=re.UNICODE)
    base = re.sub(r"[\s_-]+", "-", base).strip("-")
    if not base:
        base = "section"
    count = counts.get(base, 0)
    counts[base] = count + 1
    return base if count == 0 else f"{base}_{count}"


def _knotis_search_id(kind: str, value: str) -> str:
    token = re.sub(r"[^a-z0-9_-]+", "-", str(value).lower()).strip("-")
    return f"{kind}:{token or 'item'}"


SEARCH_EXCLUDE_ATTR_RE = re.compile(r"\{[^}]*\bdata-search-exclude\b[^}]*\}\s*$")


def _remove_search_excluded_markdown_sections(value: str) -> str:
    kept: list[str] = []
    skip_level: int | None = None
    for line in str(value or "").splitlines():
        heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
        if heading:
            level = len(heading.group(1))
            if skip_level is not None and level <= skip_level:
                skip_level = None
            if SEARCH_EXCLUDE_ATTR_RE.search(heading.group(2).strip()):
                skip_level = level
                continue
        if skip_level is not None:
            continue
        kept.append(line)
    return "\n".join(kept)


def _section_lines_search_excluded(section_lines_raw: list[str]) -> bool:
    """True when the section's own raw heading carries data-search-exclude.

    Wikilink-index entries keep the literal `{ ... }` attrs on their raw heading
    line, while their heading_path/breadcrumb strings have the attrs stripped -
    so this raw line is the only place the marker is still detectable by the
    time mention docs are built.
    """
    for line in section_lines_raw:
        heading = re.match(r"^#{1,6}\s+(.+?)\s*$", str(line or "").strip())
        if heading:
            return bool(SEARCH_EXCLUDE_ATTR_RE.search(heading.group(1).strip()))
    return False


def _compact_context_lines(entries: list[dict], *, limit: int = 8) -> str:
    chunks: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        # heading_path below is attr-stripped upstream, so it would leak an
        # excluded section's heading text past the marker-based stripper; skip
        # excluded entries entirely.
        if _section_lines_search_excluded(
            list(entry.get("section_lines_raw") or entry.get("section_lines") or [])
        ):
            continue
        parts = []
        heading_path = entry.get("heading_path") or []
        if heading_path:
            parts.append(" > ".join(str(part) for part in heading_path))
        section_lines = entry.get("section_lines_raw") or entry.get("section_lines") or []
        section_text = ""
        if section_lines:
            section_text = _remove_search_excluded_markdown_sections(
                "\n".join(str(line) for line in section_lines[:24])
            )
            if section_text:
                parts.append(section_text)
        if not section_text:
            for key in ("context",):
                value = _clean_search_text(_remove_search_excluded_markdown_sections(str(entry.get(key) or "")))
                if value:
                    parts.append(value)
        text = _clean_search_text(" ".join(parts))
        if not text or text in seen:
            continue
        chunks.append(text)
        seen.add(text)
        if len(chunks) >= limit:
            break
    return " ".join(chunks)


def parse_search_page_entries(
    md_path: Path,
    *,
    page_order: int = 999999,
    shadowed_reference_keys: set[str] | None = None,
) -> list[dict]:
    raw = md_path.read_text(encoding="utf-8")
    meta, body = _split_front_matter(raw)
    if _page_excluded_from_search(meta):
        return []
    page_tags = _front_matter_tags(meta)
    yaml_page_title = ""
    if isinstance(meta, dict) and meta.get("title"):
        yaml_page_title = str(meta["title"]).strip()

    body = _mask_html_comments(body)
    lines = body.splitlines()
    page_title = yaml_page_title or page_title_from_path(md_path)
    page_search_title = _clean_search_match_text(yaml_page_title or page_title)
    page_url = knotis_site_io.page_url_from_path(md_path)
    slug_counts: dict[str, int] = {}
    article_lines: list[str] = []
    section: dict | None = None
    section_entries: list[dict] = []
    section_order = 0
    article_excluded = False
    excluded_until_level: int | None = None
    saw_page_h1 = False
    heading_stack: list[tuple[int, str]] = []

    def finish_section() -> None:
        nonlocal section, section_order
        if not section:
            return
        searchable_lines = section["lines"]
        text = _clean_search_text("\n".join(searchable_lines))
        if not section["excluded"] and (section["title"] or text):
            render_lines = [section["raw_heading"], *searchable_lines]
            concepts, content_tags, references = _search_metadata_from_lines(
                [section["raw_heading"], *searchable_lines],
                shadowed_reference_keys,
            )
            concept_keys = [_search_key(concept) for concept in concepts if _search_key(concept)]
            reference_keys = [_search_key(reference) for reference in references if _search_key(reference)]
            primary_concept = concepts[0] if concepts else ""
            section_order += 1
            section_entries.append(
                {
                    "kind": "section",
                    "location": f"{page_url}#{section['anchor']}",
                    "page_url": page_url,
                    "page_title": page_title,
                    "group": page_url,
                    "page_order": page_order,
                    "section_order": section_order,
                    "content_line": int(section.get("content_line") or 0),
                    "level": section["level"],
                    "title": section["title"],
                    "search_title": _clean_search_match_text(section["raw_heading"]),
                    "text": text,
                    "search_text": _clean_search_match_text("\n".join(searchable_lines)),
                    "context": _search_context_lines(searchable_lines),
                    "render_context": _search_render_context_lines(render_lines),
                    "section_lines_raw": render_lines,
                    "breadcrumb": section["breadcrumb"],
                    "concepts": concepts,
                    "concept_keys": concept_keys,
                    "primary_concept": primary_concept,
                    "content_tags": content_tags,
                    "references": references,
                    "reference_keys": reference_keys,
                    "tags": ["page"],
                    "filter_tags": page_tags,
                }
            )
        section = None

    for line_no, line in enumerate(lines):
        heading = _search_heading_from_line(line)
        if heading:
            level, title, self_excluded, anchor_title = heading
            if excluded_until_level is not None and level <= excluded_until_level:
                excluded_until_level = None
            inherited_excluded = excluded_until_level is not None
            excluded = self_excluded or inherited_excluded
            if self_excluded:
                excluded_until_level = level
            if level == 1 and not saw_page_h1 and not yaml_page_title:
                finish_section()
                saw_page_h1 = True
                article_excluded = excluded
                if title:
                    page_title = title
                    page_search_title = _clean_search_match_text(anchor_title)
                continue
            if level > SEARCH_MAX_SECTION_LEVEL and not extract_wikilink_targets(line):
                if not excluded:
                    if section is not None:
                        section["lines"].append(line)
                    elif not article_excluded:
                        article_lines.append(line)
                continue
            finish_section()
            while heading_stack and heading_stack[-1][0] >= level:
                heading_stack.pop()
            heading_stack.append((level, title))
            section = {
                "level": level,
                "title": title,
                "raw_heading": line,
                "anchor": _slugify_search_heading(anchor_title, slug_counts),
                "excluded": excluded,
                "lines": [],
                "breadcrumb": _search_breadcrumb_from_stack(heading_stack),
                "content_line": line_no,
            }
            continue

        if excluded_until_level is not None:
            continue
        if section is not None:
            section["lines"].append(line)
        elif not article_excluded:
            article_lines.append(line)

    finish_section()
    article_text = _clean_search_text("\n".join(article_lines))
    article_concepts, article_content_tags, article_references = _search_metadata_from_lines(
        article_lines,
        shadowed_reference_keys,
    )
    article_concept_keys = [_search_key(concept) for concept in article_concepts if _search_key(concept)]
    article_reference_keys = [_search_key(reference) for reference in article_references if _search_key(reference)]
    article = {
        "kind": "page",
        "location": page_url,
        "page_url": page_url,
        "page_title": page_title,
        "group": page_url,
        "page_order": page_order,
        "section_order": 0,
        "content_line": 0,
        "level": 1,
        "title": page_title,
        "search_title": page_search_title,
        "text": article_text,
        "search_text": _clean_search_match_text("\n".join(article_lines)),
        "context": _search_context_lines(article_lines),
        "render_context": _search_render_context_lines(article_lines),
        "breadcrumb": [],
        "concepts": article_concepts,
        "concept_keys": article_concept_keys,
        "primary_concept": article_concepts[0] if article_concepts else "",
        "content_tags": article_content_tags,
        "references": article_references,
        "reference_keys": article_reference_keys,
        "tags": ["page"],
        "filter_tags": page_tags,
    }
    return [article, *section_entries]


def _wikilink_search_mention_doc(
    keyword: str,
    entry: dict,
    *,
    nav_order: dict[str, int],
    excluded_page_urls: set[str],
) -> dict | None:
    page_url = str(entry.get("page_url") or "")
    if not page_url or page_url in excluded_page_urls:
        return None
    section_lines_raw = list(entry.get("section_lines_raw") or entry.get("section_lines") or [])
    if not section_lines_raw:
        return None
    # An excluded section must produce no search docs at all - without this check,
    # the excluded heading's text leaks into the mention doc's text/breadcrumb
    # (heading_path is attr-stripped upstream, so the marker-based section stripper
    # can no longer catch it there).
    if _section_lines_search_excluded(section_lines_raw):
        return None
    title = str(entry.get("title") or keyword)
    heading_path = entry.get("heading_path") or []
    occurrence_index = int(entry.get("occurrence_index") or 0)
    text = _compact_context_lines([entry], limit=1)
    concept_keys = [_search_key(title), _search_key(keyword)]
    slug = re.sub(r"[^a-z0-9]+", "-", keyword.lower()).strip("-") or "concept"
    return {
        "kind": "mention",
        "location": f"{page_url}#wikilink-{slug}-{occurrence_index}",
        "page_url": page_url,
        "page_title": entry.get("page_title") or "",
        "group": page_url,
        "page_order": nav_order.get(page_url, 999999),
        "section_order": occurrence_index,
        "content_line": int(entry.get("line_idx") or 0),
        "title": title,
        "search_title": "",
        "text": text,
        "search_text": _clean_search_match_text(
            "\n".join([*(str(part) for part in heading_path), *section_lines_raw])
        ),
        "context": _search_context_lines(section_lines_raw[:24]),
        "render_context": _search_render_context_lines(section_lines_raw),
        "section_lines_raw": section_lines_raw,
        "section_kw_offset": int(entry.get("section_kw_offset") or 0),
        "breadcrumb": heading_path,
        "concepts": [title],
        "concept_keys": [key for key in concept_keys if key],
        "primary_concept": title,
        "content_tags": [],
        "references": [],
        "reference_keys": [],
        "tags": ["mention"],
        "filter_tags": [],
    }


def _reference_search_occurrence_doc(
    keyword: str,
    entry: dict,
    *,
    nav_order: dict[str, int],
    excluded_page_urls: set[str],
) -> dict | None:
    page_url = str(entry.get("page_url") or "")
    if not page_url or page_url in excluded_page_urls:
        return None
    section_lines_raw = list(entry.get("section_lines_raw") or entry.get("section_lines") or [])
    if not section_lines_raw or _section_lines_search_excluded(section_lines_raw):
        return None
    title = str(entry.get("title") or keyword)
    heading_path = list(entry.get("heading_path") or [])
    occurrence_index = int(entry.get("occurrence_index") or 0)
    slug = re.sub(r"[^a-z0-9]+", "-", keyword.lower()).strip("-") or "reference"
    reference_keys = list(dict.fromkeys(
        key for key in (_search_key(title), _search_key(keyword)) if key
    ))
    return {
        "kind": "reference_occurrence",
        "location": f"{page_url}#wikilink-{slug}-{occurrence_index}",
        "page_url": page_url,
        "page_title": entry.get("page_title") or "",
        "group": page_url,
        "page_order": nav_order.get(page_url, 999999),
        "section_order": occurrence_index,
        "content_line": int(entry.get("line_idx") or 0),
        "title": title,
        "search_title": "",
        "text": _compact_context_lines([entry], limit=1),
        "search_text": "",
        "context": _search_context_lines(section_lines_raw[:24]),
        "render_context": _search_render_context_lines(section_lines_raw),
        "section_lines_raw": section_lines_raw,
        "section_kw_offset": int(entry.get("section_kw_offset") or 0),
        "breadcrumb": heading_path,
        "concepts": [],
        "concept_keys": [],
        "primary_concept": "",
        "content_tags": [],
        "references": [title],
        "reference_keys": reference_keys,
        "tags": ["reference"],
        "filter_tags": [],
    }


def _wikilink_entry_rank(concept_key: str, keyword: str, entry: dict) -> int:
    rank = 0
    if _search_key(keyword) == concept_key:
        rank += 20
    rank += len(concept_key.split())
    offset = int(entry.get("section_kw_offset") or 0)
    if offset > 0:
        rank += 5
    occurrence_index = int(entry.get("occurrence_index") or 0)
    rank -= occurrence_index
    return rank


def _best_wikilink_entry_for_section(
    doc: dict,
    wikilinks_index: dict[str, list[dict]],
) -> tuple[list[str], int] | None:
    page_url = str(doc.get("page_url") or "")
    if not page_url:
        return None
    breadcrumb = tuple(doc.get("breadcrumb") or [])
    concept_keys = [key for key in (doc.get("concept_keys") or []) if key]
    if not concept_keys and doc.get("primary_concept"):
        concept_keys = [_search_key(str(doc.get("primary_concept")))]
    best: tuple[list[str], int] | None = None
    best_rank = -1
    for concept_key in concept_keys:
        for keyword, entries in wikilinks_index.items():
            if _search_key(keyword) != concept_key:
                continue
            for entry in entries:
                if str(entry.get("page_url") or "") != page_url:
                    continue
                entry_path = tuple(entry.get("heading_path") or [])
                if breadcrumb and entry_path and entry_path != breadcrumb:
                    continue
                section_lines_raw = list(
                    entry.get("section_lines_raw") or entry.get("section_lines") or []
                )
                if not section_lines_raw:
                    continue
                # Never back-fill a search-excluded section's raw lines into a
                # page/section doc - that would resurface excluded content in
                # search snippets.
                if _section_lines_search_excluded(section_lines_raw):
                    continue
                rank = _wikilink_entry_rank(concept_key, keyword, entry)
                if rank > best_rank:
                    best_rank = rank
                    best = (section_lines_raw, int(entry.get("section_kw_offset") or 0))
    return best


def _enrich_search_doc_with_wikilink_section(
    doc: dict,
    wikilinks_index: dict[str, list[dict]],
) -> dict:
    if doc.get("kind") not in {"page", "section"}:
        return doc
    match = _best_wikilink_entry_for_section(doc, wikilinks_index)
    if not match:
        return doc
    section_lines_raw, offset = match
    updates: dict = {}
    if not doc.get("section_lines_raw"):
        updates["section_lines_raw"] = section_lines_raw
    current_offset = int(doc.get("section_kw_offset") or 0)
    if offset > 0 and (current_offset == 0 or doc.get("kind") == "section"):
        updates["section_kw_offset"] = offset
    if not updates:
        return doc
    return {**doc, **updates}


def build_knotis_search_index(
    md_files: list[Path],
    wikilinks_index: dict[str, list[dict]],
    references_index: dict[str, list[dict]],
    content_tags_index: dict[str, list[dict]],
    search_config: dict,
    nav_order: dict[str, int] | None = None,
    excluded_page_urls: set[str] | None = None,
    excluded_keywords: set[str] | None = None,
    knotis_defaults: dict | None = None,
) -> dict:
    docs: list[dict] = []
    nav_order = nav_order or {}
    excluded_page_urls = excluded_page_urls or set()
    excluded_keywords = excluded_keywords or set()
    shadowed_reference_keys = {_search_key(keyword) for keyword in references_index}

    for md_path in md_files:
        page_url = knotis_site_io.page_url_from_path(md_path)
        if page_url in excluded_page_urls:
            continue
        docs.extend(parse_search_page_entries(
            md_path,
            page_order=nav_order.get(page_url, 999999),
            shadowed_reference_keys=shadowed_reference_keys,
        ))

    for keyword, entries in sorted(wikilinks_index.items()):
        if keyword in excluded_keywords:
            continue
        concept_entries = [
            entry for entry in entries
            if entry.get("mode") != "reference" and entry.get("page_url") not in excluded_page_urls
        ]
        if not concept_entries:
            continue
        title = concept_entries[0].get("title") or keyword
        docs.append(
            {
                "kind": "concept",
                "location": f"knotis://concept/{keyword}",
                "group": f"concept:{keyword}",
                "title": title,
                "search_title": "",
                "text": _compact_context_lines(concept_entries),
                "search_text": "",
                "breadcrumb": [],
                "concepts": [title],
                "concept_keys": [_search_key(title), _search_key(keyword)],
                "primary_concept": title,
                "content_tags": [],
                "references": [],
                "reference_keys": [],
                "page_order": min(
                    nav_order.get(str(entry.get("page_url") or ""), 999999)
                    for entry in concept_entries
                ),
                "tags": ["concept"],
                "action": {"type": "concept", "keyword": keyword},
                "count": len(concept_entries),
            }
        )

    for keyword, entries in sorted(references_index.items()):
        if keyword in excluded_keywords:
            continue
        for entry in entries:
            occurrence_doc = _reference_search_occurrence_doc(
                keyword,
                entry,
                nav_order=nav_order,
                excluded_page_urls=excluded_page_urls,
            )
            if occurrence_doc:
                docs.append(occurrence_doc)

    for keyword, entries in sorted(references_index.items()):
        if keyword in excluded_keywords:
            continue
        reference_entries = [
            entry for entry in entries if entry.get("page_url") not in excluded_page_urls
        ]
        if not reference_entries:
            continue
        title = reference_entries[0].get("title") if reference_entries else keyword
        docs.append(
            {
                "kind": "reference",
                "location": f"knotis://reference/{keyword}",
                "group": f"reference:{keyword}",
                "title": title or keyword,
                "search_title": "",
                "text": _compact_context_lines(reference_entries),
                "search_text": "",
                "breadcrumb": [],
                "concepts": [],
                "concept_keys": [],
                "primary_concept": "",
                "content_tags": [],
                "references": [title or keyword],
                "reference_keys": [_search_key(title or keyword), _search_key(keyword)],
                "page_order": min(
                    nav_order.get(str(entry.get("page_url") or ""), 999999)
                    for entry in reference_entries
                ),
                "tags": ["reference"],
                "action": {"type": "reference", "keyword": keyword},
                "count": len(reference_entries),
            }
        )

    for content_tag, entries in sorted(content_tags_index.items()):
        content_tag_entries = [
            entry for entry in entries if entry.get("page_url") not in excluded_page_urls
        ]
        if not content_tag_entries:
            continue
        docs.append(
            {
                "kind": "content_tag",
                "location": f"knotis://content-tag/{content_tag.lstrip('#')}",
                "group": f"content_tag:{content_tag}",
                "title": content_tag,
                "search_title": content_tag,
                "text": _compact_context_lines(content_tag_entries),
                "search_text": _clean_search_match_text(_compact_context_lines(content_tag_entries)),
                "breadcrumb": [],
                "concepts": [],
                "concept_keys": [],
                "primary_concept": "",
                "content_tags": [content_tag],
                "references": [],
                "reference_keys": [],
                "page_order": min(
                    nav_order.get(str(entry.get("page_url") or ""), 999999)
                    for entry in content_tag_entries
                ) if content_tag_entries else 999999,
                "tags": ["content_tag"],
                "action": {"type": "content_tag", "content_tag": content_tag},
                "count": len(content_tag_entries),
            }
        )

    for keyword, entries in sorted(wikilinks_index.items()):
        if keyword in excluded_keywords:
            continue
        for entry in entries:
            if entry.get("mode") == "reference":
                continue
            mention_doc = _wikilink_search_mention_doc(
                keyword,
                entry,
                nav_order=nav_order,
                excluded_page_urls=excluded_page_urls,
            )
            if mention_doc:
                docs.append(mention_doc)

    docs = [_enrich_search_doc_with_wikilink_section(doc, wikilinks_index) for doc in docs]

    for idx, doc in enumerate(docs):
        doc["id"] = doc.get("id") or _knotis_search_id(doc.get("kind", "doc"), doc.get("location", idx))

    return build_knotis_search_shell(search_config, docs, knotis_defaults=knotis_defaults)


def build_knotis_search_shell(
    search_config: dict,
    docs: list[dict],
    *,
    knotis_defaults: dict | None = None,
) -> dict:
    kind_counts: dict[str, int] = {}
    for doc in docs:
        kind = str(doc.get("kind", "unknown"))
        kind_counts[kind] = kind_counts.get(kind, 0) + 1

    meta: dict = {
        "generator": "Knotis",
        "version": 1,
        "counts": kind_counts,
    }
    if isinstance(knotis_defaults, dict) and knotis_defaults:
        meta["defaults"] = knotis_defaults

    return {
        "meta": meta,
        "config": {
            "lang": ["en"],
            "separator": SEARCH_SEPARATOR,
            "fields": {
                "search_title": {"boost": 1000},
                "search_text": {"boost": 1},
                "tags": {"boost": 100000},
            },
        },
        "options": {
            "enabled": bool(search_config.get("enabled", True)),
            "suggest": True,
            "filters": True,
            "order": list(search_config.get("order", [])),
        },
        "docs": docs,
    }


def write_knotis_search_index(
    search_index: dict,
    search_config: dict,
    site_assets_dir: Path | None,
    docs_assets_dir: Path | None = None,
) -> None:
    index_path = Path(KNOTIS_SEARCH_INDEX_PATH)
    docs_out = (docs_assets_dir or knotis_site_io.DOCS_DIR / "assets") / index_path.name
    search_json = json.dumps(search_index, indent=2, ensure_ascii=False)
    docs_out.parent.mkdir(parents=True, exist_ok=True)
    _write_if_changed(docs_out, search_json)

    if site_assets_dir and site_assets_dir.is_dir():
        site_root = site_assets_dir.parent
        site_out = site_root / index_path
        site_out.parent.mkdir(parents=True, exist_ok=True)
        _write_if_changed(site_out, search_json)
