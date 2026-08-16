(function () {
  "use strict";

  var SCRIPT_BASE = (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("knotis-media.js") !== -1) {
        try {
          return new URL(".", src).href;
        } catch (e) {
          return "";
        }
      }
    }
    return "";
  })();

  var GIFUCT_URL = SCRIPT_BASE ? new URL("vendor/gifuct-js.min.js", SCRIPT_BASE).href : "vendor/gifuct-js.min.js";

  var PLAY_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>';
  var PAUSE_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>';
  var MENU_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="19" r="2" fill="currentColor"/></svg>';
  var FULLSCREEN_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
  var DOWNLOAD_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z"/></svg>';
  var CC_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>';
  var SPEED_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M10 8v8l6-4-6-4zm2-6C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/></svg>';
  var PIP_SVG =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';

  var gifuctPromise = null;
  var upgradeToken = 0;

  
  
  
  
  var MAX_BLOB_SEEK_BYTES = 512 * 1024 * 1024;
  var PLAYBACK_RATES = [1, 1.5, 2, 0.5];
  var rangeSupportByOrigin = Object.create(null);
  var blobRegistry = [];
  
  
  var blobUrlBySource = Object.create(null);
  
  
  
  
  
  
  
  var gifDecodeCache = Object.create(null);

  function loadGifuct() {
    if (window.GifuctJS) return Promise.resolve(window.GifuctJS);
    if (gifuctPromise) return gifuctPromise;
    gifuctPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = GIFUCT_URL;
      script.async = true;
      script.onload = function () {
        if (window.GifuctJS) resolve(window.GifuctJS);
        else reject(new Error("GifuctJS missing after load"));
      };
      script.onerror = function () {
        reject(new Error("Failed to load gifuct-js"));
      };
      document.head.appendChild(script);
    });
    return gifuctPromise;
  }

  function contentRoots() {
    var roots = [];
    var pageRoot =
      document.querySelector(".md-content__inner") ||
      document.querySelector("article.md-typeset") ||
      document.querySelector("article") ||
      document.querySelector(".md-content") ||
      document.querySelector("main");
    if (pageRoot) roots.push(pageRoot);
    document.querySelectorAll(".wikilink-pane, .knotis-slides").forEach(function (dynamicRoot) {
      roots.push(dynamicRoot);
    });
    if (!roots.length && document.body) roots.push(document.body);
    return roots.filter(function (root, index) {
      return roots.indexOf(root) === index;
    });
  }

  function isOptOut(node) {
    if (!node) return false;
    if (node.classList && node.classList.contains("no-media-controls")) return true;
  }

  function isUpgraded(node) {
    return node && node.getAttribute("data-knotis-media-upgraded") === "true";
  }

  function markUpgraded(node) {
    if (node) node.setAttribute("data-knotis-media-upgraded", "true");
  }

  function markPending(node) {
    if (node) node.setAttribute("data-knotis-media-pending", "true");
  }

  function clearPending(node) {
    if (node) node.removeAttribute("data-knotis-media-pending");
  }

  function mediaExtension(url) {
    var clean = String(url || "").split("#")[0].split("?")[0].toLowerCase();
    var match = clean.match(/\.([a-z0-9]+)$/);
    return match ? match[1] : "";
  }

  function swapExtension(url, ext) {
    return String(url || "").replace(/\.[a-z0-9]+(?=($|[?#]))/i, "." + ext);
  }

  function withPreviewFragment(url) {
    var value = String(url || "");
    if (!value || value.indexOf("#") >= 0) return value;
    return value + "#t=0.001";
  }

  function formatTime(ms) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return minutes + ":" + String(seconds).padStart(2, "0");
  }

  function resourceExists(url) {
    if (!url) return Promise.resolve(false);
    return fetch(url, { method: "HEAD", cache: "no-store" })
      .then(function (resp) {
        if (!resp.ok) return false;
        
        
        
        
        var type = (resp.headers && resp.headers.get && resp.headers.get("content-type")) || "";
        return type.indexOf("text/html") === -1;
      })
      .catch(function () {
        return false;
      });
  }

  function originOf(url) {
    try {
      return new URL(url, document.baseURI).origin;
    } catch (e) {
      return "";
    }
  }

  function remoteVideoIframeProvider(src) {
    var url;
    try {
      url = new URL(src || "", document.baseURI);
    } catch (e) {
      return "";
    }
    var host = url.hostname.toLowerCase();
    var path = url.pathname || "";
    if ((host === "youtube.com" || host === "www.youtube.com" || host === "www.youtube-nocookie.com") && path.indexOf("/embed/") === 0) {
      return "youtube";
    }
    if (host === "drive.google.com" && /^\/file\/d\/[^/]+\/(?:preview|view)\/?$/.test(path)) {
      return "drive";
    }
    return "";
  }

  function mergeTokenList(current, additions) {
    var seen = Object.create(null);
    var values = [];
    String(current || "").split(";").concat(additions || []).forEach(function (part) {
      var token = String(part || "").trim();
      if (!token || seen[token]) return;
      seen[token] = true;
      values.push(token);
    });
    return values.join("; ");
  }

  function normalizeRemoteIframeSrc(src, provider) {
    var url;
    try {
      url = new URL(src || "", document.baseURI);
    } catch (e) {
      return src || "";
    }
    if (provider === "youtube") {
      if (!/^https?:$/.test(location.protocol) && /(?:^|\.)youtube\.com$/i.test(url.hostname)) {
        url.hostname = "www.youtube-nocookie.com";
      }
      url.searchParams.delete("origin");
      url.searchParams.delete("autoplay");
    } else if (provider === "drive") {
      url.pathname = url.pathname.replace(/\/view\/?$/, "/preview");
    }
    return url.href;
  }

  function remoteVideoIdFromSrc(src, provider) {
    var url;
    try {
      url = new URL(src || "", document.baseURI);
    } catch (e) {
      return "";
    }
    var match =
      provider === "youtube"
        ? url.pathname.match(/^\/embed\/([^/?#]+)/)
        : url.pathname.match(/^\/file\/d\/([^/?#]+)/);
    return match ? match[1] : "";
  }

  
  
  
  
  
  
  function buildRemoteEmbedFallback(iframe, provider) {
    var src = iframe.getAttribute("src") || "";
    var id = remoteVideoIdFromSrc(src, provider);
    var isYoutube = provider === "youtube";
    var link = document.createElement("a");
    link.className = "knotis-media-embed-fallback no-lightbox";
    link.href = id
      ? isYoutube
        ? "https://www.youtube.com/watch?v=" + id
        : "https://drive.google.com/file/d/" + id + "/view"
      : src;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    var label = isYoutube ? "Watch on YouTube" : "Open in Google Drive";
    link.setAttribute("aria-label", label);
    if (id) {
      var thumb = document.createElement("img");
      thumb.className = "knotis-media-embed-fallback__thumb";
      thumb.alt = "";
      thumb.src = isYoutube
        ? "https://img.youtube.com/vi/" + id + "/hqdefault.jpg"
        : "https://drive.google.com/thumbnail?id=" + id + "&sz=w1280";
      thumb.addEventListener("error", function () {
        
        
        thumb.remove();
      });
      link.appendChild(thumb);
    }
    var badge = document.createElement("span");
    badge.className = "knotis-media-embed-fallback__badge";
    badge.innerHTML = PLAY_SVG;
    link.appendChild(badge);
    var labelEl = document.createElement("span");
    labelEl.className = "knotis-media-embed-fallback__label";
    labelEl.textContent = label;
    link.appendChild(labelEl);
    markUpgraded(link);
    replaceNode(iframe, link);
  }

  function upgradeRemoteIframe(iframe) {
    if (isOptOut(iframe) || isUpgraded(iframe)) return;
    var provider = remoteVideoIframeProvider(iframe.getAttribute("src") || "");
    if (!provider) return;
    if (!/^https?:$/.test(location.protocol)) {
      buildRemoteEmbedFallback(iframe, provider);
      return;
    }
    iframe.src = normalizeRemoteIframeSrc(iframe.getAttribute("src") || "", provider);
    iframe.classList.add("no-lightbox");
    iframe.setAttribute("allowfullscreen", "");
    iframe.allowFullscreen = true;
    iframe.setAttribute("referrerpolicy", iframe.getAttribute("referrerpolicy") || "strict-origin-when-cross-origin");
    if (provider === "youtube") {
      iframe.setAttribute(
        "allow",
        mergeTokenList(iframe.getAttribute("allow"), [
          "accelerometer",
          "autoplay",
          "clipboard-write",
          "encrypted-media",
          "gyroscope",
          "picture-in-picture",
          "web-share",
        ]),
      );
    } else if (provider === "drive") {
      iframe.setAttribute("allow", mergeTokenList(iframe.getAttribute("allow"), ["autoplay", "fullscreen"]));
    }
    markUpgraded(iframe);
  }

  function detectRangeSupport(url) {
    var origin = originOf(url);
    if (rangeSupportByOrigin[origin]) return rangeSupportByOrigin[origin];
    rangeSupportByOrigin[origin] = fetch(url, {
      headers: { Range: "bytes=0-1" },
      cache: "no-store",
    })
      .then(function (resp) {
        
        
        try {
          if (resp.body && resp.body.cancel) resp.body.cancel();
        } catch (e) {
          
        }
        return resp.status === 206;
      })
      .catch(function () {
        
        
        return true;
      });
    return rangeSupportByOrigin[origin];
  }

  function contentLengthOf(url) {
    return fetch(url, { method: "HEAD", cache: "no-store" })
      .then(function (resp) {
        if (!resp.ok || !resp.headers || !resp.headers.get) return null;
        var size = Number.parseInt(resp.headers.get("content-length") || "", 10);
        return Number.isFinite(size) && size >= 0 ? size : null;
      })
      .catch(function () {
        return null;
      });
  }

  function registerBlobUrl(video, url, source) {
    blobRegistry.push({ video: video, url: url, source: source || "" });
  }

  function releaseStaleBlobUrls() {
    
    
    var keep = [];
    var liveUrls = Object.create(null);
    blobRegistry.forEach(function (entry) {
      if (entry.video && entry.video.isConnected) {
        keep.push(entry);
        liveUrls[entry.url] = true;
      }
    });
    var revoked = Object.create(null);
    blobRegistry.forEach(function (entry) {
      if (liveUrls[entry.url] || revoked[entry.url]) return;
      revoked[entry.url] = true;
      try {
        URL.revokeObjectURL(entry.url);
      } catch (e) {
        
      }
      if (entry.source && blobUrlBySource[entry.source] === entry.url) {
        delete blobUrlBySource[entry.source];
      }
    });
    blobRegistry = keep;
  }

  function swapVideoSrcPreservingState(video, newSrc) {
    var time = video.currentTime || 0;
    var wasPlaying = !video.paused && !video.ended;
    
    var rate = video.playbackRate;
    video.src = newSrc;
    if (rate && rate !== 1) video.playbackRate = rate;
    if (time > 0 || wasPlaying) {
      video.addEventListener(
        "loadedmetadata",
        function () {
          if (time > 0) video.currentTime = time;
          if (wasPlaying && typeof video.play === "function") {
            var resumed = video.play();
            if (resumed && resumed.catch) resumed.catch(function () {});
          }
        },
        { once: true },
      );
    }
  }

  function ensureSeekableSource(video, mp4Url) {
    
    
    
    var existingSrc = String(video.currentSrc || video.src || "");
    if (existingSrc.indexOf("blob:") === 0) {
      
      
      registerBlobUrl(video, existingSrc.split("#")[0], mp4Url);
      return Promise.resolve();
    }
    return detectRangeSupport(mp4Url)
      .then(function (supported) {
        if (supported) return;
        var cached = blobUrlBySource[mp4Url];
        if (cached) {
          registerBlobUrl(video, cached, mp4Url);
          swapVideoSrcPreservingState(video, withPreviewFragment(cached));
          return;
        }
        return contentLengthOf(mp4Url).then(function (size) {
          if (size === null || size > MAX_BLOB_SEEK_BYTES) return;
          return fetch(mp4Url, { cache: "default" })
            .then(function (resp) {
              if (!resp.ok) throw new Error("HTTP " + resp.status);
              return resp.blob();
            })
            .then(function (blob) {
              if (!video.isConnected) return;
              var blobUrl = blobUrlBySource[mp4Url];
              if (!blobUrl) {
                blobUrl = URL.createObjectURL(blob);
                blobUrlBySource[mp4Url] = blobUrl;
              }
              registerBlobUrl(video, blobUrl, mp4Url);
              swapVideoSrcPreservingState(video, withPreviewFragment(blobUrl));
            });
        });
      })
      .catch(function (err) {
        console.error("[knotis-media] blob seek fallback failed:", err);
      });
  }

  function wrapFigure(element, captionText) {
    if (element.closest && element.closest("figure.knotis-media")) {
      var existing = element.closest("figure.knotis-media");
      if (captionText && !existing.querySelector("figcaption")) {
        var existingCaption = document.createElement("figcaption");
        existingCaption.className = "knotis-media__caption";
        existingCaption.textContent = captionText;
        existing.appendChild(existingCaption);
      }
      return existing;
    }
    if (!element.parentNode) {
      var detached = document.createElement("figure");
      detached.className = "knotis-media";
      detached.appendChild(element);
      if (captionText) {
        var detachedCaption = document.createElement("figcaption");
        detachedCaption.className = "knotis-media__caption";
        detachedCaption.textContent = captionText;
        detached.appendChild(detachedCaption);
      }
      return detached;
    }
    var figure = document.createElement("figure");
    figure.className = "knotis-media";
    var parent = element.parentNode;
    parent.insertBefore(figure, element);
    figure.appendChild(element);
    if (captionText) {
      var caption = document.createElement("figcaption");
      caption.className = "knotis-media__caption";
      caption.textContent = captionText;
      figure.appendChild(caption);
    }
    return figure;
  }

  function captionFromImage(img) {
    return (img.getAttribute("alt") || img.getAttribute("title") || "").trim();
  }

  function cssLength(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    if (/^\d+(?:\.\d+)?$/.test(raw)) return raw + "px";
    if (/^\d+(?:\.\d+)?(?:px|rem|em|vw|vh|vmin|vmax|%)$/i.test(raw)) return raw;
    return "";
  }

  function applyMediaSizeFromSource(figure, source) {
    if (!figure || !source) return;
    var width = cssLength(source.style && source.style.width) || cssLength(source.getAttribute("width"));
    if (!width) return;
    figure.style.width = width;
    figure.style.maxWidth = "100%";
    figure.classList.add("knotis-media--sized");
  }

  function applyVideoAttrs(video, options) {
    video.controls = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.preload = "metadata";
    video.classList.add("knotis-media__element", "no-lightbox");
    if (options && options.loop) video.loop = true;
    if (options && options.width) video.setAttribute("width", String(options.width));
    if (options && options.title) video.setAttribute("title", options.title);
  }

  function setVideoSource(video, url) {
    var previewUrl = withPreviewFragment(url);
    video.removeAttribute("poster");
    while (video.firstChild) video.removeChild(video.firstChild);
    video.src = previewUrl;
  }

  function captionCandidates(sourceUrl) {
    var base = String(sourceUrl || "").split("#")[0].split("?")[0];
    
    
    var langMatch = base.match(/^(.*)\.([a-z]{2})\.[a-z0-9]+$/i);
    if (langMatch) {
      return [
        { url: langMatch[1] + "." + langMatch[2] + ".vtt", lang: langMatch[2].toLowerCase(), label: langMatch[2].toUpperCase() },
        { url: langMatch[1] + ".vtt", lang: "en", label: "English" },
      ];
    }
    return [{ url: swapExtension(base, "vtt"), lang: "en", label: "English" }];
  }

  
  
  
  function clampCueList(cues) {
    var sorted = cues.slice().sort(function (a, b) {
      return a.startTime - b.startTime;
    });
    for (var i = 0; i < sorted.length - 1; i++) {
      var limit = sorted[i + 1].startTime;
      
      
      if (sorted[i].endTime > limit && limit > sorted[i].startTime) {
        sorted[i].endTime = limit;
      }
    }
    return sorted;
  }

  function clampTrackCues(textTrack) {
    var cues = textTrack && textTrack.cues;
    if (!cues || !cues.length) return;
    var list = [];
    for (var i = 0; i < cues.length; i++) list.push(cues[i]);
    clampCueList(list);
  }

  
  
  function clampTrackWhenLoaded(trackEl) {
    var textTrack = trackEl.track;
    if (textTrack && textTrack.cues && textTrack.cues.length) {
      clampTrackCues(textTrack);
      return;
    }
    trackEl.addEventListener("load", function () {
      clampTrackCues(trackEl.track);
    });
  }

  
  
  function parseVttTimestamp(str) {
    var parts = String(str || "").trim().split(":").map(Number);
    if (!parts.length || parts.some(function (n) { return Number.isNaN(n); })) return 0;
    var seconds = 0;
    for (var i = 0; i < parts.length; i++) seconds = seconds * 60 + parts[i];
    return seconds;
  }

  function parseVttCues(text) {
    var lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    var cues = [];
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (line.indexOf("-->") !== -1) {
        var parts = line.split("-->");
        var start = parseVttTimestamp(parts[0]);
        
        var end = parseVttTimestamp((parts[1] || "").trim().split(/\s+/)[0]);
        i++;
        var textLines = [];
        while (i < lines.length && lines[i].trim() !== "") {
          textLines.push(lines[i]);
          i++;
        }
        if (end > start) cues.push({ startTime: start, endTime: end, text: textLines.join("\n") });
      }
      i++;
    }
    return cues;
  }

  function activeCueText(cues, timeSeconds) {
    if (!cues) return "";
    for (var i = 0; i < cues.length; i++) {
      if (timeSeconds >= cues[i].startTime && timeSeconds < cues[i].endTime) return cues[i].text;
    }
    return "";
  }

  function loadGifCaptions(gifUrl) {
    var candidates = captionCandidates(gifUrl);
    var chain = Promise.resolve(null);
    candidates.forEach(function (candidate) {
      chain = chain.then(function (found) {
        if (found) return found;
        return resourceExists(candidate.url).then(function (exists) {
          if (!exists) return null;
          return fetch(candidate.url, { cache: "no-store" })
            .then(function (resp) {
              if (!resp.ok) throw new Error("HTTP " + resp.status);
              return resp.text();
            })
            .then(function (text) {
              var cues = clampCueList(parseVttCues(text));
              return cues.length ? cues : null;
            })
            .catch(function () {
              return null;
            });
        });
      });
    });
    return chain;
  }

  function attachCaptions(video, mp4Url) {
    var candidates = captionCandidates(mp4Url);
  var chain = Promise.resolve();
    candidates.forEach(function (candidate, index) {
      chain = chain.then(function () {
        return resourceExists(candidate.url).then(function (exists) {
          if (!exists) return;
          var track = document.createElement("track");
          track.kind = "captions";
          track.src = candidate.url;
          track.srclang = candidate.lang;
          track.label = candidate.label;
          if (index === 0) track.default = true;
          track.addEventListener("load", function () {
            clampTrackCues(track.track);
            if (index !== 0 && track.track) track.track.mode = "disabled";
          });
          video.appendChild(track);
          
          
          
          
          if (index !== 0 && track.track) track.track.mode = "hidden";
        });
      });
    });
    return chain;
  }

  function replaceNode(oldNode, newNode) {
    var parent = oldNode.parentNode;
    if (!parent) return newNode;
    parent.insertBefore(newNode, oldNode);
    parent.removeChild(oldNode);
    return newNode;
  }

  
  
  
  
  function soloWrapperTarget(node) {
    var target = node;
    while (target.parentElement) {
      var parent = target.parentElement;
      var tag = parent.tagName;
      if (tag !== "P" && tag !== "A") break;
      var solo = Array.prototype.every.call(parent.childNodes, function (child) {
        if (child === target) return true;
        return child.nodeType === 3 && !child.textContent.trim();
      });
      if (!solo) break;
      target = parent;
    }
    return target;
  }

  function formatPlaybackRate(rate) {
    return String(rate) + "×";
  }

  
  
  function createRateButton(video) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "knotis-media__rate no-lightbox";
    button.setAttribute("aria-label", "Playback speed");
    button.title = "Playback speed";
    var index = 0;
    button.textContent = formatPlaybackRate(PLAYBACK_RATES[index]);
    button.addEventListener("click", function () {
      index = (index + 1) % PLAYBACK_RATES.length;
      video.playbackRate = PLAYBACK_RATES[index];
      button.textContent = formatPlaybackRate(PLAYBACK_RATES[index]);
    });
    return button;
  }

  function addRateButton(figure, video, replaceExisting) {
    if (!figure) return;
    if (replaceExisting) {
      figure.querySelectorAll(".knotis-media__rate").forEach(function (button) {
        button.remove();
      });
    } else if (figure.querySelector(".knotis-media__rate")) {
      return;
    }
    figure.appendChild(createRateButton(video));
    video.__knotisMediaRateLive = true;
  }

  function refreshClonedVideo(video) {
    var figure = video.closest("figure.knotis-media") || wrapFigure(video, "");
    applyVideoAttrs(video, {
      loop: video.loop,
      width: video.getAttribute("width"),
      title: video.getAttribute("title"),
    });
    if (!video.__knotisMediaRateLive) addRateButton(figure, video, true);
    if (video.__knotisMediaLive) return Promise.resolve();
    video.__knotisMediaLive = true;
    
    
    
    
    video.querySelectorAll("track").forEach(function (trackEl) {
      clampTrackWhenLoaded(trackEl);
    });
    var source = video.getAttribute("data-knotis-media-src") || "";
    if (!source) return Promise.resolve();
    var jobs = [];
    if (!video.querySelector("track")) jobs.push(attachCaptions(video, source));
    jobs.push(ensureSeekableSource(video, source));
    return Promise.all(jobs);
  }

  
  
  function createGifMenuItem(iconSvg, labelText, subText) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "knotis-gif-player__menu-item";
    var icon = document.createElement("span");
    icon.className = "knotis-gif-player__menu-icon";
    icon.innerHTML = iconSvg;
    var labels = document.createElement("span");
    labels.className = "knotis-gif-player__menu-labels";
    var label = document.createElement("span");
    label.textContent = labelText;
    labels.appendChild(label);
    var sub = null;
    if (subText !== undefined) {
      sub = document.createElement("span");
      sub.className = "knotis-gif-player__menu-sub";
      sub.textContent = subText;
      labels.appendChild(sub);
    }
    button.appendChild(icon);
    button.appendChild(labels);
    return { button: button, sub: sub };
  }

  function createMediaMenuToggle(owner, menuBtn, menu) {
    function onDocumentClick(event) {
      if (!owner.contains(event.target)) closeMenu();
    }
    function openMenu() {
      menu.hidden = false;
      menuBtn.setAttribute("aria-expanded", "true");
      setTimeout(function () {
        document.addEventListener("click", onDocumentClick, true);
      }, 0);
    }
    function closeMenu() {
      menu.hidden = true;
      menuBtn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocumentClick, true);
    }
    menuBtn.addEventListener("click", function () {
      if (menu.hidden) openMenu();
      else closeMenu();
    });
    return { open: openMenu, close: closeMenu };
  }

  function downloadMedia(url, fallbackName) {
    var link = document.createElement("a");
    link.href = url;
    link.download = String(url || "").split("#")[0].split("?")[0].split("/").pop() || fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function upgradeVideoElement(video) {
    if (isOptOut(video) || isUpgraded(video)) return Promise.resolve();
    var src =
      video.currentSrc ||
      video.getAttribute("src") ||
      (video.querySelector("source") && video.querySelector("source").getAttribute("src")) ||
      "";
    if (!src || mediaExtension(src) !== "mp4") return Promise.resolve();

    var caption = "";
    var figcaption = video.closest("figure") && video.closest("figure").querySelector("figcaption");
    if (figcaption) caption = figcaption.textContent.trim();

    applyVideoAttrs(video, {
      loop: video.loop,
      width: video.getAttribute("width"),
      title: video.getAttribute("title"),
    });
    var base = src.split("#")[0];
    setVideoSource(video, base);
    markUpgraded(video);
    
    
    video.setAttribute("data-knotis-media-src", base);
    video.__knotisMediaLive = true;
    var figure = wrapFigure(video, caption);
    applyMediaSizeFromSource(figure, video);
    var hoist = soloWrapperTarget(figure);
    if (hoist !== figure) replaceNode(hoist, figure);
    addRateButton(figure, video);
    return Promise.all([attachCaptions(video, base), ensureSeekableSource(video, base)]);
  }

  function createVideoFromImage(img, mp4Url) {
    var video = document.createElement("video");
    applyVideoAttrs(video, {
      width: img.getAttribute("width"),
      title: img.getAttribute("title"),
    });
    setVideoSource(video, mp4Url);
    markUpgraded(video);
    video.setAttribute("data-knotis-media-src", mp4Url);
    video.__knotisMediaLive = true;

    var figure = document.createElement("figure");
    figure.className = "knotis-media";
    applyMediaSizeFromSource(figure, img);
    figure.appendChild(video);
    var caption = captionFromImage(img);
    if (caption) {
      var captionEl = document.createElement("figcaption");
      captionEl.className = "knotis-media__caption";
      captionEl.textContent = caption;
      figure.appendChild(captionEl);
    }
    addRateButton(figure, video);
    replaceNode(soloWrapperTarget(img), figure);
    return Promise.all([attachCaptions(video, mp4Url), ensureSeekableSource(video, mp4Url)]);
  }

  function upgradeMp4Image(img) {
    if (isOptOut(img) || isUpgraded(img)) return Promise.resolve();
    var src = img.currentSrc || img.getAttribute("src") || "";
    if (mediaExtension(src) !== "mp4") return Promise.resolve();
    return createVideoFromImage(img, src.split("#")[0]);
  }

  
  
  
  
  
  var gifPatchCanvas = null;
  var gifPatchCtx = null;

  function putGifPatch(ctx, frame) {
    if (!frame || !frame.patch) return;
    if (!gifPatchCanvas) {
      gifPatchCanvas = document.createElement("canvas");
      gifPatchCtx = gifPatchCanvas.getContext("2d");
    }
    if (gifPatchCanvas.width < frame.dims.width) gifPatchCanvas.width = frame.dims.width;
    if (gifPatchCanvas.height < frame.dims.height) gifPatchCanvas.height = frame.dims.height;
    var imageData = new ImageData(
      new Uint8ClampedArray(frame.patch),
      frame.dims.width,
      frame.dims.height,
    );
    gifPatchCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(
      gifPatchCanvas,
      0,
      0,
      frame.dims.width,
      frame.dims.height,
      frame.dims.left,
      frame.dims.top,
      frame.dims.width,
      frame.dims.height,
    );
  }

  
  
  
  function applyGifDisposal(ctx, prevFrame, savedFrame) {
    if (!prevFrame) return;
    if (prevFrame.disposalType === 2) {
      ctx.clearRect(prevFrame.dims.left, prevFrame.dims.top, prevFrame.dims.width, prevFrame.dims.height);
    } else if (prevFrame.disposalType === 3 && savedFrame) {
      ctx.putImageData(savedFrame, 0, 0);
    }
  }

  function renderGifComposite(ctx, canvas, frames, targetIndex) {
    var width = canvas.width;
    var height = canvas.height;
    var saved = null;
    ctx.clearRect(0, 0, width, height);
    for (var i = 0; i <= targetIndex; i++) {
      var frame = frames[i];
      applyGifDisposal(ctx, i > 0 ? frames[i - 1] : null, saved);
      if (frame.disposalType === 3) {
        saved = ctx.getImageData(0, 0, width, height);
      }
      putGifPatch(ctx, frame);
    }
  }

  function attachGifKeyboardControls(container, api) {
    container.addEventListener("keydown", function (event) {
      
      
      
      if (event.target !== container) return;
      var key = event.key;
      if (key === " " || key === "Spacebar" || key === "Enter") {
        api.togglePlay();
      } else if (key === "ArrowRight") {
        api.stepFrame(1);
      } else if (key === "ArrowLeft") {
        api.stepFrame(-1);
      } else if (key === "Home") {
        api.goToStart();
      } else {
        return;
      }
      event.preventDefault();
    });
  }

  
  function loadGifFrames(gifUrl) {
    if (gifDecodeCache[gifUrl]) return gifDecodeCache[gifUrl];
    var decoded = loadGifuct().then(function (GifuctJS) {
      return fetch(gifUrl, { cache: "default" })
        .then(function (resp) {
          if (!resp.ok) throw new Error("HTTP " + resp.status);
          return resp.arrayBuffer();
        })
        .then(function (buffer) {
          var parsed = GifuctJS.parseGIF(buffer);
          var frames = GifuctJS.decompressFrames(parsed, true);
          if (!frames.length) throw new Error("GIF has no frames");
          return { frames: frames, dims: parsed.lsd };
        });
    });
    gifDecodeCache[gifUrl] = decoded;
    decoded.catch(function () {
      
      if (gifDecodeCache[gifUrl] === decoded) delete gifDecodeCache[gifUrl];
    });
    return decoded;
  }

  function buildGifPlayer(img, gifUrl) {
    
    
    
    
    
    var altText = captionFromImage(img);

    var wrapper = document.createElement("div");
    wrapper.className = "knotis-gif-player knotis-media__element no-lightbox";
    wrapper.setAttribute("data-knotis-gif-src", gifUrl);
    wrapper.setAttribute("data-knotis-gif-alt", altText);

    var canvas = document.createElement("canvas");
    canvas.className = "knotis-gif-player__canvas";
    canvas.setAttribute("role", "img");
    
    
    if (altText) canvas.setAttribute("aria-label", altText);

    
    
    
    var stage = document.createElement("div");
    stage.className = "knotis-gif-player__stage";

    var captionEl = document.createElement("div");
    captionEl.className = "knotis-gif-player__captions";

    
    
    
    var controls = document.createElement("div");
    controls.className = "knotis-gif-player__controls";

    var row = document.createElement("div");
    row.className = "knotis-gif-player__row";

    var playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "knotis-gif-player__play";
    playBtn.setAttribute("aria-label", "Play");
    playBtn.innerHTML = PLAY_SVG;

    var timeline = document.createElement("input");
    timeline.type = "range";
    timeline.className = "knotis-gif-player__timeline";
    timeline.min = "0";
    timeline.max = "0";
    timeline.step = "1";
    timeline.value = "0";
    timeline.disabled = true;
    timeline.setAttribute("aria-label", "Seek");

    var timeEl = document.createElement("span");
    timeEl.className = "knotis-gif-player__time";

    var spacer = document.createElement("div");
    spacer.className = "knotis-gif-player__spacer";

    var fsBtn = null;
    if (typeof wrapper.requestFullscreen === "function") {
      fsBtn = document.createElement("button");
      fsBtn.type = "button";
      fsBtn.className = "knotis-gif-player__fullscreen";
      fsBtn.setAttribute("aria-label", "Full screen");
      fsBtn.innerHTML = FULLSCREEN_SVG;
      fsBtn.addEventListener("click", function () {
        if (document.fullscreenElement === wrapper) {
          var exited = document.exitFullscreen();
          if (exited && exited.catch) exited.catch(function () {});
        } else {
          var entered = wrapper.requestFullscreen();
          if (entered && entered.catch) entered.catch(function () {});
        }
      });
    }

    row.appendChild(playBtn);
    row.appendChild(timeEl);
    row.appendChild(spacer);
    if (fsBtn) row.appendChild(fsBtn);
    controls.appendChild(row);
    controls.appendChild(timeline);
    stage.appendChild(canvas);
    stage.appendChild(captionEl);
    wrapper.appendChild(stage);
    wrapper.appendChild(controls);

    var ctx = canvas.getContext("2d");
    var frames = null;
    var delays = null;
    var totalMs = 0;
    var state = {
      frames: null,
      dims: null,
      currentIndex: 0,
      playing: false,
      timer: null,
      scrubbing: false,
      savedFrame: null,
      cues: null,
      captionsEnabled: true,
      rate: 1,
    };

    function paintSnapshot() {
      
      
      
      if (frames || !ctx || !img.complete || !img.naturalWidth) return;
      try {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
      } catch (e) {
        
      }
    }

    function frameStartMs(index) {
      if (!delays) return 0;
      var ms = 0;
      for (var i = 0; i < index; i++) ms += delays[i];
      return ms;
    }

    function updateTimeLabel(index) {
      if (!delays) return;
      timeEl.textContent = formatTime(frameStartMs(index)) + " / " + formatTime(totalMs);
    }

    function updateCaption(index) {
      
      
      
      captionEl.textContent =
        state.cues && state.captionsEnabled ? activeCueText(state.cues, frameStartMs(index) / 1000) : "";
    }

    
    
    
    var menuBtn = document.createElement("button");
    menuBtn.type = "button";
    menuBtn.className = "knotis-gif-player__menu-btn";
    menuBtn.setAttribute("aria-label", "More options");
    menuBtn.setAttribute("aria-haspopup", "true");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.innerHTML = MENU_SVG;

    var menu = document.createElement("div");
    menu.className = "knotis-gif-player__menu";
    menu.hidden = true;
    var toggle = createMediaMenuToggle(wrapper, menuBtn, menu);

    var downloadItem = createGifMenuItem(DOWNLOAD_SVG, "Download");
    downloadItem.button.addEventListener("click", function () {
      downloadMedia(gifUrl, "animation.gif");
      toggle.close();
    });

    var captionsItem = createGifMenuItem(CC_SVG, "Captions", "English");
    captionsItem.button.setAttribute("role", "menuitemcheckbox");
    function setCaptionsEnabled(enabled) {
      state.captionsEnabled = enabled;
      captionsItem.button.setAttribute("aria-checked", String(enabled));
      if (captionsItem.sub) captionsItem.sub.textContent = enabled ? "English" : "Off";
      updateCaption(state.currentIndex);
    }
    setCaptionsEnabled(state.captionsEnabled);
    captionsItem.button.addEventListener("click", function () {
      setCaptionsEnabled(!state.captionsEnabled);
      toggle.close();
    });

    
    
    
    var speedItem = createGifMenuItem(SPEED_SVG, "Playback speed", formatPlaybackRate(state.rate));
    var rateBtn = document.createElement("button");
    rateBtn.type = "button";
    rateBtn.className = "knotis-media__rate no-lightbox";
    rateBtn.setAttribute("aria-label", "Playback speed");
    rateBtn.title = "Playback speed";
    rateBtn.textContent = formatPlaybackRate(state.rate);
    var rateIndex = 0;
    function cycleRate() {
      rateIndex = (rateIndex + 1) % PLAYBACK_RATES.length;
      state.rate = PLAYBACK_RATES[rateIndex];
      rateBtn.textContent = formatPlaybackRate(state.rate);
      if (speedItem.sub) speedItem.sub.textContent = formatPlaybackRate(state.rate);
    }
    rateBtn.addEventListener("click", cycleRate);
    
    
    speedItem.button.addEventListener("click", cycleRate);

    var pipItem = null;
    if (document.pictureInPictureEnabled && typeof canvas.captureStream === "function") {
      pipItem = createGifMenuItem(PIP_SVG, "Picture in Picture");
      var pipVideo = null;
      pipItem.button.addEventListener("click", function () {
        
        if (!pipVideo) {
          pipVideo = document.createElement("video");
          pipVideo.muted = true;
          pipVideo.setAttribute("playsinline", "");
          pipVideo.className = "knotis-gif-player__pip-source";
          pipVideo.srcObject = canvas.captureStream();
          wrapper.appendChild(pipVideo);
        }
        var request = function () {
          var opened = pipVideo.requestPictureInPicture();
          if (opened && opened.catch) opened.catch(function () {});
        };
        var started = pipVideo.play();
        if (started && started.then) started.then(request).catch(function () {});
        else request();
        toggle.close();
      });
    }

    menu.appendChild(downloadItem.button);
    menu.appendChild(captionsItem.button);
    menu.appendChild(speedItem.button);
    if (pipItem) menu.appendChild(pipItem.button);
    row.appendChild(menuBtn);
    controls.appendChild(menu);

    function setPlayState(playing) {
      state.playing = playing;
      playBtn.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      
      
      wrapper.classList.toggle("knotis-gif-player--playing", playing);
    }

    function stopTimer() {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }

    function showFrame(index, replay) {
      if (!frames) return;
      index = Math.max(0, Math.min(frames.length - 1, index));
      if (replay) {
        renderGifComposite(ctx, canvas, frames, index);
      } else {
        var frame = frames[index];
        applyGifDisposal(ctx, index > 0 ? frames[index - 1] : null, state.savedFrame);
        if (frame.disposalType === 3) {
          state.savedFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
        putGifPatch(ctx, frame);
      }
      state.currentIndex = index;
      timeline.value = String(index);
      updateTimeLabel(index);
      updateCaption(index);
    }

    function scheduleNextFrame() {
      stopTimer();
      if (!frames || !state.playing || state.scrubbing) return;
      var delay = (delays[state.currentIndex] || 100) / (state.rate || 1);
      state.timer = setTimeout(function () {
        var next = state.currentIndex + 1;
        if (next >= frames.length) {
          state.savedFrame = null;
          showFrame(0, true);
        } else {
          showFrame(next, false);
        }
        scheduleNextFrame();
      }, delay);
    }

    function togglePlay() {
      
      
      if (!frames) return;
      setPlayState(!state.playing);
      if (state.playing) scheduleNextFrame();
      else stopTimer();
    }

    playBtn.addEventListener("click", togglePlay);

    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "group");
    if (altText) wrapper.setAttribute("aria-label", altText + " player");
    attachGifKeyboardControls(wrapper, {
      togglePlay: togglePlay,
      stepFrame: function (delta) {
        
        if (state.playing) togglePlay();
        state.savedFrame = null;
        showFrame(state.currentIndex + delta, true);
      },
      goToStart: function () {
        if (state.playing) togglePlay();
        state.savedFrame = null;
        showFrame(0, true);
      },
    });

    timeline.addEventListener("pointerdown", function () {
      state.scrubbing = true;
      stopTimer();
    });
    timeline.addEventListener("pointerup", function () {
      state.scrubbing = false;
      if (state.playing) scheduleNextFrame();
    });
    timeline.addEventListener("input", function () {
      var index = Number.parseInt(timeline.value, 10) || 0;
      state.savedFrame = null;
      showFrame(index, true);
    });

    markUpgraded(wrapper);
    wrapper.__knotisGifPlayerLive = true;

    paintSnapshot();
    if (!img.complete) img.addEventListener("load", paintSnapshot, { once: true });

    var figure = wrapFigure(wrapper, altText);
    applyMediaSizeFromSource(figure, img);
    if (!figure.querySelector(".knotis-media__rate")) figure.appendChild(rateBtn);
    replaceNode(soloWrapperTarget(img), figure);

    return loadGifFrames(gifUrl).then(function (decoded) {
      frames = decoded.frames;
      state.frames = frames;
      state.dims = decoded.dims;
      delays = frames.map(function (frame) {
        return Math.max(20, Number(frame.delay) || 100);
      });
      totalMs = delays.reduce(function (sum, delay) {
        return sum + delay;
      }, 0);
      if (canvas.width !== decoded.dims.width || canvas.height !== decoded.dims.height) {
        canvas.width = decoded.dims.width;
        canvas.height = decoded.dims.height;
      }
      timeline.max = String(Math.max(0, frames.length - 1));
      timeline.disabled = false;
      state.savedFrame = null;
      showFrame(0, true);

      
      
      return loadGifCaptions(gifUrl).then(function (cues) {
        state.cues = cues || null;
        updateCaption(state.currentIndex);
      });
    });
  }

  function upgradeGifImage(img) {
    if (isOptOut(img) || isUpgraded(img)) return Promise.resolve();
    var src = img.currentSrc || img.getAttribute("src") || "";
    if (mediaExtension(src) !== "gif") return Promise.resolve();

    markPending(img);
    var mp4Url = swapExtension(src.split("#")[0], "mp4");
    return resourceExists(mp4Url).then(function (hasMp4) {
      if (hasMp4) return createVideoFromImage(img, mp4Url);
      return buildGifPlayer(img, src.split("#")[0]);
    }).catch(function (err) {
      clearPending(img);
      throw err;
    });
  }

  function rebuildClonedGifPlayer(player) {
    if (!player || player.__knotisGifPlayerLive) return Promise.resolve();
    var gifUrl = player.getAttribute("data-knotis-gif-src");
    if (!gifUrl) return Promise.resolve();

    var figure = player.closest("figure.knotis-media");
    var img = document.createElement("img");
    img.src = gifUrl;
    img.alt = player.getAttribute("data-knotis-gif-alt") || player.getAttribute("aria-label") || "";
    if (figure && figure.style.width) img.style.width = figure.style.width;
    replaceNode(figure || player, img);
    markPending(img);
    return buildGifPlayer(img, gifUrl).catch(function (err) {
      clearPending(img);
      throw err;
    });
  }

  function upgradeMediaInRoot(root) {
    if (!root) return Promise.resolve();
    var jobs = [];

    root.querySelectorAll("img").forEach(function (img) {
      if (isOptOut(img) || isUpgraded(img)) return;
      var ext = mediaExtension(img.currentSrc || img.getAttribute("src") || "");
      if (ext === "mp4") jobs.push(upgradeMp4Image(img));
      else if (ext === "gif") jobs.push(upgradeGifImage(img));
    });

    root.querySelectorAll("video").forEach(function (video) {
      if (isOptOut(video)) return;
      if (isUpgraded(video)) {
        jobs.push(refreshClonedVideo(video));
        return;
      }
      jobs.push(upgradeVideoElement(video));
    });

    root.querySelectorAll("iframe").forEach(upgradeRemoteIframe);

    root.querySelectorAll(".knotis-gif-player[data-knotis-gif-src]").forEach(function (player) {
      if (isOptOut(player)) return;
      jobs.push(rebuildClonedGifPlayer(player));
    });

    return Promise.all(jobs);
  }

  function upgradeMedia() {
    var token = ++upgradeToken;
    releaseStaleBlobUrls();
    var roots = contentRoots();
    var jobs = roots.map(upgradeMediaInRoot);
    return Promise.all(jobs).then(function () {
      if (token !== upgradeToken) return;
      try {
        document.dispatchEvent(new CustomEvent("knotis:media-upgraded", {
          detail: { roots: roots },
        }));
      } catch (e) {
        document.dispatchEvent(new Event("knotis:media-upgraded"));
      }
    });
  }

  function init() {
    upgradeMedia().catch(function (err) {
      console.error("[knotis-media] upgrade failed:", err);
    });
  }

  if (document.body) {
    init();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else if (!document.body) {
    init();
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    var firstSwap = true;
    window.document$.subscribe(function () {
      if (firstSwap) {
        firstSwap = false;
        return;
      }
      init();
    });
  }

  document.addEventListener("wikilink:pane-content-updated", init);
  document.addEventListener("knotis:slides-content-updated", init);

  
  
  window.KnotisMediaInternals = {
    clampCueList: clampCueList,
    captionCandidates: captionCandidates,
    soloWrapperTarget: soloWrapperTarget,
    attachGifKeyboardControls: attachGifKeyboardControls,
    parseVttCues: parseVttCues,
    activeCueText: activeCueText,
    createGifMenuItem: createGifMenuItem,
    createMediaMenuToggle: createMediaMenuToggle,
    remoteVideoIframeProvider: remoteVideoIframeProvider,
    normalizeRemoteIframeSrc: normalizeRemoteIframeSrc,
  };
})();
