#!/usr/bin/env python3
from __future__ import annotations

import io
import tempfile
import tomllib
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from knotis.build_site import KNOTIS_STAMPED_ASSETS
from knotis.builder.assets_mirror import (
    GENERATED_ASSET_FILES,
    KNOTIS_ASSET_FILES,
    RUNTIME_SCRIPTS,
    RUNTIME_SCRIPTS_AFTER_SITE,
    RUNTIME_STYLESHEETS,
    VENDOR_ASSET_FILES,
    runtime_asset_paths,
)
from knotis.builder.zensical_config import (
    migrate_template_asset_lists,
    resolve_zensical_config_path,
)

PACKAGE_DIR = Path(__file__).resolve().parents[1] / "src" / "knotis"
SCAFFOLD_MAIN = PACKAGE_DIR / "scaffold" / "overrides" / "main.html"

# overrides/main.html as scaffolded by Knotis 0.1.9 and earlier: a literal asset
# list that predates knotis-sticky-table-headers.js.
OLD_MAIN_HTML = """{#-
  Site-wide main layout: every page resolves Knotis content flags from
  zensical.toml plus optional knotis_content front matter.
-#}
{% extends "base.html" %}

{% block styles %}
{{ super() }}
{%- for path in [
  "assets/knotis/knotis-palette.css",
  "assets/knotis/knotis-content-tags.css",
  "assets/knotis/knotis-content.css",
  "assets/knotis/knotis-wikilinks.css",
  "assets/knotis/knotis-pane.css",
  "assets/knotis/knotis-graph.css",
  "assets/knotis/knotis-search.css",
  "assets/knotis/knotis-slides.css",
  "assets/knotis/knotis-readaloud.css",
  "assets/knotis/knotis-media.css",
  "stylesheets/knotis-theme.css",
] %}
<link rel="stylesheet" href="{{ path | url }}">
{%- endfor %}
{% endblock %}

{% block extrahead %}
{{ super() }}
{%- set site_content = config.extra.knotis.content if config.extra.knotis and config.extra.knotis.content else {} -%}
{%- set styled_section_groups = site_content.styled_section_groups | default(true) -%}
<script>
  document.documentElement.setAttribute("data-knotis-styled-section-groups", "{{ styled_section_groups | string | lower }}");
</script>
{% endblock %}

{% block container %}
  {% include "partials/knotis-content-container.html" %}
{% endblock %}

{% block scripts %}
{{ super() }}
{%- for path in [
  "assets/knotis/vendor/mermaid-10.9.6.min.js",
  "assets/knotis/knotis-core.js",
  "assets/knotis/knotis-media.js",
  "assets/knotis/knotis-icon-map.js",
  "assets/knotis/knotis-wikilinks.js",
  "assets/knotis/lunr.min.js",
  "assets/knotis/knotis-search.js",
  "assets/knotis/knotis-slides.js",
  "assets/knotis/knotis-graph.js",
  "assets/knotis/knotis-readaloud.js",
  "javascripts/mathjax.js",
  "javascripts/glossary.js",
  "assets/knotis/vendor/mathjax-3.2.2-tex-mml-chtml.js",
] %}
<script src="{{ path | url }}"></script>
{%- endfor %}
{% endblock %}
"""

SITE_TOML = """[project]
site_name = "Example"
site_url = "https://example.test/course/"
docs_dir = "docs"

[project.extra.knotis.content]
generator = true

[project.theme]
custom_dir = "overrides"

[[project.theme.palette]]
scheme = "default"
"""


def _write_site(root: Path, main_html: str | None, toml_text: str = SITE_TOML) -> Path:
    (root / "docs").mkdir(parents=True, exist_ok=True)
    (root / "docs" / "index.md").write_text("# Home\n", encoding="utf-8")
    (root / "zensical.toml").write_text(toml_text, encoding="utf-8")
    main = root / "overrides" / "main.html"
    if main_html is not None:
        main.parent.mkdir(parents=True, exist_ok=True)
        main.write_text(main_html, encoding="utf-8")
    return main


def _build_config(root: Path) -> dict:
    with resolve_zensical_config_path(root).open("rb") as handle:
        return tomllib.load(handle)


