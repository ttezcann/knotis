(function () {
  const STATE_KEY = "knotis-slides-state-v1";
  const AUTO_OPEN_KEY = "knotis-slides-auto-open";
  const ACTIVE_CLASS = "knotis-slides--active";
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
      try {
        return new URL("/", location.origin).href;
      } catch {
        return `${location.origin}/`;
      }
    }
  }
  const GRAPH_JSON_URL = new URL("graph.json", SCRIPT_BASE).href;
  const ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v9A2.5 2.5 0 0 1 17.5 17H13v2h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2H6.5A2.5 2.5 0 0 1 4 14.5v-9Zm2 0v9c0 .28.22.5.5.5h11a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-11a.5.5 0 0 0-.5.5Z"/>
    </svg>
  `;
  const RESTART_ICON = `
    <svg viewBox="0 0 512 512" aria-hidden="true">
      <path fill="currentColor" d="M125.7 160H176c17.7 0 32 14.3 32 32s-14.3 32-32 32H48c-17.7 0-32-14.3-32-32V64c0-17.7 14.3-32 32-32s32 14.3 32 32v51.2l17.6-17.6c87.5-87.5 229.3-87.5 316.8 0s87.5 229.3 0 316.8-229.3 87.5-316.8 0c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0c62.5 62.5 163.8 62.5 226.3 0s62.5-163.8 0-226.3-163.8-62.5-226.3 0L125.7 160z"/>
    </svg>
  `;
  const TOC_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M4 6.5A1.5 1.5 0 1 1 7 6.5 1.5 1.5 0 0 1 4 6.5Zm5-.75h11v1.5H9v-1.5Zm-5 6.75A1.5 1.5 0 1 1 7 12.5 1.5 1.5 0 0 1 4 12.5Zm5-.75h11v1.5H9v-1.5Zm-5 6.75A1.5 1.5 0 1 1 7 18.5 1.5 1.5 0 0 1 4 18.5Zm5-.75h11v1.5H9v-1.5Z"/>
    </svg>
  `;
  const CLOSE_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M6.22 4.81 12 10.59l5.78-5.78a1 1 0 1 1 1.41 1.41L13.41 12l5.78 5.78a1 1 0 0 1-1.41 1.41L12 13.41l-5.78 5.78a1 1 0 0 1-1.41-1.41L10.59 12 4.81 6.22a1 1 0 1 1 1.41-1.41Z"/>
    </svg>
  `;
  const PREVIEW_CLASS = "knotis-slides--preview";
  const HEADING_SELECTOR = "h1, h2, h3, h4, h5, h6";
  const DEFAULT_SLIDES_CONFIG = Object.freeze({
    enabled: false,
    fit_mode: "fit",
    fit_min_font_px: 20,
    fit_max_font_px: 52,
    content_fill: 0.72,
    content_inset: [3, 5, 3, 5],
    include_urls: [],
    exclude_urls: [],
  });

  let trigger = null;
  let restartTrigger = null;
  let overlay = null;
  let slides = [];
  let titleSlideFontPx = null;
  let currentIndex = 0;
  let currentRevealIndex = 0;
  let renderToken = 0;
  let enteredFullscreen = false;
  let suppressFullscreenPreview = false;
  let handlersAttached = false;
  let configPromise = null;
  let slidesEnabled = false;
  let slidesConfig = { ...DEFAULT_SLIDES_CONFIG };
  let headerObserver = null;
  let headerObserverScheduled = false;
  let fitAnimationFrame = 0;
  let slideBodySerial = 0;
  let mermaidConfigured = false;
  const warnedDenseSlides = new WeakSet();
  const WEBKIT_SLIDES_ENGINE = (() => {
    if (typeof navigator === "undefined") return false;
    const ua = navigator.userAgent;
    if (/\b(?:Chrom(?:e|ium)|Edg|OPR|CriOS|FxiOS)\b/.test(ua)) return false;
    return /\bAppleWebKit\b/.test(ua);
  })();

  function clearFitContentScale(card, measure) {
    [card, measure].forEach((root) => {
      root?.style.removeProperty("--knotis-slides-content-scale");
      root?.querySelectorAll(".knotis-slides__body").forEach((body) => {
        body.style.removeProperty("zoom");
        body.style.width = "";
      });
      root?.querySelectorAll(".knotis-slides__body-fit").forEach((wrap) => {
        wrap.style.removeProperty("zoom");
        wrap.style.width = "";
      });
    });
  }

  function applyFitContentScale(card, measure, scale) {
    const clamped = Math.max(0.2, Math.min(1, scale));
    const value = clamped.toFixed(3);
    clearFitContentScale(card, measure);
    card.style.setProperty("--knotis-slides-content-scale", value);
    measure.style.setProperty("--knotis-slides-content-scale", value);
  }

  const PREVIEW_MIN_SCALE = 0.05;

  function applyPreviewInnerScale(inner, scale) {
    const clamped = Math.max(PREVIEW_MIN_SCALE, Math.min(1, scale));
    const value = clamped.toFixed(3);
    inner.style.width = clamped >= 0.999 ? "100%" : `${100 / clamped}%`;
    if (!WEBKIT_SLIDES_ENGINE) {
      inner.style.removeProperty("zoom");
      inner.style.setProperty("--knotis-slides-preview-scale", value);
      return;
    }
    inner.style.removeProperty("--knotis-slides-preview-scale");
    if (clamped >= 0.999) inner.style.removeProperty("zoom");
    else inner.style.zoom = value;
  }

  function safariBodyFitWrap(card) {
    const body = card?.querySelector(":scope > .knotis-slides__body");
    if (!body) return null;
    const parent = body.parentElement;
    if (parent?.classList.contains("knotis-slides__body-fit")) return parent;
    const wrap = document.createElement("div");
    wrap.className = "knotis-slides__body-fit";
    parent?.insertBefore(wrap, body);
    wrap.appendChild(body);
    return wrap;
  }

  function clearWebKitSlideshowZoom(card) {
    card?.querySelectorAll(".knotis-slides__body-fit").forEach((wrap) => {
      wrap.style.removeProperty("zoom");
      wrap.style.width = "";
    });
  }

  function applyWebKitSlideshowZoom(card, scale) {
    const clamped = Math.max(0.2, Math.min(1, scale));
    const wrap = safariBodyFitWrap(card);
    if (!wrap) return;
    wrap.style.removeProperty("zoom");
    wrap.style.width = "";
    if (clamped >= 0.999) return;
    wrap.style.zoom = clamped.toFixed(3);
    wrap.style.width = `${100 / clamped}%`;
  }

  function frameBodySize(frame) {
    const body = frame?.querySelector(".knotis-slides__body");
    if (!body) return { width: 0, height: 0 };
    const rect = body.getBoundingClientRect();
    const hasReadableOverflowRail = Boolean(
      body.querySelector(".md-typeset__table, .md-typeset__scrollwrap, table, .highlight, pre"),
    );
    return {
      width: hasReadableOverflowRail
        ? Math.ceil(rect.width)
        : Math.max(body.scrollWidth, Math.ceil(rect.width)),
      height: Math.max(body.scrollHeight, Math.ceil(rect.height)),
    };
  }

  function webKitFontFits(card, fontPx, fill = 1) {
    card.style.setProperty("--knotis-slides-font-size", `${Number(fontPx).toFixed(3)}px`);
    clearWebKitSlideshowZoom(card);
    const capacity = bodyCapacity(card);
    const size = frameBodySize(card);
    if (!size.width || !size.height) return true;
    return size.width <= capacity.width + 1 && size.height <= capacity.height * fill + 1;
  }

  function webKitLargestFittingFont(card, lowFont, highFont, fill) {
    let low = lowFont;
    let high = highFont;
    let best = lowFont;
    for (let attempt = 0; attempt < 12 && high - low > 0.08; attempt += 1) {
      const candidate = (low + high) / 2;
      if (webKitFontFits(card, candidate, fill)) {
        best = candidate;
        low = candidate;
      } else {
        high = candidate;
      }
    }
    return best;
  }

  function applyFitSlideSizeWebKit(card, slide) {
    renderToken += 1;
    card.style.removeProperty("--knotis-slides-scale");
    card.removeAttribute("data-knotis-fit-warning");
    card.dataset.knotisSlideFit = "fit";
    clearFitContentScale(card, null);
    safariBodyFitWrap(card);

    const requestedFont = numericSlideFont(slide);
    const preferredMin = slidesConfig.fit_min_font_px;
    const maxFont = Math.max(preferredMin, requestedFont || slidesConfig.fit_max_font_px);
    const targetFill = slide.fillTarget ?? slidesConfig.content_fill;
    const minFitsFull = webKitFontFits(card, preferredMin, 1);
    let finalFont = preferredMin;

    if (minFitsFull) {
      if (webKitFontFits(card, preferredMin, targetFill)) {
        finalFont = webKitLargestFittingFont(card, preferredMin, maxFont, targetFill);
      }
    } else {
      let emergencyFloor = preferredMin;
      let floorFits = false;
      for (let attempt = 0; attempt < 24 && emergencyFloor > 0.25; attempt += 1) {
        emergencyFloor *= 0.82;
        floorFits = webKitFontFits(card, emergencyFloor, 1);
        if (floorFits) break;
      }
      finalFont = floorFits
        ? webKitLargestFittingFont(card, emergencyFloor, preferredMin, 1)
        : Math.max(0.25, emergencyFloor);
      warnDenseSlide(slide, finalFont);
      card.dataset.knotisFitWarning = "below-min-font";
    }

    card.style.setProperty("--knotis-slides-font-size", `${finalFont.toFixed(3)}px`);
    card.dataset.knotisFitFontPx = finalFont.toFixed(3);
    clearWebKitSlideshowZoom(card);
    const capacity = bodyCapacity(card);
    const size = frameBodySize(card);
    if (!size.width || !size.height) return;
    const contentScale = Math.min(1, capacity.width / size.width, capacity.height / size.height);
    applyWebKitSlideshowZoom(card, contentScale);
    if (contentScale < 0.999 && finalFont <= preferredMin + 0.01) {
      warnDenseSlide(slide, finalFont);
      card.dataset.knotisFitWarning = "below-min-font";
    }
  }

  function parseContentInset(raw) {
    const defaults = DEFAULT_SLIDES_CONFIG.content_inset;
    if (!Array.isArray(raw) || raw.length !== 4) return [...defaults];
    const parsed = raw.map((v, i) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 && n <= 20 ? n : defaults[i];
    });
    return parsed;
  }

  function parseUrlList(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((value) => String(value || "").trim())
      .filter(Boolean);
  }

  function runtimeSlidesConfig(rawConfig) {
    const raw = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
    const fitMode = raw.fit_mode === "scroll" ? "scroll" : "fit";
    const fitMinFont = Number.isFinite(Number(raw.fit_min_font_px))
      ? Math.max(1, Number(raw.fit_min_font_px))
      : DEFAULT_SLIDES_CONFIG.fit_min_font_px;
    const fitMaxFont = Number.isFinite(Number(raw.fit_max_font_px))
      ? Math.max(fitMinFont, Number(raw.fit_max_font_px))
      : DEFAULT_SLIDES_CONFIG.fit_max_font_px;
    const fill = Number(raw.content_fill);
    const contentFill = Number.isFinite(fill)
      ? Math.max(0.35, Math.min(1, fill))
      : DEFAULT_SLIDES_CONFIG.content_fill;
    const includeUrls = parseUrlList(raw.include_urls);
    const excludeUrls = new Set(parseUrlList(raw.exclude_urls));
    return {
      enabled: raw.enabled === true,
      fit_mode: fitMode,
      fit_min_font_px: fitMinFont,
      fit_max_font_px: fitMaxFont,
      content_fill: contentFill,
      content_inset: parseContentInset(raw.content_inset),
      include_urls: includeUrls.filter((url) => !excludeUrls.has(url)),
      exclude_urls: [...excludeUrls],
    };
  }

  function applyOverlayFitMode() {
    if (!overlay) return;
    overlay.dataset.knotisFitMode = slidesConfig.fit_mode;
    const inset = slidesConfig.content_inset;
    overlay.style.setProperty("--knotis-slides-inset-top", `${inset[0]}vh`);
    overlay.style.setProperty("--knotis-slides-inset-right", `${inset[1]}vw`);
    overlay.style.setProperty("--knotis-slides-inset-bottom", `${inset[2]}vh`);
    overlay.style.setProperty("--knotis-slides-inset-left", `${inset[3]}vw`);
  }

  function notifySlidesContentUpdated(root = overlay) {
    if (!root) return;
    try {
      document.dispatchEvent(new CustomEvent("knotis:slides-content-updated", {
        detail: { root },
      }));
    } catch {
      document.dispatchEvent(new Event("knotis:slides-content-updated"));
    }
  }

  async function loadSlidesConfig() {
    if (!configPromise) {
      configPromise = fetch(GRAPH_JSON_URL, { cache: "no-store" })
        .then((resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json();
        })
        .then((graph) => {
          slidesConfig = runtimeSlidesConfig(graph?.meta?.knotis?.slides);
          slidesEnabled = slidesConfig.enabled;
          applyOverlayFitMode();
          return slidesEnabled;
        })
        .catch((err) => {
          slidesConfig = { ...DEFAULT_SLIDES_CONFIG };
          slidesEnabled = false;
          console.warn("[knotis-slides] Slides are disabled or config could not be loaded.", err);
          return false;
        });
    }
    return configPromise;
  }

  function siteRootHref() {
    return siteBaseFromScript(SCRIPT_BASE);
  }

  function normalizePath(pathname = location.pathname) {
    return pathname.replace(/\/index\.html$/, "/");
  }

  function pageUrlToPathname(pageUrl) {
    const token = String(pageUrl || "").trim();
    if (!token) return "";
    try {
      return normalizePath(new URL(token, siteRootHref()).pathname);
    } catch {
      return normalizePath(`/${token.replace(/^\/+/, "")}`);
    }
  }

  function pathMatchesPageUrl(currentPathname, pageUrl) {
    const resolved = pageUrlToPathname(pageUrl);
    const current = normalizePath(currentPathname);
    if (current === resolved) return true;
    const rel = String(pageUrl || "").trim().replace(/^\/+/, "").replace(/\/index\.html$/, "/").replace(/\/$/, "");
    if (!rel) return false;
    const currentStem = current.replace(/\/$/, "");
    return currentStem === `/${rel}` || currentStem.endsWith(`/${rel}`);
  }

  function isSlidesPage() {
    const current = normalizePath();
    const includeUrls = slidesConfig.include_urls || [];
    if (!includeUrls.length) return false;
    const excludePathnames = new Set(
      (slidesConfig.exclude_urls || []).map((url) => pageUrlToPathname(url)),
    );
    if (excludePathnames.has(current)) return false;
    return includeUrls.some((url) => pathMatchesPageUrl(current, url));
  }

  function pageKey() {
    return normalizePath();
  }

  function readState() {
    try {
      return JSON.parse(sessionStorage.getItem(STATE_KEY) || "null");
    } catch {
      return null;
    }
  }

  function clearState() {
    try {
      sessionStorage.removeItem(STATE_KEY);
      sessionStorage.removeItem(AUTO_OPEN_KEY);
    } catch (err) {
      console.warn("[DEBUG] clearing slide session state failed", err);
    }
    updateTriggerLabel();
  }

  function writeState(extra = {}) {
    if (!slides.length) return;
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({
        pageKey: pageKey(),
        href: location.href.replace(location.hash, ""),
        title: getModuleTitle(),
        slideIndex: currentIndex,
        revealIndex: currentRevealIndex,
        slideCount: slides.length,
        updatedAt: Date.now(),
        ...extra,
      }));
    } catch (err) {
      console.warn("[DEBUG] saving slide session state failed", err);
    }
    updateTriggerLabel();
  }

  function clearAutoOpen() {
    try { sessionStorage.removeItem(AUTO_OPEN_KEY); } catch (err) { console.warn("[DEBUG] clearing slide auto-open key failed", err); }
  }

  function getHeaderNav() {
    return (
      document.querySelector(".md-header__inner .md-header__option")?.parentElement ||
      document.querySelector(".md-header__inner") ||
      document.querySelector(".md-header nav") ||
      document.querySelector(".md-header")
    );
  }

  function createTrigger() {
    const button = document.createElement("button");
    hydrateTrigger(button);
    return button;
  }

  function hydrateTrigger(button) {
    button.type = "button";
    button.classList.add("knotis-slides-trigger");
    button.setAttribute("aria-label", "Open module slides");
    button.title = "Open module slides";
    if (!button.querySelector(".knotis-slides-trigger__label")) {
      button.innerHTML = `
        <span class="knotis-slides-trigger__icon">${ICON}</span>
        <span class="knotis-slides-trigger__label">Slides</span>
      `;
    }
  }

  function createRestartTrigger() {
    const button = document.createElement("button");
    hydrateRestartTrigger(button);
    return button;
  }

  function hydrateRestartTrigger(button) {
    button.type = "button";
    button.classList.add("knotis-slides-restart");
    button.setAttribute("aria-label", "Restart module slides");
    button.title = "Restart module slides";
    if (!button.innerHTML.trim()) button.innerHTML = RESTART_ICON;
  }

  function placeTriggerInHeader(nav, search) {
    if (!trigger) return;
    if (search && search.parentElement) {
      const targetParent = search.parentElement;
      if (trigger.parentElement !== targetParent || trigger.previousElementSibling !== search) {
        search.insertAdjacentElement("afterend", trigger);
      }
      return;
    }
    if (!nav) return;
    const source = nav.querySelector(".md-header__source");
    if (source) {
      if (trigger.parentElement !== nav || trigger.nextElementSibling !== source) {
        nav.insertBefore(trigger, source);
      }
      return;
    }
    if (trigger.parentElement !== nav || nav.lastElementChild !== trigger) {
      nav.appendChild(trigger);
    }
  }

  function ensureTrigger() {
    if (!slidesEnabled || !isSlidesPage()) {
      trigger?.remove();
      restartTrigger?.remove();
      trigger = null;
      restartTrigger = null;
      return null;
    }

    if (!trigger || !document.body.contains(trigger)) {
      trigger = document.querySelector(".knotis-slides-trigger") || createTrigger();
    }
    hydrateTrigger(trigger);
    const search = document.querySelector(".knotis-search-trigger");
    const nav = getHeaderNav();
    placeTriggerInHeader(nav, search);

    if (!restartTrigger || !document.body.contains(restartTrigger)) {
      restartTrigger = document.querySelector(".knotis-slides-restart") || createRestartTrigger();
    }
    hydrateRestartTrigger(restartTrigger);
    if (restartTrigger && trigger && restartTrigger.previousElementSibling !== trigger) {
      trigger.insertAdjacentElement("afterend", restartTrigger);
    }

    updateTriggerLabel();
    return trigger;
  }

  function ensureHeaderObserver() {
    if (headerObserver) return;
    const target = getHeaderNav() || document.querySelector(".md-header");
    if (!target) {
      setTimeout(ensureHeaderObserver, 200);
      return;
    }
    headerObserver = new MutationObserver(() => {
      if (headerObserverScheduled) return;
      headerObserverScheduled = true;
      requestAnimationFrame(() => {
        headerObserverScheduled = false;
        ensureTrigger();
      });
    });
    headerObserver.observe(target, { childList: true, subtree: true });
  }

  function resetHeaderObserver() {
    headerObserver?.disconnect();
    headerObserver = null;
    headerObserverScheduled = false;
  }

  function updateTriggerLabel() {
    if (!trigger) return;
    const saved = readState();
    const hasSaved = saved && Number.isFinite(saved.slideIndex);
    const label = trigger.querySelector(".knotis-slides-trigger__label");
    const text = hasSaved ? "Continue Slides" : "Slides";
    if (label) label.textContent = text;
    trigger.title = hasSaved ? "Continue module slides" : "Open module slides";
    trigger.setAttribute("aria-label", trigger.title);
    if (restartTrigger) {
      restartTrigger.hidden = !hasSaved;
      restartTrigger.setAttribute("aria-hidden", hasSaved ? "false" : "true");
    }
  }

  function article() {
    return (
      document.querySelector(".md-content__inner") ||
      document.querySelector("article.md-typeset") ||
      document.querySelector("article") ||
      document.querySelector(".md-content") ||
      document.querySelector("main")
    );
  }

  function cleanText(node) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll?.(".headerlink, [aria-hidden='true']").forEach((el) => el.remove());
    return clone.textContent
      .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
      .replace(/\[\[([^\]]+)\]\]/g, "$1")
      .replace(/⚓︎/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getModuleTitle() {
    const root = article();
    const skipHeading = root?.querySelector("h1#__skip");
    if (skipHeading) return cleanText(skipHeading);
    const docTitle = document.title.replace(/\s+-\s+.*$/, "").trim();
    const firstH1 = root?.querySelector("h1");
    const firstText = cleanText(firstH1);
    if (docTitle && firstText && docTitle !== firstText) return docTitle;
    return firstText || docTitle;
  }

  function isModuleTitleSlide(slide) {
    return slide?.kind === "module_title";
  }

  function buildModuleTitleSlide(title) {
    return {
      kind: "module_title",
      title,
      sourceTitle: title,
      breadcrumb: "",
      breadcrumbs: [],
      revealGroups: [[]],
      order: -1,
      level: 1,
      manual: false,
    };
  }

  function buildTitleSlideShell(title) {
    const shell = document.createElement("div");
    shell.className = "knotis-slides__title-slide";
    const label = document.createElement("div");
    label.className = "knotis-slides__title-slide-label";
    label.textContent = title;
    shell.appendChild(label);
    return shell;
  }

  function slideCardContentWidth(card) {
    const styles = getComputedStyle(card);
    const paddingX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
    return Math.max(1, card.clientWidth - paddingX);
  }

  function ensureTitleSlideFontPx(card) {
    if (!card) return titleSlideFontPx;
    if (titleSlideFontPx !== null) {
      overlay?.style.setProperty("--knotis-slides-title-slide-font-size", `${titleSlideFontPx}px`);
      return titleSlideFontPx;
    }

    const width = slideCardContentWidth(card);
    const probe = document.createElement("div");
    probe.className = "knotis-slides__title-slide-label";
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    probe.style.left = "0";
    probe.style.top = "0";
    probe.style.pointerEvents = "none";
    probe.style.width = `${width}px`;
    probe.textContent = getModuleTitle();
    card.appendChild(probe);

    const minFont = 28;
    const maxFont = 72;
    let best = minFont;
    for (let fontPx = maxFont; fontPx >= minFont; fontPx -= 1) {
      probe.style.fontSize = `${fontPx}px`;
      probe.style.whiteSpace = "nowrap";
      if (probe.scrollWidth <= width + 1) {
        best = fontPx;
        break;
      }
    }
    probe.style.fontSize = `${best}px`;
    probe.style.whiteSpace = "normal";
    probe.remove();

    titleSlideFontPx = best;
    overlay?.style.setProperty("--knotis-slides-title-slide-font-size", `${titleSlideFontPx}px`);
    return titleSlideFontPx;
  }

  function resetTitleSlideSizing() {
    titleSlideFontPx = null;
    overlay?.style.removeProperty("--knotis-slides-title-slide-font-size");
  }

  function sectionHeading(section) {
    return section?.querySelector?.(":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6");
  }

  function sectionBody(section) {
    return section?.querySelector?.(":scope > .heading-flow__content");
  }

  function headingLevel(heading) {
    const match = String(heading?.tagName || "").match(/^H([1-6])$/);
    return match ? Number(match[1]) : 0;
  }

  function isPageTitleHeading(heading) {
    if (!heading || heading.tagName !== "H1") return false;
    if (heading.id === "__skip") return true;
    if (heading.closest?.(".heading-flow")) return false;
    const root = article();
    const firstH1 = root?.querySelector(":scope > h1");
    return firstH1 === heading;
  }

  function outlineLevel(heading) {
    if (isPageTitleHeading(heading)) return 0;
    const section = heading?.closest?.(".heading-flow");
    const match = String(section?.className || "").match(/\bheading-flow--h([1-6])\b/);
    if (match) return Number(match[1]);
    return headingLevel(heading);
  }

  function stripLeadingNumber(text) {
    return String(text || "").replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "").trim();
  }

  function labelForMeta(meta) {
    if (!meta) return "";
    return meta.number ? `${meta.number}. ${meta.title}` : meta.title;
  }

  function markerName(node) {
    if (node?.nodeType === Node.ELEMENT_NODE && node.matches?.("[data-knotis-slide-marker]")) {
      return String(node.getAttribute("data-knotis-slide-marker") || "").trim().toLowerCase();
    }
    if (node?.nodeType !== Node.COMMENT_NODE) return "";
    return String(node.nodeValue || "").trim().toLowerCase();
  }

  function hasMarkerDrivenSlides(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      if (isMarker(walker.currentNode, "slide-break")) return true;
    }
    return false;
  }

  function isMarker(node, name) {
    const value = markerName(node);
    return value === name || value.startsWith(`${name} `);
  }

  function markerHasOption(node, option) {
    return markerName(node).split(/[\s,;:]+/).includes(option);
  }

  function markerHasAnyOption(node, options) {
    return options.some((option) => markerHasOption(node, option));
  }

  function markerOptionValue(node, names) {
    const value = markerName(node);
    for (const name of names) {
      const match = value.match(new RegExp(`(?:^|[\\s,;:])${name}=([^\\s,;]+)`));
      if (match) return match[1];
    }
    return "";
  }

  function markerFontSize(node) {
    const value = markerOptionValue(node, ["font", "font-size", "size"]);
    const match = value.match(/^(\d+(?:\.\d+)?)px$/);
    if (!match) return "";
    const px = Math.max(8, Math.min(99, Number(match[1])));
    return `${px}px`;
  }

  function markerFillTarget(node) {
    const value = markerOptionValue(node, ["fill", "fit-fill", "target-fill"]);
    if (!value) return null;
    const percentage = value.match(/^(\d+(?:\.\d+)?)%$/);
    const fill = Number(percentage ? Number(percentage[1]) / 100 : value);
    if (Number.isFinite(fill) && fill >= 0.35 && fill <= 1) return fill;
    console.warn("[knotis-slides] Ignoring slide fill outside 0.35 through 1.0.", node);
    return null;
  }

  function meaningfulNode(node) {
    if (!node) return false;
    if (node.nodeType === Node.COMMENT_NODE) return false;
    if (node.nodeType === Node.TEXT_NODE) return /\S/.test(node.nodeValue || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.matches?.("[data-knotis-slide-marker]")) return false;
    if (node.matches?.("img, iframe, svg, video, canvas, figure.knotis-media, .knotis-gif-player")) return true;
    return cleanText(node) || node.querySelector?.("img, iframe, video, canvas, figure.knotis-media, table, pre, .highlight, .admonition, details, .mermaid");
  }

  function fragmentNodes(fragment) {
    return Array.from(fragment.childNodes).filter(meaningfulNode);
  }

  function listStartForItem(item) {
    const list = item?.parentElement;
    if (!list?.matches?.("ol")) return null;
    const explicitValue = Number(item.getAttribute("value"));
    if (Number.isFinite(explicitValue) && explicitValue > 0) return explicitValue;
    const siblings = Array.from(list.children).filter((child) => child.matches?.("li"));
    const itemIndex = siblings.indexOf(item);
    if (itemIndex < 0) return null;
    const baseStart = Number(list.getAttribute("start") || 1);
    return (Number.isFinite(baseStart) && baseStart > 0 ? baseStart : 1) + itemIndex;
  }

  function sourceListItemAfterMarker(marker) {
    if (!marker?.matches?.("[data-knotis-slide-marker]")) {
      return marker?.closest?.("li") || null;
    }
    const hostItem = marker.closest?.("li");
    let sibling = marker.nextElementSibling;
    while (sibling) {
      if (sibling.matches?.("[data-knotis-slide-marker]")) {
        sibling = sibling.nextElementSibling;
        continue;
      }
      if (sibling.matches?.("li")) return sibling;
      if (hostItem?.contains(sibling)) return hostItem;
      if (sibling.matches?.("ol, ul")) {
        const firstItem = sibling.querySelector(":scope > li");
        if (firstItem) return firstItem;
      }
      sibling = sibling.nextElementSibling;
    }
    return hostItem || null;
  }

  function loneNestedListInListItem(item) {
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

  function unwrapSlideSplitListWrappers(fragment) {
    while (fragment.childNodes.length === 1) {
      const only = fragment.firstChild;
      if (only.nodeType !== Node.ELEMENT_NODE || !only.matches?.("li")) break;
      const nestedList = loneNestedListInListItem(only);
      if (!nestedList) break;
      fragment.replaceChildren(nestedList);
    }
  }

  function flattenEmptyLeadListItems(root) {
    const items = Array.from(root.querySelectorAll?.("li") || []).reverse();
    for (const item of items) {
      const nested = loneNestedListInListItem(item);
      if (!nested) continue;
      const parentList = item.parentElement;
      if (!parentList?.matches?.("ol, ul")) continue;
      const insertBefore = item.nextSibling;
      while (nested.firstChild) {
        parentList.insertBefore(nested.firstChild, insertBefore);
      }
      item.remove();
    }
  }

  function wrapListAncestorShells(fragment, startNode) {
    let sourceItem = sourceListItemAfterMarker(startNode) || startNode?.closest?.("li");
    if (!sourceItem?.matches?.("li")) return;

    while (sourceItem) {
      const parentList = sourceItem.parentElement;
      if (!parentList?.matches?.("ol, ul")) break;
      const parentLi = parentList.parentElement;
      if (!parentLi?.matches?.("li")) break;

      const shellLi = document.createElement("li");
      const shellList = document.createElement(parentList.tagName.toLowerCase());
      const listClass = parentList.getAttribute("class");
      if (listClass) shellList.setAttribute("class", listClass);

      const onlyListChild = fragment.childNodes.length === 1
        && fragment.firstChild?.nodeType === Node.ELEMENT_NODE
        && fragment.firstChild.matches?.("ol, ul")
        && fragment.firstChild.tagName.toLowerCase() === shellList.tagName.toLowerCase();
      if (onlyListChild) {
        const innerList = fragment.firstChild;
        while (innerList.firstChild) {
          shellList.appendChild(innerList.firstChild);
        }
        fragment.removeChild(innerList);
      } else {
        while (fragment.firstChild) {
          shellList.appendChild(fragment.firstChild);
        }
      }
      shellLi.appendChild(shellList);
      fragment.appendChild(shellLi);

      sourceItem = parentLi;
    }
  }

  function repairPartialListRange(fragment, startNode) {
    const topLevelItems = Array.from(fragment.childNodes).filter(
      (node) => node.nodeType === Node.ELEMENT_NODE && node.matches?.("li")
    );
    if (topLevelItems.length) {
      const sourceItem = sourceListItemAfterMarker(startNode);
      const sourceList = sourceItem?.parentElement;
      if (sourceList?.matches?.("ol, ul")) {
        const wrapper = document.createElement(sourceList.tagName.toLowerCase());
        const sourceClass = sourceList.getAttribute("class");
        if (sourceClass) wrapper.setAttribute("class", sourceClass);
        if (wrapper.matches("ol")) {
          const start = listStartForItem(sourceItem);
          if (start) wrapper.setAttribute("start", String(start));
        }
        topLevelItems.forEach((item) => wrapper.appendChild(item));
        const preserved = Array.from(fragment.childNodes);
        while (fragment.firstChild) fragment.removeChild(fragment.firstChild);
        preserved
          .filter((node) => !(node.nodeType === Node.ELEMENT_NODE && node.matches?.("li")))
          .forEach((node) => fragment.appendChild(node));
        fragment.appendChild(wrapper);
        return;
      }
    }

    const startItem = sourceListItemAfterMarker(startNode) || startNode?.closest?.("li");
    const sourceList = startItem?.parentElement;
    if (
      startItem?.matches?.("li")
      && sourceList?.matches?.("ol, ul")
      && startNode?.matches?.("[data-knotis-slide-marker]")
      && startItem.contains(startNode)
      && Array.from(fragment.childNodes).some(meaningfulNode)
      && !Array.from(fragment.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE && node.matches?.("li"))
    ) {
      const shellLi = document.createElement("li");
      const shellList = document.createElement(sourceList.tagName.toLowerCase());
      const sourceClass = sourceList.getAttribute("class");
      if (sourceClass) shellList.setAttribute("class", sourceClass);
      if (shellList.matches("ol")) {
        const start = listStartForItem(startItem);
        if (start) shellList.setAttribute("start", String(start));
      }
      while (fragment.firstChild) {
        shellLi.appendChild(fragment.firstChild);
      }
      shellList.appendChild(shellLi);
      fragment.appendChild(shellList);
      return;
    }

    if (!sourceList?.matches?.("ol, ul")) return;
    const clonedList = Array.from(fragment.childNodes).find((node) => (
      node.nodeType === Node.ELEMENT_NODE && node.matches?.("ol, ul")
    )) || fragment.querySelector?.("ol, ul");
    if (!clonedList?.matches?.(sourceList.tagName.toLowerCase())) return;
    if (clonedList.matches("ol")) {
      const start = listStartForItem(startItem);
      if (start) clonedList.setAttribute("start", String(start));
    }
  }

  function isListElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE && node.matches?.("ol, ul");
  }

  function markerAtListEdge(marker, edge) {
    const list = marker?.parentElement;
    if (!isListElement(list)) return null;
    const siblings = Array.from(list.childNodes);
    const markerIndex = siblings.indexOf(marker);
    if (markerIndex < 0) return null;
    const side = edge === "start"
      ? siblings.slice(0, markerIndex)
      : siblings.slice(markerIndex + 1);
    return side.some(meaningfulNode) ? null : list;
  }

  function cloneRangeFragment(startNode, endNode) {
    const range = document.createRange();
    const startList = markerAtListEdge(startNode, "start");
    const endList = markerAtListEdge(endNode, "end");
    if (startList) {
      range.setStartBefore(startList);
    } else {
      range.setStartAfter(startNode);
    }
    if (endList && endNode?.parentElement !== endList) {
      range.setEndAfter(endList);
    } else if (endNode) {
      range.setEndBefore(endNode);
    }
    const fragment = range.cloneContents();
    repairPartialListRange(fragment, startNode);
    wrapListAncestorShells(fragment, startNode);
    unwrapSlideSplitListWrappers(fragment);
    flattenEmptyLeadListItems(fragment);
    fragment.querySelectorAll?.(".headerlink").forEach((el) => el.remove());
    fragment.querySelectorAll?.("[data-knotis-slide-marker]").forEach((el) => el.remove());
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach((comment) => comment.remove());
    pruneEmptyStructure(fragment);
    resetMermaidClone(fragment, null, startNode, endNode);
    return fragment;
  }

  function liveMermaidNodesBetween(startNode, endNode) {
    const root = article();
    if (!root || !startNode) return [];
    const range = document.createRange();
    range.setStartAfter(startNode);
    if (endNode) range.setEndBefore(endNode);
    else range.setEnd(root, root.childNodes.length);
    const nodes = [];
    mermaidNodesIn(root).forEach((node) => {
      try {
        if (range.intersectsNode(node)) nodes.push(node);
      } catch (err) {
        console.warn("[DEBUG] checking range intersection for mermaid node failed", err);
      }
    });
    return nodes;
  }

  function cloneRangeNodes(startNode, endNode) {
    const nodes = fragmentNodes(cloneRangeFragment(startNode, endNode));
    if (nodes.length) return nodes;
    const range = document.createRange();
    range.setStartAfter(startNode);
    if (endNode) range.setEndBefore(endNode);
    else {
      const root = article();
      if (root) range.setEnd(root, root.childNodes.length);
    }
    const fallback = range.cloneContents();
    fallback.querySelectorAll?.("[data-knotis-slide-marker]").forEach((el) => el.remove());
    return fragmentNodes(fallback);
  }

  function makeRange(startNode, endNode) {
    const range = document.createRange();
    range.setStartAfter(startNode);
    range.setEndBefore(endNode);
    return range;
  }

  function makePageOnlyRangeFromStart(endMarker, root) {
    const range = document.createRange();
    range.setStart(root, 0);
    range.setEndBefore(endMarker);
    return range;
  }

  function makePageOnlyRange(startNode, endNode, root) {
    const range = document.createRange();
    range.setStartAfter(startNode);
    if (endNode) range.setEndBefore(endNode);
    else range.setEnd(root, root.childNodes.length);
    return range;
  }

  function rangeIntersectsNode(range, node) {
    try {
      return range.intersectsNode(node);
    } catch {
      return false;
    }
  }

  function isNodeInManualRange(node, blocks) {
    return blocks.some((block) => rangeIntersectsNode(block.range, node));
  }

  function compareNodes(a, b) {
    if (a === b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    const position = a.compareDocumentPosition(b);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  }

  function buildNodeOrder(root) {
    const order = new WeakMap();
    let index = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    while (walker.nextNode()) {
      order.set(walker.currentNode, index);
      index += 1;
    }
    return order;
  }

  function firstHeadingFromNodes(nodes) {
    for (const node of nodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      if (node.matches?.(HEADING_SELECTOR) && !isPageTitleHeading(node)) return node;
      const heading = Array.from(node.querySelectorAll?.(HEADING_SELECTOR) || [])
        .find((candidate) => !isPageTitleHeading(candidate));
      if (heading) return heading;
    }
    return null;
  }

  function firstHeadingInRange(startNode, endNode) {
    const root = article();
    if (!root || !startNode || !endNode) return null;
    const range = makeRange(startNode, endNode);
    return Array.from(root.querySelectorAll(HEADING_SELECTOR))
      .find((heading) => !isPageTitleHeading(heading) && rangeIntersectsNode(range, heading)) || null;
  }

  function firstMeaningfulChild(node) {
    return Array.from(node?.childNodes || []).find(meaningfulNode) || null;
  }

  function leadingSectionTitleHeading(section) {
    let current = section;
    let heading = sectionHeading(current);
    while (current) {
      const body = sectionBody(current);
      const firstChild = firstMeaningfulChild(body);
      if (!firstChild?.matches?.(".heading-flow")) break;
      const childHeading = sectionHeading(firstChild);
      if (!childHeading) break;
      heading = childHeading;
      current = firstChild;
    }
    return heading;
  }

  function sectionHasOwnBodyContent(section) {
    const body = sectionBody(section);
    return Array.from(body?.childNodes || []).some((child) => {
      if (!meaningfulNode(child)) return false;
      return !child.matches?.(".heading-flow");
    });
  }

  function manualTitleHeadingInRange(startNode, endNode) {
    const fallback = firstHeadingInRange(startNode, endNode);
    const range = startNode && endNode ? makeRange(startNode, endNode) : null;
    const fallbackSection = fallback?.closest?.(".heading-flow");
    if (range && fallbackSection && !sectionHasOwnBodyContent(fallbackSection)) {
      const leadingHeading = leadingSectionTitleHeading(fallbackSection);
      if (
        leadingHeading
        && leadingHeading !== fallback
        && outlineLevel(leadingHeading) > outlineLevel(fallback)
        && rangeIntersectsNode(range, leadingHeading)
      ) {
        return leadingHeading;
      }
    }
    let node = startNode?.nextSibling || null;
    while (node && node !== endNode) {
      if (!meaningfulNode(node)) {
        node = node.nextSibling;
        continue;
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(".heading-flow")) {
        let section = node;
        let heading = leadingSectionTitleHeading(section);
        while (!sectionHasOwnBodyContent(section)) {
          let next = section.nextSibling;
          while (next && next !== endNode && !meaningfulNode(next)) next = next.nextSibling;
          const nextHeading = next?.matches?.(".heading-flow") ? sectionHeading(next) : null;
          if (!nextHeading || outlineLevel(nextHeading) <= outlineLevel(heading)) break;
          section = next;
          heading = leadingSectionTitleHeading(section) || heading;
        }
        return heading || fallback;
      }
      if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(HEADING_SELECTOR) && !isPageTitleHeading(node)) {
        let heading = node;
        node = node.nextSibling;
        while (node && node !== endNode) {
          if (!meaningfulNode(node)) {
            node = node.nextSibling;
            continue;
          }
          if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(HEADING_SELECTOR) && !isPageTitleHeading(node)) {
            heading = node;
            node = node.nextSibling;
            continue;
          }
          break;
        }
        return heading;
      }
      break;
    }
    return fallback;
  }

  function precedingHeading(node) {
    const root = article();
    if (!root || !node) return null;
    let candidate = null;
    for (const heading of root.querySelectorAll(HEADING_SELECTOR)) {
      if (compareNodes(heading, node) >= 0) break;
      if (!isPageTitleHeading(heading)) candidate = heading;
    }
    return candidate;
  }

  function cloneHeadingTitleNodes(heading) {
    if (!heading) return [];
    const clone = cloneWithoutIds(heading);
    clone.querySelectorAll?.(".headerlink").forEach((el) => el.remove());
    return Array.from(clone.childNodes).filter(meaningfulNode);
  }

  function precedingSectionTitle(node, moduleTitle) {
    const root = article();
    if (!root || !node) return moduleTitle;
    const sections = Array.from(root.querySelectorAll(".heading-flow"));
    let candidate = "";
    for (const section of sections) {
      if (compareNodes(section, node) >= 0) break;
      const heading = sectionHeading(section);
      if (outlineLevel(heading) === 2) {
        candidate = cleanText(heading);
      }
    }
    return candidate || moduleTitle;
  }

  function breadcrumbText(slide) {
    const crumbs = slide?.breadcrumbs || [];
    if (crumbs.length) return crumbs.map((crumb) => crumb.label || labelForMeta(crumb)).filter(Boolean).join(" > ");
    return slide?.breadcrumb || "";
  }

  function manualBreadcrumb(startNode, titleHeading, moduleTitle) {
    const level = outlineLevel(titleHeading);
    if (level <= 2) return "";
    return precedingSectionTitle(startNode, moduleTitle);
  }

  function buildRevealGroups(startNode, endNode, clicks) {
    const boundaries = [startNode, ...clicks, endNode];
    const groups = [];
    for (let idx = 0; idx < boundaries.length - 1; idx += 1) {
      groups.push(cloneRangeNodes(boundaries[idx], boundaries[idx + 1]));
    }
    return groups.length ? groups : [[]];
  }

  function slideBodyWithoutTitle(nodes) {
    return removeLeadingHeadingsFromRevealGroups([nodes])[0] || [];
  }

  function expandHeadingFlowBlocks(nodes) {
    return nodes.flatMap((node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.matches?.(".heading-flow")) {
        const body = node.querySelector(":scope > .heading-flow__content");
        if (body) return Array.from(body.children).filter(meaningfulNode);
      }
      return meaningfulNode(node) ? [node] : [];
    });
  }

  function buildRevealPreviewContainer(nodes) {
    const container = document.createElement("div");
    expandHeadingFlowBlocks(slideBodyWithoutTitle(nodes)).forEach((node) => {
      container.appendChild(cloneWithoutIds(node));
    });
    return container;
  }

  function pruneEmptyStructure(root) {
    root.querySelectorAll?.("li").forEach((item) => {
      if (!meaningfulNode(item)) item.remove();
    });
    root.querySelectorAll?.("ul, ol").forEach((list) => {
      if (!list.querySelector("li")) list.remove();
    });
  }

  function walkClickBoundaries(node, boundaries, inLi = false) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches?.("li")) {
      boundaries.push(node);
      Array.from(node.children).forEach((child) => walkClickBoundaries(child, boundaries, true));
      return;
    }
    if (!inLi && node.matches?.("p, table, pre, .highlight, .admonition, details, .mermaid, .wl-sec-mermaid, blockquote")) {
      boundaries.push(node);
      return;
    }
    if (!inLi || node.matches?.("ul, ol")) {
      Array.from(node.children).forEach((child) => walkClickBoundaries(child, boundaries, inLi));
    }
  }

  function collectClickBoundaries(root) {
    const boundaries = [];
    Array.from(root.childNodes).forEach((child) => walkClickBoundaries(child, boundaries, false));
    return boundaries;
  }

  function buildProgressiveRevealGroups(nodes, collectBoundaries) {
    const container = buildRevealPreviewContainer(nodes);
    const boundaries = collectBoundaries(container);
    if (!boundaries.length) {
      const blocks = expandHeadingFlowBlocks(slideBodyWithoutTitle(nodes));
      return blocks.length ? blocks.map((node) => [node]) : [[]];
    }
    const groups = [];
    boundaries.forEach((_, index) => {
      const clone = container.cloneNode(true);
      collectBoundaries(clone).forEach((el, i) => {
        if (i > index) el.remove();
      });
      pruneEmptyStructure(clone);
      const group = Array.from(clone.childNodes).filter(meaningfulNode);
      if (group.length) groups.push(group);
    });
    return groups.length ? groups : [[]];
  }

  function collectStepBoundaries(root) {
    const boundaries = [];
    Array.from(root.childNodes).forEach((child) => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (child.matches?.("ul, ol")) {
        Array.from(child.children)
          .filter((node) => node.matches?.("li"))
          .forEach((item) => boundaries.push(item));
        return;
      }
      if (meaningfulNode(child)) boundaries.push(child);
    });
    return boundaries;
  }

  function buildClickModeGroups(nodes) {
    return buildProgressiveRevealGroups(nodes, collectClickBoundaries);
  }

  function buildStepModeGroups(nodes) {
    return buildProgressiveRevealGroups(nodes, collectStepBoundaries);
  }

  function revealModeFromMarker(marker) {
    if (markerHasAnyOption(marker, ["click", "clicks"])) return "click";
    if (markerHasAnyOption(marker, ["step", "steps"])) return "step";
    return "";
  }

  function buildAutoRevealGroups(nodes, mode) {
    if (mode === "click") return buildClickModeGroups(nodes);
    if (mode === "step") return buildStepModeGroups(nodes);
    return [[]];
  }

  function stripLeadingSectionHeadings(section) {
    let current = section;
    let removed = false;
    while (current?.matches?.(".heading-flow")) {
      const heading = sectionHeading(current);
      if (heading) {
        heading.remove();
        removed = true;
      }
      const body = sectionBody(current);
      const firstChild = firstMeaningfulChild(body);
      if (!firstChild?.matches?.(".heading-flow")) break;
      current = firstChild;
    }
    return removed;
  }

  function removeLeadingHeadingsFromRevealGroups(groups) {
    let removing = true;
    return groups.map((group) => {
      if (!removing) return group;
      const nextGroup = [];
      for (const node of group) {
        if (removing && node.nodeType === Node.ELEMENT_NODE && node.matches?.(".heading-flow")) {
          stripLeadingSectionHeadings(node);
          if (meaningfulNode(node)) {
            removing = false;
            nextGroup.push(node);
          }
          continue;
        }
        if (removing && node.nodeType === Node.ELEMENT_NODE && node.matches?.(HEADING_SELECTOR) && !isPageTitleHeading(node)) {
          continue;
        }
        if (removing && node.nodeType === Node.ELEMENT_NODE) {
          const heading = Array.from(node.querySelectorAll?.(HEADING_SELECTOR) || [])
            .find((candidate) => !isPageTitleHeading(candidate));
          if (heading) {
            heading.remove();
          }
        }
        removing = false;
        if (meaningfulNode(node)) nextGroup.push(node);
      }
      return nextGroup;
    });
  }

  function findManualBlocks(root, moduleTitle, nodeOrder) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
    const blocks = [];
    let current = null;
    let pageOnlyStart = null;

    let seenFirstBreak = false;

    function finishPageOnly(endMarker) {
      if (!pageOnlyStart) return;
      blocks.push({
        start: pageOnlyStart,
        end: endMarker || null,
        range: makePageOnlyRange(pageOnlyStart, endMarker, root),
        pageOnly: true,
      });
      pageOnlyStart = null;
    }

    function finishCurrent(endMarker) {
      if (!current) return;
      const nodes = cloneRangeNodes(current.start, endMarker);
      if (nodes.length) {
        const clonedTitleHeading = firstHeadingFromNodes(nodes);
        const originalTitleHeading = manualTitleHeadingInRange(current.start, endMarker);
        const fallbackHeading = precedingHeading(current.start);
        const titleHeading = originalTitleHeading || clonedTitleHeading || fallbackHeading;
        const hasOwnHeading = !!(originalTitleHeading || clonedTitleHeading);
        const title = stripLeadingNumber(cleanText(titleHeading)) || precedingSectionTitle(current.start, moduleTitle);
        const range = makeRange(current.start, endMarker);
        const revealGroups = current.revealMode
          ? buildAutoRevealGroups(nodes, current.revealMode)
          : removeLeadingHeadingsFromRevealGroups(buildRevealGroups(current.start, endMarker, current.clicks));
        blocks.push({
          start: current.start,
          end: endMarker,
          range,
          slide: {
            breadcrumb: manualBreadcrumb(current.start, titleHeading, moduleTitle),
            title,
            sourceTitle: title,
            revealGroups,
            sourceNode: current.start,
            sourceHeading: titleHeading,
            level: outlineLevel(titleHeading) || 2,
            breadcrumbs: [],
            order: nodeOrder.get(current.start) ?? 0,
            fontSize: current.fontSize,
            fillTarget: current.fillTarget,
            titleNodes: cloneHeadingTitleNodes(titleHeading),
            manualContinuation: !hasOwnHeading && !!fallbackHeading,
            manual: true,
            revealMode: current.revealMode,
          },
        });
      }
      current = null;
      pageOnlyStart = endMarker;
    }

    while (walker.nextNode()) {
      const marker = walker.currentNode;
      if (!markerName(marker)) continue;
      if (isMarker(marker, "slide-break")) {
        if (!seenFirstBreak) {
          seenFirstBreak = true;
          blocks.push({
            start: null,
            end: marker,
            range: makePageOnlyRangeFromStart(marker, root),
            pageOnly: true,
          });
        }
        finishPageOnly(marker);
        if (current) {
          console.warn("[knotis-slides] Closing a manual slide at the next slide-break marker because no slide-end marker was found.", current.start);
          finishCurrent(marker);
          pageOnlyStart = null;
        }
        current = {
          start: marker,
          clicks: [],
          revealMode: revealModeFromMarker(marker),
          fontSize: markerFontSize(marker),
          fillTarget: markerFillTarget(marker),
        };
      } else if (isMarker(marker, "click")) {
        if (current) current.clicks.push(marker);
      } else if (isMarker(marker, "slide-end")) {
        if (!current) {
          pageOnlyStart = marker;
          continue;
        }
        finishCurrent(marker);
      }
    }

    if (current) {
      console.warn("[knotis-slides] Ignoring unclosed slide-break marker.", current.start);
    }
    finishPageOnly(null);

    return blocks;
  }

  function outlineNumber(counters, level) {
    for (let idx = 2; idx < level; idx += 1) {
      if (!counters[idx]) counters[idx] = 1;
    }
    counters[level] = (counters[level] || 0) + 1;
    for (let idx = level + 1; idx <= 6; idx += 1) counters[idx] = 0;
    const parts = [];
    for (let idx = 2; idx <= level; idx += 1) {
      if (counters[idx]) parts.push(counters[idx]);
    }
    return parts.join(".").replace(/^0\./, "");
  }

  function buildHeadingMeta(root) {
    const counters = {};
    const parentStack = {};
    const metaByHeading = new WeakMap();
    const sections = Array.from(root?.querySelectorAll?.(".heading-flow") || []);
    sections.forEach((section) => {
      const heading = sectionHeading(section);
      const rawLevel = outlineLevel(heading);
      if (!heading || rawLevel < 2) return;
      const level = rawLevel > 2 && !parentStack[rawLevel - 1] ? 2 : rawLevel;
      const number = outlineNumber(counters, level);
      const title = stripLeadingNumber(cleanText(heading));
      const breadcrumbs = [];
      for (let idx = 2; idx < level; idx += 1) {
        if (parentStack[idx]) breadcrumbs.push(parentStack[idx]);
      }
      const meta = {
        number,
        title,
        label: number ? `${number}. ${title}` : title,
        sourceHeading: heading,
        level,
        slideIndex: -1,
        titleNodes: cloneHeadingTitleNodes(heading),
        breadcrumbs: [...breadcrumbs],
      };
      metaByHeading.set(heading, meta);
      parentStack[level] = meta;
      for (let idx = level + 1; idx <= 6; idx += 1) delete parentStack[idx];
    });
    return metaByHeading;
  }

  function renumberSlides(slideList) {
    const outlineMetaByHeading = buildHeadingMeta(article());
    const counters = {};
    const parentStack = {};
    const metaByHeading = new WeakMap();
    const splitCounts = new Map();
    const splitSeen = new Map();

    function splitKey(slide) {
      return slide.sourceHeading || slide.sourceSection || slide.sourceNode || slide;
    }

    slideList.forEach((slide, index) => {
      const rawLevel = Math.max(2, Math.min(6, slide.level || 2));
      let level = rawLevel > 2 && !parentStack[rawLevel - 1] ? 2 : rawLevel;
      const heading = slide.sourceHeading?.isConnected ? slide.sourceHeading : null;
      let meta = heading ? metaByHeading.get(heading) || outlineMetaByHeading.get(heading) : null;
      const baseTitle = stripLeadingNumber(slide.sourceTitle || String(slide.title || "").replace(/\s+\(\d+\/\d+\)$/, ""));

      if (!meta) {
        for (let idx = 2; idx < level; idx += 1) {
          if (!counters[idx]) counters[idx] = 1;
        }
        counters[level] = (counters[level] || 0) + 1;
        for (let idx = level + 1; idx <= 6; idx += 1) {
          counters[idx] = 0;
          delete parentStack[idx];
        }
        const parts = [];
        for (let idx = 2; idx <= level; idx += 1) {
          if (counters[idx]) parts.push(counters[idx]);
        }
        const number = parts.join(".");
        const breadcrumbs = [];
        for (let idx = 2; idx < level; idx += 1) {
          if (parentStack[idx]) breadcrumbs.push(parentStack[idx]);
        }
        meta = {
          number,
          title: baseTitle,
          label: number ? `${number}. ${baseTitle}` : baseTitle,
          sourceHeading: heading,
          level,
          slideIndex: index,
          titleNodes: slide.titleNodes?.length ? slide.titleNodes : cloneHeadingTitleNodes(heading),
          breadcrumbs: [...breadcrumbs],
        };
        if (heading) metaByHeading.set(heading, meta);
        parentStack[level] = meta;
      } else {
        level = meta.level;
        meta = {
          ...meta,
          slideIndex: meta.slideIndex >= 0 ? meta.slideIndex : index,
          titleNodes: meta.titleNodes?.length ? meta.titleNodes : slide.titleNodes,
          breadcrumbs: [...(meta.breadcrumbs || [])],
        };
        if (heading) metaByHeading.set(heading, meta);
      }

      slide.number = meta.number;
      slide.sourceTitle = meta.title;
      slide.titleNodes = meta.titleNodes || [];
      slide.breadcrumbs = [...(meta.breadcrumbs || [])];
      slide.breadcrumb = breadcrumbText(slide);
      slide.level = level;
      const key = splitKey(slide);
      splitCounts.set(key, (splitCounts.get(key) || 0) + 1);
    });

    slideList.forEach((slide) => {
      const key = splitKey(slide);
      const total = splitCounts.get(key) || 1;
      const nextSeen = (splitSeen.get(key) || 0) + 1;
      splitSeen.set(key, nextSeen);
      slide.splitIndex = nextSeen;
      slide.splitTotal = total;
      const label = slide.number ? `${slide.number}. ${slide.sourceTitle}` : slide.sourceTitle;
      slide.title = total > 1 ? `${label} (${nextSeen}/${total})` : label;
      (slide.breadcrumbs || []).forEach((crumb) => {
        const targetIndex = slideList.findIndex((candidate) => candidate.sourceHeading && candidate.sourceHeading === crumb.sourceHeading);
        if (targetIndex >= 0) crumb.slideIndex = targetIndex;
      });
      slide.breadcrumb = breadcrumbText(slide);
    });
    return slideList;
  }

  function cloneWithoutIds(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll?.(".headerlink").forEach((el) => el.remove());
    if (clone.nodeType === Node.ELEMENT_NODE) {
      clone.removeAttribute("id");
      clone.removeAttribute("name");
    }
    clone.querySelectorAll?.("[id], [name]").forEach((el) => {
      if (el.closest?.(".mermaid, pre.mermaid, .wl-sec-mermaid")) return;
      el.removeAttribute("id");
      el.removeAttribute("name");
    });
    resetMermaidClone(clone, node);
    return clone;
  }

  function mermaidNodesIn(root) {
    const nodes = [];
    if (root.nodeType !== Node.ELEMENT_NODE) return nodes;
    if (root.matches?.(".mermaid, pre.mermaid")) nodes.push(root);
    nodes.push(...Array.from(root.querySelectorAll?.(".mermaid, pre.mermaid") || []));
    return nodes;
  }

  function mermaidSourceFromNode(node) {
    if (!node) return "";
    if (window.KnotisMermaid?.source) {
      return window.KnotisMermaid.normalize
        ? window.KnotisMermaid.normalize(window.KnotisMermaid.source(node))
        : String(window.KnotisMermaid.source(node) || "").trim();
    }
    const code = node.querySelector?.("code");
    const raw = node.dataset?.knotisMermaidSource || (code ? code.textContent : "") || "";
    if (raw) return raw.trim();
    if (node.querySelector?.("svg")) return "";
    return String(node.textContent || "").trim();
  }

  function rewriteMermaidSvgIds(node, suffix) {
    if (!node?.querySelector?.("svg")) return;
    const idMap = new Map();
    node.querySelectorAll("[id]").forEach((el) => {
      const oldId = el.getAttribute("id");
      if (!oldId) return;
      const newId = `${oldId}-ks${suffix}`;
      idMap.set(oldId, newId);
      el.setAttribute("id", newId);
    });
    if (!idMap.size) return;
    node.querySelectorAll("[fill], [stroke], [clip-path], [mask], [filter], [href], [xlink\\:href]").forEach((el) => {
      ["fill", "stroke", "clip-path", "mask", "filter", "href", "xlink:href"].forEach((attr) => {
        const value = el.getAttribute(attr);
        if (!value || !value.includes("url(#")) return;
        el.setAttribute(attr, value.replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${idMap.get(id) || id})`));
      });
    });
    
    
    
    node.querySelectorAll("style").forEach((styleEl) => {
      const css = styleEl.textContent;
      if (!css) return;
      styleEl.textContent = css.replace(/#([\w.:-]+)/g, (match, id) => (
        idMap.has(id) ? `#${idMap.get(id)}` : match
      ));
    });
  }

  function preserveMermaidClone(node, suffix, sourceNode) {
    const html = window.KnotisMermaid?.svgHtml?.(sourceNode) || "";
    if (html && /<svg[\s>]/i.test(html)) {
      node.innerHTML = html;
      delete node.dataset.knotisMermaidExternal;
      rewriteMermaidSvgIds(node, suffix);
      node.setAttribute("data-processed", "true");
      node.dataset.processed = "true";
      return true;
    }
    if (!node?.querySelector?.("svg")) return false;
    if (window.KnotisMermaid?.looksBroken?.(node)) return false;
    rewriteMermaidSvgIds(node, suffix);
    node.setAttribute("data-processed", "true");
    node.dataset.processed = "true";
    return true;
  }

  function resetMermaidNode(node, suffix) {
    if (!node?.classList?.contains("mermaid")) return;
    if (preserveMermaidClone(node, suffix, null)) return;
    const source = mermaidSourceFromNode(node);
    if (!source) return;
    delete node.dataset.knotisMermaidExternal;
    node.dataset.knotisMermaidSource = source;
    node.textContent = source;
    node.removeAttribute("data-processed");
    delete node.dataset.processed;
  }

  function resetMermaidClone(root, originalRoot = null, rangeStart = null, rangeEnd = null) {
    if (root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE && root.nodeType !== Node.ELEMENT_NODE) return;
    const sourceNodes = originalRoot
      ? mermaidNodesIn(originalRoot)
      : liveMermaidNodesBetween(rangeStart, rangeEnd);
    const captureRoot = originalRoot || article();
    if (captureRoot) window.KnotisMermaid?.capture?.(captureRoot);
    mermaidNodesIn(root).forEach((node, index) => {
      delete node.dataset.knotisMermaidExternal;
      const suffix = `${slideBodySerial}-${index}`;
      const sourceNode = sourceNodes[index] || null;
      if (preserveMermaidClone(node, suffix, sourceNode)) return;
      resetMermaidNode(node, suffix);
    });
  }

  function repairTabbedSets(root) {
    root.querySelectorAll?.(".tabbed-set").forEach((set, setIndex) => {
      const inputs = Array.from(set.querySelectorAll(":scope > input[type='radio']"));
      const labels = Array.from(set.querySelectorAll(":scope > .tabbed-labels label"));
      if (!inputs.length || !labels.length) return;
      const groupName = `knotis-slide-tab-${slideBodySerial}-${setIndex}`;
      let checkedIndex = inputs.findIndex((input) => input.checked);
      if (checkedIndex < 0) checkedIndex = 0;
      inputs.forEach((input, inputIndex) => {
        const id = `${groupName}-${inputIndex}`;
        input.id = id;
        input.name = groupName;
        input.checked = inputIndex === checkedIndex;
        if (labels[inputIndex]) labels[inputIndex].htmlFor = id;
      });
    });
  }

  function annotateSlideTables(root) {
    root.querySelectorAll?.("th, td").forEach((cell) => {
      const text = cleanText(cell);
      if (!text) return;
      const normalized = text.toLowerCase();
      if (/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/.test(text)) {
        cell.dataset.knotisTableCell = "numeric";
      } else if (normalized === "respondent id" || normalized === "id") {
        cell.dataset.knotisTableCell = "compact";
      } else if (text.length <= 14 && !/\s/.test(text)) {
        cell.dataset.knotisTableCell = "compact";
      }
    });
  }

  function isImageOnlyListItem(item) {
    if (!item?.matches?.("li")) return false;
    const meaningful = Array.from(item.childNodes || []).filter((node) => {
      if (node.nodeType === Node.TEXT_NODE) return Boolean(String(node.textContent || "").trim());
      if (node.nodeType !== Node.ELEMENT_NODE) return false;
      if (node.matches?.("img, iframe")) return true;
      if (node.matches?.("p") && node.querySelector(":scope > :is(img, iframe):only-child, :scope > a:only-child > img:only-child")) return true;
      if (node.matches?.("ul, ol")) return false;
      return cleanText(node) || node.querySelector?.("img, iframe, table, pre, svg, .highlight, .admonition, details, .mermaid");
    });
    return meaningful.length === 1 && (
      meaningful[0].matches?.("img, iframe")
      || (meaningful[0].matches?.("p") && meaningful[0].querySelector(":scope > :is(img, iframe):only-child, :scope > a:only-child > img:only-child"))
    );
  }

  function isMarkerlessImageList(node) {
    if (!node?.matches?.("ul, ol")) return false;
    const items = Array.from(node.children || []).filter((child) => child.matches?.("li"));
    return items.length > 0 && items.every(isImageOnlyListItem);
  }

  function blockWeight(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return 0;
    if (node.matches("table, .md-typeset__table")) return 6;
    if (node.matches(".highlight, pre, .wl-sec-code-block")) return 5;
    if (node.matches(".admonition, details, .wl-sec-admonition")) return 5;
    if (node.matches(".mermaid, .wl-sec-mermaid") || node.querySelector(".mermaid, .wl-sec-mermaid")) return 5;
    if (node.matches("figure") || node.querySelector(":scope > :is(img, iframe), :scope img")) return 4;
    if (node.matches("ul, ol")) {
      const topItems = node.querySelectorAll(":scope > li").length || node.querySelectorAll("li").length;
      const media = node.querySelectorAll("img, iframe, table, pre, svg, .highlight, .admonition, details, .mermaid").length;
      return 2 + Math.ceil(topItems / 2) + media * 3;
    }
    const text = cleanText(node);
    const embeddedMedia = node.querySelectorAll?.("img, iframe, table, pre, svg, .highlight, .admonition, details, .mermaid").length || 0;
    if (embeddedMedia) return Math.max(2, Math.ceil(text.length / 420)) + embeddedMedia * 4;
    return Math.max(1, Math.ceil(text.length / 340));
  }

  function cloneListChunk(list, items) {
    const clone = list.cloneNode(false);
    if (list.matches?.("ol")) {
      const siblings = Array.from(list.children).filter((child) => child.matches?.("li"));
      const firstItem = items[0];
      const explicitValue = Number(firstItem?.getAttribute?.("value"));
      const itemIndex = Math.max(0, siblings.indexOf(firstItem));
      const baseStart = Number(list.getAttribute("start") || 1);
      const start = Number.isFinite(explicitValue) && explicitValue > 0
        ? explicitValue
        : baseStart + itemIndex;
      clone.setAttribute("start", String(start));
    }
    items.forEach((item) => clone.appendChild(cloneWithoutIds(item)));
    return clone;
  }

  function splitOversizedList(list, maxWeight) {
    const items = Array.from(list.children).filter((child) => child.matches?.("li"));
    if (items.length < 2) return null;
    const chunks = [];
    let current = [];
    let weight = 0;
    for (const item of items) {
      const itemWeight = Math.max(1, blockWeight(item));
      if (current.length && weight + itemWeight > maxWeight) {
        chunks.push([cloneListChunk(list, current)]);
        current = [];
        weight = 0;
      }
      current.push(item);
      weight += itemWeight;
    }
    if (current.length) chunks.push([cloneListChunk(list, current)]);
    return chunks.length > 1 ? chunks : null;
  }

  function packBlocks(nodes) {
    const maxWeight = 9;
    const groups = [];
    let current = [];
    let weight = 0;

    function flush() {
      if (!current.length) return;
      groups.push(current);
      current = [];
      weight = 0;
    }

    for (const node of nodes) {
      if (node.matches?.(".headerlink")) continue;
      const hasTeachingMedia = !!node.querySelector?.("img, table, pre, svg, .highlight, .admonition, details, .mermaid");
      if (hasTeachingMedia && node.matches?.("ul, ol") && !isMarkerlessImageList(node)) {
        const mediaChunks = splitOversizedList(node, 1);
        if (mediaChunks) {
          flush();
          groups.push(...mediaChunks);
          continue;
        }
      }
      if (hasTeachingMedia && !node.matches?.("ul, ol")) {
        flush();
        groups.push([cloneWithoutIds(node)]);
        continue;
      }
      const w = blockWeight(node);
      const isStandalone = node.matches?.(".admonition, details, .highlight, pre, table, .md-typeset__table");
      const splitList = w >= maxWeight && node.matches?.("ul, ol") ? splitOversizedList(node, maxWeight) : null;

      if (splitList) {
        flush();
        groups.push(...splitList);
        continue;
      }

      if (isStandalone && current.length) flush();
      if (current.length && weight + w > maxWeight) flush();

      current.push(cloneWithoutIds(node));
      weight += w;

      if (isStandalone || w >= maxWeight) flush();
    }

    flush();
    return groups.length ? groups : [[]];
  }

  function buildSlides() {
    const root = article();
    if (!root) return [];
    window.KnotisMermaid?.capture?.(root);
    window.KnotisMermaid?.cache?.(root);

    const moduleTitle = getModuleTitle();
    const nodeOrder = buildNodeOrder(root);
    const manualBlocks = findManualBlocks(root, moduleTitle, nodeOrder);
    const sections = Array.from(root.querySelectorAll(".heading-flow"));
    const counters = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const parentTitles = {};
    const parentMeta = {};
    const markerDriven = hasMarkerDrivenSlides(root);
    const nextSlides = manualBlocks.map((block) => block.slide).filter(Boolean);

    if (!markerDriven) {
    for (const section of sections) {
      const heading = sectionHeading(section);
      const body = sectionBody(section);
      const level = outlineLevel(heading);
      if (!heading || !body || level < 2) continue;
      if (isNodeInManualRange(heading, manualBlocks)) continue;

      const number = outlineNumber(counters, level);
      const title = stripLeadingNumber(cleanText(heading));
      const headingMeta = { number, title, label: number ? `${number}. ${title}` : title, sourceHeading: heading, level };
      if (title) {
        parentTitles[level] = title;
        parentMeta[level] = headingMeta;
      }
      for (let idx = level + 1; idx <= 6; idx += 1) {
        delete parentTitles[idx];
        delete parentMeta[idx];
      }
      const blocks = Array.from(body.children).filter((node) => {
        if (node.matches?.(".heading-flow, .md-tags")) return false;
        if (isNodeInManualRange(node, manualBlocks)) return false;
        return cleanText(node) || node.querySelector?.("img, table, pre, .highlight, .admonition, details, .mermaid");
      });
      if (!blocks.length) continue;

      const breadcrumbs = [];
      for (let idx = 2; idx < level; idx += 1) {
        if (parentMeta[idx]) breadcrumbs.push(parentMeta[idx]);
      }
      const breadcrumb = breadcrumbs.map((crumb) => crumb.label).join(" > ");
      const numberedTitle = headingMeta.label;
      const groups = packBlocks(blocks);
      groups.forEach((group, index) => {
        nextSlides.push({
          breadcrumb,
          breadcrumbs,
          title: groups.length > 1 ? `${numberedTitle} (${index + 1}/${groups.length})` : numberedTitle,
          sourceTitle: title,
          revealGroups: [group],
          sourceNode: group[0] || section,
          sourceSection: section,
          sourceHeading: heading,
          level,
          number,
          order: (nodeOrder.get(section) ?? 0) + ((index + 1) / 100),
          manual: false,
        });
      });
    }
    }

    const sorted = nextSlides.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const deck = renumberSlides(sorted);
    const pageTitle = getModuleTitle();
    if (pageTitle) deck.unshift(buildModuleTitleSlide(pageTitle));
    return deck;
  }

  function slideMarkup() {
    return `
      <div class="knotis-slides__chrome">
        <div class="knotis-slides__meta">
          <div class="knotis-slides__crumb"></div>
          <h2 class="knotis-slides__title"></h2>
        </div>
        <div class="knotis-slides__topline">
          <button type="button" class="knotis-slides__toc-button" aria-label="Open slide table of contents" aria-expanded="false">${TOC_ICON}</button>
          <button type="button" class="knotis-slides__slideshow-button">Slideshow</button>
          <button type="button" class="knotis-slides__close-button" aria-label="Quit slide view">${CLOSE_ICON}</button>
          <div class="knotis-slides__count" aria-live="polite"></div>
        </div>
      </div>
      <div class="knotis-slides__stage">
        <section class="knotis-slides__card md-typeset" tabindex="-1"></section>
        <section class="knotis-slides__measure md-typeset" aria-hidden="true"></section>
      </div>
      <div class="knotis-slides__preview" aria-label="Slide preview"></div>
      <div class="knotis-slides__toc-backdrop" hidden></div>
      <nav class="knotis-slides__toc" aria-label="Slide table of contents" aria-hidden="true" hidden>
        <div class="knotis-slides__toc-heading">Slides</div>
        <ol class="knotis-slides__toc-list"></ol>
      </nav>
    `;
  }

  function disableHeadingGuides(surface) {
    if (!surface) return;
    surface.setAttribute("data-knotis-heading-guides", "false");
  }

  function ensureOverlay() {
    if (overlay && document.body.contains(overlay)) {
      if (WEBKIT_SLIDES_ENGINE) overlay.dataset.knotisSlidesEngine = "webkit";
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.className = "knotis-slides";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Module slides");
    overlay.innerHTML = slideMarkup();
    if (WEBKIT_SLIDES_ENGINE) overlay.dataset.knotisSlidesEngine = "webkit";
    disableHeadingGuides(overlay.querySelector(".knotis-slides__card"));
    disableHeadingGuides(overlay.querySelector(".knotis-slides__measure"));
    document.body.appendChild(overlay);
    applyOverlayFitMode();
    return overlay;
  }

  function tocOpen() {
    return !!overlay?.classList.contains("knotis-slides--toc-open");
  }

  function closeToc() {
    if (!overlay) return;
    overlay.classList.remove("knotis-slides--toc-open");
    overlay.querySelector(".knotis-slides__toc")?.setAttribute("aria-hidden", "true");
    overlay.querySelector(".knotis-slides__toc")?.setAttribute("hidden", "");
    overlay.querySelector(".knotis-slides__toc-backdrop")?.setAttribute("hidden", "");
    overlay.querySelector(".knotis-slides__toc-button")?.setAttribute("aria-expanded", "false");
  }

  function openToc() {
    if (!overlay) return;
    overlay.classList.add("knotis-slides--toc-open");
    overlay.querySelector(".knotis-slides__toc")?.removeAttribute("hidden");
    overlay.querySelector(".knotis-slides__toc")?.setAttribute("aria-hidden", "false");
    overlay.querySelector(".knotis-slides__toc-backdrop")?.removeAttribute("hidden");
    overlay.querySelector(".knotis-slides__toc-button")?.setAttribute("aria-expanded", "true");
  }

  function toggleToc() {
    if (tocOpen()) closeToc();
    else openToc();
  }

  function renderToc() {
    if (!overlay) return;
    const list = overlay.querySelector(".knotis-slides__toc-list");
    if (!list) return;
    list.replaceChildren(...slides.map((slide, index) => {
      const item = document.createElement("li");
      const row = document.createElement("div");
      row.className = "knotis-slides__toc-item";
      row.dataset.slideIndex = String(index);
      row.innerHTML = `
        <span class="knotis-slides__toc-number">${index + 1}</span>
        <span class="knotis-slides__toc-text">
          <span class="knotis-slides__toc-crumb"></span>
          <button type="button" class="knotis-slides__toc-title-button"></button>
        </span>
      `;
      renderBreadcrumb(row.querySelector(".knotis-slides__toc-crumb"), slide, { compact: true });
      const titleButton = row.querySelector(".knotis-slides__toc-title-button");
      titleButton.textContent = slide.title;
      titleButton.dataset.slideIndex = String(index);
      item.appendChild(row);
      return item;
    }));
    updateTocActive();
  }

  function updateTocActive() {
    if (!overlay) return;
    overlay.querySelectorAll(".knotis-slides__toc-item").forEach((button) => {
      const active = Number(button.dataset.slideIndex) === currentIndex;
      button.classList.toggle("knotis-slides__toc-item--active", active);
      if (active) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function renderBreadcrumb(container, slide, { compact = false } = {}) {
    if (!container) return;
    const crumbs = slide?.breadcrumbs || [];
    container.replaceChildren();
    if (!crumbs.length) return;
    crumbs.forEach((crumb, index) => {
      if (index) {
        const sep = document.createElement("span");
        sep.className = "knotis-slides__crumb-separator";
        sep.textContent = " > ";
        container.appendChild(sep);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = compact ? "knotis-slides__toc-crumb-link" : "knotis-slides__crumb-link";
      button.textContent = crumb.label || labelForMeta(crumb);
      if (Number.isFinite(crumb.slideIndex)) button.dataset.slideIndex = String(crumb.slideIndex);
      container.appendChild(button);
    });
  }

  function jumpToSlide(index, { fullscreen = false } = {}) {
    currentIndex = Math.max(0, Math.min(Number(index) || 0, slides.length - 1));
    currentRevealIndex = 0;
    closeToc();
    renderSlide();
    if (fullscreen) enterSlideshow();
    else if (overlay?.classList.contains(PREVIEW_CLASS)) renderPreview();
  }

  function queueFitForMermaidHost(el) {
    if (el.closest?.(".knotis-slides__stage") || el.matches?.(".knotis-slides__card, .knotis-slides__measure")) {
      queueCurrentSlideFit();
    } else if (el.closest?.(".knotis-slides__preview")) {
      queuePreviewFit(el.closest(".knotis-slides__preview"));
    }
  }

  async function renderMermaid(el) {
    if (typeof mermaid === "undefined") return;
    window.KnotisMermaid?.hydrate?.(el);
    const mermaidNodes = Array.from(el.querySelectorAll?.(".mermaid") || []);
    const needsRender = mermaidNodes.some((node) => (
      !node.querySelector("svg") || window.KnotisMermaid?.looksBroken?.(node)
    ));
    if (!needsRender) {
      queueFitForMermaidHost(el);
      return;
    }
    window.KnotisMermaid?.capture?.(el);
    window.KnotisMermaid?.prepare?.(el);
    window.KnotisMermaid?.hydrate?.(el);
    const nodes = Array.from(el.querySelectorAll(".mermaid:not([data-processed])"))
      .filter((node) => !node.querySelector("svg"));
    if (!nodes.length) {
      queueFitForMermaidHost(el);
      return;
    }
    const pending = [];
    nodes.forEach((node) => {
      const source = mermaidSourceFromNode(node);
      if (!source) return;
      node.dataset.knotisMermaidSource = source;
      node.textContent = source;
      pending.push(node);
    });
    if (!pending.length) return;
    try {
      if (window.KnotisMermaid?.configure) {
        window.KnotisMermaid.configure();
      } else if (!mermaidConfigured && typeof mermaid.initialize === "function") {
        mermaid.initialize({ startOnLoad: false });
        mermaidConfigured = true;
      }
      const renderJob = typeof mermaid.run === "function"
        ? mermaid.run({ nodes: pending })
        : typeof mermaid.init === "function"
          ? mermaid.init(undefined, pending)
          : null;
      Promise.resolve(renderJob).then(() => {
        window.KnotisMermaid?.cache?.(el);
        queueFitForMermaidHost(el);
      });
    } catch (err) {
      console.warn("[knotis-slides] Mermaid render failed.", err);
    }
  }

  function revealGroups(slide) {
    return slide?.revealGroups?.length ? slide.revealGroups : [[]];
  }

  function revealCount(slide) {
    return Math.max(1, revealGroups(slide).length);
  }

  function visibleSlideNodes(slide) {
    const groups = revealGroups(slide);
    if (slide?.revealMode) {
      return groups[Math.min(currentRevealIndex, groups.length - 1)] || [];
    }
    return groups.slice(0, currentRevealIndex + 1).flat();
  }

  function allSlideNodes(slide) {
    const groups = revealGroups(slide);
    if (slide?.revealMode) {
      return groups[groups.length - 1] || [];
    }
    return groups.flat();
  }

  function nodeTextLength(nodes) {
    return nodes.reduce((total, node) => total + cleanText(node).length, 0);
  }

  function nodeObjectCount(nodes) {
    return nodes.reduce((total, node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return total + (cleanText(node) ? 1 : 0);
      if (node.matches?.("ul, ol")) return total + Math.max(1, node.querySelectorAll(":scope > li").length);
      return total + 1 + node.querySelectorAll("img, table, pre, .highlight, .admonition, details, .mermaid").length;
    }, 0);
  }

  function initialContentScale(nodes) {
    const textLength = nodeTextLength(nodes);
    const objects = nodeObjectCount(nodes);
    const mediaCount = nodes.reduce((total, node) => (
      total + (node.querySelectorAll?.("img, table, pre, .highlight, .admonition, details, .mermaid").length || 0)
    ), 0);
    if (!nodes.length) return 1;
    if (mediaCount > 0) return objects <= 3 && textLength < 450 ? 1.08 : 0.98;
    if (objects <= 2 && textLength < 260) return 1.42;
    if (objects <= 4 && textLength < 520) return 1.28;
    if (objects <= 7 && textLength < 900) return 1.12;
    if (objects > 16 || textLength > 2400) return 0.82;
    if (objects > 10 || textLength > 1600) return 0.92;
    return 1;
  }

  function applyLegacySlideScale(card, slide) {
    renderToken += 1;
    const nodes = allSlideNodes(slide);
    card.style.setProperty("--knotis-slides-scale", initialContentScale(nodes).toFixed(3));
    if (slide.fontSize) card.style.setProperty("--knotis-slides-font-size", slide.fontSize);
    else card.style.removeProperty("--knotis-slides-font-size");
    card.removeAttribute("data-knotis-slide-fit");
    card.removeAttribute("data-knotis-fit-font-px");
    card.removeAttribute("data-knotis-fit-warning");
    card.style.removeProperty("--knotis-slides-content-scale");
    clearFitContentScale(card, null);
  }

  function applySlideListIndent(body, slide) {
    if (!body) return;
    if (!slide || isModuleTitleSlide(slide)) {
      body.style.removeProperty("--heading-flow-bullet-padding");
      return;
    }
    const level = Math.max(2, Math.min(6, Number(slide.level) || 2));
    body.style.setProperty("--heading-flow-bullet-padding", `var(--heading-bullet-padding-h${level})`);
  }

  function upgradeSlideCodeBlocks(root) {
    root.querySelectorAll(".highlight").forEach((highlight) => {
      highlight.querySelectorAll(".linenodiv pre").forEach((gutter) => {
        gutter.querySelectorAll("a").forEach((anchor) => {
          anchor.replaceWith(anchor.textContent || "");
        });
        Array.from(gutter.childNodes).forEach((node) => {
          if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) node.remove();
          else if (node.nodeType === Node.ELEMENT_NODE && !node.textContent.trim()) node.remove();
        });
      });
      let nav = highlight.querySelector(".md-code__nav");
      if (!nav) {
        nav = document.createElement("nav");
        nav.className = "md-code__nav";
      }
      let button = nav.querySelector(".md-code__button");
      if (!button) {
        button = document.createElement("button");
        button.className = "md-code__button";
        button.type = "button";
        nav.appendChild(button);
      }
      nav.classList.add("knotis-slides__code-nav");
      button.classList.add("knotis-slides__code-copy");
      button.removeAttribute("data-clipboard-target");
      button.removeAttribute("data-md-type");
      button.title = "Copy code";
      button.setAttribute("aria-label", "Copy code");
      highlight.appendChild(nav);
    });
  }

  async function copySlideCode(button) {
    const code = button.closest(".highlight")?.querySelector("code");
    if (!code) return;
    const text = (code.textContent || "").replace(/\n$/, "");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    button.classList.add("knotis-slides__code-copy--done");
    button.title = "Copied";
    button.setAttribute("aria-label", "Copied");
    clearTimeout(button._knotisCopyResetTimer);
    button._knotisCopyResetTimer = setTimeout(() => {
      button.classList.remove("knotis-slides__code-copy--done");
      button.title = "Copy code";
      button.setAttribute("aria-label", "Copy code");
    }, 1200);
  }

  function slideBody(nodes) {
    const body = document.createElement("div");
    body.className = "knotis-slides__body";
    slideBodySerial += 1;
    body.replaceChildren(...nodes.map((node) => cloneWithoutIds(node)));
    repairTabbedSets(body);
    annotateSlideTables(body);
    syncOrderedListStarts(body);
    markMarkerlessBlockListItems(body);
    upgradeSlideCodeBlocks(body);
    window.KnotisWikilinks?.expandIconShortcodesInRoot?.(body);
    return body;
  }

  function markerlessBlockChild(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.matches?.("img, iframe, figure.knotis-media, video, canvas, .knotis-gif-player, .highlight, pre, .wl-sec-mermaid, .mermaid, svg, table, .md-typeset__table, .md-typeset__scrollwrap, .admonition, details")) return true;
    if (node.matches?.("p") && node.querySelector(":scope > :is(img, iframe):only-child, :scope > a:only-child > img:only-child, :scope > svg:only-child, :scope > video:only-child, :scope > figure.knotis-media:only-child")) return true;
    return false;
  }

  function markMarkerlessBlockListItems(root) {
    root.querySelectorAll?.("li").forEach((item) => {
      item.classList.remove("knotis-slides__markerless-block");
      for (const node of item.childNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if ((node.textContent || "").trim()) return;
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.("span[data-knotis-slide-marker], [hidden]")) continue;
        if (markerlessBlockChild(node)) {
          item.classList.add("knotis-slides__markerless-block");
          return;
        }
        if (node.matches?.("p") && !cleanText(node)) continue;
        return;
      }
    });
  }

  function slideListCounterDepth(list) {
    let depth = 1;
    let node = list?.parentElement || null;
    while (node && !node.matches?.(".knotis-slides__body, .knotis-slides__preview-body-inner")) {
      if (node.matches?.("ol")) depth += 1;
      node = node.parentElement;
    }
    return Math.max(1, Math.min(depth, 7));
  }

  function syncOrderedListStarts(root) {
    root.querySelectorAll?.("ol").forEach((list) => {
      const start = Number(list.getAttribute("start") || 1);
      const counterStart = Number.isFinite(start) && start > 1 ? start - 1 : 0;
      const depth = slideListCounterDepth(list);
      list.style.setProperty("--knotis-ol-start", String(counterStart));
      list.style.counterReset = `level${depth} ${counterStart}`;
      const itemCount = list.querySelectorAll(":scope > li").length;
      const maxNumber = start + Math.max(itemCount, 1) - 1;
      const digits = String(Math.max(maxNumber, start)).length;
      if (digits > 1) {
        const markerWidth = digits === 2 ? "2.35em" : `${(digits * 1.15).toFixed(2)}em`;
        list.style.setProperty("--heading-flow-ol-marker-width", markerWidth);
      }
    });
  }

  function numericSlideFont(slide) {
    const parsed = Number.parseFloat(String(slide?.fontSize || ""));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function setHybridFont(card, measure, fontPx) {
    const value = `${Number(fontPx).toFixed(3)}px`;
    card.style.setProperty("--knotis-slides-font-size", value);
    measure.style.setProperty("--knotis-slides-font-size", value);
  }

  function contentScaleForFit(card, measure) {
    const capacity = bodyCapacity(card);
    const size = frameBodySize(measure);
    if (!size.width || !size.height) return 1;
    return Math.min(1, capacity.width / size.width, capacity.height / size.height);
  }

  function syncMeasureDetails(card, measure) {
    const visibleDetails = Array.from(card.querySelectorAll("details"));
    const measureDetails = Array.from(measure.querySelectorAll("details"));
    visibleDetails.forEach((details, index) => {
      const target = measureDetails[index];
      if (target) target.open = details.open;
    });
  }

  function syncMeasureTabbedSets(card, measure) {
    const visibleSets = Array.from(card.querySelectorAll(".tabbed-set"));
    const measureSets = Array.from(measure.querySelectorAll(".tabbed-set"));
    visibleSets.forEach((set, setIndex) => {
      const checkedIndex = Array.from(set.querySelectorAll(":scope > input[type='radio']"))
        .findIndex((input) => input.checked);
      if (checkedIndex < 0) return;
      const targetInputs = Array.from(measureSets[setIndex]?.querySelectorAll(":scope > input[type='radio']") || []);
      targetInputs.forEach((input, inputIndex) => {
        input.checked = inputIndex === checkedIndex;
      });
    });
  }

  function syncMeasureFrame(card, measure) {
    measure.style.inset = "auto";
    measure.style.left = `${card.offsetLeft}px`;
    measure.style.top = `${card.offsetTop}px`;
    measure.style.width = `${card.offsetWidth}px`;
    measure.style.height = `${card.offsetHeight}px`;
  }

  function bodyCapacity(frame) {
    const styles = getComputedStyle(frame);
    const paddingX = Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight);
    const paddingY = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    return {
      width: Math.max(1, frame.clientWidth - paddingX),
      height: Math.max(1, frame.clientHeight - paddingY),
    };
  }

  function fitFontFits(card, measure, fontPx, fill = 1) {
    setHybridFont(card, measure, fontPx);
    const capacity = bodyCapacity(measure);
    const size = frameBodySize(measure);
    return size.width <= capacity.width + 1 && size.height <= capacity.height * fill + 1;
  }

  function largestFittingFont(card, measure, lowFont, highFont, fill) {
    let low = lowFont;
    let high = highFont;
    let best = lowFont;
    for (let attempt = 0; attempt < 12 && high - low > 0.08; attempt += 1) {
      const candidate = (low + high) / 2;
      if (fitFontFits(card, measure, candidate, fill)) {
        best = candidate;
        low = candidate;
      } else {
        high = candidate;
      }
    }
    return best;
  }

  function warnDenseSlide(slide, fontPx) {
    if (warnedDenseSlides.has(slide)) return;
    warnedDenseSlides.add(slide);
    console.warn(
      `[knotis-slides] Slide ${currentIndex + 1} "${slide.title}" fitted below the preferred `
      + `minimum ${slidesConfig.fit_min_font_px}px at ${fontPx.toFixed(2)}px. Split the slide if it is hard to read.`,
    );
  }

  function applyFitSlideSize(card, measure, slide) {
    if (isModuleTitleSlide(slide)) {
      ensureTitleSlideFontPx(card);
      card.dataset.knotisSlideFit = "title";
      card.style.removeProperty("--knotis-slides-font-size");
      clearFitContentScale(card, measure);
      return;
    }

    if (WEBKIT_SLIDES_ENGINE) {
      applyFitSlideSizeWebKit(card, slide);
      return;
    }

    renderToken += 1;
    syncMeasureFrame(card, measure);
    card.style.removeProperty("--knotis-slides-scale");
    measure.style.removeProperty("--knotis-slides-scale");
    card.removeAttribute("data-knotis-fit-warning");
    card.dataset.knotisSlideFit = "fit";
    applyFitContentScale(card, measure, 1);

    const requestedFont = numericSlideFont(slide);
    const preferredMin = slidesConfig.fit_min_font_px;
    const maxFont = Math.max(preferredMin, requestedFont || slidesConfig.fit_max_font_px);
    const targetFill = slide.fillTarget ?? slidesConfig.content_fill;
    const minFitsFull = fitFontFits(card, measure, preferredMin, 1);
    let finalFont = preferredMin;

    if (minFitsFull) {
      if (fitFontFits(card, measure, preferredMin, targetFill)) {
        finalFont = largestFittingFont(
          card,
          measure,
          preferredMin,
          maxFont,
          targetFill,
        );
      }
    } else {
      let emergencyFloor = preferredMin;
      let floorFits = false;
      for (let attempt = 0; attempt < 24 && emergencyFloor > 0.25; attempt += 1) {
        emergencyFloor *= 0.82;
        floorFits = fitFontFits(card, measure, emergencyFloor, 1);
        if (floorFits) break;
      }
      finalFont = floorFits
        ? largestFittingFont(card, measure, emergencyFloor, preferredMin, 1)
        : Math.max(0.25, emergencyFloor);
      warnDenseSlide(slide, finalFont);
      card.dataset.knotisFitWarning = "below-min-font";
    }

    setHybridFont(card, measure, finalFont);
    card.dataset.knotisFitFontPx = finalFont.toFixed(3);
    const contentScale = contentScaleForFit(card, measure);
    applyFitContentScale(card, measure, contentScale);
    if (contentScale < 0.999 && finalFont <= preferredMin + 0.01) {
      warnDenseSlide(slide, finalFont);
      card.dataset.knotisFitWarning = "below-min-font";
    }
  }

  function queueCurrentSlideFit() {
    if (fitAnimationFrame) cancelAnimationFrame(fitAnimationFrame);
    fitAnimationFrame = requestAnimationFrame(() => {
      fitAnimationFrame = 0;
      if (!overlay?.classList.contains(ACTIVE_CLASS) || overlay.classList.contains(PREVIEW_CLASS)) return;
      const card = overlay.querySelector(".knotis-slides__card");
      const measure = overlay.querySelector(".knotis-slides__measure");
      const slide = slides[currentIndex];
      if (!card || !measure || !slide || slidesConfig.fit_mode !== "fit") return;
      if (isModuleTitleSlide(slide)) return;
      const runFit = () => {
        if (!WEBKIT_SLIDES_ENGINE) {
          syncMeasureDetails(card, measure);
          syncMeasureTabbedSets(card, measure);
        }
        applyFitSlideSize(card, measure, slide);
      };
      if (WEBKIT_SLIDES_ENGINE) requestAnimationFrame(runFit);
      else runFit();
    });
  }

  function watchSlideMedia(root) {
    root.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", queueCurrentSlideFit, { once: true });
    });
    root.querySelectorAll("video").forEach((video) => {
      if (video.readyState < 1) video.addEventListener("loadedmetadata", queueCurrentSlideFit, { once: true });
    });
  }

  function watchSlideDetails(root) {
    root.querySelectorAll("details").forEach((details) => {
      details.addEventListener("toggle", () => {
        requestAnimationFrame(queueCurrentSlideFit);
      });
    });
  }

  function watchSlideTabs(root) {
    root.querySelectorAll(".tabbed-set > input[type='radio']").forEach((input) => {
      input.addEventListener("change", () => {
        requestAnimationFrame(queueCurrentSlideFit);
      });
    });
  }

  function fitRenderedSlide(card, measure, slide) {
    if (isModuleTitleSlide(slide)) {
      const shell = buildTitleSlideShell(slide.title);
      card.replaceChildren(shell);
      if (measure) measure.replaceChildren(shell.cloneNode(true));
      ensureTitleSlideFontPx(card);
      card.style.removeProperty("--knotis-slides-font-size");
      card.style.removeProperty("--knotis-slides-scale");
      clearFitContentScale(card, measure);
      return;
    }

    if (slidesConfig.fit_mode !== "fit") {
      measure.replaceChildren();
      measure.style.removeProperty("--knotis-slides-font-size");
      applyLegacySlideScale(card, slide);
      return;
    }

    if (WEBKIT_SLIDES_ENGINE) {
      safariBodyFitWrap(card);
      measure.replaceChildren();
      watchSlideMedia(card);
      watchSlideDetails(card);
      watchSlideTabs(card);
      queueCurrentSlideFit();
      return;
    }

    measure.replaceChildren(slideBody(allSlideNodes(slide)));
    applySlideListIndent(measure.querySelector(".knotis-slides__body"), slide);
    renderMermaid(measure);
    watchSlideMedia(card);
    watchSlideMedia(measure);
    watchSlideDetails(card);
    watchSlideTabs(card);
    queueCurrentSlideFit();
  }

  function sourceElementForSlide(slide) {
    if (isModuleTitleSlide(slide)) {
      const heading = article()?.querySelector("h1");
      if (heading?.isConnected) return heading;
    }
    if (slide?.sourceHeading?.isConnected) return slide.sourceHeading;
    if (slide?.sourceSection?.isConnected) return slide.sourceSection;
    if (slide?.sourceNode?.isConnected) {
      if (slide.sourceNode.nodeType === Node.ELEMENT_NODE) return slide.sourceNode;
      let node = slide.sourceNode.nextSibling;
      while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.nextSibling;
      if (node) return node;
    }
    return null;
  }

  function scrollToCurrentSlideSource() {
    const target = sourceElementForSlide(slides[currentIndex]);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("wikilink--block-highlighted");
    setTimeout(() => target.classList.remove("wikilink--block-highlighted"), 2000);
  }

  function renderPreview() {
    if (!overlay || !slides.length) return;
    const preview = overlay.querySelector(".knotis-slides__preview");
    if (!preview) return;
    const cards = slides.map((slide, index) => {
      const button = document.createElement("div");
      button.setAttribute("role", "button");
      button.tabIndex = 0;
      button.className = "knotis-slides__preview-card md-typeset";
      if (isModuleTitleSlide(slide)) button.classList.add("knotis-slides__preview-card--title-slide");
      disableHeadingGuides(button);
      button.classList.toggle("knotis-slides__preview-card--active", index === currentIndex);
      button.dataset.slideIndex = String(index);
      button.innerHTML = `
        <span class="knotis-slides__preview-number">${index + 1}</span>
        <span class="knotis-slides__preview-crumb"></span>
        <strong class="knotis-slides__preview-title"></strong>
        <span class="knotis-slides__preview-body">
          <span class="knotis-slides__preview-body-inner"></span>
        </span>
      `;
      const crumb = button.querySelector(".knotis-slides__preview-crumb");
      const title = button.querySelector(".knotis-slides__preview-title");
      const inner = button.querySelector(".knotis-slides__preview-body-inner");
      if (isModuleTitleSlide(slide)) {
        crumb.textContent = "";
        title.textContent = "";
        inner.classList.add("knotis-slides__preview-body-inner--title-slide");
        inner.replaceChildren(buildTitleSlideShell(slide.title));
      } else {
        crumb.textContent = breadcrumbText(slide);
        title.textContent = slide.title;
        inner.classList.remove("knotis-slides__preview-body-inner--title-slide");
        inner.replaceChildren(slideBody(allSlideNodes(slide)));
        applySlideListIndent(inner, slide);
      }
      return button;
    });
    preview.replaceChildren(...cards);
    renderMermaid(preview);
    notifySlidesContentUpdated(preview);
    queuePreviewFit(preview);
    preview.querySelectorAll("img").forEach((img) => {
      if (!img.complete) img.addEventListener("load", () => queuePreviewFit(preview), { once: true });
    });
    preview.querySelector(".knotis-slides__preview-card--active")?.scrollIntoView({ block: "nearest" });
  }

  function queuePreviewFit(preview) {
    if (!preview) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitPreviewCards(preview));
    });
  }

  function previewFitScale(inner, availableWidth, availableHeight) {
    const hasReadableOverflowRail = Boolean(
      inner.querySelector(".md-typeset__table, .md-typeset__scrollwrap, table, .highlight, pre"),
    );
    const contentWidth = hasReadableOverflowRail
      ? Math.ceil(inner.getBoundingClientRect().width)
      : inner.scrollWidth;
    const contentHeight = inner.scrollHeight;
    if (!contentWidth || !contentHeight) return null;
    return Math.min(1, availableWidth / contentWidth, availableHeight / contentHeight);
  }

  function fitPreviewCards(preview) {
    preview.querySelectorAll(".knotis-slides__preview-card").forEach((card) => {
      const body = card.querySelector(".knotis-slides__preview-body");
      const inner = card.querySelector(".knotis-slides__preview-body-inner");
      if (!body || !inner) return;
      applyPreviewInnerScale(inner, 1);
      const availableWidth = body.clientWidth;
      const availableHeight = body.clientHeight;
      if (!availableWidth || !availableHeight) return;
      let scale = previewFitScale(inner, availableWidth, availableHeight);
      if (scale == null) return;
      applyPreviewInnerScale(inner, scale);
      scale = previewFitScale(inner, availableWidth, availableHeight);
      if (scale != null) applyPreviewInnerScale(inner, scale);
    });
  }

  function renderSlideTitle(container, slide) {
    if (!container) return;
    container.replaceChildren();
    if (isModuleTitleSlide(slide)) return;
    if (slide.number) container.appendChild(document.createTextNode(`${slide.number}. `));
    const titleNodes = slide.titleNodes?.length
      ? slide.titleNodes.map((node) => cloneWithoutIds(node))
      : [document.createTextNode(slide.sourceTitle || stripLeadingNumber(slide.title))];
    container.append(...titleNodes);
    if (slide.splitTotal > 1) {
      container.appendChild(document.createTextNode(` (${slide.splitIndex}/${slide.splitTotal})`));
    }
  }

  function renderSlide() {
    if (!overlay || !slides.length) return;
    currentIndex = Math.max(0, Math.min(currentIndex, slides.length - 1));
    const slide = slides[currentIndex];
    currentRevealIndex = Math.max(0, Math.min(currentRevealIndex, revealCount(slide) - 1));
    const visibleNodes = visibleSlideNodes(slide);
    const card = overlay.querySelector(".knotis-slides__card");
    const measure = overlay.querySelector(".knotis-slides__measure");
    if (isModuleTitleSlide(slide)) {
      overlay.querySelector(".knotis-slides__crumb")?.replaceChildren();
    } else {
      renderBreadcrumb(overlay.querySelector(".knotis-slides__crumb"), slide);
    }
    renderSlideTitle(overlay.querySelector(".knotis-slides__title"), slide);
    overlay.querySelector(".knotis-slides__count").textContent = `${currentIndex + 1} / ${slides.length}`;
    if (isModuleTitleSlide(slide)) {
      fitRenderedSlide(card, measure, slide);
    } else {
      card.replaceChildren(slideBody(visibleNodes));
      applySlideListIndent(card.querySelector(".knotis-slides__body"), slide);
      renderMermaid(card);
      fitRenderedSlide(card, measure, slide);
    }
    notifySlidesContentUpdated(overlay);
    if (!isModuleTitleSlide(slide)) queueCurrentSlideFit();
    updateTocActive();
    card.focus({ preventScroll: true });
    writeState();
  }

  async function enterPreview() {
    if (!overlay) return;
    writeState();
    closeToc();
    overlay.classList.add(PREVIEW_CLASS);
    renderPreview();
    suppressFullscreenPreview = true;
    await exitFullscreen();
    suppressFullscreenPreview = false;
  }

  async function enterSlideshow() {
    if (!overlay) return;
    overlay.classList.remove(PREVIEW_CLASS);
    await requestFullscreen();
    renderSlide();
  }

  function goForward() {
    const slide = slides[currentIndex];
    if (currentRevealIndex < revealCount(slide) - 1) {
      currentRevealIndex += 1;
    } else if (currentIndex < slides.length - 1) {
      currentIndex += 1;
      currentRevealIndex = 0;
    }
    renderSlide();
  }

  function goBackward() {
    if (currentRevealIndex > 0) {
      currentRevealIndex -= 1;
    } else if (currentIndex > 0) {
      currentIndex -= 1;
      currentRevealIndex = revealCount(slides[currentIndex]) - 1;
    }
    renderSlide();
  }

  function activeWikilinkPane() {
    const pane = document.getElementById("wikilink-pane");
    return pane?.classList.contains("wikilink-pane--open") ? pane : null;
  }

  function closeActiveWikilinkPane() {
    const pane = activeWikilinkPane();
    if (!pane) return false;
    const closeButton = pane.querySelector(".wikilink-pane__close");
    if (closeButton) closeButton.click();
    else {
      pane.classList.remove("wikilink-pane--open");
      pane.setAttribute("aria-hidden", "true");
    }
    return true;
  }

  async function requestFullscreen() {
    const target = document.documentElement || overlay;
    if (document.fullscreenElement || !target.requestFullscreen) return;
    try {
      await target.requestFullscreen({ navigationUI: "hide" });
      enteredFullscreen = true;
    } catch {
      enteredFullscreen = false;
    }
  }

  async function exitFullscreen() {
    if (!enteredFullscreen || !document.fullscreenElement || !document.exitFullscreen) return;
    try { await document.exitFullscreen(); } catch (err) { console.warn("[DEBUG] exiting fullscreen failed", err); }
    enteredFullscreen = false;
  }

  function pageHasMermaid(root) {
    return Boolean(root?.querySelector?.(".mermaid, pre.mermaid"));
  }

  function warmPageMermaidCache(root) {
    if (!root || !window.KnotisMermaid) return;
    window.KnotisMermaid.capture?.(root);
    window.KnotisMermaid.cache?.(root);
    if (window.KnotisMermaid.syncCache) {
      void window.KnotisMermaid.syncCache(root).then(() => {
        window.KnotisMermaid.capture?.(root);
        window.KnotisMermaid.cache?.(root);
      });
    }
    if (pageHasMermaid(root) && window.KnotisMermaid.ensureReady) {
      void window.KnotisMermaid.ensureReady(root).then(() => {
        window.KnotisMermaid.capture?.(root);
        window.KnotisMermaid.cache?.(root);
      });
    }
  }

  async function openSlides(index = 0, revealIndex = 0) {
    const root = article() || document;
    warmPageMermaidCache(root);
    resetTitleSlideSizing();
    slides = buildSlides();
    if (!slides.length) return;
    currentIndex = Math.max(0, Math.min(index, slides.length - 1));
    currentRevealIndex = Math.max(0, Math.min(revealIndex, revealCount(slides[currentIndex]) - 1));
    ensureOverlay();
    renderToc();
    overlay.classList.add(ACTIVE_CLASS);
    overlay.classList.remove(PREVIEW_CLASS);
    document.body.setAttribute("data-knotis-slides-lock", "");
    await requestFullscreen();
    renderSlide();
  }

  async function closeSlides({ preserveState = true } = {}) {
    if (!overlay) return;
    if (preserveState) writeState();
    closeToc();
    suppressFullscreenPreview = true;
    overlay.classList.remove(ACTIVE_CLASS);
    overlay.classList.remove(PREVIEW_CLASS);
    document.body.removeAttribute("data-knotis-slides-lock");
    await exitFullscreen();
    suppressFullscreenPreview = false;
  }

  async function closeSlidesToModule() {
    await closeSlides({ preserveState: true });
    scrollToCurrentSlideSource();
  }

  function handleTriggerClick(event) {
    event.preventDefault();
    const saved = readState();
    if (saved?.pageKey && saved.pageKey !== pageKey() && saved.href) {
      try {
        sessionStorage.setItem(AUTO_OPEN_KEY, JSON.stringify({ pageKey: saved.pageKey }));
      } catch (err) {
        console.warn("[DEBUG] saving slide auto-open key failed", err);
      }
      location.href = saved.href;
      return;
    }
    openSlides(
      saved?.pageKey === pageKey() ? saved.slideIndex || 0 : 0,
      saved?.pageKey === pageKey() ? saved.revealIndex || 0 : 0,
    );
  }

  function attachHandlers() {
    if (handlersAttached) return;
    handlersAttached = true;

    document.addEventListener("click", (event) => {
      if (event.target.closest?.(".knotis-slides-trigger")) {
        handleTriggerClick(event);
        return;
      }

      if (event.target.closest?.(".knotis-slides-restart")) {
        event.preventDefault();
        clearState();
        return;
      }

      const codeCopy = event.target.closest?.(".knotis-slides__code-copy");
      if (codeCopy) {
        event.preventDefault();
        event.stopPropagation();
        copySlideCode(codeCopy);
        return;
      }

      if (event.target.closest?.(".knotis-slides__toc-button")) {
        event.preventDefault();
        toggleToc();
        return;
      }

      if (event.target.closest?.(".knotis-slides__slideshow-button")) {
        event.preventDefault();
        enterSlideshow();
        return;
      }

      if (event.target.closest?.(".knotis-slides__close-button")) {
        event.preventDefault();
        if (overlay?.classList.contains(PREVIEW_CLASS)) closeSlidesToModule();
        else enterPreview();
        return;
      }

      const crumbLink = event.target.closest?.(".knotis-slides__crumb-link, .knotis-slides__toc-crumb-link");
      if (crumbLink) {
        event.preventDefault();
        event.stopPropagation();
        if (Number.isFinite(Number(crumbLink.dataset.slideIndex))) jumpToSlide(Number(crumbLink.dataset.slideIndex));
        return;
      }

      const tocTitle = event.target.closest?.(".knotis-slides__toc-title-button");
      if (tocTitle) {
        event.preventDefault();
        jumpToSlide(Number(tocTitle.dataset.slideIndex));
        return;
      }

      if (event.target.closest?.(".knotis-slides__toc-backdrop")) {
        event.preventDefault();
        closeToc();
        return;
      }

      if (event.target.closest?.(".knotis-slides__toc")) {
        event.preventDefault();
        return;
      }

      const previewCard = event.target.closest?.(".knotis-slides__preview-card");
      if (previewCard) {
        event.preventDefault();
        jumpToSlide(Number(previewCard.dataset.slideIndex), { fullscreen: true });
        return;
      }

      if (overlay?.classList.contains(ACTIVE_CLASS) && event.target.closest?.(".wikilink-card__context")) {
        closeSlides({ preserveState: true });
        return;
      }

      if (!event.target.closest?.(".knotis-slides")) return;
      if (overlay?.classList.contains(PREVIEW_CLASS)) return;
      if (event.target.closest?.(".knotis-slides__card :is(img, iframe, video, canvas, figure.knotis-media, .knotis-gif-player, .knotis-media__rate, .knotis-gif-player__controls)")) {
        return;
      }
      if (event.target.closest?.(".wikilink, .content-tag, a, button, summary, input, textarea, select, label")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.clientX < window.innerWidth * 0.25) goBackward();
      else goForward();
    }, true);

    document.addEventListener("keydown", (event) => {
      if (!overlay?.classList.contains(ACTIVE_CLASS)) return;
      if (event.key === "Escape" && closeActiveWikilinkPane()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (event.target.closest?.(".wikilink-pane")) return;
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        toggleToc();
        return;
      }
      if (overlay.classList.contains(PREVIEW_CLASS)) {
        const previewCard = event.target.closest?.(".knotis-slides__preview-card");
        if (previewCard && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          jumpToSlide(Number(previewCard.dataset.slideIndex), { fullscreen: true });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          if (tocOpen()) closeToc();
          else closeSlidesToModule();
        }
        return;
      }
      if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        if (tocOpen()) closeToc();
        else goForward();
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        if (tocOpen()) closeToc();
        else goBackward();
      } else if (event.key === "Escape") {
        event.preventDefault();
        if (tocOpen()) closeToc();
        else if (overlay.classList.contains(PREVIEW_CLASS)) closeSlidesToModule();
        else enterPreview();
      }
    }, true);

    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) {
        const shouldPreview = overlay?.classList.contains(ACTIVE_CLASS) && !overlay.classList.contains(PREVIEW_CLASS) && !suppressFullscreenPreview;
        enteredFullscreen = false;
        if (shouldPreview) enterPreview();
      }
      queueCurrentSlideFit();
    });

    document.addEventListener("knotis:media-upgraded", (event) => {
      if (!overlay?.classList.contains(ACTIVE_CLASS)) return;
      const roots = Array.isArray(event.detail?.roots) ? event.detail.roots : [event.detail?.root].filter(Boolean);
      const includesSlides = !roots.length || roots.some((root) => (
        root === overlay || overlay.contains(root) || root.contains?.(overlay)
      ));
      if (!includesSlides) return;
      overlay.querySelectorAll(".knotis-slides__body, .knotis-slides__preview-body-inner").forEach(markMarkerlessBlockListItems);
      if (overlay.classList.contains(PREVIEW_CLASS)) queuePreviewFit(overlay.querySelector(".knotis-slides__preview"));
      else queueCurrentSlideFit();
    });

    window.addEventListener("resize", () => {
      titleSlideFontPx = null;
      if (overlay?.classList.contains(ACTIVE_CLASS) && isModuleTitleSlide(slides[currentIndex])) {
        renderSlide();
      } else {
        queueCurrentSlideFit();
      }
    });
    document.fonts?.ready?.then(queueCurrentSlideFit);
  }

  async function maybeAutoOpen() {
    if (!slidesEnabled) return;
    let auto = null;
    try {
      auto = JSON.parse(sessionStorage.getItem(AUTO_OPEN_KEY) || "null");
    } catch (err) {
      console.warn("[DEBUG] reading slide auto-open state failed", err);
    }
    if (!auto || auto.pageKey !== pageKey()) return;
    clearAutoOpen();
    const saved = readState();
    setTimeout(() => openSlides(saved?.slideIndex || 0, saved?.revealIndex || 0), 120);
  }

  function init() {
    ensureTrigger();
    loadSlidesConfig().then(() => {
      ensureTrigger();
      maybeAutoOpen();
    });
    ensureHeaderObserver();
    attachHandlers();
  }

  function onPageSwap() {
    if (overlay?.classList.contains(ACTIVE_CLASS)) closeSlides({ preserveState: true });
    slides = [];
    resetTitleSlideSizing();
    currentIndex = 0;
    currentRevealIndex = 0;
    ensureTrigger();
    resetHeaderObserver();
    loadSlidesConfig().then(() => {
      ensureTrigger();
      ensureHeaderObserver();
      maybeAutoOpen();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    let first = true;
    window.document$.subscribe(() => {
      if (first) { first = false; return; }
      onPageSwap();
    });
  } else {
    let lastPath = pageKey();
    setInterval(() => {
      if (lastPath === pageKey()) return;
      lastPath = pageKey();
      onPageSwap();
    }, 400);
  }
})();
