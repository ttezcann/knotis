(function () {
  "use strict";

  if (!window.KnotisCore) {
    console.error("[knotis] knotis-core.js must load before knotis-search.js");
    return;
  }
  const { escapeHtml } = window.KnotisCore;

  const SCRIPT_BASE = document.currentScript?.src || location.href;
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
  const INDEX_URL = new URL("knotis-search.json", SCRIPT_BASE).href;
  const GRAPH_URL = new URL("graph.json", SCRIPT_BASE).href;
  const SITE_BASE = siteBaseFromScript(SCRIPT_BASE);
  const SEARCH_ID = "__knotis-search";
  const SEARCH_CLASS = "knotis-search";
  const RESULT_LIMIT = 50;
  const SNIPPET_RADIUS = 200;

  let indexPromise = null;
  let graphPromise = null;
  let preparedIndex = null;
  
  
  let knownEntityKeys = new Set();
  
  
  let knownReferenceKeys = new Set();
  let searchOrder = [];
  
  
  let keywordDensity = new Map();

  
  
  
  
  
  
  
  const BOILERPLATE_MIN_PAGES = 8;
  const BOILERPLATE_MIN_DENSITY = 3;
  function isBoilerplateKeyword(key) {
    const stats = keywordDensity.get(key);
    if (!stats) return false;
    return stats.pageCount >= BOILERPLATE_MIN_PAGES && stats.mentionsPerPage >= BOILERPLATE_MIN_DENSITY;
  }
  let searchPaneConfigCache = null;
  let handlersAttached = false;
  let searchTimer = null;
  let searchEnabled = false;
  let queryInitialized = false;
  const activeFilters = new Set();

  const ICONS = {
    search: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3a6.5 6.5 0 0 1 5.17 10.45l4.44 4.44-1.42 1.42-4.44-4.44A6.5 6.5 0 1 1 9.5 3m0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z"/></svg>',
    back: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="m20 11v2H7.83l5.59 5.59L12 20l-8-8 8-8 1.42 1.41L7.83 11z"/></svg>',
    filter: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M10 18h4v-2h-4v2M3 6v2h18V6H3m3 7h12v-2H6v2z"/></svg>',
    document: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 1.5L18.5 9H13zM8 13h8v2H8zm0 4h5v2H8z"/></svg>',
    chevronBoxDown: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 10l4 4 4-4"/></svg>',
  };

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z0-9#]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  
  
  
  
  
  
  function stripNonContentMarkup(value) {
    return String(value || "")
      .replace(/!\[[^\]]*\]\([^)]*\)(?:\{[^}\n]*\})?/g, " ")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\{[^}\n]*\}/g, " ");
  }

  function tokenize(value) {
    return normalize(value).match(/#[a-z0-9_-]+|[a-z0-9]+(?:[.-][a-z0-9]+)*/g) || [];
  }

  function unique(items) {
    return [...new Set(items.filter(Boolean))];
  }

  const TASK_TAGS = {
    code: "#code",
    output: "#output",
    interpretation: "#interpretation",
  };

  
  
  
  
  
  const PRIORITY = {
    EXACT_REFERENCE: 60,        
    MENTION_EXACT_RICH: 55,     
    CONTENT_TAG_EXACT_SOLE: 52,     
    TASK_MATCH: 50,             
    CONTENT_TAG_IN_TITLE: 50,
    CONTENT_TAG_IN_TITLE_LOOSE: 49,
    TEACHING_MENTION: 48,       
    CONTENT_TAG_ONLY: 47,
    MENTION_EXACT_PLAIN: 45,    
    EXACT_HEADING: 45,          
    PARTIAL_REFERENCE_TARGET: 44, 
    EXACT_CONCEPT: 43,          
    PARTIAL_CONCEPT: 42,        
                                
                                
                                
    PARTIAL_REFERENCE: 41,      
                                
                                
    PHRASE_IN_TITLE: 40,        
    PHRASE_IN_TEXT: 40,         
    PARTIAL_CONCEPT_BOILER: 39, 
                                
                                
    MENTION_PARTIAL_RICH: 38,
    MENTION_PARTIAL_PLAIN: 35,
    BASE: 1,
    
    
    GATE_TASK: 50,
    GATE_CONTENT_TAG: 47,
    GATE_ENTITY: 40,
  };

  function stripTerminalPunctuation(value) {
    return normalize(value).replace(/[?!.:;]+$/g, "").trim();
  }

  
  
  
  
  
  function queryIsEntityPrefix(strippedQuery) {
    if (strippedQuery.length < 2) return false;
    for (const key of knownEntityKeys) {
      if (key.startsWith(strippedQuery)) return true;
    }
    return false;
  }

  function queryPrefixesSingleWordEntity(strippedQuery) {
    if (strippedQuery.length < 2 || strippedQuery.includes(" ")) return false;
    for (const key of knownEntityKeys) {
      if (!key.includes(" ") && key.startsWith(strippedQuery)) return true;
    }
    return false;
  }

  function parseQueryIntent(query) {
    const terms = unique(tokenize(query));
    
    
    
    
    
    
    
    
    
    
    
    const strippedQuery = stripTerminalPunctuation(query);
    const treatAsEntity = knownEntityKeys.has(strippedQuery) || queryIsEntityPrefix(strippedQuery);
    const explicitTags = terms.filter((term) => term.startsWith("#"));
    const plainTerms = terms.filter((term) => !term.startsWith("#"));
    const hasNonTaskPlainTerm = plainTerms.some((term) => !TASK_TAGS[term]);
    
    
    
    const taskTags = treatAsEntity || !hasNonTaskPlainTerm
      ? []
      : unique(terms.map((term) => TASK_TAGS[term]).filter(Boolean));
    const allTags = unique([...taskTags, ...explicitTags]);
    const conceptTerms = terms.filter((term) => (
      !term.startsWith("#") && (treatAsEntity || !TASK_TAGS[term] || !hasNonTaskPlainTerm)
    ));
    const conceptPhrase = conceptTerms.join(" ").trim();
    return {
      phrase: normalize(query),
      terms,
      conceptTerms,
      conceptPhrase,
      taskTags: allTags,
      explicitTags,
      hasTaskIntent: allTags.length > 0 && conceptTerms.length > 0,
    };
  }

  function queryContentTagTerms(intent) {
    return intent.taskTags.length ? intent.taskTags : intent.terms.filter((term) => term.startsWith("#"));
  }

  function isContentTagOnlyQuery(query, intent) {
    const parsed = intent || parseQueryIntent(query);
    return queryContentTagTerms(parsed).length > 0 && parsed.conceptTerms.length === 0;
  }

  function lineHasRequestedContentTag(line, tag) {
    const token = String(tag || "").toLowerCase();
    if (!token) return false;
    const haystack = String(line || "").toLowerCase();
    return haystack.includes(token);
  }

  function lineMatchesContentTagQuery(line, tags) {
    return tags.every((tag) => lineHasRequestedContentTag(line, tag));
  }

  function findContentTagBlockIndex(lines, tags) {
    if (!Array.isArray(lines) || !tags?.length) return -1;
    const preferred = [];
    const fallback = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!lineMatchesContentTagQuery(line, tags)) continue;
      fallback.push(i);
      const trimmed = String(line).trim();
      if (parseTeachingSectionHeader(line) || /^#{1,6}\s+/.test(trimmed)) {
        preferred.push(i);
      }
    }
    if (preferred.length) return preferred[0];
    if (fallback.length) return fallback[0];
    return -1;
  }

  function resolveContentTagSectionOffset(doc, query) {
    const intent = parseQueryIntent(query);
    if (!isContentTagOnlyQuery(query, intent)) return docSectionKwOffset(doc);
    const tags = queryContentTagTerms(intent);
    const lines = docSectionLinesRaw(doc);
    if (!lines?.length) return docSectionKwOffset(doc);
    const blockIndex = findContentTagBlockIndex(lines, tags);
    return blockIndex >= 0 ? blockIndex : docSectionKwOffset(doc);
  }

  function docForContentTagQuery(doc, query) {
    if (!doc || !isContentTagOnlyQuery(query)) return doc;
    const offset = resolveContentTagSectionOffset(doc, query);
    return {
      ...doc,
      sectionKwOffset: offset,
      section_kw_offset: offset,
      primaryConcept: "",
      primary_concept: "",
    };
  }

  function snippetHighlightKeyword(doc, query) {
    const intent = parseQueryIntent(query);
    if (isContentTagOnlyQuery(query, intent)) {
      return queryContentTagTerms(intent)[0] || "";
    }
    
    
    
    
    
    
    const fullPhrase = stripTerminalPunctuation(intent.phrase || query);
    const docKeys = [...(doc?._conceptKeys || []), ...(doc?._referenceKeys || [])];
    if (fullPhrase && docKeys.includes(fullPhrase)) return fullPhrase;
    return stripTerminalPunctuation(intent.conceptPhrase || intent.phrase || query);
  }

  function sectionDocDisplayTitle(sectionDoc, article) {
    if (sectionDoc?.kind === "mention") {
      const crumbs = Array.isArray(sectionDoc.breadcrumb) ? sectionDoc.breadcrumb.filter(Boolean) : [];
      if (crumbs.length) return crumbs[crumbs.length - 1];
      return article?.title || sectionDoc.page_title || sectionDoc.title || "";
    }
    return sectionDoc?.title || article?.title || "";
  }

  function resultUrl(locationValue) {
    return new URL(locationValue || "", SITE_BASE).href;
  }

  function textForNavigation(raw) {
    return String(raw || "")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^(\s*)(?:[-*+]|\d+[.)])\s+/, "")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)(?:\s*\{[^}]*\})?/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/\+\+([^<>\n]+?)\+\+/g, "$1")
      .replace(/==([^=\n]+(?:=[^=\n]+)*)==/g, "$1")
      .replace(/[*_`~]+/g, "")
      .replace(/:([a-z0-9-]+):/gi, "$1")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function conceptHighlightTerm(doc, query) {
    if (!doc) return "";
    const intent = parseQueryIntent(query || "");
    const phrase = intent.conceptPhrase || intent.phrase;
    const normalizedPhrase = normalize(phrase);
    const candidates = unique([
      doc.primaryConcept,
      ...(Array.isArray(doc.concepts) ? doc.concepts : []),
      ...(Array.isArray(doc.references) ? doc.references : []),
    ].map((item) => String(item || "").trim()));
    if (!normalizedPhrase || !candidates.length) return "";
    const exact = candidates.find((item) => normalize(item) === normalizedPhrase);
    if (exact) return exact;
    const prefix = candidates.find((item) => normalize(item).startsWith(normalizedPhrase));
    if (prefix) return prefix;
    const wordPrefix = candidates.find((item) => normalize(item).split(/\s+/).some((word) => word.startsWith(normalizedPhrase)));
    return wordPrefix || "";
  }

  function searchNavigationTargetText(doc, query) {
    if (!doc) return "";
    const context = chooseContextLines(doc, query);
    const terms = unique(tokenize(query));
    const sourceLines = context?.lines?.length
      ? context.lines
      : Array.isArray(doc.renderContext) && doc.renderContext.length
        ? doc.renderContext
        : doc.context || [];
    const cleanedLines = sourceLines
      .map((line) => textForNavigation(line))
      .filter((line) => line && !/^`{3}/.test(line));
    const exactLine = cleanedLines.find((line) => terms.length && lineMatchesQuery(line, terms, "all"));
    const anyLine = cleanedLines.find((line) => terms.length && lineMatchesQuery(line, terms, "any"));
    const locationValue = String(doc.location || "");
    const hasSectionHash = locationValue.includes("#");
    const titleTarget = hasSectionHash ? textForNavigation(doc.title || "") : "";
    const target = exactLine || anyLine || titleTarget || textForNavigation(doc.title || "");
    return target.length > 220 ? target.slice(0, 220).trim() : target;
  }

  function resultUrlWithHighlight(doc, query) {
    const url = new URL(resultUrl(doc?.location || ""));
    const intent = parseQueryIntent(query);
    const term = isContentTagOnlyQuery(query, intent)
      ? queryContentTagTerms(intent)[0] || ""
      : conceptHighlightTerm(doc, query);
    const targetText = searchNavigationTargetText(doc, query);
    if (targetText) url.searchParams.set("knotis-target-text", targetText);
    if (term) url.searchParams.set("knotis-highlight", term);
    return url.href;
  }

  function getToggle() {
    let toggle = document.getElementById(SEARCH_ID);
    if (!toggle) {
      toggle = document.createElement("input");
      toggle.className = "md-toggle";
      toggle.type = "checkbox";
      toggle.id = SEARCH_ID;
      toggle.autocomplete = "off";
      toggle.setAttribute("data-md-toggle", "knotis-search");
      toggle.setAttribute("data-md-component", "knotis-search-toggle");
      document.body.prepend(toggle);
    }
    return toggle;
  }

  function getHeaderNav() {
    return (
      document.querySelector(".md-header__inner .md-header__option")?.parentElement ||
      document.querySelector(".md-header__inner") ||
      document.querySelector(".md-header nav") ||
      document.querySelector(".md-header")
    );
  }

  function ensureHeaderTrigger() {
    let trigger = document.querySelector(".knotis-search-trigger");
    if (trigger) {
      hydrateHeaderTrigger(trigger);
      document.dispatchEvent(new CustomEvent("knotis:search-trigger-mounted", { detail: { trigger } }));
      return trigger;
    }

    const nav = getHeaderNav();
    if (!nav) return null;

    trigger = createHeaderTrigger();
    const source = nav.querySelector(".md-header__source");
    if (source) nav.insertBefore(trigger, source);
    else nav.appendChild(trigger);
    document.dispatchEvent(new CustomEvent("knotis:search-trigger-mounted", { detail: { trigger } }));
    return trigger;
  }

  function hydrateHeaderTrigger(trigger) {
    trigger.classList.add("md-search", "knotis-search-trigger");
    trigger.setAttribute("role", "search");
    trigger.setAttribute("aria-label", "Search");
    trigger.setAttribute("aria-keyshortcuts", "Control+K Meta+K");
    let button = trigger.querySelector(".md-search__button");
    if (!button) {
      button = document.createElement("button");
      trigger.appendChild(button);
    }
    button.type = "button";
    button.className = "md-search__button";
    button.innerHTML = '<span class="md-search__button-label">Search</span>';
    button.setAttribute("aria-label", "Search");
    button.setAttribute("aria-keyshortcuts", "Control+K Meta+K");
    button.title = "Search";
  }

  function createHeaderTrigger() {
    const trigger = document.createElement("div");
    hydrateHeaderTrigger(trigger);
    return trigger;
  }

  function searchMarkup() {
    return `
      <label class="md-search__overlay" for="${SEARCH_ID}"></label>
      <div class="md-search__inner" role="search">
        <form class="md-search__form" name="search">
          <input type="text" class="md-search__input" name="query" aria-label="Search" placeholder="Search" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" data-md-component="knotis-search-query">
          <label class="md-search__icon md-icon" for="${SEARCH_ID}" aria-label="Close search">${ICONS.search}${ICONS.back}</label>
          <nav class="md-search__options" aria-label="Search options">
            <button type="button" class="md-search__icon md-icon knotis-search__filters-toggle" aria-label="Toggle filters" aria-expanded="true">
              ${ICONS.filter}
              <span class="knotis-search__filter-count" hidden>0</span>
            </button>
          </nav>
          <div class="md-search__suggest" data-md-component="knotis-search-suggest"></div>
        </form>
        <div class="knotis-search__body">
          <div class="md-search__output">
            <div class="md-search__scrollwrap" tabindex="0" data-md-scrollfix>
              <div class="md-search-result" data-md-component="knotis-search-result">
                <div class="md-search-result__meta">Initializing search</div>
                <ol class="md-search-result__list" role="presentation"></ol>
              </div>
            </div>
          </div>
          <aside class="knotis-search-filters" aria-label="Search filters" hidden>
            <div class="knotis-search-filters__header">Filters</div>
            <div class="knotis-search-filters__group">
              <div class="knotis-search-filters__title">Tags</div>
              <div class="knotis-search-filters__list"></div>
            </div>
          </aside>
        </div>
      </div>
    `;
  }

  function ensureSearchComponent() {
    getToggle();
    const trigger = ensureHeaderTrigger();
    let search = document.querySelector(".md-search[data-md-component='knotis-search']");

    if (!search || !search.classList.contains(SEARCH_CLASS)) {
      const next = document.createElement("div");
      next.className = `md-search ${SEARCH_CLASS}`;
      next.setAttribute("data-md-component", "knotis-search");
      next.setAttribute("role", "dialog");
      next.setAttribute("aria-label", "Search");
      next.innerHTML = searchMarkup();

      if (search) search.replaceWith(next);
      else if (trigger) trigger.insertAdjacentElement("afterend", next);
      else document.body.appendChild(next);
      search = next;
    }

    search.dataset.knotisSearchMounted = "true";
    return search;
  }

  async function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(INDEX_URL, { cache: "no-store" })
        .then((resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json();
        })
        .then(prepareIndex);
    }
    return indexPromise;
  }

  async function loadGraph() {
    if (!graphPromise) {
      graphPromise = fetch(GRAPH_URL, { cache: "no-store" })
        .then((resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json();
        })
        .then(prepareGraph)
        .catch((err) => {
          console.warn("[knotis-search] Graph data unavailable; related concepts hidden.", err);
          return { labels: new Map(), related: new Map(), meta: {} };
        });
    }
    return graphPromise;
  }

  function prepareGraph(raw) {
    const labels = new Map();
    for (const node of raw?.nodes || []) {
      if (node?.id && node?.label) labels.set(String(node.id), String(node.label));
    }

    const related = new Map();
    for (const edge of raw?.edges || []) {
      const source = String(edge?.source || "");
      const target = String(edge?.target || "");
      if (!source.startsWith("kw:") || !target.startsWith("kw:")) continue;
      const relation = String(edge?.relation || "");
      if (relation !== "hierarchy" && relation !== "sibling") continue;
      const weight = Number(edge?.weight || 0);
      for (const [from, to] of [[source, target], [target, source]]) {
        if (!related.has(from)) related.set(from, []);
        related.get(from).push({
          key: to.replace(/^kw:/, ""),
          label: labels.get(to) || to.replace(/^kw:/, ""),
          relation,
          weight,
        });
      }
    }

    for (const [key, items] of related) {
      const seen = new Set();
      related.set(key, items
        .sort((a, b) => (
          (a.relation === "hierarchy" ? 0 : 1) - (b.relation === "hierarchy" ? 0 : 1)
        ) || (b.weight - a.weight) || a.label.localeCompare(b.label))
        .filter((item) => {
          const itemKey = normalize(item.key);
          if (!itemKey || seen.has(itemKey)) return false;
          seen.add(itemKey);
          return true;
        })
        .slice(0, 5));
    }

    const meta = raw?.meta && typeof raw.meta === "object" ? raw.meta : {};
    return { labels, related, meta };
  }

  function resolveSearchPaneConfig(graph, index) {
    const normalizePaneConfig = window.KnotisSectionRender?.normalizePaneConfig;
    const fromGraph = graph?.meta?.defaults?.pane;
    const fromIndex = index?.raw?.meta?.defaults?.pane;
    const pane = (fromGraph && typeof fromGraph === "object")
      ? fromGraph
      : (fromIndex && typeof fromIndex === "object" ? fromIndex : null);
    if (typeof normalizePaneConfig === "function") {
      return normalizePaneConfig(pane || {});
    }
    return {
      initial_lines: 12,
      initial_list_items: 20,
      keyword_context_mode: "parent_list",
      skip_duplicate_headings: true,
      keyword_own_section: true,
      ...(pane || {}),
    };
  }

  function setSearchPaneConfig(config) {
    searchPaneConfigCache = config;
  }

  function getSearchPaneConfigSync() {
    return searchPaneConfigCache || resolveSearchPaneConfig({}, preparedIndex || {});
  }

  function prepareIndex(raw) {
    const docs = (raw.docs || []).map((doc, index) => {
      const title = String(doc.title || "");
      const text = String(doc.text || "");
      const searchTitle = String(Object.hasOwn(doc, "search_title") ? doc.search_title : title);
      const searchText = String(Object.hasOwn(doc, "search_text") ? doc.search_text : text);
      const tags = Array.isArray(doc.tags) ? doc.tags.map(String) : [];
      const filterTags = Array.isArray(doc.filter_tags) ? doc.filter_tags.map(String).filter(Boolean) : [];
      const concepts = Array.isArray(doc.concepts) ? doc.concepts.map(String) : [];
      const content_tags = Array.isArray(doc.content_tags) ? doc.content_tags.map(String) : [];
      const references = Array.isArray(doc.references) ? doc.references.map(String) : [];
      const conceptKeys = Array.isArray(doc.concept_keys) ? doc.concept_keys.map(String) : concepts.map(normalize);
      const referenceKeys = Array.isArray(doc.reference_keys) ? doc.reference_keys.map(String) : references.map(normalize);
      const renderContext = Array.isArray(doc.render_context) ? doc.render_context.map(String) : [];
      const sectionLinesRaw = Array.isArray(doc.section_lines_raw) ? doc.section_lines_raw.map(String) : [];
      const sectionKwOffset = Number.isFinite(Number(doc.section_kw_offset)) ? Number(doc.section_kw_offset) : 0;
      return {
        ...doc,
        id: String(doc.id || `${doc.kind || "doc"}:${index}`),
        title,
        text,
        searchTitle,
        searchText,
        tags,
        filterTags,
        _filterTags: filterTags.map(normalize).filter(Boolean),
        concepts,
        conceptKeys,
        primaryConcept: String(doc.primary_concept || concepts[0] || ""),
        content_tags,
        references,
        referenceKeys,
        breadcrumb: Array.isArray(doc.breadcrumb) ? doc.breadcrumb.map(String).filter(Boolean) : [],
        context: Array.isArray(doc.context) ? doc.context.map(String) : [],
        renderContext,
        sectionLinesRaw,
        sectionKwOffset,
        _contentLine: Number.isFinite(Number(doc.content_line)) ? Number(doc.content_line) : 999999,
        _pageOrder: Number.isFinite(Number(doc.page_order)) ? Number(doc.page_order) : 999999,
        _sectionOrder: Number.isFinite(Number(doc.section_order)) ? Number(doc.section_order) : 999999,
        _title: normalize(searchTitle),
        _text: normalize(searchText),
        _tags: normalize(tags.join(" ")),
        _concepts: normalize(concepts.join(" ")),
        _conceptKeys: conceptKeys.map(normalize).filter(Boolean),
        _content_tags: normalize(content_tags.join(" ")),
        _references: normalize(references.join(" ")),
        _referenceKeys: referenceKeys.map(normalize).filter(Boolean),
        _renderText: normalize(stripNonContentMarkup(renderContext.join(" "))),
      };
    });

    const pageDocs = new Map();
    docs.forEach((doc) => {
      if (doc.kind === "page") pageDocs.set(doc.page_url || doc.location, doc);
    });

    knownEntityKeys = new Set();
    knownReferenceKeys = new Set();
    searchOrder = Array.isArray(raw?.options?.order)
      ? raw.options.order.map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    docs.forEach((doc) => {
      for (const key of [...(doc._conceptKeys || []), ...(doc._referenceKeys || [])]) {
        const clean = stripTerminalPunctuation(key);
        if (clean) knownEntityKeys.add(clean);
      }
      for (const key of doc._referenceKeys || []) {
        const clean = stripTerminalPunctuation(key);
        if (clean) knownReferenceKeys.add(clean);
      }
    });

    
    
    
    
    
    
    
    const keywordPages = new Map();
    docs.forEach((doc) => {
      if (doc.kind !== "mention" || !doc.page_url) return;
      for (const key of new Set(doc._conceptKeys || [])) {
        if (!key) continue;
        if (!keywordPages.has(key)) keywordPages.set(key, new Map());
        const pages = keywordPages.get(key);
        pages.set(doc.page_url, (pages.get(doc.page_url) || 0) + 1);
      }
    });
    keywordDensity = new Map();
    keywordPages.forEach((pages, key) => {
      const pageCount = pages.size;
      const mentionCount = [...pages.values()].reduce((sum, n) => sum + n, 0);
      keywordDensity.set(key, { pageCount, mentionsPerPage: mentionCount / pageCount });
    });

    let lunrIndex = null;
    if (window.lunr) {
      try {
        lunrIndex = window.lunr(function () {
          this.ref("id");
          this.field("searchTitle", { boost: 20 });
          this.field("searchText", { boost: 1 });
          this.field("tags", { boost: 50 });
          this.field("concepts", { boost: 100 });
          this.field("content_tags", { boost: 80 });
          docs.forEach((doc) => this.add(doc));
        });
      } catch (err) {
        console.warn("[knotis-search] Lunr index unavailable; using fallback scorer.", err);
      }
    }

    preparedIndex = { raw, docs, pageDocs, lunrIndex };
    return preparedIndex;
  }

  function conceptMatchLevel(doc, conceptPhrase, conceptTerms) {
    const phrase = stripTerminalPunctuation(conceptPhrase);
    if (!phrase) return 0;
    const keys = unique([...(doc._conceptKeys || []), ...(doc.concepts || []).map(normalize), normalize(doc.primaryConcept)]);
    if (keys.some((key) => stripTerminalPunctuation(key) === phrase)) return 4;
    if (keys.some((key) => key.startsWith(phrase))) return 3;
    if (keys.some((key) => key.split(/\s+/).some((word) => word.startsWith(phrase)))) return 2;
    if (conceptTerms?.length && keys.some((key) => (
      conceptTerms.every((term) => key.split(/\s+/).some((word) => word.startsWith(term)))
    ))) return 2;
    if (phrase.length >= 4 && keys.some((key) => key.includes(phrase))) return 1;
    return 0;
  }

  
  
  
  
  
  
  function matchedConceptKeys(doc, conceptPhrase, conceptTerms) {
    const phrase = stripTerminalPunctuation(conceptPhrase);
    if (!phrase) return [];
    const keys = unique([...(doc._conceptKeys || []), ...(doc.concepts || []).map(normalize), normalize(doc.primaryConcept)]);
    return keys.filter((key) => (
      stripTerminalPunctuation(key) === phrase
      || key.startsWith(phrase)
      || key.split(/\s+/).some((word) => word.startsWith(phrase))
      || (conceptTerms?.length && conceptTerms.every((term) => key.split(/\s+/).some((word) => word.startsWith(term))))
    ));
  }

  
  
  
  
  function mentionLineIsBareLabel(doc) {
    const lines = docSectionLinesRaw(doc);
    if (!lines?.length) return true;
    const line = String(lines[docSectionKwOffset(doc)] ?? "");
    const residue = line
      .replace(/\[\[[^\]]+\]\]/g, " ")
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, " ")
      .replace(/:[a-z0-9-]+:/gi, " ")
      .replace(/[*_`~#>|:;.,!?()[\]{}\s-]+/g, "");
    return residue.length <= 2;
  }

  function stripSlideAnchorMarkers(text) {
    return String(text || "").replace(/⚓︎/g, "").replace(/⚓/g, "");
  }

  function haystackContainsPhrase(haystack, phrase) {
    const norm = normalize(stripTerminalPunctuation(phrase));
    if (!norm) return false;
    const escaped = norm.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(`\\b${escaped}\\b`, "i");
    return re.test(normalize(haystack));
  }

  function haystackContainsPhrasePrefix(haystack, phrase) {
    const terms = tokenize(stripTerminalPunctuation(phrase)).filter((term) => !term.startsWith("#"));
    if (!terms.length) return false;
    const escaped = terms.map((term) => term.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&"));
    const pattern = escaped.map((term, index) => (
      index === escaped.length - 1 ? `\\b${term}` : `\\b${term}\\b`
    )).join("\\s+");
    return new RegExp(pattern, "i").test(normalize(haystack));
  }

  function haystackContainsTerm(haystack, term) {
    const norm = normalize(term);
    if (!norm) return false;
    const escaped = norm.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(normalize(haystack));
  }

  function docHasStructuredEntityMatch(doc, query) {
    const intent = parseQueryIntent(query);
    const phrase = stripTerminalPunctuation(intent.conceptPhrase || intent.phrase || "");
    if (!phrase) return false;
    if (conceptMatchLevel(doc, phrase, intent.conceptTerms) >= 2) return true;
    return (doc?._referenceKeys || []).some((key) => {
      const reference = stripTerminalPunctuation(key);
      return reference === phrase || reference.startsWith(phrase);
    });
  }

  function docHasTeachingWikilink(doc, query) {
    if (doc?.kind === "mention") {
      return mentionMatchesQuery(doc, query);
    }
    if (!docHasStructuredEntityMatch(doc, query)) return false;
    const lines = doc.renderContext?.length
      ? doc.renderContext
      : (docSectionLinesRaw(doc) || []);
    return lines.some((line) => lineHasMatchingWikilink(line, query));
  }

  function mentionMatchesQuery(doc, query) {
    const intent = parseQueryIntent(query);
    const phrase = intent.conceptPhrase || "";
    if (!phrase) return false;
    return conceptMatchLevel(doc, phrase, intent.conceptTerms) >= 2;
  }

  function scoreDoc(doc, query, intent, lunrScores) {
    const phrase = intent.phrase;
    if (!phrase) return null;
    const explicitTags = intent.explicitTags || intent.terms.filter((term) => term.startsWith("#"));
    if (explicitTags.length) {
      const docContentTags = new Set((doc.content_tags || []).map((tag) => normalize(tag)));
      if (!explicitTags.every((tag) => docContentTags.has(tag))) return null;
    }
    if (doc.kind === "mention" && !mentionMatchesQuery(doc, query)) return null;

    const headingPhrase = stripTerminalPunctuation(doc._title);
    const textPhrase = explicitTags.length && intent.conceptPhrase ? intent.conceptPhrase : phrase;
    const queryPhrase = stripTerminalPunctuation(textPhrase);
    const queryConceptPhrase = stripTerminalPunctuation(intent.conceptPhrase || normalize(String(query || "").replace(/#[a-z0-9_-]+\b/gi, " ")));
    const entityPrefixQuery = queryIsEntityPrefix(queryPhrase);
    const haystack = `${doc._title} ${doc._text} ${doc._tags} ${doc._concepts} ${doc._content_tags} ${doc._references}`;
    
    
    
    
    
    
    
    
    const exactPhraseInTitle = haystackContainsPhrase(doc._title, textPhrase);
    const exactPhraseInText = haystackContainsPhrase(doc._text, textPhrase);
    const phraseInTitle = exactPhraseInTitle || haystackContainsPhrasePrefix(doc._title, textPhrase);
    const phraseInText = exactPhraseInText || haystackContainsPhrasePrefix(doc._text, textPhrase);
    const phraseInConcepts = haystackContainsPhrase(doc._concepts, textPhrase)
      || haystackContainsPhrasePrefix(doc._concepts, textPhrase);
    const conceptLevel = conceptMatchLevel(doc, queryConceptPhrase, intent.conceptTerms);
    const exactConceptMatch = conceptLevel >= 4;
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    
    const primaryConceptKey = stripTerminalPunctuation(doc.primaryConcept || (doc.concepts || [])[0] || "");
    const isPrimaryConceptMatch = doc.kind !== "mention"
      && exactConceptMatch && primaryConceptKey && primaryConceptKey === queryConceptPhrase
      && !isBoilerplateKeyword(queryConceptPhrase);
    const referenceKeys = doc._referenceKeys || [];
    const exactReferenceMatch = referenceKeys.some((reference) => stripTerminalPunctuation(reference) === queryPhrase);
    const prefixReferenceMatch = queryPhrase.length >= 2 && referenceKeys.some((reference) => stripTerminalPunctuation(reference).startsWith(queryPhrase));
    const wordReferenceMatch = queryPhrase.length >= 5 && referenceKeys.some((reference) => (
      stripTerminalPunctuation(reference).split(/\s+/).some((word) => word.startsWith(queryPhrase))
    ));
    if (doc.kind === "reference_occurrence") {
      if (!exactReferenceMatch && !prefixReferenceMatch && !wordReferenceMatch) return null;
      if (knownReferenceKeys.has(queryPhrase) && !exactReferenceMatch) return null;
    }
    
    
    
    
    
    
    
    
    
    
    
    
    const exactMentionMatch = (exactConceptMatch || exactReferenceMatch)
      && (!isBoilerplateKeyword(queryConceptPhrase) || !mentionLineIsBareLabel(doc));
    const exactHeadingMatch = headingPhrase === queryPhrase || doc._title === phrase;
    const contentTagTerms = queryContentTagTerms(intent);
    const contentTagOnly = isContentTagOnlyQuery(query, intent);
    if (contentTagOnly) {
      if (!contentTagTerms.every((tag) => doc._content_tags.includes(tag))) return null;
      const sectionLines = docSectionLinesRaw(doc);
      if (sectionLines?.length && findContentTagBlockIndex(sectionLines, contentTagTerms) < 0) return null;
    }
    const conceptContentTagMatch = contentTagTerms.length > 0 && exactConceptMatch && contentTagTerms.every((tag) => doc._content_tags.includes(tag));
    const fuzzyConceptContentTagMatch = conceptLevel >= 2 && contentTagTerms.length && contentTagTerms.every((tag) => doc._content_tags.includes(tag));
    const requiredTextTerms = explicitTags.length ? intent.conceptTerms : intent.terms;
    const matchedTerms = requiredTextTerms.filter((term) => haystackContainsTerm(haystack, term));
    const taskAwareMatch = intent.hasTaskIntent && conceptLevel >= 2 && contentTagTerms.every((tag) => doc._content_tags.includes(tag));
    const multiWordQuery = intent.conceptTerms.length > 1;
    const fullPhraseNorm = normalize(stripTerminalPunctuation(intent.conceptPhrase));
    const hasFullPhrase = !multiWordQuery || (fullPhraseNorm && (
      haystackContainsPhrase(haystack, intent.conceptPhrase)
      || haystackContainsPhrasePrefix(haystack, intent.conceptPhrase)
    ));
    const teachingWikilink = docHasTeachingWikilink(doc, query);
    if (multiWordQuery && !hasFullPhrase && !exactReferenceMatch && !prefixReferenceMatch && !wordReferenceMatch && conceptLevel < 2 && !taskAwareMatch && !teachingWikilink) {
      return null;
    }
    
    
    
    
    
    
    
    
    if (multiWordQuery && conceptLevel >= 4 && doc.kind === "section" && !teachingWikilink && !phraseInTitle && !exactReferenceMatch) {
      return null;
    }
    const hasMatchSignal = contentTagOnly || phraseInTitle || phraseInText || phraseInConcepts || conceptLevel >= 2 || teachingWikilink
      || exactReferenceMatch || prefixReferenceMatch || wordReferenceMatch || taskAwareMatch;
    if (!hasMatchSignal && matchedTerms.length < requiredTextTerms.length) return null;

    let score = 0;
    let priority = PRIORITY.BASE;
    if (exactReferenceMatch) {
      score += 62000;
      priority = Math.max(priority, PRIORITY.EXACT_REFERENCE);
    }
    
    
    
    
    
    if (!exactReferenceMatch && (prefixReferenceMatch || wordReferenceMatch)) {
      score += 38000;
      priority = Math.max(
        priority,
        multiWordQuery ? PRIORITY.PARTIAL_REFERENCE_TARGET : PRIORITY.PARTIAL_REFERENCE,
      );
    }
    if (conceptContentTagMatch) score += 52000;
    if (conceptContentTagMatch) priority = Math.max(priority, PRIORITY.TASK_MATCH);
    if (fuzzyConceptContentTagMatch) {
      score += 51000 + conceptLevel * 800;
      priority = Math.max(priority, PRIORITY.TASK_MATCH);
    }
    if (exactConceptMatch) {
      score += 50000;
      if (isPrimaryConceptMatch) priority = Math.max(priority, PRIORITY.EXACT_CONCEPT);
    }
    if (teachingWikilink) {
      score += 2800;
      
      
      
      
      
      
      
      
      if (doc.kind === "mention" && exactMentionMatch) {
        priority = Math.max(priority, PRIORITY.TEACHING_MENTION);
      }
    }
    
    
    
    
    
    
    
    
    
    if (conceptLevel >= 2 && !isPrimaryConceptMatch) {
      score += 44000 + conceptLevel * 900;
      const matched = matchedConceptKeys(doc, queryConceptPhrase, intent.conceptTerms);
      const allBoilerplate = matched.length > 0
        && matched.every((key) => isBoilerplateKeyword(stripTerminalPunctuation(key)));
      const shadowedHeadWordPrefix = queryPrefixesSingleWordEntity(queryPhrase)
        && matched.length > 0
        && matched.every((key) => {
          const words = stripTerminalPunctuation(key).split(/\s+/).filter(Boolean);
          return words.length > 1 && words[0].startsWith(queryPhrase);
        });
      priority = Math.max(
        priority,
        (allBoilerplate || shadowedHeadWordPrefix) ? PRIORITY.PARTIAL_CONCEPT_BOILER : PRIORITY.PARTIAL_CONCEPT,
      );
    }
    if (exactHeadingMatch) {
      score += 42000;
      
      
      
      
      
      if (doc.kind !== "mention") priority = Math.max(priority, PRIORITY.EXACT_HEADING);
    }
    if (doc._title === phrase) score += 10000;
    else if (doc._title.startsWith(phrase)) score += 7000;
    else if (phraseInTitle) score += 4500;
    if (phraseInText) score += 1200;
    
    
    
    
    
    
    
    
    
    
    
    
    
    const explainedByNonPrimaryConcept = conceptLevel >= 2 && !isPrimaryConceptMatch;
    if ((exactPhraseInTitle || (entityPrefixQuery && phraseInTitle)) && !explainedByNonPrimaryConcept) {
      priority = Math.max(priority, PRIORITY.PHRASE_IN_TITLE);
    }
    if ((exactPhraseInText || (entityPrefixQuery && phraseInText)) && !explainedByNonPrimaryConcept) {
      priority = Math.max(priority, PRIORITY.PHRASE_IN_TEXT);
    }

    for (const term of intent.terms) {
      if (doc._title.includes(term)) score += 650;
      if (doc._text.includes(term)) score += 120;
      if (doc._tags.includes(term)) score += 500;
      if (doc._concepts.includes(term) || (doc._conceptKeys || []).some((key) => key.includes(term))) score += 950;
      if (doc._content_tags.includes(term)) score += 900;
      if (doc._references.includes(term)) score += 1200;
    }

    if (query.trim().startsWith("#") && doc.kind === "content_tag") score += 5000;
    if (doc.kind === "concept" && doc._title === phrase) score += 1800;
    if (doc.kind === "reference" && doc._title === phrase) score += 1600;
    if (doc.kind === "page") score += 80;
    if (doc.kind === "section") score += 40;
    
    
    
    
    if (doc.kind === "mention" && docSectionLinesRaw(doc)) {
      score += 47000;
      priority = Math.max(priority, exactMentionMatch ? PRIORITY.MENTION_EXACT_RICH : PRIORITY.MENTION_PARTIAL_RICH);
    } else if (doc.kind === "mention") {
      score += 8000;
      priority = Math.max(priority, exactMentionMatch ? PRIORITY.MENTION_EXACT_PLAIN : PRIORITY.MENTION_PARTIAL_PLAIN);
    }
    if (contentTagOnly) {
      score += 20000;
      priority = Math.max(priority, PRIORITY.CONTENT_TAG_ONLY);
      const docTags = doc.content_tags || [];
      if (contentTagTerms.length === 1 && docTags.length === 1 && normalize(docTags[0]) === contentTagTerms[0]) {
        score += 25000;
        priority = Math.max(priority, PRIORITY.CONTENT_TAG_EXACT_SOLE);
      }
      if (contentTagTerms.some((tag) => doc._title.includes(tag))) {
        score += 15000;
        priority = Math.max(priority, PRIORITY.CONTENT_TAG_IN_TITLE);
      } else if (contentTagTerms.some((tag) => doc._title.includes(tag.replace(/^#/, "")))) {
        score += 12000;
        priority = Math.max(priority, PRIORITY.CONTENT_TAG_IN_TITLE_LOOSE);
      }
      if (contentTagTerms.length === 1 && docTags.length > 1) {
        score -= 5000;
      }
    }
    if (lunrScores?.has(doc.id)) score += Math.round(lunrScores.get(doc.id) * 100);

    return { score, priority };
  }

  function lunrScoresFor(query, index) {
    if (!index.lunrIndex) return null;
    const terms = tokenize(query).filter((term) => !term.startsWith("#"));
    if (!terms.length) return null;
    try {
      const q = terms.map((term) => `${term}*`).join(" ");
      return new Map(index.lunrIndex.search(q).map((result) => [result.ref, result.score]));
    } catch {
      return null;
    }
  }

  function docMatchesFilters(doc, filters) {
    if (!filters || !filters.size) return true;
    const tags = new Set(doc._filterTags || []);
    return [...filters].every((filter) => tags.has(filter));
  }

  function docContentLine(doc) {
    return Number.isFinite(Number(doc?._contentLine)) ? Number(doc._contentLine) : 999999;
  }

  function firstQueryMatchOffsetInDoc(doc, query) {
    const lines = docSectionLinesRaw(doc) || [];
    if (!query || !lines.length) return docSectionKwOffset(doc) || 0;
    if (doc?.kind === "reference_occurrence") return docSectionKwOffset(doc) || 0;
    const structuredEntityMatch = docHasStructuredEntityMatch(doc, query);
    if (structuredEntityMatch) {
      for (let i = 0; i < lines.length; i++) {
        if (lineHasMatchingWikilink(lines[i], query)) return i;
      }
    }
    const phrase = queryConceptPhrase(query);
    if (phrase) {
      for (let i = 0; i < lines.length; i++) {
        const plainLine = String(lines[i] || "").replace(/\[\[[^\]]+\]\]/g, " ");
        if (haystackContainsPhrase(plainLine, phrase) || haystackContainsPhrasePrefix(plainLine, phrase)) return i;
      }
    }
    return docSectionKwOffset(doc) || 0;
  }

  function docFirstMatchLine(doc, query = "") {
    if (doc?.kind === "mention" || doc?.kind === "reference_occurrence") {
      return docContentLine(doc);
    }
    return docContentLine(doc) + firstQueryMatchOffsetInDoc(doc, query);
  }

  function compareReadingOrder(a, b, query = "") {
    const docA = a.doc || a;
    const docB = b.doc || b;
    
    
    
    
    
    const priorityA = Number.isFinite(Number(a.priority)) ? Number(a.priority) : 0;
    const priorityB = Number.isFinite(Number(b.priority)) ? Number(b.priority) : 0;
    if (priorityA !== priorityB) return priorityB - priorityA;
    const pageA = Number.isFinite(Number(docA._pageOrder)) ? Number(docA._pageOrder) : 999999;
    const pageB = Number.isFinite(Number(docB._pageOrder)) ? Number(docB._pageOrder) : 999999;
    if (pageA !== pageB) return pageA - pageB;
    const lineA = docA.kind ? docFirstMatchLine(docA, query) : (a.matchLine ?? 999999);
    const lineB = docB.kind ? docFirstMatchLine(docB, query) : (b.matchLine ?? 999999);
    if (lineA !== lineB) return lineA - lineB;
    return (b.score - a.score) || String(docA.id || "").localeCompare(String(docB.id || ""));
  }

  function groupDocs(items, { mentionByPage = null, query = "" } = {}) {
    const groups = new Map();
    const pageGroupKind = (doc) => (
      doc.kind === "page" || doc.kind === "section" || doc.kind === "mention" || doc.kind === "reference_occurrence" ? "page" : doc.kind
    );
    const pageGroupId = (doc) => (
      doc.kind === "page" || doc.kind === "section" || doc.kind === "mention" || doc.kind === "reference_occurrence"
        ? doc.group || doc.page_url || doc.location.split("#")[0]
        : doc.group || doc.id
    );

    for (const item of items) {
      const doc = item.doc;
      
      
      const groupId = pageGroupId(doc);
      if (!groups.has(groupId)) {
        groups.set(groupId, {
          id: groupId,
          kind: pageGroupKind(doc),
          score: item.score,
          priority: item.priority,
          pageOrder: doc._pageOrder,
          sectionOrder: doc._sectionOrder,
          matchLine: docFirstMatchLine(doc, query),
          docs: [],
        });
      }
      const group = groups.get(groupId);
      group.score = Math.max(group.score, item.score);
      group.priority = Math.max(group.priority, item.priority);
      group.pageOrder = Math.min(group.pageOrder, doc._pageOrder);
      group.sectionOrder = Math.min(group.sectionOrder, doc._sectionOrder);
      group.matchLine = Math.min(group.matchLine, docFirstMatchLine(doc, query));
      group.docs.push(item);
    }

    if (mentionByPage) {
      for (const [groupId, mentionItem] of mentionByPage.entries()) {
        const doc = mentionItem.doc;
        if (!groups.has(groupId)) {
          groups.set(groupId, {
            id: groupId,
            kind: "page",
            score: mentionItem.score,
            priority: mentionItem.priority,
            pageOrder: doc._pageOrder,
            sectionOrder: doc._sectionOrder,
            matchLine: docFirstMatchLine(doc, query),
            docs: [mentionItem],
          });
          continue;
        }
        const group = groups.get(groupId);
        const hasMention = group.docs.some((entry) => entry.doc.id === doc.id);
        if (!hasMention) group.docs.push(mentionItem);
        group.score = Math.max(group.score, mentionItem.score);
        group.priority = Math.max(group.priority, mentionItem.priority);
        group.matchLine = Math.min(group.matchLine, docFirstMatchLine(doc, query));
      }
    }
    return groups;
  }

  function normalizedSearchOrderPath(value) {
    let clean = String(value || "").trim().replace(/^\/+/, "").replace(/^docs\//, "").replace(/\/+$/, "");
    clean = clean.replace(/\/index\.md$/i, "").replace(/\.md$/i, "");
    return clean;
  }

  function searchGroupOrderRank(group) {
    if (!searchOrder.length) return 0;
    const pagePath = normalizedSearchOrderPath(group?.id || "");
    for (let index = 0; index < searchOrder.length; index += 1) {
      const token = normalizedSearchOrderPath(searchOrder[index]);
      if (token && (pagePath === token || pagePath.startsWith(`${token}/`))) return index;
    }
    return searchOrder.length;
  }

  function sortGroups(groups, query = "") {
    
    
    
    return [...groups.values()]
      .sort((a, b) => (
        (searchGroupOrderRank(a) - searchGroupOrderRank(b))
        || (b.priority - a.priority)
        || (a.pageOrder - b.pageOrder)
        || (a.matchLine - b.matchLine)
        || (a.sectionOrder - b.sectionOrder)
        || (b.score - a.score)
        || a.id.localeCompare(b.id)
      ))
      .slice(0, RESULT_LIMIT);
  }

  function filteredPageGroups(index, filters) {
    if (!filters?.size) return [];
    const items = index.docs
      .filter((doc) => doc.kind === "page" && docMatchesFilters(doc, filters))
      .map((doc) => ({ doc, score: 1, priority: 1 }));
    return sortGroups(groupDocs(items, { query: "" }), "");
  }

  function bestMentionByPage(scoredItems, query = "") {
    const mentionByPage = new Map();
    for (const item of scoredItems) {
      if (item.doc.kind !== "mention" || !mentionMatchesQuery(item.doc, query)) continue;
      const groupId = item.doc.group || item.doc.page_url || item.doc.location.split("#")[0];
      const prev = mentionByPage.get(groupId);
      if (!prev || compareReadingOrder(item, prev, query) < 0) {
        mentionByPage.set(groupId, item);
      }
    }
    return mentionByPage;
  }

  function sortSnippetItems(items, query) {
    
    
    
    
    
    
    
    
    const filtered = items.filter((item) => item.doc?.kind !== "mention" || mentionMatchesQuery(item.doc, query));
    return filtered.sort((a, b) => compareReadingOrder(a, b, query));
  }

  function resolveSectionKwOffsetForQuery(doc, query) {
    const lines = docSectionLinesRaw(doc);
    if (!lines?.length) return docSectionKwOffset(doc);
    const existing = docSectionKwOffset(doc);
    if (doc.kind === "reference_occurrence") return existing;
    if (existing > 0 && doc.kind === "mention") return existing;
    const trimmed = String(query || "").trim();
    if (!trimmed || trimmed.startsWith("#")) return existing;
    const structuredEntityMatch = docHasStructuredEntityMatch(doc, query);
    if (structuredEntityMatch) {
      for (let i = 0; i < lines.length; i++) {
        if (lineHasMatchingWikilink(lines[i], query)) return i;
      }
    }
    const phrase = queryConceptPhrase(query);
    if (phrase) {
      for (let i = 0; i < lines.length; i++) {
        const plainLine = String(lines[i] || "").replace(/\[\[[^\]]+\]\]/g, " ");
        if (haystackContainsPhrase(plainLine, phrase) || haystackContainsPhrasePrefix(plainLine, phrase)) return i;
      }
    }
    return existing;
  }

  function searchIndex(query, index, filters = activeFilters) {
    const intent = parseQueryIntent(query);
    if (!intent.terms.length) return [];
    const lunrScores = lunrScoresFor(query, index);
    const scoredAll = index.docs
      .filter((doc) => docMatchesFilters(doc, filters))
      .map((doc) => {
        const scoredDoc = scoreDoc(doc, query, intent, lunrScores);
        return scoredDoc ? { doc, score: scoredDoc.score, priority: scoredDoc.priority } : null;
      })
      .filter((item) => item && item.score > 0);

    const mentionByPage = bestMentionByPage(scoredAll, query);
    const scored = scoredAll
      .filter((item) => item.doc.kind === "page" || item.doc.kind === "section" || item.doc.kind === "reference_occurrence")
      .sort((a, b) => compareReadingOrder(a, b, query));

    
    
    
    
    
    
    const taskOnly = intent.hasTaskIntent && scored.some((item) => item.priority >= PRIORITY.GATE_TASK);
    const contentTagOnly = isContentTagOnlyQuery(query, intent) && scored.some((item) => item.priority >= PRIORITY.GATE_CONTENT_TAG);
    const strongEntityMatch = scored.some((item) => item.priority >= PRIORITY.GATE_ENTITY);
    const gateThreshold = taskOnly
      ? PRIORITY.GATE_TASK
      : contentTagOnly
        ? PRIORITY.GATE_CONTENT_TAG
        : strongEntityMatch
          ? PRIORITY.GATE_ENTITY
          : null;
    const visible = gateThreshold == null ? scored : scored.filter((item) => item.priority >= gateThreshold);

    
    
    
    
    
    const gatedMentionByPage = gateThreshold == null
      ? mentionByPage
      : new Map([...mentionByPage].filter(([, item]) => item.priority >= gateThreshold));

    return sortGroups(groupDocs(visible, { mentionByPage: gatedMentionByPage, query }), query);
  }

  function docUsesWikilinkOnlyHighlight(doc, query) {
    const intent = parseQueryIntent(query || "");
    if (intent.hasTaskIntent) return false;
    const phrase = stripTerminalPunctuation(intent.conceptPhrase || "");
    if (!phrase || String(query || "").trim().startsWith("#")) return false;
    return conceptMatchLevel(doc, phrase, intent.conceptTerms) >= 2;
  }

  function findSnippetStructuredBlockAround(lines, index) {
    if (index < 0 || index >= lines.length) return null;
    for (let start = index; start >= 0; start--) {
      const opener = parseAdmonitionOpener(lines[start]);
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

  function findSnippetTableBlockAround(lines, index) {
    const block = collectTableLines(lines, index);
    return block ? { start: block.start, end: block.end } : null;
  }

  function normalizeSnippetWindow(lines, start, end) {
    let safeStart = Math.max(0, start);
    let safeEnd = Math.min(lines.length, end);
    while (safeStart > 0 && activeFenceBefore(lines, safeStart)) safeStart--;
    const tableAtStart = findSnippetTableBlockAround(lines, safeStart);
    if (tableAtStart) safeStart = tableAtStart.start;
    const structuredAtStart = findSnippetStructuredBlockAround(lines, safeStart);
    if (structuredAtStart) safeStart = structuredAtStart.start;
    safeEnd = extendPastFence(lines, safeStart, safeEnd);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (let i = safeStart; i < safeEnd; i++) {
        const tableBlock = findSnippetTableBlockAround(lines, i);
        if (tableBlock && tableBlock.end > safeEnd) {
          safeEnd = tableBlock.end;
          safeEnd = extendPastFence(lines, safeStart, safeEnd);
          expanded = true;
        }
        const structuredBlock = findSnippetStructuredBlockAround(lines, i);
        if (structuredBlock && structuredBlock.end > safeEnd) {
          safeEnd = structuredBlock.end;
          safeEnd = extendPastFence(lines, safeStart, safeEnd);
          expanded = true;
        }
      }
    }
    return { start: safeStart, end: safeEnd };
  }

  function lineHasMatchingWikilink(line, query) {
    const phrase = normalize(queryConceptPhrase(query));
    if (!phrase) return false;
    for (const match of String(line || "").matchAll(/\[\[([^\]]+)\]\]/g)) {
      if (queryMatchesWikilinkRaw(match[1], query)) return true;
    }
    return false;
  }

  function highlightText(value, query) {
    const raw = String(value || "");
    const phrase = queryConceptPhrase(query);
    if (!phrase) return escapeHtml(raw);
    const escaped = phrase.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&").replace(/\s+/g, "\\s+");
    const expr = phrase.includes(" ")
      ? new RegExp(`\\b${escaped}`, "ig")
      : new RegExp(`\\b${escaped}`, "ig");
    let result = "";
    let last = 0;
    let match;
    while ((match = expr.exec(raw)) !== null) {
      result += escapeHtml(raw.slice(last, match.index));
      result += `<mark data-md-highlight>${escapeHtml(match[0])}</mark>`;
      last = match.index + match[0].length;
    }
    result += escapeHtml(raw.slice(last));
    return result;
  }


  function queryConceptPhrase(query) {
    const intent = parseQueryIntent(query);
    return stripTerminalPunctuation(intent.conceptPhrase || "");
  }

  function parseWikilinkRaw(raw) {
    const parts = String(raw || "").split("|");
    const target = (parts[0] || "").trim();
    const rawLabel = parts.length > 1 ? parts.slice(1).join("|").trim() : target;
    const isReference = parts.length > 1 && ["ref", "reference"].includes(rawLabel.toLowerCase());
    const label = isReference ? target : (rawLabel || target);
    return {
      target,
      label,
      keyword: normalize(target),
      labelKey: normalize(label),
    };
  }

  function queryMatchesWikilinkRaw(raw, query) {
    const phrase = normalize(queryConceptPhrase(query));
    if (!phrase) return false;
    const { keyword, labelKey } = parseWikilinkRaw(raw);
    return phrase === keyword || phrase === labelKey;
  }

  function highlightWikilinkLabelPartial(label, query) {
    const phrase = queryConceptPhrase(query);
    const raw = String(label || "");
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

  function renderWikilinkSpan(raw, query) {
    const { label } = parseWikilinkRaw(raw);
    const matched = queryMatchesWikilinkRaw(raw, query);
    const classes = matched
      ? "knotis-search-wikilink knotis-search-wikilink-match"
      : "knotis-search-wikilink";
    const labelHtml = matched ? escapeHtml(label) : highlightWikilinkLabelPartial(label, query);
    return `<span class="${classes}">${labelHtml}</span>`;
  }

  function highlightQueryPhrase(text, query) {
    const raw = String(text || "");
    const phrase = queryConceptPhrase(query);
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
        result += `<mark class="knotis-search-query-mark">${escapeHtml(match[0])}</mark>`;
        last = match.index + match[0].length;
      }
      result += escapeHtml(segment.slice(last));
      return result;
    };

    return raw.split(/(:[a-z0-9-]+:)/gi).map((segment) => (
      /^:[a-z0-9-]+:$/i.test(segment) ? escapeHtml(segment) : highlightSegment(segment)
    )).join("");
  }

  function renderInlineWikilinks(text, query) {
    return String(text || "").split(/(\[\[[^\]]+\]\])/).map((part) => {
      if (part.startsWith("[[") && part.endsWith("]]")) {
        return renderWikilinkSpan(part.slice(2, -2), query);
      }
      return highlightQueryPhrase(part, query);
    }).join("");
  }

  function renderSearchIconToken(token) {
    const icons = {
      "lucide-search": '<svg xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
      "fontawesome-brands-windows": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 4.5 11 3v8H2Zm10 0 10-1.5V11H12ZM2 12h9v8L2 18.5Zm10 0h10v8.5L12 20Z"/></svg>',
      "fontawesome-brands-apple": '<span aria-hidden="true"></span>',
    };
    const svg = icons[token];
    if (!svg) return null;
    return `<span class="knotis-search-icon md-icon" aria-hidden="true">${svg}</span>`;
  }

  function renderSearchKeyChord(content) {
    const parts = String(content || "").split("+").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return escapeHtml(`++${content}++`);
    const labelMap = {
      ctrl: "Ctrl",
      control: "Ctrl",
      cmd: "Cmd",
      command: "Cmd",
      alt: "Alt",
      option: "Option",
      shift: "Shift",
    };
    const rendered = parts.map((part) => {
      const lower = part.toLowerCase();
      const label = labelMap[lower] || (part.length === 1 ? part.toUpperCase() : part);
      return `<kbd>${escapeHtml(label)}</kbd>`;
    }).join('<span class="knotis-search-key-sep">+</span>');
    return `<span class="keys">${rendered}</span>`;
  }

  function tokenizeInlineDecorations(text) {
    const replacements = [];
    let working = String(text || "").replace(/&amp;nbsp;/g, "\u00a0");
    working = working.replace(/:([a-z0-9-]+):(?!:)(?:\{[^}\n]*\})?/gi, (match, token) => {
      const html = renderSearchIconToken(token);
      if (!html) return match;
      const index = replacements.length;
      replacements.push(html);
      return `\x00KDEC${index}\x00`;
    });
    working = working.replace(/\+\+([^<>\n]+?)\+\+/g, (match, content) => {
      const index = replacements.length;
      replacements.push(renderSearchKeyChord(content));
      return `\x00KDEC${index}\x00`;
    });
    return { text: working, replacements };
  }

  function restoreInlineDecorations(html, replacements) {
    if (!replacements.length) return html;
    return html.replace(/\x00KDEC(\d+)\x00/g, (_, rawIndex) => replacements[Number(rawIndex)] || "");
  }

  function renderInlinePlainChunk(value, query) {
    const decorated = tokenizeInlineDecorations(String(value || ""));
    const html = decorated.text.split(/(`[^`]+`|==[\s\S]*?==)/g).map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return `<code>${renderInlineWikilinks(part.slice(1, -1), query)}</code>`;
      }
      if (part.startsWith("==") && part.endsWith("==")) {
        return `<mark class="knotis-search-inline-mark">${renderInlinePlainChunk(part.slice(2, -2), query)}</mark>`;
      }
      return part
        .split(/(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g)
        .map((chunk) => {
          const strong = chunk.match(/^(?:\*\*([^*]+)\*\*|__([^_]+)__)$/);
          if (strong) return `<strong>${renderInlineWikilinks(strong[1] || strong[2], query)}</strong>`;
          const emphasis = chunk.match(/^(?:\*([^*]+)\*|_([^_]+)_)$/);
          if (emphasis) return `<em>${renderInlineWikilinks(emphasis[1] || emphasis[2], query)}</em>`;
          return renderInlineWikilinks(chunk, query);
        })
        .join("");
    }).join("");
    return restoreInlineDecorations(html, decorated.replacements);
  }

  function makeSnippet(text, query) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    const haystack = clean.toLowerCase();
    const terms = tokenize(query);
    let pos = -1;
    for (const term of terms) {
      const idx = haystack.indexOf(term);
      if (idx >= 0 && (pos < 0 || idx < pos)) pos = idx;
    }
    if (pos < 0) pos = 0;
    const start = Math.max(0, pos - SNIPPET_RADIUS);
    const end = Math.min(clean.length, pos + SNIPPET_RADIUS);
    const prefix = start > 0 ? "... " : "";
    const suffix = end < clean.length ? " ..." : "";
    return `${prefix}${clean.slice(start, end)}${suffix}`;
  }

  function lineMatchesQuery(line, terms, mode = "any") {
    const haystack = normalize(line);
    if (terms.length > 1) {
      return haystackContainsPhrasePrefix(haystack, terms.join(" "));
    }
    return mode === "all"
      ? terms.every((term) => haystackContainsPhrasePrefix(haystack, term))
      : terms.some((term) => haystackContainsPhrasePrefix(haystack, term));
  }

  function lineIndent(line) {
    return (String(line).match(/^[ \t]*/)?.[0] || "").replace(/\t/g, "  ").length;
  }

  function parseTeachingSectionHeader(line) {
    const trimmed = String(line || "").trim();
    const match = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (!match || lineIndent(line) !== 0) return null;
    const body = match[2];
    if (!/#(?:code|output|interpretation)\b/i.test(body) && !/\*\*.+\*\*/.test(body)) return null;
    return {
      sourceNumber: Number.parseInt(match[1], 10) || 1,
      text: body,
    };
  }

  function findTeachingSectionStart(lines, index) {
    for (let i = Math.min(index, lines.length - 1); i >= 0; i--) {
      if (parseTeachingSectionHeader(lines[i])) return i;
    }
    return Math.max(0, index);
  }

  function findTeachingSectionEnd(lines, start) {
    if (!parseTeachingSectionHeader(lines[start])) return lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (parseTeachingSectionHeader(lines[i])) return i;
    }
    return lines.length;
  }

  function findContextMatchIndex(lines, query, intent, terms, doc) {
    if (isContentTagOnlyQuery(query, intent)) {
      const tags = queryContentTagTerms(intent);
      const idx = findContentTagBlockIndex(lines, tags);
      if (idx >= 0) {
        if (parseTeachingSectionHeader(lines[idx])) return idx;
        if (/^#{1,6}\s+/.test(String(lines[idx]).trim())) return idx;
        return findTeachingSectionStart(lines, idx);
      }
    }
    const conceptTerms = (intent.conceptTerms || []).filter((term) => !term.startsWith("#"));
    if (doc && docUsesWikilinkOnlyHighlight(doc, query)) {
      const wikilinkIndex = lines.findIndex((line) => lineHasMatchingWikilink(line, query));
      if (wikilinkIndex >= 0) {
        if (parseTeachingSectionHeader(lines[wikilinkIndex])) return wikilinkIndex;
        return findTeachingSectionStart(lines, wikilinkIndex);
      }
    }
    if (intent.hasTaskIntent && conceptTerms.length) {
      const taskTokens = (intent.taskTags || []).map((tag) => tag.replace(/^#/, "").toLowerCase());
      const taskIndex = lines.findIndex((line) => {
        const haystack = normalize(line);
        return conceptTerms.every((term) => haystack.includes(term))
          && taskTokens.every((token) => haystack.includes(token));
      });
      if (taskIndex >= 0) return findTeachingSectionStart(lines, taskIndex);
    }

    let preciseMatch = terms.length > 1;
    let matchIndex = preciseMatch ? lines.findIndex((line) => lineMatchesQuery(line, terms, "all")) : -1;
    if (matchIndex < 0) matchIndex = lines.findIndex((line) => lineMatchesQuery(line, terms, "any"));
    if (matchIndex < 0) return -1;
    if (parseTeachingSectionHeader(lines[matchIndex])) return matchIndex;
    return findTeachingSectionStart(lines, matchIndex);
  }

  function resolveSnippetOrderedNumber(state, depth, sourceNumber) {
    const prev = state.counters.get(depth) || 0;
    let displayNumber = Number.parseInt(sourceNumber, 10);
    if (!Number.isFinite(displayNumber) || displayNumber < 1) {
      displayNumber = prev + 1;
    } else if (prev > 0 && displayNumber <= prev) {
      displayNumber = prev + 1;
    }
    for (const key of [...state.counters.keys()]) {
      if (key > depth) state.counters.delete(key);
    }
    state.counters.set(depth, displayNumber);
    return displayNumber;
  }

  function chooseContextLines(doc, query) {
    const sliceDoc = docForContentTagQuery(doc, query);
    const sourceLines = docSectionLinesRaw(sliceDoc)?.length
      ? docSectionLinesRaw(sliceDoc)
      : Array.isArray(sliceDoc.renderContext) && sliceDoc.renderContext.length
        ? sliceDoc.renderContext
        : sliceDoc.context;
    const lines = Array.isArray(sourceLines) ? sourceLines.map((line) => String(line || "")) : [];
    const intent = parseQueryIntent(query);
    const terms = unique(tokenize(query));
    if (!lines.some((line) => line.trim()) || !terms.length) return null;

    const matchIndex = findContextMatchIndex(lines, query, intent, terms, sliceDoc);
    if (matchIndex < 0) return null;
    const sectionStart = findTeachingSectionStart(lines, matchIndex);
    const sectionEnd = findTeachingSectionEnd(lines, sectionStart);
    if (parseTeachingSectionHeader(lines[sectionStart])) {
      const normalized = normalizeSnippetWindow(lines, sectionStart, sectionEnd);
      return {
        lines: lines.slice(normalized.start, normalized.end),
        prefix: normalized.start > sectionStart,
        suffix: normalized.end < sectionEnd,
      };
    }

    const isListLine = (l) => /^(?:[-*+]\s+|\d+[.)]\s+)/.test(String(l || "").trim());
    const isAdmonLine = (l) => Boolean(parseAdmonitionOpener(l));
    const isHeadingLine = (l) => /^#{1,6}\s+/.test(String(l || "").trim());
    const isIndentedLine = (l) => /^[ \t]{4,}\S/.test(String(l || ""));
    const isCodeLine = (l) => /^`[^`]/.test(String(l || "").trim()) && String(l || "").trim().endsWith("`");
    const isFenceLine = (l) => Boolean(parseFence(l));
    const isTableLine = (l) => Boolean(normalizedTableLine(l));
    const isImageLine = (l) => /^(?:!\[[^\]]*\]\([^)]+\)(?:\{[^}]*\})?|<img\b[^>]*>)\s*$/.test(stripListPrefix(l));

    const CONTEXT_BEFORE = 2;
    const MAX_LINES = String(doc.title || "").toLowerCase().includes("#code") || (doc.content_tags || []).some((t) => normalize(t) === "#code")
      ? 48
      : 32;

    let start = Math.max(sectionStart, matchIndex - CONTEXT_BEFORE);
    if (start > sectionStart && activeFenceBefore(lines, start)) {
      start = sectionStart;
    }
    const selected = [];
    let index = start;
    let inFence = false;
    const hardEnd = sectionEnd;
    while (index < hardEnd && (selected.length < MAX_LINES || inFence)) {
      if (selected.length && isHeadingLine(lines[index]) && !inFence) {
        break;
      }
      selected.push(lines[index]);
      if (isFenceLine(lines[index])) inFence = !inFence;
      index += 1;
      if (!inFence && selected.length >= 3 && index > matchIndex + 1 && index < hardEnd) {
        const next = lines[index] || "";
        if (parseTeachingSectionHeader(next)) break;
        if (isHeadingLine(next) || (!isListLine(next.trim()) && !isAdmonLine(next) && !isIndentedLine(next) && !isCodeLine(next) && !isFenceLine(next) && !isTableLine(next) && !isImageLine(next))) {
          break;
        }
      }
    }
    const expandedEnd = Math.min(extendPastFence(lines, start, index), hardEnd);
    while (index < expandedEnd) {
      selected.push(lines[index]);
      index += 1;
    }

    const tableExpanded = expandRangeForTables(lines, start, index);
    const normalized = normalizeSnippetWindow(lines, tableExpanded.start, tableExpanded.end);
    return {
      lines: lines.slice(normalized.start, normalized.end),
      prefix: normalized.start > sectionStart,
      suffix: normalized.end < sectionEnd,
    };
  }

  function expandRangeForTables(lines, start, end) {
    let sliceStart = start;
    let sliceEnd = end;
    for (let i = start; i < end; i++) {
      const block = collectTableLines(lines, i);
      if (block) {
        sliceStart = Math.min(sliceStart, block.start);
        sliceEnd = Math.max(sliceEnd, block.end);
      }
    }
    return { start: sliceStart, end: sliceEnd, lines: lines.slice(sliceStart, sliceEnd) };
  }

  function renderInlineMarkdown(value, query) {
    const text = String(value || "")
      .replace(/^#{1,6}\s+/, "")
      .trim();
    return renderInlinePlainChunk(text, query);
  }

  function parseMarkdownImage(line) {
    const candidate = stripListPrefix(line).trim();
    const match = candidate.match(/^!\[([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?\s*$/);
    if (!match) return null;
    return { alt: match[1] || "", src: match[2] || "" };
  }

  function isMarkerlessBlockLine(line) {
    return Boolean(
      parseFence(line)
      || parseAdmonitionOpener(line)
      || normalizedTableLine(line)
      || parseMarkdownImage(stripListPrefix(line)),
    );
  }


  function snippetListDepthFromLine(line, depthStack) {
    const indent = lineIndent(line);
    return Math.min(depthStack.length + 1, Math.max(1, Math.floor(indent / 4) + 1));
  }

  function appendMarkerlessListItem(html, line, depthStack) {
    const depth = snippetListDepthFromLine(line, depthStack);
    let out = "";
    if (depth > depthStack.length) {
      for (let d = depthStack.length; d < depth; d++) {
        out += "<ul>";
        depthStack.push("ul");
      }
      out += `<li class="knotis-search-markerless-li">${html}`;
      return out;
    }
    if (depth < depthStack.length) {
      while (depthStack.length > depth) {
        const tag = depthStack.pop();
        out += `</li></${tag}>`;
      }
    }
    out += `</li><li class="knotis-search-markerless-li">${html}`;
    return out;
  }

  function wrapSnippetMarkerlessBlock(html, line, depthStack) {
    return appendMarkerlessListItem(html, line, depthStack);
  }

  function imageUrl(src, pageUrl) {
    const cleanSrc = String(src || "").trim().replace(/^<(.+)>$/, "$1");
    if (/^\.\.\/assets\//.test(cleanSrc)) {
      return new URL(cleanSrc.replace(/^\.\.\//, ""), SITE_BASE).href;
    }
    if (/^(?:\.\/)?assets\//.test(cleanSrc)) {
      return new URL(cleanSrc.replace(/^\.\//, ""), SITE_BASE).href;
    }
    try {
      return new URL(cleanSrc, resultUrl(pageUrl || "")).href;
    } catch {
      return cleanSrc;
    }
  }

  function stripBlockListPrefix(line) {
    return String(line || "").replace(/^(\s*)(?:[-*+]|\d+\.)\s+/, "$1");
  }

  function stripListPrefix(line) {
    return String(line || "").trim().replace(/^(?:[-*+]|\d+\.)\s+/, "");
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
      type: match[3].toLowerCase(),
      title: match[4] || match[3],
    };
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
        end += 1;
        if (fence && fence.markerChar === activeMarker) break;
      }
    }
    return end;
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
      const currentIndent = lineIndent(line);
      if (currentIndent < bodyIndent) break;

      const previousIndent = previousIndex >= 0
        ? lineIndent(lines[previousIndex])
        : -1;
      const isDeeperChild = currentIndent === childIndent && previousIndent === bodyIndent;
      const isReturnedChild = currentIndent === bodyIndent && previousIndent > bodyIndent;

      if (
        separated
        && (isDeeperChild || isReturnedChild)
        && parseListLine(line)
        && previousIndex >= 0
        && parseListLine(lines[previousIndex])
      ) {
        let isTrailingBlock = true;
        for (let cursor = index; cursor < lines.length; cursor++) {
          const candidate = lines[cursor];
          if (!candidate.trim()) continue;
          const candidateIndent = lineIndent(candidate);
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
        endIndex += 1;
        continue;
      }
      const currentIndent = (line.match(/^(\s*)/)?.[1] || "").length;
      if (currentIndent < indent) {
        const previousBodyLine = [...bodyLines].reverse().find((bodyLine) => bodyLine.trim());
        const previousTableLine = previousBodyLine ? stripBlockListPrefix(previousBodyLine).trim() : "";
        if (previousTableLine.includes("|") && line.trim().includes("|")) {
          bodyLines.push(stripBlockListPrefix(line).trim());
          endIndex += 1;
          continue;
        }
        break;
      }
      const sliceIndent = line.startsWith(" ".repeat(indent)) ? indent : 0;
      bodyLines.push(sliceIndent ? line.slice(indent) : stripBlockListPrefix(line));
      endIndex += 1;
    }
    while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
    return { bodyLines, endIndex };
  }

  function normalizeTableRow(line) {
    const trimmed = stripBlockListPrefix(line).trim();
    if (!trimmed.startsWith("|")) return null;
    const pipeCount = (trimmed.match(/\|/g) || []).length;
    if (pipeCount < 2) return null;
    return trimmed.endsWith("|") ? trimmed : `${trimmed}|`;
  }

  function normalizedTableLine(line) {
    return normalizeTableRow(line);
  }

  function isTableRowLine(line) {
    return Boolean(normalizeTableRow(line));
  }

  function collectTableLines(lines, startIndex) {
    if (!isTableRowLine(lines[startIndex])) return null;

    let start = startIndex;
    while (start > 0 && isTableRowLine(lines[start - 1])) {
      start -= 1;
    }

    const block = [];
    let end = start;
    while (end < lines.length && isTableRowLine(lines[end])) {
      block.push(normalizeTableRow(lines[end]));
      end += 1;
    }
    if (block.length < 2) return null;

    const separatorIndex = block.findIndex((row, index) => index > 0 && isTableSeparator(row));
    if (separatorIndex !== 1) return null;

    return { lines: block, start, end };
  }

  function parseListLine(line) {
    const trimmed = String(line || "").trim();
    const ordered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) return { type: "ol", text: ordered[1], start: Number.parseInt(trimmed, 10) || 1 };
    const unordered = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unordered) return { type: "ul", text: unordered[1] };
    return null;
  }

  function addEllipsisToLine(line, position) {
    const parsed = parseListLine(line);
    if (!parsed) return position === "prefix" ? `... ${line}` : `${line} ...`;
    const marker = String(line).match(/^\s*(?:[-*+]|\d+[.)])\s+/)?.[0] || "";
    const text = position === "prefix" ? `... ${parsed.text}` : `${parsed.text} ...`;
    return `${marker}${text}`;
  }

  function parseTableLine(line) {
    const normalized = normalizeTableRow(line);
    if (!normalized) return null;
    return normalized.slice(1, -1).split("|").map((cell) => cell.trim());
  }

  function isTableSeparator(line) {
    const cells = parseTableLine(line);
    return !!cells?.length && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
  }

  function renderTableLines(lines, query) {
    const rows = lines
      .map((line) => parseTableLine(line))
      .filter(Boolean);
    if (!rows.length) return "";

    let hasHeader = false;
    let bodyRows = rows;
    if (rows.length > 1 && isTableSeparator(lines[1])) {
      hasHeader = true;
      bodyRows = rows.slice(2);
    }
    const headerHtml = hasHeader
      ? `<thead><tr>${rows[0].map((cell) => `<th>${renderInlineMarkdown(cell, query)}</th>`).join("")}</tr></thead>`
      : "";
    const bodyHtml = `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInlineMarkdown(cell, query)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    return `<div class="knotis-search-tablewrap"><table>${headerHtml}${bodyHtml}</table></div>`;
  }

  function renderSnippetLines(lines, query, pageUrl, concepts = []) {
    let html = "";
    const depthStack = [];
    const snippetOrderState = { counters: new Map() };
    let codeLines = null;
    let codeSourceLine = null;
    let fencedBlock = null;
    const renderCodeBlock = (label, code, sourceLine) => {
      const rows = code.map((cl, index) => (
        `<span class="knotis-search-codeblock__line"><span class="knotis-search-codeblock__number">${index + 1}</span><span class="knotis-search-codeblock__code">${escapeHtml(cl)}</span></span>`
      )).join("");
      const block = `<div class="knotis-search-codeblock"><div class="knotis-search-codeblock__toolbar"><span class="knotis-search-codeblock__label">${escapeHtml(label)}</span><button class="knotis-search-codeblock__copy" type="button" aria-label="Copy code" title="Copy code">Copy</button></div><pre><code>${rows}</code></pre></div>`;
      return wrapSnippetMarkerlessBlock(block, sourceLine || "", depthStack);
    };

    function flushCode() {
      if (codeLines !== null && codeLines.length) {
        html += renderCodeBlock("Code", codeLines, codeSourceLine);
      }
      codeLines = null;
      codeSourceLine = null;
    }

    function flushFencedBlock() {
      if (!fencedBlock || !fencedBlock.lines.length) {
        fencedBlock = null;
        return;
      }
      const normalized = fencedBlock.lines.map((entry) => stripBlockListPrefix(entry));
      const nonEmpty = normalized.filter((entry) => entry.trim());
      const minIndent = nonEmpty.length
        ? Math.min(...nonEmpty.map((entry) => (entry.match(/^(\s*)/)?.[1] || "").length))
        : 0;
      const stripped = normalized.map((entry) => entry.slice(minIndent));
      const lang = (fencedBlock.lang || "").toLowerCase();
      const sourceLine = fencedBlock.sourceLine || "";
      if (lang === "mermaid") {
        const source = stripped.join("\n").trim();
        if (source) {
          const diagram = `<div class="knotis-search-diagram" data-knotis-mermaid="${escapeAttr(source)}"><div class="knotis-search-diagram__surface">Rendering diagram...</div></div>`;
          html += wrapSnippetMarkerlessBlock(diagram, sourceLine, depthStack);
        }
      } else {
        const label = fencedBlock.lang ? fencedBlock.lang.toUpperCase() : "Code";
        html += renderCodeBlock(label, stripped, sourceLine);
      }
      fencedBlock = null;
    }

    function closeDownTo(targetDepth) {
      while (depthStack.length > targetDepth) {
        const tag = depthStack.pop();
        html += `</li></${tag}>`;
      }
    }

    function closeForMarkerlessBlock(_line) {
      return;
    }

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const trimmed = line.trim();
      if (fencedBlock) {
        if (parseFence(line)) {
          flushFencedBlock();
          continue;
        }
        fencedBlock.lines.push(String(line || ""));
        continue;
      }

      if (!trimmed) {
        flushCode();
        continue;
      }

      const fence = parseFence(line);
      if (fence) {
        flushCode();
        closeForMarkerlessBlock(line);
        fencedBlock = {
          lang: fence.info.split(/\s+/)[0] || "",
          lines: [],
          markerChar: fence.markerChar,
          sourceLine: line,
        };
        continue;
      }

      const isCodeLine = /^`[^`]/.test(stripListPrefix(line)) && stripListPrefix(line).endsWith("`");
      if (isCodeLine) {
        if (codeLines === null) {
          flushCode();
          closeForMarkerlessBlock(line);
          codeLines = [];
          codeSourceLine = line;
        }
        codeLines.push(stripListPrefix(line).slice(1, -1));
        continue;
      }
      flushCode();

      const teachingHeader = parseTeachingSectionHeader(line);
      if (teachingHeader) {
        closeDownTo(0);
        const displayNumber = resolveSnippetOrderedNumber(snippetOrderState, 0, teachingHeader.sourceNumber);
        html += `<p class="knotis-search-section-heading"><span class="knotis-search-section-heading__number">${displayNumber}.</span> ${renderInlineMarkdown(teachingHeader.text, query)}</p>`;
        continue;
      }

      const image = parseMarkdownImage(line);
      if (image) {
        closeForMarkerlessBlock(line);
        const figure = `<figure class="knotis-search-figure"><img src="${escapeAttr(imageUrl(image.src, pageUrl))}" alt="${escapeAttr(image.alt || "Search preview image")}" loading="lazy" onerror="this.closest('figure')?.classList.add('knotis-search-figure--missing'); this.remove();"><figcaption>[figure here]</figcaption></figure>`;
        html += wrapSnippetMarkerlessBlock(figure, line, depthStack);
        continue;
      }

      const tableBlock = collectTableLines(lines, index);
      if (tableBlock) {
        closeForMarkerlessBlock(line);
        html += wrapSnippetMarkerlessBlock(renderTableLines(tableBlock.lines, query), line, depthStack);
        index = tableBlock.end - 1;
        continue;
      }

      const admonition = parseAdmonitionOpener(line);
      if (admonition) {
        closeForMarkerlessBlock(line);
        const { bodyLines, endIndex } = collectIndentedBlock(
          lines,
          index,
          admonition.indent + 4,
          { splitTrailingChild: true },
        );
        const titleHtml = admonition.title ? renderInlineMarkdown(admonition.title, query) : "";
        const bodyHtml = bodyLines.length
          ? renderSnippetLines(bodyLines, query, pageUrl, concepts)
          : "";
        let admonitionHtml;
        if (admonition.kind === "details") {
          admonitionHtml = `<details class="${escapeHtml(admonition.type)}"${admonition.open ? " open" : ""}>`;
          if (titleHtml) admonitionHtml += `<summary>${titleHtml}</summary>`;
          admonitionHtml += bodyHtml;
          admonitionHtml += `</details>`;
        } else {
          admonitionHtml = `<div class="admonition ${escapeHtml(admonition.type)}">`;
          if (titleHtml) admonitionHtml += `<p class="admonition-title">${titleHtml}</p>`;
          admonitionHtml += bodyHtml;
          admonitionHtml += `</div>`;
        }
        html += wrapSnippetMarkerlessBlock(`<div class="md-typeset">${admonitionHtml}</div>`, line, depthStack);
        index = endIndex - 1;
        continue;
      }

      const parsed = parseListLine(line);
      if (parsed && !parsed.text.trim()) {
        const nextLine = lines[index + 1];
        if (nextLine && lineIndent(nextLine) > lineIndent(line) && isMarkerlessBlockLine(nextLine)) {
          continue;
        }
        continue;
      }
      if (parsed && !parseFence(line) && !parseAdmonitionOpener(line) && !normalizedTableLine(line)) {
        const rawIndent = line.match(/^[ \t]*/)[0];
        const indent = rawIndent.replace(/\t/g, "  ").length;
        const depth = Math.min(depthStack.length + 1, Math.max(1, Math.floor(indent / 4) + 1));
        const tag = parsed.type === "ol" ? "ol" : "ul";
        const content = renderInlineMarkdown(parsed.text, query);
        let startAttr = "";
        if (tag === "ol") {
          const displayNumber = resolveSnippetOrderedNumber(snippetOrderState, depth - 1, parsed.start);
          startAttr = ` start="${displayNumber}"`;
        }

        if (depth > depthStack.length) {
          for (let d = depthStack.length; d < depth; d++) {
            const openStart = tag === "ol" && d === depth - 1 ? startAttr : "";
            const liClass = tag === "ul" ? ' class="knotis-search-list-li"' : "";
            html += `<${tag}${openStart}><li${liClass}>`;
            depthStack.push(tag);
          }
          html += content;
        } else if (depth < depthStack.length) {
          closeDownTo(depth);
          if (depthStack.length === depth) {
            if (depthStack[depth - 1] !== tag) {
              const liClass = tag === "ul" ? ' class="knotis-search-list-li"' : "";
              html += `<${tag}${startAttr}><li${liClass}>${content}`;
              depthStack.push(tag);
            } else {
              html += `</li><li${tag === "ul" ? ' class="knotis-search-list-li"' : ""}>${content}`;
            }
          }
        } else {
          html += `</li><li${tag === "ul" ? ' class="knotis-search-list-li"' : ""}>${content}`;
        }
        continue;
      }

      if (/^#{1,6}\s+/.test(trimmed)) {
        closeDownTo(0);
        html += `<p class="knotis-search-heading"><strong>${renderInlineMarkdown(line, query)}</strong></p>`;
      } else {
        closeForMarkerlessBlock(line);
        html += `<p>${renderInlineMarkdown(line, query)}</p>`;
      }
    }

    flushFencedBlock();
    flushCode();
    closeDownTo(0);
    return html;
  }

  function sanitizeMermaidSource(source) {
    return String(source || "")
      .replace(/<(?!br\s*\/?>)/gi, "&lt;");
  }

  function renderBreadcrumb(doc, query, opts = {}) {
    const sourceParts = Array.isArray(doc.breadcrumb) ? doc.breadcrumb.filter(Boolean) : [];
    const parts = [];
    const withoutTrailingTag = (value) => normalize(value).replace(/\s+#[a-z0-9_-]+$/i, "").trim();
    for (const part of sourceParts) {
      const clean = stripSlideAnchorMarkers(String(part || "").trim());
      if (!clean) continue;
      if (parts.length && normalize(parts[parts.length - 1]) === normalize(clean)) continue;
      parts.push(clean);
    }
    for (let index = parts.length - 1; index > 0; index--) {
      if (withoutTrailingTag(parts[index]) === normalize(parts[index - 1])) {
        parts.splice(index - 1, 1);
      }
    }
    if (!opts.includeCurrent && parts.length && normalize(parts[parts.length - 1]) === normalize(doc.title || "")) {
      parts.pop();
    }
    if (!parts.length) return "";
    const keyword = snippetHighlightKeyword(doc, query);
    const sectionLines = docSectionLinesRaw(doc) || [];
    if (window.KnotisSectionRender?.renderSectionBreadcrumb && keyword) {
      const rendered = window.KnotisSectionRender.renderSectionBreadcrumb(parts, {
        keyword,
        renderOpts: { renderMode: "search", searchQuery: query },
        sectionLines,
        className: "knotis-search-breadcrumb",
      });
      if (rendered?.html) {
        return `<nav class="knotis-search-breadcrumb" aria-label="Result breadcrumb">${rendered.html}</nav>`;
      }
    }
    return `<nav class="knotis-search-breadcrumb" aria-label="Result breadcrumb">${
      parts.map((part) => `<span>${highlightText(part, query || "")}</span>`).join("")
    }</nav>`;
  }

  function renderSearchSectionPath(doc, query) {
    const title = String(doc.title || "").trim();
    if (!title) return "";
    const keyword = snippetHighlightKeyword(doc, query);
    const sectionLines = docSectionLinesRaw(doc) || [];
    if (window.KnotisSectionRender?.renderSectionBreadcrumb && keyword) {
      const rendered = window.KnotisSectionRender.renderSectionBreadcrumb([title], {
        keyword,
        renderOpts: { renderMode: "search", searchQuery: query },
        sectionLines,
        className: "md-search-result__path-inner",
      });
      if (rendered?.html) {
        return `<nav class="md-search-result__path">${rendered.html}</nav>`;
      }
    }
    return `<nav class="md-search-result__path">${highlightText(title, query || "")}</nav>`;
  }

  function graphKeyForConcept(value) {
    const key = normalize(value);
    return key ? `kw:${key}` : "";
  }

  function renderRelatedConcepts(doc, graph, query) {
    if (!graph?.related) return "";
    const concept = doc.primaryConcept || (doc.concepts || [])[0] || "";
    const conceptKey = normalize(concept);
    const queryKey = normalize(query);
    const related = (graph.related.get(graphKeyForConcept(concept)) || [])
      .filter((item) => {
        const key = normalize(item.key);
        const label = normalize(item.label);
        return key && key !== conceptKey && label !== conceptKey && key !== queryKey && label !== queryKey;
      });
    if (!related.length) return "";
    return `
      <nav class="knotis-search-related" aria-label="Related concepts">
        <span class="knotis-search-related__label">Related</span>
        ${related.map((item) => `
          <button type="button" class="knotis-search-related__link" data-knotis-search-action="${escapeAttr(JSON.stringify({ type: "concept", keyword: item.key }))}">${escapeHtml(item.label)}</button>
        `).join("")}
      </nav>
    `;
  }

  function docSectionLinesRaw(doc) {
    if (Array.isArray(doc.sectionLinesRaw) && doc.sectionLinesRaw.length) return doc.sectionLinesRaw;
    if (Array.isArray(doc.section_lines_raw) && doc.section_lines_raw.length) return doc.section_lines_raw;
    return null;
  }

  function docSectionKwOffset(doc) {
    if (Number.isInteger(doc.sectionKwOffset)) return doc.sectionKwOffset;
    const raw = Number(doc.section_kw_offset);
    return Number.isFinite(raw) ? raw : 0;
  }

  function renderPaneSnippetHtml(doc, query, paneConfig) {
    const sliceDoc = docForContentTagQuery(doc, query);
    const sectionLines = docSectionLinesRaw(sliceDoc);
    if (!sectionLines?.length) return "";
    if (!window.KnotisSectionRender?.renderInitialWindow) {
      console.warn("[knotis-search] KnotisSectionRender unavailable; snippet omitted.");
      return "";
    }
    const keyword = snippetHighlightKeyword(doc, query);
    const config = paneConfig || getSearchPaneConfigSync();
    const kwOffset = resolveSectionKwOffsetForQuery(sliceDoc, query);
    const html = window.KnotisSectionRender.renderInitialWindow(
      sectionLines,
      kwOffset,
      {
        pageUrl: sliceDoc.page_url || "",
        keyword,
        paneConfig: config,
        sectionParts: sliceDoc.breadcrumb || [],
        renderOpts: { renderMode: "search", searchQuery: query },
      }
    );
    if (!html || !html.trim()) return "";
    const wrap = window.KnotisSectionRender.wrapMarkdownSurface || ((body) => (
      `<div class="md-content"><div class="md-typeset heading-flow__content">${body}</div></div>`
    ));
    // data-page-url lets upgradePaneCodeBlocks() swap in the server-rendered
    // Pygments code blocks (same as pane cards) — it resolves the source page
    // from the nearest [data-page-url] ancestor.
    return wrap(html).replace(
      'class="md-typeset heading-flow__content"',
      `class="md-typeset heading-flow heading-flow--knotis heading-flow__content knotis-search-pane-snippet" data-page-url="${escapeAttr(sliceDoc.page_url || "")}"`,
    );
  }

  function makeSnippetHtml(doc, query, paneConfig) {
    if (docSectionLinesRaw(doc)?.length) {
      const paneSnippet = renderPaneSnippetHtml(doc, query, paneConfig);
      if (paneSnippet) return paneSnippet;
      return "";
    }
    const context = chooseContextLines(doc, query);
    if (!context) {
      const snippet = makeSnippet(doc.text, query);
      return snippet ? `<p>${renderInlineMarkdown(snippet, query)}</p>` : "";
    }

    const lines = [...context.lines];
    const isTableLine = (line) => Boolean(normalizeTableRow(line));
    const isStructureLine = (line) => {
      const trimmed = String(line || "").trim();
      return (
        /^#{1,6}\s+/.test(trimmed) ||
        Boolean(parseAdmonitionOpener(line)) ||
        Boolean(parseFence(line)) ||
        /^`[^`]/.test(stripListPrefix(line)) ||
        /^(?:!\[[^\]]*\]\([^)]+\)(?:\{[^}]*\})?|<img\b[^>]*>)\s*$/.test(stripListPrefix(line)) ||
        Boolean(normalizedTableLine(line))
      );
    };
    let prefixHtml = "";
    let suffixHtml = "";
    if (context.prefix && lines.length) {
      if (isTableLine(lines[0]) || isStructureLine(lines[0])) prefixHtml = `<p class="knotis-search-ellipsis">...</p>`;
      else lines[0] = addEllipsisToLine(lines[0], "prefix");
    }
    if (context.suffix && lines.length) {
      if (isTableLine(lines[lines.length - 1]) || isStructureLine(lines[lines.length - 1])) suffixHtml = `<p class="knotis-search-ellipsis">...</p>`;
      else lines[lines.length - 1] = addEllipsisToLine(lines[lines.length - 1], "suffix");
    }

    return `${prefixHtml}${renderSnippetLines(lines, query, doc.page_url, doc.concepts || [])}${suffixHtml}`;
  }

  function buildGroupSnippetDoc(article, sectionDoc, query) {
    const sectionLines = docSectionLinesRaw(sectionDoc) || docSectionLinesRaw(article);
    const displayTitle = sectionDocDisplayTitle(sectionDoc, article);
    const kwOffset = resolveSectionKwOffsetForQuery(sectionDoc, query);
    const merged = {
      ...article,
      ...sectionDoc,
      title: displayTitle,
      page_title: article.page_title || sectionDoc.page_title || "",
      text: sectionDoc.text || article.text,
      context: sectionDoc.context || article.context || [],
      renderContext: sectionDoc.renderContext || article.renderContext || [],
      concepts: sectionDoc.concepts || article.concepts || [],
      content_tags: sectionDoc.content_tags || article.content_tags || [],
      location: sectionDoc.location || article.location,
      breadcrumb: sectionDoc.breadcrumb || article.breadcrumb || [],
      primaryConcept: sectionDoc.primaryConcept || sectionDoc.primary_concept || article.primaryConcept || "",
      sectionLinesRaw: sectionLines || [],
      section_lines_raw: sectionLines || [],
      sectionKwOffset: kwOffset,
      section_kw_offset: kwOffset,
    };
    return query ? docForContentTagQuery(merged, query) : merged;
  }

  function snippetWindowRange(doc, query, paneConfig) {
    const sectionLines = docSectionLinesRaw(doc);
    if (!sectionLines?.length) {
      const identity = `fallback:${doc.page_url || ""}:${doc.location || ""}:${doc.title || ""}`;
      return { identity, key: identity, start: 0, end: 1 };
    }
    const kwOffset = resolveSectionKwOffsetForQuery(doc, query);
    const resolver = window.KnotisSectionRender?.resolveInitialWindow;
    const config = paneConfig || getSearchPaneConfigSync();
    let start = kwOffset;
    let end = kwOffset + 1;
    if (typeof resolver === "function") {
      try {
        const range = resolver(sectionLines, kwOffset, config, {
          pageUrl: doc.page_url || "",
          keyword: snippetHighlightKeyword(doc, query),
          sectionParts: doc.breadcrumb || [],
          renderOpts: { renderMode: "search", searchQuery: query },
        });
        start = Number.isFinite(Number(range?.displayStart)) ? Number(range.displayStart) : start;
        end = Number.isFinite(Number(range?.end)) ? Number(range.end) : end;
      } catch (err) {
        console.warn("[knotis-search] Could not resolve snippet window for deduping.", err);
      }
    }
    const identityText = (value) => normalize(stripNonContentMarkup(
      String(value || "").replace(/\[\[([^\]]+)\]\]/g, (_match, raw) => parseWikilinkRaw(raw).label)
    ));
    const firstLine = identityText(sectionLines[start]);
    const lastLine = identityText(sectionLines[Math.max(start, end - 1)]);
    const identity = [
      "section",
      doc.page_url || "",
      identityText(sectionLines.find((line) => String(line || "").trim())),
    ].join("\x1f");
    const key = [
      "section",
      doc.page_url || "",
      String(start),
      String(end),
      firstLine,
      lastLine,
    ].join("\x1f");
    return { identity, key, start, end };
  }

  function snippetWindowKey(doc, query, paneConfig) {
    return snippetWindowRange(doc, query, paneConfig).key;
  }

  function snippetRangesOverlap(a, b) {
    if (!a || !b || a.identity !== b.identity) return false;
    return Math.max(a.start, b.start) < Math.min(a.end, b.end);
  }

  function uniqueSnippetItems(article, items, query, paneConfig) {
    const seen = new Set();
    const seenRanges = [];
    const uniqueItems = [];
    for (const item of items) {
      const doc = buildGroupSnippetDoc(article, item.doc, query);
      const range = snippetWindowRange(doc, query, paneConfig);
      const key = range.key;
      if (seen.has(key)) continue;
      if (seenRanges.some((prev) => snippetRangesOverlap(prev, range))) continue;
      seen.add(key);
      seenRanges.push(range);
      uniqueItems.push({ ...item, doc });
    }
    return uniqueItems;
  }

  function itemOverlapsAnySnippetRange(article, item, ranges, query, paneConfig) {
    const doc = buildGroupSnippetDoc(article, item.doc, query);
    const range = snippetWindowRange(doc, query, paneConfig);
    return ranges.some((referenceRange) => snippetRangesOverlap(referenceRange, range));
  }

  function renderArticle(doc, query, score, isEntity, graph, paneConfig) {
    const action = doc.action ? escapeAttr(JSON.stringify(doc.action)) : "";
    const href = doc.action ? "#" : resultUrlWithHighlight(doc, query);
    const tagHtml = isEntity
      ? `<nav class="md-tags"><span class="md-tag">${escapeHtml(doc.kind)}</span>${doc.count ? `<span class="md-tag">${doc.count} matches</span>` : ""}</nav>`
      : "";
    const snippet = makeSnippetHtml(doc, query, paneConfig);
    const moduleTitle = !isEntity ? String(doc.page_title || "").trim() : "";
    const headline = moduleTitle || doc.title;
    const showSectionPath = !isEntity && moduleTitle && doc.title && normalize(doc.title) !== normalize(moduleTitle);
    const breadcrumbHtml = renderBreadcrumb(doc, query, { includeCurrent: true });
    const pathHtml = !breadcrumbHtml && showSectionPath ? renderSearchSectionPath(doc, query) : "";
    const relatedHtml = isEntity ? "" : renderRelatedConcepts(doc, graph, query);
    const linkAttrs = action
      ? ` data-knotis-search-action="${action}"`
      : ` data-href="${escapeAttr(href)}" role="link"`;
    return `
      <div class="md-search-result__link" tabindex="-1"${linkAttrs}>
        <article class="md-search-result__article" data-md-score="${Number(score || 0).toFixed(2)}">
          <div class="md-search-result__icon md-icon">${ICONS.document}</div>
          <h1>${renderInlineMarkdown(headline, query)}</h1>
          ${pathHtml}
          ${breadcrumbHtml}
          ${snippet ? `<div class="md-search-result__teaser">${snippet}</div>` : ""}
          ${relatedHtml}
          ${tagHtml}
        </article>
      </div>
    `;
  }

  function renderSnippet(doc, query, score, paneConfig) {
    const snippet = makeSnippetHtml(doc, query, paneConfig);
    if (!snippet) return "";
    const href = resultUrlWithHighlight(doc, query);
    return `
      <div class="md-search-result__more-link" tabindex="-1" data-href="${escapeAttr(href)}" data-md-score="${Number(score || 0).toFixed(2)}" role="link">
        ${renderBreadcrumb(doc, query, { includeCurrent: true })}
        <div class="md-search-result__teaser">${snippet}</div>
      </div>
    `;
  }

  function moreLabel(count) {
    return count === 1 ? "1 more on this page" : `${count} more on this page`;
  }

  function comparePageAppearance(a, b) {
    const docA = a.doc || a;
    const docB = b.doc || b;
    const lineA = docContentLine(docA);
    const lineB = docContentLine(docB);
    if (lineA !== lineB) return lineA - lineB;
    const sectionA = Number.isFinite(Number(docA._sectionOrder)) ? Number(docA._sectionOrder) : 999999;
    const sectionB = Number.isFinite(Number(docB._sectionOrder)) ? Number(docB._sectionOrder) : 999999;
    if (sectionA !== sectionB) return sectionA - sectionB;
    return String(docA.id || "").localeCompare(String(docB.id || ""));
  }

  function renderGroup(group, query, index, graph, paneConfig) {
    if (group.kind === "single") {
      const item = group.docs
        .sort((a, b) => compareReadingOrder(a, b, query))[0];
      return `<li class="md-search-result__item">${renderArticle(item.doc, query, item.score, false, graph, paneConfig)}</li>`;
    }

    if (group.kind !== "page") {
      const item = group.docs[0];
      return `<li class="md-search-result__item">${renderArticle(item.doc, query, item.score, true, graph, paneConfig)}</li>`;
    }

    const pageUrl = group.id;
    const articleItem = group.docs.find((item) => item.doc.kind === "page");
    const article = articleItem?.doc || index.pageDocs.get(pageUrl) || group.docs[0].doc;
    const snippetItems = sortSnippetItems(
      group.docs.filter((item) => item.doc.text),
      query,
    );
    const referenceItems = uniqueSnippetItems(
      article,
      snippetItems.filter((item) => item.doc.kind === "reference_occurrence"),
      query,
      paneConfig,
    );
    const referenceRanges = referenceItems.map((item) => snippetWindowRange(item.doc, query, paneConfig));
    const normalItems = uniqueSnippetItems(
      article,
      snippetItems.filter((item) => item.doc.kind !== "reference_occurrence"),
      query,
      paneConfig,
    ).filter((item) => !itemOverlapsAnySnippetRange(article, item, referenceRanges, query, paneConfig));
    const visibleItems = sortSnippetItems([...referenceItems, ...normalItems], query);
    const primary = visibleItems[0] || { doc: buildGroupSnippetDoc(article, article, query), score: articleItem?.score || group.score };
    const primaryDoc = primary.doc;
    const featuredReferences = referenceItems.filter((item) => item.doc.id !== primaryDoc.id);
    const remaining = normalItems
      .filter((item) => item.doc.id !== primaryDoc.id)
      .sort(comparePageAppearance);
    const more = remaining.slice(0, 8);

    return `
      <li class="md-search-result__item">
        ${renderArticle(primaryDoc, query, primary.score, false, graph, paneConfig)}
        ${featuredReferences.map((item) => renderSnippet(item.doc, query, item.score, paneConfig)).join("")}
        ${more.length ? `
          <details class="md-search-result__more">
            <summary tabindex="-1"><span class="md-search-result__more-icon">${ICONS.chevronBoxDown}</span><div>${moreLabel(more.length)}</div></summary>
            ${more.map((item) => renderSnippet(item.doc, query, item.score, paneConfig)).join("")}
          </details>
        ` : ""}
      </li>
    `;
  }

  async function renderLegacySearchDiagrams(search) {
    if (!search || !window.mermaid?.render) return;
    const diagrams = [...search.querySelectorAll("[data-knotis-mermaid]:not([data-knotis-mermaid-ready])")];
    for (const node of diagrams) {
      node.dataset.knotisMermaidReady = "true";
      const source = node.getAttribute("data-knotis-mermaid") || "";
      const surface = node.querySelector(".knotis-search-diagram__surface");
      if (!surface || !source.trim()) continue;
      try {
        const renderId = `knotis-search-mermaid-${Math.random().toString(36).slice(2)}`;
        window.KnotisMermaid?.configure?.();
        const result = await window.mermaid.render(renderId, sanitizeMermaidSource(source));
        surface.innerHTML = result.svg;
      } catch {
        surface.innerHTML = `<pre><code>${escapeHtml(source)}</code></pre>`;
      }
    }
  }

  async function renderSearchDiagrams(search) {
    if (!search) return;
    const surfaces = search.querySelectorAll(".md-search-result__teaser, .knotis-search-pane-snippet");
    if (window.KnotisMermaid?.render) {
      for (const surface of surfaces) {
        await window.KnotisMermaid.render(surface);
      }
    }
    await renderLegacySearchDiagrams(search);
  }

  function setMeta(search, text) {
    search.querySelector(".md-search-result__meta").textContent = text;
  }

  function collectFilterFacets(index) {
    const counts = new Map();
    for (const doc of index?.docs || []) {
      if (doc.kind !== "page") continue;
      for (const tag of doc.filterTags || []) {
        const key = normalize(tag);
        if (!key) continue;
        const current = counts.get(key) || { key, label: tag, count: 0 };
        current.count += 1;
        counts.set(key, current);
      }
    }
    return [...counts.values()]
      .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  }

  function updateFilterBadge(search) {
    const badge = search.querySelector(".knotis-search__filter-count");
    if (!badge) return;
    const count = activeFilters.size;
    badge.hidden = count === 0;
    badge.textContent = String(count);
  }

  function applyFilterPanelState(search, hasFacets) {
    const panel = search.querySelector(".knotis-search-filters");
    const toggle = search.querySelector(".knotis-search__filters-toggle");
    if (!panel || !toggle) return;
    const collapsed = search.dataset.knotisFiltersCollapsed === "true";
    const open = hasFacets && !collapsed;
    panel.hidden = !open;
    toggle.hidden = !hasFacets;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    search.classList.toggle("knotis-search--has-filters", open);
    search.classList.toggle("knotis-search--filters-available", hasFacets);
    updateFilterBadge(search);
  }

  function renderFilters(search, index) {
    const panel = search.querySelector(".knotis-search-filters");
    const list = search.querySelector(".knotis-search-filters__list");
    if (!panel || !list) return;
    const options = index?.raw?.options || {};
    if (options.filters === false) {
      panel.hidden = true;
      search.classList.remove("knotis-search--has-filters");
      search.classList.remove("knotis-search--filters-available");
      list.innerHTML = "";
      search.querySelector(".knotis-search__filters-toggle")?.setAttribute("hidden", "");
      return;
    }
    const facets = collectFilterFacets(index);
    applyFilterPanelState(search, facets.length > 0);
    if (!facets.length) {
      list.innerHTML = `<div class="knotis-search-filter-empty">No page tags</div>`;
      return;
    }
    list.innerHTML = `
      ${facets.map((facet) => {
        const active = activeFilters.has(facet.key);
        return `
          <button type="button" class="knotis-search-filter${active ? " knotis-search-filter--active" : ""}" data-knotis-filter="${escapeAttr(facet.key)}">
            <span>${escapeHtml(facet.label)}</span>
            <strong>${facet.count}</strong>
          </button>
        `;
      }).join("")}
    `;
  }

  function updateFilterButtonLabels(search) {
    search.querySelectorAll("[data-knotis-filter]").forEach((button) => {
      const active = activeFilters.has(button.dataset.knotisFilter || "");
      button.classList.toggle("knotis-search-filter--active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    updateFilterBadge(search);
  }

  function setSuggest(search, query, groups) {
    const suggest = search.querySelector(".md-search__suggest");
    if (!suggest) return;
    const options = preparedIndex?.raw?.options || {};
    if (!options.suggest || !query.trim() || !groups.length) {
      suggest.textContent = "";
      return;
    }
    const q = query.trim().toLowerCase();
    if (/\s/.test(q)) {
      suggest.textContent = "";
      return;
    }
    const candidates = [];
    for (const group of groups.slice(0, 12)) {
      for (const item of group.docs || []) {
        const doc = item.doc || {};
        candidates.push(doc.title, ...(doc.concepts || []), ...(doc.references || []), ...(doc.content_tags || []), ...(doc.renderContext || []));
      }
    }
    const word = candidates
      .join(" ")
      .split(/\s+/)
      .map((part) => part.replace(/^[^\w#]+|[^\w#-]+$/g, ""))
      .find((part) => part.toLowerCase().startsWith(q) && part.length > query.trim().length);
    suggest.textContent = word || "";
  }

  async function updateResults(search) {
    const input = search.querySelector(".md-search__input");
    const list = search.querySelector(".md-search-result__list");
    const query = input?.value || "";
    const trimmed = query.trim();
    const idle = !trimmed && !activeFilters.size;
    search.classList.toggle("knotis-search--empty", idle);
    search.classList.remove("knotis-search--no-results");
    try {
      const [index, graph] = await Promise.all([loadIndex(), loadGraph()]);
      const paneConfig = resolveSearchPaneConfig(graph, index);
      setSearchPaneConfig(paneConfig);
      renderFilters(search, index);
      if (idle) {
        list.innerHTML = "";
        setMeta(search, "");
        setSuggest(search, "", []);
        return;
      }

      setMeta(search, "Searching...");
      const groups = trimmed ? searchIndex(trimmed, index) : filteredPageGroups(index, activeFilters);
      search.classList.toggle("knotis-search--no-results", groups.length === 0);
      list.innerHTML = groups.map((group) => renderGroup(group, trimmed, index, graph, paneConfig)).join("");
      renderSearchDiagrams(search);
      // Swap client-rendered code boxes for the server-rendered (Pygments,
      // line-numbered) versions, exactly like pane cards do.
      window.KnotisSectionRender?.upgradePaneCodeBlocks?.(list);
      setMeta(search, groups.length === 1 ? "1 result" : `${groups.length} results`);
      setSuggest(search, trimmed, groups);
    } catch (err) {
      console.error("[knotis-search] Failed to search:", err);
      list.innerHTML = "";
      setMeta(search, "Search index could not be loaded");
    }
  }

  function scheduleUpdate(search) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => updateResults(search), 80);
  }

  function openSearch(query) {
    if (!searchEnabled) return;
    const search = ensureSearchComponent();
    const toggle = getToggle();
    const input = search.querySelector(".md-search__input");
    search.classList.add("knotis-search--active");
    toggle.checked = true;
    document.body.setAttribute("data-md-scrolllock", "");
    input.value = typeof query === "string" ? query : "";
    setTimeout(() => {
      input.focus();
      input.select();
      updateResults(search);
    }, 0);
  }

  function closeSearch() {
    const search = document.querySelector(`.${SEARCH_CLASS}`);
    const toggle = document.getElementById(SEARCH_ID);
    if (search) search.classList.remove("knotis-search--active");
    if (toggle) toggle.checked = false;
    document.body.removeAttribute("data-md-scrolllock");
  }

  // Other Knotis chrome (e.g. the pane, when one of its cards navigates on
  // the same page) asks the search overlay to close via this event.
  document.addEventListener("knotis:close-search", closeSearch);

  function handleAction(action) {
    if (action.type === "content_tag") {
      document.dispatchEvent(new CustomEvent("wikilink:open-content-tag-pane", {
        detail: { content_tag: action.content_tag, opts: { contextScope: "all_pages" } },
      }));
      return;
    }
    if (action.type === "reference") {
      document.dispatchEvent(new CustomEvent("wikilink:open-reference-pane", {
        detail: { keyword: action.keyword, opts: { contextScope: "all_pages" } },
      }));
      return;
    }
    if (action.type === "concept") {
      document.dispatchEvent(new CustomEvent("wikilink:open-pane", {
        detail: { keyword: action.keyword, contextScope: "all_pages" },
      }));
    }
  }

  async function copySearchCodeToClipboard(text) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  }

  function attachHandlers() {
    if (handlersAttached) return;
    handlersAttached = true;

    document.addEventListener("click", (event) => {
      const trigger = event.target.closest?.(".knotis-search-trigger");
      if (trigger) {
        event.preventDefault();
        openSearch();
        return;
      }

      const activeSearch = document.querySelector(`.${SEARCH_CLASS}.knotis-search--active`);
      if (
        activeSearch &&
        !event.target.closest?.(`.${SEARCH_CLASS} .md-search__inner`) &&
        !event.target.closest?.("#wikilink-pane")
      ) {
        event.preventDefault();
        closeSearch();
        return;
      }

      const actionLink = event.target.closest?.("[data-knotis-search-action]");
      if (actionLink) {
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
          handleAction(JSON.parse(actionLink.dataset.knotisSearchAction));
        } catch (err) {
          console.error("[knotis-search] Invalid action:", err);
        }
        return;
      }

      const copyBtn = event.target.closest?.(".knotis-search-codeblock__copy");
      if (copyBtn) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const block = copyBtn.closest(".knotis-search-codeblock");
        const lines = [...(block?.querySelectorAll(".knotis-search-codeblock__code") || [])]
          .map((node) => node.textContent || "");
        if (!lines.length) return;
        copySearchCodeToClipboard(lines.join("\n"))
          .then(() => {
            copyBtn.classList.add("knotis-search-codeblock__copy--done");
            copyBtn.textContent = "Copied";
            window.setTimeout(() => {
              copyBtn.classList.remove("knotis-search-codeblock__copy--done");
              copyBtn.textContent = "Copy";
            }, 1200);
          })
          .catch(() => {});
        return;
      }

    const search = event.target.closest?.(`.${SEARCH_CLASS}`);
    if (!search) return;

    const filterToggle = event.target.closest?.(".knotis-search__filters-toggle");
    if (filterToggle) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const collapsed = search.dataset.knotisFiltersCollapsed === "true";
      search.dataset.knotisFiltersCollapsed = collapsed ? "false" : "true";
      applyFilterPanelState(search, true);
      search.querySelector(".md-search__input")?.focus();
      return;
    }

    const filterButton = event.target.closest?.("[data-knotis-filter]");
    if (filterButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const key = filterButton.dataset.knotisFilter || "";
      if (activeFilters.has(key)) activeFilters.delete(key);
      else activeFilters.add(key);
      updateFilterButtonLabels(search);
      updateResults(search);
      search.querySelector(".md-search__input")?.focus();
      return;
    }

    function nestedSearchInteractive(target, container) {
      const interactive = target.closest?.("a[href], button, .wikilink, .wikilink-card__md-link, [role=\"button\"]");
      return interactive && container.contains(interactive) && interactive !== container;
    }

    function navigateSearchResult(container) {
      const href = container.dataset.href || container.getAttribute("href") || "";
      if (!href || href === "#") return;
      closeSearch();
      try {
        const url = new URL(href, location.href);
        const targetText = url.searchParams.get("knotis-target-text") || "";
        if (targetText) window.KnotisSectionRender?.setPendingNavigation?.(href, targetText);
      } catch (err) {
        console.warn("[DEBUG] recording pending navigation target failed", err);
      }
      location.href = href;
    }

    const resultLink = event.target.closest?.(".md-search-result__link");
    if (resultLink && !resultLink.hasAttribute("data-knotis-search-action")) {
      if (nestedSearchInteractive(event.target, resultLink)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateSearchResult(resultLink);
      return;
    }

    const moreLink = event.target.closest?.(".md-search-result__more-link");
    if (moreLink) {
      if (nestedSearchInteractive(event.target, moreLink)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      navigateSearchResult(moreLink);
      return;
    }

    if (event.target.closest(".md-search__form > .md-search__icon")) {
      event.preventDefault();
      closeSearch();
      return;
    }

    if (event.target.closest(".md-search__overlay")) {
      closeSearch();
      return;
    }

  }, true);

    document.addEventListener("input", (event) => {
      const search = event.target.closest?.(`.${SEARCH_CLASS}`);
      if (search && event.target.matches(".md-search__input")) scheduleUpdate(search);
    }, true);

    document.addEventListener("reset", (event) => {
      const search = event.target.closest?.(`.${SEARCH_CLASS}`);
      if (!search) return;
      event.preventDefault();
      const input = search.querySelector(".md-search__input");
      if (input?.value) {
        input.value = "";
        updateResults(search);
        input.focus();
      } else {
        closeSearch();
      }
    }, true);

    document.addEventListener("keydown", (event) => {
      const activeSearch = document.querySelector(`.${SEARCH_CLASS}.knotis-search--active`);
      const target = event.target;
      const isTextInput = target && /^(input|textarea|select)$/i.test(target.tagName || "");
      const isSlashShortcut = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isCommandK = event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey;

      if (isSlashShortcut && !isTextInput) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openSearch();
      }

      if (isCommandK) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openSearch();
      }
      if (event.key === "Escape" && activeSearch) {
        event.preventDefault();
        closeSearch();
      }
      if (event.key === "ArrowRight" && activeSearch) {
        const input = activeSearch.querySelector(".md-search__input");
        const suggest = activeSearch.querySelector(".md-search__suggest")?.textContent || "";
        if (suggest && input && suggest.toLowerCase().startsWith(input.value.toLowerCase())) {
          event.preventDefault();
          input.value = suggest;
          updateResults(activeSearch);
        }
      }
    }, true);

    
    
    
    
    
    function isInsideOpenPane(target) {
      return !!target?.closest?.("#wikilink-pane.wikilink-pane--open");
    }

    document.addEventListener("wheel", (event) => {
      const activeSearch = document.querySelector(`.${SEARCH_CLASS}.knotis-search--active`);
      if (!activeSearch || isInsideOpenPane(event.target)) return;
      const scrollwrap = activeSearch.querySelector(".md-search__scrollwrap");
      if (!scrollwrap) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      scrollwrap.scrollTop += event.deltaY;
      scrollwrap.scrollLeft += event.deltaX;
    }, { capture: true, passive: false });

    let lastTouchY = null;
    document.addEventListener("touchstart", (event) => {
      const activeSearch = document.querySelector(`.${SEARCH_CLASS}.knotis-search--active`);
      if (!activeSearch || isInsideOpenPane(event.target)) return;
      lastTouchY = event.touches?.[0]?.clientY ?? null;
    }, { capture: true, passive: true });

    document.addEventListener("touchmove", (event) => {
      const activeSearch = document.querySelector(`.${SEARCH_CLASS}.knotis-search--active`);
      if (!activeSearch || isInsideOpenPane(event.target)) return;
      const scrollwrap = activeSearch.querySelector(".md-search__scrollwrap");
      const currentY = event.touches?.[0]?.clientY ?? null;
      if (!scrollwrap || currentY === null || lastTouchY === null) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      scrollwrap.scrollTop += lastTouchY - currentY;
      lastTouchY = currentY;
    }, { capture: true, passive: false });
  }

  function initFromQuery() {
    if (queryInitialized || !searchEnabled) return;
    queryInitialized = true;
    const params = new URLSearchParams(location.search);
    const query = params.get("q");
    const filters = params.get("f");
    if (filters) {
      activeFilters.clear();
      filters.split(",").map(normalize).filter(Boolean).forEach((filter) => activeFilters.add(filter));
    }
    if (query) openSearch(query.replace(/\+/g, " "));
    else if (activeFilters.size) openSearch("");
  }

  function removeThemeSearchElements() {
    document.querySelectorAll('[data-md-toggle="search"]').forEach(function (el) {
      if (el.id !== SEARCH_ID) el.remove();
    });
    document.querySelectorAll('label[for="__search"]').forEach(function (el) {
      if (!el.closest(".knotis-search")) el.remove();
    });

    const selectors = [
      '[data-md-component="search"]:not(.knotis-search):not(.knotis-search-trigger)',
      '.md-header .md-search:not(.knotis-search):not(.knotis-search-trigger)',
      '.md-header .md-search:not(.knotis-search-trigger) .md-search__button',
      '.md-header label.md-search__icon[for="__search"]',
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (!el.closest(".knotis-search, .knotis-search-trigger")) {
          el.remove();
        }
      }
    }

    for (const child of document.body.children) {
      if (child.shadowRoot && !child.classList.contains(SEARCH_CLASS)) {
        child.style.setProperty("display", "none", "important");
        child.dataset.knotisSuppressed = "true";
      }
    }
  }

  let themeObserver = null;
  let cleanupTimer = null;

  function setupThemeSearchSuppression() {
    removeThemeSearchElements();

    if (themeObserver) themeObserver.disconnect();

    themeObserver = new MutationObserver(() => {
      removeThemeSearchElements();
    });

    themeObserver.observe(document.body, { childList: true, subtree: true });

    let cleanupCount = 0;
    cleanupTimer = setInterval(() => {
      removeThemeSearchElements();
      cleanupCount++;
      if (cleanupCount >= 30) clearInterval(cleanupTimer);
    }, 500);
  }

  function disableContextdocsSearch() {
    searchEnabled = false;
    document.documentElement.removeAttribute("data-knotis-search-enabled");
    if (themeObserver) themeObserver.disconnect();
    themeObserver = null;
    if (cleanupTimer) clearInterval(cleanupTimer);
    cleanupTimer = null;
    document.querySelector(".knotis-search-trigger")?.remove();
    document.querySelector(`.${SEARCH_CLASS}`)?.remove();
    const toggle = document.getElementById(SEARCH_ID);
    if (toggle) toggle.remove();
  }

  async function init() {
    try {
      const index = await loadIndex();
      if (index?.raw?.options?.enabled === false) {
        disableContextdocsSearch();
        return false;
      }
      searchEnabled = true;
      document.documentElement.setAttribute("data-knotis-search-enabled", "true");
      const search = ensureSearchComponent();
      setupThemeSearchSuppression();
      attachHandlers();
      renderFilters(search, index);
      setMeta(search, "");
      return true;
    } catch (err) {
      console.warn("[knotis-search] Search index unavailable; leaving theme search untouched.", err);
      disableContextdocsSearch();
      return false;
    }
  }

  function boot() {
    try {
      ensureHeaderTrigger();
      setupThemeSearchSuppression();
    } catch (err) {
      console.warn("[knotis-search] Early header trigger mount failed.", err);
    }
    init().then((enabled) => {
      if (enabled) initFromQuery();
    });
  }

  if (window.__KNOTIS_SEARCH_TEST__) {
    window.__KnotisSearchTest = {
      haystackContainsPhrasePrefix,
      highlightQueryPhrase,
      highlightText,
      lineMatchesQuery,
      prepareIndex,
      renderGroup,
      renderSnippetLines,
      searchIndex,
    };
    return;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      boot();
    }, { once: true });
  } else {
    boot();
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    let skipFirst = true;
    window.document$.subscribe(() => {
      if (skipFirst) {
        skipFirst = false;
        return;
      }
      if (searchEnabled) ensureHeaderTrigger();
      else boot();
    });
  }
})();
