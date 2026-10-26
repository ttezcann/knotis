#!/usr/bin/env python3
from __future__ import annotations

import io
import re
import sys
import tomllib
from pathlib import Path

from .assets_mirror import (
    COPY_ONLY_ASSET_FILES,
    RUNTIME_ASSET_URL_PREFIX,
    RUNTIME_SCRIPTS,
    RUNTIME_SCRIPTS_AFTER_SITE,
    RUNTIME_STYLESHEETS,
    runtime_asset_paths,
)
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
RUNTIME_ASSETS_CONFIG_KEY = "knotis_runtime_assets"
LEGACY_RUNTIME_ASSET_PREFIX = "assets/"
_RETIRED_KNOTIS_ASSET_RE = re.compile(r"knotis-[A-Za-z0-9._-]+\.(?:css|js)")
# A literal `{%- for path in [...] %}` asset loop, as older Knotis scaffolds wrote it.
_TEMPLATE_ASSET_LIST_RE = re.compile(
    r"\{%-?\s*for\s+path\s+in\s+\[(?P<body>[^\]]*)\]\s*-?%\}\n"
    r"(?P<tag>[^\n]*\{\{\s*path\s*\|\s*url\s*\}\}[^\n]*)\n"
    r"[ \t]*\{%-?\s*endfor\s*-?%\}"
)
_TEMPLATE_LIST_BODY_RE = re.compile(r'(?:\s*"[^"\n]*"\s*,?)*\s*')
_TEMPLATE_ASSETS_SET_LINE = (
    "{%- set knotis_assets = config.extra.knotis_runtime_assets "
    "if config.extra.knotis_runtime_assets else {} %}"
)


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


def _legacy_package_asset_name(entry: str) -> str | None:
    if not entry.startswith(LEGACY_RUNTIME_ASSET_PREFIX):
        return None
    name = entry[len(LEGACY_RUNTIME_ASSET_PREFIX):]
    if name.startswith("vendor/") or name in COPY_ONLY_ASSET_FILES or name == "knotis-theme.css":
        return None
    if name in (*RUNTIME_STYLESHEETS, *RUNTIME_SCRIPTS) or _RETIRED_KNOTIS_ASSET_RE.fullmatch(name):
        return name
    return None


def _reconciled_legacy_asset_list(values: list[str], names: tuple[str, ...]) -> list[str]:
    """Put the registry's package assets where the old package entries started.

    Site entries (knotis-theme.css, course scripts, vendored libraries a legacy
    site lists itself) keep their order around that block; package entries that
    the registry no longer ships are dropped.
    """
    package_indexes = [index for index, value in enumerate(values) if _legacy_package_asset_name(value)]
    if not package_indexes:
        return values
    first = package_indexes[0]
    before = values[:first]
    rest = [value for value in values[first:] if not _legacy_package_asset_name(value)]
    package = [f"{LEGACY_RUNTIME_ASSET_PREFIX}{name}" for name in names if not name.startswith("vendor/")]
    return [*before, *package, *rest]


def _format_toml_string_array(key: str, values: list[str]) -> str:
    return f"{key} = [\n" + "".join(f'  "{value}",\n' for value in values) + "]"


def reconcile_legacy_extra_assets(text: str) -> str:
    """Bring legacy extra_css/extra_javascript Knotis entries up to the registry (build config only)."""
    data = _read_zensical_dict_from_text(text)
    project = data.get("project", {}) if isinstance(data.get("project"), dict) else {}
    lines = text.splitlines()
    section = _section_range(lines, "[project]")
    if section is None:
        return text
    updated = text
    for key, names in (("extra_css", RUNTIME_STYLESHEETS), ("extra_javascript", RUNTIME_SCRIPTS)):
        values = project.get(key)
        if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
            continue
        reconciled = _reconciled_legacy_asset_list(values, names)
        if reconciled == values:
            continue
        start, end = _section_range(updated.splitlines(), "[project]")
        section_lines = updated.splitlines(keepends=True)
        offset = sum(len(line) for line in section_lines[:start])
        limit = sum(len(line) for line in section_lines[:end])
        match = re.compile(rf"^{key}\s*=\s*\[[^\]]*\]", re.MULTILINE).search(updated, offset, limit)
        if match is None:
            continue
        candidate = updated[: match.start()] + _format_toml_string_array(key, reconciled) + updated[match.end():]
        parsed = _read_zensical_dict_from_text(candidate).get("project", {})
        if isinstance(parsed, dict) and parsed.get(key) == reconciled:
            updated = candidate
    return updated


