#!/usr/bin/env python3
from __future__ import annotations
"""
config_normalize.py — Validate and normalize [project.extra.knotis] config.

Each feature section has a `_normalize_*` function; `_normalize_knotis_config`
runs them all against `config_defaults` and `_build_graph_meta` assembles the
graph.json meta block.
"""

import re
import sys
from copy import deepcopy
from pathlib import Path

from . import content_tag_colors
from . import knotis_site_io
from .frontmatter import _yaml_scalar
from .scan_context import normalize as normalize_keyword
from .config_defaults import (
    KNOTIS_BASE_VIEW_DEFAULTS,
    KNOTIS_CONCEPT_GRAPH_DEFAULTS,
    KNOTIS_DEFAULT_CONFIG,
    KNOTIS_DEPRECATED_RUNTIME_COLOR_KEYS,
    KNOTIS_PAGE_GRAPH_DEFAULTS,
    KNOTIS_RUNTIME_COLOR_KEYS,
    KNOTIS_SITE_GRAPH_DEFAULTS,
    VALID_BOOL_AUTO,
    VALID_CONCEPT_GRAPH_VIEWS,
    VALID_CONCEPT_PRIMARY_PAGES,
    VALID_CONTEXT_SCOPES,
    VALID_FIT_MODES,
    VALID_GLOSSARY_DEFAULT_VIEWS,
    VALID_HOVER_MODES,
    VALID_LABEL_MODES,
    VALID_PAGE_EDGE_MODES,
    VALID_PAGE_FILTERS,
    VALID_PANE_EDGE_CONTEXT_MODES,
    VALID_PANE_EDGE_GAP_MODES,
    VALID_PANE_KEYWORD_CONTEXT_MODES,
    VALID_RELATIONS,
    VALID_SEEDS,
    VALID_SIZE_METRICS,
    VALID_SLIDE_FIT_MODES,
    VALID_SORT_METRICS,
    _deep_merge_dicts,
)


def _warn_knotis_config(message: str) -> None:
    print(f"[build_wikilinks] WARNING: {message}", file=sys.stderr)


def _normalize_string_list(value, valid_values: set[str] | None, path: str) -> list[str]:
    items = value if isinstance(value, list) else [value]
    normalized: list[str] = []
    for item in items:
        if item is None:
            continue
        token = str(item).strip()
        if not token:
            continue
        if valid_values and token not in valid_values:
            _warn_knotis_config(f"{path} entry '{token}' is invalid and will be ignored")
            continue
        if token not in normalized:
            normalized.append(token)
    return normalized


def _normalize_int(value, path: str, *, allow_none: bool = False, minimum: int = 0):
    if value is None and allow_none:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        _warn_knotis_config(f"{path} must be an integer{', or null' if allow_none else ''}; got {value!r}")
        return None
    if value < minimum:
        _warn_knotis_config(f"{path} must be >= {minimum}; got {value!r}")
        return None
    return value


def _normalize_percent(value, path: str):
    normalized_value = _normalize_int(value, path, minimum=0)
    if normalized_value is None:
        return None
    if normalized_value > 100:
        _warn_knotis_config(f"{path} must be <= 100; got {value!r}")
        return None
    return normalized_value


