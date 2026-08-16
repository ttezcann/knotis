#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from knotis.builder import frontmatter  # noqa: E402


class YamlScalarTests(unittest.TestCase):
    def test_strips_quotes_and_whitespace(self) -> None:
        self.assertEqual(frontmatter._yaml_scalar('  "hello"  '), "hello")
        self.assertEqual(frontmatter._yaml_scalar("'world'"), "world")
        self.assertEqual(frontmatter._yaml_scalar("plain"), "plain")

    def test_parse_scalar_bools_null_ints(self) -> None:
        self.assertIs(frontmatter._parse_yaml_scalar_value("true"), True)
        self.assertIs(frontmatter._parse_yaml_scalar_value("False"), False)
        self.assertIsNone(frontmatter._parse_yaml_scalar_value("null"))
        self.assertIsNone(frontmatter._parse_yaml_scalar_value("~"))
        self.assertEqual(frontmatter._parse_yaml_scalar_value("-42"), -42)
        self.assertEqual(frontmatter._parse_yaml_scalar_value("42px"), "42px")
        self.assertEqual(frontmatter._parse_yaml_scalar_value(""), "")

    def test_parse_scalar_inline_list(self) -> None:
        self.assertEqual(
            frontmatter._parse_yaml_scalar_value('[a, "b, c", 3]'),
            ["a", "b, c", 3],
        )
        self.assertEqual(frontmatter._parse_yaml_scalar_value("[]"), [])
        self.assertEqual(
            frontmatter._parse_yaml_scalar_value("[[1, 2], [3]]"),
            [[1, 2], [3]],
        )

    def test_comment_stripping_respects_quotes(self) -> None:
        self.assertEqual(frontmatter._strip_yaml_comment("value # comment"), "value")
        self.assertEqual(frontmatter._strip_yaml_comment('"a # b" # c'), '"a # b"')
        self.assertEqual(frontmatter._strip_yaml_comment("#lead"), "")
        self.assertEqual(frontmatter._strip_yaml_comment("a#b"), "a#b")


class YamlBlockTests(unittest.TestCase):
    def test_map_block_nested(self) -> None:
        lines = [
            "search:",
            "  enabled: true",
            "  weights:",
            "    title: 10",
            "    body: 1",
            "pane:",
            "  width: 640",
        ]
        data, end = frontmatter._parse_yaml_map_block(lines, 0, 0)
        self.assertEqual(end, len(lines))
        self.assertEqual(
            data,
            {
                "search": {"enabled": True, "weights": {"title": 10, "body": 1}},
                "pane": {"width": 640},
            },
        )

    def test_scalar_list_items_only(self) -> None:
        # Mini-parser limitation (documented): list items are scalars;
        # `- key: value` items stay as scalar text rather than maps.
        lines = [
            "items:",
            "  - one",
            "  - two",
            "colors:",
            "  - name: red",
        ]
        data, _end = frontmatter._parse_yaml_map_block(lines, 0, 0)
        self.assertEqual(data["items"], ["one", "two"])
        self.assertEqual(data["colors"], ["name: red"])

    def test_map_block_empty_value_becomes_empty_dict(self) -> None:
        lines = ["a:", "b: 1"]
        data, _end = frontmatter._parse_yaml_map_block(lines, 0, 0)
        self.assertEqual(data, {"a": {}, "b": 1})


class KnotisBlockExtractionTests(unittest.TestCase):
    def test_extracts_knotis_block_under_extra(self) -> None:
        lines = [
            "title: Page",
            "extra:",
            "  knotis:",
            "    search:",
            "      enabled: false",
            "tags:",
            "  - a",
        ]
        block, indent = frontmatter._extract_knotis_block(lines)
        self.assertEqual(indent, 4)
        self.assertEqual(block, ["    search:", "      enabled: false"])
        data, _end = frontmatter._parse_yaml_map_block(block, 0, indent)
        self.assertEqual(data, {"search": {"enabled": False}})

    def test_no_extra_returns_empty(self) -> None:
        self.assertEqual(frontmatter._extract_knotis_block(["title: X"]), ([], 0))

    def test_extra_without_knotis_returns_empty(self) -> None:
        lines = ["extra:", "  other: 1"]
        self.assertEqual(frontmatter._extract_knotis_block(lines), ([], 0))


class ReExportTests(unittest.TestCase):
    def test_build_wikilinks_still_exposes_helpers(self) -> None:
        from knotis.builder import build_wikilinks as module

        for name in (
            "_yaml_scalar",
            "_strip_yaml_comment",
            "_parse_yaml_scalar_value",
            "_parse_yaml_list_block",
            "_parse_yaml_map_block",
            "_extract_knotis_block",
            "_read_zensical_toml",
        ):
            self.assertTrue(hasattr(module, name), name)


if __name__ == "__main__":
    unittest.main()
