"""Markdown extension that keeps Knotis slide marker comments rendering-neutral.

Slide markers are authoring controls, not visible Markdown content. This
extension removes marker-only lines before Python-Markdown parses the document,
then reattaches hidden marker elements to the rendered block tree so numbering,
lists, admonitions, details, tables, and fenced blocks render as if the
comments were never present.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import os
import re
import sys
from html import escape
from xml.etree import ElementTree as etree

from markdown.extensions import Extension
from markdown.postprocessors import Postprocessor
from markdown.preprocessors import Preprocessor
from markdown.treeprocessors import Treeprocessor


MARKER_RE = re.compile(r"^(\s*)<!--\s*((?:slide-end|slide-break|click)\b.*?)\s*-->\s*$", re.I)
MARKER_COMMENT_RE = re.compile(r"<!--\s*((?:slide-end|slide-break|click)\b.*?)\s*-->", re.I)
MARKER_LINE_RE = re.compile(r"^\s*(?:<!--\s*(?:slide-end|slide-break|click)\b.*?\s*-->\s*)+$", re.I)
HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.*)$")
LIST_ITEM_RE = re.compile(r"^(\s*)([-+*]|\d+[.)])\s+(.*)$")
FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})(.*)$")
ADMONITION_RE = re.compile(r"^(\s*)(!{3}|\?{3})\s+([^\s]+)(?:\s+(.*))?$")
BLOCKQUOTE_RE = re.compile(r"^\s{0,3}>")
TABLE_DELIM_RE = re.compile(r"^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$")
IMAGE_ONLY_RE = re.compile(r"^\s*!\[(.*?)\]\([^)]*\)\s*(?:\{[^{}]*\}\s*)?$")
IFRAME_START_RE = re.compile(r"^(\s*)(?:([-+*]|\d+[.)])\s+)?<iframe\b(.*)$", re.I)
IFRAME_END_RE = re.compile(r"</iframe\s*>", re.I)
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]*)\)")
WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
INLINE_CODE_RE = re.compile(r"`([^`]*)`")
HTML_TAG_RE = re.compile(r"<[^>]+>")
ATTR_LIST_RE = re.compile(r"\s*\{[^{}]*\}\s*$")
EMPH_RE = re.compile(r"(\*\*|__|\*|_|~~|==)")
ICON_SHORTCODE_RE = re.compile(r":[a-z0-9][a-z0-9_-]*:", re.I)
HTML_STASH_RE = re.compile(r"^\x02wzxhzdk:\d+\x03$")
STASH_TOKEN_RE = re.compile(r"\x02wzxhzdk:\d+\x03")
STASH_INDEX_RE = re.compile(r"\x02wzxhzdk:(\d+)\x03")
TABBED_HEADER_RE = re.compile(r"^(\s*)===\s+")
MARKER_TOKEN_RE = re.compile(r"@@KNOTIS_SLIDE_MARKER:([^@]+)@@")
MARKER_SPAN_HTML = r'(?:<span\b[^>]*\bdata-knotis-slide-marker="[^"]+"[^>]*></span>\s*)*'
WRAPPED_BLOCK_RE = re.compile(
    rf"<p>\s*({MARKER_SPAN_HTML})"
    r"((?:<div\b.*?</div>|<pre\b.*?</pre>))"
    rf"(\s*{MARKER_SPAN_HTML})\s*</p>",
    re.S,
)

BLOCK_TAGS = {"p", "li", "table", "blockquote", "details", "pre"}
HEADING_TAGS = {f"h{i}" for i in range(1, 7)}
MARKERLESS_BLOCK_KINDS = frozenset({"details", "admonition", "code", "table"})
MARKERLESS_RENDER_KINDS = MARKERLESS_BLOCK_KINDS


@dataclass(frozen=True)
class SourceBlock:
    kind: str
    start_line: int
    end_line: int
    indent: int
    list_type: str
    signature: str
    occurrence: int
    kind_index: int


@dataclass(frozen=True)
class MarkerRecord:
    marker_text: str
    marker_kind: str
    anchor_direction: str
    source_order: int
    source_line: int
    block_kind: str
    signature: str
    occurrence: int
    kind_index: int
    container_position: str = ""


@dataclass
class RenderedBlock:
    kind: str
    signature: str
    occurrence: int
    kind_index: int
    render_order: int
    element: etree.Element


def _page_path(md) -> str:
    if md is None:
        return ""
    try:
        from zensical.extensions.context import ContextPreprocessor

        context = ContextPreprocessor.from_markdown(md)
        if context and context.page and context.page.path:
            return str(context.page.path)
    except Exception:
        pass
    return ""


def _editor_line_offset(md) -> int:
    if md is None:
        return 0
    return int(getattr(md, "knotis_editor_line_offset", 0))


def _display_line(md, line: int) -> int:
    if md is None:
        return line + 1
    mapping = getattr(md, "knotis_render_to_editor_line", None)
    if mapping and 0 <= line < len(mapping):
        return int(mapping[line]) + 1
    return line + _editor_line_offset(md) + 1


def _warn(md, message: str, *, line: int | None = None) -> None:
    # Slide-marker match diagnostics are noisy during `serve`/`build`: a
    # marker often fails one match attempt and is recovered by a fallback,
    # so most of these lines are benign. Dropped-marker *regressions* are
    # caught by the test suite (e.g. test_module_01_marker_count), so this
    # is opt-in only. Set KNOTIS_SLIDE_MARKER_DEBUG=1 to see the lines.
    if not os.environ.get("KNOTIS_SLIDE_MARKER_DEBUG"):
        return
    prefix = "[knotis_slide_markers]"
    path = _page_path(md)
    if path and line is not None:
        print(f"{prefix} {path}: line {_display_line(md, line)}: {message}", file=sys.stderr)
    elif path:
        print(f"{prefix} {path}: {message}", file=sys.stderr)
    elif line is not None:
        print(f"{prefix} line {_display_line(md, line)}: {message}", file=sys.stderr)
    else:
        print(f"{prefix} {message}", file=sys.stderr)


def _marker_element(marker_text: str) -> etree.Element:
    marker = etree.Element("span")
    marker.set("hidden", "hidden")
    marker.set("data-knotis-slide-marker", marker_text)
    return marker


def _marker_token(marker_text: str) -> str:
    return f"@@KNOTIS_SLIDE_MARKER:{escape(marker_text, quote=True)}@@"


def _strip_attrs(text: str) -> str:
    return ATTR_LIST_RE.sub("", text.rstrip())


def _normalize_text(text: str) -> str:
    if not text:
        return ""
    text = STASH_TOKEN_RE.sub(" ", text)
    text = _strip_attrs(text)
    text = WIKILINK_RE.sub(
        lambda m: m.group(1) if not (m.group(2) or "").strip() or (m.group(2) or "").strip().casefold() in {"ref", "reference"} else m.group(2),
        text,
    )
    text = LINK_RE.sub(lambda m: m.group(1), text)
    text = INLINE_CODE_RE.sub(lambda m: m.group(1), text)
    text = ICON_SHORTCODE_RE.sub(" ", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = EMPH_RE.sub("", text)
    text = text.replace("\\", "")
    text = " ".join(text.split()).strip().casefold()
    text = re.sub(r"\(\s+", "(", text)
    text = re.sub(r"\s+\)", ")", text)
    return text


def _signature_match_key(signature: str) -> str:
    text = _normalize_text(signature)
    text = re.sub(r"\s+([.,;:!?])", r"\1", text)
    return text


def _unstash_text(text: str, md) -> str:
    if not text:
        return text
    stash = getattr(md, "htmlStash", None) if md is not None else None
    if stash is None:
        return text

    def replace(match: re.Match[str]) -> str:
        index_match = STASH_INDEX_RE.search(match.group(0))
        if index_match is None:
            return " "
        try:
            index = int(index_match.group(1))
            raw = stash.rawHtmlBlocks[index]
        except (IndexError, ValueError, TypeError):
            return " "
        if not isinstance(raw, str):
            return " "
        # Icon shortcodes stash inline <svg> whose <title> text does not
        # exist in the markdown source; drop the whole svg subtree so
        # source and rendered signatures stay comparable.
        stripped = re.sub(r"(?is)<svg\b.*?</svg>", " ", raw)
        stripped = HTML_TAG_RE.sub(" ", stripped)
        stripped = " ".join(stripped.split()).strip()
        return stripped or " "

    return STASH_TOKEN_RE.sub(replace, text)


def _first_nonempty(items: list[str]) -> str:
    for item in items:
        normalized = _normalize_text(item)
        if normalized:
            return normalized
    return ""


def _image_alt_from_line(line: str) -> str:
    match = IMAGE_ONLY_RE.match(_strip_attrs(line))
    if not match:
        return ""
    return _normalize_text(match.group(1))


def _heading_signature(line: str) -> str:
    match = HEADING_RE.match(line)
    return _normalize_text(match.group(2) if match else line)


def _list_signature(line: str) -> str:
    match = LIST_ITEM_RE.match(line)
    body = match.group(3) if match else line
    alt = _image_alt_from_line(body)
    if alt:
        return alt
    return _normalize_text(body)


def _list_type(line: str) -> str:
    match = LIST_ITEM_RE.match(line)
    if not match:
        return ""
    marker = match.group(2)
    return "ordered" if marker[:1].isdigit() else "unordered"


def _admonition_title(line: str) -> str:
    match = ADMONITION_RE.match(line)
    if not match:
        return _normalize_text(line)
    tail = match.group(4) or ""
    quote_match = re.search(r'"([^"]+)"', tail)
    if quote_match:
        return _normalize_text(quote_match.group(1))
    return _normalize_text(tail or match.group(3))


def _table_signature(lines: list[str]) -> str:
    for line in lines:
        if "|" in line and not TABLE_DELIM_RE.match(line):
            parts = [part.strip() for part in line.strip().strip("|").split("|")]
            signature = _first_nonempty(parts)
            if signature:
                return signature
    return ""


def _code_signature(lines: list[str]) -> str:
    if not lines:
        return ""
    fence = FENCE_RE.match(lines[0])
    if not fence:
        return _first_nonempty(lines)
    info = _normalize_text(fence.group(3))
    if info and info != "mermaid":
        pass
    for line in lines[1:]:
        if FENCE_RE.match(line):
            break
        normalized = _normalize_text(line)
        if normalized:
            return normalized
    return info


def _blockquote_signature(lines: list[str]) -> str:
    stripped = [re.sub(r"^\s{0,3}>\s?", "", line) for line in lines]
    return _first_nonempty(stripped)


def _paragraph_signature(lines: list[str]) -> str:
    alts = [_image_alt_from_line(line) for line in lines]
    alt = _first_nonempty(alts)
    if alt:
        return alt
    return _first_nonempty(lines)


def _line_indent(line: str) -> int:
    return len(line) - len(line.lstrip(" \t"))


def _is_ordered_list_marker(marker: str) -> bool:
    return bool(re.match(r"\d+[.)]", marker))


def _is_marker(line: str) -> bool:
    return bool(MARKER_LINE_RE.match(line))


def _dedent_list_runs_after_markers(lines: list[str]) -> list[str]:
    output = list(lines)
    slide_open = False
    for index, line in enumerate(lines):
        marker = MARKER_RE.match(line)
        if not marker or marker.group(1):
            continue
        marker_texts = _marker_texts(line)
        if not marker_texts:
            continue
        offset = 0
        while offset < len(marker_texts):
            marker_kind = marker_texts[offset].split(None, 1)[0].lower()
            next_marker_kind = (
                marker_texts[offset + 1].split(None, 1)[0].lower()
                if offset + 1 < len(marker_texts)
                else ""
            )
            if marker_kind == "slide-break":
                if next_marker_kind == "slide-end":
                    slide_open = False
                    offset += 2
                    continue
                if not slide_open:
                    slide_open = True
                    offset += 1
                    continue
                next_item = _next_nonblank_nonmarker(output, index + 1)
                if not next_item:
                    slide_open = True
                    offset += 1
                    continue
                next_index, next_line = next_item
                next_match = LIST_ITEM_RE.match(next_line)
                if not next_match or not _is_ordered_list_marker(next_match.group(2)):
                    slide_open = True
                    offset += 1
                    continue
                dedent = len(next_match.group(1))
                if dedent <= 0:
                    slide_open = True
                    offset += 1
                    continue
                cursor = next_index
                while cursor < len(output):
                    current = output[cursor]
                    if _is_marker(current):
                        break
                    if current.strip():
                        indent = _line_indent(current)
                        if indent < dedent:
                            break
                        output[cursor] = current[dedent:]
                    cursor += 1
                slide_open = True
                offset += 1
                continue
            if marker_kind == "slide-end":
                slide_open = False
            offset += 1
    return output


def _normalize_iframe_src(value: str) -> str:
    value = value.replace("/view", "/preview") if "drive.google.com/file/d/" in value else value
    if "youtube.com/embed/" in value or "youtube-nocookie.com/embed/" in value:
        for param in ("origin", "autoplay"):
            value = re.sub(rf"([?&]){param}=[^&\"']*", r"\1", value)
    value = value.replace("?&", "?").replace("&&", "&").rstrip("?&")
    return value


def _normalize_iframe_html(raw: str) -> str:
    html = " ".join(raw.split())
    html = re.sub(r"<iframe\b", "<iframe", html, flags=re.I)
    html = re.sub(r"\s*</iframe\s*>.*$", "</iframe>", html, flags=re.I)
    if not IFRAME_END_RE.search(html):
        html = html.rstrip(">") + "></iframe>" if html.rstrip().endswith(">") else html + "></iframe>"
    html = re.sub(
        r'\bsrc=(["\'])(.*?)\1',
        lambda match: f'src={match.group(1)}{_normalize_iframe_src(match.group(2))}{match.group(1)}',
        html,
        flags=re.I,
    )
    if "allowfullscreen" not in html.lower():
        html = re.sub(r">\s*</iframe>", " allowfullscreen></iframe>", html, flags=re.I)
    return html


def _normalize_raw_iframe_blocks(lines: list[str]) -> list[str]:
    output: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        match = IFRAME_START_RE.match(line)
        if not match:
            output.append(line)
            index += 1
            continue

        indent, marker, tail = match.groups()
        parts = [f"<iframe{tail}"]
        end_index = index
        while not IFRAME_END_RE.search(parts[-1]) and end_index + 1 < len(lines):
            candidate = lines[end_index + 1]
            if end_index + 1 > index and LIST_ITEM_RE.match(candidate):
                break
            parts.append(candidate.strip())
            end_index += 1
        html = _normalize_iframe_html(" ".join(parts))
        output.append(f"{indent}{marker} {html}" if marker else f"{indent}{html}")
        index = end_index + 1
    return output


def _list_item_line_starts_teaching_block(indent: str, body: str, lines: list[str], index: int) -> bool:
    stripped = body.lstrip()
    if not stripped:
        return False
    if FENCE_RE.match(f"{indent}{stripped}"):
        return True
    if ADMONITION_RE.match(f"{indent}{stripped}"):
        return True
    return _is_table_start(lines, index)


def _is_indented_teaching_block_line(line: str, lines: list[str], index: int, *, allow_fence: bool = True) -> bool:
    if not line.strip():
        return False
    if LIST_ITEM_RE.match(line):
        return False
    stripped = line.lstrip()
    if allow_fence and FENCE_RE.match(stripped):
        return True
    if ADMONITION_RE.match(stripped):
        return True
    if IMAGE_ONLY_RE.match(line) or IMAGE_ONLY_RE.match(stripped):
        return True
    return _is_table_start(lines, index)


def _table_run_end(lines: list[str], index: int) -> int:
    end = index
    while end < len(lines):
        line = lines[end]
        if _is_marker(line) or not line.strip() or "|" not in line:
            break
        end += 1
    return max(index, end - 1)


def _fence_run_end(lines: list[str], index: int) -> tuple[int, str]:
    line = lines[index]
    list_match = LIST_ITEM_RE.match(line)
    opener_line = list_match.group(3).lstrip() if list_match else line.lstrip()
    opener = FENCE_RE.match(opener_line)
    if not opener:
        return index, ""
    token = opener.group(2)
    end = index
    for cursor in range(index + 1, len(lines)):
        if _is_marker(lines[cursor]):
            break
        closing = FENCE_RE.match(lines[cursor].lstrip())
        if closing and closing.group(2)[0] == token[0] and len(closing.group(2)) >= len(token):
            return cursor, token
        end = cursor
    return end, token


def _attachment_block_end(lines: list[str], index: int, base_indent: int) -> int:
    line = lines[index]
    list_match = LIST_ITEM_RE.match(line)
    if list_match and _list_item_line_starts_teaching_block(
        list_match.group(1),
        list_match.group(3),
        lines,
        index,
    ):
        body = list_match.group(3).lstrip()
        if FENCE_RE.match(f"{list_match.group(1)}{body}"):
            end, _ = _fence_run_end(lines, index)
            return end
        if ADMONITION_RE.match(body):
            return _scan_indented_block(lines, index, len(list_match.group(1)) + 4)
        if _is_table_start(lines, index):
            return _table_run_end(lines, index)
        if IMAGE_ONLY_RE.match(body):
            return index
        return index

    if _is_table_start(lines, index):
        return _table_run_end(lines, index)
    if FENCE_RE.match(line.lstrip()):
        end, _ = _fence_run_end(lines, index)
        return end
    if ADMONITION_RE.match(line.lstrip()):
        return _scan_indented_block(lines, index, _line_indent(line))
    if IMAGE_ONLY_RE.match(line) or IMAGE_ONLY_RE.match(line.lstrip()):
        return index
    return index


def _attachment_block_lines(lines: list[str], start: int, end: int) -> list[str]:
    block: list[str] = []
    list_match = LIST_ITEM_RE.match(lines[start])
    if list_match and _list_item_line_starts_teaching_block(
        list_match.group(1),
        list_match.group(3),
        lines,
        start,
    ):
        block.append(lines[start])
        if _is_table_start(lines, start):
            for index in range(start + 1, end + 1):
                block.append(lines[index])
            return block
        if FENCE_RE.match(list_match.group(3).lstrip()):
            for index in range(start + 1, end + 1):
                block.append(lines[index])
            return block
        return block

    for index in range(start, end + 1):
        block.append(lines[index])
    return block


def _normalized_markerless_attachment(parent_indent: str, block_lines: list[str], *, as_sibling: bool = False) -> list[str]:
    marker_indent = parent_indent if as_sibling else f"{parent_indent}    "
    body_indent = f"{marker_indent}    "
    if not block_lines:
        return []

    first = block_lines[0]
    list_match = LIST_ITEM_RE.match(first)
    if list_match:
        opener = list_match.group(3).lstrip()
        if (
            FENCE_RE.match(opener)
            or ADMONITION_RE.match(opener)
            or ("|" in opener and len(block_lines) > 1)
        ):
            body_lines = [opener, *[line for line in block_lines[1:] if line.strip() or line == ""]]
        elif IMAGE_ONLY_RE.match(opener):
            return ["", f"{marker_indent}- {opener}"]
        else:
            body_lines = [line for line in block_lines if line.strip() or line == ""]
    else:
        body_lines = [line for line in block_lines if line.strip() or line == ""]

    if len(body_lines) == 1 and IMAGE_ONLY_RE.match(body_lines[0].lstrip()):
        return ["", f"{marker_indent}- {body_lines[0].lstrip()}"]

    non_empty = [line for line in body_lines if line.strip()]
    if non_empty:
        min_indent = min(len(line) - len(line.lstrip()) for line in non_empty)
        dedented: list[str] = []
        for line in body_lines:
            if not line.strip():
                dedented.append("")
            elif len(line) - len(line.lstrip()) >= min_indent:
                dedented.append(line[min_indent:])
            else:
                dedented.append(line.lstrip())
        body_lines = dedented

    output = ["", f"{marker_indent}- ", ""]
    for line in body_lines:
        if not line.strip():
            output.append("")
        else:
            output.append(f"{body_indent}{line}")
    return output


def _split_trailing_admonition_child(
    body_lines: list[str],
    opener_indent: int,
) -> tuple[list[str], list[str], int]:
    """Separate a final, blank-delimited child list from an admonition body."""

    body_indent = opener_indent + 4
    child_indent = body_indent + 4
    for index in range(len(body_lines) - 1, 0, -1):
        line = body_lines[index]
        match = LIST_ITEM_RE.match(line)
        candidate_indent = _line_indent(line)
        if not match or candidate_indent not in {body_indent, child_indent}:
            continue

        separator = index - 1
        while separator >= 0 and _is_blank(body_lines[separator]):
            separator -= 1
        if separator == index - 1:
            continue

        previous = LIST_ITEM_RE.match(body_lines[separator])
        previous_indent = _line_indent(body_lines[separator])
        is_deeper_child = candidate_indent == child_indent and previous_indent == body_indent
        is_returned_child = candidate_indent == body_indent and previous_indent > body_indent
        if not previous or not (is_deeper_child or is_returned_child):
            continue
        if any(
            candidate.strip() and _line_indent(candidate) < candidate_indent
            for candidate in body_lines[index:]
        ):
            continue
        return body_lines[: separator + 1], body_lines[index:], candidate_indent

    return body_lines, [], 0


def _scan_prose_list_attachment_end(lines: list[str], start: int) -> int:
    match = LIST_ITEM_RE.match(lines[start])
    if not match:
        return start
    base_indent = len(match.group(1))
    end = start
    index = start + 1
    while index < len(lines):
        line = lines[index]
        if _is_marker(line):
            end = index
            index += 1
            continue
        if _is_blank(line):
            next_item = _next_nonblank_nonmarker(lines, index + 1)
            if next_item is None:
                end = index
                index += 1
                continue
            next_index, next_line = next_item
            if _is_prose_attachment_opener(lines, next_index, next_line, base_indent):
                end = index
                index += 1
                continue
            break

        if _is_prose_attachment_opener(lines, index, line, base_indent):
            block_end = _attachment_block_end(lines, index, base_indent)
            end = block_end
            index = block_end + 1
            continue
        break
    return end


def _is_prose_attachment_opener(lines: list[str], index: int, line: str, base_indent: int) -> bool:
    if LIST_ITEM_RE.match(line):
        return False
    if _line_indent(line) <= base_indent:
        return False
    return _is_indented_teaching_block_line(line, lines, index)


def _prefix_orphan_teaching_lines_in_list_items(lines: list[str]) -> list[str]:
    output: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        match = LIST_ITEM_RE.match(line)
        if not match:
            output.append(line)
            index += 1
            continue

        output.append(line)
        end = _scan_list_item(lines, index)
        parent_indent = match.group(1)
        if _list_item_line_starts_teaching_block(parent_indent, match.group(3), lines, index):
            for cursor in range(index + 1, end + 1):
                output.append(lines[cursor])
            index = end + 1
            continue

        child_indent = f"{parent_indent}    "
        cursor = index + 1
        fence_token = ""
        while cursor <= end:
            current = lines[cursor]
            if _is_marker(current):
                fence_token = ""
                output.append(current)
                cursor += 1
                continue
            if _is_blank(current):
                output.append(current)
                cursor += 1
                continue

            list_match = LIST_ITEM_RE.match(current)
            if list_match:
                body = list_match.group(3).lstrip()
                fence_open = FENCE_RE.match(body)
                fence_token = fence_open.group(2) if fence_open else ""
                output.append(current)
                cursor += 1
                continue

            fence_match = FENCE_RE.match(current.lstrip())
            if fence_token and fence_match:
                token = fence_match.group(2)
                if token[0] == fence_token[0] and len(token) >= len(fence_token):
                    output.append(current)
                    fence_token = ""
                    cursor += 1
                    continue

            if fence_token:
                output.append(current)
                cursor += 1
                continue

            if _is_indented_teaching_block_line(current, lines, cursor) and _line_indent(current) > len(parent_indent):
                block_end = _attachment_block_end(lines, cursor, len(parent_indent))
                for offset, block_line in enumerate(lines[cursor : block_end + 1]):
                    if offset == 0:
                        output.append(f"{child_indent}- {block_line.lstrip()}")
                    else:
                        output.append(block_line)
                cursor = block_end + 1
                continue

            output.append(current)
            cursor += 1
        index = end + 1
    return output


def _normalize_indented_teaching_blocks_in_list_items(lines: list[str]) -> list[str]:
    """Normalize teaching blocks attached to prose list items."""

    lines = _prefix_orphan_teaching_lines_in_list_items(lines)
    output: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        match = LIST_ITEM_RE.match(line)
        if not match:
            output.append(line)
            index += 1
            continue

        indent, _marker, body = match.groups()
        if not body.strip() or _list_item_line_starts_teaching_block(indent, body, lines, index):
            output.append(line)
            index += 1
            continue

        output.append(line)
        body_end = max(_scan_list_item(lines, index), _scan_prose_list_attachment_end(lines, index))
        attachment_index = index + 1
        fence_token = ""
        while attachment_index <= body_end:
            current = lines[attachment_index]
            if _is_marker(current):
                fence_token = ""
                output.append(current)
                attachment_index += 1
                continue
            if _is_blank(current):
                output.append(current)
                attachment_index += 1
                continue

            list_match = LIST_ITEM_RE.match(current)
            if list_match:
                body = list_match.group(3).lstrip()
                fence_open = FENCE_RE.match(body)
                fence_token = fence_open.group(2) if fence_open else ""
                output.append(current)
                attachment_index += 1
                continue

            fence_match = FENCE_RE.match(current.lstrip())
            if fence_token and fence_match:
                token = fence_match.group(2)
                if token[0] == fence_token[0] and len(token) >= len(fence_token):
                    output.append(current)
                    fence_token = ""
                    attachment_index += 1
                    continue

            if fence_token:
                output.append(current)
                attachment_index += 1
                continue

            if _is_prose_attachment_opener(lines, attachment_index, current, len(indent)):
                block_end = _attachment_block_end(lines, attachment_index, len(indent))
                block_lines = _attachment_block_lines(lines, attachment_index, block_end)
                output.extend(_normalized_markerless_attachment(indent, block_lines))
                attachment_index = block_end + 1
                continue

            if (
                _line_indent(current) <= len(indent)
                and _is_indented_teaching_block_line(current, lines, attachment_index)
            ):
                block_end = _attachment_block_end(lines, attachment_index, len(indent))
                block_lines = _attachment_block_lines(lines, attachment_index, block_end)
                output.extend(_normalized_markerless_attachment(indent, block_lines, as_sibling=True))
                attachment_index = block_end + 1
                continue

            output.append(current)
            attachment_index += 1
        index = body_end + 1
    return output


def _strip_markerless_block_list_prefixes(lines: list[str]) -> list[str]:
    """Treat block list markers as invisible outline nodes."""

    def relative_to_indent(line: str, indent: str) -> str:
        return line[len(indent) :] if line.startswith(indent) else line.lstrip()

    def append_with_body_indent(line: str, indent: str, body_indent: str) -> None:
        if not line.strip():
            output.append("")
            return
        output.append(f"{body_indent}{relative_to_indent(line, indent)}")

    output: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        match = LIST_ITEM_RE.match(line)
        if not match:
            output.append(line)
            index += 1
            continue

        indent, marker, body = match.groups()
        if marker[:1].isdigit():
            output.append(line)
            index += 1
            continue
        stripped = body.lstrip()
        is_table_start = _is_table_start(lines, index)

        fence = FENCE_RE.match(f"{indent}{stripped}")
        admonition = ADMONITION_RE.match(f"{indent}{stripped}")
        if not (fence or admonition or is_table_start):
            output.append(line)
            index += 1
            continue

        body_indent = f"{indent}    "
        if output and output[-1].strip():
            output.append("")
        output.append(f"{indent}{marker} ")
        output.append("")
        output.append(f"{body_indent}{stripped}")

        index += 1
        if fence:
            fence_token = fence.group(2)
            while index < len(lines):
                append_with_body_indent(lines[index], indent, body_indent)
                closing = FENCE_RE.match(lines[index])
                index += 1
                if closing and closing.group(2).startswith(fence_token[0]) and len(closing.group(2)) >= len(fence_token):
                    break
        elif is_table_start:
            while index < len(lines):
                current = lines[index]
                if not current.strip() or "|" not in current:
                    break
                output.append(f"{body_indent}{current.strip()}")
                index += 1
        else:
            body_block_indent = len(indent) + 4
            body_lines: list[str] = []
            while index < len(lines):
                current = lines[index]
                if not current.strip():
                    body_lines.append("")
                    index += 1
                    continue
                if _line_indent(current) < body_block_indent:
                    break
                body_lines.append(current)
                index += 1

            body_lines, child_lines, child_indent = _split_trailing_admonition_child(body_lines, len(indent))
            for transformed_line in _strip_markerless_block_list_prefixes(body_lines):
                if not transformed_line.strip():
                    output.append("")
                else:
                    output.append(f"{body_indent}{relative_to_indent(transformed_line, indent)}")

            if child_lines:
                if output and output[-1].strip():
                    output.append("")
                for child_line in child_lines:
                    if not child_line.strip():
                        output.append("")
                    else:
                        output.append(f"{body_indent}{child_line[child_indent:]}")

        if index < len(lines) and lines[index].strip() and (not output or output[-1].strip()):
            output.append("")
    return output


def _marker_texts(line: str) -> list[str]:
    if not MARKER_LINE_RE.match(line):
        return []
    return [match.group(1).strip() for match in MARKER_COMMENT_RE.finditer(line)]


def _is_blank(line: str) -> bool:
    return not line.strip()


def _is_table_start(lines: list[str], index: int) -> bool:
    if "|" not in lines[index]:
        return False
    next_index = index + 1
    while next_index < len(lines) and _is_marker(lines[next_index]):
        next_index += 1
    if next_index >= len(lines):
        return False
    return bool(TABLE_DELIM_RE.match(lines[next_index]))


def _next_nonblank_nonmarker(lines: list[str], index: int) -> tuple[int, str] | None:
    for offset in range(index, len(lines)):
        if _is_marker(lines[offset]) or _is_blank(lines[offset]):
            continue
        return offset, lines[offset]
    return None


def _scan_fence(lines: list[str], start: int) -> int:
    opening = FENCE_RE.match(lines[start])
    if not opening:
        return start
    fence_token = opening.group(2)
    for index in range(start + 1, len(lines)):
        if _is_marker(lines[index]):
            continue
        closing = FENCE_RE.match(lines[index])
        if closing and closing.group(2).startswith(fence_token[0]) and len(closing.group(2)) >= len(fence_token):
            return index
    return len(lines) - 1


def _scan_indented_block(lines: list[str], start: int, base_indent: int) -> int:
    end = start
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if _is_marker(line):
            break
        if _is_blank(line):
            end = index
            continue
        if _line_indent(line) > base_indent:
            end = index
            continue
        break
    return end


def _scan_table(lines: list[str], start: int) -> int:
    end = start
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if _is_marker(line) or _is_blank(line) or "|" not in line:
            break
        end = index
    return end


def _scan_tabbed_block(lines: list[str], start: int) -> int:
    match = TABBED_HEADER_RE.match(lines[start])
    if not match:
        return start
    base_indent = len(match.group(1))
    end = start
    index = start + 1
    while index < len(lines):
        line = lines[index]
        if _is_marker(line):
            break
        if _is_blank(line):
            end = index
            index += 1
            continue
        if _line_indent(line) <= base_indent:
            if TABBED_HEADER_RE.match(line):
                end = index
                index += 1
                continue
            break
        end = index
        index += 1
    return end


def _scan_blockquote(lines: list[str], start: int) -> int:
    end = start
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if _is_marker(line):
            break
        if _is_blank(line):
            end = index
            continue
        if BLOCKQUOTE_RE.match(line):
            end = index
            continue
        break
    return end


def _scan_list_item(lines: list[str], start: int) -> int:
    match = LIST_ITEM_RE.match(lines[start])
    if not match:
        return start
    base_indent = len(match.group(1))
    end = start
    index = start + 1
    while index < len(lines):
        line = lines[index]
        if _is_marker(line):
            break
        if _is_blank(line):
            next_nonblank_index = index + 1
            while next_nonblank_index < len(lines) and _is_blank(lines[next_nonblank_index]):
                next_nonblank_index += 1
            if next_nonblank_index < len(lines) and _is_marker(lines[next_nonblank_index]):
                end = index
                break
            next_item = _next_nonblank_nonmarker(lines, index + 1)
            if not next_item:
                end = index
                break
            next_index, next_line = next_item
            next_list_match = LIST_ITEM_RE.match(next_line)
            if next_list_match and _line_indent(next_line) <= base_indent:
                end = index
                break
            if _line_indent(next_line) <= base_indent:
                end = index
                break
            end = next_index
            index = next_index
            continue
        next_list_match = LIST_ITEM_RE.match(line)
        if next_list_match and _line_indent(line) <= base_indent:
            break
        end = index
        index += 1
    return end


def _scan_paragraph(lines: list[str], start: int) -> int:
    end = start
    for index in range(start + 1, len(lines)):
        line = lines[index]
        if _is_marker(line) or _is_blank(line):
            break
        if HEADING_RE.match(line) or LIST_ITEM_RE.match(line) or ADMONITION_RE.match(line) or FENCE_RE.match(line) or BLOCKQUOTE_RE.match(line) or _is_table_start(lines, index):
            break
        end = index
    return end


def _list_item_wraps_block(lines: list[str], start: int, end: int) -> tuple[str, str] | None:
    match = LIST_ITEM_RE.match(lines[start])
    if not match:
        return None
    if match.group(3).strip():
        return None
    body_indent = len(match.group(1)) + 4
    for index in range(start + 1, end + 1):
        line = lines[index]
        if not line.strip():
            continue
        if _line_indent(line) < body_indent:
            break
        admonition = ADMONITION_RE.match(line)
        if admonition:
            token = admonition.group(2)
            kind = "details" if token == "???" else "admonition"
            return kind, _admonition_title(line)
        if FENCE_RE.match(line):
            return "code", _code_signature(lines[index : end + 1])
        if _is_table_start(lines, index):
            table_end = _scan_table(lines, index)
            return "table", _table_signature(lines[index : table_end + 1])
        break
    return None


def _block_from_lines(lines: list[str], start: int, end: int) -> tuple[str, str]:
    block_lines = lines[start : end + 1]
    first_line = lines[start]
    if HEADING_RE.match(first_line):
        return "heading", _heading_signature(first_line)
    if FENCE_RE.match(first_line):
        return "code", _code_signature(block_lines)
    if ADMONITION_RE.match(first_line):
        token = ADMONITION_RE.match(first_line).group(2)
        kind = "details" if token == "???" else "admonition"
        return kind, _admonition_title(first_line)
    if _is_table_start(lines, start):
        return "table", _table_signature(block_lines)
    if BLOCKQUOTE_RE.match(first_line):
        return "blockquote", _blockquote_signature(block_lines)
    if LIST_ITEM_RE.match(first_line):
        wrapped = _list_item_wraps_block(lines, start, end)
        if wrapped:
            return wrapped
        return "list_item", _list_signature(first_line)
    return "paragraph", _paragraph_signature(block_lines)


def _scan_source_blocks(lines: list[str]) -> list[SourceBlock]:
    blocks: list[SourceBlock] = []
    counts: Counter[tuple[str, str]] = Counter()
    kind_counts: Counter[str] = Counter()
    index = 0
    if lines and lines[0].strip() == "---":
        index = 1
        while index < len(lines):
            if lines[index].strip() == "---":
                index += 1
                break
            index += 1
    while index < len(lines):
        line = lines[index]
        if _is_marker(line) or _is_blank(line):
            index += 1
            continue
        if HEADING_RE.match(line):
            end = index
        elif FENCE_RE.match(line):
            end = _scan_fence(lines, index)
        elif ADMONITION_RE.match(line):
            end = _scan_indented_block(lines, index, _line_indent(line))
        elif _is_table_start(lines, index):
            end = _scan_table(lines, index)
        elif TABBED_HEADER_RE.match(line):
            index = _scan_tabbed_block(lines, index) + 1
            continue
        elif BLOCKQUOTE_RE.match(line):
            end = _scan_blockquote(lines, index)
        elif LIST_ITEM_RE.match(line):
            end = _scan_list_item(lines, index)
        else:
            end = _scan_paragraph(lines, index)
        kind, signature = _block_from_lines(lines, index, end)
        counts[(kind, signature)] += 1
        kind_counts[kind] += 1
        blocks.append(SourceBlock(kind, index, end, _line_indent(line), _list_type(line), signature, counts[(kind, signature)], kind_counts[kind]))
        index = end + 1
    return blocks


def _find_anchor_block(blocks: list[SourceBlock], marker_index: int, direction: str) -> SourceBlock | None:
    if direction == "next":
        for block in blocks:
            if block.start_line > marker_index:
                return block
        return None
    for block in reversed(blocks):
        if block.end_line < marker_index:
            return block
    return None


def _same_list_run(first: SourceBlock | None, second: SourceBlock | None) -> bool:
    return bool(
        first
        and second
        and first.kind == "list_item"
        and second.kind == "list_item"
        and first.indent == second.indent
        and first.list_type == second.list_type
    )


def _between_list_items(first: SourceBlock | None, second: SourceBlock | None) -> bool:
    return bool(first and second and first.kind == "list_item" and second.kind == "list_item")


def _marker_needs_separator_blank(previous_block: SourceBlock | None, next_block: SourceBlock | None) -> bool:
    if not previous_block or not next_block:
        return False
    if previous_block.kind == "list_item" and next_block.kind == "list_item":
        if _same_list_run(previous_block, next_block):
            return False
        if next_block.indent < previous_block.indent:
            return True
        return (
            previous_block.indent == next_block.indent
            and previous_block.list_type != next_block.list_type
        )
    return not _between_list_items(previous_block, next_block)


def _same_list_marker_needs_nested_separator(
    lines: list[str],
    previous_block: SourceBlock | None,
    next_block: SourceBlock | None,
) -> bool:
    if not previous_block or not next_block:
        return False
    if previous_block.kind != "list_item" or next_block.kind != "list_item":
        return False
    if previous_block.end_line <= previous_block.start_line:
        return False
    block_lines = lines[previous_block.start_line : previous_block.end_line + 1]
    has_nested_block = any(
        ADMONITION_RE.match(line) or FENCE_RE.match(line) or _is_table_start(lines, previous_block.start_line + offset)
        for offset, line in enumerate(block_lines)
    )
    if not has_nested_block:
        return False
    index = previous_block.end_line
    while index > previous_block.start_line and _is_blank(lines[index]):
        index -= 1
    return _line_indent(lines[index]) > next_block.indent


def _marker_continues_nested_list_after_block(
    previous_block: SourceBlock | None,
    next_block: SourceBlock | None,
) -> bool:
    return bool(
        previous_block
        and next_block
        and previous_block.kind == "list_item"
        and next_block.kind == "list_item"
        and next_block.start_line > previous_block.end_line
        and next_block.indent > previous_block.indent
    )


def _source_block_contains_markerless_teaching_block(
    lines: list[str],
    block: SourceBlock,
) -> bool:
    for index in range(block.start_line, block.end_line + 1):
        if index >= len(lines) or _is_marker(lines[index]):
            continue
        line = lines[index]
        match = LIST_ITEM_RE.match(line)
        if match and _list_item_line_starts_teaching_block(
            match.group(1),
            match.group(3),
            lines,
            index,
        ):
            return True
        if not match and _is_indented_teaching_block_line(line, lines, index):
            return True
    return False


def _slide_end_continues_nested_list_after_block(
    lines: list[str],
    previous_block: SourceBlock | None,
    next_block: SourceBlock | None,
) -> bool:
    return bool(
        previous_block
        and next_block
        and _marker_continues_nested_list_after_block(previous_block, next_block)
        and not _source_block_contains_markerless_teaching_block(lines, previous_block)
    )


def _embedded_table_span_in_source_block(lines: list[str], block: SourceBlock) -> tuple[int, int] | None:
    if block.kind != "list_item":
        return None
    for index in range(block.start_line, block.end_line + 1):
        if index >= len(lines) or _is_marker(lines[index]):
            continue
        if _is_table_start(lines, index):
            return index, _scan_table(lines, index)
    return None


def _table_marker_fields(lines: list[str], table_start: int, table_end: int) -> tuple[str, int, int]:
    signature = _table_signature(lines[table_start : table_end + 1])
    tables: list[tuple[int, int, str]] = []
    index = 0
    while index < len(lines):
        if _is_marker(lines[index]) or _is_blank(lines[index]):
            index += 1
            continue
        if _is_table_start(lines, index):
            end = _scan_table(lines, index)
            tables.append((index, end, _table_signature(lines[index : end + 1])))
            index = end + 1
            continue
        index += 1
    for kind_index, (start, end, table_signature) in enumerate(tables, start=1):
        if start == table_start and end == table_end:
            occurrence = sum(1 for _, _, prior_signature in tables[:kind_index] if prior_signature == signature)
            return signature, occurrence, kind_index
    return signature, 1, 1


def _slide_end_embedded_table_span(
    lines: list[str],
    previous_block: SourceBlock | None,
    next_block: SourceBlock | None,
) -> tuple[int, int] | None:
    if not previous_block or not next_block:
        return None
    if previous_block.kind != "list_item" or next_block.kind != "list_item":
        return None
    if next_block.indent <= previous_block.indent:
        return None
    if next_block.start_line <= previous_block.end_line:
        return None
    span = _embedded_table_span_in_source_block(lines, previous_block)
    if span is None:
        return None
    table_start, table_end = span
    if next_block.start_line <= table_end:
        return None
    return span


def _slide_end_pops_to_shallower_item(
    lines: list[str],
    previous_block: SourceBlock | None,
    next_block: SourceBlock | None,
) -> bool:
    # True when the marker leaves a deeper nested run (judged by the last
    # content line of the previous block, which may be a whole subtree) for
    # a shallower — but still nested — sibling item.
    if not (
        previous_block
        and next_block
        and previous_block.kind == "list_item"
        and next_block.kind == "list_item"
        and next_block.start_line > previous_block.end_line
        and next_block.indent > 0
    ):
        return False
    for index in range(previous_block.end_line, previous_block.start_line - 1, -1):
        if index >= len(lines):
            continue
        line = lines[index]
        # Only bullet lines carry nesting depth; fenced-code interiors and
        # continuation lines are indented arbitrarily deeper.
        if not re.match(r"\s*(?:[-*+]|\d+\.)\s", line):
            continue
        tail_indent = len(line) - len(line.lstrip(" "))
        return tail_indent > next_block.indent
    return False


def _slide_end_before_shallower_list_item(
    previous_block: SourceBlock | None,
    next_block: SourceBlock | None,
) -> bool:
    return bool(
        previous_block
        and next_block
        and previous_block.kind == "list_item"
        and next_block.kind == "list_item"
        and next_block.start_line > previous_block.end_line
        and next_block.indent < previous_block.indent
        and next_block.indent > 0
    )


def _marker_splits_parent_lead_in_from_nested_children(
    blocks: list[SourceBlock],
    marker_index: int,
) -> bool:
    previous_block = _find_anchor_block(blocks, marker_index, "prev")
    next_block = _find_anchor_block(blocks, marker_index, "next")
    if not previous_block or not next_block:
        return False
    if previous_block.kind != "list_item" or next_block.kind != "list_item":
        return False
    if next_block.start_line > previous_block.end_line:
        return False
    return next_block.indent > previous_block.indent


def _marker_container_position(blocks: list[SourceBlock], marker_index: int, direction: str, block: SourceBlock) -> str:
    previous_block = _find_anchor_block(blocks, marker_index, "prev")
    next_block = _find_anchor_block(blocks, marker_index, "next")
    if block.kind == "paragraph":
        if direction == "prev" and next_block and next_block.kind == "list_item":
            return "after_block"
        if direction == "next" and previous_block and previous_block.kind == "list_item":
            return "before_block"
        return ""
    if block.kind in MARKERLESS_BLOCK_KINDS:
        if direction == "next" and previous_block and previous_block.kind in MARKERLESS_BLOCK_KINDS | {"list_item"}:
            return "before_block"
        if direction == "prev" and next_block and next_block.kind in MARKERLESS_BLOCK_KINDS:
            return "after_block"
        return ""
    if block.kind != "list_item":
        return ""
    if direction == "next" and not _same_list_run(previous_block, block):
        if previous_block and previous_block.kind == "list_item" and block.kind == "list_item" and previous_block.indent != block.indent:
            if _marker_continues_nested_list_after_block(previous_block, block):
                return "between_items"
            if _marker_splits_parent_lead_in_from_nested_children(blocks, marker_index):
                return "before_nested_list"
            if block.indent < previous_block.indent:
                if block.indent > 0:
                    # Popping out to a shallower nested item: the fragment
                    # cut lands on the item boundary, not inside an item.
                    return "between_items_shallower"
                return "between_items"
            return "between_outer_items"
        if block.kind == "list_item" and previous_block and previous_block.kind in MARKERLESS_BLOCK_KINDS:
            return "before_block"
        return "before_list"
    if direction == "prev" and not _same_list_run(block, next_block):
        if (
            block.kind == "list_item"
            and next_block
            and next_block.kind in MARKERLESS_BLOCK_KINDS
        ):
            return "after_block"
        if block.kind == "list_item" and next_block is None:
            return "after_block"
        if block.kind == "list_item" and next_block and next_block.kind == "list_item" and block.indent != next_block.indent:
            if _marker_splits_parent_lead_in_from_nested_children(blocks, marker_index):
                return "before_nested_list"
            if next_block.indent < block.indent:
                if next_block.indent == 0:
                    # Popping to a top-level item keeps the end tucked at
                    # the end of the deeper item it closes.
                    return "after_block_inside"
                return "between_items"
            return "between_outer_items"
        return "after_list"
    if direction == "prev" and next_block and _same_list_run(block, next_block):
        return "between_items"
    if direction == "next" and previous_block and _same_list_run(previous_block, block):
        if (
            previous_block.kind == "list_item"
            and block.kind == "list_item"
            and 0 < block.indent < previous_block.indent
        ):
            # Popping out to a shallower nested item within the same list
            # run: the fragment cut lands on the item boundary.
            return "between_items_shallower"
        return "between_items"
    if _between_list_items(previous_block, next_block) and _same_list_run(previous_block, next_block):
        return "between_items"
    return ""


def _element_text(element: etree.Element) -> str:
    texts: list[str] = []
    for text in element.itertext():
        if text:
            texts.append(text)
    return _normalize_text(" ".join(texts))


def _inline_text_content(element: etree.Element) -> str:
    parts: list[str] = []
    if element.text:
        parts.append(element.text)
    for child in list(element):
        if not isinstance(child.tag, str):
            continue
        child_tag = child.tag.split("}")[-1]
        if child_tag in BLOCK_TAGS or child_tag in HEADING_TAGS or child_tag in {"ol", "ul", "div", "details", "table"}:
            continue
        if child_tag == "svg":
            # Icon shortcodes render as inline svg whose <title> text is not
            # present in the markdown source; keep signatures comparable.
            if child.tail:
                parts.append(child.tail)
            continue
        parts.append(_inline_text_content(child))
        if child.tail:
            parts.append(child.tail)
    return "".join(parts)


def _direct_li_text(element: etree.Element, md=None) -> str:
    parts: list[str] = []
    if element.text:
        parts.append(element.text)
    for child in list(element):
        child_tag = child.tag.split("}")[-1] if isinstance(child.tag, str) else ""
        if child_tag == "p":
            parts.append(_inline_text_content(child))
            break
        if child_tag in BLOCK_TAGS or child_tag in HEADING_TAGS or child_tag in {"ol", "ul", "div", "details"}:
            break
        parts.append(_inline_text_content(child))
        if child.tail:
            parts.append(child.tail)
    text = _unstash_text("".join(parts), md)
    return _normalize_text(text)


def _paragraph_signature_from_element(element: etree.Element) -> str:
    text = _element_text(element)
    if text:
        return text
    for image in element.iter():
        tag = image.tag.split("}")[-1] if isinstance(image.tag, str) else ""
        if tag == "img":
            return _normalize_text(image.get("alt", ""))
    return ""


def _heading_signature_from_element(element: etree.Element) -> str:
    parts: list[str] = []
    if element.text:
        parts.append(element.text)
    for child in list(element):
        child_tag = child.tag.split("}")[-1] if isinstance(child.tag, str) else ""
        child_classes = set((child.get("class") or "").split()) if isinstance(child.tag, str) else set()
        if child_tag == "a" and "headerlink" in child_classes:
            continue
        parts.extend(text for text in child.itertext() if text)
        if child.tail:
            parts.append(child.tail)
    return _normalize_text(" ".join(parts))


def _code_signature_from_element(element: etree.Element) -> str:
    text = "".join(element.itertext())
    for line in text.splitlines():
        normalized = _normalize_text(line)
        if normalized:
            return normalized
    return _normalize_text(text)


def _table_signature_from_element(element: etree.Element) -> str:
    headings: list[str] = []
    for cell in element.findall(".//th"):
        headings.append(_element_text(cell))
    heading_text = _first_nonempty(headings)
    if heading_text:
        return heading_text
    cells: list[str] = []
    for cell in element.findall(".//td"):
        cells.append(_element_text(cell))
    return _first_nonempty(cells)


def _rendered_block_signature(kind: str, element: etree.Element, md=None) -> str:
    if kind == "heading":
        return _heading_signature_from_element(element)
    if kind == "list_item":
        text = _direct_li_text(element, md)
        if not text:
            for image in element.iter():
                image_tag = image.tag.split("}")[-1] if isinstance(image.tag, str) else ""
                if image_tag == "img":
                    alt = _normalize_text(image.get("alt", ""))
                    if alt:
                        return alt
        return text or _normalize_text(_unstash_text(_element_text(element), md))
    if kind == "paragraph":
        return _unstash_text(_paragraph_signature_from_element(element), md)
    if kind in {"admonition", "details"}:
        title = element.find("./p") if kind == "admonition" else element.find("./summary")
        title_text = _element_text(title) if title is not None else ""
        return title_text or _element_text(element)
    if kind == "code":
        return _code_signature_from_element(element)
    if kind == "table":
        return _table_signature_from_element(element)
    if kind == "blockquote":
        return _element_text(element)
    return _element_text(element)


def _rendered_kind(element: etree.Element) -> str | None:
    if not isinstance(element.tag, str):
        return None
    tag = element.tag.split("}")[-1]
    if tag in HEADING_TAGS:
        return "heading"
    if tag == "li":
        return "list_item"
    if tag == "p":
        if HTML_STASH_RE.match(element.text or ""):
            return "code"
        return "paragraph"
    if tag == "table":
        return "table"
    if tag == "blockquote":
        return "blockquote"
    if tag == "details":
        return "details"
    if tag == "pre":
        return "code"
    if tag == "div":
        classes = set((element.get("class") or "").split())
        if "admonition" in classes:
            return "admonition"
        if "highlight" in classes or "mermaid" in classes:
            return "code"
    return None


def _previous_sibling_is_slide_end(
    element: etree.Element, parents: dict[etree.Element, etree.Element]
) -> bool:
    parent = parents.get(element)
    if parent is None:
        return False
    children = list(parent)
    try:
        index = children.index(element)
    except ValueError:
        return False
    if index == 0:
        return False
    sibling = children[index - 1]
    return (
        _element_tag(sibling) == "span"
        and (sibling.get("data-knotis-slide-marker") or "").startswith("slide-end")
    )


def _list_item_leads_with_image(element: etree.Element) -> bool:
    if _element_tag(element) != "li" or (element.text or "").strip():
        return False
    for child in list(element):
        child_tag = child.tag.split("}")[-1] if isinstance(child.tag, str) else ""
        if child_tag == "span" and child.get("data-knotis-slide-marker"):
            continue
        if child_tag == "img":
            return True
        if child_tag == "p":
            if (child.text or "").strip():
                return False
            first = next(iter(child), None)
            return first is not None and _element_tag(first) == "img"
        return False
    return False


def _image_alt_in_element(element: etree.Element, signature: str) -> bool:
    if not signature:
        return False
    tag = element.tag.split("}")[-1] if isinstance(element.tag, str) else ""
    if tag != "li":
        return False
    empty_alt_image = bool(re.fullmatch(r"!\[\]\([^)]*\)", signature))
    for child in list(element):
        child_tag = child.tag.split("}")[-1] if isinstance(child.tag, str) else ""
        if child_tag in {"ul", "ol"}:
            continue
        if child_tag == "img" and (
            _normalize_text(child.get("alt", "")) == signature
            or (empty_alt_image and not _normalize_text(child.get("alt", "")))
        ):
            return True
        if child_tag == "p":
            for image in child.iter():
                image_tag = image.tag.split("}")[-1] if isinstance(image.tag, str) else ""
                if image_tag == "img" and (
                    _normalize_text(image.get("alt", "")) == signature
                    or (empty_alt_image and not _normalize_text(image.get("alt", "")))
                ):
                    return True
    return False


def _signature_terms(signature: str) -> set[str]:
    return {term for term in re.findall(r"[a-z0-9]+", signature.casefold()) if len(term) > 2}


def _signature_content_tags(signature: str) -> set[str]:
    return {token.casefold() for token in re.findall(r"#[a-z0-9_-]+", signature, flags=re.I)}


def _signatures_related(first: str, second: str) -> bool:
    if not first or not second:
        return False
    if first == second or first in second or second in first:
        return True
    first_tags = _signature_content_tags(first)
    second_tags = _signature_content_tags(second)
    if first_tags or second_tags:
        return first_tags == second_tags
    first_terms = _signature_terms(first)
    second_terms = _signature_terms(second)
    if not first_terms or not second_terms:
        return False
    return len(first_terms & second_terms) / min(len(first_terms), len(second_terms)) >= 0.6


def _marker_signature_matches(marker_sig: str, block_sig: str) -> bool:
    if not marker_sig or not block_sig:
        return False
    if marker_sig == block_sig or marker_sig in block_sig or block_sig in marker_sig:
        return True
    return _signatures_related(marker_sig, block_sig)


def _resolve_markerless_wrapper_block(
    marker: MarkerRecord,
    blocks: list[RenderedBlock],
    min_render_order: int,
) -> RenderedBlock | None:
    wrappers = _markerless_wrapper_list_items(blocks, marker.block_kind, 0)
    if not wrappers:
        return None
    if marker.anchor_direction == "next":
        eligible = [wrapper for wrapper in wrappers if wrapper.render_order >= min_render_order]
        if not eligible:
            return None
        signature_matches = [wrapper for wrapper in eligible if _marker_signature_matches(marker.signature, wrapper.signature)]
        return signature_matches[0] if signature_matches else eligible[0]
    signature_matches = [
        wrapper
        for wrapper in wrappers
        if wrapper.render_order >= min_render_order and _marker_signature_matches(marker.signature, wrapper.signature)
    ]
    if signature_matches:
        return signature_matches[0]
    signature_matches = [wrapper for wrapper in wrappers if _marker_signature_matches(marker.signature, wrapper.signature)]
    if signature_matches:
        return signature_matches[-1]
    eligible = [wrapper for wrapper in wrappers if wrapper.render_order >= min_render_order]
    return eligible[0] if eligible else None


def _image_list_item_matches(marker: MarkerRecord, blocks: list[RenderedBlock]) -> list[RenderedBlock]:
    if marker.block_kind != "list_item" or not marker.signature:
        return []
    return [
        candidate
        for candidate in blocks
        if candidate.kind == "list_item"
        and _image_alt_in_element(candidate.element, marker.signature)
    ]


def _resolve_marker_block(
    marker: MarkerRecord,
    blocks: list[RenderedBlock],
    block_map: dict[tuple[str, str, int], RenderedBlock],
    kind_index_map: dict[tuple[str, int], RenderedBlock],
    top_list_index_map: dict[int, RenderedBlock],
    min_render_order: int,
) -> RenderedBlock | None:
    def eligible(candidate: RenderedBlock | None) -> RenderedBlock | None:
        if candidate is None or candidate.render_order < min_render_order:
            return None
        return candidate

    block = block_map.get((marker.block_kind, _signature_match_key(marker.signature), marker.occurrence))
    block = eligible(block)
    image_matches = _image_list_item_matches(marker, blocks)
    if image_matches:
        block = min(
            image_matches,
            key=lambda candidate: (abs(candidate.kind_index - marker.kind_index), candidate.render_order),
        )
    elif marker.block_kind == "list_item" and marker.signature:
        image_match = None
        for candidate in blocks:
            if (
                candidate.render_order >= min_render_order
                and candidate.kind == "list_item"
                and _image_alt_in_element(candidate.element, marker.signature)
            ):
                image_match = candidate
                break
        if image_match is not None:
            block = image_match
    if block is None:
        marker_key = _signature_match_key(marker.signature)
        signature_matches = [
            candidate
            for candidate in blocks
            if candidate.kind == marker.block_kind
            and candidate.render_order >= min_render_order
            and _signature_match_key(candidate.signature) == marker_key
        ]
        if len(signature_matches) == 1:
            block = signature_matches[0]
        elif signature_matches:
            block = min(signature_matches, key=lambda candidate: abs(candidate.kind_index - marker.kind_index))
    if block is None and marker.block_kind == "paragraph":
        for candidate in blocks:
            if (
                candidate.render_order >= min_render_order
                and candidate.kind == "list_item"
                and _image_alt_in_element(candidate.element, marker.signature)
            ):
                block = candidate
                break
    if block is None and marker.block_kind == "list_item":
        for candidate in blocks:
            if (
                candidate.render_order >= min_render_order
                and candidate.kind == "list_item"
                and _image_alt_in_element(candidate.element, marker.signature)
            ):
                block = candidate
                break
    if block is None and marker.block_kind == "list_item":
        candidate = eligible(kind_index_map.get((marker.block_kind, marker.kind_index)))
        if candidate is not None and _signature_match_key(marker.signature) == _signature_match_key(candidate.signature):
            block = candidate
    if block is None and marker.block_kind == "list_item":
        candidate = eligible(top_list_index_map.get(marker.kind_index))
        if candidate is not None and _signature_match_key(marker.signature) == _signature_match_key(candidate.signature):
            block = candidate
    if block is None and marker.block_kind == "list_item":
        marker_key = _signature_match_key(marker.signature)
        related_candidates = [
            (abs(index - marker.kind_index), index, candidate)
            for index, candidate in top_list_index_map.items()
            if candidate.render_order >= min_render_order
            and _signature_match_key(candidate.signature) == marker_key
        ]
        if related_candidates:
            block = min(related_candidates, key=lambda item: (item[0], item[1]))[2]
    if block is None and marker.block_kind in MARKERLESS_BLOCK_KINDS:
        block = _resolve_markerless_wrapper_block(marker, blocks, min_render_order)
    if block is None and marker.block_kind not in {"paragraph", "list_item"}:
        candidate = eligible(kind_index_map.get((marker.block_kind, marker.kind_index)))
        if candidate is not None and candidate.signature == marker.signature:
            block = candidate
    if block is None and marker.block_kind in MARKERLESS_BLOCK_KINDS:
        indexed = [
            candidate
            for candidate in blocks
            if candidate.kind == marker.block_kind
            and candidate.kind_index == marker.kind_index
            and candidate.render_order >= min_render_order
        ]
        if len(indexed) == 1:
            block = indexed[0]
        elif indexed:
            related = [
                candidate
                for candidate in indexed
                if candidate.signature == marker.signature or _signatures_related(marker.signature, candidate.signature)
            ]
            if len(related) == 1:
                block = related[0]
            elif related:
                block = min(related, key=lambda candidate: (abs(candidate.occurrence - marker.occurrence), candidate.render_order))
    return block


def _effective_container_position(marker: MarkerRecord, block: RenderedBlock) -> str:
    if marker.block_kind == block.kind:
        return marker.container_position
    if marker.block_kind == "paragraph" and block.kind == "list_item":
        if marker.anchor_direction == "prev":
            return "after_block"
        if marker.anchor_direction == "next":
            return "before_block"
    if marker.block_kind in MARKERLESS_BLOCK_KINDS and block.kind == "list_item":
        if marker.anchor_direction == "prev":
            return "after_block"
        if marker.anchor_direction == "next":
            return "before_block"
    return marker.container_position


def _scan_rendered_blocks(root: etree.Element, md=None) -> list[RenderedBlock]:
    blocks: list[RenderedBlock] = []
    counts: Counter[tuple[str, str]] = Counter()
    kind_counts: Counter[str] = Counter()

    def _walk(element: etree.Element, parent_tag: str | None = None) -> None:
        tag = element.tag.split("}")[-1] if isinstance(element.tag, str) else ""
        kind = _rendered_kind(element)
        if parent_tag == "li" and tag == "p":
            has_img = any(
                (child.tag.split("}")[-1] if isinstance(child.tag, str) else "") == "img"
                for child in element.iter()
            )
            if not has_img:
                kind = None
        if kind:
            signature = _normalize_text(_rendered_block_signature(kind, element, md))
            counts[(kind, signature)] += 1
            kind_counts[kind] += 1
            blocks.append(RenderedBlock(kind, signature, counts[(kind, signature)], kind_counts[kind], len(blocks), element))
        if kind in {"admonition", "details", "blockquote"}:
            return
        for child in list(element):
            if isinstance(child.tag, str):
                _walk(child, tag)

    _walk(root)
    return blocks


def _insert_at_start(element: etree.Element, marker_text: str) -> None:
    if element.tag.split("}")[-1] == "p" and HTML_STASH_RE.match(element.text or ""):
        element.text = _marker_token(marker_text) + (element.text or "")
        return
    marker = _marker_element(marker_text)
    original_text = element.text or ""
    element.text = ""
    if original_text.strip():
        marker.tail = original_text
    else:
        element.text = original_text
    element.insert(0, marker)


def _insert_at_end(element: etree.Element, marker_text: str) -> None:
    if element.tag.split("}")[-1] == "p" and HTML_STASH_RE.match(element.text or ""):
        element.text = (element.text or "") + _marker_token(marker_text)
        return
    marker = _marker_element(marker_text)
    element.append(marker)


def _parent_map(root: etree.Element) -> dict[etree.Element, etree.Element]:
    return {child: parent for parent in root.iter() for child in list(parent)}


def _is_nested_list_item(element: etree.Element, parents: dict[etree.Element, etree.Element]) -> bool:
    current = parents.get(element)
    while current is not None:
        tag = current.tag.split("}")[-1] if isinstance(current.tag, str) else ""
        if tag == "li":
            return True
        current = parents.get(current)
    return False


def _nearest_parent_list(element: etree.Element, parents: dict[etree.Element, etree.Element]) -> etree.Element | None:
    current = parents.get(element)
    while current is not None:
        tag = current.tag.split("}")[-1] if isinstance(current.tag, str) else ""
        if tag in {"ol", "ul"}:
            return current
        current = parents.get(current)
    return None


def _direct_nested_list(parent_li: etree.Element) -> etree.Element | None:
    for child in list(parent_li):
        if not isinstance(child.tag, str):
            continue
        tag = child.tag.split("}")[-1]
        if tag in {"ul", "ol"}:
            return child
    return None


def _insert_before_nested_list(parent_li: etree.Element, marker_text: str) -> bool:
    nested = _direct_nested_list(parent_li)
    if nested is None:
        return False
    parent_li.insert(list(parent_li).index(nested), _marker_element(marker_text))
    return True


def _parent_li_for_nested_list_marker(
    marker: MarkerRecord,
    block: RenderedBlock,
    parents: dict[etree.Element, etree.Element],
) -> etree.Element | None:
    if block.kind != "list_item":
        return None
    if marker.anchor_direction == "prev":
        return block.element if _direct_nested_list(block.element) is not None else None
    nested_ul = _nearest_parent_list(block.element, parents)
    if nested_ul is None:
        return None
    parent_li = parents.get(nested_ul)
    if parent_li is None:
        return None
    parent_tag = parent_li.tag.split("}")[-1] if isinstance(parent_li.tag, str) else ""
    if parent_tag != "li":
        return None
    if _direct_nested_list(parent_li) is not nested_ul:
        return None
    if parent_li is block.element:
        return None
    return parent_li


def _outermost_parent_list(element: etree.Element, parents: dict[etree.Element, etree.Element]) -> etree.Element | None:
    current = parents.get(element)
    outermost: etree.Element | None = None
    while current is not None:
        tag = current.tag.split("}")[-1] if isinstance(current.tag, str) else ""
        if tag in {"ol", "ul"}:
            outermost = current
        current = parents.get(current)
    return outermost


def _markerless_child_kind(element: etree.Element) -> str | None:
    for child in list(element):
        child_tag = child.tag.split("}")[-1] if isinstance(child.tag, str) else ""
        if child_tag == "span" and child.get("data-knotis-slide-marker"):
            continue
        if child_tag in {"ul", "ol"}:
            return None
        kind = _rendered_kind(child)
        if kind in MARKERLESS_BLOCK_KINDS:
            return kind
        if child_tag or (child.text or "").strip():
            return None
    return None


def _markerless_wrapper_list_items(
    blocks: list[RenderedBlock],
    inner_kind: str,
    min_render_order: int,
) -> list[RenderedBlock]:
    wrappers: list[RenderedBlock] = []
    for candidate in blocks:
        if candidate.kind != "list_item" or candidate.render_order < min_render_order:
            continue
        if _direct_li_text(candidate.element):
            continue
        if _markerless_child_kind(candidate.element) != inner_kind:
            continue
        wrappers.append(candidate)
    return wrappers


def _empty_markerless_list_wrapper(
    element: etree.Element,
    parents: dict[etree.Element, etree.Element],
) -> etree.Element | None:
    current: etree.Element | None = element
    wrapper_li: etree.Element | None = None
    while current is not None:
        tag = current.tag.split("}")[-1] if isinstance(current.tag, str) else ""
        if tag == "li":
            wrapper_li = current
            break
        current = parents.get(current)
    if wrapper_li is None or _direct_li_text(wrapper_li):
        return None
    list_parent = parents.get(wrapper_li)
    list_tag = list_parent.tag.split("}")[-1] if list_parent is not None and isinstance(list_parent.tag, str) else ""
    if list_tag not in {"ol", "ul"}:
        return None
    for child in list(wrapper_li):
        child_tag = child.tag.split("}")[-1] if isinstance(child.tag, str) else ""
        if child_tag == "span" and child.get("data-knotis-slide-marker"):
            continue
        if element is wrapper_li:
            # Asked about the <li> itself: it wraps markerless content when
            # its first real child is a code/table/details/admonition block.
            if _rendered_kind(child) in MARKERLESS_RENDER_KINDS:
                return wrapper_li
            return None
        if child is element or element in child.iter():
            return wrapper_li
        if child_tag or (child.text or "").strip():
            return None
    return None


def _outermost_li_in_list(element: etree.Element, parents: dict[etree.Element, etree.Element]) -> etree.Element | None:
    current: etree.Element | None = element
    outermost_li: etree.Element | None = None
    while current is not None:
        tag = current.tag.split("}")[-1] if isinstance(current.tag, str) else ""
        if tag == "li":
            outer_check = parents.get(current)
            if outer_check is not None:
                outer_tag = outer_check.tag.split("}")[-1] if isinstance(outer_check.tag, str) else ""
                if outer_tag in {"ol", "ul"}:
                    outermost_li = current
        current = parents.get(current)
    return outermost_li


def _element_tag(element: etree.Element) -> str:
    if not isinstance(element.tag, str):
        return ""
    return element.tag.split("}")[-1]


def _is_list_element(element: etree.Element) -> bool:
    return _element_tag(element) in {"ul", "ol"}


def _first_list_item(list_element: etree.Element) -> etree.Element | None:
    for child in list(list_element):
        if _element_tag(child) == "li":
            return child
    return None


def _list_item_has_nested_list(element: etree.Element) -> bool:
    return any(_is_list_element(child) for child in list(element) if isinstance(child.tag, str))


def _list_item_contains_markerless_teaching_block(element: etree.Element) -> bool:
    for child in element.iter():
        if not isinstance(child.tag, str):
            continue
        tag = _element_tag(child)
        if tag in MARKERLESS_RENDER_KINDS:
            return True
    return False


def _coerce_list_item_element(
    element: etree.Element, parents: dict[etree.Element, etree.Element]
) -> etree.Element | None:
    current: etree.Element | None = element
    for _ in range(8):
        if current is None:
            return None
        if _element_tag(current) == "li":
            return current
        current = parents.get(current)
    return None


def _previous_list_item_sibling(
    li: etree.Element, parents: dict[etree.Element, etree.Element]
) -> etree.Element | None:
    parent = parents.get(li)
    if parent is None or not _is_list_element(parent):
        return None
    items = [child for child in list(parent) if _element_tag(child) == "li"]
    try:
        index = items.index(li)
    except ValueError:
        return None
    if index <= 0:
        return None
    return items[index - 1]


def _insert_slide_end_before_list_item(
    element: etree.Element,
    marker_text: str,
    parents: dict[etree.Element, etree.Element],
) -> bool:
    li = _coerce_list_item_element(element, parents)
    if li is None:
        return False
    previous_li = _previous_list_item_sibling(li, parents)
    if previous_li is not None:
        _insert_at_end(previous_li, marker_text)
        return True
    return _insert_marker_before_list_item(element, marker_text, parents)


def _hoist_before_image_led_nested_list(
    li: etree.Element,
    marker_text: str,
    parents: dict[etree.Element, etree.Element],
) -> bool:
    # First item of a list nested under an image-led item: the marker goes
    # ahead of the whole nested list so the image keeps its own slide and
    # the nested list moves intact to the next one.
    parent = parents.get(li)
    if parent is None or not _is_list_element(parent) or _first_list_item(parent) is not li:
        return False
    grand_li = parents.get(parent)
    if grand_li is None or _element_tag(grand_li) != "li":
        return False
    if not _list_item_leads_with_image(grand_li):
        return False
    grand_li.insert(list(grand_li).index(parent), _marker_element(marker_text))
    return True


def _insert_marker_before_list_item(
    element: etree.Element,
    marker_text: str,
    parents: dict[etree.Element, etree.Element],
) -> bool:
    li = _coerce_list_item_element(element, parents)
    if li is None:
        return False
    if _hoist_before_image_led_nested_list(li, marker_text, parents):
        return True
    if _insert_between_list_items(li, marker_text, parents, after=False):
        return True
    list_parent = _nearest_parent_list(li, parents)
    if list_parent is None:
        return False
    try:
        index = list(list_parent).index(li)
    except ValueError:
        return False
    list_parent.insert(index, _marker_element(marker_text))
    return True


def _insert_between_list_items(
    li: etree.Element,
    marker_text: str,
    parents: dict[etree.Element, etree.Element],
    *,
    after: bool,
) -> bool:
    parent = parents.get(li)
    if parent is None or not _is_list_element(parent) or _element_tag(li) != "li":
        return False
    marker = _marker_element(marker_text)
    index = list(parent).index(li)
    parent.insert(index + (1 if after else 0), marker)
    return True


def _insert_before(element: etree.Element, marker_text: str, parents: dict[etree.Element, etree.Element]) -> bool:
    parent = parents.get(element)
    if parent is None:
        return False
    if _is_list_element(parent) and _element_tag(element) == "li":
        if _first_list_item(parent) is element:
            grandparent = parents.get(parent)
            if grandparent is not None and _element_tag(grandparent) == "li":
                # Nested list: keep the marker inside the list, ahead of its
                # first item, so the item stays inside its list shell.
                return _insert_between_list_items(element, marker_text, parents, after=False)
            if grandparent is not None:
                # Top-level list: the marker stands before the whole list.
                grandparent.insert(list(grandparent).index(parent), _marker_element(marker_text))
                return True
            return _insert_between_list_items(element, marker_text, parents, after=False)
        _insert_at_start(element, marker_text)
        return True
    marker = _marker_element(marker_text)
    parent.insert(list(parent).index(element), marker)
    return True


def _insert_before_sibling(element: etree.Element, marker_text: str, parents: dict[etree.Element, etree.Element]) -> bool:
    # Unlike _insert_before, a marker before a list item stays a sibling of
    # the <li> so a slide fragment can cut the list at the item boundary.
    parent = parents.get(element)
    if parent is None:
        return False
    if _is_list_element(parent) and _element_tag(element) == "li":
        return _insert_between_list_items(element, marker_text, parents, after=False)
    marker = _marker_element(marker_text)
    parent.insert(list(parent).index(element), marker)
    return True


def _insert_after(element: etree.Element, marker_text: str, parents: dict[etree.Element, etree.Element]) -> bool:
    parent = parents.get(element)
    if parent is None:
        return False
    if _is_list_element(parent) and _element_tag(element) == "li":
        # Markers stay siblings of the list items so a slide fragment can
        # cut the list at item boundaries instead of inside an <li>.
        return _insert_between_list_items(element, marker_text, parents, after=True)
    marker = _marker_element(marker_text)
    parent.insert(list(parent).index(element) + 1, marker)
    return True


def _table_parent_li_with_post_table_nested_list(
    table: etree.Element, parents: dict[etree.Element, etree.Element]
) -> etree.Element | None:
    parent = parents.get(table)
    if parent is None:
        return None
    parent_tag = parent.tag.split("}")[-1] if isinstance(parent.tag, str) else ""
    if parent_tag != "li":
        return None
    children = list(parent)
    try:
        table_index = children.index(table)
    except ValueError:
        return None
    for child in children[table_index + 1 :]:
        child_tag = child.tag.split("}")[-1] if isinstance(child.tag, str) else ""
        if child_tag in {"ul", "ol"}:
            return parent
    return None


def _insert_after_table(
    table: etree.Element, marker_text: str, parents: dict[etree.Element, etree.Element]
) -> bool:
    parent_li = _table_parent_li_with_post_table_nested_list(table, parents)
    if parent_li is not None:
        _insert_at_end(parent_li, marker_text)
        return True
    return _insert_after(table, marker_text, parents)


def _slide_break_marker_text(marker_text: str) -> str:
    return marker_text.strip()


def _append_marker_record(
    markers: list[MarkerRecord],
    blocks: list[SourceBlock],
    lines: list[str],
    marker_index: int,
    marker_text: str,
    marker_kind: str,
    source_order: int,
    md=None,
) -> int:
    direction = "next" if marker_kind in {"slide-break", "click"} else "prev"
    container_position = ""
    if marker_kind == "slide-end":
        prev_block = _find_anchor_block(blocks, marker_index, "prev")
        next_block = _find_anchor_block(blocks, marker_index, "next")
        # A pop-out to a shallower nested item wins over the embedded-table
        # anchor: the cut belongs on the item boundary, not after the table.
        pops_to_shallower = bool(
            prev_block and next_block and _slide_end_pops_to_shallower_item(lines, prev_block, next_block)
        )
        embedded_table = None if pops_to_shallower else _slide_end_embedded_table_span(lines, prev_block, next_block)
        if embedded_table is not None:
            table_start, table_end = embedded_table
            signature, occurrence, kind_index = _table_marker_fields(lines, table_start, table_end)
            markers.append(
                MarkerRecord(
                    marker_text=marker_text,
                    marker_kind=marker_kind,
                    anchor_direction="prev",
                    source_order=source_order,
                    source_line=marker_index,
                    block_kind="table",
                    signature=signature,
                    occurrence=occurrence,
                    kind_index=kind_index,
                    container_position="",
                )
            )
            return source_order + 1
        if pops_to_shallower:
            block = next_block
            direction = "next"
            container_position = "between_items_shallower"
        elif prev_block and next_block and _slide_end_before_shallower_list_item(prev_block, next_block):
            block = next_block
            direction = "next"
            container_position = "between_items"
        elif prev_block and next_block and _slide_end_continues_nested_list_after_block(
            lines, prev_block, next_block
        ):
            block = next_block
            direction = "next"
            container_position = "between_items"
        else:
            block = prev_block
    else:
        block = _find_anchor_block(blocks, marker_index, direction)
    if block is None:
        _warn(
            md,
            f"Dropped `{marker_text}`: no anchor block found",
            line=marker_index,
        )
        return source_order
    if not container_position:
        container_position = _marker_container_position(blocks, marker_index, direction, block)
    markers.append(
        MarkerRecord(
            marker_text=marker_text,
            marker_kind=marker_kind,
            anchor_direction=direction,
            source_order=source_order,
            source_line=marker_index,
            block_kind=block.kind,
            signature=block.signature,
            occurrence=block.occurrence,
            kind_index=block.kind_index,
            container_position=container_position,
        )
    )
    return source_order + 1


class KnotisSlideMarkerPreprocessor(Preprocessor):
    def run(self, lines: list[str]) -> list[str]:
        lines = _normalize_raw_iframe_blocks(lines)
        lines = _dedent_list_runs_after_markers(lines)
        lines = _normalize_indented_teaching_blocks_in_list_items(lines)
        lines = _strip_markerless_block_list_prefixes(lines)
        blocks = _scan_source_blocks(lines)
        markers: list[MarkerRecord] = []
        source_order = 0
        output: list[str] = []
        render_to_editor: list[int] = []
        slide_open = False

        def _append_output(text: str, editor_line: int) -> None:
            render_to_editor.append(editor_line)
            output.append(text)

        for index, line in enumerate(lines):
            marker_texts = _marker_texts(line)
            if not marker_texts:
                _append_output(line, index)
                continue

            previous_block = _find_anchor_block(blocks, index, "prev")
            next_block = _find_anchor_block(blocks, index, "next")
            if _marker_needs_separator_blank(previous_block, next_block) or _same_list_marker_needs_nested_separator(lines, previous_block, next_block):
                _append_output("", index)

            marker_offset = 0
            while marker_offset < len(marker_texts):
                marker_text = marker_texts[marker_offset]
                marker_kind = marker_text.split(None, 1)[0].lower()
                next_marker_kind = (
                    marker_texts[marker_offset + 1].split(None, 1)[0].lower()
                    if marker_offset + 1 < len(marker_texts)
                    else ""
                )

                if marker_kind == "slide-break":
                    if next_marker_kind == "slide-end":
                        if slide_open:
                            source_order = _append_marker_record(
                                markers, blocks, lines, index, "slide-end", "slide-end", source_order, self.md
                            )
                        slide_open = False
                        marker_offset += 2
                        continue

                    if slide_open:
                        source_order = _append_marker_record(
                            markers, blocks, lines, index, "slide-end", "slide-end", source_order, self.md
                        )
                    source_order = _append_marker_record(
                        markers,
                        blocks,
                        lines,
                        index,
                        _slide_break_marker_text(marker_text),
                        "slide-break",
                        source_order,
                        self.md,
                    )
                    slide_open = True
                    marker_offset += 1
                    continue

                if marker_kind == "slide-end":
                    slide_open = False
                source_order = _append_marker_record(
                    markers, blocks, lines, index, marker_text, marker_kind, source_order, self.md
                )
                marker_offset += 1

        self.md.knotis_slide_markers = markers
        self.md.knotis_render_to_editor_line = render_to_editor
        return output


class KnotisSlideMarkerTreeprocessor(Treeprocessor):
    def run(self, root: etree.Element) -> etree.Element:
        markers: list[MarkerRecord] = getattr(self.md, "knotis_slide_markers", [])
        if not markers:
            return root

        blocks = _scan_rendered_blocks(root, self.md)
        block_map = {
            (block.kind, _signature_match_key(block.signature), block.occurrence): block
            for block in blocks
        }
        kind_index_map = {
            (block.kind, block.kind_index): block
            for block in blocks
        }
        parents = _parent_map(root)
        top_list_index_map: dict[int, RenderedBlock] = {}
        top_list_index = 0
        for block in blocks:
            if block.kind != "list_item" or _is_nested_list_item(block.element, parents):
                continue
            top_list_index += 1
            top_list_index_map[top_list_index] = block

        min_render_order = 0
        previous_marker: MarkerRecord | None = None

        def _mark_applied(marker_record: MarkerRecord, render_order: int) -> None:
            nonlocal min_render_order, previous_marker
            min_render_order = render_order
            previous_marker = marker_record

        for marker in markers:
            block = _resolve_marker_block(marker, blocks, block_map, kind_index_map, top_list_index_map, min_render_order)
            if block is None:
                _warn(
                    self.md,
                    "Dropped `%s` for %s #%s (`%s`): no rendered block match"
                    % (marker.marker_text, marker.block_kind, marker.occurrence, marker.signature),
                    line=marker.source_line,
                )
                continue
            container_position = _effective_container_position(marker, block)
            if block.kind in MARKERLESS_RENDER_KINDS:
                wrapper_li = _empty_markerless_list_wrapper(block.element, parents)
                if wrapper_li is not None and marker.anchor_direction == "next":
                    inserted = _insert_before_sibling(wrapper_li, marker.marker_text, parents)
                elif block.kind == "table" and marker.anchor_direction == "prev":
                    inserted = _insert_after_table(block.element, marker.marker_text, parents)
                else:
                    inserted = (
                        _insert_before_sibling(block.element, marker.marker_text, parents)
                        if marker.anchor_direction == "next"
                        else _insert_after(block.element, marker.marker_text, parents)
                    )
                if inserted:
                    _mark_applied(marker, block.render_order)
                    continue
            if block.kind in {"heading", "table"}:
                if block.kind == "table" and marker.anchor_direction == "prev":
                    inserted = _insert_after_table(block.element, marker.marker_text, parents)
                else:
                    inserted = (
                        _insert_before(block.element, marker.marker_text, parents)
                        if marker.anchor_direction == "next"
                        else _insert_after(block.element, marker.marker_text, parents)
                    )
                if inserted:
                    _mark_applied(marker, block.render_order)
                    continue
            if container_position == "after_block_inside":
                _insert_at_end(block.element, marker.marker_text)
                _mark_applied(marker, block.render_order)
                continue
            if container_position == "after_block":
                if _insert_after(block.element, marker.marker_text, parents):
                    _mark_applied(marker, block.render_order)
                    continue
            if container_position == "before_block":
                if (
                    marker.marker_kind == "slide-end"
                    and block.kind == "list_item"
                    and _insert_slide_end_before_list_item(block.element, marker.marker_text, parents)
                ):
                    _mark_applied(marker, block.render_order)
                    continue
                if (
                    marker.block_kind in MARKERLESS_BLOCK_KINDS
                    and block.kind == "list_item"
                    and _empty_markerless_list_wrapper(block.element, parents) is not None
                    and _insert_before_sibling(block.element, marker.marker_text, parents)
                ):
                    # The marker anchors to a code/table block that fully
                    # wraps this <li>; cut at the item boundary so the
                    # fragment keeps the wrapper list structure.
                    _mark_applied(marker, block.render_order)
                    continue
                if _insert_before(block.element, marker.marker_text, parents):
                    _mark_applied(marker, block.render_order)
                    continue
            if container_position == "before_nested_list":
                parent_li = _parent_li_for_nested_list_marker(marker, block, parents)
                if parent_li is not None and _insert_before_nested_list(parent_li, marker.marker_text):
                    _mark_applied(marker, block.render_order)
                    continue
            if container_position in {"before_list", "after_list"}:
                list_element = _outermost_parent_list(block.element, parents)
                if list_element is not None:
                    inserted = (
                        _insert_before(list_element, marker.marker_text, parents)
                        if container_position == "before_list"
                        else _insert_after(list_element, marker.marker_text, parents)
                    )
                    if inserted:
                        _mark_applied(marker, block.render_order)
                        continue
            if container_position == "between_outer_items":
                effective_li = _outermost_li_in_list(block.element, parents)
                if effective_li is not None:
                    inserted = _insert_between_list_items(
                        effective_li,
                        marker.marker_text,
                        parents,
                        after=marker.anchor_direction == "prev",
                    )
                    if inserted:
                        _mark_applied(marker, block.render_order)
                        continue
            if container_position == "between_items_shallower":
                # The marker pops out of a deeper nested run to a shallower
                # (but still nested) item: cut at the item boundary instead
                # of tucking the marker inside an item.
                inserted = _insert_marker_before_list_item(
                    block.element,
                    marker.marker_text,
                    parents,
                )
                if inserted:
                    _mark_applied(marker, block.render_order)
                    continue
            if container_position == "between_items":
                if marker.marker_kind == "slide-end" and marker.anchor_direction == "next":
                    inserted = _insert_slide_end_before_list_item(
                        block.element,
                        marker.marker_text,
                        parents,
                    )
                elif marker.anchor_direction == "prev":
                    if (
                        _list_item_has_nested_list(block.element)
                        and _list_item_contains_markerless_teaching_block(block.element)
                        and _element_tag(parents.get(block.element)) != "ol"
                    ):
                        # Ordered (numbered) items always cut at the item
                        # boundary so numbering carries across slides.
                        _insert_at_end(block.element, marker.marker_text)
                        inserted = True
                    else:
                        inserted = _insert_between_list_items(
                            block.element,
                            marker.marker_text,
                            parents,
                            after=True,
                        )
                else:
                    list_parent = parents.get(block.element)
                    paired_slide_break = bool(
                        previous_marker
                        and previous_marker.marker_kind == "slide-end"
                        and previous_marker.source_line == marker.source_line
                    )
                    if list_parent is not None and _element_tag(list_parent) == "ol":
                        inserted = _insert_between_list_items(
                            block.element,
                            marker.marker_text,
                            parents,
                            after=False,
                        )
                    elif paired_slide_break:
                        target_li = _coerce_list_item_element(block.element, parents) or block.element
                        if _hoist_before_image_led_nested_list(target_li, marker.marker_text, parents):
                            _mark_applied(marker, block.render_order)
                            continue
                        tight_item = bool((target_li.text or "").strip())
                        if (
                            tight_item or _previous_sibling_is_slide_end(target_li, parents)
                        ) and not _list_item_leads_with_image(target_li):
                            # The paired slide-end already sits on the item
                            # boundary (or the item is tight): keep the pair
                            # adjacent, cutting between the list items.
                            # Image-led items keep the start inside so the
                            # image stays wrapped on its own slide.
                            inserted = _insert_between_list_items(
                                target_li,
                                marker.marker_text,
                                parents,
                                after=False,
                            )
                        else:
                            _insert_at_start(target_li, marker.marker_text)
                            inserted = True
                    else:
                        inserted = _insert_between_list_items(
                            block.element,
                            marker.marker_text,
                            parents,
                            after=False,
                        )
                if inserted:
                    _mark_applied(marker, block.render_order)
                    continue
            if marker.anchor_direction == "next":
                if (
                    marker.marker_kind == "slide-end"
                    and _insert_slide_end_before_list_item(block.element, marker.marker_text, parents)
                ):
                    pass
                else:
                    target = _coerce_list_item_element(block.element, parents) or block.element
                    _insert_at_start(target, marker.marker_text)
            elif block.kind == "paragraph" and _insert_after(block.element, marker.marker_text, parents):
                pass
            else:
                _insert_at_end(block.element, marker.marker_text)
            _mark_applied(marker, block.render_order)
        return root


class KnotisSlideMarkerPostprocessor(Postprocessor):
    def run(self, text: str) -> str:
        text = MARKER_TOKEN_RE.sub(
            lambda match: f'<span hidden="hidden" data-knotis-slide-marker="{match.group(1)}"></span>',
            text,
        )
        return WRAPPED_BLOCK_RE.sub(lambda match: f"{match.group(1)}{match.group(2)}{match.group(3)}", text)


class KnotisSlideMarkersExtension(Extension):
    def extendMarkdown(self, md):
        md.preprocessors.register(KnotisSlideMarkerPreprocessor(md), "knotis_slide_markers", 37)
        md.treeprocessors.register(KnotisSlideMarkerTreeprocessor(md), "knotis_slide_marker_tree", 0)
        md.postprocessors.register(KnotisSlideMarkerPostprocessor(md), "knotis_slide_marker_post", 0)


def makeExtension(**kwargs):
    return KnotisSlideMarkersExtension(**kwargs)