def _normalize_float(value, path: str, *, minimum: float | None = None, maximum: float | None = None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _warn_knotis_config(f"{path} must be a number; got {value!r}")
        return None
    normalized_value = float(value)
    if minimum is not None and normalized_value < minimum:
        _warn_knotis_config(f"{path} must be >= {minimum}; got {value!r}")
        return None
    if maximum is not None and normalized_value > maximum:
        _warn_knotis_config(f"{path} must be <= {maximum}; got {value!r}")
        return None
    return normalized_value


def _normalize_bool(value, path: str):
    if isinstance(value, bool):
        return value
    _warn_knotis_config(f"{path} must be true or false; got {value!r}")
    return None


def _normalize_bool_auto(value, path: str):
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value in VALID_BOOL_AUTO:
        return value
    _warn_knotis_config(f"{path} must be true, false, or 'auto'; got {value!r}")
    return None


def _normalize_enum(value, valid_values: set[str], path: str):
    if not isinstance(value, str) or value not in valid_values:
        _warn_knotis_config(
            f"{path} must be one of {sorted(valid_values)}; got {value!r}"
        )
        return None
    return value


def _normalize_css_value(value, path: str):
    if isinstance(value, str) and value.strip():
        return value.strip()
    _warn_knotis_config(f"{path} must be a non-empty CSS color string; got {value!r}")
    return None


def _normalize_color_value(value, path: str):
    normalized = _normalize_css_value(value, path)
    if normalized is None:
        return None
    if any(char in normalized for char in "{};<>") or "\n" in normalized or "\r" in normalized:
        _warn_knotis_config(f"{path} must be a single CSS color value; got {value!r}")
        return None
    return normalized


def _normalize_wikilinks_config(raw_config: dict | None, path: str = "knotis.wikilinks") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}
    normalized = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key in {"default", "slate"}:
            normalized_value = _normalize_color_value(value, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
    return normalized


def _normalize_content_tag_color_config(raw_config: dict | None, path: str = "knotis.content_tags.colors") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict[str, dict[str, str]] = {}
    for scheme, scheme_colors in raw_config.items():
        scheme_key = str(scheme or "").strip().lower()
        sub_path = f"{path}.{scheme}"
        if scheme_key not in content_tag_colors.VALID_CONTENT_TAG_COLOR_SCHEMES:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
            continue
        if not isinstance(scheme_colors, dict):
            _warn_knotis_config(f"{sub_path} must be a mapping; got {scheme_colors!r}")
            continue
        normalized_scheme: dict[str, str] = {}
        for tag, color in scheme_colors.items():
            tag_key = content_tag_colors.normalize_tag_name(tag)
            color_path = f"{sub_path}.{tag}"
            if not tag_key:
                _warn_knotis_config(f"{color_path} must use a non-empty content tag name")
                continue
            normalized_color = _normalize_color_value(
                content_tag_colors.normalize_content_tag_base_color(color),
                color_path,
            )
            if normalized_color is not None:
                normalized_scheme[tag_key] = normalized_color
        if normalized_scheme:
            normalized[scheme_key] = normalized_scheme
    return normalized


def _normalize_graph_tag_key(value: str) -> str:
    from .build_wikilinks import _clean_search_text  # avoids import cycle
    clean = _clean_search_text(str(value or "")).strip()
    clean = clean.lstrip("#").strip()
    return clean.lower()


def _display_graph_tag_label(value: str) -> str:
    from .build_wikilinks import _clean_search_text  # avoids import cycle
    clean = _clean_search_text(str(value or "")).strip()
    clean = clean.lstrip("#").strip()
    return f"#{clean}" if clean else ""


def _normalize_site_graph_tag_descriptor(value, path: str) -> dict | None:
    key = _normalize_graph_tag_key(str(value or ""))
    if not key:
        _warn_knotis_config(f"{path} must be a non-empty tag; got {value!r}")
        return None
    return {
        "key": key,
        "label": _display_graph_tag_label(str(value)),
    }


def _normalize_site_graph_exclude_tags(value, path: str) -> list[dict]:
    items = value if isinstance(value, list) else [value]
    seen: set[str] = set()
    descriptors: list[dict] = []
    for index, item in enumerate(items):
        descriptor = _normalize_site_graph_tag_descriptor(item, f"{path}[{index}]")
        if not descriptor or descriptor["key"] in seen:
            continue
        seen.add(descriptor["key"])
        descriptors.append(descriptor)
    return descriptors


def _normalize_site_graph_default_view(value, path: str) -> str:
    raw = str(value or "").strip()
    if not raw or raw.lower() == "all":
        return "all"
    key = _normalize_graph_tag_key(raw)
    if not key:
        _warn_knotis_config(f"{path} must be 'all' or a page tag; got {value!r}")
        return "all"
    return key


def _normalize_site_graph_graph_config(raw_config: dict | None, path: str) -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key == "enabled":
            normalized_value = _normalize_bool(value, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key == "default_view":
            normalized[key] = _normalize_site_graph_default_view(value, sub_path)
        elif key == "exclude_tags":
            normalized[key] = _normalize_site_graph_exclude_tags(value, sub_path)
        elif key in {"exclude_paths", "exclude_wikilinks"}:
            normalized[key] = _normalize_string_list(value, None, sub_path)
        elif key == "available_tags":
            continue
        elif key in {"class_tags", "resource_tag"}:
            _warn_knotis_config(
                f"'{sub_path}' is deprecated and ignored; use {path}.exclude_tags for site-graph tag filter chips"
            )
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
    return normalized


def _normalize_site_graph_config(raw_config: dict | None, path: str = "knotis.site_graph") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    view_config_input = {
        key: value
        for key, value in raw_config.items()
        if key not in {"graph", "filters", "exclude_paths", "exclude_wikilinks"}
    }
    if "exclude_paths" in raw_config or "exclude_wikilinks" in raw_config:
        _warn_knotis_config(
            f"'{path}.exclude_paths' and '{path}.exclude_wikilinks' are deprecated; "
            f"use {path}.graph.exclude_paths and {path}.graph.exclude_wikilinks"
        )
    normalized = _normalize_view_config(view_config_input, path)
    graph_cfg = _normalize_site_graph_graph_config(raw_config.get("graph"), f"{path}.graph")
    if graph_cfg:
        normalized["graph"] = _deep_merge_dicts(normalized.get("graph", {}), graph_cfg)
    if "filters" in raw_config:
        _warn_knotis_config(
            f"'{path}.filters' is deprecated; use {path}.graph.default_view and {path}.graph.exclude_tags"
        )
        legacy_cfg = _normalize_site_graph_graph_config(raw_config.get("filters"), f"{path}.filters")
        if legacy_cfg:
            normalized["graph"] = _deep_merge_dicts(normalized.get("graph", {}), legacy_cfg)
    return normalized


def _normalize_page_exclusion_config(
    raw_config: dict | None,
    path: str,
) -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict = {}
    if "exclude_paths" in raw_config:
        normalized["exclude_paths"] = _normalize_string_list(
            raw_config.get("exclude_paths", []),
            None,
            f"{path}.exclude_paths",
        )
    elif "exclude_pages" in raw_config:
        _warn_knotis_config(
            f"'{path}.exclude_pages' is deprecated; use {path}.exclude_paths"
        )
        normalized["exclude_paths"] = _normalize_string_list(
            raw_config.get("exclude_pages", []),
            None,
            f"{path}.exclude_paths",
        )
    for key, value in raw_config.items():
        if key in {"exclude_paths", "exclude_pages"}:
            continue
        _warn_knotis_config(f"Unknown config key '{path}.{key}' will be ignored")
    return normalized


def _normalize_wikilink_exclusion_keywords(
    raw_wikilinks: list | None,
    path: str,
    known_keywords: set[str] | None = None,
) -> list[str]:
    excluded: set[str] = set()
    for raw_wikilink in raw_wikilinks or []:
        keyword = _yaml_scalar(raw_wikilink)
        if keyword.startswith("[[") and keyword.endswith("]]"):
            keyword = keyword[2:-2].strip()
        normalized_keyword = normalize_keyword(keyword)
        if not normalized_keyword:
            continue
        excluded.add(normalized_keyword)
        if known_keywords is not None and normalized_keyword not in known_keywords:
            print(
                f"[build_wikilinks] WARNING: {path} entry '{raw_wikilink}' did not match any parsed keyword",
                file=sys.stderr,
            )
    return sorted(excluded)


def _finalize_graph_view_exclusions(
    view_cfg: dict,
    md_files: list[Path],
    config_prefix: str,
    known_keywords: set[str] | None = None,
) -> None:
    graph_cfg = view_cfg.setdefault("graph", {})
    exclude_paths = graph_cfg.get("exclude_paths", [])
    exclude_resolved = knotis_site_io.resolve_page_path_set(
        exclude_paths,
        md_files,
        config_key=f"{config_prefix}.exclude_paths",
    )
    graph_cfg["exclude_urls"] = sorted(
        knotis_site_io.page_url_from_path(md_path)
        for md_path in md_files
        if md_path.relative_to(knotis_site_io.DOCS_DIR).as_posix() in exclude_resolved
    )
    graph_cfg["exclude_keywords"] = _normalize_wikilink_exclusion_keywords(
        graph_cfg.get("exclude_wikilinks", []),
        f"{config_prefix}.exclude_wikilinks",
        known_keywords,
    )


def _finalize_graph_exclusions(
    knotis_config: dict,
    md_files: list[Path],
    all_occurrences: list[dict],
) -> None:
    known_keywords = {occ["keyword"] for occ in all_occurrences}
    for key, prefix in (
        ("site_graph", "knotis.site_graph.graph"),
        ("page_graph", "knotis.page_graph.graph"),
        ("concept_graph", "knotis.concept_graph.graph"),
    ):
        _finalize_graph_view_exclusions(
            knotis_config.setdefault(key, {}),
            md_files,
            prefix,
            known_keywords,
        )


def _normalize_search_config(raw_config: dict | None, path: str = "knotis.search") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    removed_keys = {
        "include_pages",
        "include_concepts",
        "include_references",
        "include_content_tags",
        "suggest",
        "filters",
        "index_path",
    }
    normalized: dict = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key == "enabled":
            normalized_value = _normalize_bool(value, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key in {"exclude_paths", "exclude_wikilinks"}:
            normalized[key] = _normalize_string_list(value, None, sub_path)
        elif key == "order":
            tokens = _normalize_string_list(value, None, sub_path)
            normalized[key] = [token.strip("/") for token in tokens if token.strip("/")]
        elif key == "exclude_pages":
            _warn_knotis_config(
                f"'{sub_path}' is deprecated; use {path}.exclude_paths"
            )
            normalized["exclude_paths"] = _normalize_string_list(value, None, f"{path}.exclude_paths")
        elif key in removed_keys:
            _warn_knotis_config(f"'{sub_path}' is not configurable; remove it from zensical.toml")
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
    return normalized


def _normalize_pane_config(raw_config: dict | None, path: str = "knotis.pane") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key == "path":
            path_cfg = _normalize_path_config(value, sub_path)
            if path_cfg:
                normalized["path"] = path_cfg
        elif key == "order":
            tokens = _normalize_string_list(value, None, sub_path)
            normalized[key] = [token.strip("/") for token in tokens if token.strip("/")]
        elif key == "width":
            normalized_value = _normalize_int(value, sub_path, minimum=320)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key in {"initial_lines", "initial_list_items", "chunk_lines"}:
            normalized_value = _normalize_int(value, sub_path, minimum=1)
            if normalized_value is not None:
                normalized[key] = normalized_value
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
    return normalized


def _finalize_pane_runtime_config(knotis_config: dict) -> None:
    author = knotis_config.get("pane", {})
    if not isinstance(author, dict):
        author = {}
    path_author = author.get("path", {})
    if not isinstance(path_author, dict):
        path_author = {}
    defaults_pane = knotis_config.setdefault("defaults", {}).setdefault("pane", {})
    for key in ("order", "width", "initial_lines", "initial_list_items", "chunk_lines"):
        if key in author:
            defaults_pane[key] = deepcopy(author[key])
    knotis_config["path"] = {
        "enabled": path_author.get("enabled", True),
        "include_paths": list(path_author.get("include_paths", [])),
        "exclude_paths": list(path_author.get("exclude_paths", [])),
    }


def _normalize_path_config(raw_config: dict | None, path: str = "knotis.path") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict = {}
    if "enabled" in raw_config:
        sub_path = f"{path}.enabled"
        normalized_value = _normalize_bool(raw_config["enabled"], sub_path)
        if normalized_value is not None:
            normalized["enabled"] = normalized_value
    for key in ("include_paths", "exclude_paths"):
        if key not in raw_config:
            continue
        sub_path = f"{path}.{key}"
        tokens = _normalize_string_list(raw_config[key], None, sub_path)
        normalized[key] = [token.strip("/") for token in tokens if token.strip("/")]
    for key in raw_config:
        if key not in {"enabled", "include_paths", "exclude_paths"}:
            _warn_knotis_config(f"Unknown config key '{path}.{key}' will be ignored")
    return normalized


def _normalize_readaloud_config(raw_config: dict | None, path: str = "knotis.readaloud") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key == "enabled":
            normalized_value = _normalize_bool(value, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
    return normalized


def _normalize_slides_config(raw_config: dict | None, path: str = "knotis.slides") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key == "enabled":
            normalized_value = _normalize_bool(value, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key == "fit_mode":
            normalized_value = _normalize_enum(value, VALID_SLIDE_FIT_MODES, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key in {"fit_min_font_px", "fit_max_font_px"}:
            normalized_value = _normalize_int(value, sub_path, minimum=1)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key == "content_fill":
            normalized_value = _normalize_float(value, sub_path, minimum=0.35, maximum=1.0)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key == "content_inset":
            if not isinstance(value, list) or len(value) != 4:
                _warn_knotis_config(f"{sub_path} must be a 4-element array [top, right, bottom, left]; got {value!r}")
            else:
                parsed = []
                valid = True
                for i, v in enumerate(value):
                    n = v if isinstance(v, (int, float)) and not isinstance(v, bool) else None
                    if n is None or n < 0 or n > 20:
                        _warn_knotis_config(f"{sub_path}[{i}] must be 0 through 20; got {v!r}")
                        valid = False
                        break
                    parsed.append(n)
                if valid:
                    normalized[key] = parsed
        elif key in {"include_paths", "exclude_paths"}:
            normalized[key] = knotis_site_io.normalize_page_path_list(value, config_key=sub_path)
        elif key == "include_pages":
            _warn_knotis_config(
                f"'{sub_path}' is deprecated; use {path}.include_paths"
            )
            normalized["include_paths"] = knotis_site_io.normalize_page_path_list(
                value,
                config_key=f"{path}.include_paths",
            )
        elif key == "exclude_pages":
            _warn_knotis_config(
                f"'{sub_path}' is deprecated; use {path}.exclude_paths"
            )
            normalized["exclude_paths"] = knotis_site_io.normalize_page_path_list(
                value,
                config_key=f"{path}.exclude_paths",
            )
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")

    if (
        "fit_min_font_px" in normalized
        and "fit_max_font_px" in normalized
        and normalized["fit_min_font_px"] > normalized["fit_max_font_px"]
    ):
        _warn_knotis_config(
            f"{path}.fit_min_font_px must be <= {path}.fit_max_font_px; "
            f"got {normalized['fit_min_font_px']!r} > {normalized['fit_max_font_px']!r}"
        )
        normalized.pop("fit_min_font_px", None)
        normalized.pop("fit_max_font_px", None)
    return normalized


def _normalize_content_tags_config(raw_config: dict | None, path: str = "knotis.content_tags") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key in {"enabled", "nav_chips", "sync_nav"}:
            normalized_value = _normalize_bool(value, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        elif key == "order":
            normalized["order"] = content_tag_colors.normalize_content_tag_order(value)
        elif key == "colors":
            color_cfg = _normalize_content_tag_color_config(value, sub_path)
            if color_cfg:
                normalized["colors"] = color_cfg
        elif key == "tag":
            _warn_knotis_config(
                f"'{sub_path}' is no longer supported; edit tags in the generated content-tags.md front matter"
            )
        elif key in {"path", "page"}:
            _warn_knotis_config(
                f"'{sub_path}' is no longer supported; add content-tags.md to project.nav where you want it"
            )
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
    return normalized


def _normalize_content_config(raw_config: dict | None, path: str = "knotis.content") -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized = {}
    for key, value in raw_config.items():
        sub_path = f"{path}.{key}"
        if key == "structured_lists":
            _warn_knotis_config(
                f"'{sub_path}' is no longer configurable; nested outline list numbering is always enabled"
            )
        elif key == "markerless_bullets":
            _warn_knotis_config(
                f"'{sub_path}' is no longer configurable; markerless outline blocks are always enabled"
            )
        elif key == "nested_numbering_lists":
            _warn_knotis_config(
                f"'{sub_path}' is no longer configurable; nested outline list numbering is always enabled"
            )
        elif key in {"heading_numbering", "heading_guides", "generator", "styled_section_groups"}:
            normalized_value = _normalize_bool(value, sub_path)
            if normalized_value is not None:
                normalized[key] = normalized_value
        else:
            _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
    return normalized


def _normalize_view_config(raw_config: dict | None, path: str) -> dict:
    if raw_config is None:
        return {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config(f"{path} must be a mapping; got {raw_config!r}")
        return {}

    normalized: dict = {}
    for key, value in raw_config.items():
        if key in {"exclude_paths", "exclude_wikilinks"}:
            _warn_knotis_config(
                f"'{path}.{key}' is deprecated; use {path}.graph.{key}"
            )
            continue
        if key == "graph":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.graph must be a mapping; got {value!r}")
                continue
            graph_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.graph.{sub_key}"
                if sub_key == "enabled":
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key in {"exclude_paths", "exclude_wikilinks"}:
                    graph_cfg[sub_key] = _normalize_string_list(sub_value, None, sub_path)
                    continue
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    graph_cfg[sub_key] = normalized_value
            if graph_cfg:
                normalized["graph"] = graph_cfg
        elif key == "nodes":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.nodes must be a mapping; got {value!r}")
                continue
            nodes_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.nodes.{sub_key}"
                if sub_key in {"show_keywords", "show_pages", "show_categories", "show_orphans"}:
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key in {"min_keyword_page_count", "min_keyword_occurrence_count"}:
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=0)
                elif sub_key == "size_metric":
                    normalized_value = _normalize_enum(sub_value, VALID_SIZE_METRICS, sub_path)
                elif sub_key in {"keyword_radius", "page_radius", "category_radius"}:
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=1)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    nodes_cfg[sub_key] = normalized_value
            if nodes_cfg:
                normalized["nodes"] = nodes_cfg
        elif key == "relations":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.relations must be a mapping; got {value!r}")
                continue
            rel_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.relations.{sub_key}"
                if sub_key == "include":
                    rel_cfg[sub_key] = _normalize_string_list(sub_value, VALID_RELATIONS, sub_path)
                elif sub_key == "min_weight":
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=1)
                    if normalized_value is not None:
                        rel_cfg[sub_key] = normalized_value
                elif sub_key == "top_edges_per_node":
                    normalized_value = _normalize_int(sub_value, sub_path, allow_none=True, minimum=1)
                    rel_cfg[sub_key] = normalized_value
                elif sub_key == "sort_metric":
                    normalized_value = _normalize_enum(sub_value, VALID_SORT_METRICS, sub_path)
                    if normalized_value is not None:
                        rel_cfg[sub_key] = normalized_value
                elif sub_key == "page_edges":
                    normalized_value = _normalize_enum(sub_value, VALID_PAGE_EDGE_MODES, sub_path)
                    if normalized_value is not None:
                        rel_cfg[sub_key] = normalized_value
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
            if rel_cfg:
                normalized["relations"] = rel_cfg
        elif key == "scope":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.scope must be a mapping; got {value!r}")
                continue
            scope_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.scope.{sub_key}"
                if sub_key == "page_filter":
                    normalized_value = _normalize_enum(sub_value, VALID_PAGE_FILTERS, sub_path)
                elif sub_key == "seed":
                    normalized_value = _normalize_enum(sub_value, VALID_SEEDS, sub_path)
                elif sub_key == "max_hops":
                    normalized_value = _normalize_int(sub_value, sub_path, allow_none=True, minimum=1)
                elif sub_key == "view":
                    normalized_value = _normalize_enum(sub_value, VALID_CONCEPT_GRAPH_VIEWS, sub_path)
                elif sub_key == "primary_page":
                    normalized_value = _normalize_enum(sub_value, VALID_CONCEPT_PRIMARY_PAGES, sub_path)
                elif sub_key in {"max_pages", "max_ancestor_hops", "max_descendant_hops"}:
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=0)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None or sub_key == "max_hops":
                    scope_cfg[sub_key] = normalized_value
            if scope_cfg:
                normalized["scope"] = scope_cfg
        elif key == "layout":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.layout must be a mapping; got {value!r}")
                continue
            layout_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.layout.{sub_key}"
                if sub_key == "fit_mode":
                    normalized_value = _normalize_enum(sub_value, VALID_FIT_MODES, sub_path)
                elif sub_key == "fit_padding":
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=0)
                elif sub_key == "fit_shrink":
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.5, maximum=1.0)
                elif sub_key == "bounds_label_pad":
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=0)
                elif sub_key == "fit_on_resize":
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key == "initial_zoom":
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.1, maximum=8.0)
                elif sub_key == "preview_zoom":
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.1, maximum=8.0)
                elif sub_key == "center_on_load":
                    normalized_value = _normalize_bool(sub_value, sub_path)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    layout_cfg[sub_key] = normalized_value
            if layout_cfg:
                normalized["layout"] = layout_cfg
        elif key == "physics":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.physics must be a mapping; got {value!r}")
                continue
            physics_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.physics.{sub_key}"
                if sub_key in {"link_distance", "link_distance_min", "link_distance_max", "charge_range", "collision_padding"}:
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0)
                elif sub_key == "charge_strength":
                    normalized_value = _normalize_float(sub_value, sub_path)
                elif sub_key in {"center_strength", "anchor_strength", "radial_strength", "alpha_decay"}:
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    physics_cfg[sub_key] = normalized_value
            if (
                "link_distance_min" in physics_cfg
                and "link_distance_max" in physics_cfg
                and physics_cfg["link_distance_min"] > physics_cfg["link_distance_max"]
            ):
                _warn_knotis_config(
                    f"{path}.physics.link_distance_min must be <= {path}.physics.link_distance_max; "
                    f"got {physics_cfg['link_distance_min']!r} > {physics_cfg['link_distance_max']!r}"
                )
                physics_cfg.pop("link_distance_min", None)
                physics_cfg.pop("link_distance_max", None)
            if physics_cfg:
                normalized["physics"] = physics_cfg
        elif key == "labels":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.labels must be a mapping; got {value!r}")
                continue
            labels_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.labels.{sub_key}"
                if sub_key in {"show", "outline"}:
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key == "mode":
                    normalized_value = _normalize_enum(sub_value, VALID_LABEL_MODES | {"zoom"}, sub_path)
                elif sub_key in {"font_size", "page_font_size", "category_font_size", "modal_font_size", "preview_font_size"}:
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=1)
                elif sub_key in {"wrap_chars", "max_lines", "font_weight"}:
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=1)
                elif sub_key == "keyword_zoom_threshold":
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.25)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    labels_cfg[sub_key] = normalized_value
            if labels_cfg:
                normalized["labels"] = labels_cfg
        elif key == "n_hops":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.n_hops must be a mapping; got {value!r}")
                continue
            hops_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.n_hops.{sub_key}"
                if sub_key in {"enabled", "show_control"}:
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key in {"default", "min", "max"}:
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=1)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    hops_cfg[sub_key] = normalized_value
            if "min" in hops_cfg and "max" in hops_cfg and hops_cfg["min"] > hops_cfg["max"]:
                _warn_knotis_config(
                    f"{path}.n_hops.min must be <= {path}.n_hops.max; "
                    f"got {hops_cfg['min']!r} > {hops_cfg['max']!r}"
                )
                hops_cfg.pop("min", None)
                hops_cfg.pop("max", None)
            if hops_cfg:
                normalized["n_hops"] = hops_cfg
        elif key == "hover":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.hover must be a mapping; got {value!r}")
                continue
            hover_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.hover.{sub_key}"
                if sub_key == "enabled":
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key == "mode":
                    normalized_value = _normalize_enum(sub_value, VALID_HOVER_MODES, sub_path)
                elif sub_key == "hops":
                    normalized_value = _normalize_int(sub_value, sub_path, minimum=1)
                elif sub_key == "freeze_key":
                    normalized_value = str(sub_value).strip() if isinstance(sub_value, str) and str(sub_value).strip() else None
                    if normalized_value is None:
                        _warn_knotis_config(f"{sub_path} must be a non-empty string; got {sub_value!r}")
                elif sub_key in {
                    "freeze_enabled",
                    "dim_enabled",
                    "include_page",
                    "include_categories",
                    "include_hierarchy_ancestors",
                    "include_hierarchy_descendants",
                    "include_siblings",
                    "include_nav",
                    "include_page_edges",
                    "include_hierarchy_edges",
                    "include_sibling_edges",
                    "preserve_story_chain",
                }:
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key == "page_scope":
                    normalized_value = _normalize_enum(sub_value, VALID_PAGE_FILTERS, sub_path)
                elif sub_key == "dim_non_hovered_percent":
                    normalized_value = _normalize_percent(sub_value, sub_path)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    hover_cfg[sub_key] = normalized_value
            if hover_cfg:
                normalized["hover"] = hover_cfg
        elif key == "edges":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.edges must be a mapping; got {value!r}")
                continue
            edges_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.edges.{sub_key}"
                if sub_key in {"page_opacity", "hierarchy_opacity", "sibling_opacity", "nav_opacity", "highlight_opacity", "dim_opacity"}:
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.0, maximum=1.0)
                elif sub_key in {"page_width", "hierarchy_width", "sibling_width", "nav_width"}:
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.0)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    edges_cfg[sub_key] = normalized_value
            if edges_cfg:
                normalized["edges"] = edges_cfg
        elif key == "controls":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.controls must be a mapping; got {value!r}")
                continue
            controls_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.controls.{sub_key}"
                if sub_key in {"show_zoom", "show_search"}:
                    normalized_value = _normalize_bool_auto(sub_value, sub_path)
                elif sub_key in {"show_expand", "enable_node_click", "enable_edge_click"}:
                    normalized_value = _normalize_bool(sub_value, sub_path)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    controls_cfg[sub_key] = normalized_value
            if controls_cfg:
                normalized["controls"] = controls_cfg
        elif key == "pane":
            if isinstance(value, dict) and value:
                _warn_knotis_config(
                    f"{path}.pane is not configurable; set pane options under knotis.pane instead"
                )
        elif key == "colors":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.colors must be a mapping; got {value!r}")
                continue
            color_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.colors.{sub_key}"
                if sub_key not in KNOTIS_RUNTIME_COLOR_KEYS:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if sub_key in KNOTIS_DEPRECATED_RUNTIME_COLOR_KEYS:
                    _warn_knotis_config(
                        f"{sub_path} is deprecated; override --knotis-wikilink-* or --content-tag-1..5 tokens in CSS instead"
                    )
                    continue
                normalized_value = _normalize_css_value(sub_value, sub_path)
                if normalized_value is not None:
                    color_cfg[sub_key] = normalized_value
            if color_cfg:
                normalized["colors"] = color_cfg
        elif key == "content_tag_color_order":
            _warn_knotis_config(
                f"{path}.content_tag_color_order is ignored; content tag colors are assigned automatically "
                "from knotis-content-tags.css tokens"
            )
        elif key == "content_tag_palette":
            _warn_knotis_config(
                f"{path}.content_tag_palette is deprecated and ignored; "
                "define --content-tag-1..5 in knotis-content-tags.css or assets/knotis-theme.css overrides instead"
            )
        elif key in {"content_tag_colors", "content_tag_color_overrides"}:
            _warn_knotis_config(
                f"{path}.{key} is ignored; content tag colors are assigned automatically "
                "from knotis-content-tags.css tokens"
            )
        elif key == "ui":
            if not isinstance(value, dict):
                _warn_knotis_config(f"{path}.ui must be a mapping; got {value!r}")
                continue
            ui_cfg = {}
            for sub_key, sub_value in value.items():
                sub_path = f"{path}.ui.{sub_key}"
                if sub_key in {"show_labels", "show_expand_button", "enable_edge_click", "enable_node_click"}:
                    normalized_value = _normalize_bool(sub_value, sub_path)
                elif sub_key in {"show_zoom_controls", "enable_search"}:
                    normalized_value = _normalize_bool_auto(sub_value, sub_path)
                elif sub_key == "label_mode":
                    normalized_value = _normalize_enum(sub_value, VALID_LABEL_MODES, sub_path)
                elif sub_key == "keyword_label_zoom_threshold":
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.25)
                elif sub_key in {"page_edge_opacity", "hierarchy_edge_opacity", "sibling_edge_opacity", "nav_edge_opacity"}:
                    normalized_value = _normalize_float(sub_value, sub_path, minimum=0.0, maximum=1.0)
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
                    continue
                if normalized_value is not None:
                    ui_cfg[sub_key] = normalized_value
            if ui_cfg:
                normalized["ui"] = ui_cfg
        else:
            _warn_knotis_config(f"Unknown config key '{path}.{key}' will be ignored")
    if not normalized.get("colors"):
        normalized.pop("colors", None)
    return normalized


