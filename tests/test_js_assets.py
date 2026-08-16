#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parents[1] / "src" / "knotis" / "assets"
SITE_ROOT = Path(__file__).resolve().parents[2]

KNOTIS_JS_ASSETS = sorted(
    p for p in ASSETS_DIR.glob("knotis-*.js") if ".min." not in p.name
)


def _node() -> str | None:
    return shutil.which("node")


def _jsdom_entry() -> Path | None:
    for root in (SITE_ROOT, *SITE_ROOT.parents):
        candidate = root / "node_modules" / "jsdom" / "lib" / "api.js"
        if candidate.exists():
            return candidate
    return None


class JsAssetTests(unittest.TestCase):
    def test_all_knotis_js_assets_parse(self) -> None:
        node = _node()
        if node is None:
            self.skipTest("node is unavailable")
        self.assertTrue(KNOTIS_JS_ASSETS, "no knotis JS assets found")
        for asset in KNOTIS_JS_ASSETS:
            with self.subTest(asset=asset.name):
                result = subprocess.run(
                    [node, "--check", str(asset)],
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 0, result.stderr)

    def test_core_exports_and_wikilinks_guard(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/",
        }});
        const core = readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8");
        dom.window.eval(core);
        const api = dom.window.KnotisCore;
        if (!api) {{ console.error("KnotisCore missing"); process.exit(1); }}
        for (const name of ["isPlainObject", "deepClone", "deepMerge", "fetchJsonNoStore", "escapeHtml", "renderKeyChordHtml", "initMocNavPersistence"]) {{
          if (typeof api[name] !== "function") {{ console.error("missing export: " + name); process.exit(1); }}
        }}
        const merged = api.deepMerge({{ a: {{ b: 1 }} }}, {{ a: {{ c: 2 }} }});
        if (merged.a.b !== 1 || merged.a.c !== 2) {{ console.error("deepMerge broken"); process.exit(1); }}
        if (api.escapeHtml("<a href='x'>&") !== "&lt;a href=&#39;x&#39;&gt;&amp;") {{
          console.error("escapeHtml broken: " + api.escapeHtml("<a href='x'>&"));
          process.exit(1);
        }}
        if (!api.renderKeyChordHtml("ctrl+k").includes("<kbd")) {{ console.error("renderKeyChordHtml broken"); process.exit(1); }}
        if (api.renderKeyChordHtml("") !== "") {{ console.error("empty chord fallback broken"); process.exit(1); }}
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_core_persists_moc_nav_toggle_state(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const html = `
          <!DOCTYPE html><html><body>
            <li class="md-nav__item">
              <input class="md-nav__toggle md-toggle" type="checkbox" data-knotis-moc-nav-key="resources/how-to-use-this-site/">
              <nav class="md-nav"></nav>
            </li>
          </body></html>
        `;
        const dom = new JSDOM(html, {{
          runScripts: "outside-only",
          url: "https://example.test/",
        }});
        const core = readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8");
        dom.window.eval(core);
        const api = dom.window.KnotisCore;
        const input = dom.window.document.querySelector("input");
        const nav = dom.window.document.querySelector("nav");

        api.initMocNavPersistence(dom.window.document);
        input.checked = true;
        input.dispatchEvent(new dom.window.Event("change"));
        if (dom.window.localStorage.getItem("knotis:moc-nav:resources/how-to-use-this-site/") !== "expanded") {{
          console.error("expanded state was not stored");
          process.exit(1);
        }}

        input.checked = false;
        api.initMocNavPersistence(dom.window.document);
        if (!input.checked || nav.getAttribute("aria-expanded") !== "true") {{
          console.error("stored expanded state was not restored");
          process.exit(1);
        }}

        input.checked = false;
        input.dispatchEvent(new dom.window.Event("change"));
        if (dom.window.localStorage.getItem("knotis:moc-nav:resources/how-to-use-this-site/") !== "collapsed") {{
          console.error("collapsed state was not stored");
          process.exit(1);
        }}
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_consumers_guard_against_missing_core(self) -> None:
        for name in ("knotis-wikilinks.js", "knotis-graph.js", "knotis-search.js"):
            text = (ASSETS_DIR / name).read_text(encoding="utf-8")
            self.assertIn("window.KnotisCore", text, name)
            self.assertIn("knotis-core.js must load before", text, name)

    def test_site_graph_links_use_graph_meta_page_url(self) -> None:
        for name in ("knotis-wikilinks.js", "knotis-graph.js"):
            text = (ASSETS_DIR / name).read_text(encoding="utf-8")
            self.assertIn("site_graph?.page_url", text, name)
            self.assertIn('return pageUrl || "graph/"', text, name)

    def test_search_and_pane_mermaid_use_page_palette(self) -> None:
        css = (ASSETS_DIR / "knotis-pane.css").read_text(encoding="utf-8")
        for token in (
            ".wikilink-pane",
            ".knotis-search",
            ".knotis-search-diagram__surface",
            "--md-mermaid-node-bg-color",
            "--md-mermaid-node-fg-color",
            "--md-mermaid-label-bg-color",
            "--md-mermaid-label-fg-color",
            "--md-mermaid-edge-color",
        ):
            self.assertIn(token, css)

        search_js = (ASSETS_DIR / "knotis-search.js").read_text(encoding="utf-8")
        self.assertIn("window.KnotisMermaid?.configure?.()", search_js)
        self.assertNotIn("const themedSource", search_js)

    def test_search_phrase_prefix_matches_plain_titles(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-search.js",
        }});
        dom.window.__KNOTIS_SEARCH_TEST__ = true;
        dom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        dom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-search.js")!r}, "utf8"));
        const search = dom.window.__KnotisSearchTest;
        if (!search) {{ console.error("search test hook missing"); process.exit(1); }}

        const index = search.prepareIndex({{
          docs: [
            {{
              kind: "section",
              id: "section:rstudio-interface",
              title: "RStudio interface",
              text: "",
              concepts: ["RStudio interface"],
              concept_keys: ["rstudio interface"],
              location: "modules/01.-introduction-to-rstudio/#rstudio-interface",
              page_url: "modules/01.-introduction-to-rstudio/",
              page_title: "01. Introduction to RStudio",
              page_order: 1,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:factor-variable",
              title: "Factor variable",
              text: "The factor variable explains the outcome variable.",
              concepts: ["Factor variable"],
              concept_keys: ["factor variable"],
              location: "modules/06.-chi-square-analysis/#factor-variable",
              page_url: "modules/06.-chi-square-analysis/",
              page_title: "06. Chi-square analysis",
              page_order: 6,
              section_order: 1,
            }},
            {{
              kind: "page",
              id: "page:03",
              title: "03. Descriptive statistics",
              text: "",
              location: "modules/03.-descriptive-statistics/",
              page_url: "modules/03.-descriptive-statistics/",
              page_title: "03. Descriptive statistics",
              page_order: 3,
              section_order: 0,
            }},
            {{
              kind: "section",
              id: "section:frequency-code",
              title: "Frequency table #code",
              text: "Working code",
              concepts: ["Frequency table"],
              concept_keys: ["frequency table"],
              content_tags: ["#code"],
              render_context: ["1. **[[Frequency table]] #code**", "- Working code"],
              location: "modules/03.-descriptive-statistics/#frequency-table-code",
              page_url: "modules/03.-descriptive-statistics/",
              page_title: "03. Descriptive statistics",
              page_order: 3,
              section_order: 10,
            }},
            {{
              kind: "section",
              id: "section:frequency-output-tagged",
              title: "Frequency result #output",
              text: "A frequency output table.",
              content_tags: ["#output"],
              render_context: ["1. **Frequency result #output**", "- A frequency output table."],
              section_lines_raw: ["1. **Frequency result #output**", "- A frequency output table."],
              location: "modules/tagged-output/#frequency-result-output",
              page_url: "modules/tagged-output/",
              page_title: "Tagged output",
              page_order: 21,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:frequency-output-plain",
              title: "Plain frequency discussion",
              text: "The frequency output word appears here as ordinary prose.",
              location: "modules/plain-output/#frequency-discussion",
              page_url: "modules/plain-output/",
              page_title: "Plain output prose",
              page_order: 22,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:frequency-code-plain",
              title: "Plain frequency code discussion",
              text: "The code word appears here without a content tag.",
              location: "modules/plain-code/#frequency-code-discussion",
              page_url: "modules/plain-code/",
              page_title: "Plain code prose",
              page_order: 23,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:random-sampling",
              title: "Random sampling",
              text: "",
              location: "modules/08.-probabilistic-sampling/#random-sampling",
              page_url: "modules/08.-probabilistic-sampling/",
              page_title: "08. Probabilistic sampling",
              page_order: 8,
              section_order: 1,
            }},
            {{
              kind: "page",
              id: "page:features-video-controls-feature",
              title: "Video Controls Feature",
              text: "",
              location: "features/video-controls-feature/",
              page_url: "features/video-controls-feature/",
              page_title: "Video Controls Feature",
              page_order: 17,
              section_order: 0,
            }},
            {{
              kind: "section",
              id: "section:features-video-controls-feature-feature-video-controls",
              title: "Feature: Video controls",
              text: "- Video controls turn lesson GIFs and MP4s into classroom-friendly media players. - Students can pause and replay.",
              concepts: ["Video controls"],
              concept_keys: ["video controls"],
              context: [
                "- Video controls turn lesson GIFs and MP4s into classroom-friendly media players.",
                "    - Students can pause and replay.",
              ],
              render_context: [
                "# Feature: Video controls",
                "- [[Video controls]] turn lesson GIFs and MP4s into classroom-friendly media players.",
                "    - Students can pause and replay.",
              ],
              section_lines_raw: [
                "# Feature: Video controls",
                "- [[Video controls]] turn lesson GIFs and MP4s into classroom-friendly media players.",
                "    - Students can pause and replay.",
              ],
              section_kw_offset: 1,
              breadcrumb: ["Feature: Video controls"],
              location: "features/video-controls-feature/#feature-video-controls",
              page_url: "features/video-controls-feature/",
              page_title: "Video Controls Feature",
              page_order: 17,
              section_order: 1,
            }},
            {{
              kind: "mention",
              id: "mention:features-video-controls-feature-wikilink-video-controls-0",
              title: "Video controls",
              text: "Feature: Video controls - Video controls turn lesson GIFs and MP4s into classroom-friendly media players. - Students can pause and replay.",
              concepts: ["Video controls"],
              concept_keys: ["video controls", "video controls"],
              context: [
                "# Feature: Video controls",
                "- Video controls turn lesson GIFs and MP4s into classroom-friendly media players.",
                "    - Students can pause and replay.",
              ],
              render_context: [
                "# Feature: Video controls",
                "- [[Video controls]] turn lesson GIFs and MP4s into classroom-friendly media players.",
                "    - Students can pause and replay.",
              ],
              section_lines_raw: [
                "# Feature: Video controls",
                "- [[Video controls]] turn lesson GIFs and MP4s into classroom-friendly media players.",
                "    - Students can pause and replay.",
              ],
              section_kw_offset: 1,
              breadcrumb: [],
              location: "features/video-controls-feature/#wikilink-video-controls-0",
              page_url: "features/video-controls-feature/",
              page_title: "Video Controls Feature",
              page_order: 17,
              section_order: 0,
              primary_concept: "Video controls",
            }},
            {{
              kind: "section",
              id: "section:concept-rstudio",
              title: "RStudio",
              search_title: "",
              text: "RStudio is the IDE students use.",
              search_text: "RStudio is the IDE students use.",
              concepts: ["RStudio"],
              concept_keys: ["rstudio"],
              location: "module-01/#rstudio",
              page_url: "module-01/",
              page_title: "01. Introduction to RStudio",
              page_order: 1,
              section_order: 1,
            }},
            {{
              kind: "reference_occurrence",
              id: "reference-occurrence:rstudio-console-0",
              title: "RStudio console",
              search_title: "",
              text: "Reference definition one for the console.",
              search_text: "Reference definition one for the console.",
              references: ["RStudio console"],
              reference_keys: ["rstudio console"],
              location: "module-01/#wikilink-rstudio-console-0",
              page_url: "module-01/",
              page_title: "01. Introduction to RStudio",
              page_order: 1,
              section_order: 2,
            }},
            {{
              kind: "reference_occurrence",
              id: "reference-occurrence:rstudio-console-1",
              title: "RStudio console",
              search_title: "",
              text: "Reference definition two for immediate output.",
              search_text: "Reference definition two for immediate output.",
              references: ["RStudio console"],
              reference_keys: ["rstudio console"],
              location: "module-01/#wikilink-rstudio-console-1",
              page_url: "module-01/",
              page_title: "01. Introduction to RStudio",
              page_order: 1,
              section_order: 3,
            }},
            {{
              kind: "page",
              id: "page:module-02",
              title: "02. Introduction to data and scripting",
              search_title: "",
              text: "",
              search_text: "",
              location: "module-02/",
              page_url: "module-02/",
              page_title: "02. Introduction to data and scripting",
              page_order: 2,
              section_order: 0,
            }},
            {{
              kind: "section",
              id: "section:module-02-learning-outcomes",
              title: "Learning outcomes",
              search_title: "Learning outcomes",
              text: "Define the key terminologies of data, including variable name.",
              search_text: "Define the key terminologies of data, including variable name.",
              section_lines_raw: [
                "# Learning outcomes",
                "1. Define the key terminologies of data, including variable name.",
              ],
              section_kw_offset: 1,
              content_line: 5,
              breadcrumb: ["Module items", "Learning outcomes"],
              location: "module-02/#learning-outcomes",
              page_url: "module-02/",
              page_title: "02. Introduction to data and scripting",
              page_order: 2,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:module-02-pasting-variable-names",
              title: "Pasting variable names",
              search_title: "Pasting variable names",
              text: "Pasting variable names avoids typing mistakes.",
              search_text: "Pasting variable names avoids typing mistakes.",
              section_lines_raw: [
                "# Pasting variable names",
                "Pasting variable names avoids typing mistakes.",
              ],
              section_kw_offset: 1,
              content_line: 80,
              breadcrumb: ["Using R script files", "Pasting variable names"],
              location: "module-02/#pasting-variable-names",
              page_url: "module-02/",
              page_title: "02. Introduction to data and scripting",
              page_order: 2,
              section_order: 8,
            }},
            ...[
              ["value", "Value", 3],
              ["value-label", "Value label", 4],
              ["variable-name", "Variable name", 1],
              ["variable-label", "Variable label", 2],
            ].map(([slug, title, offset], occurrence) => ({{
              kind: "reference_occurrence",
              id: `reference-occurrence:${{slug}}-0`,
              title,
              search_title: "",
              text: "Shared terminology context.",
              // Deliberately reproduce the old bad payload. Reference records must
              // still match only their own reference_keys in the browser.
              search_text: "Variable name Variable label Value Value label",
              references: [title],
              reference_keys: [title.toLowerCase()],
              section_lines_raw: [
                "# Data terminology",
                "- **[[Variable name|ref]]:** Unique words assigned to each question.",
                "- **[[Variable label|ref]]:** Explains what the question is about.",
                "- **[[Value|ref]]:** Numbers representing specific responses.",
                "- **[[Value label|ref]]:** What those values mean.",
              ],
              section_kw_offset: offset,
              breadcrumb: ["Terminologies", "Data terminology"],
              location: `module-02/#wikilink-${{slug}}-0`,
              page_url: "module-02/",
              page_title: "02. Introduction to data and scripting",
              page_order: 2,
              section_order: occurrence + 1,
            }})),
            {{
              kind: "section",
              id: "section:ordinary-rstudio-console",
              title: "Ordinary RStudio console wikilink",
              search_title: "Ordinary wikilink",
              text: "Paste code into RStudio console.",
              search_text: "Paste code into .",
              concepts: [],
              concept_keys: [],
              location: "ordinary-console/#ordinary-rstudio-console-wikilink",
              page_url: "ordinary-console/",
              page_title: "Ordinary Console",
              page_order: 29,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:plain-rstudio",
              title: "Plain RStudio text",
              text: "This sentence mentions RStudio without a wikilink.",
              location: "plain-rstudio/#plain-rstudio-text",
              page_url: "plain-rstudio/",
              page_title: "Plain RStudio",
              page_order: 32,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:plain-rstudio-console",
              title: "Plain RStudio console text",
              text: "This sentence mentions RStudio console without a wikilink.",
              location: "plain-console/#plain-rstudio-console-text",
              page_url: "plain-console/",
              page_title: "Plain Console",
              page_order: 33,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:categorical-primary",
              title: "Categorical variables",
              text: "Categorical variables take on values that are labels.",
              search_text: "Categorical variables take on values that are labels.",
              concepts: ["Categorical variables"],
              concept_keys: ["categorical variables"],
              location: "categorical/#categorical-variables",
              page_url: "categorical/",
              page_title: "03. Descriptive statistics",
              page_order: 3,
              section_order: 1,
            }},
            {{
              kind: "section",
              id: "section:categorical-secondary",
              title: "Categorical examples",
              text: "Another categorical example appears later on the page.",
              search_text: "Another categorical example appears later on the page.",
              concepts: ["Categorical examples"],
              concept_keys: ["categorical examples"],
              location: "categorical/#categorical-examples",
              page_url: "categorical/",
              page_title: "03. Descriptive statistics",
              page_order: 3,
              section_order: 2,
            }},
          ],
        }});

        function titles(query) {{
          return search.searchIndex(query, index, new Set())
            .flatMap((group) => group.docs.map((item) => item.doc.title));
        }}
        function assertHas(query, title) {{
          const matches = titles(query);
          if (!matches.includes(title)) {{
            console.error(`${{query}} did not include ${{title}}: ${{matches.join(" | ")}}`);
            process.exit(1);
          }}
        }}
        function assertMissing(query, title) {{
          const matches = titles(query);
          if (matches.includes(title)) {{
            console.error(`${{query}} unexpectedly included ${{title}}`);
            process.exit(1);
          }}
        }}

        for (const query of ["descriptive st", "descriptive sta", "descriptive stat", "descriptive stati", "descriptive statistics"]) {{
          assertHas(query, "03. Descriptive statistics");
        }}
        assertMissing("descriptive x", "03. Descriptive statistics");
        assertHas("frequency table code", "Frequency table #code");
        assertHas("output", "Frequency result #output");
        assertHas("output", "Plain frequency discussion");
        assertHas("#output", "Frequency result #output");
        assertMissing("#output", "Plain frequency discussion");
        assertHas("frequency #output", "Frequency result #output");
        assertMissing("frequency #output", "Plain frequency discussion");
        assertHas("#code", "Frequency table #code");
        assertMissing("#code", "Plain frequency code discussion");
        assertHas("random samp", "Random sampling");
        assertHas("fac", "Factor variable");
        assertMissing("fac", "RStudio interface");

        const videoGroups = search.searchIndex("video controls", index, new Set());
        const videoGroup = videoGroups.find((group) => group.id === "features/video-controls-feature/");
        if (!videoGroup) {{
          console.error("video controls feature result group missing");
          process.exit(1);
        }}
        const videoDocIds = videoGroup.docs.map((item) => item.doc.id);
        if (!videoDocIds.includes("section:features-video-controls-feature-feature-video-controls") ||
            !videoDocIds.includes("mention:features-video-controls-feature-wikilink-video-controls-0")) {{
          console.error("regression setup did not include both section and mention hits: " + videoDocIds.join(" | "));
          process.exit(1);
        }}
        const renderedVideoGroup = search.renderGroup(videoGroup, "video controls", index, null, null);
        if (renderedVideoGroup.includes("more on this page")) {{
          console.error("duplicate section/mention snippet rendered as an extra search card: " + renderedVideoGroup);
          process.exit(1);
        }}

        const categoricalGroup = search.searchIndex("categorical", index, new Set())
          .find((group) => group.id === "categorical/");
        const renderedCategorical = search.renderGroup(categoricalGroup, "categorical", index, null, null);
        if (!renderedCategorical.includes("1 more on this page")) {{
          console.error("normal same-page matches must retain more on this page: " + renderedCategorical);
          process.exit(1);
        }}

        const previousSectionRender = dom.window.KnotisSectionRender;
        dom.window.KnotisSectionRender = {{
          resolveInitialWindow(lines) {{ return {{ displayStart: 0, end: lines.length }}; }},
          renderInitialWindow(lines) {{ return `<p>${{lines[0] || ""}}</p>`; }},
          wrapMarkdownSurface(body) {{ return body; }},
        }};
        for (const [query, expectedTitle] of [["value", "Value"], ["variable name", "Variable name"]]) {{
          const terminologyGroup = search.searchIndex(query, index, new Set())
            .find((group) => group.id === "module-02/");
          const matchedReferences = terminologyGroup?.docs
            .filter((item) => item.doc.kind === "reference_occurrence") || [];
          if (matchedReferences.length !== 1 || matchedReferences[0].doc.title !== expectedTitle) {{
            console.error(`${{query}} must select only its exact reference: ${{matchedReferences.map((item) => item.doc.title).join(" | ")}}`);
            process.exit(1);
          }}
          const renderedTerminology = search.renderGroup(terminologyGroup, query, index, null, null);
          if (query === "value") {{
            if (renderedTerminology.includes("md-search-result__more-link") || renderedTerminology.includes("more on this page")) {{
              console.error(`${{query}} rendered duplicate terminology cards: ${{renderedTerminology}}`);
              process.exit(1);
            }}
          }} else {{
            if (!renderedTerminology.includes("2 more on this page")) {{
              console.error("variable name should retain both distinct same-page matches: " + renderedTerminology);
              process.exit(1);
            }}
            const learningAt = renderedTerminology.indexOf("Learning outcomes");
            const pastingAt = renderedTerminology.indexOf("Pasting variable names");
            if (!(learningAt >= 0 && learningAt < pastingAt)) {{
              console.error("more-on-this-page cards must follow page appearance order: " + renderedTerminology);
              process.exit(1);
            }}
          }}
        }}

        const variablePrefixGroup = search.searchIndex("vari", index, new Set())
          .find((group) => group.id === "module-02/");
        const variablePrefixRefs = variablePrefixGroup.docs
          .filter((item) => item.doc.kind === "reference_occurrence");
        if (variablePrefixRefs.length !== 2) {{
          console.error("vari fixture should match both structured variable references");
          process.exit(1);
        }}
        const renderedVariablePrefix = search.renderGroup(variablePrefixGroup, "vari", index, null, null);
        dom.window.KnotisSectionRender = previousSectionRender;
        if (renderedVariablePrefix.split("<p># Data terminology</p>").length !== 2) {{
          console.error("identical reference windows must render once: " + renderedVariablePrefix);
          process.exit(1);
        }}
        if (!renderedVariablePrefix.includes("2 more on this page")) {{
          console.error("distinct non-reference matches must remain expandable: " + renderedVariablePrefix);
          process.exit(1);
        }}

        for (const prefix of ["rs", "rst", "rstu"]) {{
          const groupIds = search.searchIndex(prefix, index, new Set()).map((group) => group.id);
          if (groupIds[0] !== "module-01/") {{
            console.error(`${{prefix}} should rank Module 01 first: ${{groupIds.join(" | ")}}`);
            process.exit(1);
          }}
          const group = search.searchIndex(prefix, index, new Set())[0];
          const rendered = search.renderGroup(group, prefix, index, null, null);
          const rstudioAt = rendered.indexOf("knotis-target-text=RStudio&amp;");
          const firstRefAt = rendered.indexOf("Reference definition one for the console");
          const secondRefAt = rendered.indexOf("Reference definition two for immediate output");
          const detailsAt = rendered.indexOf('<details class="md-search-result__more">');
          if (!(rstudioAt >= 0 && rstudioAt < firstRefAt && firstRefAt < secondRefAt)) {{
            console.error(`${{prefix}} should show RStudio first and both refs next: ${{rendered}}`);
            process.exit(1);
          }}
          if (detailsAt >= 0 && (firstRefAt > detailsAt || secondRefAt > detailsAt)) {{
            console.error(`${{prefix}} refs must be visible outside more-on-this-page: ${{rendered}}`);
            process.exit(1);
          }}
        }}

        const rstuGroupIds = search.searchIndex("rstu", index, new Set()).map((group) => group.id);
        const rstudioIndex = rstuGroupIds.indexOf("module-01/");
        const ordinaryConsoleIndex = rstuGroupIds.indexOf("ordinary-console/");
        const plainRstudioIndex = rstuGroupIds.indexOf("plain-rstudio/");
        const plainConsoleIndex = rstuGroupIds.indexOf("plain-console/");
        if ([rstudioIndex, plainRstudioIndex, plainConsoleIndex].some((index) => index < 0)) {{
          console.error("rstu prefix search missed an expected group: " + rstuGroupIds.join(" | "));
          process.exit(1);
        }}
        if (ordinaryConsoleIndex >= 0) {{
          console.error("rstu prefix search should suppress longer ordinary wikilinks that shadow the shorter RStudio concept: " + rstuGroupIds.join(" | "));
          process.exit(1);
        }}
        if (!(rstudioIndex < plainRstudioIndex && plainRstudioIndex < plainConsoleIndex)) {{
          console.error("rstu prefix search order should be Module 01 refs, then plain text: " + rstuGroupIds.join(" | "));
          process.exit(1);
        }}

        const consoleGroups = search.searchIndex("rstudio console", index, new Set());
        const consoleGroupIds = consoleGroups.map((group) => group.id);
        const consoleReferenceIndex = consoleGroupIds.indexOf("module-01/");
        const consoleOrdinaryIndex = consoleGroupIds.indexOf("ordinary-console/");
        if (consoleReferenceIndex !== 0 || consoleOrdinaryIndex >= 0) {{
          console.error("exact reference search should show explicit refs and exclude ordinary wikilinks: " + consoleGroupIds.join(" | "));
          process.exit(1);
        }}
        const renderedReferenceGroup = search.renderGroup(consoleGroups[0], "rstudio console", index, null, null);
        for (const text of ["Reference definition one for the console", "Reference definition two for immediate output"]) {{
          if (renderedReferenceGroup.split(text).length !== 2) {{
            console.error("each explicit ref must render exactly once: " + renderedReferenceGroup);
            process.exit(1);
          }}
        }}
        const exactDetailsAt = renderedReferenceGroup.indexOf('<details class="md-search-result__more">');
        const secondRefAt = renderedReferenceGroup.indexOf("Reference definition two for immediate output");
        if (exactDetailsAt >= 0 && secondRefAt > exactDetailsAt) {{
          console.error("explicit refs must not move into more on this page: " + renderedReferenceGroup);
          process.exit(1);
        }}

        if (!search.lineMatchesQuery("Descriptive statistics", ["descriptive", "st"], "all")) {{
          console.error("lineMatchesQuery missed adjacent prefix phrase");
          process.exit(1);
        }}
        if (search.lineMatchesQuery("Descriptive values and statistics", ["descriptive", "st"], "all")) {{
          console.error("lineMatchesQuery matched scattered phrase");
          process.exit(1);
        }}
        if (!search.lineMatchesQuery("Factor variable", ["fac"], "any")) {{
          console.error("lineMatchesQuery missed single-word prefix");
          process.exit(1);
        }}
        if (search.lineMatchesQuery("RStudio interface", ["fac"], "any")) {{
          console.error("lineMatchesQuery matched inside a word");
          process.exit(1);
        }}
        const logical = search.highlightQueryPhrase("a logical order", "logic");
        if (!logical.includes('<mark class="knotis-search-query-mark">logic</mark>al')) {{
          console.error("plain-text prefix highlight missed logical: " + logical);
          process.exit(1);
        }}
        const biological = search.highlightQueryPhrase("a biological order", "logic");
        if (biological.includes("mark")) {{
          console.error("plain-text highlight matched inside biological: " + biological);
          process.exit(1);
        }}
        const pathHighlight = search.highlightText("logical order", "logic");
        if (!pathHighlight.includes("<mark data-md-highlight>logic</mark>al")) {{
          console.error("breadcrumb prefix highlight missed logical: " + pathHighlight);
          process.exit(1);
        }}

        const orderedIndex = search.prepareIndex({{
          options: {{ order: ["resources", "modules"] }},
          docs: [
            {{ kind: "section", id: "ordered:module", title: "Ordered match", text: "Ordered match", search_text: "Ordered match", location: "modules/lesson/#match", page_url: "modules/lesson/", page_title: "Module", page_order: 1, section_order: 1 }},
            {{ kind: "section", id: "ordered:resource", title: "Ordered match", text: "Ordered match", search_text: "Ordered match", location: "resources/guide/#match", page_url: "resources/guide/", page_title: "Resource", page_order: 20, section_order: 1 }},
            {{ kind: "section", id: "ordered:other", title: "Ordered match", text: "Ordered match", search_text: "Ordered match", location: "other/page/#match", page_url: "other/page/", page_title: "Other", page_order: 0, section_order: 1 }},
          ],
        }});
        const orderedGroups = search.searchIndex("ordered match", orderedIndex, new Set()).map((group) => group.id);
        if (orderedGroups.join("|") !== "resources/guide/|modules/lesson/|other/page/") {{
          console.error("search order prefixes must rank configured groups first in list order: " + orderedGroups.join(" | "));
          process.exit(1);
        }}

        const paneDom = new JSDOM("<!DOCTYPE html><html><body data-knotis-offline-preview='true'></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-wikilinks.js",
        }});
        paneDom.window.fetch = async () => ({{ ok: false, status: 404, json: async () => ({{}}) }});
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));
        const renderer = paneDom.window.KnotisSectionRender;
        if (!renderer) {{ console.error("section renderer missing"); process.exit(1); }}
        const renderedLogical = renderer.renderLines(["A logical order."], "", {{ searchQuery: "logic" }});
        if (!renderedLogical.includes('<mark class="knotis-search-query-mark">logic</mark>al')) {{
          console.error("shared renderer missed logical prefix: " + renderedLogical);
          process.exit(1);
        }}
        const renderedBiological = renderer.renderLines(["A biological order."], "", {{ searchQuery: "logic" }});
        if (renderedBiological.includes("knotis-search-query-mark")) {{
          console.error("shared renderer matched inside biological: " + renderedBiological);
          process.exit(1);
        }}
        const renderedPlainHeading = renderer.renderLines(["# video"], "", {{ keyword: "video" }});
        if (!renderedPlainHeading.includes('<mark class="knotis-search-query-mark">video</mark>')) {{
          console.error("plain keyword heading should use query mark, got: " + renderedPlainHeading);
          process.exit(1);
        }}
        const renderedWikilinkHeading = renderer.renderLines(["# [[video]]"], "", {{ keyword: "video" }});
        if (!renderedWikilinkHeading.includes("knotis-search-wikilink-match")) {{
          console.error("wikilink heading should keep wikilink match styling: " + renderedWikilinkHeading);
          process.exit(1);
        }}
        const renderedLiteralInlineCode = renderer.renderLines([
          "A `#content-tag` labels a section by content type.",
          "The double-bracket, `[[concept]]` syntax names a concept.",
        ], "", {{ keyword: "concept" }});
        if (!renderedLiteralInlineCode.includes("<code>#content-tag</code>")) {{
          console.error("content tag inside inline code should stay literal: " + renderedLiteralInlineCode);
          process.exit(1);
        }}
        if (!renderedLiteralInlineCode.includes("<code>[[concept]]</code>")) {{
          console.error("wikilink syntax inside inline code should stay literal: " + renderedLiteralInlineCode);
          process.exit(1);
        }}
        if (renderedLiteralInlineCode.includes("content-tag--inline") || renderedLiteralInlineCode.includes("wikilink--inline")) {{
          console.error("inline code should not become pane tokens: " + renderedLiteralInlineCode);
          process.exit(1);
        }}
        const renderedCleanContext = renderer.renderLines([
          "Write your first lesson",
          'title: "Write your first lesson"',
          "icon: lucide/pencil",
          "tags:",
          "- Workflows",
          "This page walks through one short lesson with [[pane]].",
        ], "", {{ keyword: "pane", pageTitle: "Write your first lesson" }});
        if (renderedCleanContext.includes("Write your first lesson") || renderedCleanContext.includes("title:") || renderedCleanContext.includes("Workflows")) {{
          console.error("pane context should suppress duplicate page title and YAML: " + renderedCleanContext);
          process.exit(1);
        }}
        if (!renderedCleanContext.includes("This page walks through one short lesson")) {{
          console.error("pane context cleanup removed body text: " + renderedCleanContext);
          process.exit(1);
        }}
        const renderedHighlightedFence = renderer.renderLines([
          '```r linenums="1" hl_lines="2 1"',
          "first line",
          "second line",
          "```",
        ], "modules/example/");
        if (!renderedHighlightedFence.includes('data-wl-highlight-lines="1,2"')) {{
          console.error("pane code did not retain normalized hl_lines options: " + renderedHighlightedFence);
          process.exit(1);
        }}
        const renderedOutOfRangeFence = renderer.renderLines([
          '```r linenums="1" hl_lines="1 2 3"',
          "only line",
          "```",
        ], "modules/example/");
        if (!renderedOutOfRangeFence.includes('data-wl-highlight-lines="1"')) {{
          console.error("pane code kept highlight lines outside the source range: " + renderedOutOfRangeFence);
          process.exit(1);
        }}
        const numberedCodeHost = paneDom.window.document.createElement("div");
        numberedCodeHost.dataset.pageUrl = "modules/example/";
        const numberedCodeBlock = paneDom.window.document.createElement("div");
        numberedCodeBlock.className = "wl-sec-code-block";
        numberedCodeBlock.dataset.wlCode = "first line\\nsecond line";
        numberedCodeHost.appendChild(numberedCodeBlock);
        paneDom.window.document.body.appendChild(numberedCodeHost);
        paneDom.window.fetch = async () => ({{
          ok: true,
          json: async () => ({{}}),
          text: async () => `<article><div class="language-r highlight"><table class="highlighttable"><tr>
            <td class="linenos"><div class="linenodiv"><pre><span class="normal"><a href="#__codelineno-1-5">5</a></span>\n<span class="normal"><a href="#__codelineno-1-6">6</a></span></pre></div></td>
            <td class="code"><div><pre><span></span><code><span id="__span-1-5"><a id="__codelineno-1-5" name="__codelineno-1-5"></a><span class="hll"><span class="n">first</span> line\n</span></span><span id="__span-1-6"><a id="__codelineno-1-6" name="__codelineno-1-6"></a><span class="hll"><span class="n">second</span> line\n</span></span></code></pre></div></td>
          </tr></table></div><div class="language-r highlight"><table class="highlighttable"><tr>
            <td class="linenos"><div class="linenodiv"><pre><span class="normal"><a href="#__codelineno-2-5">5</a></span>\n<span class="normal"><a href="#__codelineno-2-6">6</a></span></pre></div></td>
            <td class="code"><div><pre><span></span><code><span id="__span-2-5"><a id="__codelineno-2-5" name="__codelineno-2-5"></a><span class="n">first</span> line\n</span><span id="__span-2-6"><a id="__codelineno-2-6" name="__codelineno-2-6"></a><span class="n">second</span> line\n</span></code></pre></div></td>
          </tr></table></div></article>`,
        }});
        await renderer.upgradePaneCodeBlocks(numberedCodeHost);
        const renderedGutter = numberedCodeHost.querySelector("td.linenos");
        const renderedGutterLabels = [...(renderedGutter?.querySelectorAll(".normal") || [])]
          .map((node) => node.textContent.trim())
          .join(" ");
        if (renderedGutterLabels !== "5 6") {{
          console.error("numbered pane code did not preserve the page gutter: " + numberedCodeHost.innerHTML);
          process.exit(1);
        }}
        if ([...renderedGutter.querySelector("pre").childNodes].some((node) => !node.textContent.trim())) {{
          console.error("numbered pane code kept an empty gutter row: " + numberedCodeHost.innerHTML);
          process.exit(1);
        }}
        if ([...numberedCodeHost.querySelector("td.code pre").childNodes]
          .some((node) => node.tagName !== "CODE" && !node.textContent.trim())) {{
          console.error("numbered pane code kept an empty code spacer: " + numberedCodeHost.innerHTML);
          process.exit(1);
        }}
        if (numberedCodeHost.querySelector("[id], [name]")) {{
          console.error("numbered pane code kept page-local ids: " + numberedCodeHost.innerHTML);
          process.exit(1);
        }}
        const renderedCodeText = numberedCodeHost.querySelector("td.code code")?.textContent || "";
        if (!renderedCodeText.includes("first line") || !renderedCodeText.includes("second line")) {{
          console.error("numbered pane code changed source text: " + numberedCodeHost.innerHTML);
          process.exit(1);
        }}
        if (numberedCodeHost.querySelector("td.code .hll")) {{
          console.error("unhighlighted duplicate received highlighted rendered markup: " + numberedCodeHost.innerHTML);
          process.exit(1);
        }}
        const paneCopyNav = numberedCodeBlock.querySelector(":scope > .md-code__nav");
        if (!paneCopyNav?.querySelector(".md-code__button.wl-sec-code__copy")) {{
          console.error("pane copy control must sit outside the horizontal scroll rail: " + numberedCodeHost.innerHTML);
          process.exit(1);
        }}
        const highlightedCodeHost = paneDom.window.document.createElement("div");
        highlightedCodeHost.dataset.pageUrl = "modules/example/";
        const highlightedCodeBlock = paneDom.window.document.createElement("div");
        highlightedCodeBlock.className = "wl-sec-code-block";
        highlightedCodeBlock.dataset.wlCode = "first line\\nsecond line";
        highlightedCodeBlock.dataset.wlHighlightLines = "1,2";
        highlightedCodeHost.appendChild(highlightedCodeBlock);
        paneDom.window.document.body.appendChild(highlightedCodeHost);
        await renderer.upgradePaneCodeBlocks(highlightedCodeHost);
        if (highlightedCodeHost.querySelectorAll("td.code .hll").length !== 2) {{
          console.error("highlighted duplicate did not retain its authored line highlights: " + highlightedCodeHost.innerHTML);
          process.exit(1);
        }}
        const paneOpenDom = new JSDOM(`<!DOCTYPE html><html><body>
          <main class="md-content__inner">
            <span id="pane-test-wikilink" class="wikilink" data-keyword="wikilink" data-occurrence-index="0" data-focus-page-url="features/wikilinks-feature/" role="button" tabindex="0">wikilink</span>
          </main>
        </body></html>`, {{
          pretendToBeVisual: true,
          runScripts: "outside-only",
          url: "https://example.test/features/wikilinks-feature/",
        }});
        paneOpenDom.window.requestAnimationFrame = (callback) => paneOpenDom.window.setTimeout(callback, 0);
        paneOpenDom.window.HTMLElement.prototype.scrollTo = function () {{}};
        const conceptPreviewCalls = [];
        paneOpenDom.window.Knotis = {{
          renderConceptGraphPreview: async (_container, keyword, options = {{}}) => {{
            conceptPreviewCalls.push({{ keyword, options }});
          }},
        }};
        const fakeWikilinks = {{
          wikilink: [{{
            title: "wikilink",
            page_title: "Wikilinks Feature",
            page_url: "features/wikilinks-feature/",
            context: "- A [[wikilink]] is a concept written in double brackets.",
            child_items: [],
            occurrence_index: 0,
            heading_path: ["Wikilinks Feature"],
            parent_chain: ["# Wikilinks Feature"],
            section_lines: [
              "# Wikilinks Feature",
              "## Feature: [[Wikilinks]]",
              "- A [[wikilink]] is a concept written in double brackets.",
            ],
            section_lines_raw: [
              "# Wikilinks Feature",
              "## Feature: [[Wikilinks]]",
              "- A [[wikilink]] is a concept written in double brackets.",
            ],
            section_kw_offset: 2,
            line_idx: 2,
          }}],
        }};
        const fakeReferences = {{
          wikilink: [{{
            title: "wikilink",
            page_title: "Wikilinks Feature",
            page_url: "features/wikilinks-feature/",
            context: "- A [[wikilink|ref]] is a reference definition.",
            child_items: [],
            occurrence_index: 1,
            heading_path: ["Wikilinks Feature"],
            parent_chain: ["# Wikilinks Feature"],
            section_lines: [
              "# Wikilinks Feature",
              "## Feature: [[Wikilinks|ref]]",
              "- A [[wikilink|ref]] is a reference definition.",
            ],
            section_lines_raw: [
              "# Wikilinks Feature",
              "## Feature: [[Wikilinks|ref]]",
              "- A [[wikilink|ref]] is a reference definition.",
            ],
            section_kw_offset: 2,
          }}],
        }};
        paneOpenDom.window.fetch = async (url) => {{
          const href = String(url);
          if (href.includes("wikilinks.json")) return {{ ok: true, json: async () => fakeWikilinks }};
          if (href.includes("references.json")) return {{ ok: true, json: async () => fakeReferences }};
          if (href.includes("nav_order.json")) return {{ ok: true, json: async () => ({{ "features/wikilinks-feature/": 1 }}) }};
          if (href.includes("graph.json")) return {{ ok: true, json: async () => ({{ meta: {{ knotis: {{ pane: {{ context_scope: "all_pages" }} }} }} }}) }};
          if (href.includes("content-tags.json")) return {{ ok: true, json: async () => ({{}}) }};
          return {{ ok: false, status: 404, json: async () => ({{}}) }};
        }};
        paneOpenDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        paneOpenDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));
        paneOpenDom.window.document.dispatchEvent(new paneOpenDom.window.Event("DOMContentLoaded", {{ bubbles: true }}));
        await new Promise((resolve) => setTimeout(resolve, 20));
        paneOpenDom.window.document.getElementById("pane-test-wikilink").click();
        await new Promise((resolve) => setTimeout(resolve, 80));
        const openedPane = paneOpenDom.window.document.getElementById("wikilink-pane");
        if (!openedPane || !openedPane.classList.contains("wikilink-pane--open")) {{
          console.error("fake pane did not open");
          process.exit(1);
        }}
        if (openedPane.dataset.paneType !== "keyword") {{
          console.error("plain wikilink should open keyword pane, not reference pane: " + openedPane.dataset.paneType);
          process.exit(1);
        }}
        if (conceptPreviewCalls.length !== 1 || conceptPreviewCalls[0].keyword !== "wikilink") {{
          console.error("concept preview did not render once: " + JSON.stringify(conceptPreviewCalls));
          process.exit(1);
        }}
        if (conceptPreviewCalls[0].options.focusPageUrl) {{
          console.error("pane card focus must not scope the concept graph: " + JSON.stringify(conceptPreviewCalls[0]));
          process.exit(1);
        }}
        const moduleTitles = [...openedPane.querySelectorAll(".wikilink-module__page")]
          .map((node) => node.textContent.trim())
          .filter((text) => text === "Wikilinks Feature");
        const cardTitles = [...openedPane.querySelectorAll(".wikilink-card__page")]
          .map((node) => node.textContent.trim())
          .filter((text) => text === "Wikilinks Feature");
        if (moduleTitles.length !== 1 || cardTitles.length !== 0) {{
          console.error("page title should appear only as module header, got module=" + moduleTitles.length + " card=" + cardTitles.length + ": " + openedPane.innerHTML);
          process.exit(1);
        }}
        paneOpenDom.window.close();
        const contentTagSlice = [
          "2. **[[Reversing values]] #code structure:**",
          "    - **[[Model code]]**",
          "        - ```r linenums=\\"1\\"",
          "        gss$new_variable_here <-",
          "        ```",
          "    - **[[Working code]]**",
          "        - ```r linenums=\\"1\\"",
          "        gss$satjobreversed <-",
          "        ```",
          "            - **Line 1:** We put the new variable name here.",
          "            - **Line 2:** We put the original variable here.",
        ];
        const renderedContentTag = renderer.wrapMarkdownSurface(renderer.renderLines(contentTagSlice, "modules/04.-recoding-variables/", {{
          keyword: "#code",
          renderMode: "content_tag",
          sourceLines: contentTagSlice,
          baseLineIndex: 0,
        }}));
        const holder = paneDom.window.document.createElement("div");
        holder.innerHTML = renderedContentTag;
        const outerOl = holder.querySelector("ol");
        if (!outerOl || outerOl.getAttribute("start") !== "2") {{
          console.error("content tag list slice did not preserve start=2: " + renderedContentTag);
          process.exit(1);
        }}
        const olStyle = outerOl.getAttribute("style") || "";
        if (!olStyle.includes("--knotis-ol-start:1") || !olStyle.includes("counter-reset:level1")) {{
          console.error("content tag list slice did not seed custom list counters from start=2: " + renderedContentTag);
          process.exit(1);
        }}
        const topItem = outerOl.children[0];
        if (!topItem || !topItem.textContent.includes("Reversing values") || topItem.classList.contains("knotis-nested-list-shell")) {{
          console.error("content tag list slice rendered a shell instead of the tagged item: " + renderedContentTag);
          process.exit(1);
        }}
        if (!topItem.querySelector(":scope > ul")) {{
          console.error("content tag list slice did not keep child bullets under the tagged item: " + renderedContentTag);
          process.exit(1);
        }}
        const lineItem = [...topItem.querySelectorAll("li")].find((li) => li.textContent.includes("Line 1:"));
        if (!lineItem) {{
          console.error("content tag list slice omitted nested line explanation bullets: " + renderedContentTag);
          process.exit(1);
        }}
        const workingItem = [...topItem.querySelectorAll(":scope > ul > li")].find((li) => li.textContent.includes("Working code"));
        const workingCodeItem = workingItem?.querySelector(":scope > ul > li");
        if (!workingCodeItem?.querySelector(":scope > .wl-sec-code-block")) {{
          console.error("content tag list slice did not render the working code block as a child bullet: " + renderedContentTag);
          process.exit(1);
        }}
        if (!workingCodeItem.querySelector(":scope > ul > li")) {{
          console.error("content tag list slice did not keep line bullets under the working code block: " + renderedContentTag);
          process.exit(1);
        }}
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_admonition_trailing_children_render_outside_in_pane_and_search(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const lines = [
          '    - !!! info "Box title"',
          '        - First box item',
          '            - Second box item',
          '                - Final nested box item',
          '',
          '        - Child after the box',
        ];
        const nestedLines = [
          '- !!! note "Outer box"',
          '    - !!! question "Nested box"',
          '        - First nested item',
          '',
          '        - Second nested item',
        ];

        function assertAdmonitionBoundaries(holder, label) {{
          const child = [...holder.querySelectorAll("li")]
            .find((item) => item.textContent.trim() === "Child after the box");
          const first = [...holder.querySelectorAll("li")]
            .find((item) => item.textContent.trim() === "Final nested box item");
          if (!child || child.closest(".admonition")) {{
            console.error(label + " kept the trailing child inside the admonition: " + holder.innerHTML);
            process.exit(1);
          }}
          if (!first?.closest(".admonition")) {{
            console.error(label + " moved ordinary admonition content outside: " + holder.innerHTML);
            process.exit(1);
          }}
        }}

        function assertNestedAdmonition(holder, label) {{
          const second = [...holder.querySelectorAll("li")]
            .find((item) => item.textContent.trim() === "Second nested item");
          if (!second?.closest(".admonition.question")) {{
            console.error(label + " split nested admonition content: " + holder.innerHTML);
            process.exit(1);
          }}
        }}

        const paneDom = new JSDOM("<!DOCTYPE html><html><body data-knotis-offline-preview='true'></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-wikilinks.js",
        }});
        paneDom.window.fetch = async () => ({{ ok: false, status: 404, json: async () => ({{}}) }});
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));
        const paneRenderer = paneDom.window.KnotisSectionRender;
        const paneHolder = paneDom.window.document.createElement("div");
        paneHolder.innerHTML = paneRenderer.renderLines(lines, "modules/example/");
        assertAdmonitionBoundaries(paneHolder, "pane");
        paneHolder.innerHTML = paneRenderer.renderLines(nestedLines, "modules/example/");
        assertNestedAdmonition(paneHolder, "pane");
        paneDom.window.close();

        const searchDom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-search.js",
        }});
        searchDom.window.__KNOTIS_SEARCH_TEST__ = true;
        searchDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        searchDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-search.js")!r}, "utf8"));
        const searchRenderer = searchDom.window.__KnotisSearchTest;
        const searchHolder = searchDom.window.document.createElement("div");
        searchHolder.innerHTML = searchRenderer.renderSnippetLines(lines, "", "modules/example/", []);
        assertAdmonitionBoundaries(searchHolder, "search");
        searchHolder.innerHTML = searchRenderer.renderSnippetLines(nestedLines, "", "modules/example/", []);
        assertNestedAdmonition(searchHolder, "search");
        searchDom.window.close();
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_pane_fence_counts_as_one_budget_line(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const paneDom = new JSDOM("<!DOCTYPE html><html><body data-knotis-offline-preview='true'></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-wikilinks.js",
        }});
        paneDom.window.fetch = async () => ({{ ok: false, status: 404, json: async () => ({{}}) }});
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));
        const renderer = paneDom.window.KnotisSectionRender;
        if (!renderer) {{ console.error("section renderer missing"); process.exit(1); }}

        const lines = [
          "## What scaffolding creates",
          "- intro bullet one",
          "- intro bullet two",
          "- After the command finishes, the folder contains:",
          "    - ```",
          "my-site-folder/",
          "├── docs/",
          "│   ├── index.md",
          "│   ├── section-1/",
          "│   │   └── page-1.md … page-5.md",
          "│   ├── section-2/",
          "│   │   └── page-6.md … page-10.md",
          "│   ├── explore/",
          "│   │   ├── site-graph.md",
          "│   │   ├── glossary.md",
          "│   │   └── content-tags.md",
          "│   └── assets/",
          "├── assets/",
          "├── overrides/",
          "├── site/",
          "├── zensical.toml",
          "    ```",
          "- **[[zensical.toml]]** is the site configuration file.",
          "    - It ships with default Knotis and Zensical settings.",
          "- **[[overrides]]** provides sample page templates.",
        ];
        const kwOffset = lines.findIndex((line) => line.includes("[[zensical.toml]]"));
        if (kwOffset < 0) {{ console.error("fixture missing zensical.toml bullet"); process.exit(1); }}
        const paneConfig = renderer.normalizePaneConfig({{
          initial_lines: 12,
          initial_list_items: 20,
          chunk_lines: 4,
          keyword_own_section: true,
        }});
        const window = renderer.resolveInitialWindow(lines, kwOffset, paneConfig);
        const childIndex = kwOffset + 1;
        if (window.end <= childIndex) {{
          console.error("pane budget should include the child bullet after zensical.toml, got end=" + window.end + " childIndex=" + childIndex);
          process.exit(1);
        }}
        const html = renderer.renderInitialWindow(lines, kwOffset, {{
          paneConfig,
          keyword: "zensical.toml",
        }});
        if (!html.includes("It ships with default Knotis and Zensical settings.")) {{
          console.error("pane render omitted nested zensical.toml child bullet: " + html);
          process.exit(1);
        }}
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_pane_numbered_code_preserves_page_scroll_geometry(self) -> None:
        css = (ASSETS_DIR / "knotis-pane.css").read_text(encoding="utf-8")
        self.assertNotIn(".wl-pane-code-line", css)
        self.assertIn("min-width: 100%", css)
        self.assertIn("width: max-content", css)
        self.assertIn("overflow-wrap: normal", css)
        self.assertIn("overflow: visible", css)
        self.assertIn("font-size: 0.75rem", css)
        self.assertIn("font-size: 0.64rem", css)
        self.assertIn("border-radius: 0 0.4rem 0.4rem 0", css)
        self.assertIn("padding: 0.525rem 0.8rem", css)
        self.assertIn("white-space: pre", css)
        self.assertIn("scrollbar-width: none", css)
        self.assertIn(".highlight::-webkit-scrollbar", css)
        self.assertIn(".linenodiv pre > .normal", css)
        self.assertIn("display: block", css)
        self.assertIn("--wl-rendered-code-line-height", css)
        self.assertIn("height: 1.5rem", css)
        self.assertIn("width: 1.5rem", css)
        self.assertIn("background: var(--md-code-bg-color", css)

    def test_pane_ordered_lists_under_bullets_use_ordered_counter_depth(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const paneDom = new JSDOM("<!DOCTYPE html><html><body data-knotis-offline-preview='true'></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-wikilinks.js",
        }});
        paneDom.window.fetch = async () => ({{ ok: false, status: 404, json: async () => ({{}}) }});
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));
        const renderer = paneDom.window.KnotisSectionRender;

        const lines = [
          "# [[Graphs]]",
          "- There are three different graphs:",
          "    1. [[Site graph]]: The site graph shows the whole course at a glance.",
          "    2. [[Page graph]]: The page graph is for active page only.",
          "    3. [[Concept graph]]: The concept graph centers on one concept.",
          "- ![Pane showing details](pane.png)",
          "    1. This is the pane of \\"linear regression\\" wikilink.",
          "        1. This part shows the number of mentions and pages including this concept.",
          "    2. Shows the [[concept graph]] of \\"linear regression\\" wikilink.",
          "        1. Clicking on the graph preview expands the graph.",
          "    3. Return button: returns to that graph.",
          "        1. Site graph appears because the wikilink was clicked on the site graph.",
        ];
        const holder = paneDom.window.document.createElement("div");
        holder.innerHTML = renderer.renderLines(lines, "resources/site-guide/graphs/", {{ keyword: "concept graph" }});
        const topOrderedLists = [...holder.querySelectorAll("ul > li > ol")];
        if (topOrderedLists.length < 2) {{
          console.error("expected ordered children under bullet parents: " + holder.innerHTML);
          process.exit(1);
        }}
        for (const ol of topOrderedLists) {{
          if (!ol.getAttribute("style").includes("counter-reset:level1")) {{
            console.error("ordered child of bullet should reset level1: " + ol.outerHTML);
            process.exit(1);
          }}
        }}
        const nestedOrderedLists = [...holder.querySelectorAll("ul > li > ol > li > ol")];
        if (!nestedOrderedLists.length) {{
          console.error("expected nested ordered children under ordered pane items: " + holder.innerHTML);
          process.exit(1);
        }}
        for (const ol of nestedOrderedLists) {{
          if (!ol.getAttribute("style").includes("counter-reset:level2")) {{
            console.error("ordered child of ordered item should reset level2: " + ol.outerHTML);
            process.exit(1);
          }}
        }}

        const imageThenSteps = [
          "## [[Search]] view",
          "- ![Search view](search.png)",
          "1. Click on the Search bar in the header.",
          "    1. Use the keyboard shortcut.",
          "2. The search cards show the module name.",
        ];
        holder.innerHTML = renderer.renderLines(imageThenSteps, "resources/site-guide/search/", {{ keyword: "search" }});
        const topLists = [...holder.children].filter((node) => ["UL", "OL"].includes(node.tagName));
        if (topLists.length !== 2 || topLists[0].tagName !== "UL" || topLists[1].tagName !== "OL") {{
          console.error("top-level ordered steps after an image bullet should be a sibling ol: " + holder.innerHTML);
          process.exit(1);
        }}
        if (!topLists[1].textContent.includes("Click on the Search bar")) {{
          console.error("first ordered step moved out of the top-level ol: " + holder.innerHTML);
          process.exit(1);
        }}
        const nestedShortcutList = topLists[1].querySelector(":scope > li > ol");
        if (!nestedShortcutList || !nestedShortcutList.getAttribute("style").includes("counter-reset:level2")) {{
          console.error("nested shortcut step should remain an ordered child of step 1: " + holder.innerHTML);
          process.exit(1);
        }}

        const workflowLines = [
          "## [[How to work with codes]]?",
          " - We never type the codes or variables inside the codes.",
          "    - **The workflow:**",
          "        1. Imagine we need a frequency table.",
          "        2. Find the frequency table model code.",
          "        3. Paste it under the working space.",
          "            1. Hit ++enter++ and add a blank line.",
        ];
        holder.innerHTML = renderer.renderLines(workflowLines, "modules/02.-introduction-to-data-and-scripting/", {{
          keyword: "search",
          sourceLines: workflowLines,
          baseLineIndex: 0,
        }});
        const workflowItem = holder.querySelector('[data-nav-text="the workflow:"]');
        const workflowSteps = workflowItem?.querySelector(":scope > ol");
        if (!workflowSteps || !workflowSteps.children[0]?.textContent.includes("Imagine we need")) {{
          console.error("nested workflow steps should render as an ordered child list: " + holder.innerHTML);
          process.exit(1);
        }}
        if (!workflowSteps.getAttribute("style").includes("counter-reset:level1")) {{
          console.error("workflow steps under bullets should use ordered counter level1: " + workflowSteps.outerHTML);
          process.exit(1);
        }}
        const workflowSubsteps = workflowSteps.querySelector(":scope > li > ol");
        if (!workflowSubsteps || !workflowSubsteps.getAttribute("style").includes("counter-reset:level2")) {{
          console.error("workflow substeps should use ordered counter level2: " + holder.innerHTML);
          process.exit(1);
        }}
        paneDom.window.close();
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_reference_pane_marks_reference_meta(self) -> None:
        js = (ASSETS_DIR / "knotis-wikilinks.js").read_text(encoding="utf-8")
        self.assertIn("const referenceMetaLabels = getKeywordNodeStats(graphData, keyword)", js)
        self.assertIn('referenceMetaLabels.push("Reference")', js)
        self.assertIn("buildPaneMetaRow(referenceMetaLabels)", js)
        self.assertIn("const hasReference = Array.isArray(references[keyword])", js)
        self.assertIn('if (!isContentTagPane && opts.hasReference) metaLabels.push("Reference")', js)
        self.assertIn("{ ...resolvedOpts, hasReference }", js)

    def test_slide_code_preserves_lines_and_uses_horizontal_scroll(self) -> None:
        css = (ASSETS_DIR / "knotis-slides.css").read_text(encoding="utf-8")
        js = (ASSETS_DIR / "knotis-slides.js").read_text(encoding="utf-8")
        self.assertIn(".knotis-slides__preview-body-inner", css)
        self.assertIn("display: block !important", css)
        self.assertIn("overflow-x: auto !important", css)
        self.assertIn("min-width: 100% !important", css)
        self.assertIn("overflow-wrap: normal", css)
        self.assertIn("white-space: pre", css)
        self.assertNotIn("white-space: pre-wrap", css)
        self.assertGreaterEqual(js.count('table, .highlight, pre"'), 2)
        self.assertIn("upgradeSlideCodeBlocks(body)", js)
        self.assertIn('highlight.querySelectorAll(".linenodiv pre")', js)
        self.assertIn('anchor.replaceWith(anchor.textContent || "")', js)
        self.assertIn("highlight.appendChild(nav)", js)
        self.assertIn('button.removeAttribute("data-clipboard-target")', js)
        self.assertIn('event.target.closest?.(".knotis-slides__code-copy")', js)
        self.assertIn(".highlight > .knotis-slides__code-nav", css)
        self.assertIn(".knotis-slides__code-copy::after", css)
        self.assertIn(".highlighttable .linenodiv pre > .normal", css)
        self.assertIn("flex: 0 0 1.5em", css)
        self.assertIn("justify-content: flex-end", css)
        self.assertIn('[data-knotis-slides-engine="webkit"] .highlighttable', css)

    def test_safari_code_markers_and_gutters_are_browser_scoped(self) -> None:
        content_css = (ASSETS_DIR / "knotis-content.css").read_text(encoding="utf-8")
        pane_css = (ASSETS_DIR / "knotis-pane.css").read_text(encoding="utf-8")
        slides_css = (ASSETS_DIR / "knotis-slides.css").read_text(encoding="utf-8")

        self.assertIn(':root[data-knotis-webkit-engine="true"]', content_css)
        self.assertIn("li > .highlight:first-child:not(:has(.highlighttable))", content_css)
        self.assertIn("list-style-position: outside !important", content_css)
        self.assertIn(
            ':root[data-knotis-webkit-engine="true"] .wl-pane-list-item > .wl-sec-code-block--rendered:first-child',
            pane_css,
        )
        self.assertIn(
            ':root[data-knotis-webkit-engine="true"] .wl-sec-code-block--rendered .wl-sec-code__rendered .highlighttable .linenodiv pre',
            pane_css,
        )
        self.assertIn(
            '.knotis-slides[data-knotis-slides-engine="webkit"] :is(.knotis-slides__card, .knotis-slides__measure, .knotis-slides__preview-body-inner) ul > li.knotis-slides__markerless-block > .highlight:first-child',
            slides_css,
        )
        self.assertIn("transform: none", slides_css)

    def test_iframe_media_support_assets(self) -> None:
        content_css = (ASSETS_DIR / "knotis-content.css").read_text(encoding="utf-8")
        media_css = (ASSETS_DIR / "knotis-media.css").read_text(encoding="utf-8")
        pane_css = (ASSETS_DIR / "knotis-pane.css").read_text(encoding="utf-8")
        slides_js = (ASSETS_DIR / "knotis-slides.js").read_text(encoding="utf-8")
        wikilinks_js = (ASSETS_DIR / "knotis-wikilinks.js").read_text(encoding="utf-8")

        self.assertIn(":is(img, iframe", content_css)
        self.assertIn("p:first-child > :is(img, iframe, .knotis-media-embed-fallback):only-child", content_css)
        self.assertIn("[data-knotis-slide-marker] + :is(img, iframe, .knotis-media-embed-fallback)", content_css)
        self.assertIn(".knotis-media-embed-fallback", media_css)
        self.assertIn('iframe[src*="youtube.com/embed"]', media_css)
        self.assertIn('iframe[src*="drive.google.com/file/d/"]', media_css)
        self.assertIn(".wl-sec-html-embed", pane_css)
        self.assertIn('node.matches?.("img, iframe', slides_js)
        self.assertIn('querySelector?.("img, iframe', slides_js)
        self.assertIn(".knotis-slides__card :is(img, iframe", slides_js)
        self.assertIn("function collectRawMediaBlock", wikilinks_js)
        self.assertIn("wl-sec-html-embed", wikilinks_js)

    def test_pane_renderer_preserves_multiline_iframe_blocks(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const paneDom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-wikilinks.js",
        }});
        paneDom.window.fetch = async () => ({{ ok: false, status: 404, json: async () => ({{}}) }});
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));

        const lines = [
          '- <iframe id="ytplayer" type="text/html" width="640" height="360"',
          '  src="https://www.youtube.com/embed/M7lc1UVf-VE?autoplay=1&origin=http://example.com"',
          '  frameborder="0"></iframe>',
        ];
        const rendered = paneDom.window.KnotisSectionRender.renderLines(lines, "modules/example/");
        const holder = paneDom.window.document.createElement("div");
        holder.innerHTML = rendered;
        const wrapper = holder.querySelector(".wl-sec-html-embed");
        const iframe = wrapper?.querySelector("iframe");
        if (!wrapper || !iframe) {{
          console.error("pane iframe block did not render: " + rendered);
          process.exit(1);
        }}
        if (wrapper.textContent.trim().startsWith("- ")) {{
          console.error("pane iframe block should strip the source list marker: " + wrapper.innerHTML);
          process.exit(1);
        }}
        if (iframe.getAttribute("src") !== "https://www.youtube.com/embed/M7lc1UVf-VE") {{
          console.error("pane iframe src should remove YouTube autoplay/origin: " + wrapper.innerHTML);
          process.exit(1);
        }}
        if (holder.querySelector(".wl-sec-html-table")) {{
          console.error("iframe block should not use table wrapper: " + rendered);
          process.exit(1);
        }}
        paneDom.window.close();
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_pane_renderer_preserves_multiline_video_blocks(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const paneDom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-wikilinks.js",
        }});
        paneDom.window.fetch = async () => ({{ ok: false, status: 404, json: async () => ({{}}) }});
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
        paneDom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));

        const lines = [
          '- <video width="640" height="360" controls>',
          '  <source src="/assets/attachments/analyzing-arguments.mp4" type="video/mp4">',
          '</video>',
        ];
        const rendered = paneDom.window.KnotisSectionRender.renderLines(lines, "features/video-controls-feature/");
        const holder = paneDom.window.document.createElement("div");
        holder.innerHTML = rendered;
        const wrapper = holder.querySelector(".wl-sec-html-embed");
        const video = wrapper?.querySelector("video");
        const source = video?.querySelector("source");
        if (!wrapper || !video || !source) {{
          console.error("pane video block did not render: " + rendered);
          process.exit(1);
        }}
        if (wrapper.textContent.trim().startsWith("- ")) {{
          console.error("pane video block should strip the source list marker: " + wrapper.innerHTML);
          process.exit(1);
        }}
        if (source.getAttribute("src") !== "/assets/attachments/analyzing-arguments.mp4") {{
          console.error("pane video source changed unexpectedly: " + wrapper.innerHTML);
          process.exit(1);
        }}
        if (holder.querySelector(".wl-sec-html-table")) {{
          console.error("video block should not use table wrapper: " + rendered);
          process.exit(1);
        }}
        paneDom.window.close();
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_content_css_exposes_heading_customization_tokens(self) -> None:
        css = (ASSETS_DIR / "knotis-content.css").read_text(encoding="utf-8")

        for token in (
            "--knotis-heading-level-1-size",
            "--knotis-heading-level-2-size",
            "--knotis-heading-level-3-size",
            "--knotis-heading-top-level-gap",
            "--knotis-heading-sibling-gap",
            "--knotis-heading-child-gap",
            "--knotis-heading-content-gap",
            "--knotis-heading-content-start-gap",
            "--knotis-heading-guide-offset",
            "--knotis-markerless-block-child-gap",
        ):
            self.assertIn(token, css)

        self.assertIn("margin-top: var(--knotis-heading-sibling-gap)", css)
        self.assertIn("margin-top: var(--knotis-heading-child-gap)", css)
        self.assertIn("margin-bottom: var(--knotis-heading-content-gap)", css)
        self.assertIn("margin-top: var(--knotis-markerless-block-child-gap)", css)
        self.assertIn(":first-child + :is(ul, ol)", css)
        self.assertIn("margin-bottom: 0 !important", css)
        self.assertIn("line-height: 0", css)
        self.assertIn("line-height: var(--knotis-list-bullet-line-height)", css)
        self.assertNotIn("list-style-position: inside !important", css)

    def test_content_tag_css_owns_content_tag_tokens_and_rules(self) -> None:
        palette_css = (ASSETS_DIR / "knotis-palette.css").read_text(encoding="utf-8")
        content_tags_css = (ASSETS_DIR / "knotis-content-tags.css").read_text(encoding="utf-8")
        wikilinks_css = (ASSETS_DIR / "knotis-wikilinks.css").read_text(encoding="utf-8")

        self.assertIn("--content-tag-1", content_tags_css)
        self.assertIn("--knotis-content-tag-text", content_tags_css)
        self.assertIn(".content-tag {", content_tags_css)
        self.assertIn(".wikilink-content-tags-page", content_tags_css)
        self.assertIn("color-mix(in srgb, var(--knotis-content-tag-text, #b54708) 18%, transparent)", content_tags_css)
        self.assertIn("color-mix(in srgb, var(--knotis-content-tag-text, #b54708) 28%, transparent)", content_tags_css)
        self.assertNotIn("color-mix(in srgb, #f79009", content_tags_css)
        self.assertNotIn("--content-tag-1", palette_css)
        self.assertNotIn("--knotis-content-tag-text", palette_css)
        self.assertNotIn(".content-tag {", wikilinks_css)
        self.assertNotIn(".wikilink-content-tags-page", wikilinks_css)

    def test_content_tag_colors_and_order_use_graph_meta(self) -> None:
        js = (ASSETS_DIR / "knotis-wikilinks.js").read_text(encoding="utf-8")

        self.assertIn("const FALLBACK_CONTENT_TAG_ORDER", js)
        self.assertIn("function normalizeContentTagOrder", js)
        self.assertIn("order: normalizeContentTagOrder(raw.order)", js)
        self.assertIn("compareContentTagNames(a, b, cfg.order)", js)
        self.assertIn('contentTagColorScheme(contentTagColors, "default")', js)
        self.assertIn('contentTagColorScheme(contentTagColors, "slate")', js)
        self.assertIn('":root "', js)
        self.assertIn("'[data-md-color-scheme=\"slate\"] '", js)
        self.assertNotIn("NAV_TAG_PREFERRED_ORDER", js)

    def test_wikilink_css_owns_wikilink_tokens(self) -> None:
        palette_css = (ASSETS_DIR / "knotis-palette.css").read_text(encoding="utf-8")
        wikilinks_css = (ASSETS_DIR / "knotis-wikilinks.css").read_text(encoding="utf-8")
        js = (ASSETS_DIR / "knotis-wikilinks.js").read_text(encoding="utf-8")

        self.assertIn("--knotis-wikilink-color", wikilinks_css)
        self.assertIn("--knotis-wikilink-text", wikilinks_css)
        self.assertIn("--knotis-wikilink-hover-background", wikilinks_css)
        self.assertIn("--knotis-wikilink-flash-background", wikilinks_css)
        self.assertIn("--knotis-wikilink-flash-outline", wikilinks_css)
        self.assertNotIn("--knotis-concept-color:", palette_css)
        self.assertNotIn("--knotis-concept-text:", palette_css)
        self.assertNotIn("--knotis-concept", wikilinks_css)
        self.assertIn("color-mix(in srgb, var(--knotis-wikilink-color) 12%, transparent)", wikilinks_css)
        self.assertIn("color-mix(in srgb, var(--knotis-wikilink-color) 28%, transparent)", wikilinks_css)
        self.assertNotIn("color-mix(in srgb, #0197a7", wikilinks_css)
        self.assertIn('wikilink_text: "--knotis-wikilink-text"', js)
        self.assertIn("knotis-wikilink-color-overrides", js)

    def test_pane_card_actions_stay_right_aligned_without_title(self) -> None:
        css = (ASSETS_DIR / "knotis-pane.css").read_text(encoding="utf-8")
        js = (ASSETS_DIR / "knotis-wikilinks.js").read_text(encoding="utf-8")
        self.assertIn("wikilink-card--title-suppressed", js)
        self.assertIn(".wikilink-card__header-actions", css)
        self.assertIn("margin-left: auto", css)
        self.assertIn(".wikilink-card--title-suppressed > .wikilink-card__header", css)
        self.assertIn("float: right", css)
        self.assertIn(".wikilink-card--title-suppressed > .wikilink-card__header + .wikilink-card__body", css)
        self.assertIn("margin-top: 0", css)

    def test_heading_flow_keeps_trailing_footnotes_and_tags_outside_last_section(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        async function runCase(extraTrailingHtml) {{
          const dom = new JSDOM(`<!DOCTYPE html><html><body data-knotis-offline-preview="true">
            <article class="md-content__inner md-typeset">
              <h1 id="__skip">Slide mode Feature</h1>
              <h1 id="video2">video2</h1>
              <ul><li>here is a gif</li></ul>
              <h2 id="video-3">video 3</h2>
              <ul><li>dsadasdas</li></ul>
              ${{extraTrailingHtml}}
            </article>
          </body></html>`, {{
            pretendToBeVisual: true,
            runScripts: "outside-only",
            url: "https://example.test/features/slide-mode-feature/",
          }});
          dom.window.fetch = async (url) => {{
            const href = String(url);
            if (href.includes("graph.json")) {{
              return {{ ok: true, json: async () => ({{ meta: {{ knotis: {{}} }} }}) }};
            }}
            if (href.includes("content-tags.json")) {{
              return {{ ok: true, json: async () => ({{}}) }};
            }}
            return {{ ok: false, status: 404, json: async () => ({{}}) }};
          }};
          dom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-core.js")!r}, "utf8"));
          dom.window.eval(readFileSync({str(ASSETS_DIR / "knotis-wikilinks.js")!r}, "utf8"));
          dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded", {{ bubbles: true }}));
          await new Promise((resolve) => dom.window.setTimeout(resolve, 20));

          const article = dom.window.document.querySelector("article");
          const video3 = article.querySelector("#video-3")?.closest(".heading-flow");
          const body = video3?.querySelector(":scope > .heading-flow__content");
          if (!body || !body.textContent.includes("dsadasdas")) {{
            console.error("video 3 section did not keep its list: " + article.innerHTML);
            process.exit(1);
          }}
          if (body.querySelector(".footnote, .footnotes, .md-footnotes, .md-tags")) {{
            console.error("trailing page blocks should not be inside final heading guide section: " + body.innerHTML);
            process.exit(1);
          }}
          if (extraTrailingHtml.includes("footnote") && !article.querySelector(":scope > .footnote")) {{
            console.error("footnote should remain a page-level child: " + article.innerHTML);
            process.exit(1);
          }}
          if (!article.querySelector(":scope > .md-tags")) {{
            console.error("tags should remain a page-level child: " + article.innerHTML);
            process.exit(1);
          }}
          dom.window.close();
        }}

        await runCase(`<div class="footnote"><hr><ol><li id="fn:1">text</li></ol></div><nav class="md-tags"><span>Features</span></nav>`);
        await runCase(`<nav class="md-tags"><span>Features</span></nav>`);
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def _run_media_script(self, body: str) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";
        const MEDIA_JS = readFileSync({str(ASSETS_DIR / "knotis-media.js")!r}, "utf8");
        const MEDIA_CSS = readFileSync({str(ASSETS_DIR / "knotis-media.css")!r}, "utf8");
        {body}
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_media_upgrades_pane_content_after_pane_event(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <p>No media on the main page.</p>
          </article>
          <aside id="wikilink-pane" class="wikilink-pane">
            <img src="/assets/pane-demo.mp4" alt="video" />
            <img src="/assets/pane-demo.gif" alt="gif" />
          </aside>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.method === "HEAD" && href.endsWith("pane-demo.mp4")) {
            return { ok: true, status: 200, headers: { get: (name) => (String(name).toLowerCase() === "content-type" ? "video/mp4" : null) } };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 206, body: { cancel: async () => {} } };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        win.document.dispatchEvent(new win.CustomEvent("wikilink:pane-content-updated", {
          detail: { pane: win.document.getElementById("wikilink-pane") },
        }));
        let figures = [];
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          figures = [...win.document.querySelectorAll("#wikilink-pane figure.knotis-media")];
          if (figures.length === 2) break;
        }
        if (figures.length !== 2) {
          console.error("expected pane mp4 and gif to upgrade, got " + figures.length + ": " + win.document.getElementById("wikilink-pane").innerHTML);
          process.exit(1);
        }
        const videos = [...win.document.querySelectorAll("#wikilink-pane video")];
        if (videos.length !== 2) {
          console.error("expected both pane media items to become videos, got " + videos.length);
          process.exit(1);
        }
        if (!videos.every((video) => video.controls && video.classList.contains("no-lightbox"))) {
          console.error("pane media videos missing controls/no-lightbox");
          process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_upgrades_slide_content_after_slide_event(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <p>No media on the main page.</p>
          </article>
          <div id="slides" class="knotis-slides knotis-slides--active">
            <section class="knotis-slides__card md-typeset">
              <div class="knotis-slides__body">
                <img src="/assets/slide-clip.mp4" alt="video" width="1200" />
                <img src="/assets/slide-loop.gif" alt="gif" width="900" />
              </div>
            </section>
          </div>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.ImageData = function ImageData(data, width, height) {
          this.data = data;
          this.width = width;
          this.height = height;
        };
        win.HTMLCanvasElement.prototype.getContext = function () {
          return {
            clearRect: () => {},
            putImageData: () => {},
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }),
          };
        };
        win.GifuctJS = {
          parseGIF: () => ({ lsd: { width: 2, height: 2 } }),
          decompressFrames: () => ([{
            delay: 100,
            dims: { left: 0, top: 0, width: 2, height: 2 },
            patch: new Uint8ClampedArray(16),
            disposalType: 0,
          }]),
        };
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.method === "HEAD" && href.endsWith("slide-loop.mp4")) {
            return { ok: false, status: 404 };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 206, body: { cancel: async () => {} } };
          }
          if (href.endsWith("slide-loop.gif")) {
            return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        win.document.dispatchEvent(new win.CustomEvent("knotis:slides-content-updated", {
          detail: { root: win.document.getElementById("slides") },
        }));
        let figures = [];
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          figures = [...win.document.querySelectorAll("#slides figure.knotis-media")];
          if (figures.length === 2 && win.document.querySelector("#slides .knotis-gif-player")) break;
        }
        if (figures.length !== 2) {
          console.error("expected slide mp4 and gif to upgrade, got " + figures.length + ": " + win.document.getElementById("slides").innerHTML);
          process.exit(1);
        }
        const video = win.document.querySelector("#slides video");
        if (!video || !video.controls || !video.classList.contains("no-lightbox")) {
          console.error("slide mp4 did not become controlled video");
          process.exit(1);
        }
        const videoFigure = video.closest("figure.knotis-media");
        if (videoFigure.style.width !== "1200px" || !videoFigure.classList.contains("knotis-media--sized")) {
          console.error("slide mp4 figure did not preserve width: " + videoFigure.outerHTML);
          process.exit(1);
        }
        const gifPlayer = win.document.querySelector("#slides .knotis-gif-player");
        if (!gifPlayer || !gifPlayer.querySelector(".knotis-gif-player__play") || !gifPlayer.querySelector("canvas")) {
          console.error("slide gif did not become controlled canvas player");
          process.exit(1);
        }
        const gifFigure = gifPlayer.closest("figure.knotis-media");
        if (gifFigure.style.width !== "900px" || !gifFigure.classList.contains("knotis-media--sized")) {
          console.error("slide gif figure did not preserve width: " + gifFigure.outerHTML);
          process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_hides_gif_while_upgrade_is_pending(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img id="demo" src="/assets/demo.gif" alt="demo" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.method === "HEAD" && href.endsWith("demo.mp4")) {
            return new Promise(() => {});
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        const img = win.document.getElementById("demo");
        if (img.getAttribute("data-knotis-media-pending") !== "true") {
          console.error("gif should be hidden before async upgrade completes: " + img.outerHTML);
          process.exit(1);
        }
        if (!MEDIA_CSS.includes('img[data-knotis-media-pending="true"]') || !MEDIA_CSS.includes("visibility: hidden")) {
          console.error("pending gif CSS is missing");
          process.exit(1);
        }
        console.log("ok");
        """)

    def test_gif_player_uses_browser_cache_for_gif_bytes(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/cache-test.gif" alt="gif" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.ImageData = function ImageData(data, width, height) {
          this.data = data;
          this.width = width;
          this.height = height;
        };
        win.HTMLCanvasElement.prototype.getContext = function () {
          return {
            clearRect: () => {},
            putImageData: () => {},
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }),
          };
        };
        win.GifuctJS = {
          parseGIF: () => ({ lsd: { width: 2, height: 2 } }),
          decompressFrames: () => ([{
            delay: 100,
            dims: { left: 0, top: 0, width: 2, height: 2 },
            patch: new Uint8ClampedArray(16),
            disposalType: 0,
          }]),
        };
        const requests = [];
        win.fetch = async (url, opts) => {
          const href = String(url);
          requests.push({ href, opts });
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.method === "HEAD" && href.endsWith("cache-test.mp4")) {
            return { ok: false, status: 404 };
          }
          if (href.endsWith("cache-test.gif")) {
            return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        let player = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          player = win.document.querySelector(".knotis-gif-player");
          if (player) break;
        }
        if (!player) {
          console.error("expected GIF player to be built");
          process.exit(1);
        }
        const gifRequest = requests.find((request) => request.href.endsWith("cache-test.gif"));
        if (!gifRequest) {
          console.error("expected a GIF byte fetch");
          process.exit(1);
        }
        if (gifRequest.opts && gifRequest.opts.cache === "no-store") {
          console.error("GIF byte fetch should use normal browser caching");
          process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_upgrades_mp4_image_and_video(self) -> None:
        node = _node()
        jsdom = _jsdom_entry()
        if node is None or jsdom is None:
            self.skipTest("node/jsdom runtime is unavailable")
        script = f"""
        import {{ JSDOM }} from {str(jsdom)!r};
        import {{ readFileSync }} from "node:fs";

        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" width="640" />
            <video src="/assets/other.mp4"></video>
          </article>
        </body></html>`, {{
          runScripts: "outside-only",
          url: "https://example.test/assets/knotis-media.js",
        }});
        const win = dom.window;
        win.fetch = async (url, opts) => {{
          const href = String(url);
          if (href.includes("graph.json")) {{
            return {{
              ok: true,
              json: async () => ({{ meta: {{ knotis: {{ media: {{ enabled: true, captions: false }} }} }} }}),
            }};
          }}
          if (opts && opts.method === "HEAD") {{
            return {{ ok: false, status: 404 }};
          }}
          return {{ ok: false, status: 404 }};
        }};
        win.eval(readFileSync({str(ASSETS_DIR / "knotis-media.js")!r}, "utf8"));
        let videos = [];
        for (let attempt = 0; attempt < 20; attempt += 1) {{
          await new Promise((resolve) => setTimeout(resolve, 50));
          videos = [...win.document.querySelectorAll("video")];
          if (videos.length === 2) break;
        }}
        if (videos.length !== 2) {{
          console.error("expected two video elements, got " + videos.length);
          process.exit(1);
        }}
        for (const video of videos) {{
          if (!video.controls) {{ console.error("missing controls"); process.exit(1); }}
          if (video.preload !== "metadata") {{ console.error("missing preload metadata"); process.exit(1); }}
          if (!video.classList.contains("no-lightbox")) {{ console.error("missing no-lightbox"); process.exit(1); }}
          if (!video.src.includes("#t=0.001")) {{ console.error("missing preview fragment: " + video.src); process.exit(1); }}
        }}
        const figure = win.document.querySelector("figure.knotis-media");
        if (!figure) {{ console.error("missing figure wrapper"); process.exit(1); }}
        console.log("ok");
        """
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_media_blob_fallback_when_range_unsupported(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        const calls = { blobGets: 0 };
        win.URL.createObjectURL = () => "blob:knotis/1";
        win.URL.revokeObjectURL = () => {};
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 200, body: { cancel: async () => {} } };
          }
          if (opts && opts.method === "HEAD") {
            return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === "content-length" ? "1024" : null) } };
          }
          if (href.endsWith(".mp4")) {
            calls.blobGets += 1;
            return { ok: true, status: 200, blob: async () => ({}) };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        let video = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          video = win.document.querySelector("video");
          if (video && video.src.startsWith("blob:")) break;
        }
        if (!video) { console.error("video missing"); process.exit(1); }
        if (!video.src.startsWith("blob:")) { console.error("expected blob src, got " + video.src); process.exit(1); }
        if (!video.src.endsWith("#t=0.001")) { console.error("blob src lost preview fragment: " + video.src); process.exit(1); }
        if (calls.blobGets !== 1) { console.error("expected one blob GET, got " + calls.blobGets); process.exit(1); }
        console.log("ok");
        """)

    def test_media_native_src_when_range_supported(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        const calls = { blobGets: 0 };
        win.URL.createObjectURL = () => "blob:knotis/1";
        win.URL.revokeObjectURL = () => {};
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 206, body: { cancel: async () => {} } };
          }
          if (opts && opts.method === "HEAD") {
            return { ok: true, status: 200, headers: { get: () => "1024" } };
          }
          if (href.endsWith(".mp4")) calls.blobGets += 1;
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const video = win.document.querySelector("video");
        if (!video) { console.error("video missing"); process.exit(1); }
        if (!video.src.includes("/assets/demo.mp4#t=0.001")) { console.error("native src lost: " + video.src); process.exit(1); }
        if (calls.blobGets !== 0) { console.error("unexpected blob GET on range-capable origin"); process.exit(1); }
        console.log("ok");
        """)

    def test_media_blob_fallback_respects_size_cap(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        const calls = { blobGets: 0 };
        win.URL.createObjectURL = () => "blob:knotis/1";
        win.URL.revokeObjectURL = () => {};
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 200, body: { cancel: async () => {} } };
          }
          if (opts && opts.method === "HEAD") {
            return { ok: true, status: 200, headers: { get: () => String(600 * 1024 * 1024) } };
          }
          if (href.endsWith(".mp4")) calls.blobGets += 1;
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const video = win.document.querySelector("video");
        if (!video) { console.error("video missing"); process.exit(1); }
        if (!video.src.includes("/assets/demo.mp4#t=0.001")) { console.error("oversized file should keep native src: " + video.src); process.exit(1); }
        if (calls.blobGets !== 0) { console.error("oversized file must not be buffered"); process.exit(1); }
        console.log("ok");
        """)

    def test_media_caption_probe_uses_original_url_when_blobbed(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.URL.createObjectURL = () => "blob:knotis/1";
        win.URL.revokeObjectURL = () => {};
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: true } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 200, body: { cancel: async () => {} } };
          }
          if (opts && opts.method === "HEAD") {
            return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === "content-length" ? "1024" : null) } };
          }
          if (href.endsWith(".mp4")) {
            return { ok: true, status: 200, blob: async () => ({}) };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        let video = null;
        let track = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          video = win.document.querySelector("video");
          track = win.document.querySelector("track");
          if (video && track && video.src.startsWith("blob:")) break;
        }
        if (!video || !video.src.startsWith("blob:")) { console.error("expected blob video src"); process.exit(1); }
        if (!track) { console.error("track missing"); process.exit(1); }
        const trackSrc = track.getAttribute("src");
        if (!trackSrc.includes("/assets/demo.vtt")) { console.error("track must probe original URL, got " + trackSrc); process.exit(1); }
        if (trackSrc.startsWith("blob:")) { console.error("track src must not be blobbed"); process.exit(1); }
        console.log("ok");
        """)

    def test_media_revokes_blob_urls_for_disconnected_videos(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        const revoked = [];
        win.URL.createObjectURL = () => "blob:knotis/1";
        win.URL.revokeObjectURL = (url) => { revoked.push(url); };
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 200, body: { cancel: async () => {} } };
          }
          if (opts && opts.method === "HEAD") {
            return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === "content-length" ? "1024" : null) } };
          }
          if (href.endsWith(".mp4")) {
            return { ok: true, status: 200, blob: async () => ({}) };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        let video = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          video = win.document.querySelector("video");
          if (video && video.src.startsWith("blob:")) break;
        }
        if (!video || !video.src.startsWith("blob:")) { console.error("blob swap did not happen"); process.exit(1); }
        win.document.querySelector("figure.knotis-media").remove();
        win.document.dispatchEvent(new win.Event("wikilink:pane-content-updated"));
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          if (revoked.length) break;
        }
        if (!revoked.includes("blob:knotis/1")) { console.error("stale blob URL was not revoked: " + revoked.join(",")); process.exit(1); }
        console.log("ok");
        """)

    def test_media_ignores_html_fallback_probe_responses(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: true } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 206, body: { cancel: async () => {} } };
          }
          if (opts && opts.method === "HEAD") {
            // Dev servers can answer 200 + an HTML fallback page for missing
            // files; the probe must treat that as "absent".
            return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null) } };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        await new Promise((resolve) => setTimeout(resolve, 400));
        const video = win.document.querySelector("video");
        if (!video) { console.error("video missing"); process.exit(1); }
        if (win.document.querySelector("track")) {
          console.error("HTML fallback response must not produce a caption track"); process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_caption_candidates_support_video_and_gif_lang_variants(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
          runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const internals = win.KnotisMediaInternals;
        if (typeof internals.captionCandidates !== "function") { console.error("captionCandidates missing"); process.exit(1); }
        function urls(list) { return list.map((c) => c.url).join(","); }
        const mp4Plain = internals.captionCandidates("/assets/demo.mp4");
        if (urls(mp4Plain) !== "/assets/demo.vtt") { console.error("mp4 plain candidates wrong: " + urls(mp4Plain)); process.exit(1); }
        const mp4Lang = internals.captionCandidates("/assets/demo.en.mp4");
        if (urls(mp4Lang) !== "/assets/demo.en.vtt,/assets/demo.vtt") { console.error("mp4 lang candidates wrong: " + urls(mp4Lang)); process.exit(1); }
        const gifPlain = internals.captionCandidates("/assets/demo.gif");
        if (urls(gifPlain) !== "/assets/demo.vtt") { console.error("gif plain candidates wrong: " + urls(gifPlain)); process.exit(1); }
        const gifLang = internals.captionCandidates("/assets/demo.en.gif");
        if (urls(gifLang) !== "/assets/demo.en.vtt,/assets/demo.vtt") { console.error("gif lang candidates wrong: " + urls(gifLang)); process.exit(1); }
        console.log("ok");
        """)

    def test_media_normalizes_remote_video_iframes(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <iframe id="ytplayer" type="text/html" width="640" height="360"
              src="https://www.youtube.com/embed/M7lc1UVf-VE?autoplay=1&origin=http://example.com"
              frameborder="0"></iframe>
            <iframe id="drive"
              src="https://drive.google.com/file/d/1aDezJtGTxYOySem3_7LIfvoMxg9g2z91/view"
              width="640"
              height="360"></iframe>
            <iframe id="other" src="https://example.com/embed/video"></iframe>
          </article>
        </body></html>`, {
          runScripts: "outside-only", url: "https://notes.example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const youtube = win.document.getElementById("ytplayer");
        const drive = win.document.getElementById("drive");
        const other = win.document.getElementById("other");
        if (youtube.src !== "https://www.youtube.com/embed/M7lc1UVf-VE") {
          console.error("YouTube iframe origin/autoplay was not removed: " + youtube.src);
          process.exit(1);
        }
        if (!youtube.getAttribute("allow").includes("encrypted-media") || !youtube.hasAttribute("allowfullscreen")) {
          console.error("YouTube iframe missing player permissions: " + youtube.outerHTML);
          process.exit(1);
        }
        if (drive.src !== "https://drive.google.com/file/d/1aDezJtGTxYOySem3_7LIfvoMxg9g2z91/preview") {
          console.error("Drive iframe should use preview URL: " + drive.src);
          process.exit(1);
        }
        if (!drive.getAttribute("allow").includes("fullscreen") || !drive.classList.contains("no-lightbox")) {
          console.error("Drive iframe missing normalized attrs: " + drive.outerHTML);
          process.exit(1);
        }
        if (other.getAttribute("data-knotis-media-upgraded") === "true") {
          console.error("unrecognized iframe should not be upgraded");
          process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_remote_iframe_internals(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
          runScripts: "outside-only", url: "vscode-webview://preview.example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const internals = win.KnotisMediaInternals;
        if (internals.remoteVideoIframeProvider("https://www.youtube.com/embed/M7lc1UVf-VE") !== "youtube") {
          console.error("YouTube embed provider not detected"); process.exit(1);
        }
        if (internals.remoteVideoIframeProvider("https://drive.google.com/file/d/abc123/view") !== "drive") {
          console.error("Drive view provider not detected"); process.exit(1);
        }
        if (internals.remoteVideoIframeProvider("https://www.youtube.com/watch?v=M7lc1UVf-VE") !== "") {
          console.error("raw YouTube watch URLs are not iframe embeds"); process.exit(1);
        }
        const normalized = internals.normalizeRemoteIframeSrc(
          "https://www.youtube.com/embed/M7lc1UVf-VE?autoplay=1&origin=http://example.com",
          "youtube",
        );
        if (normalized !== "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE") {
          console.error("VS Code YouTube iframe should use nocookie and remove origin/autoplay: " + normalized);
          process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_replaces_provider_iframes_with_fallback_on_non_http_origin(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body data-knotis-offline-preview="true">
          <article class="md-content__inner md-typeset">
            <iframe id="ytplayer" type="text/html" width="640" height="360"
              src="https://www.youtube-nocookie.com/embed/M7lc1UVf-VE"
              frameborder="0"></iframe>
            <iframe id="drive"
              src="https://drive.google.com/file/d/1aDezJtGTxYOySem3_7LIfvoMxg9g2z91/preview"
              width="640"
              height="360"></iframe>
            <iframe id="other" src="https://example.com/embed/video"></iframe>
          </article>
        </body></html>`, {
          runScripts: "outside-only", url: "vscode-webview://preview.example.test/index.html",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (win.document.getElementById("ytplayer") || win.document.getElementById("drive")) {
          console.error("provider iframes must not survive on a non-http origin (no Referer -> YouTube Error 153)");
          process.exit(1);
        }
        const fallbacks = [...win.document.querySelectorAll("a.knotis-media-embed-fallback")];
        if (fallbacks.length !== 2) {
          console.error("expected two fallback cards, got " + fallbacks.length);
          process.exit(1);
        }
        const youtube = fallbacks.find((a) => a.href.includes("youtube.com/watch"));
        if (!youtube || youtube.href !== "https://www.youtube.com/watch?v=M7lc1UVf-VE") {
          console.error("YouTube fallback should link to the watch page: " + (youtube && youtube.href));
          process.exit(1);
        }
        const thumb = youtube.querySelector("img");
        if (!thumb || thumb.src !== "https://img.youtube.com/vi/M7lc1UVf-VE/hqdefault.jpg") {
          console.error("YouTube fallback should show the video thumbnail: " + (thumb && thumb.src));
          process.exit(1);
        }
        if (!youtube.textContent.includes("Watch on YouTube")) {
          console.error("YouTube fallback missing label: " + youtube.textContent);
          process.exit(1);
        }
        if (youtube.target !== "_blank" || !(youtube.rel || "").includes("noopener")) {
          console.error("fallback links must open externally: target=" + youtube.target + " rel=" + youtube.rel);
          process.exit(1);
        }
        const drive = fallbacks.find((a) => a.href.includes("drive.google.com"));
        if (!drive || drive.href !== "https://drive.google.com/file/d/1aDezJtGTxYOySem3_7LIfvoMxg9g2z91/view") {
          console.error("Drive fallback should link to the shareable view page: " + (drive && drive.href));
          process.exit(1);
        }
        if (!drive.textContent.includes("Open in Google Drive")) {
          console.error("Drive fallback missing label: " + drive.textContent);
          process.exit(1);
        }
        const other = win.document.getElementById("other");
        if (!other || other.getAttribute("data-knotis-media-upgraded") === "true") {
          console.error("unrelated iframe must stay untouched");
          process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_parse_vtt_cues_extracts_timestamps_and_text(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
          runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const internals = win.KnotisMediaInternals;
        if (typeof internals.parseVttCues !== "function") { console.error("parseVttCues missing"); process.exit(1); }
        const vtt = [
          "WEBVTT",
          "",
          "1",
          "00:00:02.960 --> 00:00:09.519",
          "viewpoints work together to better",
          "understand an issue. So when we compare",
          "",
          "2",
          "00:00:07.200 --> 00:00:16.800 line:90%",
          "sense, an argument is a cooperative",
          "effort in which people with different",
          "",
        ].join("\\n");
        const cues = internals.parseVttCues(vtt);
        if (cues.length !== 2) { console.error("expected 2 cues, got " + cues.length); process.exit(1); }
        if (cues[0].startTime !== 2.96 || cues[0].endTime !== 9.519) {
          console.error("cue 0 timing wrong: " + JSON.stringify(cues[0])); process.exit(1);
        }
        if (cues[0].text !== "viewpoints work together to better\\nunderstand an issue. So when we compare") {
          console.error("cue 0 text wrong: " + cues[0].text); process.exit(1);
        }
        if (cues[1].startTime !== 7.2 || cues[1].endTime !== 16.8) {
          console.error("cue 1 timing (with cue settings after end time) wrong: " + JSON.stringify(cues[1])); process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_active_cue_text_uses_clamped_overlap(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
          runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const internals = win.KnotisMediaInternals;
        if (typeof internals.activeCueText !== "function") { console.error("activeCueText missing"); process.exit(1); }
        const cues = internals.clampCueList([
          { startTime: 2.96, endTime: 9.519, text: "first" },
          { startTime: 7.2, endTime: 16.8, text: "second" },
        ]);
        if (internals.activeCueText(cues, 5) !== "first") { console.error("expected first cue active at t=5"); process.exit(1); }
        if (internals.activeCueText(cues, 8) !== "second") {
          console.error("clamp should hand t=8 to the second cue: " + internals.activeCueText(cues, 8)); process.exit(1);
        }
        if (internals.activeCueText(cues, 20) !== "") { console.error("expected no active cue after the last cue ends"); process.exit(1); }
        if (internals.activeCueText(null, 5) !== "") { console.error("null cues should yield empty string"); process.exit(1); }
        console.log("ok");
        """)

    def test_media_clamp_cue_list_prevents_overlap(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
          runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const internals = win.KnotisMediaInternals;
        if (!internals || typeof internals.clampCueList !== "function") {
          console.error("KnotisMediaInternals.clampCueList missing"); process.exit(1);
        }
        // Rolling ASR cues from analyzing-arguments.vtt: each starts before the previous ends.
        const rolling = [
          { startTime: 2.96, endTime: 9.519 },
          { startTime: 7.2, endTime: 16.8 },
          { startTime: 14.16, endTime: 23.119 },
        ];
        internals.clampCueList(rolling);
        if (rolling[0].endTime !== 7.2) { console.error("cue 0 not clamped: " + rolling[0].endTime); process.exit(1); }
        if (rolling[1].endTime !== 14.16) { console.error("cue 1 not clamped: " + rolling[1].endTime); process.exit(1); }
        if (rolling[2].endTime !== 23.119) { console.error("last cue must be untouched"); process.exit(1); }
        const unsorted = [
          { startTime: 7.2, endTime: 16.8 },
          { startTime: 2.96, endTime: 9.519 },
        ];
        internals.clampCueList(unsorted);
        if (unsorted[1].endTime !== 7.2) { console.error("unsorted input not clamped by time order"); process.exit(1); }
        const contained = [
          { startTime: 5, endTime: 20 },
          { startTime: 5, endTime: 7 },
        ];
        internals.clampCueList(contained);
        for (const cue of contained) {
          if (cue.endTime <= cue.startTime) { console.error("clamp produced non-positive cue duration"); process.exit(1); }
        }
        console.log("ok");
        """)

    def test_media_hoists_solo_paragraph_media_in_list_item(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset"><ul>
            <li><p><img src="/assets/one.mp4" alt="a"></p></li>
            <li><p><a href="/assets/two.mp4"><img src="/assets/two.mp4" alt="b"></a></p></li>
            <li><p>Watch <img src="/assets/three.mp4" alt="c"> now</p></li>
          </ul></article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 206, body: { cancel: async () => {} } };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        let items = [];
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          items = [...win.document.querySelectorAll("li")];
          if (win.document.querySelectorAll("figure.knotis-media").length === 3) break;
        }
        if (win.document.querySelectorAll("figure.knotis-media").length !== 3) {
          console.error("expected 3 upgraded figures"); process.exit(1);
        }
        for (const index of [0, 1]) {
          const li = items[index];
          if (!li.querySelector(":scope > figure.knotis-media:first-child")) {
            console.error("li " + index + " missing hoisted figure: " + li.innerHTML); process.exit(1);
          }
          if (li.querySelector("p") || li.querySelector("a")) {
            console.error("li " + index + " kept solo wrapper: " + li.innerHTML); process.exit(1);
          }
        }
        const mixed = items[2];
        if (!mixed.querySelector(":scope > p figure.knotis-media")) {
          console.error("non-solo paragraph must keep figure inline: " + mixed.innerHTML); process.exit(1);
        }
        if (!mixed.textContent.includes("Watch") || !mixed.textContent.includes("now")) {
          console.error("non-solo paragraph lost surrounding text"); process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_rebuilds_cloned_players_in_slides(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset"><p>page</p></article>
          <div id="slides" class="knotis-slides">
            <section class="md-typeset">
              <figure class="knotis-media">
                <div class="knotis-gif-player knotis-media__element" tabindex="0"
                     data-knotis-media-upgraded="true"
                     data-knotis-gif-src="/assets/anim.gif"
                     data-knotis-gif-alt="clip"></div>
              </figure>
              <figure class="knotis-media">
                <video data-knotis-media-upgraded="true" src="/assets/clip.mp4#t=0.001" controls></video>
                <button class="knotis-media__rate" type="button">1×</button>
              </figure>
            </section>
          </div>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.ImageData = function ImageData(data, width, height) {
          this.data = data; this.width = width; this.height = height;
        };
        win.HTMLCanvasElement.prototype.getContext = function () {
          return {
            clearRect: () => {},
            putImageData: () => {},
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(16), width: 2, height: 2 }),
          };
        };
        win.GifuctJS = {
          parseGIF: () => ({ lsd: { width: 2, height: 2 } }),
          decompressFrames: () => ([{
            delay: 100,
            dims: { left: 0, top: 0, width: 2, height: 2 },
            patch: new Uint8ClampedArray(16),
            disposalType: 0,
          }]),
        };
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.method === "HEAD") {
            return { ok: false, status: 404 };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 206, body: { cancel: async () => {} } };
          }
          if (href.endsWith("anim.gif")) {
            return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        win.document.dispatchEvent(new win.Event("wikilink:pane-content-updated"));
        let rebuilt = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          rebuilt = win.document.querySelector("#slides .knotis-gif-player canvas");
          if (rebuilt) break;
        }
        if (!rebuilt) {
          console.error("cloned gif player was not rebuilt: " + win.document.getElementById("slides").innerHTML);
          process.exit(1);
        }
        const player = rebuilt.closest(".knotis-gif-player");
        if (!player.querySelector(".knotis-gif-player__play")) {
          console.error("rebuilt player missing controls"); process.exit(1);
        }
        if (player.getAttribute("data-knotis-gif-src") !== "/assets/anim.gif") {
          console.error("rebuilt player must re-stamp its gif src for the next clone cycle"); process.exit(1);
        }
        if (win.document.querySelectorAll("#slides figure.knotis-media").length !== 2) {
          console.error("figure count changed during rebuild"); process.exit(1);
        }
        // Cloned video: dead rate button must be replaced with a live one.
        const video = win.document.querySelector("#slides video");
        const rate = video.closest("figure.knotis-media").querySelector(".knotis-media__rate");
        if (!rate) { console.error("video rate button missing after rewire"); process.exit(1); }
        rate.click();
        if (video.playbackRate !== 1.5) {
          console.error("rewired rate button is not live: playbackRate=" + video.playbackRate); process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_gif_menu_item_structure(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
          runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const internals = win.KnotisMediaInternals;
        if (typeof internals.createGifMenuItem !== "function") {
          console.error("createGifMenuItem missing"); process.exit(1);
        }
        const withSub = internals.createGifMenuItem("<svg></svg>", "Captions", "English");
        if (!withSub.button.classList.contains("knotis-gif-player__menu-item")) {
          console.error("menu item class missing"); process.exit(1);
        }
        if (!withSub.button.querySelector(".knotis-gif-player__menu-icon svg")) {
          console.error("menu item icon missing"); process.exit(1);
        }
        if (!withSub.button.textContent.includes("Captions") || !withSub.button.textContent.includes("English")) {
          console.error("menu item labels wrong: " + withSub.button.textContent); process.exit(1);
        }
        if (!withSub.sub || !withSub.sub.classList.contains("knotis-gif-player__menu-sub")) {
          console.error("sublabel handle missing"); process.exit(1);
        }
        withSub.sub.textContent = "Off";
        if (!withSub.button.textContent.includes("Off")) {
          console.error("sublabel not live"); process.exit(1);
        }
        const noSub = internals.createGifMenuItem("<svg></svg>", "Download");
        if (noSub.sub !== null) { console.error("sub should be null without subText"); process.exit(1); }
        if (noSub.button.querySelector(".knotis-gif-player__menu-sub")) {
          console.error("sublabel element should not exist without subText"); process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_gif_player_keyboard_controls(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM("<!DOCTYPE html><html><body><div id='player' tabindex='0'><input type='range'></div></body></html>", {
          runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js",
        });
        const win = dom.window;
        win.fetch = async () => ({ ok: false, status: 404 });
        win.eval(MEDIA_JS);
        const internals = win.KnotisMediaInternals;
        if (!internals || typeof internals.attachGifKeyboardControls !== "function") {
          console.error("KnotisMediaInternals.attachGifKeyboardControls missing"); process.exit(1);
        }
        const container = win.document.getElementById("player");
        const calls = [];
        internals.attachGifKeyboardControls(container, {
          togglePlay: () => calls.push("toggle"),
          stepFrame: (delta) => calls.push("step:" + delta),
          goToStart: () => calls.push("home"),
        });
        function press(key, target) {
          const event = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
          (target || container).dispatchEvent(event);
          return event;
        }
        const space = press(" ");
        press("Enter");
        press("ArrowRight");
        press("ArrowLeft");
        press("Home");
        const ignored = press("a");
        if (calls.join(",") !== "toggle,toggle,step:1,step:-1,home") {
          console.error("keyboard wiring wrong: " + calls.join(",")); process.exit(1);
        }
        if (!space.defaultPrevented) { console.error("handled keys must preventDefault"); process.exit(1); }
        if (ignored.defaultPrevented) { console.error("unhandled keys must not preventDefault"); process.exit(1); }
        const before = calls.length;
        press(" ", container.querySelector("input"));
        if (calls.length !== before) {
          console.error("keys targeting child controls must be ignored"); process.exit(1);
        }
        console.log("ok");
        """)

    def test_media_video_rate_button_cycles_playback_rate(self) -> None:
        self._run_media_script("""
        const dom = new JSDOM(`<!DOCTYPE html><html><body>
          <article class="md-content__inner md-typeset">
            <img src="/assets/demo.mp4" alt="clip" />
          </article>
        </body></html>`, { runScripts: "outside-only", url: "https://example.test/assets/knotis-media.js" });
        const win = dom.window;
        win.fetch = async (url, opts) => {
          const href = String(url);
          if (href.includes("graph.json")) {
            return { ok: true, json: async () => ({ meta: { knotis: { media: { enabled: true, captions: false } } } }) };
          }
          if (opts && opts.headers && opts.headers.Range) {
            return { ok: true, status: 206, body: { cancel: async () => {} } };
          }
          return { ok: false, status: 404 };
        };
        win.eval(MEDIA_JS);
        let button = null;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          button = win.document.querySelector("figure.knotis-media .knotis-media__rate");
          if (button) break;
        }
        if (!button) { console.error("rate button missing"); process.exit(1); }
        const video = win.document.querySelector("video");
        if (button.textContent !== "1\\u00d7") { console.error("rate button should start at 1x: " + button.textContent); process.exit(1); }
        button.click();
        if (video.playbackRate !== 1.5 || button.textContent !== "1.5\\u00d7") {
          console.error("first click should reach 1.5x: rate=" + video.playbackRate + " label=" + button.textContent); process.exit(1);
        }
        button.click();
        if (video.playbackRate !== 2) { console.error("second click should reach 2x"); process.exit(1); }
        button.click();
        if (video.playbackRate !== 0.5) { console.error("third click should reach 0.5x"); process.exit(1); }
        button.click();
        if (video.playbackRate !== 1) { console.error("fourth click should wrap to 1x"); process.exit(1); }
        if (win.document.querySelector("figure.knotis-media .knotis-media__video-menu")) {
          console.error("mp4 should not add a duplicate custom options menu");
          process.exit(1);
        }
        if (video.hasAttribute("controlsList")) {
          console.error("mp4 should keep the native browser menu items: " + video.getAttribute("controlsList"));
          process.exit(1);
        }
        console.log("ok");
        """)


if __name__ == "__main__":
    unittest.main()
