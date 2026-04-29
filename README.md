# yaoyao-liu.github.io

[![LICENSE](https://img.shields.io/github/license/yaoyao-liu/minimal-light?style=flat-square&logo=creative-commons&color=EF9421)](https://github.com/yaoyao-liu/yaoyao-liu.github.io/blob/main/LICENSE)

This is the latest version of my homepage's source code. Feel free to use and share.
<br />
For more details, please refer to this repository: <https://github.com/yaoyao-liu/minimal-light>.

### Using Locally with Jekyll

You need to install [Ruby](https://www.ruby-lang.org/en/) and [Jekyll](https://jekyllrb.com/) fisrt.

Install and run:

```bash
bundle install
bundle exec jekyll serve --livereload
```
View the live page using `localhost`:
<http://localhost:4000>. You can get the html files in the `_site` folder.

### Google Scholar Crawler

The instructions for the Google Scholar crawler can be found in [this repository](https://github.com/RayeRen/acad-homepage.github.io).
<br>
Before using that, you need to change the Google Scholar ID in the following file:
https://github.com/yaoyao-liu/yaoyao-liu.github.io/blob/7d16d828a229580815428782fb74d937710eb50e/google_scholar_crawler/main.py#L7

### Embedded AI Paper Updater

This project includes an automated updater for the **Embedded AI** page.

If you only want to run the updater manually in the current terminal session, you can use the following steps.

First, go to the updater folder and install the required dependencies:

```bash
cd scripts/embedded-ai
npm install
```

Then configure the API key in the current terminal session only.
For example, in PowerShell:

```bash
$env:GEMINI_API_KEY="your_gemini_key"
$env:OPENROUTER_API_KEY="your_openrouter_key"
$env:TENCENT_TOKENHUB_API_KEY="your_tencent_tokenhub_key"

$env:GEMINI_MODEL="gemini-2.5-flash"
$env:OPENROUTER_MODEL="openrouter/free"
$env:TENCENT_TOKENHUB_MODEL="hunyuan-2.0-instruct-20251111"
```
Long-Term Usage：

```bash
    setx GEMINI_API_KEY "your_gemini_key"
    setx OPENROUTER_API_KEY "your_openrouter_key"
    setx TENCENT_TOKENHUB_API_KEY "your_tencent_tokenhub_key"

    setx GEMINI_MODEL "gemini-2.5-flash"
    setx OPENROUTER_MODEL "openrouter/free"
    setx TENCENT_TOKENHUB_MODEL "hunyuan-2.0-instruct-20251111"
```
After that, run:

```bash
npm run update-papers
```

#### Default behavior (current)
- Default source: arXiv (`--source arxiv`)
- Default download mode: skip PDF download
- Default search mode: incremental (when watermark exists)

#### Incremental search state files
- `google_scholar_crawler/state/last_search_state.json`: arXiv search watermark state
- `google_scholar_crawler/state/classification_checkpoint.json`: classification checkpoint/cache
- `google_scholar_crawler/cache/normalized_papers.json`: merged historical + incremental normalized papers

#### Example commands
```bash
# 1) Default incremental update
npm run update-papers

# 2) Incremental update with year window
npm run update-papers -- --source arxiv --year-low 2024 --year-high 2026

# 3) Force full search rebuild
npm run update-papers -- --source arxiv --force-full-search
```

#### Reset incremental watermark
Delete `google_scholar_crawler/state/last_search_state.json` and run updater again.

#### GitHub Actions
- Workflow file: `.github/workflows/update-papers.yml`
- Runs daily on schedule and supports manual dispatch inputs:
    - `year_low`
    - `year_high`
    - `total_limit`
    - `skip_download` (default `true`)

To verify automatic runs, check the latest run in Actions and confirm logs include search mode (`full` / `incremental`) and updater summary.

### Acknowledgements

This project uses the source code from the following repositories:

* [pages-themes/minimal](https://github.com/pages-themes/minimal)

* [orderedlist/minimal](https://github.com/orderedlist/minimal)

* [al-folio](https://github.com/alshedivat/al-folio)

* [AcadHomepage](https://github.com/RayeRen/acad-homepage.github.io)
