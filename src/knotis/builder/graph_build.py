#!/usr/bin/env python3
from __future__ import annotations
"""
graph_build.py — Build graph.json nodes and edges from parsed occurrences.
\nEdge rules: hierarchy (structural list nesting / headings), siblings
(same-sentence co-mentions), page membership, and nav edges.
"""

import re
from pathlib import Path

from . import knotis_site_io
from .frontmatter import (
    _front_matter_tags,
    _split_front_matter,
)
from .scan_context import (
    page_title_from_path,
)
from .config_normalize import (
    _build_graph_meta,
    _display_graph_tag_label,
    _normalize_graph_tag_key,
)


def build_graph(
    all_occurrences: list[dict],
    md_files: list[Path],
    nav_items: list | None = None,
    graph_view_config: dict | None = None,
    page_graph_occurrences: list[dict] | None = None,
    moc_page_urls: set[str] | None = None,
) -> dict:
    """
    Build graph nodes + edges from occurrence data.

    Edge rules (per-page):
      - list indentation / numbered nesting → hierarchy edge parent_kw → child_kw
      - top-level list items under a single-keyword prose intro → hierarchy edge parent_kw → child_kw
      - nested heading levels (# → ## → ### → ####) → hierarchy edge parent_kw → child_kw
      - same sentence / same paragraph → sibling kw ↔ kw edge
      - same heading path, with no explicit hierarchy parent → sibling kw ↔ kw edge
      - repeated keywords may also keep later page-local list hierarchy links
        without replacing the earlier selected hierarchy parent
      - repeated keywords may also become siblings of later explicit list / heading parents
        without replacing the earlier selected hierarchy parent
      - keywords without a hierarchy parent connect directly to their page
      - when multiple hierarchy parents are inferred on a page, the first valid
        parent on that page wins and later parents do not replace it
    """
    nodes: dict[str, dict] = {}
    edge_data: dict[tuple[str, str], dict[str, object]] = {}

    def relation_priority(relation: str) -> int:
        return {
            "nav": 4,
            "hierarchy": 3,
            "sibling": 2,
            "page": 1,
        }.get(relation, 0)

    def keyword_from_node_id(node_id: str) -> str | None:
        if node_id.startswith("kw:"):
            return node_id[3:]
        return None

    def add_edge(
        source: str,
        target: str,
        page_url: str,
        relation: str,
        evidence_source: str | None = None,
    ) -> None:
        for endpoint in (source, target):
            endpoint_kw = keyword_from_node_id(endpoint)
            if endpoint_kw and not allow_page_graph_keyword(endpoint_kw, page_url):
                return
        key = (source, target)
        edge = edge_data.setdefault(
            key,
            {
                "pages": set(),
                "relation": relation,
                "sources": {"line": 0, "paragraph": 0, "heading": 0, "local_parent": 0},
                "hierarchy_sources": {},
            },
        )
        if relation_priority(relation) > relation_priority(edge["relation"]):
            edge["relation"] = relation
        edge["pages"].add(page_url)
        if relation == "sibling" and evidence_source in edge["sources"]:
            edge["sources"][evidence_source] += 1
        if relation == "hierarchy" and evidence_source:
            page_sources = edge["hierarchy_sources"].setdefault(page_url, {})
            page_sources[evidence_source] = page_sources.get(evidence_source, 0) + 1

    def is_page_ancestor(page_url: str, ancestor_kw: str, descendant_kw: str) -> bool:
        """
        Return True when `ancestor_kw` reaches `descendant_kw` through hierarchy
        edges on the same page. This lets us keep only the most specific parent
        for a keyword when multiple hierarchy parents are inferred from repeated
        mentions across nested sections.
        """
        if ancestor_kw == descendant_kw:
            return False

        children = page_hierarchy_children.get(page_url, {})
        stack = list(children.get(ancestor_kw, ()))
        seen: set[str] = set()

        while stack:
            current = stack.pop()
            if current == descendant_kw:
                return True
            if current in seen:
                continue
            seen.add(current)
            stack.extend(children.get(current, ()))

        return False

    # Pages to exclude: index files and the concept graph page itself
    EXCLUDE_STEMS = {"index"}
    EXCLUDE_URL_SUFFIXES = ("site-graph/", "graph/")
    page_graph_occurrence_source = page_graph_occurrences or all_occurrences
    reference_keywords = {
        occ["keyword"]
        for occ in page_graph_occurrence_source
        if occ.get("mode") == "reference"
    }
    reference_pages_by_keyword: dict[str, set[str]] = {}
    for occ in page_graph_occurrence_source:
        if occ.get("mode") != "reference":
            continue
        reference_pages_by_keyword.setdefault(occ["keyword"], set()).add(occ["page_url"])

    def is_reference_definition_page(keyword: str, page_url: str) -> bool:
        return page_url in reference_pages_by_keyword.get(keyword, set())

    def include_graph_occurrence(occ: dict) -> bool:
        keyword = occ["keyword"]
        if keyword not in reference_keywords:
            return occ.get("mode") != "reference"
        return is_reference_definition_page(keyword, occ["page_url"])

    def allow_page_graph_keyword(keyword: str, page_url: str) -> bool:
        if keyword not in reference_keywords:
            return True
        return is_reference_definition_page(keyword, page_url)

    def counts_for_page_graph_hierarchy(occ: dict) -> bool:
        keyword = occ["keyword"]
        page_url = occ["page_url"]
        if keyword in reference_keywords and is_reference_definition_page(keyword, page_url):
            return occ.get("mode") == "reference"
        return True

    graph_occurrences = [
        occ for occ in all_occurrences if include_graph_occurrence(occ)
    ]
    page_graph_occurrences_filtered = [
        occ for occ in page_graph_occurrence_source if include_graph_occurrence(occ)
    ]
    page_tag_labels: dict[str, str] = {}

    # Add page nodes — skip index pages and the graph page
    for md_path in md_files:
        if md_path.stem in EXCLUDE_STEMS:
            continue
        url = knotis_site_io.page_url_from_path(md_path)
        if any(url.endswith(suffix) for suffix in EXCLUDE_URL_SUFFIXES):
            continue
        meta, _body = _split_front_matter(md_path.read_text(encoding="utf-8"))
        page_tags = _front_matter_tags(meta)
        tag_keys: list[str] = []
        tag_labels: list[str] = []
        for raw_tag in page_tags:
            tag_key = _normalize_graph_tag_key(raw_tag)
            tag_label = _display_graph_tag_label(raw_tag)
            if not tag_key or not tag_label or tag_key in tag_keys:
                continue
            tag_keys.append(tag_key)
            tag_labels.append(tag_label)
            page_tag_labels.setdefault(tag_key, tag_label)
        node_id = f"page:{url}"
        if node_id not in nodes:
            nodes[node_id] = {
                "id": node_id,
                "type": "page",
                "label": page_title_from_path(md_path),
                "url": url,
                "tag_keys": tag_keys,
                "tags": tag_labels,
            }

    # Build the full nav hierarchy: section nodes + parent→child edges at every depth.
    # All nav edges carry "__nav__" so filterToPage never includes them in page graphs.
    section_nodes, nav_edge_list = build_nav_hierarchy(nav_items or [], moc_page_urls=moc_page_urls)
    nodes.update(section_nodes)
    for src, tgt in nav_edge_list:
        if src in nodes and tgt in nodes:
            add_edge(src, tgt, "__nav__", "nav")

    # Pre-compute page_count per keyword for centrality sizing
    kw_page_count: dict[str, int] = {}
    kw_occurrence_count: dict[str, int] = {}
    for occ in graph_occurrences:
        kw_page_count.setdefault(occ["keyword"], set()).add(occ["page_url"])
        kw_occurrence_count[occ["keyword"]] = kw_occurrence_count.get(occ["keyword"], 0) + 1
    kw_page_count = {kw: len(pages) for kw, pages in kw_page_count.items()}

    keyword_page_roots: dict[tuple[str, str], int] = {}
    for occ in graph_occurrences:
        page_kw = (occ["page_url"], occ["keyword"])
        if occ.get("is_structural_list_keyword") and not occ.get("list_parent_kw"):
            line_idx = int(occ.get("line_idx") or 0)
            prev = keyword_page_roots.get(page_kw)
            if prev is None or line_idx < prev:
                keyword_page_roots[page_kw] = line_idx

    selected_parent_candidates: dict[tuple[str, str], str | None] = {}
    selected_parent_sources: dict[tuple[str, str], str | None] = {}

    # Concepts that define their own top-level section heading (e.g. `### [[X]]`
    # with no keyword-bearing heading ancestor) are page roots. A prose mention of
    # such a concept inside another section must not demote it to a hierarchy child
    # — only a genuine structural list nesting can. Without this, `### [[Wikilink]]`
    # loses its page-root status (and its page edge) merely because another
    # section's prose reads "…such as [[wikilink]]", and mutual prose mentions
    # produce A↔B hierarchy cycles that also break the edge pane.
    section_root_keywords_by_page: dict[str, set[str]] = {}
    for occ in graph_occurrences:
        if occ.get("is_heading_line") and not occ.get("hierarchy_parent_kw"):
            section_root_keywords_by_page.setdefault(occ["page_url"], set()).add(occ["keyword"])

    def valid_hierarchy_parent(parent_kw: str | None, kw: str, page_url: str) -> bool:
        return bool(
            parent_kw
            and parent_kw != kw
            and allow_page_graph_keyword(parent_kw, page_url)
        )

    def selected_parent_would_cycle(page_url: str, kw: str, parent_kw: str) -> bool:
        current = parent_kw
        seen: set[str] = set()
        while current and current not in seen:
            if current == kw:
                return True
            seen.add(current)
            current = selected_parent_candidates.get((page_url, current))
        return False

    reference_page_graph_parents: dict[tuple[str, str], set[str]] = {}
    for occ in page_graph_occurrences_filtered:
        if not counts_for_page_graph_hierarchy(occ):
            continue
        if occ.get("mode") != "reference":
            continue
        kw = occ["keyword"]
        page_url = occ["page_url"]
        if not is_reference_definition_page(kw, page_url):
            continue
        parent_kw = occ.get("hierarchy_parent_kw")
        if valid_hierarchy_parent(parent_kw, kw, page_url):
            reference_page_graph_parents.setdefault((page_url, kw), set()).add(parent_kw)

    for occ in graph_occurrences:
        kw = occ["keyword"]
        page_url = occ["page_url"]
        page_kw = (page_url, kw)
        if page_kw in selected_parent_candidates:
            continue
        if not counts_for_page_graph_hierarchy(occ):
            continue
        # A section-defining concept only accepts a structural list parent; skip
        # prose/paragraph mentions so a passing reference in another section can't
        # bury a page-root concept (the first structural parent, if any, wins).
        if (
            kw in section_root_keywords_by_page.get(page_url, ())
            and not occ.get("is_structural_list_keyword")
        ):
            continue

        parent_kw = occ.get("hierarchy_parent_kw")
        if (
            not parent_kw
            or parent_kw == kw
            or not allow_page_graph_keyword(parent_kw, page_url)
            or selected_parent_would_cycle(page_url, kw, parent_kw)
        ):
            continue
        root_intro_line = keyword_page_roots.get(page_kw)
        if (
            occ.get("hierarchy_parent_source") == "list"
            and root_intro_line is not None
            and occ.get("list_parent_kw")
            and int(occ.get("line_idx") or 0) > root_intro_line
        ):
            continue

        effective_parent_kw = parent_kw
        effective_parent_source = occ.get("hierarchy_parent_source")
        linked_list_ancestor_chain = occ.get("linked_list_ancestor_chain") or []
        if (
            occ.get("list_parent_kw") == parent_kw
            and linked_list_ancestor_chain
            and linked_list_ancestor_chain[-1] == parent_kw
            and len(linked_list_ancestor_chain) >= 2
        ):
            higher_local_parent_kw = linked_list_ancestor_chain[-2]
            earlier_parent_for_immediate_kw = selected_parent_candidates.get((page_url, parent_kw))
            if (
                higher_local_parent_kw
                and higher_local_parent_kw != kw
                and higher_local_parent_kw != parent_kw
                and earlier_parent_for_immediate_kw
                and earlier_parent_for_immediate_kw != higher_local_parent_kw
            ):
                effective_parent_kw = higher_local_parent_kw
                effective_parent_source = "list"

        selected_parent_candidates[page_kw] = effective_parent_kw
        selected_parent_sources[page_kw] = effective_parent_source

    hierarchy_pairs: set[tuple[str, str]] = set()
    hierarchy_pairs_by_page: set[tuple[str, str, str]] = set()
    page_graph_hierarchy_edges: dict[tuple[str, str, str], dict[str, str]] = {}
    page_graph_page_edges: dict[tuple[str, str], dict[str, str]] = {}
    page_graph_keywords_by_page: dict[str, set[str]] = {}
    sibling_groups: dict[tuple[str, str, str], set[str]] = {}
    list_sibling_groups: dict[tuple[str, tuple], set[str]] = {}
    heading_sibling_groups: dict[tuple[str, tuple[str, ...]], set[str]] = {}
    local_parent_sibling_pairs: set[tuple[str, str, str]] = set()
    seen_page_keywords: set[tuple[str, str]] = set()

    for occ in graph_occurrences:
        kw = occ["keyword"]
        page_url = occ["page_url"]
        page_kw = (page_url, kw)
        page_node_id = f"page:{page_url}"
        kw_node_id = f"kw:{kw}"

        if not allow_page_graph_keyword(kw, page_url):
            continue

        # Add keyword node with page_count for centrality sizing
        if kw_node_id not in nodes:
            nodes[kw_node_id] = {
                "id": kw_node_id,
                "type": "keyword",
                "label": kw,
                "page_count": kw_page_count.get(kw, 1),
                "occurrence_count": kw_occurrence_count.get(kw, 1),
            }

        selected_parent_kw = selected_parent_candidates.get((page_url, kw))
        selected_parent_source = selected_parent_sources.get((page_url, kw))
        local_structural_parent_kw = occ.get("list_parent_kw") or occ.get("heading_parent_kw")
        is_ref_definition_occ = (
            occ.get("mode") == "reference"
            and is_reference_definition_page(kw, page_url)
            and counts_for_page_graph_hierarchy(occ)
        )
        ref_parent_kw = (
            occ.get("hierarchy_parent_kw")
            if is_ref_definition_occ
            and valid_hierarchy_parent(occ.get("hierarchy_parent_kw"), kw, page_url)
            else None
        )
        effective_hierarchy_parent_kw = (
            ref_parent_kw
            if ref_parent_kw and f"kw:{ref_parent_kw}" in nodes
            else (
                selected_parent_kw
                if (
                    selected_parent_kw
                    and selected_parent_kw != kw
                    and f"kw:{selected_parent_kw}" in nodes
                )
                else None
            )
        )
        effective_hierarchy_source = (
            occ.get("hierarchy_parent_source") or "reference"
            if ref_parent_kw
            else selected_parent_source
        )

        if (
            page_kw not in seen_page_keywords
            and page_node_id in nodes
            and not effective_hierarchy_parent_kw
            and not reference_page_graph_parents.get((page_url, kw))
        ):
            add_edge(page_node_id, kw_node_id, page_url, "page")

        if effective_hierarchy_parent_kw:
            edge_src = f"kw:{effective_hierarchy_parent_kw}"
            hierarchy_pairs.add((edge_src, kw_node_id))
            hierarchy_pairs_by_page.add((page_url, edge_src, kw_node_id))
            add_edge(
                edge_src,
                kw_node_id,
                page_url,
                "hierarchy",
                evidence_source=effective_hierarchy_source,
            )

        if (
            page_kw in seen_page_keywords
            and occ.get("mode") != "reference"
            and selected_parent_kw
            and local_structural_parent_kw
            and local_structural_parent_kw != kw
            and local_structural_parent_kw != selected_parent_kw
            and allow_page_graph_keyword(local_structural_parent_kw, page_url)
        ):
            local_parent_sibling_pairs.add((page_url, local_structural_parent_kw, kw))

        paragraph_group = occ.get("paragraph_group")
        if paragraph_group:
            group_kind = "line" if str(paragraph_group).startswith("line:") else "paragraph"
            sibling_groups.setdefault((page_url, group_kind, paragraph_group), set()).add(kw)

        list_sibling_key = occ.get("list_sibling_key")
        if list_sibling_key is not None and occ.get("mode") != "reference":
            list_sibling_groups.setdefault((page_url, list_sibling_key), set()).add(kw)

        heading_path = tuple(occ.get("heading_path") or [])
        if heading_path and not effective_hierarchy_parent_kw and not selected_parent_kw:
            heading_sibling_groups.setdefault((page_url, heading_path), set()).add(kw)

        seen_page_keywords.add(page_kw)

    for occ in page_graph_occurrences_filtered:
        kw = occ["keyword"]
        page_url = occ["page_url"]
        if not allow_page_graph_keyword(kw, page_url):
            continue

        page_node_id = f"page:{page_url}"
        kw_node_id = f"kw:{kw}"
        if page_node_id in nodes and kw_node_id in nodes:
            page_graph_keywords_by_page.setdefault(page_url, set()).add(kw_node_id)

        selected_parent_kw = selected_parent_candidates.get((page_url, kw))
        ref_parents = reference_page_graph_parents.get((page_url, kw), set())
        has_ref_page_graph_parent = any(
            f"kw:{parent_kw}" in nodes
            for parent_kw in ref_parents
        )
        has_allowed_page_graph_parent = has_ref_page_graph_parent or (
            selected_parent_kw
            and selected_parent_kw != kw
            and allow_page_graph_keyword(selected_parent_kw, page_url)
            and f"kw:{selected_parent_kw}" in nodes
        )
        if (
            page_node_id in nodes
            and kw_node_id in nodes
            and not has_allowed_page_graph_parent
        ):
            page_graph_page_edges.setdefault(
                (page_url, kw_node_id),
                {
                    "page": page_url,
                    "source": page_node_id,
                    "target": kw_node_id,
                },
            )

    def page_hierarchy_descendants(
        page_url: str,
        keyword_id: str,
        edges: dict[tuple[str, str, str], dict[str, str]],
    ) -> set[str]:
        descendants: set[str] = set()
        frontier = [keyword_id]
        seen = {keyword_id}
        while frontier:
            current = frontier.pop()
            for (edge_page, source, target), _edge in edges.items():
                if edge_page != page_url or source != current:
                    continue
                if target in seen:
                    continue
                seen.add(target)
                descendants.add(target)
                frontier.append(target)
        return descendants

    for (page_url, kw), parent_kw in selected_parent_candidates.items():
        if is_reference_definition_page(kw, page_url):
            continue
        if not allow_page_graph_keyword(parent_kw, page_url):
            continue
        parent_source = selected_parent_sources.get((page_url, kw))
        if parent_source is None:
            continue
        if parent_source == "reference" and not is_reference_definition_page(kw, page_url):
            continue
        kw_node_id = f"kw:{kw}"
        if kw_node_id not in nodes:
            continue
        page_graph_hierarchy_edges.setdefault(
            (page_url, f"kw:{parent_kw}", kw_node_id),
            {
                "page": page_url,
                "source": f"kw:{parent_kw}",
                "target": kw_node_id,
                "source_kind": parent_source or "list",
            },
        )

    for occ in page_graph_occurrences_filtered:
        if not counts_for_page_graph_hierarchy(occ):
            continue
        if occ.get("mode") != "reference":
            continue
        kw = occ["keyword"]
        page_url = occ["page_url"]
        if not is_reference_definition_page(kw, page_url):
            continue
        parent_kw = occ.get("hierarchy_parent_kw")
        if not valid_hierarchy_parent(parent_kw, kw, page_url):
            continue
        kw_node_id = f"kw:{kw}"
        if kw_node_id not in nodes or f"kw:{parent_kw}" not in nodes:
            continue
        page_graph_hierarchy_edges.setdefault(
            (page_url, f"kw:{parent_kw}", kw_node_id),
            {
                "page": page_url,
                "source": f"kw:{parent_kw}",
                "target": kw_node_id,
                "source_kind": occ.get("hierarchy_parent_source") or "reference",
            },
        )

    for occ in page_graph_occurrences_filtered:
        kw = occ["keyword"]
        page_url = occ["page_url"]
        if not counts_for_page_graph_hierarchy(occ):
            continue
        # Mirror the section-root rule above: a prose mention must not make a
        # section-defining concept a hierarchy child in the page-graph edges
        # either (only a genuine structural list nesting can).
        if (
            kw in section_root_keywords_by_page.get(page_url, ())
            and not occ.get("is_structural_list_keyword")
        ):
            continue
        local_page_graph_parent_kw = occ.get("hierarchy_parent_kw")
        local_page_graph_source = occ.get("hierarchy_parent_source")
        if local_page_graph_source != "list":
            continue
        root_intro_line = keyword_page_roots.get((page_url, kw))
        if (
            root_intro_line is not None
            and occ.get("list_parent_kw")
            and int(occ.get("line_idx") or 0) > root_intro_line
        ):
            continue
        if (
            not local_page_graph_parent_kw
            or local_page_graph_parent_kw == kw
            or not allow_page_graph_keyword(local_page_graph_parent_kw, page_url)
        ):
            continue
        source_id = f"kw:{local_page_graph_parent_kw}"
        target_id = f"kw:{kw}"
        edge_key = (page_url, source_id, target_id)
        if edge_key in page_graph_hierarchy_edges:
            continue
        if source_id in page_hierarchy_descendants(page_url, target_id, page_graph_hierarchy_edges):
            continue
        page_graph_hierarchy_edges.setdefault(
            edge_key,
            {
                "page": page_url,
                "source": source_id,
                "target": target_id,
                "source_kind": local_page_graph_source,
            },
        )

    page_graph_parents_by_page: dict[str, set[str]] = {}
    page_graph_children_by_page: dict[str, set[str]] = {}
    for edge in page_graph_hierarchy_edges.values():
        page_url = edge["page"]
        page_graph_parents_by_page.setdefault(page_url, set()).add(edge["source"])
        page_graph_children_by_page.setdefault(page_url, set()).add(edge["target"])

    for page_url, keyword_ids in page_graph_keywords_by_page.items():
        page_node_id = f"page:{page_url}"
        existing_root_targets = {
            edge["target"]
            for edge in page_graph_page_edges.values()
            if edge["page"] == page_url
        }
        hierarchy_roots = (
            page_graph_parents_by_page.get(page_url, set())
            - page_graph_children_by_page.get(page_url, set())
        )
        if not hierarchy_roots:
            hierarchy_roots = page_graph_parents_by_page.get(page_url, set())

        for root_id in sorted(hierarchy_roots):
            if root_id not in nodes:
                continue
            if keyword_ids and root_id not in keyword_ids:
                continue
            if root_id not in existing_root_targets:
                page_graph_page_edges.setdefault(
                    (page_url, root_id),
                    {
                        "page": page_url,
                        "source": page_node_id,
                        "target": root_id,
                    },
                )
            add_edge(page_node_id, root_id, page_url, "page")

    def add_sibling_edge(
        src_id: str,
        tgt_id: str,
        page_url: str,
        evidence_source: str,
    ) -> None:
        if (
            (page_url, src_id, tgt_id) in hierarchy_pairs_by_page
            or (page_url, tgt_id, src_id) in hierarchy_pairs_by_page
        ):
            return
        if (src_id, tgt_id) in hierarchy_pairs:
            if (tgt_id, src_id) in hierarchy_pairs:
                return
            src_id, tgt_id = tgt_id, src_id
        add_edge(src_id, tgt_id, page_url, "sibling", evidence_source=evidence_source)

    # ── Sibling edges: same line or same paragraph ────────────────────────────
    for (page_url, group_kind, _group), keywords in sibling_groups.items():
        if len(keywords) < 2:
            continue
        kw_list = sorted(keywords)
        for i in range(len(kw_list)):
            for j in range(i + 1, len(kw_list)):
                src_id = f"kw:{kw_list[i]}"
                tgt_id = f"kw:{kw_list[j]}"
                add_sibling_edge(src_id, tgt_id, page_url, group_kind)

    # ── Sibling edges: same list parent and indentation level ──────────────────
    for (page_url, _list_key), keywords in list_sibling_groups.items():
        if len(keywords) < 2:
            continue
        kw_list = sorted(keywords)
        for i in range(len(kw_list)):
            for j in range(i + 1, len(kw_list)):
                src_id = f"kw:{kw_list[i]}"
                tgt_id = f"kw:{kw_list[j]}"
                add_sibling_edge(src_id, tgt_id, page_url, "local_parent")

    # ── Sibling edges: same heading path without explicit hierarchy ────────────
    for (page_url, _heading_path), keywords in heading_sibling_groups.items():
        if len(keywords) < 2:
            continue
        kw_list = sorted(keywords)
        for i in range(len(kw_list)):
            for j in range(i + 1, len(kw_list)):
                src_id = f"kw:{kw_list[i]}"
                tgt_id = f"kw:{kw_list[j]}"
                add_sibling_edge(src_id, tgt_id, page_url, "heading")

    # ── Sibling edges: later explicit local parent without replacing first hierarchy ──
    for page_url, parent_kw, kw in sorted(local_parent_sibling_pairs):
        src_id = f"kw:{parent_kw}"
        tgt_id = f"kw:{kw}"
        add_sibling_edge(src_id, tgt_id, page_url, "local_parent")

    meta = _build_graph_meta(graph_view_config, md_files)
    site_graph_meta = meta.setdefault("knotis", {}).setdefault("site_graph", {})
    graph_meta = site_graph_meta.setdefault("graph", {})
    available_tags = [
        {"key": key, "label": label}
        for key, label in sorted(page_tag_labels.items(), key=lambda item: item[1].lower())
    ]
    graph_meta["available_tags"] = available_tags
    if not graph_meta.get("exclude_tags"):
        graph_meta["exclude_tags"] = available_tags

    return {
        "nodes": list(nodes.values()),
        "edges": [
            {
                "source": s,
                "target": t,
                "pages": sorted(edge["pages"]),
                "relation": edge["relation"],
                "page_count": len(edge["pages"]),
                "weight": (
                    3 * edge["sources"]["line"]
                    + 2 * edge["sources"]["paragraph"]
                    + edge["sources"]["heading"]
                    + 2 * edge["sources"]["local_parent"]
                    if edge["relation"] == "sibling"
                    else len(edge["pages"])
                ),
                "sources": edge["sources"],
                "hierarchy_sources": edge["hierarchy_sources"],
            }
            for (s, t), edge in edge_data.items()
            if s in nodes and t in nodes
        ],
        "page_hierarchy_edges": [
            edge
            for edge in page_graph_hierarchy_edges.values()
            if edge["source"] in nodes and edge["target"] in nodes
        ],
        "page_graph_page_edges": [
            edge
            for edge in page_graph_page_edges.values()
            if edge["source"] in nodes and edge["target"] in nodes
        ],
        "meta": meta,
    }


