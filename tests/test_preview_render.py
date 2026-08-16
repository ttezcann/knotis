#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).resolve()
KNOTIS_ROOT = MODULE_PATH.parents[1]
SITE_ROOT = MODULE_PATH.parents[2]
SCRIPTS_DIR = SITE_ROOT / "scripts"


class PreviewRenderTests(unittest.TestCase):
    def _run_preview_helper(self, helper: str) -> subprocess.CompletedProcess[str]:
        env = os.environ.copy()
        root_path = str(SITE_ROOT)
        existing = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = root_path if not existing else f"{root_path}{os.pathsep}{existing}"
        script = (
            "import sys\n"
            f"sys.path.insert(0, {str(SCRIPTS_DIR)!r})\n"
            + textwrap.dedent(helper)
        )
        return subprocess.run(
            [sys.executable, "-c", script],
            capture_output=True,
            text=True,
            env=env,
            cwd=str(SITE_ROOT),
            check=False,
        )

    def test_docs_rel_mapping(self) -> None:
        result = self._run_preview_helper(
            """
from preview_render import docs_rel_to_page_url, docs_rel_to_site_html
from pathlib import Path

assert docs_rel_to_page_url("index.md") == ""
assert docs_rel_to_page_url("glossary.md") == "glossary/"
assert docs_rel_to_page_url("modules/01.-introduction-to-rstudio.md") == "modules/01.-introduction-to-rstudio/"
site = docs_rel_to_site_html(Path("site"), "modules/01.-introduction-to-rstudio.md")
assert site is not None
print("ok")
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_preview_asset_base_url(self) -> None:
        result = self._run_preview_helper(
            """
from preview_render import preview_asset_base_url
from pathlib import Path

assert preview_asset_base_url(Path("."), "modules/03.-descriptive-statistics.md") == (
    "http://127.0.0.1:8000/modules/03.-descriptive-statistics/"
)
assert preview_asset_base_url(Path("."), "glossary.md") == (
    "http://127.0.0.1:8000/glossary/"
)
print("ok")
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_build_preview_page_html_injects_dev_server_base_href(self) -> None:
        if not (SITE_ROOT / "site" / "glossary" / "index.html").is_file():
            self.skipTest("Built site output is unavailable")
        result = self._run_preview_helper(
            """
from preview_render import build_preview_page_html
from pathlib import Path

html = build_preview_page_html(
    Path("."),
    "modules/03.-descriptive-statistics.md",
    "# Live Preview Test\\n\\nUnsaved body.",
)
assert '<base href="http://127.0.0.1:8000/modules/03.-descriptive-statistics/">' in html
print("ok")
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_glossary_preview_html_marks_live_preview(self) -> None:
        if not (SITE_ROOT / "site" / "glossary" / "index.html").is_file():
            self.skipTest("Built site output is unavailable")
        result = self._run_preview_helper(
            """
from preview_render import build_preview_page_html
from pathlib import Path

html = build_preview_page_html(
    Path("."),
    "glossary.md",
    "# Live Preview Test\\n\\nUnsaved body.",
)
assert "Live Preview Test" in html
assert 'data-knotis-live-preview="true"' in html
assert "dev-reload.js" not in html
print("ok")
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)

    def test_module_01_render_contains_gss_heading(self) -> None:
        module_path = SITE_ROOT / "docs" / "modules" / "01.-introduction-to-rstudio.md"
        if not module_path.is_file():
            self.skipTest("Module 01 source is unavailable")
        result = self._run_preview_helper(
            """
from preview_render import render_markdown_content
from pathlib import Path

markdown = Path("docs/modules/01.-introduction-to-rstudio.md").read_text(encoding="utf-8")
html = render_markdown_content(Path("."), "modules/01.-introduction-to-rstudio.md", markdown)
assert 'id="data-general-social-survey-gss"' in html
print("ok")
"""
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)


if __name__ == "__main__":
    unittest.main()