def runtime_assets_config() -> dict[str, list[str]]:
    return {
        "stylesheets": runtime_asset_paths(RUNTIME_STYLESHEETS),
        "scripts": runtime_asset_paths(RUNTIME_SCRIPTS),
        "scripts_after_site": runtime_asset_paths(RUNTIME_SCRIPTS_AFTER_SITE),
    }


def inject_runtime_assets_config(text: str) -> str:
    """Append the registry to the build config so templates can loop over it."""
    data = _read_zensical_dict_from_text(text)
    extra = data.get("project", {}).get("extra", {}) if isinstance(data.get("project"), dict) else {}
    if isinstance(extra, dict) and RUNTIME_ASSETS_CONFIG_KEY in extra:
        print(
            f"[knotis] WARNING: zensical.toml defines project.extra.{RUNTIME_ASSETS_CONFIG_KEY}, which Knotis "
            "generates; remove it so templates receive the package runtime asset list.",
            file=sys.stderr,
        )
        return text
    assets = runtime_assets_config()
    block = (
        "\n# Generated by Knotis: package runtime assets for overrides templates.\n"
        f"[project.extra.{RUNTIME_ASSETS_CONFIG_KEY}]\n"
        + "\n".join(_format_toml_string_array(group, paths) for group, paths in assets.items())
        + "\n"
    )
    candidate = text.rstrip("\n") + "\n" + block
    parsed = _read_zensical_dict_from_text(candidate).get("project", {})
    parsed_assets = parsed.get("extra", {}).get(RUNTIME_ASSETS_CONFIG_KEY) if isinstance(parsed, dict) else None
    if parsed_assets != assets:
        print(
            "[knotis] WARNING: could not add the Knotis runtime asset list to the build config "
            "(is project.extra an inline table?); templates will not load package assets.",
            file=sys.stderr,
        )
        return text
    return candidate


def _migrated_template_asset_list(entries: list[str], tag: str) -> str:
    def literal(values: list[str]) -> list[str]:
        if not values:
            return []
        body = "".join(f'  "{value}",\n' for value in values)
        return [f"{{%- for path in [\n{body}] %}}\n{tag}\n{{%- endfor %}}"]

    def loop(group: str) -> str:
        return f"{{%- for path in knotis_assets.{group} | default([]) %}}\n{tag}\n{{%- endfor %}}"

    is_package = [entry.startswith(RUNTIME_ASSET_URL_PREFIX) for entry in entries]
    first = is_package.index(True)
    before = [entry for entry, package in zip(entries[:first], is_package) if not package]
    if "<script" not in tag:
        rest = [entry for entry, package in zip(entries[first:], is_package[first:]) if not package]
        parts = [*literal(before), _TEMPLATE_ASSETS_SET_LINE, loop("stylesheets"), *literal(rest)]
        return "\n".join(parts)
    after_site_paths = set(runtime_asset_paths(RUNTIME_SCRIPTS_AFTER_SITE))
    split = next((index for index, entry in enumerate(entries) if entry in after_site_paths), len(entries))
    middle = [entry for index, entry in enumerate(entries) if first < index < split and not is_package[index]]
    after = [entry for index, entry in enumerate(entries) if index > split and not is_package[index]]
    parts = [
        *literal(before),
        _TEMPLATE_ASSETS_SET_LINE,
        loop("scripts"),
        *literal(middle),
        loop("scripts_after_site"),
        *literal(after),
    ]
    return "\n".join(parts)


