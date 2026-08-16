#!/usr/bin/env python3
from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from knotis import zensical_runtime


class ZensicalRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.module = zensical_runtime

    def test_pinned_version_constant(self) -> None:
        self.assertEqual(self.module.ZENSICAL_VERSION, "0.0.55")
        self.assertEqual(self.module.ZENSICAL_REQUIREMENT, "zensical==0.0.55")

    def test_read_zensical_version_parses_semver(self) -> None:
        with mock.patch.object(self.module.subprocess, "run") as run:
            run.return_value = mock.Mock(stdout="zensical 0.0.46\n", stderr="")
            self.assertEqual(self.module.read_zensical_version(["/bin/zensical"]), "0.0.46")

    def test_ensure_zensical_skips_install_when_pinned_version_present(self) -> None:
        with (
            mock.patch.object(self.module, "zensical_command", return_value=[sys.executable, "-m", "zensical"]),
            mock.patch.object(self.module, "version_matches", return_value=True),
            mock.patch.object(self.module, "_install_zensical") as install,
        ):
            self.assertEqual(self.module.ensure_zensical(), [sys.executable, "-m", "zensical"])
            install.assert_not_called()

    def test_ensure_zensical_installs_when_missing(self) -> None:
        with (
            mock.patch.object(self.module, "zensical_command", return_value=[sys.executable, "-m", "zensical"]),
            mock.patch.object(self.module, "version_matches", side_effect=[False, True]),
            mock.patch.object(self.module, "_install_zensical") as install,
        ):
            self.assertEqual(self.module.ensure_zensical(), [sys.executable, "-m", "zensical"])
            install.assert_called_once()

    def test_resolve_zensical_installs_when_missing(self) -> None:
        with (
            mock.patch.dict(self.module.os.environ, {}, clear=True),
            mock.patch.object(self.module, "ensure_zensical", return_value=[sys.executable, "-m", "zensical"]) as ensure,
        ):
            self.assertEqual(
                self.module.resolve_zensical_command(),
                [sys.executable, "-m", "zensical"],
            )
            ensure.assert_called_once()


if __name__ == "__main__":
    raise SystemExit(unittest.main())
