#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path

DOCS_DIR = Path()
REPO_ROOT = Path()


def configure(*, docs_dir: Path, repo_root: Path) -> None:
    global DOCS_DIR, REPO_ROOT
    DOCS_DIR = docs_dir
    REPO_ROOT = repo_root


def warn_config(message: str) -> None:
    print(f"[build_wikilinks] WARNING: {message}", file=sys.stderr)


def write_if_changed(path: Path, content: str) -> None:
    """Write file only if content differs from what's on disk — avoids triggering rebuild loops."""
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == content:
                print(f"[build_wikilinks] {path.name} unchanged, skipping write", file=sys.stderr)
                return
        except Exception:
            pass
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    print(f"[build_wikilinks] Wrote {path}", file=sys.stderr)


def extract_raw_front_matter_lines(raw: str) -> list[str]:
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        return []

    for idx in range(1, len(lines)):
        if lines[idx].strip() == "---":
            return lines[: idx + 1]
    return []


def ensure_front_matter(front_matter_lines: list[str]) -> list[str]:
    if not front_matter_lines or front_matter_lines[0].strip() != "---":
        return ["---", "---"]
    return front_matter_lines


def front_matter_has_key(front_matter_lines: list[str], key: str) -> bool:
    prefix = f"{key}:"
    for line in front_matter_lines[1:-1]:
        if line.startswith(prefix):
            return True
    return False


def ensure_front_matter_key_lines(
    front_matter_lines: list[str],
    key: str,
    lines_to_add: list[str],
) -> list[str]:
    front_matter_lines = ensure_front_matter(front_matter_lines)
    if front_matter_has_key(front_matter_lines, key):
        return front_matter_lines
    return [*front_matter_lines[:-1], *lines_to_add, front_matter_lines[-1]]


def ensure_front_matter_list_item(
    front_matter_lines: list[str],
    key: str,
    item: str,
) -> list[str]:
    front_matter_lines = ensure_front_matter(front_matter_lines)
    prefix = f"{key}:"
    start = None
    for idx, line in enumerate(front_matter_lines[1:-1], start=1):
        if line.startswith(prefix):
            start = idx
            break

    if start is None:
        return [*front_matter_lines[:-1], prefix, f"  - {item}", front_matter_lines[-1]]

    end = start + 1
    while end < len(front_matter_lines) - 1:
        line = front_matter_lines[end]
        if line and not line.startswith((" ", "\t", "-")):
            break
        end += 1

    block = "\n".join(front_matter_lines[start:end])
    if re.search(rf"(^|[\s\[\],]){re.escape(item)}($|[\s\]\[,])", block):
        return front_matter_lines
    return [*front_matter_lines[:end], f"  - {item}", *front_matter_lines[end:]]


def ensure_generated_page_marker(
    front_matter_lines: list[str],
    marker: str,
    *,
    blank_line_before: bool = False,
) -> list[str]:
    front_matter_lines = ensure_front_matter(front_matter_lines)
    inner = [
        line
        for line in front_matter_lines[1:-1]
        if not line.strip().startswith("knotis_generated:")
    ]
    while inner and inner[-1] == "":
        inner.pop()
    if blank_line_before:
        inner.append("")
    return ["---", *inner, f"knotis_generated: {marker}", "---"]


def order_front_matter_key_blocks(front_matter_lines: list[str], keys: list[str]) -> list[str]:
    front_matter_lines = ensure_front_matter(front_matter_lines)
    key_set = set(keys)
    blocks: dict[str, list[str]] = {}
    rest: list[str] = []
    inner = front_matter_lines[1:-1]
    idx = 0
    while idx < len(inner):
        line = inner[idx]
        key = line.split(":", 1)[0] if ":" in line else ""
        if key in key_set:
            end = idx + 1
            while end < len(inner):
                next_line = inner[end]
                if not next_line or not next_line.startswith((" ", "\t", "-")):
                    break
                end += 1
            blocks.setdefault(key, inner[idx:end])
            idx = end
            continue
        rest.append(line)
        idx += 1

    ordered: list[str] = []
    for key in keys:
        ordered.extend(blocks.get(key, []))
    ordered.extend(rest)
    return ["---", *ordered, "---"]


