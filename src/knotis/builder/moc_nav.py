#!/usr/bin/env python3
from __future__ import annotations
"""
moc_nav.py - Build-time navigation expansion for clickable MOC pages.
"""

import json
from copy import deepcopy
from pathlib import Path

from .frontmatter import _split_front_matter
from . import knotis_site_io


def _normalize_nav_path(path: object) -> str:
    return str(path or "").replace("\\", "/").strip().strip("/")


def _resolve_moc_child_path(raw_path: object, *, moc_path: str, docs_dir: Path) -> str | None:
    token = _normalize_nav_path(raw_path)
    if not token:
        return None
    if token == moc_path:
        return None
    docs_candidate = docs_dir / token
    if docs_candidate.is_file():
        return token
    relative_candidate = (docs_dir / moc_path).parent / token
    if relative_candidate.is_file():
        return relative_candidate.relative_to(docs_dir).as_posix()
    knotis_site_io.warn_config(
        f"MOC child page '{token}' from '{moc_path}' does not exist; skipping it"
    )
    return None


def load_moc_configs(repo_root: Path, docs_dir: Path | None = None) -> dict[str, dict]:
    docs = docs_dir or repo_root / "docs"
    if not docs.is_dir():
        return {}

    configs: dict[str, dict] = {}
    for md_path in sorted(docs.rglob("*.md")):
        try:
            raw = md_path.read_text(encoding="utf-8")
        except OSError:
            continue
        meta, _body = _split_front_matter(raw)
        if meta.get("moc") is not True:
            continue
        moc_path = md_path.relative_to(docs).as_posix()
        raw_pages = meta.get("moc_pages", [])
        if raw_pages is None:
            raw_pages = []
        if not isinstance(raw_pages, list):
            knotis_site_io.warn_config(
                f"MOC page '{moc_path}' has non-list moc_pages; treating it as empty"
            )
            raw_pages = []
        pages: list[str] = []
        seen = {moc_path}
        for raw_page in raw_pages:
            child_path = _resolve_moc_child_path(raw_page, moc_path=moc_path, docs_dir=docs)
            if child_path and child_path not in seen:
                pages.append(child_path)
                seen.add(child_path)
        configs[moc_path] = {
            "collapse": meta.get("moc_collapse") is True,
            "nav": meta.get("moc_nav") is not False,
            "pages": pages,
        }
    return configs


def nav_visible_moc_configs(moc_configs: dict[str, dict]) -> dict[str, dict]:
    return {
        path: config
        for path, config in moc_configs.items()
        if config.get("nav") is not False
    }


def apply_moc_nav_to_items(nav_items: list, moc_configs: dict[str, dict]) -> list:
    if not moc_configs:
        return nav_items

    def transform(items: list) -> list:
        transformed: list = []
        for item in items:
            if isinstance(item, str):
                path = _normalize_nav_path(item)
                config = moc_configs.get(path)
                if config is None:
                    transformed.append(item)
                else:
                    transformed.append([path, *config.get("pages", [])])
                continue
            if isinstance(item, dict):
                next_item = {}
                for label, value in item.items():
                    if isinstance(value, str):
                        path = _normalize_nav_path(value)
                        config = moc_configs.get(path)
                        if config is None:
                            next_item[label] = value
                        else:
                            next_item[label] = [path, *config.get("pages", [])]
                    elif isinstance(value, list):
                        next_item[label] = transform(value)
                    else:
                        next_item[label] = value
                transformed.append(next_item)
                continue
            transformed.append(item)
        return transformed

    return transform(deepcopy(nav_items))


def moc_page_urls(moc_configs: dict[str, dict]) -> set[str]:
    urls: set[str] = set()
    for path in moc_configs:
        url = knotis_site_io.nav_path_to_url(path)
        if url:
            urls.add(url)
    return urls


def _toml_string(value: object) -> str:
    return json.dumps(str(value), ensure_ascii=False)


def render_nav_entry(item, indent: int) -> str:
    pad = "  " * indent
    if isinstance(item, str):
        return f"{pad}{_toml_string(_normalize_nav_path(item))}"
    if isinstance(item, list):
        child_lines = [render_nav_entry(child, indent + 1) for child in item]
        inner = ",\n".join(child_lines)
        return f"{pad}[\n{inner},\n{pad}]"
    if isinstance(item, dict):
        lines = []
        for label, value in item.items():
            if isinstance(value, str):
                lines.append(f"{pad}{{ {_toml_string(label)} = {_toml_string(_normalize_nav_path(value))} }}")
            elif isinstance(value, list):
                child_lines = [render_nav_entry(child, indent + 1) for child in value]
                inner = ",\n".join(child_lines)
                lines.append(f"{pad}{{ {_toml_string(label)} = [\n{inner},\n{pad}] }}")
        return ",\n".join(lines)
    raise TypeError(f"Unsupported nav item: {item!r}")


def render_nav_block(nav_items: list) -> str:
    entries = [render_nav_entry(item, 1) for item in nav_items]
    inner = ",\n".join(entries)
    return f"nav = [\n{inner},\n]"


def _find_nav_block(text: str) -> tuple[int, int] | None:
    needle = "nav"
    pos = 0
    while True:
        start = text.find(needle, pos)
        if start < 0:
            return None
        if start > 0 and (text[start - 1].isalnum() or text[start - 1] in "_-"):
            pos = start + len(needle)
            continue
        cursor = start + len(needle)
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        if cursor >= len(text) or text[cursor] != "=":
            pos = start + len(needle)
            continue
        cursor += 1
        while cursor < len(text) and text[cursor].isspace():
            cursor += 1
        if cursor >= len(text) or text[cursor] != "[":
            pos = start + len(needle)
            continue
        depth = 0
        in_single = False
        in_double = False
        escaped = False
        idx = cursor
        while idx < len(text):
            ch = text[idx]
            if escaped:
                escaped = False
            elif ch == "\\" and in_double:
                escaped = True
            elif ch == "'" and not in_double:
                in_single = not in_single
            elif ch == '"' and not in_single:
                in_double = not in_double
            elif not in_single and not in_double:
                if ch == "[":
                    depth += 1
                elif ch == "]":
                    depth -= 1
                    if depth == 0:
                        return start, idx + 1
            idx += 1
        return None


def replace_nav_block(text: str, nav_items: list) -> str:
    nav_block = _find_nav_block(text)
    if nav_block is None:
        return text
    start, end = nav_block
    return text[:start] + render_nav_block(nav_items) + text[end:]
