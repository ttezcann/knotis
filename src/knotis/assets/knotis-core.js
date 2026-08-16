(function () {
  "use strict";

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function deepClone(value) {
    if (Array.isArray(value)) return value.map((item) => deepClone(item));
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, deepClone(item)]));
    }
    return value;
  }

  function deepMerge(base, ...overrides) {
    const result = deepClone(base);
    overrides.forEach((override) => {
      if (!isPlainObject(override)) return;
      Object.entries(override).forEach(([key, value]) => {
        if (isPlainObject(value) && isPlainObject(result[key])) result[key] = deepMerge(result[key], value);
        else result[key] = deepClone(value);
      });
    });
    return result;
  }

  function fetchJsonNoStore(url) {
    return fetch(url, { cache: "no-store" });
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const KEY_CHORD_LABELS = {
    ctrl: "Ctrl",
    control: "Ctrl",
    cmd: "Cmd",
    command: "Cmd",
    alt: "Alt",
    option: "Option",
    shift: "Shift",
    enter: "Enter",
    return: "Return",
    tab: "Tab",
    esc: "Esc",
    escape: "Esc",
    space: "Space",
  };

  
  function renderKeyChordHtml(content) {
    const parts = String(content || "").split("+").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return "";
    const rendered = parts.map((part) => {
      const lower = part.toLowerCase();
      const label = KEY_CHORD_LABELS[lower] || (part.length === 1 ? part.toUpperCase() : part);
      return `<kbd class="key-${lower.replace(/[^a-z0-9]+/g, "-")}">${escapeHtml(label)}</kbd>`;
    }).join('<span class="wl-key-sep">+</span>');
    return `<span class="keys">${rendered}</span>`;
  }

  const MOC_NAV_STATE_PREFIX = "knotis:moc-nav:";

  function mocNavStorageKey(input) {
    const key = String(input?.dataset?.knotisMocNavKey || "").trim();
    return key ? `${MOC_NAV_STATE_PREFIX}${key}` : "";
  }

  function syncMocNavExpandedState(input) {
    if (!input) return;
    const nav = input.closest(".md-nav__item")?.querySelector(":scope > nav.md-nav");
    if (nav) nav.setAttribute("aria-expanded", input.checked ? "true" : "false");
  }

  function initMocNavPersistence(root = document) {
    const inputs = root.querySelectorAll?.("input.md-nav__toggle[data-knotis-moc-nav-key]") || [];
    inputs.forEach((input) => {
      const storageKey = mocNavStorageKey(input);
      if (!storageKey) return;
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved === "expanded") input.checked = true;
        else if (saved === "collapsed") input.checked = false;
      } catch (_err) {
        
      }
      syncMocNavExpandedState(input);
      if (input.dataset.knotisMocNavBound === "true") return;
      input.dataset.knotisMocNavBound = "true";
      input.addEventListener("change", () => {
        try {
          localStorage.setItem(storageKey, input.checked ? "expanded" : "collapsed");
        } catch (_err) {
          
        }
        syncMocNavExpandedState(input);
      });
    });
  }

  function initKnotisCorePageEnhancements() {
    initMocNavPersistence(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initKnotisCorePageEnhancements);
  } else {
    initKnotisCorePageEnhancements();
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    let first = true;
    window.document$.subscribe(() => {
      if (first) { first = false; return; }
      initKnotisCorePageEnhancements();
    });
  }

  window.KnotisCore = {
    isPlainObject,
    deepClone,
    deepMerge,
    fetchJsonNoStore,
    escapeHtml,
    renderKeyChordHtml,
    initMocNavPersistence,
  };
})();