def strip_front_matter_knotis_content(front_matter_lines: list[str]) -> list[str]:
    if not front_matter_lines or front_matter_lines[0].strip() != "---":
        return front_matter_lines

    inner = front_matter_lines[1:-1]
    kept: list[str] = []
    skip_block = False
    for line in inner:
        stripped = line.strip()
        if stripped.startswith("knotis_content:"):
            skip_block = True
            continue
        if skip_block:
            if line.startswith("  ") or line.startswith("\t"):
                continue
            skip_block = False
        kept.append(line)
    return ["---", *kept, "---"]


def ensure_front_matter_knotis_content(
    front_matter_lines: list[str],
    values: dict[str, bool],
) -> list[str]:
    front_matter_lines = strip_front_matter_knotis_content(ensure_front_matter(front_matter_lines))
    inner = [line for line in front_matter_lines[1:-1] if not line.strip().startswith("template:")]
    block = ["knotis_content:", *[f"  {key}: {str(value).lower()}" for key, value in values.items()]]
    insert_at = 0
    for idx, line in enumerate(inner):
        if line.startswith("title:"):
            insert_at = idx + 1
            break
    return ["---", *inner[:insert_at], *block, *inner[insert_at:], "---"]


def is_generated_page(raw: str, marker: str) -> bool:
    return f"knotis_generated: {marker}" in raw


def read_zensical_toml() -> dict:
    toml_path = REPO_ROOT / "zensical.toml"
    try:
        with toml_path.open("rb") as handle:
            return tomllib.load(handle)
    except FileNotFoundError:
        return {}
    except Exception as exc:
        warn_config(f"could not read zensical.toml: {exc}")
        return {}


def load_site_nav() -> list:
    project = read_zensical_toml().get("project", {})
    nav = project.get("nav", []) if isinstance(project, dict) else []
    return nav if isinstance(nav, list) else []


def iter_nav_paths(nav_items: list | None = None):
    items = load_site_nav() if nav_items is None else nav_items
    for item in items:
        if isinstance(item, str):
            yield item.replace("\\", "/")
        elif isinstance(item, dict):
            for _label, value in item.items():
                if isinstance(value, str):
                    yield value.replace("\\", "/")
                elif isinstance(value, list):
                    yield from iter_nav_paths(value)


def nav_path_for_filename(filename: str, nav_items: list | None = None) -> str | None:
    target = filename.replace("\\", "/").split("/")[-1]
    for path in iter_nav_paths(nav_items):
        if path.split("/")[-1] == target:
            return path
    return None


def yaml_scalar(value: str) -> str:
    return value.strip().strip("\"'")


def nav_path_to_url(md_path: str) -> str | None:
    """Convert a nav .md path string to a site URL fragment. Returns None for index pages."""
    parts = md_path.replace("\\", "/").split("/")
    stem = parts[-1]
    parent = "/".join(parts[:-1])
    if stem == "index.md":
        return None
    return (parent + "/" if parent else "") + stem[:-3] + "/"


def page_url_from_path(md_path: Path) -> str:
    """Convert a docs-relative md path to a site URL fragment."""
    rel = md_path.relative_to(DOCS_DIR)
    if rel.stem == "index":
        url = str(rel.parent) + "/"
    else:
        url = str(rel.parent / rel.stem) + "/"
    return url.replace("\\", "/")


def normalize_page_path_candidate(raw_path: object) -> str | None:
    """Normalize a TOML page path to a docs-relative posix path."""
    candidate = yaml_scalar(str(raw_path)).replace("\\", "/").strip()
    if not candidate:
        return None

    path_obj = Path(candidate)
    if path_obj.is_absolute():
        try:
            return path_obj.resolve().relative_to(DOCS_DIR.resolve()).as_posix()
        except ValueError:
            return None

    candidate = re.sub(r"^\./", "", candidate)
    candidate = re.sub(r"^docs/", "", candidate)
    return candidate.strip("/") or candidate


