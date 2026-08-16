#!/usr/bin/env python3
from __future__ import annotations

VALID_CONTENT_TAG_COLOR_ORDERS = {"alphabetical", "first_seen"}
VALID_CONTENT_TAG_COLOR_SCHEMES = {"default", "slate"}

# Auto-assigned tags cycle these five palette tokens (defaults in knotis-content-tags.css).
AUTO_CONTENT_TAG_PALETTE = (
    "var(--content-tag-1)",
    "var(--content-tag-2)",
    "var(--content-tag-3)",
    "var(--content-tag-4)",
    "var(--content-tag-5)",
)


def normalize_tag_name(raw: object) -> str:
    return str(raw or "").strip().lstrip("#").lower()


def display_tag_name(raw: object) -> str:
    tag = normalize_tag_name(raw)
    return f"#{tag}" if tag else ""


def expand_palette_color(base_color: str) -> dict[str, str]:
    color = base_color.strip()
    return {
        "text": color,
        "background": f"color-mix(in srgb, {color} 18%, transparent)",
        "hover_background": f"color-mix(in srgb, {color} 28%, transparent)",
        "mark_background": f"color-mix(in srgb, {color} 28%, transparent)",
        "mark_text": color,
    }


def normalize_content_tag_color_order(raw_order: object) -> str:
    candidate = str(raw_order or "alphabetical").strip().lower()
    if candidate in VALID_CONTENT_TAG_COLOR_ORDERS:
        return candidate
    return "alphabetical"


def normalize_content_tag_order(raw_order: object) -> list[str]:
    items = raw_order if isinstance(raw_order, list) else [raw_order]
    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        tag = normalize_tag_name(item)
        if not tag or tag in seen:
            continue
        normalized.append(display_tag_name(tag))
        seen.add(tag)
    return normalized


def normalize_content_tag_base_color(raw_color: object) -> str:
    color = str(raw_color or "").strip()
    if not color:
        return ""
    if color.startswith("#"):
        return color
    if all(char in "0123456789abcdefABCDEF" for char in color) and len(color) in {3, 4, 6, 8}:
        return f"#{color}"
    return color


def _ordered_discovered_tags(
    discovered_tags: list[str],
    *,
    order: str,
    first_seen_tags: list[str] | None,
    configured_order: list[str] | None = None,
) -> list[str]:
    normalized_discovered: list[str] = []
    seen: set[str] = set()
    for tag in discovered_tags:
        normalized = normalize_tag_name(tag)
        if normalized and normalized not in seen:
            seen.add(normalized)
            normalized_discovered.append(normalized)

    if configured_order:
        ordered: list[str] = []
        seen_order: set[str] = set()
        for tag in configured_order:
            normalized = normalize_tag_name(tag)
            if normalized in seen and normalized not in seen_order:
                ordered.append(normalized)
                seen_order.add(normalized)
        for tag in sorted(normalized_discovered):
            if tag not in seen_order:
                ordered.append(tag)
        return ordered

    if order == "first_seen" and first_seen_tags:
        ordered: list[str] = []
        seen_order: set[str] = set()
        for tag in first_seen_tags:
            normalized = normalize_tag_name(tag)
            if normalized in seen and normalized not in seen_order:
                ordered.append(normalized)
                seen_order.add(normalized)
        for tag in sorted(normalized_discovered):
            if tag not in seen_order:
                ordered.append(tag)
        return ordered
    return sorted(normalized_discovered)


def resolve_content_tag_colors(
    *,
    order: str,
    discovered_tags: list[str],
    first_seen_tags: list[str] | None = None,
    configured_order: list[str] | None = None,
    configured_colors: dict[str, dict[str, str]] | None = None,
) -> dict[str, dict[str, dict[str, str]]]:
    order = normalize_content_tag_color_order(order)
    ordered_tags = _ordered_discovered_tags(
        discovered_tags,
        order=order,
        first_seen_tags=first_seen_tags,
        configured_order=configured_order,
    )
    if not ordered_tags:
        return {}
    configured_colors = configured_colors or {}

    resolved_by_scheme: dict[str, dict[str, dict[str, str]]] = {}
    for scheme in ("default", "slate"):
        scheme_colors = configured_colors.get(scheme, {})
        resolved: dict[str, dict[str, str]] = {}
        for tag in ordered_tags:
            if tag in scheme_colors:
                resolved[tag] = expand_palette_color(scheme_colors[tag])

        palette_index = 0
        for tag in ordered_tags:
            if tag in resolved:
                continue
            base_color = AUTO_CONTENT_TAG_PALETTE[palette_index % len(AUTO_CONTENT_TAG_PALETTE)]
            palette_index += 1
            resolved[tag] = expand_palette_color(base_color)

        resolved_by_scheme[scheme] = resolved

    return resolved_by_scheme
