#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ZENSICAL_VERSION = "0.0.55"
ZENSICAL_REQUIREMENT = f"zensical=={ZENSICAL_VERSION}"


def zensical_command() -> list[str]:
    return [sys.executable, "-m", "zensical"]


def read_zensical_version(zensical_bin: str | Path | list[str] | tuple[str, ...] | None = None) -> str | None:
    command = list(zensical_bin) if isinstance(zensical_bin, (list, tuple)) else None
    if command is None:
        command = zensical_command() if zensical_bin is None else [str(zensical_bin)]
    try:
        result = subprocess.run(
            [*command, "--version"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    output = f"{result.stdout or ''}{result.stderr or ''}"
    match = re.search(r"(\d+\.\d+\.\d+)", output)
    return match.group(1) if match else None


def version_matches(zensical_bin: str | Path | list[str] | tuple[str, ...] | None = None, expected: str = ZENSICAL_VERSION) -> bool:
    found = read_zensical_version(zensical_bin)
    return found == expected


def _install_zensical() -> None:
    subprocess.run(
        [sys.executable, "-m", "pip", "install", ZENSICAL_REQUIREMENT],
        check=True,
    )


def ensure_zensical() -> list[str]:
    """Install or upgrade Zensical in the current interpreter."""
    command = zensical_command()
    if version_matches(command):
        return command

    print(f"[knotis] Installing {ZENSICAL_REQUIREMENT}…", flush=True)
    _install_zensical()

    if not version_matches(command):
        found = read_zensical_version(command) or "unknown"
        raise RuntimeError(
            f"Expected {ZENSICAL_REQUIREMENT}, but {sys.executable} reports {found}."
        )
    return command


def _version_mismatch_message() -> str:
    found = read_zensical_version(zensical_command()) or "unknown"
    return (
        f"Knotis requires {ZENSICAL_REQUIREMENT} in the current Python environment "
        f"(found {found} via {sys.executable} -m zensical). "
        f"Install with: {sys.executable} -m pip install {ZENSICAL_REQUIREMENT}"
    )


def resolve_zensical_command() -> list[str]:
    """Return a usable Zensical command at the pinned version."""
    if os.environ.get("KNOTIS_SKIP_ZENSICAL_VERSION_CHECK"):
        return zensical_command()
    return ensure_zensical()


def resolve_zensical() -> str:
    """Legacy string API for callers that expect an executable path."""
    return sys.executable
