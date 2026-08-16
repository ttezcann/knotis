(function () {
  "use strict";

  var EXPANDED_CLASS = "knotis-readaloud--expanded";
  var ACTIVE_CLASS = "knotis-readaloud--active";
  var NO_VOICES_MSG = "No speech voices available on this device";

  var FEMALE_HINTS = ["ava", "samantha", "karen", "zoe", "allison", "nicky", "female", "zira", "jenny", "susan"];
  var MALE_HINTS = ["tom", "alex", "daniel", "evan", "fred", "david", "male", "mark", "guy", "aaron"];

  var HEADPHONES_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/><circle cx="12" cy="12" r="1"/></svg>';
  var PLAY_SVG       = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5,3 19,12 5,21"/></svg>';
  var PAUSE_SVG      = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';

  var RATE_OPTIONS = [
    { label: "0.5x", value: 0.5 },
    { label: "0.75x", value: 0.75 },
    { label: "1.0x", value: 1.0 },
    { label: "1.25x", value: 1.25 },
    { label: "1.5x", value: 1.5 },
    { label: "2.0x", value: 2.0 },
  ];

  var STORAGE_KEY_RATE = "knotis-readaloud-rate";
  var STORAGE_KEY_VOICE = "knotis-readaloud-voice";

  var wrapper = null;
  var hpBtn = null;
  var panel = null;
  var playBtn = null;
  var rateSelect = null;
  var voiceSelect = null;
  var noVoicesEl = null;

  var isPlaying = false;
  var isPaused = false;
  var isExpanded = false;

  var voiceOptions = [];

  var contentBlocks = [];
  var currentBlockIndex = -1;
  var currentUtterance = null;
  var highlightedEl = null;

  var SCRIPT_BASE = (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("knotis-readaloud.js") !== -1) {
        try { return new URL(".", src).href; } catch (e) { return ""; }
      }
    }
    return "";
  })();
  var GRAPH_JSON_URL = SCRIPT_BASE ? new URL("graph.json", SCRIPT_BASE).href : "graph.json";

  var readaloudConfig = { enabled: true };
  var readaloudConfigPromise = null;
  var controlsBound = false;

  

  function getHeaderNav() {
    return (
      document.querySelector(".md-header__inner .md-header__option")?.parentElement ||
      document.querySelector(".md-header__inner") ||
      document.querySelector(".md-header nav") ||
      document.querySelector(".md-header")
    );
  }

  function loadRate() {
    var raw = localStorage.getItem(STORAGE_KEY_RATE);
    var val = parseFloat(raw);
    if (!isNaN(val)) {
      for (var i = 0; i < RATE_OPTIONS.length; i++) {
        if (RATE_OPTIONS[i].value === val) return val;
      }
      if (val < 0.5) return 0.5;
      if (val > 2.0) return 2.0;
      return val;
    }
    return 1.0;
  }

  function saveRate(rate) {
    localStorage.setItem(STORAGE_KEY_RATE, String(rate));
  }

  function loadVoiceValue() {
    var saved = localStorage.getItem(STORAGE_KEY_VOICE) || "";
    if (saved === "voice1" || saved === "voice2") return saved;
    if (saved.indexOf("kokoro:") === 0) {
      localStorage.removeItem(STORAGE_KEY_VOICE);
    }
    return "voice1";
  }

  function saveVoiceValue(value) {
    localStorage.setItem(STORAGE_KEY_VOICE, value);
  }

  function loadReadaloudConfig() {
    if (readaloudConfigPromise) return readaloudConfigPromise;
    readaloudConfigPromise = fetch(GRAPH_JSON_URL, { cache: "no-store" })
      .then(function (resp) {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.json();
      })
      .then(function (graph) {
        var raw = graph && graph.meta && graph.meta.knotis && graph.meta.knotis.readaloud;
        if (raw && typeof raw.enabled === "boolean") {
          readaloudConfig.enabled = raw.enabled;
        }
        return readaloudConfig;
      })
      .catch(function () {
        return readaloudConfig;
      });
    return readaloudConfigPromise;
  }

  function headingLevel(el) {
    if (!el || !el.tagName) return 0;
    var tag = el.tagName.toLowerCase();
    if (tag.length === 2 && tag.charAt(0) === "h") {
      var n = parseInt(tag.charAt(1), 10);
      if (n >= 1 && n <= 6) return n;
    }
    return 0;
  }

  function isReadaloudExcludedHeading(el) {
    return !!(el && el.hasAttribute && el.hasAttribute("data-readaloud-exclude"));
  }

  function isYamlPageTitleHeading(el) {
    return !!(el && el.id === "__skip");
  }

  function setReadaloudVisible(visible) {
    var trigger = wrapper || document.querySelector(".knotis-readaloud-trigger");
    if (!trigger) return;
    trigger.hidden = !visible;
    trigger.style.display = visible ? "" : "none";
    if (!visible) {
      if (isExpanded) collapse();
      else cancelSpeech();
    }
  }

  function readaloudEnabled() {
    return readaloudConfig.enabled !== false;
  }

  

  function getContentRoot() {
    return (
      document.querySelector("article.md-content__inner.md-typeset") ||
      document.querySelector("article.md-content__inner")
    );
  }

  function isInsideSkippedContainer(el, root) {
    var node = el;
    while (node && node !== root) {
      if (!node.tagName) { node = node.parentElement; continue; }
      var tag = node.tagName.toLowerCase();
      if (tag === "table" || tag === "figure" || tag === "nav" || tag === "aside" || tag === "pre") {
        return true;
      }
      if (node.classList) {
        if (
          node.classList.contains("mermaid") ||
          node.classList.contains("highlighttable") ||
          node.classList.contains("md-nav") ||
          node.classList.contains("md-content__button") ||
          node.classList.contains("md-sidebar") ||
          node.classList.contains("md-tabs") ||
          node.classList.contains("md-footer") ||
          node.classList.contains("grid") ||
          node.classList.contains("cards") ||
          node.classList.contains("knotis-readaloud-trigger") ||
          node.classList.contains("wikilink-pane") ||
          node.classList.contains("knotis-search") ||
          node.classList.contains("language-r") ||
          node.classList.contains("language-python") ||
          node.classList.contains("language-bash")
        ) {
          return true;
        }
      }
      node = node.parentElement;
    }
    return false;
  }

  function extractOwnListItemText(el) {
    var clone = el.cloneNode(true);
    clone.querySelectorAll("ul, ol").forEach(function (n) { n.remove(); });
    return extractVisibleText(clone);
  }

  function shouldSkipBlock(el, root) {
    if (!el || !el.tagName) return true;
    if (isInsideSkippedContainer(el, root)) return true;

    var tag = el.tagName.toLowerCase();
    var isBlock = { "p":1, "li":1, "h1":1, "h2":1, "h3":1, "h4":1, "h5":1, "h6":1, "blockquote":1 }[tag];
    if (!isBlock) return false;

    
    if (tag === "li" && el.querySelector("ul, ol")) {
      return false;
    }

    if (el.querySelector("pre, table, figure, .mermaid, .highlighttable, .md-button")) {
      var clone = el.cloneNode(true);
      clone.querySelectorAll(
        "pre, table, figure, button, .md-button, .highlighttable, .highlight, .mermaid, img, svg"
      ).forEach(function (n) { n.remove(); });
      if ((clone.textContent || "").replace(/\s+/g, " ").trim().length < 12) return true;
    }

    if (tag === "li" || tag === "p") {
      if (el.querySelector("img, svg, .twemoji")) {
        var prose = el.cloneNode(true);
        prose.querySelectorAll(
          "img, svg, pre, table, figure, button, .md-button, .twemoji, .keys, a[download], .highlighttable, .highlight"
        ).forEach(function (n) { n.remove(); });
        if ((prose.textContent || "").replace(/\s+/g, " ").trim().length < 12) return true;
      }
    }
    return false;
  }

  function extractContentBlocks(root) {
    if (!root) return [];

    var blocks = [];
    var skipTags = { "nav":1, "footer":1, "script":1, "style":1, "noscript":1, "svg":1, "math":1, "mjx-container":1, "table":1, "figure":1, "pre":1, "thead":1, "tbody":1, "tr":1, "th":1, "td":1, "figcaption":1 };
    var blockTags = { "p":1, "li":1, "h1":1, "h2":1, "h3":1, "h4":1, "h5":1, "h6":1, "blockquote":1 };
    var skipUntilLevel = null;

    function walk(el) {
      if (!el || !el.tagName) return;
      var tag = el.tagName.toLowerCase();
      if (skipTags[tag]) return;

      var level = headingLevel(el);
      if (level) {
        if (skipUntilLevel !== null && level <= skipUntilLevel) {
          skipUntilLevel = null;
        }
        if (isReadaloudExcludedHeading(el)) {
          skipUntilLevel = level;
          return;
        }
        if (isYamlPageTitleHeading(el)) {
          return;
        }
      }

      if (blockTags[tag]) {
        if (skipUntilLevel !== null) return;
        if (shouldSkipBlock(el, root)) return;
        if (tag === "li" && el.querySelector("ul, ol")) {
          var ownText = extractOwnListItemText(el);
          if (ownText.length > 0) blocks.push({ el: el, text: ownText });
          for (var c = 0; c < el.children.length; c++) walk(el.children[c]);
          return;
        }
        var text = extractVisibleText(el);
        if (text.length > 0) blocks.push({ el: el, text: text });
        return;
      }
      if (el.children) {
        for (var i = 0; i < el.children.length; i++) walk(el.children[i]);
      }
    }
    walk(root);
    return blocks;
  }

  function extractVisibleText(el) {
    var clone = el.cloneNode(true);
    clone.querySelectorAll(
      "script, style, noscript, nav, aside, pre, table, figure, img, svg, math, mjx-container, " +
      "button, .md-search, .knotis-search, .md-nav, .md-header, .md-sidebar, .md-footer, .md-tabs, " +
      ".md-content__button, .md-button, .mermaid, .highlighttable, .highlight, .twemoji, .keys, " +
      "[aria-hidden='true'], [data-knotis-slide-marker]"
    ).forEach(function (n) { n.remove(); });

    return (clone.textContent || "")
      .replace(/\u00B6/g, "")
      .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  

  function _englishVoices(raw) {
    var en = [];
    for (var i = 0; i < raw.length; i++) {
      if (raw[i].lang && raw[i].lang.toLowerCase().indexOf("en") === 0) en.push(raw[i]);
    }
    return en;
  }

  function _scoreVoice(name) {
    var n = name.toLowerCase();
    var score = 0;
    if (n.indexOf("enhanced") !== -1) score += 10;
    if (n.indexOf("premium") !== -1) score += 8;
    if (n.indexOf("neural") !== -1) score += 6;
    return score;
  }

  function _findBestVoice(voices, hints, exclude) {
    var best = null;
    var bestScore = -1;
    for (var h = 0; h < hints.length; h++) {
      var needle = hints[h];
      for (var i = 0; i < voices.length; i++) {
        if (exclude && voices[i] === exclude) continue;
        var n = voices[i].name.toLowerCase();
        if (n.indexOf(needle) === -1) continue;
        var score = _scoreVoice(n) + (hints.length - h);
        if (score > bestScore) {
          bestScore = score;
          best = voices[i];
        }
      }
      if (best) return best;
    }
    return null;
  }

  function _pickFallback(voices, exclude) {
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < voices.length; i++) {
      if (exclude && voices[i] === exclude) continue;
      var score = _scoreVoice(voices[i].name);
      if (score > bestScore) {
        bestScore = score;
        best = voices[i];
      }
    }
    return best;
  }

  function loadVoices() {
    refreshVoiceList();
    if (voiceOptions.length === 0) {
      window.speechSynthesis.addEventListener("voiceschanged", function () {
        refreshVoiceList();
      }, { once: true });
    }
  }

  function canSpeak() {
    if (voiceOptions.length === 0) refreshVoiceList();
    return voiceOptions.length > 0;
  }

  function refreshVoiceList() {
    voiceOptions = [];

    try {
      var en = _englishVoices(window.speechSynthesis.getVoices());
      if (en.length === 0) {
        populateVoiceSelect();
        updateNoVoicesUI();
        return;
      }

      var female = _findBestVoice(en, FEMALE_HINTS, null) || en[0];
      var male = _findBestVoice(en, MALE_HINTS, female) || _pickFallback(en, female);

      voiceOptions.push({
        id: "voice1",
        label: "Voice 1",
        value: "voice1",
        voice: female,
      });

      if (male && male !== female) {
        voiceOptions.push({
          id: "voice2",
          label: "Voice 2",
          value: "voice2",
          voice: male,
        });
      }
    } catch (e) {  }

    populateVoiceSelect();
    updateNoVoicesUI();
  }

  function populateVoiceSelect() {
    if (!voiceSelect) return;
    voiceSelect.innerHTML = "";
    for (var i = 0; i < voiceOptions.length; i++) {
      var opt = document.createElement("option");
      opt.value = voiceOptions[i].value;
      opt.textContent = voiceOptions[i].label;
      voiceSelect.appendChild(opt);
    }
    var saved = loadVoiceValue();
    var matched = false;
    if (saved) {
      for (var j = 0; j < voiceOptions.length; j++) {
        if (voiceOptions[j].value === saved) {
          voiceSelect.value = saved;
          matched = true;
          break;
        }
      }
    }
    if (!matched && voiceOptions.length > 0) {
      voiceSelect.value = voiceOptions[0].value;
    }
  }

  function getSelectedVoiceInfo() {
    if (!voiceSelect) return null;
    var value = voiceSelect.value;
    for (var i = 0; i < voiceOptions.length; i++) {
      if (voiceOptions[i].value === value) return voiceOptions[i];
    }
    return voiceOptions.length > 0 ? voiceOptions[0] : null;
  }

  function updateNoVoicesUI() {
    if (!noVoicesEl || !playBtn) return;
    var canPlay = voiceOptions.length > 0;
    noVoicesEl.hidden = canPlay;
    noVoicesEl.textContent = NO_VOICES_MSG;
    playBtn.disabled = !canPlay;
  }

  function updateEmptyContentUI() {
    if (!noVoicesEl || !playBtn) return;
    if (voiceOptions.length === 0) {
      noVoicesEl.hidden = false;
      noVoicesEl.textContent = NO_VOICES_MSG;
      playBtn.disabled = true;
      return;
    }
    if (contentBlocks.length === 0) {
      noVoicesEl.hidden = false;
      noVoicesEl.textContent = "No readable content on this page";
      playBtn.disabled = true;
      return;
    }
    noVoicesEl.hidden = true;
    playBtn.disabled = false;
  }

  

  function clearBlockHighlight() {
    if (highlightedEl) {
      highlightedEl.classList.remove(ACTIVE_CLASS);
      highlightedEl = null;
    }
  }

  function focusBlock(index) {
    clearBlockHighlight();
    if (index < 0 || index >= contentBlocks.length) return;
    var block = contentBlocks[index];
    if (!block || !block.el || !block.el.isConnected) return;
    highlightedEl = block.el;
    highlightedEl.classList.add(ACTIVE_CLASS);
    try {
      highlightedEl.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {
      highlightedEl.scrollIntoView(true);
    }
  }

  

  function stopSpeaking() {
    currentUtterance = null;
    try { window.speechSynthesis.cancel(); } catch (e) {  }
    isPlaying = false;
    isPaused = false;
    refreshPlayIcon();
  }

  function cancelSpeech() {
    stopSpeaking();
    currentBlockIndex = -1;
    clearBlockHighlight();
  }

  

  function speakBlock(index) {
    if (index < 0 || index >= contentBlocks.length) {
      isPlaying = false;
      clearBlockHighlight();
      refreshPlayIcon();
      return;
    }

    try { window.speechSynthesis.cancel(); } catch (e) {  }
    currentUtterance = null;

    var block = contentBlocks[index];
    if (!block || !block.text) {
      speakBlock(index + 1);
      return;
    }

    currentBlockIndex = index;
    isPlaying = true;
    isPaused = false;
    refreshPlayIcon();
    focusBlock(index);

    var utterance = new SpeechSynthesisUtterance(block.text);
    currentUtterance = utterance;
    utterance.rate = loadRate();
    utterance.lang = document.documentElement.lang || "en-US";

    var info = getSelectedVoiceInfo();
    if (info && info.voice) {
      utterance.voice = info.voice;
    }

    utterance.onstart = function () { isPlaying = true; refreshPlayIcon(); };
    utterance.onend = function () {
      if (this !== currentUtterance || !isPlaying) return;
      _nextBlock();
    };
    utterance.onerror = function (e) {
      if (this !== currentUtterance) return;
      if (e.error === "canceled" || e.error === "interrupted") {
        isPlaying = false;
        refreshPlayIcon();
        return;
      }
      console.warn("[knotis-readaloud] Speech error:", e.error);
      if (isPlaying) _nextBlock();
    };

    try { window.speechSynthesis.speak(utterance); }
    catch (e) {
      console.warn("[knotis-readaloud] speak failed:", e);
      isPlaying = false;
      refreshPlayIcon();
    }
  }

  function _nextBlock() {
    if (!isPlaying) return;
    if (currentBlockIndex < contentBlocks.length - 1) {
      speakBlock(currentBlockIndex + 1);
    } else {
      isPlaying = false;
      currentBlockIndex = -1;
      currentUtterance = null;
      clearBlockHighlight();
      refreshPlayIcon();
    }
  }

  function ensureContentBlocks() {
    if (contentBlocks.length === 0) {
      var root = getContentRoot();
      if (root) contentBlocks = extractContentBlocks(root);
    }
  }

  function togglePlayPause() {
    
    if (isPlaying && isPaused) {
      isPaused = false;
      try { window.speechSynthesis.resume(); } catch (e) {  }
      refreshPlayIcon();
      return;
    }

    
    if (isPlaying) {
      isPaused = true;
      try { window.speechSynthesis.pause(); } catch (e) {  }
      refreshPlayIcon();
      return;
    }

    if (!canSpeak()) {
      updateNoVoicesUI();
      return;
    }

    if (contentBlocks.length === 0) {
      var root = getContentRoot();
      if (!root) return;
      contentBlocks = extractContentBlocks(root);
      currentBlockIndex = -1;
    }

    if (contentBlocks.length === 0) {
      updateEmptyContentUI();
      return;
    }

    updateEmptyContentUI();
    isPlaying = true;
    isPaused = false;

    var startIndex = currentBlockIndex >= 0 ? currentBlockIndex : 0;
    speakBlock(startIndex);
  }

  

  var CLICKABLE_BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, h5, h6, blockquote";
  var CLICK_IGNORE_SELECTOR = "a, button, input, select, textarea, label, summary, .md-button";

  
  function blockIndexForNode(node) {
    while (node) {
      for (var i = 0; i < contentBlocks.length; i++) {
        if (contentBlocks[i].el === node) return i;
      }
      node = node.parentElement;
    }
    return -1;
  }

  function handleContentClick(e) {
    if (!canSpeak()) return;
    
    if (e.target.closest && e.target.closest(CLICK_IGNORE_SELECTOR)) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && String(sel).trim().length > 0) return;

    ensureContentBlocks();
    if (contentBlocks.length === 0) return;

    var blockEl = e.target.closest && e.target.closest(CLICKABLE_BLOCK_SELECTOR);
    if (!blockEl) return;
    var idx = blockIndexForNode(blockEl);
    if (idx === -1) return;

    currentBlockIndex = idx;
    stopSpeaking();
    isPlaying = true;
    isPaused = false;
    speakBlock(idx);
  }

  

  function onDocumentClick(e) {
    if (!isExpanded) return;
    if (wrapper && wrapper.contains(e.target)) return;     
    var root = getContentRoot();
    if (root && root.contains(e.target)) {
      handleContentClick(e);                               
      return;
    }
    collapse();                                            
  }

  function onDocumentKeydown(e) {
    if (!isExpanded) return;
    if (e.key === "Escape" || e.key === "Esc") collapse();
  }

  function refreshPlayIcon() {
    if (!playBtn) return;
    var icon = playBtn.querySelector(".knotis-readaloud-play-icon");
    if (!icon) return;

    if (isPlaying && !isPaused) {
      icon.innerHTML = PAUSE_SVG;
      playBtn.setAttribute("aria-label", "Pause reading");
      playBtn.title = "Pause reading";
    } else {
      icon.innerHTML = PLAY_SVG;
      playBtn.setAttribute("aria-label", "Read page aloud");
      playBtn.title = "Read page aloud";
    }
  }

  

  function expand() {
    if (!wrapper || !panel) return;
    panel.hidden = false;
    panel.setAttribute("aria-hidden", "false");
    wrapper.classList.add(EXPANDED_CLASS);
    isExpanded = true;
    hpBtn.setAttribute("aria-expanded", "true");
    hpBtn.title = "Hide controls";
    if (contentBlocks.length === 0) contentBlocks = extractContentBlocks(getContentRoot());
    updateEmptyContentUI();
    refreshPlayIcon();
    
    document.body.classList.add("knotis-readaloud--armed");
    document.addEventListener("click", onDocumentClick, false);
    document.addEventListener("keydown", onDocumentKeydown, false);
  }

  function collapse() {
    if (!wrapper || !panel) return;
    wrapper.classList.remove(EXPANDED_CLASS);
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");
    isExpanded = false;
    hpBtn.setAttribute("aria-expanded", "false");
    hpBtn.title = "Read Aloud";
    document.body.classList.remove("knotis-readaloud--armed");
    document.removeEventListener("click", onDocumentClick, false);
    document.removeEventListener("keydown", onDocumentKeydown, false);
    cancelSpeech();
  }

  function toggleExpand() {
    if (isExpanded) collapse();
    else expand();
  }

  

  function setControlRefs(nextWrapper) {
    wrapper = nextWrapper;
    playBtn = wrapper.querySelector(".knotis-readaloud-play");
    rateSelect = wrapper.querySelector(".knotis-readaloud-rate");
    voiceSelect = wrapper.querySelector(".knotis-readaloud-voice");
    noVoicesEl = wrapper.querySelector(".knotis-readaloud-no-voices");
    hpBtn = wrapper.querySelector(".knotis-readaloud-hp");
    panel = wrapper.querySelector(".knotis-readaloud-panel");
    if (panel && !isExpanded) {
      panel.hidden = true;
      panel.setAttribute("aria-hidden", "true");
    }
  }

  function bindControls() {
    if (!wrapper || controlsBound) return;
    controlsBound = true;

    if (hpBtn) {
      hpBtn.addEventListener("click", function (e) {
        e.preventDefault(); e.stopPropagation();
        toggleExpand();
      });
    }

    if (playBtn) {
      playBtn.addEventListener("click", function (e) { e.stopPropagation(); togglePlayPause(); });
    }

    if (rateSelect) {
      rateSelect.value = String(loadRate());
      rateSelect.addEventListener("change", function (e) {
        e.stopPropagation();
        var rate = parseFloat(e.target.value);
        saveRate(rate);
        
        if (isPlaying && !isPaused && currentBlockIndex >= 0) speakBlock(currentBlockIndex);
      });
    }

    if (voiceSelect) {
      voiceSelect.addEventListener("change", function (e) {
        e.stopPropagation();
        saveVoiceValue(e.target.value);
        if (isPlaying) stopSpeaking();
      });
    }

    populateVoiceSelect();
    updateNoVoicesUI();
  }

  function buildWrapper() {
    if (wrapper) return wrapper;

    wrapper = document.createElement("span");
    wrapper.className = "knotis-readaloud-trigger";

    hpBtn = document.createElement("button");
    hpBtn.type = "button";
    hpBtn.className = "knotis-readaloud-hp";
    hpBtn.setAttribute("aria-label", "Read Aloud");
    hpBtn.setAttribute("aria-expanded", "false");
    hpBtn.title = "Read Aloud";
    hpBtn.innerHTML = HEADPHONES_SVG;

    panel = document.createElement("span");
    panel.className = "knotis-readaloud-panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Read aloud controls");
    panel.hidden = true;
    panel.setAttribute("aria-hidden", "true");

    panel.innerHTML =
      '<button type="button" class="knotis-readaloud-btn knotis-readaloud-play" aria-label="Read page aloud" title="Read page aloud"><span class="knotis-readaloud-play-icon">' + PLAY_SVG + '</span></button>' +
      '<div class="knotis-readaloud-setting">' +
        '<select id="knotis-readaloud-rate-select" class="knotis-readaloud-setting__select knotis-readaloud-rate" aria-label="Speed">' +
          RATE_OPTIONS.map(function (o) { return '<option value="' + o.value + '">' + o.label + '</option>'; }).join("") +
        '</select>' +
      '</div>' +
      '<div class="knotis-readaloud-setting">' +
        '<select id="knotis-readaloud-voice-select" class="knotis-readaloud-setting__select knotis-readaloud-voice" aria-label="Voice"></select>' +
      '</div>' +
      '<span class="knotis-readaloud-no-voices" hidden>' + NO_VOICES_MSG + '</span>';

    wrapper.appendChild(panel);
    wrapper.appendChild(hpBtn);
    setControlRefs(wrapper);
    bindControls();
    return wrapper;
  }

  

  function ensureTrigger() {
    if (!readaloudEnabled()) {
      setReadaloudVisible(false);
      return;
    }
    if (!wrapper || !document.body.contains(wrapper)) {
      var existing = document.querySelector(".knotis-readaloud-trigger");
      if (existing) {
        controlsBound = false;
        setControlRefs(existing);
        bindControls();
      } else {
        buildWrapper();
      }
    }
    var nav = getHeaderNav();
    if (!nav) return;
    var palette = nav.querySelector(".md-header__option");
    if (palette) {
      if (wrapper.parentElement !== nav || wrapper.nextElementSibling !== palette) nav.insertBefore(wrapper, palette);
    } else {
      var source = nav.querySelector(".md-header__source");
      if (source) {
        if (wrapper.parentElement !== nav || wrapper.nextElementSibling !== source) nav.insertBefore(wrapper, source);
      } else if (wrapper.parentElement !== nav) nav.appendChild(wrapper);
    }
    setReadaloudVisible(true);
    return wrapper;
  }

  function init() {
    loadVoices();
    loadReadaloudConfig().then(function () {
      ensureTrigger();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  var _lastPageUrl = location.pathname + location.search + location.hash;

  function onPageSwap() {
    var url = location.pathname + location.search + location.hash;
    if (url === _lastPageUrl) return;
    _lastPageUrl = url;
    contentBlocks = [];
    if (isExpanded) collapse();
    else cancelSpeech();
    loadReadaloudConfig().then(function () {
      ensureTrigger();
    });
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    var _first = true;
    window.document$.subscribe(function () {
      if (_first) { _first = false; return; }
      onPageSwap();
    });
  }

  window.addEventListener("pagehide", cancelSpeech);
  window.addEventListener("beforeunload", cancelSpeech);
})();
