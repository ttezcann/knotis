#!/usr/bin/env python3
from __future__ import annotations
"""
config_defaults.py — Default Knotis runtime configuration.

Base view/site/page/concept graph profiles and the top-level default
config dict that `config_normalize` merges user config into.
"""

from copy import deepcopy


def _deep_merge_dicts(base: dict, override: dict) -> dict:
    result = deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge_dicts(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


KNOTIS_RUNTIME_COLOR_KEYS = {
    "wikilink_text",
    "wikilink_hover_background",
    "wikilink_flash_background",
    "wikilink_flash_outline",
    "content_tag_text",
    "content_tag_background",
    "content_tag_hover_background",
    "content_tag_mark_background",
    "content_tag_mark_text",
    "block_highlight_background",
    "block_highlight_mid_background",
    "block_highlight_outline",
}

KNOTIS_DEPRECATED_RUNTIME_COLOR_KEYS = KNOTIS_RUNTIME_COLOR_KEYS


KNOTIS_BASE_VIEW_DEFAULTS = {
    "graph": {
        "enabled": True,
    },
    "nodes": {
        "show_keywords": True,
        "show_pages": True,
        "show_categories": True,
        "show_orphans": False,
        "min_keyword_page_count": 1,
        "min_keyword_occurrence_count": 1,
        "size_metric": "page_count",
        "keyword_radius": 18,
        "page_radius": 30,
        "category_radius": 54,
    },
    "relations": {
        "include": ["hierarchy", "page", "nav"],
        "min_weight": 1,
        "top_edges_per_node": None,
        "sort_metric": "page_count",
        "page_edges": "root_only",
    },
    "scope": {
        "page_filter": "all_pages",
        "seed": "all",
        "max_hops": None,
        "view": "teaching_path",
        "primary_page": "nav_first",
        "max_pages": 4,
        "max_ancestor_hops": 2,
        "max_descendant_hops": 2,
    },
    "layout": {
        "fit_mode": "fit",
        "fit_padding": 18,
        "fit_on_resize": True,
        "initial_zoom": 1.0,
        "preview_zoom": 1.25,
        "center_on_load": True,
    },
    "physics": {
        "link_distance": 145,
        "link_distance_min": 90,
        "link_distance_max": 340,
        "charge_strength": -950,
        "charge_range": 1300,
        "collision_padding": 44,
        "center_strength": 0.10,
        "anchor_strength": 0.12,
        "alpha_decay": 0.02,
    },
    "labels": {
        "show": True,
        "mode": "all",
        "font_size": 13,
        "page_font_size": 14,
        "category_font_size": 15,
        "modal_font_size": 15,
        "preview_font_size": 17,
        "wrap_chars": 18,
        "max_lines": 4,
        "outline": True,
        "font_weight": 400,
        "keyword_zoom_threshold": 1.35,
    },
    "n_hops": {
        "enabled": True,
        "show_control": True,
        "default": 1,
        "min": 1,
        "max": 5,
    },
    "hover": {
        "enabled": True,
        "mode": "hierarchy_family",
        "hops": 2,
        "freeze_enabled": True,
        "freeze_key": "Shift",
        "dim_enabled": True,
        "include_page": True,
        "include_categories": True,
        "include_hierarchy_ancestors": True,
        "include_hierarchy_descendants": True,
        "include_siblings": False,
        "include_nav": True,
        "include_page_edges": True,
        "include_hierarchy_edges": True,
        "include_sibling_edges": False,
        "preserve_story_chain": True,
        "page_scope": "current_page_if_available",
        "dim_non_hovered_percent": 80,
    },
    "edges": {
        "page_opacity": 1.0,
        "hierarchy_opacity": 1.0,
        "sibling_opacity": 0.35,
        "nav_opacity": 0.6,
        "page_width": 1.1,
        "hierarchy_width": 1.4,
        "sibling_width": 0.8,
        "nav_width": 0.8,
        "highlight_opacity": 1.0,
        "dim_opacity": 0.08,
    },
    "controls": {
        "show_zoom": "auto",
        "show_search": "auto",
        "show_expand": True,
        "enable_node_click": True,
        "enable_edge_click": True,
    },
    "pane": {
        "context_scope": "all_pages",
        "order": [],
        "width": 750,
        "initial_lines": 12,
        "initial_list_items": 20,
        "chunk_lines": 4,
        "intro_expand_to_heading": False,
        "content_tag_full_section": True,
        "reference_full_section": True,
        "show_history_controls": True,
        "show_meta_badges": True,
        "show_context_controls": True,
        "show_concept_graph_preview": True,
        "show_graph_return_button": True,
        "skip_duplicate_headings": True,
        "keyword_context_mode": "parent_list",
        "keyword_own_section": True,
        "edge_context_mode": "compact",
        "edge_gap_mode": "hide",
        "edge_inline_gap_max_lines": 2,
    },
    "ui": {
        "show_labels": True,
        "show_zoom_controls": "auto",
        "show_expand_button": True,
        "enable_search": "auto",
        "enable_edge_click": True,
        "enable_node_click": True,
        "label_mode": "all",
        "keyword_label_zoom_threshold": 1.35,
        "page_edge_opacity": 1.0,
        "hierarchy_edge_opacity": 1.0,
        "sibling_edge_opacity": 0.35,
        "nav_edge_opacity": 1.0,
    },
}

KNOTIS_SITE_GRAPH_DEFAULTS = {
    "graph": {
        "enabled": True,
        "default_view": "all",
        "exclude_tags": [],
        "available_tags": [],
        "exclude_paths": [],
        "exclude_wikilinks": [],
    },
    "scope": {
        "page_filter": "all_pages",
        "seed": "all",
    },
    "controls": {
        "show_zoom": "auto",
        "show_search": "auto",
        "show_expand": False,
        "enable_node_click": True,
        "enable_edge_click": True,
    },
    "nodes": {
        "show_keywords": True,
        "show_pages": True,
        "show_categories": True,
        "show_orphans": False,
        "min_keyword_page_count": 1,
        "min_keyword_occurrence_count": 1,
        "size_metric": "page_count",
        "keyword_radius": 18,
        "page_radius": 30,
        "category_radius": 54,
    },
    "relations": {
        "include": ["hierarchy", "page", "nav"],
        "min_weight": 1,
        "sort_metric": "page_count",
        "page_edges": "root_only",
    },
    "labels": {
        "show": True,
        "mode": "all",
        "font_size": 13,
        "page_font_size": 14,
        "category_font_size": 15,
        "modal_font_size": 15,
        "preview_font_size": 17,
        "wrap_chars": 18,
        "max_lines": 4,
        "outline": True,
        "font_weight": 400,
        "keyword_zoom_threshold": 1.35,
    },
    "edges": {
        "page_opacity": 1.0,
        "hierarchy_opacity": 1.0,
        "sibling_opacity": 0.35,
        "nav_opacity": 0.6,
        "page_width": 1.1,
        "hierarchy_width": 1.4,
        "sibling_width": 0.8,
        "nav_width": 0.8,
        "highlight_opacity": 1.0,
        "dim_opacity": 0.08,
    },
    "layout": {
        "fit_mode": "fit",
        "fit_padding": 18,
        "fit_on_resize": True,
        "initial_zoom": 1.0,
        "preview_zoom": 1.25,
        "center_on_load": True,
    },
    "hover": {
        "enabled": True,
        "mode": "hierarchy_family",
        "hops": 2,
        "freeze_enabled": True,
        "freeze_key": "Shift",
        "dim_enabled": True,
        "include_page": True,
        "include_categories": True,
        "include_hierarchy_ancestors": True,
        "include_hierarchy_descendants": True,
        "include_siblings": False,
        "include_nav": True,
        "include_page_edges": True,
        "include_hierarchy_edges": True,
        "include_sibling_edges": False,
        "preserve_story_chain": True,
        "page_scope": "current_page_if_available",
        "dim_non_hovered_percent": 80,
    },
    "physics": {
        "link_distance": 145,
        "link_distance_min": 90,
        "link_distance_max": 340,
        "charge_strength": -950,
        "charge_range": 1300,
        "collision_padding": 44,
        "center_strength": 0.10,
        "anchor_strength": 0.12,
        "alpha_decay": 0.02,
    },
}

KNOTIS_PAGE_GRAPH_DEFAULTS = {
    "graph": {
        "enabled": True,
        "exclude_paths": [],
        "exclude_wikilinks": [],
    },
    "scope": {
        "page_filter": "current_page_only",
        "seed": "current_page",
    },
    "controls": {
        "show_zoom": False,
        "show_search": False,
        "show_expand": True,
        "enable_node_click": True,
        "enable_edge_click": True,
    },
    "nodes": {
        "show_keywords": True,
        "show_pages": True,
        "show_categories": False,
        "show_orphans": False,
        "min_keyword_page_count": 1,
        "min_keyword_occurrence_count": 1,
        "size_metric": "page_count",
    },
    "relations": {
        "include": ["hierarchy", "page", "nav", "sibling"],
        "min_weight": 1,
        "sort_metric": "weight",
        "page_edges": "root_only",
    },
    "labels": {
        "show": True,
        "mode": "all",
        "font_size": 17,
        "page_font_size": 17,
        "category_font_size": 17,
        "modal_font_size": 17,
        "preview_font_size": 12,
        "wrap_chars": 24,
        "max_lines": 3,
        "outline": True,
        "font_weight": 400,
        "keyword_zoom_threshold": 1.35,
    },
    "edges": {
        "page_opacity": 1.0,
        "hierarchy_opacity": 1.0,
        "sibling_opacity": 0.35,
        "nav_opacity": 0.6,
        "page_width": 1.1,
        "hierarchy_width": 1.4,
        "sibling_width": 0.8,
        "nav_width": 0.8,
        "highlight_opacity": 0.8,
        "dim_opacity": 0.08,
    },
    "layout": {
        "fit_mode": "fit",
        "fit_padding": 48,
        "fit_on_resize": True,
        "initial_zoom": 1.0,
        "center_on_load": True,
    },
    "hover": {
        "enabled": True,
        "mode": "hierarchy_family",
        "hops": 3,
        "freeze_enabled": True,
        "freeze_key": "Shift",
        "dim_enabled": True,
        "include_page": True,
        "include_categories": True,
        "include_hierarchy_ancestors": True,
        "include_hierarchy_descendants": True,
        "include_siblings": False,
        "include_nav": True,
        "include_page_edges": True,
        "include_hierarchy_edges": True,
        "include_sibling_edges": False,
        "preserve_story_chain": True,
        "page_scope": "current_page_if_available",
        "dim_non_hovered_percent": 80,
    },
    "physics": {
        "link_distance": 112,
        "link_distance_min": 86,
        "link_distance_max": 250,
        "charge_strength": -620,
        "charge_range": 620,
        "collision_padding": 42,
        "center_strength": 0.12,
        "anchor_strength": 0.2,
        "radial_strength": 0.48,
        "alpha_decay": 0.02,
    },
    "n_hops": {
        "enabled": False,
        "show_control": False,
    },
}

KNOTIS_CONCEPT_GRAPH_DEFAULTS = {
    "graph": {
        "enabled": True,
        "exclude_paths": [],
        "exclude_wikilinks": [],
    },
    "scope": {
        "page_filter": "all_pages",
        "seed": "all",
        "view": "teaching_path",
        "primary_page": "nav_first",
        "max_pages": 4,
        "max_ancestor_hops": 2,
        "max_descendant_hops": 2,
    },
    "controls": {
        "show_zoom": "auto",
        "show_search": "auto",
        "show_expand": True,
        "enable_node_click": True,
        "enable_edge_click": True,
    },
    "nodes": {
        "show_keywords": True,
        "show_pages": True,
        "show_categories": True,
        "show_orphans": False,
        "min_keyword_page_count": 1,
        "min_keyword_occurrence_count": 1,
        "size_metric": "page_count",
    },
    "relations": {
        "include": ["hierarchy", "page", "nav", "sibling"],
        "min_weight": 1,
        "sort_metric": "weight",
        "page_edges": "root_only",
    },
    "labels": {
        "show": True,
        "mode": "all",
        "font_size": 17,
        "page_font_size": 17,
        "category_font_size": 17,
        "modal_font_size": 17,
        "preview_font_size": 15,
        "wrap_chars": 14,
        "max_lines": 4,
        "outline": True,
        "font_weight": 400,
        "keyword_zoom_threshold": 1.35,
    },
    "edges": {
        "page_opacity": 1.0,
        "hierarchy_opacity": 1.0,
        "sibling_opacity": 0.35,
        "nav_opacity": 0.6,
        "page_width": 1.1,
        "hierarchy_width": 1.4,
        "sibling_width": 0.8,
        "nav_width": 0.8,
        "highlight_opacity": 1.0,
        "dim_opacity": 0.08,
    },
    "layout": {
        "fit_mode": "fit",
        "fit_padding": 18,
        "fit_shrink": 0.85,
        "bounds_label_pad": 28,
        "fit_on_resize": True,
        "initial_zoom": 1.0,
        "center_on_load": True,
    },
    "hover": {
        "enabled": False,
        "mode": "hierarchy_family",
        "hops": 2,
        "freeze_enabled": True,
        "freeze_key": "Shift",
        "dim_enabled": True,
        "include_page": True,
        "include_categories": True,
        "include_hierarchy_ancestors": True,
        "include_hierarchy_descendants": True,
        "include_siblings": True,
        "include_nav": True,
        "include_page_edges": True,
        "include_hierarchy_edges": True,
        "include_sibling_edges": True,
        "preserve_story_chain": True,
        "page_scope": "all_pages",
        "dim_non_hovered_percent": 80,
    },
    "physics": {
        "link_distance": 120,
        "link_distance_min": 70,
        "link_distance_max": 260,
        "charge_strength": -650,
        "charge_range": 900,
        "collision_padding": 36,
        "center_strength": 0.12,
        "anchor_strength": 0.18,
        "radial_strength": 0.44,
        "alpha_decay": 0.02,
    },
}

KNOTIS_DEFAULT_CONFIG = {
    "pane": {
        "path": {
            "enabled": True,
            "include_paths": [],
            "exclude_paths": [],
        },
        "order": [],
        "width": 750,
        "initial_lines": 12,
        "initial_list_items": 20,
        "chunk_lines": 4,
    },
    "glossary": {
        "enabled": True,
        "default_view": "alphabetical",
        "page_view_label": "By page",
        "exclude_paths": [],
        "order": [],
    },
    "content_tags": {
        "enabled": True,
        "nav_chips": True,
        "sync_nav": False,
        "order": [],
        "colors": {},
    },
    "wikilinks": {
        "default": "#0197a7",
        "slate": "#fda4af",
    },
    "search": {
        "enabled": True,
        "exclude_paths": [],
        "exclude_wikilinks": [],
        "order": [],
    },
    "slides": {
        "enabled": False,
        "fit_mode": "fit",
        "fit_min_font_px": 20,
        "fit_max_font_px": 52,
        "content_fill": 0.72,
        "content_inset": [3, 5, 3, 5],
        "include_paths": [],
        "exclude_paths": [],
    },
    "content": {
        "heading_numbering": True,
        "heading_guides": True,
        "nested_numbering_lists": True,
        "generator": True,
        "styled_section_groups": True,
    },
    "readaloud": {
        "enabled": True,
    },
    "defaults": deepcopy(KNOTIS_BASE_VIEW_DEFAULTS),
    "page_graph": deepcopy(KNOTIS_PAGE_GRAPH_DEFAULTS),
    "concept_graph": deepcopy(KNOTIS_CONCEPT_GRAPH_DEFAULTS),
    "site_graph": deepcopy(KNOTIS_SITE_GRAPH_DEFAULTS),
}

VALID_SIZE_METRICS = {"page_count", "occurrence_count", "fixed"}
VALID_RELATIONS = {"hierarchy", "sibling", "page", "nav"}
VALID_SORT_METRICS = {"weight", "page_count", "none"}
VALID_PAGE_EDGE_MODES = {"root_only", "all"}
VALID_PAGE_FILTERS = {"all_pages", "current_page_only", "current_page_if_available"}
VALID_SEEDS = {"all", "current_page"}
VALID_CONCEPT_GRAPH_VIEWS = {"teaching_path", "neighbourhood"}
VALID_CONCEPT_PRIMARY_PAGES = {"nav_first", "current_page_first"}
VALID_HOVER_MODES = {"none", "direct_neighbors", "n_hop_neighbors", "hierarchy_family", "page_branch"}
VALID_CONTEXT_SCOPES = {"current_page_only", "current_page_first", "all_pages"}
VALID_PANE_EDGE_CONTEXT_MODES = {"compact", "parent_list", "section"}
VALID_PANE_KEYWORD_CONTEXT_MODES = VALID_PANE_EDGE_CONTEXT_MODES
VALID_PANE_EDGE_GAP_MODES = {"toggle", "inline", "hide"}
VALID_BOOL_AUTO = {"auto"}
VALID_GLOSSARY_DEFAULT_VIEWS = {"alphabetical", "by_page", "module"}
VALID_LABEL_MODES = {"focus", "all"}
VALID_FIT_MODES = {"fit", "loose", "manual"}
VALID_SLIDE_FIT_MODES = {"fit", "scroll"}

KNOTIS_FOOTER_ATTRIBUTION_HTML = (
    'Made with <a href="https://knotis-docs.ttezcan.com/">Knotis</a>, '
    'a wrapper for <a href="https://zensical.org/">Zensical</a>'
)
