#!/usr/bin/env python3
from __future__ import annotations
"""
scan_context.py — Markdown scanning primitives for the Knotis builder.

Wikilink/content-tag regexes and helpers that map lines to headings, list
hierarchy, parent chains, and extract the context shown in panes.
"""

import re
from html import unescape as html_unescape
from pathlib import Path


WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
CONTENT_TAG_RE = re.compile(r"(?<![\w/&(\[])#([A-Za-z][A-Za-z0-9_-]{0,48})\b")
HTML_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
LIST_ITEM_RE = re.compile(r"^\s*(?:[*\-+]|\d+(?:\.\d+)*\.?)\s+")
KNOTIS_METADATA_ATTR_RE = re.compile(
    r"\{[^}]*\bdata-(?:search|readaloud)-[^}]*\}",
    flags=re.I,
)





def _strip_knotis_metadata_attrs(value: str) -> str:
    return KNOTIS_METADATA_ATTR_RE.sub(" ", str(value or ""))


def _strip_slide_anchor_markers(value: str) -> str:
    return str(value or "").replace("⚓︎", "").replace("⚓", "")


def _strip_trailing_heading_attrs(value: str) -> str:
    return _strip_slide_anchor_markers(
        re.sub(r"\s*\{[^}]*\}\s*$", "", str(value or "")).strip()
    )


def split_wikilink_parts(keyword: str) -> tuple[str, str]:
    """Return (target, label) for [[target|label]] syntax."""
    target, sep, label = keyword.partition("|")
    target = target.strip()
    label = (label if sep else target).strip() or target
    if sep and label.lower() in {"ref", "reference"}:
        label = target
    return target, label


def is_valid_wikilink_raw(raw_keyword: str) -> bool:
    target, _label = split_wikilink_parts(raw_keyword)
    return bool(target.strip())


def wikilink_mode(keyword: str) -> str:
    """Return the behavior mode for a wikilink target."""
    _target, sep, label = keyword.partition("|")
    if sep and label.strip().lower() in {"ref", "reference"}:
        return "reference"
    return "concept"


def normalize(keyword: str) -> str:
    target, _label = split_wikilink_parts(keyword)
    return target.lower()


def wikilink_label(keyword: str) -> str:
    _target, label = split_wikilink_parts(keyword)
    return label


def iter_wikilink_matches(text: str):
    inline_code_ranges = _build_inline_code_ranges(text)
    for match in WIKILINK_RE.finditer(text):
        if _inside_any_range(match.start(), inline_code_ranges):
            continue
        yield match


def extract_wikilink_targets(text: str) -> list[str]:
    return [
        normalize(match.group(1))
        for match in iter_wikilink_matches(text)
        if is_valid_wikilink_raw(match.group(1))
    ]


def normalize_content_tag(tag: str) -> str:
    return "#" + tag.lstrip("#").lower()


def is_css_hex_color_token(tag: str) -> bool:
    return bool(re.fullmatch(r"[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8}", tag.lstrip("#")))


def _mask_html_comments(raw: str) -> str:
    """Keep comment line offsets stable while hiding their contents from scanners."""
    return HTML_COMMENT_RE.sub(
        lambda match: "".join("\n" if ch == "\n" else " " for ch in match.group(0)),
        raw,
    )


def parse_list_item(line: str) -> dict | None:
    bullet_match = re.match(r"^(\s*)([*\-+])\s+(.*)", line)
    if bullet_match:
        return {
            "indent": len(bullet_match.group(1)),
            "text": bullet_match.group(3).strip(),
            "number_parts": None,
        }

    number_match = re.match(r"^(\s*)(\d+(?:\.\d+)*)\.?\s+(.*)", line)
    if number_match:
        return {
            "indent": len(number_match.group(1)),
            "text": number_match.group(3).strip(),
            "number_parts": tuple(int(part) for part in number_match.group(2).split(".")),
        }

    return None


