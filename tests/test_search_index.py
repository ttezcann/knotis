#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from knotis.builder import build_wikilinks as MODULE  # noqa: E402
from knotis.builder.assets_mirror import runtime_asset_output_dir  # noqa: E402


class SearchIndexTests(unittest.TestCase):
    """Characterization tests for the Knotis search index pipeline."""

    def asset_dir(self, root: Path, docs_dir: Path) -> Path:
        return runtime_asset_output_dir(root, docs_dir)

    def make_site(self) -> tuple[Path, Path]:
        root = Path(tempfile.mkdtemp())
        docs_dir = root / "docs"
        (docs_dir / "assets").mkdir(parents=True)
        (root / "zensical.toml").write_text(
            """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
  { "First Module" = "modules/first.md" },
]

[project.extra.knotis.search]
enabled = true
order = ["other", "modules"]
""".lstrip(),
            encoding="utf-8",
        )
        MODULE.REPO_ROOT = root
        MODULE.DOCS_DIR = docs_dir
        MODULE.ASSETS_DIR = docs_dir / "assets"
        MODULE.knotis_site_io.configure(docs_dir=docs_dir, repo_root=root)
        (docs_dir / "index.md").write_text(
            "# Home\n\nWelcome to [[alpha]] and #intro.\n",
            encoding="utf-8",
        )
        modules_dir = docs_dir / "modules"
        modules_dir.mkdir(parents=True, exist_ok=True)
        (modules_dir / "first.md").write_text(
            "# First Module\n"
            "\n"
            "## Learning [[alpha]]\n"
            "- [[alpha]] is the first concept. #code\n"
            "    - It relates to [[beta]].\n"
            "\n"
            "## Practice\n"
            "- Run the example below.\n",
            encoding="utf-8",
        )
        return root, docs_dir

    def build_index(self) -> dict:
        root, docs_dir = self.make_site()
        MODULE.main(docs_dir=docs_dir)
        index_path = self.asset_dir(root, docs_dir) / "knotis-search.json"
        self.assertTrue(index_path.is_file(), "knotis-search.json not written")
        return json.loads(index_path.read_text(encoding="utf-8"))

    def test_index_contains_page_section_and_concept_docs(self) -> None:
        index = self.build_index()
        docs = index["docs"]
        kinds = {doc["kind"] for doc in docs}
        self.assertIn("page", kinds)
        self.assertIn("section", kinds)
        self.assertIn("concept", kinds)
        self.assertEqual(index["options"]["order"], ["other", "modules"])

        page_titles = {doc["title"] for doc in docs if doc["kind"] == "page"}
        self.assertIn("Home", page_titles)
        self.assertIn("First Module", page_titles)

        section_titles = {doc["title"] for doc in docs if doc["kind"] == "section"}
        self.assertIn("Learning alpha", section_titles)
        self.assertIn("Practice", section_titles)

    def test_concept_docs_cover_all_wikilinked_keywords(self) -> None:
        index = self.build_index()
        concept_locations = {
            doc["location"] for doc in index["docs"] if doc["kind"] == "concept"
        }
        self.assertIn("knotis://concept/alpha", concept_locations)
        self.assertIn("knotis://concept/beta", concept_locations)

    def test_section_docs_carry_concepts_content_tags_and_location(self) -> None:
        index = self.build_index()
        learning = next(
            doc
            for doc in index["docs"]
            if doc["kind"] == "section" and doc["title"] == "Learning alpha"
        )
        self.assertIn("alpha", learning.get("concept_keys", []))
        self.assertIn("beta", learning.get("concept_keys", []))
        self.assertIn("#code", learning.get("content_tags", []))
        self.assertTrue(learning["location"].startswith("modules/first/"))
        self.assertIn("#learning-alpha", learning["location"])

    def test_page_order_follows_nav(self) -> None:
        index = self.build_index()
        pages = {
            doc["title"]: doc["page_order"] for doc in index["docs"] if doc["kind"] == "page"
        }
        # nav_path_to_url returns None for index pages, so only non-index
        # nav pages get a real order; everything else defaults to 999999.
        self.assertEqual(pages["First Module"], 0)
        self.assertEqual(pages["Home"], 999999)

    def test_search_text_strips_markup(self) -> None:
        index = self.build_index()
        learning = next(
            doc
            for doc in index["docs"]
            if doc["kind"] == "section" and doc["title"] == "Learning alpha"
        )
        text = learning.get("text", "")
        self.assertNotIn("[[", text)
        self.assertIn("alpha is the first concept", text)

    def test_reference_occurrences_shadow_ordinary_wikilinks_but_keep_plain_text(self) -> None:
        root = Path(tempfile.mkdtemp())
        docs_dir = root / "docs"
        (docs_dir / "assets").mkdir(parents=True)
        (root / "zensical.toml").write_text(
            """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
  { Other = "other.md" },
]

[project.extra.knotis.search]
enabled = true
""".lstrip(),
            encoding="utf-8",
        )
        MODULE.REPO_ROOT = root
        MODULE.DOCS_DIR = docs_dir
        MODULE.ASSETS_DIR = docs_dir / "assets"
        MODULE.knotis_site_io.configure(docs_dir=docs_dir, repo_root=root)
        (docs_dir / "index.md").write_text(
            "# Home\n\n"
            "## What is [[RStudio]]?\n"
            "- RStudio is an IDE.\n\n"
            "## Reference source one\n"
            "- Paste the code into [[RStudio console|ref]].\n\n"
            "## Reference source two\n"
            "- The [[RStudio console|ref]] shows immediate output.\n",
            encoding="utf-8",
        )
        (docs_dir / "other.md").write_text(
            "# Other\n\n"
            "## Ordinary links\n"
            ":lucide-clipboard-copy: Use [[RStudio console]] here.\n"
            "Use [[RStudio console|console pane]] again.\n\n"
            "## Plain text\n"
            "The RStudio console is also mentioned without a wikilink.\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)
        asset_dir = self.asset_dir(root, docs_dir)
        index = json.loads((asset_dir / "knotis-search.json").read_text(encoding="utf-8"))
        docs = index["docs"]

        references = json.loads((asset_dir / "references.json").read_text(encoding="utf-8"))
        self.assertEqual(len(references["rstudio console"]), 2)

        reference_docs = [d for d in docs if d["kind"] == "reference_occurrence"]
        self.assertEqual(len(reference_docs), 2)
        self.assertTrue(all(d["group"] == "./" for d in reference_docs))
        self.assertTrue(all(d["reference_keys"] == ["rstudio console"] for d in reference_docs))
        self.assertTrue(all(d["search_title"] == "" for d in reference_docs))
        self.assertTrue(all(d["search_text"] == "" for d in reference_docs))
        self.assertEqual(
            [d["content_line"] for d in reference_docs],
            sorted(d["content_line"] for d in reference_docs),
        )

        reference_keys = {
            key
            for doc in reference_docs
            for key in doc.get("reference_keys", [])
        }
        for reference_key in reference_keys:
            self.assertFalse(
                any(
                    d["kind"] in {"concept", "mention"}
                    and reference_key in d.get("concept_keys", [])
                    for d in docs
                ),
                f"ordinary concept document leaked reference key {reference_key!r}",
            )
            self.assertFalse(
                any(
                    d["kind"] in {"page", "section"}
                    and reference_key in (
                        d.get("concept_keys", []) + d.get("reference_keys", [])
                    )
                    for d in docs
                ),
                f"ordinary page/section document leaked reference key {reference_key!r}",
            )

        ordinary = next(
            d for d in docs
            if d["kind"] == "section" and d.get("page_url") == "other/" and d["title"] == "Ordinary links"
        )
        self.assertNotIn("rstudio console", ordinary["search_text"].lower())
        self.assertNotIn("console pane", ordinary["search_text"].lower())
        self.assertNotIn("copy", ordinary["search_text"].lower())
        self.assertIn("[[RStudio console|console pane]]", "\n".join(ordinary["section_lines_raw"]))

        plain = next(
            d for d in docs
            if d["kind"] == "section" and d.get("page_url") == "other/" and d["title"] == "Plain text"
        )
        self.assertIn("rstudio console", plain["search_text"].lower())

    def test_html_comments_are_inert_for_every_index(self) -> None:
        root, docs_dir = self.make_site()
        (docs_dir / "index.md").write_text(
            "# Home\n\n"
            "<!-- knotis-reference: Secret console\n"
            "Hidden searchable phrase [[Secret concept]] #secret-tag.\n"
            "-->\n\n"
            "Visible text only.\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)

        asset_dir = self.asset_dir(root, docs_dir)
        references = json.loads((asset_dir / "references.json").read_text(encoding="utf-8"))
        wikilinks = json.loads((asset_dir / "wikilinks.json").read_text(encoding="utf-8"))
        content_tags = json.loads((asset_dir / "content-tags.json").read_text(encoding="utf-8"))
        search = json.loads((asset_dir / "knotis-search.json").read_text(encoding="utf-8"))

        self.assertNotIn("secret console", references)
        self.assertNotIn("secret concept", wikilinks)
        self.assertNotIn("#secret-tag", content_tags)
        searchable = " ".join(
            str(doc.get(field, ""))
            for doc in search["docs"]
            for field in ("search_title", "search_text")
        ).lower()
        self.assertNotIn("hidden searchable phrase", searchable)
        self.assertNotIn("secret concept", searchable)

    def test_search_excluded_sections_emit_no_docs_and_leak_no_text(self) -> None:
        # A { data-search-exclude } heading must remove its section from search
        # entirely - including the mention docs built from wikilink occurrences
        # inside it, whose text/breadcrumb previously leaked the excluded heading
        # (heading_path is attr-stripped upstream, defeating the marker-based
        # section stripper).
        root = Path(tempfile.mkdtemp())
        docs_dir = root / "docs"
        (docs_dir / "assets").mkdir(parents=True)
        (root / "zensical.toml").write_text(
            """
[project]
site_name = "Test"
nav = [
  { Home = "index.md" },
]

[project.extra.knotis.search]
enabled = true
""".lstrip(),
            encoding="utf-8",
        )
        MODULE.REPO_ROOT = root
        MODULE.DOCS_DIR = docs_dir
        MODULE.ASSETS_DIR = docs_dir / "assets"
        MODULE.knotis_site_io.configure(docs_dir=docs_dir, repo_root=root)
        (docs_dir / "index.md").write_text(
            "# Home\n\n"
            "## Hidden setup steps { data-search-exclude }\n"
            "- Paste [[Secret concept]] into the console.\n\n"
            "## Visible section\n"
            "- This mentions [[Secret concept]] too, in indexable text.\n",
            encoding="utf-8",
        )

        MODULE.main(docs_dir=docs_dir)
        index = json.loads(
            (self.asset_dir(root, docs_dir) / "knotis-search.json").read_text(encoding="utf-8")
        )
        docs = index["docs"]

        section_titles = {d["title"] for d in docs if d["kind"] == "section"}
        self.assertNotIn("Hidden setup steps", section_titles)
        self.assertIn("Visible section", section_titles)

        mention_docs = [d for d in docs if d["kind"] == "mention"]
        self.assertTrue(
            all(
                "Hidden setup steps" not in " ".join(d.get("breadcrumb", []))
                for d in mention_docs
            ),
            "no mention doc may carry the excluded heading in its breadcrumb",
        )
        for doc in docs:
            haystack = " ".join([
                str(doc.get("text") or ""),
                " ".join(str(part) for part in doc.get("breadcrumb") or []),
            ])
            self.assertNotIn(
                "Hidden setup steps",
                haystack,
                f"excluded heading text leaked into {doc['kind']} doc {doc.get('location')}",
            )

        # The wikilink in the visible section must still be searchable.
        visible_mentions = [
            d for d in mention_docs
            if "Visible section" in " ".join(d.get("breadcrumb", []))
        ]
        self.assertTrue(
            visible_mentions,
            "the non-excluded occurrence of the same wikilink must keep its mention doc",
        )


if __name__ == "__main__":
    unittest.main()
