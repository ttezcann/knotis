# Knotis

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/0-logo/knotis-lockup-dark.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/0-logo/knotis-lockup.png" alt="Knotis logo" width="260">
  </picture>
</p>
<p align="center">
  <strong>
    Connected instructional materials from Markdown
  </strong>
</p>

<p align="center">
  <a href="https://pypi.org/project/knotis/"><img
    src="https://img.shields.io/pypi/v/knotis"
    alt="PyPI"
  /></a>
  <a href="https://www.python.org/"><img
    src="https://img.shields.io/badge/Python-%E2%89%A53.11-3776AB"
    alt="Python 3.11 or later"
  /></a>
  <a href="LICENSE.txt"><img
    src="https://img.shields.io/badge/License-MIT-blue.svg"
    alt="MIT License"
  /></a>
  <a href="https://doi.org/10.5281/zenodo.22983153"><img
    src="https://zenodo.org/badge/DOI/10.5281/zenodo.22983153.svg"
    alt="DOI 10.5281/zenodo.22983153"
  /></a>
</p>

<p align="center">
  <a href="https://knotis-docs.ttezcan.com/"><img
    src="https://img.shields.io/badge/Documentation-Read-brightgreen"
    alt="Knotis documentation"
  /></a>
  <a href="https://ssric-reg.ttezcan.com/"><img
    src="https://img.shields.io/badge/Demo-View%20site-brightgreen"
    alt="View the demonstration site"
  /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=ttezcann.knotis-preview"><img
    src="https://img.shields.io/badge/VS%20Code-Install%20extension-007ACC"
    alt="Install the Knotis VS Code extension"
  /></a>
</p>