def parse_heading_line(line: str) -> tuple[int, str] | None:
    """Return (level, raw_text) for flush Markdown headings, else None."""
    flush_match = re.match(r"^(#{1,6})\s+(.*)$", line.strip())
    if flush_match:
        return len(flush_match.group(1)), flush_match.group(2).strip()
    return None


def heading_line_label(line: str) -> str:
    parsed = parse_heading_line(line)
    if not parsed:
        return ""
    title = _strip_slide_anchor_markers(_strip_trailing_heading_attrs(parsed[1].strip()))
    return WIKILINK_RE.sub(lambda match: wikilink_label(match.group(1)), title)


def build_list_parent_line_map(lines: list[str]) -> dict[int, int | None]:
    """Return {line_index: parent_line_index} for list items."""
    stack: list[tuple[int, dict]] = []
    parent_map: dict[int, int | None] = {}

    for i, line in enumerate(lines):
        item = parse_list_item(line)
        if item is None:
            parent_map[i] = None
            if parse_heading_line(line) is not None:
                stack.clear()
            continue

        while stack:
            parent_idx, parent = stack[-1]
            numbered_child = (
                item["number_parts"] is not None
                and parent["number_parts"] is not None
                and len(item["number_parts"]) == len(parent["number_parts"]) + 1
                and item["number_parts"][: len(parent["number_parts"])] == parent["number_parts"]
            )
            indented_child = item["indent"] > parent["indent"]
            if numbered_child or indented_child:
                break
            stack.pop()

        parent_map[i] = stack[-1][0] if stack else None
        stack.append((i, item))

    return parent_map


def page_title_from_path(md_path: Path) -> str:
    """Read YAML title or the first # heading from the body; fall back to filename stem."""
    try:
        from .frontmatter import _split_front_matter

        raw = md_path.read_text(encoding="utf-8")
        meta, body = _split_front_matter(raw)
        yaml_title = meta.get("title") if isinstance(meta, dict) else None
        if yaml_title:
            return str(yaml_title).strip()
        for line in body.splitlines():
            stripped = line.strip()
            if stripped.startswith("# "):
                return stripped[2:].strip()
    except Exception:
        pass
    # Fallback: derive from filename
    stem = re.sub(r"^\d+[-.]+", "", md_path.stem)
    return stem.strip("-_ ").replace("-", " ").replace("_", " ").title()


def _strip_markdown(text: str) -> str:
    """
    Light markdown normalisation for context storage.
    Keeps **bold**, *italic*, and ![image]() so the frontend can render them.
    Strips only structural noise: heading markers, bare [label](url) links,
    inline code, and excess whitespace.
    """
    # Markdown links [label](url) → label only (NOT image syntax — kept for rendering)
    text = re.sub(r"(?<!!)(\[([^\]]+)\]\([^)]+\))", r"\2", text)
    # Heading markers at line/string start
    text = re.sub(r"(^|\n)#{1,6}\s+", r"\1", text)
    # Inline code → plain text
    text = re.sub(r"`([^`]+)`", r"\1", text)
    # Collapse multiple spaces / newlines to a single space
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n+", " ", text)
    return text.strip()


def get_context(text: str, match: re.Match, window: int = 200) -> str:
    """Return up to `window` chars around the match, markdown-stripped then sentence-clipped."""
    start = max(0, match.start() - window)
    end = min(len(text), match.end() + window)
    raw_snippet = text[start:end]
    rel_start = max(0, match.start() - start)

    # Strip markdown FIRST so sentence boundaries are found in clean text,
    # not inside URLs or heading markers.
    clean = _strip_markdown(raw_snippet)

    # Re-locate the current keyword in the cleaned snippet. Counting the cleaned
    # prefix keeps later matches on the same line from snapping back to the first [[...]].
    kw_pos = len(_strip_markdown(raw_snippet[:rel_start]))
    if kw_pos > len(clean):
        kw_pos = len(clean) // 2  # fallback: middle of snippet

    # Clip to nearest sentence boundaries in the clean text
    left_bound = clean.rfind(". ", 0, kw_pos)
    right_bound = clean.find(". ", kw_pos)
    slice_start = left_bound + 2 if left_bound != -1 else 0
    slice_end = right_bound + 1 if right_bound != -1 else len(clean)
    clean = clean[slice_start:slice_end]

    clean = clean.strip()

    # Remove any leading word-fragment caused by the window starting mid-word
    # (e.g. "ent - SAMPLE:…" from cutting "Content" at char 200).
    # A clean start is an uppercase letter, digit, "[", or "(" — anything else
    # at the very beginning is a truncation artifact.
    clean = re.sub(r'^[^A-Z0-9\[\(]+', '', clean)

    return clean


