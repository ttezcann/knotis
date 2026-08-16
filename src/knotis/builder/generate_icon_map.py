#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ICON_SHORTCODE_RE = re.compile(
    r":((?:lucide|fontawesome|material|simple)-[a-z0-9-]+):(?![a-z0-9-])",
    re.IGNORECASE,
)
FENCED_CODE_RE = re.compile(r"```.*?```", re.DOTALL)
ICON_FAMILIES = ("lucide", "fontawesome", "material", "simple")
FONTAWESOME_STYLES = ("brands", "solid", "regular")


def strip_fenced_code_blocks(text: str) -> str:
    return FENCED_CODE_RE.sub("", text)


def scan_icon_tokens_from_text(text: str) -> set[str]:
    cleaned = strip_fenced_code_blocks(text)
    return {match.group(1).lower() for match in ICON_SHORTCODE_RE.finditer(cleaned)}


def scan_icon_tokens(md_files: list[Path]) -> set[str]:
    tokens: set[str] = set()
    for md_path in md_files:
        try:
            tokens.update(scan_icon_tokens_from_text(md_path.read_text(encoding="utf-8")))
        except OSError as exc:
            print(f"[build_wikilinks] WARNING: could not read {md_path} for icon scan: {exc}", file=sys.stderr)
    return tokens


def zensical_icons_dir() -> Path | None:
    try:
        import zensical
    except ImportError:
        return None
    icons_dir = Path(zensical.__file__).resolve().parent / "templates" / ".icons"
    return icons_dir if icons_dir.is_dir() else None


def resolve_icon_svg(token: str, icons_root: Path) -> Path | None:
    token = token.lower()
    for family in ICON_FAMILIES:
        prefix = f"{family}-"
        if not token.startswith(prefix):
            continue
        slug = token[len(prefix) :]
        if family == "fontawesome":
            for style in FONTAWESOME_STYLES:
                style_prefix = f"{style}-"
                if slug.startswith(style_prefix):
                    candidate = icons_root / "fontawesome" / style / f"{slug[len(style_prefix):]}.svg"
                    if candidate.is_file():
                        return candidate
            return None
        candidate = icons_root / family / f"{slug}.svg"
        return candidate if candidate.is_file() else None
    return None


def _icon_label(token: str) -> str:
    slug = token.split("-", 1)[-1]
    return slug.replace("-", " ").strip()


def _svg_inner_from_text(svg_text: str) -> str:
    svg_text = re.sub(r"<!--.*?-->", "", svg_text, flags=re.DOTALL)
    match = re.search(r"<svg[^>]*>(.*)</svg>", svg_text, re.DOTALL | re.IGNORECASE)
    if not match:
        return ""
    inner = match.group(1)
    inner = re.sub(r"<title[^>]*>.*?</title>", "", inner, flags=re.DOTALL | re.IGNORECASE)
    return inner.strip()


def _icon_is_stroke(svg_text: str) -> bool:
    root_match = re.search(r"<svg([^>]*)>", svg_text, re.IGNORECASE)
    root_attrs = root_match.group(1) if root_match else ""
    if 'fill="none"' in root_attrs or "fill='none'" in root_attrs:
        return True
    if 'stroke="currentColor"' in svg_text or "stroke='currentColor'" in svg_text:
        return True
    return 'fill="none"' in svg_text and "stroke=" in svg_text


def _icon_view_box(svg_text: str) -> str:
    match = re.search(r'viewBox="([^"]+)"', svg_text, re.IGNORECASE)
    return match.group(1) if match else "0 0 24 24"


def icon_entry_from_svg(token: str, svg_path: Path) -> dict[str, str] | None:
    svg_text = svg_path.read_text(encoding="utf-8")
    inner = _svg_inner_from_text(svg_text)
    if not inner:
        print(f"[build_wikilinks] WARNING: empty SVG body for {token}: {svg_path}", file=sys.stderr)
        return None

    view_box = _icon_view_box(svg_text)
    name = token
    if _icon_is_stroke(svg_text):
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" '
            f'stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide {name}" '
            f'viewBox="{view_box}" aria-hidden="true" focusable="false">{inner}</svg>'
        )
    else:
        svg = (
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view_box}" fill="currentColor" '
            f'class="{name}" aria-hidden="true" focusable="false">{inner}</svg>'
        )
    return {"label": _icon_label(token), "svg": svg}


def build_icon_map(tokens: set[str], icons_root: Path | None) -> dict[str, dict[str, str]]:
    icon_map: dict[str, dict[str, str]] = {}
    if icons_root is None:
        if tokens:
            print(
                "[build_wikilinks] WARNING: Zensical icon set unavailable; "
                "pane/search/slide icon shortcodes will use fallbacks until Zensical is installed.",
                file=sys.stderr,
            )
        return icon_map

    for token in sorted(tokens):
        svg_path = resolve_icon_svg(token, icons_root)
        if svg_path is None:
            print(f"[build_wikilinks] WARNING: no Zensical SVG for icon shortcode :{token}:", file=sys.stderr)
            continue
        entry = icon_entry_from_svg(token, svg_path)
        if entry is not None:
            icon_map[token] = entry
    return icon_map


def render_icon_map_js(icon_map: dict[str, dict[str, str]]) -> str:
    lines = [
        "// Generated by Knotis build_wikilinks — do not edit.",
        "// Used by knotis-wikilinks.js for pane, search, and slide icon shortcodes.",
        "window.KNOTIS_ICON_MAP = " + json.dumps(icon_map, indent=2, ensure_ascii=True) + ";",
        "",
    ]
    return "\n".join(lines)


def write_icon_map(
    md_files: list[Path],
    *asset_dirs: Path,
) -> dict[str, dict[str, str]]:
    tokens = scan_icon_tokens(md_files)
    icon_map = build_icon_map(tokens, zensical_icons_dir())
    js = render_icon_map_js(icon_map)
    for asset_dir in asset_dirs:
        if asset_dir is None:
            continue
        asset_dir.mkdir(parents=True, exist_ok=True)
        out = asset_dir / "knotis-icon-map.js"
        if out.exists() and out.read_text(encoding="utf-8") == js:
            continue
        out.write_text(js, encoding="utf-8")
        label = asset_dir.name
        if asset_dir.parent.name == "docs":
            label = "docs/assets"
        elif asset_dir.parent.name not in {"", "."}:
            label = f"{asset_dir.parent.name}/{asset_dir.name}"
        print(f"[build_wikilinks] Wrote {len(icon_map)} icon map entries → {label}/knotis-icon-map.js", file=sys.stderr)
    return icon_map