class RuntimeAssetRegistryTests(unittest.TestCase):
    def test_copy_and_stamp_lists_derive_from_the_registry(self) -> None:
        names = (*RUNTIME_STYLESHEETS, *RUNTIME_SCRIPTS, *RUNTIME_SCRIPTS_AFTER_SITE)
        self.assertEqual(len(names), len(set(names)))
        for name in names:
            with self.subTest(name=name):
                if name.startswith("vendor/"):
                    self.assertIn(name.removeprefix("vendor/"), VENDOR_ASSET_FILES)
                elif name in GENERATED_ASSET_FILES:
                    self.assertNotIn(name, KNOTIS_ASSET_FILES)
                else:
                    self.assertIn(name, KNOTIS_ASSET_FILES)
                    self.assertTrue((PACKAGE_DIR / "assets" / name).is_file())
        self.assertEqual(
            set(KNOTIS_STAMPED_ASSETS),
            {name for name in names if name.startswith("knotis-")} | {"knotis-theme.css"},
        )

    def test_scaffold_template_loads_assets_from_the_registry(self) -> None:
        text = SCAFFOLD_MAIN.read_text(encoding="utf-8")
        self.assertNotIn('"assets/knotis/', text)
        for group in ("stylesheets", "scripts", "scripts_after_site"):
            self.assertIn(f"knotis_assets.{group}", text)
        self.assertLess(text.index("knotis_assets.stylesheets"), text.index('"stylesheets/knotis-theme.css"'))
        self.assertLess(text.index("knotis_assets.scripts "), text.index('"javascripts/mathjax.js"'))
        self.assertLess(text.index('"javascripts/glossary.js"'), text.index("knotis_assets.scripts_after_site"))

    def test_older_scaffold_template_migrates_to_the_current_scaffold(self) -> None:
        migrated, replaced = migrate_template_asset_lists(OLD_MAIN_HTML)
        self.assertEqual(replaced, 2)
        self.assertEqual(migrated, SCAFFOLD_MAIN.read_text(encoding="utf-8"))
        again, replaced_again = migrate_template_asset_lists(migrated)
        self.assertEqual((again, replaced_again), (migrated, 0))

    def test_migration_keeps_user_entries_and_blocks_in_place(self) -> None:
        custom = (
            OLD_MAIN_HTML
            .replace('{%- for path in [\n  "assets/knotis/knotis-palette.css",',
                     '{%- for path in [\n  "stylesheets/fonts.css",\n  "assets/knotis/knotis-palette.css",')
            .replace('  "javascripts/glossary.js",\n', '  "javascripts/glossary.js",\n  "javascripts/course.js",\n')
            .replace('  "assets/knotis/vendor/mathjax-3.2.2-tex-mml-chtml.js",\n] %}',
                     '  "assets/knotis/vendor/mathjax-3.2.2-tex-mml-chtml.js",\n  "javascripts/after-math.js",\n] %}')
            + '\n{% block announce %}<p class="course-banner">Week 3</p>{% endblock %}\n'
        )
        migrated, replaced = migrate_template_asset_lists(custom)
        self.assertEqual(replaced, 2)
        self.assertNotIn('"assets/knotis/', migrated)
        self.assertIn('{% block announce %}<p class="course-banner">Week 3</p>{% endblock %}', migrated)
        self.assertIn("{% block extrahead %}", migrated)
        order = [
            '"stylesheets/fonts.css"',
            "knotis_assets.stylesheets",
            '"stylesheets/knotis-theme.css"',
            "knotis_assets.scripts ",
            '"javascripts/mathjax.js"',
            '"javascripts/course.js"',
            "knotis_assets.scripts_after_site",
            '"javascripts/after-math.js"',
        ]
        positions = [migrated.index(token) for token in order]
        self.assertEqual(positions, sorted(positions))

    def test_lists_without_package_assets_or_with_expressions_are_left_alone(self) -> None:
        own_list = '{%- for path in [\n  "javascripts/a.js",\n] %}\n<script src="{{ path | url }}"></script>\n{%- endfor %}\n'
        self.assertEqual(migrate_template_asset_lists(own_list), (own_list, 0))
        dynamic = (
            '{%- for path in [\n  "assets/knotis/knotis-core.js",\n  config.extra.my_script,\n] %}\n'
            '<script src="{{ path | url }}"></script>\n{%- endfor %}\n'
        )
        self.assertEqual(migrate_template_asset_lists(dynamic), (dynamic, 0))


