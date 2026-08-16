from __future__ import annotations

import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from contextlib import redirect_stderr
from pathlib import Path


KNOTIS_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = KNOTIS_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from knotis.builder import build_wikilinks as MODULE
from knotis.builder import knotis_site_io as SITE_IO


class BuildWikilinksTests(unittest.TestCase):
    def make_project(
        self,
        toml_text: str | None = None,
        *,
        legacy_asset_layout: bool = True,
    ) -> tuple[Path, Path]:
        root = Path(tempfile.mkdtemp())
        docs_dir = root / "docs"
        (docs_dir / "assets").mkdir(parents=True)
        if legacy_asset_layout:
            (root / "assets").mkdir()
        (root / "zensical.toml").write_text(
            toml_text
            or """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]
""".lstrip(),
            encoding="utf-8",
        )
        MODULE.REPO_ROOT = root
        MODULE.DOCS_DIR = docs_dir
        MODULE.ASSETS_DIR = docs_dir / "assets"
        MODULE.knotis_site_io.configure(docs_dir=docs_dir, repo_root=root)
        return root, docs_dir

    def build_graph_for_markdown(self, markdown: str, toml_text: str | None = None) -> dict:
        _root, docs_dir = self.make_project(toml_text=toml_text)
        md_path = docs_dir / "index.md"
        md_path.write_text(markdown, encoding="utf-8")
        occurrences = MODULE.parse_md_file(md_path)
        config = MODULE._normalize_knotis_config(MODULE._load_toml_knotis_config())
        MODULE._finalize_content_tag_colors(config, {}, [])
        return MODULE.build_graph(
            occurrences,
            [md_path],
            nav_items=[],
            graph_view_config=config,
        )

    def build_graph_for_page(self, filename: str, markdown: str, toml_text: str | None = None) -> dict:
        _root, docs_dir = self.make_project(toml_text=toml_text)
        md_path = docs_dir / filename
        md_path.write_text(markdown, encoding="utf-8")
        occurrences = MODULE.parse_md_file(md_path)
        config = MODULE._normalize_knotis_config(MODULE._load_toml_knotis_config())
        MODULE._finalize_content_tag_colors(config, {}, [])
        return MODULE.build_graph(
            occurrences,
            [md_path],
            nav_items=[],
            graph_view_config=config,
        )

    def test_main_keeps_new_scaffold_runtime_assets_out_of_root_assets(self) -> None:
        root, docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]
