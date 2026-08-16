from __future__ import annotations

import shutil
import subprocess
import sys
from importlib import resources
from pathlib import Path

from .zensical_runtime import ensure_zensical


def _resource_root() -> Path:
    return resources.files("knotis").joinpath("scaffold")  # type: ignore[return-value]


def _copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)


def _run_zensical_new(target: Path) -> None:
    ensure_zensical()
    print("[knotis] Running zensical new ....", flush=True)
    subprocess.run([sys.executable, "-m", "zensical", "new", "."], cwd=target, check=True)


def _remove_zensical_demo_docs(target: Path) -> None:
    for name in ("markdown.md",):
        path = target / "docs" / name
        if path.is_file():
            path.unlink()


def _run_initial_build(target: Path) -> None:
    subprocess.run(
        [sys.executable, "-B", "-m", "knotis", "build"],
        cwd=target,
        check=True,
    )


def run_knotis_new(target: Path, *, run_build: bool = True) -> None:
    target = target.resolve()
    config_path = target / "zensical.toml"

    if config_path.exists():
        raise FileExistsError(f"{config_path} already exists; refusing to overwrite.")

    target.mkdir(parents=True, exist_ok=True)

    with resources.as_file(_resource_root()) as scaffold_dir:
        _run_zensical_new(target)
        _remove_zensical_demo_docs(target)

        _copy_file(scaffold_dir / "zensical.toml", target / "zensical.toml")
        _copy_file(scaffold_dir / ".gitignore", target / ".gitignore")
        _copy_tree(scaffold_dir / "overrides", target / "overrides")
        _copy_tree(scaffold_dir / "docs", target / "docs")
        _copy_file(
            scaffold_dir / "assets" / "knotis-theme.css",
            target / "docs" / "stylesheets" / "knotis-theme.css",
        )

    print(f"[knotis] Created Knotis site at {target}", flush=True)

    if run_build:
        print("[knotis] Running initial build...", flush=True)
        _run_initial_build(target)
