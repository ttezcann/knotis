#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
import tempfile
import tomllib
import unittest
import zipfile
from pathlib import Path

KNOTIS_ROOT = Path(__file__).resolve().parents[1]


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


if __name__ == "__main__":
    unittest.main()