def parse_list_hierarchy(lines: list[str]) -> dict[int, str]:
    """
    Return a map of {line_index: parent_item_text} for list items.
    A parent_item is the nearest ancestor list item one indent level up.
    """
    parent_line_map = build_list_parent_line_map(lines)
    parent_map: dict[int, str | None] = {}

    for i, line in enumerate(lines):
        if not LIST_ITEM_RE.match(line):
            parent_map[i] = None
            continue

        parent_idx = parent_line_map.get(i)
        if parent_idx is None:
            parent_map[i] = None
            continue

        parent_map[i] = parse_list_item(lines[parent_idx])["text"]

    return parent_map


def find_transparent_list_parent_keyword(
    lines: list[str],
    line_idx: int,
    list_parent_line_map: dict[int, int | None],
    current_keyword: str | None = None,
) -> str | None:
    """
    Return the nearest ancestor list keyword for a list item.

    Plain-text bridge bullets are transparent: if an immediate parent bullet has
    no wikilink targets, keep walking up until we find the closest linked ancestor.
    """
    item = parse_list_item(lines[line_idx])
    if item is None:
        return None

    parent_idx = list_parent_line_map.get(line_idx)
    while parent_idx is not None:
        ancestor_keywords = extract_wikilink_targets(lines[parent_idx])
        if current_keyword is not None:
            ancestor_keywords = [kw for kw in ancestor_keywords if kw != current_keyword]
        if ancestor_keywords:
            return ancestor_keywords[0]
        parent_idx = list_parent_line_map.get(parent_idx)

    return None


def build_heading_path_map(lines: list[str]) -> dict[int, list[str]]:
    """
    For each line, return the list of standard-markdown heading texts that are
    currently active above it, from outermost to innermost. [[...]] brackets
    are stripped.
    """
    stack: list[tuple[int, str]] = []  # (level, text)
    result: dict[int, list[str]] = {}
    code_line_mask = _build_fenced_code_line_mask(lines)
    for i, line in enumerate(lines):
        parsed = None if code_line_mask[i] else parse_heading_line(line)
        if parsed:
            level, text = parsed
            text = _strip_trailing_heading_attrs(
                WIKILINK_RE.sub(lambda match: wikilink_label(match.group(1)), text)
            )
            while stack and stack[-1][0] >= level:
                stack.pop()
            stack.append((level, text))
        result[i] = [t for _, t in stack]
    return result


def build_parent_chain_map(lines: list[str]) -> dict[int, list[str]]:
    """
    For each list-item line, return the full ordered list of ancestor bullet texts
    from outermost to innermost (raw text, [[...]] brackets stripped).
    Non-list lines get an empty list.
    """
    parent_line_map = build_list_parent_line_map(lines)
    result: dict[int, list[str]] = {}
    for i, _line in enumerate(lines):
        item = parse_list_item(lines[i])
        if item is None:
            result[i] = []
            continue

        chain: list[str] = []
        parent_idx = parent_line_map.get(i)
        while parent_idx is not None:
            parent_item = parse_list_item(lines[parent_idx])
            parent_text = WIKILINK_RE.sub(lambda m: wikilink_label(m.group(1)), parent_item["text"])
            chain.append(parent_text)
            parent_idx = parent_line_map.get(parent_idx)
        result[i] = list(reversed(chain))
    return result