def _normalize_knotis_config(raw_config: dict | None) -> dict:
    raw_config = raw_config or {}
    if not isinstance(raw_config, dict):
        _warn_knotis_config("extra.knotis must be a mapping; using defaults")
        raw_config = {}

    normalized = deepcopy(KNOTIS_DEFAULT_CONFIG)

    if "glossary" in raw_config:
        glossary_value = raw_config.get("glossary")
        if not isinstance(glossary_value, dict):
            _warn_knotis_config(f"knotis.glossary must be a mapping; got {glossary_value!r}")
        else:
            glossary_cfg = {}
            for sub_key, sub_value in glossary_value.items():
                sub_path = f"knotis.glossary.{sub_key}"
                if sub_key == "default_view":
                    normalized_value = _normalize_enum(sub_value, VALID_GLOSSARY_DEFAULT_VIEWS, sub_path)
                    if normalized_value == "module":
                        normalized_value = "by_page"
                    if normalized_value is not None:
                        glossary_cfg[sub_key] = normalized_value
                elif sub_key == "page_view_label":
                    label = str(sub_value).strip()
                    if label:
                        glossary_cfg[sub_key] = label
                elif sub_key == "exclude_paths":
                    glossary_cfg[sub_key] = _normalize_string_list(sub_value, None, sub_path)
                elif sub_key == "order":
                    tokens = _normalize_string_list(sub_value, None, sub_path)
                    glossary_cfg[sub_key] = [token.strip("/") for token in tokens if token.strip("/")]
                elif sub_key == "exclude_pages":
                    _warn_knotis_config(
                        f"'{sub_path}' is deprecated; use knotis.glossary.exclude_paths"
                    )
                    glossary_cfg["exclude_paths"] = _normalize_string_list(
                        sub_value,
                        None,
                        "knotis.glossary.exclude_paths",
                    )
                elif sub_key == "enabled":
                    normalized_value = _normalize_bool(sub_value, sub_path)
                    if normalized_value is not None:
                        glossary_cfg[sub_key] = normalized_value
                else:
                    _warn_knotis_config(f"Unknown config key '{sub_path}' will be ignored")
            if glossary_cfg:
                normalized["glossary"] = _deep_merge_dicts(normalized["glossary"], glossary_cfg)

    if "pane" in raw_config:
        normalized["pane"] = _deep_merge_dicts(
            normalized["pane"],
            _normalize_pane_config(raw_config.get("pane")),
        )

    if "graph" in raw_config:
        legacy_graph = raw_config.get("graph")
        if isinstance(legacy_graph, dict) and (
            legacy_graph.get("exclude_paths") or legacy_graph.get("exclude_wikilinks")
        ):
            _warn_knotis_config(
                "knotis.graph is removed; set exclude_paths and exclude_wikilinks "
                "under knotis.site_graph.graph, knotis.page_graph.graph, or knotis.concept_graph.graph"
            )

    if "hashtags" in raw_config:
        _warn_knotis_config(
            "Legacy [project.extra.knotis.hashtags] is unsupported; use [project.extra.knotis.content_tags]"
        )
        normalized["content_tags"] = _deep_merge_dicts(
            normalized["content_tags"],
            _normalize_content_tags_config(raw_config.get("hashtags")),
        )

    if "content_tags" in raw_config:
        normalized["content_tags"] = _deep_merge_dicts(
            normalized["content_tags"],
            _normalize_content_tags_config(raw_config.get("content_tags")),
        )

    if "wikilinks" in raw_config:
        normalized["wikilinks"] = _deep_merge_dicts(
            normalized["wikilinks"],
            _normalize_wikilinks_config(raw_config.get("wikilinks")),
        )

    if "search" in raw_config:
        normalized["search"] = _deep_merge_dicts(
            normalized["search"],
            _normalize_search_config(raw_config.get("search")),
        )

    if "slides" in raw_config:
        normalized["slides"] = _deep_merge_dicts(
            normalized["slides"],
            _normalize_slides_config(raw_config.get("slides")),
        )

    if "readaloud" in raw_config:
        normalized["readaloud"] = _deep_merge_dicts(
            normalized["readaloud"],
            _normalize_readaloud_config(raw_config.get("readaloud")),
        )

    if "content" in raw_config:
        normalized["content"] = _deep_merge_dicts(
            normalized["content"],
            _normalize_content_config(raw_config.get("content")),
        )

    if "defaults" in raw_config:
        normalized["defaults"] = _deep_merge_dicts(
            normalized["defaults"],
            _normalize_view_config(raw_config.get("defaults"), "knotis.defaults"),
        )
    if "page_graph" in raw_config:
        normalized["page_graph"] = _deep_merge_dicts(
            normalized["page_graph"],
            _normalize_view_config(raw_config.get("page_graph"), "knotis.page_graph"),
        )
    if "concept_graph" in raw_config:
        normalized["concept_graph"] = _deep_merge_dicts(
            normalized["concept_graph"],
            _normalize_view_config(raw_config.get("concept_graph"), "knotis.concept_graph"),
        )
    if "site_graph" in raw_config:
        normalized["site_graph"] = _deep_merge_dicts(
            normalized["site_graph"],
            _normalize_site_graph_config(raw_config.get("site_graph"), "knotis.site_graph"),
        )

    for key in raw_config:
        if key not in {
            "pane",
            "graph",
            "glossary",
            "content_tags",
            "wikilinks",
            "search",
            "slides",
            "readaloud",
            "content",
            "defaults",
            "page_graph",
            "concept_graph",
            "site_graph",
        }:
            _warn_knotis_config(f"Unknown config key 'knotis.{key}' will be ignored")

    _finalize_pane_runtime_config(normalized)

    return normalized