def normalize_page_path_list(raw_paths, *, config_key: str) -> list[str]:
    """Normalize TOML page-path entries to docs-relative posix paths."""
    items = raw_paths if isinstance(raw_paths, list) else [raw_paths]
    normalized: list[str] = []
    for item in items:
        if item is None:
            continue
        raw_token = str(item).strip()
        if not raw_token:
            continue
        candidate = normalize_page_path_candidate(item)
        if candidate is None:
            warn_config(f"{config_key} entry '{raw_token}' is outside docs_dir '{DOCS_DIR}'")
            continue
        if candidate not in normalized:
            normalized.append(candidate)
    return normalized


def match_page_paths(candidate: str, available_paths: set[str]) -> set[str]:
    """Match one normalized candidate against known docs-relative Markdown paths."""
    matches: set[str] = set()

    if candidate in available_paths:
        matches.add(candidate)

    if not candidate.endswith(".md"):
        md_candidate = f"{candidate}.md"
        if md_candidate in available_paths:
            matches.add(md_candidate)

    dir_prefix = f"{candidate.rstrip('/')}/"
    for rel_path in available_paths:
        if rel_path.startswith(dir_prefix):
            matches.add(rel_path)

    return matches


def resolve_page_path_set(
    raw_paths: list,
    md_files: list[Path],
    *,
    config_key: str,
) -> set[str]:
    available_paths = {
        md_path.relative_to(DOCS_DIR).as_posix(): md_path
        for md_path in md_files
    }
    available_path_set = set(available_paths)
    basename_map: dict[str, list[str]] = {}
    for rel_path in available_paths:
        basename_map.setdefault(Path(rel_path).name, []).append(rel_path)

    resolved_paths: set[str] = set()
    for raw_path in raw_paths:
        candidate = normalize_page_path_candidate(raw_path)
        if candidate is None:
            warn_config(f"{config_key} entry '{raw_path}' is outside docs_dir '{DOCS_DIR}'")
            continue

        matches = match_page_paths(candidate, available_path_set)
        if matches:
            if len(matches) == 1:
                normalized_path = next(iter(matches))
                if normalized_path != yaml_scalar(str(raw_path)).replace("\\", "/"):
                    print(
                        f"[build_wikilinks] Normalized {config_key} entry '{raw_path}' → '{normalized_path}'",
                        file=sys.stderr,
                    )
            elif not (
                candidate in available_path_set
                or f"{candidate}.md" in available_path_set
            ):
                print(
                    f"[build_wikilinks] Normalized {config_key} entry '{raw_path}' → "
                    f"{len(matches)} pages under '{candidate}/'",
                    file=sys.stderr,
                )
            resolved_paths.update(matches)
            continue

        basename_matches = basename_map.get(Path(candidate).name, [])
        if len(basename_matches) == 1:
            normalized_path = basename_matches[0]
            resolved_paths.add(normalized_path)
            print(
                f"[build_wikilinks] Normalized {config_key} entry '{raw_path}' → '{normalized_path}'",
                file=sys.stderr,
            )
        elif len(basename_matches) > 1:
            match_list = ", ".join(sorted(basename_matches))
            warn_config(f"{config_key} entry '{raw_path}' is ambiguous: {match_list}")
        else:
            warn_config(f"{config_key} entry '{raw_path}' did not match any docs page")
    return resolved_paths


def resolve_skip_page_urls(
    exclusion_config: dict,
    md_files: list[Path],
    *,
    config_prefix: str,
    extra_skip_urls: set[str] | None = None,
) -> set[str]:
    """Resolve exclude_paths from a feature config block to page URLs."""
    exclude_list = exclusion_config.get("exclude_paths")
    if exclude_list is None:
        exclude_list = exclusion_config.get("exclude_pages", [])
    exclude_paths = resolve_page_path_set(
        exclude_list,
        md_files,
        config_key=f"{config_prefix}.exclude_paths",
    )
    skip_urls = set(extra_skip_urls or ())
    for rel_path in exclude_paths:
        skip_urls.add(page_url_from_path(DOCS_DIR / rel_path))
    return skip_urls
