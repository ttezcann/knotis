#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from knotis.builder import content_tag_colors as MODULE


class ContentTagColorsTests(unittest.TestCase):
    def test_discovered_tags_use_automatic_palette(self) -> None:
        resolved = MODULE.resolve_content_tag_colors(
            order="alphabetical",
            discovered_tags=["#code", "#output", "#notes"],
            first_seen_tags=["#notes", "#code", "#output"],
        )
        self.assertEqual(resolved["default"]["code"]["text"], "var(--content-tag-1)")
        self.assertEqual(resolved["default"]["notes"]["text"], "var(--content-tag-2)")
        self.assertEqual(resolved["default"]["output"]["text"], "var(--content-tag-3)")
        self.assertEqual(resolved["slate"]["code"]["text"], "var(--content-tag-1)")

    def test_auto_assign_cycles_five_theme_tokens(self) -> None:
        resolved = MODULE.resolve_content_tag_colors(
            order="alphabetical",
            discovered_tags=["#alpha", "#beta", "#gamma", "#delta", "#epsilon", "#zeta"],
            first_seen_tags=[],
        )
        self.assertEqual(resolved["default"]["alpha"]["text"], "var(--content-tag-1)")
        self.assertEqual(resolved["default"]["gamma"]["text"], "var(--content-tag-5)")
        self.assertEqual(resolved["default"]["zeta"]["text"], "var(--content-tag-1)")

    def test_configured_order_keeps_unlisted_tags_after_listed_tags(self) -> None:
        resolved = MODULE.resolve_content_tag_colors(
            order="alphabetical",
            discovered_tags=["#beta", "#alpha", "#code", "#output"],
            configured_order=["#output", "#code"],
        )
        self.assertEqual(list(resolved["default"]), ["output", "code", "alpha", "beta"])

    def test_configured_colors_expand_for_each_scheme(self) -> None:
        resolved = MODULE.resolve_content_tag_colors(
            order="alphabetical",
            discovered_tags=["#code", "#custom"],
            configured_colors={
                "default": {"code": "#111111", "custom": "#222222"},
                "slate": {"code": "#aaaaaa"},
            },
        )
        self.assertEqual(resolved["default"]["code"]["text"], "#111111")
        self.assertEqual(resolved["default"]["code"]["background"], "color-mix(in srgb, #111111 18%, transparent)")
        self.assertEqual(resolved["default"]["code"]["hover_background"], "color-mix(in srgb, #111111 28%, transparent)")
        self.assertEqual(resolved["default"]["code"]["mark_background"], "color-mix(in srgb, #111111 28%, transparent)")
        self.assertEqual(resolved["slate"]["code"]["text"], "#aaaaaa")
        self.assertEqual(resolved["slate"]["custom"]["text"], "var(--content-tag-1)")

    def test_bare_hex_is_normalized(self) -> None:
        self.assertEqual(MODULE.normalize_content_tag_base_color("b45309"), "#b45309")


if __name__ == "__main__":
    unittest.main()