def _finalize_content_tag_colors(
    knotis_config: dict,
    content_tags_index: dict[str, list[dict]],
    all_content_tag_occurrences: list[dict],
) -> None:
    content_tags_cfg = knotis_config.get("content_tags", {})
    defaults_cfg = knotis_config.setdefault("defaults", {})
    defaults_cfg["content_tag_colors"] = content_tag_colors.resolve_content_tag_colors(
        order="alphabetical",
        discovered_tags=list(content_tags_index.keys()),
        first_seen_tags=[occ["content_tag"] for occ in all_content_tag_occurrences],
        configured_order=content_tags_cfg.get("order", []),
        configured_colors=content_tags_cfg.get("colors", {}),
    )


def _finalize_slides_page_scope(slides_cfg: dict, md_files: list[Path]) -> None:
    include_paths = slides_cfg.get("include_paths", [])
    exclude_paths = slides_cfg.get("exclude_paths", [])
    include_resolved = knotis_site_io.resolve_page_path_set(
        include_paths,
        md_files,
        config_key="knotis.slides.include_paths",
    )
    exclude_resolved = knotis_site_io.resolve_page_path_set(
        exclude_paths,
        md_files,
        config_key="knotis.slides.exclude_paths",
    )
    included_paths = include_resolved - exclude_resolved
    slides_cfg["include_urls"] = sorted(knotis_site_io.page_url_from_path(md_path) for md_path in md_files if md_path.relative_to(knotis_site_io.DOCS_DIR).as_posix() in included_paths)
    slides_cfg["exclude_urls"] = sorted(knotis_site_io.page_url_from_path(md_path) for md_path in md_files if md_path.relative_to(knotis_site_io.DOCS_DIR).as_posix() in exclude_resolved)


