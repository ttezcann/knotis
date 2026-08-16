#!/usr/bin/env python3
from __future__ import annotations

import io
import re
import tomllib
from pathlib import Path

from .config_defaults import KNOTIS_DEFAULT_CONFIG, KNOTIS_FOOTER_ATTRIBUTION_HTML
from . import moc_nav

SLIDE_MARKERS_EXTENSION_TOML_LINE = (
    '[project.markdown_extensions."knotis.markdown.knotis_slide_markers"]\n'
)
SLIDE_MARKERS_EXTENSION_MARKERS = (
    "knotis.markdown.knotis_slide_markers",
    '[project.markdown_extensions."knotis_slide_markers"]',
    '[project.markdown_extensions.knotis_slide_markers]',
)

_SECTION_HEADING_RE = re.compile(r"^\[[^\]]+\]\s*$")
CONTENT_TAGS_CSS_LINE = '  "assets/knotis-content-tags.css",'


def zensical_text_includes_slide_markers_extension(text: str) -> bool:
    return any(marker in text for marker in SLIDE_MARKERS_EXTENSION_MARKERS)


def inject_slide_markers_extension(text: str) -> str:
    if zensical_text_includes_slide_markers_extension(text):
        return text

    anchor = "[project.markdown_extensions.attr_list]"
    idx = text.find(anchor)
    if idx >= 0:
        line_end = text.find("\n", idx)
        insert_at = len(text) if line_end < 0 else line_end + 1
        return text[:insert_at] + SLIDE_MARKERS_EXTENSION_TOML_LINE + text[insert_at:]

    anchor = "[project.markdown_extensions."
    idx = text.find(anchor)
    if idx >= 0:
        return text[:idx] + SLIDE_MARKERS_EXTENSION_TOML_LINE + text[idx:]

    anchor = "# Markdown extensions"
    idx = text.find(anchor)
    if idx >= 0:
        line_end = text.find("\n", idx)
        insert_at = len(text) if line_end < 0 else line_end + 1
        return text[:insert_at] + SLIDE_MARKERS_EXTENSION_TOML_LINE + text[insert_at:]

    return text.rstrip() + "\n\n" + SLIDE_MARKERS_EXTENSION_TOML_LINE


def _read_zensical_dict_from_text(text: str) -> dict:
    try:
        return tomllib.load(io.BytesIO(text.encode("utf-8")))
    except tomllib.TOMLDecodeError:
        return {}


def content_generator_enabled(repo_root: Path, text: str | None = None) -> bool:
    if text is None:
        source = repo_root / "zensical.toml"
        if not source.is_file():
            return bool(KNOTIS_DEFAULT_CONFIG["content"]["generator"])
        text = source.read_text(encoding="utf-8")

    data = _read_zensical_dict_from_text(text)
    project = data.get("project", {})
    if not isinstance(project, dict):
        project = {}
    extra = project.get("extra", {})
    if not isinstance(extra, dict):
        extra = {}
    knotis = extra.get("knotis", {})
    if not isinstance(knotis, dict):
        knotis = {}
    content = knotis.get("content", {})
    if not isinstance(content, dict):
        content = {}
    enabled = content.get("generator", KNOTIS_DEFAULT_CONFIG["content"]["generator"])
    if isinstance(enabled, bool):
        return enabled
    return bool(KNOTIS_DEFAULT_CONFIG["content"]["generator"])


def _project_copyright_from_dict(data: dict) -> str:
    project = data.get("project", {})
    if not isinstance(project, dict):
        return ""
    copyright_value = project.get("copyright", "")
    if copyright_value is None:
        return ""
    return str(copyright_value).strip()


def merge_footer_copyright(user_copyright: str, *, show_knotis_attribution: bool) -> str:
    attribution = KNOTIS_FOOTER_ATTRIBUTION_HTML
    if not show_knotis_attribution:
        return user_copyright
    if user_copyright:
        return f"{user_copyright}<br>\n{attribution}"
    return attribution