class BuildConfigRuntimeAssetTests(unittest.TestCase):
    def test_build_config_carries_registry_paths_for_templates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_site(root, SCAFFOLD_MAIN.read_text(encoding="utf-8"))
            config = _build_config(root)
            assets = config["project"]["extra"]["knotis_runtime_assets"]
            self.assertEqual(assets["stylesheets"], runtime_asset_paths(RUNTIME_STYLESHEETS))
            self.assertEqual(assets["scripts"], runtime_asset_paths(RUNTIME_SCRIPTS))
            self.assertEqual(assets["scripts_after_site"], runtime_asset_paths(RUNTIME_SCRIPTS_AFTER_SITE))
            self.assertIn("assets/knotis/knotis-sticky-table-headers.js", assets["scripts"])
            self.assertEqual(config["project"]["site_url"], "https://example.test/course/")
            self.assertEqual(config["project"]["theme"]["palette"], [{"scheme": "default"}])
            self.assertTrue(config["project"]["extra"]["knotis"]["content"]["generator"] is False)

    def test_older_site_template_is_migrated_once_and_builds_are_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = _write_site(root, OLD_MAIN_HTML)
            source_toml = (root / "zensical.toml").read_text(encoding="utf-8")
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                first = resolve_zensical_config_path(root)
            self.assertIn("overrides/main.html", stderr.getvalue())
            self.assertEqual(main.read_text(encoding="utf-8"), SCAFFOLD_MAIN.read_text(encoding="utf-8"))
            build_text = first.read_text(encoding="utf-8")
            main_mtime = main.stat().st_mtime_ns
            build_mtime = first.stat().st_mtime_ns

            stderr = io.StringIO()
            with redirect_stderr(stderr):
                second = resolve_zensical_config_path(root)
            self.assertEqual(stderr.getvalue(), "")
            self.assertEqual(second.read_text(encoding="utf-8"), build_text)
            self.assertEqual(main.stat().st_mtime_ns, main_mtime)
            self.assertEqual(second.stat().st_mtime_ns, build_mtime)
            self.assertEqual(build_text.count("[project.extra.knotis_runtime_assets]"), 1)
            self.assertEqual((root / "zensical.toml").read_text(encoding="utf-8"), source_toml)

    def test_custom_template_that_cannot_be_migrated_gets_a_diagnostic(self) -> None:
        custom = (
            '{% extends "base.html" %}\n{% block scripts %}\n{{ super() }}\n'
            '<script src="{{ \'assets/knotis/knotis-core.js\' | url }}"></script>\n{% endblock %}\n'
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            main = _write_site(root, custom)
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                resolve_zensical_config_path(root)
            warning = stderr.getvalue()
            self.assertIn("overrides/main.html", warning)
            self.assertIn("assets/knotis/knotis-sticky-table-headers.js", warning)
            self.assertNotIn("assets/knotis/knotis-core.js,", warning)
            self.assertIn("knotis_runtime_assets", warning)
            self.assertEqual(main.read_text(encoding="utf-8"), custom)

    def test_legacy_extra_asset_lists_are_reconciled_in_the_build_config_only(self) -> None:
        toml_text = SITE_TOML.replace(
            'docs_dir = "docs"\n',
            'docs_dir = "docs"\n'
            'extra_css = [\n  "assets/knotis-palette.css",\n  "assets/knotis-content.css",\n'
            '  "assets/knotis-hashtag.css",\n  "assets/knotis-theme.css",\n  "stylesheets/course.css",\n]\n'
            'extra_javascript = [\n  "assets/knotis-core.js",\n  "assets/knotis-wikilinks.js",\n'
            '  "assets/dev-reload.js",\n  "javascripts/glossary.js",\n  "assets/vendor/mermaid-10.9.6.min.js",\n]\n',
        )
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_site(root, '{% extends "base.html" %}\n', toml_text)
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                project = _build_config(root)["project"]
            self.assertNotIn("WARNING", stderr.getvalue())
            legacy_css = [f"assets/{name}" for name in RUNTIME_STYLESHEETS]
            self.assertEqual(project["extra_css"], [*legacy_css, "assets/knotis-theme.css", "stylesheets/course.css"])
            legacy_js = [f"assets/{name}" for name in RUNTIME_SCRIPTS if not name.startswith("vendor/")]
            self.assertEqual(
                project["extra_javascript"],
                [*legacy_js, "assets/dev-reload.js", "javascripts/glossary.js", "assets/vendor/mermaid-10.9.6.min.js"],
            )
            self.assertIn("assets/knotis-hashtag.css", (root / "zensical.toml").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
