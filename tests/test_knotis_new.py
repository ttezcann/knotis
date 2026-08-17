#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import tomllib
import unittest
from pathlib import Path

KNOTIS_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = KNOTIS_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from knotis import new as knotis_new


class KnotisNewTests(unittest.TestCase):
  def setUp(self) -> None:
    self.module = knotis_new

  def test_refuses_existing_zensical_toml(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp)
      (root / "zensical.toml").write_text("[project]\n", encoding="utf-8")
      with self.assertRaises(FileExistsError):
        self.module.run_knotis_new(root, run_build=False)

  def test_scaffold_writes_generic_site(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      root = Path(tmp) / "demo"
      self.module.run_knotis_new(
        root,
        run_build=False,
      )

      self.assertTrue((root / "docs" / "index.md").exists())
      self.assertTrue((root / "docs" / "explore").is_dir())
      self.assertTrue((root / "docs" / "section-1").is_dir())
      self.assertTrue((root / "docs" / "section-2").is_dir())
      self.assertFalse((root / "docs" / "graph.md").exists())
      self.assertFalse((root / "docs" / "explore" / "graph.md").exists())

      graph_md = (root / "docs" / "explore" / "site-graph.md").read_text(encoding="utf-8")
      self.assertIn('title: "Site graph"', graph_md)
      self.assertIn("icon: fontawesome/solid/circle-nodes", graph_md)
      self.assertIn("tags:\n  -", graph_md)
      self.assertIn("knotis_generated: site-graph-page", graph_md)
      self.assertIn("graph-container", graph_md)

      glossary_md = (root / "docs" / "explore" / "glossary.md").read_text(encoding="utf-8")
      self.assertIn('title: "Glossary"', glossary_md)
      self.assertIn("knotis_content:\n  heading_numbering: false\n  heading_guides: false", glossary_md)
      self.assertNotIn("template:", glossary_md)
      self.assertIn("icon: lucide/arrow-down-a-z", glossary_md)
      self.assertIn("tags:\n  -", glossary_md)
      self.assertIn("tags:\n  -\nknotis_generated: glossary-page", glossary_md)
      self.assertIn("knotis_generated: glossary-page", glossary_md)

      content_tags_md = (root / "docs" / "explore" / "content-tags.md").read_text(encoding="utf-8")
      self.assertIn('title: "Content tags"', content_tags_md)
      self.assertIn("icon: lucide/hash", content_tags_md)
      self.assertIn("tags:\n  -", content_tags_md)
      self.assertIn("knotis_generated: content-tags-page", content_tags_md)
      self.assertNotIn("Resources", graph_md + glossary_md + content_tags_md)

      onboarding = (
        "- Edit this page in `docs/{section}/page-{page_num}.md`.\n"
        "- Rename `{section}` and `page-{page_num}` in your local directory.\n"
        "- Edit `title` and `tags` in this page's YAML.\n"
        "- Edit `Site tree` in `zensical.toml`.\n"
      )
      for page_num in range(1, 11):
        section = "section-1" if page_num <= 5 else "section-2"
        tag = "Section-1" if page_num <= 5 else "Section-2"
        page_md = (root / "docs" / section / f"page-{page_num}.md").read_text(encoding="utf-8")
        self.assertIn(f'title: "Page {page_num}"', page_md)
        self.assertIn("icon:\n", page_md)
        self.assertIn(f"tags:\n  - {tag}\n", page_md)
        self.assertIn(onboarding.format(section=section, page_num=page_num), page_md)
        self.assertIn("# Heading 1\n- \n## Heading 2\n- \n### Heading 3\n- \n", page_md)
        attachment_dir = root / "docs" / "assets" / "attachments" / section / f"page-{page_num}"
        self.assertTrue(attachment_dir.is_dir(), attachment_dir)
        self.assertTrue((attachment_dir / ".gitkeep").is_file(), attachment_dir / ".gitkeep")
      index_md = (root / "docs" / "index.md").read_text(encoding="utf-8")
      self.assertIn("icon: lucide/house", index_md)
      self.assertIn("knotis_content:\n  heading_numbering: false\n  heading_guides: false", index_md)
      self.assertFalse((root / "scripts" / "knotis.py").exists())
      self.assertFalse((root / "scripts" / "build_wikilinks.py").exists())
      workflow = (root / ".github" / "workflows" / "docs.yml").read_text(encoding="utf-8")
      self.assertIn("python -m pip install knotis", workflow)
      self.assertIn("knotis build", workflow)
      self.assertNotIn("pip install zensical", workflow)
      self.assertNotIn("zensical build --clean", workflow)
      self.assertTrue((root / "overrides" / "main.html").is_file())
      self.assertFalse((root / "overrides" / "no-heading-number.html").exists())
      self.assertFalse((root / "knotis").exists())
      self.assertFalse((root / "docs" / "markdown.md").exists())
      self.assertFalse((root / "assets").exists())
      theme_css = (root / "docs" / "stylesheets" / "knotis-theme.css").read_text(encoding="utf-8")
      self.assertIn("#1E1E2E", theme_css)

      config = tomllib.loads((root / "zensical.toml").read_text(encoding="utf-8"))
      self.assertEqual(config["project"]["site_name"], "My site name here")
      self.assertEqual(config["project"]["repo_url"], "https://github.com/example/example")
      self.assertEqual(config["project"]["theme"]["custom_dir"], "overrides")
      self.assertEqual(config["project"]["theme"]["primary"], "indigo")
      self.assertEqual(
        config["project"]["nav"],
        [
          {"Home": "index.md"},
          {
            "Section 1": [
              {"Page 1": "section-1/page-1.md"},
              {"Page 2": "section-1/page-2.md"},
              {"Page 3": "section-1/page-3.md"},
              {"Page 4": "section-1/page-4.md"},
              {"Page 5": "section-1/page-5.md"},
            ],
          },
          {
            "Section 2": [
              {"Page 6": "section-2/page-6.md"},
              {"Page 7": "section-2/page-7.md"},
              {"Page 8": "section-2/page-8.md"},
              {"Page 9": "section-2/page-9.md"},
              {"Page 10": "section-2/page-10.md"},
            ],
          },
          {
            "Explore": [
              {"Site graph": "explore/site-graph.md"},
              {"Glossary": "explore/glossary.md"},
              {"Content tags": "explore/content-tags.md"},
            ],
          },
        ],
      )
      knotis = config["project"]["extra"]["knotis"]
      self.assertTrue(knotis["search"]["enabled"])
      self.assertEqual(knotis["pane"]["width"], 750)
      self.assertTrue(knotis["pane"]["path"]["enabled"])
      self.assertEqual(knotis["site_graph"]["graph"]["exclude_paths"], [])
      self.assertEqual(knotis["page_graph"]["graph"]["exclude_paths"], [])
      self.assertEqual(knotis["concept_graph"]["graph"]["exclude_paths"], [])
      self.assertTrue(knotis["slides"]["enabled"])
      self.assertEqual(knotis["slides"]["fit_min_font_px"], 26)
      self.assertEqual(knotis["glossary"]["page_view_label"], "Pages")
      self.assertTrue(knotis["content_tags"]["enabled"])
      self.assertNotIn("path", knotis["content_tags"])
      self.assertNotIn("order", knotis["content_tags"])
      self.assertNotIn("colors", knotis["content_tags"])
      self.assertEqual(knotis["wikilinks"]["default"], "#0197a7")
      self.assertEqual(knotis["wikilinks"]["slate"], "#fda4af")
      self.assertNotIn("extra_css", config["project"])
      self.assertNotIn("extra_javascript", config["project"])

      text = (root / "zensical.toml").read_text(encoding="utf-8")
      self.assertIn('site_url = "http://localhost:8000/"', text)
      self.assertNotIn('"Graph"', text)
      self.assertIn('{ "Explore" = [', text)
      self.assertNotIn("plugins = [", text)
      self.assertNotIn("dev-reload.js", text)
      self.assertNotIn("knotis-preview-bridge.js", text)
      self.assertNotIn("assets/knotis-", text)
      self.assertNotIn("assets/vendor/", text)
      self.assertIn("# Zensical settings", text)
      self.assertIn("# Knotis settings", text)
      self.assertIn("## Graphs", text)
      self.assertIn("### Site graph", text)
      self.assertNotIn("[project.validation]", text)
      self.assertNotIn("knotis.markdown.knotis_slide_markers", text)
      self.assertNotIn("ssric-reg", text)
      self.assertNotIn("resources/how-to-use", text)
      self.assertNotIn('include_paths = ["modules"]', text)
      self.assertNotIn("[project.theme.icon.tag]", text)
      self.assertNotIn("[project.extra.tags]", text)

  def test_resolve_knotis_root_from_ssric_scripts(self) -> None:
    self.skipTest("legacy symlink root resolution is not used by packaged Knotis")


if __name__ == "__main__":
  raise SystemExit(unittest.main())