def build_linked_list_ancestor_chain_map(lines: list[str]) -> dict[int, list[str]]:
    """
    For each list-item line, return the ordered list of ancestor keywords from
    outermost to innermost, using the same first-keyword selection rule as
    transparent list-parent inference.
    """
    parent_line_map = build_list_parent_line_map(lines)
    result: dict[int, list[str]] = {}

    for i, _line in enumerate(lines):
        item = parse_list_item(lines[i])
        if item is None:
            result[i] = []
            continue

        chain: list[str] = []
        parent_idx = parent_line_map.get(i)
        while parent_idx is not None:
            ancestor_keywords = extract_wikilink_targets(lines[parent_idx])
            if ancestor_keywords:
                chain.append(ancestor_keywords[0])
            parent_idx = parent_line_map.get(parent_idx)
        result[i] = list(reversed(chain))

    return result


def is_comparison_heading_section(lines: list[str], heading_idx: int) -> bool:
    """
    Return True for plain headings such as "Permanent vs. temporary migration"
    whose immediate top-level bullet children define two or more distinct concepts.
    """
    if extract_wikilink_targets(lines[heading_idx]):
        return False
    parsed = parse_heading_line(lines[heading_idx])
    if not parsed:
        return False
    _level, heading_text = parsed
    if not re.search(r"\bvs\.?\b", heading_text, re.I):
        return False

    sibling_keywords: list[str] = []
    for j in range(heading_idx + 1, len(lines)):
        if parse_heading_line(lines[j]) is not None:
            break
        item = parse_list_item(lines[j])
        if item is None or item["indent"] != 0:
            continue
        sibling_keywords.extend(extract_nonreference_wikilink_targets(lines[j]))
    return len(set(sibling_keywords)) >= 2


def infer_keyword_from_plain_heading(heading_text: str, known_keywords: set[str]) -> str | None:
    """
    Return an existing keyword mentioned plainly in a heading, preferring the
    longest match when multiple concepts appear.
    """
    normalized_heading = heading_text.lower()
    matches: list[tuple[int, int, str]] = []
    for keyword in known_keywords:
        if not keyword:
            continue
        pattern = rf"(?<![\w-]){re.escape(keyword)}(?![\w-])"
        match = re.search(pattern, normalized_heading)
        if match:
            matches.append((-(match.end() - match.start()), match.start(), keyword))
    if not matches:
        return None
    return sorted(matches)[0][2]


def extract_nonreference_wikilink_targets(text: str) -> list[str]:
    """Return normalized wikilink targets that are not reserved |ref links."""
    targets: list[str] = []
    for match in iter_wikilink_matches(text):
        raw = match.group(1)
        if wikilink_mode(raw) == "reference":
            continue
        targets.append(normalize(raw))
    return targets


def build_heading_parent_keyword_map(lines: list[str]) -> dict[int, str | None]:
    """
    For each heading line, return the nearest ancestor section keyword.
    A heading's own keyword is inferred from either:
    - the first wikilink on the heading line, or
    - the first wikilink in the lead content immediately below that heading,
      stopping at the next heading of any depth.
    """
    heading_keyword_map = build_heading_keyword_map(lines)
    heading_stack: list[tuple[int, str | None]] = []
    result: dict[int, str | None] = {}

    for i, line in enumerate(lines):
        parsed = parse_heading_line(line)
        if not parsed:
            result[i] = None
            continue

        level, _text = parsed
        while heading_stack and heading_stack[-1][0] >= level:
            heading_stack.pop()

        parent_kw = next((kw for _, kw in reversed(heading_stack) if kw is not None), None)
        result[i] = parent_kw

        own_kw = heading_keyword_map.get(i)
        heading_stack.append((level, own_kw))

    return result