# ── Nav hierarchy ─────────────────────────────────────────────────────────────



def build_nav_hierarchy(
    nav_items: list,
    *,
    moc_page_urls: set[str] | None = None,
) -> tuple[dict[str, dict], list[tuple[str, str]]]:
    """
    Walk the parsed nav list from zensical.toml and return:
      section_nodes  — {cat_id: node_dict}  for every named nav section at any depth
      nav_edges      — [(src_id, tgt_id), ...] linking parent-section → child-section
                       and section → page (all carry "__nav__" pages sentinel so they
                       are never included in page-scoped graph filtering)

    Nav list shape:
      - bare string "path.md"         → index / standalone page
      - {"Label": "path.md"}          → leaf page entry
      - {"Label": ["path.md", ...]}   → section with children
    """
    section_nodes: dict[str, dict] = {}
    nav_edges: list[tuple[str, str]] = []
    moc_urls = moc_page_urls or set()

    def leaf_url(item) -> str | None:
        if isinstance(item, str):
            return knotis_site_io.nav_path_to_url(item)
        if isinstance(item, dict):
            for _label, value in item.items():
                if isinstance(value, str):
                    return knotis_site_io.nav_path_to_url(value)
        return None

    def process(items: list, parent_id: str | None) -> None:
        for item in items:
            if isinstance(item, str):
                # Bare index paths normally add no graph edge. MOC groups use
                # bare child paths under a clickable page parent.
                url = knotis_site_io.nav_path_to_url(item)
                if url and parent_id and parent_id.startswith("page:"):
                    nav_edges.append((parent_id, f"page:{url}"))
            elif isinstance(item, dict):
                for label, value in item.items():
                    if isinstance(value, str):
                        # Leaf page: {"Label": "path.md"}
                        url = knotis_site_io.nav_path_to_url(value)
                        if url and parent_id:
                            nav_edges.append((parent_id, f"page:{url}"))
                    elif isinstance(value, list):
                        # Section: {"Label": [...]}
                        first_url = leaf_url(value[0]) if value else None
                        if first_url in moc_urls:
                            moc_id = f"page:{first_url}"
                            if parent_id is not None:
                                nav_edges.append((parent_id, moc_id))
                            process(value[1:], moc_id)
                        else:
                            cat_id = f"cat:{label}"
                            if cat_id not in section_nodes:
                                section_nodes[cat_id] = {
                                    "id": cat_id,
                                    "type": "category",
                                    "label": label,
                                }
                            if parent_id is not None:
                                nav_edges.append((parent_id, cat_id))
                            process(value, cat_id)

    process(nav_items, None)
    return section_nodes, nav_edges


# ── Nav order ─────────────────────────────────────────────────────────────────


def build_nav_order(nav_items: list | None = None) -> dict[str, int]:
    """
    Walk the parsed nav list from zensical.toml and return {page_url: display_order_index}.
    Pages appear in the order they are listed in the nav, matching the sidebar order.
    """
    nav_order: dict[str, int] = {}
    counter = [0]

    def walk(items: list) -> None:
        for item in items:
            if isinstance(item, str):
                url = knotis_site_io.nav_path_to_url(item)
                if url:
                    nav_order[url] = counter[0]
                    counter[0] += 1
            elif isinstance(item, dict):
                for value in item.values():
                    if isinstance(value, str):
                        url = knotis_site_io.nav_path_to_url(value)
                        if url:
                            nav_order[url] = counter[0]
                            counter[0] += 1
                    elif isinstance(value, list):
                        walk(value)

    walk(nav_items or [])
    return nav_order