def migrate_template_asset_lists(text: str) -> tuple[str, int]:
    """Replace literal Knotis asset loops in a template with registry loops.

    Only `{%- for path in [...] %}` lists made of plain strings that include
    package paths (assets/knotis/...) are touched; the site's own entries stay
    as literal lists in the same position relative to the Knotis assets.
    """
    replaced = 0

    def replace(match: re.Match) -> str:
        nonlocal replaced
        body = match.group("body")
        if not _TEMPLATE_LIST_BODY_RE.fullmatch(body):
            return match.group(0)
        entries = re.findall(r'"([^"\n]*)"', body)
        if not any(entry.startswith(RUNTIME_ASSET_URL_PREFIX) for entry in entries):
            return match.group(0)
        replaced += 1
        return _migrated_template_asset_list(entries, match.group("tag"))

    return _TEMPLATE_ASSET_LIST_RE.sub(replace, text), replaced


def _site_lists_legacy_package_assets(data: dict) -> bool:
    project = data.get("project", {}) if isinstance(data.get("project"), dict) else {}
    for key in ("extra_css", "extra_javascript"):
        values = project.get(key)
        if isinstance(values, list) and any(isinstance(v, str) and _legacy_package_asset_name(v) for v in values):
            return True
    return False


def sync_site_template_runtime_assets(repo_root: Path, data: dict) -> None:
    """Migrate an older Knotis main.html once, then report templates that miss package assets."""
    if _site_lists_legacy_package_assets(data):
        return
    theme = data.get("project", {}).get("theme", {}) if isinstance(data.get("project"), dict) else {}
    custom_dir = theme.get("custom_dir") if isinstance(theme, dict) else None
    templates_dir = repo_root / str(custom_dir) if isinstance(custom_dir, str) and custom_dir.strip() else None
    main_html = templates_dir / "main.html" if templates_dir is not None else None
    label = f"{custom_dir.strip('/')}/main.html" if main_html is not None else "overrides/main.html"

    if main_html is not None and main_html.is_file():
        original = main_html.read_text(encoding="utf-8")
        migrated, replaced = migrate_template_asset_lists(original)
        if replaced and migrated != original:
            main_html.write_text(migrated, encoding="utf-8")
            print(
                f"[knotis] Updated {label}: {replaced} Knotis asset list(s) now load from the package "
                "runtime asset list (one-time migration; your other template content is unchanged).",
                file=sys.stderr,
            )

    template_text = ""
    if templates_dir is not None and templates_dir.is_dir():
        template_text = "\n".join(
            path.read_text(encoding="utf-8", errors="replace") for path in sorted(templates_dir.rglob("*.html"))
        )
    if RUNTIME_ASSETS_CONFIG_KEY in template_text:
        return
    expected = [path for paths in runtime_assets_config().values() for path in paths]
    missing = [path for path in expected if path not in template_text]
    if missing:
        print(
            f"[knotis] WARNING: {label} does not load Knotis runtime assets from "
            f"config.extra.{RUNTIME_ASSETS_CONFIG_KEY}, so these package assets are not loaded: "
            f"{', '.join(missing)}. Replace the template's Knotis asset list with the knotis_assets "
            "loops in the packaged scaffold (knotis/scaffold/overrides/main.html), or add the missing "
            "paths yourself.",
            file=sys.stderr,
        )


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
    text = reconcile_legacy_extra_assets(text)
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
    sync_site_template_runtime_assets(repo_root, _read_zensical_dict_from_text(original))
    text = inject_slide_markers_extension(original)
    text = apply_knotis_zensical_overrides(text, repo_root)
    text = inject_runtime_assets_config(text)
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