def build_heading_keyword_map(lines: list[str]) -> dict[int, str | None]:
    """
    Infer one representative keyword for each heading.
    Preference order:
    1. first wikilink on the heading line
    2. first wikilink in the heading's lead block before the next heading
    """
    result: dict[int, str | None] = {}
    known_keywords = {
        keyword
        for line in lines
        for keyword in extract_wikilink_targets(line)
    }

    for i, line in enumerate(lines):
        parsed = parse_heading_line(line)
        if not parsed:
            result[i] = None
            continue

        own_kw = next(iter(extract_wikilink_targets(line)), None)
        level, heading_text = parsed
        comparison_heading = (
            own_kw is None
            and is_comparison_heading_section(lines, i)
        )
        # Page titles (#) only define a graph keyword from an explicit [[wikilink]].
        # Plain-text matches like "Introduction to RStudio" must not become ancestors.
        if own_kw is None and level > 1:
            own_kw = infer_keyword_from_plain_heading(heading_text, known_keywords)
        if own_kw is None and not comparison_heading and level > 1:
            for j in range(i + 1, len(lines)):
                if parse_heading_line(lines[j]) is not None:
                    break
                if parse_list_item(lines[j]) is not None:
                    break
                child_keywords = extract_nonreference_wikilink_targets(lines[j])
                if child_keywords:
                    own_kw = child_keywords[0]
                    break

        result[i] = own_kw

    return result


def heading_has_single_keyword_definition(lines: list[str], heading_idx: int) -> bool:
    """
    Return True when the heading's defining keyword comes from a line with exactly
    one unique wikilink target.

    This keeps subsection-parent inference narrow: a deeper heading can act as a
    fallback parent only when its own heading line, or the first lead-content line
    that defines it, names one clear concept rather than several co-mentioned ones.
    """
    heading_line_keywords = list(dict.fromkeys(extract_wikilink_targets(lines[heading_idx])))
    if heading_line_keywords:
        return len(heading_line_keywords) == 1

    for j in range(heading_idx + 1, len(lines)):
        if parse_heading_line(lines[j]) is not None:
            break
        line_keywords = list(dict.fromkeys(extract_nonreference_wikilink_targets(lines[j])))
        if line_keywords:
            return len(line_keywords) == 1

    return False


def build_current_heading_line_map(lines: list[str]) -> dict[int, int | None]:
    """Return the nearest heading line at or above each line."""
    result: dict[int, int | None] = {}
    current_heading_idx: int | None = None
    code_line_mask = _build_fenced_code_line_mask(lines)

    for i, line in enumerate(lines):
        if not code_line_mask[i] and parse_heading_line(line) is not None:
            current_heading_idx = i
        result[i] = current_heading_idx

    return result


def infer_paragraph_parent_keyword(
    lines: list[str],
    line_idx: int,
    current_heading_line_map: dict[int, int | None],
) -> str | None:
    """
    Infer a parent keyword for a top-level list item from the nearest preceding prose
    paragraph in the same heading section.

    A paragraph qualifies only when it contains exactly one unique wikilink target.
    This lets patterns like:

        Intro paragraph with [[parent]]
        - [[child]]

    create hierarchy without turning unrelated prose into noisy parent guesses.
    Intervening prose with zero or multiple keywords is skipped while searching
    upward within the same heading section.
    """
    item = parse_list_item(lines[line_idx])
    if item is None or item["indent"] > 0:
        return None

    heading_idx = current_heading_line_map.get(line_idx)
    min_idx = 0 if heading_idx is None else heading_idx + 1
    i = line_idx - 1

    while i >= min_idx:
        line = lines[i]
        stripped = line.strip()

        if not stripped:
            i -= 1
            continue
        if parse_heading_line(line) is not None:
            break
        if parse_list_item(line) or stripped.startswith("|"):
            i -= 1
            continue

        paragraph_start = i
        while paragraph_start - 1 >= min_idx:
            prev_line = lines[paragraph_start - 1]
            prev_stripped = prev_line.strip()
            if (
                not prev_stripped
                or parse_heading_line(prev_line) is not None
                or parse_list_item(prev_line)
                or prev_stripped.startswith("|")
            ):
                break
            paragraph_start -= 1

        paragraph_keywords: list[str] = []
        for j in range(paragraph_start, i + 1):
            paragraph_keywords.extend(extract_wikilink_targets(lines[j]))
        unique_keywords = list(dict.fromkeys(paragraph_keywords))
        if len(unique_keywords) == 1:
            return unique_keywords[0]

        i = paragraph_start - 1

    return None


