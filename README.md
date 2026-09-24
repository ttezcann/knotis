# Knotis

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/0-logo/knotis-lockup-dark.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/0-logo/knotis-lockup.png" alt="Knotis logo" width="260">
  </picture>
</p>


**Connected instructional materials from Markdown.**

Knotis is a teaching-focused extension to [Zensical](https://zensical.org/), distributed as a Python package with a command-line interface.

It helps instructors publish course notes in which readers can follow a lesson sequence, revisit concepts across pages, inspect their relationships and retrieve particular kinds of teaching content.

Instructors maintain Markdown files. Knotis indexes wikilinks such as `[[concept]]`, outlining structure and content tags, then generates the Pane, Site graph, Page graph, Concept graph, Glossary and Search features, with optional Slide mode, alongside the rendered pages.

[Documentation](https://knotis-docs.ttezcan.com/) | [Source code](https://github.com/ttezcann/knotis) | [PyPI](https://pypi.org/project/knotis/) | [Knotis VS Code extension](https://marketplace.visualstudio.com/items?itemName=ttezcann.knotis-preview)

## Documentation and Sample Site

- [Knotis documentation](https://knotis-docs.ttezcan.com/): a functioning Knotis site with installation, authoring, feature and publishing guides.
- [Regression Modeling in Social Sciences](https://ssric-reg.ttezcan.com/): data analysis teaching materials.

## Features

- **Outlining:** headings and nested lists organize explanations, code, tables, images and media.
- **Wikilinks:** `[[concept]]` markers connect occurrences across pages; aliases change the displayed wording without creating a separate concept.
- **Panes:** inspect occurrences with surrounding teaching material, follow related concepts and return through pane history.
- **Graphs:** explore site, page and concept views derived from authored structure and navigation.
- **Content tags:** collect material such as `#code`, `#output` and `#interpretation` across the site.
- **Glossary:** a site-wide list of every concept, generated from the wikilinks.
- **Slide mode:** present lesson content without maintaining a separate slide deck.
- **Search:** find concepts and sections, narrow searches with content tags.
- **Read aloud:** a built-in text-to-speech control for pages.
- **Supporting media tools:** browser-based read-aloud, image viewing, GIF/MP4 playback controls and caption support.

An optional [Knotis VS Code extension](https://github.com/ttezcann/knotis-vscode) supports authoring and previewing.

## Requirements

- Python **3.11 or later**, with `pip` and virtual-environment support.
- A terminal and a plain-text editor.
- Git is needed only for source-based installation or Git-based publishing.

Knotis depends on Zensical. Installing Knotis installs its declared dependencies; do not independently upgrade Zensical beyond the version required by your Knotis release.

## Installation

Create a working directory and an isolated Python environment. Keep the site in its own subdirectory.

### macOS and Linux

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install knotis
```

### Windows PowerShell

```powershell
python3 -m venv .venv
.venv\Scripts\activate
pip install knotis
```

## Upgrade
```bash
pip install --upgrade knotis
```

Review the [GitHub Releases page](https://github.com/ttezcann/knotis/releases) before upgrading.

It lists new features, renamed settings, removed settings, and any steps needed after an update.

## Quick Start

With the environment active, create and preview a new site:

```bash
mkdir my-course
cd my-course
knotis new .
knotis serve
```

`knotis new .` creates a starter configuration, sample pages and supporting files, then performs an initial build. Use an empty site folder; the command refuses to scaffold over an existing `zensical.toml`.

Open the URL printed in the terminal, normally `http://localhost:8000/`. The server watches source changes and refreshes the local preview. Stop it with `Ctrl+C`.

To build without starting a server:

```bash
knotis build
```

Run build and serve commands from the site directory containing `zensical.toml`. The finished website is written to `site/`.


## Configuration and Site Files

For newly scaffolded sites, the main files and directories are:

| Path | Purpose |
| --- | --- |
| `zensical.toml` | Site identity, navigation, theme and Knotis feature settings. |
| `docs/` | Authored Markdown pages. |
| `docs/assets/` | Author-managed images, media, data and downloads. |
| `docs/explore/` | Entry pages for the site graph, glossary and content tags. |
| `docs/stylesheets/knotis-theme.css` | Site-specific appearance overrides. |
| `overrides/` | Theme templates and hooks. |
| `.knotis/assets/` | Generated runtime and index staging files. |
| `site/` | Generated website, including `assets/knotis/`. |


## License
Knotis is released under the [MIT License](LICENSE.txt).

