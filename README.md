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
#### Daily update strategy (GitHub Actions)

Daily GitHub Action uses arXiv as the search source, and enables `--skip-arxiv-in-a` and `--refilter-all` by default.

This means:
- arXiv is still used for discovery.
- Papers that match raw group A cannot pass filtering by arXiv fallback alone.
- A-related papers must match a real TH_CPL / THP_CPL venue.
- B/C papers may still use arXiv fallback when no real venue is available, unless future rules change.

#### Local full rebuild commands

Without PDF download:

```bash
node scripts/embedded-ai/update-papers.mjs --source arxiv --force-full-search --year-low 2025 --skip-arxiv-in-a --refilter-all --skip-download --clear-cache 2>&1 | tee run_2025_full.log
```

With PDF download:

```bash
node scripts/embedded-ai/update-papers.mjs --source arxiv --force-full-search --year-low 2025 --skip-arxiv-in-a --refilter-all --no-skip-download --clear-cache 2>&1 | tee run_2025_full.log
```

#### Local daily incremental simulation

```bash
node scripts/embedded-ai/update-papers.mjs --source arxiv --skip-arxiv-in-a --refilter-all --skip-download
```

#### Files that should be committed

- `_data/embedded_ai_papers.json`
- `artifacts/*.bib`
- `google_scholar_crawler/cache/normalized_papers.json`
- `google_scholar_crawler/state/last_search_state.json`
- `google_scholar_crawler/state/classification_checkpoint.json`
- `google_scholar_crawler/state/download_state.json` (if download step is used)
- `google_scholar_crawler/state/download_quota.json` (if download step is used)

#### Files that should NOT be committed

- `google_scholar_crawler/cache/arxiv/*.json`
- `google_scholar_crawler/state/source_stats.json`
- `google_scholar_crawler/state/*.tmp`
- `run_*.log`
- `*.log`

#### Why cache/state directories must not be globally ignored

Do not ignore or delete the entire `google_scholar_crawler/cache` or `google_scholar_crawler/state` directories.

Some files inside them are required for daily incremental updates:
- `normalized_papers.json` keeps the canonical historical paper set.
- `last_search_state.json` stores arXiv incremental watermarks.
- `classification_checkpoint.json` caches classification results.

#### Validation commands

Filter bucket distribution:

```bash
jq '
[
    .categories[].papers[].filter_bucket
]
| group_by(.)
| map({bucket: .[0], count: length})
' _data/embedded_ai_papers.json
```

TH_CPL matched count:

```bash
jq '
[
    .categories[].papers[]
    | select((.matched_th_cpl_level // "") != "")
]
| length
' _data/embedded_ai_papers.json
```

Matched venue distribution:

```bash
jq '
[
    .categories[].papers[]
    | select((.matched_venue // "") != "")
    | .matched_venue
]
| group_by(.)
| map({venue: .[0], count: length})
| sort_by(-.count)
' _data/embedded_ai_papers.json
```

Check source_stats total consistency with final output:

```bash
jq '.stats.after_filter, .stats.classification.total, .stats.source_stats.total_summary.total' _data/embedded_ai_papers.json
```

#### arXiv Full Search Semantics

When using `--force-full-search`, the pipeline enforces **all-or-nothing semantics**:

1. **Complete Success**: All three groups (A, B, C) fetch their complete result sets from arXiv. The watermark is updated, and output files are written.
2. **Partial Failure**: If any group fails mid-pagination (e.g., arXiv API returns 503 errors after fetching 300 of 6469 papers), the pipeline **aborts entirely**:
   - No watermark is updated
   - No final JSON output is written
   - No BibTeX artifacts are generated
   - Exit code is non-zero
   - Error details are logged including the failed group, page where failure occurred, and error message

This prevents data corruption from partial results being silently accepted as complete.

**Troubleshooting Partial Search Failures**:

Detect if the pipeline failed due to incomplete search:

```bash
# Check last run log for CRITICAL arXiv messages
grep "CRITICAL: Incomplete full search" run_2025_full.log

# Check per-group completion status in logs
grep "\[arxiv-bridge\].*failed" run_2025_full.log

# Verify watermark was not updated after failed run
cat google_scholar_crawler/state/last_search_state.json
```

If a full search fails, you have two options:

1. **Retry the full search** later when the arXiv API is stable
2. **Split by year range** to reduce pages per request:
   ```bash
   node scripts/embedded-ai/update-papers.mjs --source arxiv --force-full-search --year-low 2025 --year-high 2025 --skip-download --clear-cache
   node scripts/embedded-ai/update-papers.mjs --source arxiv --force-full-search --year-low 2024 --year-high 2024 --skip-download
   ```

#### GitHub Actions
- Workflow file: `.github/workflows/update-papers.yml`
- Runs daily on schedule and supports manual dispatch inputs:
    - `year_low`
    - `year_high`
    - `total_limit`
    - `skip_download` (default `true`)

### Acknowledgements

This project uses the source code from the following repositories:

* [pages-themes/minimal](https://github.com/pages-themes/minimal)

* [orderedlist/minimal](https://github.com/orderedlist/minimal)

* [al-folio](https://github.com/alshedivat/al-folio)

* [AcadHomepage](https://github.com/RayeRen/acad-homepage.github.io)
