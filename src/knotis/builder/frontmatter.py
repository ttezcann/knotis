#!/usr/bin/env python3
from __future__ import annotations
"""
frontmatter.py — Minimal YAML front-matter parsing for Knotis page config.

Parses only the subset of YAML that Knotis front matter uses (scalars,
inline lists, nested maps/lists by indentation) and extracts the
`extra.knotis:` block from a page's front-matter lines.
"""

import re


def _yaml_scalar(value: str) -> str:
    return value.strip().strip("\"'")


def _strip_yaml_comment(text: str) -> str:
    in_single = False
    in_double = False
    prev = ""
    for idx, ch in enumerate(text):
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double and (idx == 0 or prev.isspace()):
            return text[:idx].rstrip()
        prev = ch
    return text.rstrip()


def _split_inline_yaml_list(inner: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    in_single = False
    in_double = False
    prev = ""
    for ch in inner:
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "[" and not in_single and not in_double:
            depth += 1
        elif ch == "]" and not in_single and not in_double and depth > 0:
            depth -= 1
        elif ch == "," and not in_single and not in_double and depth == 0:
            part = "".join(buf).strip()
            if part:
                parts.append(part)
            buf = []
            prev = ch
            continue
        buf.append(ch)
        prev = ch
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts


def _parse_yaml_scalar_value(value: str):
    value = _strip_yaml_comment(value.strip())
    if not value:
        return ""
    if value.startswith("[") and value.endswith("]"):
        inner = value[1:-1].strip()
        if not inner:
            return []
        return [_parse_yaml_scalar_value(part) for part in _split_inline_yaml_list(inner)]
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    if lowered in {"null", "none", "~"}:
        return None
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    return _yaml_scalar(value)


def _next_yaml_content_line(lines: list[str], start: int) -> int | None:
    i = start
    while i < len(lines):
        stripped = _strip_yaml_comment(lines[i]).strip()
        if stripped:
            return i
        i += 1
    return None


def _parse_yaml_list_block(lines: list[str], start: int, indent: int):
    items = []
    i = start
    while True:
        next_idx = _next_yaml_content_line(lines, i)
        if next_idx is None:
            return items, len(lines)
        raw_line = lines[next_idx]
        line_indent = len(raw_line) - len(raw_line.lstrip())
        if line_indent < indent:
            return items, next_idx
        if line_indent != indent:
            return items, next_idx
        stripped = _strip_yaml_comment(raw_line).strip()
        if not stripped.startswith("- "):
            return items, next_idx

        item_text = stripped[2:].strip()
        if item_text:
            items.append(_parse_yaml_scalar_value(item_text))
            i = next_idx + 1
            continue

        child_idx = _next_yaml_content_line(lines, next_idx + 1)
        if child_idx is None:
            items.append(None)
            return items, len(lines)
        child_indent = len(lines[child_idx]) - len(lines[child_idx].lstrip())
        if child_indent <= indent:
            items.append(None)
            i = child_idx
            continue
        child_stripped = _strip_yaml_comment(lines[child_idx]).strip()
        if child_stripped.startswith("- "):
            child_value, i = _parse_yaml_list_block(lines, child_idx, child_indent)
        else:
            child_value, i = _parse_yaml_map_block(lines, child_idx, child_indent)
        items.append(child_value)
    return items, i


def _parse_yaml_map_block(lines: list[str], start: int, indent: int):
    data = {}
    i = start
    while True:
        next_idx = _next_yaml_content_line(lines, i)
        if next_idx is None:
            return data, len(lines)
        raw_line = lines[next_idx]
        line_indent = len(raw_line) - len(raw_line.lstrip())
        if line_indent < indent:
            return data, next_idx
        if line_indent != indent:
            return data, next_idx
        stripped = _strip_yaml_comment(raw_line).strip()
        if stripped.startswith("- "):
            return data, next_idx
        key_match = re.match(r"^([A-Za-z0-9_-]+)\s*:\s*(.*)$", stripped)
        if not key_match:
            i = next_idx + 1
            continue
        key = key_match.group(1)
        value_text = key_match.group(2).strip()
        if value_text:
            data[key] = _parse_yaml_scalar_value(value_text)
            i = next_idx + 1
            continue

        child_idx = _next_yaml_content_line(lines, next_idx + 1)
        if child_idx is None:
            data[key] = {}
            return data, len(lines)
        child_indent = len(lines[child_idx]) - len(lines[child_idx].lstrip())
        if child_indent <= line_indent:
            data[key] = {}
            i = child_idx
            continue
        child_stripped = _strip_yaml_comment(lines[child_idx]).strip()
        if child_stripped.startswith("- "):
            data[key], i = _parse_yaml_list_block(lines, child_idx, child_indent)
        else:
            data[key], i = _parse_yaml_map_block(lines, child_idx, child_indent)
    return data, i


def _extract_knotis_block(lines: list[str]) -> tuple[list[str], int]:
    extra_idx = None
    extra_indent = 0
    for idx, line in enumerate(lines):
        stripped = _strip_yaml_comment(line).strip()
        if stripped == "extra:":
            extra_idx = idx
            extra_indent = len(line) - len(line.lstrip())
            break
    if extra_idx is None:
        return [], 0

    knotis_idx = None
    knotis_indent = extra_indent + 2
    for idx in range(extra_idx + 1, len(lines)):
        stripped = _strip_yaml_comment(lines[idx]).strip()
        if not stripped:
            continue
        indent = len(lines[idx]) - len(lines[idx].lstrip())
        if indent <= extra_indent:
            break
        if indent == knotis_indent and stripped == "knotis:":
            knotis_idx = idx
            break
    if knotis_idx is None:
        return [], 0

    block_lines: list[str] = []
    for idx in range(knotis_idx + 1, len(lines)):
        stripped = _strip_yaml_comment(lines[idx]).strip()
        indent = len(lines[idx]) - len(lines[idx].lstrip())
        if stripped and indent <= knotis_indent:
            break
        block_lines.append(lines[idx])
    return block_lines, knotis_indent + 2


def _split_front_matter(raw: str) -> tuple[dict, str]:
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}, raw

    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            meta_lines = lines[1:idx]
            body = "\n".join(lines[idx + 1 :])
            try:
                meta, _end = _parse_yaml_map_block(meta_lines, 0, 0)
            except Exception:
                meta = {}
            return meta if isinstance(meta, dict) else {}, body
    return {}, raw


def _page_excluded_from_search(meta: dict) -> bool:
    search = meta.get("search", {}) if isinstance(meta, dict) else {}
    return isinstance(search, dict) and search.get("exclude") is True


def _front_matter_tags(meta: dict) -> list[str]:
    if not isinstance(meta, dict):
        return []
    raw_tags = meta.get("tags", meta.get("tag", []))
    if raw_tags is None:
        return []
    values = raw_tags if isinstance(raw_tags, list) else [raw_tags]
    tags: list[str] = []
    seen: set[str] = set()
    for value in values:
        from .build_wikilinks import _clean_search_text  # avoids import cycle
        clean = _clean_search_text(str(value or "")).strip()
        key = clean.lower()
        if clean and key not in seen:
            tags.append(clean)
            seen.add(key)
    return tags
