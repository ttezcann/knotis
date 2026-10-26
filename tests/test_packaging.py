#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import tomllib
import unittest
import zipfile
from pathlib import Path

KNOTIS_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(KNOTIS_ROOT / "src"))

from knotis.builder.assets_mirror import (  # noqa: E402
    RUNTIME_SCRIPTS,
    RUNTIME_SCRIPTS_AFTER_SITE,
    RUNTIME_STYLESHEETS,
    runtime_asset_paths,
)


class PackagingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.tmp = tempfile.TemporaryDirectory()
        cls.tmp_path = Path(cls.tmp.name)
        cls.wheelhouse = cls.tmp_path / "wheelhouse"
        cls.wheelhouse.mkdir()
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pip",
                "wheel",
                "--no-deps",
                "--wheel-dir",
                str(cls.wheelhouse),
                str(KNOTIS_ROOT),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise AssertionError(f"Wheel build failed:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}")
        wheels = sorted(cls.wheelhouse.glob("knotis-*.whl"))
        if not wheels:
            raise AssertionError(f"No Knotis wheel found in {cls.wheelhouse}")
        cls.wheel = wheels[0]

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmp.cleanup()

    def test_wheel_contains_required_package_data(self) -> None:
        with zipfile.ZipFile(self.wheel) as wheel:
            names = set(wheel.namelist())
        required = {
            "knotis/assets/knotis-content.css",
            "knotis/assets/knotis-content-tags.css",
            "knotis/assets/knotis-wikilinks.js",
            "knotis/assets/knotis-sticky-table-headers.js",
            "knotis/assets/lunr.min.js",
            "knotis/assets/lunr.LICENSE",
            "knotis/assets/vendor/gifuct-js.min.js",
            "knotis/assets/vendor/mathjax-3.2.2-tex-mml-chtml.js",
            "knotis/assets/vendor/mathjax-3.2.2.LICENSE",
            "knotis/assets/vendor/mermaid-10.9.6.min.js",
            "knotis/assets/vendor/mermaid-10.9.6.LICENSE",
            "knotis/scaffold/.github/workflows/docs.yml",
            "knotis/scaffold/zensical.toml",
            "knotis/scaffold/docs/index.md",
            "knotis/scaffold/docs/javascripts/glossary.js",
            "knotis/scaffold/docs/javascripts/mathjax.js",
            "knotis/scaffold/overrides/main.html",
            "knotis/scaffold/overrides/partials/knotis-content-container.html",
            "knotis/builder/build_wikilinks.py",
            "knotis/markdown/knotis_slide_markers.py",
        }
        self.assertFalse(required - names)

    def _make_venv(self) -> tuple[Path, Path]:
        venv_dir = self.tmp_path / f"venv-{len(list(self.tmp_path.glob('venv-*')))}"
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
        python = venv_dir / "bin" / "python"
        knotis = venv_dir / "bin" / "knotis"
        subprocess.run([str(python), "-m", "pip", "install", "-U", "pip"], check=True, stdout=subprocess.DEVNULL)
        subprocess.run([str(python), "-m", "pip", "install", str(self.wheel)], check=True)
        return python, knotis

    def test_installed_wheel_exposes_cli_help(self) -> None:
        python, knotis = self._make_venv()
        for command in ([str(knotis), "--help"], [str(python), "-m", "knotis", "--help"]):
            result = subprocess.run(command, capture_output=True, text=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
            self.assertIn("Knotis site build", result.stdout)

    def test_installed_wheel_scaffolds_and_builds_clean_site(self) -> None:
        _python, knotis = self._make_venv()
        site_root = self.tmp_path / "demo-site"
        result = subprocess.run(
            [str(knotis), "new", str(site_root), "--no-build"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertFalse((site_root / "knotis").exists())
        self.assertFalse((site_root / "assets").exists())
        self.assertTrue((site_root / "docs" / "assets").is_dir())
        self.assertTrue((site_root / "docs" / "stylesheets" / "knotis-theme.css").is_file())
        self.assertFalse((site_root / "docs" / "assets" / "attachments").exists())
        self.assertFalse((site_root / "scripts" / "build_wikilinks.py").exists())
        workflow = (site_root / ".github" / "workflows" / "docs.yml").read_text(encoding="utf-8")
        self.assertIn("python -m pip install knotis", workflow)
        self.assertIn("knotis build", workflow)
        self.assertNotIn("pip install zensical", workflow)
        self.assertNotIn("zensical build --clean", workflow)
        config = (site_root / "zensical.toml").read_text(encoding="utf-8")
        self.assertNotIn("knotis.markdown.knotis_slide_markers", config)

        result = subprocess.run(
            [str(knotis), "build"],
            cwd=site_root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertTrue((site_root / "site" / "index.html").is_file())
        self.assertFalse((site_root / "assets").exists())
        self.assertFalse((site_root / "docs" / "assets" / "wikilinks.json").exists())
        self.assertFalse((site_root / "docs" / "assets" / "knotis-core.js").exists())
        self.assertFalse((site_root / "docs" / "assets" / "vendor").exists())
        self.assertTrue((site_root / "site" / "assets" / "knotis" / "wikilinks.json").is_file())
        self.assertTrue((site_root / "site" / "assets" / "knotis" / "knotis-search.json").is_file())
        self.assertTrue((site_root / "site" / "assets" / "knotis" / "knotis-core.js").is_file())
        self.assertTrue((site_root / "site" / "assets" / "knotis" / "knotis-search.js").is_file())
        self.assertTrue(
            (site_root / "site" / "assets" / "knotis" / "vendor" / "mermaid-10.9.6.min.js").is_file()
        )
        self.assertFalse((site_root / "site" / "search.json").exists())
        workers_dir = site_root / "site" / "assets" / "javascripts" / "workers"
        self.assertFalse(any(workers_dir.glob("search*.js")) if workers_dir.is_dir() else False)
        self.assertFalse((site_root / "site" / "assets" / "wikilinks.json").exists())
        self.assertFalse((site_root / "site" / "assets" / "knotis-core.js").exists())
        self.assertTrue((site_root / ".knotis" / "assets" / "wikilinks.json").is_file())
        self.assertFalse((site_root / "knotis_slide_markers.py").exists())
        config_data = tomllib.loads((site_root / "zensical.toml").read_text(encoding="utf-8"))
        self.assertNotIn("extra_css", config_data["project"])
        self.assertNotIn("extra_javascript", config_data["project"])
        self.assertTrue((site_root / "docs" / "assets").is_dir())
        self.assertFalse((site_root / "docs" / "assets" / "attachments").exists())
        html = (site_root / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn("assets/knotis/knotis-core.js", html)
        self.assertIn("assets/knotis/knotis-search.css", html)
        self.assertIn("stylesheets/knotis-theme.css", html)
        self.assertIn("assets/knotis/knotis-sticky-table-headers.js", html)
        # The scaffold template loads exactly the package registry, in order, once each.
        loaded = re.findall(r'(?:href|src)="(?:\./)?(assets/knotis/[^"?]+)(?:\?v=[0-9a-f]+)?"', html)
        expected = [
            *runtime_asset_paths(RUNTIME_STYLESHEETS),
            *runtime_asset_paths(RUNTIME_SCRIPTS),
            *runtime_asset_paths(RUNTIME_SCRIPTS_AFTER_SITE),
        ]
        self.assertEqual([path for path in loaded if path in expected], expected)
        self.assertLess(html.index("knotis-media.css"), html.index("stylesheets/knotis-theme.css"))
        self.assertLess(html.index("javascripts/mathjax.js"), html.index("vendor/mathjax-3.2.2-tex-mml-chtml.js"))
        self.assertRegex(html, r'knotis-sticky-table-headers\.js\?v=[0-9a-f]{12}"')
        self.assertTrue((site_root / "site" / "assets" / "knotis" / "knotis-sticky-table-headers.js").is_file())
        self.assertFalse(config_data["project"]["extra"]["knotis"]["table"]["sticky_headers"]["enabled"])
        self.assertEqual(config_data["project"]["extra"]["knotis"]["pane"]["graph_path_size"], 3)
        graph = json.loads((site_root / "site" / "assets" / "knotis" / "graph.json").read_text(encoding="utf-8"))
        self.assertEqual(graph["meta"]["knotis"]["defaults"]["pane"]["graph_path_size"], 3)
        pane_css = (site_root / "site" / "assets" / "knotis" / "knotis-pane.css").read_text(encoding="utf-8")
        self.assertIn('[data-graph-path-size="1"]', pane_css)

        # Enabling sticky headers and changing the graph/Path size need only the
        # scaffolded settings, no asset paths.
        config_path = site_root / "zensical.toml"
        scaffolded = config_path.read_text(encoding="utf-8")
        section = "[project.extra.knotis.table.sticky_headers]\nenabled = false\n"
        self.assertIn(section, scaffolded)
        self.assertIn("graph_path_size = 3\n", scaffolded)
        config_path.write_text(
            scaffolded.replace(section, "[project.extra.knotis.table.sticky_headers]\nenabled = true\n")
            .replace("graph_path_size = 3\n", "graph_path_size = 1\n"),
            encoding="utf-8",
        )
        result = subprocess.run(
            [str(knotis), "build"],
            cwd=site_root,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        graph = json.loads((site_root / "site" / "assets" / "knotis" / "graph.json").read_text(encoding="utf-8"))
        sticky = graph["meta"]["knotis"]["table"]["sticky_headers"]
        self.assertTrue(sticky["enabled"])
        self.assertTrue(sticky["include_all"])
        self.assertEqual(graph["meta"]["knotis"]["defaults"]["pane"]["graph_path_size"], 1)


if __name__ == "__main__":
    unittest.main()
