(function () {
  const ROOT_ATTR = "data-knotis-sticky-table-headers";
  const TABLE_VARS = [
    "--knotis-sticky-head-start",
    "--knotis-sticky-head-end",
    "--knotis-sticky-head-travel",
    "--knotis-sticky-head-shift",
  ];
  const SCRIPT_BASE = document.currentScript?.src || location.href;
  const GRAPH_JSON_URL = new URL("graph.json", SCRIPT_BASE).href;
  const scrollDriven = Boolean(window.CSS?.supports?.("animation-timeline: scroll()"));
  let configPromise = null;
  let tables = [];
  let frame = 0;
  let generation = 0;
  let listening = false;
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(schedule) : null;

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
      return `${location.origin}/`;
    }
  }

  function normalizePath(pathname = location.pathname) {
    return pathname.replace(/\/index\.html$/, "/");
  }

  function pageUrlToPathname(pageUrl) {
    const token = String(pageUrl || "").trim();
    if (!token) return "";
    try {
      return normalizePath(new URL(token, siteBaseFromScript(SCRIPT_BASE)).pathname);
    } catch {
      return normalizePath(`/${token.replace(/^\/+/, "")}`);
    }
  }

  function pathMatchesPageUrl(currentPathname, pageUrl) {
    const current = normalizePath(currentPathname);
    if (current === pageUrlToPathname(pageUrl)) return true;
    const rel = String(pageUrl || "").trim().replace(/^\/+/, "").replace(/\/index\.html$/, "/").replace(/\/$/, "");
    if (!rel) return false;
    const currentStem = current.replace(/\/$/, "");
    return currentStem === `/${rel}` || currentStem.endsWith(`/${rel}`);
  }

  function urlList(raw) {
    return Array.isArray(raw) ? raw.map((value) => String(value || "").trim()).filter(Boolean) : [];
  }

  function runtimeConfig(raw) {
    const cfg = raw && typeof raw === "object" ? raw : {};
    return {
      enabled: cfg.enabled === true,
      includeAll: cfg.include_all === true,
      includeUrls: urlList(cfg.include_urls),
      excludeUrls: urlList(cfg.exclude_urls),
    };
  }

  function loadConfig() {
    if (!configPromise) {
      configPromise = fetch(GRAPH_JSON_URL, { cache: "no-store" })
        .then((resp) => {
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          return resp.json();
        })
        .then((graph) => runtimeConfig(graph?.meta?.knotis?.table?.sticky_headers))
        .catch(() => runtimeConfig(null));
    }
    return configPromise;
  }

  function pageEnabled(config) {
    if (!config.enabled) return false;
    const current = normalizePath();
    if (config.excludeUrls.some((url) => pathMatchesPageUrl(current, url))) return false;
    return config.includeAll || config.includeUrls.some((url) => pathMatchesPageUrl(current, url));
  }

  function headerOffset() {
    const header = document.querySelector(".md-header");
    return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  }

  function measure(table) {
    const head = table.tHead;
    const rect = table.getBoundingClientRect();
    const headTop = rect.top + table.clientTop + head.offsetTop;
    const travel = Math.max(0, rect.bottom - table.clientTop - headTop - head.offsetHeight);
    return { headTop, travel };
  }

  function update() {
    frame = 0;
    const offset = headerOffset();
    for (const table of tables) {
      if (!table.tHead || !table.isConnected) continue;
      const { headTop, travel } = measure(table);
      if (scrollDriven) {
        const start = Math.max(0, scrollY + headTop - offset);
        table.style.setProperty("--knotis-sticky-head-start", `${start}px`);
        table.style.setProperty("--knotis-sticky-head-end", `${start + travel}px`);
        table.style.setProperty("--knotis-sticky-head-travel", `${travel}px`);
      } else {
        const shift = Math.min(Math.max(offset - headTop, 0), travel);
        table.style.setProperty("--knotis-sticky-head-shift", `${shift}px`);
        table.toggleAttribute("data-sticky-head-active", shift > 0);
      }
    }
  }

  function schedule() {
    if (!frame && tables.length) frame = requestAnimationFrame(update);
  }

  function setListening(on) {
    if (on === listening) return;
    listening = on;
    const method = on ? addEventListener : removeEventListener;
    if (!scrollDriven) method("scroll", schedule, { passive: true });
    method("resize", schedule);
  }

  function teardown() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    resizeObserver?.disconnect();
    setListening(false);
    for (const table of tables) {
      table.removeAttribute("data-sticky-head");
      table.removeAttribute("data-sticky-head-active");
      for (const name of TABLE_VARS) table.style.removeProperty(name);
      if (!table.getAttribute("style")) table.removeAttribute("style");
    }
    tables = [];
    document.documentElement.removeAttribute(ROOT_ATTR);
  }

  function eligibleTables() {
    return [...document.querySelectorAll(".md-content__inner table")].filter(
      (table) => table.tHead && !table.classList.contains("highlighttable"),
    );
  }

  async function init() {
    const current = ++generation;
    teardown();
    const config = await loadConfig();
    if (current !== generation || !pageEnabled(config)) return;
    tables = eligibleTables();
    if (!tables.length) return;
    document.documentElement.setAttribute(ROOT_ATTR, "true");
    for (const table of tables) {
      table.setAttribute("data-sticky-head", "");
      resizeObserver?.observe(table);
    }
    const content = document.querySelector(".md-content__inner");
    if (content) resizeObserver?.observe(content);
    setListening(true);
    schedule();
  }

  document.fonts?.ready.then(schedule);

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(init);
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
