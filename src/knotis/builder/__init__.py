from __future__ import annotations

from pathlib import Path

from . import build_wikilinks


def run_build(site_root: Path | str | None = None, *, skip_site_mirror: bool = False) -> None:
    """Run the Knotis indexer for a site root."""
    root = Path.cwd() if site_root is None else Path(site_root)
    build_wikilinks.main(docs_dir=root / "docs", skip_site_mirror=skip_site_mirror)