def _format_copyright_toml(value: str) -> str:
    return f'copyright = """\n{value}\n"""'


def _section_range(lines: list[str], section_name: str) -> tuple[int, int] | None:
    start = None
    for index, line in enumerate(lines):
        if line.strip() == section_name:
            start = index
            continue
        if start is not None and _SECTION_HEADING_RE.match(line):
            return start, index
    if start is not None:
        return start, len(lines)
    return None


def inject_project_extra_generator_false(text: str) -> str:
    lines = text.splitlines()
    section = _section_range(lines, "[project.extra]")
    if section is None:
        anchor = "# Additional configuration"
        insert_at = len(lines)
        for index, line in enumerate(lines):
            if line.strip() == anchor:
                insert_at = index + 1
                break
        block = ["", "[project.extra]", "generator = false", ""]
        lines[insert_at:insert_at] = block
        return "\n".join(lines) + ("\n" if text.endswith("\n") else "")

    start, end = section
    kept: list[str] = []
    for line in lines[start + 1 : end]:
        if re.match(r"^\s*generator\s*=", line):
            continue
        kept.append(line)
    replacement = lines[: start + 1] + ["generator = false", *kept] + lines[end:]
    return "\n".join(replacement) + ("\n" if text.endswith("\n") else "")


def inject_knotis_content_generator_false(text: str) -> str:
    lines = text.splitlines()
    section = _section_range(lines, "[project.extra.knotis.content]")
    if section is None:
        block = ["", "[project.extra.knotis.content]", "generator = false"]
        return "\n".join([*lines, *block]) + ("\n" if text.endswith("\n") else "")

    start, end = section
    kept: list[str] = []
    inserted = False
    for line in lines[start + 1 : end]:
        if re.match(r"^\s*generator\s*=", line):
            if not inserted:
                kept.append("generator = false")
                inserted = True
            continue
        kept.append(line)
    if not inserted:
        kept.append("generator = false")
    replacement = lines[: start + 1] + kept + lines[end:]
    return "\n".join(replacement) + ("\n" if text.endswith("\n") else "")


def inject_project_copyright(text: str, copyright_value: str) -> str:
    formatted = _format_copyright_toml(copyright_value)
    lines = text.splitlines()
    section = _section_range(lines, "[project]")
    if section is None:
        block = ["[project]", formatted, ""]
        if lines and lines[0].startswith("#"):
            lines[1:1] = block
        else:
            lines[0:0] = block
        return "\n".join(lines) + ("\n" if text.endswith("\n") else "")

    start, end = section
    index = start + 1
    while index < end:
        stripped = lines[index].strip()
        if stripped.startswith("copyright ="):
            block_end = index + 1
            if stripped.startswith('copyright = """') and stripped.count('"""') < 2:
                while block_end < end and '"""' not in lines[block_end]:
                    block_end += 1
                block_end = min(block_end + 1, end)
            elif stripped.startswith("copyright = '''") and stripped.count("'''") < 2:
                while block_end < end and "'''" not in lines[block_end]:
                    block_end += 1
                block_end = min(block_end + 1, end)
            replacement = lines[:index] + [formatted] + lines[block_end:]
            return "\n".join(replacement) + ("\n" if text.endswith("\n") else "")
        index += 1

    insert_at = start + 1
    replacement = lines[:insert_at] + [formatted] + lines[insert_at:]
    return "\n".join(replacement) + ("\n" if text.endswith("\n") else "")


def inject_content_tags_css(text: str) -> str:
    if "assets/knotis-content-tags.css" in text:
        return text

    lines = text.splitlines()
    in_extra_css = False
    fallback_insert_at = None
    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("extra_css") and "[" in stripped:
            in_extra_css = True
            continue
        if not in_extra_css:
            continue
        if '"assets/knotis-palette.css"' in line:
            lines.insert(index + 1, CONTENT_TAGS_CSS_LINE)
            return "\n".join(lines) + ("\n" if text.endswith("\n") else "")
        if stripped == "]":
            fallback_insert_at = index
            break

    if fallback_insert_at is not None:
        lines.insert(fallback_insert_at, CONTENT_TAGS_CSS_LINE)
        return "\n".join(lines) + ("\n" if text.endswith("\n") else "")
    return text


