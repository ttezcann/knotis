(function (global) {
  "use strict";

  function createPreviewScroll(options) {
    const anchorY = options?.anchorY ?? 16;
    const smoothMs = options?.smoothMs ?? 180;
    const rootSelector = options?.rootSelector ?? ".md-content__inner";

    let suppressUntil = 0;
    let cachedAnchors = null;
    let animFrame = null;
    let animTargetY = 0;

    function scrollRoot() {
      return document.scrollingElement || document.documentElement || document.body;
    }

    function currentScrollY() {
      return scrollRoot().scrollTop || global.scrollY || 0;
    }

    function setScrollY(value) {
      const top = Math.max(0, value);
      scrollRoot().scrollTop = top;
      global.scrollTo(0, top);
    }

    function elementTop(element) {
      return element.getBoundingClientRect().top + currentScrollY();
    }

    function elementBottom(element) {
      return element.getBoundingClientRect().bottom + currentScrollY();
    }

    function contentEndY(root) {
      return root ? elementBottom(root) : document.body.scrollHeight;
    }

    function readHeadingMap() {
      const node = document.getElementById("knotis-heading-map");
      if (!node) {
        return [];
      }
      try {
        const parsed = JSON.parse(node.textContent || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (_error) {
        return [];
      }
    }

    function buildDataLineAnchors(root) {
      const byLine = new Map();
      for (const element of root.querySelectorAll("[data-line]")) {
        const line = Number.parseInt(element.getAttribute("data-line") || "", 10);
        if (!Number.isFinite(line)) {
          continue;
        }
        const target = element.closest(".heading-flow") || element;
        const top = elementTop(target);
        const existing = byLine.get(line);
        if (existing === undefined || top < existing.top) {
          byLine.set(line, { line, top });
        }
      }
      return Array.from(byLine.values()).sort((left, right) => left.line - right.line);
    }

    function buildHeadingAnchors() {
      const headingMap = readHeadingMap();
      const anchors = [];
      for (const entry of headingMap) {
        const element = document.getElementById(entry.id);
        if (!element) {
          continue;
        }
        const target = element.closest(".heading-flow") || element;
        anchors.push({ line: entry.line, top: elementTop(target) });
      }
      return anchors.sort((left, right) => left.line - right.line);
    }

    function trustDataLineAnchors() {
      return document.body?.getAttribute("data-knotis-trust-data-line") === "true";
    }

    function buildAnchorMap() {
      const root = document.querySelector(rootSelector);
      if (!root) {
        return [];
      }

      const headingAnchors = buildHeadingAnchors();
      if (trustDataLineAnchors()) {
        const dataLineAnchors = buildDataLineAnchors(root);
        if (dataLineAnchors.length > 0) {
          return dataLineAnchors;
        }
      }
      if (headingAnchors.length > 0) {
        return headingAnchors;
      }
      return buildDataLineAnchors(root);
    }

    function getAnchors(force) {
      if (force || !cachedAnchors) {
        cachedAnchors = buildAnchorMap();
      }
      return cachedAnchors;
    }

    function invalidateAnchorMap() {
      cachedAnchors = null;
    }

    function scrollYForLine(line, anchors, endY) {
      if (!anchors.length) {
        return 0;
      }
      if (line <= anchors[0].line) {
        return Math.max(0, anchors[0].top - anchorY);
      }

      let index = 0;
      while (index + 1 < anchors.length && anchors[index + 1].line <= line) {
        index += 1;
      }

      const start = anchors[index];
      const end = anchors[index + 1] || { line: start.line + 1, top: endY };
      const span = Math.max(1, end.line - start.line);
      const ratio = (line - start.line) / span;
      return Math.max(0, start.top + (end.top - start.top) * ratio - anchorY);
    }

    function smoothScrollTo(targetY) {
      animTargetY = Math.max(0, targetY);
      if (animFrame) {
        return;
      }

      const startY = currentScrollY();
      const startTime = performance.now();

      function step(now) {
        const t = Math.min(1, (now - startTime) / smoothMs);
        const eased = 1 - Math.pow(1 - t, 3);
        setScrollY(startY + (animTargetY - startY) * eased);
        if (t < 1) {
          animFrame = requestAnimationFrame(step);
          return;
        }
        setScrollY(animTargetY);
        animFrame = null;
        suppressUntil = Date.now() + smoothMs + 120;
      }

      animFrame = requestAnimationFrame(step);
    }

    function scrollToLine(line, scrollOptions) {
      if (!Number.isFinite(line)) {
        return false;
      }

      const root = document.querySelector(rootSelector);
      const anchors = getAnchors(Boolean(scrollOptions?.forceRemeasure));
      if (!anchors.length) {
        return false;
      }

      const targetY = scrollYForLine(line, anchors, contentEndY(root));
      const smooth = scrollOptions?.smooth !== false;

      if (smooth) {
        smoothScrollTo(targetY);
      } else {
        setScrollY(targetY);
        suppressUntil = Date.now() + 400;
      }

      return true;
    }

    function visibleLineAtAnchor() {
      const root = document.querySelector(rootSelector);
      const anchors = getAnchors(false);
      if (!anchors.length) {
        return null;
      }

      const anchorPos = currentScrollY() + anchorY;
      const endY = contentEndY(root);

      if (anchorPos <= anchors[0].top) {
        return anchors[0].line;
      }

      let index = 0;
      while (index + 1 < anchors.length && anchors[index + 1].top <= anchorPos) {
        index += 1;
      }

      const start = anchors[index];
      const end = anchors[index + 1] || { line: start.line + 1, top: endY };
      const span = Math.max(1, end.top - start.top);
      const ratio = (anchorPos - start.top) / span;
      return Math.round(start.line + (end.line - start.line) * ratio);
    }

    function isSuppressed() {
      return Date.now() < suppressUntil;
    }

    function markSuppressed(durationMs) {
      suppressUntil = Date.now() + durationMs;
    }

    return {
      buildAnchorMap,
      getAnchors,
      invalidateAnchorMap,
      scrollToLine,
      visibleLineAtAnchor,
      scrollYForLine,
      isSuppressed,
      markSuppressed,
      currentScrollY,
    };
  }

  global.__knotisPreviewScroll = { createPreviewScroll };

  if (global.parent !== global && /^localhost$|^127\.0\.0\.1$/.test(global.location.hostname)) {
    const scroll = createPreviewScroll({ anchorY: 96, smoothMs: 0 });
    let suppressUntil = 0;

    global.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || data.source !== "knotis-preview") {
        return;
      }
      if (data.type === "scrollToLine") {
        scroll.scrollToLine(Number.parseInt(data.line, 10), { smooth: false, forceRemeasure: true });
        suppressUntil = Date.now() + 400;
        return;
      }
      if (data.type === "scrollToHeading" && data.id) {
        const target = document.getElementById(data.id);
        if (!target) {
          return;
        }
        suppressUntil = Date.now() + 400;
        target.scrollIntoView({ block: "start", behavior: "auto" });
      }
    });

    let scrollTimer = null;
    global.addEventListener(
      "scroll",
      () => {
        if (Date.now() < suppressUntil || scroll.isSuppressed()) {
          return;
        }
        if (scrollTimer) {
          clearTimeout(scrollTimer);
        }
        scrollTimer = setTimeout(() => {
          const line = scroll.visibleLineAtAnchor();
          if (line === null) {
            return;
          }
          global.parent.postMessage(
            {
              source: "knotis-preview",
              type: "visibleLine",
              line,
            },
            "*",
          );
        }, 120);
      },
      { passive: true },
    );

    global.__knotisPreviewBridge = {
      scrollToLine: (line) => scroll.scrollToLine(line, { smooth: false, forceRemeasure: true }),
      visibleLineAtAnchor: () => scroll.visibleLineAtAnchor(),
      lineElements: () => scroll.getAnchors(true),
    };
  }
})(window);
