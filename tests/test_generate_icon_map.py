#!/usr/bin/env python3
from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from knotis.builder.generate_icon_map import (
    build_icon_map,
    custom_icon_dirs_from_config,
    render_icon_map_js,
    resolve_icon_svg,
    scan_icon_tokens_from_text,
    strip_fenced_code_blocks,
    write_icon_map,
    zensical_icons_dir,
)
from knotis.builder.assets_mirror import KNOTIS_ASSET_FILES


class GenerateIconMapTests(unittest.TestCase):
    def test_strip_fenced_code_blocks_removes_icon_shortcodes_in_code(self) -> None:
        text = "- normal :lucide-search:\n```md\n:lucide-hidden:\n```\n"
        self.assertEqual(strip_fenced_code_blocks(text), "- normal :lucide-search:\n\n")

    def test_scan_icon_tokens_from_text(self) -> None:
        text = "- :simple-youtube: and :fontawesome-brands-apple: plus :lucide-list-tree:"
        self.assertEqual(
            scan_icon_tokens_from_text(text),
            {"simple-youtube", "fontawesome-brands-apple", "lucide-list-tree"},
        )

    def test_resolve_icon_svg_for_all_families(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        cases = {
            "lucide-search": icons_root / "lucide" / "search.svg",
            "simple-youtube": icons_root / "simple" / "youtube.svg",
            "simple-googledrive": icons_root / "simple" / "googledrive.svg",
            "fontawesome-brands-apple": icons_root / "fontawesome" / "brands" / "apple.svg",
            "material-apple": icons_root / "material" / "apple.svg",
            "fontawesome-solid-computer-mouse": icons_root / "fontawesome" / "solid" / "computer-mouse.svg",
        }
        for token, expected in cases.items():
            with self.subTest(token=token):
                self.assertEqual(resolve_icon_svg(token, icons_root), expected)

    def test_build_icon_map_generates_entries_for_used_tokens(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        icon_map = build_icon_map({"simple-youtube", "lucide-search"}, icons_root)
        self.assertIn("simple-youtube", icon_map)
        self.assertIn("lucide-search", icon_map)
        self.assertIn("<svg", icon_map["simple-youtube"]["svg"])
        self.assertIn("youtube", icon_map["simple-youtube"]["label"])

    def test_write_icon_map_outputs_js(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            out_dir = Path(tmp)
            md = out_dir / "sample.md"
            md.write_text("- :simple-youtube: demo\n", encoding="utf-8")
            icon_map = write_icon_map([md], out_dir)
            js_path = out_dir / "knotis-icon-map.js"
            self.assertTrue(js_path.is_file())
            self.assertIn("simple-youtube", icon_map)
            js = js_path.read_text(encoding="utf-8")
            self.assertIn("window.KNOTIS_ICON_MAP", js)
            parsed = json.loads(js.split("=", 1)[1].strip().rstrip(";"))
            self.assertIn("simple-youtube", parsed)

    def test_write_icon_map_outputs_js_to_each_target_dir(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            md = tmp_dir / "sample.md"
            first = tmp_dir / "assets"
            second = tmp_dir / "docs" / "assets"
            third = tmp_dir / "site" / "assets"
            md.write_text("- :simple-youtube: demo\n", encoding="utf-8")
            write_icon_map([md], first, second, third)
            for out_dir in (first, second, third):
                with self.subTest(out_dir=out_dir):
                    js = (out_dir / "knotis-icon-map.js").read_text(encoding="utf-8")
                    self.assertIn("simple-youtube", js)

    def test_scan_icon_tokens_keeps_inline_and_fenced_code_examples_out(self) -> None:
        text = (
            "- Use :octicons-vscode-24: and :knotis-mark: here.\n"
            "- Write `:knotis-mark:` or `:lucide-search:` to show the syntax.\n"
            "    - ```md\n"
            "      :octicons-file-24:\n"
            "      ```\n"
        )
        self.assertEqual(scan_icon_tokens_from_text(text), {"octicons-vscode-24", "knotis-mark"})

    def test_resolve_octicons_like_zensical(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        self.assertEqual(
            resolve_icon_svg("octicons-vscode-24", icons_root),
            icons_root / "octicons" / "vscode-24.svg",
        )
        icon_map = build_icon_map({"octicons-vscode-24"}, icons_root)
        entry = icon_map["octicons-vscode-24"]
        self.assertIn('viewBox="0 0 24 24"', entry["svg"])
        self.assertIn('fill="currentColor"', entry["svg"])
        self.assertIn('aria-hidden="true"', entry["svg"])
        self.assertEqual(entry["label"], "vscode 24")

    def test_existing_families_keep_their_entries(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        icon_map = build_icon_map({"lucide-search", "fontawesome-brands-github"}, icons_root)
        self.assertIn('class="lucide lucide-search"', icon_map["lucide-search"]["svg"])
        self.assertIn('stroke-width="2"', icon_map["lucide-search"]["svg"])
        self.assertIn('fill="currentColor"', icon_map["fontawesome-brands-github"]["svg"])
        self.assertEqual(icon_map["fontawesome-brands-github"]["label"], "brands github")

    def test_custom_icon_dirs_from_config_resolve_against_site_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            site = Path(tmp)
            absolute = site / "elsewhere" / "icons"
            nested = {"project": {"markdown_extensions": {"pymdownx": {"emoji": {
                "options": {"custom_icons": ["overrides/.icons", str(absolute)]},
            }}}}}
            self.assertEqual(
                custom_icon_dirs_from_config(nested, site),
                [site / "overrides" / ".icons", absolute],
            )
            quoted = {"project": {"markdown_extensions": {"pymdownx.emoji": {
                "options": {"custom_icons": ["./theme/icons/"]},
            }}}}
            self.assertEqual(custom_icon_dirs_from_config(quoted, site), [site / "theme" / "icons"])
            self.assertEqual(custom_icon_dirs_from_config({}, site), [])
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                bad = {"project": {"markdown_extensions": {"pymdownx": {"emoji": {"options": {"custom_icons": "icons"}}}}}}
                self.assertEqual(custom_icon_dirs_from_config(bad, site), [])
            self.assertIn("custom_icons", stderr.getvalue())

    def _write_svg(self, path: Path, body: str = '<path d="M0 0h24v24H0z"/>', root: str = 'viewBox="0 0 24 24"') -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" {root}>{body}</svg>', encoding="utf-8")
        return path

    def test_custom_icons_use_zensical_names_and_precedence(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            first = Path(tmp) / "first"
            second = Path(tmp) / "second"
            mark = self._write_svg(first / "knotis-mark.svg")
            nested = self._write_svg(first / "brand" / "logo.svg")
            override = self._write_svg(first / "lucide" / "search.svg", '<path d="M1 1h2"/>')
            self._write_svg(second / "knotis-mark.svg", '<path d="M9 9h1"/>')
            second_only = self._write_svg(second / "only-second.svg")
            self._write_svg(first / "smile.svg")
            dirs = [first, second]
            self.assertEqual(resolve_icon_svg("knotis-mark", icons_root, dirs), mark)
            self.assertEqual(resolve_icon_svg("brand-logo", icons_root, dirs), nested)
            self.assertEqual(resolve_icon_svg("lucide-search", icons_root, dirs), override)
            self.assertEqual(resolve_icon_svg("only-second", icons_root, dirs), second_only)
            # Twemoji names win over icons in Zensical, so :smile: stays an emoji.
            self.assertIsNone(resolve_icon_svg("smile", icons_root, dirs))
            icon_map = build_icon_map({"knotis-mark", "lucide-search", "smile"}, icons_root, dirs)
            self.assertEqual(set(icon_map), {"knotis-mark", "lucide-search"})
            self.assertIn('d="M0 0h24v24H0z"', icon_map["knotis-mark"]["svg"])
            self.assertIn('d="M1 1h2"', icon_map["lucide-search"]["svg"])

    def test_custom_icon_entry_preserves_root_presentation_and_label(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            icons = Path(tmp) / "icons"
            self._write_svg(
                icons / "knotis-mark.svg",
                '<g transform="translate(-4,1)" stroke="currentColor"><circle cx="28" cy="49" r="11" stroke-width="6"/></g>',
                'viewBox="0 0 100 100" fill="none" role="img" aria-label="Knotis" width="100"',
            )
            self._write_svg(icons / "plain-logo.svg")
            icon_map = build_icon_map({"knotis-mark", "plain-logo"}, icons_root, [icons])
            svg = icon_map["knotis-mark"]["svg"]
            self.assertIn('viewBox="0 0 100 100"', svg)
            self.assertIn('fill="none"', svg)
            self.assertIn('<g transform="translate(-4,1)" stroke="currentColor">', svg)
            self.assertIn('aria-hidden="true"', svg)
            self.assertNotIn('class="lucide', svg)
            self.assertNotIn('stroke-width="2"', svg)
            self.assertNotIn('width="100"', svg)
            self.assertNotIn('role="img"', svg)
            self.assertEqual(icon_map["knotis-mark"]["label"], "Knotis")
            self.assertIn('fill="currentColor"', icon_map["plain-logo"]["svg"])
            self.assertEqual(icon_map["plain-logo"]["label"], "plain logo")

    def test_missing_icons_and_directories_warn_without_fallbacks(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            missing_dir = Path(tmp) / "no-such-icons"
            stderr = io.StringIO()
            with redirect_stderr(stderr):
                icon_map = build_icon_map(
                    {"octicons-not-a-real-icon-24", "octicons-vscode-24", "30", "not-an-icon"},
                    icons_root,
                    [missing_dir],
                )
            self.assertEqual(set(icon_map), {"octicons-vscode-24"})
            warnings = stderr.getvalue()
            self.assertIn(":octicons-not-a-real-icon-24:", warnings)
            self.assertIn(str(missing_dir), warnings)
            self.assertNotIn(":30:", warnings)
            self.assertNotIn(":not-an-icon:", warnings)

    def test_write_icon_map_includes_configured_custom_icons(self) -> None:
        icons_root = zensical_icons_dir()
        if icons_root is None:
            self.skipTest("Zensical is not installed")
        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            icons = tmp_dir / "overrides" / ".icons"
            self._write_svg(icons / "knotis-mark.svg")
            md = tmp_dir / "sample.md"
            md.write_text("- :octicons-vscode-24: VS Code\n- :knotis-mark: extension\n", encoding="utf-8")
            out_dir = tmp_dir / "out"
            icon_map = write_icon_map([md], out_dir, custom_icon_dirs=[icons])
            self.assertEqual(set(icon_map), {"octicons-vscode-24", "knotis-mark"})
            js = (out_dir / "knotis-icon-map.js").read_text(encoding="utf-8")
            parsed = json.loads(js.split("=", 1)[1].strip().rstrip(";"))
            self.assertEqual(set(parsed), {"octicons-vscode-24", "knotis-mark"})

    def test_icon_map_is_generated_not_static_mirrored(self) -> None:
        self.assertNotIn("knotis-icon-map.js", KNOTIS_ASSET_FILES)


if __name__ == "__main__":
    unittest.main()
