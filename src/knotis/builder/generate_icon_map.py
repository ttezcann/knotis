#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import sys
from glob import iglob
from pathlib import Path

# Any :name: can be an icon once custom icon directories are configured; only
# names that resolve to an SVG below become map entries.
ICON_SHORTCODE_RE = re.compile(r":([a-z0-9][a-z0-9_-]*):(?![a-z0-9_-])", re.IGNORECASE)
FENCED_CODE_RE = re.compile(r"```.*?```", re.DOTALL)
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
SVG_ROOT_PRESENTATION_ATTRS = (
    "fill",
    "fill-rule",
    "clip-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
)


def strip_fenced_code_blocks(text: str) -> str:
    return FENCED_CODE_RE.sub("", text)


def scan_icon_tokens_from_text(text: str) -> set[str]:
    cleaned = INLINE_CODE_RE.sub("", strip_fenced_code_blocks(text))
    return {match.group(1) for match in ICON_SHORTCODE_RE.finditer(cleaned)}


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


def custom_icon_dirs_from_config(config: dict, site_root: Path) -> list[Path]:
    """Return `pymdownx.emoji` `options.custom_icons` directories, resolved like Zensical."""
    project = config.get("project", {}) if isinstance(config, dict) else {}
    extensions = project.get("markdown_extensions", {}) if isinstance(project, dict) else {}
    if not isinstance(extensions, dict):
        return []
    emoji_cfg = extensions.get("pymdownx.emoji")
    if emoji_cfg is None and isinstance(extensions.get("pymdownx"), dict):
        emoji_cfg = extensions["pymdownx"].get("emoji")
    options = emoji_cfg.get("options", {}) if isinstance(emoji_cfg, dict) else {}
    raw_dirs = options.get("custom_icons", []) if isinstance(options, dict) else []
    if not isinstance(raw_dirs, list) or not all(isinstance(entry, str) for entry in raw_dirs):
        print(
            f"[build_wikilinks] WARNING: pymdownx.emoji options.custom_icons must be a list of paths; got {raw_dirs!r}",
            file=sys.stderr,
        )
        return []
    # Zensical runs from the site root, so relative entries are site-root relative.
    return [Path(os.path.normpath(site_root / entry)) for entry in raw_dirs if entry.strip()]


def _twemoji_names() -> set[str]:
    try:
        from pymdownx import twemoji_db
    except ImportError:
        return set()
    return set(twemoji_db.emoji) | set(twemoji_db.aliases)


def build_icon_index(icons_root: Path | None, custom_dirs: list[Path] | tuple[Path, ...] = ()) -> dict[str, Path]:
    """Map icon names to SVG files with Zensical's naming and precedence.

    Mirrors zensical.extensions.emoji._load_twemoji_index: custom directories
    are scanned before the theme icons, a name is the SVG path relative to its
    directory with separators turned into "-", the first file for a name wins,
    and Twemoji names are never replaced. That function is not called directly
    because it is cached per process and adds icons to pymdownx's shared
    Twemoji table.
    """
    reserved = _twemoji_names()
    index: dict[str, Path] = {}
    roots = [*custom_dirs, *([icons_root] if icons_root is not None else [])]
    for root in roots:
        base = os.path.normpath(str(root))
        pattern = os.path.normpath(os.path.join(base, "**", "*.svg"))
        for file in sorted(iglob(pattern, recursive=True)):
            name = file[len(base) + 1 : -4].replace(os.path.sep, "-")
            if f":{name}:" in reserved or name in index:
                continue
            index[name] = Path(file)
    return index


def resolve_icon_svg(
    token: str,
    icons_root: Path | None,
    custom_dirs: list[Path] | tuple[Path, ...] = (),
) -> Path | None:
    return build_icon_index(icons_root, custom_dirs).get(token)


