#!/usr/bin/env python3
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from knotis.builder.generate_icon_map import (
    build_icon_map,
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

    def test_icon_map_is_generated_not_static_mirrored(self) -> None:
        self.assertNotIn("knotis-icon-map.js", KNOTIS_ASSET_FILES)


if __name__ == "__main__":
    unittest.main()