def build_paragraph_group_map(lines: list[str]) -> dict[int, str | None]:
    """
    Group lines into sibling blocks.
    - headings and list items: only their own line
    - prose paragraphs: consecutive non-blank prose lines
    """
    result: dict[int, str | None] = {}
    next_group = 0
    active_paragraph: str | None = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            result[i] = None
            active_paragraph = None
            continue

        if parse_heading_line(line) is not None or parse_list_item(line) or stripped.startswith("|"):
            next_group += 1
            result[i] = f"line:{next_group}"
            active_paragraph = None
            continue

        if active_paragraph is None:
            next_group += 1
            active_paragraph = f"para:{next_group}"
        result[i] = active_paragraph

    return result


def get_extended_context(lines: list[str], line_idx: int, raw_text: str, match: re.Match) -> str | None:
    """
    Extra content shown when the user presses ↓ in the backlinks pane.
    - List items  → all sibling items that follow at the same indent level
                    (so pressing ↓ on learning-outcome 1 reveals 2, 3, 4 …)
    - Prose / headings → a wider ±600-char window around the match
    Returns None when there is nothing meaningful to add.
    """
    line = lines[line_idx]
    if not LIST_ITEM_RE.match(line):
        # Prose: wider window; skip if identical to the regular short context
        wide = get_context(raw_text, match, window=600)
        short = get_context(raw_text, match, window=200)
        return wide if wide != short else None

    # List item: first skip past children of the current bullet — they are
    # already shown as child_items in the default card view and must not repeat.
    indent = len(line) - len(line.lstrip())
    i = line_idx + 1

    while i < len(lines):
        l = lines[i]
        if not l.strip():
            i += 1
            continue
        curr_indent = len(l) - len(l.lstrip())
        if curr_indent <= indent:
            break  # reached a sibling or parent — stop skipping
        i += 1

    # Collect everything that follows: siblings, headings, prose paragraphs.
    # This lets users read the rest of the page without navigating away.
    parts: list[str] = []
    while i < len(lines):
        l = lines[i]

        if not l.strip():
            i += 1
            continue

        curr_indent = len(l) - len(l.lstrip())

        # A shallower list item means we've left our list block — stop.
        if LIST_ITEM_RE.match(l) and curr_indent < indent:
            break

        # Level-1 heading is the page title — stop.
        if re.match(r'^#\s', l):
            break

        # Heading (## or deeper): include as bold plain text (no ## markers).
        heading_m = re.match(r'^#{2,6}\s+(.*)', l)
        if heading_m:
            text = _strip_markdown(heading_m.group(1).strip())
            if text:
                parts.append(f"**{text}**")   # ** markers → <strong> in the frontend
            i += 1
            continue

        # List item: preserve number marker or convert unordered marker to •
        if LIST_ITEM_RE.match(l):
            marker = _list_marker(l)
            text = _strip_markdown(LIST_ITEM_RE.sub("", l).strip())
            prefix = "  " if curr_indent > indent else ""
            parts.append(prefix + marker + text)
            i += 1
            continue

        # Prose line: include as plain text.
        text = _strip_markdown(l.strip())
        if text:
            parts.append(text)
        i += 1

    return "\n".join(parts) if parts else None


def _list_marker(line: str) -> str:
    """
    Return the display marker for a list line:
    - numbered items  → "1. ", "2. " … (preserved as-is)
    - unordered items → "• "           (normalises -, *, + to a bullet character)
    """
    m = re.match(r'^\s*(\d+\.)\s*', line)
    if m:
        return m.group(1) + " "
    return "• "