def _icon_label(token: str, svg_text: str = "", nested: bool = True) -> str:
    authored = re.search(r"<svg[^>]*\saria-label=\"([^\"]+)\"", svg_text, re.IGNORECASE)
    if not authored:
        authored = re.search(r"<title[^>]*>([^<]+)</title>", svg_text, re.IGNORECASE)
    if authored and authored.group(1).strip():
        return authored.group(1).strip()
    slug = token.split("-", 1)[-1] if nested else token
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


def _custom_icon_svg(name: str, svg_text: str, inner: str) -> str:
    root_match = re.search(r"<svg([^>]*)>", svg_text, re.IGNORECASE)
    root_attrs = root_match.group(1) if root_match else ""
    kept = []
    for attr in SVG_ROOT_PRESENTATION_ATTRS:
        match = re.search(rf'(?<![\w-]){attr}="([^"]*)"', root_attrs)
        if match:
            kept.append(f'{attr}="{match.group(1)}"')
    if not any(entry.startswith("fill=") for entry in kept):
        kept.insert(0, 'fill="currentColor"')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{_icon_view_box(svg_text)}" '
        f'{" ".join(kept)} class="{name}" aria-hidden="true" focusable="false">{inner}</svg>'
    )


def icon_entry_from_svg(token: str, svg_path: Path, *, custom: bool = False, nested: bool = True) -> dict[str, str] | None:
    svg_text = svg_path.read_text(encoding="utf-8")
    inner = _svg_inner_from_text(svg_text)
    if not inner:
        print(f"[build_wikilinks] WARNING: empty SVG body for {token}: {svg_path}", file=sys.stderr)
        return None

    view_box = _icon_view_box(svg_text)
    name = token
    if custom:
        # Site-authored SVGs keep their own root fill/stroke instead of the theme wrappers.
        return {"label": _icon_label(token, svg_text, nested), "svg": _custom_icon_svg(name, svg_text, inner)}
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


def _icon_families(roots: list[Path]) -> set[str]:
    families: set[str] = set()
    for root in roots:
        try:
            families.update(child.name for child in root.iterdir() if child.is_dir())
        except OSError:
            continue
    return families


def build_icon_map(
    tokens: set[str],
    icons_root: Path | None,
    custom_dirs: list[Path] | tuple[Path, ...] = (),
) -> dict[str, dict[str, str]]:
    icon_map: dict[str, dict[str, str]] = {}
    if icons_root is None and tokens:
        print(
            "[build_wikilinks] WARNING: Zensical icon set unavailable; "
            "pane/search/slide icon shortcodes will use fallbacks until Zensical is installed.",
            file=sys.stderr,
        )
    present_dirs = []
    for custom_dir in custom_dirs:
        if custom_dir.is_dir():
            present_dirs.append(custom_dir)
        else:
            print(f"[build_wikilinks] WARNING: custom icon directory not found: {custom_dir}", file=sys.stderr)
    if icons_root is None and not present_dirs:
        return icon_map

    index = build_icon_index(icons_root, present_dirs)
    # Only names under an icon family folder are clearly meant as icons; other
    # :word: text (times, emoji, prose) is left alone without a warning.
    families = _icon_families([*present_dirs, *([icons_root] if icons_root is not None else [])])
    for token in sorted(tokens):
        svg_path = index.get(token)
        if svg_path is None:
            if token.split("-", 1)[0] in families:
                print(f"[build_wikilinks] WARNING: no Zensical SVG for icon shortcode :{token}:", file=sys.stderr)
            continue
        custom_root = next((root for root in present_dirs if svg_path.is_relative_to(root)), None)
        entry = icon_entry_from_svg(
            token,
            svg_path,
            custom=custom_root is not None,
            nested=custom_root is None or svg_path.parent != custom_root,
        )
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
    custom_icon_dirs: list[Path] | tuple[Path, ...] = (),
) -> dict[str, dict[str, str]]:
    tokens = scan_icon_tokens(md_files)
    icon_map = build_icon_map(tokens, zensical_icons_dir(), custom_icon_dirs)
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