def _build_graph_meta(knotis_config: dict | None, md_files: list[Path] | None = None) -> dict:
    knotis_config = knotis_config or deepcopy(KNOTIS_DEFAULT_CONFIG)
    content_tags_cfg = deepcopy(knotis_config.get("content_tags", {}))
    content_tags_path = knotis_site_io.nav_path_for_filename("content-tags.md") or "content-tags.md"
    content_tags_cfg["page_url"] = knotis_site_io.nav_path_to_url(content_tags_path) or ""
    site_graph_cfg = deepcopy(knotis_config.get("site_graph", {}))
    site_graph_path = (
        knotis_site_io.nav_path_for_filename("site-graph.md")
        or knotis_site_io.nav_path_for_filename("graph.md")
        or ("graph.md" if (knotis_site_io.DOCS_DIR / "graph.md").is_file() else "site-graph.md")
    )
    site_graph_cfg["page_url"] = knotis_site_io.nav_path_to_url(site_graph_path) or ""
    slides_cfg = deepcopy(knotis_config.get("slides", {}))
    _finalize_slides_page_scope(slides_cfg, md_files or [])
    return {
        "knotis": {
            "defaults": deepcopy(knotis_config.get("defaults", {})),
            "page_graph": deepcopy(knotis_config.get("page_graph", {})),
            "concept_graph": deepcopy(knotis_config.get("concept_graph", {})),
            "site_graph": site_graph_cfg,
            "slides": slides_cfg,
            "readaloud": deepcopy(knotis_config.get("readaloud", {})),
            "content": deepcopy(knotis_config.get("content", {})),
            "content_tags": content_tags_cfg,
            "wikilinks": deepcopy(knotis_config.get("wikilinks", {})),
            "pane": deepcopy(knotis_config.get("pane", {})),
            "path": deepcopy(knotis_config.get("path", {})),
        }
    }


def _load_toml_knotis_config() -> dict:
    project = knotis_site_io.read_zensical_toml().get("project", {})
    extra = project.get("extra", {}) if isinstance(project, dict) else {}
    knotis = extra.get("knotis", {}) if isinstance(extra, dict) else {}
    return knotis if isinstance(knotis, dict) else {}


def _load_toml_nav() -> list:
    project = knotis_site_io.read_zensical_toml().get("project", {})
    nav = project.get("nav", []) if isinstance(project, dict) else []
    return nav if isinstance(nav, list) else []


def _load_site_knotis_config() -> dict:
    return _load_toml_knotis_config()


def _load_site_nav() -> list:
    return _load_toml_nav()
