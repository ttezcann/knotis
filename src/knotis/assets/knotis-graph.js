(function () {
  "use strict";

  if (!window.KnotisCore) {
    console.error("[knotis] knotis-core.js must load before knotis-graph.js");
    return;
  }
  const { isPlainObject, deepClone, deepMerge, fetchJsonNoStore } = window.KnotisCore;
  const escapeGraphHtml = window.KnotisCore.escapeHtml;

  const GRAPH_JSON_URL = new URL("graph.json", document.currentScript?.src || location.href).href;
  
  
  const D3_CDN = new URL("d3.min.js", document.currentScript?.src || location.href).href;

  
  const R_PAGE_MIN = 22;
  const R_KW_MIN   = 13;
  const DEFAULT_HOVER_DIM_PERCENT = 80;
  const BASE_VIEW_DEFAULTS = {
    graph: {
      enabled: true,
    },
    nodes: {
      show_keywords: true,
      show_pages: true,
      show_categories: true,
      show_orphans: false,
      min_keyword_page_count: 1,
      min_keyword_occurrence_count: 1,
      size_metric: "page_count",
      keyword_radius: 18,
      page_radius: 30,
      category_radius: 54,
    },
    relations: {
      include: ["hierarchy", "page", "nav"],
      min_weight: 1,
      top_edges_per_node: null,
      sort_metric: "page_count",
      page_edges: "root_only",
    },
    scope: {
      page_filter: "all_pages",
      seed: "all",
      max_hops: null,
      view: "teaching_path",
      primary_page: "nav_first",
      max_pages: 4,
      max_ancestor_hops: 2,
      max_descendant_hops: 2,
    },
    layout: {
      fit_mode: "fit",
      fit_padding: 18,
      fit_on_resize: true,
      initial_zoom: 1,
      preview_zoom: 1.25,
      center_on_load: true,
    },
    physics: {
      link_distance: 145,
      link_distance_min: 90,
      link_distance_max: 340,
      charge_strength: -950,
      charge_range: 1300,
      collision_padding: 44,
      center_strength: 0.10,
      anchor_strength: 0.12,
      alpha_decay: 0.02,
    },
    labels: {
      show: true,
      mode: "all",
      font_size: 13,
      page_font_size: 14,
      category_font_size: 15,
      modal_font_size: 15,
      preview_font_size: 17,
      wrap_chars: 18,
      max_lines: 4,
      outline: true,
      font_weight: 400,
      keyword_zoom_threshold: 1.35,
    },
    hover: {
      enabled: true,
      mode: "hierarchy_family",
      hops: 2,
      freeze_enabled: true,
      freeze_key: "Shift",
      dim_enabled: true,
      include_page: true,
      include_categories: true,
      include_hierarchy_ancestors: true,
      include_hierarchy_descendants: true,
      include_siblings: false,
      include_nav: true,
      include_page_edges: true,
      include_hierarchy_edges: true,
      include_sibling_edges: false,
      preserve_story_chain: true,
      page_scope: "current_page_if_available",
      dim_non_hovered_percent: DEFAULT_HOVER_DIM_PERCENT,
    },
    edges: {
      page_opacity: 1,
      hierarchy_opacity: 1,
      sibling_opacity: 0.35,
      nav_opacity: 0.6,
      page_width: 1.1,
      hierarchy_width: 1.4,
      sibling_width: 0.8,
      nav_width: 0.8,
      highlight_opacity: 1,
      dim_opacity: 0.08,
    },
    controls: {
      show_zoom: "auto",
      show_search: "auto",
      show_expand: false,
      enable_node_click: true,
      enable_edge_click: true,
    },
    pane: {
      context_scope: "current_page_first",
      order: [],
      width: 560,
    },
    ui: {
      show_labels: true,
      show_zoom_controls: "auto",
      show_expand_button: true,
      enable_search: "auto",
      enable_edge_click: true,
      enable_node_click: true,
      label_mode: "all",
      keyword_label_zoom_threshold: 1.35,
      page_edge_opacity: 1,
      hierarchy_edge_opacity: 1,
      sibling_edge_opacity: 0.35,
      nav_edge_opacity: 1,
    },
  };


  const FALLBACK_GRAPH_META = {
    defaults: deepClone(BASE_VIEW_DEFAULTS),
    page_graph: {},
    concept_graph: {},
    site_graph: {},
  };

  

  function getCurrentPageUrl(graph = null) {
    const pathname = location.pathname.replace(/\/index\.html$/, "/");
    const pageNodes = graph?.nodes?.filter((node) => node.type === "page" && node.url) || [];
    let best = null;
    for (const node of pageNodes) {
      const url = node.url;
      if (pathname.endsWith("/" + url) || pathname === "/" + url) {
        if (!best || url.length > best.length) best = url;
      }
    }
    if (best) return best;
    const rootPath = getSiteRootPath().replace(/\/$/, "");
    const stripped = pathname.replace(/^\//, "");
    if (rootPath && stripped.startsWith(rootPath.replace(/^\//, "") + "/")) {
      return stripped.slice(rootPath.replace(/^\//, "").length + 1);
    }
    return stripped;
  }

  function getSiteRootPath() {
    const assetPath = new URL(GRAPH_JSON_URL, location.href).pathname;
    return assetPath.replace(/assets\/(?:knotis\/)?graph\.json$/, "");
  }

  function isHomePage() {
    const pathname = location.pathname.replace(/\/index\.html$/, "/");
    const rootPath = getSiteRootPath();
    return pathname === rootPath || pathname === rootPath.replace(/\/$/, "");
  }

  function getSiteGraphPageUrl(graph = null) {
    const raw = graph?.meta?.knotis?.site_graph?.page_url;
    const pageUrl = typeof raw === "string" ? raw.trim().replace(/^\/+/, "") : "";
    return pageUrl || "graph/";
  }

  function getSiteGraphHref(graph = null) {
    return `${getSiteRootPath()}${getSiteGraphPageUrl(graph)}`;
  }

  function buildConceptSiteGraphHref(focalKeyword, graph = null) {
    const focal = String(focalKeyword || "").trim();
    if (!focal) return getSiteGraphHref(graph);
    return `${getSiteGraphHref(graph)}?kw=${encodeURIComponent(focal)}`;
  }

  
  
  
  function buildPageSiteGraphHref(pageUrl, graph = null) {
    const page = String(pageUrl || "").trim();
    if (!page) return getSiteGraphHref(graph);
    return `${getSiteGraphHref(graph)}?page=${encodeURIComponent(page)}`;
  }

  function renderGraphKeyChordHtml(content) {
    return window.KnotisCore.renderKeyChordHtml(content) || escapeGraphHtml(content);
  }

  function freezeKeyToChord(freezeKey) {
    return String(freezeKey || "Shift")
      .trim()
      .split(/[\s+]+/)
      .filter(Boolean)
      .join("+");
  }

  function buildGraphFreezeHintHtml(hoverConfig) {
    if (hoverConfig?.freeze_enabled === false) return "";
    const chord = freezeKeyToChord(hoverConfig?.freeze_key || "Shift");
    return `Hold ${renderGraphKeyChordHtml(chord)} to highlight connections.`;
  }

  function removeGraphFreezeHint(container) {
    if (container?.nextElementSibling?.classList?.contains("graph-freeze-hint")) {
      container.nextElementSibling.remove();
    }
  }

  function attachGraphFreezeHint(container, graphConfig, className = "graph-freeze-hint") {
    if (!container || graphConfig?.hover?.freeze_enabled === false) return null;
    removeGraphFreezeHint(container);
    const hint = document.createElement("div");
    hint.className = className;
    hint.dataset.graphFor = container.id || "";
    hint.innerHTML = buildGraphFreezeHintHtml(graphConfig.hover);
    container.insertAdjacentElement("afterend", hint);
    return hint;
  }

  function graphIconSvg(name) {
    const attrs = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
    if (name === "bubbles") {
      return `<svg class="page-graph-label__svg page-graph-label__svg--bubbles" ${attrs}><circle cx="7.5" cy="14.5" r="3.5"></circle><circle cx="15" cy="8" r="4"></circle><circle cx="17.5" cy="17.5" r="2.5"></circle></svg>`;
    }
    if (name === "circle-nodes") {
      return `<svg class="page-graph-label__svg page-graph-label__svg--circle-nodes" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" focusable="false"><path d="M418.4 157.9c35.3-8.3 61.6-40 61.6-77.9c0-44.2-35.8-80-80-80c-43.4 0-78.7 34.5-80 77.5L136.2 151.1C121.7 136.8 101.9 128 80 128c-44.2 0-80 35.8-80 80s35.8 80 80 80c12.2 0 23.8-2.7 34.1-7.6L259.7 407.8c-2.4 7.6-3.7 15.8-3.7 24.2c0 44.2 35.8 80 80 80s80-35.8 80-80c0-27.7-14-52.1-35.4-66.4l37.8-207.7zM156.3 232.2c2.2-6.9 3.5-14.2 3.7-21.7l183.8-73.5c3.6 3.5 7.4 6.7 11.6 9.5L317.6 354.1c-5.5 1.3-10.8 3.1-15.8 5.5L156.3 232.2z"/></svg>`;
    }
    if (name === "up-right-from-square") {
      return `<svg class="page-graph-label__svg page-graph-label__svg--external" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" focusable="false"><path d="M352 0c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9L370.7 96 201.4 265.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L416 141.3l41.4 41.4c9.2 9.2 22.9 11.9 34.9 6.9s19.8-16.6 19.8-29.6V32c0-17.7-14.3-32-32-32H352zM80 32C35.8 32 0 67.8 0 112V432c0 44.2 35.8 80 80 80h320c44.2 0 80-35.8 80-80V320c0-17.7-14.3-32-32-32s-32 14.3-32 32v112c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16h112c17.7 0 32-14.3 32-32s-14.3-32-32-32H80z"/></svg>`;
    }
    if (name === "graph") {
      return `<svg class="page-graph-label__svg page-graph-label__svg--graph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M19.5 17C19.37 17 19.24 17 19.11 17.04L17.5 13.79C17.95 13.34 18.25 12.71 18.25 12C18.25 10.62 17.13 9.5 15.75 9.5C15.62 9.5 15.5 9.5 15.36 9.54L13.73 6.29C14.21 5.84 14.5 5.21 14.5 4.5C14.5 3.12 13.38 2 12 2S9.5 3.12 9.5 4.5C9.5 5.21 9.79 5.84 10.26 6.29L8.64 9.54C8.5 9.5 8.38 9.5 8.25 9.5C6.87 9.5 5.75 10.62 5.75 12C5.75 12.71 6.05 13.34 6.5 13.79L4.89 17.04C4.76 17 4.63 17 4.5 17C3.12 17 2 18.12 2 19.5C2 20.88 3.12 22 4.5 22S7 20.88 7 19.5C7 18.8 6.71 18.16 6.24 17.71L7.86 14.46C8 14.5 8.12 14.5 8.25 14.5C8.38 14.5 8.5 14.5 8.64 14.46L10.27 17.71C9.8 18.16 9.5 18.8 9.5 19.5C9.5 20.88 10.62 22 12 22S14.5 20.88 14.5 19.5C14.5 18.12 13.38 17 12 17C11.87 17 11.74 17 11.61 17.04L10 13.79C10.46 13.34 10.75 12.71 10.75 12S10.46 10.66 10 10.21L11.61 6.96C11.74 7 11.87 7 12 7S12.26 7 12.39 6.96L14 10.21C13.55 10.66 13.25 11.3 13.25 12C13.25 13.38 14.37 14.5 15.75 14.5C15.88 14.5 16 14.5 16.14 14.46L17.77 17.71C17.3 18.16 17 18.8 17 19.5C17 20.88 18.12 22 19.5 22S22 20.88 22 19.5C22 18.12 20.88 17 19.5 17Z"/></svg>`;
    }
    if (name === "external-arrow") {
      
      
      return `<svg class="page-graph-label__svg page-graph-label__svg--external-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 17 17 7M9 7h8v8"/></svg>`;
    }
    return `<svg class="page-graph-label__svg page-graph-label__svg--network" ${attrs}><rect x="9" y="2" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="16" y="16" width="6" height="6" rx="1"></rect><path d="M12 8v4"></path><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path></svg>`;
  }

  
  
  
  
  function findPageUrl(graph) {
    const pathname = location.pathname.replace(/\/index\.html$/, "/");
    const pageNodes = graph.nodes.filter((n) => n.type === "page");
    
    let best = null;
    for (const n of pageNodes) {
      if (pathname.endsWith("/" + n.url) || pathname === "/" + n.url) {
        if (!best || n.url.length > best.length) best = n.url;
      }
    }
    return best || getCurrentPageUrl();
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.d3) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(s);
    });
  }

  function resolveAutoUi(config, mode) {
    const resolved = deepClone(config || {});
    resolved.ui = { ...(BASE_VIEW_DEFAULTS.ui), ...(resolved.ui || {}) };
    resolved.labels = { ...(BASE_VIEW_DEFAULTS.labels), ...(resolved.labels || {}) };
    resolved.controls = { ...(BASE_VIEW_DEFAULTS.controls), ...(resolved.controls || {}) };
    resolved.edges = { ...(BASE_VIEW_DEFAULTS.edges), ...(resolved.edges || {}) };
    resolved.hover = { ...(BASE_VIEW_DEFAULTS.hover), ...(resolved.hover || {}) };
    resolved.layout = { ...(BASE_VIEW_DEFAULTS.layout), ...(resolved.layout || {}) };
    resolved.physics = { ...(BASE_VIEW_DEFAULTS.physics), ...(resolved.physics || {}) };
    resolved.ui.show_labels = boolOr(resolved.labels.show, resolved.ui.show_labels);
    resolved.ui.label_mode = resolved.labels.mode || resolved.ui.label_mode;
    resolved.ui.keyword_label_zoom_threshold = numberOr(
      resolved.labels.keyword_zoom_threshold,
      resolved.ui.keyword_label_zoom_threshold
    );
    resolved.ui.show_zoom_controls = resolved.controls.show_zoom ?? resolved.ui.show_zoom_controls;
    resolved.ui.enable_search = resolved.controls.show_search ?? resolved.ui.enable_search;
    resolved.ui.show_expand_button = boolOr(resolved.controls.show_expand, resolved.ui.show_expand_button);
    resolved.ui.enable_node_click = boolOr(resolved.controls.enable_node_click, resolved.ui.enable_node_click);
    resolved.ui.enable_edge_click = boolOr(resolved.controls.enable_edge_click, resolved.ui.enable_edge_click);
    resolved.ui.page_edge_opacity = numberOr(resolved.edges.page_opacity, resolved.ui.page_edge_opacity);
    resolved.ui.hierarchy_edge_opacity = numberOr(resolved.edges.hierarchy_opacity, resolved.ui.hierarchy_edge_opacity);
    resolved.ui.sibling_edge_opacity = numberOr(resolved.edges.sibling_opacity, resolved.ui.sibling_edge_opacity);
    resolved.ui.nav_edge_opacity = numberOr(resolved.edges.nav_opacity, resolved.ui.nav_edge_opacity);

    if (!resolved.hover.enabled) resolved.hover.mode = "none";
    if (!resolved.hover.dim_enabled) resolved.hover.dim_non_hovered_percent = 0;
    if (resolved.ui.show_zoom_controls === "auto") resolved.ui.show_zoom_controls = mode === "full";
    if (resolved.ui.enable_search === "auto") resolved.ui.enable_search = mode === "full";
    return resolved;
  }

  function numberOr(value, fallback) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : fallback;
  }

  const SIDEBAR_GRAPH_PREVIEW_FIT = Object.freeze({
    paddingMin: 12,
    paddingWidthRatio: 0.075,
    paddingHeightRatio: 0.085,
    fitShrink: 0.97,
    minScale: 0.32,
    maxScale: 1.68,
    labelPad: {
      page: { x: 52, y: 54 },
      keyword: { x: 34, y: 40 },
    },
  });

  function previewZoomMultiplier(config) {
    return Math.max(0.1, Math.min(8, numberOr(config?.layout?.preview_zoom, 1)));
  }

  function boolOr(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function clampPercent(value, fallback = DEFAULT_HOVER_DIM_PERCENT) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(100, value));
  }

  function clampUnitInterval(value, fallback) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
  }

  function hoverDimmingOpacity(config) {
    const percent = clampPercent(config?.hover?.dim_non_hovered_percent);
    return Math.max(0, 1 - (percent / 100));
  }

  function hoverDimmingLinkOpacity(config) {
    const percent = clampPercent(config?.hover?.dim_non_hovered_percent);
    return Math.max(0, 1 - ((percent * 1.32) / 100));
  }

  function stableHash(text) {
    let hash = 2166136261;
    for (const ch of String(text)) {
      hash ^= ch.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  

  function buildAdjacencyMap(edges) {
    const adjacency = new Map();
    edges.forEach((edge) => {
      const s = edgeSourceId(edge);
      const t = edgeTargetId(edge);
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s).add(t);
      adjacency.get(t).add(s);
    });
    return adjacency;
  }

  function buildSiteHoverMaps(nodes, edges) {
    const pageIdByUrl = new Map(
      nodes
        .filter((node) => node.type === "page" && node.url)
        .map((node) => [node.url, node.id])
    );
    const adjacency = new Map();
    const keywordAdjacency = new Map();
    const keywordSiblingAdjacency = new Map();
    const hierarchyParents = new Map();
    const hierarchyChildren = new Map();
    const keywordPages = new Map();
    const pageNavParents = new Map();
    const pageNavChildren = new Map();

    edges.forEach((edge) => {
      const s = edgeSourceId(edge);
      const t = edgeTargetId(edge);
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s).add(t);
      adjacency.get(t).add(s);

      if (s.startsWith("kw:") && t.startsWith("kw:")) {
        if (!keywordAdjacency.has(s)) keywordAdjacency.set(s, new Set());
        if (!keywordAdjacency.has(t)) keywordAdjacency.set(t, new Set());
        keywordAdjacency.get(s).add(t);
        keywordAdjacency.get(t).add(s);

        if (edge.relation === "sibling") {
          if (!keywordSiblingAdjacency.has(s)) keywordSiblingAdjacency.set(s, new Set());
          if (!keywordSiblingAdjacency.has(t)) keywordSiblingAdjacency.set(t, new Set());
          keywordSiblingAdjacency.get(s).add(t);
          keywordSiblingAdjacency.get(t).add(s);
        }
      }

      if (edge.relation === "hierarchy" && s.startsWith("kw:") && t.startsWith("kw:")) {
        if (!hierarchyChildren.has(s)) hierarchyChildren.set(s, new Set());
        if (!hierarchyParents.has(t)) hierarchyParents.set(t, new Set());
        hierarchyChildren.get(s).add(t);
        hierarchyParents.get(t).add(s);
      }

      if (edge.relation === "page") {
        const pageId = s.startsWith("page:") ? s : (t.startsWith("page:") ? t : null);
        const kwId = s.startsWith("kw:") ? s : (t.startsWith("kw:") ? t : null);
        if (pageId && kwId) {
          if (!keywordPages.has(kwId)) keywordPages.set(kwId, new Set());
          keywordPages.get(kwId).add(pageId);
        }
      }

      const navParent = navEdgeParentId(edge);
      const navChild = navEdgeChildId(edge);
      if (navParent && navChild) {
        if (!pageNavParents.has(navChild)) pageNavParents.set(navChild, new Set());
        if (!pageNavChildren.has(navParent)) pageNavChildren.set(navParent, new Set());
        pageNavParents.get(navChild).add(navParent);
        pageNavChildren.get(navParent).add(navChild);
      }

      if (Array.isArray(edge.pages)) {
        const pageUrls = edge.pages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__");
        if (pageUrls.length) {
          [s, t]
            .filter((id) => id.startsWith("kw:"))
            .forEach((kwId) => {
              if (!keywordPages.has(kwId)) keywordPages.set(kwId, new Set());
              pageUrls.forEach((pageUrl) => keywordPages.get(kwId).add(pageUrl));
            });
        }
      }
    });

    return {
      adjacency,
      keywordAdjacency,
      keywordSiblingAdjacency,
      hierarchyParents,
      hierarchyChildren,
      keywordPages,
      pageNavParents,
      pageNavChildren,
      pageIdByUrl,
    };
  }

  function edgeCurveBend(edge, mode) {
    const relation = edge.relation || "other";
    const key = `${edgeSourceId(edge)}::${edgeTargetId(edge)}::${relation}`;
    const sign = (stableHash(key) & 1) === 0 ? -1 : 1;
    const relationFactor = relation === "hierarchy"
      ? 0.55
      : relation === "page"
        ? 0.78
        : relation === "sibling"
          ? 1.15
          : 0.92;
    const modeFactor = mode === "page" ? 1.45 : 0.95;
    return sign * relationFactor * modeFactor;
  }

  function edgePath(edge, mode) {
    const source = edge.source;
    const target = edge.target;
    const x1 = source.x;
    const y1 = source.y;
    const x2 = target.x;
    const y2 = target.y;
    return `M${x1},${y1} L${x2},${y2}`;
  }

  function seedPageGraphLayout(nodes, edges, width, height, currentPageUrl) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const pageNode = currentPageUrl ? nodeById.get(`page:${currentPageUrl}`) : nodes.find((node) => node.type === "page") || null;
    const pageId = pageNode?.id || null;
    const levels = new Map();
    const anchors = new Map();
    const keywordIds = new Set(nodes.filter((node) => node.type === "keyword").map((node) => node.id));
    const pageIds = new Set(nodes.filter((node) => node.type === "page").map((node) => node.id));
    const hierarchyChildren = new Map();
    const hierarchyParents = new Map();
    const pageKeywords = new Map();
    const keywordPages = new Map();

    function pushSet(map, key, value) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    }

    edges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      if (edge.relation !== "hierarchy") return;
      if (!keywordIds.has(sourceId) || !keywordIds.has(targetId)) return;
      if (!hierarchyChildren.has(sourceId)) hierarchyChildren.set(sourceId, new Set());
      if (!hierarchyParents.has(targetId)) hierarchyParents.set(targetId, new Set());
      hierarchyChildren.get(sourceId).add(targetId);
      hierarchyParents.get(targetId).add(sourceId);
    });

    edges.forEach((edge) => {
      if (edge.relation !== "page") return;
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      const relatedPageId = pageIds.has(sourceId) ? sourceId : (pageIds.has(targetId) ? targetId : null);
      const relatedKeywordId = keywordIds.has(sourceId) ? sourceId : (keywordIds.has(targetId) ? targetId : null);
      if (!relatedPageId || !relatedKeywordId) return;
      pushSet(pageKeywords, relatedPageId, relatedKeywordId);
      pushSet(keywordPages, relatedKeywordId, relatedPageId);
    });

    if (pageId) levels.set(pageId, 0);

    let roots = [...keywordIds].filter((id) => {
      const parents = hierarchyParents.get(id) || new Set();
      return ![...parents].some((parentId) => keywordIds.has(parentId));
    });
    if (!roots.length) roots = [...keywordIds];

    roots = roots.sort((a, b) => {
      const labelA = nodeById.get(a)?.label || a;
      const labelB = nodeById.get(b)?.label || b;
      return labelA.localeCompare(labelB);
    });

    const queue = roots.map((id) => ({ id, depth: 1 }));
    roots.forEach((id) => levels.set(id, 1));
    while (queue.length) {
      const { id, depth } = queue.shift();
      (hierarchyChildren.get(id) || new Set()).forEach((childId) => {
        const nextDepth = depth + 1;
        if (!levels.has(childId) || nextDepth < levels.get(childId)) {
          levels.set(childId, nextDepth);
          queue.push({ id: childId, depth: nextDepth });
        }
      });
    }
    keywordIds.forEach((id) => {
      if (!levels.has(id)) levels.set(id, 1);
    });
    pageIds.forEach((id) => {
      if (id === pageId) return;
      const relatedKeywords = [...(pageKeywords.get(id) || new Set())];
      const nearestKeywordLevel = relatedKeywords.reduce((minLevel, keywordId) => {
        const level = levels.get(keywordId);
        return level == null ? minLevel : Math.min(minLevel, level);
      }, Number.POSITIVE_INFINITY);
      levels.set(id, Number.isFinite(nearestKeywordLevel) ? Math.max(2, nearestKeywordLevel + 1) : 2);
    });

    const centerX = width / 2;
    const centerY = height / 2;
    const minDim = Math.min(width, height);
    const roomy = minDim >= 640;
    const ringStep = Math.max(72, Math.min(roomy ? 176 : 138, minDim * (roomy ? 0.19 : 0.18)));
    const maxRadius = Math.max(ringStep * 2.05, minDim * (roomy ? 0.43 : 0.40));
    const groups = new Map();
    const rootByNode = new Map();

    roots.forEach((rootId) => {
      const stack = [rootId];
      while (stack.length) {
        const id = stack.pop();
        if (rootByNode.has(id)) continue;
        rootByNode.set(id, rootId);
        (hierarchyChildren.get(id) || new Set()).forEach((childId) => stack.push(childId));
      }
    });
    keywordIds.forEach((id) => {
      if (!rootByNode.has(id)) rootByNode.set(id, id);
    });
    pageIds.forEach((id) => {
      if (id === pageId) {
        rootByNode.set(id, "__current_page__");
        return;
      }
      const candidateRoots = [...(pageKeywords.get(id) || new Set())]
        .map((keywordId) => rootByNode.get(keywordId))
        .filter(Boolean)
        .sort((a, b) => roots.indexOf(a) - roots.indexOf(b));
      rootByNode.set(id, candidateRoots[0] || roots[0] || id);
    });

    nodes.forEach((node) => {
      const level = levels.get(node.id) ?? (node.type === "page" ? (node.id === pageId ? 0 : 2) : 1);
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    });

    groups.forEach((group, level) => {
      if (level === 0) {
        group.forEach((node) => {
          node.x = centerX;
          node.y = centerY;
        });
        return;
      }

      const ringRadius = Math.min(maxRadius, ringStep * level);
      const ordered = group
        .slice()
        .sort((a, b) => {
          const rootA = rootByNode.get(a.id);
          const rootB = rootByNode.get(b.id);
          const rootDiff = (roots.indexOf(rootA) - roots.indexOf(rootB));
          if (rootDiff !== 0) return rootDiff;
          const diff = stableHash(a.label || a.id) - stableHash(b.label || b.id);
          if (diff !== 0) return diff;
          return (a.label || a.id).localeCompare(b.label || b.id);
        });
      const levelBuckets = new Map();
      ordered.forEach((node) => {
        const rootId = rootByNode.get(node.id) || node.id;
        if (!levelBuckets.has(rootId)) levelBuckets.set(rootId, []);
        levelBuckets.get(rootId).push(node);
      });

      ordered.forEach((node) => {
        const rootId = rootByNode.get(node.id) || node.id;
        const rootIndex = Math.max(0, roots.indexOf(rootId));
        const rootAngle = roots.length
          ? (-Math.PI / 2) + (rootIndex / roots.length) * Math.PI * 2
          : -Math.PI / 2;
        const bucket = levelBuckets.get(rootId) || [node];
        const index = bucket.indexOf(node);
        const sector = roots.length ? (Math.PI * 2 / Math.max(roots.length, 1)) : Math.PI * 2;
        const spread = Math.min(sector * 0.72, level === 1 ? 0.52 : 0.96);
        const offset = bucket.length > 1
          ? ((index / (bucket.length - 1)) - 0.5) * spread
          : 0;
        const jitter = ((stableHash(node.id) % 17) - 8) * 0.7;
        const pageOffset = node.type === "page" ? Math.max(18, ringStep * 0.14) : 0;
        const radius = ringRadius + jitter + pageOffset;
        node.x = centerX + Math.cos(rootAngle + offset) * radius;
        node.y = centerY + Math.sin(rootAngle + offset) * radius;
        anchors.set(node.id, { x: node.x, y: node.y });
      });
    });

    if (pageId) anchors.set(pageId, { x: centerX, y: centerY });
    return { levels, pageId, anchors };
  }

  function seedConceptGraphLayout(nodes, edges, width, height, conceptKeyword, layoutOptions = {}) {
    const teachingPathMode = layoutOptions.teachingPathMode !== false;
    const targetLabel = String(conceptKeyword || "").trim().toLowerCase();
    const targetNode = nodes.find((node) =>
      node.type === "keyword" && String(node.label || "").trim().toLowerCase() === targetLabel
    ) || nodes.find((node) => node.type === "keyword") || null;
    const targetId = targetNode?.id || null;
    const parents = new Map();
    const children = new Map();
    const keywordPages = new Map();
    const pageCategories = new Map();
    const levels = new Map();
    const anchors = new Map();

    function pushSet(map, key, value) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    }

    edges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetEdgeId = edgeTargetId(edge);
      if (edge.relation === "hierarchy" && sourceId.startsWith("kw:") && targetEdgeId.startsWith("kw:")) {
        pushSet(children, sourceId, targetEdgeId);
        pushSet(parents, targetEdgeId, sourceId);
      }
      if (edge.relation === "page") {
        const pageId = sourceId.startsWith("page:") ? sourceId : (targetEdgeId.startsWith("page:") ? targetEdgeId : null);
        const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetEdgeId.startsWith("kw:") ? targetEdgeId : null);
        if (pageId && keywordId) pushSet(keywordPages, keywordId, pageId);
      }
      if (edge.relation === "nav" && sourceId.startsWith("cat:") && targetEdgeId.startsWith("page:")) {
        pushSet(pageCategories, targetEdgeId, sourceId);
      }
    });

    let maxAncestorDepth = 0;
    if (targetId) {
      const ancestorQueue = [{ id: targetId, depth: 0 }];
      const seenAncestors = new Set();
      while (ancestorQueue.length) {
        const { id, depth } = ancestorQueue.shift();
        if (seenAncestors.has(id)) continue;
        seenAncestors.add(id);
        maxAncestorDepth = Math.max(maxAncestorDepth, depth);
        (parents.get(id) || new Set()).forEach((parentId) => {
          ancestorQueue.push({ id: parentId, depth: depth + 1 });
        });
      }

      const descendantQueue = [{ id: targetId, depth: 0 }];
      const seenDescendants = new Set();
      while (descendantQueue.length) {
        const { id, depth } = descendantQueue.shift();
        if (seenDescendants.has(id)) continue;
        seenDescendants.add(id);
        const level = maxAncestorDepth + 1 + depth;
        if (!levels.has(id) || level < levels.get(id)) levels.set(id, level);
        (children.get(id) || new Set()).forEach((childId) => {
          descendantQueue.push({ id: childId, depth: depth + 1 });
        });
      }

      seenAncestors.forEach((id) => {
        if (id === targetId) return;
        let depth = 1;
        const queue = [{ current: targetId, distance: 0 }];
        const seen = new Set();
        while (queue.length) {
          const { current, distance } = queue.shift();
          if (seen.has(current)) continue;
          seen.add(current);
          if (current === id) {
            depth = distance;
            break;
          }
          (parents.get(current) || new Set()).forEach((parentId) => {
            queue.push({ current: parentId, distance: distance + 1 });
          });
        }
        levels.set(id, Math.max(1, maxAncestorDepth + 1 - depth));
      });
    }

    if (teachingPathMode) {
      [...levels.entries()].forEach(([id, level]) => {
        const node = nodes.find((entry) => entry.id === id);
        if (node?.type === "keyword") levels.set(id, level + 1);
      });
    }

    nodes.forEach((node) => {
      if (teachingPathMode) {
        if (node.type === "category") {
          levels.set(node.id, 0);
          return;
        }
        if (node.type === "page") {
          levels.set(node.id, 1);
          (pageCategories.get(node.id) || new Set()).forEach((categoryId) => levels.set(categoryId, 0));
          return;
        }
        if (!levels.has(node.id)) {
          levels.set(node.id, targetId && node.id === targetId ? maxAncestorDepth + 2 : 2);
        }
        return;
      }

      if (node.type === "page") {
        levels.set(node.id, 0);
        return;
      }
      if (node.type === "category") {
        levels.set(node.id, 0);
        return;
      }
      if (!levels.has(node.id)) levels.set(node.id, targetId && node.id === targetId ? maxAncestorDepth + 1 : 1);
    });

    if (!teachingPathMode) {
      keywordPages.forEach((pageIds) => {
        pageIds.forEach((pageId) => {
          levels.set(pageId, 0);
          (pageCategories.get(pageId) || new Set()).forEach((categoryId) => levels.set(categoryId, 0));
        });
      });
    }

    const groups = new Map();
    nodes.forEach((node) => {
      const level = levels.get(node.id) ?? 1;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push(node);
    });

    const orderedLevels = [...groups.keys()].sort((a, b) => a - b);
    const minX = Math.max(76, width * 0.08);
    const maxX = Math.max(minX + 1, width - Math.max(76, width * 0.08));
    const stepX = orderedLevels.length > 1 ? (maxX - minX) / (orderedLevels.length - 1) : 0;
    const centerY = height / 2;

    orderedLevels.forEach((level, levelIndex) => {
      const group = (groups.get(level) || [])
        .slice()
        .sort((a, b) => {
          if (a.id === targetId) return -1;
          if (b.id === targetId) return 1;
          if (a.type !== b.type) {
            const order = { category: 0, page: 1, keyword: 2 };
            return (order[a.type] || 9) - (order[b.type] || 9);
          }
          return (a.label || a.id).localeCompare(b.label || b.id);
        });
      const x = minX + stepX * levelIndex;
      const spread = Math.min(height * 0.72, Math.max(88, group.length * 92));
      group.forEach((node, index) => {
        const y = group.length === 1
          ? centerY
          : centerY - (spread / 2) + (spread * index) / Math.max(group.length - 1, 1);
        const jitter = node.id === targetId ? 0 : ((stableHash(node.id) % 9) - 4) * 1.8;
        node.x = x + jitter;
        node.y = y;
        anchors.set(node.id, { x: node.x, y: node.y });
      });
    });

    return { anchors, levels, targetId };
  }

  function seedFullGraphLayout(nodes, edges, width, height, siteCategoryAnchors = new Map()) {
    const centerX = width / 2;
    const centerY = height / 2;
    const minDim = Math.min(width, height);
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const anchors = new Map();
    const pagesByCategory = new Map();
    const pageCategory = new Map();
    const keywordPages = new Map();
    const hierarchyParents = new Map();
    const hierarchyChildren = new Map();

    function pushUnique(map, key, value) {
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key);
      if (!list.includes(value)) list.push(value);
    }

    function averageAnchors(anchorList) {
      if (!anchorList.length) return { x: centerX, y: centerY };
      const total = anchorList.reduce((acc, entry) => {
        acc.x += entry.x;
        acc.y += entry.y;
        return acc;
      }, { x: 0, y: 0 });
      return {
        x: total.x / anchorList.length,
        y: total.y / anchorList.length,
      };
    }

    edges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);

      if (edge.relation === "nav" && sourceId.startsWith("cat:") && targetId.startsWith("page:")) {
        pushUnique(pagesByCategory, sourceId, targetId);
        pageCategory.set(targetId, sourceId);
      }

      if (edge.relation === "page") {
        const pageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
        const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
        if (pageId && keywordId) pushUnique(keywordPages, keywordId, pageId);
      }

      if (edge.relation === "hierarchy" && sourceId.startsWith("kw:") && targetId.startsWith("kw:")) {
        pushUnique(hierarchyParents, targetId, sourceId);
        pushUnique(hierarchyChildren, sourceId, targetId);
      }
    });

    const categoryNodes = nodes
      .filter((node) => node.type === "category")
      .slice()
      .sort((a, b) => {
        if (a.id === "cat:Modules") return -1;
        if (b.id === "cat:Modules") return 1;
        return (a.label || a.id).localeCompare(b.label || b.id);
      });

    const fallbackRadius = minDim * 0.26;
    categoryNodes.forEach((node, index) => {
      const fallbackAngle = (-Math.PI / 2) + ((index / Math.max(categoryNodes.length, 1)) * Math.PI * 2);
      const fallback = {
        x: centerX + Math.cos(fallbackAngle) * fallbackRadius,
        y: centerY + Math.sin(fallbackAngle) * fallbackRadius,
      };
      const anchor = siteCategoryAnchors.get(node.id) || fallback;
      anchors.set(node.id, anchor);
      node.x = anchor.x;
      node.y = anchor.y;
    });

    const ungroupedPages = [];
    const pageNodes = nodes
      .filter((node) => node.type === "page")
      .slice()
      .sort((a, b) => (a.label || a.id).localeCompare(b.label || b.id));

    pageNodes.forEach((node) => {
      if (!pageCategory.has(node.id)) ungroupedPages.push(node.id);
    });
    if (ungroupedPages.length) pagesByCategory.set("__ungrouped__", ungroupedPages);

    pagesByCategory.forEach((pageIds, categoryId) => {
      const baseAnchor = categoryId === "__ungrouped__"
        ? { x: centerX, y: centerY + minDim * 0.22 }
        : (anchors.get(categoryId) || { x: centerX, y: centerY });
      const orderedIds = pageIds
        .filter((pageId) => nodeById.has(pageId))
        .slice()
        .sort((a, b) => {
          const labelA = nodeById.get(a)?.label || a;
          const labelB = nodeById.get(b)?.label || b;
          return labelA.localeCompare(labelB);
        });
      let cursor = 0;
      let ring = 0;
      const startAngle = (stableHash(categoryId) % 360) * Math.PI / 180;
      const baseRadius = categoryId === "cat:Modules"
        ? Math.max(126, Math.min(184, minDim * 0.16))
        : Math.max(92, Math.min(148, minDim * 0.12));
      const ringStep = Math.max(52, minDim * 0.05);

      while (cursor < orderedIds.length) {
        const capacity = Math.max(6, 6 + ring * 4);
        const batch = orderedIds.slice(cursor, cursor + capacity);
        const radius = baseRadius + ring * ringStep;
        batch.forEach((pageId, index) => {
          const node = nodeById.get(pageId);
          if (!node) return;
          const angle = startAngle + (index / Math.max(batch.length, 1)) * Math.PI * 2;
          const jitter = ((stableHash(pageId) % 11) - 5) * 1.4;
          const anchor = {
            x: baseAnchor.x + Math.cos(angle) * (radius + jitter),
            y: baseAnchor.y + Math.sin(angle) * (radius + jitter),
          };
          anchors.set(pageId, anchor);
          node.x = anchor.x;
          node.y = anchor.y;
        });
        cursor += batch.length;
        ring += 1;
      }
    });

    const keywordDepth = new Map();
    const keywordIds = nodes.filter((node) => node.type === "keyword").map((node) => node.id);
    const keywordRoots = keywordIds.filter((keywordId) => !(hierarchyParents.get(keywordId) || []).length);
    const queue = keywordRoots.map((keywordId) => ({ keywordId, depth: 0 }));
    keywordRoots.forEach((keywordId) => keywordDepth.set(keywordId, 0));

    while (queue.length) {
      const { keywordId, depth } = queue.shift();
      (hierarchyChildren.get(keywordId) || []).forEach((childId) => {
        const nextDepth = depth + 1;
        if (!keywordDepth.has(childId) || nextDepth < keywordDepth.get(childId)) {
          keywordDepth.set(childId, nextDepth);
          queue.push({ keywordId: childId, depth: nextDepth });
        }
      });
    }

    const orderedKeywords = nodes
      .filter((node) => node.type === "keyword")
      .slice()
      .sort((a, b) => {
        const depthDiff = (keywordDepth.get(a.id) ?? 0) - (keywordDepth.get(b.id) ?? 0);
        if (depthDiff !== 0) return depthDiff;
        return (a.label || a.id).localeCompare(b.label || b.id);
      });

    for (let pass = 0; pass < 3; pass++) {
      orderedKeywords.forEach((node) => {
        const sourceAnchors = [];
        (keywordPages.get(node.id) || []).forEach((pageId) => {
          const anchor = anchors.get(pageId);
          if (anchor) sourceAnchors.push(anchor);
        });
        (hierarchyParents.get(node.id) || []).forEach((parentId) => {
          const anchor = anchors.get(parentId);
          if (anchor) {
            sourceAnchors.push(anchor);
            sourceAnchors.push(anchor);
          }
        });
        if (!sourceAnchors.length) {
          (hierarchyChildren.get(node.id) || []).forEach((childId) => {
            const anchor = anchors.get(childId);
            if (anchor) sourceAnchors.push(anchor);
          });
        }
        if (!sourceAnchors.length) {
          const fallbackCategory = (keywordPages.get(node.id) || [])
            .map((pageId) => pageCategory.get(pageId))
            .find(Boolean);
          const anchor = fallbackCategory ? anchors.get(fallbackCategory) : null;
          if (anchor) sourceAnchors.push(anchor);
        }

        const baseAnchor = averageAnchors(sourceAnchors);
        const angle = (stableHash(node.id) % 360) * Math.PI / 180;
        const depth = keywordDepth.get(node.id) ?? 0;
        const offset = 26 + Math.min(40, depth * 9);
        const jitter = ((stableHash(`${node.id}:jitter`) % 13) - 6) * 2.1;
        const anchor = {
          x: baseAnchor.x + Math.cos(angle) * (offset + jitter),
          y: baseAnchor.y + Math.sin(angle) * (offset + jitter),
        };
        anchors.set(node.id, anchor);
        node.x = anchor.x;
        node.y = anchor.y;
      });
    }

    return { anchors };
  }

  function getGraphMeta(graph) {
    const raw = graph?.meta?.knotis || {};
    return {
      defaults: isPlainObject(raw.defaults) ? raw.defaults : FALLBACK_GRAPH_META.defaults,
      page_graph: isPlainObject(raw.page_graph) ? raw.page_graph : FALLBACK_GRAPH_META.page_graph,
      concept_graph: isPlainObject(raw.concept_graph) ? raw.concept_graph : FALLBACK_GRAPH_META.concept_graph,
      site_graph: isPlainObject(raw.site_graph) ? raw.site_graph : FALLBACK_GRAPH_META.site_graph,
    };
  }

  function resolveViewConfig(graph, mode) {
    const meta = getGraphMeta(graph);
    const viewKey = mode === "page" ? "page_graph" : (mode === "concept" ? "concept_graph" : "site_graph");
    const resolved = deepMerge(
      BASE_VIEW_DEFAULTS,
      isPlainObject(meta.defaults) ? meta.defaults : {},
      isPlainObject(meta[viewKey]) ? meta[viewKey] : {}
    );
    return resolveAutoUi(resolved, mode);
  }

  function graphEnabled(graph, mode) {
    return resolveViewConfig(graph, mode)?.graph?.enabled !== false;
  }

  

  function normalizeSiteTagKey(value) {
    return String(value || "").trim().replace(/^#/, "").toLowerCase();
  }

  function getSiteGraphFilters(graph) {
    const graphCfg = getGraphMeta(graph).site_graph?.graph;
    if (!isPlainObject(graphCfg)) return null;
    const excludeTags = Array.isArray(graphCfg.exclude_tags)
      ? graphCfg.exclude_tags
          .map((tag) => ({
            key: normalizeSiteTagKey(tag?.key || tag?.label || tag),
            label: tag?.label || `#${tag?.key || tag}`,
          }))
          .filter((tag) => tag.key)
      : [];
    if (!excludeTags.length) return null;
    const defaultView = normalizeSiteTagKey(graphCfg.default_view || "all") || "all";
    return {
      excludeTags,
      defaultView,
    };
  }

  function pageHasSiteTag(pageNode, tagKey) {
    if (!pageNode || !tagKey) return false;
    return (pageNode.tag_keys || pageNode.tags || [])
      .map(normalizeSiteTagKey)
      .includes(tagKey);
  }

  function createSiteFilterState(filters) {
    const state = {
      mode: "all",
      includedKeys: new Set(),
    };
    if (!filters) return state;
    const defaultView = normalizeSiteTagKey(filters.defaultView);
    if (!defaultView || defaultView === "all") return state;
    const match = filters.excludeTags.find((tag) => tag.key === defaultView);
    if (!match) return state;
    state.mode = "include";
    state.includedKeys.add(match.key);
    return state;
  }

  function siteFilterIsAll(state) {
    return !state || !state.includedKeys?.size;
  }

  function edgeSupportsVisiblePage(edge, visiblePageUrls) {
    const pages = Array.isArray(edge.pages) ? edge.pages : [];
    return pages.some((pageUrl) => pageUrl && pageUrl !== "__nav__" && visiblePageUrls.has(pageUrl));
  }

  function filterPreparedSiteGraph(prepared, state, filters) {
    if (!filters || siteFilterIsAll(state)) return prepared;

    const nodeById = new Map(prepared.nodes.map((node) => [node.id, node]));
    const visiblePageIds = new Set();
    const visiblePageUrls = new Set();
    const includedKeys = state.includedKeys || new Set();

    prepared.nodes.forEach((node) => {
      if (node.type !== "page") return;
      const visible = [...includedKeys].some((tagKey) => pageHasSiteTag(node, tagKey));
      if (!visible) return;
      visiblePageIds.add(node.id);
      if (node.url) visiblePageUrls.add(node.url);
    });

    const filteredEdges = prepared.edges.filter((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      if (edge.relation === "nav") return visiblePageIds.has(targetId);
      if (edge.relation === "page") {
        const pageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
        return Boolean(pageId) && visiblePageIds.has(pageId);
      }
      if (sourceId.startsWith("kw:") && targetId.startsWith("kw:")) {
        return edgeSupportsVisiblePage(edge, visiblePageUrls);
      }
      return visiblePageIds.has(sourceId) || visiblePageIds.has(targetId) || edgeSupportsVisiblePage(edge, visiblePageUrls);
    });

    const visibleNodeIds = new Set();
    filteredEdges.forEach((edge) => {
      visibleNodeIds.add(edgeSourceId(edge));
      visibleNodeIds.add(edgeTargetId(edge));
    });
    visiblePageIds.forEach((pageId) => visibleNodeIds.add(pageId));

    const filteredNodes = prepared.nodes.filter((node) => {
      if (node.type === "category") return visibleNodeIds.has(node.id);
      if (node.type === "page") return visiblePageIds.has(node.id);
      return visibleNodeIds.has(node.id);
    });
    const finalNodeIds = new Set(filteredNodes.map((node) => node.id));
    const finalEdges = filteredEdges.filter((edge) => finalNodeIds.has(edgeSourceId(edge)) && finalNodeIds.has(edgeTargetId(edge)));
    const highlightContextEdges = (prepared._highlightContextEdges || []).filter((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      if (edge.relation === "nav") return visiblePageIds.has(targetId);
      if (edge.relation === "page") {
        const pageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
        return Boolean(pageId) && visiblePageIds.has(pageId);
      }
      return finalNodeIds.has(sourceId) && finalNodeIds.has(targetId);
    });

    return {
      ...prepared,
      nodes: filteredNodes,
      edges: finalEdges,
      _highlightContextEdges: highlightContextEdges,
    };
  }

  
  function wrapText(textEl, label, charsPerLine, maxLines = null) {
    const words = label.split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > charsPerLine && line) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + " " + word : word;
      }
    }
    if (line) lines.push(line);
    const visibleLines = maxLines ? lines.slice(0, Math.max(1, maxLines)) : lines;
    if (maxLines && lines.length > visibleLines.length) {
      visibleLines[visibleLines.length - 1] = `${visibleLines[visibleLines.length - 1].replace(/\s+$/, "")}…`;
    }

    
    visibleLines.forEach((l, i) => {
      textEl.append("tspan")
        .attr("x", 0)
        .attr("dy", i === 0 ? "0.8em" : "1.08em")
        .text(l);
    });
  }

  
  function cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function zoomInIconSvg() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"></circle>
      <line x1="11" y1="8" x2="11" y2="14"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>`;
  }

  function zoomOutIconSvg() {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="7"></circle>
      <line x1="8" y1="11" x2="14" y2="11"></line>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>`;
  }

  function attachGraphControls(container, {
    onZoomIn,
    onZoomOut,
    showButtons = true,
  }) {
    container.classList.add("graph-controls-host");
    container.querySelector(".graph-controls")?.remove();

    const controls = document.createElement("div");
    controls.className = "graph-controls";

    if (showButtons) {
      const buttonRow = document.createElement("div");
      buttonRow.className = "graph-controls__buttons";

      const zoomInBtn = document.createElement("button");
      zoomInBtn.className = "graph-control-btn graph-control-btn--zoom-in";
      zoomInBtn.setAttribute("aria-label", "Zoom in");
      zoomInBtn.setAttribute("title", "Zoom in");
      zoomInBtn.innerHTML = zoomInIconSvg();
      zoomInBtn.addEventListener("click", onZoomIn);
      buttonRow.appendChild(zoomInBtn);

      const zoomOutBtn = document.createElement("button");
      zoomOutBtn.className = "graph-control-btn graph-control-btn--zoom-out";
      zoomOutBtn.setAttribute("aria-label", "Zoom out");
      zoomOutBtn.setAttribute("title", "Zoom out");
      zoomOutBtn.innerHTML = zoomOutIconSvg();
      zoomOutBtn.addEventListener("click", onZoomOut);
      buttonRow.appendChild(zoomOutBtn);

      controls.appendChild(buttonRow);
    }

    container.appendChild(controls);
  }

  function edgeSourceId(edge) {
    return typeof edge.source === "object" ? edge.source.id : edge.source;
  }

  function edgeTargetId(edge) {
    return typeof edge.target === "object" ? edge.target.id : edge.target;
  }

  function isNavParentId(id) {
    return typeof id === "string" && (id.startsWith("cat:") || id.startsWith("page:"));
  }

  function isNavChildId(id) {
    return typeof id === "string" && id.startsWith("page:");
  }

  function navEdgeParentId(edge) {
    if (edge?.relation !== "nav") return null;
    const sourceId = edgeSourceId(edge);
    const targetId = edgeTargetId(edge);
    return isNavParentId(sourceId) && isNavChildId(targetId) ? sourceId : null;
  }

  function navEdgeChildId(edge) {
    if (edge?.relation !== "nav") return null;
    const sourceId = edgeSourceId(edge);
    const targetId = edgeTargetId(edge);
    return isNavParentId(sourceId) && isNavChildId(targetId) ? targetId : null;
  }

  function graphEdgeKey(edge) {
    return `${edge.relation || "other"}:${edgeSourceId(edge)}->${edgeTargetId(edge)}`;
  }

  function computeSiblingWeight(sources) {
    const safe = sources || {};
    return 3 * (safe.line || 0) + 2 * (safe.paragraph || 0) + (safe.heading || 0) + 2 * (safe.local_parent || 0);
  }

  function getEffectiveEdgeScore(edge, metric) {
    if (metric === "none") return 0;
    if (metric === "page_count") return edge.page_count || (Array.isArray(edge.pages) ? edge.pages.length : 1);
    return edge._effectiveWeight ?? edge.weight ?? edge.page_count ?? (Array.isArray(edge.pages) ? edge.pages.length : 1);
  }

  function edgeBelongsToPage(edge, pageUrl, pageId) {
    const s = edgeSourceId(edge);
    const t = edgeTargetId(edge);
    if (s === pageId || t === pageId) return true;
    return Array.isArray(edge.pages) && edge.pages.includes(pageUrl);
  }

  function collectNavAncestorEdges(edges, pageId) {
    const childToEdges = new Map();
    edges.forEach((edge, index) => {
      const parentId = navEdgeParentId(edge);
      const childId = navEdgeChildId(edge);
      if (!parentId || !childId) return;
      if (!childToEdges.has(childId)) childToEdges.set(childId, []);
      childToEdges.get(childId).push({ index, parentId });
    });
    const allowed = new Set();
    const stack = [pageId];
    const seen = new Set();
    while (stack.length) {
      const current = stack.pop();
      if (seen.has(current)) continue;
      seen.add(current);
      (childToEdges.get(current) || []).forEach(({ index, parentId }) => {
        allowed.add(index);
        stack.push(parentId);
      });
    }
    return allowed;
  }

  function applyRelationFilters(edges, config) {
    const include = new Set(config.relations.include || []);
    const minWeight = config.relations.min_weight || 1;
    return edges
      .map((edge, index) => ({ ...edge, _edgeIndex: index }))
      .filter((edge) => include.has(edge.relation))
      .map((edge) => {
        if (edge.relation === "sibling") {
          const rawSources = edge.sources || {};
          return {
            ...edge,
            _effectiveSources: rawSources,
            _effectiveWeight: edge.weight ?? computeSiblingWeight(rawSources),
          };
        }
        return {
          ...edge,
          _effectiveSources: edge.sources || { line: 0, paragraph: 0, heading: 0, local_parent: 0 },
          _effectiveWeight: edge.weight ?? edge.page_count ?? (Array.isArray(edge.pages) ? edge.pages.length : 1),
        };
      })
      .filter((edge) => edge._effectiveWeight >= minWeight);
  }

  function applyPageFilter(edges, currentPageUrl, filterMode) {
    if (filterMode === "all_pages" || !currentPageUrl) return { edges, applied: false };
    const pageId = `page:${currentPageUrl}`;
    const baseEdges = edges.filter((edge) => edge.relation !== "nav" && edgeBelongsToPage(edge, currentPageUrl, pageId));
    const hasCurrentPageMatch = baseEdges.length > 0 || edges.some((edge) => edgeSourceId(edge) === pageId || edgeTargetId(edge) === pageId);
    if (filterMode === "current_page_if_available" && !hasCurrentPageMatch) return { edges, applied: false };

    const navEdgeIndexes = collectNavAncestorEdges(edges, pageId);
    const filteredEdges = edges.filter((edge, index) => {
      if (edge.relation === "nav") return navEdgeIndexes.has(index);
      return edgeBelongsToPage(edge, currentPageUrl, pageId);
    });
    return { edges: filteredEdges, applied: true };
  }

  function isStrictPageHierarchyEdge(edge, currentPageUrl) {
    if (edge.relation !== "hierarchy" || !currentPageUrl) return true;
    const pageSources = edge.hierarchy_sources?.[currentPageUrl];
    if (!pageSources) return true;
    return (
      (pageSources.list || 0) > 0
      || (pageSources.reference || 0) > 0
      || (pageSources.heading_explicit || 0) > 0
      || (pageSources.heading_inferred || 0) > 0
      || (pageSources.section_heading || 0) > 0
    );
  }

  function graphPageHierarchyEdges(graphData) {
    return graphData?.page_hierarchy_edges
      || graphData?._sourceGraph?.page_hierarchy_edges
      || [];
  }

  function pageGraphTeachesHierarchyEdge(graphData, pageUrl, sourceId, targetId) {
    if (!pageUrl || !sourceId || !targetId) return false;
    return graphPageHierarchyEdges(graphData).some((edge) => (
      edge.page === pageUrl
      && ((edge.source === sourceId && edge.target === targetId)
        || (edge.source === targetId && edge.target === sourceId))
    ));
  }

  function graphSiblingEdgeOnPage(graphData, pageUrl, sourceId, targetId) {
    if (!pageUrl || !sourceId || !targetId) return false;
    const edges = graphData?.edges || graphData?._sourceGraph?.edges || [];
    return edges.some((edge) => (
      edge.relation === "sibling"
      && Array.isArray(edge.pages)
      && edge.pages.includes(pageUrl)
      && ((edgeSourceId(edge) === sourceId && edgeTargetId(edge) === targetId)
        || (edgeSourceId(edge) === targetId && edgeTargetId(edge) === sourceId))
    ));
  }

  function scopeEdgeClickPages(edgePages, { relation, sourceId, targetId, currentPageUrl, graphData, preferCurrentPageScope }) {
    if (!preferCurrentPageScope) return edgePages;
    if (!currentPageUrl || !Array.isArray(edgePages) || !edgePages.length) return edgePages;
    if (edgePages.includes(currentPageUrl)) return [currentPageUrl];
    if (relation === "hierarchy" && pageGraphTeachesHierarchyEdge(graphData, currentPageUrl, sourceId, targetId)) {
      return [currentPageUrl];
    }
    if (relation === "sibling" && graphSiblingEdgeOnPage(graphData, currentPageUrl, sourceId, targetId)) {
      return [currentPageUrl];
    }
    return edgePages;
  }

  function mergePageGraphHierarchyEdges(edges, pageHierarchyEdges, currentPageUrl) {
    if (!currentPageUrl || !Array.isArray(pageHierarchyEdges) || pageHierarchyEdges.length === 0) return edges;

    
    const pageSpecificKeys = new Set(
      pageHierarchyEdges
        .filter((e) => e.page === currentPageUrl && e.source && e.target)
        .map((e) => `${edgeSourceId(e)}\u0000${edgeTargetId(e)}`)
    );

    
    
    
    let updatedEdges = edges;
    if (pageSpecificKeys.size > 0) {
      updatedEdges = edges.map((edge) => {
        if (edge.relation !== "hierarchy") return edge;
        const key = `${edgeSourceId(edge)}\u0000${edgeTargetId(edge)}`;
        if (!pageSpecificKeys.has(key)) return edge;
        if (Array.isArray(edge.pages) && edge.pages.includes(currentPageUrl)) return edge;
        return { ...edge, pages: [...(edge.pages || []), currentPageUrl] };
      });
    }

    const existingHierarchy = new Set(
      updatedEdges
        .filter((edge) => edge.relation === "hierarchy")
        .map((edge) => `${edgeSourceId(edge)}\u0000${edgeTargetId(edge)}`)
    );
    const additions = [];

    pageHierarchyEdges.forEach((edge) => {
      if (edge.page !== currentPageUrl || !edge.source || !edge.target) return;
      const key = `${edge.source}\u0000${edge.target}`;
      if (existingHierarchy.has(key)) return; 
      existingHierarchy.add(key);
      const sourceKind = edge.source_kind || "list";
      additions.push({
        source: edge.source,
        target: edge.target,
        pages: [currentPageUrl],
        relation: "hierarchy",
        page_count: 1,
        weight: 1,
        sources: { line: 0, paragraph: 0, heading: 0, local_parent: 0 },
        hierarchy_sources: { [currentPageUrl]: { [sourceKind]: 1 } },
        _pageGraphOnly: true,
      });
    });

    return additions.length ? updatedEdges.concat(additions) : updatedEdges;
  }

  function mergePageGraphPageEdges(edges, pageGraphPageEdges, currentPageUrl) {
    if (!currentPageUrl || !Array.isArray(pageGraphPageEdges) || pageGraphPageEdges.length === 0) return edges;
    const existingPageEdges = new Set(
      edges
        .filter((edge) => edge.relation === "page")
        .map((edge) => `${edgeSourceId(edge)}\u0000${edgeTargetId(edge)}`)
    );
    const additions = [];

    pageGraphPageEdges.forEach((edge) => {
      if (edge.page !== currentPageUrl || !edge.source || !edge.target) return;
      const key = `${edge.source}\u0000${edge.target}`;
      if (existingPageEdges.has(key)) return;
      existingPageEdges.add(key);
      additions.push({
        source: edge.source,
        target: edge.target,
        pages: [currentPageUrl],
        relation: "page",
        page_count: 1,
        weight: 1,
        sources: { line: 0, paragraph: 0, heading: 0, local_parent: 0 },
        hierarchy_sources: {},
        _pageGraphOnly: true,
      });
    });

    return additions.length ? edges.concat(additions) : edges;
  }

  function mergeAllPageGraphPageEdges(edges, pageGraphPageEdges) {
    const existingPageEdges = new Set();
    edges
      .filter((edge) => edge.relation === "page")
      .forEach((edge) => {
        const pageId = edgeSourceId(edge).startsWith("page:") ? edgeSourceId(edge) : edgeTargetId(edge);
        const keywordId = edgeSourceId(edge).startsWith("kw:") ? edgeSourceId(edge) : edgeTargetId(edge);
        if (!pageId.startsWith("page:") || !keywordId.startsWith("kw:")) return;
        const pageUrls = Array.isArray(edge.pages) && edge.pages.length
          ? edge.pages
          : [pageId.slice("page:".length)];
        pageUrls.forEach((pageUrl) => {
          if (pageUrl && pageUrl !== "__nav__") existingPageEdges.add(`${pageId}\u0000${keywordId}\u0000${pageUrl}`);
        });
      });
    const additions = [];

    function addPageSupportEdge(pageUrl, pageId, keywordId) {
      if (!pageUrl || pageUrl === "__nav__" || !pageId || !keywordId) return;
      if (!pageId.startsWith("page:") || !keywordId.startsWith("kw:")) return;
      const key = `${pageId}\u0000${keywordId}\u0000${pageUrl}`;
      if (existingPageEdges.has(key)) return false;
      existingPageEdges.add(key);
      additions.push({
        source: pageId,
        target: keywordId,
        pages: [pageUrl],
        relation: "page",
        page_count: 1,
        weight: 1,
        sources: { line: 0, paragraph: 0, heading: 0, local_parent: 0 },
        hierarchy_sources: {},
        _pageGraphOnly: true,
      });
      return true;
    }

    if (Array.isArray(pageGraphPageEdges)) {
      pageGraphPageEdges.forEach((edge) => {
        addPageSupportEdge(edge.page, edge.source, edge.target);
      });
    }

    edges.forEach((edge) => {
      if (edge.relation !== "hierarchy" && edge.relation !== "sibling") return;
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      const keywordIds = [sourceId, targetId].filter((id) => id.startsWith("kw:"));
      if (!keywordIds.length || !Array.isArray(edge.pages)) return;
      edge.pages.forEach((pageUrl) => {
        const pageId = pageUrl && pageUrl !== "__nav__" ? `page:${pageUrl}` : "";
        keywordIds.forEach((keywordId) => addPageSupportEdge(pageUrl, pageId, keywordId));
      });
    });

    return additions.length ? edges.concat(additions) : edges;
  }

  function mergeAllPageHierarchyEdges(edges, pageHierarchyEdges) {
    if (!Array.isArray(pageHierarchyEdges) || pageHierarchyEdges.length === 0) return edges;
    const existingHierarchyEdges = new Set();
    const additions = [];

    pageHierarchyEdges.forEach((edge) => {
      if (!edge.page || !edge.source || !edge.target) return;
      const key = `${edge.source}\u0000${edge.target}\u0000${edge.page}`;
      if (existingHierarchyEdges.has(key)) return;
      existingHierarchyEdges.add(key);
      additions.push({
        source: edge.source,
        target: edge.target,
        pages: [edge.page],
        relation: "hierarchy",
        page_count: 1,
        weight: 1,
        sources: { line: 0, paragraph: 0, heading: 0, local_parent: 0 },
        hierarchy_sources: { [edge.page]: { [edge.source_kind || "list"]: 1 } },
        _pageGraphOnly: true,
      });
    });

    return additions.length ? edges.concat(additions) : edges;
  }

  function prunePageEdgesToRootConcepts(edges, currentPageUrl) {
    const rootedChildrenByPage = new Map();

    function addRootedChild(pageUrl, keywordId) {
      if (!pageUrl || pageUrl === "__nav__" || !keywordId) return;
      if (!rootedChildrenByPage.has(pageUrl)) rootedChildrenByPage.set(pageUrl, new Set());
      rootedChildrenByPage.get(pageUrl).add(keywordId);
    }

    edges.forEach((edge) => {
      if (edge.relation !== "hierarchy") return;
      const targetId = edgeTargetId(edge);
      if (!targetId.startsWith("kw:")) return;
      const pageUrls = Array.isArray(edge.pages)
        ? edge.pages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__")
        : [];
      if (pageUrls.length) {
        pageUrls.forEach((pageUrl) => {
          if (edge.hierarchy_sources?.[pageUrl]) {
            addRootedChild(pageUrl, targetId);
          }
        });
      } else if (currentPageUrl) {
        if (edge.hierarchy_sources?.[currentPageUrl]) {
          addRootedChild(currentPageUrl, targetId);
        }
      }
    });

    if (!rootedChildrenByPage.size) return edges;

    const prunedEdges = edges.filter((edge) => {
      if (edge.relation !== "page") return true;
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
      if (!keywordId) return true;
      const pageUrls = Array.isArray(edge.pages)
        ? edge.pages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__")
        : [];
      const scopedPageUrls = pageUrls.length ? pageUrls : (currentPageUrl ? [currentPageUrl] : []);
      return !scopedPageUrls.some((pageUrl) => rootedChildrenByPage.get(pageUrl)?.has(keywordId));
    });

    if (currentPageUrl) {
      const pageId = `page:${currentPageUrl}`;
      const hasCurrentPageEdge = prunedEdges.some((e) => e.relation === "page" && (edgeSourceId(e) === pageId || edgeTargetId(e) === pageId));
      if (!hasCurrentPageEdge) {
        const hadCurrentPageEdge = edges.some((e) => e.relation === "page" && (edgeSourceId(e) === pageId || edgeTargetId(e) === pageId));
        if (hadCurrentPageEdge) return edges;
      }
    }

    return prunedEdges;
  }

  function applyNodeFilters(nodes, config) {
    return nodes.filter((node) => {
      if (node.type === "keyword") {
        if (!config.nodes.show_keywords) return false;
        if ((node.page_count || 0) < (config.nodes.min_keyword_page_count || 0)) return false;
        if ((node.occurrence_count || 0) < (config.nodes.min_keyword_occurrence_count || 0)) return false;
      }
      if (node.type === "page" && !config.nodes.show_pages) return false;
      if (node.type === "category" && !config.nodes.show_categories) return false;
      return true;
    });
  }

  function pruneTopEdgesPerNode(edges, config) {
    const limit = config.relations.top_edges_per_node;
    const metric = config.relations.sort_metric;
    if (!limit || metric === "none") return edges;

    const keepEdgeKeys = new Set();
    const byKeyword = new Map();
    edges.forEach((edge) => {
      const s = edgeSourceId(edge);
      const t = edgeTargetId(edge);
      if (!s.startsWith("kw:") || !t.startsWith("kw:")) {
        keepEdgeKeys.add(`${s}::${t}`);
        return;
      }
      if (!byKeyword.has(s)) byKeyword.set(s, []);
      if (!byKeyword.has(t)) byKeyword.set(t, []);
      byKeyword.get(s).push(edge);
      byKeyword.get(t).push(edge);
    });

    byKeyword.forEach((edgeList) => {
      edgeList
        .slice()
        .sort((a, b) => getEffectiveEdgeScore(b, metric) - getEffectiveEdgeScore(a, metric))
        .slice(0, limit)
        .forEach((edge) => keepEdgeKeys.add(`${edgeSourceId(edge)}::${edgeTargetId(edge)}`));
    });

    return edges.filter((edge) => keepEdgeKeys.has(`${edgeSourceId(edge)}::${edgeTargetId(edge)}`));
  }

  function bfsVisibleNodes(edges, seedIds, maxHops = null) {
    const adjacency = new Map();
    edges.forEach((edge) => {
      const s = edgeSourceId(edge);
      const t = edgeTargetId(edge);
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s).add(t);
      adjacency.get(t).add(s);
    });

    const visited = new Set(seedIds);
    const queue = seedIds.map((id) => ({ id, depth: 0 }));
    while (queue.length) {
      const { id, depth } = queue.shift();
      if (maxHops !== null && depth >= maxHops) continue;
      (adjacency.get(id) || new Set()).forEach((nextId) => {
        if (visited.has(nextId)) return;
        visited.add(nextId);
        queue.push({ id: nextId, depth: depth + 1 });
      });
    }
    return visited;
  }

  function applySeedAndHopFilters(nodes, edges, config, currentPageUrl) {
    if (config.scope.seed === "all" && config.scope.max_hops == null) return { nodes, edges };
    const nodeIds = new Set(nodes.map((node) => node.id));
    let seedIds = [];
    if (config.scope.seed === "current_page" && currentPageUrl) {
      const pageId = `page:${currentPageUrl}`;
      if (nodeIds.has(pageId)) {
        seedIds = [pageId];
      } else {
        edges.forEach((edge) => {
          if (!Array.isArray(edge.pages) || !edge.pages.includes(currentPageUrl)) return;
          const s = edgeSourceId(edge);
          const t = edgeTargetId(edge);
          if (nodeIds.has(s)) seedIds.push(s);
          if (nodeIds.has(t)) seedIds.push(t);
        });
      }
    }
    seedIds = [...new Set(seedIds.filter((id) => nodeIds.has(id)))];
    if (seedIds.length === 0) return { nodes, edges };

    const allowed = bfsVisibleNodes(edges, seedIds, config.scope.max_hops);
    return {
      nodes: nodes.filter((node) => allowed.has(node.id)),
      edges: edges.filter((edge) => allowed.has(edgeSourceId(edge)) && allowed.has(edgeTargetId(edge))),
    };
  }

  function removeOrphans(nodes, edges) {
    const degrees = new Map();
    edges.forEach((edge) => {
      const s = edgeSourceId(edge);
      const t = edgeTargetId(edge);
      degrees.set(s, (degrees.get(s) || 0) + 1);
      degrees.set(t, (degrees.get(t) || 0) + 1);
    });
    const keptNodes = nodes.filter((node) => (degrees.get(node.id) || 0) > 0);
    const keptIds = new Set(keptNodes.map((node) => node.id));
    return {
      nodes: keptNodes,
      edges: edges.filter((edge) => keptIds.has(edgeSourceId(edge)) && keptIds.has(edgeTargetId(edge))),
    };
  }

  function applyGraphExclusionFilters(nodes, edges, config) {
    const graphCfg = isPlainObject(config.graph) ? config.graph : {};
    const excludeUrls = new Set(Array.isArray(graphCfg.exclude_urls) ? graphCfg.exclude_urls : []);
    const excludeKeywords = new Set(Array.isArray(graphCfg.exclude_keywords) ? graphCfg.exclude_keywords : []);
    if (!excludeUrls.size && !excludeKeywords.size) {
      return { nodes, edges };
    }

    const filteredNodes = nodes.filter((node) => {
      if (node.type === "page" && excludeUrls.has(node.url)) return false;
      if (node.type === "keyword") {
        const keyword = node.id.startsWith("kw:") ? node.id.slice(3) : "";
        if (keyword && excludeKeywords.has(keyword)) return false;
      }
      return true;
    });
    const keptIds = new Set(filteredNodes.map((node) => node.id));
    return {
      nodes: filteredNodes,
      edges: edges.filter((edge) => keptIds.has(edgeSourceId(edge)) && keptIds.has(edgeTargetId(edge))),
    };
  }

  function graphPayloadForMode(graph, mode) {
    const config = resolveViewConfig(graph, mode);
    const excluded = applyGraphExclusionFilters(graph.nodes, graph.edges, config);
    const keptIds = new Set(excluded.nodes.map((node) => node.id));
    return {
      ...graph,
      nodes: excluded.nodes,
      edges: excluded.edges,
      page_hierarchy_edges: (graph.page_hierarchy_edges || []).filter(
        (edge) => keptIds.has(edge.source) && keptIds.has(edge.target)
      ),
      page_graph_page_edges: (graph.page_graph_page_edges || []).filter(
        (edge) => keptIds.has(edge.source) && keptIds.has(edge.target)
      ),
      _resolvedConfig: config,
    };
  }

  function prepareGraphForMode(graph, mode, pageUrl = "") {
    const currentPageUrl = String(pageUrl || "").trim() || findPageUrl(graph);
    const workingGraph = graphPayloadForMode(graph, mode);
    const config = workingGraph._resolvedConfig;
    const pageFilterResult = applyPageFilter(workingGraph.edges, currentPageUrl, config.scope.page_filter);
    let edges = applyRelationFilters(pageFilterResult.edges, config);
    if (mode === "page") {
      edges = edges.filter((edge) => isStrictPageHierarchyEdge(edge, currentPageUrl));
      edges = mergePageGraphHierarchyEdges(edges, workingGraph.page_hierarchy_edges, currentPageUrl);
      edges = mergePageGraphPageEdges(edges, workingGraph.page_graph_page_edges, currentPageUrl);
    } else if (config.relations.page_edges === "all") {
      edges = mergeAllPageGraphPageEdges(edges, workingGraph.page_graph_page_edges);
    }
    let hoverPageEdgeSource = edges;
    if (config.relations.page_edges !== "all" && mode === "full") {
      hoverPageEdgeSource = mergeAllPageGraphPageEdges(edges, workingGraph.page_graph_page_edges);
    }
    if (mode === "full") {
      hoverPageEdgeSource = mergeAllPageHierarchyEdges(hoverPageEdgeSource, workingGraph.page_hierarchy_edges);
    }
    if (config.relations.page_edges !== "all") {
      edges = prunePageEdgesToRootConcepts(edges, mode === "page" ? currentPageUrl : null);
    }
    let highlightContextEdges = hoverPageEdgeSource.filter((edge) =>
      edge.relation === "page" || edge.relation === "nav" || (mode === "full" && edge.relation === "hierarchy")
    );
    let nodes = applyNodeFilters(workingGraph.nodes, config);

    const nodeIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter((edge) => nodeIds.has(edgeSourceId(edge)) && nodeIds.has(edgeTargetId(edge)));
    highlightContextEdges = highlightContextEdges.filter((edge) => nodeIds.has(edgeSourceId(edge)) && nodeIds.has(edgeTargetId(edge)));
    edges = pruneTopEdgesPerNode(edges, config);

    ({ nodes, edges } = applySeedAndHopFilters(nodes, edges, config, currentPageUrl));
    if (!config.nodes.show_orphans) ({ nodes, edges } = removeOrphans(nodes, edges));
    const finalNodeIds = new Set(nodes.map((node) => node.id));
    highlightContextEdges = highlightContextEdges.filter((edge) => finalNodeIds.has(edgeSourceId(edge)) && finalNodeIds.has(edgeTargetId(edge)));

    return {
      nodes,
      edges,
      meta: graph.meta || {},
      page_hierarchy_edges: graph.page_hierarchy_edges || [],
      _sourceGraph: graph,
      _resolvedConfig: config,
      _currentPageUrl: currentPageUrl,
      _pageFilterApplied: pageFilterResult.applied,
      _highlightContextEdges: highlightContextEdges,
    };
  }

  function dedupeEdges(edges) {
    const seen = new Set();
    const deduped = [];
    edges.forEach((edge) => {
      const key = `${edge.relation || "other"}::${edgeSourceId(edge)}::${edgeTargetId(edge)}::${(edge.pages || []).join("|")}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(edge);
    });
    return deduped;
  }

  function prepareExpandedPageGraph(graph, pageUrl = "") {
    const currentPageUrl = String(pageUrl || "").trim() || findPageUrl(graph);
    if (!currentPageUrl) return prepareGraphForMode(graph, "page");

    const inlineGraph = prepareGraphForMode(graph, "page", currentPageUrl);
    const fullConfig = resolveViewConfig(graph, "full");
    const currentPageId = `page:${currentPageUrl}`;
    const keywordIds = new Set(
      inlineGraph.nodes
        .filter((node) => node.type === "keyword")
        .map((node) => node.id)
    );
    const relatedPageIds = new Set([currentPageId]);
    const expandedKeywordIds = new Set(keywordIds);
    const defaultVisibleNodeIds = new Set(inlineGraph.nodes.map((node) => node.id));
    const defaultVisibleEdgeKeys = new Set(inlineGraph.edges.map((edge) => graphEdgeKey(edge)));
    const relatedEdges = applyRelationFilters(graph.edges, fullConfig);
    const pageEdges = relatedEdges.filter((edge) => edge.relation === "page");

    pageEdges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      const pageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
      const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
      if (!pageId || !keywordId) return;
      if (keywordIds.has(keywordId)) relatedPageIds.add(pageId);
    });

    pageEdges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      const pageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
      const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
      if (!pageId || !keywordId) return;
      if (relatedPageIds.has(pageId)) expandedKeywordIds.add(keywordId);
    });

    const allowedNodeIds = new Set([...relatedPageIds, ...expandedKeywordIds]);
    const expandedEdges = dedupeEdges([
      ...inlineGraph.edges.map((edge) => ({ ...edge })),
      ...relatedEdges
        .filter((edge) => {
          const sourceId = edgeSourceId(edge);
          const targetId = edgeTargetId(edge);
          return allowedNodeIds.has(sourceId) && allowedNodeIds.has(targetId);
        })
        .map((edge) => ({ ...edge })),
    ]);
    const prunedEdges = inlineGraph._resolvedConfig?.relations?.page_edges === "all"
      ? expandedEdges
      : prunePageEdgesToRootConcepts(expandedEdges, null);
    const finalNodeIds = new Set();
    prunedEdges.forEach((edge) => {
      finalNodeIds.add(edgeSourceId(edge));
      finalNodeIds.add(edgeTargetId(edge));
    });

    const nodes = graph.nodes
      .filter((node) => finalNodeIds.has(node.id) && node.type !== "category")
      .map((node) => ({ ...node }));
    const finalEdges = prunedEdges.filter((edge) => finalNodeIds.has(edgeSourceId(edge)) && finalNodeIds.has(edgeTargetId(edge)));
    
    
    
    const pageFocalNodeId = nodes.some((node) => node.id === currentPageId)
      ? currentPageId
      : (nodes.find((node) => node.type === "keyword" && keywordIds.has(node.id))?.id || null);

    return {
      nodes,
      edges: finalEdges,
      meta: graph.meta || {},
      page_hierarchy_edges: graph.page_hierarchy_edges || [],
      _sourceGraph: graph,
      _resolvedConfig: deepMerge(resolveViewConfig(graph, "page"), {
        ui: {
          show_expand_button: false,
          enable_search: false,
        },
      }),
      _currentPageUrl: currentPageUrl,
      _pageFocalNodeId: pageFocalNodeId,
      _pageFilterApplied: false,
      _highlightContextEdges: finalEdges.filter((edge) => edge.relation === "page" || edge.relation === "nav"),
      _defaultVisibleNodeIds: [...defaultVisibleNodeIds],
      _defaultVisibleEdgeKeys: [...defaultVisibleEdgeKeys],
    };
  }

  

  function normalizeConceptScope(config) {
    const scope = config?.scope || {};
    return {
      view: scope.view === "neighbourhood" ? "neighbourhood" : "teaching_path",
      primary_page: scope.primary_page === "current_page_first" ? "current_page_first" : "nav_first",
      max_pages: Math.max(1, numberOr(scope.max_pages, 2)),
      max_ancestor_hops: Math.max(0, numberOr(scope.max_ancestor_hops, 3)),
      max_descendant_hops: Math.max(0, numberOr(scope.max_descendant_hops, 1)),
    };
  }

  function buildConceptEdgeIndexes(filteredEdges) {
    const hierarchyParents = new Map();
    const hierarchyChildren = new Map();
    const hierarchyEdgePages = new Map();
    const pageEdges = [];
    const navEdges = [];
    const keywordRootPages = new Map();

    function pushEntry(map, key, entry) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(entry);
    }

    function addHierarchyEdgePage(parentId, childId, pageUrl) {
      if (!pageUrl || pageUrl === "__nav__") return;
      const key = `${parentId}->${childId}`;
      if (!hierarchyEdgePages.has(key)) hierarchyEdgePages.set(key, new Set());
      hierarchyEdgePages.get(key).add(pageUrl);
    }

    filteredEdges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);

      if (edge.relation === "hierarchy" && sourceId.startsWith("kw:") && targetId.startsWith("kw:")) {
        pushEntry(hierarchyParents, targetId, { parentId: sourceId, edge });
        pushEntry(hierarchyChildren, sourceId, { childId: targetId, edge });
        if (Array.isArray(edge.pages)) {
          edge.pages.forEach((pageUrl) => addHierarchyEdgePage(sourceId, targetId, pageUrl));
        }
        return;
      }

      if (edge.relation === "page") {
        pageEdges.push(edge);
        const pageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
        const kwId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
        if (pageId && kwId) {
          const pageUrl = pageId.replace(/^page:/, "");
          if (!keywordRootPages.has(kwId)) keywordRootPages.set(kwId, new Set());
          keywordRootPages.get(kwId).add(pageUrl);
        }
        return;
      }

      if (edge.relation === "nav") {
        navEdges.push(edge);
      }
    });

    return {
      hierarchyParents,
      hierarchyChildren,
      hierarchyEdgePages,
      pageEdges,
      navEdges,
      keywordRootPages,
    };
  }

  function sortPageUrlsByNav(urls, graph) {
    const sortByNav = (a, b) => {
      const nodeA = graph.nodes.find((node) => node.type === "page" && node.url === a);
      const nodeB = graph.nodes.find((node) => node.type === "page" && node.url === b);
      return (nodeA?.label || a).localeCompare(nodeB?.label || b, undefined, { numeric: true });
    };
    return [...urls].sort(sortByNav);
  }

  function immediateHierarchyParentOnPage(targetNodeId, pageUrl, hierarchyParents, hierarchyEdgePages) {
    for (const { parentId } of hierarchyParents.get(targetNodeId) || []) {
      const edgePages = hierarchyEdgePages.get(`${parentId}->${targetNodeId}`) || new Set();
      if (!edgePages.size || edgePages.has(pageUrl)) return parentId;
    }
    return null;
  }

  function selectDiverseTeachingPages(urls, graph, maxPages, targetNodeId, indexes) {
    const { hierarchyParents, hierarchyEdgePages } = indexes;
    const selected = [];
    const seenParents = new Set();
    for (const pageUrl of sortPageUrlsByNav(urls, graph)) {
      const parentKey = immediateHierarchyParentOnPage(
        targetNodeId,
        pageUrl,
        hierarchyParents,
        hierarchyEdgePages
      ) || `page:${pageUrl}`;
      if (seenParents.has(parentKey)) continue;
      seenParents.add(parentKey);
      selected.push(pageUrl);
      if (selected.length >= maxPages) break;
    }
    return selected;
  }

  function isModulePageUrl(pageUrl) {
    return Boolean(pageUrl) && String(pageUrl).includes("modules/");
  }

  function collectConceptMentionModulePageUrls(targetNodeId, indexes, graph) {
    const {
      hierarchyParents,
      hierarchyChildren,
      hierarchyEdgePages,
      keywordRootPages,
    } = indexes;
    const pageUrls = new Set();

    (keywordRootPages.get(targetNodeId) || new Set()).forEach((pageUrl) => {
      if (isModulePageUrl(pageUrl)) pageUrls.add(pageUrl);
    });

    (hierarchyParents.get(targetNodeId) || []).forEach(({ parentId }) => {
      const edgePages = hierarchyEdgePages.get(`${parentId}->${targetNodeId}`) || new Set();
      edgePages.forEach((pageUrl) => {
        if (isModulePageUrl(pageUrl)) pageUrls.add(pageUrl);
      });
    });

    (hierarchyChildren.get(targetNodeId) || []).forEach(({ childId }) => {
      const edgePages = hierarchyEdgePages.get(`${targetNodeId}->${childId}`) || new Set();
      edgePages.forEach((pageUrl) => {
        if (isModulePageUrl(pageUrl)) pageUrls.add(pageUrl);
      });
    });

    return sortPageUrlsByNav([...pageUrls], graph);
  }

  function computeConceptMentionModuleVisibility(graph, targetNode, pageContextUrl = null) {
    if (!targetNode || targetNode.type !== "keyword") return null;
    const config = resolveViewConfig(graph, "concept");
    if (!graphEnabled(graph, "concept")) return null;
    const scope = normalizeConceptScope(config);
    const neighbourhood = prepareConceptGraphNeighbourhood(graph, targetNode, config);
    return buildConceptTeachingPath(
      graph,
      targetNode,
      neighbourhood.edges,
      scope,
      pageContextUrl
    );
  }

  function selectPrimaryPageUrls(candidatePageUrls, graph, scope, pageContextUrl, targetNodeId = null, indexes = null) {
    const urls = [...new Set(candidatePageUrls)].filter(Boolean);
    if (!urls.length) return [];

    if (pageContextUrl && urls.includes(pageContextUrl)) {
      return [pageContextUrl];
    }

    if (targetNodeId && indexes) {
      return selectDiverseTeachingPages(urls, graph, scope.max_pages, targetNodeId, indexes);
    }

    return sortPageUrlsByNav(urls, graph).slice(0, scope.max_pages);
  }

  function pageScopedHierarchyParents(keywordId, pageUrl, hierarchyParents, hierarchyEdgePages) {
    return (hierarchyParents.get(keywordId) || []).filter(({ parentId }) => {
      const edgePages = hierarchyEdgePages.get(`${parentId}->${keywordId}`) || new Set();
      return !edgePages.size || edgePages.has(pageUrl);
    });
  }

  function pageScopedHierarchyChildren(keywordId, pageUrl, hierarchyChildren, hierarchyEdgePages) {
    return (hierarchyChildren.get(keywordId) || []).filter(({ childId }) => {
      const edgePages = hierarchyEdgePages.get(`${keywordId}->${childId}`) || new Set();
      return !edgePages.size || edgePages.has(pageUrl);
    });
  }

  function findPageRootKeywordIds(pageUrl, pageEdges) {
    const pageId = `page:${pageUrl}`;
    const roots = new Set();
    pageEdges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      if (sourceId === pageId && targetId.startsWith("kw:")) roots.add(targetId);
      if (targetId === pageId && sourceId.startsWith("kw:")) roots.add(sourceId);
    });
    return roots;
  }

  function collectTeachingStoryAncestors(keywordId, pageUrl, maxHops, hierarchyParents, hierarchyEdgePages, pageRootIds) {
    const keywordIds = new Set([keywordId]);
    const edges = [];
    let current = keywordId;

    for (let depth = 0; depth < maxHops; depth++) {
      const parents = pageScopedHierarchyParents(current, pageUrl, hierarchyParents, hierarchyEdgePages);
      if (!parents.length) break;

      let picked = parents[0];
      if (parents.length > 1) {
        const pageRootParent = parents.find(({ parentId }) => pageRootIds.has(parentId));
        if (!pageRootParent) break;
        picked = pageRootParent;
      }

      keywordIds.add(picked.parentId);
      edges.push(picked.edge);
      current = picked.parentId;
      if (pageRootIds.has(current)) break;
    }

    return { keywordIds, edges };
  }

  function findShortestTeachingPathToTarget(keywordId, pageUrl, maxHops, pageRootIds, hierarchyChildren, hierarchyEdgePages) {
    const roots = [...pageRootIds].filter(Boolean);
    if (!roots.length) return null;
    if (roots.includes(keywordId)) return { keywordIds: new Set([keywordId]), edges: [], pageLinkKeywordId: keywordId };

    const queue = roots.map((rootId) => ({
      id: rootId,
      ids: [rootId],
      edges: [],
    }));
    const seen = new Set(roots);
    const maxDepth = Math.max(1, maxHops);

    while (queue.length) {
      const current = queue.shift();
      if (current.edges.length >= maxDepth) continue;

      const children = pageScopedHierarchyChildren(current.id, pageUrl, hierarchyChildren, hierarchyEdgePages)
        .sort((a, b) => {
          const labelA = a.edge?.target || a.childId;
          const labelB = b.edge?.target || b.childId;
          return String(labelA).localeCompare(String(labelB));
        });

      for (const { childId, edge } of children) {
        const nextIds = [...current.ids, childId];
        const nextEdges = [...current.edges, edge];
        if (childId === keywordId) {
          return {
            keywordIds: new Set(nextIds),
            edges: nextEdges,
            pageLinkKeywordId: nextIds[0],
          };
        }
        if (seen.has(childId)) continue;
        seen.add(childId);
        queue.push({ id: childId, ids: nextIds, edges: nextEdges });
      }
    }

    return null;
  }

  function findLongestTeachingPathOnPageHierarchy(keywordId, pageUrl, maxHops, pageRootIds, pageHierarchyEdges) {
    const pageEdges = (pageHierarchyEdges || []).filter((edge) => edge.page === pageUrl);
    if (!pageEdges.length) return null;

    const roots = [...pageRootIds].filter(Boolean);
    if (!roots.length) return null;
    if (roots.includes(keywordId)) {
      return { keywordIds: new Set([keywordId]), edges: [], pageLinkKeywordId: keywordId };
    }

    const childrenByParent = new Map();
    pageEdges.forEach((edge) => {
      if (!childrenByParent.has(edge.source)) childrenByParent.set(edge.source, []);
      childrenByParent.get(edge.source).push({
        childId: edge.target,
        edge: {
          source: edge.source,
          target: edge.target,
          relation: "hierarchy",
          pages: [pageUrl],
        },
      });
    });

    let best = null;

    function visit(currentId, ids, pathEdges) {
      if (currentId === keywordId) {
        if (!best || pathEdges.length > best.edges.length) {
          best = {
            keywordIds: new Set(ids),
            edges: pathEdges.slice(),
            pageLinkKeywordId: ids[0],
          };
        }
        return;
      }
      if (pathEdges.length >= maxHops) return;

      const children = (childrenByParent.get(currentId) || [])
        .slice()
        .sort((a, b) => String(a.childId).localeCompare(String(b.childId)));
      children.forEach(({ childId, edge }) => {
        if (ids.includes(childId)) return;
        visit(childId, [...ids, childId], [...pathEdges, edge]);
      });
    }

    roots.forEach((rootId) => visit(rootId, [rootId], []));
    return best;
  }

  function buildPageHierarchyIndexes(pageUrl, pageHierarchyEdges) {
    const childrenByParent = new Map();
    const parentsByChild = new Map();

    (pageHierarchyEdges || [])
      .filter((edge) => edge.page === pageUrl)
      .forEach((edge) => {
        const hierarchyEdge = {
          source: edge.source,
          target: edge.target,
          relation: "hierarchy",
          pages: [pageUrl],
        };
        if (!childrenByParent.has(edge.source)) childrenByParent.set(edge.source, []);
        childrenByParent.get(edge.source).push({ childId: edge.target, edge: hierarchyEdge });
        if (!parentsByChild.has(edge.target)) parentsByChild.set(edge.target, []);
        parentsByChild.get(edge.target).push({ parentId: edge.source, edge: hierarchyEdge });
      });

    return { childrenByParent, parentsByChild };
  }

  function augmentPageHierarchyTeachingPathWithRootBranches(
    teachingPath,
    pageUrl,
    pageRootIds,
    pageHierarchyEdges,
    focalKeywordId = null
  ) {
    if (!teachingPath) return null;

    const { childrenByParent, parentsByChild } = buildPageHierarchyIndexes(pageUrl, pageHierarchyEdges);
    const primaryPathIds = new Set(teachingPath.keywordIds);
    const keywordIds = new Set(teachingPath.keywordIds);
    const edges = [...teachingPath.edges];
    const participatingPageRoots = new Set(
      teachingPath.pageLinkKeywordId ? [teachingPath.pageLinkKeywordId] : []
    );
    const seenEdgeKeys = new Set(edges.map((edge) => graphEdgeKey(edge)));

    function addHierarchyEdge(edge) {
      const key = graphEdgeKey(edge);
      if (seenEdgeKeys.has(key)) return;
      seenEdgeKeys.add(key);
      edges.push(edge);
    }

    function expandCoChildren(parentId) {
      (childrenByParent.get(parentId) || []).forEach(({ childId, edge }) => {
        keywordIds.add(childId);
        addHierarchyEdge(edge);
      });
    }

    [...teachingPath.keywordIds].forEach((keywordId) => {
      (parentsByChild.get(keywordId) || []).forEach(({ parentId }) => {
        if (!pageRootIds.has(parentId)) return;
        participatingPageRoots.add(parentId);
        keywordIds.add(parentId);
        expandCoChildren(parentId);
      });
    });

    if (focalKeywordId) {
      (parentsByChild.get(focalKeywordId) || []).forEach(({ parentId }) => {
        if (!primaryPathIds.has(parentId)) return;
        expandCoChildren(parentId);
      });
    }

    return {
      keywordIds,
      edges,
      pageLinkKeywordId: teachingPath.pageLinkKeywordId,
      participatingPageRoots,
    };
  }

  function pageHierarchyDefinesParentChild(parentId, childId, pageUrl, pageHierarchyEdges) {
    return (pageHierarchyEdges || []).some((edge) =>
      edge.page === pageUrl && edge.source === parentId && edge.target === childId
    );
  }

  function collectPageHierarchyDescendantFamily(keywordId, pageUrl, maxHops, pageHierarchyEdges) {
    const { childrenByParent } = buildPageHierarchyIndexes(pageUrl, pageHierarchyEdges);
    const keywordIds = new Set([keywordId]);
    const edges = [];
    const seenEdgeKeys = new Set();
    let frontier = [keywordId];

    for (let depth = 0; depth < maxHops && frontier.length; depth++) {
      const nextFrontier = [];
      frontier.forEach((currentId) => {
        const children = (childrenByParent.get(currentId) || [])
          .slice()
          .sort((a, b) => String(a.childId).localeCompare(String(b.childId)));
        children.forEach(({ childId, edge }) => {
          const edgeKey = graphEdgeKey(edge);
          if (!seenEdgeKeys.has(edgeKey)) {
            seenEdgeKeys.add(edgeKey);
            edges.push(edge);
          }
          keywordIds.add(childId);
          nextFrontier.push(childId);
        });
      });
      frontier = nextFrontier;
    }

    return { keywordIds, edges };
  }

  function mergeTeachingPathParts(...parts) {
    const keywordIds = new Set();
    const edges = [];
    const seenEdgeKeys = new Set();
    let pageLinkKeywordId = null;
    let participatingPageRoots = null;

    parts.forEach((part) => {
      if (!part) return;
      part.keywordIds.forEach((id) => keywordIds.add(id));
      part.edges.forEach((edge) => {
        const key = graphEdgeKey(edge);
        if (seenEdgeKeys.has(key)) return;
        seenEdgeKeys.add(key);
        edges.push(edge);
      });
      if (part.pageLinkKeywordId) pageLinkKeywordId = part.pageLinkKeywordId;
      if (part.participatingPageRoots?.size) {
        if (!participatingPageRoots) participatingPageRoots = new Set();
        part.participatingPageRoots.forEach((id) => participatingPageRoots.add(id));
      }
    });

    return { keywordIds, edges, pageLinkKeywordId, participatingPageRoots };
  }

  function buildPageHierarchyTeachingPath(
    keywordId,
    pageUrl,
    maxAncestorHops,
    maxDescendantHops,
    pageRootIds,
    pageHierarchyEdges
  ) {
    const primaryPath = findLongestTeachingPathOnPageHierarchy(
      keywordId,
      pageUrl,
      maxAncestorHops,
      pageRootIds,
      pageHierarchyEdges
    );
    if (!primaryPath) return null;
    return mergeTeachingPathParts(
      augmentPageHierarchyTeachingPathWithRootBranches(
        primaryPath,
        pageUrl,
        pageRootIds,
        pageHierarchyEdges,
        keywordId
      ),
      collectPageHierarchyDescendantFamily(
        keywordId,
        pageUrl,
        maxDescendantHops,
        pageHierarchyEdges
      )
    );
  }

  function collectTeachingStoryDescendants(keywordId, pageUrl, maxHops, hierarchyChildren, hierarchyEdgePages) {
    const keywordIds = new Set([keywordId]);
    const edges = [];
    const seenEdgeKeys = new Set();
    let frontier = [keywordId];

    for (let depth = 0; depth < maxHops && frontier.length; depth++) {
      const nextFrontier = [];
      frontier.forEach((currentId) => {
        const children = pageScopedHierarchyChildren(currentId, pageUrl, hierarchyChildren, hierarchyEdgePages)
          .sort((a, b) => {
            const labelA = a.edge?.target || a.childId;
            const labelB = b.edge?.target || b.childId;
            return String(labelA).localeCompare(String(labelB));
          });
        children.forEach(({ childId, edge }) => {
          const edgeKey = graphEdgeKey(edge);
          if (!seenEdgeKeys.has(edgeKey)) {
            seenEdgeKeys.add(edgeKey);
            edges.push(edge);
          }
          keywordIds.add(childId);
          nextFrontier.push(childId);
        });
      });
      frontier = nextFrontier;
    }

    return { keywordIds, edges };
  }

  function collectPageScopedSiblings(keywordId, pageUrl, sourceEdges, pageHierarchyEdges) {
    const keywordIds = new Set();
    const edges = [];
    (sourceEdges || []).forEach((edge) => {
      if (edge.relation !== "sibling") return;
      const pages = Array.isArray(edge.pages) ? edge.pages : [];
      if (!pages.includes(pageUrl)) return;
      const source = edgeSourceId(edge);
      const target = edgeTargetId(edge);
      if (source !== keywordId && target !== keywordId) return;
      const otherId = source === keywordId ? target : source;
      if (pageHierarchyDefinesParentChild(keywordId, otherId, pageUrl, pageHierarchyEdges)) return;
      if (pageHierarchyDefinesParentChild(otherId, keywordId, pageUrl, pageHierarchyEdges)) return;
      keywordIds.add(otherId);
      edges.push(edge);
    });
    return { keywordIds, edges };
  }

  function findPageIndexVariableKeywordId(
    graph,
    pageUrl,
    pageRootIds,
    hierarchyChildren,
    hierarchyEdgePages,
    maxSearchHops = 8
  ) {
    const pageId = `page:${pageUrl}`;
    const pageRootHit = (graph.edges || []).find((edge) => {
      if (edge.relation !== "page") return false;
      const keywordId = edge.source === pageId
        ? edge.target
        : (edge.target === pageId ? edge.source : null);
      if (!keywordId || !String(keywordId).startsWith("kw:")) return false;
      const label = graph.nodes.find((node) => node.id === keywordId)?.label || "";
      return /index variable/i.test(label);
    });
    if (pageRootHit) {
      const keywordId = pageRootHit.source === pageId ? pageRootHit.target : pageRootHit.source;
      if (keywordId) return keywordId;
    }

    const visited = new Set();
    let frontier = [...pageRootIds];
    for (let depth = 0; depth < maxSearchHops && frontier.length; depth++) {
      const nextFrontier = [];
      frontier.forEach((keywordId) => {
        if (visited.has(keywordId)) return;
        visited.add(keywordId);
        const label = graph.nodes.find((node) => node.id === keywordId)?.label || "";
        if (/index variable/i.test(label)) {
          nextFrontier.indexVariableHit = keywordId;
          return;
        }
        pageScopedHierarchyChildren(keywordId, pageUrl, hierarchyChildren, hierarchyEdgePages)
          .forEach(({ childId }) => {
            if (!visited.has(childId)) nextFrontier.push(childId);
          });
      });
      if (nextFrontier.indexVariableHit) return nextFrontier.indexVariableHit;
      frontier = nextFrontier;
    }
    return null;
  }

  function findPageRootKeywordIdByLabel(graph, pageRootIds, labelPattern) {
    for (const keywordId of pageRootIds) {
      const label = graph.nodes.find((node) => node.id === keywordId)?.label || "";
      if (labelPattern.test(label)) return keywordId;
    }
    return null;
  }

  function buildIndexVariableTeachingAugment(
    graph,
    pageUrl,
    focalId,
    pageRootIds,
    hierarchyParents,
    hierarchyChildren,
    hierarchyEdgePages,
    maxAncestorHops,
    sourceEdges
  ) {
    const indexVarRoot = findPageIndexVariableKeywordId(
      graph,
      pageUrl,
      pageRootIds,
      hierarchyChildren,
      hierarchyEdgePages
    );
    if (!indexVarRoot || !pageRootIds.has(focalId) || indexVarRoot === focalId) return null;

    const pageSiblings = collectPageScopedSiblings(focalId, pageUrl, sourceEdges, graph.page_hierarchy_edges);
    if (!pageSiblings.keywordIds.size) return null;

    const keywordIds = new Set([focalId]);
    const edges = [];
    const pages = [pageUrl];
    const seenEdgeKeys = new Set();

    function addHierarchyEdge(sourceId, targetId) {
      const edge = {
        source: sourceId,
        target: targetId,
        relation: "hierarchy",
        pages,
      };
      const key = graphEdgeKey(edge);
      if (seenEdgeKeys.has(key)) return;
      seenEdgeKeys.add(key);
      edges.push(edge);
      keywordIds.add(sourceId);
      keywordIds.add(targetId);
    }

    const indexAncestors = collectTeachingStoryAncestors(
      indexVarRoot,
      pageUrl,
      maxAncestorHops,
      hierarchyParents,
      hierarchyEdgePages,
      pageRootIds
    );
    indexAncestors.keywordIds.forEach((id) => keywordIds.add(id));
    indexAncestors.edges.forEach((edge) => {
      const key = graphEdgeKey(edge);
      if (seenEdgeKeys.has(key)) return;
      seenEdgeKeys.add(key);
      edges.push(edge);
    });
    keywordIds.add(indexVarRoot);

    const computingRoot = findPageRootKeywordIdByLabel(graph, pageRootIds, /^computing$/i);
    if (computingRoot && computingRoot !== indexVarRoot) {
      addHierarchyEdge(computingRoot, indexVarRoot);
    }

    const indexVarSiblings = collectPageScopedSiblings(indexVarRoot, pageUrl, sourceEdges, graph.page_hierarchy_edges);
    indexVarSiblings.keywordIds.forEach((id) => keywordIds.add(id));
    indexVarSiblings.edges.forEach((edge) => {
      const key = graphEdgeKey(edge);
      if (seenEdgeKeys.has(key)) return;
      seenEdgeKeys.add(key);
      edges.push(edge);
    });

    addHierarchyEdge(indexVarRoot, focalId);
    pageSiblings.keywordIds.forEach((siblingId) => {
      keywordIds.add(siblingId);
      if (siblingId !== focalId) addHierarchyEdge(indexVarRoot, siblingId);
    });
    pageSiblings.edges.forEach((edge) => {
      const key = graphEdgeKey(edge);
      if (seenEdgeKeys.has(key)) return;
      seenEdgeKeys.add(key);
      edges.push(edge);
    });

    const pageLinkKeywordId = computingRoot || indexVarRoot;
    const participatingPageRoots = new Set([pageLinkKeywordId]);
    if (computingRoot && indexVarRoot !== computingRoot) participatingPageRoots.add(indexVarRoot);

    return {
      keywordIds,
      edges,
      pageLinkKeywordId,
      participatingPageRoots,
    };
  }

  function resolveTeachingPageLinkKeywordId(
    targetId,
    pageUrl,
    pageRootIds,
    hierarchyParents,
    hierarchyEdgePages,
    nodeIds
  ) {
    let topPageRoot = null;
    let current = targetId;
    const seen = new Set();

    while (current && !seen.has(current)) {
      seen.add(current);
      if (pageRootIds.has(current) && current !== targetId) {
        topPageRoot = current;
      }

      const parents = pageScopedHierarchyParents(current, pageUrl, hierarchyParents, hierarchyEdgePages)
        .filter(({ parentId }) => nodeIds.has(parentId));
      if (!parents.length) break;

      let picked = parents[0];
      if (parents.length > 1) {
        const pageRootParent = parents.find(({ parentId }) => pageRootIds.has(parentId));
        if (!pageRootParent) break;
        picked = pageRootParent;
      }

      current = picked.parentId;
      if (pageRootIds.has(current)) break;
    }

    return topPageRoot;
  }

  function mergeGraphEdges(baseEdges, extraEdges) {
    const seen = new Set();
    const merged = [];
    [...(baseEdges || []), ...(extraEdges || [])].forEach((edge) => {
      const key = graphEdgeKey(edge);
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(edge);
    });
    return merged;
  }

  function collectScopedHierarchyAncestors(keywordId, pageScope, maxHops, hierarchyParents, hierarchyEdgePages) {
    const keywordIds = new Set([keywordId]);
    const edges = [];
    const seen = new Set();
    const stack = [{ id: keywordId, depth: 0, pageScope: new Set(pageScope) }];

    while (stack.length) {
      const { id, depth, pageScope: scope } = stack.pop();
      const scopeKey = `${id}@@${[...scope].sort().join("|")}`;
      if (seen.has(scopeKey)) continue;
      seen.add(scopeKey);

      (hierarchyParents.get(id) || []).forEach(({ parentId, edge }) => {
        const edgePages = hierarchyEdgePages.get(`${parentId}->${id}`) || new Set();
        const matchingPages = [...edgePages].filter((pageUrl) => scope.has(pageUrl));
        if (edgePages.size && !matchingPages.length) return;

        keywordIds.add(parentId);
        keywordIds.add(id);
        edges.push(edge);

        if (depth < maxHops) {
          const nextScope = matchingPages.length ? new Set(matchingPages) : scope;
          stack.push({ id: parentId, depth: depth + 1, pageScope: nextScope });
        }
      });
    }

    return { keywordIds, edges };
  }

  function collectScopedHierarchyDescendants(keywordId, pageScope, maxHops, hierarchyChildren, hierarchyEdgePages) {
    const keywordIds = new Set([keywordId]);
    const edges = [];
    const seen = new Set();
    const stack = [{ id: keywordId, depth: 0, pageScope: new Set(pageScope) }];

    while (stack.length) {
      const { id, depth, pageScope: scope } = stack.pop();
      const scopeKey = `${id}@@${[...scope].sort().join("|")}`;
      if (seen.has(scopeKey)) continue;
      seen.add(scopeKey);

      (hierarchyChildren.get(id) || []).forEach(({ childId, edge }) => {
        const edgePages = hierarchyEdgePages.get(`${id}->${childId}`) || new Set();
        const matchingPages = [...edgePages].filter((pageUrl) => scope.has(pageUrl));
        if (edgePages.size && !matchingPages.length) return;

        keywordIds.add(id);
        keywordIds.add(childId);
        edges.push(edge);

        if (depth < maxHops) {
          const nextScope = matchingPages.length ? new Set(matchingPages) : scope;
          stack.push({ id: childId, depth: depth + 1, pageScope: nextScope });
        }
      });
    }

    return { keywordIds, edges };
  }

  function buildVisibleEdgeKeysFromNodes(sourceEdges, visibleNodeIds) {
    const keys = new Set();
    sourceEdges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      if (visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId)) {
        keys.add(graphEdgeKey(edge));
      }
    });
    return keys;
  }

  function hierarchyParentIdList(maps, keywordId) {
    return [...(maps.hierarchyParents.get(keywordId) || new Set())];
  }

  function sortedHierarchyParents(maps, keywordId, preferredNodeIds) {
    return hierarchyParentIdList(maps, keywordId).sort((a, b) => {
      const aPref = preferredNodeIds?.has(a) ? 0 : 1;
      const bPref = preferredNodeIds?.has(b) ? 0 : 1;
      return aPref - bPref || String(a).localeCompare(String(b));
    });
  }

  function hierarchyChildIdList(maps, keywordId) {
    return [...(maps.hierarchyChildren.get(keywordId) || new Set())];
  }

  function sortedHierarchyChildren(maps, keywordId, preferredNodeIds) {
    return hierarchyChildIdList(maps, keywordId).sort((a, b) => {
      const aPref = preferredNodeIds?.has(a) ? 0 : 1;
      const bPref = preferredNodeIds?.has(b) ? 0 : 1;
      return aPref - bPref || String(a).localeCompare(String(b));
    });
  }

  function findShortestHierarchyPathUp(startId, targetId, maps, preferredNodeIds = null) {
    if (startId === targetId) return [startId];
    const queue = [[startId]];
    const seen = new Set([startId]);
    while (queue.length) {
      const path = queue.shift();
      const currentId = path[path.length - 1];
      for (const parentId of sortedHierarchyParents(maps, currentId, preferredNodeIds)) {
        if (seen.has(parentId)) continue;
        seen.add(parentId);
        const nextPath = [...path, parentId];
        if (parentId === targetId) return nextPath;
        queue.push(nextPath);
      }
    }
    return [startId];
  }

  function findShortestHierarchyPathDown(startId, targetId, maps, preferredNodeIds = null) {
    if (startId === targetId) return [startId];
    const queue = [[startId]];
    const seen = new Set([startId]);
    while (queue.length) {
      const path = queue.shift();
      const currentId = path[path.length - 1];
      for (const childId of sortedHierarchyChildren(maps, currentId, preferredNodeIds)) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        const nextPath = [...path, childId];
        if (childId === targetId) return nextPath;
        queue.push(nextPath);
      }
    }
    return null;
  }

  function hierarchyEdgeSharesPage(parentId, childId, maps) {
    const edgePages = maps.hierarchyEdgePages?.get(`${parentId}->${childId}`) || new Set();
    return !edgePages.size || [...edgePages].some((pageUrl) => pageUrl && pageUrl !== "__nav__");
  }

  function findSiblingBridgePath(hoveredId, conceptTargetId, maps, preferredNodeIds = null) {
    let best = null;

    for (const parentId of sortedHierarchyParents(maps, hoveredId, preferredNodeIds)) {
      if (!(maps.hierarchyParents.get(conceptTargetId) || new Set()).has(parentId)) continue;
      if (!hierarchyEdgeSharesPage(parentId, hoveredId, maps)) continue;
      if (!hierarchyEdgeSharesPage(parentId, conceptTargetId, maps)) continue;

      const hoveredPages = maps.hierarchyEdgePages?.get(`${parentId}->${hoveredId}`) || new Set();
      const conceptPages = maps.hierarchyEdgePages?.get(`${parentId}->${conceptTargetId}`) || new Set();
      if (hoveredPages.size && conceptPages.size) {
        const shared = [...hoveredPages].some((pageUrl) => conceptPages.has(pageUrl));
        if (!shared) continue;
      }

      const upPath = findShortestHierarchyPathUp(hoveredId, parentId, maps, preferredNodeIds);
      const path = upPath.includes(conceptTargetId) ? upPath : [...upPath, conceptTargetId];
      if (!best || path.length < best.length) best = path;
    }

    return best;
  }

  function findConceptGraphHierarchyPath(hoveredId, conceptTargetId, maps, preferredNodeIds = null) {
    if (hoveredId === conceptTargetId) return [hoveredId];
    const downPath = findShortestHierarchyPathDown(hoveredId, conceptTargetId, maps, preferredNodeIds);
    if (downPath) return downPath;
    const upPath = findShortestHierarchyPathUp(hoveredId, conceptTargetId, maps, preferredNodeIds);
    if (upPath.length > 1) return upPath;
    const bridgePath = findSiblingBridgePath(hoveredId, conceptTargetId, maps, preferredNodeIds);
    if (bridgePath) return bridgePath;
    return [hoveredId, conceptTargetId];
  }

  function addNavAncestorNodesForPageId(pageId, maps, highlight) {
    const stack = [pageId];
    const seen = new Set();
    while (stack.length) {
      const currentId = stack.pop();
      if (seen.has(currentId)) continue;
      seen.add(currentId);
      (maps.pageNavParents.get(currentId) || new Set()).forEach((parentId) => {
        if (highlight.has(parentId) && seen.has(parentId)) return;
        highlight.add(parentId);
        stack.push(parentId);
      });
    }
  }

  function addNavDescendantNodesForPageId(pageId, maps, highlight) {
    const stack = [pageId];
    const seen = new Set();
    while (stack.length) {
      const currentId = stack.pop();
      if (seen.has(currentId)) continue;
      seen.add(currentId);
      (maps.pageNavChildren?.get(currentId) || new Set()).forEach((childId) => {
        if (highlight.has(childId) && seen.has(childId)) return;
        highlight.add(childId);
        stack.push(childId);
      });
    }
  }

  function addPageAndCategoryForPageId(pageId, maps, highlight, options = {}) {
    if (!pageId) return;
    highlight.add(pageId);
    addNavAncestorNodesForPageId(pageId, maps, highlight);
    if (options.includeDescendants) addNavDescendantNodesForPageId(pageId, maps, highlight);
  }

  function pageScopedHierarchyParentIds(keywordId, pageUrl, maps, preferredNodeIds = null) {
    return [...(maps.hierarchyParents.get(keywordId) || new Set())]
      .filter((parentId) => {
        const edgePages = maps.hierarchyEdgePages?.get(`${parentId}->${keywordId}`) || new Set();
        return !edgePages.size || edgePages.has(pageUrl);
      })
      .sort((a, b) => {
        const aPref = preferredNodeIds?.has(a) ? 0 : 1;
        const bPref = preferredNodeIds?.has(b) ? 0 : 1;
        return aPref - bPref || String(a).localeCompare(String(b));
      });
  }

  function collectPageScopedAncestorChain(keywordId, pageUrl, maps, preferredNodeIds = null, maxHops = 16) {
    const chain = [];
    let currentId = keywordId;
    const seen = new Set([currentId]);

    for (let depth = 0; depth < maxHops; depth++) {
      const parents = pageScopedHierarchyParentIds(currentId, pageUrl, maps, preferredNodeIds);
      if (!parents.length) break;
      const parentId = parents[0];
      if (seen.has(parentId)) break;
      seen.add(parentId);
      chain.push(parentId);
      currentId = parentId;
    }

    return chain;
  }

  function normalizePageUrl(pageRef) {
    if (!pageRef) return null;
    const pageUrl = pageRef.startsWith("page:") ? pageRef.slice(5) : pageRef;
    return pageUrl && pageUrl !== "__nav__" ? pageUrl : null;
  }

  function collectHoveredKeywordPageUrls(hoveredId, maps, visibleNodeIds = null) {
    const pageUrls = new Set();
    if (!hoveredId) return pageUrls;

    (maps.keywordPages.get(hoveredId) || new Set()).forEach((pageRef) => {
      const pageUrl = normalizePageUrl(pageRef);
      if (!pageUrl) return;
      const pageId = `page:${pageUrl}`;
      if (visibleNodeIds && !visibleNodeIds.has(pageId)) return;
      pageUrls.add(pageUrl);
    });

    return pageUrls;
  }

  function collectPageLocalPathContext(pathKeywordIds, conceptTargetId, maps, highlight, preferredNodeIds = null, visibleNodeIds = null) {
    const hoveredId = pathKeywordIds?.[0];
    if (!hoveredId) return highlight;

    const pageUrls = collectHoveredKeywordPageUrls(hoveredId, maps, visibleNodeIds);

    pageUrls.forEach((pageUrl) => {
      if (conceptTargetId) {
        collectPageScopedAncestorChain(conceptTargetId, pageUrl, maps, preferredNodeIds).forEach((id) => {
          highlight.add(id);
        });
        collectPageScopedAncestorChain(hoveredId, pageUrl, maps, preferredNodeIds).forEach((id) => {
          highlight.add(id);
        });
      }
      addPageAndCategoryForPageId(`page:${pageUrl}`, maps, highlight);
    });

    return highlight;
  }

  function resolveTeachingPathPageId(pageRef) {
    if (!pageRef) return null;
    return pageRef.startsWith("page:") ? pageRef : `page:${pageRef}`;
  }

  function collectTeachingPathPrefixFromRoot(rootKeywordId, teachingPathNodeIds, maps) {
    const highlight = new Set();
    if (!rootKeywordId || !teachingPathNodeIds?.has(rootKeywordId)) return highlight;

    let currentId = rootKeywordId;
    highlight.add(currentId);
    const seenKeywords = new Set([currentId]);

    for (let depth = 0; depth < 32; depth++) {
      const parents = sortedHierarchyParents(maps, currentId, teachingPathNodeIds)
        .filter((parentId) => teachingPathNodeIds.has(parentId));
      if (!parents.length) break;
      const parentId = parents[0];
      if (seenKeywords.has(parentId)) break;
      seenKeywords.add(parentId);
      highlight.add(parentId);
      currentId = parentId;
    }

    for (const keywordId of [...highlight]) {
      if (!keywordId.startsWith("kw:")) continue;
      const pageRefs = maps.keywordPages.get(keywordId);
      if (!pageRefs) continue;
      pageRefs.forEach((pageRef) => {
        const pageId = resolveTeachingPathPageId(pageRef);
        if (pageId && teachingPathNodeIds.has(pageId)) highlight.add(pageId);
      });
    }

    for (const nodeId of [...highlight]) {
      if (!nodeId.startsWith("page:")) continue;
      const navContext = new Set();
      addNavAncestorNodesForPageId(nodeId, maps, navContext);
      navContext.forEach((parentId) => {
        if (teachingPathNodeIds.has(parentId)) highlight.add(parentId);
      });
    }

    return highlight;
  }

  function resolveGraphPageUrl(node) {
    if (!node) return "";
    if (node.url) return node.url;
    if (node.id?.startsWith("page:")) return node.id.slice(5);
    return "";
  }

  function collectPageModulePathHighlight(
    hoveredPageId,
    pageUrl,
    conceptTargetId,
    teachingPathNodeIds,
    maps,
    sourceEdges,
    visibleNodeIds = null,
    teachingPathByPage = null
  ) {
    const highlight = new Set();
    if (!hoveredPageId || !pageUrl) return highlight;

    highlight.add(hoveredPageId);
    addPageAndCategoryForPageId(hoveredPageId, maps, highlight, { includeDescendants: true });

    const family = teachingPathByPage?.[pageUrl];
    if ((family?.keywordIds || []).length) {
      family.keywordIds.forEach((keywordId) => {
        if (!keywordId.startsWith("kw:")) return;
        if (visibleNodeIds && !visibleNodeIds.has(keywordId)) return;
        highlight.add(keywordId);
      });
      if (visibleNodeIds) {
        [...highlight].forEach((id) => {
          if (!visibleNodeIds.has(id)) highlight.delete(id);
        });
      }
      [...highlight].forEach((id) => {
        if (!id.startsWith("page:") || id === hoveredPageId) return;
        highlight.delete(id);
      });
      return highlight;
    }

    const preferred = teachingPathNodeIds;
    const seedKeywords = new Set();

    (sourceEdges || []).forEach((edge) => {
      if (edge.relation === "page") {
        const source = edgeSourceId(edge);
        const target = edgeTargetId(edge);
        const kwId = source.startsWith("kw:") ? source : (target.startsWith("kw:") ? target : null);
        const pageId = source.startsWith("page:") ? source : (target.startsWith("page:") ? target : null);
        if (pageId === hoveredPageId && kwId) seedKeywords.add(kwId);
        return;
      }
      if (edge.relation !== "hierarchy") return;
      const pages = Array.isArray(edge.pages) ? edge.pages : [];
      if (!pages.includes(pageUrl)) return;
      const source = edgeSourceId(edge);
      const target = edgeTargetId(edge);
      if (source.startsWith("kw:")) seedKeywords.add(source);
      if (target.startsWith("kw:")) seedKeywords.add(target);
    });

    const queue = [...seedKeywords];
    const seenKeywords = new Set();
    while (queue.length) {
      const kwId = queue.shift();
      if (seenKeywords.has(kwId)) continue;
      seenKeywords.add(kwId);
      if (visibleNodeIds && !visibleNodeIds.has(kwId)) continue;
      highlight.add(kwId);

      collectPageScopedAncestorChain(kwId, pageUrl, maps, preferred).forEach((parentId) => {
        if (visibleNodeIds && !visibleNodeIds.has(parentId)) return;
        highlight.add(parentId);
        if (parentId.startsWith("kw:") && !seenKeywords.has(parentId)) queue.push(parentId);
      });

      sortedHierarchyChildren(maps, kwId, preferred).forEach((childId) => {
        const edgePages = maps.hierarchyEdgePages?.get(`${kwId}->${childId}`) || new Set();
        if (edgePages.size && !edgePages.has(pageUrl)) return;
        if (!seenKeywords.has(childId)) queue.push(childId);
      });
    }

    if (conceptTargetId) {
      const focalPageRefs = maps.keywordPages?.get(conceptTargetId) || new Set();
      const focalOnPage = focalPageRefs.has(pageUrl) || focalPageRefs.has(hoveredPageId);
      if (focalOnPage) {
        highlight.add(conceptTargetId);
        collectPageScopedAncestorChain(conceptTargetId, pageUrl, maps, preferred).forEach((id) => {
          if (!visibleNodeIds || visibleNodeIds.has(id)) highlight.add(id);
        });
      }
    }

    if (visibleNodeIds) {
      [...highlight].forEach((id) => {
        if (!visibleNodeIds.has(id)) highlight.delete(id);
      });
    }

    [...highlight].forEach((id) => {
      if (!id.startsWith("page:") || id === hoveredPageId) return;
      highlight.delete(id);
    });

    return highlight;
  }

  function buildTeachingFamilyHierarchyIndexes(family) {
    const parentsByChild = new Map();
    const childrenByParent = new Map();
    (family?.edges || []).forEach((edge) => {
      if (edge.relation !== "hierarchy") return;
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      if (!sourceId.startsWith("kw:") || !targetId.startsWith("kw:")) return;
      if (!parentsByChild.has(targetId)) parentsByChild.set(targetId, []);
      parentsByChild.get(targetId).push(sourceId);
      if (!childrenByParent.has(sourceId)) childrenByParent.set(sourceId, []);
      childrenByParent.get(sourceId).push(targetId);
    });
    return { parentsByChild, childrenByParent };
  }

  function sortedTeachingParents(childId, family, options = {}) {
    const { parentsByChild } = buildTeachingFamilyHierarchyIndexes(family);
    const excludeParents = options.excludeParents || new Set();
    const pageLinkKeywordId = family?.pageLinkKeywordId || null;
    return (parentsByChild.get(childId) || [])
      .filter((parentId) => !excludeParents.has(parentId))
      .sort((a, b) => {
        if (pageLinkKeywordId) {
          if (a === pageLinkKeywordId) return -1;
          if (b === pageLinkKeywordId) return 1;
        }
        return String(a).localeCompare(String(b));
      });
  }

  function findUpwardPathInTeachingFamily(startId, endId, family, options = {}) {
    if (!family || startId === endId) return [startId];
    const keywordSet = new Set(family.keywordIds || []);
    if (!keywordSet.has(startId) || !keywordSet.has(endId)) return [startId];

    const queue = [{ id: startId, path: [startId] }];
    const seen = new Set([startId]);

    while (queue.length) {
      const current = queue.shift();
      if (current.id === endId) return current.path;

      for (const parentId of sortedTeachingParents(current.id, family, options)) {
        if (seen.has(parentId)) continue;
        seen.add(parentId);
        queue.push({ id: parentId, path: [...current.path, parentId] });
      }
    }

    return [startId];
  }

  function collectAncestorChainInTeachingFamily(keywordId, family, options = {}) {
    const chain = [];
    const seen = new Set([keywordId]);
    let currentId = keywordId;

    for (let depth = 0; depth < 32; depth++) {
      const parents = sortedTeachingParents(currentId, family, options);
      if (!parents.length) break;
      const parentId = parents[0];
      if (seen.has(parentId)) break;
      seen.add(parentId);
      chain.push(parentId);
      currentId = parentId;
    }

    return chain;
  }

  function collectConceptGraphTeachingTreeHighlight(
    hoveredNode,
    conceptTargetId,
    teachingPathByPage,
    visibleNodeIds,
    maps
  ) {
    const highlight = new Set([hoveredNode.id]);
    const pageUrls = collectHoveredKeywordPageUrls(hoveredNode.id, maps, visibleNodeIds);

    pageUrls.forEach((pageUrl) => {
      const family = teachingPathByPage?.[pageUrl];
      if (!family) return;

      const keywordSet = new Set(family.keywordIds || []);
      if (!keywordSet.has(hoveredNode.id)) return;

      const excludeParents = new Set([hoveredNode.id]);

      if (conceptTargetId && keywordSet.has(conceptTargetId)) {
        findUpwardPathInTeachingFamily(hoveredNode.id, conceptTargetId, family, { excludeParents })
          .forEach((id) => highlight.add(id));
        if (hoveredNode.id !== conceptTargetId) {
          if (family.pageLinkKeywordId && keywordSet.has(family.pageLinkKeywordId)) {
            findUpwardPathInTeachingFamily(
              conceptTargetId,
              family.pageLinkKeywordId,
              family
            ).forEach((id) => highlight.add(id));
          } else {
            collectAncestorChainInTeachingFamily(conceptTargetId, family)
              .forEach((id) => highlight.add(id));
          }
        }
      } else if (family.pageLinkKeywordId && keywordSet.has(family.pageLinkKeywordId)) {
        findUpwardPathInTeachingFamily(hoveredNode.id, family.pageLinkKeywordId, family)
          .forEach((id) => highlight.add(id));
      } else {
        collectAncestorChainInTeachingFamily(hoveredNode.id, family)
          .forEach((id) => highlight.add(id));
      }

      const { childrenByParent } = buildTeachingFamilyHierarchyIndexes(family);
      sortedTeachingParents(hoveredNode.id, family, { excludeParents }).forEach((parentId) => {
        if (!keywordSet.has(parentId)) return;
        highlight.add(parentId);
        (childrenByParent.get(parentId) || []).forEach((childId) => {
          if (keywordSet.has(childId)) highlight.add(childId);
        });
      });
      (childrenByParent.get(hoveredNode.id) || []).forEach((childId) => {
        if (keywordSet.has(childId)) highlight.add(childId);
      });

      const pageId = `page:${pageUrl}`;
      if (!visibleNodeIds || visibleNodeIds.has(pageId)) {
        addPageAndCategoryForPageId(pageId, maps, highlight);
      }
    });

    if (visibleNodeIds) {
      [...highlight].forEach((id) => {
        if (!visibleNodeIds.has(id)) highlight.delete(id);
      });
    }

    return highlight;
  }

  function collectConceptGraphPathHighlight(
    hoveredNode,
    conceptTargetId,
    storyPrefixNodeIds,
    teachingPathNodeIds,
    maps,
    visibleNodeIds = null,
    sourceEdges = null,
    teachingPathByPage = null
  ) {
    const highlight = new Set();
    if (!hoveredNode?.id) return highlight;

    highlight.add(hoveredNode.id);

    const prefix = storyPrefixNodeIds?.size
      ? storyPrefixNodeIds
      : collectTeachingPathPrefixFromRoot(conceptTargetId, teachingPathNodeIds, maps);

    if (hoveredNode.type === "keyword" && conceptTargetId) {
      if (teachingPathByPage && Object.keys(teachingPathByPage).length) {
        return collectConceptGraphTeachingTreeHighlight(
          hoveredNode,
          conceptTargetId,
          teachingPathByPage,
          visibleNodeIds,
          maps
        );
      }

      const pathIds = findConceptGraphHierarchyPath(
        hoveredNode.id,
        conceptTargetId,
        maps,
        teachingPathNodeIds
      );
      pathIds.forEach((id) => highlight.add(id));

      if (hoveredNode.id === conceptTargetId) {
        prefix.forEach((id) => highlight.add(id));
      } else {
        collectPageLocalPathContext(
          pathIds,
          conceptTargetId,
          maps,
          highlight,
          teachingPathNodeIds,
          visibleNodeIds
        );
      }
      if (visibleNodeIds) {
        [...highlight].forEach((id) => {
          if (!visibleNodeIds.has(id)) highlight.delete(id);
        });
      }
      return highlight;
    }

    if (hoveredNode.type === "page") {
      return collectPageModulePathHighlight(
        hoveredNode.id,
        resolveGraphPageUrl(hoveredNode),
        conceptTargetId,
        teachingPathNodeIds,
        maps,
        sourceEdges,
        visibleNodeIds,
        teachingPathByPage
      );
    }

    if (hoveredNode.type === "category") {
      highlight.add(hoveredNode.id);
      if (visibleNodeIds) {
        [...highlight].forEach((id) => {
          if (!visibleNodeIds.has(id)) highlight.delete(id);
        });
      }
    }

    return highlight;
  }

  function buildConceptTeachingPath(graph, targetNode, neighbourhoodEdges, scope, pageContextUrl) {
    const indexes = buildConceptEdgeIndexes(neighbourhoodEdges);
    const {
      hierarchyParents,
      hierarchyChildren,
      hierarchyEdgePages,
      pageEdges,
      navEdges,
      keywordRootPages,
    } = indexes;

    const candidatePageUrls = new Set();
    (keywordRootPages.get(targetNode.id) || new Set()).forEach((pageUrl) => candidatePageUrls.add(pageUrl));
    (hierarchyParents.get(targetNode.id) || []).forEach(({ parentId }) => {
      const edgePages = hierarchyEdgePages.get(`${parentId}->${targetNode.id}`) || new Set();
      edgePages.forEach((pageUrl) => candidatePageUrls.add(pageUrl));
    });

    const mentionModulePageUrls = collectConceptMentionModulePageUrls(targetNode.id, indexes, graph);
    let primaryPageUrls = mentionModulePageUrls.length
      ? mentionModulePageUrls
      : selectPrimaryPageUrls(
        candidatePageUrls,
        graph,
        scope,
        pageContextUrl,
        targetNode.id,
        indexes
      );
    if (pageContextUrl && primaryPageUrls.includes(pageContextUrl)) {
      primaryPageUrls = [
        pageContextUrl,
        ...primaryPageUrls.filter((pageUrl) => pageUrl !== pageContextUrl),
      ];
    }
    const primaryStoryPageUrl = pageContextUrl && primaryPageUrls.includes(pageContextUrl)
      ? pageContextUrl
      : (primaryPageUrls[0] || null);
    const storyPrefixNodeIds = new Set([targetNode.id]);
    const nodeIds = new Set([targetNode.id]);
    const conceptEdges = [];
    const pageIds = new Set();
    const seenEdges = new Set();
    const teachingPathByPage = {};

    function addEdge(edge) {
      const key = graphEdgeKey(edge);
      if (seenEdges.has(key)) return;
      seenEdges.add(key);
      conceptEdges.push(edge);
    }

    function rememberTeachingFamily(pageUrl, familyKeywordIds, familyEdges, options = {}) {
      teachingPathByPage[pageUrl] = {
        keywordIds: [...familyKeywordIds],
        edges: familyEdges.slice(),
        usesPageHierarchy: Boolean(options.usesPageHierarchy),
        pageLinkKeywordId: options.pageLinkKeywordId || null,
        participatingPageRoots: options.participatingPageRoots
          ? [...options.participatingPageRoots]
          : (options.pageLinkKeywordId ? [options.pageLinkKeywordId] : []),
      };
    }

    primaryPageUrls.forEach((pageUrl) => {
      const pageRootIds = findPageRootKeywordIds(pageUrl, pageEdges);
      const teachingPathHopLimit = Math.max(scope.max_ancestor_hops, 6);
      const pageHierarchyPath = buildPageHierarchyTeachingPath(
        targetNode.id,
        pageUrl,
        teachingPathHopLimit,
        scope.max_descendant_hops,
        pageRootIds,
        graph.page_hierarchy_edges
      );

      let pageLinkKeywordId = null;
      let usesPageHierarchy = false;
      let participatingPageRoots = null;
      const familyKeywordIds = new Set([targetNode.id]);
      const familyEdges = [];
      const siblings = collectPageScopedSiblings(
        targetNode.id,
        pageUrl,
        neighbourhoodEdges,
        graph.page_hierarchy_edges
      );

      if (pageHierarchyPath) {
        pageHierarchyPath.keywordIds.forEach((id) => {
          familyKeywordIds.add(id);
          nodeIds.add(id);
        });
        pageHierarchyPath.edges.forEach((edge) => {
          familyEdges.push(edge);
          addEdge(edge);
        });
        pageLinkKeywordId = pageHierarchyPath.pageLinkKeywordId;
        usesPageHierarchy = true;
        participatingPageRoots = pageHierarchyPath.participatingPageRoots;
      } else {
        const pageTeachingPath = findShortestTeachingPathToTarget(
          targetNode.id,
          pageUrl,
          teachingPathHopLimit,
          pageRootIds,
          hierarchyChildren,
          hierarchyEdgePages
        );
        const ancestors = pageTeachingPath || collectTeachingStoryAncestors(
          targetNode.id,
          pageUrl,
          scope.max_ancestor_hops,
          hierarchyParents,
          hierarchyEdgePages,
          pageRootIds
        );
        const descendants = collectTeachingStoryDescendants(
          targetNode.id,
          pageUrl,
          scope.max_descendant_hops,
          hierarchyChildren,
          hierarchyEdgePages
        );

        [ancestors, descendants].forEach((part) => {
          part.keywordIds.forEach((id) => familyKeywordIds.add(id));
          part.edges.forEach((edge) => familyEdges.push(edge));
        });

        ancestors.keywordIds.forEach((id) => nodeIds.add(id));
        descendants.keywordIds.forEach((id) => nodeIds.add(id));
        ancestors.edges.forEach(addEdge);
        descendants.edges.forEach(addEdge);

        pageLinkKeywordId = pageTeachingPath?.pageLinkKeywordId || resolveTeachingPageLinkKeywordId(
          targetNode.id,
          pageUrl,
          pageRootIds,
          hierarchyParents,
          hierarchyEdgePages,
          nodeIds
        );
      }

      siblings.keywordIds.forEach((id) => {
        familyKeywordIds.add(id);
        nodeIds.add(id);
      });
      siblings.edges.forEach((edge) => {
        familyEdges.push(edge);
        addEdge(edge);
      });

      const indexAugment = buildIndexVariableTeachingAugment(
        graph,
        pageUrl,
        targetNode.id,
        pageRootIds,
        hierarchyParents,
        hierarchyChildren,
        hierarchyEdgePages,
        scope.max_ancestor_hops,
        neighbourhoodEdges
      );
      if (indexAugment) {
        indexAugment.keywordIds.forEach((id) => {
          familyKeywordIds.add(id);
          nodeIds.add(id);
        });
        indexAugment.edges.forEach((edge) => {
          familyEdges.push(edge);
          addEdge(edge);
        });
        pageLinkKeywordId = indexAugment.pageLinkKeywordId;
        participatingPageRoots = indexAugment.participatingPageRoots;
      }

      rememberTeachingFamily(pageUrl, familyKeywordIds, familyEdges, {
        usesPageHierarchy,
        pageLinkKeywordId,
        participatingPageRoots,
      });

      const pageId = `page:${pageUrl}`;
      nodeIds.add(pageId);
      pageIds.add(pageId);

      const pageLinkKeywordIds = new Set();
      if (pageLinkKeywordId) pageLinkKeywordIds.add(pageLinkKeywordId);
      if (participatingPageRoots?.size) {
        participatingPageRoots.forEach((keywordId) => {
          if (nodeIds.has(keywordId)) pageLinkKeywordIds.add(keywordId);
        });
      }
      if (pageLinkKeywordIds.size) {
        pageLinkKeywordIds.forEach((keywordId) => {
          addEdge({
            source: pageId,
            target: keywordId,
            relation: "page",
            pages: [pageUrl],
          });
        });
      } else {
        pageEdges.forEach((edge) => {
          const sourceId = edgeSourceId(edge);
          const targetId = edgeTargetId(edge);
          const edgePageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
          if (edgePageId !== pageId) return;
          const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
          if (!keywordId || !nodeIds.has(keywordId)) return;
          addEdge(edge);
        });
      }

      navEdges.forEach((edge) => {
        if (edgeTargetId(edge) !== pageId) return;
        addEdge(edge);
        nodeIds.add(edgeSourceId(edge));
      });

      if (pageUrl === primaryStoryPageUrl) {
        (teachingPathByPage[pageUrl]?.keywordIds || []).forEach((id) => storyPrefixNodeIds.add(id));
        storyPrefixNodeIds.add(pageId);
        navEdges.forEach((edge) => {
          if (edgeTargetId(edge) !== pageId) return;
          storyPrefixNodeIds.add(edgeSourceId(edge));
        });
      }
    });

    if (!primaryPageUrls.length) {
      pageEdges.forEach((edge) => {
        const sourceId = edgeSourceId(edge);
        const targetId = edgeTargetId(edge);
        const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
        if (keywordId !== targetNode.id) return;
        addEdge(edge);
        const pageId = sourceId.startsWith("page:") ? sourceId : targetId;
        nodeIds.add(pageId);
        pageIds.add(pageId);
      });
      navEdges.forEach((edge) => {
        if (!pageIds.has(edgeTargetId(edge))) return;
        addEdge(edge);
        nodeIds.add(edgeSourceId(edge));
      });
    }

    return {
      nodeIds,
      edges: conceptEdges,
      edgeKeys: buildVisibleEdgeKeysFromNodes(conceptEdges, nodeIds),
      storyPrefixNodeIds,
      teachingPathByPage,
    };
  }

  function finalizeConceptGraphPayload(graph, targetNode, config, payload, options = {}) {
    const {
      nodeIds,
      edges,
      defaultVisibleNodeIds = null,
      defaultVisibleEdgeKeys = null,
      conceptStoryPrefixNodeIds = null,
      teachingPathByPage = null,
      teachingPathMode = false,
      currentPageUrl = null,
      focusPageUrl = null,
      sourceGraph = null,
    } = payload;

    const nodes = graph.nodes
      .filter((node) => {
        if (!nodeIds.has(node.id)) return false;
        if (node.type === "page" && !config.nodes.show_pages) return false;
        if (node.type === "category" && !config.nodes.show_categories) return false;
        if (node.type === "keyword" && !config.nodes.show_keywords) return false;
        return true;
      })
      .map((node) => ({ ...node }));
    const finalNodeIds = new Set(nodes.map((node) => node.id));
    const finalEdges = edges
      .filter((edge) => finalNodeIds.has(edgeSourceId(edge)) && finalNodeIds.has(edgeTargetId(edge)))
      .map((edge) => ({ ...edge }));

    return {
      nodes,
      edges: finalEdges,
      meta: graph.meta || {},
      _resolvedConfig: deepMerge(config, {
        hover: {
          hops: config.hover?.hops || 1,
          page_scope: config.hover?.page_scope || "all_pages",
        },
        ui: {
          enable_search: false,
        },
      }),
      _currentPageUrl: currentPageUrl || null,
      _focusPageUrl: focusPageUrl || null,
      _sourceGraph: sourceGraph || null,
      _pageFilterApplied: false,
      _highlightContextEdges: finalEdges.filter((edge) => edge.relation === "page" || edge.relation === "nav"),
      _conceptKeyword: targetNode.label,
      _conceptTargetId: targetNode.id,
      _teachingPathMode: teachingPathMode,
      _defaultVisibleNodeIds: defaultVisibleNodeIds ? [...defaultVisibleNodeIds] : null,
      _defaultVisibleEdgeKeys: defaultVisibleEdgeKeys ? [...defaultVisibleEdgeKeys] : null,
      _conceptStoryPrefixNodeIds: Array.isArray(conceptStoryPrefixNodeIds) ? [...conceptStoryPrefixNodeIds] : null,
      _conceptTeachingPathByPage: teachingPathByPage ? { ...teachingPathByPage } : null,
    };
  }

  function prepareConceptGraphNeighbourhood(graph, targetNode, config) {
    const excluded = applyGraphExclusionFilters(graph.nodes, graph.edges, config);
    const filteredEdges = applyRelationFilters(excluded.edges, config);
    const nodeIds = new Set([targetNode.id]);
    const conceptEdges = [];
    const pageIds = new Set();
    const seenConceptEdges = new Set();
    const {
      hierarchyParents,
      hierarchyChildren,
      pageEdges,
      navEdges,
    } = buildConceptEdgeIndexes(filteredEdges);

    function addConceptEdge(edge) {
      const key = graphEdgeKey(edge);
      if (seenConceptEdges.has(key)) return;
      seenConceptEdges.add(key);
      conceptEdges.push(edge);
    }

    function collectAncestors(keywordId) {
      const stack = [keywordId];
      const seen = new Set();
      while (stack.length) {
        const currentId = stack.pop();
        if (seen.has(currentId)) continue;
        seen.add(currentId);
        (hierarchyParents.get(currentId) || []).forEach(({ parentId, edge }) => {
          nodeIds.add(parentId);
          nodeIds.add(currentId);
          addConceptEdge(edge);
          stack.push(parentId);
        });
      }
    }

    function collectDescendants(keywordId) {
      const stack = [keywordId];
      const seen = new Set();
      while (stack.length) {
        const currentId = stack.pop();
        if (seen.has(currentId)) continue;
        seen.add(currentId);
        (hierarchyChildren.get(currentId) || []).forEach(({ childId, edge }) => {
          nodeIds.add(currentId);
          nodeIds.add(childId);
          addConceptEdge(edge);
          stack.push(childId);
        });
      }
    }

    collectAncestors(targetNode.id);
    collectDescendants(targetNode.id);

    function collectHierarchyCoSiblings(keywordId) {
      (hierarchyParents.get(keywordId) || []).forEach(({ parentId, edge: parentEdge }) => {
        nodeIds.add(parentId);
        addConceptEdge(parentEdge);
        (hierarchyChildren.get(parentId) || []).forEach(({ childId, edge }) => {
          if (childId === keywordId) return;
          nodeIds.add(childId);
          addConceptEdge(edge);
        });
      });
    }

    collectHierarchyCoSiblings(targetNode.id);

    if ((config.relations.include || []).includes("sibling")) {
      filteredEdges.forEach((edge) => {
        if (edge.relation !== "sibling") return;
        const sourceId = edgeSourceId(edge);
        const targetId = edgeTargetId(edge);
        if (sourceId === targetNode.id || targetId === targetNode.id) {
          nodeIds.add(sourceId);
          nodeIds.add(targetId);
        } else if (!nodeIds.has(sourceId) || !nodeIds.has(targetId)) {
          return;
        }
        addConceptEdge(edge);
      });
    }

    pageEdges.forEach((edge) => {
      const sourceId = edgeSourceId(edge);
      const targetId = edgeTargetId(edge);
      const pageId = sourceId.startsWith("page:") ? sourceId : (targetId.startsWith("page:") ? targetId : null);
      const keywordId = sourceId.startsWith("kw:") ? sourceId : (targetId.startsWith("kw:") ? targetId : null);
      if (!pageId || !keywordId || !nodeIds.has(keywordId)) return;
      addConceptEdge(edge);
      nodeIds.add(pageId);
      pageIds.add(pageId);
    });

    const pendingNavPages = [...pageIds];
    const seenNavPages = new Set();
    while (pendingNavPages.length) {
      const currentPageId = pendingNavPages.shift();
      if (seenNavPages.has(currentPageId)) continue;
      seenNavPages.add(currentPageId);
      navEdges.forEach((edge) => {
        const sourceId = navEdgeParentId(edge);
        const targetId = navEdgeChildId(edge);
        if (!sourceId || targetId !== currentPageId) return;
        addConceptEdge(edge);
        nodeIds.add(sourceId);
        if (sourceId.startsWith("page:") && !pageIds.has(sourceId)) {
          pageIds.add(sourceId);
          pendingNavPages.push(sourceId);
        }
      });
    }

    return { nodeIds, edges: conceptEdges };
  }

  function prepareConceptGraph(graph, keywordLabel, options = {}) {
    const normalizedLabel = String(keywordLabel || "").trim().toLowerCase();
    if (!normalizedLabel) return null;

    const config = resolveViewConfig(graph, "concept");
    const scope = normalizeConceptScope(config);
    const currentPageUrl = options.currentPageUrl || findPageUrl(graph) || getCurrentPageUrl(graph);
    const focusPageUrl = String(options.focusPageUrl || "").trim() || null;
    const pageContextUrl = focusPageUrl || (
      scope.primary_page === "current_page_first" ? currentPageUrl : null
    );
    const targetNode = graph.nodes.find((node) =>
      node.type === "keyword" && String(node.label || "").trim().toLowerCase() === normalizedLabel
    );
    if (!targetNode) return null;

    const neighbourhood = prepareConceptGraphNeighbourhood(graph, targetNode, config);

    if (scope.view === "neighbourhood") {
      return finalizeConceptGraphPayload(graph, targetNode, config, {
        nodeIds: neighbourhood.nodeIds,
        edges: neighbourhood.edges,
        teachingPathMode: false,
        currentPageUrl,
        focusPageUrl,
        sourceGraph: graph,
      });
    }

    const teachingPath = buildConceptTeachingPath(
      graph,
      targetNode,
      neighbourhood.edges,
      scope,
      pageContextUrl
    );
    const mergedNodeIds = new Set([...neighbourhood.nodeIds, ...teachingPath.nodeIds]);
    const mergedEdges = mergeGraphEdges(neighbourhood.edges, teachingPath.edges);

    return finalizeConceptGraphPayload(graph, targetNode, config, {
      nodeIds: mergedNodeIds,
      edges: mergedEdges,
      defaultVisibleNodeIds: [...teachingPath.nodeIds],
      defaultVisibleEdgeKeys: [...teachingPath.edgeKeys],
      conceptStoryPrefixNodeIds: [...teachingPath.storyPrefixNodeIds],
      teachingPathByPage: teachingPath.teachingPathByPage,
      teachingPathMode: true,
      currentPageUrl,
      focusPageUrl,
      sourceGraph: graph,
    });
  }

  

  function renderGraph(container, graphData, mode, highlightKw = null, options = {}) {
    const { nodes, edges } = graphData;
    const isPageGraph = mode === "page";
    const isSiteGraph = mode === "full";
    const highlightContextEdges = (graphData?._highlightContextEdges || []).filter((edge) =>
      edge.relation === "page"
      || edge.relation === "nav"
      || (isSiteGraph && edge.relation === "hierarchy")
    );
    const graphConfig = graphData?._resolvedConfig || BASE_VIEW_DEFAULTS;
    const currentPageUrl = graphData?._currentPageUrl || null;
    const isConceptGraph = mode === "concept";
    const usesConceptGraphView = isConceptGraph;
    const isPageGraphModal = isPageGraph && container.classList.contains("graph-modal__graph");
    const isCompactConceptPreview = isConceptGraph && container.classList.contains("concept-graph-preview__graph");
    const isPreviewGraph = Boolean(options.preview) && !isCompactConceptPreview;
    
    
    
    const freezeHighlightKw = options.freezeHighlightKw !== false;
    
    
    const highlightPageId = options.highlightPageId || null;
    const hoverInteractionsDisabled = options.disableHover === true || isCompactConceptPreview;
    const usesTransientHover = !hoverInteractionsDisabled && (isPageGraph || isPreviewGraph);
    const freezeKey = graphConfig.hover.freeze_key || "Shift";
    const enableHoverFreeze = graphConfig.hover.freeze_enabled !== false && !hoverInteractionsDisabled;
    const usesConceptTeachingPath = Boolean(usesConceptGraphView && graphData?._teachingPathMode);
    const defaultVisibleNodeIds = Array.isArray(graphData?._defaultVisibleNodeIds) && (
      isPageGraphModal || usesConceptTeachingPath
    )
      ? new Set(graphData._defaultVisibleNodeIds)
      : null;
    const defaultVisibleEdgeKeys = Array.isArray(graphData?._defaultVisibleEdgeKeys) && (
      isPageGraphModal || usesConceptTeachingPath
    )
      ? new Set(graphData._defaultVisibleEdgeKeys)
      : null;
    const conceptTeachingPathNodeIds = usesConceptTeachingPath && defaultVisibleNodeIds
      ? new Set(graphData._defaultVisibleNodeIds)
      : null;
    const conceptTargetId = usesConceptTeachingPath
      ? (graphData?._conceptTargetId || null)
      : null;
    const conceptStoryPrefixNodeIds = usesConceptTeachingPath && Array.isArray(graphData?._conceptStoryPrefixNodeIds)
      ? new Set(graphData._conceptStoryPrefixNodeIds)
      : null;
    const conceptTeachingPathByPage = usesConceptTeachingPath && graphData?._conceptTeachingPathByPage
      ? { ...graphData._conceptTeachingPathByPage }
      : null;
    const usesConceptGraphPathHighlight = usesConceptTeachingPath && usesConceptGraphView && !isCompactConceptPreview;
    
    
    
    
    
    let focalHaloId = usesConceptGraphView
      ? conceptTargetId
      : (isPageGraph ? (graphData?._pageFocalNodeId || null) : null);
    const usesFocalHalo = () => Boolean(focalHaloId);
    let baseGraphState = null;
    if (usesConceptTeachingPath && conceptTeachingPathNodeIds) {
      baseGraphState = {
        visibleNodeIds: new Set(conceptTeachingPathNodeIds),
        visibleEdgeKeys: defaultVisibleEdgeKeys
          ? new Set(defaultVisibleEdgeKeys)
          : buildVisibleEdgeKeysFromNodes(edges, conceptTeachingPathNodeIds),
      };
    }
    let activeDefaultVisibleNodeIds = defaultVisibleNodeIds;
    let activeDefaultVisibleEdgeKeys = defaultVisibleEdgeKeys;
    const dimmedNodeOpacity = hoverDimmingOpacity(graphConfig);
    const dimmedLinkOpacity = clampUnitInterval(graphConfig.edges.dim_opacity, hoverDimmingLinkOpacity(graphConfig));
    const highlightLinkOpacity = clampUnitInterval(graphConfig.edges.highlight_opacity, 1);
    const width  = container.clientWidth  || 800;
    const height = container.clientHeight || 600;

    container.innerHTML = "";

    function closeContainingGraphModal() {
      if (!container.closest("#graph-modal")) return;
      document.dispatchEvent(new CustomEvent("knotis:close-graph-modal"));
    }

    const svg = d3
      .select(container)
      .append("svg")
      .attr("width",   "100%")
      .attr("height",  "100%")
      .attr("viewBox", [0, 0, width, height])
      .attr("aria-label", isPageGraph ? "Page graph" : (usesConceptGraphView ? "Concept graph" : "Site graph"));

    
    
    
    function syncViewBoxToContainer() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      svg.attr("viewBox", [0, 0, w, h]);
    }

    
    const g = svg.append("g");
    let currentZoomTransform = d3.zoomIdentity;
    const zoomBehavior = d3.zoom()
      .scaleExtent([0.1, 5])
      .on("zoom", (ev) => {
        if (ev.sourceEvent) userAdjustedZoom = true;
        currentZoomTransform = ev.transform;
        g.attr("transform", ev.transform);
        if (graphConfig.ui.show_labels && isSiteGraph) updateLabelHighlight();
      });
    svg.call(zoomBehavior);
    let userAdjustedZoom = false;

    function zoomBy(factor) {
      svg.transition().duration(180).call(zoomBehavior.scaleBy, factor);
    }

    const pageLayout = isPageGraph
      ? seedPageGraphLayout(nodes, edges, width, height, currentPageUrl)
      : null;
    let conceptLayout = usesConceptGraphView
      ? seedConceptGraphLayout(nodes, edges, width, height, graphData?._conceptKeyword || highlightKw, {
          teachingPathMode: graphData?._teachingPathMode !== false,
        })
      : null;
    const pageLevels = pageLayout?.levels || new Map();

    function edgeDistanceForMode(edge) {
      const relation = edge.relation || "other";
      if (isPageGraph) {
        if (relation === "page") {
          const sourceId = edgeSourceId(edge);
          const targetId = edgeTargetId(edge);
          const conceptId = sourceId.startsWith("page:") ? targetId : sourceId;
          const level = Math.max(1, pageLevels.get(conceptId) || 1);
          return Math.min(isPageGraphModal ? 280 : 220, 88 + level * (isPageGraphModal ? 44 : 36));
        }
        if (relation === "hierarchy") return isPageGraphModal ? 128 : 118;
        if (relation === "sibling") return isPageGraphModal ? 146 : 138;
        return isPageGraphModal ? 122 : 110;
      }
      if (usesConceptGraphView) {
        if (relation === "page") return isCompactConceptPreview ? 118 : 158;
        if (relation === "hierarchy") return isCompactConceptPreview ? 98 : 136;
        if (relation === "nav") return isCompactConceptPreview ? 96 : 128;
        if (relation === "sibling") return isCompactConceptPreview ? 118 : 146;
        return isCompactConceptPreview ? 104 : 132;
      }
      if (relation === "page") return 76;
      if (relation === "hierarchy") return 88;
      if (relation === "sibling") return 104;
      return 96;
    }

    function edgeStrengthForMode(edge) {
      const relation = edge.relation || "other";
      if (isPageGraph) {
        if (relation === "page") return 0.16;
        if (relation === "hierarchy") return 0.92;
        if (relation === "sibling") return 0.12;
        return 0.28;
      }
      if (usesConceptGraphView) {
        if (relation === "hierarchy") return 0.9;
        if (relation === "page") return 0.42;
        if (relation === "nav") return 0.26;
        if (relation === "sibling") return 0.18;
        return 0.4;
      }
      if (relation === "page") return 0.62;
      if (relation === "hierarchy") return 0.52;
      if (relation === "sibling") return 0.34;
      return 0.5;
    }

    function radialTargetRadius(d) {
      const minDim = Math.min(width, height);
      if (isPageGraph) {
        const level = pageLevels.get(d.id) ?? (d.type === "page" ? 0 : 1);
        if (level <= 0) return 0;
        const baseRadius = Math.max(66, minDim * (isPageGraphModal ? 0.18 : 0.16));
        return Math.min(minDim * (isPageGraphModal ? 0.42 : 0.38), baseRadius * level);
      }
      return 0;
    }

    function isSidebarGraphPreview() {
      return (isPageGraph && !isPageGraphModal) || isCompactConceptPreview;
    }

    function sidebarPreviewFitPadding(fitWidth, fitHeight) {
      const fit = SIDEBAR_GRAPH_PREVIEW_FIT;
      return {
        paddingX: Math.max(fit.paddingMin, fitWidth * fit.paddingWidthRatio),
        paddingY: Math.max(fit.paddingMin, fitHeight * fit.paddingHeightRatio),
      };
    }

    function collectSidebarPreviewBounds() {
      const fit = SIDEBAR_GRAPH_PREVIEW_FIT;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      nodes.forEach((d) => {
        if (d.x == null || d.y == null) return;
        if (isCompactConceptPreview && activeDefaultVisibleNodeIds && !activeDefaultVisibleNodeIds.has(d.id)) {
          return;
        }
        const r = kwRadius(d);
        const pad = d.type === "page" ? fit.labelPad.page : fit.labelPad.keyword;
        minX = Math.min(minX, d.x - r - pad.x);
        minY = Math.min(minY, d.y - r - pad.y);
        maxX = Math.max(maxX, d.x + r + pad.x);
        maxY = Math.max(maxY, d.y + r + pad.y);
      });

      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
      return { minX, minY, maxX, maxY };
    }

    function fitSidebarGraphPreview(animate = true) {
      if (!isSidebarGraphPreview() || !nodes.length) return;
      const fitWidth = container.clientWidth || width;
      const fitHeight = container.clientHeight || height;
      const { paddingX, paddingY } = sidebarPreviewFitPadding(fitWidth, fitHeight);
      const bounds = collectSidebarPreviewBounds();
      if (!bounds) return;

      const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1);
      const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1);
      const fitScale = Math.min(
        fitWidth / (boundsWidth + paddingX),
        fitHeight / (boundsHeight + paddingY)
      );
      const fit = SIDEBAR_GRAPH_PREVIEW_FIT;
      const scale = Math.max(
        fit.minScale,
        Math.min(fit.maxScale, fitScale * fit.fitShrink)
      );
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const transform = d3.zoomIdentity
        .translate(fitWidth / 2, fitHeight / 2)
        .scale(scale)
        .translate(-centerX, -centerY);

      if (animate) {
        svg.transition().duration(450).call(zoomBehavior.transform, transform);
      } else {
        svg.call(zoomBehavior.transform, transform);
      }
    }

    function fitPageGraphView(animate = true) {
      if (graphConfig.layout.fit_mode !== "fit") return;
      if (!isPageGraph || !nodes.length) return;
      if (isSidebarGraphPreview()) {
        fitSidebarGraphPreview(animate);
        return;
      }
      const fitWidth = container.clientWidth || width;
      const fitHeight = container.clientHeight || height;
      const configuredPadding = numberOr(graphConfig.layout.fit_padding, 48);
      const paddingX = Math.max(isPageGraphModal ? 44 : 24, configuredPadding, fitWidth * (isPageGraphModal ? 0.06 : 0.04));
      const paddingY = Math.max(isPageGraphModal ? 48 : 24, configuredPadding, fitHeight * (isPageGraphModal ? 0.07 : 0.05));
      const nodesToFit = defaultVisibleNodeIds
        ? nodes.filter((nodeDatum) => isDefaultVisibleNode(nodeDatum))
        : nodes;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      nodesToFit.forEach((d) => {
        if (d.x == null || d.y == null) return;
        const r = kwRadius(d);
        const labelPadX = d.type === "page" ? (isPageGraphModal ? 50 : 52) : (isPageGraphModal ? 34 : 36);
        const labelPadY = d.type === "page" ? (isPageGraphModal ? 56 : 54) : (isPageGraphModal ? 42 : 42);
        minX = Math.min(minX, d.x - r - labelPadX);
        minY = Math.min(minY, d.y - r - labelPadY);
        maxX = Math.max(maxX, d.x + r + labelPadX);
        maxY = Math.max(maxY, d.y + r + labelPadY);
      });

      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

      const boundsWidth = Math.max(maxX - minX, 1);
      const boundsHeight = Math.max(maxY - minY, 1);
      const fitScale = Math.min(
        fitWidth / (boundsWidth + paddingX),
        fitHeight / (boundsHeight + paddingY)
      );
      const spaciousCell = Math.sqrt((fitWidth * fitHeight) / Math.max(nodes.length, 1));
      const maxAutoScale = isPageGraphModal
        ? Math.max(1.35, Math.min(2.35, spaciousCell / 92))
        : Math.max(1.18, Math.min(1.72, spaciousCell / 118));
      const scale = Math.max(
        isPageGraphModal ? 0.82 : 0.74,
        Math.min(maxAutoScale, fitScale * (isPageGraphModal ? 0.98 : 0.96))
      );
      const finalScale = scale;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const transform = d3.zoomIdentity
        .translate(fitWidth / 2, fitHeight / 2)
        .scale(finalScale)
        .translate(-centerX, -centerY);

      if (animate) {
        svg.transition().duration(450).call(zoomBehavior.transform, transform);
      } else {
        svg.call(zoomBehavior.transform, transform);
      }
    }

    function collectVisibleConceptGraphBounds() {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      nodes.forEach((d) => {
        if (d.x == null || d.y == null) return;
        if (activeDefaultVisibleNodeIds && !activeDefaultVisibleNodeIds.has(d.id)) return;
        const r = kwRadius(d);
        const boundsLabelPad = numberOr(graphConfig.layout.bounds_label_pad, 32);
        const labelPadX = d.type === "page" ? boundsLabelPad + 6 : Math.round(boundsLabelPad * 0.72);
        const labelPadY = d.type === "page" ? boundsLabelPad + 10 : Math.round(boundsLabelPad * 0.82);
        minX = Math.min(minX, d.x - r - labelPadX);
        minY = Math.min(minY, d.y - r - labelPadY);
        maxX = Math.max(maxX, d.x + r + labelPadX);
        maxY = Math.max(maxY, d.y + r + labelPadY);
      });

      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;
      return { minX, minY, maxX, maxY };
    }

    function applyConceptGraphTransform(transform, animate = true) {
      if (animate) {
        svg.transition().duration(450).call(zoomBehavior.transform, transform);
      } else {
        svg.call(zoomBehavior.transform, transform);
      }
    }

    function conceptGraphFitPadding() {
      const configuredPadding = numberOr(graphConfig.layout.fit_padding, 48);
      return {
        paddingX: Math.max(6, configuredPadding),
        paddingY: Math.max(6, configuredPadding),
      };
    }

    function fitConceptGraphVisibleBounds(animate = true) {
      if (!usesConceptGraphView || !nodes.length) return;
      const fitWidth = container.clientWidth || width;
      const fitHeight = container.clientHeight || height;
      const { paddingX, paddingY } = conceptGraphFitPadding();
      const bounds = collectVisibleConceptGraphBounds();
      if (!bounds) return;

      const boundsWidth = Math.max(bounds.maxX - bounds.minX, 1);
      const boundsHeight = Math.max(bounds.maxY - bounds.minY, 1);
      const fitScale = Math.min(
        fitWidth / (boundsWidth + paddingX),
        fitHeight / (boundsHeight + paddingY)
      );
      const fitShrink = numberOr(graphConfig.layout.fit_shrink, 0.98);
      const scale = Math.max(0.35, Math.min(3, fitScale * fitShrink));
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      applyConceptGraphTransform(
        d3.zoomIdentity
          .translate(fitWidth / 2, fitHeight / 2)
          .scale(scale)
          .translate(-centerX, -centerY),
        animate
      );
    }

    function fitConceptGraphView(animate = true) {
      if (isSidebarGraphPreview()) {
        fitSidebarGraphPreview(animate);
        return;
      }
      fitConceptGraphVisibleBounds(animate);
    }

    function fitPreviewGraphView(animate = true) {
      if (graphConfig.layout.fit_mode !== "fit") return;
      if ((!isPreviewGraph && !isCompactConceptPreview) || isPageGraph || !nodes.length) return;
      const fitWidth = container.clientWidth || width;
      const fitHeight = container.clientHeight || height;
      const configuredPadding = numberOr(graphConfig.layout.fit_padding, 48);
      const paddingX = Math.max(isCompactConceptPreview ? 28 : 28, configuredPadding, fitWidth * (isCompactConceptPreview ? 0.14 : 0.12));
      const paddingY = Math.max(isCompactConceptPreview ? 30 : 30, configuredPadding, fitHeight * (isCompactConceptPreview ? 0.14 : 0.12));
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      nodes.forEach((d) => {
        if (d.x == null || d.y == null) return;
        if (usesConceptTeachingPath && isCompactConceptPreview && activeDefaultVisibleNodeIds && !activeDefaultVisibleNodeIds.has(d.id)) {
          return;
        }
        const r = kwRadius(d);
        const labelPadX = d.type === "page" ? 54 : 34;
        const labelPadY = d.type === "page" ? 58 : 40;
        minX = Math.min(minX, d.x - r - labelPadX);
        minY = Math.min(minY, d.y - r - labelPadY);
        maxX = Math.max(maxX, d.x + r + labelPadX);
        maxY = Math.max(maxY, d.y + r + labelPadY);
      });

      if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return;

      const boundsWidth = Math.max(maxX - minX, 1);
      const boundsHeight = Math.max(maxY - minY, 1);
      const fitScale = Math.min(
        fitWidth / (boundsWidth + paddingX),
        fitHeight / (boundsHeight + paddingY)
      );
      const spaciousCell = Math.sqrt((fitWidth * fitHeight) / Math.max(nodes.length, 1));
      const maxAutoScale = isCompactConceptPreview
        ? Math.max(0.92, Math.min(1.28, spaciousCell / 128))
        : Math.max(0.9, Math.min(1.18, spaciousCell / 148));
      const scale = isCompactConceptPreview
        ? Math.max(0.78, Math.min(maxAutoScale, fitScale * 0.86))
        : Math.max(0.42, Math.min(maxAutoScale, fitScale * 0.84)) * previewZoomMultiplier(graphConfig);
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const transform = d3.zoomIdentity
        .translate(fitWidth / 2, fitHeight / 2)
        .scale(scale)
        .translate(-centerX, -centerY);

      if (animate) {
        svg.transition().duration(450).call(zoomBehavior.transform, transform);
      } else {
        svg.call(zoomBehavior.transform, transform);
      }
    }

    function applyConfiguredInitialView() {
      if (graphConfig.layout.fit_mode === "fit") return;
      const scale = Math.max(0.1, Math.min(5, numberOr(graphConfig.layout.initial_zoom, 1)));
      if (graphConfig.layout.center_on_load) {
        svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(scale).translate(-width / 2, -height / 2));
      } else if (scale !== 1) {
        svg.call(zoomBehavior.transform, d3.zoomIdentity.scale(scale));
      }
    }

    
    function buildEdgeMaps(sourceEdges) {
      const adjacency = new Map();
      const parents = new Map();
      const children = new Map();
      const keywordToPages = new Map();
      const keywordRootPages = new Map();
      const keywordAdjacency = new Map();
      const keywordSiblingAdjacency = new Map();
      const pageNavParents = new Map();
      const pageNavChildren = new Map();
      const hierarchyEdgePages = new Map();

      function addHierarchyEdgePage(parentId, childId, pageUrl) {
        if (!pageUrl || pageUrl === "__nav__") return;
        const key = `${parentId}->${childId}`;
        if (!hierarchyEdgePages.has(key)) hierarchyEdgePages.set(key, new Set());
        hierarchyEdgePages.get(key).add(pageUrl);
      }

      sourceEdges.forEach((edge) => {
        const s = edgeSourceId(edge);
        const t = edgeTargetId(edge);
        if (!adjacency.has(s)) adjacency.set(s, new Set());
        if (!adjacency.has(t)) adjacency.set(t, new Set());
        adjacency.get(s).add(t);
        adjacency.get(t).add(s);

        if (s.startsWith("kw:") && t.startsWith("kw:")) {
          if (!keywordAdjacency.has(s)) keywordAdjacency.set(s, new Set());
          if (!keywordAdjacency.has(t)) keywordAdjacency.set(t, new Set());
          keywordAdjacency.get(s).add(t);
          keywordAdjacency.get(t).add(s);

          if (edge.relation === "sibling") {
            if (!keywordSiblingAdjacency.has(s)) keywordSiblingAdjacency.set(s, new Set());
            if (!keywordSiblingAdjacency.has(t)) keywordSiblingAdjacency.set(t, new Set());
            keywordSiblingAdjacency.get(s).add(t);
            keywordSiblingAdjacency.get(t).add(s);
          }
        }

        if (edge.relation === "hierarchy" && s.startsWith("kw:") && t.startsWith("kw:")) {
          if (!children.has(s)) children.set(s, new Set());
          if (!parents.has(t)) parents.set(t, new Set());
          children.get(s).add(t);
          parents.get(t).add(s);
          if (Array.isArray(edge.pages)) {
            edge.pages.forEach((pageUrl) => addHierarchyEdgePage(s, t, pageUrl));
          }
        }

        if (edge.relation === "page") {
          const pageId = s.startsWith("page:") ? s : (t.startsWith("page:") ? t : null);
          const kwId = s.startsWith("kw:") ? s : (t.startsWith("kw:") ? t : null);
          if (pageId && kwId) {
            if (!keywordToPages.has(kwId)) keywordToPages.set(kwId, new Set());
            keywordToPages.get(kwId).add(pageId);
            if (!keywordRootPages.has(kwId)) keywordRootPages.set(kwId, new Set());
            keywordRootPages.get(kwId).add(pageId);
          }
        }

        const navParent = navEdgeParentId(edge);
        const navChild = navEdgeChildId(edge);
        if (navParent && navChild) {
          if (!pageNavParents.has(navChild)) pageNavParents.set(navChild, new Set());
          if (!pageNavChildren.has(navParent)) pageNavChildren.set(navParent, new Set());
          pageNavParents.get(navChild).add(navParent);
          pageNavChildren.get(navParent).add(navChild);
        }

        if (Array.isArray(edge.pages)) {
          const pageUrls = edge.pages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__");
          if (pageUrls.length) {
            [s, t]
              .filter((id) => id.startsWith("kw:"))
              .forEach((kwId) => {
                if (!keywordToPages.has(kwId)) keywordToPages.set(kwId, new Set());
                pageUrls.forEach((pageUrl) => keywordToPages.get(kwId).add(pageUrl));
              });
          }
        }
      });

      return {
        adjacency,
        keywordAdjacency,
        keywordSiblingAdjacency,
        hierarchyParents: parents,
        hierarchyChildren: children,
        keywordPages: keywordToPages,
        keywordRootPages,
        pageNavParents,
        pageNavChildren,
        hierarchyEdgePages,
      };
    }

    const pageScopeMode = graphConfig.hover.page_scope;
    const scopedEdges = (() => {
      if (!currentPageUrl || pageScopeMode === "all_pages") return edges;
      const pageId = `page:${currentPageUrl}`;
      const navEdgeIndexes = collectNavAncestorEdges(edges, pageId);
      const narrowed = edges.filter((edge, index) => (
        edge.relation === "nav"
          ? navEdgeIndexes.has(index)
          : edgeBelongsToPage(edge, currentPageUrl, pageId)
      ));
      if (pageScopeMode === "current_page_if_available" && !narrowed.some((edge) => edge.relation !== "nav")) return edges;
      return narrowed;
    })();

    const scopedContextEdges = (() => {
      if (!currentPageUrl || pageScopeMode === "all_pages") return highlightContextEdges;
      const pageId = `page:${currentPageUrl}`;
      const navEdgeIndexes = collectNavAncestorEdges(highlightContextEdges, pageId);
      const narrowed = highlightContextEdges.filter((edge, index) => (
        edge.relation === "nav"
          ? navEdgeIndexes.has(index)
          : edgeBelongsToPage(edge, currentPageUrl, pageId)
      ));
      if (pageScopeMode === "current_page_if_available" && !narrowed.some((edge) => edge.relation !== "nav")) return highlightContextEdges;
      return narrowed;
    })();

    const allMaps = buildEdgeMaps([...edges, ...highlightContextEdges]);
    const scopedMaps = buildEdgeMaps([...scopedEdges, ...scopedContextEdges]);
    const sitePageHierarchyIndex = (() => {
      const pages = new Map();

      function ensurePage(pageUrl) {
        if (!pages.has(pageUrl)) {
          pages.set(pageUrl, {
            parentsByChild: new Map(),
            childrenByParent: new Map(),
          });
        }
        return pages.get(pageUrl);
      }

      function addPageHierarchyLink(pageUrl, sourceId, targetId) {
        if (!pageUrl || pageUrl === "__nav__" || !sourceId.startsWith("kw:") || !targetId.startsWith("kw:")) return;
        const pageIndex = ensurePage(pageUrl);
        const entry = { parentId: sourceId, childId: targetId };
        if (!pageIndex.parentsByChild.has(targetId)) pageIndex.parentsByChild.set(targetId, []);
        if (!pageIndex.childrenByParent.has(sourceId)) pageIndex.childrenByParent.set(sourceId, []);
        pageIndex.parentsByChild.get(targetId).push(entry);
        pageIndex.childrenByParent.get(sourceId).push(entry);
      }

      edges.forEach((edge) => {
        if (edge.relation !== "hierarchy") return;
        const sourceId = edgeSourceId(edge);
        const targetId = edgeTargetId(edge);
        if (!sourceId.startsWith("kw:") || !targetId.startsWith("kw:")) return;

        const hierarchySources = edge.hierarchy_sources || {};
        Object.keys(hierarchySources).forEach((pageUrl) => {
          addPageHierarchyLink(pageUrl, sourceId, targetId);
        });
      });

      if (isSiteGraph) {
        (graphData?._sourceGraph?.page_hierarchy_edges || []).forEach((edge) => {
          addPageHierarchyLink(edge.page, edge.source, edge.target);
        });
      }

      return pages;
    })();
    const pageHierarchyIndex = (() => {
      const parentsByChild = new Map();
      const childrenByParent = new Map();
      if (!isPageGraph || !currentPageUrl) return { parentsByChild, childrenByParent };

      edges.forEach((edge) => {
        if (edge.relation !== "hierarchy") return;
        const sourceId = edgeSourceId(edge);
        const targetId = edgeTargetId(edge);
        if (!sourceId.startsWith("kw:") || !targetId.startsWith("kw:")) return;
        const pageSources = edge.hierarchy_sources?.[currentPageUrl];
        if (!pageSources) return;
        const sourceKind = pageSources.list ? "list" : "other";
        const entry = { parentId: sourceId, childId: targetId, sourceKind };
        if (!parentsByChild.has(targetId)) parentsByChild.set(targetId, []);
        if (!childrenByParent.has(sourceId)) childrenByParent.set(sourceId, []);
        parentsByChild.get(targetId).push(entry);
        childrenByParent.get(sourceId).push(entry);
      });

      return { parentsByChild, childrenByParent };
    })();

    
    
    
    
    
    
    
    
    
    
    const parentKwIds = new Set();
    const parentKwChildren = new Map();
    const subCatIds   = new Set();  

    
    
    
    
    
    
    const parentScopeEdgeKeys =
      activeDefaultVisibleEdgeKeys && activeDefaultVisibleEdgeKeys.size
        ? activeDefaultVisibleEdgeKeys
        : null;

    edges.forEach((e) => {
      const s = typeof e.source === "object" ? e.source.id : e.source;
      const t = typeof e.target === "object" ? e.target.id : e.target;
      if (s.startsWith("kw:") && t.startsWith("kw:") && e.relation === "hierarchy") {
        if (!parentScopeEdgeKeys || parentScopeEdgeKeys.has(graphEdgeKey(e))) {
          if (!parentKwChildren.has(s)) parentKwChildren.set(s, new Set());
          parentKwChildren.get(s).add(t);
        }
      }
      if (s.startsWith("cat:") && t.startsWith("cat:")) subCatIds.add(t);
    });
    parentKwChildren.forEach((children, parentId) => {
      
      
      if (children.size >= 1) parentKwIds.add(parentId);
    });

    const topCategoryIds = new Set(
      nodes
        .filter((node) => node.type === "category" && !subCatIds.has(node.id))
        .map((node) => node.id)
    );
    const siteCategoryAnchors = (() => {
      const anchors = new Map();
      if (!isSiteGraph || !topCategoryIds.size) return anchors;
      const centerX = width / 2;
      const centerY = height / 2;
      const spreadX = Math.min(width * 0.34, 420);
      const spreadY = Math.min(height * 0.25, 280);
      const fallbackRadius = Math.min(width, height) * 0.22;
      const ordered = Array.from(topCategoryIds).sort((a, b) => {
        if (a === "cat:Modules") return -1;
        if (b === "cat:Modules") return 1;
        return a.localeCompare(b);
      });

      ordered.forEach((categoryId, index) => {
        if (categoryId === "cat:Modules") {
          anchors.set(categoryId, { x: centerX, y: centerY });
          return;
        }
        if (categoryId === "cat:Lab Resources") {
          anchors.set(categoryId, { x: centerX - spreadX, y: centerY - spreadY });
          return;
        }
        if (categoryId === "cat:Other Resources") {
          anchors.set(categoryId, { x: centerX + spreadX, y: centerY - spreadY });
          return;
        }
        const angle = -Math.PI / 2 + ((index - 1) * Math.PI * 2) / Math.max(ordered.length - 1, 1);
        anchors.set(categoryId, {
          x: centerX + Math.cos(angle) * fallbackRadius,
          y: centerY + Math.sin(angle) * fallbackRadius,
        });
      });
      return anchors;
    })();
    const fullLayout = isSiteGraph
      ? seedFullGraphLayout(nodes, edges, width, height, siteCategoryAnchors)
      : null;

    
    function restFill(n) {
      if (n.type === "category" && subCatIds.has(n.id)) return "var(--graph-cat-parent-color, #e8a888)";
      if (n.type === "category")                        return "var(--graph-cat-color, #e8d5a8)";
      if (n.type === "page")                            return "var(--graph-page-color, #a8c8e8)";
      if (parentKwIds.has(n.id))                        return "var(--graph-kw-parent-color, #d4a8e8)";
      return "var(--graph-kw-color, #a8d8b0)";
    }

    
    const nodeCount = nodes.length;
    const area      = width * height;
    const cellSize  = Math.sqrt(area / Math.max(nodeCount, 1));

    
    
    const rPageMin = isPageGraph ? 30 : R_PAGE_MIN;
    const rKwMin   = isPageGraph ? 18 : R_KW_MIN;

    const configuredPageRadius = Number.isFinite(Number(graphConfig.nodes.page_radius))
      ? Number(graphConfig.nodes.page_radius)
      : null;
    const configuredKeywordRadius = Number.isFinite(Number(graphConfig.nodes.keyword_radius))
      ? Number(graphConfig.nodes.keyword_radius)
      : null;
    const configuredCategoryRadius = Number.isFinite(Number(graphConfig.nodes.category_radius))
      ? Number(graphConfig.nodes.category_radius)
      : null;
    const rPage = configuredPageRadius || Math.max(rPageMin, Math.min(52, cellSize * (isPageGraph ? 0.18 : 0.11)));
    const rKw   = configuredKeywordRadius || Math.max(rKwMin,   Math.min(34, cellSize * (isPageGraph ? 0.11 : 0.065)));

    const configuredLinkDistance = numberOr(graphConfig.physics.link_distance, cellSize * 0.5);
    const linkDistanceMin = numberOr(graphConfig.physics.link_distance_min, 0);
    const linkDistanceMax = numberOr(graphConfig.physics.link_distance_max, configuredLinkDistance);
    const linkDist = Math.max(linkDistanceMin, Math.min(linkDistanceMax, configuredLinkDistance));
    const chargeStr = numberOr(
      graphConfig.physics.charge_strength,
      -(rPage * (isPageGraph ? (isPageGraphModal ? 10.8 : 9.2) : (isSiteGraph ? 13.2 : 9)))
    );
    const chargeRange = numberOr(graphConfig.physics.charge_range, 900);
    const collisionPadding = numberOr(
      graphConfig.physics.collision_padding,
      isPageGraph ? (isPageGraphModal ? 48 : 32) : (usesConceptGraphView ? (isCompactConceptPreview ? 24 : 42) : (isSiteGraph ? 36 : 20))
    );
    const centerStrength = numberOr(graphConfig.physics.center_strength, isPageGraph ? 0.08 : 0.12);
    const anchorStrengthBase = numberOr(graphConfig.physics.anchor_strength, isPageGraphModal ? 0.18 : 0.13);
    const radialStrength = numberOr(graphConfig.physics.radial_strength, isPageGraphModal ? 0.44 : 0.54);
    const alphaDecay = numberOr(graphConfig.physics.alpha_decay, isPageGraph ? 0.018 : (isSiteGraph ? 0.018 : 0.025));

    
    const simulation = d3
      .forceSimulation(nodes)
      .force("link",    d3.forceLink(edges).id((d) => d.id).distance((edge) => Math.max(linkDist, edgeDistanceForMode(edge))).strength(edgeStrengthForMode))
      .force("charge",  d3.forceManyBody().strength(chargeStr).distanceMax(chargeRange))
      .force("center",  d3.forceCenter(width / 2, height / 2).strength(centerStrength))
      .force("collide", d3.forceCollide((d) => kwRadius(d) + collisionPadding))
      .alphaDecay(alphaDecay);

    if (isPageGraph) {
      const anchorStrength = anchorStrengthBase;
      simulation
        .force("x", d3.forceX((d) => pageLayout?.anchors?.get(d.id)?.x ?? width / 2).strength((d) => d.type === "page" ? 0.32 : anchorStrength))
        .force("y", d3.forceY((d) => pageLayout?.anchors?.get(d.id)?.y ?? height / 2).strength((d) => d.type === "page" ? 0.32 : anchorStrength));
      simulation.force(
        "radial",
        d3.forceRadial(radialTargetRadius, width / 2, height / 2).strength(radialStrength)
      );
    } else {
      if (usesConceptGraphView && conceptLayout?.anchors?.size) {
        simulation
          .force("concept-structure-x", d3.forceX((d) => conceptLayout.anchors.get(d.id)?.x ?? width / 2).strength((d) => {
            if (d.id === conceptLayout.targetId) return Math.max(anchorStrengthBase, 0.58);
            if (d.type === "keyword") return anchorStrengthBase;
            return Math.max(0.01, anchorStrengthBase * 0.7);
          }))
          .force("concept-structure-y", d3.forceY((d) => conceptLayout.anchors.get(d.id)?.y ?? height / 2).strength((d) => {
            if (d.id === conceptLayout.targetId) return Math.max(anchorStrengthBase, 0.58);
            if (d.type === "keyword") return anchorStrengthBase;
            return Math.max(0.01, anchorStrengthBase * 0.7);
          }));
      }
      if (isSiteGraph && fullLayout?.anchors?.size) {
        simulation
          .force("site-structure-x", d3.forceX((d) => fullLayout.anchors.get(d.id)?.x ?? width / 2).strength((d) => {
            if (d.type === "category") return anchorStrengthBase;
            if (d.type === "page") return Math.max(0.01, anchorStrengthBase * 0.62);
            return Math.max(0.01, anchorStrengthBase * 0.28);
          }))
          .force("site-structure-y", d3.forceY((d) => fullLayout.anchors.get(d.id)?.y ?? height / 2).strength((d) => {
            if (d.type === "category") return anchorStrengthBase;
            if (d.type === "page") return Math.max(0.01, anchorStrengthBase * 0.62);
            return Math.max(0.01, anchorStrengthBase * 0.28);
          }));
      }
      if (mode === "full" && siteCategoryAnchors.size) {
        simulation
          .force("site-category-x", d3.forceX((d) => siteCategoryAnchors.get(d.id)?.x ?? width / 2).strength((d) => siteCategoryAnchors.has(d.id) ? anchorStrengthBase : 0.01))
          .force("site-category-y", d3.forceY((d) => siteCategoryAnchors.get(d.id)?.y ?? height / 2).strength((d) => siteCategoryAnchors.has(d.id) ? anchorStrengthBase : 0.01));
      }
      
      
      
      simulation.stop();
      const settleTicks = Math.max(150, Math.min(320, nodes.length * 2.5));
      for (let i = 0; i < settleTicks; i++) simulation.tick();
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const visibleSitePageUrls = new Set(
      isSiteGraph
        ? nodes
            .filter((node) => node.type === "page" && node.url)
            .map((node) => node.url)
        : []
    );
    const pageIdByUrl = new Map(
      nodes
        .filter((node) => node.type === "page" && node.url)
        .map((node) => [node.url, node.id])
    );
    const edgeRenderOrder = {
      page: 1,
      nav: 2,
      hierarchy: 3,
      sibling: 4,
    };
    const sortedEdges = edges
      .slice()
      .sort((a, b) => (edgeRenderOrder[a.relation] || 99) - (edgeRenderOrder[b.relation] || 99));
    const renderedEdgeKeys = new Set(
      sortedEdges.map((edge) => graphEdgeKey(edge))
    );
    function edgeBelongsToVisibleSitePage(edge) {
      if (!isSiteGraph || !visibleSitePageUrls.size) return true;
      const pages = Array.isArray(edge.pages)
        ? edge.pages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__")
        : [];
      if (!pages.length) return true;
      return pages.some((pageUrl) => visibleSitePageUrls.has(pageUrl));
    }
    const sourceGraphHighlightEdges = (isSiteGraph || usesConceptGraphView)
      ? (graphData?._sourceGraph?.edges || []).filter((edge) => {
          if (edge.relation !== "hierarchy" && edge.relation !== "sibling") return false;
          const sourceId = edgeSourceId(edge);
          const targetId = edgeTargetId(edge);
          return nodeById.has(sourceId)
            && nodeById.has(targetId)
            && edgeBelongsToVisibleSitePage(edge);
        })
      : [];
    const activeHighlightContextEdges = (isSiteGraph || usesConceptGraphView)
      ? mergeGraphEdges(
          highlightContextEdges,
          sourceGraphHighlightEdges
        )
      : highlightContextEdges;
    const activeHighlightCandidateEdges = mergeGraphEdges(edges, activeHighlightContextEdges);
    const highlightOnlyEdges = isPageGraph
      ? []
      : activeHighlightContextEdges.filter((edge) => {
          const sourceId = edgeSourceId(edge);
          const targetId = edgeTargetId(edge);
          return nodeById.has(sourceId)
            && nodeById.has(targetId)
            && !renderedEdgeKeys.has(graphEdgeKey(edge));
        });
    function isHighlightOnlyEdge(edge) {
      return !renderedEdgeKeys.has(graphEdgeKey(edge));
    }

    function isDefaultVisibleNode(nodeDatum) {
      return !activeDefaultVisibleNodeIds || activeDefaultVisibleNodeIds.has(nodeDatum.id);
    }

    function isDefaultVisibleEdge(edge) {
      return !activeDefaultVisibleEdgeKeys || activeDefaultVisibleEdgeKeys.has(graphEdgeKey(edge));
    }

    function applyTeachingPathVisibility() {
      node
        .style("visibility", (n) => isDefaultVisibleNode(n) ? "visible" : "hidden")
        .style("pointer-events", (n) => isDefaultVisibleNode(n) ? "auto" : "none");
      node.attr("opacity", (n) => isDefaultVisibleNode(n) ? 1 : 0);
      link
        .style("visibility", (e) => isDefaultVisibleEdge(e) ? "visible" : "hidden")
        .attr("opacity", (e) => isDefaultVisibleEdge(e) ? baseLinkOpacity(e) : 0);
      highlightOnlyLink.attr("opacity", 0);
      linkHit.attr("pointer-events", (e) => (isHighlightOnlyEdge(e) || !isDefaultVisibleEdge(e)) ? "none" : "all");
      updateLabelHighlight();
    }

    function updateConceptStructureForces(layout) {
      if (!usesConceptGraphView || !layout?.anchors?.size) return;
      simulation
        .force("concept-structure-x", d3.forceX((d) => layout.anchors.get(d.id)?.x ?? width / 2).strength((d) => {
          if (d.id === layout.targetId) return Math.max(anchorStrengthBase, 0.58);
          if (d.type === "keyword") return anchorStrengthBase;
          return Math.max(0.01, anchorStrengthBase * 0.7);
        }))
        .force("concept-structure-y", d3.forceY((d) => layout.anchors.get(d.id)?.y ?? height / 2).strength((d) => {
          if (d.id === layout.targetId) return Math.max(anchorStrengthBase, 0.58);
          if (d.type === "keyword") return anchorStrengthBase;
          return Math.max(0.01, anchorStrengthBase * 0.7);
        }));
      simulation.alpha(0.85).restart();
    }

    function baseLinkOpacity(edge) {
      if (edge.relation === "page") return clampUnitInterval(graphConfig.edges.page_opacity, 1);
      if (edge.relation === "hierarchy") return clampUnitInterval(graphConfig.edges.hierarchy_opacity, 1);
      if (edge.relation === "sibling") return clampUnitInterval(graphConfig.edges.sibling_opacity, 0.35);
      if (edge.relation === "nav") return clampUnitInterval(graphConfig.edges.nav_opacity, 0.6);
      if (isPageGraph) return edge.relation === "page" ? 0.52 : 1;
      if (usesConceptGraphView) {
        if (edge.relation === "hierarchy") return 0.9;
        if (edge.relation === "page") return 0.5;
        if (edge.relation === "nav") return 0.34;
        if (edge.relation === "sibling") return 0.42;
      }
      if (isSiteGraph) {
        if (edge.relation === "page") return clampUnitInterval(graphConfig.ui.page_edge_opacity, 1);
        if (edge.relation === "nav") return clampUnitInterval(graphConfig.ui.nav_edge_opacity, 1);
        if (edge.relation === "hierarchy") return clampUnitInterval(graphConfig.ui.hierarchy_edge_opacity, 1);
        if (edge.relation === "sibling") return clampUnitInterval(graphConfig.ui.sibling_edge_opacity, 0.35);
      }
      if (isPreviewGraph) return edge.relation === "page" ? 0.34 : 0.46;
      return 1;
    }

    function baseLinkStrokeWidth(edge) {
      if (edge.relation === "page") return numberOr(graphConfig.edges.page_width, 1.1);
      if (edge.relation === "hierarchy") return numberOr(graphConfig.edges.hierarchy_width, 1.4);
      if (edge.relation === "sibling") return numberOr(graphConfig.edges.sibling_width, 0.8);
      if (edge.relation === "nav") return numberOr(graphConfig.edges.nav_width, 0.8);
      if (isPageGraph) return edge.relation === "hierarchy" ? 1.9 : 1.5;
      if (usesConceptGraphView) {
        if (edge.relation === "hierarchy") return isCompactConceptPreview ? 1.7 : 2.0;
        if (edge.relation === "page") return isCompactConceptPreview ? 1.3 : 1.6;
        if (edge.relation === "nav") return 1.2;
      }
      if (isSiteGraph) {
        if (edge.relation === "page") return 1.35;
        if (edge.relation === "nav") return 1.3;
        if (edge.relation === "hierarchy") return 1.6;
        if (edge.relation === "sibling") return 1.2;
      }
      return 1.5;
    }

    
    const link = g
      .append("g")
      .selectAll("path")
      .data(sortedEdges)
      .join("path")
      .attr("class", "graph-link")
      .attr("stroke",       "var(--graph-edge-color, rgba(0,0,0,0.18))")
      .attr("stroke-width", baseLinkStrokeWidth)
      .attr("fill", "none")
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .style("visibility", (edge) => isDefaultVisibleEdge(edge) ? "visible" : "hidden")
      .attr("opacity", (edge) => isDefaultVisibleEdge(edge) ? baseLinkOpacity(edge) : 0);

    const highlightOnlyLink = g
      .append("g")
      .selectAll("path")
      .data(highlightOnlyEdges)
      .join("path")
      .attr("class", "graph-link graph-link--highlight-context")
      .attr("stroke", "var(--graph-connected-color, var(--md-accent-fg-color, #ff6d00))")
      .attr("stroke-width", 2.3)
      .attr("fill", "none")
      .attr("stroke-linecap", "round")
      .attr("stroke-linejoin", "round")
      .attr("pointer-events", "none")
      .attr("opacity", 0);

    
    
    
    const hitEdges = graphConfig.ui.enable_edge_click
      ? [...sortedEdges, ...highlightOnlyEdges].filter((e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          return !s.startsWith("cat:") && !t.startsWith("cat:")
            && !(Array.isArray(e.pages) && e.pages.includes("__nav__"));
        })
      : [];

    
    
    
    let _pendingEdgeClick = null;

    const linkHit = g
      .append("g")
      .selectAll("path")
      .data(hitEdges)
      .join("path")
      .attr("class", "graph-link-hit")
      .attr("stroke", "rgba(0,0,0,0.001)")
      .attr("stroke-width", 12)
      .attr("pointer-events", (d) => (isHighlightOnlyEdge(d) || !isDefaultVisibleEdge(d)) ? "none" : "all")
      .attr("fill", "none")
      .attr("cursor", graphConfig.ui.enable_edge_click ? "pointer" : "default")
      .on("pointerdown", (event, d) => {
        
        _pendingEdgeClick = { d, x: event.clientX, y: event.clientY };
      })
      .on("pointerenter", (_, d) => {
        if (hoverInteractionsDisabled) return;
        if (isShiftHighlightLocked()) return;
        if (!hoverHighlightEnabled()) return;
        if (hasActiveVisualHighlight()) return;
        const sid = edgeSourceId(d), tid = edgeTargetId(d);
        link
          .attr("stroke", (e) => {
            const s = typeof e.source === "object" ? e.source.id : e.source;
            const t = typeof e.target === "object" ? e.target.id : e.target;
            return s === sid && t === tid
              ? "var(--graph-connected-color, #f5c472)"
              : "var(--graph-edge-color, rgba(0,0,0,0.18))";
          })
          .attr("stroke-width", (e) => {
            const s = typeof e.source === "object" ? e.source.id : e.source;
            const t = typeof e.target === "object" ? e.target.id : e.target;
            return s === sid && t === tid ? 3 : 1.5;
          });
      })
      .on("pointerleave", () => {
        if (hoverInteractionsDisabled) return;
        if (isShiftHighlightLocked()) return;
        if (!hoverHighlightEnabled()) return;
        if (hasActiveVisualHighlight()) return;
        link
          .attr("stroke", "var(--graph-edge-color, rgba(0,0,0,0.18))")
          .attr("stroke-width", baseLinkStrokeWidth)
          .attr("opacity", baseLinkOpacity);
      });

    
    
    
    svg.node().addEventListener("pointerup", (event) => {
      if (!_pendingEdgeClick) return;
      const { d, x, y } = _pendingEdgeClick;
      _pendingEdgeClick = null;
      const dx = event.clientX - x;
      const dy = event.clientY - y;
      if (dx * dx + dy * dy < 25) {  
        const sourceId = edgeSourceId(d);
        const targetId = edgeTargetId(d);
        const sourceNode = nodeById.get(sourceId);
        const targetNode = nodeById.get(targetId);
        if (!sourceNode || !targetNode) return;
        dismissIncomingHighlight();
        closeContainingGraphModal();
        const edgePages = Array.isArray(d.pages)
          ? d.pages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__")
          : [];
        const scopedEdgePages = scopeEdgeClickPages(edgePages, {
          relation: d.relation || null,
          sourceId,
          targetId,
          currentPageUrl,
          graphData,
          preferCurrentPageScope: isPageGraph,
        });
        document.dispatchEvent(
          new CustomEvent("wikilink:open-edge-pane", {
            detail: {
              sourceId,
              sourceLabel: sourceNode.label,
              sourceType:  sourceNode.type,
              sourceUrl:   sourceNode.url || null,
              targetId,
              targetLabel: targetNode.label,
              targetType:  targetNode.type,
              relation:    d.relation || null,
              pages:       scopedEdgePages,
              preferCurrentPageScope: isPageGraph,
              contextScope: isPageGraph ? "current_page_first" : graphConfig.pane.context_scope,
            },
          })
        );
      }
    }, true);  

    
    const node = g
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", (d) => `graph-node graph-node--${d.type}`)
      .attr("cursor", graphConfig.ui.enable_node_click ? "pointer" : "default")
      .call(dragBehavior(simulation, mode, syncGraphState));

    
    
    function kwRadius(d) {
      if (d.type === "category") return configuredCategoryRadius || rPage * 1.5;
      if (d.type === "page")     return rPage;
      if (graphConfig.nodes.size_metric === "fixed") return rKw;
      const count = graphConfig.nodes.size_metric === "occurrence_count"
        ? (d.occurrence_count || 1)
        : (d.page_count || 1);
      return rKw * (0.6 + 0.4 * Math.sqrt(count));
    }

    
    
    
    
    node.append("circle")
      .attr("class",        "graph-node__circle")
      .attr("r", kwRadius)
      .attr("fill",         (d) => restFill(d))
      .attr("stroke",       "var(--md-default-bg-color, #fff)")
      .attr("stroke-width", 2);

    
    if (graphConfig.ui.show_labels) {
      node.each(function (d) {
        const r = kwRadius(d);
        const configuredBaseFont = d.type === "page"
          ? numberOr(graphConfig.labels.page_font_size, graphConfig.labels.font_size)
          : d.type === "category"
            ? numberOr(graphConfig.labels.category_font_size, graphConfig.labels.font_size)
            : numberOr(graphConfig.labels.font_size, 13);
        const fontSize = isPageGraphModal || (isConceptGraph && !isCompactConceptPreview)
          ? numberOr(graphConfig.labels.modal_font_size, configuredBaseFont)
          : isPreviewGraph || isCompactConceptPreview
            ? numberOr(graphConfig.labels.preview_font_size, configuredBaseFont)
            : configuredBaseFont;
        const text = d3.select(this).append("text")
          .attr("class",          "graph-label")
          .attr("text-anchor",    "middle")
          .attr("y",              r + 4)
          .attr("font-weight",    String(numberOr(graphConfig.labels.font_weight, 400)))
          .attr("pointer-events", "none")
          .style("font-size",     `${fontSize}px`);
        if (!graphConfig.labels.outline) {
          text.style("paint-order", "normal").style("stroke", "none");
        }

        const labelWrapWidth = d.type === "page"
          ? (isPageGraphModal ? 32 : (isPageGraph ? 28 : (isConceptGraph ? 27 : 20)))
          : (isPageGraphModal ? 26 : (isPageGraph ? 24 : (isCompactConceptPreview ? 22 : (isConceptGraph ? 24 : 18))));
        wrapText(
          text,
          d.label,
          numberOr(graphConfig.labels.wrap_chars, labelWrapWidth),
          numberOr(graphConfig.labels.max_lines, 3)
        );
      });
    }

    const keywordLabelZoomThreshold = typeof graphConfig.ui.keyword_label_zoom_threshold === "number"
      ? graphConfig.ui.keyword_label_zoom_threshold
      : 1.35;
    let currentSiteLabelMode = "all";
    let activeLabelSet = null;

    function isViewportVisible(nodeDatum) {
      const widthNow = container.clientWidth || width;
      const heightNow = container.clientHeight || height;
      const sx = currentZoomTransform.applyX(nodeDatum.x || 0);
      const sy = currentZoomTransform.applyY(nodeDatum.y || 0);
      const pad = Math.max(36, kwRadius(nodeDatum) + 14);
      return sx >= -pad && sx <= widthNow + pad && sy >= -pad && sy <= heightNow + pad;
    }

    function shouldShowLabel(nodeDatum, fullSet = activeLabelSet) {
      if (!graphConfig.ui.show_labels) return false;
      if (fullSet) {
        return fullSet.has(nodeDatum.id) || isDefaultVisibleNode(nodeDatum);
      }
      return isDefaultVisibleNode(nodeDatum);
    }

    function updateLabelHighlight(fullSet = null) {
      if (!graphConfig.ui.show_labels) return;
      activeLabelSet = fullSet ? new Set(fullSet) : null;
      node.select("text.graph-label")
        .style("fill", "var(--graph-label-color, currentColor)")
        .attr("display", (d) => shouldShowLabel(d, activeLabelSet) ? null : "none");
    }

    function setSiteLabelMode(nextMode) {
      currentSiteLabelMode = "all";
      updateLabelHighlight();
    }

    
    node.append("title").text((d) => d.label);
    updateLabelHighlight();
    if (defaultVisibleNodeIds) {
      node
        .style("visibility", (d) => isDefaultVisibleNode(d) ? "visible" : "hidden")
        .style("pointer-events", (d) => isDefaultVisibleNode(d) ? "auto" : "none");
      node.attr("opacity", (d) => isDefaultVisibleNode(d) ? 1 : 0);
    }

    

    let activeSearchQuery = "";
    let incomingHighlightActive = Boolean(highlightKw || highlightPageId) && freezeHighlightKw;
    let incomingHighlightTimer = null;
    let activeStickyHoverId = null;
    let activeTransientHoverId = null;
    let pointerHoverNodeId = null;
    let shiftFreezeActive = false;
    let uiStateListener = null;

    function hoverHighlightEnabled() {
      return !enableHoverFreeze || shiftFreezeActive;
    }

    function isShiftHighlightLocked() {
      return enableHoverFreeze && shiftFreezeActive && Boolean(activeStickyHoverId);
    }

    function hasActiveVisualHighlight() {
      return Boolean(activeSearchQuery || activeStickyHoverId || activeTransientHoverId || incomingHighlightActive);
    }

    function getActiveHighlightNode() {
      const activeId = activeStickyHoverId || activeTransientHoverId;
      return activeId ? (nodeById.get(activeId) || null) : null;
    }

    function getUiState() {
      const activeNode = getActiveHighlightNode();
      return {
        hasActiveHighlight: Boolean(activeNode),
        activeLabel: activeNode?.label || "",
        anchorLabel: usesConceptGraphPathHighlight
          ? (graphData?._conceptKeyword || "")
          : "",
        shiftFreezeActive,
      };
    }

    function notifyUiState() {
      uiStateListener?.(getUiState());
    }

    function setUiStateListener(listener) {
      uiStateListener = listener;
      notifyUiState();
    }

    function cancelIncomingHighlight() {
      if (!incomingHighlightActive) return false;
      incomingHighlightActive = false;
      if (incomingHighlightTimer) {
        clearTimeout(incomingHighlightTimer);
        incomingHighlightTimer = null;
      }
      const params = new URLSearchParams(location.search);
      let changed = false;
      if (params.has("kw")) {
        params.delete("kw");
        changed = true;
      }
      if (params.has("page")) {
        params.delete("page");
        changed = true;
      }
      if (changed) {
        const query = params.toString();
        const nextUrl = `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
        history.replaceState(history.state, "", nextUrl);
      }
      return true;
    }

    function resetFrozenHighlight() {
      activeStickyHoverId = null;
      activeTransientHoverId = null;
      cancelIncomingHighlight();
      notifyUiState();
    }

    function clearActiveGraphHighlight() {
      resetFrozenHighlight();
      if (activeSearchQuery) setSearchHighlight(activeSearchQuery);
      else if (usesConceptGraphPathHighlight) applyConceptFocalHighlight();
      else clearHighlight();
    }

    function dismissIncomingHighlight() {
      if (!incomingHighlightActive && !activeStickyHoverId) return false;
      clearActiveGraphHighlight();
      return true;
    }

    
    
    function getActiveMaps(pageScope = graphConfig.hover.page_scope) {
      if (pageScope === "all_pages") return allMaps;
      if (pageScope === "current_page_only") return scopedMaps;
      return currentPageUrl && scopedEdges.length ? scopedMaps : allMaps;
    }

    function getEffectiveHoverConfig({ forSearch = false } = {}) {
      if (!graphConfig.hover.enabled || graphConfig.hover.mode === "none") {
        return graphConfig.hover;
      }
      return graphConfig.hover;
    }

    function addAncestorChain(nodeId, set, maps) {
      const stack = [nodeId];
      const seen = new Set();

      while (stack.length) {
        const current = stack.pop();
        if (seen.has(current)) continue;
        seen.add(current);

        const parents = maps.hierarchyParents.get(current) || new Set();
        for (const parentId of parents) {
          if (!set.has(parentId)) set.add(parentId);
          stack.push(parentId);
        }
      }
      return set;
    }

    function addDescendantChain(nodeId, set, maps) {
      const stack = [nodeId];
      const seen = new Set();

      while (stack.length) {
        const current = stack.pop();
        if (seen.has(current)) continue;
        seen.add(current);

        const children = maps.hierarchyChildren.get(current) || new Set();
        for (const childId of children) {
          if (!set.has(childId)) set.add(childId);
          stack.push(childId);
        }
      }
      return set;
    }

    function addSiblingNodes(nodeId, set, maps) {
      const parents = maps.hierarchyParents.get(nodeId) || new Set();
      parents.forEach((parentId) => {
        const siblings = maps.hierarchyChildren.get(parentId) || new Set();
        siblings.forEach((siblingId) => set.add(siblingId));
      });
      return set;
    }

    function isPageHierarchyCoSibling(currentId, parentId) {
      const grandparentEntries = pageHierarchyIndex.parentsByChild.get(parentId) || [];
      return grandparentEntries.some((grandparentEntry) => {
        const siblingEntries = pageHierarchyIndex.childrenByParent.get(grandparentEntry.parentId) || [];
        const siblingIds = siblingEntries.map((entry) => entry.childId);
        return siblingIds.includes(currentId) && siblingIds.includes(parentId);
      });
    }

    function selectPageHoverParentEntry(currentId) {
      const parentEntries = pageHierarchyIndex.parentsByChild.get(currentId) || [];
      return parentEntries.find((entry) => !isPageHierarchyCoSibling(currentId, entry.parentId)) || null;
    }

    function addPageHierarchyCoChildrenForHover(nodeId, set) {
      (pageHierarchyIndex.parentsByChild.get(nodeId) || []).forEach((parentEntry) => {
        const parentId = parentEntry.parentId;
        if (isPageHierarchyCoSibling(nodeId, parentId)) return;
        set.add(parentId);
        (pageHierarchyIndex.childrenByParent.get(parentId) || []).forEach((childEntry) => {
          set.add(childEntry.childId);
        });
      });
      (pageHierarchyIndex.childrenByParent.get(nodeId) || []).forEach((childEntry) => {
        set.add(childEntry.childId);
      });
      return set;
    }

    function addPageHierarchyCoChildrenEdgeKeysForHover(nodeId, keys) {
      (pageHierarchyIndex.parentsByChild.get(nodeId) || []).forEach((parentEntry) => {
        const parentId = parentEntry.parentId;
        if (isPageHierarchyCoSibling(nodeId, parentId)) return;
        (pageHierarchyIndex.childrenByParent.get(parentId) || []).forEach((childEntry) => {
          addCandidateEdgeKeys(keys, "hierarchy", parentId, childEntry.childId);
        });
      });
      (pageHierarchyIndex.childrenByParent.get(nodeId) || []).forEach((childEntry) => {
        addCandidateEdgeKeys(keys, "hierarchy", nodeId, childEntry.childId);
      });
      return keys;
    }

    function collectPageKeywordHoverSet(nodeId) {
      const set = new Set([nodeId]);
      const seen = new Set();
      let rootId = nodeId;
      let currentId = nodeId;

      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const parentEntry = selectPageHoverParentEntry(currentId);
        if (!parentEntry || set.has(parentEntry.parentId)) break;
        rootId = parentEntry.parentId;
        set.add(parentEntry.parentId);
        currentId = parentEntry.parentId;
      }

      addPageHierarchyCoChildrenForHover(nodeId, set);

      if (currentPageUrl) {
        const pageId = `page:${currentPageUrl}`;
        if (nodeById.has(pageId)) {
          set.add(pageId);
          if (rootId.startsWith("kw:")) set.add(rootId);
        }
      }

      return set;
    }

    function addPageNodesForKeywords(set, maps) {
      for (const id of [...set]) {
        const pageIds = maps.keywordPages.get(id);
        if (!pageIds) continue;
        pageIds.forEach((pageId) => set.add(pageId));
      }
      return set;
    }

    function addPageContextForKeywords(keywordIds, targetSet, maps) {
      const pageIds = addMentionPageContextForKeywords(keywordIds, targetSet, maps);
      addCategoryContextForPages(pageIds, targetSet, maps);
      return pageIds;
    }

    function addMentionPageContextForKeywords(keywordIds, targetSet, maps) {
      const pageIds = new Set();
      keywordIds.forEach((keywordId) => {
        const pageRefs = maps.keywordPages.get(keywordId);
        if (!pageRefs) return;
        pageRefs.forEach((pageRef) => {
          const pageId = pageRef.startsWith("page:")
            ? pageRef
            : pageIdByUrl.get(pageRef);
          if (!pageId) return;
          pageIds.add(pageId);
          targetSet.add(pageId);
        });
      });
      return pageIds;
    }

    function addCategoryContextForPages(pageIds, targetSet, maps) {
      pageIds.forEach((pageId) => {
        addNavAncestorNodesForPageId(pageId, maps, targetSet);
      });
      return targetSet;
    }

    function addHierarchySiblingKeywords(nodeId, targetSet, maps) {
      const parents = maps.hierarchyParents.get(nodeId) || new Set();
      parents.forEach((parentId) => {
        (maps.hierarchyChildren.get(parentId) || new Set()).forEach((siblingId) => {
          if (siblingId !== nodeId) targetSet.add(siblingId);
        });
      });
      return targetSet;
    }

    function addStoryPageContextForKeyword(nodeId, targetSet, maps) {
      const storyPages = new Set();
      const candidatePages = new Set();
      const rootPageRefs = maps.keywordRootPages?.get(nodeId) || new Set();
      rootPageRefs.forEach((pageRef) => {
        const pageId = pageRef.startsWith("page:")
          ? pageRef
          : pageIdByUrl.get(pageRef);
        const pageUrl = pageId && nodeById.has(pageId)
          ? (nodeById.get(pageId)?.url || pageId.replace(/^page:/, ""))
          : null;
        if (pageUrl) candidatePages.add(pageUrl);
      });
      (maps.hierarchyParents.get(nodeId) || new Set()).forEach((parentId) => {
        const edgePages = maps.hierarchyEdgePages?.get(`${parentId}->${nodeId}`) || new Set();
        edgePages.forEach((pageUrl) => {
          if (pageUrl && pageUrl !== "__nav__") candidatePages.add(pageUrl);
        });
      });

      const selectedPageUrl = [...candidatePages].sort((a, b) => {
        const pageA = nodeById.get(pageIdByUrl.get(a) || `page:${a}`);
        const pageB = nodeById.get(pageIdByUrl.get(b) || `page:${b}`);
        return (pageA?.label || a).localeCompare(pageB?.label || b, undefined, { numeric: true });
      })[0] || null;
      const selectedPageScope = selectedPageUrl ? new Set([selectedPageUrl]) : null;

      if (selectedPageScope) {
        selectedPageScope.forEach((pageUrl) => storyPages.add(pageUrl));
      }

      const stack = [{ keywordId: nodeId, pageScope: selectedPageScope }];
      const seen = new Set();

      while (stack.length) {
        const { keywordId: childId, pageScope } = stack.pop();
        const scopeKey = pageScope ? [...pageScope].sort().join("|") : "*";
        const seenKey = `${childId}@@${scopeKey}`;
        if (seen.has(seenKey)) continue;
        seen.add(seenKey);
        const parents = maps.hierarchyParents.get(childId) || new Set();
        parents.forEach((parentId) => {
          const edgePages = maps.hierarchyEdgePages?.get(`${parentId}->${childId}`) || new Set();
          const matchingPages = pageScope
            ? new Set([...edgePages].filter((pageUrl) => pageScope.has(pageUrl)))
            : new Set(edgePages);
          if (!matchingPages.size && edgePages.size) return;
          targetSet.add(parentId);
          matchingPages.forEach((pageUrl) => storyPages.add(pageUrl));
          stack.push({ keywordId: parentId, pageScope: matchingPages.size ? matchingPages : pageScope });
        });
      }

      if (!storyPages.size) {
        return addPageContextForKeywords([nodeId], targetSet, maps);
      }

      storyPages.forEach((pageUrl) => {
        const pageId = pageUrl.startsWith("page:")
          ? pageUrl
          : pageIdByUrl.get(pageUrl) || `page:${pageUrl}`;
        if (!nodeById.has(pageId)) return;
        targetSet.add(pageId);
        addCategoryContextForPages(new Set([pageId]), targetSet, maps);
      });

      return storyPages;
    }

    function filterHighlightSetByHoverIncludes(set, hoverConfig) {
      if (hoverConfig.include_page === false) {
        [...set].forEach((id) => {
          if (id.startsWith("page:")) set.delete(id);
        });
      }
      if (hoverConfig.include_categories === false) {
        [...set].forEach((id) => {
          if (id.startsWith("cat:")) set.delete(id);
        });
      }
      return set;
    }

    function collectSiteKeywordHoverSet(nodeId, hops, maps, hoverConfig = graphConfig.hover) {
      const included = new Set([nodeId]);
      const includedKeywords = new Set([nodeId]);

      if (hoverConfig.preserve_story_chain !== false) addStoryPageContextForKeyword(nodeId, included, maps);
      [...included]
        .filter((id) => id.startsWith("kw:"))
        .forEach((keywordId) => includedKeywords.add(keywordId));

      if (hops < 2) return filterHighlightSetByHoverIncludes(included, hoverConfig);

      let frontier = new Set();
      (maps.keywordAdjacency.get(nodeId) || new Set()).forEach((nextId) => {
        if (!nextId.startsWith("kw:") || includedKeywords.has(nextId)) return;
        includedKeywords.add(nextId);
        included.add(nextId);
        frontier.add(nextId);
      });

      for (let depth = 3; depth <= hops && frontier.size; depth++) {
        const nextFrontier = new Set();
        frontier.forEach((keywordId) => {
          const localKeywords = new Set();
          (maps.hierarchyParents.get(keywordId) || new Set()).forEach((parentId) => localKeywords.add(parentId));
          addHierarchySiblingKeywords(keywordId, localKeywords, maps);
          (maps.keywordSiblingAdjacency.get(keywordId) || new Set()).forEach((siblingId) => localKeywords.add(siblingId));

          localKeywords.forEach((nextId) => {
            if (!nextId.startsWith("kw:") || includedKeywords.has(nextId)) return;
            includedKeywords.add(nextId);
            included.add(nextId);
            nextFrontier.add(nextId);
          });
        });
        frontier = nextFrontier;
      }

      addPageContextForKeywords(
        [...included].filter((id) => id.startsWith("kw:")),
        included,
        maps
      );
      return filterHighlightSetByHoverIncludes(included, hoverConfig);
    }

    function collectNHopSet(nodeId, hops, maps) {
      const set = new Set([nodeId]);
      const queue = [{ id: nodeId, depth: 0 }];
      while (queue.length) {
        const { id, depth } = queue.shift();
        if (depth >= hops) continue;
        (maps.adjacency.get(id) || new Set()).forEach((nextId) => {
          if (set.has(nextId)) return;
          set.add(nextId);
          queue.push({ id: nextId, depth: depth + 1 });
        });
      }
      return set;
    }

    function collectPageBranchSet(nodeId, maps) {
      const set = new Set([nodeId]);
      const queue = [nodeId];
      while (queue.length) {
        const current = queue.shift();
        (maps.adjacency.get(current) || new Set()).forEach((nextId) => {
          if (nextId.startsWith("cat:")) return;
          if (set.has(nextId)) return;
          set.add(nextId);
          queue.push(nextId);
        });
      }
      return set;
    }

    function collectCategoryPageSet(categoryId, maps) {
      const set = new Set([categoryId]);
      const queue = [categoryId];
      while (queue.length) {
        const current = queue.shift();
        (maps.adjacency.get(current) || new Set()).forEach((nextId) => {
          if (!nextId.startsWith("cat:") && !nextId.startsWith("page:")) return;
          if (set.has(nextId)) return;
          set.add(nextId);
          if (nextId.startsWith("cat:") || maps.pageNavChildren?.has(nextId)) queue.push(nextId);
        });
      }
      return set;
    }

    function collectHighlightSet(d, options = {}) {
      const hoverConfig = getEffectiveHoverConfig(options);
      const maps = getActiveMaps(hoverConfig.page_scope);
      if (hoverConfig.mode === "none") return new Set();
      if (isPageGraph && !options.forSearch && d.type === "keyword") {
        return collectPageKeywordHoverSet(d.id);
      }
      if (isConceptGraph && !options.forSearch && d.type === "keyword") {
        const set = new Set([d.id]);
        if (hoverConfig.include_hierarchy_ancestors !== false) addAncestorChain(d.id, set, maps);
        if (hoverConfig.include_hierarchy_descendants !== false) addDescendantChain(d.id, set, maps);
        if (hoverConfig.include_siblings) addSiblingNodes(d.id, set, maps);
        if (hoverConfig.include_page) {
          const keywordIds = [...set].filter((id) => id.startsWith("kw:"));
          addPageContextForKeywords(keywordIds, set, maps);
        }
        return filterHighlightSetByHoverIncludes(set, hoverConfig);
      }
      if (!options.forSearch && d.type === "keyword") {
        const sourceGraph = graphData?._sourceGraph || null;
        if (sourceGraph && (isSiteGraph || usesConceptGraphView)) {
          const visibility = computeConceptMentionModuleVisibility(sourceGraph, d, currentPageUrl);
          if (visibility?.nodeIds?.size) {
            return filterHighlightSetByHoverIncludes(new Set(visibility.nodeIds), hoverConfig);
          }
        }
      }
      if (d.type === "category") {
        return hoverConfig.include_categories === false ? new Set([d.id]) : collectCategoryPageSet(d.id, maps);
      }
      if (d.type === "page") {
        const pageUrl   = d.url || d.id.replace(/^page:/, "");
        const pageId    = d.id;
        const set = new Set([pageId]);
        const pageIds = new Set([pageId]);
        const directKeywords = new Set();
        const pageHierarchy = sitePageHierarchyIndex.get(pageUrl);

        highlightContextEdges.forEach((e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          if (e.relation !== "page") return;
          const touchesPage = s === pageId || t === pageId || (Array.isArray(e.pages) && e.pages.includes(pageUrl));
          if (!touchesPage) return;
          if (s === pageId && t.startsWith("kw:")) directKeywords.add(t);
          if (t === pageId && s.startsWith("kw:")) directKeywords.add(s);
          if (s.startsWith("kw:") && t.startsWith("page:") && t === pageId) directKeywords.add(s);
          if (t.startsWith("kw:") && s.startsWith("page:") && s === pageId) directKeywords.add(t);
        });

        const rootKeywords = pageHierarchy
          ? [...directKeywords].filter((keywordId) => !(pageHierarchy.parentsByChild.get(keywordId) || []).length)
          : [...directKeywords];
        const keywordQueue = rootKeywords.length ? [...rootKeywords] : [...directKeywords];

        keywordQueue.forEach((keywordId) => set.add(keywordId));
        while (keywordQueue.length) {
          const keywordId = keywordQueue.shift();
          (pageHierarchy?.childrenByParent.get(keywordId) || []).forEach((entry) => {
            if (set.has(entry.childId)) return;
            set.add(entry.childId);
            keywordQueue.push(entry.childId);
          });
        }

        addNavDescendantNodesForPageId(pageId, maps, set);
        if (hoverConfig.include_categories !== false) addNavAncestorNodesForPageId(pageId, maps, set);
        return filterHighlightSetByHoverIncludes(set, hoverConfig);
      }
      if (hoverConfig.mode === "direct_neighbors") {
        return collectNHopSet(d.id, 1, maps);
      }
      if (hoverConfig.mode === "n_hop_neighbors") {
        return collectNHopSet(d.id, hoverConfig.hops || 1, maps);
      }
      if (d.type === "keyword") {
        if (hoverConfig.mode === "page_branch") {
          const set = collectPageBranchSet(d.id, maps);
          return hoverConfig.include_page ? addPageNodesForKeywords(set, maps) : set;
        }
        const set = new Set([d.id]);
        if (hoverConfig.include_hierarchy_ancestors !== false) addAncestorChain(d.id, set, maps);
        if (hoverConfig.include_hierarchy_descendants !== false) addDescendantChain(d.id, set, maps);
        if (hoverConfig.include_siblings) addSiblingNodes(d.id, set, maps);
        return filterHighlightSetByHoverIncludes(hoverConfig.include_page ? addPageNodesForKeywords(set, maps) : set, hoverConfig);
      } else {
        const neighbours = maps.adjacency.get(d.id) || new Set();
        return new Set([d.id, ...neighbours]);
      }
    }

    function collectExactSiteKeywordEdgeKeys(d) {
      if (!isSiteGraph || !d || d.type !== "keyword") return null;
      const sourceGraph = graphData?._sourceGraph || null;
      if (!sourceGraph) return null;
      const visibility = computeConceptMentionModuleVisibility(sourceGraph, d, currentPageUrl);
      if (!visibility?.edgeKeys?.size) return null;
      return new Set(visibility.edgeKeys);
    }

    function filterSiteKeywordHighlightSetByEdges(d, highlightedSet, edgeKeys) {
      if (!isSiteGraph || !d || d.type !== "keyword" || !(highlightedSet instanceof Set) || !(edgeKeys instanceof Set)) {
        return highlightedSet;
      }
      const connectedSet = new Set([d.id]);
      activeHighlightCandidateEdges.forEach((edge) => {
        if (!edgeKeys.has(graphEdgeKey(edge))) return;
        const sourceId = edgeSourceId(edge);
        const targetId = edgeTargetId(edge);
        if (!highlightedSet.has(sourceId) || !highlightedSet.has(targetId)) return;
        connectedSet.add(sourceId);
        connectedSet.add(targetId);
      });
      return connectedSet;
    }

    function buildKeywordHighlightOptions(d) {
      const highlightedSet = collectHighlightSet(d);
      const activeEdgeKeys = collectExactSiteKeywordEdgeKeys(d);
      const exactEdgeKeys = activeEdgeKeys || collectExactPageKeywordEdgeKeys(d);
      return {
        highlightedSet: filterSiteKeywordHighlightSetByEdges(d, highlightedSet, activeEdgeKeys),
        exactEdgeKeys,
        exactEdgesOverrideRelationFilters: Boolean(activeEdgeKeys),
      };
    }

    function addCandidateEdgeKeys(keys, relation, sourceId, targetId, { bidirectional = false } = {}) {
      if (!relation || !sourceId || !targetId) return keys;
      keys.add(`${relation}:${sourceId}->${targetId}`);
      if (bidirectional) keys.add(`${relation}:${targetId}->${sourceId}`);
      return keys;
    }

    function collectExactPageKeywordEdgeKeys(d) {
      if (!isPageGraph || !d || d.type !== "keyword" || !currentPageUrl) return null;
      const keys = new Set();
      const seen = new Set();
      let rootId = d.id;
      let currentId = d.id;

      while (currentId && !seen.has(currentId)) {
        seen.add(currentId);
        const parentEntry = selectPageHoverParentEntry(currentId);
        if (!parentEntry) break;
        addCandidateEdgeKeys(keys, "hierarchy", parentEntry.parentId, currentId);
        rootId = parentEntry.parentId;
        currentId = parentEntry.parentId;
      }

      addPageHierarchyCoChildrenEdgeKeysForHover(d.id, keys);

      const pageId = `page:${currentPageUrl}`;
      if (nodeById.has(pageId)) {
        if (rootId.startsWith("kw:")) addCandidateEdgeKeys(keys, "page", pageId, rootId, { bidirectional: true });
      }

      return keys.size ? keys : null;
    }

    
    
    
    
    
    
    
    const baseLabelWeight = String(numberOr(graphConfig.labels.font_weight, 400));
    
    const haloDiscGap = isCompactConceptPreview ? 9 : 20;
    const FOCAL_HALO = {
      color: "var(--graph-focal-halo-color, #0197a7)",
      discOpacity: 0.12,
      ringOpacity: 0.4,
      ringGap: isCompactConceptPreview ? 5 : 11,
    };
    const HOVER_HALO = {
      color: "var(--graph-hover-halo-color, #e8952e)",
      discOpacity: 0.16,
      ringOpacity: 0.5,
      ringGap: isCompactConceptPreview ? 5 : 10,
    };
    
    
    let hoverHaloIds = new Set();

    function haloRoleFor(n) {
      if (usesFocalHalo() && n.id === focalHaloId) return FOCAL_HALO;
      if (hoverHaloIds.has(n.id)) return HOVER_HALO;
      return null;
    }

    
    
    
    function ensureHalo(g) {
      let halo = g.select("g.graph-node-halo");
      if (!halo.empty()) return halo;
      halo = g.insert("g", ":first-child")
        .attr("class", "graph-node-halo")
        .attr("pointer-events", "none");
      halo.append("circle")
        .attr("class", "graph-node-halo__disc")
        .attr("pointer-events", "none");
      halo.append("circle")
        .attr("class", "graph-node-halo__ring")
        .attr("pointer-events", "none");
      return halo;
    }

    
    
    
    function refreshHalos() {
      node.each(function (n) {
        const g = d3.select(this);
        const role = haloRoleFor(n);
        if (!role) {
          g.select("g.graph-node-halo").style("display", "none");
          return;
        }
        const halo = ensureHalo(g);
        const r = kwRadius(n);
        halo.style("display", null);
        halo.select(".graph-node-halo__disc")
          .attr("r", r + haloDiscGap)
          .attr("fill", role.color)
          .attr("opacity", role.discOpacity);
        halo.select(".graph-node-halo__ring")
          .attr("r", r + role.ringGap)
          .attr("fill", "none")
          .attr("stroke", role.color)
          .attr("stroke-width", 2)
          .attr("opacity", role.ringOpacity);
      });
      if (graphConfig.ui.show_labels) {
        node.select("text.graph-label")
          .attr("font-weight", (n) => (haloRoleFor(n) ? 700 : baseLabelWeight));
      }
    }

    
    
    
    
    function paintFocalHalo() {
      if (usesFocalHalo() && nodeById.get(focalHaloId)) {
        node.select("circle.graph-node__circle")
          .filter((n) => n.id === focalHaloId)
          .attr("fill", (n) => restFill(n))
          .attr("stroke", FOCAL_HALO.color)
          .attr("stroke-width", 3);
        node.filter((n) => n.id === focalHaloId)
          .style("visibility", "visible")
          .style("pointer-events", "auto")
          .attr("opacity", 1);
        node.select("text.graph-label")
          .filter((n) => n.id === focalHaloId)
          .attr("display", null);
      }
      refreshHalos();
    }

    
    function applyConceptFocalHighlight() {
      if (!usesConceptGraphPathHighlight || !conceptTargetId) return;
      if (!nodeById.get(conceptTargetId)) return;
      activeStickyHoverId = conceptTargetId;
      activeTransientHoverId = null;
      hoverHaloIds = new Set();
      applyTeachingPathVisibility();
      
      
      
      node.select("circle.graph-node__circle")
        .attr("fill", (n) => restFill(n))
        .attr("stroke", (n) => n.id === conceptTargetId
          ? "var(--graph-focal-halo-color, #0197a7)"
          : "var(--md-default-bg-color, #fff)")
        .attr("stroke-width", (n) => n.id === conceptTargetId ? 3 : 2);
      link.attr("stroke", "var(--graph-edge-color, rgba(0,0,0,0.18))")
        .attr("stroke-width", baseLinkStrokeWidth);
      paintFocalHalo();
      notifyUiState();
    }

    function applyConceptPathHighlight(nodeDatum) {
      if (!usesConceptGraphPathHighlight) return;
      if (nodeDatum.id === conceptTargetId) {
        applyConceptFocalHighlight();
        return;
      }
      activeStickyHoverId = nodeDatum.id;
      activeTransientHoverId = null;
      const pathNodes = collectConceptGraphPathHighlight(
        nodeDatum,
        conceptTargetId,
        conceptStoryPrefixNodeIds,
        conceptTeachingPathNodeIds,
        allMaps,
        activeDefaultVisibleNodeIds,
        edges,
        conceptTeachingPathByPage
      );
      applyHighlightSet(pathNodes, nodeDatum.id, null, { dimOthers: true });
      notifyUiState();
    }

    function applyHighlightSet(highlightedSet, hoveredId = null, matchedSet = null, options = {}) {
      
      const fullSet = matchedSet
        ? new Set([...highlightedSet, ...matchedSet])
        : highlightedSet;
      const dimOthers = options.dimOthers !== false;
      const suppressEdgeHighlight = options.suppressEdgeHighlight === true;
      const exactEdgeKeys = options.exactEdgeKeys instanceof Set ? options.exactEdgeKeys : null;
      const exactEdgesOverrideRelationFilters = options.exactEdgesOverrideRelationFilters === true;
      const isHoverTarget = (id) =>
        (hoveredId && id === hoveredId) || (matchedSet && matchedSet.has(id));
      
      
      hoverHaloIds = new Set(matchedSet ? [...matchedSet] : []);
      if (hoveredId) hoverHaloIds.add(hoveredId);
      const hoveredNode = hoveredId ? (nodeById.get(hoveredId) || null) : null;
      const hoveredPageUrl = hoveredNode?.type === "page"
        ? (hoveredNode.url || hoveredNode.id.replace(/^page:/, ""))
        : null;
      function pageHoverKeywordId(edge, pageId) {
        const s = edgeSourceId(edge);
        const t = edgeTargetId(edge);
        return s === pageId && t.startsWith("kw:")
          ? t
          : t === pageId && s.startsWith("kw:")
            ? s
            : null;
      }
      function shouldHighlightPageHoverPageEdge(edge, pageId) {
        const keywordId = pageHoverKeywordId(edge, pageId);
        if (!keywordId || !fullSet.has(keywordId)) return false;
        if (!Array.isArray(edge.pages) || !edge.pages.length) return true;
        if (!edge.pages.includes(hoveredPageUrl)) return false;
        return edge._pageGraphOnly !== true;
      }
      const shouldHighlightEdge = (edge) => {
        if (suppressEdgeHighlight) return false;
        const s = edgeSourceId(edge);
        const t = edgeTargetId(edge);
        if (!fullSet.has(s) || !fullSet.has(t)) return false;
        if (exactEdgeKeys && exactEdgesOverrideRelationFilters) return exactEdgeKeys.has(graphEdgeKey(edge));
        if (edge.relation === "page" && graphConfig.hover.include_page_edges === false) return false;
        if (edge.relation === "hierarchy" && graphConfig.hover.include_hierarchy_edges === false) return false;
        if (edge.relation === "sibling" && graphConfig.hover.include_sibling_edges === false) return false;
        if (edge.relation === "nav" && graphConfig.hover.include_nav === false) return false;
        if (exactEdgeKeys) return exactEdgeKeys.has(graphEdgeKey(edge));
        if (isPageGraph) return true;
        if (matchedSet) return edge.relation === "page" || edge.relation === "nav";
        if (hoveredNode?.type === "page") {
          if (edge.relation === "nav") return true;
          if (edge.relation === "hierarchy") {
            return Array.isArray(edge.pages) && edge.pages.includes(hoveredPageUrl);
          }
          if (edge.relation === "page") {
            return shouldHighlightPageHoverPageEdge(edge, hoveredNode.id);
          }
          return false;
        }
        if (hoveredNode?.type === "keyword") {
          return (s.startsWith("kw:") && t.startsWith("kw:")
              && (edge.relation === "hierarchy" || edge.relation === "sibling"))
            || edge.relation === "page"
            || edge.relation === "nav";
        }
        return edge.relation === "page" || edge.relation === "nav";
      };
      const shouldHighlightContextEdge = (edge) => {
        if (suppressEdgeHighlight || isPageGraph) return false;
        const s = edgeSourceId(edge);
        const t = edgeTargetId(edge);
        if (!fullSet.has(s) || !fullSet.has(t)) return false;
        if (exactEdgeKeys && exactEdgesOverrideRelationFilters) return exactEdgeKeys.has(graphEdgeKey(edge));
        if (edge.relation === "page" && graphConfig.hover.include_page_edges === false) return false;
        if (edge.relation === "nav" && graphConfig.hover.include_nav === false) return false;
        if (exactEdgeKeys) return exactEdgeKeys.has(graphEdgeKey(edge));
        if (matchedSet) {
          if (edge.relation === "nav") return true;
          return (matchedSet.has(s) && t.startsWith("page:"))
            || (matchedSet.has(t) && s.startsWith("page:"));
        }
        if (hoveredNode?.type === "page") {
          if (edge.relation === "nav") return true;
          if (edge.relation === "hierarchy") {
            return Array.isArray(edge.pages) && edge.pages.includes(hoveredPageUrl);
          }
          if (edge.relation !== "page") return false;
          return shouldHighlightPageHoverPageEdge(edge, hoveredNode.id);
        }
        if (hoveredNode?.type === "keyword") {
          if (edge.relation === "hierarchy" && graphConfig.hover.include_hierarchy_edges === false) return false;
          if (edge.relation === "sibling" && graphConfig.hover.include_sibling_edges === false) return false;
          return edge.relation === "nav"
            || edge.relation === "page"
            || (s.startsWith("kw:") && t.startsWith("kw:")
              && (edge.relation === "hierarchy" || edge.relation === "sibling"));
        }
        return edge.relation === "page" || edge.relation === "nav";
      };

      
      
      
      node.select("circle.graph-node__circle")
        .attr("fill", (n) => restFill(n))
        .attr("stroke", (n) => isHoverTarget(n.id)
          ? "var(--graph-hover-halo-color, #e8952e)"
          : "var(--md-default-bg-color, #fff)")
        .attr("stroke-width", (n) => isHoverTarget(n.id) ? 3 : 2);

      const conceptPathHover = usesConceptGraphPathHighlight && dimOthers;
      const isShownNode = (n) => {
        if (conceptPathHover) return isDefaultVisibleNode(n);
        return fullSet.has(n.id) || (hoveredId && n.id === hoveredId) || isDefaultVisibleNode(n);
      };
      node
        .style("visibility", (n) => isShownNode(n) ? "visible" : "hidden")
        .style("pointer-events", (n) => isShownNode(n) ? "auto" : "none");
      node.attr("opacity", (n) => {
        if (!isShownNode(n)) return 0;
        if (!dimOthers) return 1;
        return (fullSet.has(n.id) || (hoveredId && n.id === hoveredId))
          ? 1
          : (isDefaultVisibleNode(n) ? dimmedNodeOpacity : 0);
      });
      updateLabelHighlight(dimOthers ? fullSet : null);

      const inactiveHighlightOpacity = (isPageGraph || (usesConceptGraphPathHighlight && dimOthers))
        ? dimmedLinkOpacity
        : 0;
      link
        .style("visibility", (e) => (shouldHighlightEdge(e) || isDefaultVisibleEdge(e)) ? "visible" : "hidden")
        .attr("opacity", (e) => {
          if (suppressEdgeHighlight) {
            return isDefaultVisibleEdge(e) ? baseLinkOpacity(e) : 0;
          }
          if (shouldHighlightEdge(e)) return Math.max(highlightLinkOpacity, baseLinkOpacity(e));
          if (!isDefaultVisibleEdge(e)) return 0;
          return Math.min(baseLinkOpacity(e), inactiveHighlightOpacity);
        })
        .attr("stroke", (e) => {
          if (suppressEdgeHighlight) {
            return "var(--graph-edge-color, rgba(0,0,0,0.18))";
          }
          return shouldHighlightEdge(e)
            ? "var(--graph-connected-color, var(--md-accent-fg-color, #ff6d00))"
            : "var(--graph-edge-color, rgba(0,0,0,0.18))";
        })
        .attr("stroke-width", (e) => {
          if (suppressEdgeHighlight) return baseLinkStrokeWidth(e);
          return shouldHighlightEdge(e) ? Math.max(baseLinkStrokeWidth(e), 2.3) : baseLinkStrokeWidth(e);
        });

      highlightOnlyLink
        .attr("opacity", (e) => shouldHighlightContextEdge(e) ? 1 : 0);
      linkHit
        .attr("pointer-events", (e) => isHighlightOnlyEdge(e) && !shouldHighlightContextEdge(e) ? "none" : "all");
      if (!isPageGraph) {
        linkHit
          .attr("pointer-events", (e) => {
            if (isHighlightOnlyEdge(e)) return shouldHighlightContextEdge(e) ? "all" : "none";
            return shouldHighlightEdge(e) ? "all" : "none";
          });
      }
      
      
      paintFocalHalo();
    }

    function applyHighlight(d, { sticky = true } = {}) {
      if (usesConceptGraphPathHighlight && d?.type === "keyword") {
        if (sticky) {
          activeStickyHoverId = d.id;
          activeTransientHoverId = null;
          cancelIncomingHighlight();
        } else {
          activeTransientHoverId = d.id;
        }
        applyConceptPathHighlight(d);
        return;
      }
      if (sticky) {
        activeStickyHoverId = d.id;
        activeTransientHoverId = null;
        cancelIncomingHighlight();
      } else {
        activeTransientHoverId = d.id;
      }
      const highlightOptions = buildKeywordHighlightOptions(d);
      applyHighlightSet(highlightOptions.highlightedSet, d.id, null, {
        exactEdgeKeys: highlightOptions.exactEdgeKeys,
        exactEdgesOverrideRelationFilters: highlightOptions.exactEdgesOverrideRelationFilters,
      });
      notifyUiState();
    }

    function restoreHighlightAfterTransientHover() {
      activeTransientHoverId = null;
      if (activeSearchQuery) {
        setSearchHighlight(activeSearchQuery);
      } else if (activeStickyHoverId && nodeById.has(activeStickyHoverId)) {
        const stickyNode = nodeById.get(activeStickyHoverId);
        if (usesConceptGraphPathHighlight && stickyNode.type === "keyword") {
          applyConceptPathHighlight(stickyNode);
        } else {
          const highlightOptions = buildKeywordHighlightOptions(stickyNode);
          applyHighlightSet(highlightOptions.highlightedSet, stickyNode.id, null, {
            exactEdgeKeys: highlightOptions.exactEdgeKeys,
            exactEdgesOverrideRelationFilters: highlightOptions.exactEdgesOverrideRelationFilters,
          });
          notifyUiState();
        }
      } else {
        clearHighlight();
        notifyUiState();
      }
    }

    function graphSourceForNode(d) {
      if (mode === "concept") {
        return {
          type: "concept",
          keyword: graphData._conceptKeyword || d.label || "",
        };
      }
      if (mode === "page") {
        return {
          type: "page",
          pageUrl: graphData._currentPageUrl || currentPageUrl || "",
        };
      }
      return {
        type: "site",
        keyword: d.type === "keyword" ? (d.label || "") : "",
      };
    }

    function clearHighlight() {
      hoverHaloIds = new Set();
      node.select("circle.graph-node__circle")
        .attr("fill",         (n) => restFill(n))
        .attr("stroke",       "var(--md-default-bg-color, #fff)")
        .attr("stroke-width", 2);
      applyTeachingPathVisibility();
      link.attr("stroke", "var(--graph-edge-color, rgba(0,0,0,0.18))")
          .attr("stroke-width", baseLinkStrokeWidth);
      
      paintFocalHalo();
    }

    
    
    
    
    function setSearchHighlight(query) {
      activeSearchQuery = query;
      if (!query) { clearHighlight(); return; }
      resetFrozenHighlight();
      const q = query.toLowerCase();
      const matchingNodes = nodes.filter(
        (d) => d.type === "keyword" && d.label.toLowerCase().includes(q)
      );
      if (matchingNodes.length === 0) { clearHighlight(); return; }

      
      const matchedSet = new Set(matchingNodes.map((d) => d.id));
      const fullSet = new Set(matchedSet);
      if (!isPageGraph) addPageContextForKeywords(matchedSet, fullSet, allMaps);

      
      
      hoverHaloIds = new Set(matchedSet);
      node.select("circle.graph-node__circle")
        .attr("fill", (n) => restFill(n))
        .attr("stroke", (n) => matchedSet.has(n.id)
          ? "var(--graph-hover-halo-color, #e8952e)"
          : "var(--md-default-bg-color, #fff)")
        .attr("stroke-width", (n) => matchedSet.has(n.id) ? 3 : 2);

      node
        .style("visibility", (n) => (fullSet.has(n.id) || isDefaultVisibleNode(n)) ? "visible" : "hidden")
        .style("pointer-events", (n) => (fullSet.has(n.id) || isDefaultVisibleNode(n)) ? "auto" : "none");
      node.attr("opacity", (n) => fullSet.has(n.id) ? 1 : (isDefaultVisibleNode(n) ? dimmedNodeOpacity : 0));
      updateLabelHighlight(fullSet);

      link
        .style("visibility", (e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          const active = fullSet.has(s) && fullSet.has(t) && (e.relation === "page" || e.relation === "nav");
          return active || isDefaultVisibleEdge(e) ? "visible" : "hidden";
        })
        .attr("opacity", (e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          const active = fullSet.has(s) && fullSet.has(t) && (e.relation === "page" || e.relation === "nav");
          if (active) return Math.max(highlightLinkOpacity, baseLinkOpacity(e));
          if (!isDefaultVisibleEdge(e)) return 0;
          return Math.min(baseLinkOpacity(e), isPageGraph ? dimmedLinkOpacity : 0);
        })
        .attr("stroke", (e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          const active = fullSet.has(s) && fullSet.has(t) && (e.relation === "page" || e.relation === "nav");
          return active
            ? "var(--graph-connected-color, var(--md-accent-fg-color, #ff6d00))"
            : "var(--graph-edge-color, rgba(0,0,0,0.18))";
        })
        .attr("stroke-width", (e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          const active = fullSet.has(s) && fullSet.has(t) && (e.relation === "page" || e.relation === "nav");
          return active ? Math.max(baseLinkStrokeWidth(e), 2.3) : baseLinkStrokeWidth(e);
        });

      highlightOnlyLink
        .attr("opacity", (e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          if (!fullSet.has(s) || !fullSet.has(t)) return 0;
          if (e.relation === "nav") return 1;
          return (matchedSet.has(s) && t.startsWith("page:"))
            || (matchedSet.has(t) && s.startsWith("page:"))
            ? 1
            : 0;
        });
      linkHit
        .attr("pointer-events", (e) => {
          const s = edgeSourceId(e);
          const t = edgeTargetId(e);
          if (!fullSet.has(s) || !fullSet.has(t)) {
            if (!isDefaultVisibleEdge(e)) return "none";
            return isPageGraph && !isHighlightOnlyEdge(e) ? "all" : "none";
          }
          if (!isHighlightOnlyEdge(e)) return isPageGraph || e.relation === "page" || e.relation === "nav" ? "all" : "none";
          if (e.relation === "nav") return "all";
          return (matchedSet.has(s) && t.startsWith("page:"))
            || (matchedSet.has(t) && s.startsWith("page:"))
            ? "all"
            : "none";
        });
      
      paintFocalHalo();
    }

    
    node
      .on("pointerenter", (_, d) => {
        if (hoverInteractionsDisabled) return;
        if (isShiftHighlightLocked()) return;
        pointerHoverNodeId = d.id;
        if (!hoverHighlightEnabled()) return;
        if (usesConceptGraphPathHighlight) {
          applyConceptPathHighlight(d);
          return;
        }
        if (getEffectiveHoverConfig().mode === "none") return;
        const stickyHover = !usesTransientHover || enableHoverFreeze;
        applyHighlight(d, { sticky: stickyHover });
      })
      .on("pointerleave", (event) => {
        if (hoverInteractionsDisabled) return;
        if (isShiftHighlightLocked()) return;
        const relatedNode = event.relatedTarget?.closest?.(".graph-node");
        if (relatedNode && container.contains(relatedNode)) return;
        pointerHoverNodeId = null;
        if (!hoverHighlightEnabled()) {
          if (usesConceptGraphPathHighlight) applyConceptFocalHighlight();
          return;
        }
        if (usesConceptGraphPathHighlight) {
          applyConceptFocalHighlight();
          return;
        }
        if (!usesTransientHover) return;
        if (!activeTransientHoverId && !activeStickyHoverId) return;
        restoreHighlightAfterTransientHover();
      })
      .on("click", (_, d) => {
        if (!graphConfig.ui.enable_node_click) return;
        cancelIncomingHighlight();
        if (d.type === "page" && d.url) {
          closeContainingGraphModal();
          location.href = "/" + d.url;
        } else if (d.type === "keyword") {
          const graphSource = graphSourceForNode(d);
          closeContainingGraphModal();
          document.dispatchEvent(
            new CustomEvent("wikilink:open-pane", {
              detail: {
                keyword: d.label,
                graphSource,
                contextScope: graphConfig.pane.context_scope,
              },
            })
          );
        }
      });

    
    function updateEdgePaths() {
      link.attr("d", (d) => edgePath(d, mode));
      linkHit.attr("d", (d) => {
        const source = nodeById.get(edgeSourceId(d));
        const target = nodeById.get(edgeTargetId(d));
        if (!source || !target) return "";
        return `M${source.x},${source.y} L${target.x},${target.y}`;
      });
      highlightOnlyLink.attr("d", (d) => {
        const source = nodeById.get(edgeSourceId(d));
        const target = nodeById.get(edgeTargetId(d));
        if (!source || !target) return "";
        return `M${source.x},${source.y} L${target.x},${target.y}`;
      });
    }

    function syncGraphState() {
      updateEdgePaths();
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    }

    simulation.on("tick", () => {
      syncGraphState();
    });

    svg.on("click", (event) => {
      if (event.target === svg.node()) dismissIncomingHighlight();
    });

    function onKeyDown(event) {
      if (!document.body.contains(container)) {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        return;
      }
      if (enableHoverFreeze && event.key === freezeKey && !shiftFreezeActive) {
        shiftFreezeActive = true;
        if (pointerHoverNodeId && nodeById.has(pointerHoverNodeId)) {
          const hoveredNode = nodeById.get(pointerHoverNodeId);
          if (usesConceptGraphPathHighlight) {
            applyConceptPathHighlight(hoveredNode);
          } else if (getEffectiveHoverConfig().mode !== "none") {
            applyHighlight(hoveredNode, { sticky: true });
          }
        }
        notifyUiState();
      }
      if (event.key === "Escape" && (incomingHighlightActive || activeStickyHoverId || activeTransientHoverId)) {
        clearActiveGraphHighlight();
      }
    }

    function onKeyUp(event) {
      if (!document.body.contains(container)) {
        document.removeEventListener("keydown", onKeyDown);
        document.removeEventListener("keyup", onKeyUp);
        return;
      }
      if (enableHoverFreeze && event.key === freezeKey && shiftFreezeActive) {
        shiftFreezeActive = false;
        activeStickyHoverId = null;
        activeTransientHoverId = null;
        if (activeSearchQuery) {
          setSearchHighlight(activeSearchQuery);
        } else if (usesConceptGraphPathHighlight) {
          applyConceptFocalHighlight();
        } else {
          clearHighlight();
        }
        notifyUiState();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    
    
    if (highlightKw || highlightPageId) {
      
      
      let focalNode = highlightPageId ? (nodeById.get(highlightPageId) || null) : null;
      if (!focalNode && highlightKw) {
        node.each(function (d) {
          if (d.label.toLowerCase() === highlightKw.toLowerCase() && d.type === "keyword") {
            focalNode = d;
          }
        });
      }
      if (focalNode && isSiteGraph) {
        focalHaloId = focalNode.id;
        paintFocalHalo();
      }
      
      
      
      if (focalNode && freezeHighlightKw) {
        incomingHighlightTimer = setTimeout(() => {
          incomingHighlightTimer = null;
          if (!incomingHighlightActive) return;
          applyHighlight(focalNode);
          
          if (focalNode.x != null && focalNode.y != null) {
            svg.transition().duration(800).call(
              zoomBehavior.transform,
              d3.zoomIdentity.translate(width / 2 - focalNode.x, height / 2 - focalNode.y)
            );
          }
        }, 1500);
      }
    }

    if (isPageGraph) {
      simulation.stop();
      const settleTicks = Math.max(90, Math.min(isPageGraphModal ? 260 : 190, nodes.length * (isPageGraphModal ? 9 : 7)));
      for (let i = 0; i < settleTicks; i++) simulation.tick();
      syncGraphState();
      fitPageGraphView(false);
      applyConfiguredInitialView();
      
      
      
      paintFocalHalo();

      if (isPageGraphModal) {
        requestAnimationFrame(() => {
          if (!document.body.contains(container)) return;
          fitPageGraphView(false);
          applyConfiguredInitialView();
          paintFocalHalo();
        });
      }

      if (!isPageGraphModal && graphConfig.layout.fit_on_resize && typeof ResizeObserver !== "undefined") {
        container.__pageGraphResizeObserver?.disconnect?.();
        let resizeFrame = null;
        const observer = new ResizeObserver(() => {
          if (userAdjustedZoom) return;
          if (resizeFrame) cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            syncViewBoxToContainer();
            fitPageGraphView(false);
          });
        });
        observer.observe(container);
        container.__pageGraphResizeObserver = observer;
      }
    } else if (usesConceptGraphView) {
      simulation.stop();
      const settleTicks = Math.max(110, Math.min(240, nodes.length * 2.4));
      for (let i = 0; i < settleTicks; i++) simulation.tick();
      syncGraphState();
      fitConceptGraphView(false);
      applyConfiguredInitialView();
      
      
      
      
      applyConceptFocalHighlight();
      paintFocalHalo();
      requestAnimationFrame(() => {
        if (!document.body.contains(container)) return;
        fitConceptGraphView(false);
        applyConceptFocalHighlight();
        paintFocalHalo();
      });
      if (isCompactConceptPreview && graphConfig.layout.fit_on_resize && typeof ResizeObserver !== "undefined") {
        container.__conceptGraphPreviewResizeObserver?.disconnect?.();
        let resizeFrame = null;
        const observer = new ResizeObserver(() => {
          if (userAdjustedZoom) return;
          if (resizeFrame) cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            syncViewBoxToContainer();
            fitConceptGraphView(false);
          });
        });
        observer.observe(container);
        container.__conceptGraphPreviewResizeObserver = observer;
      }
    } else if (isPreviewGraph) {
      simulation.stop();
      const settleTicks = Math.max(140, Math.min(260, nodes.length * 2));
      for (let i = 0; i < settleTicks; i++) simulation.tick();
      syncGraphState();
      fitPreviewGraphView(false);
      applyConfiguredInitialView();
    } else {
      syncGraphState();
      applyConfiguredInitialView();
    }

    return {
      getUiState,
      getSiteLabelMode: () => currentSiteLabelMode,
      setUiStateListener,
      setSiteLabelMode,
      setSearchHighlight,
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(0.8),
    };
  }

  
  function dragBehavior(sim, mode, onUpdate) {
    return d3.drag()
      .on("start", (ev, d) => {
        d.fx = d.x;
        d.fy = d.y;
        onUpdate?.();
      })
      .on("drag",  (ev, d) => {
        d.fx = ev.x;
        d.fy = ev.y;
        d.x = ev.x;
        d.y = ev.y;
        onUpdate?.();
      })
      .on("end",   (ev, d) => {
        d.x = d.fx ?? d.x;
        d.y = d.fy ?? d.y;
        d.fx = d.x;
        d.fy = d.y;
        onUpdate?.();
      });
  }

  function disconnectPageGraphObserver(container) {
    container?.__pageGraphResizeObserver?.disconnect?.();
    container?.__pageGraphPreviewOpenCleanup?.();
    if (container) container.__pageGraphResizeObserver = null;
  }

  
  
  
  
  function filterToPage(graph, pageUrl) {
    const pageId = `page:${pageUrl}`;

    
    const pageEdges = graph.edges.filter((e) => {
      const s = typeof e.source === "object" ? e.source.id : e.source;
      const t = typeof e.target === "object" ? e.target.id : e.target;
      
      if (s.startsWith("cat:") || t.startsWith("cat:")) return false;
      
      if (s === pageId || t === pageId) return true;
      
      return Array.isArray(e.pages) && e.pages.includes(pageUrl);
    });

    
    const allowed = new Set([pageId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of pageEdges) {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        if (allowed.has(s) && !allowed.has(t)) { allowed.add(t); changed = true; }
        if (allowed.has(t) && !allowed.has(s)) { allowed.add(s); changed = true; }
      }
    }

    return {
      nodes: graph.nodes.filter((n) => allowed.has(n.id) && !n.id.startsWith("cat:")),
      edges: pageEdges.filter((e) => {
        const s = typeof e.source === "object" ? e.source.id : e.source;
        const t = typeof e.target === "object" ? e.target.id : e.target;
        return allowed.has(s) && allowed.has(t);
      }),
    };
  }

  
  
  function buildSiteGraphCardHeader() {
    const header = document.createElement("div");
    header.className = "graph-widget__header";
    header.innerHTML =
      `<span class="graph-widget__title">` +
        `<span class="graph-widget__title-icon">${graphIconSvg("circle-nodes")}</span>` +
        `<span>Site graph</span>` +
      `</span>`;
    return header;
  }

  
  
  
  
  function buildPageGraphTabs() {
    const tabs = document.createElement("div");
    tabs.className = "graph-tabs";
    tabs.setAttribute("role", "group");
    tabs.setAttribute("aria-label", "Graph views");
    tabs.innerHTML =
      `<button type="button" class="graph-tab graph-tab--active" data-graph-tab="page" aria-current="true">` +
        `<span class="graph-tab__icon">${graphIconSvg("network")}</span>` +
        `<span class="graph-tab__label">Page graph</span>` +
      `</button>` +
      `<button type="button" class="graph-tab" data-graph-tab="site" aria-label="Open site graph">` +
        `<span class="graph-tab__icon">${graphIconSvg("circle-nodes")}</span>` +
        `<span class="graph-tab__label">Site graph</span>` +
      `</button>`;

    tabs.querySelector('[data-graph-tab="page"]').addEventListener("click", (event) => {
      event.preventDefault();
      document.dispatchEvent(
        new CustomEvent("knotis:open-page-graph", {
          detail: { pageUrl: getCurrentPageUrl() },
        })
      );
    });
    tabs.querySelector('[data-graph-tab="site"]').addEventListener("click", async (event) => {
      event.preventDefault();
      try {
        location.href = getSiteGraphHref(await fetchGraph());
      } catch (_err) {
        location.href = getSiteGraphHref(graphCache);
      }
    });
    return tabs;
  }

  function injectSidebarGraphInToc({ containerId, ariaLabel, labelKind }) {
    
    
    const staleContainer = document.getElementById(containerId);
    disconnectPageGraphObserver(staleContainer);
    removeGraphFreezeHint(staleContainer);
    (staleContainer?.closest(".graph-widget") || staleContainer)?.remove();
    document.querySelectorAll(`.page-graph-label[data-graph-label="${labelKind}"]`).forEach((el) => el.remove());

    const tocInner = document.querySelector(
      ".md-sidebar--secondary .md-sidebar__inner"
    );
    if (!tocInner) return null;

    const graphDiv = document.createElement("div");
    graphDiv.id = containerId;
    graphDiv.className = "page-graph-container";
    if (labelKind === "site") graphDiv.classList.add("site-graph-container");
    graphDiv.setAttribute("aria-label", ariaLabel);

    const card = document.createElement("div");
    card.className = `graph-widget graph-widget--${labelKind}`;
    card.appendChild(labelKind === "site" ? buildSiteGraphCardHeader() : buildPageGraphTabs());
    card.appendChild(graphDiv);

    tocInner.insertBefore(card, tocInner.firstChild);
    return graphDiv;
  }

  
  function injectPageGraphInToc() {
    return injectSidebarGraphInToc({
      containerId: "page-graph-container",
      ariaLabel: "Page graph",
      labelKind: "page",
    });
  }

  function injectSiteGraphInToc() {
    return injectSidebarGraphInToc({
      containerId: "site-graph-container",
      ariaLabel: "Site graph overview",
      labelKind: "site",
    });
  }

  

  let graphCache = null;

  async function fetchGraph() {
    if (graphCache) return graphCache;
    
    
    const [, resp] = await Promise.all([
      loadScript(D3_CDN),
      fetchJsonNoStore(GRAPH_JSON_URL),
    ]);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    graphCache = await resp.json();
    return graphCache;
  }

  function siteFilterLabel(state, filters) {
    if (!filters || siteFilterIsAll(state)) return "All";
    const labels = filters.excludeTags
      .filter((tag) => state.includedKeys?.has(tag.key))
      .map((tag) => tag.label);
    return labels.length ? labels.join(" + ") : "All";
  }

  function renderSiteFilterChips(wrapper, filters, state, onChange) {
    if (!wrapper || !filters) return;
    wrapper.querySelector(".graph-search__filters")?.remove();
    const filterBar = document.createElement("div");
    filterBar.className = "graph-search__filters";
    filterBar.setAttribute("aria-label", "Filter site graph by page tag");

    function addChip(label, active, onClick) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `knotis-toggle-button graph-search__filter-chip${active ? " graph-search__filter-chip--active" : ""}`;
      chip.textContent = label;
      chip.setAttribute("aria-pressed", active ? "true" : "false");
      chip.addEventListener("click", onClick);
      filterBar.appendChild(chip);
    }

    addChip("All", siteFilterIsAll(state), () => {
      state.mode = "all";
      state.includedKeys = new Set();
      onChange();
    });

    filters.excludeTags.forEach((tag) => {
      addChip(tag.label, state.includedKeys?.has(tag.key), () => {
        if (!state.includedKeys) state.includedKeys = new Set();
        if (state.includedKeys.has(tag.key)) state.includedKeys.delete(tag.key);
        else state.includedKeys.add(tag.key);
        state.mode = state.includedKeys.size ? "include" : "all";
        onChange();
      });
    });

    wrapper.appendChild(filterBar);
  }

  async function initFullGraph(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.style.height = "92vh";
    container.style.minHeight = "940px";
    container.textContent = "Loading graph…";
    try {
      const graph = await fetchGraph();
      if (!graphEnabled(graph, "full")) {
        document.getElementById("graph-search-wrap")?.remove();
        container.textContent = "";
        container.hidden = true;
        return;
      }
      const prepared = prepareGraphForMode(graph, "full");
      const siteFilters = getSiteGraphFilters(graph);
      const siteFilterState = createSiteFilterState(siteFilters);
      if (!prepared.nodes.length) {
        container.textContent = "No wikilinks found yet. Add a double-bracket wikilink to your pages.";
        return;
      }
      container.textContent = "";

      
      
      let searchWrap = null;
      if (prepared._resolvedConfig.ui.enable_search) {
        searchWrap = document.getElementById("graph-search-wrap");
        if (!searchWrap) {
          searchWrap = document.createElement("div");
          searchWrap.id = "graph-search-wrap";
          searchWrap.className = "graph-search";
          container.parentElement.insertBefore(searchWrap, container);
        }
        const freezeHintHtml = buildGraphFreezeHintHtml(prepared._resolvedConfig.hover);
        const freezeHint = freezeHintHtml
          ? `<div class="graph-freeze-meta graph-search__freeze-meta">
              <div class="graph-freeze-meta__hint">${freezeHintHtml}</div>
              <span id="graph-pinned-chip" class="graph-freeze-meta__chip" hidden></span>
            </div>`
          : "";
        searchWrap.innerHTML = `<div class="graph-search__row">
          <input type="search" id="graph-search-input"
            class="graph-search__input"
            placeholder="Search concepts…"
            aria-label="Search concept graph">
        </div>
        ${freezeHint}`;
      } else {
        document.getElementById("graph-search-wrap")?.remove();
      }

      const deepLinkParams = new URLSearchParams(location.search);
      const highlightKw = deepLinkParams.get("kw") || null;
      
      
      const highlightPageUrl = (deepLinkParams.get("page") || "").trim();
      const highlightPageId = highlightPageUrl
        ? [
            `page:${highlightPageUrl}`,
            `page:${highlightPageUrl.replace(/\/+$/, "")}`,
            `page:${highlightPageUrl.replace(/\/*$/, "/")}`,
          ].find((id) => prepared.nodes.some((n) => n.id === id)) || null
        : null;
      
      
      
      let initialHighlightApplied = false;
      const renderCurrentSiteGraph = () => {
        const searchValue = document.getElementById("graph-search-input")?.value.trim() || "";
        const filtered = filterPreparedSiteGraph(prepared, siteFilterState, siteFilters);
        filtered._sourceGraph = graph;
        if (!filtered.nodes.length) {
          container.textContent = `No nodes match ${siteFilterLabel(siteFilterState, siteFilters)}.`;
          container.querySelector(".graph-controls")?.remove();
          return;
        }
        container.textContent = "";
        const freezeHighlight = Boolean(highlightKw || highlightPageId) && !initialHighlightApplied;
        initialHighlightApplied = true;
        const graphApi = renderGraph(container, cloneGraph(filtered), "full", highlightKw, {
          freezeHighlightKw: freezeHighlight,
          highlightPageId,
        });
        const { setSearchHighlight } = graphApi;
        if (filtered._resolvedConfig.ui.show_zoom_controls) {
          attachGraphControls(container, {
            onZoomIn: graphApi.zoomIn,
            onZoomOut: graphApi.zoomOut,
          });
        } else {
          container.querySelector(".graph-controls")?.remove();
        }

        const pinnedChip = document.getElementById("graph-pinned-chip");
        graphApi.setUiStateListener((state) => {
          if (!pinnedChip) return;
          const shouldShow = Boolean(state.shiftFreezeActive && state.activeLabel);
          pinnedChip.hidden = !shouldShow;
          pinnedChip.textContent = shouldShow
            ? `Pinned: ${state.activeLabel}`
            : "";
        });

        const searchInput = document.getElementById("graph-search-input");
        if (searchInput && filtered._resolvedConfig.ui.enable_search) {
          const fresh = searchInput.cloneNode(true);
          fresh.value = searchValue;
          searchInput.replaceWith(fresh);
          const syncSearchHighlight = (e) => setSearchHighlight(e.target.value.trim());
          fresh.addEventListener("input", syncSearchHighlight);
          fresh.addEventListener("search", syncSearchHighlight);
          fresh.addEventListener("change", syncSearchHighlight);
          if (searchValue) setSearchHighlight(searchValue);
        }

        renderSiteFilterChips(searchWrap, siteFilters, siteFilterState, renderCurrentSiteGraph);
      };

      renderCurrentSiteGraph();

    } catch (err) {
      console.error("[graph] Full graph error:", err);
      container.textContent = "Could not load graph.";
    }
  }

  
  function cloneGraph({
    nodes,
    edges,
    meta,
    _resolvedConfig,
    _currentPageUrl,
    _pageFocalNodeId,
    _pageFilterApplied,
    _highlightContextEdges,
    _conceptKeyword,
    _conceptTargetId,
    _teachingPathMode,
    _defaultVisibleNodeIds,
    _defaultVisibleEdgeKeys,
    _conceptStoryPrefixNodeIds,
    _conceptTeachingPathByPage,
    _focusPageUrl,
    _sourceGraph,
  }) {
    return {
      nodes: nodes.map((n) => ({ ...n })),
      edges: edges.map((e) => ({ ...e })),
      meta: meta || {},
      _resolvedConfig: _resolvedConfig || null,
      _currentPageUrl: _currentPageUrl || null,
      _pageFocalNodeId: _pageFocalNodeId || null,
      _focusPageUrl: _focusPageUrl || null,
      _sourceGraph: _sourceGraph || null,
      _pageFilterApplied: _pageFilterApplied || false,
      _highlightContextEdges: (_highlightContextEdges || []).map((e) => ({ ...e })),
      _conceptKeyword: _conceptKeyword || null,
      _conceptTargetId: _conceptTargetId || null,
      _teachingPathMode: _teachingPathMode === true,
      _defaultVisibleNodeIds: Array.isArray(_defaultVisibleNodeIds) ? [..._defaultVisibleNodeIds] : null,
      _defaultVisibleEdgeKeys: Array.isArray(_defaultVisibleEdgeKeys) ? [..._defaultVisibleEdgeKeys] : null,
      _conceptStoryPrefixNodeIds: Array.isArray(_conceptStoryPrefixNodeIds) ? [..._conceptStoryPrefixNodeIds] : null,
      _conceptTeachingPathByPage: _conceptTeachingPathByPage ? { ..._conceptTeachingPathByPage } : null,
    };
  }

  function getPageGraphTitle(graphData) {
    const pageNode = (graphData?.nodes || []).find((node) => node.type === "page" && (
      !graphData?._currentPageUrl || node.url === graphData._currentPageUrl
    )) || (graphData?.nodes || []).find((node) => node.type === "page");
    return pageNode?.label ? `${pageNode.label} page graph` : "Page graph";
  }

  function getGraphModalTitle(graphData, mode, fallbackTitle = "") {
    if (fallbackTitle) return fallbackTitle;
    if (mode === "page") return getPageGraphTitle(graphData);
    if (mode === "concept") {
      const keyword = graphData?._conceptKeyword || "Concept";
      return `${keyword} concept graph`;
    }
    return "Site graph";
  }

  function getGraphModalAriaLabel(mode) {
    if (mode === "page") return "Expanded page graph";
    if (mode === "concept") return "Expanded concept graph";
    return "Expanded site graph";
  }

  function openGraphModal(graphData, mode = "page", options = {}) {
    if (document.getElementById("graph-modal")) return;

    const resolvedTitle = getGraphModalTitle(graphData, mode, options.title || "");
    const showFreezeHint = graphData._resolvedConfig?.hover?.freeze_enabled !== false;
    const showModalControls = graphData._resolvedConfig?.ui?.show_zoom_controls !== false;

    const overlay = document.createElement("div");
    overlay.id        = "graph-modal";
    overlay.className = "graph-modal";
    overlay.setAttribute("role",       "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", getGraphModalAriaLabel(mode));

    const panel = document.createElement("div");
    panel.className = "graph-modal__panel";

    const closeBtn = document.createElement("button");
    closeBtn.className  = "graph-modal__close";
    closeBtn.innerHTML  = "&times;";
    closeBtn.setAttribute("aria-label", "Close expanded graph");

    const graphDiv = document.createElement("div");
    graphDiv.className = "graph-modal__graph";

    let statusChip = null;
    let conceptSiteGraphAction = null;
    if (resolvedTitle || options.actionHref || showFreezeHint) {
      const header = document.createElement("div");
      header.className = "graph-modal__header";
      const heading = document.createElement("div");
      heading.className = "graph-modal__heading";

      if (resolvedTitle) {
        const title = document.createElement("div");
        title.className = "graph-modal__title";
        title.textContent = resolvedTitle;
        heading.appendChild(title);
      }

      if (showFreezeHint) {
        const meta = document.createElement("div");
        meta.className = "graph-freeze-meta graph-modal__meta";

        const hint = document.createElement("span");
        hint.className = "graph-freeze-meta__hint graph-modal__hint";
        hint.innerHTML = buildGraphFreezeHintHtml(graphData._resolvedConfig?.hover);
        meta.appendChild(hint);

        statusChip = document.createElement("span");
        statusChip.className = "graph-freeze-meta__chip graph-modal__status";
        statusChip.hidden = true;
        meta.appendChild(statusChip);

        heading.appendChild(meta);
      }

      header.appendChild(heading);
      if (options.actionHref) {
        conceptSiteGraphAction = document.createElement("a");
        conceptSiteGraphAction.className = "graph-modal__action";
        const actionLeadingIcon = `<span class="graph-modal__action-icon" aria-hidden="true">${graphIconSvg("circle-nodes")}</span>`;
        const actionTrailingIcon = `<span class="graph-modal__action-external" aria-hidden="true">${graphIconSvg("external-arrow")}</span>`;
        if (mode === "concept" && graphData._conceptKeyword) {
          conceptSiteGraphAction.innerHTML = `${actionLeadingIcon}<span class="graph-modal__action-label">${options.actionLabel || "See it in site graph"}</span>${actionTrailingIcon}`;
          conceptSiteGraphAction.href = buildConceptSiteGraphHref(graphData._conceptKeyword, graphData._sourceGraph);
        } else {
          conceptSiteGraphAction.href = options.actionHref;
          conceptSiteGraphAction.innerHTML = `${actionLeadingIcon}<span class="graph-modal__action-label">${options.actionLabel || "Open full site graph"}</span>${actionTrailingIcon}`;
        }
        header.appendChild(conceptSiteGraphAction);
      }
      panel.appendChild(header);
    }
    panel.appendChild(closeBtn);
    panel.appendChild(graphDiv);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const modalApi = renderGraph(graphDiv, cloneGraph(graphData), mode, options.highlightKw || null);

    if (showModalControls) {
      attachGraphControls(graphDiv, {
        onZoomIn: modalApi.zoomIn,
        onZoomOut: modalApi.zoomOut,
      });
    }
    modalApi.setUiStateListener((state) => {
      if (statusChip) {
        const shouldShow = Boolean(state.shiftFreezeActive && state.activeLabel);
        statusChip.hidden = !shouldShow;
        statusChip.textContent = shouldShow
          ? `Pinned: ${state.activeLabel}`
          : "";
      }
    });

    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("knotis:close-graph-modal", close);
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    function isSameTabActionClick(event, link) {
      if (event.defaultPrevented || event.button !== 0) return false;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
      const target = link?.getAttribute("target") || "";
      return !target || target === "_self";
    }

    closeBtn.addEventListener("click", close);
    if (conceptSiteGraphAction) {
      conceptSiteGraphAction.addEventListener("click", (event) => {
        if (!isSameTabActionClick(event, conceptSiteGraphAction)) return;
        close();
        
        
        
        if (mode === "concept" || mode === "page") {
          document.dispatchEvent(new CustomEvent("knotis:close-pane"));
        }
        
        
        
        
        const targetUrl = new URL(conceptSiteGraphAction.href, location.href);
        const normalizePath = (p) => p.replace(/\/index\.html$/, "/");
        if (
          normalizePath(targetUrl.pathname) === normalizePath(location.pathname)
          && document.getElementById("graph-container")
        ) {
          event.preventDefault();
          history.pushState(history.state, "", targetUrl.href);
          
          
          
          const staleContainer = document.getElementById("graph-container");
          const freshContainer = staleContainer.cloneNode(false);
          staleContainer.replaceWith(freshContainer);
          initFullGraph("graph-container");
        }
      });
    }
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", onKey);
    document.addEventListener("knotis:close-graph-modal", close);
    closeBtn.focus();
  }

  
  
  function enablePageGraphPreviewOpen(container, graphData, mode = "page", modalOptions = {}) {
    if (!container || container.classList.contains("graph-modal__graph")) return;
    if (container.__pageGraphPreviewOpenCleanup) container.__pageGraphPreviewOpenCleanup();

    let pointerStart = null;
    let suppressNextClick = false;

    
    
    const managedAttrs = [];
    container.classList.add("page-graph-container--clickable");
    if (!container.hasAttribute("role")) { container.setAttribute("role", "button"); managedAttrs.push("role"); }
    if (!container.hasAttribute("tabindex")) { container.setAttribute("tabindex", "0"); managedAttrs.push("tabindex"); }
    if (!container.hasAttribute("aria-label")) {
      container.setAttribute("aria-label", mode === "concept" ? "Expand concept graph" : "Expand page graph");
      managedAttrs.push("aria-label");
    }

    function isControlTarget(target) {
      return Boolean(target.closest?.(".page-graph-zoom, .graph-controls"));
    }

    function onPointerDown(event) {
      if (isControlTarget(event.target)) {
        pointerStart = null;
        return;
      }
      pointerStart = { x: event.clientX, y: event.clientY };
    }

    function onPointerUp(event) {
      if (!pointerStart || isControlTarget(event.target)) return;
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      pointerStart = null;
      if (dx * dx + dy * dy >= 25) return;
      suppressNextClick = true;
      event.preventDefault();
      event.stopPropagation();
      openGraphModal(graphData, mode, modalOptions);
    }

    function onClick(event) {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function onKeyDown(event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (isControlTarget(event.target)) return;
      event.preventDefault();
      openGraphModal(graphData, mode, modalOptions);
    }

    container.addEventListener("pointerdown", onPointerDown, true);
    container.addEventListener("pointerup", onPointerUp, true);
    container.addEventListener("click", onClick, true);
    container.addEventListener("keydown", onKeyDown);
    container.__pageGraphPreviewOpenCleanup = () => {
      container.classList.remove("page-graph-container--clickable");
      managedAttrs.forEach((attr) => container.removeAttribute(attr));
      container.removeEventListener("pointerdown", onPointerDown, true);
      container.removeEventListener("pointerup", onPointerUp, true);
      container.removeEventListener("click", onClick, true);
      container.removeEventListener("keydown", onKeyDown);
      container.__pageGraphPreviewOpenCleanup = null;
    };
  }

  
  
  function enableSiteGraphPreviewOpen(container, clickTarget = container) {
    if (!container || container.classList.contains("graph-modal__graph")) return;
    const target = clickTarget || container;
    if (target.__siteGraphPreviewOpenCleanup) target.__siteGraphPreviewOpenCleanup();

    const href = getSiteGraphHref(graphCache);
    let pointerStart = null;
    let suppressNextClick = false;

    function isControlTarget(node) {
      return Boolean(node.closest?.(".page-graph-zoom, .graph-controls"));
    }

    function openSiteGraph() {
      location.href = href;
    }

    function onPointerDown(event) {
      if (isControlTarget(event.target)) {
        pointerStart = null;
        return;
      }
      pointerStart = { x: event.clientX, y: event.clientY };
    }

    function onPointerUp(event) {
      if (!pointerStart || isControlTarget(event.target)) return;
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      pointerStart = null;
      if (dx * dx + dy * dy >= 25) return;
      suppressNextClick = true;
      event.preventDefault();
      event.stopPropagation();
      openSiteGraph();
    }

    function onClick(event) {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    function onKeyDown(event) {
      if (isControlTarget(event.target)) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openSiteGraph();
    }

    target.classList.add("graph-widget--clickable");
    target.setAttribute("tabindex", "0");
    target.setAttribute("role", "link");
    target.setAttribute("aria-label", "Open full site graph");
    target.addEventListener("pointerdown", onPointerDown, true);
    target.addEventListener("pointerup", onPointerUp, true);
    target.addEventListener("click", onClick, true);
    target.addEventListener("keydown", onKeyDown);
    target.__siteGraphPreviewOpenCleanup = () => {
      target.classList.remove("graph-widget--clickable");
      target.removeAttribute("tabindex");
      target.removeAttribute("role");
      target.removeAttribute("aria-label");
      target.removeEventListener("pointerdown", onPointerDown, true);
      target.removeEventListener("pointerup", onPointerUp, true);
      target.removeEventListener("click", onClick, true);
      target.removeEventListener("keydown", onKeyDown);
      target.__siteGraphPreviewOpenCleanup = null;
    };
  }

  async function initSiteGraphOverview() {
    try {
      const graph = await fetchGraph();
      const container = document.getElementById("site-graph-container");
      if (!container) return;
      if (!graphEnabled(graph, "full")) {
        disconnectPageGraphObserver(container);
        (container.closest(".graph-widget") || container).remove();
        document.getElementById("page-graph-site-link")?.remove();
        document.querySelectorAll('.page-graph-label[data-graph-label="site"]').forEach((el) => el.remove());
        return;
      }
      const prepared = prepareGraphForMode(graph, "full");

      if (!prepared.nodes.length) {
        container.textContent = "No wikilinks found yet.";
        return;
      }

      renderGraph(container, cloneGraph(prepared), "full", null, { preview: true, disableHover: true });
      
      enableSiteGraphPreviewOpen(container, container.closest(".graph-widget") || container);
    } catch (err) {
      console.error("[graph] Site graph overview error:", err);
    }
  }

  function waitForContainerLayout(container, maxFrames = 30) {
    return new Promise((resolve) => {
      let frames = 0;
      const check = () => {
        if (!document.body.contains(container) || container.clientWidth > 0 || frames >= maxFrames) {
          resolve();
          return;
        }
        frames += 1;
        requestAnimationFrame(check);
      };
      check();
    });
  }

  async function initPageGraph() {
    try {
      const graph    = await fetchGraph();
      if (!graphEnabled(graph, "full")) {
        document.getElementById("page-graph-site-link")?.remove();
        document.querySelectorAll('.page-graph-label[data-graph-label="site"]').forEach((el) => el.remove());
      }
      if (!graphEnabled(graph, "page")) {
        const staleContainer = document.getElementById("page-graph-container");
        disconnectPageGraphObserver(staleContainer);
        removeGraphFreezeHint(staleContainer);
        (staleContainer?.closest(".graph-widget") || staleContainer)?.remove();
        document.querySelectorAll('.page-graph-label[data-graph-label="page"]').forEach((el) => el.remove());
        return;
      }
      const filtered = prepareGraphForMode(graph, "page");
      const expandedGraph = prepareExpandedPageGraph(graph);

      
      
      if (filtered.nodes.length <= 1) {
        const staleContainer = document.getElementById("page-graph-container");
        disconnectPageGraphObserver(staleContainer);
        removeGraphFreezeHint(staleContainer);
        (staleContainer?.closest(".graph-widget") || staleContainer)?.remove();
        document.querySelectorAll('.page-graph-label[data-graph-label="page"]').forEach((el) => el.remove());
        document.getElementById("page-graph-site-link")?.remove();
        if (graphEnabled(graph, "full")) {
          injectSiteGraphInToc();
          await initSiteGraphOverview();
        }
        return;
      }

      const container = document.getElementById("page-graph-container");
      if (!container) return;
      
      
      
      await waitForContainerLayout(container);
      if (!document.body.contains(container)) return;

      const graphApi = renderGraph(container, cloneGraph(filtered), "page", null, { disableHover: true });
      if (filtered._resolvedConfig.ui.show_zoom_controls) {
        attachGraphControls(container, {
          onZoomIn: graphApi.zoomIn,
          onZoomOut: graphApi.zoomOut,
        });
      } else {
        container.querySelector(".graph-controls")?.remove();
      }
      
      container.querySelector(".page-graph-zoom")?.remove();
      const siteGraphAvailable = graphEnabled(graph, "full");
      const modalPageUrl = expandedGraph?._currentPageUrl || "";
      enablePageGraphPreviewOpen(container, expandedGraph, "page", {
        actionHref: siteGraphAvailable && modalPageUrl
          ? buildPageSiteGraphHref(modalPageUrl, graph)
          : null,
        actionLabel: siteGraphAvailable ? "See it in site graph" : "",
      });

    } catch (err) {
      console.error("[graph] Page graph error:", err);
    }
  }

  async function openConceptGraph(keyword, options = {}) {
    const cleanKeyword = String(keyword || "").trim();
    if (!cleanKeyword) return;
    try {
      const graph = await fetchGraph();
      if (!graphEnabled(graph, "concept")) return;
      const prepared = prepareConceptGraph(graph, cleanKeyword, {
        currentPageUrl: getCurrentPageUrl(),
        focusPageUrl: options.focusPageUrl || getCurrentPageUrl(graph),
      });
      const siteGraphAvailable = graphEnabled(graph, "full");
      if (prepared) {
        prepared._sourceGraph = graph;
      }
      const fullGraphHref = buildConceptSiteGraphHref(prepared._conceptKeyword || cleanKeyword, graph);
      if (!prepared || !prepared.nodes.length) {
        if (siteGraphAvailable) location.href = fullGraphHref;
        return;
      }
      openGraphModal(prepared, "concept", {
        title: `${prepared._conceptKeyword || cleanKeyword} concept graph`,
        actionHref: siteGraphAvailable ? fullGraphHref : null,
        actionLabel: siteGraphAvailable ? "See it in site graph" : "",
      });
    } catch (err) {
      console.error("[graph] Concept graph error:", err);
      location.href = `${getSiteGraphHref(graphCache)}?kw=${encodeURIComponent(cleanKeyword)}`;
    }
  }

  async function openPageGraph(pageUrl = "") {
    try {
      const graph = await fetchGraph();
      if (!graphEnabled(graph, "page")) return;
      const requestedPageUrl = String(pageUrl || "").trim();
      const prepared = prepareExpandedPageGraph(graph, requestedPageUrl);
      if (!prepared?.nodes?.length) return;
      const siteGraphAvailable = graphEnabled(graph, "full");
      const hrefPageUrl = prepared._currentPageUrl || requestedPageUrl;
      openGraphModal(prepared, "page", {
        actionHref: siteGraphAvailable && hrefPageUrl
          ? buildPageSiteGraphHref(hrefPageUrl, graph)
          : null,
        actionLabel: siteGraphAvailable ? "See it in site graph" : "",
      });
    } catch (err) {
      console.error("[graph] Page graph modal error:", err);
    }
  }

  async function openConceptMap(keyword) {
    return openConceptGraph(keyword);
  }

  async function renderConceptGraphPreview(containerOrId, keyword, options = {}) {
    const container = typeof containerOrId === "string"
      ? document.getElementById(containerOrId)
      : containerOrId;
    const cleanKeyword = String(keyword || "").trim();
    if (!container || !cleanKeyword) return null;

    container.innerHTML = "";
    container.textContent = "Loading concept graph…";

    const graph = await fetchGraph();
    const siteGraphAvailable = graphEnabled(graph, "full");
    if (!graphEnabled(graph, "concept")) {
      container.removeAttribute("role");
      container.removeAttribute("tabindex");
      container.textContent = "";
      return null;
    }
    const prepared = prepareConceptGraph(graph, cleanKeyword, {
      currentPageUrl: getCurrentPageUrl(),
      focusPageUrl: options.focusPageUrl || "",
    });
    if (!prepared || !prepared.nodes.length) {
      container.textContent = "No concept graph yet.";
      return null;
    }

    prepared._sourceGraph = graph;

    container.textContent = "";
    container.classList.add("concept-graph-preview__graph", "page-graph-container--clickable");
    container.setAttribute("role", "button");
    container.setAttribute("tabindex", "0");
    container.setAttribute("aria-label", `${prepared._conceptKeyword || cleanKeyword} concept graph preview`);

    renderGraph(container, cloneGraph(prepared), "concept", null, { preview: true, disableHover: true });
    const modalOptions = {
      title: `${prepared._conceptKeyword || cleanKeyword} concept graph`,
      actionHref: siteGraphAvailable
        ? buildConceptSiteGraphHref(prepared._conceptKeyword || cleanKeyword, graph)
        : null,
      actionLabel: siteGraphAvailable ? "See it in site graph" : "",
    };
    
    container.querySelector(".page-graph-zoom")?.remove();
    enablePageGraphPreviewOpen(container, prepared, "concept", modalOptions);
    return { prepared };
  }

  

  function init() {
    
    if (document.getElementById("graph-container")) {
      initFullGraph("graph-container");
      return; 
    }

    if (isHomePage()) {
      injectSiteGraphInToc();
      initSiteGraphOverview();
      return;
    }

    
    
    
    injectPageGraphInToc();
    initPageGraph();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function handleConceptGraphEvent(event) {
    openConceptGraph(event.detail?.keyword);
  }

  function handlePageGraphEvent(event) {
    openPageGraph(event.detail?.pageUrl);
  }

  document.addEventListener("knotis:open-concept-graph", handleConceptGraphEvent);
  document.addEventListener("knotis:open-concept-map", handleConceptGraphEvent);
  document.addEventListener("knotis:open-page-graph", handlePageGraphEvent);

  
  function onPageSwap() {
    
    const staleContainer = document.getElementById("page-graph-container");
    disconnectPageGraphObserver(staleContainer);
    (staleContainer?.closest(".graph-widget") || staleContainer)?.remove();
    const staleSiteContainer = document.getElementById("site-graph-container");
    disconnectPageGraphObserver(staleSiteContainer);
    (staleSiteContainer?.closest(".graph-widget") || staleSiteContainer)?.remove();
    document.querySelectorAll('.page-graph-label[data-graph-label="page"], .page-graph-label[data-graph-label="site"]').forEach((el) => el.remove());
    document.getElementById("page-graph-site-link")?.remove();
    init();
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    let first = true;
    window.document$.subscribe(() => {
      if (first) { first = false; return; }
      onPageSwap();
    });
  } else {
    const contentRoot = document.querySelector(".md-content, main") || document.body;
    let debounce;
    new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(onPageSwap, 50);
    }).observe(contentRoot, { childList: true, subtree: false });
  }

  window.Knotis = { initFullGraph, initPageGraph, openConceptGraph, openPageGraph, renderConceptGraphPreview };
})();