def get_bullet_context(lines: list[str], line_idx: int) -> tuple[str, list[str]]:
    """
    For a line that is a list item, return (bullet_text, [child_bullet_texts]).
    bullet_text keeps [[...]] so the frontend can highlight; child texts are stripped.
    The list marker ("1. " or "• ") is prepended so the context reads "1. Learn …"
    Returns (None, []) if the line is not a list item.
    """
    line = lines[line_idx]
    if not LIST_ITEM_RE.match(line):
        return None, []

    indent = len(line) - len(line.lstrip())
    marker = _list_marker(line)
    # Full bullet text with [[...]] intact for frontend highlighting
    context = marker + LIST_ITEM_RE.sub("", line).strip()

    child_items: list[str] = []
    for next_line in lines[line_idx + 1 :]:
        if not next_line.strip():
            continue  # skip blank lines inside list
        next_indent = len(next_line) - len(next_line.lstrip())
        if next_indent <= indent:
            break  # back to same or shallower level
        if LIST_ITEM_RE.match(next_line):
            child_text = LIST_ITEM_RE.sub("", next_line).strip()
            # Keep [[...]] brackets so the frontend can render them as clickable links
            child_items.append(child_text)

    return context, child_items


def get_section_content(lines: list[str], line_idx: int) -> tuple[list[str], list[str], int]:
    """
    Return (section_lines, section_lines_raw, offset) where section_lines are the
    flattened pane-safe markdown lines, section_lines_raw are the original markdown
    lines of the section, and offset is line_idx's position within that raw section.
    A section runs from the nearest heading (any level) above line_idx to the next
    heading of the same or higher level (or end-of-file).
    """
    code_line_mask = _build_fenced_code_line_mask(lines)

    # Walk backward to find the nearest heading at or before line_idx
    start = 0
    start_level = 6
    for i in range(line_idx, -1, -1):
        if code_line_mask[i]:
            continue
        parsed = parse_heading_line(lines[i])
        if parsed:
            start = i
            start_level = parsed[0]
            break

    # Walk forward to find the next heading at the same or higher level
    end = len(lines)
    for i in range(start + 1, len(lines)):
        if code_line_mask[i]:
            continue
        parsed = parse_heading_line(lines[i])
        if parsed and parsed[0] <= start_level:
            end = i
            break

    raw_section = lines[start:end]
    relative_idx = line_idx - start
    section = _flatten_special_blocks(raw_section)
    return section, raw_section, relative_idx


def _line_indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def _trim_trailing_blank_lines(lines: list[str]) -> list[str]:
    end = len(lines)
    while end > 1 and not lines[end - 1].strip():
        end -= 1
    return lines[:end]


def get_content_tag_section_content(lines: list[str], line_idx: int) -> tuple[list[str], list[str], int]:
    """
    Return pane context for content_tags.

    Content tags act as local content markers:
    - a content-tagged Markdown heading owns the content until the next Markdown
      heading at any level;
    - a content-tagged list item owns its indented children until the next
      parent/sibling item or heading.
    """
    line = lines[line_idx]
    parsed_heading = parse_heading_line(line)
    if parsed_heading:
        code_line_mask = _build_fenced_code_line_mask(lines)
        end = len(lines)
        for i in range(line_idx + 1, len(lines)):
            if code_line_mask[i]:
                continue
            next_heading = parse_heading_line(lines[i])
            if next_heading is not None:
                end = i
                break
        raw_section = _trim_trailing_blank_lines(lines[line_idx:end])
        section = _flatten_special_blocks(raw_section)
        return section, raw_section, 0

    if not LIST_ITEM_RE.match(line):
        return get_section_content(lines, line_idx)

    code_line_mask = _build_fenced_code_line_mask(lines)
    start_indent = _line_indent(line)
    end = len(lines)

    for i in range(line_idx + 1, len(lines)):
        if code_line_mask[i]:
            continue
        current = lines[i]
        if not current.strip():
            continue
        if parse_heading_line(current) is not None:
            end = i
            break
        current_indent = _line_indent(current)
        if current_indent <= start_indent:
            end = i
            break

    raw_section = _trim_trailing_blank_lines(lines[line_idx:end])
    section = _flatten_special_blocks(raw_section)
    return section, raw_section, 0


ADMONITION_RE = re.compile(r'^(\s*)[!?]{3}\+?\s+\w+(?:\s+"([^"]*)")?')
TAB_RE        = re.compile(r'^(\s*)===\+?\s+"([^"]*)"')
ICON_RE       = re.compile(r':[a-z0-9]+(?:[_-][a-z0-9]+)*:\s*')


