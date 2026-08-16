#!/usr/bin/env python3
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from knotis import cli, watch  # noqa: E402


class KnotisCliWorkflowTests(unittest.TestCase):
    def test_split_serve_args_drops_forwarding_separator(self) -> None:
        live_reload, watch_enabled, forwarded = cli.split_serve_args(
            ["--no-reload", "--", "--dev-addr", "localhost:8019"]
        )

        self.assertFalse(live_reload)
        self.assertTrue(watch_enabled)
        self.assertEqual(forwarded, ["--dev-addr", "localhost:8019"])

    def test_build_runs_indexer_once_and_keeps_post_build_cleanup(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with (
                mock.patch.object(cli, "run_build") as run_build,
                mock.patch.object(cli, "run_zensical_build", return_value=0),
                mock.patch.object(cli, "normalize_generated_page_front_matter") as normalize_pages,
                mock.patch.object(cli, "clean_generated_page_routes") as clean_routes,
                mock.patch.object(cli, "sync_source_styles"),
                mock.patch.object(cli, "clean_search_index") as clean_search,
            ):
                self.assertEqual(cli.run_knotis_build(root), 0)

        run_build.assert_called_once_with(root)
        normalize_pages.assert_called_once_with(root)
        clean_routes.assert_called_once_with(root)
        clean_search.assert_called_once_with(root / "site", root)

    def test_served_runtime_assets_ready_waits_for_javascript(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            class Response:
                headers = {"content-type": "application/javascript"}

                def __enter__(self):
                    return self

                def __exit__(self, *_exc):
                    return False

                def read(self, _size: int) -> bytes:
                    return b"/* Knotis core utilities */"

            with (
                mock.patch.object(cli, "sync_site_runtime_assets") as sync_assets,
                mock.patch.object(cli, "clean_search_index") as clean_search,
                mock.patch.object(cli, "stamp_knotis_asset_cache_busters") as stamp_assets,
                mock.patch.object(cli.urllib.request, "urlopen", return_value=Response()) as urlopen,
            ):
                self.assertTrue(
                    cli.served_runtime_assets_ready(root, "http://localhost:8000", timeout=0.2)
                )

        sync_assets.assert_called_once_with(root)
        clean_search.assert_called_once_with(root / "site", root)
        stamp_assets.assert_called_once_with(root / "site", root / "site" / "assets" / "knotis")
        url = urlopen.call_args.args[0].full_url
        self.assertIn("/assets/knotis/knotis-core.js?", url)

    def test_serve_watcher_startup_cleans_without_rebuilding_index(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with (
                mock.patch.object(watch, "run_build") as run_build,
                mock.patch.object(watch, "normalize_generated_page_front_matter") as normalize_pages,
                mock.patch.object(watch, "clean_generated_page_routes") as clean_routes,
                mock.patch.object(watch, "sync_served_runtime_assets") as sync_assets,
                mock.patch.object(watch, "clean_search_index") as clean_search,
                mock.patch.object(watch, "get_mtimes", return_value={}),
                mock.patch.object(watch.time, "sleep", side_effect=KeyboardInterrupt),
            ):
                watch.watch(root, skip_initial_build=True)

        run_build.assert_not_called()
        normalize_pages.assert_called_once_with(root)
        clean_routes.assert_called_once_with(root)
        sync_assets.assert_called_once_with(root)
        clean_search.assert_not_called()

    def test_watcher_refresh_lets_zensical_serve_own_site_rebuilds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with (
                mock.patch.object(watch, "run_build") as run_build,
                mock.patch.object(watch, "normalize_generated_page_front_matter") as normalize_pages,
                mock.patch.object(watch, "sync_served_runtime_assets") as sync_assets,
                mock.patch.object(watch, "refresh_zensical_build_overlay", return_value=True) as refresh_overlay,
                mock.patch.object(watch, "clean_generated_page_routes") as clean_routes,
                mock.patch.object(watch, "clean_search_index"),
                mock.patch.object(watch.emit_dev_heartbeat, "emit"),
            ):
                watch.run_watch_build(root, {root / "zensical.toml"})

        run_build.assert_called_once_with(root)
        sync_assets.assert_called_once_with(root)
        normalize_pages.assert_called_once_with(root)
        refresh_overlay.assert_called_once_with(root)
        clean_routes.assert_called_once_with(root)

    def test_normalize_generated_page_front_matter_removes_blank_before_marker(self) -> None:
        from knotis.build_site import normalize_generated_page_front_matter

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            glossary = root / "docs" / "explore" / "glossary.md"
            glossary.parent.mkdir(parents=True)
            glossary.write_text(
                "\n".join(
                    [
                        "---",
                        'title: "Glossary"',
                        "tags:",
                        "  - Explore",
                        "",
                        "knotis_generated: glossary-page",
                        "---",
                        "",
                        "Body",
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            normalize_generated_page_front_matter(root)

            text = glossary.read_text(encoding="utf-8")
            self.assertIn("tags:\n  - Explore\nknotis_generated: glossary-page", text)
            self.assertNotIn("Explore\n\nknotis_generated", text)

    def test_refresh_zensical_build_overlay_updates_nav_in_dest(self) -> None:
        from knotis.build_site import refresh_zensical_build_overlay

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            toml = root / "zensical.toml"
            toml.write_text(
                "\n".join(
                    [
                        "[project]",
                        'site_name = "Test"',
                        'nav = [{ "Workflows" = "workflows/index.md" }]',
                        "",
                        "[project.markdown_extensions.attr_list]",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            refresh_zensical_build_overlay(root)
            dest = root / ".zensical.knotis.build.toml"
            self.assertTrue(dest.is_file())
            self.assertIn("Workflows", dest.read_text(encoding="utf-8"))

            toml.write_text(
                "\n".join(
                    [
                        "[project]",
                        'site_name = "Test"',
                        'nav = [{ "Getting started" = "getting-started/index.md" }]',
                        "",
                        "[project.markdown_extensions.attr_list]",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            self.assertTrue(refresh_zensical_build_overlay(root))
            updated = dest.read_text(encoding="utf-8")
            self.assertIn("Getting started", updated)
            self.assertNotIn('"Workflows"', updated)

    def test_refresh_zensical_build_overlay_expands_moc_nav_from_front_matter(self) -> None:
        from knotis.build_site import refresh_zensical_build_overlay

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            docs = root / "docs"
            (docs / "resources" / "how-to-use-this-site").mkdir(parents=True)
            (docs / "resources" / "how-to-use-this-site.md").write_text(
                "\n".join(
                    [
                        "---",
                        'title: "How to use this site"',
                        "moc: true",
                        "moc_collapse: true",
                        "moc_pages:",
                        "  - how-to-use-this-site/search.md",
                        "  - how-to-use-this-site/pane.md",
                        "---",
                        "",
                        "# [[How to use this site]]",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (docs / "resources" / "how-to-use-this-site" / "search.md").write_text(
                "# [[Search]]\n",
                encoding="utf-8",
            )
            (docs / "resources" / "how-to-use-this-site" / "pane.md").write_text(
                "# [[Pane]]\n",
                encoding="utf-8",
            )
            (root / "zensical.toml").write_text(
                "\n".join(
                    [
                        "[project]",
                        'site_name = "Test"',
                        'nav = [{ "Resources" = [{ "How to use this site" = "resources/how-to-use-this-site.md" }] }]',
                        "",
                        "[project.markdown_extensions.attr_list]",
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            self.assertTrue(refresh_zensical_build_overlay(root))
            updated = (root / ".zensical.knotis.build.toml").read_text(encoding="utf-8")

        self.assertIn('{ "How to use this site" = [', updated)
        self.assertIn('"resources/how-to-use-this-site.md"', updated)
        self.assertIn('"resources/how-to-use-this-site/search.md"', updated)
        self.assertIn('"resources/how-to-use-this-site/pane.md"', updated)

    def test_refresh_zensical_build_overlay_skips_moc_nav_when_disabled(self) -> None:
        from knotis.build_site import refresh_zensical_build_overlay

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            docs = root / "docs"
            (docs / "resources" / "site-guide").mkdir(parents=True)
            (docs / "resources" / "site-guide.md").write_text(
                "\n".join(
                    [
                        "---",
                        'title: "Site guide"',
                        "moc: true",
                        "moc_nav: false",
                        "moc_pages:",
                        "  - site-guide/search.md",
                        "  - site-guide/pane.md",
                        "---",
                        "",
                        "# [[Site guide]]",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (docs / "resources" / "site-guide" / "search.md").write_text("# [[Search]]\n", encoding="utf-8")
            (docs / "resources" / "site-guide" / "pane.md").write_text("# [[Pane]]\n", encoding="utf-8")
            (root / "zensical.toml").write_text(
                "\n".join(
                    [
                        "[project]",
                        'site_name = "Test"',
                        'nav = [{ "Resources" = [{ "Site guide" = "resources/site-guide.md" }] }]',
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            self.assertTrue(refresh_zensical_build_overlay(root))
            updated = (root / ".zensical.knotis.build.toml").read_text(encoding="utf-8")

        self.assertIn('{ "Site guide" = "resources/site-guide.md" }', updated)
        self.assertNotIn("resources/site-guide/search.md", updated)
        self.assertNotIn("resources/site-guide/pane.md", updated)

    def test_clean_search_index_removes_zensical_search_artifacts(self) -> None:
        from knotis.build_site import clean_search_index

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workers = root / "site" / "assets" / "javascripts" / "workers"
            workers.mkdir(parents=True)
            (root / "site" / "javascripts").mkdir(parents=True)
            (root / "site" / "search.json").write_text("{}", encoding="utf-8")
            (root / "site" / "javascripts" / "search-cleanup.js").write_text("", encoding="utf-8")
            (workers / "search.b6b7e04f.min.js").write_text("", encoding="utf-8")
            (workers / "other-worker.js").write_text("", encoding="utf-8")

            clean_search_index(root / "site", root)

            self.assertFalse((root / "site" / "search.json").exists())
            self.assertFalse((root / "site" / "javascripts" / "search-cleanup.js").exists())
            self.assertFalse((workers / "search.b6b7e04f.min.js").exists())
            self.assertTrue((workers / "other-worker.js").exists())

    def test_clean_search_index_preserves_zensical_search_when_knotis_search_disabled(self) -> None:
        from knotis.build_site import clean_search_index

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            workers = root / "site" / "assets" / "javascripts" / "workers"
            workers.mkdir(parents=True)
            (root / "zensical.toml").write_text(
                "\n".join(
                    [
                        "[project]",
                        'site_name = "Test"',
                        "",
                        "[project.extra.knotis.search]",
                        "enabled = false",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (root / "site" / "search.json").write_text("{}", encoding="utf-8")
            (workers / "search.b6b7e04f.min.js").write_text("", encoding="utf-8")

            clean_search_index(root / "site", root)

            self.assertTrue((root / "site" / "search.json").exists())
            self.assertTrue((workers / "search.b6b7e04f.min.js").exists())


if __name__ == "__main__":
    unittest.main()