Knotis is a teaching-focused extension to [Zensical](https://zensical.org/), distributed as a Python package with a command-line interface.

It helps instructors publish course notes in which readers can follow a lesson sequence, revisit concepts across pages, inspect their relationships and retrieve particular kinds of teaching content.

Instructors maintain Markdown files. Knotis indexes wikilinks such as `[[concept]]`, outline structure and content tags, then uses them to power contextual panes, Site graph, Page graph, Concept graph, Glossary and Search features, with optional Slide mode, alongside the rendered pages.

## Documentation and Demonstration Site

- [Knotis documentation](https://knotis-docs.ttezcan.com/): a functioning Knotis site with installation, authoring, feature and publishing guides.
- [Regression Modeling in Social Sciences](https://ssric-reg.ttezcan.com/): data analysis teaching materials.


## Features

<table>
  <tr>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/outlining-feature/">Outlining</a></strong><br>
      Headings and nested lists organize explanations, code, tables, images and media.
    </td>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/wikilinks-feature/">Wikilinks</a></strong><br>
      <code>[[Concept]]</code> markers connect occurrences across pages.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/pane-feature/">Pane</a></strong><br>
      Inspect occurrences with surrounding teaching material, follow related concepts and return through pane history.
    </td>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/graphs-feature/">Graphs</a></strong><br>
      Explore site, page and concept views derived from authored structure and navigation.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/content-tags-feature/">Content tags</a></strong><br>
      Collect material such as <code>#code</code>, <code>#formula</code> and <code>#discussion</code> across the site.
    </td>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/glossary-feature/">Glossary</a></strong><br>
      A site-wide index of concepts generated from wikilinks.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/slide-mode-feature/">Slide mode</a></strong><br>
      Present lesson content without maintaining a separate slide deck.
    </td>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/search-feature/">Search</a></strong><br>
      Find concepts and sections, narrow searches with content tags.
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/read-aloud-feature/">Read aloud</a></strong><br>
      A built-in text-to-speech control for pages.
    </td>
    <td width="50%">
      <strong><a href="https://knotis-docs.ttezcan.com/features/video-controls-feature/">Supporting media tools</a></strong><br>
      Image viewing, GIF/MP4 playback controls and caption support.
    </td>
  </tr>
</table>

<p>
  <img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/vscode/vscode-original.svg"
       alt=""
       width="18">
  An optional <a href="https://github.com/ttezcann/knotis-vscode">Knotis VS Code extension</a>
  supports authoring and previewing.
</p>

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

### Windows

```console
python -m venv .venv
.venv\Scripts\activate
pip install knotis
```

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

## Screenshots

### Pane

Clicking a wikilink opens a pane with the concept's surrounding teaching material, relationships and path through the course.

[Read the Pane feature guide](https://knotis-docs.ttezcan.com/features/pane-feature/).

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/pane.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/pane.png" alt="A Knotis concept pane for Binary, showing its concept graph, teaching path and contextual occurrences across course pages" width="600">
  </a>
</p>

### Graphs

Knotis builds three graphs: (1) Site graph, (2) Page graph, and (3) Concept graph.

[Read the graphs feature guide](https://knotis-docs.ttezcan.com/features/graphs-feature/).

#### Site Graph

The site graph shows the whole course at a glance.

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/site-graph.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/site-graph.png" alt="Full-site concept map showing modules, resources, and linked concepts as connected nodes." width="600">
  </a>
</p>

#### Page Graph

The page graph shows the concepts on the page and how they relate to each other.

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/page-graph.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/page-graph.png" alt="Concept map for a single page, showing the page connected to its major concepts and related sub-concepts." width="600">
  </a>
</p>

#### Concept Graph

The concept graph centers on one concept.

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/concept-graph.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/concept-graph.png" alt="Concept graph centered on one concept and connected to course pages and related concepts." width="600">
  </a>
</p>

### Content Tags

Clicking a content tag chip on the home page opens the pane.

[Read the content tags feature guide](https://knotis-docs.ttezcan.com/features/content-tags-feature/).

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/content-tags.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/content-tags.png" alt="The #code content tag is selected in the navigation bar, opening a pane that lists sections across the site tagged #code." width="600">
  </a>
</p>

### Glossary

The Glossary is an auto-generated page that lists wikilink concepts found across the site.

[Read the glossary feature guide](https://knotis-docs.ttezcan.com/features/glossary-feature/).

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/glossary.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/glossary.png" alt="Glossary organized by page, listing linked concepts introduced in each course module, with options to switch to alphabetical or importance views." width="600">
  </a>
</p>

### Slide Mode

Slide mode turns a page into a full-screen slideshow without a separate deck.

[Read the slide mode feature guide](https://knotis-docs.ttezcan.com/features/slide-mode-feature/).

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/slides.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/slides.png" alt="Slide mode displays lesson content as presentation slides, with multiple slides visible in the overview and a Slideshow control at the top." width="600">
  </a>
</p>

### Concept-aware Search

Search finds concepts, pages, and teaching content across the entire site or specific sections.

[Read the search feature guide](https://knotis-docs.ttezcan.com/features/search-feature/).

<p align="center">
  <a href="https://github.com/ttezcann/knotis-docs/blob/main/docs/assets/attachments/getting-started/what-is-knotis/search-dummy-variable.png">
    <img src="https://raw.githubusercontent.com/ttezcann/knotis-docs/main/docs/assets/attachments/getting-started/what-is-knotis/search-dummy-variable.png" alt="Knotis search results for dummy variable, showing matched teaching context and related concepts" width="600">
  </a>
</p>

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

## Upgrade

```bash
pip install --upgrade knotis
```

Review the [GitHub Releases page](https://github.com/ttezcann/knotis/releases) before upgrading.

It lists new features, renamed settings, removed settings, and any steps needed after an update.

## Support

For usage questions and bug reports, open a [GitHub issue](https://github.com/ttezcann/knotis/issues).

## Citation

If you use Knotis in research or teaching, cite the archived software using [DOI 10.5281/zenodo.22983153](https://doi.org/10.5281/zenodo.22983153).

## License

Knotis is released under the [MIT License](LICENSE.txt).