def _flatten_special_blocks(lines: list[str]) -> list[str]:
    """
    Replace Zensical admonition and tabbed-content syntax with plain readable
    lines so the frontend does not show raw markup in the backlinks pane.

    Admonitions (top-level or indented inside lists):
        !!! type "Title"   →  **Title**
        ??? type "Title"   →  **Title**
        indented body      →  body (opener indent + 4 spaces stripped)

    Tabbed content:
        === ":icon: Label"  →  **Label**   (icon codes like :fontawesome-*: removed)
        ===+ "Label"        →  **Label**
        indented body       →  body (same indent stripping)
    """
    result = []
    body_indent = None  # spaces to strip from body lines of the current block
    for line in lines:
        # Check for admonition opener
        m = ADMONITION_RE.match(line)
        if m:
            opener_indent = len(m.group(1))
            body_indent = opener_indent + 4
            title = (m.group(2) or "").strip()
            if title:
                result.append(f"**{title}**")
            continue
        # Check for tab opener
        m = TAB_RE.match(line)
        if m:
            opener_indent = len(m.group(1))
            body_indent = opener_indent + 4
            # Strip icon codes (e.g. `:fontawesome-brands-windows:`) from the label
            title = ICON_RE.sub("", m.group(2)).strip()
            if title:
                result.append(f"**{title}**")
            continue
        # Inside a block body
        if body_indent is not None:
            if line == "" or line.startswith(" " * body_indent):
                result.append(line[body_indent:])
                continue
            else:
                body_indent = None  # non-indented line ends the block
        result.append(line)
    return result


FENCE_RE = re.compile(r"^[ \t]*(?:[-*+]\s+|\d+\.\s+)?(`{3,}|~{3,})", re.MULTILINE)


def _build_fenced_code_line_mask(lines: list[str]) -> list[bool]:
    mask: list[bool] = []
    active_marker: str | None = None

    for line in lines:
        stripped = line.lstrip()
        fence_match = re.match(r"^(?:[-*+]\s+|\d+\.\s+)?(`{3,}|~{3,})", stripped)
        is_code_line = active_marker is not None
        if fence_match:
            marker = fence_match.group(1)[0]
            mask.append(True)
            if active_marker is None:
                active_marker = marker
            elif marker == active_marker:
                active_marker = None
            continue

        mask.append(is_code_line)

    return mask


def _build_code_block_ranges(raw: str) -> list[tuple[int, int]]:
    """Return (start, end) char ranges of fenced code blocks in the raw file."""
    ranges = []
    fence_open = None
    for m in FENCE_RE.finditer(raw):
        if fence_open is None:
            fence_open = m.start()
        else:
            ranges.append((fence_open, m.end()))
            fence_open = None
    return ranges


def _inside_code_block(pos: int, ranges: list[tuple[int, int]]) -> bool:
    """Check if a char position falls inside any fenced code block range."""
    for start, end in ranges:
        if start <= pos < end:
            return True
        if pos < start:
            break
    return False


def _build_inline_code_ranges(raw: str) -> list[tuple[int, int]]:
    """Return char ranges for simple inline `code` spans."""
    ranges = []
    for match in re.finditer(r"`[^`\n]+`", raw):
        ranges.append((match.start(), match.end()))
    return ranges


def _inside_any_range(pos: int, ranges: list[tuple[int, int]]) -> bool:
    for start, end in ranges:
        if start <= pos < end:
            return True
        if pos < start:
            break
    return False


def _line_index_for_pos(line_starts: list[int], char_pos: int) -> int:
    line_idx = 0
    for idx, ls in enumerate(line_starts):
        if ls <= char_pos:
            line_idx = idx
        else:
            break
    return line_idx


def _is_markdown_heading_marker(line: str, column: int) -> bool:
    """Skip the leading # in '# Heading', while allowing '## Heading #tag'."""
    return bool(re.match(r"^#{1,6}\s", line)) and not line[:column].strip()