def apply_knotis_zensical_overrides(text: str, repo_root: Path) -> str:
    data = _read_zensical_dict_from_text(text)
    user_copyright = _project_copyright_from_dict(data)
    show_attribution = content_generator_enabled(repo_root, text)
    project = data.get("project", {}) if isinstance(data.get("project"), dict) else {}
    nav_items = project.get("nav", []) if isinstance(project.get("nav"), list) else []
    docs_dir = repo_root / str(project.get("docs_dir", "docs"))
    moc_configs = moc_nav.load_moc_configs(repo_root, docs_dir)
    nav_moc_configs = moc_nav.nav_visible_moc_configs(moc_configs)
    if nav_moc_configs and nav_items:
        expanded_nav = moc_nav.apply_moc_nav_to_items(nav_items, nav_moc_configs)
        if expanded_nav != nav_items:
            text = moc_nav.replace_nav_block(text, expanded_nav)
    text = inject_content_tags_css(text)
    text = inject_project_extra_generator_false(text)
    text = inject_knotis_content_generator_false(text)
    if show_attribution:
        merged = merge_footer_copyright(user_copyright, show_knotis_attribution=True)
        text = inject_project_copyright(text, merged)
    return text


def slides_enabled_in_site(repo_root: Path) -> bool:
    toml_path = repo_root / "zensical.toml"
    try:
        with toml_path.open("rb") as handle:
            data = tomllib.load(handle)
    except FileNotFoundError:
        return False
    except OSError:
        return False

    project = data.get("project", {})
    if not isinstance(project, dict):
        return False
    extra = project.get("extra", {})
    if not isinstance(extra, dict):
        extra = {}
    knotis = extra.get("knotis", {})
    if not isinstance(knotis, dict):
        knotis = {}
    slides = knotis.get("slides", {})
    if not isinstance(slides, dict):
        slides = {}
    if "enabled" not in slides:
        return bool(KNOTIS_DEFAULT_CONFIG["slides"]["enabled"])
    enabled = slides.get("enabled")
    if isinstance(enabled, bool):
        return enabled
    return bool(KNOTIS_DEFAULT_CONFIG["slides"]["enabled"])


def resolve_zensical_config_path(repo_root: Path) -> Path:
    """Return zensical.toml, or a generated build config with Knotis build overrides."""
    source = repo_root / "zensical.toml"
    if not source.is_file():
        return source

    original = source.read_text(encoding="utf-8")
    text = inject_slide_markers_extension(original)
    text = apply_knotis_zensical_overrides(text, repo_root)
    if text == original:
        return source

    dest = repo_root / ".zensical.knotis.build.toml"
    if not dest.exists() or dest.read_text(encoding="utf-8") != text:
        dest.write_text(text, encoding="utf-8")
    return dest


def site_uses_packaged_markdown_extensions(repo_root: Path, raw_config: dict | None = None) -> bool:
    config = raw_config if raw_config is not None else _read_zensical_dict(repo_root)
    extensions = config.get("project", {}).get("markdown_extensions", {})
    if isinstance(extensions, dict) and any(
        str(name).startswith("knotis.markdown.") for name in extensions
    ):
        return True
    source = repo_root / "zensical.toml"
    if source.is_file():
        text = source.read_text(encoding="utf-8")
        if zensical_text_includes_slide_markers_extension(text):
            return True
    return slides_enabled_in_site(repo_root)


def _read_zensical_dict(repo_root: Path) -> dict:
    toml_path = repo_root / "zensical.toml"
    try:
        with toml_path.open("rb") as handle:
            return tomllib.load(handle)
    except (FileNotFoundError, OSError):
        return {}