""".lstrip(),
            legacy_asset_layout=False,
        )
        (docs_dir / "index.md").write_text("# Home\n", encoding="utf-8")
        attachment_dir = docs_dir / "assets" / "attachments" / "home"
        attachment_dir.mkdir(parents=True)
        (attachment_dir / ".gitkeep").write_text("", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir, skip_site_mirror=True)

        self.assertFalse((root / "assets").exists())
        self.assertFalse((docs_dir / "assets" / "knotis-core.js").exists())
        self.assertFalse((docs_dir / "assets" / "vendor").exists())
        self.assertTrue((root / ".knotis" / "assets" / "knotis-core.js").is_file())
        self.assertTrue((root / ".knotis" / "assets" / "vendor" / "mermaid-10.9.6.min.js").is_file())
        self.assertTrue((root / ".knotis" / "assets" / "wikilinks.json").is_file())
        self.assertTrue((attachment_dir / ".gitkeep").is_file())
        self.assertTrue((docs_dir / "stylesheets" / "knotis-theme.css").is_file())
        self.assertFalse((docs_dir / "assets" / "knotis-theme.css").exists())

    def test_main_preserves_root_assets_for_legacy_root_theme_sites(self) -> None:
        root, docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]
extra_css = [
  "assets/knotis-palette.css",
  "assets/knotis-theme.css",
]
""".lstrip(),
        )
        (docs_dir / "index.md").write_text("# Home\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir, skip_site_mirror=True)

        self.assertTrue((root / "assets" / "knotis-core.js").is_file())
        self.assertTrue((root / "assets" / "vendor" / "mermaid-10.9.6.min.js").is_file())
        self.assertTrue((root / "assets" / "knotis-theme.css").is_file())
        self.assertTrue((docs_dir / "assets" / "knotis-theme.css").is_file())

    def test_main_parses_authored_glossary_named_pages(self) -> None:
        _root, docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
nav = [
  { "Resources" = [
    { "How to use this site" = "resources/how-to-use-this-site.md" },
  ] },
  { "Explore" = [
    { "Glossary" = "explore/glossary.md" },
  ] },
]
""".lstrip(),
        )
        (docs_dir / "resources" / "how-to-use-this-site").mkdir(parents=True)
        (docs_dir / "resources" / "how-to-use-this-site.md").write_text(
            "---\ntitle: \"How to use this site\"\nmoc: true\nmoc_pages:\n  - how-to-use-this-site/glossary.md\n---\n",
            encoding="utf-8",
        )
        (docs_dir / "resources" / "how-to-use-this-site" / "glossary.md").write_text(
            "# [[Glossary]]\n\n1. [[By page]]\n2. [[Alphabetical]]\n3. [[By importance]]\n",
            encoding="utf-8",
        )
        (docs_dir / "explore").mkdir()
        (docs_dir / "explore" / "glossary.md").write_text(
            "---\nknotis_generated: glossary-page\n---\n\n# [[Generated only]]\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir, skip_site_mirror=True)

        wikilinks = json.loads((docs_dir / "assets" / "wikilinks.json").read_text(encoding="utf-8"))
        self.assertIn("by page", wikilinks)
        self.assertIn("alphabetical", wikilinks)
        self.assertIn("by importance", wikilinks)
        self.assertNotIn("generated only", wikilinks)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        node_ids = {node["id"] for node in graph["nodes"]}
        self.assertIn("kw:by page", node_ids)
        self.assertIn("kw:alphabetical", node_ids)
        self.assertIn("kw:by importance", node_ids)

    def _markdown_runtime_python(self) -> str:
        candidates = [
            Path.home() / ".local" / "pipx" / "venvs" / "zensical" / "bin" / "python3.14",
            Path.home() / ".local" / "pipx" / "venvs" / "zensical" / "bin" / "python3",
            Path.home() / ".local" / "pipx" / "venvs" / "zensical" / "bin" / "python",
        ]
        for candidate in candidates:
            if not candidate.exists():
                continue
            result = subprocess.run(
                [str(candidate), "-c", "import markdown"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            if result.returncode == 0:
                return str(candidate)
        self.skipTest("Python-Markdown runtime is unavailable for slide marker render tests")

    def render_markdown_html(self, markdown_text: str) -> str:
        with tempfile.TemporaryDirectory() as tmpdir:
            markdown_path = Path(tmpdir) / "sample.md"
            markdown_path.write_text(markdown_text, encoding="utf-8")
            script = textwrap.dedent(
                """
                from pathlib import Path
                import markdown
                import sys

                extensions = [
                    "attr_list",
                    "knotis.markdown.knotis_slide_markers",
                    "md_in_html",
                    "sane_lists",
                    "tables",
                    "footnotes",
                    "abbr",
                    "toc",
                    "admonition",
                    "pymdownx.details",
                    "pymdownx.highlight",
                    "pymdownx.inlinehilite",
                    "pymdownx.superfences",
                    "pymdownx.tabbed",
                    "pymdownx.caret",
                    "pymdownx.mark",
                    "pymdownx.tilde",
                    "pymdownx.keys",
                    "pymdownx.critic",
                    "pymdownx.snippets",
                    "pymdownx.tasklist",
                    "pymdownx.emoji",
                    "pymdownx.arithmatex",
                ]
                extension_configs = {
                    "toc": {"permalink": "¶"},
                    "pymdownx.highlight": {
                        "anchor_linenums": True,
                        "line_spans": "__span",
                        "pygments_lang_class": True,
                    },
                }
                markdown_text = Path(sys.argv[1]).read_text(encoding="utf-8")
                html = markdown.markdown(
                    markdown_text,
                    extensions=extensions,
                    extension_configs=extension_configs,
                )
                sys.stdout.write(html)
                """
            )
            env = os.environ.copy()
            extension_dir = str(SRC_DIR)
            existing = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = extension_dir if not existing else f"{extension_dir}{os.pathsep}{existing}"
            result = subprocess.run(
                [self._markdown_runtime_python(), "-c", script, str(markdown_path)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                check=False,
            )
            if result.returncode != 0:
                self.fail(f"Markdown render failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
            return result.stdout.strip()

    def _zensical_site_root(self) -> Path:
        return KNOTIS_ROOT.parent

    def render_zensical_html(self, markdown_text: str, *, markdown_path: str = "sample.md") -> str:
        site_root = self._zensical_site_root()
        config_path = site_root / "zensical.toml"
        if not config_path.exists():
            self.skipTest("Zensical site config is unavailable for slide marker render tests")
        with tempfile.TemporaryDirectory() as tmpdir:
            markdown_file = Path(tmpdir) / Path(markdown_path).name
            markdown_file.write_text(markdown_text, encoding="utf-8")
            script = textwrap.dedent(
                """
                from pathlib import Path
                import sys

                from knotis.builder.zensical_config import resolve_zensical_config_path
                from zensical.config import parse_zensical_config
                from zensical.markdown.render import render

                site_root = Path(sys.argv[1])
                markdown_path = Path(sys.argv[2])
                parse_zensical_config(str(resolve_zensical_config_path(site_root)))
                html = render(
                    markdown_path.read_text(encoding="utf-8"),
                    path=str(markdown_path),
                    url="sample/",
                )["content"]
                sys.stdout.write(html)
                """
            )
            env = os.environ.copy()
            root_path = str(site_root)
            src_path = str(SRC_DIR)
            existing = env.get("PYTHONPATH", "")
            env["PYTHONPATH"] = (
                f"{root_path}{os.pathsep}{src_path}"
                if not existing
                else f"{root_path}{os.pathsep}{src_path}{os.pathsep}{existing}"
            )
            result = subprocess.run(
                [self._markdown_runtime_python(), "-c", script, str(site_root), str(markdown_file)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
                check=False,
            )
            if result.returncode != 0:
                self.fail(f"Zensical render failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
            return result.stdout.strip()

    def test_markerless_block_list_prefixes_render_as_blocks(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - ```r
                x <- 1
                ```

                - !!! info "Box title"
                    Box body

                - | A | B |
                  |---|---|
                  | 1 | 2 |
                    - Table child

                - Parent item
                    - ```mermaid
                    flowchart LR
                      A-->B
                    ```
                        - Mermaid child
                """
            ).strip()
        )

        self.assertIn("highlight", html)
        self.assertIn('class="admonition info"', html)
        self.assertIn("<table>", html)
        self.assertIn("Table child", html)
        self.assertIn("flowchart LR", html)
        self.assertIn("Mermaid child", html)

    def test_raw_iframe_bullets_do_not_swallow_following_content(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - <iframe id="ytplayer" type="text/html" width="640" height="360"
                  src="https://www.youtube.com/embed/M7lc1UVf-VE?autoplay=1&origin=http://example.com"
                  frameborder="0"></iframe>

                - <iframe
                  src="https://drive.google.com/file/d/1aDezJtGTxYOySem3_7LIfvoMxg9g2z91/view"
                  width="640"
                  height="360"
                  allow="autoplay"
                  allowfullscreen>
                </iframe>

                - After iframe content should still render.
                """
            ).strip()
        )

        self.assertIn('src="https://www.youtube.com/embed/M7lc1UVf-VE"', html)
        self.assertNotIn("autoplay=1", html)
        self.assertNotIn("origin=http://example.com", html)
        self.assertIn("drive.google.com/file/d/1aDezJtGTxYOySem3_7LIfvoMxg9g2z91/preview", html)
        self.assertIn("After iframe content should still render.", html)
        self.assertLess(html.index("</iframe>"), html.index("After iframe content should still render."))
        self.assertNotIn("```mermaid", html)

    def test_markerless_admonition_supports_trailing_child_list(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - Parent item
                    - !!! info "Box title"
                        - First box item
                        - Second box item

                            - Child after the box
                """
            ).strip()
        )

        admonition_start = html.index('<div class="admonition info">')
        admonition_end = html.index("</div>", admonition_start)
        admonition_html = html[admonition_start:admonition_end]
        self.assertIn("First box item", admonition_html)
        self.assertIn("Second box item", admonition_html)
        self.assertNotIn("Child after the box", admonition_html)
        self.assertRegex(
            html,
            r'</div>\s*<ul>\s*<li>Child after the box</li>\s*</ul>',
        )

    def test_markerless_admonition_supports_child_returning_to_body_indent(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - Sample admonition:
                    - !!! note "Sample admonition box"
                        - Grandparent bullet
                            - Parent bullet
                                - Child item

                        - Child after the box
                """
            ).strip()
        )

        admonition_start = html.index('<div class="admonition note">')
        admonition_end = html.index("</div>", admonition_start)
        admonition_html = html[admonition_start:admonition_end]
        self.assertIn("Grandparent bullet", admonition_html)
        self.assertIn("Parent bullet", admonition_html)
        self.assertIn("Child item", admonition_html)
        self.assertNotIn("Child after the box", admonition_html)
        self.assertRegex(
            html,
            r'</div>\s*<ul>\s*<li>Child after the box</li>\s*</ul>',
        )

    def test_nested_admonition_content_is_not_split_as_trailing_child(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - !!! note "Outer box"
                    Outer text.
                    - !!! question "Nested box"
                        - First nested item

                        - Second nested item
                """
            ).strip()
        )

        nested_start = html.index('<div class="admonition question">')
        nested_end = html.index("</div>", nested_start)
        nested_html = html[nested_start:nested_end]
        self.assertIn("First nested item", nested_html)
        self.assertIn("Second nested item", nested_html)

    def test_nested_mermaid_with_blank_lines_inside_fence_renders(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - So then, if the different samples fall in **50,738 - 44,738 dollars** range, we'll assume our sampling methods work.
                    - ```mermaid
                    flowchart LR
                    A["$44,738"] --- B["$47,738"] --- C["$50,738"]

                    style A fill:stroke:#333,stroke-width:1px
                    style B fill:stroke:#333,stroke-width:5px
                    style C fill:stroke:#333,stroke-width:1px
                    ```
                - These are the sampling methods we'll use:
                """
            ).strip()
        )
        self.assertNotIn("```mermaid", html)
        self.assertIn("flowchart LR", html)
        self.assertNotIn("<p><code>mermaid", html)

    def test_indented_teaching_blocks_match_dash_prefixed_markdown(self) -> None:
        dash_markdown = textwrap.dedent(
            """
            - In this analysis, we propose a cause-and-effect relationship.
                - ```mermaid
                flowchart LR
                  A-->B
                ```
                - ![Diagram](figure.png)

            - Copy the code below.
                - ```r
                x <- 1
                ```

            - See the table.
                - | A | B |
                  |---|---|
                  | 1 | 2 |
            """
        ).strip()
        indented_markdown = textwrap.dedent(
            """
            - In this analysis, we propose a cause-and-effect relationship.
                ```mermaid
                flowchart LR
                  A-->B
                ```
                ![Diagram](figure.png)

            - Copy the code below.
                ```r
                x <- 1
                ```

            - See the table.
                | A | B |
                |---|---|
                | 1 | 2 |
            """
        ).strip()

        dash_html = self.render_markdown_html(dash_markdown)
        indented_html = self.render_markdown_html(indented_markdown)

        def collapse(html: str) -> str:
            return re.sub(r"\s+", " ", self.normalize_html_whitespace(html))

        self.assertEqual(collapse(dash_html), collapse(indented_html))
        self.assertIn("flowchart LR", indented_html)
        self.assertIn("<table>", indented_html)
        self.assertIn("figure.png", indented_html)

    def test_all_table_attachment_forms_render_equivalent_html(self) -> None:
        child_forms = {
            "indented": textwrap.dedent(
                """
                ### [[Descriptive table]] #output
                - **Basic descriptive statistics**
                    | variable | variable label | n | NA.prc | mean | sd |
                    |:---------|:---------------|---|--------|------|-----|
                    | coninc   | Respondents' family income | 3563 | 10.61 | 47738.65 | 47738.65 |
                """
            ).strip(),
            "dash": textwrap.dedent(
                """
                ### [[Descriptive table]] #output
                - **Basic descriptive statistics**
                    - | variable | variable label | n | NA.prc | mean | sd |
                    |:---------|:---------------|---|--------|------|-----|
                    | coninc   | Respondents' family income | 3563 | 10.61 | 47738.65 | 47738.65 |
                """
            ).strip(),
        }
        sibling_forms = {
            "repo": textwrap.dedent(
                """
                ### [[Descriptive table]] #output
                - **Basic descriptive statistics**
                - | variable | variable label | n | NA.prc | mean | sd |
                |:---------|:---------------|---|--------|------|-----|
                | coninc   | Respondents' family income | 3563 | 10.61 | 47738.65 | 47738.65 |
                """
            ).strip(),
            "flush": textwrap.dedent(
                """
                ### [[Descriptive table]] #output
                - **Basic descriptive statistics**
                | variable | variable label | n | NA.prc | mean | sd |
                |:---------|:---------------|---|--------|------|-----|
                | coninc   | Respondents' family income | 3563 | 10.61 | 47738.65 | 47738.65 |
                """
            ).strip(),
        }
        child_html = {
            name: self.normalize_html_whitespace(self.render_markdown_html(markdown))
            for name, markdown in child_forms.items()
        }
        sibling_html = {
            name: self.normalize_html_whitespace(self.render_markdown_html(markdown))
            for name, markdown in sibling_forms.items()
        }
        child_reference = child_html["indented"]
        sibling_reference = sibling_html["repo"]
        for name, html in child_html.items():
            with self.subTest(group="child", form=name):
                self.assertIn("<table>", html)
                self.assertEqual(child_reference, html)
        for name, html in sibling_html.items():
            with self.subTest(group="sibling", form=name):
                self.assertIn("<table>", html)
                self.assertEqual(sibling_reference, html)
        self.assertNotEqual(child_reference, sibling_reference)

    def test_sibling_table_stays_outside_prose_list_item(self) -> None:
        sibling_html = self.render_markdown_html(
            textwrap.dedent(
                """
                - **Basic descriptive statistics**
                - | variable | variable label | n |
                |:---------|:---------------|---|
                | coninc   | income | 3563 |
                """
            ).strip()
        )
        child_html = self.render_markdown_html(
            textwrap.dedent(
                """
                - **Basic descriptive statistics**
                    - | variable | variable label | n |
                    |:---------|:---------------|---|
                    | coninc   | income | 3563 |
                """
            ).strip()
        )
        self.assertRegex(
            sibling_html,
            r"<ul>\s*<li>\s*<p><strong>Basic descriptive statistics</strong></p>\s*</li>\s*<li>\s*<table>",
        )
        self.assertRegex(
            child_html,
            r"<ul>\s*<li>\s*<p><strong>Basic descriptive statistics</strong></p>\s*<ul>\s*<li>\s*<table>",
        )

    def test_slide_break_after_prose_and_indented_mermaid(self) -> None:
        base_markdown = textwrap.dedent(
            """
            - In this analysis, we propose a cause-and-effect relationship.
                ```mermaid
                flowchart LR
                  A-->B
                ```
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            - In this analysis, we propose a cause-and-effect relationship.
            <!-- slide-break -->
                ```mermaid
                flowchart LR
                  A-->B
                ```
            <!-- slide-end -->
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertIn("flowchart LR", base_html)
        self.assertRegex(
            marked_html,
            r'cause-and-effect relationship\.</p>\s*<ul>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>\s*<div class="language-text highlight"',
        )
        self.assertRegex(
            marked_html,
            r'<div class="language-text highlight"[\s\S]*flowchart LR[\s\S]*data-knotis-slide-marker="slide-end"',
        )

    def test_markerless_table_and_details_stay_inside_markerless_admonition(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - !!! abstract "Relationship between preferred pet and respondents’ age group"
                    Do you think there is a relationship?

                    - | Age group | Cat | Dog |
                    |---|---:|---:|
                    | Younger | 207 | 293 |

                    - ??? tip "Show the answer"
                        - Use chi-square to test the relationship.
                """
            ).strip()
        )

        self.assertIn('class="admonition abstract"', html)
        self.assertIn("<table>", html)
        self.assertIn("<details", html)
        self.assertRegex(html, r'class="admonition abstract"[\s\S]*<table>[\s\S]*<details')
        self.assertNotRegex(html, r'</div>\s*<ul>\s*<li>\s*<table>')

    def test_markerless_details_abstract_keeps_nested_table_and_tip(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - ??? abstract "2. American Health Values Survey"
                    *"During the last 5 years do you think your health in general has gotten better, gotten worse or stayed about the same?"*
                    - | 1 | 2 | 3 |
                    |:---:|:---:|:---:|
                    | Better | Worse |  Stayed about the same |

                        - ??? tip "Show the answer"
                            - Categorical (Nominal)
                                - There are more than two categories, so it is not binary.
                """
            ).strip()
        )

        self.assertIn('<details class="abstract"', html)
        self.assertIn("<table>", html)
        self.assertIn('<details class="tip"', html)
        self.assertRegex(html, r'<details class="abstract"[\s\S]*<table>[\s\S]*<details class="tip"')
        self.assertNotRegex(html, r'</details>\s*<ul>\s*<li>\s*<table>')


    def test_markerless_abstract_exercise_slide_breaks_anchor_to_details(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## Determining variable type exercise
            - Intro bullet for the exercise.

            - ??? abstract "1. Youth Participatory Politics Survey Project"
                *"I am interested in political issues."*
                - | 1 | 2 |
                |:---:|:---:|
                | A | B |
                - ??? tip "Show the answer"
                    - **Categorical (Ordinal)**

            - ??? abstract "2. American Health Values Survey"
                *"During the last 5 years..."*
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            ## Determining variable type exercise
            - Intro bullet for the exercise.

            <!-- slide-break -->
            - ??? abstract "1. Youth Participatory Politics Survey Project"
                *"I am interested in political issues."*
                - | 1 | 2 |
                |:---:|:---:|
                | A | B |
                - ??? tip "Show the answer"
                    - **Categorical (Ordinal)**

            <!-- slide-break -->
            - ??? abstract "2. American Health Values Survey"
                *"During the last 5 years..."*
            """
        ).strip()
        marked_html = self.render_markdown_html(marked_markdown)
        self.assertRegex(
            marked_html,
            r'Intro bullet for the exercise\.</p>\s*</li>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>\s*<details class="abstract">\s*<summary>1\. Youth Participatory Politics Survey Project</summary>',
        )
        self.assertRegex(
            marked_html,
            r'</details>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span></li>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>\s*<details class="abstract">\s*<summary>2\. American Health Values Survey</summary>',
        )
        self.assertEqual(
            self.normalize_html_whitespace(self.strip_slide_marker_spans(marked_html)),
            self.normalize_html_whitespace(self.render_markdown_html(base_markdown)),
        )

    def test_exercise_intro_slide_break_does_not_leave_empty_bullet_before_abstract(self) -> None:
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## Determining variable type exercise
            - Determining the type of variable is important because different analysis techniques are used depending on the variable type.
                - Some questions from different surveys will be shown.
                - We will determine if they are;
                    - **Categorical** (If so, **binary**, **nominal**, or **ordinal**)
                    - **Continuous**

            <!-- slide-break -->
            - ??? abstract "1. Youth Participatory Politics Survey Project"
                *"I am interested in political issues."*
            <!-- slide-end -->
            """
        ).strip()
        html = self.render_markdown_html(marked_markdown)
        self.assertRegex(
            html,
            r'<strong>Continuous</strong>\s*</li>\s*</ul>\s*</li>\s*</ul>\s*</li>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*'
            r'<li>\s*<details class="abstract">\s*<summary>1\. Youth Participatory Politics Survey Project</summary>',
        )
        self.assertNotRegex(
            html,
            r'<strong>Continuous</strong>[\s\S]{0,250}<li>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"',
        )

    def test_markerless_table_after_admonition_paragraph_does_not_need_blank_line(self) -> None:
        html = self.render_markdown_html(
            textwrap.dedent(
                """
                - !!! note "Relationship between preferred pet and respondents’ age group"
                    In other words, do you think the preferred pet is influenced by age group?
                    - | Age group | Cat | Dog |
                    |---|---:|---:|
                    | Younger | 207 | 293 |
                        - ??? tip "Show the answer"
                            - Use chi-square to test the relationship.
                """
            ).strip()
        )

        self.assertIn('class="admonition note"', html)
        self.assertIn("<table>", html)
        self.assertIn("<details", html)
        self.assertRegex(html, r'class="admonition note"[\s\S]*<table>[\s\S]*<details')
        self.assertNotIn("<code>| Age group", html)

    def strip_slide_marker_spans(self, html: str) -> str:
        return re.sub(
            r'<span\b[^>]*\bdata-knotis-slide-marker="[^"]+"[^>]*></span>',
            "",
            html,
        ).strip()

    def normalize_html_whitespace(self, html: str) -> str:
        return re.sub(r">\s+<", "><", html.strip())

    def strip_data_line_attrs(self, html: str) -> str:
        return re.sub(r'\sdata-line="[^"]*"', "", html)

    def assert_render_neutral_markers(self, base_markdown: str, marked_markdown: str, expected_markers: list[str]) -> tuple[str, str]:
        base_html = self.render_markdown_html(base_markdown)
        marked_html = self.render_markdown_html(marked_markdown)
        self.assertNotIn("<!-- slide-", marked_html)
        self.assertNotIn("<!-- click", marked_html)
        for marker in expected_markers:
            self.assertIn(f'data-knotis-slide-marker="{marker}"', marked_html)
        self.assertEqual(
            self.normalize_html_whitespace(self.strip_slide_marker_spans(marked_html)),
            self.normalize_html_whitespace(base_html),
        )
        return base_html, marked_html

    def test_main_canonicalizes_alias_keywords(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# Home\n\n[[sampling strategy|sampling strategies]] helps.\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        wikilinks = json.loads((docs_dir / "assets" / "wikilinks.json").read_text(encoding="utf-8"))
        self.assertIn("sampling strategy", wikilinks)
        self.assertNotIn("sampling strategy|sampling strategies", wikilinks)

    def test_main_does_not_copy_slide_marker_extension_to_site_root(self) -> None:
        root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text("# Home\n\nNo links here.\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        self.assertFalse((root / "knotis_slide_markers.py").exists())

    def test_slide_markers_keep_image_bullet_followed_by_ordered_list_rendering(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### More detailed look
            - Here's the more detailed look:
            ![RStudio interface with more detailed view](../assets/images/rstudio/01.-introduction-to-rstudio/rstudio_interface_detailed.png){ width="1000" }


            1. **Menu bar:** The top strip with File, Edit, Code, View, Plots, and other menus.
            2. **Script editor:** The upper-left panel where you write and save your R code.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            ### More detailed look
            - Here's the more detailed look:
            ![RStudio interface with more detailed view](../assets/images/rstudio/01.-introduction-to-rstudio/rstudio_interface_detailed.png){ width="1000" }

            <!-- slide-end -->
            <!-- slide-break -->
            1. **Menu bar:** The top strip with File, Edit, Code, View, Plots, and other menus.
            2. **Script editor:** The upper-left panel where you write and save your R code.
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertIn("<ul>", base_html)
        self.assertIn("<ol>", base_html)
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ol>')
        self.assertNotRegex(marked_html, r"<ol>\s*<li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-break\"")

    def test_slide_marker_wrapping_whole_ordered_list_stays_outside_ol(self) -> None:
        base_markdown = textwrap.dedent(
            """
            1. Menu bar
            2. Script editor
            3. Save button
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            1. Menu bar
            2. Script editor
            3. Save button
            <!-- slide-end -->
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ol>')
        self.assertRegex(
            marked_html,
            r'Save button</li>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*</ol>',
        )
        self.assertNotRegex(marked_html, r"</ol>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertNotRegex(marked_html, r"<ol>\s*<li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-break\"")

    def test_slide_break_expands_to_end_start_between_list_items(self) -> None:
        base_markdown = textwrap.dedent(
            """
            1. Menu bar
            2. Script editor
            3. Save button
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            1. Menu bar
            2. Script editor
            <!-- slide-break -->
            3. Save button
            <!-- slide-end -->
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertRegex(marked_html, r"</li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>')

    def test_slide_break_after_nested_list_block_keeps_next_top_level_item(self) -> None:
        base_markdown = textwrap.dedent(
            """
            - For our analysis, imagine we are interested in the income level of respondents.
                - Then, we will merge values and create a new variable by recoding.

                    !!! info "Merging values"
                        - **1**: married ➜ 1: married
                        - **2**: widowed ➜ **2**: formerly in union

            - After recoding the original variable, our dataset will include one more variable.

                | respondent id | marital | maritalgroups |
                |---|---|---|
                | 1 | 1 (married) | 1 (married) |
                | 2 | 2 (widowed) | 2 (formerly in union) |
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            - For our analysis, imagine we are interested in the income level of respondents.
                - Then, we will merge values and create a new variable by recoding.

                    !!! info "Merging values"
                        - **1**: married ➜ 1: married
                        - **2**: widowed ➜ **2**: formerly in union
            <!-- slide-break -->
            - After recoding the original variable, our dataset will include one more variable.

                | respondent id | marital | maritalgroups |
                |---|---|---|
                | 1 | 1 (married) | 1 (married) |
                | 2 | 2 (widowed) | 2 (formerly in union) |
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertRegex(marked_html, r"</li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>\s*<p>After recoding')
        self.assertRegex(marked_html, r"<ul>\s*<li>\s*<p>For our analysis")
        self.assertRegex(marked_html, r"</li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"[^>]*></span><span\b[^>]*data-knotis-slide-marker=\"slide-break\"[^>]*></span>\s*<li>")

    def test_frequency_table_interpretation_slide_start_in_module_04_context(self) -> None:
        # Inline replica of the module 04 item 5 -> 6 boundary (the module
        # file itself drifts, so the test carries its own fixture).
        snippet = textwrap.dedent(
            """
            ### [[Merging values]]
            - For our analysis, we may want to merge the values of variables and create a new variable.
            - Merging values is for [[categorical]] variables.
                - Take `marital` variable in GSS.
            <!-- slide-break -->
            5. **[[Frequency table]] #output for the original variable (marital)**
                - **Respondents' marital status (Variable label)**
                    - | value | value label   | frq  | raw.prc | valid.prc | cum.prc |
                      |-----|-----------------|------|---------|-----------|---------|
                      | 1   | Married         | 1659 | 41.62   | 41.78     | 41.78   |
                      | 2   | Widowed         | 269  | 6.75    | 6.77      | 48.55   |
                      | 5   | Never married   | 1334 | 33.47   | 33.59     | 100.00  |
                      | NA  | NA              | 15   | 0.38    | NA        | NA      |
            <!-- slide-break -->
            6. **[[Frequency table]] #interpretation for the original variable (marital)**
                - !!! note "Frequency table interpretation sample"
                    The respondents' marital status *variable* shows that 41.78% of the respondents are married; 6.77% of the respondents are widowed; and 33.59% of the respondents are never married.
                - !!! quote "Frequency table interpretation template"
                    The **[[variable label]]** *variable* shows that **xx.xx%** of the respondents are / have / feel / think / said / reported **[[value label]] 1**...
                - !!! success "Interpretation explanation"
                    - After the **variable label**, we add the word of "*variable*" in your interpretation:
                        - "The respondents' marital status *variable* shows that..."
            """
        ).strip()
        marked_html = self.render_zensical_html(snippet)
        stripped = self.strip_data_line_attrs(marked_html)
        self.assertRegex(
            stripped,
            r'slide-end"[^>]*></span>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>\s*<p><strong>\[\[Frequency table\]\] #interpretation for the original variable',
        )
        self.assertNotRegex(
            stripped,
            r'slide-end"[^>]*></span>\s*<li>\s*<p><strong>\[\[Frequency table\]\] #interpretation for the original variable',
        )

    def test_slide_break_carries_click_font_fill_to_next_slide(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## First slide

            - Visible immediately

            - Revealed on click

            ## Second slide

            - Sparse content
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## First slide

            - Visible immediately

            <!-- click -->
            - Revealed on click

            <!-- slide-break click font=22px fill=0.85 -->
            ## Second slide

            - Sparse content
            <!-- slide-end -->
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "click", "slide-end", "slide-break click font=22px fill=0.85"],
        )
        self.assertRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-break click font=22px fill=0\.85"[^>]*></span>\s*<h2',
        )
        self.assertRegex(marked_html, r'data-knotis-slide-marker="click"')

    def test_slide_break_slide_end_skips_page_only_content(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## First slide

            Included.

            ## Page-only setup

            Not in slides.

            ## Second slide

            Included again.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## First slide

            Included.

            <!-- slide-break --><!-- slide-end -->
            ## Page-only setup

            Not in slides.

            <!-- slide-break -->
            ## Second slide

            Included again.
            <!-- slide-end -->
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertEqual(base_html.count("<h2"), marked_html.count("<h2"))
        self.assertEqual(marked_html.count('data-knotis-slide-marker="slide-break"'), 2)
        self.assertEqual(marked_html.count('data-knotis-slide-marker="slide-end"'), 2)
        first_end = marked_html.find('data-knotis-slide-marker="slide-end"')
        page_only = marked_html.find("Page-only setup")
        second_start = marked_html.rfind('data-knotis-slide-marker="slide-break"', 0, marked_html.find("Second slide"))
        self.assertLess(first_end, page_only)
        self.assertLess(page_only, second_start)

    def test_slide_break_with_excluded_heading_keeps_list_content(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### Learning outcomes { data-search-exclude }
            1. Differentiate R and RStudio
            2. Use RStudio Cloud (Posit)
            3. Explain what R packages are
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### Learning outcomes { data-search-exclude }
            1. Differentiate R and RStudio
            2. Use RStudio Cloud (Posit)
            3. Explain what R packages are
            <!-- slide-end -->
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertEqual(base_html.count("<li>"), marked_html.count("<li>"))
        self.assertIn("Differentiate R and RStudio", marked_html)
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<h3')
        self.assertRegex(
            marked_html,
            r'Explain what R packages are</li>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*</ol>',
        )
        self.assertNotRegex(marked_html, r"</ol>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")

    def test_slide_break_preserves_nested_bullet_ordered_list_block(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## [[Reasons for recoding]]
            - There are three reasons for recoding:
                1. [[Merging values]]
                2. [[Reversing values]]
                3. [[Transforming continuous variables into groups]]

            ### [[Merging values]]
            - For our analysis, we may want to merge values.
            - Take `marital` variable in GSS.
            - After recoding, the dataset includes one more variable.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## [[Reasons for recoding]]
            - There are three reasons for recoding:
                1. [[Merging values]]
                2. [[Reversing values]]
                3. [[Transforming continuous variables into groups]]
            <!-- slide-break -->
            ### [[Merging values]]
            - For our analysis, we may want to merge values.
            <!-- slide-break -->
            - Take `marital` variable in GSS.
            <!-- slide-break -->
            - After recoding, the dataset includes one more variable.
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertRegex(marked_html, r"<ul>\s*<li>There are three reasons for recoding:<ol>")
        self.assertRegex(marked_html, r"</ol>\s*</li>\s*</ul>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertNotRegex(marked_html, r"<ol>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-break\"")
        self.assertNotRegex(marked_html, r"<li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-(?:break|end)\"")

    def test_slide_break_after_nested_bullet_list_closes_after_whole_list(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## [[Recoding]] definition
            - It is rare that we use variables as they are in our analyses.
                - Instead, we often customize the values of variables for our needs.
            - Recoding means creating a new variable using the values of an original variable.
                - After recoding (creating a new variable), the data will include one more variable.

            ## [[Reasons for recoding]]
            - There are three reasons for recoding:
                1. [[Merging values]]
                2. [[Reversing values]]
                3. [[Transforming continuous variables into groups]]

            ### [[Merging values]]
            - For our analysis, we may want to merge values.
            - After recoding the original `marital` variable, our dataset will include `maritalgroups`.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## [[Recoding]] definition
            - It is rare that we use variables as they are in our analyses.
                - Instead, we often customize the values of variables for our needs.
            - Recoding means creating a new variable using the values of an original variable.
                - After recoding (creating a new variable), the data will include one more variable.
            <!-- slide-break -->
            ## [[Reasons for recoding]]
            - There are three reasons for recoding:
                1. [[Merging values]]
                2. [[Reversing values]]
                3. [[Transforming continuous variables into groups]]
            <!-- slide-break -->
            ### [[Merging values]]
            - For our analysis, we may want to merge values.
            <!-- slide-break -->
            - After recoding the original `marital` variable, our dataset will include `maritalgroups`.
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        definition = marked_html[
            marked_html.find('id="recoding-definition"') : marked_html.find('id="reasons-for-recoding"')
        ]
        self.assertEqual(definition.count('data-knotis-slide-marker="slide-break"'), 1)
        self.assertEqual(definition.count('data-knotis-slide-marker="slide-end"'), 1)
        self.assertGreater(
            definition.find('data-knotis-slide-marker="slide-end"'),
            definition.rfind("</ul>"),
        )

    def test_slide_markers_keep_standalone_image_inside_manual_slide(self) -> None:
        base_markdown = textwrap.dedent(
            """
            1. **Files tab:** This shows the files.

            ![Files screenshot](files.png)

            2. **Plots tab:** This displays graphs.

            ![Plots screenshot](plots.png)

            3. **Packages tab:** This shows packages.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            1. **Files tab:** This shows the files.

            ![Files screenshot](files.png)

            2. **Plots tab:** This displays graphs.

            ![Plots screenshot](plots.png)
            <!-- slide-end -->
            <!-- slide-break -->
            3. **Packages tab:** This shows packages.
            <!-- slide-end -->
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertRegex(marked_html, r'alt="Plots screenshot"[^>]*\s*/>\s*</p>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"')
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ol start="3"')

    def test_slide_markers_keep_empty_alt_image_bullet_inside_manual_slide(self) -> None:
        base_markdown = textwrap.dedent(
            """
            - Before the GIF
            - ![](slides.gif){ width="700" }
            - After the GIF
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            - Before the GIF
            <!-- slide-break -->
            - ![](slides.gif){ width="700" }
            <!-- slide-end -->
            - After the GIF
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>\s*<img alt="" src="slides\.gif" width="700" />',
        )
        self.assertRegex(
            marked_html,
            r'<img alt="" src="slides\.gif" width="700" />\s*</li>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )

    def test_slide_markers_keep_ordered_list_numbering_when_split_across_slides(self) -> None:
        base_markdown = textwrap.dedent(
            """
            1. First item
            2. Second item
            3. Third item
            4. Fourth item
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            1. First item
            2. Second item
            <!-- slide-end -->
            <!-- slide-break -->
            3. Third item
            4. Fourth item
            """
        ).strip()
        base_html, _marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertEqual(base_html.count("<li>"), 4)
        self.assertNotIn("<ol start=", base_html)

    def test_slide_markers_keep_admonition_rendering(self) -> None:
        base_markdown = textwrap.dedent(
            """
            !!! warning "Troubleshooting"
                - Use the new recoded variable names in the computation code.
                - Original variables are not usable for this analysis.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            !!! warning "Troubleshooting"
                - Use the new recoded variable names in the computation code.
                - Original variables are not usable for this analysis.
            <!-- slide-end -->
            """
        ).strip()
        base_html, _marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertIn('class="admonition warning"', base_html)

    def test_slide_markers_keep_details_rendering(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ??? question "2. American Health Values Survey"

                *"During the last 5 years do you think your health in general has gotten better, gotten worse or stayed about the same?"*

                ??? tip "Show the answer"
                    Categorical (Ordinal)
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ??? question "2. American Health Values Survey"

                *"During the last 5 years do you think your health in general has gotten better, gotten worse or stayed about the same?"*

                ??? tip "Show the answer"
                    Categorical (Ordinal)
            <!-- slide-end -->
            """
        ).strip()
        base_html, _marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertIn("<details", base_html)
        self.assertIn("<summary>", base_html)

    def test_chi_square_basics_heading_admonition_manual_slide_boundaries(self) -> None:
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## Chi-square basics

            !!! abstract "Relationship between preferred pet and respondents' age group"
                Do you think there is a relationship between **preferred pet** and respondents' **age group**?

                | Age group | Cat | Dog | Total |
                |---|---:|---:|---:|
                | Younger | 207<br>41.4% | 293<br>58.6% | 500<br>100% |
                | Older | 267<br>53.4% | 233<br>46.6% | 500<br>100% |
                | Total | 474<br>47.4% | 526<br>52.6% | 1000<br>100% |

                ??? tip "Show the answer"

                    - While the table shows differences, we **CANNOT** conclude significance.
                        - We need a statistical test like the chi-square test.

            <!-- slide-end -->
            <!-- slide-break -->

            - The [[chi-square]] test is used to discover if there is a relationship between:
                - Two [[categorical]] variables.

            <!-- slide-end -->
            """
        ).strip()
        html = self.render_zensical_html(marked_markdown, markdown_path="06.-chi-square-analysis.md")
        self.assertRegex(
            html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<h2[^>]*id="chi-square-basics"',
        )
        self.assertNotRegex(
            html,
            r'<h2[^>]*id="chi-square-basics"[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"',
        )
        self.assertRegex(
            html,
            r'</div>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>'
            r'<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ul>',
        )
        details = re.search(r"<details\b[^>]*>.*?</details>", html, re.S)
        self.assertIsNotNone(details)
        self.assertNotIn('data-knotis-slide-marker="slide-break"', details.group(0))
        self.assertNotIn('data-knotis-slide-marker="slide-end"', details.group(0))

    def test_slide_markers_keep_fenced_blocks_rendering(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### Diagram

            ```mermaid
            graph TD
                A --> B
            ```
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            ### Diagram
            <!-- slide-break -->
            ```mermaid
            graph TD
                A --> B
            ```
            <!-- slide-end -->
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertIn('class="language-text highlight"', base_html)
        self.assertNotIn("<p>```mermaid", marked_html)

    def test_slide_markers_keep_heading_followed_by_numbered_list_rendering(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## Using R script files

            1. Copy the code
            2. Highlight and run
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            ## Using R script files
            <!-- slide-break -->

            1. Copy the code
            2. Highlight and run
            <!-- slide-end -->
            """
        ).strip()
        base_html, _marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertIn("<h2", base_html)
        self.assertIn("<ol>", base_html)

    def test_slide_markers_keep_nested_bullet_and_ordered_list_structure(self) -> None:
        base_markdown = textwrap.dedent(
            """
            - Parent bullet
                1. First ordered child
                2. Second ordered child
                    1. Nested ordered child
                3. Third ordered child
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            - Parent bullet
                1. First ordered child
                2. Second ordered child
            <!-- slide-end -->
            <!-- slide-break -->
                    1. Nested ordered child
                3. Third ordered child
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertIn("<ul>", base_html)
        self.assertGreaterEqual(base_html.count("<ol>"), 2)
        self.assertNotIn("<p><!-- slide-end -->", marked_html)

    def test_slide_markers_between_same_list_run_items_stay_outside_li(self) -> None:
        base_markdown = textwrap.dedent(
            """
            1. Item one
            2. Item two
            3. Item three
            4. Item four
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            1. Item one
            2. Item two
            <!-- slide-end -->
            <!-- slide-break -->
            3. Item three
            4. Item four
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertRegex(marked_html, r"</li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>')
        self.assertNotRegex(marked_html, r"<span\b[^>]*data-knotis-slide-marker=\"slide-end\"[^>]*></span>\s*</li>")
        self.assertNotRegex(marked_html, r"<li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-break\"")

    def test_slide_markers_between_nested_and_top_level_items_go_to_outer_li(self) -> None:
        base_markdown = textwrap.dedent(
            """
            - Outer item
                - Nested item one
                - Nested item two
            - Another outer item
                - Deeply nested
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            - Outer item
                - Nested item one
                - Nested item two
            <!-- slide-end -->
            <!-- slide-break -->
            - Another outer item
                - Deeply nested
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertRegex(marked_html, r"</li>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li>')
        self.assertNotRegex(marked_html, r"<span\b[^>]*data-knotis-slide-marker=\"slide-(?:end|break)\"[^>]*></span>\s*</li>")

    def test_slide_markers_via_zensical_render(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### More detailed look
            - Here's the more detailed look:
            ![RStudio interface with more detailed view](../assets/images/rstudio/01.-introduction-to-rstudio/rstudio_interface_detailed.png){ width="1000" }


            1. **Menu bar:** The top strip with File, Edit, Code, View, Plots, and other menus.
            2. **Script editor:** The upper-left panel where you write and save your R code.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            ### More detailed look
            - Here's the more detailed look:
            ![RStudio interface with more detailed view](../assets/images/rstudio/01.-introduction-to-rstudio/rstudio_interface_detailed.png){ width="1000" }

            <!-- slide-end -->
            <!-- slide-break -->
            1. **Menu bar:** The top strip with File, Edit, Code, View, Plots, and other menus.
            2. **Script editor:** The upper-left panel where you write and save your R code.
            """
        ).strip()
        base_html = self.render_zensical_html(base_markdown)
        marked_html = self.render_zensical_html(marked_markdown)
        self.assertNotIn("<!-- slide-", marked_html)
        for marker in ("slide-end", "slide-break"):
            self.assertIn(f'data-knotis-slide-marker="{marker}"', marked_html)
        self.assertEqual(
            self.strip_data_line_attrs(self.strip_slide_marker_spans(marked_html)),
            self.strip_data_line_attrs(base_html),
        )
        self.assertRegex(marked_html, r'</ul>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"')
        self.assertRegex(marked_html, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ol>')

    def test_slide_break_after_markerless_table_list_starts_next_heading(self) -> None:
        base_markdown = textwrap.dedent(
            """
            #### Find the variable in Variables in GSS page
            1. We will create a frequency table for the `finalter` variable.

            - | Variable name | Variable label |
            |---|---|
            | `finalter` | Perceived change in financial situation |

            #### [[Frequency table]] #code
            - **[[Model code]]**
                - ```r
                  frq(gss$variable_here, out = "v")
                  ```
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            #### Find the variable in Variables in GSS page
            1. We will create a frequency table for the `finalter` variable.

            - | Variable name | Variable label |
            |---|---|
            | `finalter` | Perceived change in financial situation |

            <!-- slide-end -->
            <!-- slide-break -->
            #### [[Frequency table]] #code
            - **[[Model code]]**
                - ```r
                  frq(gss$variable_here, out = "v")
                  ```
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertIn("<table>", base_html)
        self.assertRegex(marked_html, r"</table>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<h4[^>]*id="frequency-table-code"',
        )

    def test_slide_break_after_stripped_table_keeps_heading_and_interpretation_slides(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### [[Linear regression]] with 2 factors #output
            - **Respondents' personal income**
            - | *Factors* | *Coeff.* | *std. Coeff* | *p* |
            | :---------------------------------------------------------- | :-------------------: | :-------------: | :------------: |
            | (Intercept) | 17269.65 | -0.00 | **0.001** |
            | Population density of residence during adolescence years | 1515.16 | 0.07 | **0.001** |
            | Respondents' age | 308.91 | 0.14 | **0.001** |
            | Observations | 2303 | | |
            | R² / R² adjusted | 0.023 / 0.023 | | |

            - Population density of residence during adolescence years and respondents' age variables are statistically significant factor of personal income (p < 0.05).
            - Looks like, for example, residing in **6**: City greater than 250K, instead of **5**: Big city **increases** personal income by $**1,515**,
            - One year increase in age increases personal income by $**308**. For this model, a 40-year-old would make $**616** more compared to a 30-year-old.
            - Now, let's add the third factor variable, `prestg10`.

            ### [[Linear regression]] with 3 factors #code
            - **[[Model code]]**
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### [[Linear regression]] with 2 factors #output
            - **Respondents' personal income**
            - | *Factors* | *Coeff.* | *std. Coeff* | *p* |
            | :---------------------------------------------------------- | :-------------------: | :-------------: | :------------: |
            | (Intercept) | 17269.65 | -0.00 | **0.001** |
            | Population density of residence during adolescence years | 1515.16 | 0.07 | **0.001** |
            | Respondents' age | 308.91 | 0.14 | **0.001** |
            | Observations | 2303 | | |
            | R² / R² adjusted | 0.023 / 0.023 | | |

            <!-- slide-break -->
            - Population density of residence during adolescence years and respondents' age variables are statistically significant factor of personal income (p < 0.05).
            - Looks like, for example, residing in **6**: City greater than 250K, instead of **5**: Big city **increases** personal income by $**1,515**,
            - One year increase in age increases personal income by $**308**. For this model, a 40-year-old would make $**616** more compared to a 30-year-old.
            - Now, let's add the third factor variable, `prestg10`.
            <!-- slide-break -->
            ### [[Linear regression]] with 3 factors #code
            - **[[Model code]]**
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<h3[^>]*id="linear-regression-with-2-factors-output"',
        )
        self.assertNotRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ul>\s*<li>\s*<p><strong>Respondents',
        )
        self.assertRegex(
            marked_html,
            r'</table>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span></li>\s*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<p>Population density of residence during adolescence years',
        )
        self.assertNotRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ul>\s*<li>\s*<p>Population density',
        )

    def test_slide_break_after_markerless_code_and_table_list_items(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## [[Regression]] definition
            - Regression is the most widely used statistical technique.
                - Unlike [[correlation analysis]], which does NOT imply a causal relationship, regression does imply one and requires the specification of outcome and factor variables. A correlation table as an example:

            - ```r
            tab_corr (gss[c("age", "childs")],
            p.numeric = T, triangle="lower")
            ```

            - |  | *Respondents' age* | *Number of children respondents* have |
            | --- | :---: | :---: |
            | *Respondents' age* | | |
            | *Number of children respondents have* | r = 0.297<br>p = 0.000*** | |
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## [[Regression]] definition
            - Regression is the most widely used statistical technique.
                - Unlike [[correlation analysis]], which does NOT imply a causal relationship, regression does imply one and requires the specification of outcome and factor variables. A correlation table as an example:

            <!-- slide-break -->
            - ```r
            tab_corr (gss[c("age", "childs")],
            p.numeric = T, triangle="lower")
            ```

            <!-- slide-break -->
            - |  | *Respondents' age* | *Number of children respondents* have |
            | --- | :---: | :---: |
            | *Respondents' age* | | |
            | *Number of children respondents have* | r = 0.297<br>p = 0.000*** | |

            <!-- slide-end -->
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertIn("tab_corr", base_html)
        self.assertRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-end"[^>]*></span><span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span><li>\s*<div class="language-r highlight"',
        )
        self.assertRegex(
            marked_html,
            r'</table>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span></li>',
        )

    def test_slide_break_dedents_following_indented_ordered_list(self) -> None:
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### More detailed look
            - ![RStudio interface with more detailed view](rstudio_interface_detailed.png)
            <!-- slide-break -->
                1. **Menu bar:** The top strip with File, Edit, Code, View, Plots, and other menus.
                2. **Script editor:** The upper-left panel where you write and save your R code.
            <!-- slide-break -->
                1. **Files tab:** This shows the files.
                    - ![RStudio Files tab](files-tab.png)
                2. **Plots tab:** This displays any graph you produce.
                    - ![RStudio Plots tab](plots-tab.png)
            <!-- slide-end -->
            """
        ).strip()
        html = self.render_zensical_html(marked_markdown)
        self.assertRegex(
            html,
            r'rstudio_interface_detailed\.png"[^>]*/>\s*</li>\s*</ul>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )
        self.assertRegex(
            html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ol>\s*<li\b[^>]*><strong>Menu bar:',
        )
        self.assertRegex(
            html,
            r'files-tab\.png"[^>]*/>\s*</li>\s*</ul>\s*</li>\s*<li\b[^>]*><strong>Plots tab:',
        )

    def test_slide_break_preserves_indented_bullet_list_after_images(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ## [[Terminologies]]
            ### [[Survey terminology]]
            - ![image one](img1.png)
            - ![image two](img2.png)
                - [[Questionnaire]]: A set of written questions used for collecting information from respondents.
                - [[Respondents]]: Individuals who respond to the questions in a questionnaire.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ## [[Terminologies]]
            ### [[Survey terminology]]
            - ![image one](img1.png)
            - ![image two](img2.png)
            <!-- slide-break -->
                - [[Questionnaire]]: A set of written questions used for collecting information from respondents.
                - [[Respondents]]: Individuals who respond to the questions in a questionnaire.
            """
        ).strip()
        _base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break"],
        )
        self.assertRegex(
            marked_html,
            r'img2\.png"[^>]*/>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ul>\s*<li>.*?Questionnaire',
        )
        self.assertNotRegex(
            marked_html,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li\b[^>]*>.*?img2\.png',
        )
        self.assertRegex(
            marked_html,
            r'Respondents.*?questionnaire\.</li>\s*</ul>\s*</li>\s*</ul>',
        )

    def test_slide_break_between_nested_sibling_list_items_preserves_list_structure(self) -> None:
        cases = (
            {
                "base_markdown": textwrap.dedent(
                    """
                    ### Assumption 2: Multicollinearity
                    - [[Multicollinearity]] occurs when two or more variables in a regression model are dependent upon the other variables in such a way that one can be linearly predicted from the other with a high degree of accuracy.
                        - In multicollinearity, two or more of the factor variables correlate strongly with each other.
                            - ![Multicollinearity diagram](multicollinearity.png){ width="400" }
                        - **Several solutions exist for [[multicollinearity]] issue:**
                            - Removing one of the strongly correlated variables
                            - !!! note "Addressing the multicollinearity issue"
                                - For this module, we will address the multicollinearity issue by removing one of the strongly correlated variables from the model.
                    """
                ).strip(),
                "marked_markdown": textwrap.dedent(
                    """
                    <!-- slide-break -->
                    ### Assumption 2: Multicollinearity
                    - [[Multicollinearity]] occurs when two or more variables in a regression model are dependent upon the other variables in such a way that one can be linearly predicted from the other with a high degree of accuracy.
                        - In multicollinearity, two or more of the factor variables correlate strongly with each other.
                            - ![Multicollinearity diagram](multicollinearity.png){ width="400" }
                    <!-- slide-break -->
                        - **Several solutions exist for [[multicollinearity]] issue:**
                            - Removing one of the strongly correlated variables
                            - !!! note "Addressing the multicollinearity issue"
                                - For this module, we will address the multicollinearity issue by removing one of the strongly correlated variables from the model.
                    <!-- slide-end -->
                    """
                ).strip(),
                "image_marker_pattern": (
                    r'multicollinearity\.png"[^>]*/>\s*</li>\s*</ul>\s*</li>\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*'
                    r'<li\b[^>]*>\s*<p><strong>Several solutions exist'
                ),
                "forbidden_lead_pattern": (
                    r'linearly predicted from the other with a high degree of accuracy\.\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-(?:break|end)"'
                ),
            },
            {
                "base_markdown": textwrap.dedent(
                    """
                    ### Assumption 1: Homoscedasticity
                    - [[Homoscedasticity]] refers to a situation in statistics where the variability of a variable is consistent across all levels of another variable.
                        - For linear regression to be accurate, the spread of data points should be uniform across all values of the independent variable.
                        - Linear regression aims to create a straight-line model that best fits the data.
                            - ![Homoscedasticity diagram](homoscedasticity.png)
                        - **Several reasons cause this [[heteroscedasticity]] issue:**
                            - **Outliers:** Extreme values in data can lead to heteroscedasticity.
                            - !!! note "Addressing the heteroscedasticity"
                                - For this module, we will address the heteroscedasticity issue by removing the problematic variables from the model.
                    """
                ).strip(),
                "marked_markdown": textwrap.dedent(
                    """
                    <!-- slide-break -->
                    ### Assumption 1: Homoscedasticity
                    - [[Homoscedasticity]] refers to a situation in statistics where the variability of a variable is consistent across all levels of another variable.
                        - For linear regression to be accurate, the spread of data points should be uniform across all values of the independent variable.
                        - Linear regression aims to create a straight-line model that best fits the data.
                            - ![Homoscedasticity diagram](homoscedasticity.png)
                    <!-- slide-break -->
                        - **Several reasons cause this [[heteroscedasticity]] issue:**
                            - **Outliers:** Extreme values in data can lead to heteroscedasticity.
                            - !!! note "Addressing the heteroscedasticity"
                                - For this module, we will address the heteroscedasticity issue by removing the problematic variables from the model.
                    <!-- slide-end -->
                    """
                ).strip(),
                "image_marker_pattern": (
                    r'homoscedasticity\.png"[^>]*/>\s*</li>\s*</ul>\s*</li>\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*'
                    r'<li\b[^>]*>\s*(?:<p>)?<strong>Several reasons cause'
                ),
                "forbidden_lead_pattern": (
                    r'variability of a variable is consistent across all levels of another variable\.\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-(?:break|end)"'
                ),
            },
            {
                "base_markdown": textwrap.dedent(
                    """
                    ### Assumption 5: At least 10% of the cases
                    - The least frequent response category should have at least [[10% of the cases]].
                        - Let's check the frequency table of `class` variable.
                        - ```r
                        frq(gss$class, out = "v")
                        ```
                            - **Respondents' subjective class identification (Variable label)**
                                - | value | value label | frq |
                                  |---:|---|---:|
                                  | 4 | Upper class | 163 |
                        - **Several solutions exist for having less than [[10% of the cases]] issue:**
                            - Removing the variable from the model
                    """
                ).strip(),
                "marked_markdown": textwrap.dedent(
                    """
                    <!-- slide-break -->
                    ### Assumption 5: At least 10% of the cases
                    - The least frequent response category should have at least [[10% of the cases]].
                        - Let's check the frequency table of `class` variable.
                        - ```r
                        frq(gss$class, out = "v")
                        ```
                            - **Respondents' subjective class identification (Variable label)**
                                - | value | value label | frq |
                                  |---:|---|---:|
                                  | 4 | Upper class | 163 |
                    <!-- slide-break -->
                        - **Several solutions exist for having less than [[10% of the cases]] issue:**
                            - Removing the variable from the model
                    <!-- slide-end -->
                    """
                ).strip(),
                "image_marker_pattern": (
                    r'</table>\s*</li>\s*</ul>\s*</li>\s*</ul>\s*</li>\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*'
                    r'<li\b[^>]*>\s*<p><strong>Several solutions exist for having less than'
                ),
                "forbidden_lead_pattern": (
                    r'at least \[\[10% of the cases\]\]\.\s*'
                    r'<span\b[^>]*data-knotis-slide-marker="slide-(?:break|end)"'
                ),
            },
        )
        for case in cases:
            with self.subTest(case["marked_markdown"].splitlines()[1].strip()):
                base_html, marked_html = self.assert_render_neutral_markers(
                    case["base_markdown"],
                    case["marked_markdown"],
                    ["slide-break", "slide-end"],
                )
                self.assertEqual(base_html.count("<li>"), marked_html.count("<li>"))
                self.assertRegex(marked_html, case["image_marker_pattern"])
                self.assertNotRegex(marked_html, case["forbidden_lead_pattern"])

    def test_slide_break_table_and_indented_admonition_stay_on_one_slide(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### [[Use a model code]]
            - We will likely make mistakes:
                - Imagine, there was a semicolon at the end of line 3.
                    - ```r
                    frq(gss$agegroups, out = "v")
                    ```
                        - **Line 4:** The table will show `-Inf` and `2[Middle` labels.
                - | value | frq |
                  |---|---:|
                  | ==-Inf== | 127 |
                  | ==2[Middle== | 1196 |

                    - !!! warning "Troubleshooting"
                        - See [Recoding model codes](#recoding-model-codes).
                        - Determine what kind of recoding you need.
            ### [[Refresh GSS data if variables are misplaced]]
            - If variables are misplaced in the codes, we need fresh data.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### [[Use a model code]]
            - We will likely make mistakes:
                - Imagine, there was a semicolon at the end of line 3.
                    - ```r
                    frq(gss$agegroups, out = "v")
                    ```
                        - **Line 4:** The table will show `-Inf` and `2[Middle` labels.
            <!-- slide-break -->
                - | value | frq |
                  |---|---:|
                  | ==-Inf== | 127 |
                  | ==2[Middle== | 1196 |

                    - !!! warning "Troubleshooting"
                        - See [Recoding model codes](#recoding-model-codes).
                        - Determine what kind of recoding you need.
            <!-- slide-break -->
            ### [[Refresh GSS data if variables are misplaced]]
            - If variables are misplaced in the codes, we need fresh data.
            """
        ).strip()
        _, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-break", "slide-end"],
        )
        self.assertRegex(
            marked_html,
            r'</table>\s*<ul>[\s\S]*?class="admonition warning"[\s\S]*?</ul>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )
        self.assertNotRegex(
            marked_html,
            r'</table>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*<ul>',
        )

    def test_slide_break_after_code_fence_keeps_line_notes_slide(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### [[Reversing values]] #code, if necessary
            - **[[Working code]]**
                - ```r
                gss$disrspctreversed <- 1
                ```
                - **Line 1:** New variable name.
                - **Line 2:** Original variable.
                    - If codes are correct, confirmation appears:
                        - ![alt text](variable-created.png)
            ### [[Index variable]] #code
            - **[[Model code]]**
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### [[Reversing values]] #code, if necessary
            - **[[Working code]]**
                - ```r
                gss$disrspctreversed <- 1
                ```
            <!-- slide-break -->
                - **Line 1:** New variable name.
                - **Line 2:** Original variable.
                    - If codes are correct, confirmation appears:
                        - ![alt text](variable-created.png)
            <!-- slide-break -->
            ### [[Index variable]] #code
            - **[[Model code]]**
            """
        ).strip()
        marked_html = self.render_markdown_html(marked_markdown)
        self.assertNotIn("<!-- slide-", marked_html)
        for marker in ("slide-break", "slide-end"):
            self.assertIn(f'data-knotis-slide-marker="{marker}"', marked_html)
        self.assertNotRegex(
            marked_html,
            r'<ul>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"',
        )
        self.assertRegex(
            marked_html,
            r'</div>\s*</li>\s*<li>\s*<span\b[^>]*data-knotis-slide-marker="slide-(?:break|end)"',
        )
        self.assertRegex(
            marked_html,
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<h3[^>]*id="index-variable-code"',
        )

    def test_slide_break_between_parent_text_and_child_image_keeps_image_slide(self) -> None:
        base_markdown = textwrap.dedent(
            """
            ### [[Run the computing codes to create a new variable]]
            - **(1)** Let’s say we want to compute a variable.
                - Preparing the computing code does not mean we computed a new variable.
                - For example, below, the code didn’t work.
                    - Even though the computing code exists, we didn’t highlight and run it.
                - ![Screenshot](computing-error.png)
            - **(2)** Below, it works because we ran the codes in order.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### [[Run the computing codes to create a new variable]]
            - **(1)** Let’s say we want to compute a variable.
                - Preparing the computing code does not mean we computed a new variable.
                - For example, below, the code didn’t work.
                    - Even though the computing code exists, we didn’t highlight and run it.
            <!-- slide-break -->
                - ![Screenshot](computing-error.png)
            <!-- slide-break -->
            - **(2)** Below, it works because we ran the codes in order.
            """
        ).strip()
        marked_html = self.render_markdown_html(marked_markdown)
        self.assertNotIn("<!-- slide-", marked_html)
        for marker in ("slide-break", "slide-end"):
            self.assertIn(f'data-knotis-slide-marker="{marker}"', marked_html)
        self.assertNotRegex(
            marked_html,
            r'<ul>\s*<span\b[^>]*data-knotis-slide-marker="slide-(?:break|end)"',
        )
        self.assertRegex(
            marked_html,
            r'</li>\s*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<p><strong>\(2\)</strong>',
        )
        self.assertNotRegex(
            marked_html,
            r'<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*<strong>\(2\)</strong>',
        )
        self.assertNotRegex(
            marked_html,
            r'<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*<img\b[^>]*computing-error\.png',
        )
        self.assertRegex(
            marked_html,
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*(?:</li>\s*)*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<img\b[^>]*computing-error\.png',
        )
        self.assertIn("computing-error.png", marked_html)

    def test_zensical_module_05_computing_error_image_slide_markers(self) -> None:
        module_path = self._zensical_site_root() / "docs" / "modules" / "05.-computing-variables.md"
        if not module_path.exists():
            self.skipTest("Module 05 source is unavailable for Zensical slide marker test")
        html = self.render_zensical_html(
            module_path.read_text(encoding="utf-8"),
            markdown_path="modules/05.-computing-variables.md",
        )
        self.assertNotRegex(
            html,
            r'<ul>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<img\b[^>]*computing-error\.png',
        )
        self.assertNotRegex(
            html,
            r'<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*<img\b[^>]*computing-error\.png',
        )
        self.assertRegex(
            html,
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*(?:</li>\s*)*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<img\b[^>]*computing-error\.png',
        )

    def test_slide_break_after_table_interpretation_and_shallower_section_keeps_hierarchy(self) -> None:
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### [[Linear regression]] with 4 factors #output
            - **Respondents' personal income**
                - | *Factors* | *Coeff.* | *std. Coeff* | *p* |
                  | :---------------------------------------------------------- | :-------------------: | :-------------: | :------------: |
                  | (Intercept) | -41471.83 | -0.00 | **0.001** |
                  | Respondents' age | 196.07 | 0.09 | **0.001** |
            <!-- slide-break -->
                - One year increase in age increases personal income by $**196**.
                - Population density is **NO LONGER** statistically significant (p = 0.232).
            <!-- slide-break -->
            - **What changed?:** The presence of [[confounding variable]]
                - In earlier models, population density appeared to have a significant positive effect on income.
                    - But after adding education, this effect disappears.
            - **What does this mean?**
                - This suggests that the earlier relationship was not a direct effect.
            """
        ).strip()
        marked_html = self.render_markdown_html(marked_markdown)
        self.assertNotIn("<!-- slide-", marked_html)
        self.assertNotRegex(
            marked_html,
            r'<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*<strong>What changed\?:</strong>',
        )
        self.assertRegex(
            marked_html,
            r'</table>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span></li>\s*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<p>One year increase in age',
        )
        self.assertRegex(
            marked_html,
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*</li>\s*</ul>\s*</li>\s*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<p><strong>What changed\?:</strong>',
        )
        self.assertRegex(
            marked_html,
            r'<strong>What changed\?:</strong>[\s\S]*<ul>\s*<li>In earlier models, population density appeared',
        )
        self.assertRegex(
            marked_html,
            r'In earlier models, population density appeared[\s\S]*<ul>\s*<li>But after adding education, this effect disappears\.</li>',
        )

    def test_slide_break_after_search_table_keeps_table_on_first_slide(self) -> None:
        marked_markdown = textwrap.dedent(
            """
            <!-- slide-break -->
            ### [[Merging values]]
            - Merging values is for [[categorical]] variables.
            - [[Search]] the variable name, `marital`, in [Variables in GSS](variables-in-gss.md) page.
                - | Variable name | Variable label |
                  |---|---|
                  | `marital`| Respondents' marital status |
            <!-- slide-break -->
            - For our analysis, imagine we are interested in the income level of `1: married` respondents.
                - Then, we will merge values and create a new variable by recoding.
            """
        ).strip()
        marked_html = self.render_markdown_html(marked_markdown)
        self.assertNotIn("<!-- slide-", marked_html)
        self.assertRegex(
            marked_html,
            r'</table>\s*</li>\s*</ul>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"[^>]*></span>\s*</li>\s*<li[^>]*>\s*<span\b[^>]*data-knotis-slide-marker="slide-break"[^>]*></span>\s*<p>For our analysis, imagine',
        )

    def _node_jsdom_runtime(self) -> tuple[str, str] | None:
        # jsdom may be installed at the site root or any ancestor (e.g. the
        # workspace root or a CI checkout), so walk upward until found.
        candidates = [self._zensical_site_root()]
        candidates.extend(self._zensical_site_root().parents)
        for root in candidates:
            jsdom_entry = root / "node_modules" / "jsdom" / "lib" / "api.js"
            if jsdom_entry.exists():
                node = shutil.which("node")
                if not node:
                    return None
                return node, str(jsdom_entry)
        return None

    def test_slide_start_inside_li_preserves_lead_bullet_wrapper(self) -> None:
        runtime = self._node_jsdom_runtime()
        if runtime is None:
            self.skipTest("Node/jsdom runtime is unavailable for slide fragment tests")
        node, jsdom_entry = runtime
        script = textwrap.dedent(
            f"""
            import {{ JSDOM }} from {jsdom_entry!r};

            const dom = new JSDOM(`<!DOCTYPE html><html><body><article><div class="md-typeset">
            <ul>
            <li><span data-knotis-slide-marker="slide-break" hidden="hidden"></span><p>Imagine respondent A.</p>
            <ul><li>Nested child</li></ul>
            <span data-knotis-slide-marker="slide-end" hidden="hidden"></span></li>
            </ul>
            </div></article></body></html>`);
            const document = dom.window.document;
            const Node = dom.window.Node;

            function meaningfulNode(node) {{
              if (!node) return false;
              if (node.nodeType === Node.TEXT_NODE) return /\\S/.test(node.nodeValue || "");
              if (node.nodeType !== Node.ELEMENT_NODE) return false;
              if (node.matches?.("[data-knotis-slide-marker]")) return false;
              return (node.textContent || "").replace(/\\s+/g, " ").trim();
            }}

            function sourceListItemAfterMarker(marker) {{
              if (!marker?.matches?.("[data-knotis-slide-marker]")) {{
                return marker?.closest?.("li") || null;
              }}
              const hostItem = marker.closest?.("li");
              let sibling = marker.nextElementSibling;
              while (sibling) {{
                if (sibling.matches?.("[data-knotis-slide-marker]")) {{
                  sibling = sibling.nextElementSibling;
                  continue;
                }}
                if (sibling.matches?.("li")) return sibling;
                if (hostItem?.contains(sibling)) return hostItem;
                if (sibling.matches?.("ol, ul")) {{
                  const firstItem = sibling.querySelector(":scope > li");
                  if (firstItem) return firstItem;
                }}
                sibling = sibling.nextElementSibling;
              }}
              return hostItem || null;
            }}

            function repairPartialListRange(fragment, startNode) {{
              const topLevelItems = Array.from(fragment.childNodes).filter(
                (node) => node.nodeType === Node.ELEMENT_NODE && node.matches?.("li")
              );
              if (topLevelItems.length) return;

              const startItem = sourceListItemAfterMarker(startNode) || startNode?.closest?.("li");
              const sourceList = startItem?.parentElement;
              if (
                startItem?.matches?.("li")
                && sourceList?.matches?.("ol, ul")
                && startNode?.matches?.("[data-knotis-slide-marker]")
                && startItem.contains(startNode)
                && Array.from(fragment.childNodes).some(meaningfulNode)
                && !Array.from(fragment.childNodes).some((node) => node.nodeType === Node.ELEMENT_NODE && node.matches?.("li"))
              ) {{
                const shellLi = document.createElement("li");
                const shellList = document.createElement(sourceList.tagName.toLowerCase());
                while (fragment.firstChild) shellLi.appendChild(fragment.firstChild);
                shellList.appendChild(shellLi);
                fragment.appendChild(shellList);
              }}
            }}

            const startNode = document.querySelector('[data-knotis-slide-marker="slide-break"]');
            const endNode = document.querySelector('[data-knotis-slide-marker="slide-end"]');
            const range = document.createRange();
            range.setStartAfter(startNode);
            range.setEndBefore(endNode);
            const fragment = range.cloneContents();
            repairPartialListRange(fragment, startNode);
            const div = document.createElement('div');
            div.appendChild(fragment.cloneNode(true));
            const topLi = div.querySelector('ul > li');
            if (!topLi?.querySelector(':scope > p')) {{
              console.error(div.innerHTML);
              process.exit(1);
            }}
            """
        )
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            self.fail(
                "slide-break inside li should keep lead paragraph inside ul > li:\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )

    def test_slide_split_before_sibling_li_drops_empty_tail(self) -> None:
        runtime = self._node_jsdom_runtime()
        if runtime is None:
            self.skipTest("Node/jsdom runtime is unavailable for slide fragment tests")
        node, jsdom_entry = runtime
        slides_path = SRC_DIR / "knotis" / "assets" / "knotis-slides.js"
        script = textwrap.dedent(
            f"""
            import {{ JSDOM }} from {jsdom_entry!r};
            import fs from 'fs';

            const slidesJs = fs.readFileSync({str(slides_path)!r}, 'utf8');
            const helperSource = slidesJs.slice(
              slidesJs.indexOf('function cleanText('),
              slidesJs.indexOf('function walkClickBoundaries('),
            );
            const dom = new JSDOM(`<!DOCTYPE html><html><body><div class="md-typeset">
            <h3>Overview</h3><ul>
            <li><p>Lead item</p><ul>
            <li><p>Nested values</p><ul>
            <li>value one</li>
            <li><span data-knotis-slide-marker="slide-break" hidden="hidden"></span><table><tr><td>x</td></tr></table></li>
            </ul></li></ul></li></ul></div></body></html>`);
            const document = dom.window.document;
            const Node = dom.window.Node;
            const NodeFilter = dom.window.NodeFilter;
            const run = new Function('document', 'Node', 'NodeFilter', helperSource + `
              function resetMermaidClone() {{}}
              function article() {{ return null; }}
              let slideBodySerial = 0;
              const start = document.querySelector('h3');
              const end = document.querySelector('[data-knotis-slide-marker="slide-break"]');
              const fragment = cloneRangeFragment(start, end);
              const div = document.createElement('div');
              div.appendChild(fragment.cloneNode(true));
              const emptyTail = Array.from(div.querySelectorAll('li')).filter(
                (li) => !(li.textContent || '').replace(/\\s+/g, '').trim()
              );
              if (emptyTail.length) {{
                console.error(String(emptyTail.length));
                process.exit(1);
              }}
            `);
            run(document, Node, NodeFilter);
            """
        )
        result = subprocess.run(
            [node, "--input-type=module", "-e", script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            self.fail(
                "slide split before sibling li should not leave empty list items:\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )

    def test_slide_end_after_standalone_image_paragraph_not_inside_p(self) -> None:
        base_markdown = textwrap.dedent(
            """
            10. **Plots tab:** This displays any graph you produce.

            ![Plots screenshot](plots-tab.png)

            11. **Packages tab:** This shows packages.
            """
        ).strip()
        marked_markdown = textwrap.dedent(
            """
            10. **Plots tab:** This displays any graph you produce.

            ![Plots screenshot](plots-tab.png)

            <!-- slide-end -->
            <!-- slide-break -->
            11. **Packages tab:** This shows packages.
            """
        ).strip()
        base_html, marked_html = self.assert_render_neutral_markers(
            base_markdown,
            marked_markdown,
            ["slide-end", "slide-break"],
        )
        self.assertRegex(
            marked_html,
            r'alt="Plots screenshot"[^>]*/>\s*</p>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )
        self.assertNotRegex(
            marked_html,
            r'<p>\s*<img[^>]*alt="Plots screenshot"[^>]*/>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )

    def test_module_01_marker_count(self) -> None:
        module_path = self._zensical_site_root() / "docs" / "modules" / "01.-introduction-to-rstudio.md"
        if not module_path.exists():
            self.skipTest("Module 01 markdown is unavailable")
        markdown_text = module_path.read_text(encoding="utf-8")
        source_markers = 0
        slide_open = False
        for m in re.finditer(r"<!--\s*(slide-end|slide-break)\b", markdown_text, re.I):
            kind = m.group(1).lower()
            if kind == "slide-break":
                if slide_open:
                    source_markers += 1  # slide-end from break
                source_markers += 1  # slide-break opener
                slide_open = True
            elif kind == "slide-end":
                source_markers += 1
                slide_open = False
        html = self.render_zensical_html(
            markdown_text,
            markdown_path="docs/modules/01.-introduction-to-rstudio.md",
        )
        self.assertEqual(html.count('data-knotis-slide-marker'), source_markers)
        idx = html.find("more-detailed-look")
        self.assertGreater(idx, -1)
        chunk = html[idx : idx + 900]
        self.assertRegex(chunk, r"</ul>\s*<span\b[^>]*data-knotis-slide-marker=\"slide-end\"")
        self.assertRegex(chunk, r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<ol>')

    def test_module_01_open_rstudio_slide_keeps_list_content(self) -> None:
        module_path = self._zensical_site_root() / "docs" / "modules" / "01.-introduction-to-rstudio.md"
        if not module_path.exists():
            self.skipTest("Module 01 markdown is unavailable")
        html = self.render_zensical_html(
            module_path.read_text(encoding="utf-8"),
            markdown_path="docs/modules/01.-introduction-to-rstudio.md",
        )
        idx = html.find("open_rstudio_run_script_codes")
        self.assertGreater(idx, -1)
        chunk = html[idx : idx + 1200]
        self.assertNotRegex(
            chunk,
            r'open_rstudio_run_script_codes[^>]*/>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )
        self.assertRegex(
            chunk,
            r'open the script file\.</li>\s*</ul>\s*</li>\s*</ol>\s*</li>\s*</ul>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )

    def test_module_01_files_plots_tabs_split_inside_ordered_list(self) -> None:
        module_path = self._zensical_site_root() / "docs" / "modules" / "01.-introduction-to-rstudio.md"
        if not module_path.exists():
            self.skipTest("Module 01 markdown is unavailable")
        html = self.render_zensical_html(
            module_path.read_text(encoding="utf-8"),
            markdown_path="docs/modules/01.-introduction-to-rstudio.md",
        )
        idx = html.find("files-tab.png")
        self.assertGreater(idx, -1)
        chunk = html[idx : idx + 2200]
        self.assertNotRegex(
            chunk,
            r'files-tab\.png[^>]*/>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )
        self.assertRegex(
            chunk,
            r'files-tab\.png[^>]*/>(?:\s*</p>)?\s*</li>\s*</ul>\s*</li>\s*'
            r'<li><strong>\[\[Plots tab\|ref\]\]:',
        )
        self.assertRegex(
            chunk,
            r'plots-tab\.png[^>]*/>(?:\s*</p>)?\s*</li>\s*</ul>\s*</li>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )
        self.assertRegex(
            chunk,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li><strong>Packages tab:',
        )
        self.assertNotRegex(chunk, r'<ol start="10">')

    def test_module_01_table_view_slide_keeps_ordered_list_numbering(self) -> None:
        module_path = self._zensical_site_root() / "docs" / "modules" / "01.-introduction-to-rstudio.md"
        if not module_path.exists():
            self.skipTest("Module 01 markdown is unavailable")
        html = self.render_zensical_html(
            module_path.read_text(encoding="utf-8"),
            markdown_path="docs/modules/01.-introduction-to-rstudio.md",
        )
        idx = html.find("Table view")
        self.assertGreater(idx, -1)
        chunk = html[idx - 400 : idx + 900]
        self.assertRegex(
            chunk,
            r'data-knotis-slide-marker="slide-break"[^>]*></span>\s*<li><strong>Table view:',
        )
        self.assertRegex(
            chunk,
            r'We will paste the R script file codes here and hit "Enter" when we open RStudio\.</li>\s*</ol>\s*</li>\s*'
            r'<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )
        self.assertNotRegex(
            chunk,
            r'</ol>\s*<span\b[^>]*data-knotis-slide-marker="slide-end"',
        )

    def test_reference_alias_renders_as_target_text(self) -> None:
        target, label = MODULE.split_wikilink_parts("RStudio console|ref")

        self.assertEqual(target, "RStudio console")
        self.assertEqual(label, "RStudio console")
        self.assertEqual(MODULE.normalize("RStudio console|ref"), "rstudio console")
        self.assertEqual(MODULE.wikilink_mode("RStudio console|ref"), "reference")
        self.assertEqual(MODULE.wikilink_mode("RStudio console|reference"), "reference")
        self.assertEqual(MODULE.wikilink_mode("RStudio console|console"), "concept")

    def test_ref_sources_drive_references_and_filter_plain_mentions_from_index(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# Home\n\n"
            "Paste into [[RStudio console]].\n\n"
            "## Reference source\n"
            "- Paste the code into [[RStudio console|ref]].\n"
            "- Hit Enter.\n",
            encoding="utf-8",
        )
        other_path = docs_dir / "other.md"
        other_path.write_text("# Other\n\nUse [[RStudio console]] again.\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        references = json.loads((docs_dir / "assets" / "references.json").read_text(encoding="utf-8"))
        wikilinks = json.loads((docs_dir / "assets" / "wikilinks.json").read_text(encoding="utf-8"))
        self.assertIn("rstudio console", references)
        self.assertEqual(len(references["rstudio console"]), 1)
        self.assertEqual(references["rstudio console"][0]["page_url"], "./")
        self.assertEqual(references["rstudio console"][0]["title"], "RStudio console")
        self.assertIn("- Paste the code into [[RStudio console|ref]].", references["rstudio console"][0]["section_lines"])
        self.assertIn("rstudio console", wikilinks)
        self.assertEqual(len(wikilinks["rstudio console"]), 1)
        self.assertEqual(wikilinks["rstudio console"][0]["title"], "RStudio console")
        self.assertEqual(wikilinks["rstudio console"][0]["mode"], "reference")

    def test_multiple_reference_sources_for_one_concept_are_all_kept(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# Home\n\n"
            "## Interface\n"
            "- **(14) [[RStudio console|ref]] tab:** This shows the codes that were run.\n\n"
            "## Open website\n"
            "### Open RStudio Cloud website: Use RStudio console\n"
            "1. Open RStudio Cloud website.\n"
            "2. Paste the code into [[RStudio console|ref]].\n",
            encoding="utf-8",
        )
        (docs_dir / "other.md").write_text("# Other\n\nUse [[Rstudio console]].\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        references = json.loads((docs_dir / "assets" / "references.json").read_text(encoding="utf-8"))
        wikilinks = json.loads((docs_dir / "assets" / "wikilinks.json").read_text(encoding="utf-8"))

        self.assertIn("rstudio console", references)
        self.assertEqual(len(references["rstudio console"]), 2)
        self.assertEqual([entry["title"] for entry in references["rstudio console"]], ["RStudio console", "RStudio console"])
        self.assertIn("rstudio console", wikilinks)
        self.assertEqual(len(wikilinks["rstudio console"]), 2)
        self.assertTrue(all(entry["mode"] == "reference" for entry in wikilinks["rstudio console"]))

    def test_reference_pane_uses_only_explicit_reference_cards(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# Module\n\n"
            "## [[Modeling types]]\n"
            "- Intro line\n"
            "    1. **[[Explanatory modeling|ref]]**\n"
            "        - Definition bullet.\n"
            "    - Transition bullet.\n"
            "### Example one\n"
            "- [[Explanatory modeling]] in the example.\n"
            "### Example two\n"
            "- [[Explanatory modeling]] again.\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        references = json.loads((docs_dir / "assets" / "references.json").read_text(encoding="utf-8"))
        wikilinks = json.loads((docs_dir / "assets" / "wikilinks.json").read_text(encoding="utf-8"))
        entries = references["explanatory modeling"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["heading_path"], ["Module", "Modeling types"])
        self.assertIn("[[Explanatory modeling|ref]]", "\n".join(entries[0]["section_lines"]))
        self.assertEqual(len(wikilinks["explanatory modeling"]), 1)
        self.assertEqual(wikilinks["explanatory modeling"][0]["mode"], "reference")

    def test_reference_heading_path_ignores_fenced_code_comments(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# Module\n\n"
            "## [[How to work with codes]]\n"
            "- **The workflow:**\n"
            "    - ```r linenums=\"1\"\n"
            "    # WORKING SPACE-------\n"
            "    frq(gss$variable_here, out = \"v\")\n"
            "    ```\n"
            "## [[Find this working code in the R script file|ref]]\n"
            "- All the working code are above the [[working space]].\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        references = json.loads((docs_dir / "assets" / "references.json").read_text(encoding="utf-8"))
        entry = references["find this working code in the r script file"][0]
        self.assertEqual(entry["heading_path"], ["Module", "Find this working code in the R script file"])
        self.assertNotIn("WORKING SPACE", " > ".join(entry["heading_path"]))

    def test_main_includes_reference_definitions_on_definition_page_graph(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# [[Keyboard shortcuts]]\n\n"
            "## [[Using R script files]]\n"
            "### [[Working space|ref]]\n"
            "- Paste code under [[Working space|ref]].\n\n"
            "### [[Highlighting and running|ref]]\n"
            "- [[Highlighting and running|ref]] executes the code.\n\n"
            "- Use [[outline view]].\n\n"
            "### [[Find this working code in the R script file|ref]]\n"
            "- All the working code are above the [[working space]].\n"
            "- Use [[outline view]].\n"
            "- [[Highlighting and running]] the working code will generate the exact output shown on the module page.\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        node_ids = {node["id"] for node in graph["nodes"]}
        page_urls = {
            edge["page"]
            for edge in [*graph["page_graph_page_edges"], *graph["page_hierarchy_edges"]]
        }
        self.assertEqual(page_urls, {"./"})
        page_url = "./"
        page_local_keyword_ids = {
            edge["target"]
            for edge in graph["page_graph_page_edges"]
            if edge["page"] == page_url
        } | {
            edge["target"]
            for edge in graph["page_hierarchy_edges"]
            if edge["page"] == page_url
        } | {
            edge["source"]
            for edge in graph["page_hierarchy_edges"]
            if edge["page"] == page_url
        }
        for keyword_id in (
            "kw:working space",
            "kw:highlighting and running",
            "kw:find this working code in the r script file",
        ):
            self.assertIn(keyword_id, node_ids)
            self.assertIn(keyword_id, page_local_keyword_ids)

    def test_moc_nav_uses_clickable_page_node_as_graph_parent(self) -> None:
        _root, docs_dir = self.make_project(
            """
[project]
site_name = "Test"
nav = [
  { "Resources" = [
    { "How to use this site" = "resources/how-to-use-this-site.md" },
  ] },
]
""".lstrip()
        )
        (docs_dir / "resources" / "how-to-use-this-site").mkdir(parents=True)
        (docs_dir / "resources" / "how-to-use-this-site.md").write_text(
            "\n".join(
                [
                    "---",
                    'title: "How to use this site"',
                    "moc: true",
                    "moc_nav: false",
                    "moc_pages:",
                    "  - how-to-use-this-site/search.md",
                    "  - how-to-use-this-site/pane.md",
                    "---",
                    "",
                    "# [[How to use this site]]",
                    "",
                ]
            ),
            encoding="utf-8",
        )
        (docs_dir / "resources" / "how-to-use-this-site" / "search.md").write_text(
            "# [[Search]]\n",
            encoding="utf-8",
        )
        (docs_dir / "resources" / "how-to-use-this-site" / "pane.md").write_text(
            "# [[Pane]]\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        nav_edges = {
            (edge["source"], edge["target"])
            for edge in graph["edges"]
            if edge["relation"] == "nav"
        }
        self.assertIn(("cat:Resources", "page:resources/how-to-use-this-site/"), nav_edges)
        self.assertIn(
            ("page:resources/how-to-use-this-site/", "page:resources/how-to-use-this-site/search/"),
            nav_edges,
        )
        self.assertIn(
            ("page:resources/how-to-use-this-site/", "page:resources/how-to-use-this-site/pane/"),
            nav_edges,
        )
        self.assertNotIn(("cat:How to use this site", "page:resources/how-to-use-this-site/search/"), nav_edges)

    def test_inline_code_reference_examples_do_not_become_graph_parents(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# [[Features at glance]]\n\n"
            "## [[Wikilink]]\n"
            "- Wikilinks are the foundation for identifying and connecting concepts.\n"
            "### [[Reference]]\n"
            "- Add `|ref` to a wikilink, such as `[[sample reference|ref]]`.\n"
            "  - [[sample reference|ref]]\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        references = json.loads((docs_dir / "assets" / "references.json").read_text(encoding="utf-8"))
        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }
        page_graph_hierarchy_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_hierarchy_edges"]
        }

        self.assertEqual(len(references["sample reference"]), 1)
        self.assertNotIn(
            ("./", "page:./", "kw:sample reference"),
            page_graph_page_edges,
        )
        self.assertIn(
            ("./", "kw:reference", "kw:sample reference"),
            page_graph_hierarchy_edges,
        )

    def test_main_keeps_filtered_reference_backed_mentions_hierarchical(self) -> None:
        _root, docs_dir = self.make_project(
            """
[project]
site_name = "Test"
nav = [{ Lesson = "lesson.md" }]
""".lstrip()
        )
        (docs_dir / "lesson.md").write_text(
            "# [[Keyboard shortcuts]]\n\n"
            "### [[Copy the code|ref]]\n"
            "- Copy the code from the module page.\n\n"
            "### [[Files tab|ref]]\n"
            "- Open the files tab in RStudio.\n\n"
            "### [[Find this working code in the R script file|ref]]\n"
            "- Look above the [[copy the code]].\n"
            "- Open the [[files tab]].\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }
        node_ids = {node["id"] for node in graph["nodes"]}
        edge_ids = {
            (edge["source"], edge["target"])
            for edge in [*graph["edges"], *graph["page_hierarchy_edges"], *graph["page_graph_page_edges"]]
        }
        page_url = "lesson/"
        self.assertIn(
            (page_url, "page:lesson/", "kw:keyboard shortcuts"),
            page_graph_page_edges,
        )
        self.assertIn("kw:copy the code", node_ids)
        self.assertIn("kw:files tab", node_ids)
        self.assertIn("kw:find this working code in the r script file", node_ids)

    def test_main_keeps_reference_backed_concepts_out_of_other_page_graphs(self) -> None:
        _root, docs_dir = self.make_project(
            """
[project]
site_name = "Test"
nav = [
  { Lesson = "lesson.md" },
  { Other = "other.md" },
]
""".lstrip()
        )
        (docs_dir / "lesson.md").write_text(
            "# Lesson\n\n"
            "### [[Working code|ref]]\n"
            "- This page defines the reference.\n\n"
            "### [[Model code|ref]]\n"
            "- This page also defines [[model code|ref]].\n",
            encoding="utf-8",
        )
        (docs_dir / "other.md").write_text(
            "# Other\n\n"
            "- [[t-test]]\n"
            "    - [[working code]]\n"
            "    - [[model code]]\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }
        page_graph_hierarchy_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_hierarchy_edges"]
        }
        node_ids = {node["id"] for node in graph["nodes"]}

        self.assertNotIn(
            ("other/", "page:other/", "kw:working code"),
            page_graph_page_edges,
        )
        self.assertNotIn(
            ("other/", "page:other/", "kw:model code"),
            page_graph_page_edges,
        )
        self.assertNotIn(
            ("other/", "kw:t-test", "kw:working code"),
            page_graph_hierarchy_edges,
        )
        self.assertNotIn(
            ("other/", "kw:t-test", "kw:model code"),
            page_graph_hierarchy_edges,
        )
        self.assertIn("kw:working code", node_ids)
        self.assertIn("kw:model code", node_ids)
        self.assertIn(
            ("lesson/", "page:lesson/", "kw:working code"),
            page_graph_page_edges,
        )
        self.assertIn(
            ("lesson/", "page:lesson/", "kw:model code"),
            page_graph_page_edges,
        )

    def test_reference_backed_instruction_terms_do_not_leak_as_graph_parents(self) -> None:
        _root, docs_dir = self.make_project(
            """
[project]
site_name = "Test"
nav = [
  { HowTo = "how-to.md" },
  { Lesson = "lesson.md" },
]
""".lstrip()
        )
        (docs_dir / "how-to.md").write_text(
            "# How to\n\n"
            "## [[Search|ref]]\n"
            "Use the search UI.\n",
            encoding="utf-8",
        )
        (docs_dir / "lesson.md").write_text(
            "# Lesson\n\n"
            "- [[Search]] the variable name.\n"
            "- Create a [[descriptive table]].\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        references = json.loads((docs_dir / "assets" / "references.json").read_text(encoding="utf-8"))
        node_ids = {node["id"] for node in graph["nodes"]}
        edge_ids = {
            (edge["source"], edge["target"])
            for edge in [*graph["edges"], *graph["page_hierarchy_edges"], *graph["page_graph_page_edges"]]
        }
        self.assertIn("search", references)
        self.assertIn("kw:search", node_ids)
        self.assertIn("kw:descriptive table", node_ids)
        self.assertIn(
            ("page:how-to/", "kw:search"),
            {
                (edge["source"], edge["target"])
                for edge in graph["page_graph_page_edges"]
            },
        )
        self.assertFalse(
            any(
                edge["page"] == "lesson/" and (
                    edge["source"] == "kw:search" or edge["target"] == "kw:search"
                )
                for edge in graph["page_hierarchy_edges"]
            )
        )
        self.assertNotIn(
            ("lesson/", "page:lesson/", "kw:search"),
            {
                (edge["page"], edge["source"], edge["target"])
                for edge in graph["page_graph_page_edges"]
            },
        )

    def test_reference_sibling_edges_stay_off_plain_link_pages(self) -> None:
        _root, docs_dir = self.make_project(
            """
[project]
site_name = "Test"
nav = [
  { HowTo = "how-to.md" },
  { Lesson = "lesson.md" },
]
""".lstrip()
        )
        (docs_dir / "how-to.md").write_text(
            "# How to\n\n"
            "## [[Search|ref]]\n"
            "Use the search UI.\n",
            encoding="utf-8",
        )
        (docs_dir / "lesson.md").write_text(
            "# Lesson\n\n"
            "- [[Search]]\n"
            "    - [[descriptive table]]\n"
            "        - ```r\n"
            "        summary(x)\n"
            "        ```\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        sibling_edges = {
            (edge["source"], edge["target"], tuple(sorted(edge.get("pages") or ())))
            for edge in graph["edges"]
            if edge.get("relation") == "sibling"
        }

        self.assertNotIn(
            ("kw:search", "kw:descriptive table", ("lesson/",)),
            sibling_edges,
        )
        self.assertNotIn(
            ("kw:descriptive table", "kw:search", ("lesson/",)),
            sibling_edges,
        )

    def test_page_edges_only_connect_pages_to_root_concepts(self) -> None:
        graph = self.build_graph_for_page(
            "lesson.md",
            "# Lesson\n\n"
            "- [[keyboard shortcuts]]\n"
            "    - [[hand and finger positions]]\n"
            "    - [[mouse shortcuts]]\n",
        )

        full_edges = {
            (edge["source"], edge["target"], edge["relation"])
            for edge in graph["edges"]
        }
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }

        self.assertIn(("page:lesson/", "kw:keyboard shortcuts", "page"), full_edges)
        self.assertNotIn(("page:lesson/", "kw:hand and finger positions", "page"), full_edges)
        self.assertNotIn(("page:lesson/", "kw:mouse shortcuts", "page"), full_edges)
        self.assertIn(("kw:keyboard shortcuts", "kw:hand and finger positions", "hierarchy"), full_edges)
        self.assertIn(("kw:keyboard shortcuts", "kw:mouse shortcuts", "hierarchy"), full_edges)
        self.assertEqual(
            page_graph_page_edges,
            {("lesson/", "page:lesson/", "kw:keyboard shortcuts")},
        )

    def test_ordered_list_under_wikilink_heading_nests_under_heading(self) -> None:
        graph = self.build_graph_for_page(
            "recoding.md",
            "# [[Reasons for recoding]]\n"
            "- There are three reasons for recoding:\n"
            "  1. [[Merging values]]\n"
            "  2. [[Reversing values]]\n"
            "  3. [[Transforming continuous variables into groups]]\n",
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }
        children = {
            "kw:merging values",
            "kw:reversing values",
            "kw:transforming continuous variables into groups",
        }

        self.assertEqual(edges[("page:recoding/", "kw:reasons for recoding")], "page")
        for child in children:
            self.assertEqual(edges[("kw:reasons for recoding", child)], "hierarchy")
            self.assertNotIn(("page:recoding/", child), edges)
        self.assertEqual(
            page_graph_page_edges,
            {("recoding/", "page:recoding/", "kw:reasons for recoding")},
        )

    def test_explicit_subheading_nests_under_leading_wikilink_h1(self) -> None:
        graph = self.build_graph_for_page(
            "search.md",
            "# [[Search]]\n\n"
            "- Open search from the header.\n\n"
            "## [[Search order]]\n"
            "1. Wikilink-first ranking.\n",
        )

        edges = {
            (edge["source"], edge["target"]): edge["relation"]
            for edge in graph["edges"]
        }
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }

        self.assertEqual(edges[("page:search/", "kw:search")], "page")
        self.assertEqual(edges[("kw:search", "kw:search order")], "hierarchy")
        self.assertNotIn(("page:search/", "kw:search order"), edges)
        self.assertEqual(
            page_graph_page_edges,
            {("search/", "page:search/", "kw:search")},
        )

    def test_page_local_hierarchy_roots_still_connect_to_page(self) -> None:
        _root, docs_dir = self.make_project(
            """
[project]
site_name = "Test"
nav = [{ Lesson = "lesson.md" }]
""".lstrip()
        )
        md_path = docs_dir / "lesson.md"
        md_path.write_text("# Lesson\n", encoding="utf-8")
        occurrences = [
            {
                "keyword": "root concept",
                "page_url": "lesson/",
                "mode": "normal",
                "hierarchy_parent_kw": "invisible heading parent",
                "hierarchy_parent_source": "heading",
            },
            {
                "keyword": "child concept",
                "page_url": "lesson/",
                "mode": "normal",
                "hierarchy_parent_kw": "root concept",
                "hierarchy_parent_source": "list",
            },
        ]
        config = MODULE._normalize_knotis_config(MODULE._load_toml_knotis_config())
        MODULE._finalize_content_tag_colors(config, {}, [])
        graph = MODULE.build_graph(
            occurrences,
            [md_path],
            nav_items=[],
            graph_view_config=config,
        )

        full_edges = {
            (edge["source"], edge["target"], edge["relation"])
            for edge in graph["edges"]
        }
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }

        self.assertIn(("page:lesson/", "kw:root concept", "page"), full_edges)
        self.assertIn(("kw:root concept", "kw:child concept", "hierarchy"), full_edges)
        self.assertNotIn(("page:lesson/", "kw:child concept", "page"), full_edges)
        self.assertIn(("lesson/", "page:lesson/", "kw:root concept"), page_graph_page_edges)

    def test_build_graph_emits_page_tag_metadata_and_site_graph_filters(self) -> None:
        graph = self.build_graph_for_page(
            "lesson.md",
            (
                "---\n"
                "tags:\n"
                "  - SOC399\n"
                "  - Resources\n"
                "---\n"
                "# Lesson\n\n"
                "[[Frequency table]]\n"
            ),
            toml_text=
            """
[project]
site_name = "Test"
nav = [{ Lesson = "lesson.md" }]

[project.extra.knotis.site_graph.graph]
default_view = "all"
exclude_tags = ["#SOC399", "Resources"]
""".lstrip(),
        )

        page_node = next(node for node in graph["nodes"] if node["id"] == "page:lesson/")
        self.assertEqual(page_node["tag_keys"], ["soc399", "resources"])
        self.assertEqual(page_node["tags"], ["#SOC399", "#Resources"])

        graph_cfg = graph["meta"]["knotis"]["site_graph"]["graph"]
        self.assertEqual(graph_cfg["default_view"], "all")
        self.assertEqual(
            graph_cfg["exclude_tags"],
            [
                {"key": "soc399", "label": "#SOC399"},
                {"key": "resources", "label": "#Resources"},
            ],
        )
        self.assertEqual(
            graph_cfg["available_tags"],
            [
                {"key": "resources", "label": "#Resources"},
                {"key": "soc399", "label": "#SOC399"},
            ],
        )

    def test_site_graph_default_view_normalizes_page_tag(self) -> None:
        graph = self.build_graph_for_page(
            "lesson.md",
            (
                "---\n"
                "tags:\n"
                "  - Module\n"
                "---\n"
                "# Lesson\n\n"
                "[[Frequency table]]\n"
            ),
            toml_text=
            """
[project]
site_name = "Test"
nav = [{ Lesson = "lesson.md" }]

[project.extra.knotis.site_graph.graph]
default_view = "Module"
""".lstrip(),
        )
        graph_cfg = graph["meta"]["knotis"]["site_graph"]["graph"]
        self.assertEqual(graph_cfg["default_view"], "module")

    def test_build_graph_emits_extended_graph_config(self) -> None:
        graph = self.build_graph_for_page(
            "lesson.md",
            "# Lesson\n\n[[Frequency table]]\n",
            toml_text=
            """
[project]
site_name = "Test"
nav = [{ Lesson = "lesson.md" }]

[project.extra.knotis.defaults.graph]
enabled = true

[project.extra.knotis.defaults.layout]
fit_mode = "loose"
fit_padding = 72
initial_zoom = 1.4

[project.extra.knotis.defaults.physics]
link_distance = 140
charge_strength = -900
charge_range = 1200

[project.extra.knotis.defaults.labels]
show = true
mode = "zoom"
font_size = 16
keyword_zoom_threshold = 1.2

[project.extra.knotis.defaults.n_hops]
enabled = true
show_control = false
default = 3
min = 1
max = 7

[project.extra.knotis.defaults.hover]
enabled = true
dim_enabled = false
include_siblings = true
include_sibling_edges = true

[project.extra.knotis.defaults.edges]
sibling_opacity = 0.5
sibling_width = 1.2

[project.extra.knotis.defaults.controls]
show_zoom = false
show_search = false

[project.extra.knotis.concept_graph.graph]
enabled = false
""".lstrip(),
        )

        meta = graph["meta"]["knotis"]
        self.assertEqual(meta["defaults"]["layout"]["fit_mode"], "loose")
        self.assertEqual(meta["defaults"]["layout"]["fit_padding"], 72)
        self.assertEqual(meta["defaults"]["physics"]["charge_strength"], -900.0)
        self.assertEqual(meta["defaults"]["labels"]["mode"], "zoom")
        self.assertEqual(meta["defaults"]["n_hops"]["default"], 3)
        self.assertFalse(meta["defaults"]["n_hops"]["show_control"])
        self.assertTrue(meta["defaults"]["hover"]["include_siblings"])
        self.assertEqual(meta["defaults"]["edges"]["sibling_width"], 1.2)
        self.assertFalse(meta["defaults"]["controls"]["show_zoom"])
        self.assertFalse(meta["concept_graph"]["graph"]["enabled"])

    def test_invalid_extended_graph_config_falls_back_with_warning(self) -> None:
        _root, docs_dir = self.make_project(
            """
[project]
site_name = "Test"
nav = [{ Lesson = "lesson.md" }]

[project.extra.knotis.defaults.layout]
fit_mode = "squish"

[project.extra.knotis.defaults.physics]
link_distance_min = 300
link_distance_max = 100

[project.extra.knotis.defaults.labels]
show = "yes"

[project.extra.knotis.defaults.n_hops]
min = 9
max = 2

[project.extra.knotis.defaults.controls]
show_zoom = "sometimes"
""".lstrip()
        )
        (docs_dir / "lesson.md").write_text("# Lesson\n\n[[Frequency table]]\n", encoding="utf-8")

        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(MODULE._load_toml_knotis_config())

        self.assertIn("knotis.defaults.layout.fit_mode", stderr.getvalue())
        self.assertEqual(config["defaults"]["layout"]["fit_mode"], "fit")
        self.assertEqual(config["defaults"]["physics"]["link_distance_min"], 90)
        self.assertEqual(config["defaults"]["physics"]["link_distance_max"], 340)
        self.assertTrue(config["defaults"]["labels"]["show"])
        self.assertEqual(config["defaults"]["n_hops"]["min"], 1)
        self.assertEqual(config["defaults"]["n_hops"]["max"], 5)
        self.assertEqual(config["defaults"]["controls"]["show_zoom"], "auto")

    def test_disabled_graph_ui_still_emits_graph_data(self) -> None:
        graph = self.build_graph_for_page(
            "lesson.md",
            "# Lesson\n\n[[Frequency table]]\n",
            toml_text=
            """
[project]
site_name = "Test"
nav = [{ Lesson = "lesson.md" }]

[project.extra.knotis.site_graph.graph]
enabled = false

[project.extra.knotis.page_graph.graph]
enabled = false

[project.extra.knotis.concept_graph.graph]
enabled = false
""".lstrip(),
        )

        self.assertGreater(len(graph["nodes"]), 0)
        self.assertGreater(len(graph["edges"]), 0)
        meta = graph["meta"]["knotis"]
        self.assertFalse(meta["site_graph"]["graph"]["enabled"])
        self.assertFalse(meta["page_graph"]["graph"]["enabled"])
        self.assertFalse(meta["concept_graph"]["graph"]["enabled"])

    def test_main_writes_content_tag_index_without_treating_headings_as_tags(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "# Home\n\n"
            "## Analysis #code\n\n"
            "- Run this block. #code\n\n"
            "Do not index [local](#anchor) or `#inline`.\n\n"
            "<span style=\"border-color: #aaa\">not a tag</span>\n\n"
            "```r\n"
            "#code inside a comment\n"
            "```\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        content_tags = json.loads((docs_dir / "assets" / "content-tags.json").read_text(encoding="utf-8"))
        self.assertIn("#code", content_tags)
        self.assertEqual(len(content_tags["#code"]), 2)
        self.assertNotIn("#home", content_tags)
        self.assertNotIn("#anchor", content_tags)
        self.assertNotIn("#aaa", content_tags)
        self.assertEqual(content_tags["#code"][0]["page_title"], "Home")
        self.assertIn("section_lines_raw", content_tags["#code"][0])

    def test_main_writes_knotis_search_index_with_entities_and_exclusions(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "index.md").write_text(
            "---\n"
            "tags: [Setup, Navigation]\n"
            "---\n"
            "# Home\n\n"
            "## Visible section\n\n"
            "[[Frequency table]] uses `frq()` output. #code\n\n"
            "##### Tiny visible heading\n\n"
            "Tiny heading text should stay searchable through the parent section.\n\n"
            "## R Script file { data-search-exclude }\n\n"
            "This hidden setup code should not be searchable.\n\n"
            "### Nested hidden heading\n\n"
            "Nested hidden text should not be searchable.\n\n"
            "## Learning outcomes { data-search-exclude }\n\n"
            "This hidden outcome text should not be searchable.\n\n"
            "## Reference source\n\n"
            "- Use the [[RStudio console|ref]].\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        docs = search["docs"]
        kinds = {doc["kind"] for doc in docs}
        titles = {doc["title"] for doc in docs}
        combined_text = " ".join(doc.get("text", "") for doc in docs)

        self.assertTrue(search["options"]["enabled"])
        self.assertTrue(search["options"]["suggest"])
        self.assertTrue(search["options"]["filters"])
        self.assertNotIn("share", search["options"])
        self.assertIn("page", kinds)
        self.assertIn("section", kinds)
        self.assertIn("concept", kinds)
        self.assertIn("reference", kinds)
        self.assertIn("content_tag", kinds)
        self.assertIn("Visible section", titles)
        self.assertIn("Frequency table", titles)
        self.assertIn("RStudio console", titles)
        self.assertIn("#code", titles)
        self.assertNotIn("Tiny visible heading", titles)
        self.assertIn("Tiny heading text", combined_text)
        self.assertNotIn("R Script file", titles)
        self.assertNotIn("Nested hidden heading", titles)
        self.assertNotIn("Learning outcomes", titles)
        self.assertNotIn("hidden setup code", combined_text)
        self.assertNotIn("Nested hidden text", combined_text)
        self.assertNotIn("hidden outcome text", combined_text)
        visible = next(doc for doc in docs if doc["kind"] == "section" and doc["title"] == "Visible section")
        self.assertIn("Frequency table", visible["concepts"])
        self.assertIn("frequency table", visible["concept_keys"])
        self.assertEqual(visible["primary_concept"], "Frequency table")
        self.assertIn("#code", visible["content_tags"])
        self.assertEqual(visible["filter_tags"], ["Setup", "Navigation"])
        self.assertEqual(visible["breadcrumb"], ["Visible section"])
        self.assertIn("## Visible section", visible["render_context"])

    def test_main_writes_disabled_knotis_search_index_stub(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.search]
enabled = false
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text("# Home\n\n[[Frequency table]]\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        self.assertFalse(search["options"]["enabled"])
        self.assertEqual(search["docs"], [])
        self.assertEqual(search["meta"]["counts"], {})

    def test_parse_content_tags_preserves_section_context_for_pane_cards(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "### [[Linear regression]] 1 factor #code\n\n"
            "```r\n"
            "# model code\n"
            "model1 <- lm(outcome_here ~ factor1_here, data = gss)\n"
            "```\n\n"
            "- Note that we'll introduce the predictor variables one by one.\n\n"
            "### Next section\n\n"
            "Done.\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_content_tags_file(md_path)

        self.assertEqual([occ["content_tag"] for occ in occurrences], ["#code"])
        self.assertEqual(occurrences[0]["heading_path"], ["Module", "Linear regression 1 factor #code"])
        self.assertEqual(occurrences[0]["section_kw_offset"], 0)
        self.assertIn("# model code", occurrences[0]["section_lines"])
        self.assertIn("```r", "\n".join(occurrences[0]["section_lines_raw"]))
        self.assertIn("- Note that we'll introduce the predictor variables one by one.", occurrences[0]["section_lines"])
        self.assertNotIn("### Next section", occurrences[0]["section_lines"])

    def test_search_index_records_nav_order_and_render_context(self) -> None:
        _root, docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
nav = [
  { "Second" = "second.md" },
  { "First" = "first.md" },
]
""".lstrip()
        )
        (docs_dir / "first.md").write_text(
            "# First\n\n"
            "## Details\n\n"
            "![r logo](images/r.png){ width=\"100\" }\n"
            "- Search &nbsp; :fontawesome-brands-apple: ++command+f++ for `binary`.\n"
            "- **Model code** stays bold in rendered snippets.\n"
            "```r\n"
            "frq(gss$variable_here, out = \"v\")\n"
            "```\n"
            "| Variable | Type |\n"
            "| --- | --- |\n"
            "| sex | Binary |\n",
            encoding="utf-8",
        )
        (docs_dir / "second.md").write_text(
            "# Second\n\n"
            "## Details\n\n"
            "Binary appears here too.\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        first = next(doc for doc in search["docs"] if doc["location"] == "first/#details")
        second = next(doc for doc in search["docs"] if doc["location"] == "second/#details")

        self.assertEqual(second["page_order"], 0)
        self.assertEqual(first["page_order"], 1)
        self.assertEqual(first["breadcrumb"], ["Details"])
        self.assertIn("- Search \xa0 command+f for `binary`.", first["context"])
        self.assertIn("- **Model code** stays bold in rendered snippets.", first["render_context"])
        self.assertIn('```r', first["render_context"])
        self.assertIn('frq(gss$variable_here, out = "v")', first["render_context"])
        self.assertIn("sex Binary", first["context"])
        self.assertNotIn("| sex | Binary |", first["context"])
        self.assertNotIn("r logo", " ".join(first["context"]))

    def test_search_render_context_preserves_list_prefixed_images_and_admonitions(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "sample.md").write_text(
            "# Sample\n\n"
            "## Section\n\n"
            "1. Confirmation step:\n"
            "    - ![Created successfully](images/ok.png){ width=\"400\" }\n"
            "    - !!! note \"Interpretation sample\"\n"
            "        Bullet one.\n",
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        section = next(doc for doc in search["docs"] if doc["location"] == "sample/#section")
        joined = "\n".join(section["render_context"])
        self.assertIn("![Created successfully](images/ok.png)", joined)
        self.assertIn('- !!! note "Interpretation sample"', joined)
        self.assertNotIn("    -\n", joined)

    def test_search_mention_docs_include_section_lines_raw(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "sample.md").write_text(
            "# Sample\n\n"
            "## Functions\n\n"
            "- A [[Factor variable]]:\n"
            "    - [[Outcome variable]] definition.\n",
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        mentions = [doc for doc in search["docs"] if doc.get("kind") == "mention"]
        self.assertTrue(mentions)
        factor = next(
            doc for doc in mentions
            if "factor variable" in " ".join(doc.get("concept_keys") or []).lower()
        )
        self.assertTrue(factor.get("section_lines_raw"))
        self.assertIn("[[Outcome variable]]", "\n".join(factor["section_lines_raw"]))

    def test_search_render_context_preserves_br_tags(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "sample.md").write_text(
            "# Sample\n\n"
            "## Section\n\n"
            "- | Label<br>column | Value |\n"
            "  | --- | --- |\n"
            "  | A | 1 |\n",
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        section = next(doc for doc in search["docs"] if doc["location"] == "sample/#section")
        joined = "\n".join(section["render_context"])
        self.assertIn("<br>", joined)

    def test_recoding_output_section_lines_keep_ordered_step(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "sample.md").write_text(
            "# Sample\n\n"
            "## Coding steps\n\n"
            "5. **[[Frequency table]] #output for marital**\n"
            "    - **Respondents' marital status**\n"
            "        - | value | label |\n"
            "          | --- | --- |\n"
            "          | 1 | Married |\n",
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        content_tags = json.loads((docs_dir / "assets" / "content-tags.json").read_text(encoding="utf-8"))
        output_entries = content_tags.get("#output") or []
        recoding = next(
            entry for entry in output_entries
            if any("Frequency table" in line for line in entry.get("section_lines_raw") or [])
        )
        lines = recoding.get("section_lines_raw") or []
        self.assertTrue(lines[0].startswith("5."))
        self.assertIn("Respondents' marital status", lines[1])
        self.assertTrue(any("| value |" in line for line in lines))

    def test_search_render_context_preserves_wikilink_markup(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "sample.md").write_text(
            "# Sample\n\n"
            "## Section\n\n"
            "- When both [[factor variable]] and [[outcome variable]] are categorical.\n"
            "- Plain outcome variable mention without brackets.\n",
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        section = next(doc for doc in search["docs"] if doc["location"] == "sample/#section")
        joined = "\n".join(section["render_context"])
        self.assertIn("[[factor variable]]", joined)
        self.assertIn("[[outcome variable]]", joined)
        self.assertIn("Plain outcome variable mention", joined)
        self.assertNotIn("[[Plain outcome variable mention", joined)

    def test_parse_content_tags_keeps_fenced_code_lines_after_code_comments(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "## Example\n\n"
            "#### Run this block #code\n\n"
            "```r\n"
            "# model code\n"
            "tab_corr(gss)\n"
            "```\n\n"
            "#### Next section\n\n"
            "Done.\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_content_tags_file(md_path)

        self.assertEqual(len(occurrences), 1)
        self.assertIn("# model code", occurrences[0]["section_lines"])
        self.assertIn("tab_corr(gss)", occurrences[0]["section_lines"])
        self.assertIn("```", occurrences[0]["section_lines"])
        self.assertIn("# model code", occurrences[0]["section_lines_raw"])
        self.assertIn("tab_corr(gss)", occurrences[0]["section_lines_raw"])

    def test_parse_content_tag_heading_stops_before_any_next_heading(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "## Recoding\n\n"
            "### [[Frequency table]] #code\n\n"
            "- **Model code**\n"
            "    ```r\n"
            "    frq(gss$variable_here, out = \"v\")\n"
            "    ```\n\n"
            "#### [[Frequency table]] #output\n\n"
            "| val | label |\n"
            "|-----|-------|\n"
            "| 1   | Married |\n\n"
            "### Next topic\n\n"
            "Done.\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_content_tags_file(md_path)
        code_occurrence = next(occ for occ in occurrences if occ["content_tag"] == "#code")

        self.assertEqual(code_occurrence["section_lines_raw"][0], "### [[Frequency table]] #code")
        self.assertIn("    frq(gss$variable_here, out = \"v\")", code_occurrence["section_lines_raw"])
        self.assertNotIn("#### [[Frequency table]] #output", code_occurrence["section_lines_raw"])
        self.assertNotIn("| 1   | Married |", code_occurrence["section_lines_raw"])

    def test_reference_section_after_list_prefixed_code_fence_starts_at_reference_heading(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "### R Script file { data-search-exclude }\n"
            "- Copy code into [[RStudio console]].\n"
            "    - ```r\n"
            "    source('setup.R')\n"
            "    ```\n\n"
            "## Steps\n"
            "### Open RStudio Cloud website: Use [[RStudio console|ref]]\n"
            "- Paste the code into [[RStudio console]].\n\n"
            "### Wait\n"
            "Done.\n",
            encoding="utf-8",
        )

        references = [
            occ for occ in MODULE.parse_md_file(md_path)
            if occ["keyword"] == "rstudio console" and occ.get("mode") == "reference"
        ]

        self.assertEqual(len(references), 1)
        self.assertEqual(
            references[0]["section_lines_raw"][0],
            "### Open RStudio Cloud website: Use [[RStudio console|ref]]",
        )
        self.assertNotIn("### R Script file { data-search-exclude }", references[0]["section_lines_raw"])
        self.assertNotIn("### Wait", references[0]["section_lines_raw"])

    def test_parse_content_tag_list_item_as_mini_section(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "## Recoding\n\n"
            "4. Find the working code.\n"
            "    1. [[Frequency table]] #code\n\n"
            "        - **Model code**\n"
            "            ```r linenums=\"1\"\n"
            "            frq(gss$variable_here, out = \"v\")\n"
            "            ```\n"
            "        - **Working code**\n"
            "            ```r linenums=\"1\"\n"
            "            frq(gss$marital, out = \"v\")\n"
            "            ```\n\n"
            "            - **Line 1:** We put `marital` here ➜ `variable_here`.\n\n"
            "5. [[Frequency table]] #output\n\n"
            "| val | label |\n"
            "|-----|-------|\n"
            "| 1   | Married |\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_content_tags_file(md_path)
        code_occurrence = next(occ for occ in occurrences if occ["content_tag"] == "#code")

        self.assertEqual(code_occurrence["section_kw_offset"], 0)
        self.assertEqual(code_occurrence["section_lines_raw"][0], "    1. [[Frequency table]] #code")
        self.assertIn("            frq(gss$variable_here, out = \"v\")", code_occurrence["section_lines_raw"])
        self.assertIn("            frq(gss$marital, out = \"v\")", code_occurrence["section_lines_raw"])
        self.assertIn("            - **Line 1:** We put `marital` here ➜ `variable_here`.", code_occurrence["section_lines_raw"])
        self.assertNotIn("5. [[Frequency table]] #output", code_occurrence["section_lines_raw"])
        self.assertNotIn("| 1   | Married |", code_occurrence["section_lines_raw"])

    def test_parse_content_tag_numbered_step_keeps_children_until_next_step(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "## Recoding\n\n"
            "7. [[Frequency table]] #code for the recoded variable (`educgroups`)\n\n"
            "    - **Model code**\n"
            "        ```r linenums=\"1\"\n"
            "        frq(gss$variable_here, out = \"v\")\n"
            "        ```\n"
            "    - **Working code**\n"
            "        ```r linenums=\"1\"\n"
            "        frq(gss$educgroups, out = \"v\")\n"
            "        ```\n\n"
            "        - **Line 1:** We put `educgroups` here ➜ `variable_here`.\n"
            "            - Find the working code in this module's R script file.\n"
            "            - [[Highlighting and running]] this code will generate the output below.\n\n"
            "8. [[Frequency table]] #output\n\n"
            "| val | label |\n"
            "|-----|-------|\n"
            "| 1   | Low level of education |\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_content_tags_file(md_path)
        code_occurrence = next(occ for occ in occurrences if occ["content_tag"] == "#code")

        self.assertEqual(
            code_occurrence["section_lines_raw"][0],
            "7. [[Frequency table]] #code for the recoded variable (`educgroups`)",
        )
        self.assertIn("        frq(gss$variable_here, out = \"v\")", code_occurrence["section_lines_raw"])
        self.assertIn("        frq(gss$educgroups, out = \"v\")", code_occurrence["section_lines_raw"])
        self.assertIn("            - Find the working code in this module's R script file.", code_occurrence["section_lines_raw"])
        self.assertNotIn("8. [[Frequency table]] #output", code_occurrence["section_lines_raw"])
        self.assertNotIn("| 1   | Low level of education |", code_occurrence["section_lines_raw"])

    def test_parse_content_tag_list_item_stops_before_parent_sibling(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "## Recoding\n\n"
            "- [[Frequency table]] #interpretation\n\n"
            "    !!! quote \"Frequency table interpretation template\"\n\n"
            "        The **[variable label]** *variable* shows that ...\n\n"
            "    - We interpret the valid percentage column **(valid.prc)**.\n\n"
            "- Here is the frequency table for recoded variables.\n\n"
            "    ```r\n"
            "    frq(gss$maritalgroups, out = \"v\")\n"
            "    ```\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_content_tags_file(md_path)
        interpretation_occurrence = next(occ for occ in occurrences if occ["content_tag"] == "#interpretation")

        self.assertIn("    !!! quote \"Frequency table interpretation template\"", interpretation_occurrence["section_lines_raw"])
        self.assertIn("    - We interpret the valid percentage column **(valid.prc)**.", interpretation_occurrence["section_lines_raw"])
        self.assertNotIn("- Here is the frequency table for recoded variables.", interpretation_occurrence["section_lines_raw"])
        self.assertNotIn("    frq(gss$maritalgroups, out = \"v\")", interpretation_occurrence["section_lines_raw"])

    def test_parse_md_file_preserves_collapsible_admonitions_in_raw_section_lines(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "## Example\n\n"
            "[[alpha]] introduction.\n\n"
            '??? tip "Code explanation: Click to expand"\n'
            "    - First point.\n"
            "    - Second point.\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_md_file(md_path)

        self.assertEqual(len(occurrences), 1)
        self.assertIn('??? tip "Code explanation: Click to expand"', occurrences[0]["section_lines_raw"])
        self.assertIn("**Code explanation: Click to expand**", occurrences[0]["section_lines"])

    def test_parse_md_file_strips_front_matter_from_pane_context(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "lesson.md"
        md_path.write_text(
            "---\n"
            'title: "Write your first lesson"\n'
            "icon: lucide/pencil\n"
            "tags:\n"
            "  - Workflows\n"
            "---\n"
            "This page shows a [[pane]] without leaking YAML.\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_md_file(md_path)

        self.assertEqual(len(occurrences), 1)
        joined = "\n".join(occurrences[0]["section_lines_raw"])
        self.assertNotIn("title:", joined)
        self.assertNotIn("icon:", joined)
        self.assertNotIn("Workflows", joined)
        self.assertIn("This page shows a [[pane]] without leaking YAML.", joined)

    def test_parse_md_file_ignores_empty_and_inline_code_wikilinks(self) -> None:
        _root, docs_dir = self.make_project()
        md_path = docs_dir / "module.md"
        md_path.write_text(
            "# Module\n\n"
            "Use double brackets, [[ ]], as syntax.\n\n"
            "Real concept [[alpha]].\n",
            encoding="utf-8",
        )

        occurrences = MODULE.parse_md_file(md_path)

        self.assertEqual([occ["keyword"] for occ in occurrences], ["alpha"])

    def test_get_context_uses_the_current_match_not_the_first_one(self) -> None:
        text = "Intro. First [[alpha]] sentence. Second [[beta]] sentence. End."
        matches = list(MODULE.WIKILINK_RE.finditer(text))

        alpha_context = MODULE.get_context(text, matches[0])
        beta_context = MODULE.get_context(text, matches[1])

        self.assertEqual(alpha_context, "First [[alpha]] sentence.")
        self.assertEqual(beta_context, "Second [[beta]] sentence.")

    def test_parse_list_hierarchy_supports_nested_numbered_lists(self) -> None:
        lines = [
            "1. Parent item",
            "    1. Child item",
            "        1. Grandchild item",
        ]

        parent_map = MODULE.parse_list_hierarchy(lines)

        self.assertIsNone(parent_map[0])
        self.assertEqual(parent_map[1], "Parent item")
        self.assertEqual(parent_map[2], "Child item")

    def test_list_hierarchy_continues_through_markerless_blocks(self) -> None:
        lines = [
            "- [[parent]]",
            "",
            "    ![Figure](figure.png)",
            "",
            "    1. [[child one]]",
            "    2. [[child two]]",
            "        ```r",
            "        summary(gss)",
            "        ```",
            "        1. [[grandchild]]",
            "    3. [[child three]]",
        ]

        parent_map = MODULE.parse_list_hierarchy(lines)
        graph = self.build_graph_for_markdown("# Home\n\n" + "\n".join(lines) + "\n")
        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}

        self.assertEqual(parent_map[4], "[[parent]]")
        self.assertEqual(parent_map[5], "[[parent]]")
        self.assertEqual(parent_map[9], "[[child two]]")
        self.assertEqual(parent_map[10], "[[parent]]")
        self.assertEqual(edges[("kw:parent", "kw:child one")], "hierarchy")
        self.assertEqual(edges[("kw:child two", "kw:grandchild")], "hierarchy")

    def test_breadcrumb_text_uses_alias_label(self) -> None:
        lines = ["### [[sampling strategy|sampling strategies]]", "- [[pilot study|pilot studies]]"]

        heading_path = MODULE.build_heading_path_map(lines)
        parent_chain = MODULE.build_parent_chain_map(lines)

        self.assertEqual(heading_path[0], ["sampling strategies"])
        self.assertEqual(parent_chain[1], [])

    def test_heading_path_includes_second_level_headings_and_resets_deeper_ones(self) -> None:
        lines = [
            "### Sample lab assignment",
            "## Learning outcomes",
            "- [[gss]]",
        ]

        heading_path = MODULE.build_heading_path_map(lines)

        self.assertEqual(heading_path[0], ["Sample lab assignment"])
        self.assertEqual(heading_path[1], ["Learning outcomes"])
        self.assertEqual(heading_path[2], ["Learning outcomes"])

    def test_heading_path_strips_readaloud_exclude_attrs(self) -> None:
        lines = [
            "## [[Recoding model codes]]  { data-readaloud-exclude }",
            "- [[Model code]] #code",
        ]

        heading_path = MODULE.build_heading_path_map(lines)

        self.assertEqual(heading_path[1], ["Recoding model codes"])
        self.assertNotIn("readaloud", heading_path[1][0].lower())

    def test_search_render_context_strips_readaloud_exclude_attrs(self) -> None:
        context = MODULE._search_render_context_lines(
            [
                "## [[Recoding model codes]]  { data-readaloud-exclude }",
                "- item",
            ]
        )
        joined = "\n".join(context)
        self.assertIn("[[Recoding model codes]]", joined)
        self.assertNotIn("readaloud", joined.lower())

    def test_heading_path_strips_slide_anchor_markers(self) -> None:
        lines = [
            "## GSS example: Predicting personal income (conrinc)⚓︎",
            "- [[factor variable]]",
        ]

        heading_path = MODULE.build_heading_path_map(lines)

        self.assertEqual(heading_path[1], ["GSS example: Predicting personal income (conrinc)"])
        self.assertNotIn("⚓", heading_path[1][0])

    def test_search_includes_template_admonition_content(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "sample.md").write_text(
            "# Sample\n\n"
            "## Interpretation\n\n"
            "- !!! note \"Interpretation sample\"\n"
            "    - Teaching text with [[factor variable]].\n"
            "- !!! quote \"Frequency table interpretation template\"\n"
            "    - Placeholder [[factor variable]] 1 and [[outcome variable]].\n",
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        section = next(doc for doc in search["docs"] if doc.get("kind") == "section")
        self.assertIn("factor variable", section.get("concept_keys") or [])
        self.assertIn("outcome variable", section.get("concept_keys") or [])
        mentions = [doc for doc in search["docs"] if doc.get("kind") == "mention"]
        factor_mentions = [
            doc for doc in mentions
            if "factor variable" in " ".join(doc.get("concept_keys") or []).lower()
        ]
        self.assertEqual(len(factor_mentions), 2)
        self.assertIn("Teaching text", "\n".join(factor_mentions[0].get("section_lines_raw") or []))
        self.assertIn(
            "interpretation template",
            "\n".join(section.get("render_context") or []).lower(),
        )
        self.assertIn("Placeholder", "\n".join(section.get("section_lines_raw") or []))
        template_mention = next(
            doc for doc in factor_mentions
            if "placeholder" in "\n".join(doc.get("section_lines_raw") or []).lower()
        )
        self.assertIn("Placeholder", "\n".join(template_mention.get("section_lines_raw") or []))

    def test_search_mention_docs_use_source_content_line(self) -> None:
        _root, docs_dir = self.make_project()
        (docs_dir / "sample.md").write_text(
            "# Sample\n\n"
            "## Early\n\n"
            "[[alpha]] appears first.\n\n"
            "## Late\n\n"
            "[[beta]] appears second.\n\n"
            "## Earlier concept\n\n"
            "[[gamma]] appears third.\n",
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        mentions = {
            doc.get("title"): int(doc.get("content_line") or -1)
            for doc in search["docs"]
            if doc.get("kind") == "mention"
        }
        self.assertLess(mentions["alpha"], mentions["beta"])
        self.assertLess(mentions["beta"], mentions["gamma"])

    def test_same_sentence_keywords_are_siblings(self) -> None:
        graph = self.build_graph_for_markdown("# Home\n\n[[alpha]] and [[beta]] appear together.\n")

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:alpha", "kw:beta")], "sibling")
        self.assertNotIn(("kw:alpha", "kw:beta"), {k for k, v in edges.items() if v == "hierarchy"})

    def test_hierarchy_on_one_page_does_not_suppress_sibling_on_another_page(self) -> None:
        _root, docs_dir = self.make_project()
        graphs_path = docs_dir / "graphs.md"
        outlining_path = docs_dir / "outlining.md"
        graphs_path.write_text(
            "# Graphs\n\n## [[concept graph]]\n\n### [[pane]]\n",
            encoding="utf-8",
        )
        outlining_path.write_text(
            "# Outlining\n\n"
            "- Knotis reads structure to build the [[pane]], the [[concept graph]], and the [[glossary]].\n",
            encoding="utf-8",
        )
        occurrences = MODULE.parse_md_file(graphs_path) + MODULE.parse_md_file(outlining_path)
        config = MODULE._normalize_knotis_config(MODULE._load_toml_knotis_config())
        MODULE._finalize_content_tag_colors(config, {}, [])
        graph = MODULE.build_graph(
            occurrences,
            [graphs_path, outlining_path],
            nav_items=[],
            graph_view_config=config,
        )

        edges = {
            (edge["source"], edge["target"], edge["relation"]): edge
            for edge in graph["edges"]
        }
        self.assertIn(("kw:concept graph", "kw:pane", "hierarchy"), edges)
        sibling = edges[("kw:pane", "kw:concept graph", "sibling")]
        self.assertEqual(sibling["pages"], ["outlining/"])
        self.assertIn("outlining/", edges[("kw:concept graph", "kw:glossary", "sibling")]["pages"])
        self.assertIn("outlining/", edges[("kw:glossary", "kw:pane", "sibling")]["pages"])

    def test_heading_depth_creates_hierarchy_edge(self) -> None:
        graph = self.build_graph_for_markdown("# Home\n\n## [[parent]]\n\n### [[child]]\n")

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:parent", "kw:child")], "hierarchy")

    def test_nested_heading_uses_parent_section_keyword_when_heading_has_no_wikilink(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## Keyboard shortcuts\n"
            "The most frequently used [[keyboard shortcuts]] are copy-paste-undo.\n\n"
            "### Hand and finger positions\n"
            "The ideal [[hand and finger positions]] are shown below.\n\n"
            "### Mouse shortcuts\n"
            "We use the following [[mouse shortcuts]].\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:keyboard shortcuts", "kw:hand and finger positions")], "hierarchy")
        self.assertEqual(edges[("kw:keyboard shortcuts", "kw:mouse shortcuts")], "hierarchy")

    def test_indented_bullet_creates_hierarchy_edge(self) -> None:
        graph = self.build_graph_for_markdown("# Home\n\n- [[parent]]\n  - [[child]]\n")

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:parent", "kw:child")], "hierarchy")

    def test_blank_line_inside_nested_list_keeps_sibling_parent(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "- [[significance of correlation]]\n"
            "    - Using the p-value, we determine if the correlation is:\n"
            "        - [[nonsignificant correlation]]\n"
            "            ![No trend](image.png)\n"
            "\n"
            "        - [[significant correlation]]\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(
            edges[("kw:significance of correlation", "kw:significant correlation")],
            "hierarchy",
        )

    def test_plain_paragraph_under_heading_stays_sibling(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n### Frequency table\n\n[[frequency table]] is used for [[categorical]] data.\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:categorical", "kw:frequency table")], "sibling")
        self.assertNotIn(("kw:frequency table", "kw:categorical"), {k for k, v in edges.items() if v == "hierarchy"})

    def test_paragraph_keyword_can_parent_top_level_bullet_keyword(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n## Using R script files\n\nWe follow [[using r script files]].\n\n- [[r script file]] is text.\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:using r script files", "kw:r script file")], "hierarchy")

    def test_list_hierarchy_does_not_cross_heading_boundary(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n- For [[categorical]], use:\n  - [[frequency table]]\n\n### Frequency table\n\n- [[frequency table]] is used for [[categorical]].\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:categorical", "kw:frequency table")], "hierarchy")
        self.assertNotIn(("kw:frequency table", "kw:categorical"), {k for k, v in edges.items() if v == "hierarchy"})

    def test_reused_keyword_across_multiple_nested_sections_keeps_hierarchy_edge(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## Parent\n"
            "[[parent]] intro.\n\n"
            "### Child\n"
            "[[child]] detail.\n\n"
            "### Another section\n"
            "See [[child]] again here.\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:parent", "kw:child")], "hierarchy")
        self.assertNotIn(("kw:child", "kw:parent"), edges)

    def test_first_hierarchy_parent_wins_when_keyword_reappears_later(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## [[bivariate correlation]]\n"
            "- [[bivariate correlation]] analysis shows the relationship between two continuous variables:\n"
            "    - [[correlation table]] shows this relationship in a table format.\n"
            "    - [[scatterplot]] shows this relationship in a graph format.\n\n"
            "### [[correlation table]]\n"
            "1. Now let's create the [[scatterplot]].\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:bivariate correlation", "kw:scatterplot")], "hierarchy")
        self.assertEqual(edges[("kw:correlation table", "kw:scatterplot")], "sibling")

    def test_hierarchy_keywords_do_not_keep_direct_page_edges(self) -> None:
        graph = self.build_graph_for_page(
            "module.md",
            "# Module\n\n"
            "## Regression definition\n\n"
            "- [[Regression]] explains models.\n"
            "  - [[factor variable]] affects the [[outcome variable]].\n\n"
            "## Types\n\n"
            "- There are [[types of regression modeling based on outcome variable]].\n"
            "  - [[Linear regression]] uses a [[continuous]] outcome.\n",
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:regression", "kw:factor variable")], "hierarchy")
        self.assertEqual(edges[("page:module/", "kw:regression")], "page")
        self.assertEqual(edges[("page:module/", "kw:types of regression modeling based on outcome variable")], "page")
        self.assertNotIn(("page:module/", "kw:factor variable"), edges)
        self.assertNotIn(("page:module/", "kw:outcome variable"), edges)
        self.assertNotIn(("page:module/", "kw:linear regression"), edges)

    def test_hierarchy_edges_record_page_specific_sources(self) -> None:
        graph = self.build_graph_for_markdown(
            "# [[linear regression]]\n\n"
            "## Regression definition\n"
            "- [[Regression]] explains models.\n\n"
            "## Types\n"
            "- There are two [[types of regression modeling based on outcome variable]]:\n"
            "  - [[Linear regression]]\n"
            "    - [[continuous]] outcome.\n"
        )

        edges = {(edge["source"], edge["target"]): edge for edge in graph["edges"]}
        self.assertEqual(
            edges[("kw:linear regression", "kw:regression")]["hierarchy_sources"]["./"],
            {"heading_inferred": 1},
        )
        self.assertEqual(
            edges[("kw:linear regression", "kw:types of regression modeling based on outcome variable")]["hierarchy_sources"]["./"],
            {"section_heading": 1},
        )
        self.assertNotIn(
            ("kw:types of regression modeling based on outcome variable", "kw:linear regression"),
            edges,
        )
        page_graph_edges = {
            (edge["source"], edge["target"], edge["source_kind"])
            for edge in graph["page_hierarchy_edges"]
        }
        self.assertIn(
            ("kw:linear regression", "kw:continuous", "list"),
            page_graph_edges,
        )

    def test_page_title_plain_text_does_not_infer_graph_ancestor(self) -> None:
        graph = self.build_graph_for_page(
            "module.md",
            "# 01. Introduction to RStudio\n\n"
            "## [[Software]]\n"
            "### What is [[RStudio]]?\n"
            "- RStudio is an IDE.\n\n"
            "## Data: General Social Survey (GSS)\n"
            "- We'll use [[GSS]] for the modules.\n",
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        page_graph_edges = {
            (edge["source"], edge["target"], edge.get("source_kind"))
            for edge in graph["page_hierarchy_edges"]
        }
        page_graph_page_edges = {
            (edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }

        self.assertNotIn(("kw:rstudio", "kw:gss"), edges)
        self.assertNotIn(("kw:rstudio", "kw:gss", "heading_inferred"), page_graph_edges)
        self.assertIn(("page:module/", "kw:gss"), page_graph_page_edges)
        self.assertEqual(edges[("kw:software", "kw:rstudio")], "hierarchy")

        graph = self.build_graph_for_markdown("# Home\n\n- [[parent]]\n  - [[child|ref]]\n")

        node_ids = {node["id"] for node in graph["nodes"]}
        edges = {(edge["source"], edge["target"]): edge for edge in graph["edges"]}
        page_hierarchy = {
            (edge["source"], edge["target"])
            for edge in graph["page_hierarchy_edges"]
        }
        self.assertIn("kw:parent", node_ids)
        self.assertIn("kw:child", node_ids)
        self.assertIn(("kw:parent", "kw:child"), edges)
        self.assertIn(("kw:parent", "kw:child"), page_hierarchy)

    def test_nested_reference_uses_top_list_ancestor_as_graph_parent(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "- In [[regression]]\n"
            "  - There are three [[types of regression modeling based on outcome variable]]:\n"
            "    - [[Explanatory modeling|ref]]\n"
            "    - [[Predictive modeling|ref]]\n"
        )

        edges = {(edge["source"], edge["target"]): edge for edge in graph["edges"]}
        self.assertEqual(
            edges[("kw:regression", "kw:types of regression modeling based on outcome variable")]["hierarchy_sources"]["./"],
            {"list": 1},
        )
        node_ids = {node["id"] for node in graph["nodes"]}
        self.assertIn("kw:explanatory modeling", node_ids)
        self.assertIn("kw:predictive modeling", node_ids)
        self.assertIn(("kw:regression", "kw:explanatory modeling"), edges)
        self.assertIn(("kw:regression", "kw:predictive modeling"), edges)

    def test_reference_definition_page_graph_ignores_inline_alias_hierarchy(self) -> None:
        graph = self.build_graph_for_page(
            "assignment-submission.md",
            "# Assignment submission\n"
            "## [[How to submit an assignment|ref]]\n"
            "1. Rename the file.\n"
            "    - If there is a mistake, [[How to rename a file in Google Drive|rename the file]].\n"
            "6. Move it [[How to move a file in Google Drive|How to make sure about the correct subfolder and move the file]].\n"
            "## [[How to move a file in Google Drive|ref]]\n"
            "- Check the folder before submitting.\n"
            "## [[How to rename a file in Google Drive|ref]]\n"
            "- Open the file and edit the name.\n"
            "## [[How to rename a folder in Google Drive|ref]]\n"
            "- Click Rename and type the correct name.\n",
        )

        page_url = "assignment-submission/"
        page_graph_page_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_graph_page_edges"]
        }
        page_graph_hierarchy_edges = {
            (edge["page"], edge["source"], edge["target"])
            for edge in graph["page_hierarchy_edges"]
        }
        page_node_id = f"page:{page_url}"

        for kw in (
            "how to move a file in google drive",
            "how to rename a file in google drive",
            "how to rename a folder in google drive",
        ):
            kw_node_id = f"kw:{kw}"
            self.assertIn(
                (page_url, page_node_id, kw_node_id),
                page_graph_page_edges,
                msg=f"{kw} should connect directly to the page node",
            )
            self.assertNotIn(
                (page_url, "kw:how to submit an assignment", kw_node_id),
                page_graph_hierarchy_edges,
                msg=f"{kw} should not nest under how to submit an assignment",
            )

    def test_reference_page_graph_emits_hierarchy_per_ref_occurrence(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## [[Steps of using RStudio]]\n"
            "### Open RStudio Cloud website: Use [[RStudio console|ref]]\n"
            "- Paste the code into [[RStudio console]].\n\n"
            "## [[RStudio interface]]\n"
            "### Main look\n"
            "- Overview image\n"
            "    3. **[[RStudio console|ref]]:** Console pane\n"
            "    4. **Files/plots/packages/help:** Lower-right pane\n"
            "### More detailed look\n"
            "- Detail image\n"
            "    9. **[[Files tab|ref]]:** Files tab\n"
            "    10. **[[Plots tab|ref]]:** Plots tab\n"
            "    12. **[[Viewer tab|ref]]:** Viewer tab\n"
        )

        page_hierarchy = {
            (edge["source"], edge["target"])
            for edge in graph["page_hierarchy_edges"]
        }
        self.assertIn(("kw:steps of using rstudio", "kw:rstudio console"), page_hierarchy)
        self.assertIn(("kw:rstudio interface", "kw:rstudio console"), page_hierarchy)
        self.assertIn(("kw:rstudio interface", "kw:files tab"), page_hierarchy)
        self.assertIn(("kw:rstudio interface", "kw:plots tab"), page_hierarchy)
        self.assertIn(("kw:rstudio interface", "kw:viewer tab"), page_hierarchy)
        self.assertNotIn(("kw:rstudio console", "kw:files tab"), page_hierarchy)
        self.assertNotIn(("kw:rstudio console", "kw:plots tab"), page_hierarchy)
        self.assertNotIn(("kw:rstudio console", "kw:viewer tab"), page_hierarchy)

    def test_page_graph_keeps_later_local_list_links_for_repeated_keywords(self) -> None:
        graph = self.build_graph_for_markdown(
            "# [[Keyboard shortcuts]]\n\n"
            "## [[Using R script files]]\n"
            "- Use [[outline view]].\n"
            "- Paste under [[working space]].\n"
            "- [[Highlighting and running]] executes the code.\n\n"
            "- [[Find this working code in the R script file]]\n"
            "  - All the working code are above the [[working space]].\n"
            "  - Use [[outline view]].\n"
            "  - [[Highlighting and running]] the working code will generate the exact output shown on the module page.\n",
        )

        page_graph_edges = {
            (edge["source"], edge["target"], edge["source_kind"])
            for edge in graph["page_hierarchy_edges"]
        }
        self.assertIn(
            ("kw:find this working code in the r script file", "kw:working space", "list"),
            page_graph_edges,
        )
        self.assertIn(
            ("kw:find this working code in the r script file", "kw:outline view", "list"),
            page_graph_edges,
        )

    def test_explicit_heading_keyword_parents_list_children_through_plain_bridge(self) -> None:
        graph = self.build_graph_for_markdown(
            "# [[linear regression]] basics\n\n"
            "## [[types of regression modeling based on outcome variable]]\n"
            "- There are two types:\n"
            "  - [[linear regression]]\n"
            "    - The [[outcome variable]] is\n"
            "      - [[continuous]]\n"
            "  - [[logistic regression]]\n"
        )

        edges = {(edge["source"], edge["target"]): edge for edge in graph["edges"]}
        page_graph_edges = {
            (edge["source"], edge["target"])
            for edge in graph["page_hierarchy_edges"]
        }
        self.assertIn(("kw:linear regression", "kw:types of regression modeling based on outcome variable"), edges)
        self.assertEqual(
            edges[("kw:linear regression", "kw:types of regression modeling based on outcome variable")]["relation"],
            "hierarchy",
        )
        self.assertIn(("kw:linear regression", "kw:types of regression modeling based on outcome variable"), page_graph_edges)
        self.assertNotIn(("kw:types of regression modeling based on outcome variable", "kw:linear regression"), page_graph_edges)
        self.assertIn(("kw:types of regression modeling based on outcome variable", "kw:logistic regression"), page_graph_edges)
        self.assertIn(("kw:linear regression", "kw:outcome variable"), page_graph_edges)
        self.assertIn(("kw:outcome variable", "kw:continuous"), page_graph_edges)

    def test_repeated_keyword_can_become_local_context_sibling_without_losing_first_parent(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "- [[correlation]]\n"
            "  - [[p-value]]\n"
            "  - [[r-value]]\n\n"
            "### Significance\n"
            "- [[significance of correlation]]\n"
            "  - Review [[p-value]].\n\n"
            "### [[direction of correlation]]\n"
            "#### [[r-value]]\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:correlation", "kw:p-value")], "hierarchy")
        self.assertEqual(edges[("kw:correlation", "kw:r-value")], "hierarchy")
        self.assertEqual(edges[("kw:significance of correlation", "kw:p-value")], "sibling")
        self.assertEqual(edges[("kw:direction of correlation", "kw:r-value")], "sibling")

    def test_paragraph_fallback_parent_does_not_create_local_context_sibling(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "- [[correlation]]\n"
            "  - [[p-value]]\n\n"
            "## Later\n"
            "[[significance of correlation]] explains the threshold.\n"
            "- Review [[p-value]].\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:correlation", "kw:p-value")], "hierarchy")
        self.assertNotIn(("kw:significance of correlation", "kw:p-value"), edges)

    def test_section_heading_fallback_does_not_create_local_context_sibling(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## [[correlation]]\n"
            "- [[correlation]]\n"
            "  - [[p-value]]\n\n"
            "### [[significance of correlation]]\n"
            "- Review [[p-value]].\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:correlation", "kw:p-value")], "hierarchy")
        self.assertNotIn(("kw:significance of correlation", "kw:p-value"), edges)

    def test_repeated_bridge_keyword_does_not_own_nested_children(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "- [[correlation]]\n"
            "  - [[r-value]]\n\n"
            "- [[strength of correlation]]\n"
            "  - Using [[r-value]], we determine the strength of correlation.\n"
            "    - [[weak correlation]]\n"
            "    - [[moderate correlation]]\n"
            "    - [[strong correlation]]\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:correlation", "kw:r-value")], "hierarchy")
        self.assertEqual(edges[("kw:strength of correlation", "kw:r-value")], "sibling")
        self.assertEqual(edges[("kw:strength of correlation", "kw:weak correlation")], "hierarchy")
        self.assertEqual(edges[("kw:strength of correlation", "kw:moderate correlation")], "hierarchy")
        self.assertEqual(edges[("kw:strength of correlation", "kw:strong correlation")], "hierarchy")
        self.assertNotIn(("kw:r-value", "kw:weak correlation"), edges)
        self.assertNotIn(("kw:r-value", "kw:moderate correlation"), edges)
        self.assertNotIn(("kw:r-value", "kw:strong correlation"), edges)

    def test_top_level_numbered_step_in_nested_heading_inherits_section_keyword(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## Reasons for recoding\n"
            "- [[reasons for recoding]] include several approaches.\n\n"
            "### Merging values\n"
            "- [[Merging values]] changes grouped categories.\n\n"
            "#### Merging values - coding steps\n"
            "1. Start from [[merging values]].\n"
            "2. Review the [[frequency table]].\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:merging values", "kw:frequency table")], "hierarchy")

    def test_nested_plain_bridge_bullet_inherits_single_keyword_heading(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## [[linear regression assumptions]]\n\n"
            "### Assumption 2: Normal distribution\n"
            "- The continuous variables used should display approximately [[normal distribution]].\n"
            "- For example, some variables should not be treated as continuous:\n"
            "    - **Several solutions exist for [[nonnormal distribution]] issue:**\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:linear regression assumptions", "kw:normal distribution")], "hierarchy")
        self.assertEqual(edges[("kw:normal distribution", "kw:nonnormal distribution")], "hierarchy")

    def test_nested_heading_step_does_not_inherit_from_multi_keyword_intro(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## Summary statistics\n\n"
            "### Frequency table\n"
            "[[frequency table]] is used for [[categorical]] variables.\n\n"
            "1. See the [[bar graph]].\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertNotIn(
            ("kw:frequency table", "kw:bar graph"),
            {k for k, v in edges.items() if v == "hierarchy"},
        )

    def test_plain_heading_keyword_parents_same_level_bullet_siblings(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## Statistical significance and p-value\n"
            "- [[Statistical significance]] is meaningful.\n"
            "  - We determine this using [[p-value]].\n\n"
            "### How to make sure p-value is significant?\n"
            "- **[[Is my p-value less than 0.05?]]**\n"
            "- **[[Check asterisks]]**\n"
        )

        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}
        self.assertEqual(edges[("kw:statistical significance", "kw:p-value")], "hierarchy")
        self.assertEqual(edges[("kw:p-value", "kw:is my p-value less than 0.05?")], "hierarchy")
        self.assertEqual(edges[("kw:p-value", "kw:check asterisks")], "hierarchy")
        self.assertEqual(edges[("kw:check asterisks", "kw:is my p-value less than 0.05?")], "sibling")
        self.assertNotIn(("kw:is my p-value less than 0.05?", "kw:check asterisks"), edges)

        page_hierarchy = {
            (edge["source"], edge["target"]) for edge in graph["page_hierarchy_edges"]
        }
        self.assertEqual(page_hierarchy, {
            ("kw:statistical significance", "kw:p-value"),
            ("kw:p-value", "kw:is my p-value less than 0.05?"),
            ("kw:p-value", "kw:check asterisks"),
        })

    def test_comparison_heading_sibling_bullets_inherit_parent_section(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## [[Migration]]\n"
            "- Migration is defined as movement.\n\n"
            "### Permanent vs. temporary migration\n"
            "- [[Permanent migration]] refers to leaving forever.\n"
            "- [[Temporary migration]] refers to being away for a time.\n\n"
            "### Voluntary vs. involuntary migration\n"
            "- [[Voluntary migration]] involves free choice.\n"
            "- [[Involuntary migration]] involves no choice.\n"
        )

        page_hierarchy = {
            (edge["source"], edge["target"]) for edge in graph["page_hierarchy_edges"]
        }
        edges = {(edge["source"], edge["target"]): edge["relation"] for edge in graph["edges"]}

        self.assertIn(("kw:migration", "kw:permanent migration"), page_hierarchy)
        self.assertIn(("kw:migration", "kw:temporary migration"), page_hierarchy)
        self.assertIn(("kw:migration", "kw:voluntary migration"), page_hierarchy)
        self.assertIn(("kw:migration", "kw:involuntary migration"), page_hierarchy)
        self.assertNotIn(("kw:temporary migration", "kw:permanent migration"), page_hierarchy)
        self.assertNotIn(("kw:permanent migration", "kw:temporary migration"), page_hierarchy)
        self.assertNotIn(("kw:involuntary migration", "kw:voluntary migration"), page_hierarchy)
        self.assertNotIn(("kw:voluntary migration", "kw:involuntary migration"), page_hierarchy)
        self.assertEqual(edges[("kw:permanent migration", "kw:temporary migration")], "sibling")
        self.assertEqual(edges[("kw:involuntary migration", "kw:voluntary migration")], "sibling")

    def test_page_hierarchy_ignores_inline_reference_parents_in_method_bullets(self) -> None:
        graph = self.build_graph_for_markdown(
            "# Home\n\n"
            "## Statistical significance and p-value\n"
            "- [[Statistical significance]]:\n"
            "  - We determine this using [[p-value]]:\n\n"
            "### How to make sure p-value is significant?\n"
            "- **[[Is my p-value less than 0.05?]]**\n"
            "    - To determine [[statistical significance]]\n"
            "- **[[Check asterisks]]**\n"
            "    - To determine [[statistical significance]]\n"
        )

        page_hierarchy = {
            (edge["source"], edge["target"]) for edge in graph["page_hierarchy_edges"]
        }
        self.assertIn(("kw:statistical significance", "kw:p-value"), page_hierarchy)
        self.assertIn(("kw:p-value", "kw:check asterisks"), page_hierarchy)
        self.assertIn(("kw:p-value", "kw:is my p-value less than 0.05?"), page_hierarchy)
        self.assertNotIn(("kw:check asterisks", "kw:statistical significance"), page_hierarchy)
        self.assertNotIn(("kw:is my p-value less than 0.05?", "kw:statistical significance"), page_hierarchy)

    def test_nested_knotis_config_parser_supports_maps_lists_bools_ints_and_defaults(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.site_graph.graph]
exclude_paths = ["other-resources/documentation.md"]
exclude_wikilinks = ["keyword"]

[project.extra.knotis.page_graph.graph]
exclude_wikilinks = ["keyword"]

[project.extra.knotis.glossary]
default_view = "module"

[project.extra.knotis.content_tags]
order = ["output", "#code"]

[project.extra.knotis.content_tags.colors.default]
"#code" = "b45309"
output = "#067647"

[project.extra.knotis.content_tags.colors.slate]
code = "#ffbf7d"

[project.extra.knotis.defaults.nodes]
show_categories = false
min_keyword_occurrence_count = 3
size_metric = "occurrence_count"

[project.extra.knotis.defaults.relations]
include = ["sibling", "page"]

[project.extra.knotis.defaults.hover]
mode = "n_hop_neighbors"
hops = 2
dim_non_hovered_percent = 45

[project.extra.knotis.pane]
order = ["lab-resources/templates.md", "other-resources/documentation.md"]
width = 720
initial_lines = 5
initial_list_items = 4
chunk_lines = 2

[project.extra.knotis.defaults.colors]
wikilink_text = "#123456"
content_tag_text = "#abcdef"

[project.extra.knotis.defaults.ui]
enable_search = "auto"

[project.extra.knotis.page_graph.ui]
show_labels = false

[project.extra.knotis.site_graph.ui]
label_mode = "all"
keyword_label_zoom_threshold = 1.35
page_edge_opacity = 1.0
hierarchy_edge_opacity = 1.0
nav_edge_opacity = 1.0
"""
        self.make_project(toml_text=toml_text)

        raw = MODULE._load_toml_knotis_config()
        self.assertEqual(raw["site_graph"]["graph"]["exclude_paths"], ["other-resources/documentation.md"])
        self.assertEqual(raw["site_graph"]["graph"]["exclude_wikilinks"], ["keyword"])
        self.assertEqual(raw["page_graph"]["graph"]["exclude_wikilinks"], ["keyword"])
        self.assertEqual(raw["glossary"]["default_view"], "module")
        self.assertEqual(raw["content_tags"]["order"], ["output", "#code"])
        self.assertEqual(raw["content_tags"]["colors"]["default"]["#code"], "b45309")
        self.assertFalse(raw["defaults"]["nodes"]["show_categories"])
        self.assertEqual(raw["defaults"]["nodes"]["min_keyword_occurrence_count"], 3)
        self.assertEqual(raw["defaults"]["nodes"]["size_metric"], "occurrence_count")
        self.assertEqual(raw["defaults"]["relations"]["include"], ["sibling", "page"])
        self.assertEqual(raw["defaults"]["hover"]["mode"], "n_hop_neighbors")
        self.assertEqual(raw["defaults"]["hover"]["hops"], 2)
        self.assertEqual(raw["defaults"]["hover"]["dim_non_hovered_percent"], 45)
        self.assertEqual(raw["pane"]["order"], ["lab-resources/templates.md", "other-resources/documentation.md"])
        self.assertEqual(raw["pane"]["width"], 720)
        self.assertEqual(raw["pane"]["initial_lines"], 5)
        self.assertEqual(raw["pane"]["initial_list_items"], 4)
        self.assertEqual(raw["pane"]["chunk_lines"], 2)
        self.assertEqual(raw["defaults"]["colors"]["wikilink_text"], "#123456")
        self.assertEqual(raw["defaults"]["colors"]["content_tag_text"], "#abcdef")
        self.assertEqual(raw["defaults"]["ui"]["enable_search"], "auto")
        self.assertFalse(raw["page_graph"]["ui"]["show_labels"])
        self.assertEqual(raw["site_graph"]["ui"]["label_mode"], "all")
        self.assertEqual(raw["site_graph"]["ui"]["keyword_label_zoom_threshold"], 1.35)
        self.assertEqual(raw["site_graph"]["ui"]["page_edge_opacity"], 1.0)

        normalized = MODULE._normalize_knotis_config(raw)
        self.assertEqual(normalized["glossary"]["default_view"], "by_page")
        self.assertIsNone(normalized["defaults"]["relations"]["top_edges_per_node"])
        self.assertNotIn("colors", normalized["defaults"])
        self.assertEqual(normalized["content_tags"]["order"], ["#output", "#code"])
        self.assertEqual(normalized["content_tags"]["colors"]["default"]["code"], "#b45309")
        self.assertEqual(normalized["content_tags"]["colors"]["default"]["output"], "#067647")
        self.assertEqual(normalized["content_tags"]["colors"]["slate"]["code"], "#ffbf7d")
        self.assertNotIn("content_tag_color_order", normalized["defaults"])
        self.assertNotIn("content_tag_color_overrides", normalized["defaults"])
        self.assertEqual(normalized["defaults"]["pane"]["order"], ["lab-resources/templates.md", "other-resources/documentation.md"])
        self.assertEqual(normalized["defaults"]["pane"]["width"], 720)
        self.assertTrue(normalized["defaults"]["pane"]["reference_full_section"])
        self.assertTrue(normalized["defaults"]["pane"]["show_history_controls"])
        self.assertTrue(normalized["defaults"]["pane"]["show_meta_badges"])
        self.assertTrue(normalized["defaults"]["pane"]["show_context_controls"])
        self.assertTrue(normalized["defaults"]["pane"]["show_concept_graph_preview"])
        self.assertTrue(normalized["defaults"]["pane"]["show_graph_return_button"])
        self.assertTrue(normalized["defaults"]["pane"]["skip_duplicate_headings"])
        self.assertEqual(normalized["defaults"]["pane"]["keyword_context_mode"], "parent_list")
        self.assertTrue(normalized["defaults"]["pane"]["keyword_own_section"])
        self.assertEqual(normalized["defaults"]["pane"]["edge_context_mode"], "compact")
        self.assertEqual(normalized["defaults"]["pane"]["edge_gap_mode"], "hide")
        self.assertEqual(normalized["site_graph"]["ui"]["label_mode"], "all")
        self.assertEqual(normalized["site_graph"]["ui"]["hierarchy_edge_opacity"], 1.0)
        self.assertEqual(normalized["site_graph"]["ui"]["nav_edge_opacity"], 1.0)

    def test_generate_glossary_respects_toml_default_view(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
  { "First Module" = "modules/first.md" },
]

[project.extra.knotis.glossary]
default_view = "module"
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text("# Home\n\n[[alpha]]\n", encoding="utf-8")
        modules_dir = docs_dir / "modules"
        modules_dir.mkdir(parents=True, exist_ok=True)
        (modules_dir / "first.md").write_text("# First Module\n\n[[beta]]\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        glossary = (docs_dir / "glossary.md").read_text(encoding="utf-8")
        self.assertIn('title: "Glossary"', glossary)
        self.assertNotIn("\n# Glossary\n", glossary)
        self.assertIn("knotis_content:\n  heading_numbering: false\n  heading_guides: false", glossary)
        self.assertTrue(
            glossary.startswith(
                '---\ntitle: "Glossary"\nknotis_content:\n  heading_numbering: false\n  heading_guides: false\n'
                "icon: lucide/arrow-down-a-z\ntags:\n  -\n"
                "knotis_generated: glossary-page\n---\n\n"
            )
        )
        self.assertIn("tags:\n  -", glossary)
        self.assertIn("knotis_generated: glossary-page", glossary)
        self.assertNotIn("template:", glossary)
        self.assertIn(
            'class="knotis-toggle-button glossary-view__button glossary-view__button--active" '
            'id="glossary-btn-module" data-glossary-view="by_page" aria-pressed="true"',
            glossary,
        )
        self.assertIn(
            'class="knotis-toggle-button glossary-view__button" id="glossary-btn-alpha" '
            'data-glossary-view="alphabetical" aria-pressed="false"',
            glossary,
        )
        self.assertIn(
            'class="knotis-toggle-button glossary-view__button" id="glossary-btn-importance" '
            'data-glossary-view="importance" aria-pressed="false"',
            glossary,
        )
        self.assertEqual(glossary.count('class="glossary-view__icon"'), 3)
        self.assertNotIn(":material-view-list:", glossary)
        self.assertNotIn(":material-sort-", glossary)
        self.assertLess(glossary.index('id="glossary-btn-module"'), glossary.index('id="glossary-btn-alpha"'))
        self.assertLess(glossary.index('id="glossary-btn-alpha"'), glossary.index('id="glossary-btn-importance"'))
        self.assertIn('id="glossary-alpha" data-default-view="by_page" style="display:none" markdown', glossary)
        self.assertIn('id="glossary-importance" data-default-view="by_page" style="display:none" markdown', glossary)
        self.assertIn('id="glossary-module" data-default-view="by_page" markdown', glossary)
        self.assertNotIn("glossary-btn-show-all", glossary)
        self.assertIn("[First Module](modules/first/)", glossary)
        self.assertNotIn("[First Module](/modules/first/)", glossary)

    def test_generate_glossary_preserves_manual_front_matter_and_adds_marker(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
]
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        glossary_path = docs_dir / "glossary.md"
        glossary_path.write_text(
            "---\nicon: lucide/arrow-down-a-z\ntags:\n  - Resources\n---\n\n# Glossary\n",
            encoding="utf-8",
        )
        (docs_dir / "index.md").write_text("# Home\n\n[[alpha]]\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        glossary = glossary_path.read_text(encoding="utf-8")
        self.assertIn('title: "Glossary"', glossary)
        self.assertLess(glossary.index('title: "Glossary"'), glossary.index("knotis_content:"))
        self.assertLess(glossary.index("knotis_content:"), glossary.index("icon: lucide/arrow-down-a-z"))
        self.assertLess(glossary.index("icon: lucide/arrow-down-a-z"), glossary.index("tags:\n  - Resources"))
        self.assertIn("tags:\n  - Resources\nknotis_generated: glossary-page", glossary)
        self.assertIn("knotis_content:\n  heading_numbering: false\n  heading_guides: false", glossary)
        self.assertNotIn("template:", glossary)
        self.assertIn("icon: lucide/arrow-down-a-z", glossary)
        self.assertIn("tags:\n  - Resources", glossary)
        self.assertIn("knotis_generated: glossary-page", glossary)
        self.assertNotIn("\n# Glossary\n", glossary)
        self.assertIn("All concepts tracked across the site.", glossary)
        self.assertIn('data-keyword="alpha"', glossary)

    def test_generate_glossary_renders_recurring_and_importance_views(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { "First Module" = "modules/first.md" },
  { "Second Module" = "modules/second.md" },
]

[project.extra.knotis.glossary]
default_view = "module"
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        modules_dir = docs_dir / "modules"
        modules_dir.mkdir(parents=True, exist_ok=True)
        (modules_dir / "first.md").write_text(
            "# First Module\n\n[[beta]] [[beta]] [[beta]] [[alpha]]\n",
            encoding="utf-8",
        )
        (modules_dir / "second.md").write_text(
            "# Second Module\n\n[[alpha]] [[gamma]] [[gamma]]\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        glossary = (docs_dir / "glossary.md").read_text(encoding="utf-8")
        self.assertIn(
            '## Second Module\n\n> 1 new<span class="glossary-module-count--recurring"> + 1 recurring</span>',
            glossary,
        )
        self.assertNotIn("glossary-module-pill", glossary)
        self.assertNotIn("glossary-btn-show-all", glossary)
        self.assertIn('class="glossary-tag glossary-tag--recurring"', glossary)
        self.assertIn("## Most mentioned concepts", glossary)
        self.assertIn("*3 mentions · 1 page*", glossary)
        self.assertIn("*2 mentions · 2 pages*", glossary)
        self.assertIn(
            "[First Module](modules/first/) · [Second Module](modules/second/)",
            glossary,
        )

        importance = glossary[glossary.index('<div id="glossary-importance"') :]
        self.assertLess(importance.index('data-keyword="beta"'), importance.index('data-keyword="alpha"'))
        self.assertLess(importance.index('data-keyword="alpha"'), importance.index('data-keyword="gamma"'))

    def test_generate_glossary_respects_page_view_label_and_exclude_pages(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { "First Module" = "modules/first.md" },
  { "How to use" = "resources/how-to-use.md" },
]

[project.extra.knotis.glossary]
default_view = "by_page"
page_view_label = "Technics"
exclude_paths = ["resources/how-to-use.md"]
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        modules_dir = docs_dir / "modules"
        modules_dir.mkdir(parents=True, exist_ok=True)
        (modules_dir / "first.md").write_text("# First Module\n\n[[alpha]]\n", encoding="utf-8")
        resources_dir = docs_dir / "resources"
        resources_dir.mkdir(parents=True, exist_ok=True)
        (resources_dir / "how-to-use.md").write_text("# How to use\n\n[[search]]\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        glossary = (docs_dir / "glossary.md").read_text(encoding="utf-8")
        self.assertIn('>Technics<svg class="glossary-view__icon"', glossary)
        self.assertNotIn("How to use", glossary)
        self.assertNotIn('data-keyword="search"', glossary)
        self.assertIn('data-keyword="alpha"', glossary)

    def test_generate_glossary_by_page_respects_order(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { "Resources" = "resources/index.md" },
  { "First Module" = "modules/first.md" },
  { "Second Module" = "modules/second.md" },
]

[project.extra.knotis.glossary]
default_view = "by_page"
order = ["resources"]
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        resources_dir = docs_dir / "resources"
        resources_dir.mkdir(parents=True, exist_ok=True)
        (resources_dir / "index.md").write_text("# Resources\n\n[[alpha]]\n", encoding="utf-8")
        modules_dir = docs_dir / "modules"
        modules_dir.mkdir(parents=True, exist_ok=True)
        (modules_dir / "first.md").write_text("# First Module\n\n[[beta]]\n", encoding="utf-8")
        (modules_dir / "second.md").write_text("# Second Module\n\n[[gamma]]\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        glossary = (docs_dir / "glossary.md").read_text(encoding="utf-8")
        module_view = glossary[glossary.index('<div id="glossary-module"') :]
        resources_pos = module_view.index("## Resources")
        first_pos = module_view.index("## First Module")
        second_pos = module_view.index("## Second Module")
        self.assertLess(resources_pos, first_pos)
        self.assertLess(resources_pos, second_pos)
        self.assertLess(first_pos, second_pos)

    def test_feature_specific_page_exclusions(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { "First Module" = "modules/first.md" },
  { Resources = ["resources/index.md", "resources/how-to-use.md"] },
]

[project.extra.knotis.site_graph.graph]
exclude_paths = ["tags.md"]

[project.extra.knotis.glossary]
exclude_paths = ["resources/how-to-use.md"]

[project.extra.knotis.search]
enabled = true
exclude_paths = ["resources"]
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "tags.md").write_text("# Tags\n\n[[tagged]]\n", encoding="utf-8")
        modules_dir = docs_dir / "modules"
        modules_dir.mkdir(parents=True, exist_ok=True)
        (modules_dir / "first.md").write_text("# First Module\n\n[[alpha]]\n", encoding="utf-8")
        resources_dir = docs_dir / "resources"
        resources_dir.mkdir(parents=True, exist_ok=True)
        (resources_dir / "index.md").write_text("# Resources\n\n[[resources-index]]\n", encoding="utf-8")
        (resources_dir / "how-to-use.md").write_text("# How to use\n\n[[search]]\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        glossary = (docs_dir / "glossary.md").read_text(encoding="utf-8")
        search = json.loads((docs_dir / "assets" / "knotis-search.json").read_text(encoding="utf-8"))
        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))

        self.assertNotIn('data-keyword="search"', glossary)
        self.assertIn('data-keyword="resources-index"', glossary)
        self.assertIn('data-keyword="alpha"', glossary)

        search_locations = {doc.get("location") for doc in search.get("docs", [])}
        self.assertFalse(any(str(loc).startswith("resources/") for loc in search_locations))
        self.assertTrue(any(str(loc).startswith("modules/") for loc in search_locations))

        graph_page_urls = {
            node.get("url")
            for node in graph.get("nodes", [])
            if node.get("type") == "page"
        }
        self.assertIn("tags/", graph_page_urls)
        site_graph_meta = graph["meta"]["knotis"]["site_graph"]["graph"]
        self.assertIn("tags/", site_graph_meta.get("exclude_urls", []))
        self.assertIn("modules/first/", graph_page_urls)
        self.assertIn("resources/how-to-use/", graph_page_urls)

    def test_content_tag_palette_assigns_builtin_and_auto_colors(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text(
            "# Home\n\n### Topic #code\n\n```r\n1+1\n```\n\n### Result #output\n\n```\n2\n```\n\n### Notes #notes\n\nText\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        colors = graph["meta"]["knotis"]["defaults"]["content_tag_colors"]
        self.assertEqual(colors["default"]["code"]["text"], "var(--content-tag-1)")
        self.assertEqual(colors["default"]["notes"]["text"], "var(--content-tag-2)")
        self.assertEqual(colors["default"]["output"]["text"], "var(--content-tag-3)")
        self.assertEqual(colors["slate"]["code"]["text"], "var(--content-tag-1)")
        self.assertEqual(colors["slate"]["output"]["text"], "var(--content-tag-3)")
        self.assertNotIn("content_tag_palette", graph["meta"]["knotis"]["defaults"])

    def test_content_tag_config_sets_order_and_scheme_colors(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.content_tags]
order = ["beta", "#alpha"]

[project.extra.knotis.content_tags.colors.default]
alpha = "b45309"
"#beta" = "#067647"

[project.extra.knotis.content_tags.colors.slate]
alpha = "#ffbf7d"

[project.extra.knotis.defaults]
content_tag_color_order = "first_seen"
content_tag_color_overrides = { "#alpha" = 2 }

[project.extra.knotis.defaults.content_tag_colors.alpha]
text = "#111111"
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text(
            "# Home\n\n### Beta #beta\n\nText\n\n### Alpha #alpha\n\nText\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        defaults = graph["meta"]["knotis"]["defaults"]
        self.assertNotIn("content_tag_color_order", defaults)
        self.assertNotIn("content_tag_color_overrides", defaults)
        self.assertEqual(graph["meta"]["knotis"]["content_tags"]["order"], ["#beta", "#alpha"])
        self.assertEqual(list(defaults["content_tag_colors"]["default"]), ["beta", "alpha"])
        self.assertEqual(defaults["content_tag_colors"]["default"]["alpha"]["text"], "#b45309")
        self.assertEqual(defaults["content_tag_colors"]["default"]["beta"]["text"], "#067647")
        self.assertEqual(defaults["content_tag_colors"]["slate"]["alpha"]["text"], "#ffbf7d")
        self.assertEqual(defaults["content_tag_colors"]["slate"]["beta"]["text"], "var(--content-tag-1)")

    def test_content_tag_color_config_rejects_unsafe_css_values(self) -> None:
        warnings = io.StringIO()
        with redirect_stderr(warnings):
            normalized = MODULE._normalize_knotis_config({
                "content_tags": {
                    "colors": {
                        "default": {
                            "safe": "b45309",
                            "bad": "red; color: blue",
                            "also_bad": "red\nblue",
                        }
                    }
                }
            })

        self.assertEqual(normalized["content_tags"]["colors"]["default"]["safe"], "#b45309")
        self.assertNotIn("bad", normalized["content_tags"]["colors"]["default"])
        self.assertNotIn("also_bad", normalized["content_tags"]["colors"]["default"])
        self.assertIn("must be a single CSS color value", warnings.getvalue())

    def test_generate_glossary_excludes_directory_and_absolute_paths(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { "First Module" = "modules/first.md" },
  { Resources = ["resources/index.md", "resources/how-to-use.md"] },
]

[project.extra.knotis.glossary]
exclude_paths = ["docs/resources"]
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        modules_dir = docs_dir / "modules"
        modules_dir.mkdir(parents=True, exist_ok=True)
        (modules_dir / "first.md").write_text("# First Module\n\n[[alpha]]\n", encoding="utf-8")
        resources_dir = docs_dir / "resources"
        resources_dir.mkdir(parents=True, exist_ok=True)
        (resources_dir / "index.md").write_text("# Resources\n\n[[resources-index]]\n", encoding="utf-8")
        how_to_use = resources_dir / "how-to-use.md"
        how_to_use.write_text("# How to use\n\n[[search]]\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        glossary = (docs_dir / "glossary.md").read_text(encoding="utf-8")
        self.assertNotIn("How to use", glossary)
        self.assertNotIn('data-keyword="search"', glossary)
        self.assertNotIn('data-keyword="resources-index"', glossary)
        self.assertIn('data-keyword="alpha"', glossary)

        SITE_IO.configure(docs_dir=docs_dir, repo_root=docs_dir.parent)
        md_files = list(docs_dir.rglob("*.md"))
        resolved = SITE_IO.resolve_page_path_set(
            [str(how_to_use.resolve())],
            md_files,
            config_key="test.absolute",
        )
        self.assertEqual(resolved, {"resources/how-to-use.md"})

    def test_generate_glossary_uses_nav_path_and_removes_generated_duplicate(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
  { "Site pages" = [
    { "Glossary" = "site-pages/glossary.md" },
  ]},
]
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text("# Home\n\n[[Alpha]]\n", encoding="utf-8")
        (docs_dir / "glossary.md").write_text(
            "---\ntitle: \"Glossary\"\n---\n\n"
            '<div class="glossary-view-toggle"></div>\n'
            '<div id="glossary-alpha"></div>\n'
            '<div id="glossary-module"></div>\n',
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        moved = docs_dir / "site-pages" / "glossary.md"
        self.assertTrue(moved.exists())
        self.assertFalse((docs_dir / "glossary.md").exists())
        glossary = moved.read_text(encoding="utf-8")
        self.assertIn('data-keyword="alpha"', glossary)

    def test_generate_content_tags_page_when_enabled(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.content_tags]
enabled = true
nav_chips = true
sync_nav = false
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text("# Home\n\n### Topic #code\n\n```r\n1+1\n```\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        page = (docs_dir / "content-tags.md").read_text(encoding="utf-8")
        self.assertIn('title: "Content tags"', page)
        self.assertIn("tags:\n  -", page)
        self.assertIn("knotis_generated: content-tags-page", page)
        self.assertIn('id="knotis-content-tags-page"', page)
        self.assertNotIn("\n# Content tags\n", page)
        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        self.assertTrue(graph["meta"]["knotis"]["content_tags"]["enabled"])
        self.assertTrue(graph["meta"]["knotis"]["content_tags"]["nav_chips"])
        self.assertEqual(graph["meta"]["knotis"]["content_tags"]["page_url"], "content-tags/")

    def test_generate_content_tags_page_preserves_existing_generated_yaml_title(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.content_tags]
enabled = true
sync_nav = false
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        generated = docs_dir / "content-tags.md"
        generated.write_text(
            "---\ntitle: \"Course Tags\"\nicon: lucide/hash\nknotis_generated: content-tags-page\n---\n\n# Content tags\n",
            encoding="utf-8",
        )
        (docs_dir / "index.md").write_text("# Home\n\n### Topic #code\n\nText\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        page = generated.read_text(encoding="utf-8")
        self.assertIn('title: "Course Tags"', page)
        self.assertEqual(page.count("title:"), 1)
        self.assertIn("knotis_generated: content-tags-page", page)
        self.assertNotIn("\n# Course Tags\n", page)

    def test_generate_content_tags_page_preserves_manual_front_matter_and_adds_marker(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.content_tags]
enabled = true
sync_nav = false
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        generated = docs_dir / "content-tags.md"
        generated.write_text(
            "---\nicon: lucide/hash\ntags:\n  - Resources\n---\n\n# Content tags\n",
            encoding="utf-8",
        )
        (docs_dir / "index.md").write_text("# Home\n\n### Topic #code\n\nText\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        page = generated.read_text(encoding="utf-8")
        self.assertTrue(
            page.startswith(
                '---\nicon: lucide/hash\ntags:\n  - Resources\ntitle: "Content tags"\n'
            )
        )
        self.assertIn("knotis_generated: content-tags-page", page)
        self.assertNotIn("\n# Content tags\n", page)
        self.assertIn('<div id="knotis-content-tags-page" class="wikilink-content-tags-page"></div>', page)

    def test_generate_content_tags_page_removed_when_disabled(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.content_tags]
enabled = false
sync_nav = false
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        generated = docs_dir / "content-tags.md"
        generated.write_text(
            "---\nknotis_generated: content-tags-page\n---\n\n# Content tags\n",
            encoding="utf-8",
        )
        (docs_dir / "index.md").write_text("# Home\n\n### Topic #code\n\nText\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)

        self.assertFalse(generated.exists())

    def test_sync_content_tags_nav_adds_and_removes_entry(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { Resources = ["resources/index.md"] },
  { Home = "index.md" },
]

[project.extra.knotis.content_tags]
enabled = true
sync_nav = true
"""
        root, docs_dir = self.make_project(toml_text=toml_text)
        resources_dir = docs_dir / "resources"
        resources_dir.mkdir(parents=True, exist_ok=True)
        (resources_dir / "index.md").write_text("# Resources\n", encoding="utf-8")
        (docs_dir / "index.md").write_text("# Home\n", encoding="utf-8")

        MODULE.main(docs_dir=docs_dir)
        nav_text = (root / "zensical.toml").read_text(encoding="utf-8")
        self.assertIn('"Content tags" = "content-tags.md"', nav_text)

        (root / "zensical.toml").write_text(
            (root / "zensical.toml").read_text(encoding="utf-8").replace(
                "enabled = true",
                "enabled = false",
            ),
            encoding="utf-8",
        )
        MODULE.main(docs_dir=docs_dir)
        nav_text = (root / "zensical.toml").read_text(encoding="utf-8")
        self.assertNotIn('"Content tags" = "content-tags.md"', nav_text)

    def test_content_tags_path_config_is_ignored(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.content_tags]
enabled = true
sync_nav = false
path = "resources/content-tags.md"
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text("# Home\n\n### Topic #code\n\nText\n", encoding="utf-8")

        stderr = io.StringIO()
        with redirect_stderr(stderr):
            MODULE.main(docs_dir=docs_dir)

        self.assertTrue((docs_dir / "content-tags.md").exists())
        self.assertFalse((docs_dir / "resources" / "content-tags.md").exists())
        self.assertIn("content_tags.path", stderr.getvalue())

    def test_generate_content_tags_uses_nav_path_and_removes_generated_duplicate(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
  { "Site pages" = [
    { "Content tags" = "site-pages/content-tags.md" },
  ]},
]

[project.extra.knotis.content_tags]
enabled = true
nav_chips = true
sync_nav = false
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text("# Home\n\n### Topic #code\n\nText\n", encoding="utf-8")
        (docs_dir / "content-tags.md").write_text(
            "---\nknotis_generated: content-tags-page\n---\n\n"
            '<div id="knotis-content-tags-page" class="wikilink-content-tags-page"></div>\n',
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        moved = docs_dir / "site-pages" / "content-tags.md"
        self.assertTrue(moved.exists())
        self.assertFalse((docs_dir / "content-tags.md").exists())
        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        self.assertEqual(graph["meta"]["knotis"]["content_tags"]["page_url"], "site-pages/content-tags/")

    def test_scaffold_explore_nav_paths_drive_generated_pages(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
  { "Explore" = [
    { "Site graph" = "explore/site-graph.md" },
    { "Glossary" = "explore/glossary.md" },
    { "Content tags" = "explore/content-tags.md" },
  ]},
]

[project.extra.knotis.content_tags]
enabled = true
nav_chips = true
sync_nav = false
"""
        _root, docs_dir = self.make_project(toml_text=toml_text)
        (docs_dir / "index.md").write_text("# Home\n\n### Topic #code\n\n[[Alpha]] text\n", encoding="utf-8")
        (docs_dir / "explore").mkdir()
        (docs_dir / "explore" / "site-graph.md").write_text(
            "---\ntitle: \"Site graph\"\ntags:\n  - Explore\n---\n\n<div id=\"graph-container\"></div>\n",
            encoding="utf-8",
        )
        (docs_dir / "explore" / "glossary.md").write_text(
            "---\ntitle: \"Glossary\"\nicon: lucide/arrow-down-a-z\ntags:\n  - Explore\n---\n",
            encoding="utf-8",
        )
        (docs_dir / "explore" / "content-tags.md").write_text(
            "---\ntitle: \"Content tags\"\nicon: lucide/hash\ntags:\n  - Explore\n---\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        graph_page = (docs_dir / "explore" / "site-graph.md").read_text(encoding="utf-8")
        self.assertIn('title: "Site graph"', graph_page)
        self.assertIn("icon: fontawesome/solid/circle-nodes", graph_page)
        self.assertIn("tags:\n  - Explore", graph_page)
        self.assertIn("hide:\n  - toc", graph_page)
        self.assertIn("knotis_generated: site-graph-page", graph_page)
        self.assertIn('id="graph-container"', graph_page)
        self.assertNotIn("knotis-graph.js", graph_page)
        self.assertTrue((docs_dir / "explore" / "glossary.md").exists())
        self.assertTrue((docs_dir / "explore" / "content-tags.md").exists())
        self.assertFalse((docs_dir / "glossary.md").exists())
        self.assertFalse((docs_dir / "content-tags.md").exists())
        graph = json.loads((docs_dir / "assets" / "graph.json").read_text(encoding="utf-8"))
        node_ids = {node["id"] for node in graph["nodes"]}
        self.assertNotIn("page:explore/site-graph/", node_ids)
        self.assertIn("page:explore/glossary/", node_ids)
        explore_edges = {
            (edge["source"], edge["target"], edge["relation"])
            for edge in graph["edges"]
        }
        self.assertIn(("cat:Explore", "page:explore/glossary/", "nav"), explore_edges)
        meta = graph["meta"]["knotis"]
        self.assertEqual(meta["site_graph"]["page_url"], "explore/site-graph/")
        self.assertEqual(meta["content_tags"]["page_url"], "explore/content-tags/")

    def test_graph_meta_includes_explicit_view_config(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.pane]
width = 640

[project.extra.knotis.wikilinks]
default = "#334455"
slate = "rebeccapurple"

[project.extra.knotis.defaults.colors]
wikilink_text = "#123456"

[project.extra.knotis.page_graph.nodes]
show_categories = false

[project.extra.knotis.site_graph.ui]
show_expand_button = false
label_mode = "all"
keyword_label_zoom_threshold = 1.35
page_edge_opacity = 1.0
"""
        graph = self.build_graph_for_markdown("# Home\n\n[[alpha]] and [[beta]].\n", toml_text=toml_text)

        meta = graph["meta"]["knotis"]
        self.assertEqual(meta["pane"]["width"], 640)
        self.assertEqual(meta["wikilinks"]["default"], "#334455")
        self.assertEqual(meta["wikilinks"]["slate"], "rebeccapurple")
        self.assertEqual(meta["defaults"]["pane"]["width"], 640)
        self.assertEqual(meta["defaults"]["pane"]["context_scope"], "all_pages")
        self.assertEqual(meta["defaults"]["pane"]["keyword_context_mode"], "parent_list")
        self.assertEqual(meta["defaults"]["pane"]["edge_context_mode"], "compact")
        self.assertEqual(meta["defaults"]["pane"]["edge_gap_mode"], "hide")
        self.assertTrue(meta["defaults"]["pane"]["show_graph_return_button"])
        self.assertTrue(meta["defaults"]["pane"]["skip_duplicate_headings"])
        self.assertNotIn("colors", meta["defaults"])
        self.assertEqual(meta["defaults"]["content_tag_colors"], {})
        self.assertEqual(meta["defaults"]["hover"]["dim_non_hovered_percent"], 80)
        self.assertFalse(meta["page_graph"]["nodes"]["show_categories"])
        self.assertFalse(meta["site_graph"]["ui"]["show_expand_button"])
        self.assertEqual(meta["site_graph"]["ui"]["label_mode"], "all")
        self.assertEqual(meta["site_graph"]["ui"]["keyword_label_zoom_threshold"], 1.35)
        self.assertEqual(meta["site_graph"]["ui"]["page_edge_opacity"], 1.0)
        self.assertNotIn("presets", meta)

    def test_graph_meta_uses_site_graph_nav_path(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
  { "Site pages" = [
    { "Site graph" = "site-pages/graph.md" },
  ]},
]
"""
        graph = self.build_graph_for_markdown("# Home\n\n[[alpha]].\n", toml_text=toml_text)

        meta = graph["meta"]["knotis"]
        self.assertEqual(meta["site_graph"]["page_url"], "site-pages/graph/")

    def test_graph_meta_defaults_content_config_to_enabled(self) -> None:
        graph = self.build_graph_for_markdown("# Home\n\n[[alpha]].\n")

        content = graph["meta"]["knotis"]["content"]
        self.assertTrue(content["heading_numbering"])
        self.assertTrue(content["heading_guides"])
        self.assertTrue(content["nested_numbering_lists"])
        self.assertTrue(content["styled_section_groups"])

    def test_graph_meta_includes_explicit_content_config(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.content]
heading_numbering = false
heading_guides = false
styled_section_groups = false
""".lstrip()
        graph = self.build_graph_for_markdown("# Home\n\n[[alpha]].\n", toml_text=toml_text)

        content = graph["meta"]["knotis"]["content"]
        self.assertFalse(content["heading_numbering"])
        self.assertFalse(content["heading_guides"])
        self.assertTrue(content["nested_numbering_lists"])
        self.assertFalse(content["styled_section_groups"])

    def test_normalize_knotis_config_search_defaults(self) -> None:
        config = MODULE._normalize_knotis_config({"search": {"enabled": True}})
        search = config["search"]
        self.assertTrue(search["enabled"])
        self.assertEqual(search["exclude_paths"], [])
        self.assertEqual(search["exclude_wikilinks"], [])
        self.assertEqual(search["order"], [])
        self.assertNotIn("include_pages", search)
        self.assertNotIn("index_path", search)

    def test_normalize_knotis_search_order(self) -> None:
        config = MODULE._normalize_knotis_config(
            {"search": {"order": ["/modules/", "resources/how-to-use.md"]}}
        )
        self.assertEqual(
            config["search"]["order"],
            ["modules", "resources/how-to-use.md"],
        )

    def test_graph_meta_defaults_slide_fit_config(self) -> None:
        config = MODULE._normalize_knotis_config({})
        slides = MODULE._build_graph_meta(config, [])["knotis"]["slides"]
        self.assertFalse(slides["enabled"])
        self.assertEqual(slides["include_paths"], [])
        self.assertEqual(slides["exclude_paths"], [])
        self.assertEqual(slides["include_urls"], [])
        self.assertEqual(slides["exclude_urls"], [])
        self.assertEqual(slides["fit_mode"], "fit")
        self.assertEqual(slides["fit_min_font_px"], 20)
        self.assertEqual(slides["fit_max_font_px"], 52)
        self.assertEqual(slides["content_fill"], 0.72)
        self.assertEqual(slides["content_inset"], [3, 5, 3, 5])

    def test_normalize_knotis_config_readaloud_defaults(self) -> None:
        config = MODULE._normalize_knotis_config({})
        readaloud = config["readaloud"]
        self.assertTrue(readaloud["enabled"])

    def test_normalize_knotis_config_readaloud_enabled(self) -> None:
        config = MODULE._normalize_knotis_config({"readaloud": {"enabled": False}})
        self.assertFalse(config["readaloud"]["enabled"])

        invalid = MODULE._normalize_knotis_config({"readaloud": {"enabled": "nope"}})
        self.assertTrue(invalid["readaloud"]["enabled"])

    def test_graph_meta_includes_readaloud_config(self) -> None:
        config = MODULE._normalize_knotis_config({"readaloud": {"enabled": False}})
        readaloud = MODULE._build_graph_meta(config, [])["knotis"]["readaloud"]
        self.assertFalse(readaloud["enabled"])

    def test_media_is_not_author_configurable(self) -> None:
        config = MODULE._normalize_knotis_config({})
        self.assertNotIn("media", config)

        ignored = MODULE._normalize_knotis_config({"media": {"enabled": False, "captions": False}})
        self.assertNotIn("media", ignored)

        meta = MODULE._build_graph_meta(ignored, [])["knotis"]
        self.assertNotIn("media", meta)

    def test_graph_meta_includes_explicit_slide_fit_config(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.slides]
enabled = true
fit_mode = "scroll"
fit_min_font_px = 18
fit_max_font_px = 46
content_fill = 0.65
""".lstrip()
        graph = self.build_graph_for_markdown("# Home\n\n[[alpha]].\n", toml_text=toml_text)

        slides = graph["meta"]["knotis"]["slides"]
        self.assertTrue(slides["enabled"])
        self.assertEqual(slides["fit_mode"], "scroll")
        self.assertEqual(slides["fit_min_font_px"], 18)
        self.assertEqual(slides["fit_max_font_px"], 46)
        self.assertEqual(slides["content_fill"], 0.65)

    def test_graph_meta_rejects_legacy_slide_fit_aliases(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.slides]
fit_mode = "hybrid"
fit_target_fill = 0.8
""".lstrip()
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            graph = self.build_graph_for_markdown("# Home\n\n[[alpha]].\n", toml_text=toml_text)

        warnings = stderr.getvalue()
        self.assertIn("knotis.slides.fit_mode must be one of", warnings)
        self.assertIn("Unknown config key 'knotis.slides.fit_target_fill' will be ignored", warnings)
        slides = graph["meta"]["knotis"]["slides"]
        self.assertEqual(slides["fit_mode"], "fit")
        self.assertEqual(slides["content_fill"], 0.72)

    def test_invalid_slide_fit_config_warns_and_falls_back(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(
                {
                    "slides": {
                        "enabled": True,
                        "fit_mode": "grow",
                        "fit_min_font_px": 60,
                        "fit_max_font_px": 12,
                        "content_fill": 0.2,
                    }
                }
            )

        warnings = stderr.getvalue()
        self.assertIn("knotis.slides.fit_mode must be one of", warnings)
        self.assertIn("knotis.slides.content_fill must be >= 0.35", warnings)
        self.assertIn("knotis.slides.fit_min_font_px must be <= knotis.slides.fit_max_font_px", warnings)
        self.assertTrue(config["slides"]["enabled"])
        self.assertEqual(config["slides"]["fit_mode"], "fit")
        self.assertEqual(config["slides"]["fit_min_font_px"], 20)
        self.assertEqual(config["slides"]["fit_max_font_px"], 52)
        self.assertEqual(config["slides"]["content_fill"], 0.72)

    def test_invalid_slide_fit_numeric_ranges_warn_and_fall_back(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(
                {
                    "slides": {
                        "fit_min_font_px": 0,
                        "fit_max_font_px": "large",
                        "content_fill": 1.2,
                    }
                }
            )

        warnings = stderr.getvalue()
        self.assertIn("knotis.slides.fit_min_font_px must be >= 1", warnings)
        self.assertIn("knotis.slides.fit_max_font_px must be an integer", warnings)
        self.assertIn("knotis.slides.content_fill must be <= 1.0", warnings)
        self.assertEqual(config["slides"]["fit_min_font_px"], 20)
        self.assertEqual(config["slides"]["fit_max_font_px"], 52)
        self.assertEqual(config["slides"]["content_fill"], 0.72)

    def test_graph_meta_resolves_slides_include_and_exclude_pages(self) -> None:
        toml_text = """
[project]
site_name = "Test"
nav = [{ Home = "index.md" }]

[project.extra.knotis.slides]
enabled = true
include_paths = ["modules"]
exclude_paths = ["modules/02.-skip.md"]
""".lstrip()
        _root, docs_dir = self.make_project(toml_text=toml_text)
        MODULE.knotis_site_io.configure(docs_dir=docs_dir, repo_root=_root)
        (docs_dir / "modules").mkdir(parents=True, exist_ok=True)
        included = docs_dir / "modules" / "01.-keep.md"
        excluded = docs_dir / "modules" / "02.-skip.md"
        other = docs_dir / "resources" / "other.md"
        other.parent.mkdir(parents=True, exist_ok=True)
        included.write_text("# Keep\n", encoding="utf-8")
        excluded.write_text("# Skip\n", encoding="utf-8")
        other.write_text("# Other\n", encoding="utf-8")
        md_files = [included, excluded, other]
        config = MODULE._normalize_knotis_config(MODULE._load_toml_knotis_config())
        slides = MODULE._build_graph_meta(config, md_files)["knotis"]["slides"]

        self.assertEqual(slides["include_paths"], ["modules"])
        self.assertEqual(slides["exclude_paths"], ["modules/02.-skip.md"])
        self.assertEqual(slides["include_urls"], ["modules/01.-keep/"])
        self.assertEqual(slides["exclude_urls"], ["modules/02.-skip/"])

    def test_slides_include_page_path_aliases_normalize_equivalently(self) -> None:
        cases = [
            ("modules", ["modules"]),
            ("docs/modules", ["modules"]),
            ("modules/01.-keep.md", ["modules/01.-keep.md"]),
            ("docs/modules/01.-keep.md", ["modules/01.-keep.md"]),
        ]
        for alias, expected in cases:
            with self.subTest(alias=alias):
                config = MODULE._normalize_knotis_config(
                    {"slides": {"include_paths": [alias], "exclude_paths": []}},
                )
                self.assertEqual(config["slides"]["include_paths"], expected)

        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(
                {
                    "slides": {
                        "include_paths": ["docs/modules"],
                        "exclude_paths": ["docs/modules/02.-skip.md"],
                    },
                },
            )
        self.assertEqual(config["slides"]["include_paths"], ["modules"])
        self.assertEqual(config["slides"]["exclude_paths"], ["modules/02.-skip.md"])

    def test_pane_config_defaults_to_enabled_with_empty_include_and_exclude(self) -> None:
        config = MODULE._normalize_knotis_config({})
        self.assertEqual(config["pane"]["path"]["enabled"], True)
        self.assertEqual(
            config["path"],
            {"enabled": True, "include_paths": [], "exclude_paths": []},
        )

    def test_pane_path_config_enabled_accepts_explicit_true_and_false(self) -> None:
        config = MODULE._normalize_knotis_config({"pane": {"path": {"enabled": False}}})
        self.assertEqual(config["pane"]["path"]["enabled"], False)
        self.assertEqual(config["path"]["enabled"], False)

        config = MODULE._normalize_knotis_config(
            {"pane": {"path": {"enabled": True, "include_paths": ["modules"]}}},
        )
        self.assertEqual(config["pane"]["path"]["enabled"], True)
        self.assertEqual(config["pane"]["path"]["include_paths"], ["modules"])
        self.assertEqual(config["path"]["include_paths"], ["modules"])

    def test_pane_path_config_enabled_warns_and_falls_back_on_invalid_value(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config({"pane": {"path": {"enabled": "yes"}}})
        self.assertIn("knotis.pane.path.enabled", stderr.getvalue())
        self.assertEqual(config["pane"]["path"]["enabled"], True)

    def test_pane_path_config_accepts_bare_string_or_list(self) -> None:
        config = MODULE._normalize_knotis_config({"pane": {"path": {"include_paths": "modules"}}})
        self.assertEqual(config["pane"]["path"]["include_paths"], ["modules"])

        config = MODULE._normalize_knotis_config(
            {"pane": {"path": {"include_paths": ["features", "workflows"]}}},
        )
        self.assertEqual(config["pane"]["path"]["include_paths"], ["features", "workflows"])

    def test_pane_path_config_exclude_supports_folder_and_page_tokens(self) -> None:
        config = MODULE._normalize_knotis_config(
            {"pane": {"path": {"exclude_paths": ["get-started", "/features/glossary-feature/"]}}},
        )
        self.assertEqual(config["pane"]["path"]["include_paths"], [])
        self.assertEqual(
            config["pane"]["path"]["exclude_paths"],
            ["get-started", "features/glossary-feature"],
        )

    def test_pane_config_warns_on_unknown_key(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            MODULE._normalize_knotis_config({"pane": {"bogus": "x"}})
        self.assertIn("knotis.pane.bogus", stderr.getvalue())

    def test_defaults_pane_in_toml_warns_as_not_configurable(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(
                {"defaults": {"pane": {"width": 640, "show_history_controls": False}}},
            )
        self.assertIn("knotis.defaults.pane is not configurable", stderr.getvalue())
        self.assertEqual(config["defaults"]["pane"]["width"], 750)

    def test_slide_runtime_repairs_cloned_tabbed_sets(self) -> None:
        slides_js = (SRC_DIR / "knotis" / "assets" / "knotis-slides.js").read_text(encoding="utf-8")

        self.assertIn("function isSlidesPage()", slides_js)
        self.assertIn("function siteRootHref()", slides_js)
        self.assertIn("function pathMatchesPageUrl(", slides_js)
        self.assertIn("knotis-slides__title-slide", slides_js)
        self.assertIn("buildModuleTitleSlide", slides_js)
        self.assertIn("include_urls", slides_js)
        self.assertIn("function repairTabbedSets(root)", slides_js)
        self.assertIn("labels[inputIndex].htmlFor = id", slides_js)
        self.assertIn("function syncMeasureTabbedSets(card, measure)", slides_js)
        self.assertIn("watchSlideTabs(card)", slides_js)

    def test_slide_runtime_marks_compact_table_cells(self) -> None:
        slides_js = (SRC_DIR / "knotis" / "assets" / "knotis-slides.js").read_text(encoding="utf-8")
        slides_css = (SRC_DIR / "knotis" / "assets" / "knotis-slides.css").read_text(encoding="utf-8")

        self.assertIn("function annotateSlideTables(root)", slides_js)
        self.assertIn('cell.dataset.knotisTableCell = "numeric"', slides_js)
        self.assertIn('cell.dataset.knotisTableCell = "compact"', slides_js)
        self.assertIn('[data-knotis-table-cell="numeric"]', slides_css)
        self.assertNotIn(":nth-child(n+3) {\n  white-space: nowrap;", slides_css)

    def test_slides_enabled_auto_injects_slide_marker_extension(self) -> None:
        root, _docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"

[project.extra.knotis.slides]
enabled = true
""".lstrip(),
        )
        from knotis.builder.zensical_config import (
            inject_slide_markers_extension,
            resolve_zensical_config_path,
            site_uses_packaged_markdown_extensions,
            zensical_text_includes_slide_markers_extension,
        )

        source = (root / "zensical.toml").read_text(encoding="utf-8")
        self.assertFalse(zensical_text_includes_slide_markers_extension(source))
        self.assertTrue(site_uses_packaged_markdown_extensions(root))
        injected = inject_slide_markers_extension(source)
        self.assertIn("knotis.markdown.knotis_slide_markers", injected)
        resolved = resolve_zensical_config_path(root)
        self.assertEqual(resolved, root / ".zensical.knotis.build.toml")
        self.assertIn("knotis.markdown.knotis_slide_markers", resolved.read_text(encoding="utf-8"))

    def test_scripts_build_site_resolves_generated_zensical_config(self) -> None:
        repo_root = Path(__file__).resolve().parents[2]
        if not (repo_root / "scripts" / "build_site.py").is_file():
            self.skipTest("legacy site scripts are unavailable in the standalone package")
        script = """
from pathlib import Path
import sys

repo_root = Path({repo_root!r})
sys.path.insert(0, str(repo_root / "scripts"))
from build_site import _resolve_zensical_config

resolved = _resolve_zensical_config(repo_root)
assert resolved.name == ".zensical.knotis.build.toml", resolved
assert "knotis.markdown.knotis_slide_markers" in resolved.read_text(encoding="utf-8")
""".format(repo_root=str(repo_root))
        result = subprocess.run(
            [sys.executable, "-c", script],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_invalid_content_config_warns_and_falls_back(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(
                {
                    "content": {
                        "heading_numbering": "nope",
                        "heading_guides": "nope",
                        "styled_section_groups": "nope",
                        "nested_numbering_lists": False,
                    }
                }
            )

        self.assertIn("knotis.content.heading_numbering must be true or false", stderr.getvalue())
        self.assertIn("knotis.content.heading_guides must be true or false", stderr.getvalue())
        self.assertIn("knotis.content.styled_section_groups must be true or false", stderr.getvalue())
        self.assertIn("knotis.content.nested_numbering_lists' is no longer configurable", stderr.getvalue())
        self.assertTrue(config["content"]["heading_numbering"])
        self.assertTrue(config["content"]["heading_guides"])
        self.assertTrue(config["content"]["styled_section_groups"])
        self.assertTrue(config["content"]["nested_numbering_lists"])

    def test_removed_structured_lists_warns_and_falls_back(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(
                {"content": {"structured_lists": False}}
            )

        self.assertIn("structured_lists' is no longer configurable", stderr.getvalue())
        self.assertTrue(config["content"]["nested_numbering_lists"])

    def test_removed_search_config_keys_warn(self) -> None:
        stderr = io.StringIO()
        with redirect_stderr(stderr):
            config = MODULE._normalize_knotis_config(
                {
                    "search": {
                        "enabled": False,
                        "filters": "yes",
                        "include_references": True,
                        "include_pages": False,
                        "index_path": "custom.json",
                    }
                }
            )

        output = stderr.getvalue()
        self.assertIn("'knotis.search.filters' is not configurable", output)
        self.assertIn("'knotis.search.include_references' is not configurable", output)
        self.assertIn("'knotis.search.include_pages' is not configurable", output)
        self.assertIn("'knotis.search.index_path' is not configurable", output)
        self.assertFalse(config["search"]["enabled"])
        self.assertNotIn("filters", config["search"])

    def test_keyword_nodes_include_occurrence_count(self) -> None:
        graph = self.build_graph_for_markdown("# Home\n\n[[alpha]] appears.\n\n[[alpha]] appears again.\n")

        alpha = next(node for node in graph["nodes"] if node["id"] == "kw:alpha")
        self.assertEqual(alpha["page_count"], 1)
        self.assertEqual(alpha["occurrence_count"], 2)

    def test_edges_include_weight_page_count_and_sources(self) -> None:
        paragraph_graph = self.build_graph_for_markdown("# Home\n\n[[alpha]] and [[beta]] appear together.\n")
        heading_graph = self.build_graph_for_markdown(
            "# Home\n\n## Topic\nIntro without keywords.\n\n[[gamma]] detail.\n\n[[delta]] detail.\n"
        )

        paragraph_edges = {
            (edge["source"], edge["target"]): edge
            for edge in paragraph_graph["edges"]
            if edge["relation"] == "sibling"
        }
        heading_edges = {
            (edge["source"], edge["target"]): edge
            for edge in heading_graph["edges"]
            if edge["relation"] == "sibling"
        }
        alpha_beta = paragraph_edges[("kw:alpha", "kw:beta")]
        gamma_delta = heading_edges[("kw:delta", "kw:gamma")]

        self.assertEqual(alpha_beta["page_count"], 1)
        self.assertEqual(alpha_beta["sources"], {"line": 0, "paragraph": 1, "heading": 1, "local_parent": 0})
        self.assertEqual(alpha_beta["weight"], 3)

        self.assertEqual(gamma_delta["sources"], {"line": 0, "paragraph": 0, "heading": 1, "local_parent": 0})
        self.assertEqual(gamma_delta["weight"], 1)

    def test_apply_knotis_zensical_overrides_injects_generator_false(self) -> None:
        from knotis.builder.config_defaults import KNOTIS_FOOTER_ATTRIBUTION_HTML
        from knotis.builder.zensical_config import apply_knotis_zensical_overrides

        root, _docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"

[project.extra]
generator = true

[project.extra.knotis.content]
generator = true
""".lstrip(),
        )
        source = (root / "zensical.toml").read_text(encoding="utf-8")
        patched = apply_knotis_zensical_overrides(source, root)
        self.assertIn("[project.extra]", patched)
        self.assertRegex(patched, r"\[project\.extra\]\s*\ngenerator = false")
        self.assertRegex(patched, r"\[project\.extra\.knotis\.content\][^\[]*generator = false")
        self.assertIn(KNOTIS_FOOTER_ATTRIBUTION_HTML, patched)

    def test_apply_knotis_zensical_overrides_injects_content_tags_css(self) -> None:
        from knotis.builder.zensical_config import apply_knotis_zensical_overrides

        root, _docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
extra_css = [
  "assets/knotis-palette.css",
  "assets/knotis-content.css",
  "assets/knotis-wikilinks.css",
  "assets/knotis-theme.css",
]
""".lstrip(),
        )
        source = (root / "zensical.toml").read_text(encoding="utf-8")
        patched = apply_knotis_zensical_overrides(source, root)
        self.assertIn('"assets/knotis-content-tags.css"', patched)
        self.assertLess(
            patched.index('"assets/knotis-content-tags.css"'),
            patched.index('"assets/knotis-content.css"'),
        )

    def test_apply_knotis_zensical_overrides_injects_nested_generator_false_when_missing(self) -> None:
        from knotis.builder.zensical_config import apply_knotis_zensical_overrides

        root, _docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
""".lstrip(),
        )
        source = (root / "zensical.toml").read_text(encoding="utf-8")
        patched = apply_knotis_zensical_overrides(source, root)
        self.assertIn("[project.extra.knotis.content]\ngenerator = false", patched)

    def test_clean_generated_page_routes_removes_default_routes_when_nav_uses_subdir(self) -> None:
        from knotis.build_site import clean_generated_page_routes

        root, docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
nav = [
  { "Site graph" = "site-pages/site-graph.md" },
  { "Glossary" = "site-pages/glossary.md" },
  { "Content tags" = "site-pages/content-tags.md" },
]
""".lstrip(),
        )
        (docs_dir / "site-pages").mkdir()
        (docs_dir / "site-pages" / "site-graph.md").write_text("generated", encoding="utf-8")
        (docs_dir / "site-pages" / "glossary.md").write_text("generated", encoding="utf-8")
        (docs_dir / "site-pages" / "content-tags.md").write_text("generated", encoding="utf-8")
        for route in ("site-graph", "glossary", "content-tags"):
            route_dir = root / "site" / route
            route_dir.mkdir(parents=True)
            (route_dir / "index.html").write_text("stale", encoding="utf-8")

        clean_generated_page_routes(root)

        self.assertFalse((root / "site" / "site-graph").exists())
        self.assertFalse((root / "site" / "glossary").exists())
        self.assertFalse((root / "site" / "content-tags").exists())

    def test_apply_knotis_zensical_overrides_merges_user_copyright(self) -> None:
        from knotis.builder.config_defaults import KNOTIS_FOOTER_ATTRIBUTION_HTML
        from knotis.builder.zensical_config import apply_knotis_zensical_overrides

        root, _docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
copyright = "&copy; 2025 Jane Doe"

[project.extra.knotis.content]
generator = true
""".lstrip(),
        )
        source = (root / "zensical.toml").read_text(encoding="utf-8")
        patched = apply_knotis_zensical_overrides(source, root)
        self.assertIn("&copy; 2025 Jane Doe", patched)
        self.assertIn("<br>", patched)
        self.assertIn(KNOTIS_FOOTER_ATTRIBUTION_HTML, patched)

    def test_apply_knotis_zensical_overrides_skips_attribution_when_disabled(self) -> None:
        from knotis.builder.config_defaults import KNOTIS_FOOTER_ATTRIBUTION_HTML
        from knotis.builder.zensical_config import apply_knotis_zensical_overrides

        root, _docs_dir = self.make_project(
            toml_text="""
[project]
site_name = "Test"
copyright = "&copy; 2025 Jane Doe"

[project.extra.knotis.content]
generator = false
""".lstrip(),
        )
        source = (root / "zensical.toml").read_text(encoding="utf-8")
        patched = apply_knotis_zensical_overrides(source, root)
        self.assertIn("generator = false", patched)
        self.assertNotIn(KNOTIS_FOOTER_ATTRIBUTION_HTML, patched)
        self.assertNotIn('copyright = """', patched)


if __name__ == "__main__":
    unittest.main()
