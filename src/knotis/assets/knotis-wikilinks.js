(function () {
  "use strict";

  if (!window.KnotisCore) {
    console.error("[knotis] knotis-core.js must load before knotis-wikilinks.js");
    return;
  }
  const { isPlainObject, deepClone, deepMerge, fetchJsonNoStore, escapeHtml } = window.KnotisCore;

  const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
  const CONTENT_TAG_RE = /(?<![\w/&(\[])#([A-Za-z][A-Za-z0-9_-]{0,48})\b/g;
  const INLINE_TOKEN_RE = /\[\[([^\]]+)\]\]|(?<![\w/&(\[])#([A-Za-z][A-Za-z0-9_-]{0,48})\b/g;
  
  const MARK_SYNTAX_RE = /==([^=\n]+(?:=[^=\n]+)*)==/g;
  const _SCRIPT_BASE = document.currentScript?.src || location.href;
  function siteBaseFromScript(src) {
    try {
      const url = new URL(src || location.href, location.href);
      url.pathname = url.pathname
        .replace(/\/assets\/knotis\/[^/]*$/, "/")
        .replace(/\/assets\/[^/]*$/, "/");
      url.search = "";
      url.hash = "";
      return url.href;
    } catch {
      return new URL("/", location.origin).href;
    }
  }
  const SITE_BASE = siteBaseFromScript(_SCRIPT_BASE);
  const JSON_URL      = new URL("wikilinks.json",  _SCRIPT_BASE).href;
  const CONTENT_TAGS_URL  = new URL("content-tags.json", _SCRIPT_BASE).href;
  const REFERENCES_URL = new URL("references.json", _SCRIPT_BASE).href;
  const NAV_ORDER_URL = new URL("nav_order.json",   _SCRIPT_BASE).href;
  const GRAPH_JSON_URL = new URL("graph.json",      _SCRIPT_BASE).href;

  let wikilinkData = null; 
  let contentTagData = null; 
  let referenceData = null; 
  let navOrderData = null; 
  let graphDataCache = null; 
  let graphMetaData = null; 
  void getGraphData();
  void getContentTagData();
  const keywordCounters = new Map(); 
  const contentTagCounters = new Map(); 
  const PENDING_CONTEXT_NAV_KEY = "wikilink-pending-context-nav";
  const PENDING_PANE_RESTORE_KEY = "wikilink-pending-pane-restore";
  const PANE_HISTORY_KEY = "wikilink-pane-history";
  const SEARCH_HIGHLIGHT_PARAM = "knotis-highlight";
  const SEARCH_TARGET_TEXT_PARAM = "knotis-target-text";
  const PANE_URL_PARAM = "knotis-pane";
  const FALLBACK_CONTENT_TAG_ORDER = [];
  
  
  const WEBKIT_CONTENT_ENGINE = (() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    if (/Chrom(?:e|ium)|Edg|OPR|CriOS|FxiOS/.test(ua)) return false;
    return /\bAppleWebKit\b/.test(ua);
  })();
  if (WEBKIT_CONTENT_ENGINE) document.documentElement.setAttribute("data-knotis-webkit-engine", "true");
  const HASH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-hash" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3 8 21"/><path d="m16 3-2 18"/></svg>';
  const SHARE2_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512" fill="currentColor" aria-hidden="true" focusable="false"><path d="M352 224c53 0 96-43 96-96s-43-96-96-96s-96 43-96 96c0 4 .2 8 .7 11.9l-94.1 47C145.4 170.2 121.9 160 96 160c-53 0-96 43-96 96s43 96 96 96c25.9 0 49.4-10.2 66.6-26.9l94.1 47c-.5 3.9-.7 7.8-.7 11.9c0 53 43 96 96 96s96-43 96-96s-43-96-96-96c-25.9 0-49.4 10.2-66.6 26.9l-94.1-47c.5-3.9 .7-7.8 .7-11.9s-.2-8-.7-11.9l94.1-47C302.6 213.8 326.1 224 352 224z"/></svg>';
  const LINK_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-link" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  const SITE_GRAPH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="currentColor" aria-hidden="true" focusable="false"><path d="M418.4 157.9c35.3-8.3 61.6-40 61.6-77.9c0-44.2-35.8-80-80-80c-43.4 0-78.7 34.5-80 77.5L136.2 151.1C121.7 136.8 101.9 128 80 128c-44.2 0-80 35.8-80 80s35.8 80 80 80c12.2 0 23.8-2.7 34.1-7.6L259.7 407.8c-2.4 7.6-3.7 15.8-3.7 24.2c0 44.2 35.8 80 80 80s80-35.8 80-80c0-27.7-14-52.1-35.4-66.4l37.8-207.7zM156.3 232.2c2.2-6.9 3.5-14.2 3.7-21.7l183.8-73.5c3.6 3.5 7.4 6.7 11.6 9.5L317.6 354.1c-5.5 1.3-10.8 3.1-15.8 5.5L156.3 232.2z"/></svg>';
  const ROUTE_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-route" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>';
  const PAGE_GRAPH_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="2" width="6" height="6" rx="1"></rect><rect x="2" y="16" width="6" height="6" rx="1"></rect><rect x="16" y="16" width="6" height="6" rx="1"></rect><path d="M12 8v4"></path><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"></path></svg>';
  const UNDO2_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 14 4 9l5-5"></path><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5A5.5 5.5 0 0 1 14.5 20H11"></path></svg>';
  const FALLBACK_PANE_CONFIG = {
    context_scope: "current_page_first",
    order: [],
    width: 560,
    initial_lines: 6,
    initial_list_items: 6,
    chunk_lines: 3,
    intro_expand_to_heading: false,
    content_tag_full_section: true,
    reference_full_section: true,
    show_history_controls: true,
    show_meta_badges: true,
    show_context_controls: true,
    show_concept_graph_preview: true,
    show_graph_return_button: true,
    skip_duplicate_headings: true,
    keyword_context_mode: "parent_list",
    keyword_own_section: true,
    edge_context_mode: "compact",
    edge_gap_mode: "hide",
    edge_inline_gap_max_lines: 2,
  };
  const FALLBACK_CONTENT_CONFIG = {
    heading_numbering: true,
    heading_guides: true,
    nested_numbering_lists: true,
    styled_section_groups: true,
  };
  const FALLBACK_CONTENT_TAGS_CONFIG = {
    enabled: false,
    nav_chips: false,
    page_url: "content-tags/",
  };
  const FALLBACK_WIKILINKS_CONFIG = {
    default: "#0197a7",
    slate: "#fda4af",
  };
  const CONTENT_TAGS_NAV_LABEL = "Content tags";
  const FALLBACK_PATH_CONFIG = {
    enabled: true,
    include_paths: [],
    exclude_paths: [],
  };
  const COLOR_VAR_MAP = {
    wikilink_text: "--knotis-wikilink-text",
    wikilink_hover_background: "--knotis-wikilink-hover-background",
    wikilink_flash_background: "--knotis-wikilink-flash-background",
    wikilink_flash_outline: "--knotis-wikilink-flash-outline",
    content_tag_text: "--knotis-content-tag-text",
    content_tag_background: "--knotis-content-tag-background",
    content_tag_hover_background: "--knotis-content-tag-hover-background",
    content_tag_mark_background: "--knotis-content-tag-mark-background",
    content_tag_mark_text: "--knotis-content-tag-mark-text",
    block_highlight_background: "--knotis-block-highlight-background",
    block_highlight_mid_background: "--knotis-block-highlight-mid-background",
    block_highlight_outline: "--knotis-block-highlight-outline",
  };
  const INLINE_EDGE_GAP_MAX_LINES = 5;

  function isOfflinePreview() {
    return window.__KNOTIS_OFFLINE_PREVIEW === true
      || document.body?.getAttribute("data-knotis-offline-preview") === "true";
  }

  
  const cardStore = new Map();

  
  
  
  const CARD_RECORD_KEYS = [
    "lines", "keyword", "pageUrl", "kwOffset",
    "displayStart", "displayEnd", "nextStart",
    "ownSectionStart", "ownSectionEnd",
    "beforeRanges", "chunkRanges", "chunkLines",
    "sectionParts", "renderOpts", "skipDuplicateHeadings",
  ];

  function makeCardRecord(record) {
    for (const key of CARD_RECORD_KEYS) {
      if (!(key in record)) {
        console.warn(`[DEBUG] card record is missing "${key}"`, record);
      }
    }
    return record;
  }
  let mermaidConfigured = false;
  const mermaidRenderCache = new Map();
  let paneHistoryState = { entries: [], index: -1 };
  let paneHistoryLoaded = false;
  let paneTrigger = null;
  let paneHeaderObserver = null;
  let paneHeaderObserverScheduled = false;
  const PANE_TRIGGER_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide lucide-panel-right-open" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/><path d="m10 15-3-3 3-3"/></svg>';

  function kwToId(keyword) {
    return "wikilink-" + keyword.replace(/\s+/g, "-");
  }

  function contentTagToId(contentTag) {
    const normalized = normalizeContentTag(contentTag).slice(1).replace(/[^a-z0-9_-]+/g, "-");
    return "content-tag-" + normalized;
  }

  function normalizeContentTag(contentTag) {
    return "#" + String(contentTag || "").replace(/^#/, "").toLowerCase();
  }

  function normalizeContentTagOrder(order) {
    const items = Array.isArray(order) ? order : FALLBACK_CONTENT_TAG_ORDER;
    const normalized = [];
    const seen = new Set();
    items.forEach((item) => {
      const tag = normalizeContentTag(item).trim();
      if (tag !== "#" && !seen.has(tag)) {
        normalized.push(tag);
        seen.add(tag);
      }
    });
    return normalized;
  }

  function isCssHexColorToken(contentTag) {
    const token = String(contentTag || "").replace(/^#/, "");
    return /^(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(token);
  }


  function parseWikilinkParts(raw) {
    const [targetPart, ...labelParts] = raw.split("|");
    const target = (targetPart || "").trim();
    const rawLabel = (labelParts.length ? labelParts.join("|") : target).trim() || target;
    const mode = labelParts.length && ["ref", "reference"].includes(rawLabel.toLowerCase()) ? "reference" : "concept";
    const label = mode === "reference" ? target : rawLabel;
    return {
      keyword: target.toLowerCase(),
      label,
      mode,
    };
  }

  function isValidWikilinkRaw(raw) {
    return Boolean((String(raw).split("|")[0] || "").trim());
  }

  function stripMarkdownDestinationWrapper(value) {
    const text = String(value || "").trim();
    if (text.startsWith("<") && text.endsWith(">")) return text.slice(1, -1).trim();
    if (text.startsWith("&lt;") && text.endsWith("&gt;")) return text.slice(4, -4).trim();
    return text;
  }

  
  function resolveRelativeSrc(src, pageUrl) {
    try {
      src = stripMarkdownDestinationWrapper(src);
      const base = pageUrl.startsWith("/") ? pageUrl : "/" + pageUrl;
      
      
      
      const dir = base.replace(/[^/]+\/$/, "");
      return new URL(src, location.origin + dir).href;
    } catch {
      return src;
    }
  }

  function resolveRelativeHref(href, pageUrl) {
    try {
      href = stripMarkdownDestinationWrapper(href);
      if (!href) return href;
      if (/^(?:[a-z]+:|#|\/)/i.test(href)) return href;

      const base = pageUrl.startsWith("/") ? pageUrl : "/" + pageUrl;
      const dir = base.replace(/[^/]+\/$/, "");
      const resolved = new URL(href, location.origin + dir);
      let pathname = resolved.pathname;

      if (pathname.endsWith("/index.md")) pathname = pathname.replace(/\/index\.md$/, "/");
      else if (pathname.endsWith(".md")) pathname = pathname.replace(/\.md$/, "/");

      return pathname + resolved.search + resolved.hash;
    } catch {
      return href;
    }
  }

  function wrapInlineIcon(label, svg) {
    return `<span class="wl-inline-icon md-icon" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${svg}</span>`;
  }

  function buildStrokeIcon(name, body, viewBox = "0 0 24 24") {
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" class="lucide ${escapeHtml(name)}" viewBox="${escapeHtml(viewBox)}" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  function buildSolidIcon(name, body, viewBox = "0 0 24 24") {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeHtml(viewBox)}" fill="currentColor" class="${escapeHtml(name)}" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  const ICON_TOKEN_RE = /^(?:lucide|fontawesome|material|simple)-/;

  function humanizeIconLabel(token) {
    return token.replace(/^(?:lucide|fontawesome|material|simple)-/, "").replace(/-/g, " ");
  }

  function getIconMap() {
    const generated = (typeof window !== "undefined" && window.KNOTIS_ICON_MAP && typeof window.KNOTIS_ICON_MAP === "object")
      ? window.KNOTIS_ICON_MAP
      : {};
    const map = { ...generated };
    if (map["lucide-download"] && !map["material-download"]) {
      map["material-download"] = map["lucide-download"];
    }
    if (map["lucide-arrow-down-a-z"] && !map["material-sort-alphabetical-ascending"]) {
      map["material-sort-alphabetical-ascending"] = map["lucide-arrow-down-a-z"];
    }
    return map;
  }

  function expandIconShortcodesInHtml(html) {
    if (!html || html.indexOf(":") < 0) return html;
    return html.replace(/:([a-z0-9-]+):(?![a-z0-9-])(?:\{[^}\n]*\})?/gi, (match, token) => renderIconToken(token) || match);
  }

  function expandIconShortcodesInRoot(root) {
    if (!root?.querySelectorAll) return;
    const selector = "p, li, span.wl-sec-td, h1, h2, h3, h4, h5, h6, td, th, .md-typeset__inner, .heading-flow__content";
    root.querySelectorAll(selector).forEach((el) => {
      if (!/(?:^|[^a-z0-9-]):(?:lucide|fontawesome|material|simple)-[a-z0-9-]+:/i.test(el.innerHTML)) return;
      el.innerHTML = expandIconShortcodesInHtml(el.innerHTML);
    });
  }

  function renderIconToken(token) {
    const icon = getIconMap()[token];
    if (icon) return wrapInlineIcon(icon.label, icon.svg);
    if (ICON_TOKEN_RE.test(token)) {
      return wrapInlineIcon(
        humanizeIconLabel(token),
        buildStrokeIcon("wl-inline-icon-fallback", '<circle cx="12" cy="12" r="8"/><path d="M12 8v5"/><path d="M12 16h.01"/>'),
      );
    }
    return null;
  }

  function renderKeyChord(content) {
    const html = window.KnotisCore.renderKeyChordHtml(content);
    return html || `++${escapeHtml(content)}++`;
  }

  function protectInlineCodeSpans(html, opts = {}) {
    const protectedBlocks = [];
    const replaced = html.replace(/`([^`\n]+)`/g, (_, content) => {
      const idx = protectedBlocks.length;
      protectedBlocks.push(`<code>${opts.escapeContent ? escapeHtml(content) : content}</code>`);
      return `@@WL_CODE_${idx}@@`;
    });
    return { html: replaced, protectedBlocks };
  }

  function restoreProtectedInlineCodeSpans(html, protectedBlocks) {
    if (!protectedBlocks.length) return html;
    return html.replace(/@@WL_CODE_(\d+)@@/g, (_, rawIndex) => protectedBlocks[Number(rawIndex)] || "");
  }

  function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function stripKnotisMetadataAttrs(text) {
    return stripSlideAnchorMarkers(
      String(text || "")
        .replace(/\{[^}]*\bdata-(?:search|readaloud)-[^}]*\}/gi, "")
        .replace(/\s*\{[^}]*\}\s*$/g, "")
        .trim()
    );
  }

  function stripSlideAnchorMarkers(text) {
    return String(text || "").replace(/⚓︎/g, "").replace(/⚓/g, "");
  }

  function keywordTerms(keyword) {
    return (Array.isArray(keyword) ? keyword : [keyword])
      .filter((item) => item && !String(item).startsWith("#"))
      .map((item) => String(item).toLowerCase());
  }

  function wikilinkHeadingMatches(sourceLine, keyword) {
    const terms = keywordTerms(keyword);
    if (!terms.length || !sourceLine) return [];
    const matches = [];
    const re = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = re.exec(String(sourceLine))) !== null) {
      const parts = parseWikilinkParts(match[1]);
      if (terms.includes(parts.keyword)) {
        matches.push({ keyword: parts.keyword, label: parts.label });
      }
    }
    return matches;
  }

  function lineHasWikilinkForKeyword(sourceLine, keyword) {
    return wikilinkHeadingMatches(sourceLine, keyword).length > 0;
  }

  function sourceHeadingLineForPart(part, sectionLines) {
    if (!Array.isArray(sectionLines) || !part) return "";
    return sectionLines.find((line) => headingMatchesBreadcrumb(line, [part])) || "";
  }

  function highlightPlainHeadingWithSourceWikilinks(text, keyword, renderOpts, sourceLine) {
    const matches = wikilinkHeadingMatches(sourceLine, keyword);
    if (!matches.length) return null;
    let plain = String(text || "");
    let html = "";
    for (const item of matches) {
      const idx = plain.toLowerCase().indexOf(item.label.toLowerCase());
      if (idx < 0) continue;
      html += escapeHtml(plain.slice(0, idx));
      const labelText = plain.slice(idx, idx + item.label.length);
      html += `<span class="wikilink wikilink--inline knotis-search-wikilink-match" data-keyword="${escapeHtml(item.keyword)}"${inlineFocusDataAttrs(renderOpts)} role="button" tabindex="0">${escapeHtml(labelText)}</span>`;
      plain = plain.slice(idx + item.label.length);
      break;
    }
    if (!html) return null;
    html += highlightKeyword(plain, keyword, renderOpts);
    return html;
  }

  function isHeadingLikeSectionLine(line) {
    const trimmed = String(line || "").trim();
    if (/^#{1,6}\s+/.test(trimmed)) return true;
    const body = stripListPrefix(trimmed);
    if (/^#{1,6}\s+/.test(body)) return true;
    if (/^\d+\.\s+/.test(trimmed) && /\[\[[^\]]+\]\]/.test(body)) return true;
    return /^\d+\.\s+/.test(trimmed) && /\*\*[^*]+\*\*/.test(body) && /#(?:code|output|interpretation)\b/i.test(body);
  }

  function headingSourceLineForRender(line) {
    const trimmed = String(line || "").trim();
    if (/^#{1,6}\s+/.test(trimmed)) return trimmed;
    const body = stripListPrefix(trimmed);
    if (/^#{1,6}\s+/.test(body)) return body;
    return trimmed;
  }

  function highlightKeywordInHeadingText(text, keyword, renderOpts = {}) {
    const raw = stripKnotisMetadataAttrs(text);
    if (!raw) return "";
    const sourceLine = renderOpts.sourceHeadingLine || "";
    if (/\[\[[^\]]+\]\]/.test(raw)) {
      return highlightKeyword(raw, keyword, renderOpts);
    }
    if (sourceLine && lineHasWikilinkForKeyword(sourceLine, keyword)) {
      const highlighted = highlightPlainHeadingWithSourceWikilinks(raw, keyword, renderOpts, sourceLine);
      if (highlighted) return highlighted;
    }
    const phrase = searchQueryConceptPhrase(keywordToSearchQuery(keyword)).toLowerCase();
    if (phrase && stripWikilinkMarkup(raw).toLowerCase() === phrase) {
      return `<mark class="knotis-search-query-mark">${escapeHtml(raw)}</mark>`;
    }
    return highlightKeyword(raw, keyword, renderOpts);
  }

  function highlightSectionLineText(text, keyword, renderOpts = {}, sourceLine = "") {
    const source = sourceLine || text;
    if (isHeadingLikeSectionLine(source)) {
      return highlightKeywordInHeadingText(text, keyword, {
        ...renderOpts,
        sourceHeadingLine: headingSourceLineForRender(source),
      });
    }
    return highlightKeywordForInlineMarkdown(text, keyword, renderOpts);
  }

  function renderSectionBreadcrumb(parts, opts = {}) {
    const safeParts = Array.isArray(parts)
      ? parts.map((part) => stripKnotisMetadataAttrs(part)).filter(Boolean)
      : [];
    const text = safeParts.join(" > ");
    if (!safeParts.length) return { html: "", text: "" };

    const { keyword, renderOpts = {}, sectionLines = [] } = opts;
    const segments = safeParts.map((part, index) => {
      const isLast = index === safeParts.length - 1;
      const segmentClass = isLast
        ? "wikilink-card__breadcrumb-part wikilink-card__breadcrumb-part--current"
        : "wikilink-card__breadcrumb-part";
      const sourceHeadingLine = sourceHeadingLineForPart(part, sectionLines);
      const inner = keyword
        ? highlightKeywordInHeadingText(part, keyword, { ...renderOpts, sourceHeadingLine })
        : escapeHtml(part);
      return `<span class="${segmentClass}">${inner}</span>`;
    });

    const separatorHtml = `<span class="wikilink-card__breadcrumb-sep" aria-hidden="true"></span><span class="wikilink-card__breadcrumb-sep-text"> &gt; </span>`;
    const joined = segments.reduce((acc, segment, index) => {
      if (index === 0) return segment;
      return `${acc}${separatorHtml}${segment}`;
    }, "");

    const className = opts.className
      ? `wikilink-card__breadcrumb ${opts.className}`
      : "wikilink-card__breadcrumb";
    return {
      html: `<span class="${className}" aria-label="${escapeHtml(text)}">${joined}</span>`,
      text,
    };
  }

  function stripWikilinkMarkup(text) {
    return String(text || "").replace(/\[\[([^\]]+)\]\]/g, (_match, raw) => parseWikilinkParts(raw).label);
  }

  function normalizeContextTitleText(text) {
    return stripWikilinkMarkup(stripKnotisMetadataAttrs(String(text || "")))
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(?:[-*+]|\d+\.)\s+/, "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function leadingNonBlankIndex(lines) {
    let index = 0;
    while (index < lines.length && !String(lines[index] || "").trim()) index++;
    return index;
  }

  function stripDelimitedFrontMatterLines(lines) {
    const start = leadingNonBlankIndex(lines);
    if (String(lines[start] || "").trim() !== "---") return { lines, skipped: 0 };
    for (let index = start + 1; index < lines.length; index++) {
      const trimmed = String(lines[index] || "").trim();
      if (trimmed === "---" || trimmed === "...") {
        return { lines: lines.slice(index + 1), skipped: index + 1 };
      }
    }
    return { lines, skipped: 0 };
  }

  const YAML_FRONT_MATTER_KEYS = new Set([
    "title", "description", "icon", "tags", "tag", "date", "author",
    "authors", "draft", "hide", "search", "extra", "template",
  ]);

  function isLikelyFrontMatterKeyLine(line) {
    const match = String(line || "").trim().match(/^([A-Za-z][A-Za-z0-9_.-]*):(?:\s|$)/);
    return Boolean(match && YAML_FRONT_MATTER_KEYS.has(match[1].toLowerCase()));
  }

  function stripLooseFrontMatterLines(lines, renderOpts = {}) {
    if (Number.isInteger(renderOpts.baseLineIndex) && renderOpts.baseLineIndex !== 0) {
      return { lines, skipped: 0 };
    }
    let index = leadingNonBlankIndex(lines);
    if (!isLikelyFrontMatterKeyLine(lines[index])) return { lines, skipped: 0 };

    let sawKey = false;
    while (index < lines.length) {
      const trimmed = String(lines[index] || "").trim();
      if (!trimmed) {
        index++;
        continue;
      }
      if (isLikelyFrontMatterKeyLine(trimmed)) {
        sawKey = true;
        index++;
        continue;
      }
      if (sawKey && /^[-*+]\s+/.test(trimmed)) {
        index++;
        continue;
      }
      break;
    }
    return sawKey ? { lines: lines.slice(index), skipped: index } : { lines, skipped: 0 };
  }

  function stripLeadingDuplicatePageTitleLine(lines, renderOpts = {}) {
    const pageTitle = normalizeContextTitleText(renderOpts.pageTitle);
    if (!pageTitle) return { lines, skipped: 0 };
    const index = leadingNonBlankIndex(lines);
    if (normalizeContextTitleText(lines[index]) !== pageTitle) return { lines, skipped: 0 };
    return { lines: lines.slice(index + 1), skipped: index + 1 };
  }

  function preparePaneContextLines(lines, renderOpts = {}) {
    let prepared = Array.isArray(lines) ? [...lines] : [];
    let skipped = 0;
    for (const fn of [
      stripDelimitedFrontMatterLines,
      stripLooseFrontMatterLines,
      stripLeadingDuplicatePageTitleLine,
      stripDelimitedFrontMatterLines,
      stripLooseFrontMatterLines,
    ]) {
      const result = fn(prepared, renderOpts);
      prepared = result.lines;
      skipped += result.skipped;
    }
    return { lines: prepared, skipped };
  }

  function isHtmlCommentLine(line) {
    return /^\s*<!--[\s\S]*?-->\s*$/.test(String(line || ""));
  }

  function isBareHtmlWrapperLine(line) {
    return /^<\/?[a-zA-Z][^>]*>$/.test(String(line || "").trim());
  }

  function isHtmlLikeLine(line) {
    const trimmed = String(line || "").trim();
    return Boolean(trimmed) && trimmed.startsWith("<") && !isHtmlCommentLine(trimmed);
  }

  function isRawMediaHtmlBlock(lines) {
    return Array.isArray(lines) && lines.some((line) => /<(?:iframe|video)\b/i.test(String(line || "")));
  }

  function isRawMediaBlockStart(line) {
    return /^\s*(?:[-+*]|\d+[.)])?\s*<(?:iframe|video)\b/i.test(stripBlockListPrefix(line));
  }

  function mediaBlockClosePattern(line) {
    const stripped = stripBlockListPrefix(line);
    if (/<iframe\b/i.test(stripped)) return /<\/iframe\s*>/i;
    if (/<video\b/i.test(stripped)) return /<\/video\s*>/i;
    return null;
  }

  function collectRawMediaBlock(lines, start) {
    const blockLines = [];
    let i = start;
    const closePattern = mediaBlockClosePattern(lines[start]);
    while (i < lines.length) {
      blockLines.push(stripBlockListPrefix(lines[i]));
      i++;
      if (closePattern && closePattern.test(String(lines[i - 1] || ""))) break;
    }
    return { lines: blockLines, end: i };
  }

  function iframeProviderFromSrc(src) {
    try {
      const url = new URL(String(src || "").replace(/&amp;/g, "&"), location.href);
      const host = url.hostname.toLowerCase();
      const path = url.pathname;
      if (
        (host === "youtube.com" || host === "www.youtube.com" || host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com")
        && /^\/embed\/[^/]+/.test(path)
      ) {
        return "youtube";
      }
      if (host === "drive.google.com" && /^\/file\/d\/[^/]+\/(?:view|preview)/.test(path)) {
        return "drive";
      }
    } catch {
      return "";
    }
    return "";
  }

  function normalizeIframeSrc(src) {
    const provider = iframeProviderFromSrc(src);
    if (!provider) return src;
    try {
      const url = new URL(String(src || "").replace(/&amp;/g, "&"), location.href);
      if (provider === "youtube") {
        url.searchParams.delete("origin");
        url.searchParams.delete("autoplay");
      } else if (provider === "drive") {
        url.pathname = url.pathname.replace(/\/view\/?$/, "/preview");
      }
      return url.href;
    } catch {
      return src;
    }
  }

  function escapeIframeAttrValue(value, quote) {
    let escaped = String(value || "").replace(/&/g, "&amp;");
    if (quote === '"') return escaped.replace(/"/g, "&quot;");
    return escaped.replace(/'/g, "&#39;");
  }

  function renderRawMediaBlock(lines) {
    const html = (Array.isArray(lines) ? lines : []).join("\n");
    return html.replace(/\bsrc=(["'])([\s\S]*?)\1/gi, (match, quote, src) => {
      const normalized = normalizeIframeSrc(src);
      return normalized === src ? match : `src=${quote}${escapeIframeAttrValue(normalized, quote)}${quote}`;
    });
  }

  function findIframeBlockAround(lines, index) {
    if (index < 0 || index >= lines.length) return null;
    let start = index;
    while (start >= 0 && !isRawMediaBlockStart(lines[start])) start--;
    if (start < 0) return null;
    const block = collectRawMediaBlock(lines, start);
    return index < block.end ? { start, end: block.end } : null;
  }

  function inlineFocusDataAttrs(renderOpts = {}) {
    const focusPageUrl = typeof renderOpts.focusPageUrl === "string" && renderOpts.focusPageUrl
      ? ` data-focus-page-url="${escapeHtml(renderOpts.focusPageUrl)}"`
      : "";
    const focusOccurrenceIndex = renderOpts.focusOccurrenceIndex != null && renderOpts.focusOccurrenceIndex !== ""
      ? ` data-occurrence-index="${escapeHtml(String(renderOpts.focusOccurrenceIndex))}"`
      : "";
    return `${focusPageUrl}${focusOccurrenceIndex}`;
  }

  function focusTargetAttrs(renderOpts = {}, lineIndex = null) {
    if (!Number.isInteger(lineIndex)) return "";
    if (!Number.isInteger(renderOpts.initialFocusLineIndex)) return "";
    return lineIndex === renderOpts.initialFocusLineIndex ? ' data-wl-focus-target="true"' : "";
  }

  
  
  function renderInlineMarkdown(html, pageUrl, renderOpts = {}) {
    const enableMarkSyntax = renderOpts.enableMarkSyntax !== false;
    const inlineCode = protectInlineCodeSpans(html);
    html = inlineCode.html;
    html = html.replace(/&amp;nbsp;/g, "&nbsp;");
    html = html.replace(/(?:&lt;|<)\s*br\s*\/?\s*(?:&gt;|>)/gi, "<br>");
    if (enableMarkSyntax) html = html.replace(MARK_SYNTAX_RE, "<mark>$1</mark>");
    html = html.replace(/:([a-z0-9-]+):(?![a-z0-9-])(?:\{[^}\n]*\})?/gi, (match, token) => renderIconToken(token) || match);
    html = html.replace(/\+\+([^<>\n]+?)\+\+/g, (_, content) => renderKeyChord(content));
    
    
    
    
    
    
    
    
    const stripInjectedTags = (value) => String(value || "").replace(/<[^>]*>/g, "");
    
    
    
    html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    
    
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)(?:\s*\{[^}\n]*\})?/g, (_, alt, src) => {
      const resolved = resolveRelativeSrc(stripInjectedTags(src).trim(), pageUrl || "");
      return `<img src="${escapeHtml(resolved)}" alt="${stripInjectedTags(alt)}" class="wl-img" loading="lazy">`;
    });
    
    
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)(?:\s*\{[^}\n]*\})?/g, (_, label, href) => {
      const resolved = resolveRelativeHref(stripInjectedTags(href).trim(), pageUrl || "");
      return `<a class="wikilink-card__md-link" href="${escapeHtml(resolved)}">${label}</a>`;
    });
    
    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    
    html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
    return restoreProtectedInlineCodeSpans(html, inlineCode.protectedBlocks);
  }

  

  function processTextNode(node) {
    const text = node.nodeValue;
    if (!text.includes("[[") && !CONTENT_TAG_RE.test(text)) return;

    CONTENT_TAG_RE.lastIndex = 0;
    INLINE_TOKEN_RE.lastIndex = 0;
    const currentPageUrl = getCurrentPageUrl();
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    while ((match = INLINE_TOKEN_RE.exec(text)) !== null) {
      
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }

      if (match[1]) {
        if (!isValidWikilinkRaw(match[1])) {
          frag.appendChild(document.createTextNode(match[0]));
          lastIndex = match.index + match[0].length;
          continue;
        }
        const { keyword, label, mode } = parseWikilinkParts(match[1]);
        const idx = keywordCounters.get(keyword) || 0;
        keywordCounters.set(keyword, idx + 1);

        const span = document.createElement("span");
        span.className = "wikilink";
        span.id = `${kwToId(keyword)}-${idx}`;
        span.dataset.keyword = keyword;
        span.dataset.occurrenceIndex = String(idx);
        if (currentPageUrl) span.dataset.focusPageUrl = currentPageUrl;
        if (mode === "reference") span.dataset.wikilinkMode = "reference";
        span.textContent = label;
        span.setAttribute("role", "button");
        span.setAttribute("tabindex", "0");
        span.setAttribute("aria-haspopup", "true");
        frag.appendChild(span);
      } else if (match[2]) {
        const contentTag = normalizeContentTag(match[2]);
        if (isCssHexColorToken(contentTag)) {
          frag.appendChild(document.createTextNode(match[0]));
          lastIndex = match.index + match[0].length;
          continue;
        }
        const idx = contentTagCounters.get(contentTag) || 0;
        contentTagCounters.set(contentTag, idx + 1);

        const span = document.createElement("span");
        span.className = "content-tag";
        span.id = `${contentTagToId(contentTag)}-${idx}`;
        span.dataset.contentTag = contentTag;
        span.dataset.occurrenceIndex = String(idx);
        if (currentPageUrl) span.dataset.focusPageUrl = currentPageUrl;
        span.textContent = contentTag;
        span.setAttribute("role", "button");
        span.setAttribute("tabindex", "0");
        span.setAttribute("aria-haspopup", "true");
        frag.appendChild(span);
      }

      lastIndex = match.index + match[0].length;
    }

    
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    node.parentNode.replaceChild(frag, node);
  }

  function scrollToAnchor() {
    const hash = location.hash;
    if (!hash.startsWith("#wikilink-") && !hash.startsWith("#content-tag-")) return;
    const anchorEl = document.getElementById(hash.slice(1));
    if (!anchorEl) return;
    highlightBlockTarget(anchorEl);
  }

  
  
  
  
  function stripBracketsFromNav() {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue.includes("[[")) return NodeFilter.FILTER_REJECT;
          
          let el = node.parentElement;
          while (el) {
            if (el.classList?.contains("md-nav__link") ||
                el.classList?.contains("md-nav--secondary") ||
                el.classList?.contains("md-sidebar--primary") ||
                el.classList?.contains("md-sidebar--secondary")) {
              return NodeFilter.FILTER_ACCEPT;
            }
            el = el.parentElement;
          }
          return NodeFilter.FILTER_REJECT;
        },
      }
    );
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      n.nodeValue = n.nodeValue.replace(/\[\[([^\]]+)\]\]/g, (_match, raw) => parseWikilinkParts(raw).label);
    });
  }

  function walkAndReplace(root) {
    
    
    const skip = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA"]);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let el = node.parentElement;
        while (el) {
          if (skip.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          if (el.classList?.contains("md-nav__link") ||
              el.classList?.contains("md-nav--secondary") ||
              el.classList?.contains("md-sidebar--primary") ||
              el.classList?.contains("md-sidebar--secondary")) {
            return NodeFilter.FILTER_REJECT;
          }
          el = el.parentElement;
        }
        CONTENT_TAG_RE.lastIndex = 0;
        const hasInlineToken = node.nodeValue.includes("[[") || CONTENT_TAG_RE.test(node.nodeValue);
        CONTENT_TAG_RE.lastIndex = 0;
        return hasInlineToken ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });

    keywordCounters.clear();
    contentTagCounters.clear();
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(processTextNode);
  }

  

  async function getWikilinkData() {
    if (wikilinkData) return wikilinkData;
    try {
      const resp = await fetchJsonNoStore(JSON_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      wikilinkData = await resp.json();
    } catch (err) {
      console.error("[wikilinks] Failed to load wikilinks.json:", err);
      wikilinkData = {};
    }
    return wikilinkData;
  }

  async function getContentTagData() {
    if (contentTagData) return contentTagData;
    try {
      const resp = await fetchJsonNoStore(CONTENT_TAGS_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      contentTagData = await resp.json();
    } catch (err) {
      console.error("[wikilinks] Failed to load content-tags.json:", err);
      contentTagData = {};
    }
    return contentTagData;
  }

  async function getReferenceData() {
    if (referenceData) return referenceData;
    try {
      const resp = await fetchJsonNoStore(REFERENCES_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      referenceData = await resp.json();
    } catch (err) {
      console.error("[wikilinks] Failed to load references.json:", err);
      referenceData = {};
    }
    return referenceData;
  }

  async function getNavOrder() {
    if (navOrderData !== null) return navOrderData;
    try {
      const resp = await fetchJsonNoStore(NAV_ORDER_URL);
      navOrderData = resp.ok ? await resp.json() : {};
    } catch {
      navOrderData = {};
    }
    return navOrderData;
  }

  function compareContentTagNames(a, b, order = FALLBACK_CONTENT_TAG_ORDER) {
    const preferredOrder = normalizeContentTagOrder(order);
    const aIdx = preferredOrder.indexOf(normalizeContentTag(a));
    const bIdx = preferredOrder.indexOf(normalizeContentTag(b));
    if (aIdx !== -1 || bIdx !== -1) {
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    }
    return a.localeCompare(b);
  }

  function getDirectNavItemText(item) {
    const labels = item.querySelectorAll(".md-nav__link .md-ellipsis");
    for (const label of labels) {
      if (label.closest(".md-nav__item") === item) return label.textContent.trim();
    }
    return "";
  }

  function findNavItemByText(root, label) {
    return Array.from(root.querySelectorAll(".md-nav__item")).find((item) => (
      item.classList?.contains("md-nav__item") &&
      getDirectNavItemText(item) === label
    ));
  }

  function normalizeNavPath(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const normalizePath = (path) => {
      let token = String(path || "").replace(/^\/+|\/+$/g, "");
      if (token.endsWith(".md")) token = token.slice(0, -3);
      if (token.endsWith("/index")) token = token.slice(0, -6);
      return token ? `/${token}/`.replace(/\/+/g, "/") : "";
    };
    try {
      return normalizePath(new URL(raw, window.location.href).pathname);
    } catch (_err) {
      return normalizePath(raw.split("#")[0].split("?")[0]);
    }
  }

  function pageUrlPathSuffix(pageUrl) {
    let token = String(pageUrl || "").trim().split("#")[0].split("?")[0].replace(/^\/+|\/+$/g, "");
    if (token.endsWith(".md")) token = token.slice(0, -3);
    if (token.endsWith("/index")) token = token.slice(0, -6);
    return token ? `/${token}/`.replace(/\/+/g, "/") : "";
  }

  function navHrefMatchesPageUrl(href, pageUrl) {
    const hrefPath = normalizeNavPath(href);
    const suffix = pageUrlPathSuffix(pageUrl);
    return Boolean(hrefPath && suffix && (hrefPath === suffix || hrefPath.endsWith(suffix)));
  }

  function currentLocationMatchesPageUrl(pageUrl) {
    const path = normalizeNavPath(window.location.href);
    const suffix = pageUrlPathSuffix(pageUrl);
    return Boolean(path && suffix && (path === suffix || path.endsWith(suffix)));
  }

  
  
  
  function findNavItemByHref(root, hrefSuffix) {
    const link = Array.from(root.querySelectorAll(".md-nav__item > .md-nav__link[href]"))
      .find((a) => navHrefMatchesPageUrl(a.getAttribute("href") || "", hrefSuffix));
    return link ? link.closest(".md-nav__item") : null;
  }

  function createContentTagChip(tag, className) {
    const chip = document.createElement("button");
    chip.className = `content-tag ${className || ""}`.trim();
    chip.type = "button";
    chip.dataset.contentTag = tag;
    chip.textContent = tag;
    chip.setAttribute("aria-label", `Show ${tag} blocks`);
    const openFromChip = (event) => {
      event.preventDefault();
      event.stopPropagation();
      openContentTagPane(tag);
    };
    chip.addEventListener("pointerdown", openFromChip);
    chip.addEventListener("click", openFromChip);
    return chip;
  }

  

  async function renderNavContentTagChips() {
    const nav = document.querySelector(".md-nav--primary");
    const list = nav?.querySelector(":scope > .md-nav__list");
    if (!nav || !list) return;

    const cfg = await getResolvedContentTagsConfig();
    if (!cfg.nav_chips) {
      list.querySelectorAll(".wikilink-nav-tags__wrap").forEach((node) => node.remove());
      list.querySelectorAll(".wikilink-nav-tags--generated").forEach((node) => node.remove());
      return;
    }

    const data = await getContentTagData();
    const tags = Object.keys(data || {}).sort((a, b) => compareContentTagNames(a, b, cfg.order));
    const contentTagsItem = findNavItemByHref(nav, cfg.page_url)
      || (currentLocationMatchesPageUrl(cfg.page_url) ? findNavItemByText(nav, CONTENT_TAGS_NAV_LABEL) : null);
    const navLabel = contentTagsItem?.querySelector(":scope > .md-nav__link .md-ellipsis")?.textContent?.trim()
      || CONTENT_TAGS_NAV_LABEL;
    const modulesItem = findNavItemByText(nav, "Modules");
    if (!tags.length || (!contentTagsItem && !cfg.enabled && !modulesItem)) {
      list.querySelectorAll(".wikilink-nav-tags__wrap").forEach((node) => node.remove());
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "wikilink-nav-tags__wrap";
    tags.forEach((tag) => {
      wrap.appendChild(createContentTagChip(tag, "wikilink-nav-tags__chip"));
    });

    const existingWrap = list.querySelector(".wikilink-nav-tags__wrap");
    if (existingWrap) {
      existingWrap.replaceWith(wrap);
      return;
    }

    let item = contentTagsItem || list.querySelector(".wikilink-nav-tags--generated");
    if (!item) {
      item = document.createElement("li");
      item.className = "md-nav__item wikilink-nav-tags wikilink-nav-tags--generated";
      const link = document.createElement("a");
      link.className = "md-nav__link wikilink-nav-tags__heading";
      if (cfg.enabled && cfg.page_url) {
        link.href = resolveSitePageHref(cfg.page_url);
      } else {
        link.href = "#";
        link.addEventListener("click", (event) => event.preventDefault());
      }
      link.innerHTML = `${HASH_ICON_SVG}<span class="md-ellipsis">${escapeHtml(navLabel)}</span>`;
      item.appendChild(link);
      if (modulesItem) list.insertBefore(item, modulesItem);
      else list.appendChild(item);
    } else {
      item.classList.add("wikilink-nav-tags");
      item.setAttribute("aria-label", navLabel);
    }

    const directLink = Array.from(item.children).find((child) => child.classList?.contains("md-nav__link"));
    if (directLink) directLink.insertAdjacentElement("afterend", wrap);
    else item.appendChild(wrap);
  }

  async function renderContentTagPageChips() {
    const cfg = await getResolvedContentTagsConfig();
    if (!cfg.enabled) return;

    const container = document.getElementById("knotis-content-tags-page");
    if (!container) return;

    const data = await getContentTagData();
    const tags = Object.keys(data || {}).sort((a, b) => compareContentTagNames(a, b, cfg.order));
    container.innerHTML = "";
    tags.forEach((tag) => {
      container.appendChild(createContentTagChip(tag, "wikilink-content-tags-page__chip"));
    });
  }

  async function getGraphData() {
    if (graphDataCache !== null) return graphDataCache;
    try {
      const resp = await fetchJsonNoStore(GRAPH_JSON_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      graphDataCache = await resp.json();
    } catch (err) {
      console.error("[wikilinks] Failed to load graph.json:", err);
      graphDataCache = {};
    }
    return graphDataCache;
  }

  async function getGraphMeta() {
    if (graphMetaData !== null) return graphMetaData;
    const graph = await getGraphData();
    graphMetaData = graph?.meta?.knotis || {};
    return graphMetaData;
  }

  function getCurrentPaneViewKey() {
    return document.getElementById("graph-container") ? "site_graph" : "page_graph";
  }

  function pluralize(count, singular, plural = `${singular}s`) {
    return `${count} ${count === 1 ? singular : plural}`;
  }

  function buildPaneMetaRow(labels) {
    if (!Array.isArray(labels) || !labels.length) return "";
    const badges = labels
      .filter(Boolean)
      .map((label) => `<span class="wikilink-pane__meta-badge">${escapeHtml(label)}</span>`)
      .join("");
    return badges ? `<div class="wikilink-pane__meta">${badges}</div>` : "";
  }

  function buildPathModuleItems(keyword, modules) {
    return modules.map((moduleEntry, index) => `
        <button
          type="button"
          class="learning-path__item"
          data-page-url="${escapeHtml(moduleEntry.page_url)}"
          data-keyword="${escapeHtml(keyword)}"
        >
          <span class="learning-path__step">${index + 1}</span>
          <span class="learning-path__label">${escapeHtml(moduleEntry.page_title)}</span>
        </button>`).join("");
  }

  function buildLearningPathSection(keyword) {
    return `
      <section class="learning-path" hidden>
        <div class="learning-path__header">
          <span class="learning-path__icon">${ROUTE_ICON_SVG}</span>
          <span>Path</span>
        </div>
        <div class="learning-path__list" data-path-list></div>
      </section>`;
  }

  function modulePagesFromEntries(entries, navOrder = {}, pathCfg = FALLBACK_PATH_CONFIG) {
    const includes = pathCfg.include_paths || pathCfg.include || [];
    const excludes = pathCfg.exclude_paths || pathCfg.exclude || [];
    const modules = new Map();
    (entries || []).forEach((entry) => {
      const pageUrl = String(entry?.page_url || "").trim();
      if (!pageUrl) return;
      const included = !includes.length || includes.some((token) => pathTokenMatches(token, pageUrl));
      if (!included) return;
      if (excludes.some((token) => pathTokenMatches(token, pageUrl))) return;
      if (!modules.has(pageUrl)) {
        modules.set(pageUrl, {
          page_url: pageUrl,
          page_title: entry.page_title || pageUrl,
        });
      }
    });
    return [...modules.values()].sort((a, b) => compareEntriesByNavOrder(a, b, navOrder));
  }

  function findPaneModuleSection(pane, pageUrl) {
    if (!pane || !pageUrl) return null;
    return [...pane.querySelectorAll(".wikilink-module[data-page-url]")]
      .find((section) => section.dataset.pageUrl === pageUrl) || null;
  }

  function scrollPaneToModule(pane, pageUrl) {
    const module = findPaneModuleSection(pane, pageUrl);
    if (!module) return;
    module.classList.remove("wikilink-module--minimized");
    const target = module.querySelector(".wikilink-module__header")
      || module.querySelector(".wikilink-card")
      || module;
    const performScroll = () => {
      try {
        const paneRect = pane.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const topOffset = Math.max(72, Math.round(pane.clientHeight * 0.1));
        const nextTop = pane.scrollTop + (targetRect.top - paneRect.top) - topOffset;
        pane.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
      } catch {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(performScroll);
    });
  }

  async function syncPathPanelFromEntries(pane, keyword, entries, navOrder = {}) {
    const section = pane?.querySelector(".learning-path");
    const list = pane?.querySelector("[data-path-list]");
    if (!section || !list) return;

    const pathCfg = await getResolvedPathConfig();
    if (pathCfg.enabled === false) {
      section.hidden = true;
      list.innerHTML = "";
      return;
    }
    const modules = modulePagesFromEntries(entries, navOrder, pathCfg);
    if (!modules.length) {
      section.hidden = true;
      list.innerHTML = "";
      return;
    }

    section.hidden = false;
    list.innerHTML = buildPathModuleItems(keyword, modules);
    bindLearningPathClicks(pane);
  }

  
  
  
  function buildConceptReturnTab(graphSource, paneConfig = FALLBACK_PANE_CONFIG) {
    if (paneConfig.show_graph_return_button === false) return "";
    const meta = getGraphReturnMeta(graphSource);
    if (!meta) return "";
    const src = meta.source;
    const keywordAttr = src.keyword ? ` data-keyword="${escapeHtml(src.keyword)}"` : "";
    const pageAttr = src.pageUrl ? ` data-page-url="${escapeHtml(src.pageUrl)}"` : "";
    const returnIcon = `<span class="graph-tab__return" aria-hidden="true">${UNDO2_ICON_SVG}</span>`;
    return `
        <button type="button" class="graph-tab wikilink-pane__graph-return wikilink-pane__graph-return--${escapeHtml(src.type)}" data-graph-type="${escapeHtml(src.type)}"${keywordAttr}${pageAttr} aria-label="${escapeHtml(meta.label)}">
          <span class="graph-tab__icon">${meta.icon}</span>
          <span class="graph-tab__label">${escapeHtml(meta.tabLabel)}</span>
          ${returnIcon}
        </button>`;
  }

  function buildConceptGraphSection(keyword, paneConfig = FALLBACK_PANE_CONFIG, graphSource = null) {
    if (paneConfig.show_concept_graph_preview === false) return "";
    const kw = escapeHtml(keyword);
    const returnTab = buildConceptReturnTab(graphSource, paneConfig);
    const tabClass = returnTab ? "graph-tabs" : "graph-tabs graph-tabs--single";
    return `
      <div class="wikilink-pane__graph-section">
        <div class="${tabClass}" role="group" aria-label="Graph views">
          <button type="button" class="graph-tab graph-tab--active wikilink-pane__concept-graph-btn" data-graph-tab="concept" data-keyword="${kw}" aria-current="true" aria-label="Open concept graph">
            <span class="graph-tab__icon">${SHARE2_ICON_SVG}</span>
            <span class="graph-tab__label">Concept graph</span>
          </button>
          ${returnTab}
        </div>
        <div class="concept-graph-preview__graph" data-keyword="${kw}" aria-label="Concept graph preview"></div>
      </div>`;
  }

  function buildConceptLearningPanel(keyword, entries, navOrder = {}, paneConfig = FALLBACK_PANE_CONFIG, graphSource = null) {
    const graphSection = buildConceptGraphSection(keyword, paneConfig, graphSource);
    const learningPathSection = buildLearningPathSection(keyword);
    if (!graphSection && !learningPathSection) return "";
    return `
      <section class="wikilink-pane__learning-panel">
        ${graphSection}
        ${learningPathSection}
      </section>`;
  }

  function bindLearningPathClicks(pane) {
    if (!pane) return;
    pane.querySelectorAll(".learning-path__item").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const pageUrl = button.dataset.pageUrl || "";
        if (!pageUrl) return;
        scrollPaneToModule(pane, pageUrl);
      });
    });
  }

  function graphViewEnabled(graphData, viewKey) {
    return graphData?.meta?.knotis?.[viewKey]?.graph?.enabled !== false;
  }

  function getKeywordNodeStats(graph, keyword) {
    if (!graph?.nodes || !keyword) return null;
    const node = graph.nodes.find((entry) => entry?.id === `kw:${keyword.toLowerCase()}`);
    if (!node) return null;
    const occurrenceCount = Number(node.occurrence_count || 0);
    const pageCount = Number(node.page_count || 0);
    const labels = [];
    if (occurrenceCount > 0) labels.push(pluralize(occurrenceCount, "mention"));
    if (pageCount > 0) labels.push(pluralize(pageCount, "page"));
    return labels.length ? labels : null;
  }

  function getEdgeStatLabels(graph, detail, resolvedPageUrls) {
    if (Array.isArray(resolvedPageUrls) && resolvedPageUrls.length) {
      const uniquePages = [...new Set(resolvedPageUrls.filter(Boolean))];
      return uniquePages.length ? [`linked on ${pluralize(uniquePages.length, "page")}`] : null;
    }
    if (!graph?.edges || !detail?.sourceId || !detail?.targetId) return null;
    const edge = graph.edges.find((entry) => {
      if (!entry) return false;
      const sameDirection = entry.source === detail.sourceId && entry.target === detail.targetId;
      const reverseDirection = entry.source === detail.targetId && entry.target === detail.sourceId;
      const directionMatches = sameDirection || reverseDirection;
      if (!directionMatches) return false;
      if (detail.relation && entry.relation && entry.relation !== detail.relation) return false;
      return true;
    });
    if (!edge) return null;
    const pageCount = Number(edge.page_count || (Array.isArray(edge.pages) ? edge.pages.length : 0));
    return pageCount > 0 ? [`linked on ${pluralize(pageCount, "page")}`] : null;
  }

  

  function normalizePaneConfig(paneConfig) {
    const normalized = deepMerge(FALLBACK_PANE_CONFIG, paneConfig || {});
    normalized.context_scope = normalized.context_scope || FALLBACK_PANE_CONFIG.context_scope;
    normalized.order = Array.isArray(normalized.order) ? normalized.order : [];
    normalized.width = Number.isInteger(normalized.width) && normalized.width >= 320
      ? normalized.width
      : FALLBACK_PANE_CONFIG.width;
    normalized.initial_lines = Number.isInteger(normalized.initial_lines) && normalized.initial_lines >= 1
      ? normalized.initial_lines
      : FALLBACK_PANE_CONFIG.initial_lines;
    normalized.initial_list_items = Number.isInteger(normalized.initial_list_items) && normalized.initial_list_items >= 1
      ? normalized.initial_list_items
      : FALLBACK_PANE_CONFIG.initial_list_items;
    normalized.chunk_lines = Number.isInteger(normalized.chunk_lines) && normalized.chunk_lines >= 1
      ? normalized.chunk_lines
      : FALLBACK_PANE_CONFIG.chunk_lines;
    normalized.intro_expand_to_heading = typeof normalized.intro_expand_to_heading === "boolean"
      ? normalized.intro_expand_to_heading
      : FALLBACK_PANE_CONFIG.intro_expand_to_heading;
    normalized.content_tag_full_section = typeof normalized.content_tag_full_section === "boolean"
      ? normalized.content_tag_full_section
      : FALLBACK_PANE_CONFIG.content_tag_full_section;
    normalized.reference_full_section = typeof normalized.reference_full_section === "boolean"
      ? normalized.reference_full_section
      : FALLBACK_PANE_CONFIG.reference_full_section;
    [
      "show_history_controls",
      "show_meta_badges",
      "show_context_controls",
      "show_concept_graph_preview",
      "show_graph_return_button",
      "skip_duplicate_headings",
      "keyword_own_section",
    ].forEach((key) => {
      normalized[key] = typeof normalized[key] === "boolean"
        ? normalized[key]
        : FALLBACK_PANE_CONFIG[key];
    });
    normalized.keyword_context_mode = ["compact", "parent_list", "section"].includes(normalized.keyword_context_mode)
      ? normalized.keyword_context_mode
      : FALLBACK_PANE_CONFIG.keyword_context_mode;
    normalized.edge_context_mode = ["compact", "parent_list", "section"].includes(normalized.edge_context_mode)
      ? normalized.edge_context_mode
      : FALLBACK_PANE_CONFIG.edge_context_mode;
    normalized.edge_gap_mode = ["toggle", "inline", "hide"].includes(normalized.edge_gap_mode)
      ? normalized.edge_gap_mode
      : FALLBACK_PANE_CONFIG.edge_gap_mode;
    normalized.edge_inline_gap_max_lines = Number.isInteger(normalized.edge_inline_gap_max_lines) && normalized.edge_inline_gap_max_lines >= 0
      ? normalized.edge_inline_gap_max_lines
      : FALLBACK_PANE_CONFIG.edge_inline_gap_max_lines;
    return normalized;
  }

  function normalizeGraphSource(source) {
    if (!isPlainObject(source)) return null;
    const type = String(source.type || "").trim().toLowerCase();
    if (!["site", "page", "concept"].includes(type)) return null;
    const clean = { type };
    if (source.keyword) clean.keyword = String(source.keyword).trim();
    if (source.pageUrl) clean.pageUrl = String(source.pageUrl).trim();
    return clean;
  }

  function graphSourceFromLegacy(opts = {}) {
    return opts.fromGraph ? { type: "page" } : null;
  }

  async function getResolvedPaneConfig(viewKey = getCurrentPaneViewKey()) {
    const meta = await getGraphMeta();
    const defaultsRaw = isPlainObject(meta.defaults) ? meta.defaults : {};
    const viewRaw = isPlainObject(meta[viewKey]) ? meta[viewKey] : {};
    const resolved = deepMerge(
      { pane: FALLBACK_PANE_CONFIG },
      defaultsRaw,
      viewRaw
    );
    return normalizePaneConfig(resolved.pane);
  }

  async function getResolvedAppearanceConfig(viewKey = getCurrentPaneViewKey()) {
    const meta = await getGraphMeta();
    const defaultsRaw = isPlainObject(meta.defaults) ? meta.defaults : {};
    const viewRaw = isPlainObject(meta[viewKey]) ? meta[viewKey] : {};
    return deepMerge(
      { colors: {}, content_tag_colors: {} },
      defaultsRaw,
      viewRaw
    );
  }

  function normalizeContentConfig(contentConfig) {
    const normalized = deepMerge(FALLBACK_CONTENT_CONFIG, contentConfig || {});
    normalized.heading_numbering = typeof normalized.heading_numbering === "boolean"
      ? normalized.heading_numbering
      : FALLBACK_CONTENT_CONFIG.heading_numbering;
    normalized.heading_guides = typeof normalized.heading_guides === "boolean"
      ? normalized.heading_guides
      : FALLBACK_CONTENT_CONFIG.heading_guides;
    normalized.styled_section_groups = typeof normalized.styled_section_groups === "boolean"
      ? normalized.styled_section_groups
      : FALLBACK_CONTENT_CONFIG.styled_section_groups;
    normalized.nested_numbering_lists = FALLBACK_CONTENT_CONFIG.nested_numbering_lists;
    delete normalized.structured_lists;
    return normalized;
  }

  async function getResolvedContentConfig() {
    const meta = await getGraphMeta();
    return normalizeContentConfig(isPlainObject(meta.content) ? meta.content : {});
  }

  async function getResolvedContentTagsConfig() {
    const meta = await getGraphMeta();
    const raw = isPlainObject(meta.content_tags) ? meta.content_tags : {};
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : FALLBACK_CONTENT_TAGS_CONFIG.enabled,
      nav_chips: typeof raw.nav_chips === "boolean" ? raw.nav_chips : FALLBACK_CONTENT_TAGS_CONFIG.nav_chips,
      order: normalizeContentTagOrder(raw.order),
      page_url: typeof raw.page_url === "string" && raw.page_url.trim()
        ? raw.page_url.trim()
        : FALLBACK_CONTENT_TAGS_CONFIG.page_url,
    };
  }

  async function getResolvedWikilinksConfig() {
    const meta = await getGraphMeta();
    const raw = isPlainObject(meta.wikilinks) ? meta.wikilinks : {};
    return {
      default: typeof raw.default === "string" && raw.default.trim()
        ? raw.default.trim()
        : FALLBACK_WIKILINKS_CONFIG.default,
      slate: typeof raw.slate === "string" && raw.slate.trim()
        ? raw.slate.trim()
        : FALLBACK_WIKILINKS_CONFIG.slate,
    };
  }

  function normalizePathTokenList(raw) {
    const items = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
    return items
      .map((item) => String(item || "").trim().replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
  }

  async function getResolvedPathConfig() {
    const meta = await getGraphMeta();
    const pane = isPlainObject(meta.pane) ? meta.pane : {};
    const raw = isPlainObject(pane.path) ? pane.path : {};
    return {
      enabled: typeof raw.enabled === "boolean"
        ? raw.enabled
        : FALLBACK_PATH_CONFIG.enabled,
      include_paths: normalizePathTokenList(raw.include_paths),
      exclude_paths: normalizePathTokenList(raw.exclude_paths),
    };
  }

  function pathTokenMatches(token, pageUrl) {
    const t = String(token || "").trim().replace(/^\/+|\/+$/g, "");
    if (!t || !pageUrl) return false;
    return pageUrl === `${t}/` || pageUrl.startsWith(`${t}/`);
  }

  function resolveSitePageHref(pageUrl) {
    const token = String(pageUrl || "").trim();
    if (!token) return "";
    if (/^https?:\/\//i.test(token)) return token;
    try {
      return new URL(token, document.baseURI).pathname;
    } catch {
      return token;
    }
  }

  async function applyConfiguredContentStyles() {
    const config = await getResolvedContentConfig();
    const root = document.documentElement;
    root.setAttribute("data-knotis-heading-numbering", String(config.heading_numbering));
    root.setAttribute("data-knotis-heading-guides", String(config.heading_guides));
    root.setAttribute("data-knotis-nested-numbering-lists", String(config.nested_numbering_lists));
    root.setAttribute("data-knotis-styled-section-groups", String(config.styled_section_groups));
  }

  function wrapMarkerlessListItem(html, depth, state = null) {
    const layoutStyle = state
      ? outlineLayoutStyle(state, depth, "bullet")
      : `--wl-depth:${depth}`;
    return `<div class="wl-sec-list-item wl-sec-list-item--bullet wl-sec-list-item--markerless-block wl-nav-target" style="${layoutStyle}"><span class="wl-sec-list-item__marker" aria-hidden="true">&bull;</span><span class="wl-sec-list-item__content">${html}</span></div>`;
  }

  function cssAttributeString(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function cssColorValue(value) {
    const color = String(value || "").trim();
    if (!color || /[{};<>]/.test(color) || /[\n\r]/.test(color)) return "";
    return color;
  }

  function applyRootColorVariables(colors) {
    if (!isPlainObject(colors)) return;
    Object.entries(COLOR_VAR_MAP).forEach(([key, varName]) => {
      const value = colors[key];
      if (typeof value === "string" && value.trim()) {
        document.documentElement.style.setProperty(varName, value.trim());
      }
    });
  }

  function buildWikilinkColorCss(wikilinksConfig) {
    const defaultColor = cssColorValue(wikilinksConfig?.default) || FALLBACK_WIKILINKS_CONFIG.default;
    const slateColor = cssColorValue(wikilinksConfig?.slate) || FALLBACK_WIKILINKS_CONFIG.slate;
    return [
      `:root, [data-md-color-scheme="default"] { --knotis-wikilink-color: ${defaultColor}; }`,
      `[data-md-color-scheme="slate"] { --knotis-wikilink-color: ${slateColor}; }`,
    ].join("\n");
  }

  function contentTagColorScheme(contentTagColors, scheme) {
    if (!isPlainObject(contentTagColors)) return {};
    if (isPlainObject(contentTagColors[scheme])) return contentTagColors[scheme];
    return scheme === "default" ? contentTagColors : {};
  }

  function buildContentTagColorBlocks(contentTagColors, selectorPrefix = "") {
    if (!isPlainObject(contentTagColors)) return "";
    const blocks = [];
    Object.entries(contentTagColors).forEach(([tagName, colors]) => {
      if (!isPlainObject(colors)) return;
      const tag = normalizeContentTag(tagName);
      const selector = `${selectorPrefix}.content-tag[data-content-tag="${cssAttributeString(tag)}"]`;
      const hoverSelector = `${selector}:hover, ${selector}:focus-visible`;
      const markSelector = `${selectorPrefix}.content-tag-mark[data-content-tag="${cssAttributeString(tag)}"]`;
      const declarations = [];
      const hoverDeclarations = [];
      const markDeclarations = [];

      if (typeof colors.text === "string" && colors.text.trim()) declarations.push(`color: ${colors.text.trim()};`);
      if (typeof colors.background === "string" && colors.background.trim()) declarations.push(`background-color: ${colors.background.trim()};`);
      if (typeof colors.hover_background === "string" && colors.hover_background.trim()) hoverDeclarations.push(`background-color: ${colors.hover_background.trim()};`);
      if (typeof colors.mark_background === "string" && colors.mark_background.trim()) markDeclarations.push(`background: ${colors.mark_background.trim()};`);
      if (typeof colors.mark_text === "string" && colors.mark_text.trim()) markDeclarations.push(`color: ${colors.mark_text.trim()};`);

      if (declarations.length) blocks.push(`${selector} { ${declarations.join(" ")} }`);
      if (hoverDeclarations.length) blocks.push(`${hoverSelector} { ${hoverDeclarations.join(" ")} }`);
      if (markDeclarations.length) blocks.push(`${markSelector} { ${markDeclarations.join(" ")} }`);
    });
    return blocks.join("\n");
  }

  function buildContentTagColorCss(contentTagColors) {
    const defaultCss = buildContentTagColorBlocks(
      contentTagColorScheme(contentTagColors, "default"),
      ":root ",
    ) + "\n" + buildContentTagColorBlocks(
      contentTagColorScheme(contentTagColors, "default"),
      '[data-md-color-scheme="default"] ',
    );
    const slateCss = buildContentTagColorBlocks(
      contentTagColorScheme(contentTagColors, "slate"),
      '[data-md-color-scheme="slate"] ',
    );
    const blocks = [];
    if (defaultCss.trim()) blocks.push(defaultCss.trim());
    if (slateCss.trim()) blocks.push(slateCss.trim());
    return blocks.join("\n");
  }

  async function applyConfiguredColors() {
    const appearance = await getResolvedAppearanceConfig();
    const wikilinksConfig = await getResolvedWikilinksConfig();
    applyRootColorVariables(appearance.colors);

    let wikilinkStyle = document.getElementById("knotis-wikilink-color-overrides");
    if (!wikilinkStyle) {
      wikilinkStyle = document.createElement("style");
      wikilinkStyle.id = "knotis-wikilink-color-overrides";
      document.head.appendChild(wikilinkStyle);
    }
    wikilinkStyle.textContent = buildWikilinkColorCss(wikilinksConfig);

    let style = document.getElementById("knotis-color-overrides");
    const css = buildContentTagColorCss(appearance.content_tag_colors);
    if (!css) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = "knotis-color-overrides";
      document.head.appendChild(style);
    }
    style.textContent = css;
  }

  

  function getCurrentPageUrl() {
    
    
    const pathname = location.pathname.replace(/\/index\.html$/, "/");
    const rootPath = getSiteRootPath().replace(/\/$/, "");
    const stripped = pathname.replace(/^\//, "");
    const strippedRoot = rootPath.replace(/^\//, "");
    const fallback = strippedRoot && stripped.startsWith(strippedRoot + "/")
      ? stripped.slice(strippedRoot.length + 1)
      : stripped;
    if (!wikilinkData && !contentTagData) return fallback;
    const knownUrls = new Set(
      [
        ...Object.values(wikilinkData || {}).flat(),
        ...Object.values(contentTagData || {}).flat(),
      ].map((e) => e.page_url)
    );
    let best = null;
    for (const url of knownUrls) {
      if (pathname.endsWith("/" + url) || pathname === "/" + url) {
        if (!best || url.length > best.length) best = url;
      }
    }
    return best || fallback;
  }

  function getSiteRootPath() {
    const assetPath = new URL(GRAPH_JSON_URL, location.href).pathname;
    return assetPath.replace(/assets\/(?:knotis\/)?graph\.json$/, "");
  }

  function getSiteGraphPageUrl(graph = null) {
    const raw = graph?.meta?.knotis?.site_graph?.page_url;
    const pageUrl = typeof raw === "string" ? raw.trim().replace(/^\/+/, "") : "";
    return pageUrl || "graph/";
  }

  function getSiteGraphHref(graph = null) {
    return `${getSiteRootPath()}${getSiteGraphPageUrl(graph)}`;
  }

  function tokenizeSearchQuery(query) {
    return String(query || "")
      .toLowerCase()
      .match(/#[a-z0-9_-]+|[a-z0-9]+(?:[.-][a-z0-9]+)*/g) || [];
  }

  function searchQueryConceptPhrase(query) {
    const terms = tokenizeSearchQuery(query).filter((term) => !term.startsWith("#"));
    return terms.join(" ").trim().replace(/[?!.:;]+$/g, "");
  }

  function keywordToSearchQuery(keyword) {
    if (Array.isArray(keyword)) {
      return keyword.filter((item) => item && !String(item).startsWith("#")).join(" ").trim();
    }
    return String(keyword || "").trim();
  }

  function highlightKeywordForInlineMarkdown(text, keyword, renderOpts = {}) {
    const raw = String(text || "");
    if (imageMarkdownOnly(raw)) {
      return escapeHtml(raw);
    }
    return highlightKeyword(raw, keyword, renderOpts);
  }

  function highlightPlainQueryText(text, query, { plainTextOnly = true } = {}) {
    const raw = String(text || "");
    const phrase = searchQueryConceptPhrase(query);
    if (!phrase) return escapeHtml(raw);

    let re;
    if (phrase.includes(" ")) {
      const escaped = phrase.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&").replace(/\s+/g, "\\s+");
      re = new RegExp(`\\b${escaped}`, "ig");
    } else {
      const escaped = phrase.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
      re = new RegExp(`\\b${escaped}`, "ig");
    }

    const highlightSegment = (segment) => {
      let result = "";
      let last = 0;
      let match;
      while ((match = re.exec(segment)) !== null) {
        result += escapeHtml(segment.slice(last, match.index));
        const matched = match[0];
        result += plainTextOnly
          ? `<mark class="knotis-search-query-mark">${escapeHtml(matched)}</mark>`
          : `<span class="knotis-search-wikilink-match">${escapeHtml(matched)}</span>`;
        last = match.index + matched.length;
      }
      result += escapeHtml(segment.slice(last));
      return result;
    };

    return raw.split(/(:[a-z0-9-]+:)/gi).map((segment) => (
      /^:[a-z0-9-]+:$/i.test(segment) ? escapeHtml(segment) : highlightSegment(segment)
    )).join("");
  }

  function highlightSearchTerms(text, query) {
    return highlightPlainQueryText(text, query, { plainTextOnly: true });
  }

  function highlightWikilinkLabelPartial(label, query) {
    const raw = String(label || "");
    const phrase = searchQueryConceptPhrase(query);
    if (!phrase) return escapeHtml(raw);
    const escaped = phrase.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`\\b${escaped}`, "ig");
    let result = "";
    let last = 0;
    let match;
    while ((match = re.exec(raw)) !== null) {
      result += escapeHtml(raw.slice(last, match.index));
      result += `<mark class="knotis-search-query-mark">${escapeHtml(match[0])}</mark>`;
      last = match.index + match[0].length;
    }
    result += escapeHtml(raw.slice(last));
    return result;
  }

  function escapePlainTextSegment(text, renderOpts = {}, keyword) {
    const slice = String(text || "");
    const query = renderOpts.searchQuery || keywordToSearchQuery(keyword);
    if (query) {
      return highlightPlainQueryText(slice, query, { plainTextOnly: true });
    }
    return escapeHtml(slice);
  }

  function parseCodeAnnotationLabels(lines) {
    const labels = [];
    lines.forEach((line) => {
      const match = line.match(/#\s*\((\d+)\)!/);
      if (match) labels.push(match[1]);
    });
    return labels;
  }

  function renderPaneCodeBlock(lines, lang, navSource, fenceInfo = "") {
    const annotationLabels = parseCodeAnnotationLabels(lines);
    const highlightLines = highlightLineKeyFromFenceInfo(fenceInfo, lines.length);
    const codeRows = lines.map((line, index) => {
      const lineNumber = index + 1;
      return `<span class="wl-sec-code__line" data-line-number="${lineNumber}">
        <span class="wl-sec-code__line-number" aria-hidden="true">${lineNumber}</span>
        <span class="wl-sec-code__line-text">${escapeHtml(line)}</span>
      </span>`;
    }).join("");

    const languageLabel = lang && lang !== "text"
      ? escapeHtml(lang)
      : "code";

    return `
      <div class="wl-sec-code-block wl-nav-target" data-wl-code="${escapeHtml(lines.join("\n"))}" data-wl-highlight-lines="${highlightLines}"${navTargetData(navSource)}>
        <div class="wl-sec-code__toolbar">
          <span class="wl-sec-code__lang">${languageLabel}</span>
          <button class="wl-sec-code__copy" type="button" aria-label="Copy code" title="Copy code">Copy</button>
        </div>
        <div class="wl-sec-code__body">
          <code class="wl-sec-code language-${escapeHtml(lang)}"${annotationLabels.length ? ` data-wl-annotations="${annotationLabels.join(",")}"` : ""}>${codeRows}</code>
        </div>
      </div>`;
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function" && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    try {
      textarea.select();
      const copied = document.execCommand("copy");
      if (!copied) throw new Error("Copy command was rejected");
    } finally {
      textarea.remove();
    }
  }

  function normalizePathname(pathname) {
    return (pathname || "").replace(/\/index\.html$/, "/");
  }

  function normalizeComparableText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function textForNavigation(raw) {
    return (raw || "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)(?:\s*\{[^}]*\})?/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\+\+([^<>\n]+?)\+\+/g, "$1")
      .replace(MARK_SYNTAX_RE, "$1")
      .replace(/[*_`~]+/g, "")
      .replace(/:([a-z0-9-]+):/gi, "$1")
      .replace(/\|/g, " ")
      .trim();
  }

  function navTargetData(rawText) {
    const navText = normalizeComparableText(textForNavigation(rawText));
    return navText ? ` data-nav-text="${escapeHtml(navText)}"` : "";
  }

  function highlightBlockTarget(anchorEl) {
    if (!anchorEl) return false;
    const blockTags = new Set(["LI","P","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","TR","PRE"]);
    let blockEl = blockTags.has(anchorEl.tagName) ? anchorEl : anchorEl.parentElement;
    while (blockEl && !blockTags.has(blockEl.tagName)) blockEl = blockEl.parentElement;
    if (blockEl && blockEl.tagName === "LI" && blockEl.parentElement) {
      const parentList = blockEl.parentElement;
      if ((parentList.tagName === "UL" || parentList.tagName === "OL") && parentList.parentElement?.tagName === "LI") {
        blockEl = parentList.parentElement;
      }
    }
    const target = (blockEl && blockTags.has(blockEl.tagName)) ? blockEl : anchorEl;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("wikilink--block-highlighted");
    setTimeout(() => target.classList.remove("wikilink--block-highlighted"), 2000);
    return true;
  }

  function sectionElementsFromHash(hashValue = location.hash) {
    const raw = String(hashValue || "").replace(/^#/, "");
    if (!raw) return null;
    let heading = null;
    try {
      heading = document.getElementById(decodeURIComponent(raw));
    } catch {
      heading = document.getElementById(raw);
    }
    if (!heading) return null;
    if (!/^H[1-6]$/i.test(heading.tagName)) return [heading];
    const level = Number.parseInt(heading.tagName.slice(1), 10);
    const nodes = [heading];
    let sibling = heading.nextElementSibling;
    while (sibling) {
      if (/^H[1-6]$/i.test(sibling.tagName)) {
        const siblingLevel = Number.parseInt(sibling.tagName.slice(1), 10);
        if (siblingLevel <= level) break;
      }
      nodes.push(sibling);
      sibling = sibling.nextElementSibling;
    }
    return nodes;
  }

  function sectionScopeFromHash(hashValue = location.hash) {
    return sectionElementsFromHash(hashValue);
  }

  function collectContextBlockCandidates(root) {
    const selector = "li, p, h1, h2, h3, h4, h5, h6, blockquote, tr, pre, .wl-sec-list-item, .wl-sec-prose, .wl-sec-h";
    if (!root) return [];
    if (root instanceof DocumentFragment) return [];
    if (Array.isArray(root)) {
      const seen = new Set();
      const candidates = [];
      root.forEach((node) => {
        if (!(node instanceof Element)) return;
        if (node.matches(selector) && !seen.has(node)) {
          seen.add(node);
          candidates.push(node);
        }
        node.querySelectorAll(selector).forEach((el) => {
          if (!seen.has(el)) {
            seen.add(el);
            candidates.push(el);
          }
        });
      });
      return candidates;
    }
    if (root.matches?.(selector)) {
      return [root, ...root.querySelectorAll(selector)];
    }
    return [...root.querySelectorAll(selector)];
  }

  function findBestContextBlock(targetText, scopeRoot = null) {
    const normalizedTarget = normalizeComparableText(targetText);
    if (!normalizedTarget) return null;
    const content =
      document.querySelector(".md-content__inner") ||
      document.querySelector("article.md-typeset") ||
      document.querySelector("article") ||
      document.querySelector(".md-content") ||
      document.querySelector("main") ||
      document.body;
    const candidates = collectContextBlockCandidates(scopeRoot || content);
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;
    candidates.forEach((el) => {
      const normalizedCandidate = normalizeComparableText(el.textContent || "");
      if (!normalizedCandidate || !normalizedCandidate.includes(normalizedTarget)) return;
      const score = normalizedCandidate.length - normalizedTarget.length;
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    });
    return best;
  }

  function scrollToHashAnchor(hashValue = location.hash) {
    const nodes = sectionElementsFromHash(hashValue);
    if (!nodes?.length) return false;
    return highlightBlockTarget(nodes[0]);
  }

  function scrollToContextTarget(targetText, options = {}) {
    const hashValue = options.hash || location.hash;
    const scopedNodes = hashValue ? sectionElementsFromHash(hashValue) : null;
    if (scopedNodes?.length && targetText) {
      const scopedMatch = findBestContextBlock(targetText, scopedNodes);
      if (scopedMatch) return highlightBlockTarget(scopedMatch);
    }
    if (targetText) {
      const match = findBestContextBlock(targetText);
      if (match) return highlightBlockTarget(match);
    }
    if (hashValue && scrollToHashAnchor(hashValue)) return true;
    return false;
  }

  function matchingPageConcepts(keyword) {
    const normalizedKeyword = normalizeComparableText(keyword);
    if (!normalizedKeyword) return [];
    const content =
      document.querySelector(".md-content__inner") ||
      document.querySelector("article.md-typeset") ||
      document.querySelector("article") ||
      document.querySelector(".md-content") ||
      document.querySelector("main") ||
      document.body;
    return Array.from(content.querySelectorAll(".wikilink[data-keyword]")).filter((el) => {
      const dataKeyword = normalizeComparableText(el.dataset.keyword || "");
      const visibleText = normalizeComparableText(el.textContent || "");
      return dataKeyword === normalizedKeyword || visibleText === normalizedKeyword;
    });
  }

  function candidateClosestToHash(candidates) {
    if (!candidates.length || !location.hash) return candidates[0] || null;
    let anchorEl = null;
    try {
      anchorEl = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    } catch {
      anchorEl = document.getElementById(location.hash.slice(1));
    }
    if (!anchorEl) return candidates[0] || null;
    const section = anchorEl.closest(".heading-flow") || anchorEl.closest("section") || anchorEl.parentElement;
    const sectionMatch = section ? candidates.find((el) => section.contains(el)) : null;
    if (sectionMatch) return sectionMatch;
    return candidates.find((el) => {
      if (anchorEl === el || anchorEl.contains(el)) return true;
      return Boolean(anchorEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    }) || candidates[0] || null;
  }

  function highlightSearchConcept(keyword) {
    const candidates = matchingPageConcepts(keyword);
    const target = candidateClosestToHash(candidates);
    if (!target) return false;
    return highlightBlockTarget(target);
  }

  function consumeSearchHighlightNavigation() {
    let keyword = "";
    let targetText = "";
    try {
      const url = new URL(location.href);
      keyword = url.searchParams.get(SEARCH_HIGHLIGHT_PARAM) || "";
      targetText = url.searchParams.get(SEARCH_TARGET_TEXT_PARAM) || "";
      if (keyword || targetText) {
        url.searchParams.delete(SEARCH_HIGHLIGHT_PARAM);
        url.searchParams.delete(SEARCH_TARGET_TEXT_PARAM);
        history.replaceState(history.state, "", url.href);
      }
    } catch (err) {
      console.warn("[DEBUG] stripping search params from URL failed", err);
    }
    if (!keyword && !targetText) return false;
    setTimeout(() => {
      if (targetText && scrollToContextTarget(targetText)) return;
      if (keyword) highlightSearchConcept(keyword);
    }, 120);
    return true;
  }

  function updatePaneUrlParam(paneState) {
    try {
      const url = new URL(location.href);
      const { type, keyword, content_tag: contentTag, detail } = paneState || {};
      if (type === "keyword" || type === "reference") {
        url.searchParams.set(PANE_URL_PARAM, keyword || "");
      } else if (type === "content_tag") {
        url.searchParams.set(PANE_URL_PARAM, contentTag || "");
      } else if (type === "edge" && detail) {
        url.searchParams.set(PANE_URL_PARAM, "edge:" + JSON.stringify(detail));
      } else {
        url.searchParams.delete(PANE_URL_PARAM);
      }
      history.replaceState(history.state, "", url.href);
    } catch (err) {
      console.warn("[DEBUG] syncing pane state to the URL failed", err);
    }
  }

  async function consumePaneUrlParam() {
    try {
      const url = new URL(location.href);
      const value = url.searchParams.get(PANE_URL_PARAM);
      if (!value) return false;
      if (value.startsWith("edge:")) {
        const detail = JSON.parse(value.slice(5));
        await openEdgePane(detail, { skipFocus: true });
      } else if (value.startsWith("#")) {
        await openContentTagPane(value, { skipFocus: true });
      } else {
        await openPane(value, { skipFocus: true });
      }
      return true;
    } catch (err) {
      console.warn("[DEBUG] reopening pane from URL param failed", err);
    }
    return false;
  }

  function cloneSerializable(value) {
    if (value == null) return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }

  function sanitizePaneOpts(opts = {}, { includeGraph = false, includeFocus = false } = {}) {
    const clean = {};
    if (opts.contextScope) clean.contextScope = String(opts.contextScope);
    if (includeGraph) {
      const graphSource = normalizeGraphSource(opts.graphSource || graphSourceFromLegacy(opts));
      if (graphSource) clean.graphSource = graphSource;
    }
    if (includeFocus) {
      if (opts.focusPageUrl) clean.focusPageUrl = String(opts.focusPageUrl);
      if (opts.focusOccurrenceIndex != null && opts.focusOccurrenceIndex !== "") {
        const index = Number.parseInt(opts.focusOccurrenceIndex, 10);
        if (!Number.isNaN(index)) clean.focusOccurrenceIndex = index;
      }
    }
    return clean;
  }

  function resolvePaneOpenOpts(opts = {}) {
    return {
      ...opts,
      contextScope: opts.contextScope || "all_pages",
    };
  }

  function resolveContentTagPaneOpenOpts(opts = {}) {
    const contextScope = opts.contextScope || "current_page_first";
    const parsedIndex = Number.parseInt(opts.focusOccurrenceIndex, 10);
    const hasFocusIndex = !Number.isNaN(parsedIndex);
    const currentPageUrl = getCurrentPageUrl();
    let focusPageUrl = opts.focusPageUrl || "";
    if (!focusPageUrl && contextScope === "current_page_first" && currentPageUrl) {
      focusPageUrl = currentPageUrl;
    }
    const next = {
      ...opts,
      contextScope,
    };
    if (focusPageUrl) next.focusPageUrl = focusPageUrl;
    if (hasFocusIndex) next.focusOccurrenceIndex = parsedIndex;
    return next;
  }

  function sanitizePaneState(state) {
    if (!isPlainObject(state) || !state.type) return null;
    const type = String(state.type);
    if (type === "keyword" && state.keyword) {
      return {
        type,
        keyword: String(state.keyword).toLowerCase(),
        opts: sanitizePaneOpts(state.opts || {}, { includeGraph: true, includeFocus: true }),
      };
    }
    if (type === "reference" && state.keyword) {
      return {
        type,
        keyword: String(state.keyword).toLowerCase(),
        opts: sanitizePaneOpts(state.opts || {}, { includeGraph: true, includeFocus: true }),
      };
    }
    if (type === "content_tag" && state.content_tag) {
      return {
        type,
        content_tag: normalizeContentTag(state.content_tag),
        opts: sanitizePaneOpts(state.opts || {}, { includeFocus: true }),
      };
    }
    if (type === "edge" && state.detail) {
      return {
        type,
        detail: cloneSerializable(state.detail),
        opts: sanitizePaneOpts(state.opts || {}),
      };
    }
    return null;
  }

  function normalizePaneHistory(raw) {
    const history = isPlainObject(raw) ? raw : {};
    const entries = Array.isArray(history.entries)
      ? history.entries.map((entry) => sanitizePaneState(entry)).filter(Boolean)
      : [];
    let index = Number.isInteger(history.index) ? history.index : entries.length - 1;
    if (!entries.length) index = -1;
    else index = Math.max(0, Math.min(index, entries.length - 1));
    return { entries, index };
  }

  

  function loadPaneHistory() {
    if (paneHistoryLoaded) return paneHistoryState;
    paneHistoryLoaded = true;
    try {
      paneHistoryState = normalizePaneHistory(JSON.parse(sessionStorage.getItem(PANE_HISTORY_KEY) || "null"));
    } catch (err) {
      console.warn("[DEBUG] pane history in sessionStorage is corrupt; resetting", err);
      try { sessionStorage.removeItem(PANE_HISTORY_KEY); } catch (removeErr) {
        console.warn("[DEBUG] clearing corrupt pane history failed", removeErr);
      }
      paneHistoryState = { entries: [], index: -1 };
    }
    return paneHistoryState;
  }

  function savePaneHistory() {
    try {
      sessionStorage.setItem(PANE_HISTORY_KEY, JSON.stringify({
        ...paneHistoryState,
        ts: Date.now(),
      }));
    } catch (err) {
      console.warn("[DEBUG] saving pane history to sessionStorage failed", err);
    }
  }

  function getActivePaneHistoryState() {
    const history = loadPaneHistory();
    return history.entries[history.index] || null;
  }

  function paneStatesEqual(a, b) {
    return JSON.stringify(a || null) === JSON.stringify(b || null);
  }

  function recordPaneHistory(state, mode = "push") {
    const entry = sanitizePaneState(state);
    if (!entry) return;
    const history = loadPaneHistory();
    if (mode === "skip") return;
    if (mode === "replace" && history.index >= 0) {
      history.entries[history.index] = entry;
      savePaneHistory();
      return;
    }
    const current = history.entries[history.index] || null;
    if (paneStatesEqual(current, entry)) {
      history.entries[history.index] = entry;
      savePaneHistory();
      return;
    }
    history.entries = history.entries.slice(0, history.index + 1);
    history.entries.push(entry);
    history.index = history.entries.length - 1;
    savePaneHistory();
  }

  function canNavigatePaneHistory(delta) {
    const history = loadPaneHistory();
    const nextIndex = history.index + delta;
    return nextIndex >= 0 && nextIndex < history.entries.length;
  }

  function getPaneHistorySnapshot() {
    const history = loadPaneHistory();
    return {
      entries: history.entries.map((entry) => cloneSerializable(entry)).filter(Boolean),
      index: history.index,
    };
  }

  async function replayPaneState(state, opts = {}) {
    const entry = sanitizePaneState(state);
    if (!entry) return false;
    const openOpts = { ...(entry.opts || {}), ...(opts || {}), historyMode: "skip" };
    if (entry.type === "keyword") {
      await openPane(entry.keyword, openOpts);
      return true;
    }
    if (entry.type === "reference") {
      await openReferencePane(entry.keyword, openOpts);
      return true;
    }
    if (entry.type === "content_tag") {
      await openContentTagPane(entry.content_tag, openOpts);
      return true;
    }
    if (entry.type === "edge") {
      await openEdgePane(entry.detail, openOpts);
      return true;
    }
    return false;
  }

  async function navigatePaneHistory(delta) {
    const history = loadPaneHistory();
    const nextIndex = history.index + delta;
    if (nextIndex < 0 || nextIndex >= history.entries.length) return;
    history.index = nextIndex;
    savePaneHistory();
    await replayPaneState(history.entries[nextIndex]);
  }

  function buildPaneHistoryControls() {
    loadPaneHistory();
    const canGoBack = canNavigatePaneHistory(-1);
    const canGoForward = canNavigatePaneHistory(1);
    const backDisabled = canGoBack ? "" : ' disabled aria-disabled="true"';
    const forwardDisabled = canGoForward ? "" : ' disabled aria-disabled="true"';
    return `<div class="wikilink-pane__history" role="group" aria-label="Pane history">
      <button class="wikilink-pane__nav-btn wikilink-pane__nav-btn--back" type="button" aria-label="Back"${backDisabled}>
        <span aria-hidden="true">&#8592;</span>
      </button>
      <button class="wikilink-pane__nav-btn wikilink-pane__nav-btn--forward" type="button" aria-label="Forward"${forwardDisabled}>
        <span aria-hidden="true">&#8594;</span>
      </button>
    </div>`;
  }

  function getGraphReturnMeta(source) {
    const graphSource = normalizeGraphSource(source);
    if (!graphSource) return null;
    if (graphSource.type === "site") {
      return { label: "Back to site graph", tabLabel: "Site graph", icon: SITE_GRAPH_ICON_SVG, source: graphSource };
    }
    if (graphSource.type === "concept") {
      return { label: "Back to concept graph", tabLabel: "Concept graph", icon: SHARE2_ICON_SVG, source: graphSource };
    }
    return { label: "Back to page graph", tabLabel: "Page graph", icon: PAGE_GRAPH_ICON_SVG, source: graphSource };
  }

  function buildGraphReturnButton(source, paneConfig = FALLBACK_PANE_CONFIG) {
    if (paneConfig.show_graph_return_button === false) return "";
    const meta = getGraphReturnMeta(source);
    if (!meta) return "";
    const keywordAttr = meta.source.keyword ? ` data-keyword="${escapeHtml(meta.source.keyword)}"` : "";
    const pageAttr = meta.source.pageUrl ? ` data-page-url="${escapeHtml(meta.source.pageUrl)}"` : "";
    return `<button class="wikilink-pane__graph-return wikilink-pane__graph-return--${escapeHtml(meta.source.type)}" type="button" data-graph-type="${escapeHtml(meta.source.type)}"${keywordAttr}${pageAttr}>
      <span class="wikilink-pane__graph-return-icon" aria-hidden="true">${meta.icon}</span>
      <span>${escapeHtml(meta.label)}</span>
    </button>`;
  }

  function buildPaneHeader(title, metaRow = "", opts = {}) {
    const titleClass = opts.titleClass
      ? `wikilink-pane__title ${opts.titleClass}`
      : "wikilink-pane__title";
    const historyHtml = opts.showHistoryControls === false ? "" : buildPaneHistoryControls();
    const visibleMetaRow = opts.showMetaBadges === false ? "" : metaRow;
    const graphReturnHtml = opts.graphReturnHtml || "";
    return `<div class="wikilink-pane__header">
      <div class="wikilink-pane__header-main">
        ${historyHtml}
        <div class="wikilink-pane__heading">
          <span class="${titleClass}">${escapeHtml(title)}</span>
          ${visibleMetaRow}
          ${graphReturnHtml}
        </div>
      </div>
      <div class="wikilink-pane__header-actions">
        <button class="wikilink-pane__copy-link" aria-label="Copy link to this pane" title="Copy link">${LINK_ICON_SVG}</button>
        <button class="wikilink-pane__close" aria-label="Close backlinks pane">&times;</button>
      </div>
    </div>`;
  }

  function setPendingContextNavigation(href, targetText) {
    if (!href || !targetText) return;
    try {
      const url = new URL(href, location.href);
      sessionStorage.setItem(PENDING_CONTEXT_NAV_KEY, JSON.stringify({
        pathname: normalizePathname(url.pathname),
        hash: url.hash || "",
        targetText: normalizeComparableText(targetText),
        ts: Date.now(),
      }));
    } catch (err) {
      console.warn("[DEBUG] saving pending context navigation failed", err);
    }
  }

  function setPendingPaneRestore(state) {
    if (!state) return;
    try {
      sessionStorage.setItem(PENDING_PANE_RESTORE_KEY, JSON.stringify({
        ...state,
        ts: Date.now(),
      }));
    } catch (err) {
      console.warn("[DEBUG] saving pending pane restore failed", err);
    }
  }

  function setPendingPaneRestoreFromHistory() {
    const history = getPaneHistorySnapshot();
    if (!history.entries.length || history.index < 0) return;
    setPendingPaneRestore({ history });
  }

  function shouldPersistPaneAcrossHref(href) {
    if (!href) return false;
    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin;
    } catch {
      return false;
    }
  }

  async function consumePendingPaneRestore() {
    try {
      const raw = sessionStorage.getItem(PENDING_PANE_RESTORE_KEY);
      if (!raw) return false;
      sessionStorage.removeItem(PENDING_PANE_RESTORE_KEY);
      const pending = JSON.parse(raw);
      if (pending?.history) {
        paneHistoryState = normalizePaneHistory(pending.history);
        paneHistoryLoaded = true;
        savePaneHistory();
      }
      const state = sanitizePaneState(pending) || getActivePaneHistoryState();
      if (!state) return false;
      return replayPaneState(state, { skipFocus: true });
    } catch (err) {
      console.warn("[DEBUG] restoring pane state failed", err);
    }
    return false;
  }

  function consumePendingContextNavigation() {
    try {
      const raw = sessionStorage.getItem(PENDING_CONTEXT_NAV_KEY);
      if (!raw) return false;
      const pending = JSON.parse(raw);
      sessionStorage.removeItem(PENDING_CONTEXT_NAV_KEY);
      if (!pending?.pathname || !pending?.targetText) return false;
      if (normalizePathname(location.pathname) !== pending.pathname) return false;
      if (pending.hash && location.hash !== pending.hash) {
        try {
          const url = new URL(location.href);
          url.hash = pending.hash;
          history.replaceState(history.state, "", url.href);
        } catch (err) {
          console.warn("[DEBUG] applying pending navigation hash failed", err);
        }
      }
      return scrollToContextTarget(pending.targetText, { hash: pending.hash || location.hash });
    } catch {
      return false;
    }
  }

  function highlightKeyword(text, keyword, renderOpts = {}) {
    
    
    
    
    
    const inlineCode = protectInlineCodeSpans(String(text || ""), { escapeContent: true });
    text = inlineCode.html;
    const kwSet = new Set(
      (Array.isArray(keyword) ? keyword : [keyword])
        .filter(Boolean)
        .filter((k) => !String(k).startsWith("#"))
        .map((k) => k.toLowerCase())
    );
    const tagSet = new Set(
      (Array.isArray(keyword) ? keyword : [keyword])
        .filter(Boolean)
        .filter((k) => String(k).startsWith("#"))
        .map((k) => normalizeContentTag(k))
    );
    const tokenRe = /\[\[([^\]]+)\]\]|(?<![\w/&(\[])#([A-Za-z][A-Za-z0-9_-]{0,48})\b/g;
    let result    = "";
    let lastIndex = 0;
    let m;

    while ((m = tokenRe.exec(text)) !== null) {
      
      result += escapePlainTextSegment(text.slice(lastIndex, m.index), renderOpts, keyword);

      if (m[1]) {
        if (!isValidWikilinkRaw(m[1])) {
          result += escapeHtml(m[0]);
        } else {
          const { keyword: kwNorm, label, mode } = parseWikilinkParts(m[1]);
          const focusAttrs = inlineFocusDataAttrs(renderOpts);
          const partialLabelHtml = renderOpts.searchQuery
            ? highlightWikilinkLabelPartial(label, renderOpts.searchQuery)
            : escapeHtml(label);
          if (kwSet.has(kwNorm)) {
            const selfNavIndex = renderOpts.selfNavOccurrenceIndex;
            const currentIndex = renderOpts.focusOccurrenceIndex;
            if (selfNavIndex != null && String(selfNavIndex) !== String(currentIndex ?? "")) {
              const pageUrl = renderOpts.focusPageUrl || "";
              result += `<span class="wikilink wikilink--inline" data-keyword="${escapeHtml(kwNorm)}" data-occurrence-index="${escapeHtml(String(selfNavIndex))}"${pageUrl ? ` data-focus-page-url="${escapeHtml(pageUrl)}"` : ""}${focusAttrs} role="button" tabindex="0">${escapeHtml(label)}</span>`;
            } else {
              result += `<span class="wikilink wikilink--inline knotis-search-wikilink-match" data-keyword="${escapeHtml(kwNorm)}"${focusAttrs} role="button" tabindex="0">${escapeHtml(label)}</span>`;
            }
          } else if (mode === "reference") {
            result += `<span class="wikilink wikilink--inline" data-keyword="${escapeHtml(kwNorm)}" data-wikilink-mode="reference"${focusAttrs} role="button" tabindex="0">${partialLabelHtml}</span>`;
          } else {
            result += `<span class="wikilink wikilink--inline" data-keyword="${escapeHtml(kwNorm)}"${focusAttrs} role="button" tabindex="0">${partialLabelHtml}</span>`;
          }
        }
      } else if (m[2]) {
        const tagNorm = normalizeContentTag(m[2]);
        if (isCssHexColorToken(tagNorm)) {
          result += escapeHtml(m[0]);
        } else if (tagSet.has(tagNorm)) {
          result += `<mark class="content-tag-mark" data-content-tag="${escapeHtml(tagNorm)}">${escapeHtml(tagNorm)}</mark>`;
        } else {
          result += `<span class="content-tag content-tag--inline" data-content-tag="${escapeHtml(tagNorm)}"${inlineFocusDataAttrs(renderOpts)} role="button" tabindex="0">${escapeHtml(tagNorm)}</span>`;
        }
      }
      lastIndex = m.index + m[0].length;
    }

    
    result += escapePlainTextSegment(text.slice(lastIndex), renderOpts, keyword);
    return restoreProtectedInlineCodeSpans(result, inlineCode.protectedBlocks);
  }

  function renderExtendedContext(text, keyword, renderOpts = {}) {
    
    
    return text
      .split("\n")
      .filter((l) => l !== "")
      .map((line) => {
        const isChild = line.startsWith("  ");
        const content = isChild ? line.slice(2) : line;
        let html = highlightKeyword(content, keyword, renderOpts);
        html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        const indentAttr = isChild ? ' style="padding-left:1.2em"' : "";
        return `<span class="wikilink-card__ext-line"${indentAttr}>${html}</span>`;
      })
      .join("");
  }

  function stripListPrefix(line) {
    return line.trim().replace(/^(?:[-*+]|\d+\.)\s+/, "");
  }

  function stripBlockListPrefix(line) {
    return String(line || "").replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1");
  }

  function blockLineIndent(line) {
    return (stripBlockListPrefix(line).match(/^(\s*)/)?.[1] || "").length;
  }

  function blockListBaseIndent(lines) {
    const indents = (Array.isArray(lines) ? lines : [])
      .filter((line) => String(line || "").trim())
      .map((line) => blockLineIndent(line));
    return indents.length ? Math.min(...indents) : 0;
  }

  function paneListIndentBase(renderOpts = {}) {
    return Number.isInteger(renderOpts.listIndentBase) ? renderOpts.listIndentBase : 0;
  }

  function findPaneListParentLineIndex(lines, index) {
    if (index < 0 || index >= lines.length || !lineHasListMarker(lines[index])) return -1;
    const targetIndent = blockLineIndent(lines[index]);
    for (let i = index - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.trim() || !lineHasListMarker(line)) continue;
      const indent = blockLineIndent(line);
      if (indent < targetIndent) return i;
    }
    return -1;
  }

  function isListPrefixedBlockOpenerLine(line) {
    return Boolean(parseAdmonitionOpener(line) || parseTabOpener(line));
  }

  function isLineInsideBlockBody(lines, index, blockLineIndex, bodyIndent) {
    if (index <= blockLineIndex) return false;
    if (!lineHasListMarker(lines[index])) {
      return blockLineIndent(lines[index]) >= bodyIndent;
    }
    let cur = index;
    while (cur > blockLineIndex) {
      const parent = findPaneListParentLineIndex(lines, cur);
      if (parent < 0) return blockLineIndent(lines[index]) >= bodyIndent;
      if (parent === blockLineIndex) return true;
      const parentIndent = blockLineIndent(lines[parent]);
      if (parentIndent < bodyIndent) return false;
      cur = parent;
    }
    return blockLineIndent(lines[index]) >= bodyIndent;
  }

  function findEnclosingBodyContext(lines, index) {
    for (let i = index - 1; i >= 0; i--) {
      const trimmed = (lines[i] || "").trim();
      if (!trimmed) continue;
      if (/^#{1,6}\s+/.test(trimmed)) {
        const blockStart = i + 1;
        const indents = [];
        for (let j = blockStart; j < index; j++) {
          if (!lineHasListMarker(lines[j])) continue;
          if (parseAdmonitionOpener(lines[j]) || parseTabOpener(lines[j])) continue;
          indents.push(blockLineIndent(lines[j]));
        }
        return {
          blockStart,
          listIndentBase: indents.length ? Math.min(...indents) : 0,
          admonition: null,
          tab: null,
        };
      }
      const admonition = parseAdmonitionOpener(lines[i]);
      if (admonition) {
        const bodyIndent = admonition.indent + 4;
        if (isLineInsideBlockBody(lines, index, i, bodyIndent)) {
          return { blockStart: i, listIndentBase: bodyIndent, admonition, tab: null };
        }
        continue;
      }
      const tab = parseTabOpener(lines[i]);
      if (tab) {
        const bodyIndent = tab.indent + 4;
        if (isLineInsideBlockBody(lines, index, i, bodyIndent)) {
          return { blockStart: i, listIndentBase: bodyIndent, admonition: null, tab };
        }
      }
    }
    const indents = [];
    for (let j = 0; j < index; j++) {
      if (!lineHasListMarker(lines[j])) continue;
      if (parseAdmonitionOpener(lines[j]) || parseTabOpener(lines[j])) continue;
      indents.push(blockLineIndent(lines[j]));
    }
    return {
      blockStart: 0,
      listIndentBase: indents.length ? Math.min(...indents) : 0,
      admonition: null,
      tab: null,
    };
  }

  function enclosingListIndentBase(lines, index) {
    const ctx = findEnclosingBodyContext(lines, index);
    if (ctx.admonition || ctx.tab) return ctx.listIndentBase;
    if (!lineHasListMarker(lines[index])) return 0;
    let minIndent = blockLineIndent(lines[index]);
    let cur = index;
    while (true) {
      const parent = findPaneListParentLineIndex(lines, cur);
      if (parent < 0) break;
      minIndent = Math.min(minIndent, blockLineIndent(lines[parent]));
      cur = parent;
    }
    return minIndent;
  }

  function paneLineRenderOpts(renderOpts, lineIndex) {
    if (renderOpts._lockListIndentBase) return renderOpts;
    const sourceLines = renderOpts.sourceLines;
    if (!Array.isArray(sourceLines) || !Number.isInteger(lineIndex)) return renderOpts;
    return {
      ...renderOpts,
      listIndentBase: listIndentBaseForListLine(sourceLines, lineIndex, renderOpts),
    };
  }

  function edgeSectionRenderOpts(lines, startIndex, endIndex, sectionRenderOpts, paneConfig = FALLBACK_PANE_CONFIG) {
    const opts = {
      ...sectionRenderOpts,
      sourceLines: lines,
      baseLineIndex: startIndex,
    };
    const lineCount = Math.max(0, endIndex - startIndex);
    const startLine = lines[startIndex] || "";
    if (
      lineCount <= 1
      && lineHasListMarker(startLine)
      && blockLineIndent(startLine) > 0
      && (paneConfig.edge_context_mode || FALLBACK_PANE_CONFIG.edge_context_mode) === "compact"
    ) {
      opts.listIndentBase = blockLineIndent(startLine);
    }
    return opts;
  }

  function isSlideBreakLine(line) {
    const trimmed = (line || "").trim();
    return isHtmlCommentLine(trimmed) && trimmed.includes("slide-break");
  }

  function isTopLevelSectionListLine(lines, index) {
    if (!lineHasListMarker(lines[index])) return false;
    return blockLineIndent(lines[index]) === 0 && findPaneListParentLineIndex(lines, index) < 0;
  }

  function hasNestedListContentBetween(lines, start, end) {
    for (let j = start; j < end; j++) {
      if (!lineHasListMarker(lines[j])) continue;
      if (!isTopLevelSectionListLine(lines, j)) return true;
    }
    return false;
  }

  function listFragmentHasOpenLists(html) {
    const body = String(html || "");
    const openUl = (body.match(/<ul[\s>]/gi) || []).length;
    const closeUl = (body.match(/<\/ul>/gi) || []).length;
    const openOl = (body.match(/<ol[\s>]/gi) || []).length;
    const closeOl = (body.match(/<\/ol>/gi) || []).length;
    return openUl > closeUl || openOl > closeOl;
  }

  function splitAppendRangeAtBoundaries(lines, range) {
    const end = range.end;
    const parts = [];
    let start = range.start;

    for (let i = range.start; i < end; i++) {
      if (isSlideBreakLine(lines[i])) {
        if (start < i) parts.push({ start, end: i });
        start = i + 1;
        continue;
      }
      if (i > start && isTopLevelSectionListLine(lines, i)) {
        const continuesFromBefore = sectionContinuesInsideList(lines, start);
        const hasNestedInPart = hasNestedListContentBetween(lines, start, i);
        if (continuesFromBefore || hasNestedInPart) {
          if (start < i) parts.push({ start, end: i });
          start = i;
        }
      }
    }

    if (start < end) parts.push({ start, end });
    return parts.length ? parts : [{ start: range.start, end: range.end }];
  }

  function sectionContinuesInsideList(lines, endIndex) {
    if (!Array.isArray(lines) || endIndex >= lines.length) return false;
    for (let i = endIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      if (isHtmlCommentLine(line.trim())) continue;
      if (/^#{1,6}\s+/.test(line.trim())) return false;
      if (lineHasListMarker(line)) {
        const parent = findPaneListParentLineIndex(lines, i);
        if (parent >= 0 && parent < endIndex) return true;
      }
      return false;
    }
    return false;
  }

  function shouldLeaveListsOpen(lines, endIndex, sectionEnd) {
    if (endIndex >= sectionEnd) return false;
    if (!sectionContinuesInsideList(lines, endIndex)) return false;
    let endContext = null;
    for (let i = endIndex - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.trim() || isHtmlCommentLine(line.trim())) continue;
      if (lineHasListMarker(line)) {
        endContext = findEnclosingBodyContext(lines, i);
        break;
      }
    }
    for (let i = endIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;
      if (isHtmlCommentLine(line.trim())) continue;
      if (/^#{1,6}\s+/.test(line.trim())) return false;
      if (!lineHasListMarker(line)) continue;
      if (endContext) {
        const nextContext = findEnclosingBodyContext(lines, i);
        const endAdmonition = endContext.admonition;
        const nextAdmonition = nextContext.admonition;
        if (Boolean(endAdmonition) !== Boolean(nextAdmonition)) return false;
        if (endAdmonition && nextAdmonition && endAdmonition.title !== nextAdmonition.title) return false;
      }
      return true;
    }
    return false;
  }

  function resolveAppendedChunkStart(lines, rangeStart, safeEnd, sectionParts, paneConfig) {
    let safeStart = adjustSectionSliceStart(lines, rangeStart, safeEnd, sectionParts, paneConfig);
    while (safeStart < safeEnd) {
      const trimmed = (lines[safeStart] || "").trim();
      if (!trimmed || isHtmlCommentLine(trimmed)) {
        safeStart++;
        continue;
      }
      break;
    }
    if (safeStart >= safeEnd || !lineHasListMarker(lines[safeStart])) {
      return { safeStart, parentAlreadyRendered: false };
    }
    let parentIdx = findPaneListParentLineIndex(lines, safeStart);
    if (parentIdx >= 0 && parentIdx < rangeStart) {
      return { safeStart, parentAlreadyRendered: true };
    }
    while (parentIdx >= 0 && parentIdx < safeStart) {
      safeStart = parentIdx;
      parentIdx = findPaneListParentLineIndex(lines, safeStart);
    }
    return { safeStart, parentAlreadyRendered: false };
  }

  function applyPaneListStackFromIndent(state, indent, tag, renderOpts) {
    const listDepth = paneListDepthFromIndent(indent, renderOpts);
    if (!Array.isArray(state.listDepthStack)) state.listDepthStack = [];
    while (state.listDepthStack.length > listDepth) state.listDepthStack.pop();
    while (state.listDepthStack.length < listDepth) state.listDepthStack.push(tag);
  }

  function replayPaneListStack(lines, beforeIndex, listIndentBase) {
    const state = { listDepthStack: [] };
    const { blockStart } = findEnclosingBodyContext(lines, beforeIndex);
    for (let i = blockStart; i < beforeIndex; i++) {
      const line = lines[i];
      if (!line || !line.trim() || isHtmlCommentLine(line.trim())) continue;
      const lineBase = Array.isArray(lines) ? enclosingListIndentBase(lines, i) : listIndentBase;
      const lineRenderOpts = { listIndentBase: lineBase };
      if (/^(\s*)[-*+]\s+/.test(line)) {
        applyPaneListStackFromIndent(state, blockLineIndent(line), "ul", lineRenderOpts);
      } else if (/^(\s*)(\d+)\.\s+/.test(line)) {
        applyPaneListStackFromIndent(state, blockLineIndent(line), "ol", lineRenderOpts);
      }
    }
    return state;
  }

  function findPaneChunkAppendTarget(card, lines, lineIndex) {
    const view = card.querySelector(".wikilink-card__section-view");
    const fallback = view?.querySelector(".heading-flow__content");
    if (!view || !fallback) return null;
    if (!Array.isArray(lines) || !Number.isInteger(lineIndex)) return fallback;
    const { admonition, tab, blockStart } = findEnclosingBodyContext(lines, lineIndex);
    if (admonition) {
      const bodyIndent = admonition.indent + 4;
      if (!isLineInsideBlockBody(lines, lineIndex, blockStart, bodyIndent)) return fallback;
      const title = admonition.title;
      for (const el of view.querySelectorAll(":is(.admonition, details)")) {
        const summary = el.querySelector(":is(.admonition-title, summary)");
        if (summary && summary.textContent.includes(title)) {
          return el;
        }
      }
    }
    if (tab) {
      const bodyIndent = tab.indent + 4;
      if (!isLineInsideBlockBody(lines, lineIndex, blockStart, bodyIndent)) return fallback;
      const title = tab.title;
      for (const el of view.querySelectorAll(".wl-sec-tab-panel")) {
        const titleEl = el.querySelector(".wl-sec-tab-panel__title");
        if (titleEl && titleEl.textContent.includes(title)) {
          return el.querySelector(".wl-sec-tab-panel__body") || fallback;
        }
      }
    }
    return fallback;
  }

  function seedPaneContinuationState(lines, beforeIndex) {
    const listIndentBase = enclosingListIndentBase(lines, beforeIndex);
    const state = seedOrderedState(lines, beforeIndex);
    state.listDepthStack = replayPaneListStack(lines, beforeIndex, listIndentBase).listDepthStack;
    return { state, listIndentBase };
  }

  function paneRelativeIndent(indent, renderOpts = {}) {
    return Math.max(0, (Number(indent) || 0) - paneListIndentBase(renderOpts));
  }

  function imageMarkdownOnly(text) {
    return /^!\[[^\]]*\]\([^)]+\)(?:\{[^}]*\})?\s*$/.test(String(text || "").trim());
  }

  function tableMarkdownOpener(content) {
    return /^\|/.test(String(content || "").trim());
  }

  function markerlessListItemContent(content) {
    return imageMarkdownOnly(content) || tableMarkdownOpener(content);
  }

  function sliceListIndentBase(lines) {
    if (!Array.isArray(lines)) return 0;
    for (const line of lines) {
      if (!String(line || "").trim()) continue;
      return lineHasListMarker(line) ? blockLineIndent(line) : 0;
    }
    return 0;
  }

  function initialSliceRenderOpts(lines, renderOpts = {}) {
    if (Number.isInteger(renderOpts.listIndentBase)) return renderOpts;
    const firstLine = Array.isArray(lines)
      ? lines.find((line) => String(line || "").trim())
      : "";
    const base = sliceListIndentBase(lines);
    if (renderOpts.renderMode === "content_tag" && lineHasListMarker(firstLine)) {
      return { ...renderOpts, listIndentBase: base, _lockListIndentBase: true };
    }
    return base > 0 ? { ...renderOpts, listIndentBase: base } : renderOpts;
  }

  function isOrderedListLine(line) {
    return /^\s*\d+\.\s+/.test(String(line || ""));
  }

  function listIndentBaseForListLine(lines, lineIndex, renderOpts = {}) {
    if (!Array.isArray(lines) || !Number.isInteger(lineIndex) || lineIndex < 0) {
      return paneListIndentBase(renderOpts);
    }
    const line = lines[lineIndex] || "";
    if (!/^(\s*)[-*+]\s+/.test(line)) return paneListIndentBase(renderOpts);
    let parentIdx = lineIndex - 1;
    while (parentIdx >= 0) {
      const parent = lines[parentIdx] || "";
      if (!parent.trim()) {
        parentIdx--;
        continue;
      }
      if (isOrderedListLine(parent)) {
        const parentIndent = blockLineIndent(parent);
        const childIndent = blockLineIndent(line);
        if (childIndent > parentIndent) return parentIndent;
      }
      break;
    }
    return enclosingListIndentBase(lines, lineIndex);
  }

  function skipListIntroWrapperStart(lines, start) {
    if (start < 0 || start >= lines.length) return start;
    const line = lines[start] || "";
    if (!/^(\s*)[-*+]\s+/.test(line)) return start;
    const indent = blockLineIndent(line);
    const body = stripWikilinkMarkup(stripKnotisMetadataAttrs(line.replace(/^(\s*)[-*+]\s+/, ""))).trim();
    if (!/,\s*$/.test(body)) return start;
    let childIndex = start + 1;
    while (childIndex < lines.length && !(lines[childIndex] || "").trim()) childIndex++;
    if (childIndex >= lines.length) return start;
    if (blockLineIndent(lines[childIndex]) <= indent) return start;
    if (/^In\s+/i.test(body) || body.length <= 80) return childIndex;
    return start;
  }

  function renderMarkerlessListItem(line, indent, content, pageUrl, keyword, state, renderOpts, focusAttrs, lineIndex = null) {
    state.annotationPending = false;
    state.annotationDepth = null;
    const html = renderInlineMarkdown(highlightKeywordForInlineMarkdown(content, keyword, renderOpts), pageUrl, renderOpts);
    return renderPaneListItem(state, indent, "ul", content, html, renderOpts, lineIndex);
  }

  function stripSpecialBlockIndent(line, indent) {
    return line.startsWith(" ".repeat(indent)) ? line.slice(indent) : line;
  }

  function parseFence(line) {
    const content = stripListPrefix(line).trimStart();
    const match = content.match(/^(`{3,}|~{3,})(.*)$/);
    if (!match) return null;
    return {
      markerChar: match[1][0],
      info: match[2].trim(),
    };
  }

  function parseAdmonitionOpener(line) {
    const match = stripBlockListPrefix(line).match(/^(\s*)(\?{3}\+?|!{3}\+?)\s+([a-zA-Z0-9_-]+)(?:\s+"([^"]*)")?\s*$/);
    if (!match) return null;
    return {
      indent: match[1].length,
      marker: match[2],
      kind: match[2].startsWith("?") ? "details" : "admonition",
      open: match[2].endsWith("+"),
      type: match[3],
      title: match[4] || match[3],
    };
  }

  function parseTabOpener(line) {
    const match = line.match(/^(\s*)===\+?\s+"([^"]+)"\s*$/);
    if (!match) return null;
    return {
      indent: match[1].length,
      title: match[2].replace(/:([a-z0-9-]+):\s*/gi, "").trim(),
    };
  }

  function trailingAdmonitionChildIndex(lines, startIndex, bodyIndent) {
    const childIndent = bodyIndent + 4;
    let previousIndex = -1;
    let separated = false;

    for (let index = startIndex + 1; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) {
        separated = previousIndex >= 0;
        continue;
      }
      const currentIndent = blockLineIndent(line);
      if (currentIndent < bodyIndent) break;

      const previousIndent = previousIndex >= 0
        ? blockLineIndent(lines[previousIndex])
        : -1;
      const isDeeperChild = currentIndent === childIndent && previousIndent === bodyIndent;
      const isReturnedChild = currentIndent === bodyIndent && previousIndent > bodyIndent;

      if (
        separated
        && (isDeeperChild || isReturnedChild)
        && lineHasListMarker(line)
        && previousIndex >= 0
        && lineHasListMarker(lines[previousIndex])
      ) {
        let isTrailingBlock = true;
        for (let cursor = index; cursor < lines.length; cursor++) {
          const candidate = lines[cursor];
          if (!candidate.trim()) continue;
          const candidateIndent = blockLineIndent(candidate);
          if (candidateIndent < bodyIndent) break;
          if (candidateIndent < currentIndent) {
            isTrailingBlock = false;
            break;
          }
        }
        if (isTrailingBlock) return index;
      }

      previousIndex = index;
      separated = false;
    }
    return -1;
  }

  function collectIndentedBlock(lines, startIndex, indent, options = {}) {
    const bodyLines = [];
    let endIndex = startIndex + 1;
    const trailingChildIndex = options.splitTrailingChild
      ? trailingAdmonitionChildIndex(lines, startIndex, indent)
      : -1;
    while (endIndex < lines.length) {
      if (endIndex === trailingChildIndex) break;
      const line = lines[endIndex];
      if (!line.trim()) {
        bodyLines.push("");
        endIndex++;
        continue;
      }
      const currentIndent = (line.match(/^(\s*)/)?.[1] || "").length;
      if (currentIndent < indent) {
        const previousBodyLine = [...bodyLines].reverse().find((bodyLine) => bodyLine.trim());
        const previousTableLine = previousBodyLine
          ? stripBlockListPrefix(previousBodyLine).trim()
          : "";
        if (previousTableLine.includes("|") && line.trim().includes("|")) {
          bodyLines.push(line.trim());
          endIndex++;
          continue;
        }
      }
      if (currentIndent < indent) break;
      bodyLines.push(stripSpecialBlockIndent(line, indent));
      endIndex++;
    }
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    return { bodyLines, endIndex };
  }

  function activeFenceBefore(lines, limit) {
    let activeMarker = null;
    for (let i = 0; i < limit; i++) {
      const fence = parseFence(lines[i]);
      if (!fence) continue;
      if (!activeMarker) activeMarker = fence.markerChar;
      else if (fence.markerChar === activeMarker) activeMarker = null;
    }
    return activeMarker;
  }

  
  
  
  function extendPastFence(lines, start, end) {
    let activeMarker = activeFenceBefore(lines, start);
    for (let j = start; j < Math.min(end, lines.length); j++) {
      const fence = parseFence(lines[j]);
      if (!fence) continue;
      if (!activeMarker) activeMarker = fence.markerChar;
      else if (fence.markerChar === activeMarker) activeMarker = null;
    }
    if (activeMarker) {
      while (end < lines.length) {
        const fence = parseFence(lines[end]);
        end++;
        if (fence && fence.markerChar === activeMarker) break;
      }
    }
    return end;
  }

  
  
  
  
  
  
  
  function nudgePastFenceSplit(lines, boundary, direction, limit) {
    let pos = boundary;
    while (pos !== limit && activeFenceBefore(lines, pos)) pos += direction;
    return pos;
  }

  function isTableSeparatorLine(trimmed) {
    
    if (!trimmed.includes("|")) return false;
    const cells = trimmed.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
    return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell));
  }

  function parseTableCells(line) {
    return line
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim());
  }

  function parseTableAlignments(separatorLine, columnCount) {
    const rawCells = parseTableCells(separatorLine);
    const alignments = rawCells.map((cell) => {
      const trimmed = cell.trim();
      if (/^:-{2,}:$/.test(trimmed)) return "center";
      if (/^-{2,}:$/.test(trimmed)) return "right";
      if (/^:-{2,}$/.test(trimmed)) return "left";
      return "";
    });

    while (alignments.length < columnCount) alignments.push("");
    return alignments.slice(0, columnCount);
  }

  function renderTableBlock(tableLines, pageUrl, keyword, renderOpts = {}) {
    if (tableLines.length < 2) {
      const emptyState = { orderedCounters: new Map(), annotationPending: false, annotationDepth: null };
      return tableLines.map((line) => renderSectionLine(line, pageUrl, keyword, emptyState, renderOpts)).join("");
    }

    const headerCells = parseTableCells(tableLines[0]);
    const alignments = parseTableAlignments(tableLines[1], headerCells.length);
    const bodyRows = tableLines.slice(2).map(parseTableCells);

    const renderCell = (tag, content, index) => {
      const alignment = alignments[index] || "";
      const alignAttr = alignment ? ` style="text-align:${alignment}"` : "";
      const html = renderInlineMarkdown(highlightKeyword(content || "", keyword, renderOpts), pageUrl, renderOpts);
      return `<${tag} class="wl-sec-table__cell wl-sec-table__cell--${tag}"${alignAttr}>${html}</${tag}>`;
    };

    const thead = `<thead><tr>${headerCells.map((cell, index) => renderCell("th", cell, index)).join("")}</tr></thead>`;
    const tbodyRows = bodyRows.map((row) => {
      const padded = row.slice(0, headerCells.length);
      while (padded.length < headerCells.length) padded.push("");
      return `<tr>${padded.map((cell, index) => renderCell("td", cell, index)).join("")}</tr>`;
    }).join("");
    const tbody = tbodyRows ? `<tbody>${tbodyRows}</tbody>` : "";

    return `<div class="wl-sec-table-wrap"><table class="wl-sec-table">${thead}${tbody}</table></div>`;
  }

  function renderStructuredMarkdown(lines, pageUrl, keyword, initialState = null, renderOpts = {}) {
    const preparedContext = renderOpts.prepareContextStart === false
      ? { lines, skipped: 0 }
      : preparePaneContextLines(lines, renderOpts);
    lines = preparedContext.lines;
    renderOpts = initialSliceRenderOpts(lines, renderOpts);
    let html = "";
    let i = 0;
    const baseLineIndex = (Number.isInteger(renderOpts.baseLineIndex) ? renderOpts.baseLineIndex : 0) + preparedContext.skipped;
    const state = initialState
      ? {
          orderedCounters: new Map(initialState.orderedCounters),
          annotationPending: Boolean(initialState.annotationPending),
          annotationDepth: initialState.annotationDepth ?? null,
          outlineChildPadEm: Array.isArray(initialState.outlineChildPadEm)
            ? [...initialState.outlineChildPadEm]
            : undefined,
          outlineKinds: Array.isArray(initialState.outlineKinds)
            ? [...initialState.outlineKinds]
            : undefined,
          listDepthStack: Array.isArray(initialState.listDepthStack)
            ? [...initialState.listDepthStack]
            : [],
        }
      : { orderedCounters: new Map(), annotationPending: false, annotationDepth: null, listDepthStack: [] };
    if (!Array.isArray(state.outlineChildPadEm)) resetOutlineLayout(state);
    if (!Array.isArray(state.listDepthStack)) state.listDepthStack = [];

    while (i < lines.length) {
      const fence = parseFence(lines[i]);
      if (fence) {
        const fenceOpener = lines[i];
        const fenceStartIndex = i;
        const blockIndent = blockLineIndent(fenceOpener);
        const blockDepth = outlineDepthFromIndent(blockIndent);
        const lang = fence.info.split(/\s+/)[0] || "text";
        const markerChar = fence.markerChar;
        const codeLines = [];
        i++;
        while (i < lines.length) {
          const innerFence = parseFence(lines[i]);
          if (innerFence && innerFence.markerChar === markerChar) { i++; break; }
          codeLines.push(lines[i]);
          i++;
        }
        const nonEmpty = codeLines.filter((l) => l.trim());
        const minIndent = nonEmpty.length
          ? Math.min(...nonEmpty.map((l) => l.match(/^(\s*)/)[1].length))
          : 0;
        const stripped = codeLines.map((l) => l.slice(minIndent));
        const navSource = stripped.find((l) => l.trim()) || "";
        const paneBlockOpts = {
          indent: blockIndent,
          lineBody: stripListPrefix(fenceOpener).trim() || navSource,
          renderOpts,
          lineIndex: baseLineIndex + fenceStartIndex,
          listPrefixed: /^\s*[-*+]\s+/.test(fenceOpener),
        };
        if (lang === "mermaid") {
          const code = stripped.map((l) => escapeHtml(l)).join("\n");
          html += wrapMarkerlessOutlineBlock(
            `<div class="wl-sec-mermaid"><div class="mermaid">${code}</div></div>`,
            blockDepth,
            state,
            paneBlockOpts,
          );
        } else {
          html += wrapMarkerlessOutlineBlock(
            renderPaneCodeBlock(stripped, lang, navSource, fence.info),
            blockDepth,
            state,
            paneBlockOpts,
          );
        }
        state.annotationPending = parseCodeAnnotationLabels(stripped).length > 0;
        continue;
      }

      const admonition = parseAdmonitionOpener(lines[i]);
      if (admonition) {
        const blockDepth = outlineDepthFromIndent(admonition.indent);
        const { bodyLines, endIndex } = collectIndentedBlock(
          lines,
          i,
          admonition.indent + 4,
          { splitTrailingChild: true },
        );
        const titleHtml = renderInlineMarkdown(highlightKeyword(admonition.title, keyword, renderOpts), pageUrl, renderOpts);
        const bodyBaseIndent = blockListBaseIndent(bodyLines);
        const bodyRenderOpts = { ...renderOpts, listIndentBase: bodyBaseIndent, prepareContextStart: false };
        const bodyHtml = bodyLines.length
          ? renderStructuredMarkdown(bodyLines, pageUrl, keyword, null, bodyRenderOpts)
          : "";
        const paneBlockOpts = {
          indent: admonition.indent,
          lineBody: lines[i].trim(),
          renderOpts,
          lineIndex: baseLineIndex + i,
          listPrefixed: /^\s*[-*+]\s+/.test(lines[i]),
        };
        if (admonition.kind === "details") {
          html += wrapMarkerlessOutlineBlock(`<details class="${escapeHtml(admonition.type)}" data-wl-default-open="${admonition.open ? "true" : "false"}"${admonition.open ? " open" : ""}>
            <summary class="wl-nav-target"${navTargetData(admonition.title)}>${titleHtml}</summary>
            ${bodyHtml}
          </details>`, blockDepth, state, paneBlockOpts);
        } else {
          html += wrapMarkerlessOutlineBlock(`<div class="admonition ${escapeHtml(admonition.type)}">
            <p class="admonition-title wl-nav-target"${navTargetData(admonition.title)}>${titleHtml}</p>
            ${bodyHtml}
          </div>`, blockDepth, state, paneBlockOpts);
        }
        i = endIndex;
        state.annotationPending = false;
        state.annotationDepth = null;
        continue;
      }

      const tab = parseTabOpener(lines[i]);
      if (tab) {
        const blockDepth = outlineDepthFromIndent(tab.indent);
        const { bodyLines, endIndex } = collectIndentedBlock(lines, i, tab.indent + 4);
        const titleHtml = renderInlineMarkdown(highlightKeyword(tab.title, keyword, renderOpts), pageUrl, renderOpts);
        const bodyBaseIndent = blockListBaseIndent(bodyLines);
        const bodyRenderOpts = { ...renderOpts, listIndentBase: bodyBaseIndent, prepareContextStart: false };
        const bodyHtml = bodyLines.length
          ? renderStructuredMarkdown(bodyLines, pageUrl, keyword, null, bodyRenderOpts)
          : "";
        html += wrapMarkerlessOutlineBlock(`<div class="wl-sec-tab-panel">
          <div class="wl-sec-tab-panel__title wl-nav-target"${navTargetData(tab.title)}>${titleHtml}</div>
          <div class="wl-sec-tab-panel__body">${bodyHtml}</div>
        </div>`, blockDepth, state, {
          indent: tab.indent,
          lineBody: lines[i].trim(),
          renderOpts,
          lineIndex: baseLineIndex + i,
          listPrefixed: /^\s*[-*+]\s+/.test(lines[i]),
        });
        i = endIndex;
        state.annotationPending = false;
        state.annotationDepth = null;
        continue;
      }

      if (isHtmlCommentLine(lines[i])) {
        i++;
        continue;
      }

      if (isRawMediaBlockStart(lines[i])) {
        const block = collectRawMediaBlock(lines, i);
        html += `<div class="wl-sec-html-embed">${renderRawMediaBlock(block.lines)}</div>`;
        i = block.end;
        continue;
      }

      if (isHtmlLikeLine(lines[i])) {
        const blockLines = [];
        while (i < lines.length && isHtmlLikeLine(lines[i])) {
          const current = lines[i];
          blockLines.push(current);
          i++;
        }
        const meaningfulLines = blockLines.filter((line) => !isBareHtmlWrapperLine(line));
        if (isRawMediaHtmlBlock(blockLines)) {
          html += `<div class="wl-sec-html-embed">${renderRawMediaBlock(blockLines)}</div>`;
        } else if (meaningfulLines.length) {
          html += `<div class="wl-sec-html-table">${meaningfulLines.join("\n")}</div>`;
        }
        continue;
      }

      const tableBlock = collectTableBlock(lines, i);
      if (tableBlock) {
        const tableIndent = blockLineIndent(lines[i]);
        if (tableIndent === 0) {
          resetOutlineLayout(state);
          clearOrderedCounters(state, 0);
        }
        html += wrapMarkerlessOutlineBlock(
          renderTableBlock(tableBlock.lines, pageUrl, keyword, renderOpts),
          outlineDepthFromIndent(tableIndent, renderOpts),
          state,
          {
            indent: tableIndent,
            lineBody: lines[i].trim(),
            renderOpts,
            lineIndex: baseLineIndex + i,
            listPrefixed: /^\s*[-*+]\s+/.test(lines[i]),
          },
        );
        i = tableBlock.end;
        continue;
      }

      html += renderSectionLine(
        lines[i],
        pageUrl,
        keyword,
        state,
        paneLineRenderOpts(renderOpts, baseLineIndex + i),
        baseLineIndex + i
      );
      i++;
    }

    if (!renderOpts.leaveListsOpen) {
      html += closeAllPaneLists(state);
    }
    return html;
  }

  function collectTableBlock(lines, startIndex) {
    if (startIndex + 1 >= lines.length) return null;
    const first = stripBlockListPrefix(lines[startIndex]).trim();
    const second = stripBlockListPrefix(lines[startIndex + 1]).trim();
    
    if (!first.includes("|") || !isTableSeparatorLine(second)) return null;

    let end = startIndex + 2;
    while (end < lines.length) {
      const trimmed = stripBlockListPrefix(lines[end]).trim();
      if (!trimmed.includes("|") || isTableSeparatorLine(trimmed)) break;
      end++;
    }

    return {
      lines: lines.slice(startIndex, end).map((line) => stripBlockListPrefix(line)),
      end,
    };
  }

  function findTableBlockAround(lines, index) {
    if (index < 0 || index >= lines.length) return null;
    let start = index;
    while (start > 0 && lines[start - 1].trim().startsWith("|")) start--;
    const block = collectTableBlock(lines, start);
    if (!block) return null;
    return index < block.end ? { start, end: block.end } : null;
  }

  function findHtmlBlockAround(lines, index) {
    if (index < 0 || index >= lines.length) return null;
    const iframeBlock = findIframeBlockAround(lines, index);
    if (iframeBlock) return iframeBlock;
    if (!isHtmlLikeLine(lines[index])) return null;
    let start = index;
    while (start > 0 && isHtmlLikeLine(lines[start - 1])) {
      start--;
    }

    let end = start + 1;
    while (end < lines.length && isHtmlLikeLine(lines[end])) {
      end++;
    }
    return { start, end };
  }

  function findStructuredBlockAround(lines, index) {
    if (index < 0 || index >= lines.length) return null;
    for (let start = index; start >= 0; start--) {
      const opener = parseAdmonitionOpener(lines[start]) || parseTabOpener(lines[start]);
      if (opener) {
        const { endIndex } = collectIndentedBlock(lines, start, opener.indent + 4);
        if (index < endIndex) return { start, end: endIndex };
      }
      const trimmed = (lines[start] || "").trim();
      if (!trimmed) break;
      if (/^#{1,6}\s+/.test(trimmed)) break;
    }
    return null;
  }

  function normalizeSectionWindow(lines, start, end) {
    let safeStart = Math.max(0, start);
    let safeEnd = Math.min(lines.length, end);

    while (safeStart > 0 && activeFenceBefore(lines, safeStart)) {
      safeStart--;
    }

    const tableAtStart = findTableBlockAround(lines, safeStart);
    if (tableAtStart) safeStart = tableAtStart.start;

    const htmlAtStart = findHtmlBlockAround(lines, safeStart);
    if (htmlAtStart) safeStart = htmlAtStart.start;

    const structuredAtStart = findStructuredBlockAround(lines, safeStart);
    if (structuredAtStart) safeStart = structuredAtStart.start;

    safeEnd = extendPastFence(lines, safeStart, safeEnd);

    let expanded = true;
    while (expanded) {
      expanded = false;
      for (let i = safeStart; i < safeEnd; i++) {
        const tableBlock = findTableBlockAround(lines, i);
        if (tableBlock && tableBlock.end > safeEnd) {
          safeEnd = tableBlock.end;
          safeEnd = extendPastFence(lines, safeStart, safeEnd);
          expanded = true;
        }
        const htmlBlock = findHtmlBlockAround(lines, i);
        if (htmlBlock && htmlBlock.end > safeEnd) {
          safeEnd = htmlBlock.end;
          safeEnd = extendPastFence(lines, safeStart, safeEnd);
          expanded = true;
        }
        const structuredBlock = findStructuredBlockAround(lines, i);
        if (structuredBlock && structuredBlock.end > safeEnd) {
          safeEnd = structuredBlock.end;
          safeEnd = extendPastFence(lines, safeStart, safeEnd);
          expanded = true;
        }
      }
    }

    return { start: safeStart, end: safeEnd };
  }

  function isSectionIntroLead(lines, start) {
    for (let i = 0; i < start; i++) {
      const trimmed = (lines[i] || "").trim();
      if (!trimmed) continue;
      if (/^#{1,6}\s+/.test(trimmed)) continue;
      return false;
    }
    return true;
  }

  function sectionLineHeadingLevel(line) {
    const heading = headingLineFromSectionLine(line);
    if (!heading) return null;
    const match = heading.match(/^(#{1,6})\s+/);
    return match ? match[1].length : null;
  }

  function nextHeadingBoundaryIndex(lines, start) {
    for (let i = Math.max(0, start + 1); i < lines.length; i++) {
      if (sectionLineHeadingLevel(lines[i]) != null) return i;
    }
    return lines.length;
  }

  function findOwningSectionHeadingStart(lines, kwOffset) {
    const safeOffset = Math.max(0, Math.min(kwOffset, Math.max(0, lines.length - 1)));
    for (let i = safeOffset; i >= 0; i--) {
      if (sectionLineHeadingLevel(lines[i]) != null) return i;
    }
    return 0;
  }

  function resolveOwnSectionWindow(lines, kwOffset) {
    const start = findOwningSectionHeadingStart(lines, kwOffset);
    return {
      start,
      end: nextHeadingBoundaryIndex(lines, start),
    };
  }

  
  
  
  function ownSectionBodyIsEmpty(lines, ownSection) {
    for (let i = ownSection.start + 1; i < ownSection.end; i++) {
      if ((lines[i] || "").trim()) return false;
    }
    return true;
  }

  
  
  
  
  
  
  function findDirectChildHeadingLines(lines, ownSection) {
    const ownLevel = sectionLineHeadingLevel(lines[ownSection.start]);
    if (ownLevel == null) return [];
    const childLevel = ownLevel + 1;
    const children = [];
    for (let i = ownSection.end; i < lines.length; i++) {
      const level = sectionLineHeadingLevel(lines[i]);
      if (level == null) continue;
      if (level <= ownLevel) break;
      if (level === childLevel) children.push(lines[i]);
    }
    return children;
  }

  function nextHeadingIndex(lines, start) {
    for (let i = Math.max(0, start + 1); i < lines.length; i++) {
      if (/^#{1,6}\s+/.test((lines[i] || "").trim())) return i;
    }
    return lines.length;
  }

  function sectionRangeToNextHeading(lines, start) {
    return normalizeSectionWindow(lines, start, nextHeadingIndex(lines, start));
  }

  function advancePastBudgetLine(lines, sectionStart, index) {
    const fence = parseFence(lines[index] || "");
    if (fence) {
      return extendPastFence(lines, sectionStart, index + 1);
    }
    return index + 1;
  }

  function advanceByBudgetUnits(lines, start, hardEnd, units) {
    let end = start;
    let consumed = 0;
    while (end < hardEnd && consumed < units) {
      const line = lines[end] || "";
      if (countBudgetLine(line)) {
        consumed++;
        end = advancePastBudgetLine(lines, start, end);
      } else {
        end++;
      }
    }
    return end;
  }

  function retreatByBudgetUnits(lines, sectionStart, endIndex, units) {
    const boundaries = [sectionStart];
    let index = sectionStart;
    while (index < endIndex) {
      const line = lines[index] || "";
      if (countBudgetLine(line)) {
        index = advancePastBudgetLine(lines, sectionStart, index);
        boundaries.push(index);
      } else {
        index++;
      }
    }
    if (boundaries[boundaries.length - 1] !== endIndex) {
      boundaries.push(endIndex);
    }
    const target = Math.max(0, boundaries.length - 1 - units);
    return boundaries[target];
  }

  function nextChunkRange(st, cursor = st.nextStart) {
    const rawStart = cursor;
    const sectionEnd = Number.isInteger(st.ownSectionEnd) ? st.ownSectionEnd : st.lines.length;
    const chunkBudget = st.chunkLines || FALLBACK_PANE_CONFIG.chunk_lines;
    const rawEnd = advanceByBudgetUnits(st.lines, rawStart, sectionEnd, chunkBudget);
    return normalizeSectionWindow(st.lines, rawStart, rawEnd);
  }

  function previousChunkRange(st, cursor = st.displayStart) {
    const sectionStart = Number.isInteger(st.ownSectionStart) ? st.ownSectionStart : 0;
    const rawEnd = Math.max(sectionStart, cursor);
    const chunkBudget = st.chunkLines || FALLBACK_PANE_CONFIG.chunk_lines;
    let rawStart = retreatByBudgetUnits(st.lines, sectionStart, rawEnd, chunkBudget);

    const tableAtStart = findTableBlockAround(st.lines, rawStart);
    if (tableAtStart && tableAtStart.end <= rawEnd) rawStart = tableAtStart.start;

    while (rawStart > 0 && activeFenceBefore(st.lines, rawStart)) rawStart--;

    return { start: rawStart, end: rawEnd };
  }

  
  
  
  
  function hasRenderableContent(st, start, end) {
    if (start >= end) return false;
    const html = renderSectionLines(
      st.lines.slice(start, end),
      st.pageUrl,
      st.keyword,
      seedOrderedState(st.lines, start),
      {
        ...(st.renderOpts || {}),
        sourceLines: st.lines,
        baseLineIndex: start,
        sectionParts: st.sectionParts || [],
        skipDuplicateHeadings: st.skipDuplicateHeadings !== false,
      }
    );
    return Boolean(html && html.trim());
  }

  function lineHasListMarker(line) {
    return /^(\s*)(?:[-*+]|\d+\.)\s+/.test(line || "");
  }

  function countBudgetLine(line) {
    const trimmed = (line || "").trim();
    if (!trimmed) return false;
    if (/^#{1,6}\s+/.test(trimmed)) return false;
    if (isHtmlCommentLine(trimmed)) return false;
    return true;
  }

  function rangeEndByBudget(lines, start, hardEnd, paneConfig = FALLBACK_PANE_CONFIG) {
    const lineBudget = paneConfig.initial_lines || FALLBACK_PANE_CONFIG.initial_lines;
    const listBudget = paneConfig.initial_list_items || FALLBACK_PANE_CONFIG.initial_list_items;
    let visibleLines = 0;
    let visibleListItems = 0;
    let end = start;

    while (end < hardEnd) {
      const line = lines[end] || "";
      const countsLine = countBudgetLine(line);
      const countsList = lineHasListMarker(line);
      const wouldExceedLineBudget = countsLine && visibleLines >= lineBudget;
      const wouldExceedListBudget = countsList && visibleListItems >= listBudget;
      if (end > start && (wouldExceedLineBudget || wouldExceedListBudget)) break;

      if (countsLine) visibleLines++;
      if (countsList) visibleListItems++;
      end = advancePastBudgetLine(lines, start, end);
    }

    return Math.max(start + 1, end);
  }

  
  function renderAppendedChunk(st, range) {
    const { lines, keyword, pageUrl, renderOpts } = st;
    const safeEnd = Math.min(lines.length, range.end);
    const paneConfig = { skip_duplicate_headings: st.skipDuplicateHeadings !== false };
    const sectionParts = st.sectionParts || [];
    const { safeStart, parentAlreadyRendered } = resolveAppendedChunkStart(
      lines,
      range.start,
      safeEnd,
      sectionParts,
      paneConfig
    );
    if (safeStart >= safeEnd) return { html: "", safeStart };
    const sectionEnd = Number.isInteger(st.ownSectionEnd) ? st.ownSectionEnd : lines.length;
    const state = seedOrderedState(lines, safeStart);
    if (parentAlreadyRendered) {
      state.listDepthStack = replayPaneListStack(lines, safeStart).listDepthStack;
    } else {
      state.listDepthStack = [];
    }
    const chunkRenderOpts = {
      ...renderOpts,
      sourceLines: lines,
      sectionParts,
      skipDuplicateHeadings: st.skipDuplicateHeadings !== false,
      baseLineIndex: safeStart,
      listIndentBase: isTopLevelSectionListLine(lines, safeStart)
        ? 0
        : listIndentBaseForListLine(lines, safeStart, renderOpts),
      leaveListsOpen: shouldLeaveListsOpen(lines, safeEnd, sectionEnd),
      _continuingList: parentAlreadyRendered && state.listDepthStack.length > 0,
    };
    return {
      html: renderSectionLines(
        lines.slice(safeStart, safeEnd),
        pageUrl,
        keyword,
        state,
        chunkRenderOpts
      ),
      safeStart,
    };
  }

  function updateContextButtons(card, st) {
    if (!card || !st) return;
    const lessBtn = card.querySelector(".wikilink-card__ctx-less");
    const moreBtn = card.querySelector(".wikilink-card__ctx-more");
    const sectionStart = Number.isInteger(st.ownSectionStart) ? st.ownSectionStart : 0;
    const sectionEnd = Number.isInteger(st.ownSectionEnd) ? st.ownSectionEnd : st.lines.length;
    if (lessBtn) {
      const initialNextStart = Number.isInteger(st.initialNextStart) ? st.initialNextStart : st.nextStart;
      const canGoUp = st.windowMode
        ? (st.nextStart > initialNextStart || hasRenderableContent(st, sectionStart, st.displayStart))
        : (st.displayStart > sectionStart || st.chunkRanges.length > 0);
      lessBtn.disabled = !canGoUp;
      lessBtn.setAttribute("aria-disabled", canGoUp ? "false" : "true");
      lessBtn.title = canGoUp ? "Earlier context" : "No earlier context";
    }
    if (moreBtn) {
      const initialDisplayStart = Number.isInteger(st.initialDisplayStart) ? st.initialDisplayStart : st.displayStart;
      const canGoDown = st.windowMode
        ? (st.displayStart < initialDisplayStart || hasRenderableContent(st, st.nextStart, sectionEnd))
        : ((st.beforeRanges || []).length > 0 || st.nextStart < sectionEnd);
      moreBtn.disabled = !canGoDown;
      moreBtn.setAttribute("aria-disabled", canGoDown ? "false" : "true");
      moreBtn.title = canGoDown ? "More context" : "No more context";
    }
  }

  
  
  
  
  
  function rerenderSectionWindow(card, st) {
    const view = card.querySelector(".wikilink-card__section-view");
    const context = view?.querySelector(":scope > .wikilink-card__context");
    if (!context) return;
    const lines = st.lines;
    const sectionEnd = Number.isInteger(st.ownSectionEnd) ? st.ownSectionEnd : lines.length;
    const viewHtml = renderSectionLines(
      lines.slice(st.displayStart, st.nextStart),
      st.pageUrl,
      st.keyword,
      seedOrderedState(lines, st.displayStart),
      {
        ...(st.renderOpts || {}),
        sourceLines: lines,
        baseLineIndex: st.displayStart,
        sectionParts: st.sectionParts || [],
        skipDuplicateHeadings: st.skipDuplicateHeadings !== false,
        leaveListsOpen: shouldLeaveListsOpen(lines, st.nextStart, sectionEnd),
      }
    );
    context.innerHTML = wrapPaneMarkdownSurface(viewHtml);
    renderMermaidInElement(context);
    upgradePaneCodeBlocks(context);
  }

  function buildEntryHref(entry, keyword) {
    const primaryKw = Array.isArray(keyword) ? keyword[0] : keyword;
    const anchorBase = String(primaryKw || "").startsWith("#")
      ? contentTagToId(primaryKw)
      : kwToId(primaryKw);
    const anchor = `${anchorBase}-${entry.occurrence_index || 0}`;
    return `/${entry.page_url}#${anchor}`;
  }

  function getEntrySectionLines(entry) {
    if (Array.isArray(entry?.section_lines_raw) && entry.section_lines_raw.length) return entry.section_lines_raw;
    if (Array.isArray(entry?.section_lines) && entry.section_lines.length) return entry.section_lines;
    return [];
  }

  function computeChildrenRange(lines, kwOffset) {
    if (kwOffset < 0 || kwOffset >= lines.length) return null;
    const kwLine = lines[kwOffset];
    if (!kwLine) return null;
    const kwIndent = (kwLine.match(/^(\s*)/)[1] || '').length;
    if (!kwLine.trim().match(/^[-*+]|\d+[.)]/)) return null;
    let end = kwOffset + 1;
    while (end < lines.length) {
      const line = lines[end];
      if (!line.trim()) { end++; continue; }
      if (((line.match(/^(\s*)/)[1] || '').length) <= kwIndent) break;
      end++;
    }
    while (end > kwOffset + 1 && !lines[end - 1].trim()) end--;
    return end > kwOffset + 1 ? { start: kwOffset + 1, end } : null;
  }

  function normalizeSectionHeadingText(text) {
    return stripWikilinkMarkup(stripKnotisMetadataAttrs(text))
      .replace(/\s#(?:code|output|interpretation)\b.*$/i, "")
      .replace(/[:\s]*$/, "")
      .trim()
      .toLowerCase();
  }

  function headingLineFromSectionLine(line) {
    const trimmed = String(line || "").trim();
    return /^#{1,6}\s+/.test(trimmed) ? trimmed : "";
  }

  function headingMatchesBreadcrumb(line, sectionParts) {
    if (!Array.isArray(sectionParts) || !sectionParts.length) return false;
    const headingLine = headingLineFromSectionLine(line) || String(line || "").trim();
    const match = headingLine.match(/^#{1,6}\s+(.*)$/);
    if (!match) return false;
    const headingText = normalizeSectionHeadingText(match[1]);
    if (!headingText) return false;
    return sectionParts.some((part) => {
      const breadcrumbText = normalizeSectionHeadingText(part);
      return breadcrumbText && (
        headingText === breadcrumbText
        || headingText.startsWith(`${breadcrumbText} `)
        || breadcrumbText.startsWith(`${headingText} `)
      );
    });
  }

  function shouldSkipDuplicatedSectionHeading(lines, start, end, sectionParts) {
    if (!Array.isArray(lines) || start >= end || start < 0 || start >= lines.length) return false;
    return headingMatchesBreadcrumb(lines[start], sectionParts);
  }

  function adjustSectionSliceStart(lines, start, end, sectionParts, paneConfig = FALLBACK_PANE_CONFIG) {
    let safeStart = Math.max(0, start);
    const safeEnd = Math.min(lines.length, end);
    if (paneConfig.skip_duplicate_headings === false) return safeStart;
    while (safeStart < safeEnd && shouldSkipDuplicatedSectionHeading(lines, safeStart, safeEnd, sectionParts)) {
      safeStart++;
      while (safeStart < safeEnd && !(lines[safeStart] || "").trim()) safeStart++;
    }
    return safeStart;
  }

  function findImmediateListParentStart(lines, start) {
    if (start <= 0 || !lines[start]) return start;
    const kwIndent = (lines[start].match(/^(\s*)/)[1] || "").length;
    if (kwIndent <= 0) return start;

    let parentIdx = start - 1;
    while (parentIdx >= 0) {
      const line = lines[parentIdx];
      if (!line.trim()) { parentIdx--; continue; }
      const indent = (line.match(/^(\s*)/)[1] || "").length;
      if (indent < kwIndent) {
        return lines[parentIdx].trim() ? parentIdx : start;
      }
      parentIdx--;
    }
    return start;
  }

  function findOutermostListParentStart(lines, start) {
    let current = start;
    let parent = findImmediateListParentStart(lines, current);
    while (parent !== current && parent >= 0) {
      const parentIndent = (lines[parent].match(/^(\s*)/)[1] || "").length;
      if (parentIndent === 0) return skipListIntroWrapperStart(lines, parent);
      current = parent;
      parent = findImmediateListParentStart(lines, current);
    }
    return skipListIntroWrapperStart(lines, parent);
  }

  function resolveKeywordContextStart(lines, kwOffset, mode = "compact") {
    if (mode === "section") {
      let start = 0;
      while (start < lines.length) {
        const trimmed = (lines[start] || "").trim();
        if (!trimmed) { start++; continue; }
        if (/^#{1,6}\s+/.test(trimmed)) { start++; continue; }
        return start;
      }
      return Math.max(0, kwOffset);
    }
    if (mode === "parent_list") {
      return findOutermostListParentStart(lines, kwOffset);
    }
    return findImmediateListParentStart(lines, kwOffset);
  }

  function resolveDefaultSectionRange(entry, sectionParts = [], paneConfig = FALLBACK_PANE_CONFIG, options = {}) {
    const lines = getEntrySectionLines(entry);
    const kwOffset = entry.section_kw_offset || 0;
    const ownSection = paneConfig.keyword_own_section
      ? resolveOwnSectionWindow(lines, kwOffset)
      : null;
    let start = kwOffset;
    const contextMode = options.contextMode ?? paneConfig.keyword_context_mode ?? "compact";

    if (sectionParts.length > 0 && headingMatchesBreadcrumb(lines[start], sectionParts)) {
      start++;
      while (start < lines.length && !lines[start].trim()) start++;
    }

    if (contextMode === "section") {
      start = resolveKeywordContextStart(lines, kwOffset, "section");
    } else if (lines[start] && (contextMode === "parent_list" || start > 0)) {
      const kwIndent = (lines[start].match(/^(\s*)/)[1] || "").length;
      if (contextMode === "parent_list" || kwIndent > 0) {
        start = resolveKeywordContextStart(lines, start, contextMode);
      }
    }

    if (ownSection) {
      start = ownSection.start;
      while (start < lines.length && !(lines[start] || "").trim()) start++;
    } else if (start > 0) {
      start = Math.max(start, 0);
    }

    const sectionEnd = ownSection
      ? ownSection.end
      : nextHeadingIndex(lines, start);
    const hardEnd = contextMode === "section" || (paneConfig.intro_expand_to_heading && isSectionIntroLead(lines, start))
      ? sectionEnd
      : Math.min(sectionEnd, lines.length);
    let end = rangeEndByBudget(lines, start, hardEnd, paneConfig);

    if (start <= kwOffset) {
      end = Math.min(Math.max(end, kwOffset + 1), hardEnd);
    }

    const normalized = normalizeSectionWindow(lines, start, end);
    const continuationEnd = normalizeSectionWindow(lines, normalized.end, sectionEnd).end;
    if (normalized.end < continuationEnd) {
      normalized.continuationStart = normalized.end;
      normalized.continuationEnd = continuationEnd;
    }
    if (ownSection) {
      normalized.ownSectionStart = ownSection.start;
      normalized.ownSectionEnd = ownSection.end;
    }
    return normalized;
  }

  function resolveCardSectionRange(entry, sectionParts = [], paneConfig = FALLBACK_PANE_CONFIG, fullSection = false) {
    const lines = getEntrySectionLines(entry);
    const kwOffset = entry.section_kw_offset || 0;
    if (fullSection && paneConfig.keyword_own_section) {
      const ownSection = resolveOwnSectionWindow(lines, kwOffset);
      const normalized = normalizeSectionWindow(lines, ownSection.start, ownSection.end);
      normalized.ownSectionStart = ownSection.start;
      normalized.ownSectionEnd = ownSection.end;
      return normalized;
    }
    if (fullSection) {
      return normalizeSectionWindow(lines, 0, lines.length);
    }
    return resolveDefaultSectionRange(entry, sectionParts, paneConfig);
  }

  function findHierarchyContextEntry(srcEntries, tgtEntries, pages, src, tgt) {
    const pageSet = new Set(pages || []);
    const scopedSrc = (srcEntries || []).filter((e) => pageSet.has(e.page_url) && getEntrySectionLines(e).length);
    const scopedTgt = (tgtEntries || []).filter((e) => pageSet.has(e.page_url) && getEntrySectionLines(e).length);

    let best = null;
    for (const parentEntry of scopedSrc) {
      for (const childEntry of scopedTgt) {
        if (parentEntry.page_url !== childEntry.page_url) continue;
        const parentLines = getEntrySectionLines(parentEntry);
        const childLines = getEntrySectionLines(childEntry);
        const childHeadingIndex = findHierarchyChildHeadingIndex(parentEntry, parentLines, childEntry, childLines, tgt);
        if (childHeadingIndex < 0) continue;
        if (!hierarchyCandidateValidTeachingLink(parentEntry, childEntry, parentLines, childHeadingIndex, src, tgt)) {
          continue;
        }

        const candidate = {
          ...parentEntry,
          _keyword: [src, tgt],
          _hierarchyEdgeCard: true,
          _edgeChildEntry: childEntry,
          _edgeChildHeadingIndex: childHeadingIndex,
          _edgePriority: 0,
        };
        let candidateScore = hierarchyContextEntryScore(parentEntry, childHeadingIndex);
        const alignedSection = childLines.length > 0
          && childLines.every((line, index) => (parentLines[childHeadingIndex + index] || "") === line);
        if (alignedSection) candidateScore -= 200000;
        else candidateScore += parentLines.length * 0.01;
        const bestScore = best
          ? (best._hierarchyContextScore ?? Number.POSITIVE_INFINITY)
          : Number.POSITIVE_INFINITY;
        const candidateChildIndex = childEntry.occurrence_index ?? 0;
        const bestChildIndex = best?._edgeChildEntry?.occurrence_index ?? Number.POSITIVE_INFINITY;
        if (!best
            || candidateScore < bestScore
            || (candidateScore === bestScore && candidateChildIndex < bestChildIndex)) {
          best = { ...candidate, _hierarchyContextScore: candidateScore };
        }
      }
    }
    return best;
  }

  function findHierarchyChildHeadingIndex(parentEntry, parentLines, childEntry, childLines, childKeyword) {
    const childHeadings = childLines
      .map((line) => (line || "").trim())
      .filter((line) => /^#{1,6}\s+/.test(line));
    for (const heading of childHeadings) {
      const index = parentLines.findIndex((line) => (line || "").trim() === heading);
      if (index >= 0) return index;
    }

    const childKwIndexes = findWikilinkLineIndexes(childLines, childKeyword);
    const childKwOffset = childEntry.section_kw_offset ?? childKwIndexes[0] ?? -1;
    if (childKwOffset >= 0) {
      for (let i = childKwOffset; i >= 0; i--) {
        if (/^#{1,6}\s+/.test((childLines[i] || "").trim())) {
          const heading = childLines[i].trim();
          const index = parentLines.findIndex((line) => (line || "").trim() === heading);
          if (index >= 0) return index;
          break;
        }
      }
    }

    return -1;
  }

  function findHierarchyContextEntryBidirectional(data, pages, src, tgt) {
    const forward = findHierarchyContextEntry(data[src] || [], data[tgt] || [], pages, src, tgt);
    if (forward) return forward;
    return findHierarchyContextEntry(data[tgt] || [], data[src] || [], pages, tgt, src);
  }

  function findAllHierarchyContextEntries(data, pages, src, tgt) {
    const results = [];
    const seen = new Set();
    for (const pageUrl of pages || []) {
      const entry = findHierarchyContextEntryBidirectional(data, [pageUrl], src, tgt);
      if (!entry) continue;
      const key = [
        entry.page_url || "",
        (entry.heading_path || []).join(" > "),
        entry._edgeChildEntry?.occurrence_index ?? "",
        entry._edgeChildHeadingIndex ?? "",
      ].join("::");
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(entry);
    }
    return results;
  }

  function edgeKeywordIdsMatch(sourceId, targetId, src, tgt) {
    const sourceA = `kw:${src}`;
    const sourceB = `kw:${tgt}`;
    return (sourceId === sourceA && targetId === sourceB)
      || (sourceId === sourceB && targetId === sourceA);
  }

  function sortEdgePanePageUrls(pageUrls, navOrder = {}) {
    return [...pageUrls].sort((a, b) => {
      const aIdx = navOrder[a] ?? 999999;
      const bIdx = navOrder[b] ?? 999999;
      if (aIdx !== bIdx) return aIdx - bIdx;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    });
  }

  function collectAllEdgeTeachingPages(data, graphData, src, tgt, relation) {
    const pages = new Set();
    const srcId = `kw:${src}`;
    const tgtId = `kw:${tgt}`;

    for (const edge of graphData?.page_hierarchy_edges || []) {
      if (edgeKeywordIdsMatch(edge.source, edge.target, src, tgt)) {
        pages.add(edge.page);
      }
    }

    for (const edge of graphData?.edges || []) {
      if (relation && edge.relation !== relation) continue;
      if (!edgeKeywordIdsMatch(edge.source, edge.target, src, tgt)) continue;
      (edge.pages || []).forEach((pageUrl) => {
        if (pageUrl && pageUrl !== "__nav__") pages.add(pageUrl);
      });
    }

    const notePage = (entry) => {
      if (!entry?.page_url) return;
      if (entryDirectTeachesEdgeRelationship(entry, src, tgt)) {
        pages.add(entry.page_url);
      }
    };

    (data[src] || []).forEach(notePage);
    (data[tgt] || []).forEach(notePage);

    return [...pages];
  }

  function shouldScopeEdgeToCurrentPage(detail) {
    return detail?.preferCurrentPageScope === true;
  }

  function hiddenContextToggleLabel(expanded = false, kind = "continuation") {
    const label = expanded
      ? "Hide context"
      : (kind === "gap" ? "Show content between" : "Expand context");
    const iconPath = expanded
      ? "M18 15l-6-6-6 6"
      : "M6 9l6 6 6-6";
    return `
          <span class="wikilink-card__gap-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="${iconPath}" />
            </svg>
          </span>
          <span>${label}</span>`;
  }

  function hiddenContextToggleHtml(kind = "continuation") {
    const className = kind === "gap" ? "wikilink-card__gap-toggle" : "wikilink-card__continuation-toggle";
    const bodyClass = kind === "gap" ? "wikilink-card__gap-body" : "wikilink-card__continuation-body";
    const buttonBody = hiddenContextToggleLabel(false, kind);
    return `
        <button class="${className}" type="button" aria-expanded="false" title="Show hidden context">
          ${buttonBody}
        </button>
        <div class="${bodyClass}" hidden></div>`;
  }

  function comparableContextLine(line) {
    return stripWikilinkMarkup(String(line || ""))
      .replace(/^#{1,6}\s+/, "")
      .replace(/^\s*[-*+]\s+/, "")
      .replace(/^\s*\d+\.\s+/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function dropDuplicateLeadingContextLines(lines) {
    if (!Array.isArray(lines) || lines.length < 2) return lines;
    const first = comparableContextLine(lines[0]);
    const second = comparableContextLine(lines[1]);
    if (!first || first !== second) return lines;
    return lines.slice(1);
  }

  function findEnclosingListBlockEnd(lines, kwOffset) {
    if (!Array.isArray(lines) || kwOffset < 0 || kwOffset >= lines.length) {
      return Math.max(0, kwOffset + 1);
    }
    const kwLine = lines[kwOffset] || "";
    const kwIndent = (kwLine.match(/^(\s*)/)[1] || "").length;
    if (!lineHasListMarker(kwLine)) {
      return Math.min(lines.length, kwOffset + 1);
    }

    let end = kwOffset + 1;
    while (end < lines.length) {
      const line = lines[end] || "";
      const trimmed = line.trim();
      if (!trimmed) {
        end++;
        continue;
      }
      if (/^#{1,6}\s+/.test(trimmed)) break;
      const indent = (line.match(/^(\s*)/)[1] || "").length;
      if (lineHasListMarker(line) && indent === kwIndent) {
        end++;
        continue;
      }
      if (indent > kwIndent) {
        end++;
        continue;
      }
      break;
    }
    while (end < lines.length && !(lines[end] || "").trim()) end++;
    if (end < lines.length && isHtmlCommentLine((lines[end] || "").trim())) end++;
    return end;
  }

  function hierarchyContextEntryScore(parentEntry, childHeadingIndex) {
    const kw = parentEntry.section_kw_offset || 0;
    if (childHeadingIndex < 0) {
      const depth = Array.isArray(parentEntry.heading_path) ? parentEntry.heading_path.length : 0;
      return depth * 1000 + kw;
    }
    if (kw >= childHeadingIndex) {
      return kw - childHeadingIndex;
    }
    return 100000 + (childHeadingIndex - kw);
  }

  function hierarchyParentMentionAboveChildSection(entry, lines, childHeadingIndex) {
    if (childHeadingIndex < 0) return false;
    const parentKw = entry.section_kw_offset || 0;
    return parentKw < childHeadingIndex;
  }

  function hierarchyShowsChildSectionOnly(entry, lines, childHeadingIndex, sectionParts, paneConfig = FALLBACK_PANE_CONFIG) {
    if (childHeadingIndex < 0) return false;
    if (hierarchyParentMentionAboveChildSection(entry, lines, childHeadingIndex)) return true;
    if (/^#{1,6}\s/.test((lines[childHeadingIndex] || "").trim())) return true;
    return hierarchyUsesSingleSectionBlock(entry, lines, childHeadingIndex, sectionParts, paneConfig);
  }

  function hierarchyUsesSingleSectionBlock(entry, lines, childHeadingIndex, sectionParts, paneConfig = FALLBACK_PANE_CONFIG) {
    if (childHeadingIndex < 0) return false;
    const parentKwOffset = entry.section_kw_offset || 0;
    const listEnd = findEnclosingListBlockEnd(lines, parentKwOffset);
    if (listEnd < childHeadingIndex) return false;
    const parentRange = resolveDefaultSectionRange(entry, sectionParts, paneConfig);
    if (childHeadingIndex > parentRange.start) return false;
    const childEntry = entry._edgeChildEntry;
    const childKwOffset = childEntry?.section_kw_offset ?? -1;
    return childKwOffset >= 0
      && childHeadingIndex <= childKwOffset
      && headingMatchesBreadcrumb(lines[childHeadingIndex], sectionParts);
  }

  

  function resolveHierarchyEdgeParentRange(entry, sectionParts, childHeadingIndex, paneConfig = FALLBACK_PANE_CONFIG) {
    const lines = getEntrySectionLines(entry);
    const range = resolveDefaultSectionRange(entry, sectionParts, paneConfig);
    const listEnd = findEnclosingListBlockEnd(lines, entry.section_kw_offset || 0);
    if (childHeadingIndex > range.start) {
      range.end = Math.min(range.end, childHeadingIndex, listEnd);
    } else if (childHeadingIndex >= 0) {
      range.end = Math.min(range.end, listEnd, range.start);
    } else {
      range.end = Math.min(range.end, listEnd);
    }
    if (range.start > 0 && /^#{1,6}\s/.test((lines[range.start - 1] || "").trim())) {
      const prevLine = range.start - 1;
      if (!shouldSkipDuplicatedSectionHeading(lines, prevLine, range.end, sectionParts)) {
        range.start -= 1;
      }
    }
    return normalizeSectionWindow(lines, range.start, range.end);
  }

  function resolveHierarchyChildKeywordIndex(entry, lines, childHeadingIndex, childKeyword) {
    const childEntry = entry._edgeChildEntry;
    if (childEntry) {
      const childOffset = childEntry.section_kw_offset ?? -1;
      if (childOffset >= 0) {
        const childLines = getEntrySectionLines(childEntry);
        const parentLines = lines;
        const alignedAtChildHeading = childLines.length
          && childLines.every((line, index) => (parentLines[childHeadingIndex + index] || "") === line);
        const alignedAtSectionStart = childLines.length === parentLines.length
          && childLines.every((line, index) => (parentLines[index] || "") === line);
        if (alignedAtChildHeading) return childHeadingIndex + childOffset;
        if (alignedAtSectionStart) return childOffset;
        const contextLine = String(childEntry.context || "").trim();
        if (contextLine) {
          const byContext = parentLines.findIndex(
            (line, index) => index >= childHeadingIndex && String(line || "").trim() === contextLine
          );
          if (byContext >= 0) return byContext;
        }
      }
    }
    const childKwIndexes = findWikilinkLineIndexes(lines, childKeyword)
      .filter((index) => index >= childHeadingIndex);
    return childKwIndexes.length ? childKwIndexes[0] : -1;
  }

  function resolveHierarchyEdgeChildRange(entry, lines, childHeadingIndex, childKeyword, paneConfig = FALLBACK_PANE_CONFIG) {
    const childKwIndex = resolveHierarchyChildKeywordIndex(entry, lines, childHeadingIndex, childKeyword);
    if (childKwIndex >= 0) {
      let start = findOutermostListParentStart(lines, childKwIndex);
      if (sectionLineHeadingLevel(lines[childKwIndex]) != null) {
        const ownSection = resolveOwnSectionWindow(lines, childKwIndex);
        start = Math.min(start, ownSection.start);
        const hardEnd = ownSection.end;
        let end = rangeEndByBudget(lines, start, hardEnd, paneConfig);
        end = normalizeSectionWindow(lines, start, end).end;
        const normalized = normalizeSectionWindow(lines, start, end);
        normalized.ownSectionStart = ownSection.start;
        normalized.ownSectionEnd = ownSection.end;
        if (end < hardEnd) {
          normalized.continuationStart = end;
          normalized.continuationEnd = normalizeSectionWindow(lines, end, hardEnd).end;
        }
        return normalized;
      }
      const end = findEnclosingListBlockEnd(lines, childKwIndex);
      const normalized = normalizeSectionWindow(lines, start, end);
      normalized.ownSectionStart = start;
      normalized.ownSectionEnd = end;
      return normalized;
    }

    const range = resolveDefaultSectionRange(
      {
        ...(entry._edgeChildEntry || entry),
        section_lines: lines,
        section_lines_raw: lines,
        section_kw_offset: childHeadingIndex,
      },
      [],
      paneConfig
    );
    const childKwIndexes = findWikilinkLineIndexes(lines, childKeyword).filter((index) => index >= childHeadingIndex);
    if (childKwIndexes.length) {
      range.end = Math.min(
        lines.length,
        Math.max(range.end, childKwIndexes[0] + 1)
      );
      range.end = normalizeSectionWindow(lines, range.start, range.end).end;
    }
    return range;
  }

  function buildHierarchyEdgeView(entry, keyword, cardId, sectionParts, paneConfig = FALLBACK_PANE_CONFIG, renderOpts = {}) {
    const lines = getEntrySectionLines(entry);
    const childHeadingIndex = entry._edgeChildHeadingIndex ?? -1;
    const childKeyword = Array.isArray(keyword) ? keyword[1] : keyword;
    const sectionRenderOpts = {
      ...renderOpts,
      sectionParts,
      skipDuplicateHeadings: paneConfig.skip_duplicate_headings !== false,
    };
    const parentHref = buildEntryHref(entry, keyword);
    const childHref = buildEntryHref(entry._edgeChildEntry, Array.isArray(keyword) ? keyword[1] : keyword);

    if (hierarchyShowsChildSectionOnly(entry, lines, childHeadingIndex, sectionParts, paneConfig)) {
      const childKwIndex = resolveHierarchyChildKeywordIndex(entry, lines, childHeadingIndex, childKeyword);
      const childRange = resolveHierarchyEdgeChildRange(entry, lines, childHeadingIndex, childKeyword, paneConfig);
      let start = adjustSectionSliceStart(
        lines,
        childRange.start,
        childRange.end,
        sectionParts,
        paneConfig
      );
      if (Array.isArray(keyword) && keyword.length >= 2 && childKwIndex >= 0) {
        const parentKwLine = findWikilinkLineIndexes(lines, keyword[0])
          .find((index) => index >= childHeadingIndex && index < childKwIndex);
        if (Number.isInteger(parentKwLine)) {
          start = Math.min(start, findOutermostListParentStart(lines, parentKwLine));
        }
      }
      let displayEnd = childRange.end;
      const ownSectionEnd = Number.isInteger(childRange.ownSectionEnd)
        ? childRange.ownSectionEnd
        : nextHeadingBoundaryIndex(lines, childHeadingIndex);
      if (start >= displayEnd && ownSectionEnd > start) {
        displayEnd = rangeEndByBudget(lines, start, ownSectionEnd, paneConfig);
        displayEnd = normalizeSectionWindow(lines, start, displayEnd).end;
        if (displayEnd <= start) {
          displayEnd = ownSectionEnd;
        }
      }
      const viewHtml = renderSectionLines(
        dropDuplicateLeadingContextLines(lines.slice(start, displayEnd)),
        entry.page_url,
        keyword,
        seedOrderedState(lines, start),
        edgeSectionRenderOpts(lines, start, displayEnd, sectionRenderOpts, paneConfig)
      );
      cardStore.set(cardId, makeCardRecord({
        lines,
        kwOffset: childKwIndex >= 0 ? childKwIndex : (entry._edgeChildEntry?.section_kw_offset ?? childHeadingIndex),
        displayStart: start,
        displayEnd,
        nextStart: displayEnd,
        ownSectionStart: childRange.ownSectionStart ?? childRange.start,
        ownSectionEnd: ownSectionEnd,
        beforeRanges: [],
        chunkRanges: [],
        keyword,
        pageUrl: entry.page_url,
        renderOpts: sectionRenderOpts,
        chunkLines: paneConfig.chunk_lines,
        sectionParts,
        skipDuplicateHeadings: paneConfig.skip_duplicate_headings,
      }));
      return `<div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(childHref)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(viewHtml)}</div>`;
    }

    const parentRange = resolveHierarchyEdgeParentRange(entry, sectionParts, childHeadingIndex, paneConfig);
    const childRange = childHeadingIndex >= 0
      ? resolveHierarchyEdgeChildRange(entry, lines, childHeadingIndex, childKeyword, paneConfig)
      : null;
    const parentStart = adjustSectionSliceStart(lines, parentRange.start, parentRange.end, sectionParts, paneConfig);
    const childStart = childRange
      ? adjustSectionSliceStart(lines, childRange.start, childRange.end, sectionParts, paneConfig)
      : childRange?.start ?? 0;

    const parentHtml = renderSectionLines(
      dropDuplicateLeadingContextLines(lines.slice(parentStart, parentRange.end)),
      entry.page_url,
      keyword,
      seedOrderedState(lines, parentStart),
      edgeSectionRenderOpts(lines, parentStart, parentRange.end, sectionRenderOpts, paneConfig)
    );
    const childHtml = childRange
      ? renderSectionLines(
          dropDuplicateLeadingContextLines(lines.slice(childStart, childRange.end)),
          entry.page_url,
          keyword,
          seedOrderedState(lines, childStart),
          edgeSectionRenderOpts(lines, childStart, childRange.end, sectionRenderOpts, paneConfig)
        )
      : "";

    const parentOwnSectionEnd = Number.isInteger(parentRange.ownSectionEnd)
      ? parentRange.ownSectionEnd
      : nextHeadingBoundaryIndex(lines, parentRange.start);

    cardStore.set(cardId, makeCardRecord({
      lines,
      kwOffset: entry.section_kw_offset || 0,
      displayStart: parentStart,
      displayEnd: childRange ? childRange.end : parentRange.end,
      nextStart: childRange ? childRange.end : parentRange.end,
      ownSectionStart: Number.isInteger(parentRange.ownSectionStart) ? parentRange.ownSectionStart : parentStart,
      ownSectionEnd: childRange
        ? (Number.isInteger(childRange.ownSectionEnd) ? childRange.ownSectionEnd : nextHeadingBoundaryIndex(lines, childHeadingIndex))
        : parentOwnSectionEnd,
      beforeRanges: [],
      chunkRanges: [],
      keyword,
      pageUrl: entry.page_url,
      renderOpts: sectionRenderOpts,
      chunkLines: paneConfig.chunk_lines,
      sectionParts,
      skipDuplicateHeadings: paneConfig.skip_duplicate_headings,
    }));

    return `
      <div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(parentHref)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(parentHtml)}</div>
      <div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(childHref)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(childHtml)}</div>`;
  }

  function findKeywordLineIndex(lines, keyword, startAt = 0) {
    for (let i = Math.max(0, startAt); i < lines.length; i++) {
      if (bracketsContain(lines[i], keyword)) return i;
    }
    return -1;
  }

  function lineMentionsKeyword(line, kw) {
    if (!line || !kw) return false;
    if (bracketsContain(line, kw)) return true;
    const lowered = String(line).toLowerCase();
    const needle = String(kw).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^\\w])${needle}([^\\w]|$)`).test(lowered);
  }

  function findKeywordLineIndexes(lines, keyword) {
    const indexes = [];
    for (let i = 0; i < lines.length; i++) {
      if (lineMentionsKeyword(lines[i], keyword)) indexes.push(i);
    }
    return indexes;
  }

  function lineMentionsWikilink(line, kw) {
    return bracketsContain(line, kw);
  }

  function lineCoOccursWikilinks(line, kwA, kwB) {
    return Boolean(line) && lineMentionsWikilink(line, kwA) && lineMentionsWikilink(line, kwB);
  }

  function sectionCoOccursWikilinks(lines, kwA, kwB) {
    if (!Array.isArray(lines) || !lines.length || !kwA || !kwB) return false;
    let hasA = false;
    let hasB = false;
    for (const line of lines) {
      if (!hasA && lineMentionsWikilink(line, kwA)) hasA = true;
      if (!hasB && lineMentionsWikilink(line, kwB)) hasB = true;
      if (hasA && hasB) return true;
    }
    return false;
  }

  function sectionCoOccurrenceAnchor(lines, kwA, kwB, preferredIndex = 0) {
    const sameLine = findCoOccurrenceWikilinkLineIndexes(lines, kwA, kwB);
    if (sameLine.length) return nearestIndex(sameLine, preferredIndex);
    const indexesA = findWikilinkLineIndexes(lines, kwA);
    const indexesB = findWikilinkLineIndexes(lines, kwB);
    if (!indexesA.length || !indexesB.length) return preferredIndex;
    const start = Math.min(indexesA[0], indexesB[0]);
    const end = Math.max(indexesA[indexesA.length - 1], indexesB[indexesB.length - 1]);
    const inner = [...indexesA, ...indexesB].filter((index) => index > start && index < end);
    if (inner.length) return nearestIndex(inner, preferredIndex);
    return nearestIndex([end], preferredIndex);
  }

  function findWikilinkLineIndexes(lines, keyword) {
    const indexes = [];
    for (let i = 0; i < lines.length; i++) {
      if (lineMentionsWikilink(lines[i], keyword)) indexes.push(i);
    }
    return indexes;
  }

  function findCoOccurrenceWikilinkLineIndexes(lines, kwA, kwB) {
    const indexes = [];
    for (let i = 0; i < lines.length; i++) {
      if (lineCoOccursWikilinks(lines[i], kwA, kwB)) indexes.push(i);
    }
    return indexes;
  }

  function findAdjacentWikilinkLinePairs(lines, kwA, kwB) {
    const pairs = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const forward = lineMentionsWikilink(lines[i], kwA) && lineMentionsWikilink(lines[i + 1], kwB);
      const reverse = lineMentionsWikilink(lines[i], kwB) && lineMentionsWikilink(lines[i + 1], kwA);
      if (forward || reverse) pairs.push([i, i + 1]);
    }
    return pairs;
  }

  function findListParentLineIndex(lines, lineIndex, indent) {
    for (let parentIndex = lineIndex - 1; parentIndex >= 0; parentIndex--) {
      const trimmed = (lines[parentIndex] || "").trim();
      if (!trimmed) continue;
      if (/^#{1,6}\s/.test(trimmed)) return parentIndex;
      const match = lines[parentIndex].match(/^(\s*)(?:[-*+]|\d+\.)\s+/);
      if (match && match[1].length < indent) return parentIndex;
    }
    return -1;
  }

  function findListSiblingWikilinkPairs(lines, kwA, kwB) {
    const items = [];
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^(\s*)(?:[-*+]|\d+\.)\s+/);
      if (!match) continue;
      const indent = match[1].length;
      const hasA = lineMentionsWikilink(lines[i], kwA);
      const hasB = lineMentionsWikilink(lines[i], kwB);
      if (!hasA && !hasB) continue;
      items.push({
        index: i,
        indent,
        parentIndex: findListParentLineIndex(lines, i, indent),
        hasA,
        hasB,
      });
    }

    const groups = new Map();
    for (const item of items) {
      const key = `${item.parentIndex}:${item.indent}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    const pairs = [];
    const seen = new Set();
    for (const group of groups.values()) {
      const withA = group.filter((item) => item.hasA && !item.hasB);
      const withB = group.filter((item) => item.hasB && !item.hasA);
      for (const aItem of withA) {
        for (const bItem of withB) {
          const start = Math.min(aItem.index, bItem.index);
          const end = Math.max(aItem.index, bItem.index);
          const key = `${start}-${end}`;
          if (seen.has(key)) continue;
          seen.add(key);
          pairs.push([start, end]);
        }
      }
    }
    return pairs;
  }

  function collectSiblingEdgeCoOccurrences(lines, kwA, kwB) {
    const sameLineIndexes = findCoOccurrenceWikilinkLineIndexes(lines, kwA, kwB);
    const pairRanges = [];
    const seenPairs = new Set();
    const addPair = (start, end) => {
      if (start === end) return;
      if (lineCoOccursWikilinks(lines[start], kwA, kwB) || lineCoOccursWikilinks(lines[end], kwA, kwB)) return;
      const key = `${Math.min(start, end)}-${Math.max(start, end)}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      pairRanges.push([Math.min(start, end), Math.max(start, end)]);
    };

    for (const [start, end] of findListSiblingWikilinkPairs(lines, kwA, kwB)) addPair(start, end);
    for (const [start, end] of findAdjacentWikilinkLinePairs(lines, kwA, kwB)) addPair(start, end);

    return { sameLineIndexes, pairRanges };
  }

  function findCoOccurrenceLineIndexes(lines, kwA, kwB) {
    const indexes = [];
    for (let i = 0; i < lines.length; i++) {
      if (lineCoOccursKeywords(lines[i], kwA, kwB)) indexes.push(i);
    }
    return indexes;
  }

  function findAdjacentKeywordLinePairs(lines, kwA, kwB) {
    const pairs = [];
    for (let i = 0; i < lines.length - 1; i++) {
      const forward = lineMentionsKeyword(lines[i], kwA) && lineMentionsKeyword(lines[i + 1], kwB);
      const reverse = lineMentionsKeyword(lines[i], kwB) && lineMentionsKeyword(lines[i + 1], kwA);
      if (forward || reverse) pairs.push([i, i + 1]);
    }
    return pairs;
  }

  function nearestIndex(indexes, anchor) {
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of indexes) {
      const distance = Math.abs(index - anchor);
      if (distance < bestDistance || (distance === bestDistance && index > best)) {
        best = index;
        bestDistance = distance;
      }
    }
    return best;
  }

  function resolveSingleLineRange(lines, index) {
    if (index < 0 || index >= lines.length) return null;
    return normalizeSectionWindow(lines, index, index + 1);
  }

  function resolveEdgeKeywordRange(entry, lines, index, sectionParts, paneConfig = FALLBACK_PANE_CONFIG) {
    if (index < 0 || index >= lines.length) return null;
    if (paneConfig.edge_context_mode === "section") {
      return normalizeSectionWindow(lines, 0, lines.length);
    }
    if (paneConfig.edge_context_mode === "parent_list") {
      return resolveDefaultSectionRange(
        {
          ...entry,
          section_lines: lines,
          section_lines_raw: lines,
          section_kw_offset: index,
        },
        sectionParts,
        paneConfig,
        { contextMode: "compact" }
      );
    }
    return resolveSingleLineRange(lines, index);
  }

  function shouldInlineEdgeGap(range, paneConfig = FALLBACK_PANE_CONFIG) {
    if (!range || range.start >= range.end) return false;
    if (paneConfig.edge_gap_mode === "hide") return false;
    if (paneConfig.edge_gap_mode === "inline") return true;
    const maxLines = Number.isInteger(paneConfig.edge_inline_gap_max_lines)
      ? paneConfig.edge_inline_gap_max_lines
      : FALLBACK_PANE_CONFIG.edge_inline_gap_max_lines;
    return (range.end - range.start) <= maxLines;
  }

  function shouldToggleEdgeGap(range, paneConfig = FALLBACK_PANE_CONFIG) {
    return paneConfig.edge_gap_mode === "toggle" && range && range.start < range.end && !shouldInlineEdgeGap(range, paneConfig);
  }

  function listSiblingWikilinkPair(lines, indexA, indexB, kwA, kwB) {
    const lo = Math.min(indexA, indexB);
    const hi = Math.max(indexA, indexB);
    return findListSiblingWikilinkPairs(lines, kwA, kwB).some(([start, end]) => start === lo && end === hi);
  }

  function resolveListSiblingPairRange(lines, indexA, indexB) {
    const anchor = Math.min(indexA, indexB);
    const endAnchor = Math.max(indexA, indexB);
    const start = findOutermostListParentStart(lines, anchor);
    const end = findEnclosingListBlockEnd(lines, endAnchor);
    return normalizeSectionWindow(lines, start, end);
  }

  function renderCooccurrenceEdgeRange(entry, keyword, cardId, sectionParts, paneConfig, renderOpts, lines, lineIndex, explicitRange = null) {
    const range = explicitRange || resolveEdgeKeywordRange(entry, lines, lineIndex, sectionParts, paneConfig);
    if (!range) return null;
    const sectionRenderOpts = {
      ...renderOpts,
      sectionParts,
      skipDuplicateHeadings: paneConfig.skip_duplicate_headings !== false,
    };
    const primaryStart = adjustSectionSliceStart(lines, range.start, range.end, sectionParts, paneConfig);
    const href = buildEntryHref(entry, Array.isArray(keyword) ? keyword[0] : keyword);
    const primaryHtml = renderSectionLines(
      dropDuplicateLeadingContextLines(lines.slice(primaryStart, range.end)),
      entry.page_url,
      keyword,
      seedOrderedState(lines, primaryStart),
      edgeSectionRenderOpts(lines, primaryStart, range.end, sectionRenderOpts, paneConfig)
    );
    cardStore.set(cardId, makeCardRecord({
      lines,
      kwOffset: lineIndex,
      displayStart: primaryStart,
      displayEnd: range.end,
      nextStart: range.end,
      ownSectionStart: Number.isInteger(range.ownSectionStart) ? range.ownSectionStart : primaryStart,
      ownSectionEnd: Number.isInteger(range.ownSectionEnd) ? range.ownSectionEnd : nextHeadingBoundaryIndex(lines, lineIndex),
      beforeRanges: [],
      chunkRanges: [],
      keyword,
      pageUrl: entry.page_url,
      renderOpts: sectionRenderOpts,
      chunkLines: paneConfig.chunk_lines,
      sectionParts,
      skipDuplicateHeadings: paneConfig.skip_duplicate_headings,
    }));
    return `<div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(href)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(primaryHtml)}</div>`;
  }

  function buildCooccurrenceEdgeView(entry, keyword, cardId, sectionParts, paneConfig = FALLBACK_PANE_CONFIG, renderOpts = {}) {
    const lines = getEntrySectionLines(entry);
    if (!Array.isArray(keyword) || keyword.length < 2 || !lines.length) return null;
    const sectionRenderOpts = {
      ...renderOpts,
      sectionParts,
      skipDuplicateHeadings: paneConfig.skip_duplicate_headings !== false,
    };

    const firstIndexes = findWikilinkLineIndexes(lines, keyword[0]);
    const secondIndexes = findWikilinkLineIndexes(lines, keyword[1]);
    if (!firstIndexes.length || !secondIndexes.length) return null;

    const anchorIndex = Math.max(0, Math.min(lines.length - 1, entry.section_kw_offset || 0));

    let primaryIndex;
    let secondaryIndex;
    if (Array.isArray(entry._edgePair) && entry._edgePair.length === 2) {
      primaryIndex = entry._edgePair[0];
      secondaryIndex = entry._edgePair[1];
      const pairRange = resolveListSiblingPairRange(lines, primaryIndex, secondaryIndex);
      return renderCooccurrenceEdgeRange(
        entry,
        keyword,
        cardId,
        sectionParts,
        paneConfig,
        renderOpts,
        lines,
        pairRange.start,
        pairRange
      );
    } else {
      const coOccurrenceIndexes = findCoOccurrenceWikilinkLineIndexes(lines, keyword[0], keyword[1]);
      if (coOccurrenceIndexes.length) {
        const lineIndex = coOccurrenceIndexes.includes(anchorIndex)
          ? anchorIndex
          : nearestIndex(coOccurrenceIndexes, anchorIndex);
        return renderCooccurrenceEdgeRange(
          entry,
          keyword,
          cardId,
          sectionParts,
          paneConfig,
          renderOpts,
          lines,
          lineIndex
        );
      }

      const anchorHasFirst = lineMentionsWikilink(lines[anchorIndex], keyword[0]);
      const anchorHasSecond = lineMentionsWikilink(lines[anchorIndex], keyword[1]);
      primaryIndex = anchorHasFirst || anchorHasSecond
        ? anchorIndex
        : nearestIndex([...firstIndexes, ...secondIndexes], anchorIndex);
      if (primaryIndex < 0) return null;

      let secondaryCandidates;
      if (lineMentionsWikilink(lines[primaryIndex], keyword[0]) && !lineMentionsWikilink(lines[primaryIndex], keyword[1])) {
        secondaryCandidates = secondIndexes;
      } else if (lineMentionsWikilink(lines[primaryIndex], keyword[1]) && !lineMentionsWikilink(lines[primaryIndex], keyword[0])) {
        secondaryCandidates = firstIndexes;
      } else {
        secondaryCandidates = [...firstIndexes, ...secondIndexes].filter((index) => index !== primaryIndex);
      }
      secondaryIndex = nearestIndex(secondaryCandidates, primaryIndex);
      if (secondaryIndex < 0 || primaryIndex === secondaryIndex) return null;
      if (secondaryIndex < primaryIndex) {
        const tmp = primaryIndex;
        primaryIndex = secondaryIndex;
        secondaryIndex = tmp;
      }
    }

    const primaryRange = resolveEdgeKeywordRange(entry, lines, primaryIndex, sectionParts, paneConfig);
    if (!primaryRange) return null;
    const primaryStart = adjustSectionSliceStart(lines, primaryRange.start, primaryRange.end, sectionParts, paneConfig);

    if (secondaryIndex < primaryRange.end) {
      const href = buildEntryHref(entry, Array.isArray(keyword) ? keyword[0] : keyword);
      const primaryHtml = renderSectionLines(
        dropDuplicateLeadingContextLines(lines.slice(primaryStart, primaryRange.end)),
        entry.page_url,
        keyword,
        seedOrderedState(lines, primaryStart),
        edgeSectionRenderOpts(lines, primaryStart, primaryRange.end, sectionRenderOpts, paneConfig)
      );
      cardStore.set(cardId, makeCardRecord({
        lines,
        kwOffset: primaryIndex,
        displayStart: primaryStart,
        displayEnd: primaryRange.end,
        nextStart: primaryRange.end,
        ownSectionStart: Number.isInteger(primaryRange.ownSectionStart) ? primaryRange.ownSectionStart : primaryStart,
        ownSectionEnd: Number.isInteger(primaryRange.ownSectionEnd) ? primaryRange.ownSectionEnd : nextHeadingBoundaryIndex(lines, primaryIndex),
        beforeRanges: [],
        chunkRanges: [],
        keyword,
        pageUrl: entry.page_url,
        renderOpts: sectionRenderOpts,
        chunkLines: paneConfig.chunk_lines,
        sectionParts,
        skipDuplicateHeadings: paneConfig.skip_duplicate_headings,
      }));
      return `<div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(href)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(primaryHtml)}</div>`;
    }

    const secondaryRange = resolveEdgeKeywordRange(entry, lines, secondaryIndex, sectionParts, paneConfig);
    if (!secondaryRange) return null;
    if (secondaryRange.start < primaryRange.end) return null;
    const secondaryStart = adjustSectionSliceStart(lines, secondaryRange.start, secondaryRange.end, sectionParts, paneConfig);

    const gapRange = secondaryRange.start > primaryRange.end
      ? normalizeSectionWindow(lines, primaryRange.end, secondaryRange.start)
      : null;
    const inlineGap = shouldInlineEdgeGap(gapRange, paneConfig);
    const href = buildEntryHref(entry, Array.isArray(keyword) ? keyword[0] : keyword);

    const primaryHtml = renderSectionLines(
      dropDuplicateLeadingContextLines(lines.slice(primaryStart, primaryRange.end)),
      entry.page_url,
      keyword,
      seedOrderedState(lines, primaryStart),
      edgeSectionRenderOpts(lines, primaryStart, primaryRange.end, sectionRenderOpts, paneConfig)
    );
    const secondaryHtml = renderSectionLines(
      dropDuplicateLeadingContextLines(lines.slice(secondaryStart, secondaryRange.end)),
      entry.page_url,
      keyword,
      seedOrderedState(lines, secondaryStart),
      edgeSectionRenderOpts(lines, secondaryStart, secondaryRange.end, sectionRenderOpts, paneConfig)
    );
    const gapHtmlInline = inlineGap
      ? renderSectionLines(
          dropDuplicateLeadingContextLines(lines.slice(gapRange.start, gapRange.end)),
          entry.page_url,
          keyword,
          seedOrderedState(lines, gapRange.start),
          edgeSectionRenderOpts(lines, gapRange.start, gapRange.end, sectionRenderOpts, paneConfig)
        )
      : "";

    cardStore.set(cardId, makeCardRecord({
      lines,
      kwOffset: entry.section_kw_offset || 0,
      displayStart: primaryStart,
      displayEnd: secondaryRange.end,
      nextStart: secondaryRange.end,
      ownSectionStart: Number.isInteger(primaryRange.ownSectionStart) ? primaryRange.ownSectionStart : primaryStart,
      ownSectionEnd: Number.isInteger(secondaryRange.ownSectionEnd) ? secondaryRange.ownSectionEnd : nextHeadingBoundaryIndex(lines, secondaryIndex),
      beforeRanges: [],
      chunkRanges: [],
      keyword,
      pageUrl: entry.page_url,
      renderOpts: sectionRenderOpts,
      chunkLines: paneConfig.chunk_lines,
      sectionParts,
      skipDuplicateHeadings: paneConfig.skip_duplicate_headings,
      hierarchyGapRange: shouldToggleEdgeGap(gapRange, paneConfig) ? gapRange : null,
      hierarchyGapExpanded: false,
    }));

    const gapHtml = shouldToggleEdgeGap(gapRange, paneConfig)
      ? hiddenContextToggleHtml("gap")
      : "";

    return `
      <div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(href)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(primaryHtml)}</div>
      ${inlineGap ? `<div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(href)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(gapHtmlInline)}</div>` : ""}
      ${gapHtml}
      <div class="wikilink-card__context wikilink-card__context--edge-anchor" data-href="${escapeHtml(href)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(secondaryHtml)}</div>`;
  }

  function stripOrphanListContinuationPrefix(html) {
    return String(html || "").replace(/^(?:\s*<\/li>\s*<\/ul>)+/i, "");
  }

  function ensureTopLevelListWrapper(html) {
    const body = stripOrphanListContinuationPrefix(html).trim();
    if (!body) return body;
    if (/^<(?:ul|ol)\b/i.test(body)) return body;
    if (/^<li\b/i.test(body)) return `<ul>${body}</ul>`;
    return body;
  }

  function closeLastTopLevelLiBranch(topList) {
    if (!topList) return;
    const lastTopLi = topList.querySelector(":scope > li:last-child");
    if (!lastTopLi || !listFragmentHasOpenLists(lastTopLi.innerHTML)) return;
    const stacks = [];
    let nested = lastTopLi.querySelector(":scope > ul, :scope > ol");
    while (nested) {
      stacks.push(nested);
      const lastLi = nested.querySelector(":scope > li:last-child");
      nested = lastLi?.querySelector(":scope > ul, :scope > ol") ?? null;
    }
    let closers = "";
    for (let i = stacks.length - 1; i >= 0; i--) {
      closers += "</li></" + stacks[i].tagName.toLowerCase() + ">";
    }
    closers += "</li>";
    topList.insertAdjacentHTML("beforeend", closers);
  }

  function surfaceListNeedsSealing(surface) {
    if (!surface) return false;
    const html = surface.innerHTML.trim();
    if (!html || /<\/(?:ul|ol)>\s*$/i.test(html)) return false;
    const last = surface.lastElementChild;
    return Boolean(last && (last.tagName === "UL" || last.tagName === "OL"));
  }

  function sealSurfaceOpenLists(surface) {
    if (!surfaceListNeedsSealing(surface)) return;
    const last = surface.lastElementChild;
    surface.insertAdjacentHTML("beforeend", "</li></" + last.tagName.toLowerCase() + ">");
  }

  function findOpenListContinuationContainer(surface) {
    const lastTopList = surface?.querySelector(":scope > ul:last-of-type, :scope > ol:last-of-type");
    if (!lastTopList) return null;
    let container = lastTopList;
    let li = lastTopList.querySelector(":scope > li:last-child");
    while (li) {
      const nested = li.querySelector(":scope > ul:last-of-type, :scope > ol:last-of-type");
      if (nested) {
        container = nested;
        li = nested.querySelector(":scope > li:last-child");
        continue;
      }
      break;
    }
    return container;
  }

  function appendHtmlToSurface(surface, html) {
    const temp = document.createElement("div");
    temp.innerHTML = html;
    const appended = [];
    while (temp.firstChild) {
      appended.push(temp.firstChild);
      surface.appendChild(temp.firstChild);
    }
    return appended;
  }

  function appendListContinuationHtml(surface, html) {
    const body = stripOrphanListContinuationPrefix(html).trim();
    if (!body) return [];
    const container = findOpenListContinuationContainer(surface);
    if (!container) return appendHtmlToSurface(surface, ensureTopLevelListWrapper(body));
    const lastLi = container.querySelector(":scope > li:last-child");
    if (/^<(?:ul|ol)\b/i.test(body)) {
      if (lastLi) {
        const before = lastLi.childNodes.length;
        lastLi.insertAdjacentHTML("beforeend", body);
        return [...lastLi.childNodes].slice(before);
      }
      return appendHtmlToSurface(surface, body);
    }
    const beforeCount = container.children.length;
    container.insertAdjacentHTML("beforeend", body);
    return [...container.children].slice(beforeCount);
  }

  function mergeTopLevelListHtml(surface, html, topLevelSibling = false) {
    const wrapped = ensureTopLevelListWrapper(html);
    const temp = document.createElement("div");
    temp.innerHTML = wrapped;
    const incomingList = temp.firstElementChild;
    if (!incomingList || (incomingList.tagName !== "UL" && incomingList.tagName !== "OL")) {
      return appendHtmlToSurface(surface, wrapped);
    }
    const topList = surface.querySelector(":scope > ul:last-of-type, :scope > ol:last-of-type");
    if (!topList) return appendHtmlToSurface(surface, wrapped);
    if (topLevelSibling) closeLastTopLevelLiBranch(topList);
    const before = topList.children.length;
    while (incomingList.firstChild) {
      topList.appendChild(incomingList.firstChild);
    }
    return [...topList.children].slice(before);
  }

  function appendContextChunkHtml(card, html, lines, lineIndex) {
    const surface = Array.isArray(lines) && Number.isInteger(lineIndex)
      ? findPaneChunkAppendTarget(card, lines, lineIndex)
      : card.querySelector(".wikilink-card__section-view .heading-flow__content");
    if (!surface) return [];
    const isBlockBody = surface.classList.contains("wl-sec-tab-panel__body")
      || surface.classList.contains("admonition")
      || (surface.tagName === "DETAILS" && surface.querySelector(":scope > summary"));
    const continuesOpenList = !isBlockBody
      && Array.isArray(lines)
      && Number.isInteger(lineIndex)
      && !isTopLevelSectionListLine(lines, lineIndex)
      && sectionContinuesInsideList(lines, lineIndex);
    const topLevelSibling = !isBlockBody
      && Array.isArray(lines)
      && Number.isInteger(lineIndex)
      && isTopLevelSectionListLine(lines, lineIndex);
    if (!isBlockBody && !continuesOpenList) sealSurfaceOpenLists(surface);
    if (isBlockBody) return appendHtmlToSurface(surface, html);
    if (continuesOpenList) return appendListContinuationHtml(surface, html);
    return mergeTopLevelListHtml(surface, html, topLevelSibling);
  }

  function buildContextChunk(card, html, extraClass = "", lines = null, lineIndex = null) {
    if (extraClass === "wl-chunk--after") {
      const surface = Array.isArray(lines) && Number.isInteger(lineIndex)
        ? findPaneChunkAppendTarget(card, lines, lineIndex)
        : card.querySelector(".wikilink-card__section-view .heading-flow__content");
      if (surface) {
        const appended = appendContextChunkHtml(card, html, lines, lineIndex);
        const marker = document.createElement("span");
        marker.className = "wl-chunk wl-chunk--after";
        marker.setAttribute("aria-hidden", "true");
        marker.hidden = true;
        marker._appendedNodes = appended;
        surface.appendChild(marker);
        return marker;
      }
    }
    const chunk = document.createElement("div");
    chunk.className = `wl-chunk wikilink-card__context ${extraClass}`.trim();
    const href = card.querySelector(".wikilink-card__context")?.dataset.href;
    if (href) chunk.dataset.href = href;
    chunk.setAttribute("role", "link");
    chunk.setAttribute("tabindex", "0");
    chunk.innerHTML = wrapPaneMarkdownSurface(html);
    return chunk;
  }

  function buildContinuationHtml(range) {
    return range && range.start < range.end ? hiddenContextToggleHtml("continuation") : "";
  }

  function seedOrderedState(lines, beforeIndex) {
    const state = { orderedCounters: new Map(), annotationPending: false, annotationDepth: null };
    resetOutlineLayout(state);
    resetPaneListStack(state);
    let i = 0;
    while (i < beforeIndex) {
      const fence = parseFence(lines[i]);
      if (fence) {
        const markerChar = fence.markerChar;
        i++;
        while (i < beforeIndex) {
          const innerFence = parseFence(lines[i]);
          i++;
          if (innerFence && innerFence.markerChar === markerChar) break;
        }
        state.annotationPending = true;
        continue;
      }

      const tableBlock = collectTableBlock(lines, i);
      if (tableBlock) {
        const tableIndent = lines[i].match(/^(\s*)/)[1].length;
        if (tableIndent === 0) {
          clearOrderedCounters(state, 0);
          resetOutlineLayout(state);
        }
        i = tableBlock.end;
        continue;
      }

      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { i++; continue; }

      const indent = line.match(/^(\s*)/)[1].length;
      const depth = outlineDepthFromIndent(indent);

      if (/^(#{1,6})\s+/.test(trimmed)) {
        clearOrderedCounters(state, 0);
        state.annotationPending = false;
        state.annotationDepth = null;
        resetOutlineLayout(state);
        resetPaneListStack(state);
      } else if (/^(\s*)[-*+]\s+/.test(line)) {
        clearOrderedCounters(state, depth + 1);
        state.annotationPending = false;
        state.annotationDepth = null;
        const bulletMatch = line.match(/^(\s*)[-*+]\s+(.*)/);
        if (bulletMatch && !markerlessListItemContent(bulletMatch[2])) {
          outlineLayoutStyle(state, depth, "bullet");
        }
      } else if (/^(\s*)(\d+)\.\s+/.test(line)) {
        const numberedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)/);
        if (numberedMatch && markerlessListItemContent(numberedMatch[3])) {
          // Markerless teaching blocks keep outline depth but do not consume a number.
        } else {
          if (state.annotationPending) {
            state.annotationDepth = depth;
            state.annotationPending = false;
          } else if (state.annotationDepth !== null && depth !== state.annotationDepth) {
            state.annotationDepth = null;
          }
          resolveOrderedDisplayNumber(state, depth, numberedMatch[2]);
        }
      } else if (isHtmlCommentLine(trimmed)) {
        // Slide-break comments split rendered lists but must not reset counters.
      } else if (/^<\/?[a-zA-Z][^>]*>$/.test(trimmed) || trimmed.startsWith("|") || trimmed.startsWith("![")) {
        if (indent === 0) clearOrderedCounters(state, 0);
        state.annotationPending = false;
        state.annotationDepth = null;
      } else if (indent === 0) {
        clearOrderedCounters(state, 0);
        state.annotationPending = false;
        state.annotationDepth = null;
      }

      i++;
    }
    return state;
  }

  function clearOrderedCounters(state, minDepth = 0) {
    for (const depth of [...state.orderedCounters.keys()]) {
      if (depth >= minDepth) state.orderedCounters.delete(depth);
    }
  }

  function resolveOrderedDisplayNumber(state, depth, sourceNumberText) {
    const sourceNumber = Number.parseInt(sourceNumberText, 10);
    clearOrderedCounters(state, depth + 1);
    const displayNumber = Number.isFinite(sourceNumber) && sourceNumber > 0
      ? sourceNumber
      : (state.orderedCounters.get(depth) || 0) + 1;
    state.orderedCounters.set(depth, displayNumber);
    return displayNumber;
  }

  function formatOrderedLabel(state, depth) {
    const parts = [];
    for (let d = 0; d <= depth; d++) {
      const value = state.orderedCounters.get(d);
      if (value != null) parts.push(value);
    }
    return `${parts.join(".")}.`;
  }

  function outlineDepthFromIndent(indent, renderOpts = {}) {
    return Math.max(0, Math.floor(paneRelativeIndent(indent, renderOpts) / 4));
  }

  const OUTLINE_UL_OL_LI_PAD_EM = 0.6;
  const OUTLINE_NUMBER_MARKER_SLOT_EM = 1.8;
  // Per nested list level — matches md-content `ul ul`, `ul ul ul`, … padding steps.
  const OUTLINE_NEST_STEP_EM = [0.95, 1.7, 2.15, 2.95, 3.75, 4.5];

  function outlineNestStepEm(nestDepth) {
    const index = Math.max(0, Math.min(nestDepth - 1, OUTLINE_NEST_STEP_EM.length - 1));
    return OUTLINE_NEST_STEP_EM[index];
  }

  function resetOutlineLayout(state) {
    state.outlineChildPadEm = [0];
    state.outlineKinds = [];
  }

  function truncateOutlineLayout(state, depth) {
    if (!Array.isArray(state.outlineChildPadEm)) resetOutlineLayout(state);
    if (state.outlineChildPadEm.length > depth + 1) {
      state.outlineChildPadEm.length = depth + 1;
    }
    if (Array.isArray(state.outlineKinds) && state.outlineKinds.length > depth) {
      state.outlineKinds.length = depth;
    }
  }

  function outlineBulletPadEm(state, depth) {
    if (depth === 0) return 0;
    if (depth === 1) return outlineNestStepEm(1);
    const parentPad = state.outlineChildPadEm[depth - 1];
    const gapEm = OUTLINE_NUMBER_MARKER_SLOT_EM - 1.5;
    if (parentPad == null) {
      let padEm = outlineNestStepEm(1);
      for (let d = 2; d <= depth; d++) padEm += gapEm;
      return padEm;
    }
    // Depth 2+: right-aligned grid dots land on parent text; chains through depths 4–6+.
    return parentPad + gapEm;
  }

  function outlineLayoutStyle(state, depth, kind) {
    if (kind === "bullet" || kind === "number") {
      truncateOutlineLayout(state, depth);
    }
    if (!Array.isArray(state.outlineChildPadEm)) resetOutlineLayout(state);
    if (!Array.isArray(state.outlineKinds)) state.outlineKinds = [];

    let padEm = state.outlineChildPadEm[depth];
    if (kind === "bullet") {
      padEm = outlineBulletPadEm(state, depth);
      state.outlineKinds[depth] = kind;
      state.outlineChildPadEm[depth] = padEm;
    } else if (kind === "number") {
      if (padEm == null) {
        padEm = depth === 0 ? 0 : outlineBulletPadEm(state, depth);
      }
      if (depth > 0 && state.outlineKinds[depth - 1] === "bullet") {
        padEm += OUTLINE_UL_OL_LI_PAD_EM;
      }
      state.outlineKinds[depth] = kind;
      const nestStep = outlineNestStepEm(depth + 1);
      state.outlineChildPadEm[depth + 1] = padEm + OUTLINE_NUMBER_MARKER_SLOT_EM + nestStep;
    } else if (padEm == null) {
      padEm = depth === 0 ? 0 : outlineBulletPadEm(state, depth);
    }

    return `--wl-depth:${depth}; --wl-padding-left:${padEm}em`;
  }

  function outlineBlockAttrs(state, depth) {
    const layoutStyle = state
      ? outlineLayoutStyle(state, depth, "block")
      : `--wl-depth:${depth}`;
    return ` style="${layoutStyle}" data-knotis-outline-block="markerless"`;
  }

  function wrapMarkerlessOutlineBlock(html, depth, state = null, paneOpts = {}) {
    const indent = Number.isInteger(paneOpts.indent) ? paneOpts.indent : depth * 4;
    const lineBody = paneOpts.lineBody || "";
    const renderOpts = paneOpts.renderOpts || {};
    const lineIndex = Number.isInteger(paneOpts.lineIndex) ? paneOpts.lineIndex : null;
    const shouldWrapList = indent > 0 || Boolean(paneOpts.listPrefixed);

    if (state && shouldWrapList) {
      return renderPaneListItem(state, indent, "ul", lineBody, html, renderOpts, lineIndex);
    }
    if (state) {
      return `${closeAllPaneLists(state)}${html}`;
    }
    return depth > 0 || state
      ? `<div class="wl-sec-outline-block"${outlineBlockAttrs(state, depth)}>${html}</div>`
      : html;
  }

  function activeMermaidTheme() {
    const scheme = document.body?.getAttribute("data-md-color-scheme") || "default";
    return scheme === "slate" ? "dark" : "default";
  }

  function buildMermaidConfig() {
    return { startOnLoad: false, theme: activeMermaidTheme() };
  }

  function existingMermaidConfig() {
    if (typeof mermaid === "undefined") return null;
    try {
      return typeof mermaid.getConfig === "function" ? mermaid.getConfig() : null;
    } catch {
      return null;
    }
  }

  function ensureMermaidConfigured() {
    if (typeof mermaid === "undefined" || typeof mermaid.initialize !== "function") return false;
    if (mermaidConfigured) return true;
    const existing = existingMermaidConfig();
    if (existing?.theme || existing?.themeCSS) {
      mermaidConfigured = true;
      return true;
    }
    mermaid.initialize(buildMermaidConfig());
    mermaidConfigured = true;
    return true;
  }

  const mermaidSourceCatalog = new Map();
  const mermaidSourceCatalogPromises = new Map();

  function pagePathnameForMermaidCatalog() {
    const path = location.pathname || "/";
    if (path.endsWith("/")) return path;
    const leaf = path.split("/").pop() || "";
    return leaf.includes(".") ? path : `${path}/`;
  }

  function parseMermaidSourcesFromHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    const sources = [];
    doc.querySelectorAll("pre.mermaid").forEach((pre) => {
      const code = pre.querySelector("code");
      const source = normalizeMermaidSource((code ? code.textContent : pre.textContent) || "");
      if (source) sources.push(source);
    });
    if (sources.length) return sources;
    doc.querySelectorAll(".mermaid[data-knotis-mermaid-source]").forEach((node) => {
      const source = normalizeMermaidSource(node.dataset.knotisMermaidSource || "");
      if (source) sources.push(source);
    });
    return sources;
  }

  async function fetchPageMermaidSourceCatalog(pathname = pagePathnameForMermaidCatalog()) {
    if (mermaidSourceCatalog.has(pathname)) return mermaidSourceCatalog.get(pathname);
    if (mermaidSourceCatalogPromises.has(pathname)) return mermaidSourceCatalogPromises.get(pathname);
    const job = (async () => {
      const candidates = pathname.endsWith("/")
        ? [pathname, `${pathname}index.html`]
        : [pathname, `${pathname}/`, `${pathname}/index.html`];
      for (const url of candidates) {
        try {
          const resp = await fetch(url, { credentials: "same-origin" });
          if (!resp.ok) continue;
          const html = await resp.text();
          const sources = parseMermaidSourcesFromHtml(html);
          if (sources.length) {
            mermaidSourceCatalog.set(pathname, sources);
            return sources;
          }
        } catch (err) {
          console.warn("[DEBUG] fetching mermaid sources for page failed", err);
        }
      }
      mermaidSourceCatalog.set(pathname, []);
      return [];
    })();
    mermaidSourceCatalogPromises.set(pathname, job);
    try {
      return await job;
    } finally {
      mermaidSourceCatalogPromises.delete(pathname);
    }
  }

  // ── Rendered code blocks in pane cards ──────────────────────────────────
  // The pane re-renders markdown client-side, so its code boxes had no
  // Pygments highlighting. Cards now swap in the server-rendered .highlight
  // markup fetched from the entry's built page, matched by code text and
  // authored line-highlight options so identical duplicates stay distinct.
  const renderedCodeCatalog = new Map();
  const renderedCodeCatalogPromises = new Map();

  function normalizeCodeKey(text) {
    return String(text || "").replace(/\s+/g, "");
  }

  function normalizeHighlightLineKey(value) {
    const lines = String(value || "").match(/\d+/g) || [];
    return Array.from(new Set(lines.map(Number).filter((line) => line > 0)))
      .sort((a, b) => a - b)
      .join(",");
  }

  function highlightLineKeyFromFenceInfo(info, lineCount = null) {
    const match = String(info || "").match(/\bhl_lines\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/i);
    const key = normalizeHighlightLineKey(match?.[1] || match?.[2] || match?.[3] || "");
    if (!Number.isInteger(lineCount) || lineCount < 0) return key;
    return key.split(",")
      .map(Number)
      .filter((line) => line <= lineCount)
      .join(",");
  }

  function highlightLineKeyFromRenderedCode(codeEl) {
    const lines = Array.from(codeEl?.children || [])
      .filter((el) => el.tagName === "SPAN" && el.id.startsWith("__span-"));
    return lines
      .map((line, index) => Array.from(line.children).some((child) => child.classList.contains("hll")) ? index + 1 : 0)
      .filter(Boolean)
      .join(",");
  }

  function renderedCodeCatalogKey(text, highlightLines = "") {
    return `${normalizeCodeKey(text)}\n${normalizeHighlightLineKey(highlightLines)}`;
  }

  function parseRenderedCodeBlocksFromHtml(html) {
    const blocks = new Map();
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll("article .highlight, .md-content .highlight").forEach((el) => {
        if (el.closest(".highlight") !== el) return; // outermost only
        const codeEl = el.querySelector("td.code code, code.md-code__content, pre > code");
        if (!codeEl) return;
        const key = renderedCodeCatalogKey(codeEl.textContent, highlightLineKeyFromRenderedCode(codeEl));
        if (key && !blocks.has(key)) blocks.set(key, el.outerHTML);
      });
    } catch (err) {
      console.warn("[DEBUG] parsing rendered code blocks failed", err);
    }
    return blocks;
  }

  async function fetchRenderedCodeCatalog(pageUrl) {
    const pathname = new URL(pageUrl || "", SITE_BASE).pathname;
    if (renderedCodeCatalog.has(pathname)) return renderedCodeCatalog.get(pathname);
    if (renderedCodeCatalogPromises.has(pathname)) return renderedCodeCatalogPromises.get(pathname);
    const job = (async () => {
      const candidates = pathname.endsWith("/")
        ? [pathname, `${pathname}index.html`]
        : [pathname, `${pathname}/`, `${pathname}/index.html`];
      for (const url of candidates) {
        try {
          const resp = await fetch(url, { credentials: "same-origin" });
          if (!resp.ok) continue;
          const blocks = parseRenderedCodeBlocksFromHtml(await resp.text());
          renderedCodeCatalog.set(pathname, blocks);
          return blocks;
        } catch (err) {
          console.warn("[DEBUG] fetching rendered code blocks for page failed", err);
        }
      }
      const empty = new Map();
      renderedCodeCatalog.set(pathname, empty);
      return empty;
    })();
    renderedCodeCatalogPromises.set(pathname, job);
    try {
      return await job;
    } finally {
      renderedCodeCatalogPromises.delete(pathname);
    }
  }

  function adaptRenderedCodeBlock(renderedHtml) {
    const holder = document.createElement("div");
    holder.innerHTML = renderedHtml;
    const block = holder.firstElementChild;
    if (!block) return null;
    // Cloned gutters do not need page-local anchors or Pygments' empty lead
    
    block.querySelectorAll(".linenodiv pre").forEach((gutter) => {
      gutter.querySelectorAll("a").forEach((anchor) => {
        anchor.replaceWith(anchor.textContent || "");
      });
      Array.from(gutter.childNodes).forEach((node) => {
        if (!node.textContent.trim()) node.remove();
      });
    });
    block.querySelectorAll("td.code pre").forEach((pre) => {
      Array.from(pre.childNodes).forEach((node) => {
        if (node.tagName !== "CODE" && !node.textContent.trim()) node.remove();
      });
    });
    block.querySelectorAll('td.code code a[id^="__codelineno"]').forEach((anchor) => anchor.remove());
    
    block.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    block.querySelectorAll("[name]").forEach((el) => el.removeAttribute("name"));
    block.querySelectorAll("nav.md-code__nav").forEach((nav) => nav.remove());
    return block;
  }

  function syncRenderedCodeGutters(root) {
    root.querySelectorAll(".highlighttable").forEach((table) => {
      const code = table.querySelector("td.code code");
      const lineHeight = Number.parseFloat(code ? getComputedStyle(code).lineHeight : "");
      if (Number.isFinite(lineHeight) && lineHeight > 0) {
        table.style.setProperty("--wl-rendered-code-line-height", lineHeight + "px");
      }
    });
  }

  async function upgradePaneCodeBlocks(root) {
    const blocks = [...root.querySelectorAll(".wl-sec-code-block:not(.wl-sec-code-block--rendered)")];
    if (!blocks.length) return;
    await Promise.all(blocks.map(async (blockEl) => {
      
      
      const pageUrl = blockEl.closest("[data-page-url]")?.dataset.pageUrl;
      const key = renderedCodeCatalogKey(blockEl.dataset.wlCode, blockEl.dataset.wlHighlightLines);
      if (!pageUrl || !key) return;
      try {
        const catalog = await fetchRenderedCodeCatalog(pageUrl);
        const renderedHtml = catalog.get(key);
        if (!renderedHtml || !blockEl.isConnected) return;
        const adapted = adaptRenderedCodeBlock(renderedHtml);
        if (!adapted) return;
        const wrapper = document.createElement("div");
        
        wrapper.className = "md-typeset wl-sec-code__rendered";
        wrapper.appendChild(adapted);
        blockEl.classList.add("wl-sec-code-block--rendered");
        const nav = document.createElement("nav");
        nav.className = "md-code__nav";
        const button = document.createElement("button");
        button.className = "md-code__button wl-sec-code__copy";
        button.type = "button";
        button.title = "Copy code";
        button.setAttribute("aria-label", "Copy code");
        nav.appendChild(button);
        blockEl.replaceChildren(wrapper, nav);
        syncRenderedCodeGutters(blockEl);
      } catch (err) {
        console.warn("[DEBUG] upgrading pane code block failed", err);
      }
    }));
  }

  function mermaidNodesInScope(el) {
    const nodes = [];
    if (el?.matches?.(".mermaid, pre.mermaid")) nodes.push(el);
    nodes.push(...Array.from(el?.querySelectorAll?.(".mermaid, pre.mermaid") || []));
    return nodes;
  }

  function mermaidNodeHasRenderableSource(node) {
    return Boolean(normalizeMermaidSource(
      node?.dataset?.knotisMermaidSource
      || sourceFromMermaidNode(node)
      || ""
    ));
  }

  function mermaidNodeExternallyRendered(node) {
    if (!node?.classList?.contains("mermaid")) return false;

    const lightSvg = node.querySelector("svg");
    if (lightSvg && !mermaidRenderLooksBroken(node)) return true;

    const shadowSvg = node.shadowRoot?.querySelector?.("svg");
    if (shadowSvg) return true;

    
    
    if (!mermaidNodeHasRenderableSource(node) && !lightSvg) {
      const height = node.offsetHeight;
      const width = node.offsetWidth;
      if (height >= 32 && width >= 80) return true;
    }
    return node.dataset.knotisMermaidExternal === "1";
  }

  function markExternalMermaidNodes(el) {
    mermaidNodesInScope(el).forEach((node) => {
      if (mermaidNodeExternallyRendered(node)) node.dataset.knotisMermaidExternal = "1";
    });
  }

  function mermaidNodeNeedsSource(node) {
    if (!node?.classList?.contains("mermaid")) return false;
    if (mermaidNodeExternallyRendered(node)) return false;
    if (node.dataset.knotisMermaidSource) return false;
    if (node.querySelector("svg") && !mermaidRenderLooksBroken(node)) return false;
    return true;
  }

  function wrapBareMermaidNode(node) {
    if (!node?.classList?.contains("mermaid") || node.closest(".wl-sec-mermaid")) return node;
    const wrapper = document.createElement("div");
    wrapper.className = "wl-sec-mermaid";
    node.replaceWith(wrapper);
    wrapper.appendChild(node);
    return node;
  }

  function clearEmptyProcessedMermaid(el) {
    mermaidNodesInScope(el).forEach((node) => {
      if (mermaidNodeExternallyRendered(node)) return;
      if (node.querySelector("svg") && !mermaidRenderLooksBroken(node)) return;
      if (node.dataset.knotisMermaidSource || normalizeMermaidSource(sourceFromMermaidNode(node))) return;
      node.removeAttribute("data-processed");
      delete node.dataset.processed;
      if (mermaidRenderLooksBroken(node)) node.textContent = "";
    });
  }

  async function recoverMermaidSourcesIfNeeded(el) {
    const needy = mermaidNodesInScope(el).filter(mermaidNodeNeedsSource);
    if (!needy.length) return 0;
    const catalog = await fetchPageMermaidSourceCatalog();
    if (!catalog.length) return 0;
    let applied = 0;
    needy.forEach((node, index) => {
      const source = catalog[index];
      if (!source) return;
      const replacement = document.createElement("div");
      replacement.className = "mermaid";
      replacement.dataset.knotisMermaidSource = source;
      replacement.textContent = source;
      node.replaceWith(replacement);
      wrapBareMermaidNode(replacement);
      applied += 1;
    });
    return applied;
  }

  function mermaidRenderLooksBroken(node) {
    const svg = node?.querySelector?.("svg");
    if (!svg) return true;
    const viewBox = svg.getAttribute("viewBox") || "";
    if (viewBox === "-8 -8 16 16") return true;
    const styleMax = svg.style.maxWidth || "";
    if (styleMax === "16px") return true;
    return svg.clientWidth < 24 && svg.clientHeight < 24;
  }

  function resetMermaidNodeForRender(node) {
    const source = normalizeMermaidSource(node.dataset.knotisMermaidSource || sourceFromMermaidNode(node) || "");
    if (!source) return null;
    const replacement = document.createElement("div");
    replacement.className = "mermaid";
    replacement.dataset.knotisMermaidSource = source;
    replacement.textContent = source;
    node.replaceWith(replacement);
    return replacement;
  }

  function ensureMermaidLayoutWidth(el) {
    const narrow = isNarrowMermaidScope(el);
    mermaidNodesInScope(el).forEach((node) => {
      wrapBareMermaidNode(node);
      const host = node.closest(".wl-sec-mermaid") || node.parentElement || node;
      if (host?.style) {
        host.style.width = "100%";
        host.style.maxWidth = "100%";
        host.style.minWidth = narrow ? "0" : "640px";
      }
      node.style.width = "100%";
      node.style.maxWidth = "100%";
      node.style.minWidth = narrow ? "0" : "640px";
    });
  }

  const MERMAID_PANE_MAX_HEIGHT_VH = 0.62;
  const MERMAID_PANE_MAX_HEIGHT_EM = 40;
  const MERMAID_PANE_MAX_WIDTH_EM = 64;

  function isNarrowMermaidScope(el) {
    return Boolean(el?.closest?.(
      ".wikilink-pane, .wikilink-card, .knotis-search"
    ));
  }

  function mermaidSvgNaturalSize(svg) {
    const viewBox = svg.getAttribute("viewBox");
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n > 0)) {
        return { width: parts[2], height: parts[3] };
      }
    }
    const width = Number.parseFloat(svg.getAttribute("width"));
    const height = Number.parseFloat(svg.getAttribute("height"));
    if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
      return { width, height };
    }
    const box = svg.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }

  function mermaidPaneMaxHeightPx() {
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return Math.min(window.innerHeight * MERMAID_PANE_MAX_HEIGHT_VH, MERMAID_PANE_MAX_HEIGHT_EM * rootSize);
  }

  function mermaidPaneMaxWidthPx(boundsEl) {
    const rootSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const emCap = MERMAID_PANE_MAX_WIDTH_EM * rootSize;
    const containerWidth = boundsEl?.clientWidth || 0;
    return containerWidth > 0 ? Math.min(containerWidth, emCap) : emCap;
  }

  function resetMermaidPaneFit(host) {
    if (!host) return;
    delete host.dataset.knotisMermaidFitScale;
    host.classList.remove("wl-sec-mermaid--pane-fit");
    const shell = host.querySelector(":scope > .wl-sec-mermaid__fit-shell");
    if (shell) {
      const inner = shell.querySelector(".wl-sec-mermaid__fit-inner");
      const mermaidNode = inner?.querySelector(".mermaid") || shell.querySelector(".mermaid");
      if (mermaidNode) host.appendChild(mermaidNode);
      shell.remove();
    }
  }

  function applyMermaidPaneSvgLimits(svg, maxHeightPx) {
    svg.style.display = "block";
    svg.style.marginInline = "auto";
    svg.style.height = "auto";
    svg.style.width = "100%";
    svg.style.maxWidth = "100%";
    svg.style.maxHeight = `${maxHeightPx}px`;
  }

  function fitMermaidHost(host, boundsEl) {
    const mermaidNode = host.querySelector(".mermaid") || host.querySelector(":scope > .mermaid");
    const svg = host.querySelector("svg");
    if (!svg || !mermaidNode || mermaidRenderLooksBroken(mermaidNode)) return;

    resetMermaidPaneFit(host);
    host.style.minWidth = "0";
    host.style.maxWidth = "100%";
    host.style.width = "100%";
    mermaidNode.style.minWidth = "0";
    mermaidNode.style.maxWidth = "100%";
    mermaidNode.style.width = "100%";

    const maxWidth = mermaidPaneMaxWidthPx(boundsEl);
    const maxHeight = mermaidPaneMaxHeightPx();
    applyMermaidPaneSvgLimits(svg, maxHeight);

    const natural = mermaidSvgNaturalSize(svg);
    if (!natural.width || !natural.height) return;

    let scale = Math.min(1, maxWidth / natural.width, maxHeight / natural.height);
    if (!Number.isFinite(scale) || scale >= 0.995) return;

    scale = Math.max(0.2, scale);
    host.classList.add("wl-sec-mermaid--pane-fit");
    host.dataset.knotisMermaidFitScale = String(scale);

    const shell = document.createElement("div");
    shell.className = "wl-sec-mermaid__fit-shell";
    shell.style.width = `${natural.width * scale}px`;
    shell.style.height = `${natural.height * scale}px`;
    shell.style.maxWidth = "100%";
    shell.style.marginInline = "auto";

    const inner = document.createElement("div");
    inner.className = "wl-sec-mermaid__fit-inner";
    inner.style.width = `${natural.width}px`;
    inner.style.height = `${natural.height}px`;
    inner.style.transform = `scale(${scale})`;
    inner.style.transformOrigin = "top left";

    host.insertBefore(shell, mermaidNode);
    inner.appendChild(mermaidNode);
    shell.appendChild(inner);
  }

  function fitMermaidToPane(container) {
    if (!container || !isNarrowMermaidScope(container)) return;
    mermaidNodesInScope(container).forEach((node) => {
      const host = node.closest(".wl-sec-mermaid") || node.parentElement;
      if (!host) return;
      const boundsEl = host.closest(
        ".wikilink-card__content, .wikilink-card__context, .md-search-result__teaser, .wikilink-pane__cards"
      ) || host;
      fitMermaidHost(host, boundsEl);
    });
  }

  function finalizeMermaidLayout(el) {
    fixMermaidSvgSizing(el);
    if (isNarrowMermaidScope(el)) fitMermaidToPane(el);
  }

  function fixMermaidSvgSizing(el) {
    mermaidNodesInScope(el).forEach((node) => {
      const svg = node.querySelector("svg");
      if (!svg) return;
      svg.style.removeProperty("max-width");
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      if (svg.getAttribute("width") === "100%") svg.removeAttribute("width");
    });
  }

  async function waitForLayout() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  async function runMermaidOnNodes(nodes) {
    if (!nodes.length) return;
    if (typeof mermaid.run === "function") {
      await Promise.resolve(mermaid.run({ nodes }));
      return;
    }
    if (typeof mermaid.init === "function") {
      await Promise.resolve(mermaid.init(undefined, nodes));
    }
  }

  function waitForMermaidRender(el, timeoutMs = 4000) {
    const needy = mermaidNodesInScope(el).filter((node) => (
      node.dataset.knotisMermaidSource && mermaidRenderLooksBroken(node)
    ));
    if (!needy.length) return Promise.resolve(true);
    return new Promise((resolve) => {
      const started = performance.now();
      const tick = () => {
        const remaining = mermaidNodesInScope(el).some((node) => (
          node.dataset.knotisMermaidSource && mermaidRenderLooksBroken(node)
        ));
        if (!remaining) {
          resolve(true);
          return;
        }
        if (performance.now() - started >= timeoutMs) {
          resolve(false);
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  async function ensurePageMermaidReady(el) {
    const root = el
      || document.querySelector(".md-content__inner")
      || document.querySelector("article.md-typeset")
      || document.querySelector("article")
      || document.querySelector(".md-content");
    if (!root) return false;
    clearEmptyProcessedMermaid(root);
    await recoverMermaidSourcesIfNeeded(root);
    await renderMermaidInElement(root);
    return waitForMermaidRender(root);
  }

  window.KnotisMermaid = {
    config: buildMermaidConfig,
    configure: ensureMermaidConfigured,
    capture: captureMermaidSources,
    source: sourceFromMermaidNode,
    prepare: prepareMermaidBlocks,
    hydrate: hydrateMermaidFromCache,
    cache: cacheRenderedMermaid,
    normalize: normalizeMermaidSource,
    recover: recoverMermaidSourcesIfNeeded,
    ensureReady: ensurePageMermaidReady,
    render: renderMermaidInElement,
    fitToPane: fitMermaidToPane,
    looksBroken: mermaidRenderLooksBroken,
    isExternal: mermaidNodeExternallyRendered,
    svgHtml: mermaidSvgHtmlFromNode,
    syncCache: syncPageMermaidCache,
  };

  function resolveInitialWindow(sectionLines, kwOffset, paneConfig = FALLBACK_PANE_CONFIG, options = {}) {
    const lines = Array.isArray(sectionLines) ? sectionLines : [];
    const entry = {
      section_lines: lines,
      section_lines_raw: lines,
      section_kw_offset: Number.isInteger(kwOffset) ? kwOffset : 0,
    };
    const range = resolveDefaultSectionRange(
      entry,
      options.sectionParts || [],
      normalizePaneConfig(paneConfig),
      options
    );
    const displayStart = adjustSectionSliceStart(
      lines,
      range.start,
      range.end,
      options.sectionParts || [],
      normalizePaneConfig(paneConfig)
    );
    return { ...range, displayStart };
  }

  function renderInitialWindow(sectionLines, kwOffset, opts = {}) {
    const paneConfig = normalizePaneConfig(opts.paneConfig || FALLBACK_PANE_CONFIG);
    const lines = Array.isArray(sectionLines) ? sectionLines : [];
    const kw = Number.isInteger(kwOffset) ? kwOffset : 0;
    const window = resolveInitialWindow(lines, kw, paneConfig, opts);
    const displayStart = window.displayStart;
    const ownSection = paneConfig.keyword_own_section ? resolveOwnSectionWindow(lines, kw) : null;
    const ownSectionEnd = ownSection ? ownSection.end : lines.length;
    return renderSectionLines(
      lines.slice(displayStart, window.end),
      opts.pageUrl || "",
      opts.keyword || "",
      seedOrderedState(lines, displayStart),
      {
        ...(opts.renderOpts || {}),
        renderMode: opts.renderMode || opts.renderOpts?.renderMode || "search",
        sourceLines: lines,
        baseLineIndex: displayStart,
        sectionParts: opts.sectionParts || [],
        skipDuplicateHeadings: paneConfig.skip_duplicate_headings !== false,
        leaveListsOpen: shouldLeaveListsOpen(lines, window.end, ownSectionEnd),
      }
    );
  }

  window.KnotisSectionRender = {
    resolveInitialWindow,
    renderInitialWindow,
    wrapMarkdownSurface: wrapPaneMarkdownSurface,
    normalizePaneConfig,
    renderSectionBreadcrumb,
    renderLines(lines, pageUrl, renderOpts = {}) {
      const sourceLines = Array.isArray(lines)
        ? lines
        : String(lines || "").split(/\r?\n/);
      return renderStructuredMarkdown(
        sourceLines,
        pageUrl || "",
        renderOpts.keyword || "",
        null,
        {
          ...renderOpts,
          renderMode: renderOpts.renderMode || "search",
        },
      );
    },
    setPendingNavigation(href, targetText) {
      setPendingContextNavigation(href, targetText);
    },
    normalizeSectionWindow,
    sectionElementsFromHash,
    scrollToContextTarget,
    upgradePaneCodeBlocks,
  };

  function dedentText(text) {
    const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    const nonEmpty = lines.filter((line) => line.trim());
    const minIndent = nonEmpty.length
      ? Math.min(...nonEmpty.map((line) => line.match(/^[ \t]*/)[0].replace(/\t/g, "  ").length))
      : 0;
    return lines.map((line) => line.replace(new RegExp(`^[ \\t]{0,${minIndent}}`), "")).join("\n").trim();
  }

  function normalizeMermaidSource(source) {
    return dedentText(source).replace(/[ \t]+$/gm, "");
  }

  function prepareMermaidNode(node) {
    if (!node || !node.classList?.contains("mermaid")) return;
    const source = node.dataset.knotisMermaidSource || sourceFromMermaidNode(node);
    if (source && !node.dataset.knotisMermaidSource) node.dataset.knotisMermaidSource = normalizeMermaidSource(source);
    if (node.hasAttribute("data-processed") && source && !node.querySelector("svg")) {
      node.textContent = normalizeMermaidSource(source);
      node.removeAttribute("data-processed");
      delete node.dataset.processed;
    }
  }

  function sourceFromMermaidNode(node) {
    if (!node?.classList?.contains("mermaid")) return "";
    if (node.dataset.knotisMermaidSource) return node.dataset.knotisMermaidSource;
    const code = node.querySelector?.("code");
    if (code) return code.textContent || "";
    if (node.hasAttribute("data-processed") || node.querySelector?.("svg")) return "";
    return node.textContent || "";
  }

  function captureMermaidSources(el) {
    const nodes = [];
    if (el.matches?.(".mermaid")) nodes.push(el);
    nodes.push(...Array.from(el.querySelectorAll?.(".mermaid") || []));
    nodes.forEach((node) => {
      if (node.dataset.knotisMermaidSource) return;
      const source = normalizeMermaidSource(sourceFromMermaidNode(node));
      if (source) node.dataset.knotisMermaidSource = source;
    });
  }

  function mermaidSvgLooksLikeSvg(html) {
    return /<svg[\s>]/i.test(String(html || ""));
  }

  function pageMermaidHostsInDocumentOrder(el) {
    const hosts = [];
    mermaidNodesInScope(el).forEach((node) => {
      if (node.matches?.("pre.mermaid")) hosts.push(node);
      else if (node.classList.contains("mermaid") && !node.closest("pre.mermaid")) hosts.push(node);
    });
    return hosts;
  }

  function mermaidSvgHtmlFromNode(node) {
    if (!node) return "";
    const lightSvg = node.querySelector?.("svg");
    if (lightSvg && !mermaidRenderLooksBroken(node)) {
      const html = node.innerHTML.trim();
      if (mermaidSvgLooksLikeSvg(html)) return html;
    }
    const shadowSvg = node.shadowRoot?.querySelector?.("svg");
    if (shadowSvg) return shadowSvg.outerHTML;
    const sourceKey = normalizeMermaidSource(node.dataset.knotisMermaidSource || "");
    if (sourceKey) {
      const cached = mermaidRenderCache.get(sourceKey);
      if (mermaidSvgLooksLikeSvg(cached)) return cached;
    }
    return "";
  }

  async function syncPageMermaidCache(el) {
    const root = el
      || document.querySelector(".md-content__inner")
      || document.querySelector("article.md-typeset")
      || document.querySelector("article")
      || document.querySelector(".md-content");
    if (!root) return;
    markExternalMermaidNodes(root);
    let catalog = mermaidSourceCatalog.get(pagePathnameForMermaidCatalog());
    if (!catalog) catalog = await fetchPageMermaidSourceCatalog();
    pageMermaidHostsInDocumentOrder(root).forEach((node, index) => {
      if (!node.dataset.knotisMermaidSource && catalog[index]) {
        node.dataset.knotisMermaidSource = normalizeMermaidSource(catalog[index]);
      }
      const sourceKey = normalizeMermaidSource(node.dataset.knotisMermaidSource || catalog[index] || "");
      const html = mermaidSvgHtmlFromNode(node);
      if (html && sourceKey && mermaidSvgLooksLikeSvg(html)) mermaidRenderCache.set(sourceKey, html);
    });
  }

  function cacheRenderedMermaid(el) {
    captureMermaidSources(el);
    pageMermaidHostsInDocumentOrder(el).forEach((node) => {
      const sourceKey = normalizeMermaidSource(node.dataset.knotisMermaidSource || "");
      if (!sourceKey) return;
      const html = mermaidSvgHtmlFromNode(node);
      if (html && mermaidSvgLooksLikeSvg(html)) mermaidRenderCache.set(sourceKey, html);
    });
  }

  function cachePageMermaids() {
    const root = document.querySelector(".md-content__inner")
      || document.querySelector("article.md-typeset")
      || document.querySelector("article")
      || document.querySelector(".md-content");
    if (root) {
      captureMermaidSources(root);
      cacheRenderedMermaid(root);
    }
  }

  function findRenderedMermaidHtml(sourceKey, excludeRoot = null) {
    const root = document.querySelector(".md-content__inner")
      || document.querySelector("article.md-typeset")
      || document.querySelector("article")
      || document.querySelector(".md-content");
    if (!root || !sourceKey) return "";
    captureMermaidSources(root);
    const nodes = [];
    if (root.matches?.(".mermaid[data-knotis-mermaid-source]")) nodes.push(root);
    nodes.push(...Array.from(root.querySelectorAll?.(".mermaid[data-knotis-mermaid-source]") || []));
    for (const node of nodes) {
      if (excludeRoot && (node === excludeRoot || excludeRoot.contains?.(node))) continue;
      const nodeKey = normalizeMermaidSource(node.dataset.knotisMermaidSource || "");
      if (nodeKey !== sourceKey) continue;
      const html = mermaidSvgHtmlFromNode(node);
      if (!mermaidSvgLooksLikeSvg(html)) continue;
      mermaidRenderCache.set(sourceKey, html);
      return html;
    }
    return "";
  }

  function hydrateMermaidFromCache(el) {
    const nodes = [];
    if (el.matches?.(".mermaid")) nodes.push(el);
    nodes.push(...Array.from(el.querySelectorAll?.(".mermaid") || []));
    let hydrated = 0;
    nodes.forEach((node) => {
      if (node.querySelector("svg")) return;
      const sourceKey = normalizeMermaidSource(node.dataset.knotisMermaidSource || sourceFromMermaidNode(node) || "");
      const cached = sourceKey ? mermaidRenderCache.get(sourceKey) || findRenderedMermaidHtml(sourceKey, el) : "";
      if (!mermaidSvgLooksLikeSvg(cached)) return;
      node.dataset.knotisMermaidSource = sourceKey;
      node.innerHTML = cached;
      node.setAttribute("data-processed", "true");
      hydrated += 1;
    });
    return hydrated;
  }

  
  
  function prepareMermaidBlocks(el) {
    captureMermaidSources(el);
    const pres = [];
    if (el.matches?.("pre.mermaid:not([data-wl-mermaid-prepared])")) pres.push(el);
    pres.push(...Array.from(el.querySelectorAll?.("pre.mermaid:not([data-wl-mermaid-prepared])") || []));
    pres.forEach((pre) => {
      if (mermaidNodeExternallyRendered(pre)) {
        pre.dataset.wlMermaidPrepared = "true";
        return;
      }
      const code = pre.querySelector("code");
      const source = normalizeMermaidSource(
        pre.dataset.knotisMermaidSource || (code ? code.textContent : pre.textContent) || ""
      );
      if (!source) {
        pre.dataset.wlMermaidPrepared = "true";
        return;
      }
      const wrapper = document.createElement("div");
      wrapper.className = "wl-sec-mermaid";
      const diagram = document.createElement("div");
      diagram.className = "mermaid";
      diagram.textContent = source;
      diagram.dataset.knotisMermaidSource = source;
      wrapper.appendChild(diagram);
      pre.dataset.wlMermaidPrepared = "true";
      pre.replaceWith(wrapper);
    });
    mermaidNodesInScope(el).forEach((node) => {
      if (node.matches?.("pre.mermaid")) return;
      if (node.querySelector("svg") && !mermaidRenderLooksBroken(node)) return;
      if (mermaidNodeExternallyRendered(node)) return;
      const source = normalizeMermaidSource(node.dataset.knotisMermaidSource || sourceFromMermaidNode(node) || "");
      if (!source) return;
      node.dataset.knotisMermaidSource = source;
      node.textContent = source;
      node.removeAttribute("data-processed");
      delete node.dataset.processed;
      wrapBareMermaidNode(node);
    });
  }

  function isSlideMermaidScope(el) {
    return Boolean(el?.closest?.(
      ".knotis-slides, .knotis-slides__stage, .knotis-slides__card, .knotis-slides__measure, .knotis-slides__preview"
    ));
  }

  async function renderMermaidInElement(el) {
    if (typeof mermaid === "undefined") return;
    if (isSlideMermaidScope(el)) {
      hydrateMermaidFromCache(el);
      fixMermaidSvgSizing(el);
      return;
    }
    clearEmptyProcessedMermaid(el);
    await waitForLayout();
    markExternalMermaidNodes(el);
    await recoverMermaidSourcesIfNeeded(el);
    captureMermaidSources(el);
    cachePageMermaids();
    prepareMermaidBlocks(el);
    hydrateMermaidFromCache(el);
    if (!ensureMermaidConfigured()) return;
    if (el.matches?.(".mermaid")) prepareMermaidNode(el);
    el.querySelectorAll?.(".mermaid").forEach((node) => prepareMermaidNode(node));
    hydrateMermaidFromCache(el);
    markExternalMermaidNodes(el);
    mermaidNodesInScope(el).forEach((node) => {
      if (mermaidNodeExternallyRendered(node)) return;
      const source = normalizeMermaidSource(node.dataset.knotisMermaidSource || sourceFromMermaidNode(node) || "");
      if (!source) return;
      if (!node.querySelector("svg") || mermaidRenderLooksBroken(node)) {
        const replacement = resetMermaidNodeForRender(node);
        if (replacement) wrapBareMermaidNode(replacement);
      }
    });
    ensureMermaidLayoutWidth(el);
    await waitForLayout();
    markExternalMermaidNodes(el);
    mermaidNodesInScope(el).forEach((node) => {
      if (mermaidNodeExternallyRendered(node)) return;
      const source = normalizeMermaidSource(node.dataset.knotisMermaidSource || "");
      if (!source) return;
      if (!node.querySelector("svg") || mermaidRenderLooksBroken(node)) {
        node.removeAttribute("data-processed");
        delete node.dataset.processed;
      }
    });
    const pending = mermaidNodesInScope(el).filter((node) => (
      !mermaidNodeExternallyRendered(node)
      && normalizeMermaidSource(node.dataset.knotisMermaidSource || "")
      && !node.hasAttribute("data-processed")
      && !node.querySelector("svg")
    ));
    if (pending.length) {
      await runMermaidOnNodes(pending);
      fixMermaidSvgSizing(el);
      const broken = pending.filter((node) => mermaidRenderLooksBroken(node));
      if (broken.length) {
        broken.forEach((node) => {
          const replacement = resetMermaidNodeForRender(node);
          if (replacement) wrapBareMermaidNode(replacement);
        });
        ensureMermaidLayoutWidth(el);
        await waitForLayout();
        const retry = mermaidNodesInScope(el).filter((node) => (
          !mermaidNodeExternallyRendered(node)
          && normalizeMermaidSource(node.dataset.knotisMermaidSource || "")
          && !node.hasAttribute("data-processed")
          && !node.querySelector("svg")
        ));
        await runMermaidOnNodes(retry);
      }
    }
    finalizeMermaidLayout(el);
    cacheRenderedMermaid(el);
    await syncPageMermaidCache(el);
  }

  function wrapPaneMarkdownSurface(html) {
    const body = String(html || "");
    if (!body.trim()) return body;
    return `<div class="md-content"><div class="md-typeset heading-flow__content">${body}</div></div>`;
  }

  function resetPaneListStack(state) {
    state.listDepthStack = [];
  }

  function closePaneListsDownTo(state, targetDepth) {
    let html = "";
    if (!Array.isArray(state.listDepthStack)) state.listDepthStack = [];
    while (state.listDepthStack.length > targetDepth) {
      const tag = state.listDepthStack.pop();
      html += `</li></${tag}>`;
    }
    return html;
  }

  function closeAllPaneLists(state) {
    return closePaneListsDownTo(state, 0);
  }

  function paneListDepthFromIndent(indent, renderOpts = {}) {
    const relative = paneRelativeIndent(indent, renderOpts);
    return Math.max(1, Math.floor(relative / 4) + 1);
  }

  function paneListDepthForLine(indent, renderOpts = {}, lineIndex = null) {
    const lines = renderOpts.sourceLines;
    if (!Array.isArray(lines) || !Number.isInteger(lineIndex) || !lineHasListMarker(lines[lineIndex])) {
      return paneListDepthFromIndent(indent, renderOpts);
    }
    const baseIndent = paneListIndentBase(renderOpts);
    let depth = 1;
    let current = lineIndex;
    const seen = new Set([current]);
    while (true) {
      const parent = findPaneListParentLineIndex(lines, current);
      if (parent < 0 || seen.has(parent)) break;
      if (blockLineIndent(lines[parent]) < baseIndent) break;
      depth++;
      seen.add(parent);
      current = parent;
    }
    return depth;
  }

  function seedPaneListStack(state, indent, tag) {
    const listDepth = paneListDepthFromIndent(indent);
    if (!Array.isArray(state.listDepthStack)) state.listDepthStack = [];
    while (state.listDepthStack.length > listDepth) state.listDepthStack.pop();
    while (state.listDepthStack.length < listDepth) state.listDepthStack.push(tag);
  }

  function paneOrderedCounterLevelForOpen(state, listDepth) {
    const ancestors = Array.isArray(state.listDepthStack)
      ? state.listDepthStack.slice(0, Math.max(0, listDepth - 1))
      : [];
    return Math.max(1, Math.min(7, ancestors.filter((tag) => tag === "ol").length + 1));
  }

  function renderPaneListItem(state, indent, tag, lineBody, contentHtml, renderOpts, lineIndex) {
    const listDepth = paneListDepthForLine(indent, renderOpts, lineIndex);
    const outlineDepth = outlineDepthFromIndent(indent, renderOpts);
    const focusAttrs = focusTargetAttrs(renderOpts, lineIndex);
    let annotationAttrs = "";
    let displayNumber = 1;
    if (tag === "ol") {
      if (state.annotationPending) {
        state.annotationDepth = outlineDepth;
        state.annotationPending = false;
      } else if (state.annotationDepth !== null && outlineDepth !== state.annotationDepth) {
        state.annotationDepth = null;
      }
      displayNumber = resolveOrderedDisplayNumber(state, outlineDepth, String(renderOpts._paneListStart || ""));
      if (state.annotationDepth === outlineDepth) {
        annotationAttrs = ` data-wl-annotation="${displayNumber}"`;
      }
    }
    const liAttrs = ` class="wl-nav-target wl-pane-list-item"${navTargetData(lineBody)}${annotationAttrs}${focusAttrs}`;
    let html = "";

    if (!Array.isArray(state.listDepthStack)) state.listDepthStack = [];

    function orderedListStartAttrs(targetListDepth) {
      if (tag !== "ol") return "";
      const counterLevel = paneOrderedCounterLevelForOpen(state, targetListDepth);
      return ` start="${displayNumber}" style="--knotis-ol-start:${Math.max(0, displayNumber - 1)}; counter-reset:level${counterLevel} var(--knotis-ol-start)"`;
    }

    if (renderOpts._continuingList) {
      renderOpts._continuingList = false;
      if (listDepth < state.listDepthStack.length) {
        html += closePaneListsDownTo(state, listDepth);
      }
      if (listDepth === state.listDepthStack.length) {
        return `${html}<li${liAttrs}>${contentHtml}`;
      }
    }

    if (listDepth > state.listDepthStack.length) {
      const targetDepth = listDepth;
      for (let d = state.listDepthStack.length; d < targetDepth; d++) {
        const isInnermost = d === targetDepth - 1;
        const openAttrs = isInnermost ? orderedListStartAttrs(d + 1) : "";
        if (isInnermost) {
          html += `<${tag}${openAttrs}><li${liAttrs}>`;
        } else {
          html += `<${tag}><li class="knotis-nested-list-shell">`;
        }
        state.listDepthStack.push(tag);
      }
      html += contentHtml;
    } else if (listDepth < state.listDepthStack.length) {
      html += closePaneListsDownTo(state, listDepth);
      if (state.listDepthStack.length === listDepth && state.listDepthStack[listDepth - 1] !== tag) {
        html += closePaneListsDownTo(state, listDepth - 1);
        html += `<${tag}${orderedListStartAttrs(listDepth)}><li${liAttrs}>${contentHtml}`;
        state.listDepthStack.push(tag);
      } else if (state.listDepthStack.length === listDepth) {
        html += `</li><li${liAttrs}>${contentHtml}`;
      }
    } else if (state.listDepthStack[listDepth - 1] !== tag) {
      html += closePaneListsDownTo(state, listDepth - 1);
      html += `<${tag}${orderedListStartAttrs(listDepth)}><li${liAttrs}>${contentHtml}`;
      state.listDepthStack.push(tag);
    } else {
      html += `</li><li${liAttrs}>${contentHtml}`;
    }
    return html;
  }

  
  function renderSectionLine(line, pageUrl, keyword, state, renderOpts = {}, lineIndex = null) {
    const trimmed = line.trim();
    if (!trimmed) return `${closeAllPaneLists(state)}<div class="wl-sec-gap"></div>`;
    const lineRenderOpts = paneLineRenderOpts(renderOpts, lineIndex);
    const indent = blockLineIndent(line);
    const depth = outlineDepthFromIndent(indent, lineRenderOpts);
    const focusAttrs = focusTargetAttrs(renderOpts, lineIndex);

    if (isHtmlCommentLine(trimmed)) return "";

    
    if (/^\|[\s\-:|]+\|$/.test(trimmed)) return "";

    
    const hm = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (hm) {
      if (renderOpts.skipDuplicateHeadings !== false
          && Array.isArray(renderOpts.sectionParts)
          && headingMatchesBreadcrumb(trimmed, renderOpts.sectionParts)) {
        return "";
      }
      clearOrderedCounters(state, 0);
      resetOutlineLayout(state);
      resetPaneListStack(state);
      const lvl = hm[1].length;
      const headingBody = stripKnotisMetadataAttrs(hm[2]);
      const html = renderInlineMarkdown(
        highlightKeywordInHeadingText(headingBody, keyword, { ...lineRenderOpts, sourceHeadingLine: trimmed }),
        pageUrl,
        renderOpts,
      );
      return `${closeAllPaneLists(state)}<div class="wl-sec-h wl-sec-h${lvl} wl-nav-target"${navTargetData(headingBody)}${focusAttrs}>${html}</div>`;
    }

    
    const bm = line.match(/^(\s*)[-*+]\s+(.*)/);
    if (bm) {
      clearOrderedCounters(state, depth + 1);
      if (markerlessListItemContent(bm[2])) {
        return renderMarkerlessListItem(line, indent, bm[2], pageUrl, keyword, state, lineRenderOpts, focusAttrs, lineIndex);
      }
      const html = renderInlineMarkdown(highlightSectionLineText(bm[2], keyword, lineRenderOpts, line), pageUrl, renderOpts);
      return renderPaneListItem(state, indent, "ul", bm[2], html, lineRenderOpts, lineIndex);
    }

    
    const nm = line.match(/^(\s*)(\d+)\.\s+(.*)/);
    if (nm) {
      if (markerlessListItemContent(nm[3])) {
        return renderMarkerlessListItem(line, indent, nm[3], pageUrl, keyword, state, lineRenderOpts, focusAttrs, lineIndex);
      }
      clearOrderedCounters(state, depth + 1);
      const html = renderInlineMarkdown(highlightSectionLineText(nm[3], keyword, lineRenderOpts, line), pageUrl, renderOpts);
      return renderPaneListItem(state, indent, "ol", nm[3], html, { ...lineRenderOpts, _paneListStart: nm[2] }, lineIndex);
    }

    
    if (trimmed.startsWith("|")) {
      let listPrefix = "";
      if (indent === 0) {
        clearOrderedCounters(state, 0);
        listPrefix = closeAllPaneLists(state);
      }
      const cells = trimmed.replace(/^\||\|$/g, "").split("|")
        .map(c => `<span class="wl-sec-td">${renderInlineMarkdown(highlightKeyword(c.trim(), keyword, renderOpts), pageUrl, renderOpts)}</span>`)
        .join('<span class="wl-sec-pipe">│</span>');
      const rowHtml = `<div class="wl-sec-row wl-nav-target"${navTargetData(trimmed)}${focusAttrs}>${cells}</div>`;
      return listPrefix + (indent > 0
        ? renderPaneListItem(state, indent, "ul", trimmed, rowHtml, renderOpts, lineIndex)
        : `<div class="wl-sec-row wl-sec-outline-block wl-nav-target"${outlineBlockAttrs(state, depth)}${navTargetData(trimmed)}${focusAttrs}>${cells}</div>`);
    }

    
    
    
    if (isBareHtmlWrapperLine(trimmed)) {
      if (indent === 0) clearOrderedCounters(state, 0);
      state.annotationPending = false;
      state.annotationDepth = null;
      return "";
    }

    
    
    if (trimmed.startsWith("![")) {
      state.annotationPending = false;
      state.annotationDepth = null;
      const html = renderInlineMarkdown(highlightKeywordForInlineMarkdown(trimmed, keyword, renderOpts), pageUrl, renderOpts);
      if (indent > 0) {
        return renderPaneListItem(state, indent, "ul", trimmed, html, renderOpts, lineIndex);
      }
      const listPrefix = closeAllPaneLists(state);
      return `${listPrefix}<div class="wl-sec-prose wl-sec-outline-block wl-nav-target"${outlineBlockAttrs(state, depth)}${navTargetData(trimmed)}${focusAttrs}>${html}</div>`;
    }

    
    
    
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      if (indent === 0) clearOrderedCounters(state, 0);
      state.annotationPending = false;
      state.annotationDepth = null;
      return "";
    }

    
    if (indent === 0) clearOrderedCounters(state, 0);
    state.annotationPending = false;
    state.annotationDepth = null;
    const html = renderInlineMarkdown(highlightKeywordForInlineMarkdown(trimmed, keyword, renderOpts), pageUrl, renderOpts);
    const listPrefix = indent === 0 ? closeAllPaneLists(state) : "";
    return `${listPrefix}<div class="wl-sec-prose wl-sec-outline-block wl-nav-target"${outlineBlockAttrs(state, depth)}${navTargetData(trimmed)}${focusAttrs}>${html}</div>`;
  }

  
  
  
  
  function renderSectionLines(lines, pageUrl, keyword, initialState = null, renderOpts = {}) {
    return renderStructuredMarkdown(lines, pageUrl, keyword, initialState, renderOpts);
  }

  function renderContextText(text, pageUrl, keyword, renderOpts = {}) {
    return renderStructuredMarkdown(String(text || "").split(/\r?\n/), pageUrl, keyword, null, renderOpts);
  }

  function paneCardId(entry, keyword, opts = {}) {
    const keywordPart = Array.isArray(keyword) ? keyword.join("-") : keyword;
    const edgePairPart = Array.isArray(entry._edgePair) ? entry._edgePair.join("-") : "";
    const raw = [
      entry.page_url || "",
      opts.renderMode || "",
      keywordPart || "",
      entry.occurrence_index ?? "",
      entry.section_kw_offset ?? "",
      edgePairPart,
      (entry.heading_path || []).join("-"),
    ].join("-");
    const slug = raw.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
    return `wlc-${slug || "card"}`;
  }

  

  
  
  function buildCard(entry, keyword, opts = {}) {
    const paneConfig = normalizePaneConfig(opts.paneConfig || FALLBACK_PANE_CONFIG);
    const fullSection = Boolean(opts.fullSection);
    const focusOccurrenceIndex = Number.parseInt(opts.focusOccurrenceIndex, 10);
    const isFocusedEntry = opts.focusPageUrl
      && !Number.isNaN(focusOccurrenceIndex)
      && entry.page_url === opts.focusPageUrl
      && (entry.occurrence_index || 0) === focusOccurrenceIndex;
    const selfNavOccurrenceIndex = Array.isArray(opts.allEntries)
      ? findHeadingOccurrenceIndex(opts.allEntries, keyword, entry.page_url)
      : null;
    const renderOpts = {
      renderMode: opts.renderMode || "keyword",
      pageTitle: entry.page_title,
      focusPageUrl: entry.page_url,
      focusOccurrenceIndex: entry.occurrence_index,
      selfNavOccurrenceIndex,
      initialFocusLineIndex: isFocusedEntry ? (entry.section_kw_offset || 0) : null,
    };
    const primaryKw = Array.isArray(keyword) ? keyword[0] : keyword;
    const anchorBase = String(primaryKw || "").startsWith("#")
      ? contentTagToId(primaryKw)
      : kwToId(primaryKw);
    const anchor = `${anchorBase}-${entry.occurrence_index || 0}`;
    const href   = `/${entry.page_url}#${anchor}`;

    
    let sectionParts = [];
    if (opts.renderMode === "edge") {
      sectionParts = resolveEdgeCardSectionParts(entry, paneConfig);
    } else {
      const logseqParts = (entry.parent_chain || [])
        .filter((t) => /^#+\s/.test(t))
        .map((t) => t.replace(/^#+\s*/, ""));
      if (logseqParts.length) {
        sectionParts = logseqParts;
      } else if (entry._hierarchyEdgeCard && entry._edgeChildEntry?.heading_path?.length) {
        sectionParts = entry._edgeChildEntry.heading_path;
      } else if (entry.heading_path && entry.heading_path.length) {
        sectionParts = entry.heading_path;
      }
    }
    const sectionLines = getEntrySectionLines(entry);
    const sectionBreadcrumb = renderSectionBreadcrumb(sectionParts, { keyword, renderOpts, sectionLines });
    const sectionIsPageTitle = sectionBreadcrumb.text
      && normalizeContextTitleText(sectionBreadcrumb.text) === normalizeContextTitleText(entry.page_title);
    const sectionHtml = sectionParts.length && !sectionIsPageTitle
      ? `<p class="wikilink-card__section">${sectionBreadcrumb.html}</p>`
      : "";
    const sectionLabel = sectionParts.length
      ? sectionBreadcrumb.html
      : escapeHtml(entry.page_title);
    const groupedTitleRepeatsPage = opts.grouped && (!sectionParts.length || sectionIsPageTitle);
    renderOpts.sectionParts = sectionParts;
    renderOpts.skipDuplicateHeadings = paneConfig.skip_duplicate_headings !== false;

    
    const cardId = paneCardId(entry, keyword, opts);
    const hasSection = sectionLines.length > 0;

    
    
    
    
    
    let viewHtml;
    if (hasSection) {
      if (entry._hierarchyEdgeCard) {
        viewHtml = buildHierarchyEdgeView(entry, keyword, cardId, sectionParts, paneConfig, renderOpts);
      } else {
        const lines = sectionLines;
        const edgeViewHtml = Array.isArray(keyword)
          ? buildCooccurrenceEdgeView(entry, keyword, cardId, sectionParts, paneConfig, renderOpts)
          : null;
        if (edgeViewHtml) {
          viewHtml = edgeViewHtml;
        } else {
        const range = resolveCardSectionRange(entry, sectionParts, paneConfig, fullSection);
        const { start, end } = range;
        const displayStart = adjustSectionSliceStart(lines, start, end, sectionParts, paneConfig);
        const kwOffset = entry.section_kw_offset || 0;
        const ownSection = paneConfig.keyword_own_section
          ? resolveOwnSectionWindow(lines, kwOffset)
          : null;
        const ownSectionEnd = ownSection ? ownSection.end : lines.length;
        if (fullSection) {
          viewHtml = renderSectionLines(
            lines.slice(displayStart, end),
            entry.page_url,
            keyword,
            seedOrderedState(lines, displayStart),
            {
              ...renderOpts,
              sourceLines: lines,
              baseLineIndex: displayStart,
              leaveListsOpen: shouldLeaveListsOpen(lines, end, ownSectionEnd),
            },
          );
        } else {
          viewHtml = renderInitialWindow(lines, kwOffset, {
            pageUrl: entry.page_url,
            keyword,
            paneConfig,
            sectionParts,
            renderOpts: {
              ...renderOpts,
              leaveListsOpen: shouldLeaveListsOpen(lines, end, ownSectionEnd),
            },
          });

          
          
          
          
          if (ownSection && ownSectionBodyIsEmpty(lines, ownSection)) {
            const childHeadingLines = findDirectChildHeadingLines(lines, ownSection);
            if (childHeadingLines.length) {
              const childLines = childHeadingLines.flatMap((line, idx) => (idx === 0 ? [line] : ["", line]));
              viewHtml += renderSectionLines(
                childLines,
                entry.page_url,
                keyword,
                seedOrderedState(lines, ownSection.end),
                {
                  ...renderOpts,
                  sourceLines: lines,
                  baseLineIndex: ownSection.end,
                  sectionParts,
                  skipDuplicateHeadings: paneConfig.skip_duplicate_headings !== false,
                },
              );
            }
          }
        }

        cardStore.set(cardId, makeCardRecord({
          lines,
          kwOffset,
          displayStart,
          displayEnd:   end,
          nextStart:    end,
          initialDisplayStart: displayStart,
          initialNextStart:    end,
          ownSectionStart: ownSection ? ownSection.start : 0,
          ownSectionEnd: ownSection ? ownSection.end : lines.length,
          beforeRanges: [],
          chunkRanges:  [],
          keyword,
          pageUrl:      entry.page_url,
          renderOpts,
          chunkLines:   paneConfig.chunk_lines,
          sectionParts,
          skipDuplicateHeadings: paneConfig.skip_duplicate_headings,
          windowMode: !fullSection,
        }));
        }
      }
    } else {
      
      viewHtml = renderContextText(entry.context, entry.page_url, keyword, renderOpts);
    }

    
    const st = hasSection ? cardStore.get(cardId) : null;
    const controls = hasSection && !opts.hideControls && paneConfig.show_context_controls !== false
      ? `<div class="wikilink-card__controls">
           <button class="wikilink-card__ctx-btn wikilink-card__ctx-less" aria-label="Scroll up">&#8593;</button>
           <button class="wikilink-card__ctx-btn wikilink-card__ctx-more" aria-label="Scroll down">&#8595;</button>
         </div>`
      : "";

    const headerTitleHtml = opts.grouped
      ? (groupedTitleRepeatsPage ? "" : `<a class="wikilink-card__page wikilink-card__page--section" href="${escapeHtml(href)}">${sectionLabel}</a>`)
      : `<a class="wikilink-card__page" href="${escapeHtml(href)}">${escapeHtml(entry.page_title)}</a>`;
    const bodySectionHtml = opts.grouped ? "" : sectionHtml;
    const headerActionsHtml = `
      <div class="wikilink-card__header-actions">
        ${controls}
        <button class="wikilink-card__minimize" aria-label="Minimize" title="Minimize">&#8722;</button>
      </div>`;

    const suppressedTitleClass = opts.grouped && groupedTitleRepeatsPage ? " wikilink-card--title-suppressed" : "";

    return `
    <div class="wikilink-card${suppressedTitleClass}" data-card-id="${escapeHtml(cardId)}">
      <div class="wikilink-card__header">
        ${headerTitleHtml}
        ${headerActionsHtml}
      </div>
      <div class="wikilink-card__body">
        ${bodySectionHtml}
        <div class="wikilink-card__content">
          <div class="wikilink-card__section-view">
            <div class="wikilink-card__context" data-href="${escapeHtml(href)}" role="link" tabindex="0">${wrapPaneMarkdownSurface(viewHtml)}</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function compareEntriesByNavOrder(a, b, navOrder = {}) {
    const aIdx = navOrder[a.page_url] ?? 999999;
    const bIdx = navOrder[b.page_url] ?? 999999;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return (a.occurrence_index || 0) - (b.occurrence_index || 0);
  }

  function getPageMatchCandidates(pageUrl) {
    const clean = (pageUrl || "").replace(/^\//, "");
    if (!clean || clean === "./") return new Set(["./", "index.md"]);

    const trimmed = clean.endsWith("/") ? clean.slice(0, -1) : clean;
    const lastSegment = trimmed.split("/").filter(Boolean).pop() || trimmed;
    return new Set([
      clean,
      trimmed,
      `${trimmed}.md`,
      `${trimmed}/index.md`,
      `${lastSegment}.md`,
      `${lastSegment}/index.md`,
    ]);
  }

  function getPinnedPageRank(entry, configuredPages = []) {
    const candidates = getPageMatchCandidates(entry.page_url);
    for (let i = 0; i < configuredPages.length; i += 1) {
      const token = String(configuredPages[i] || "").trim().replace(/^\//, "");
      if (!token) continue;
      for (const candidate of candidates) {
        if (candidate === token || candidate.endsWith(token)) return i;
      }
    }
    return -1;
  }

  function getOrderedPageRank(entry, configuredPages = []) {
    const rank = getPinnedPageRank(entry, configuredPages);
    return rank >= 0 ? rank : configuredPages.length;
  }

  function applyPaneContextScope(entries, paneConfig = {}, navOrder = {}) {
    const currentUrl = getCurrentPageUrl();
    const contextScope = paneConfig.context_scope || "current_page_first";
    const sorted = [...entries].sort((a, b) => compareEntriesByNavOrder(a, b, navOrder));
    let scoped = sorted;
    if (contextScope === "current_page_only") {
      scoped = sorted.filter((entry) => entry.page_url === currentUrl);
    } else if (contextScope === "current_page_first") {
      scoped = sorted.sort((a, b) => {
        const aCurrent = a.page_url === currentUrl ? 0 : 1;
        const bCurrent = b.page_url === currentUrl ? 0 : 1;
        if (aCurrent !== bCurrent) return aCurrent - bCurrent;
        return compareEntriesByNavOrder(a, b, navOrder);
      });
    }

    return scoped.sort((a, b) => {
      const order = paneConfig.order || [];
      const aOrderRank = getOrderedPageRank(a, order);
      const bOrderRank = getOrderedPageRank(b, order);
      if (aOrderRank !== bOrderRank) return aOrderRank - bOrderRank;

      if (contextScope === "current_page_first") {
        const aCurrent = a.page_url === currentUrl ? 0 : 1;
        const bCurrent = b.page_url === currentUrl ? 0 : 1;
        if (aCurrent !== bCurrent) return aCurrent - bCurrent;
      }

      return compareEntriesByNavOrder(a, b, navOrder);
    });
  }

  function prioritizeFocusedEntry(entries, opts = {}) {
    if (!Array.isArray(entries) || !entries.length) return entries;
    const focusPageUrl = opts.focusPageUrl || "";
    const focusOccurrenceIndex = Number.parseInt(opts.focusOccurrenceIndex, 10);
    if (!focusPageUrl) return entries;
    const hasExactFocus = !Number.isNaN(focusOccurrenceIndex)
      && entries.some((entry) => entry.page_url === focusPageUrl && (entry.occurrence_index || 0) === focusOccurrenceIndex);

    return [...entries].sort((a, b) => {
      const aFocused = !hasExactFocus
        ? a.page_url === focusPageUrl
        : a.page_url === focusPageUrl && (a.occurrence_index || 0) === focusOccurrenceIndex;
      const bFocused = !hasExactFocus
        ? b.page_url === focusPageUrl
        : b.page_url === focusPageUrl && (b.occurrence_index || 0) === focusOccurrenceIndex;
      if (aFocused !== bFocused) return aFocused ? -1 : 1;
      return 0;
    });
  }

  function isHeadingLevelOccurrence(entry, keyword) {
    const ctx = String(entry?.context || "").replace(/^•\s*/, "").trim();
    if (!/^#{1,6}\s+\[\[/.test(ctx)) return false;
    const match = ctx.match(/^#{1,6}\s+\[\[([^\]|]+)/);
    return Boolean(match && match[1].toLowerCase().trim() === String(keyword || "").toLowerCase());
  }

  function isContentTagOccurrence(entry) {
    return /#\w/.test(String(entry?.context || ""));
  }

  function findHeadingOccurrenceIndex(entries, keyword, pageUrl) {
    const match = (entries || []).find((entry) =>
      entry.page_url === pageUrl && isHeadingLevelOccurrence(entry, keyword)
    );
    return match ? (match.occurrence_index || 0) : null;
  }

  function isPlainListMention(entry, keyword) {
    const ctx = String(entry?.context || "").replace(/^•\s*/, "").trim();
    if (/^#{1,6}\s/.test(ctx) || isContentTagOccurrence(entry)) return false;
    const match = ctx.match(/^\[\[([^\]|]+)/);
    return Boolean(match && match[1].toLowerCase().trim() === String(keyword || "").toLowerCase());
  }

  function filterSupersededListMentions(entries, keyword) {
    const headingPages = new Set(
      (entries || [])
        .filter((entry) => isHeadingLevelOccurrence(entry, keyword))
        .map((entry) => entry.page_url)
    );
    if (!headingPages.size) return entries || [];
    return (entries || []).filter((entry) => {
      if (!headingPages.has(entry.page_url)) return true;
      return !isPlainListMention(entry, keyword);
    });
  }

  function resolvePreferredPaneOccurrence(keyword, opts = {}, entries = []) {
    const focusPageUrl = opts.focusPageUrl || "";
    const parsedIndex = Number.parseInt(opts.focusOccurrenceIndex, 10);
    if (!focusPageUrl || Number.isNaN(parsedIndex)) return opts;
    const clicked = entries.find((entry) =>
      entry.page_url === focusPageUrl && (entry.occurrence_index || 0) === parsedIndex
    );
    if (!clicked || isHeadingLevelOccurrence(clicked, keyword) || isContentTagOccurrence(clicked)) {
      return opts;
    }
    const headingIndex = findHeadingOccurrenceIndex(entries, keyword, focusPageUrl);
    if (headingIndex == null || headingIndex === parsedIndex) return opts;
    return { ...opts, focusOccurrenceIndex: headingIndex };
  }

  function resolvePaneOpenFocus(keyword, opts = {}, entries = []) {
    let next = resolvePreferredPaneOccurrence(keyword, resolvePaneOpenOpts(opts), entries);
    const parsedIndex = Number.parseInt(next.focusOccurrenceIndex, 10);
    const hasFocusIndex = !Number.isNaN(parsedIndex);
    const focusPageUrl = next.focusPageUrl || getCurrentPageUrl();
    if (!hasFocusIndex && focusPageUrl) {
      const headingIndex = findHeadingOccurrenceIndex(entries, keyword, focusPageUrl);
      if (headingIndex != null) {
        next = { ...next, focusPageUrl, focusOccurrenceIndex: headingIndex };
      }
    }
    return next;
  }

  function paneFocusScrollReady(opts = {}) {
    const focusPageUrl = opts.focusPageUrl || "";
    const parsedIndex = Number.parseInt(opts.focusOccurrenceIndex, 10);
    return Boolean(focusPageUrl && !Number.isNaN(parsedIndex));
  }

  function groupEntriesByPage(entries) {
    const groups = [];
    let current = null;

    for (const entry of entries) {
      if (!current || current.page_url !== entry.page_url) {
        current = {
          page_url: entry.page_url,
          page_title: entry.page_title,
          entries: [],
        };
        groups.push(current);
      }
      current.entries.push(entry);
    }

    return groups;
  }

  function buildModuleGroup(group, renderEntryCard, navOrder = {}) {
    const href = `/${group.page_url}`;
    const multiClass = group.entries.length > 1 ? " wikilink-module--multi" : "";
    const cardsHtml = group.entries.map((entry) => renderEntryCard(entry)).join("");

    const cardCount = Array.isArray(group.entries) ? group.entries.length : 0;
    const metaHtml = cardCount > 1
      ? `<span class="wikilink-module__count">${escapeHtml(pluralize(cardCount, "block"))}</span>`
      : "";

    return `
      <section class="wikilink-module${multiClass}" data-page-url="${escapeHtml(group.page_url)}">
        <div class="wikilink-module__header">
          <a class="wikilink-module__page" href="${escapeHtml(href)}">${escapeHtml(group.page_title)}</a>
          <div class="wikilink-module__header-actions">
            ${metaHtml}
            <button class="wikilink-module__minimize" aria-label="Minimize module" title="Minimize module">&#8722;</button>
          </div>
        </div>
        <div class="wikilink-module__body">
          <div class="wikilink-module__cards">
            ${cardsHtml}
          </div>
        </div>
      </section>`;
  }

  function buildGroupedCards(entries, renderEntryCard, navOrder = {}) {
    return groupEntriesByPage(entries)
      .map((group) => buildModuleGroup(group, renderEntryCard, navOrder))
      .join("");
  }

  function getEntryStatLabels(entries) {
    const occurrenceCount = Array.isArray(entries) ? entries.length : 0;
    const pageCount = new Set((entries || []).map((entry) => entry.page_url).filter(Boolean)).size;
    const labels = [];
    if (occurrenceCount > 0) labels.push(pluralize(occurrenceCount, "block"));
    if (pageCount > 0) labels.push(pluralize(pageCount, "page"));
    return labels.length ? labels : null;
  }

  

  function buildPane(keyword, entries, opts = {}, navOrder = {}, paneConfig = FALLBACK_PANE_CONFIG, graphData = null) {
    const effectivePaneConfig = normalizePaneConfig({
      ...paneConfig,
      context_scope: opts.contextScope || paneConfig.context_scope,
    });
    const title = entries?.[0]?.title || keyword;
    const isContentTagPane = opts.kind === "content_tag" || String(keyword || "").startsWith("#");
    const paneEntries = isContentTagPane ? entries : filterSupersededListMentions(entries, keyword);
    const scoped = applyPaneContextScope(paneEntries, effectivePaneConfig, navOrder);
    const sorted = !isContentTagPane
      && effectivePaneConfig.context_scope !== "all_pages"
      && opts.focusPageUrl
      ? prioritizeFocusedEntry(scoped, opts)
      : scoped;
    const deduped = isContentTagPane
      ? collapseEntriesBySectionPreserveOrder(sorted)
      : collapseConceptEntriesBySection(sorted);

    const cards = buildGroupedCards(deduped, (entry) => buildCard(entry, keyword, {
      grouped: true,
      paneConfig: effectivePaneConfig,
      fullSection: isContentTagPane ? effectivePaneConfig.content_tag_full_section : false,
      hideControls: isContentTagPane ? effectivePaneConfig.content_tag_full_section : false,
      renderMode: isContentTagPane ? "content_tag" : "keyword",
      allEntries: paneEntries,
      ...(opts.focusPageUrl
        ? {
            focusPageUrl: opts.focusPageUrl,
            focusOccurrenceIndex: opts.focusOccurrenceIndex,
          }
        : {}),
    }), navOrder);
    const emptyMessage = deduped.length === 0
      ? `<p class="wikilink-pane__empty">No blocks found for this ${isContentTagPane ? "content_tag" : "term"}.</p>`
      : "";

    const conceptGraphAllowed = graphViewEnabled(graphData, "concept_graph")
      && effectivePaneConfig.show_concept_graph_preview !== false;
    const conceptGraphSection = isContentTagPane
      ? ""
      : buildConceptLearningPanel(keyword, deduped, navOrder, {
          ...effectivePaneConfig,
          show_concept_graph_preview: conceptGraphAllowed,
        }, opts.graphSource);
    
    
    const returnTabInConceptSection = !isContentTagPane
      && conceptGraphAllowed
      && Boolean(buildConceptReturnTab(opts.graphSource, effectivePaneConfig));
    const metaLabels = [...(
      isContentTagPane
        ? (getEntryStatLabels(deduped) || [])
        : (getKeywordNodeStats(graphData, keyword) || [])
    )];
    if (!isContentTagPane && opts.hasReference) metaLabels.push("Reference");
    const metaRow = buildPaneMetaRow(metaLabels);

    return `
      ${buildPaneHeader(title, metaRow, {
        showHistoryControls: effectivePaneConfig.show_history_controls,
        showMetaBadges: effectivePaneConfig.show_meta_badges,
        graphReturnHtml: returnTabInConceptSection ? "" : buildGraphReturnButton(opts.graphSource, effectivePaneConfig),
      })}
      ${conceptGraphSection}
      <div class="wikilink-pane__cards">
        ${cards || emptyMessage}
      </div>`;
  }

  function buildReferencePane(keyword, entries, navOrder = {}, opts = {}, paneConfig = FALLBACK_PANE_CONFIG, graphData = null) {
    const title = entries?.[0]?.title || keyword;
    const effectivePaneConfig = normalizePaneConfig({
      ...paneConfig,
      context_scope: opts.contextScope || paneConfig.context_scope,
    });
    const scoped = applyPaneContextScope(entries || [], effectivePaneConfig, navOrder);
    const sorted = scoped;
    const deduped = collapseConceptEntriesBySection(sorted);
    const focusOccurrenceIndex = Number.parseInt(opts.focusOccurrenceIndex, 10);
    const exactFocusedEntry = opts.focusPageUrl && !Number.isNaN(focusOccurrenceIndex)
      ? deduped.find((entry) => entry.page_url === opts.focusPageUrl && (entry.occurrence_index || 0) === focusOccurrenceIndex)
      : null;
    const pageFocusedEntry = !exactFocusedEntry && opts.focusPageUrl
      ? deduped.find((entry) => entry.page_url === opts.focusPageUrl)
      : null;
    const resolvedFocusPageUrl = exactFocusedEntry?.page_url || pageFocusedEntry?.page_url || "";
    const resolvedFocusOccurrenceIndex = exactFocusedEntry
      ? exactFocusedEntry.occurrence_index
      : pageFocusedEntry?.occurrence_index;
    const fullSection = effectivePaneConfig.reference_full_section !== false;
    const cardFocusOpts = resolvedFocusPageUrl
      ? { focusPageUrl: resolvedFocusPageUrl, focusOccurrenceIndex: resolvedFocusOccurrenceIndex }
      : {};
    const cards = buildGroupedCards(deduped, (entry) => buildCard(entry, keyword, {
      grouped: true,
      paneConfig: effectivePaneConfig,
      renderMode: "reference",
      fullSection,
      hideControls: fullSection,
      ...cardFocusOpts,
    }), navOrder);
    const emptyMessage = deduped.length === 0
      ? `<p class="wikilink-pane__empty">No reference found for ${escapeHtml(title)}.</p>`
      : "";
    const conceptGraphAllowed = graphViewEnabled(graphData, "concept_graph")
      && effectivePaneConfig.show_concept_graph_preview !== false;
    const learningPanel = buildConceptLearningPanel(keyword, deduped, navOrder, {
      ...effectivePaneConfig,
      show_concept_graph_preview: conceptGraphAllowed,
    }, opts.graphSource);
    const returnTabInConceptSection = conceptGraphAllowed
      && Boolean(buildConceptReturnTab(opts.graphSource, effectivePaneConfig));
    const referenceMetaLabels = getKeywordNodeStats(graphData, keyword)
      || getEntryStatLabels(deduped)
      || [];
    referenceMetaLabels.push("Reference");

    return `
      ${buildPaneHeader(title, buildPaneMetaRow(referenceMetaLabels), {
        showHistoryControls: effectivePaneConfig.show_history_controls,
        showMetaBadges: effectivePaneConfig.show_meta_badges,
        graphReturnHtml: returnTabInConceptSection ? "" : buildGraphReturnButton(opts.graphSource, effectivePaneConfig),
      })}
      ${learningPanel}
      <div class="wikilink-pane__cards">
        ${cards || emptyMessage}
      </div>`;
  }

  
  function bracketsContain(text, kw) {
    if (!text) return false;
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (parseWikilinkParts(m[1]).keyword === kw) return true;
    }
    return false;
  }

  function lineCoOccursKeywords(line, kwA, kwB) {
    return Boolean(line) && lineMentionsKeyword(line, kwA) && lineMentionsKeyword(line, kwB);
  }

  function hierarchyCandidateValidTeachingLink(parentEntry, childEntry, parentLines, childHeadingIndex, src, tgt) {
    if (Array.isArray(parentEntry.child_items) && parentEntry.child_items.some((line) => bracketsContain(line, tgt))) {
      return true;
    }
    if (bracketsContain(childEntry.parent_item, src)) return true;
    const { sameLineIndexes, pairRanges } = collectSiblingEdgeCoOccurrences(parentLines, src, tgt);
    if (sameLineIndexes.length > 0 || pairRanges.length > 0) return true;
    const parentKw = parentEntry.section_kw_offset ?? -1;
    const childKw = childEntry.section_kw_offset ?? -1;
    if (parentKw >= 0 && childKw >= 0 && childHeadingIndex >= 0) {
      if (childHeadingIndex === childKw || childKw === parentKw) return true;
      if (childHeadingIndex > parentKw && childHeadingIndex - parentKw <= 6) {
        const between = parentLines.slice(parentKw + 1, childHeadingIndex);
        if (between.every((line) => !/^#{2,6}\s/.test(String(line || "").trim()))) return true;
      }
    }
    if (childHeadingIndex >= 0 && Array.isArray(childEntry.heading_path) && childEntry.heading_path.length) {
      if (headingMatchesBreadcrumb(parentLines[childHeadingIndex], childEntry.heading_path)) {
        return true;
      }
    }
    return false;
  }

  function entryDirectTeachesEdgeRelationship(entry, kwA, kwB) {
    if (!entry || !kwA || !kwB) return false;
    const lines = getEntrySectionLines(entry);
    if (lines.length) {
      const { sameLineIndexes, pairRanges } = collectSiblingEdgeCoOccurrences(lines, kwA, kwB);
      if (sameLineIndexes.length > 0 || pairRanges.length > 0) return true;
    }
    if (lineCoOccursWikilinks(entry.context, kwA, kwB)) return true;
    if (Array.isArray(entry.child_items) && entry.child_items.some((line) => lineCoOccursWikilinks(line, kwA, kwB))) {
      return true;
    }
    if (lineCoOccursWikilinks(entry.parent_item, kwA, kwB)) return true;
    if (Array.isArray(entry.child_items) && (
      (bracketsContain(entry.context, kwA) && entry.child_items.some((line) => bracketsContain(line, kwB)))
      || (bracketsContain(entry.context, kwB) && entry.child_items.some((line) => bracketsContain(line, kwA)))
    )) {
      return true;
    }
    if (entry.parent_item && (
      (bracketsContain(entry.parent_item, kwA) && bracketsContain(entry.context, kwB))
      || (bracketsContain(entry.parent_item, kwB) && bracketsContain(entry.context, kwA))
    )) {
      return true;
    }
    if (lines.length) {
      const srcIndexes = findWikilinkLineIndexes(lines, kwA);
      const tgtIndexes = findWikilinkLineIndexes(lines, kwB);
      if (srcIndexes.length && tgtIndexes.length) {
        if (Array.isArray(entry.child_items) && entry.child_items.some((line) => bracketsContain(line, kwB))) {
          return srcIndexes.some((index) => tgtIndexes.some((tgtIndex) => tgtIndex >= index));
        }
        if (bracketsContain(entry.parent_item, kwA) && tgtIndexes.length) {
          return true;
        }
      }
    }
    return false;
  }

  function isDirectTeachingPair(lines, start, end) {
    if (start < 0 || end < 0 || start >= lines.length || end >= lines.length) return false;
    if (start === end) return true;
    const first = String(lines[Math.min(start, end)] || "").trim();
    const second = String(lines[Math.max(start, end)] || "").trim();
    const firstIsHeading = /^#{1,6}\s/.test(first);
    const secondIsHeading = /^#{1,6}\s/.test(second);
    if (firstIsHeading && !lineHasListMarker(second)) return false;
    if (secondIsHeading && !lineHasListMarker(first)) return false;
    return true;
  }

  function edgePaneRenderRange(entry, lines, tgt, paneConfig = FALLBACK_PANE_CONFIG) {
    if (entry._hierarchyEdgeCard) {
      const childHeadingIndex = entry._edgeChildHeadingIndex ?? -1;
      const childKeyword = Array.isArray(entry._keyword) ? entry._keyword[1] : tgt;
      const childRange = resolveHierarchyEdgeChildRange(entry, lines, childHeadingIndex, childKeyword, paneConfig);
      return {
        start: childRange.start,
        end: childRange.end,
        kind: "hierarchy",
      };
    }
    if (Array.isArray(entry._edgePair) && entry._edgePair.length === 2) {
      const pairRange = resolveListSiblingPairRange(lines, entry._edgePair[0], entry._edgePair[1]);
      return {
        start: pairRange.start,
        end: pairRange.end,
        kind: "direct",
      };
    }
    const start = entry.section_kw_offset ?? 0;
    return {
      start,
      end: Math.min(lines.length, start + 1),
      kind: "other",
    };
  }

  function edgePaneRenderSignature(entry, tgt, paneConfig = FALLBACK_PANE_CONFIG) {
    const lines = getEntrySectionLines(entry);
    
    
    
    
    
    
    const sectionText = lines
      .map((line) => normalizeComparableText(stripWikilinkMarkup(String(line || ""))))
      .filter(Boolean)
      .join("\x1f");
    if (sectionText) {
      return `${entry.page_url || ""}::${sectionText.slice(0, 1000)}`;
    }
    
    
    const range = edgePaneRenderRange(entry, lines, tgt, paneConfig);
    const normalized = lines.slice(range.start, range.end)
      .map((line) => normalizeComparableText(stripWikilinkMarkup(String(line || ""))))
      .filter(Boolean)
      .join("\x1f");
    return `${entry.page_url || ""}::${normalized.slice(0, 500)}`;
  }

  function edgePaneEntryRank(entry) {
    if (entry._hierarchyEdgeCard) return 0;
    if (entry._directTeachingEdge) return 1;
    return 2;
  }

  function headingPathFromSectionLines(lines, start, end) {
    const parts = [];
    const safeStart = Math.max(0, start ?? 0);
    const safeEnd = Math.min(lines.length, end ?? lines.length);
    for (let i = safeStart; i < safeEnd; i++) {
      const match = String(lines[i] || "").trim().match(/^#{1,6}\s+(.*)$/);
      if (!match) continue;
      const text = stripWikilinkMarkup(normalizeSectionHeadingText(match[1]));
      if (text) parts.push(text);
    }
    return parts;
  }

  function resolveEdgeCardSectionParts(entry, paneConfig = FALLBACK_PANE_CONFIG) {
    const logseqParts = (entry.parent_chain || [])
      .filter((t) => /^#+\s/.test(t))
      .map((t) => t.replace(/^#+\s*/, ""));
    if (logseqParts.length) return logseqParts;

    if (entry._hierarchyEdgeCard && entry._edgeChildEntry?.heading_path?.length) {
      return entry._edgeChildEntry.heading_path;
    }
    if (entry._edgeContextEntry?.heading_path?.length) {
      return entry._edgeContextEntry.heading_path;
    }

    const lines = getEntrySectionLines(entry);
    let derived = [];
    if (lines.length) {
      const tgt = Array.isArray(entry._keyword) ? entry._keyword[1] : entry._keyword;
      const range = edgePaneRenderRange(entry, lines, tgt || "", paneConfig);
      derived = headingPathFromSectionLines(lines, range.start, range.end);
    }

    const base = Array.isArray(entry.heading_path) ? entry.heading_path : [];
    if (derived.length > base.length) return derived;
    if (base.length) return base;
    return derived;
  }

  function pickEdgeContextEntry(entries, pageUrl) {
    const onPage = (entries || []).filter((entry) => entry.page_url === pageUrl);
    if (!onPage.length) return null;
    return onPage.reduce((best, entry) => {
      const bestDepth = Array.isArray(best?.heading_path) ? best.heading_path.length : 0;
      const entryDepth = Array.isArray(entry.heading_path) ? entry.heading_path.length : 0;
      return entryDepth > bestDepth ? entry : best;
    }, onPage[0]);
  }

  function resolveDirectTeachingEdgePair(entry, lines, src, tgt) {
    const { sameLineIndexes, pairRanges } = collectSiblingEdgeCoOccurrences(lines, src, tgt);
    const validPairs = pairRanges.filter(([start, end]) => isDirectTeachingPair(lines, start, end));
    if (sameLineIndexes.length) return [sameLineIndexes[0], sameLineIndexes[0]];
    if (validPairs.length) {
      validPairs.sort((a, b) => {
        const aList = lineHasListMarker(lines[a[0]] || "") && lineHasListMarker(lines[a[1]] || "") ? 0 : 1;
        const bList = lineHasListMarker(lines[b[0]] || "") && lineHasListMarker(lines[b[1]] || "") ? 0 : 1;
        if (aList !== bList) return aList - bList;
        return a[0] - b[0];
      });
      return validPairs[0];
    }

    const srcIndexes = findWikilinkLineIndexes(lines, src);
    const tgtIndexes = findWikilinkLineIndexes(lines, tgt);
    if (Array.isArray(entry.child_items) && entry.child_items.some((line) => bracketsContain(line, tgt))) {
      const srcIndex = srcIndexes[0] ?? entry.section_kw_offset ?? -1;
      const tgtIndex = tgtIndexes.find((index) => index >= srcIndex) ?? tgtIndexes[0] ?? -1;
      if (srcIndex >= 0 && tgtIndex >= 0 && isDirectTeachingPair(lines, srcIndex, tgtIndex)) {
        return [srcIndex, tgtIndex];
      }
    }
    if (entry.parent_item && bracketsContain(entry.parent_item, src) && tgtIndexes.length) {
      const srcIndex = srcIndexes[0] ?? entry.section_kw_offset ?? -1;
      if (srcIndex >= 0 && isDirectTeachingPair(lines, srcIndex, tgtIndexes[0])) {
        return [srcIndex, tgtIndexes[0]];
      }
    }
    return null;
  }

  function collectDirectTeachingEdgeEntries(pages, src, tgt, srcPool, tgtPool, paneConfig = FALLBACK_PANE_CONFIG) {
    const pageSet = new Set(pages);
    const raw = mergeUniqueEntries(
      srcPool
        .filter((entry) => pageSet.has(entry.page_url) && entryDirectTeachesEdgeRelationship(entry, src, tgt))
        .map((entry) => ({ ...entry, _keyword: [src, tgt], _edgePriority: 0, _directTeachingEdge: true })),
      tgtPool
        .filter((entry) => pageSet.has(entry.page_url) && entryDirectTeachesEdgeRelationship(entry, src, tgt))
        .map((entry) => ({ ...entry, _keyword: [src, tgt], _edgePriority: 1, _directTeachingEdge: true }))
    );
    const candidates = [];
    for (const entry of collapseEntriesBySection(raw)) {
      const lines = getEntrySectionLines(entry);
      const pair = resolveDirectTeachingEdgePair(entry, lines, src, tgt);
      if (!pair) continue;
      candidates.push({
        ...entry,
        section_kw_offset: pair[0],
        _edgePair: pair,
      });
    }
    return dedupeEdgePaneEntries(candidates, tgt, paneConfig);
  }

  function dedupeEdgePaneEntries(entries, tgt, paneConfig = FALLBACK_PANE_CONFIG) {
    const bestBySignature = new Map();
    for (const entry of entries) {
      const signature = edgePaneRenderSignature(entry, tgt, paneConfig);
      const current = bestBySignature.get(signature);
      if (!current || edgePaneEntryRank(entry) < edgePaneEntryRank(current)) {
        bestBySignature.set(signature, entry);
        continue;
      }
      if (edgePaneEntryRank(entry) === edgePaneEntryRank(current)
          && compareEdgeEntries(entry, current) < 0) {
        bestBySignature.set(signature, entry);
      }
    }
    return Array.from(bestBySignature.values()).sort(compareEdgeEntries);
  }

  function entryCoOccursTogetherForEdge(entry, kwA, kwB) {
    if (!entry || !kwA || !kwB) return false;
    const lines = getEntrySectionLines(entry);
    if (lines.length) {
      const { sameLineIndexes, pairRanges } = collectSiblingEdgeCoOccurrences(lines, kwA, kwB);
      if (sameLineIndexes.length > 0 || pairRanges.length > 0) return true;
      return sectionCoOccursWikilinks(lines, kwA, kwB);
    }
    if (lineCoOccursWikilinks(entry.context, kwA, kwB)) return true;
    if (Array.isArray(entry.child_items) && entry.child_items.some((line) => lineCoOccursWikilinks(line, kwA, kwB))) {
      return true;
    }
    if (lineCoOccursWikilinks(entry.parent_item, kwA, kwB)) return true;
    return false;
  }

  function entryCoOccursTogether(entry, kwA, kwB) {
    if (!entry || !kwA || !kwB) return false;
    const lines = getEntrySectionLines(entry);
    if (lines.length) {
      if (lines.some((line) => lineCoOccursKeywords(line, kwA, kwB))) return true;
      return findAdjacentKeywordLinePairs(lines, kwA, kwB).length > 0;
    }
    if (lineCoOccursKeywords(entry.context, kwA, kwB)) return true;
    if (Array.isArray(entry.child_items) && entry.child_items.some((line) => lineCoOccursKeywords(line, kwA, kwB))) {
      return true;
    }
    if (lineCoOccursKeywords(entry.parent_item, kwA, kwB)) return true;
    return false;
  }

  function normalizeCoOccurrenceLineText(line) {
    return normalizeComparableText(textForNavigation(line || ""));
  }

  function edgeHeadingDepth(entry) {
    return Array.isArray(entry?.heading_path) ? entry.heading_path.length : 0;
  }

  function edgeCoOccurrenceSignature(entry, lines) {
    if (Array.isArray(entry._edgePair) && entry._edgePair.length === 2) {
      const [start, end] = entry._edgePair;
      const parts = [start, end]
        .map((index) => normalizeCoOccurrenceLineText(lines[index]))
        .filter(Boolean);
      return parts.length === 2 ? `adj:${parts.join("\x1f")}` : "";
    }
    const index = entry.section_kw_offset ?? -1;
    if (index >= 0 && lines[index]) {
      return `line:${normalizeCoOccurrenceLineText(lines[index])}`;
    }
    return `fallback:${entrySectionKey(entry)}:${index}`;
  }

  function dedupeEdgeCoOccurrenceEntries(entries) {
    const bestBySignature = new Map();
    for (const entry of entries) {
      const lines = getEntrySectionLines(entry);
      const signature = `${entry.page_url || ""}::${edgeCoOccurrenceSignature(entry, lines)}`;
      const current = bestBySignature.get(signature);
      if (!current || edgeHeadingDepth(entry) > edgeHeadingDepth(current)) {
        bestBySignature.set(signature, entry);
      }
    }
    return Array.from(bestBySignature.values()).sort(compareEdgeEntries);
  }

  function expandSiblingEdgeEntries(entries, kwA, kwB) {
    const expanded = [];
    const seen = new Set();
    const pushEntry = (entry) => {
      const pairSuffix = Array.isArray(entry._edgePair) ? `:${entry._edgePair.join("-")}` : "";
      const key = `${entryLocationKey(entry)}${pairSuffix}`;
      if (seen.has(key)) return;
      seen.add(key);
      expanded.push(entry);
    };

    for (const entry of entries) {
      const lines = getEntrySectionLines(entry);
      const { sameLineIndexes, pairRanges } = collectSiblingEdgeCoOccurrences(lines, kwA, kwB);

      if (!sameLineIndexes.length && !pairRanges.length) {
        if (sectionCoOccursWikilinks(lines, kwA, kwB)) {
          pushEntry({
            ...entry,
            section_kw_offset: sectionCoOccurrenceAnchor(
              lines,
              kwA,
              kwB,
              entry.section_kw_offset ?? 0
            ),
          });
        }
        continue;
      }

      for (const lineIndex of sameLineIndexes) {
        pushEntry({ ...entry, section_kw_offset: lineIndex });
      }
      for (const [start, end] of pairRanges) {
        pushEntry({ ...entry, section_kw_offset: start, _edgePair: [start, end] });
      }
    }

    return dedupeEdgeCoOccurrenceEntries(expanded);
  }

  function entryMentionsKeyword(entry, kw) {
    if (!entry || !kw) return false;
    if (bracketsContain(entry.context, kw)) return true;
    if (Array.isArray(entry.child_items) && entry.child_items.some((line) => bracketsContain(line, kw))) {
      return true;
    }
    if (Array.isArray(entry.section_lines) && entry.section_lines.some((line) => bracketsContain(line, kw))) {
      return true;
    }
    return false;
  }

  function entryLocationKey(entry) {
    return `${entry.page_url}:${(entry.section_lines || [])[0] || ""}:${entry.section_kw_offset ?? ""}:${entry.occurrence_index ?? ""}`;
  }

  function entrySectionKey(entry) {
    const anchor = entry.section_kw_offset ?? entry.occurrence_index ?? "";
    return [
      entry.page_url || "",
      (entry.heading_path || []).join(" > "),
      anchor,
    ].join("::");
  }

  function conceptSectionKey(entry) {
    return [
      entry.page_url || "",
      (entry.heading_path || []).join(" > "),
    ].join("::");
  }

  function compareConceptSectionEntries(a, b) {
    const aOffset = a.section_kw_offset ?? Number.POSITIVE_INFINITY;
    const bOffset = b.section_kw_offset ?? Number.POSITIVE_INFINITY;
    if (aOffset !== bOffset) return aOffset - bOffset;
    return (a.occurrence_index ?? 0) - (b.occurrence_index ?? 0);
  }

  function collapseConceptEntriesBySection(entries) {
    const bestBySection = new Map();
    for (const entry of entries || []) {
      const key = conceptSectionKey(entry);
      const current = bestBySection.get(key);
      if (!current || compareConceptSectionEntries(entry, current) < 0) {
        bestBySection.set(key, entry);
      }
    }
    const collapsed = [];
    const seen = new Set();
    for (const entry of entries || []) {
      const key = conceptSectionKey(entry);
      if (seen.has(key)) continue;
      const best = bestBySection.get(key);
      if (best) {
        collapsed.push(best);
        seen.add(key);
      }
    }
    return collapsed;
  }

  function compareEdgeEntries(a, b) {
    const aOffset = a.section_kw_offset ?? Number.POSITIVE_INFINITY;
    const bOffset = b.section_kw_offset ?? Number.POSITIVE_INFINITY;
    if (aOffset !== bOffset) return aOffset - bOffset;

    const aPriority = a._edgePriority ?? Number.POSITIVE_INFINITY;
    const bPriority = b._edgePriority ?? Number.POSITIVE_INFINITY;
    if (aPriority !== bPriority) return aPriority - bPriority;

    return (a.occurrence_index ?? 0) - (b.occurrence_index ?? 0);
  }

  function mergeUniqueEntries(...groups) {
    const merged = [];
    const seen = new Set();
    for (const group of groups) {
      for (const entry of group) {
        const key = entryLocationKey(entry);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(entry);
      }
    }
    return merged;
  }

  function getEdgeKeywordEntries(data, references, keyword) {
    return mergeUniqueEntries(data[keyword] || [], references[keyword] || []);
  }

  function collapseEntriesBySection(entries) {
    const bySection = new Map();
    for (const entry of entries) {
      const key = entrySectionKey(entry);
      const current = bySection.get(key);
      if (!current || compareEdgeEntries(entry, current) < 0) {
        bySection.set(key, entry);
      }
    }
    return Array.from(bySection.values());
  }

  function collapseEntriesBySectionPreserveOrder(entries) {
    const collapsed = [];
    const seen = new Set();
    for (const entry of entries) {
      const key = entrySectionKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      collapsed.push(entry);
    }
    return collapsed;
  }

  function pageHasGraphHierarchyEdge(graphData, pageUrl, src, tgt) {
    const edges = graphData?.page_hierarchy_edges;
    if (!pageUrl || !Array.isArray(edges) || !edges.length) return false;
    const sourceId = `kw:${src}`;
    const targetId = `kw:${tgt}`;
    return edges.some((edge) => {
      if (edge.page !== pageUrl) return false;
      return (edge.source === sourceId && edge.target === targetId)
        || (edge.source === targetId && edge.target === sourceId);
    });
  }

  function pageHasKwKwEdgeContext(data, graphData, pageUrl, src, tgt, relation) {
    if (!pageUrl || !src || !tgt) return false;

    if (relation === "hierarchy") {
      if (pageHasGraphHierarchyEdge(graphData, pageUrl, src, tgt)) return true;
      const srcOnPage = (data[src] || []).filter((entry) => entry.page_url === pageUrl);
      const tgtOnPage = (data[tgt] || []).filter((entry) => entry.page_url === pageUrl);
      if (srcOnPage.some((entry) => entryDirectTeachesEdgeRelationship(entry, src, tgt))) return true;
      if (tgtOnPage.some((entry) => entryDirectTeachesEdgeRelationship(entry, src, tgt))) return true;
      return srcOnPage.some((entry) => Array.isArray(entry.child_items)
        && entry.child_items.some((line) => bracketsContain(line, tgt)));
    }

    if (relation === "sibling") {
      const srcOnPage = (data[src] || []).filter((entry) => entry.page_url === pageUrl);
      const tgtOnPage = (data[tgt] || []).filter((entry) => entry.page_url === pageUrl);
      return srcOnPage.some((entry) => entryCoOccursTogetherForEdge(entry, src, tgt))
        || tgtOnPage.some((entry) => entryCoOccursTogetherForEdge(entry, src, tgt));
    }

    const srcOnPage = (data[src] || []).filter((entry) => entry.page_url === pageUrl);
    const tgtOnPage = (data[tgt] || []).filter((entry) => entry.page_url === pageUrl);
    if (srcOnPage.some((entry) => entryCoOccursTogetherForEdge(entry, src, tgt))) return true;
    if (tgtOnPage.some((entry) => entryCoOccursTogetherForEdge(entry, src, tgt))) return true;
    return srcOnPage.some((entry) => Array.isArray(entry.child_items)
      && entry.child_items.some((line) => bracketsContain(line, tgt)));
  }

  function resolveEdgePanePages(pages, src, tgt, relation, data, graphData, detail, navOrder) {
    const normalizedPages = Array.isArray(pages)
      ? pages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__")
      : [];
    const currentPageUrl = getCurrentPageUrl();

    if (shouldScopeEdgeToCurrentPage(detail) && currentPageUrl) {
      if (pageHasKwKwEdgeContext(data, graphData, currentPageUrl, src, tgt, relation)) {
        return [currentPageUrl];
      }
      if (normalizedPages.includes(currentPageUrl)) {
        return [currentPageUrl];
      }
    }

    if (!shouldScopeEdgeToCurrentPage(detail)) {
      const expanded = collectAllEdgeTeachingPages(data, graphData, src, tgt, relation);
      if (expanded.length) {
        return sortEdgePanePageUrls(expanded, navOrder);
      }
    }

    return normalizedPages;
  }

  async function openEdgePane(detail, opts = {}) {
    const token = ++paneOpenToken;
    const [data, references, navOrder, paneConfig, graphData] = await Promise.all([
      getWikilinkData(),
      getReferenceData(),
      getNavOrder(),
      getResolvedPaneConfig(),
      getGraphData(),
    ]);
    if (token !== paneOpenToken) return;
    const { sourceType, sourceLabel, sourceId, targetLabel, targetType, pages: rawPages, relation } = detail;

    
    const src = sourceLabel.toLowerCase();
    const tgt = targetLabel.toLowerCase();
    let pages = Array.isArray(rawPages)
      ? rawPages.filter((pageUrl) => pageUrl && pageUrl !== "__nav__")
      : [];
    if (sourceType === "keyword" && targetType === "keyword") {
      pages = resolveEdgePanePages(pages, src, tgt, relation, data, graphData, detail, navOrder);
    }
    const srcEntriesPool = getEdgeKeywordEntries(data, references, src);
    const tgtEntriesPool = getEdgeKeywordEntries(data, references, tgt);

    let entries = [];
    let title = "";

    if (sourceType === "page" && targetType === "keyword") {
      
      const pageUrl = sourceId.replace(/^page:/, "");
      entries = (data[tgt] || [])
        .filter((e) => e.page_url === pageUrl)
        .map((e) => ({ ...e, _keyword: tgt }));
      title = tgt;

    } else if (sourceType === "keyword" && targetType === "keyword") {
      

      if (relation === "hierarchy") {
        const hierarchyEntries = findAllHierarchyContextEntries(data, pages, src, tgt);
        const directEntries = collectDirectTeachingEdgeEntries(
          pages,
          src,
          tgt,
          srcEntriesPool,
          tgtEntriesPool,
          paneConfig
        );
        entries = dedupeEdgePaneEntries([...directEntries, ...hierarchyEntries], tgt, paneConfig);
      }

      if (relation === "sibling" && entries.length === 0) {
        const siblingEntries = mergeUniqueEntries(
          srcEntriesPool
            .filter((e) => pages.includes(e.page_url) && entryCoOccursTogetherForEdge(e, src, tgt))
            .map((e) => ({ ...e, _keyword: [src, tgt], _edgePriority: 0 })),
          tgtEntriesPool
            .filter((e) => pages.includes(e.page_url) && entryCoOccursTogetherForEdge(e, src, tgt))
            .map((e) => ({ ...e, _keyword: [src, tgt], _edgePriority: 1 }))
        );
        entries = expandSiblingEdgeEntries(collapseEntriesBySection(siblingEntries), src, tgt);
      }

      
      if (entries.length === 0 && relation !== "sibling") {
        entries = srcEntriesPool
          .filter((e) => pages.includes(e.page_url) &&
            e.child_items && e.child_items.some((c) => bracketsContain(c, tgt)))
          .map((e) => ({ ...e, _keyword: [src, tgt], _edgePriority: 0 }));
      }

      
      
      if (entries.length === 0) {
        const srcEntries = srcEntriesPool
          .filter((e) => pages.includes(e.page_url) && (
            relation === "sibling"
              ? entryCoOccursTogetherForEdge(e, src, tgt)
              : entryMentionsKeyword(e, tgt)
          ))
          .map((e) => ({
            ...e,
            _keyword: [src, tgt],
            _edgePriority: 0,
            _edgeContextEntry: pickEdgeContextEntry(tgtEntriesPool, e.page_url),
          }));

        const tgtEntries = tgtEntriesPool
          .filter((e) => pages.includes(e.page_url) && (
            relation === "sibling"
              ? entryCoOccursTogetherForEdge(e, src, tgt)
              : entryMentionsKeyword(e, src)
          ))
          .map((e) => ({
            ...e,
            _keyword: [src, tgt],
            _edgePriority: 1,
            _edgeContextEntry: pickEdgeContextEntry(tgtEntriesPool, e.page_url),
          }));

        const merged = mergeUniqueEntries(srcEntries, tgtEntries);
        entries = relation === "sibling"
          ? expandSiblingEdgeEntries(collapseEntriesBySection(merged), src, tgt)
          : collapseEntriesBySection(merged);
      }

      if (entries.length === 0 && relation !== "sibling") {
        const srcFallback = srcEntriesPool
          .filter((e) => pages.includes(e.page_url))
          .map((e) => ({ ...e, _keyword: [src, tgt], _edgePriority: 0 }));
        const tgtFallback = tgtEntriesPool
          .filter((e) => pages.includes(e.page_url))
          .map((e) => ({ ...e, _keyword: [src, tgt], _edgePriority: 1 }));
        entries = collapseEntriesBySection(mergeUniqueEntries(srcFallback, tgtFallback));
      }
      title = `${src} + ${tgt}`;
    }

    const paneState = {
      type: "edge",
      detail,
      opts: sanitizePaneOpts(opts || {}),
    };
    recordPaneHistory(paneState, opts.historyMode || "push");

    
    const pane = getOrCreatePane();
    applyPaneWidth(pane, paneConfig);
    pane.innerHTML = buildEdgePane(title, entries, navOrder, { contextScope: detail.contextScope }, paneConfig, detail, graphData);
    syncPaneAdmonitions(pane);
    renderMermaidInElement(pane);
    upgradePaneCodeBlocks(pane);
    notifyPaneContentUpdated(pane);
    pane.dataset.paneType = "edge";
    pane.dataset.paneState = JSON.stringify(sanitizePaneState(paneState));
    updatePaneUrlParam(paneState);
    pane.classList.add("wikilink-pane--open");
    pane.removeAttribute("aria-hidden");
    syncAllContextButtons(pane);
    pane.querySelector(".wikilink-pane__close").addEventListener("click", closePane);
    if (!opts.skipFocus) pane.focus();
    scrollPaneToTop(pane);
    syncPaneTriggerState();
  }

  
  
  function buildEdgePane(title, entries, navOrder, opts = {}, paneConfig = FALLBACK_PANE_CONFIG, detail = null, graphData = null) {
    const effectivePaneConfig = normalizePaneConfig({
      ...paneConfig,
      context_scope: opts.contextScope || paneConfig.context_scope,
    });
    const sorted = applyPaneContextScope(entries, effectivePaneConfig, navOrder);
    const resolvedPageUrls = sorted.map((entry) => entry.page_url).filter(Boolean);

    const cards = buildGroupedCards(sorted, (entry) => buildCard(entry, entry._keyword || "", { grouped: true, paneConfig: effectivePaneConfig, renderMode: "edge" }), navOrder);

    const noResults = sorted.length === 0
      ? `<p class="wikilink-pane__empty">No shared context found for these two concepts in the current graph context.</p>`
      : "";
    const metaRow = buildPaneMetaRow(getEdgeStatLabels(graphData, detail, resolvedPageUrls));

    return `
      ${buildPaneHeader(title, metaRow, {
        titleClass: "wikilink-pane__title--edge",
        showHistoryControls: effectivePaneConfig.show_history_controls,
        showMetaBadges: effectivePaneConfig.show_meta_badges,
      })}
      <div class="wikilink-pane__cards">
        ${cards || noResults}
      </div>`;
  }

  let paneDocumentHandlersAttached = false;

  function attachPaneDocumentHandlers() {
    
    
    
    if (paneDocumentHandlersAttached) return;
    paneDocumentHandlersAttached = true;

    
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !document.getElementById("graph-modal")) closePane();
    });

    
    document.addEventListener("pointerdown", (e) => {
      const pane = document.getElementById("wikilink-pane");
      if (pane && pane.classList.contains("wikilink-pane--open") && !pane.contains(e.target)) {
        
        if (!e.target.closest(".wikilink, .content-tag, .knotis-pane-trigger, .graph-modal")) closePane();
      }
    });
  }

  

  function getOrCreatePane() {
    let pane = document.getElementById("wikilink-pane");
    if (!pane) {
      pane = document.createElement("div");
      pane.id = "wikilink-pane";
      pane.className = "wikilink-pane";
      pane.setAttribute("role", "complementary");
      pane.setAttribute("aria-label", "Backlinks");
      document.body.appendChild(pane);
      attachPaneDocumentHandlers();
    }
    return pane;
  }

  function applyPaneWidth(pane, paneConfig = FALLBACK_PANE_CONFIG) {
    if (!pane) return;
    const requestedWidth = Number(paneConfig.width);
    const width = Number.isFinite(requestedWidth) && requestedWidth > 0
      ? Math.max(320, requestedWidth)
      : FALLBACK_PANE_CONFIG.width;
    pane.style.setProperty("--wikilink-pane-width", `${width}px`);
  }

  function closePaneForModuleNavigation() {
    try { sessionStorage.removeItem(PENDING_PANE_RESTORE_KEY); } catch (err) { console.warn("[DEBUG] clearing pending pane restore key failed", err); }
    closePane();
    closeGraphModal();
    
    
    
    
    document.dispatchEvent(new CustomEvent("knotis:close-search"));
  }

  function navigateFromPaneContext(ctxLink, event) {
    const href = ctxLink.getAttribute("href") || ctxLink.dataset.href;
    if (!href) return false;
    const navTarget = event.target.closest(".wl-nav-target");
    const targetText = navTarget?.dataset.navText || "";
    try {
      const url = new URL(href, location.href);
      const normalTarget = url.pathname.replace(/\/index\.html$/, "/");
      const normalCurr = location.pathname.replace(/\/index\.html$/, "/");
      const isSamePage = normalCurr === normalTarget || normalCurr.endsWith(normalTarget);
      if (isSamePage) {
        event.preventDefault();
        closePaneForModuleNavigation();
        if (targetText && scrollToContextTarget(targetText)) return true;
        if (url.hash) {
          const anchorEl = document.getElementById(url.hash.slice(1));
          if (anchorEl) highlightBlockTarget(anchorEl);
        }
        return true;
      }
    } catch (err) {
      console.warn("[DEBUG] highlighting pane navigation target failed", err);
    }
    event.preventDefault();
    setPendingContextNavigation(href, targetText);
    closePaneForModuleNavigation();
    location.href = href;
    return true;
  }

  
  
  let paneOpenToken = 0;

  function closePane() {
    paneOpenToken += 1;
    const pane = document.getElementById("wikilink-pane");
    if (pane) {
      pane.classList.remove("wikilink-pane--open");
      pane.setAttribute("aria-hidden", "true");
    }
    cardStore.clear();
    try {
      const url = new URL(location.href);
      url.searchParams.delete(PANE_URL_PARAM);
      history.replaceState(history.state, "", url.href);
    } catch (err) {
      console.warn("[DEBUG] clearing pane URL param failed", err);
    }
    syncPaneTriggerState();
  }

  function openGraphReturn(source) {
    const graphSource = normalizeGraphSource(source);
    if (!graphSource) return;
    if (graphSource.type === "concept") {
      if (graphSource.keyword) {
        document.dispatchEvent(new CustomEvent("knotis:open-concept-graph", {
          detail: { keyword: graphSource.keyword },
        }));
      }
      return;
    }
    if (graphSource.type === "page") {
      const currentPageUrl = getCurrentPageUrl();
      if (graphSource.pageUrl && graphSource.pageUrl !== currentPageUrl) {
        document.dispatchEvent(new CustomEvent("knotis:open-page-graph", {
          detail: { pageUrl: graphSource.pageUrl },
        }));
        return;
      }
      document.dispatchEvent(new CustomEvent("knotis:open-page-graph", {
        detail: { pageUrl: graphSource.pageUrl || currentPageUrl },
      }));
      return;
    }
    const siteHref = graphSource.keyword
      ? `${getSiteGraphHref(graphDataCache)}?kw=${encodeURIComponent(graphSource.keyword)}`
      : getSiteGraphHref(graphDataCache);
    if (document.getElementById("graph-container") && !graphSource.keyword) return;
    closePane();
    location.href = siteHref;
  }

  function getHeaderNav() {
    return (
      document.querySelector(".md-header__inner .md-header__option")?.parentElement ||
      document.querySelector(".md-header__inner") ||
      document.querySelector(".md-header nav") ||
      document.querySelector(".md-header")
    );
  }

  function createPaneTrigger() {
    const button = document.createElement("button");
    hydratePaneTrigger(button);
    return button;
  }

  function hydratePaneTrigger(button) {
    button.type = "button";
    button.classList.add("knotis-pane-trigger");
    button.setAttribute("aria-label", "Open concept pane");
    button.setAttribute("aria-expanded", "false");
    button.title = "Open concept pane";
    if (!button.querySelector(".knotis-pane-trigger__label")) {
      button.innerHTML = `
        <span class="knotis-pane-trigger__icon">${PANE_TRIGGER_ICON_SVG}</span>
        <span class="knotis-pane-trigger__label">Pane</span>
      `;
    }
  }

  function placePaneTriggerInHeader(nav) {
    if (!paneTrigger || !nav) return;
    const source = nav.querySelector(".md-header__source");
    const slidesAnchor = nav.querySelector(".knotis-slides-restart") || nav.querySelector(".knotis-slides-trigger");
    const anchor = slidesAnchor || nav.querySelector(".knotis-search-trigger");

    if (anchor?.parentElement) {
      if (paneTrigger.parentElement !== anchor.parentElement || paneTrigger.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement("afterend", paneTrigger);
      }
    } else if (source) {
      if (paneTrigger.parentElement !== nav || paneTrigger.nextElementSibling !== source) {
        nav.insertBefore(paneTrigger, source);
      }
    } else if (paneTrigger.parentElement !== nav || nav.lastElementChild !== paneTrigger) {
      nav.appendChild(paneTrigger);
    }

    if (source?.parentElement && paneTrigger.parentElement === source.parentElement) {
      const paneBeforeSource = Boolean(
        paneTrigger.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING
      );
      if (!paneBeforeSource) {
        source.parentElement.insertBefore(paneTrigger, source);
      }
    }
  }

  function syncPaneTriggerState() {
    if (!paneTrigger) return;
    const pane = document.getElementById("wikilink-pane");
    const open = pane?.classList.contains("wikilink-pane--open");
    paneTrigger.setAttribute("aria-expanded", open ? "true" : "false");
    const label = open ? "Close concept pane" : "Open concept pane";
    paneTrigger.title = label;
    paneTrigger.setAttribute("aria-label", label);
  }

  function notifyPaneContentUpdated(pane) {
    try {
      document.dispatchEvent(new CustomEvent("wikilink:pane-content-updated", {
        detail: { pane },
      }));
    } catch {
      document.dispatchEvent(new Event("wikilink:pane-content-updated"));
    }
  }

  function ensurePaneTrigger() {
    if (!paneTrigger || !document.body.contains(paneTrigger)) {
      paneTrigger = document.querySelector(".knotis-pane-trigger") || createPaneTrigger();
    }
    hydratePaneTrigger(paneTrigger);
    const nav = getHeaderNav();
    placePaneTriggerInHeader(nav);
    syncPaneTriggerState();
    return paneTrigger;
  }

  function ensurePaneHeaderObserver() {
    if (paneHeaderObserver) return;
    const target = getHeaderNav() || document.querySelector(".md-header");
    if (!target) {
      setTimeout(ensurePaneHeaderObserver, 200);
      return;
    }
    paneHeaderObserver = new MutationObserver(() => {
      if (paneHeaderObserverScheduled) return;
      paneHeaderObserverScheduled = true;
      requestAnimationFrame(() => {
        paneHeaderObserverScheduled = false;
        ensurePaneTrigger();
      });
    });
    paneHeaderObserver.observe(target, { childList: true, subtree: true });
  }

  async function openPlaceholderPane() {
    const paneConfig = await getResolvedPaneConfig();
    const pane = getOrCreatePane();
    applyPaneWidth(pane, paneConfig);
    pane.innerHTML =
      buildPaneHeader("Pane") +
      `<div class="wikilink-pane__cards">
         <p class="wikilink-pane__empty wikilink-pane__placeholder">
           Click a concept link to see its content here.
         </p>
       </div>`;
    pane.dataset.paneType = "placeholder";
    delete pane.dataset.paneState;
    pane.classList.add("wikilink-pane--open");
    pane.removeAttribute("aria-hidden");
    pane.querySelector(".wikilink-pane__close")?.addEventListener("click", closePane);
    pane.focus();
    syncPaneTriggerState();
  }

  async function togglePaneFromHeader() {
    const pane = document.getElementById("wikilink-pane");
    if (pane?.classList.contains("wikilink-pane--open")) {
      closePane();
      return;
    }

    const activeState = getActivePaneHistoryState();
    if (activeState) {
      await replayPaneState(activeState, { historyMode: "skip" });
      syncPaneTriggerState();
      return;
    }

    await openPlaceholderPane();
  }

  function closeGraphModal() {
    document.getElementById("graph-modal")?.remove();
  }

  async function renderInlineConceptGraphPreview(pane, keyword, opts = {}) {
    if (pane && keyword) pane.dataset.pathKeyword = keyword;
    await syncPathPanelFromEntries(pane, keyword, opts.entries || [], opts.navOrder || {});

    const preview = pane?.querySelector(".concept-graph-preview__graph");
    if (!preview || !keyword) return;
    if (!window.Knotis?.renderConceptGraphPreview) {
      preview.textContent = "Concept graph unavailable.";
      return;
    }

    try {
      await window.Knotis.renderConceptGraphPreview(preview, keyword);
    } catch (err) {
      console.error("[wikilinks] Failed to render inline concept graph:", err);
      preview.textContent = "Could not load concept graph.";
    }
  }

  function syncAllContextButtons(pane) {
    if (!pane) return;
    pane.querySelectorAll(".wikilink-card[data-card-id]").forEach((card) => {
      const st = cardStore.get(card.dataset.cardId);
      if (st) updateContextButtons(card, st);
    });
  }

  function syncPaneAdmonitions(pane) {
    if (!pane) return;
    pane.querySelectorAll(".wikilink-card__context details[data-wl-default-open]").forEach((details) => {
      details.open = details.dataset.wlDefaultOpen === "true";
    });
  }

  function scrollPaneToTop(pane) {
    if (!pane) return;
    const performScroll = () => {
      try {
        pane.scrollTo({ top: 0, behavior: "auto" });
      } catch {
        pane.scrollTop = 0;
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(performScroll);
    });
    setTimeout(performScroll, 140);
  }

  function scrollPaneToFocusedTarget(pane) {
    if (!pane) return;
    const performScroll = () => {
      const target = pane.querySelector("[data-wl-focus-target='true']");
      if (!target) return;
      try {
        const paneRect = pane.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const topOffset = Math.max(96, Math.round(pane.clientHeight * 0.22));
        const nextTop = pane.scrollTop + (targetRect.top - paneRect.top) - topOffset;
        pane.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
      } catch (err) {
        console.warn("[DEBUG] scrolling pane to target card failed", err);
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(performScroll);
    });
    setTimeout(performScroll, 140);
  }

  async function openPane(keyword, opts = {}) {
    const token = ++paneOpenToken;
    keyword = keyword.toLowerCase();
    const [data, references, navOrder, paneConfig, graphData] = await Promise.all([
      getWikilinkData(),
      getReferenceData(),
      getNavOrder(),
      getResolvedPaneConfig(),
      getGraphData(),
    ]);
    if (token !== paneOpenToken) return;
    const entries = data[keyword] || [];
    const resolvedOpts = resolvePaneOpenFocus(keyword, opts, entries);
    const hasReference = Array.isArray(references[keyword]) && references[keyword].length > 0;
    const paneState = {
      type: "keyword",
      keyword,
      opts: sanitizePaneOpts(resolvedOpts, { includeGraph: true, includeFocus: true }),
    };
    recordPaneHistory(paneState, resolvedOpts.historyMode || "push");

    const pane = getOrCreatePane();
    applyPaneWidth(pane, paneConfig);
    pane.innerHTML = buildPane(keyword, entries, { ...resolvedOpts, hasReference }, navOrder, paneConfig, graphData);
    syncPaneAdmonitions(pane);
    renderMermaidInElement(pane);
    upgradePaneCodeBlocks(pane);
    notifyPaneContentUpdated(pane);
    await renderInlineConceptGraphPreview(pane, keyword, {
      focusPageUrl: resolvedOpts.focusPageUrl || "",
      navOrder,
      entries,
    });
    if (token !== paneOpenToken) return;
    pane.dataset.paneType = "keyword";
    pane.dataset.paneState = JSON.stringify(sanitizePaneState(paneState));
    updatePaneUrlParam(paneState);
    pane.classList.add("wikilink-pane--open");
    pane.removeAttribute("aria-hidden");
    syncAllContextButtons(pane);

    
    pane.querySelector(".wikilink-pane__close").addEventListener("click", closePane);

    
    if (!opts.skipFocus) pane.focus();
    if (paneConfig.context_scope === "all_pages" || !paneFocusScrollReady(resolvedOpts)) {
      scrollPaneToTop(pane);
    } else {
      scrollPaneToFocusedTarget(pane);
    }
    syncPaneTriggerState();
  }

  async function openContentTagPane(contentTag, opts = {}) {
    const token = ++paneOpenToken;
    contentTag = normalizeContentTag(contentTag);
    const [data, navOrder, paneConfig] = await Promise.all([getContentTagData(), getNavOrder(), getResolvedPaneConfig()]);
    if (token !== paneOpenToken) return;
    const entries = data[contentTag] || [];
    const resolvedOpts = resolveContentTagPaneOpenOpts(opts);
    const paneState = {
      type: "content_tag",
      content_tag: contentTag,
      opts: sanitizePaneOpts(resolvedOpts, { includeFocus: true }),
    };
    recordPaneHistory(paneState, resolvedOpts.historyMode || "push");

    const pane = getOrCreatePane();
    applyPaneWidth(pane, paneConfig);
    pane.innerHTML = buildPane(contentTag, entries, { ...resolvedOpts, kind: "content_tag" }, navOrder, paneConfig, null);
    syncPaneAdmonitions(pane);
    renderMermaidInElement(pane);
    upgradePaneCodeBlocks(pane);
    notifyPaneContentUpdated(pane);
    pane.dataset.paneType = "content_tag";
    pane.dataset.paneState = JSON.stringify(sanitizePaneState(paneState));
    updatePaneUrlParam(paneState);
    pane.classList.add("wikilink-pane--open");
    pane.removeAttribute("aria-hidden");
    syncAllContextButtons(pane);
    pane.querySelector(".wikilink-pane__close").addEventListener("click", closePane);
    if (!opts.skipFocus) pane.focus();
    if (resolvedOpts.focusPageUrl && resolvedOpts.focusOccurrenceIndex != null) {
      scrollPaneToFocusedTarget(pane);
    } else {
      scrollPaneToTop(pane);
    }
    syncPaneTriggerState();
  }

  async function openReferencePane(keyword, opts = {}) {
    const token = ++paneOpenToken;
    keyword = String(keyword || "").toLowerCase();
    const [data, navOrder, paneConfig, graphData] = await Promise.all([getReferenceData(), getNavOrder(), getResolvedPaneConfig(), getGraphData()]);
    if (token !== paneOpenToken) return;
    const entries = Array.isArray(data[keyword]) ? data[keyword] : [];
    const resolvedOpts = resolvePaneOpenOpts(opts);
    const paneState = {
      type: "reference",
      keyword,
      opts: sanitizePaneOpts(resolvedOpts, { includeGraph: true, includeFocus: true }),
    };
    recordPaneHistory(paneState, resolvedOpts.historyMode || "push");

    const pane = getOrCreatePane();
    applyPaneWidth(pane, paneConfig);
    pane.innerHTML = buildReferencePane(keyword, entries, navOrder, resolvedOpts, paneConfig, graphData);
    syncPaneAdmonitions(pane);
    renderMermaidInElement(pane);
    upgradePaneCodeBlocks(pane);
    notifyPaneContentUpdated(pane);
    await renderInlineConceptGraphPreview(pane, keyword, {
      navOrder,
      entries,
    });
    if (token !== paneOpenToken) return;
    pane.dataset.paneType = "reference";
    pane.dataset.paneState = JSON.stringify(sanitizePaneState(paneState));
    updatePaneUrlParam(paneState);
    pane.classList.add("wikilink-pane--open");
    pane.removeAttribute("aria-hidden");
    pane.querySelector(".wikilink-pane__close").addEventListener("click", closePane);
    if (!opts.skipFocus) pane.focus();
    scrollPaneToTop(pane);
    syncPaneTriggerState();
  }

  function wikilinkClickOptions(wikilinkEl) {
    const occurrenceIndex = wikilinkEl?.dataset?.occurrenceIndex;
    const focusPageUrl = wikilinkEl?.dataset?.focusPageUrl;
    if (occurrenceIndex != null && occurrenceIndex !== "") {
      return {
        focusOccurrenceIndex: occurrenceIndex,
        ...(focusPageUrl ? { focusPageUrl } : {}),
      };
    }
    return focusPageUrl ? { focusPageUrl } : {};
  }

  function contentTagClickOptions(contentTagEl) {
    const occurrenceIndex = contentTagEl?.dataset?.occurrenceIndex;
    const focusPageUrl = contentTagEl?.dataset?.focusPageUrl;
    if (occurrenceIndex != null && occurrenceIndex !== "") {
      return {
        focusOccurrenceIndex: occurrenceIndex,
        ...(focusPageUrl ? { focusPageUrl } : {}),
      };
    }
    return focusPageUrl ? { focusPageUrl } : {};
  }

  

  let handlersAttached = false;

  function attachHandlers() {
    if (handlersAttached) return;
    handlersAttached = true;

    
    
    document.body.addEventListener("click", (e) => {
      const img = e.target.closest("img");
      if (!img) return;
      if (img.classList.contains("no-lightbox")) return;
      
      if (img.naturalWidth > 0 && img.naturalWidth < 80) return;
      if (img.naturalHeight > 0 && img.naturalHeight < 80) return;
      
      if (img.closest("a") && !img.classList.contains("wl-img")) return;
      e.preventDefault();
      e.stopPropagation();
      openLightbox(img);
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest?.(".knotis-pane-trigger")) {
        e.preventDefault();
        e.stopPropagation();
        togglePaneFromHeader();
        return;
      }

      const copyLinkBtn = e.target.closest(".wikilink-pane__copy-link");
      if (copyLinkBtn) {
        e.preventDefault();
        navigator.clipboard.writeText(location.href).catch(() => {});
        const prevTitle = copyLinkBtn.title;
        const prevLabel = copyLinkBtn.getAttribute("aria-label");
        copyLinkBtn.title = "Copied!";
        copyLinkBtn.setAttribute("aria-label", "Copied!");
        setTimeout(() => {
          copyLinkBtn.title = prevTitle;
          copyLinkBtn.setAttribute("aria-label", prevLabel);
        }, 1500);
        return;
      }

      const conceptGraphBtn = e.target.closest(".wikilink-pane__concept-graph-btn");
      if (conceptGraphBtn) {
        const keyword = conceptGraphBtn.dataset.keyword || "";
        if (keyword) {
          e.preventDefault();
          e.stopPropagation();
          document.dispatchEvent(
            new CustomEvent("knotis:open-concept-graph", {
              detail: { keyword },
            })
          );
        }
        return;
      }

      const paneBackBtn = e.target.closest(".wikilink-pane__nav-btn--back");
      if (paneBackBtn) {
        e.preventDefault();
        e.stopPropagation();
        navigatePaneHistory(-1);
        return;
      }

      const paneForwardBtn = e.target.closest(".wikilink-pane__nav-btn--forward");
      if (paneForwardBtn) {
        e.preventDefault();
        e.stopPropagation();
        navigatePaneHistory(1);
        return;
      }

      const graphReturnBtn = e.target.closest(".wikilink-pane__graph-return");
      if (graphReturnBtn) {
        e.preventDefault();
        e.stopPropagation();
        openGraphReturn({
          type: graphReturnBtn.dataset.graphType,
          keyword: graphReturnBtn.dataset.keyword || "",
          pageUrl: graphReturnBtn.dataset.pageUrl || "",
        });
        return;
      }

      const copyBtn = e.target.closest(".wl-sec-code__copy");
      if (copyBtn) {
        e.preventDefault();
        e.stopPropagation();
        const block = copyBtn.closest(".wl-sec-code-block");
        if (!block) return;
        const isIconButton = copyBtn.classList.contains("md-code__button");
        const rawCode = block.dataset.wlCode
          ?? Array.from(block.querySelectorAll(".wl-sec-code__line-text")).map((line) => line.textContent ?? "").join("\n");
        copyTextToClipboard(rawCode)
          .then(() => {
            clearTimeout(copyBtn._wlCopyResetTimer);
            if (!isIconButton) copyBtn.textContent = "Copied";
            copyBtn.classList.add("wl-sec-code__copy--done");
            copyBtn._wlCopyResetTimer = setTimeout(() => {
              if (!isIconButton) copyBtn.textContent = "Copy";
              copyBtn.classList.remove("wl-sec-code__copy--done");
            }, 1400);
          })
          .catch(() => {
            clearTimeout(copyBtn._wlCopyResetTimer);
            if (!isIconButton) copyBtn.textContent = "Failed";
            copyBtn.classList.add("wl-sec-code__copy--done");
            copyBtn._wlCopyResetTimer = setTimeout(() => {
              if (!isIconButton) copyBtn.textContent = "Copy";
              copyBtn.classList.remove("wl-sec-code__copy--done");
            }, 1400);
          });
        return;
      }

      
      const moduleMinBtn = e.target.closest(".wikilink-module__minimize");
      if (moduleMinBtn) {
        const module = moduleMinBtn.closest(".wikilink-module");
        const minimized = module.classList.toggle("wikilink-module--minimized");
        moduleMinBtn.textContent = minimized ? "+" : "\u2212";
        moduleMinBtn.title = minimized ? "Expand module" : "Minimize module";
        moduleMinBtn.setAttribute("aria-label", minimized ? "Expand module" : "Minimize module");
        return;
      }

      
      const minBtn = e.target.closest(".wikilink-card__minimize");
      if (minBtn) {
        const card = minBtn.closest(".wikilink-card");
        const minimized = card.classList.toggle("wikilink-card--minimized");
        minBtn.textContent = minimized ? "+" : "\u2212";
        minBtn.title = minimized ? "Expand" : "Minimize";
        minBtn.setAttribute("aria-label", minimized ? "Expand" : "Minimize");
        return;
      }

      
      const gapToggle = e.target.closest(".wikilink-card__gap-toggle");
      if (gapToggle) {
        const card = gapToggle.closest(".wikilink-card");
        const id = card.dataset.cardId;
        const st = cardStore.get(id);
        if (!st?.hierarchyGapRange) return;
        const gapBody = card.querySelector(".wikilink-card__gap-body");
        st.hierarchyGapExpanded = !st.hierarchyGapExpanded;
        gapToggle.setAttribute("aria-expanded", st.hierarchyGapExpanded ? "true" : "false");
        gapToggle.innerHTML = hiddenContextToggleLabel(st.hierarchyGapExpanded, "gap");
        gapToggle.title = st.hierarchyGapExpanded ? "Hide hidden context" : "Show hidden context";
        if (st.hierarchyGapExpanded) {
          gapBody.hidden = false;
          if (!gapBody.dataset.rendered) {
            gapBody.innerHTML = wrapPaneMarkdownSurface(renderSectionLines(
              st.lines.slice(st.hierarchyGapRange.start, st.hierarchyGapRange.end),
              st.pageUrl,
              st.keyword,
              seedOrderedState(st.lines, st.hierarchyGapRange.start),
              edgeSectionRenderOpts(
                st.lines,
                st.hierarchyGapRange.start,
                st.hierarchyGapRange.end,
                st.renderOpts || {},
                { edge_context_mode: "compact" }
              )
            ));
            renderMermaidInElement(gapBody);
            upgradePaneCodeBlocks(gapBody);
            gapBody.dataset.rendered = "true";
          }
        } else {
          gapBody.hidden = true;
        }
        return;
      }

      const continuationToggle = e.target.closest(".wikilink-card__continuation-toggle");
      if (continuationToggle) {
        const card = continuationToggle.closest(".wikilink-card");
        const id = card.dataset.cardId;
        const st = cardStore.get(id);
        if (!st?.expandRange) return;
        const continuationBody = card.querySelector(".wikilink-card__continuation-body");
        st.expandExpanded = !st.expandExpanded;
        continuationToggle.setAttribute("aria-expanded", st.expandExpanded ? "true" : "false");
        continuationToggle.innerHTML = hiddenContextToggleLabel(st.expandExpanded);
        continuationToggle.title = st.expandExpanded ? "Hide hidden context" : "Show hidden context";
        if (st.expandExpanded) {
          continuationBody.hidden = false;
          st.nextStart = Math.max(st.nextStart, st.expandRange.end);
          if (!continuationBody.dataset.rendered) {
            continuationBody.innerHTML = wrapPaneMarkdownSurface(renderSectionLines(
              st.lines.slice(st.expandRange.start, st.expandRange.end),
              st.pageUrl,
              st.keyword,
              seedOrderedState(st.lines, st.expandRange.start),
              edgeSectionRenderOpts(
                st.lines,
                st.expandRange.start,
                st.expandRange.end,
                st.renderOpts || {},
                { edge_context_mode: "compact" }
              )
            ));
            renderMermaidInElement(continuationBody);
            upgradePaneCodeBlocks(continuationBody);
            continuationBody.dataset.rendered = "true";
          }
        } else {
          continuationBody.hidden = true;
        }
        return;
      }

      if (e.target.closest(".wikilink-card__ctx-less")) {
        const card = e.target.closest(".wikilink-card");
        const id   = card.dataset.cardId;
        const st   = cardStore.get(id);
        if (!st) return;

        
        
        
        
        if (st.windowMode) {
          const sectionStart = Number.isInteger(st.ownSectionStart) ? st.ownSectionStart : 0;
          const initialNextStart = Number.isInteger(st.initialNextStart) ? st.initialNextStart : st.nextStart;

          
          
          
          if (st.nextStart > initialNextStart) {
            let collapseTo = Math.max(
              initialNextStart,
              st.nextStart - (st.chunkLines || FALLBACK_PANE_CONFIG.chunk_lines)
            );
            
            
            collapseTo = nudgePastFenceSplit(st.lines, collapseTo, -1, st.displayStart);
            st.nextStart = collapseTo;
            rerenderSectionWindow(card, st);
            updateContextButtons(card, st);
            return;
          }

          let candidateStart = st.displayStart;
          while (candidateStart > sectionStart) {
            const step = previousChunkRange(st, candidateStart);
            if (step.start >= candidateStart) break;
            const found = hasRenderableContent(st, step.start, candidateStart);
            candidateStart = step.start;
            if (found) break;
          }
          if (candidateStart >= st.displayStart) { updateContextButtons(card, st); return; }
          st.displayStart = candidateStart;
          rerenderSectionWindow(card, st);
          updateContextButtons(card, st);
          return;
        }

        const view    = card.querySelector(".wikilink-card__section-view");
        const afterChunks = view.querySelectorAll(".wl-chunk--after");
        const lastRange = st.chunkRanges[st.chunkRanges.length - 1];

        if (!lastRange && st.displayStart > 0) {
          const range = previousChunkRange(st);
          if (range.start >= range.end) return;

          const { html } = renderAppendedChunk(st, range);
          if (!html.trim()) {
            if (!Array.isArray(st.beforeRanges)) st.beforeRanges = [];
            st.beforeRanges.push(range);
            st.displayStart = range.start;
            updateContextButtons(card, st);
            return;
          }
          const chunk = buildContextChunk(card, html, "wl-chunk--before");
          view.insertBefore(chunk, view.firstChild);
          renderMermaidInElement(chunk);
          upgradePaneCodeBlocks(chunk);
          if (!Array.isArray(st.beforeRanges)) st.beforeRanges = [];
          st.beforeRanges.push(range);
          st.displayStart = range.start;
          updateContextButtons(card, st);
          return;
        }

        if (!lastRange) return;
        st.chunkRanges.pop();

        st.nextStart = lastRange.start;

        if (afterChunks.length) {
          const lastChunk = afterChunks[afterChunks.length - 1];
          if (lastChunk._appendedNodes) {
            lastChunk._appendedNodes.forEach((node) => node.remove());
          }
          lastChunk.remove();
        }
        updateContextButtons(card, st);
        return;
      }

      
      if (e.target.closest(".wikilink-card__ctx-more")) {
        const card = e.target.closest(".wikilink-card");
        const id   = card.dataset.cardId;
        const st   = cardStore.get(id);
        if (!st) return;

        
        
        
        
        
        if (st.windowMode) {
          const sectionEnd = Number.isInteger(st.ownSectionEnd) ? st.ownSectionEnd : st.lines.length;
          const initialDisplayStart = Number.isInteger(st.initialDisplayStart) ? st.initialDisplayStart : st.displayStart;

          
          
          
          if (st.displayStart < initialDisplayStart) {
            let collapseTo = Math.min(
              initialDisplayStart,
              st.displayStart + (st.chunkLines || FALLBACK_PANE_CONFIG.chunk_lines)
            );
            
            
            collapseTo = nudgePastFenceSplit(st.lines, collapseTo, 1, st.nextStart);
            st.displayStart = collapseTo;
            rerenderSectionWindow(card, st);
            updateContextButtons(card, st);
            return;
          }

          let candidateEnd = st.nextStart;
          while (candidateEnd < sectionEnd) {
            const step = nextChunkRange(st, candidateEnd);
            if (step.end <= candidateEnd) break;
            const found = hasRenderableContent(st, candidateEnd, step.end);
            candidateEnd = step.end;
            if (found) break;
          }
          if (candidateEnd <= st.nextStart) { updateContextButtons(card, st); return; }
          st.nextStart = candidateEnd;
          rerenderSectionWindow(card, st);
          updateContextButtons(card, st);
          return;
        }

        
        const view  = card.querySelector(".wikilink-card__section-view");
        if (Array.isArray(st.beforeRanges) && st.beforeRanges.length) {
          const restoredRange = st.beforeRanges.pop();
          const beforeChunk = view.querySelector(".wl-chunk--before");
          beforeChunk?.remove();
          st.displayStart = restoredRange.end;
          updateContextButtons(card, st);
          return;
        }
        const range = nextChunkRange(st);
        const parts = splitAppendRangeAtBoundaries(st.lines, range);
        const allAppended = [];
        let renderedAny = false;
        for (const part of parts) {
          const { html } = renderAppendedChunk(st, part);
          if (!html.trim()) continue;
          renderedAny = true;
          allAppended.push(...appendContextChunkHtml(card, html, st.lines, part.start));
        }
        if (!renderedAny) {
          st.chunkRanges.push(range);
          st.nextStart = range.end;
          updateContextButtons(card, st);
          return;
        }
        const surface = card.querySelector(".wikilink-card__section-view .heading-flow__content");
        if (allAppended.length) {
          const marker = document.createElement("span");
          marker.className = "wl-chunk wl-chunk--after";
          marker.setAttribute("aria-hidden", "true");
          marker.hidden = true;
          marker._appendedNodes = allAppended;
          const markerParent = allAppended[allAppended.length - 1]?.parentElement
            || card.querySelector(".wikilink-card__section-view .heading-flow__content");
          markerParent?.appendChild(marker);
          renderMermaidInElement(markerParent || surface);
          upgradePaneCodeBlocks(markerParent || surface);
          notifyPaneContentUpdated(markerParent || surface);
        }
        st.chunkRanges.push(range);
        st.nextStart = range.end;
        updateContextButtons(card, st);
        return;
      }

      
      const inline = e.target.closest(".wikilink--inline");
      if (inline) {
        e.preventDefault();
        e.stopPropagation();
        if (inline.dataset.wikilinkMode === "reference") openReferencePane(inline.dataset.keyword, wikilinkClickOptions(inline));
        else openPane(inline.dataset.keyword, wikilinkClickOptions(inline));
        return;
      }
      const inlineContentTag = e.target.closest(".content-tag--inline");
      if (inlineContentTag) {
        e.preventDefault();
        e.stopPropagation();
        openContentTagPane(inlineContentTag.dataset.contentTag, contentTagClickOptions(inlineContentTag));
        return;
      }
      const admonitionSummary = e.target.closest(".wikilink-card__context details > summary");
      if (admonitionSummary) {
        e.stopPropagation();
        return;
      }
      const mdLink = e.target.closest(".wikilink-card__md-link");
      if (mdLink) {
        closePaneForModuleNavigation();
        return;
      }
      const ctxLink = e.target.closest(".wikilink-card__context");
      if (ctxLink) {
        navigateFromPaneContext(ctxLink, e);
        return;
      }

      
      const pageLink = e.target.closest(".wikilink-card__page, .wikilink-module__page");
      if (pageLink) {
        closePaneForModuleNavigation();
        return;
      }
      const contentTagEl = e.target.closest(".content-tag");
      if (contentTagEl) {
        e.preventDefault();
        openContentTagPane(contentTagEl.dataset.contentTag, contentTagClickOptions(contentTagEl));
        return;
      }
      const span = e.target.closest(".wikilink");
      if (!span) return;
      e.preventDefault();
      if (span.dataset.wikilinkMode === "reference") openReferencePane(span.dataset.keyword, wikilinkClickOptions(span));
      else openPane(span.dataset.keyword, wikilinkClickOptions(span));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const inline = e.target.closest(".wikilink--inline");
      if (inline) {
        e.preventDefault();
        if (inline.dataset.wikilinkMode === "reference") openReferencePane(inline.dataset.keyword, wikilinkClickOptions(inline));
        else openPane(inline.dataset.keyword, wikilinkClickOptions(inline));
        return;
      }
      const inlineContentTag = e.target.closest(".content-tag--inline");
      if (inlineContentTag) {
        e.preventDefault();
        openContentTagPane(inlineContentTag.dataset.contentTag, contentTagClickOptions(inlineContentTag));
        return;
      }
      if (e.target.closest(".wikilink-card__context details > summary")) return;
      const ctxLink = e.target.closest(".wikilink-card__context");
      if (ctxLink) {
        e.preventDefault();
        ctxLink.click();
        return;
      }
      const contentTagEl = e.target.closest(".content-tag");
      if (contentTagEl) {
        e.preventDefault();
        openContentTagPane(contentTagEl.dataset.contentTag, contentTagClickOptions(contentTagEl));
        return;
      }
      const span = e.target.closest(".wikilink");
      if (!span) return;
      e.preventDefault();
      if (span.dataset.wikilinkMode === "reference") openReferencePane(span.dataset.keyword, wikilinkClickOptions(span));
      else openPane(span.dataset.keyword, wikilinkClickOptions(span));
    });
  }

  

  function openLightbox(img) {
    const overlay = document.createElement("div");
    overlay.className = "img-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Image lightbox");

    const closeBtn = document.createElement("button");
    closeBtn.className = "img-lightbox__close";
    closeBtn.innerHTML = "&times;";
    closeBtn.setAttribute("aria-label", "Close image");

    const zoomed = document.createElement("img");
    zoomed.className = "img-lightbox__img no-lightbox";
    zoomed.src = img.src;
    zoomed.alt = img.alt || "";

    overlay.appendChild(closeBtn);
    overlay.appendChild(zoomed);

    if (img.alt && img.alt.trim()) {
      const cap = document.createElement("div");
      cap.className = "img-lightbox__caption";
      cap.textContent = img.alt;
      overlay.appendChild(cap);
    }

    document.body.appendChild(overlay);

    function closeLightbox() {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    }
    function onKey(e) { if (e.key === "Escape") closeLightbox(); }

    
    overlay.addEventListener("pointerdown", (e) => e.stopPropagation());
    closeBtn.addEventListener("click", closeLightbox);
    zoomed.addEventListener("click", closeLightbox);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeLightbox(); });
    document.addEventListener("keydown", onKey);
    closeBtn.focus();
  }

  function hasYamlPageTitle(content) {
    if (content?.querySelector?.(":scope > h1#__skip")) return true;
    const firstH1 = content?.querySelector?.(":scope > h1");
    if (!firstH1) return false;
    const docTitle = document.title.replace(/\s+-\s+.*$/, "").trim();
    const firstText = (firstH1.textContent || "").replace(/\s+/g, " ").trim();
    return Boolean(docTitle && firstText && docTitle !== firstText);
  }

  function isSkippablePageTitleHeading(node, content) {
    if (!node || node.tagName !== "H1") return false;
    if (node.id === "__skip") return true;
    if (hasYamlPageTitle(content)) return false;
    const firstH1 = content.querySelector(":scope > h1");
    return firstH1 === node;
  }

  function headingFlowLevel(node, content) {
    const tagLevel = Number(node.tagName.slice(1));
    if (hasYamlPageTitle(content)) return Math.min(tagLevel + 1, 6);
    return tagLevel;
  }

  function needsHeadingFlowWrap(typeset) {
    if (!typeset || typeset.querySelector(".heading-flow")) return false;
    if (typeset.querySelector(":scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6")) {
      return true;
    }
    return Boolean(typeset.querySelector(":scope > h1:not(#__skip)"));
  }

  function isHeadingFlowTrailingPageBlock(node) {
    return node?.nodeType === Node.ELEMENT_NODE
      && node.matches?.(".md-tags, .footnote, .footnotes, .md-footnotes");
  }

  function installInstantNavHeadingGuard() {
    const watchRoot = document.querySelector(".md-content");
    if (!watchRoot) return;

    new MutationObserver(() => {
      const inner = document.querySelector(".md-content__inner");
      if (!inner) return;
      const typeset = inner.matches?.(".md-typeset") ? inner : inner.querySelector(".md-typeset") || inner;
      if (!needsHeadingFlowWrap(typeset)) return;
      wrapHeadingFlows(typeset);
    }).observe(watchRoot, { childList: true, subtree: true });
  }

  function applySyncContentSurface(content) {
    wrapHeadingFlows(content);
    applyOutlineListContinuations(content);
    markNestedListShells(content);
    walkAndReplace(content);
    stripBracketsFromNav();
    void renderNavContentTagChips();
    renderContentTagPageChips();
  }

  function refreshWebKitLineNumberGutters(root) {
    if (!WEBKIT_CONTENT_ENGINE || !root?.querySelectorAll) return;
    const gutters = Array.from(root.querySelectorAll(".highlighttable .linenodiv pre"));
    if (!gutters.length) return;

    const refresh = () => {
      gutters.forEach((pre) => {
        const previousDisplay = pre.style.display;
        pre.style.display = "block";
        void pre.offsetHeight;
        if (previousDisplay) pre.style.display = previousDisplay;
        else pre.style.removeProperty("display");
      });
    };

    refresh();
    requestAnimationFrame(refresh);
    setTimeout(refresh, 80);
  }

  function wrapHeadingFlows(content) {
    if (!content || !content.childNodes) return;

    const headingLevels = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);
    const anyHeading = /^H[1-6]$/;
    const children = Array.from(content.childNodes);
    const sections = [];

    for (const node of children) {
      if (isHeadingFlowTrailingPageBlock(node)) {
        sections.length = 0;
        continue;
      }

      if (node.nodeType === Node.ELEMENT_NODE && anyHeading.test(node.tagName)) {
        if (isSkippablePageTitleHeading(node, content)) {
          continue;
        }
        if (!headingLevels.has(node.tagName)) {
          sections.length = 0;
          continue;
        }

        const level = headingFlowLevel(node, content);
        while (sections.length && sections[sections.length - 1].level >= level) {
          sections.pop();
        }

        const wrapper = document.createElement("section");
        wrapper.className = `heading-flow heading-flow--h${level}`;

        const contentBlock = document.createElement("div");
        contentBlock.className = "heading-flow__content";

        const parentContent = sections[sections.length - 1]?.contentBlock || content;
        if (parentContent === content && node.parentNode === content) {
          content.insertBefore(wrapper, node);
        } else {
          parentContent.appendChild(wrapper);
        }
        wrapper.appendChild(node);
        wrapper.appendChild(contentBlock);

        sections.push({ level, contentBlock });
        continue;
      }

      const currentSection = sections[sections.length - 1];
      if (currentSection && node.parentNode === content) {
        currentSection.contentBlock.appendChild(node);
      }
    }
  }

  function outlineListCounterDepth(list) {
    let depth = 1;
    let node = list?.parentElement || null;
    while (node) {
      if (node.matches?.("ol")) depth++;
      if (node.matches?.(".md-content, .md-content__inner, article, main")) break;
      node = node.parentElement;
    }
    return Math.max(1, Math.min(depth, 7));
  }

  function applyOutlineListContinuations(root) {
    if (!root?.querySelectorAll) return;
    const containers = [root, ...Array.from(root.querySelectorAll("li, .heading-flow__content"))];
    containers.forEach((container) => {
      const orderedCounts = new Map();
      Array.from(container.children || []).forEach((child) => {
        if (!child.matches?.("ol")) return;

        const depth = outlineListCounterDepth(child);
        const explicitStart = Number.parseInt(child.getAttribute("start") || "", 10);
        const priorCount = orderedCounts.has(depth)
          ? orderedCounts.get(depth)
          : (Number.isFinite(explicitStart) && explicitStart > 1 ? explicitStart - 1 : 0);
        const directItems = Array.from(child.children || []).filter((item) => item.matches?.("li"));

        child.dataset.knotisOutlineList = "true";
        child.dataset.knotisOutlineDepth = String(depth);
        child.style.counterReset = `level${depth} ${priorCount}`;
        child.setAttribute("start", String(priorCount + 1));

        orderedCounts.set(depth, priorCount + directItems.length);
      });
    });
  }

  function nestedListShellChild(item) {
    let nestedList = null;
    for (const node of item.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node.textContent || "").trim()) return null;
        continue;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      if (node.matches?.("span[data-knotis-slide-marker], [hidden]")) continue;
      if (node.matches?.("ol, ul")) {
        if (nestedList) return null;
        nestedList = node;
        continue;
      }
      return null;
    }
    return nestedList;
  }

  function markNestedListShells(root) {
    root.querySelectorAll?.(".md-typeset li, .heading-flow__content li").forEach((item) => {
      item.classList.remove("knotis-nested-list-shell");
      if (nestedListShellChild(item)) {
        item.classList.add("knotis-nested-list-shell");
      }
    });
  }

  

  async function init() {
    
    
    
    const content =
      document.querySelector(".md-content__inner") ||
      document.querySelector("article.md-typeset") ||
      document.querySelector("article") ||
      document.querySelector(".md-content") ||
      document.querySelector("main") ||
      document.body;
    applyConfiguredColors();
    applyConfiguredContentStyles();
    ensurePaneTrigger();
    applySyncContentSurface(content);
    refreshWebKitLineNumberGutters(content);
    await renderMermaidInElement(content);
    if (isOfflinePreview()) return;
    attachHandlers();
    ensurePaneHeaderObserver();
    const hadPendingContextNavigation = consumePendingContextNavigation();
    const hadSearchHighlightNavigation = consumeSearchHighlightNavigation();
    const hadPaneUrlParam = await consumePaneUrlParam();
    if (!hadPaneUrlParam) await consumePendingPaneRestore();
    if (!hadPendingContextNavigation && !hadSearchHighlightNavigation && (location.hash.startsWith("#wikilink-") || location.hash.startsWith("#content-tag-"))) scrollToAnchor();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  if (!isOfflinePreview()) {
    
    document.addEventListener("wikilink:open-pane", (e) => {
      if (e.detail?.keyword) {
        openPane(e.detail.keyword, {
          graphSource: normalizeGraphSource(e.detail.graphSource) || graphSourceFromLegacy(e.detail),
          contextScope: e.detail.contextScope || "all_pages",
        });
      }
    });

    document.addEventListener("wikilink:open-reference-pane", (e) => {
      if (e.detail?.keyword) openReferencePane(e.detail.keyword, e.detail.opts || {});
    });

    document.addEventListener("wikilink:open-content-tag-pane", (e) => {
      if (e.detail?.content_tag) openContentTagPane(e.detail.content_tag, e.detail.opts || {});
    });

    
    document.addEventListener("wikilink:open-edge-pane", (e) => {
      if (e.detail) openEdgePane(e.detail);
    });

    
    
    document.addEventListener("knotis:close-pane", () => closePane());

    
    
    

    async function onPageSwap() {
      const content =
        document.querySelector(".md-content__inner") ||
        document.querySelector("article") ||
        document.querySelector(".md-content") ||
        document.querySelector("main") ||
        document.body;
      applyConfiguredColors();
      applyConfiguredContentStyles();
      ensurePaneTrigger();
      applySyncContentSurface(content);
      refreshWebKitLineNumberGutters(content);
      await renderMermaidInElement(content);
      const hadPendingContextNavigation = consumePendingContextNavigation();
      const hadSearchHighlightNavigation = consumeSearchHighlightNavigation();
      const hadPaneUrlParam = await consumePaneUrlParam();
      const restoredPane = hadPaneUrlParam || await consumePendingPaneRestore();
      if (!hadPendingContextNavigation && !hadSearchHighlightNavigation && !restoredPane && (location.hash.startsWith("#wikilink-") || location.hash.startsWith("#content-tag-"))) {
        setTimeout(scrollToAnchor, 80);
      }
    }

    if (window.document$ && typeof window.document$.subscribe === "function") {
      
      let first = true;
      window.document$.subscribe(() => {
        if (first) { first = false; return; }
        void onPageSwap();
      });
    } else {
      const contentRoot = document.querySelector(".md-content, main") || document.body;
      new MutationObserver(() => {
        void onPageSwap();
      }).observe(contentRoot, { childList: true, subtree: true });
    }

    installInstantNavHeadingGuard();
  }

  window.KnotisWikilinks = window.KnotisWikilinks || {};
  window.KnotisWikilinks.expandIconShortcodesInHtml = expandIconShortcodesInHtml;
  window.KnotisWikilinks.expandIconShortcodesInRoot = expandIconShortcodesInRoot;
  window.KnotisWikilinks.renderIconToken = renderIconToken;

})();
