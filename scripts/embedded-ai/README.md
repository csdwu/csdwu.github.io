# Embedded AI Paper Discovery Pipeline

## Overview

This pipeline automates discovery, filtering, classification, and publication of Embedded AI papers.

Current default behavior:
- source defaults to arXiv (`--source arxiv`)
- PDF download is skipped by default (`--skip-download` behavior is default-on)
- search is incremental when watermark state exists
- historical papers are preserved in final output JSON

## Data Flow

```
Search Sources → Normalization → Deduplication → Filtering → Classification → Output Generation
     ↓              ↓              ↓              ↓              ↓              ↓
  Scholar/arXiv  set-ops.mjs   set-ops.mjs  filter-rules.mjs classify.mjs  output-builder.mjs
```

### Key Features

- **Incremental arXiv search**: watermark-based (`last_search_state.json`) with overlap buffer
- **Historical-safe merge**: merge old normalized papers with incremental results before final output
- **Classification checkpoint**: only truly new papers enter classification
- **Robust deduplication**: DOI > arXiv ID > title+year > hash fallback
- **Intelligent filtering**: TH-CPL relevance and category-based rules
- **LLM classification**: Tencent TokenHub with heuristic fallback
- **Progress tracking**: Real-time terminal progress with GitHub Actions compatibility
- **Artifact generation**: JSON, BibTeX, PDF downloads

## Modules

### update-papers.mjs
Main orchestrator that runs the full pipeline.

### scholar-bridge.mjs
Handles Google Scholar search via scholarly library, caching, and normalization.

### arxiv-bridge.mjs
Manages arXiv API queries, pagination, and paper extraction.

### set-ops.mjs
Performs deduplication using stable keys (DOI/arXiv/title+year/hash).

### filter-rules.mjs
Applies TH-CPL and arXiv category filters to reduce noise.

### classify.mjs
Classifies papers into categories/tags using LLM or heuristics, with checkpoint persistence.

### output-builder.mjs
Generates sorted JSON output and BibTeX artifacts.

### progress.mjs
Provides progress reporting for classification.

### bibtex-builder.mjs
Creates category-specific BibTeX files.

### config.mjs
Central configuration for paths, constants, and queries.

## Deduplication Logic

Papers are deduplicated using a hierarchical key system:

1. **DOI**: `doi:{normalized_doi}`
2. **arXiv ID**: `arxiv:{normalized_id}`
3. **Title + Year**: `title-year:{title}::{year}` or `title:{title}`
4. **Fallback Hash**: `hash:{sha1_hash}` of title+year+urls

This ensures stable identification across sources and updates.

## Incremental Search And State

### Search Watermark State
- File: `google_scholar_crawler/state/last_search_state.json`
- Source: `arxiv`
- Fields include:
  - `last_successful_search_at`
  - `source`
  - `overlap_buffer_days`
  - per-group `groups.A/B/C.last_successful_search_at`

### How Incremental Search Works
1. If no `last_search_state.json` exists, pipeline runs full search for initialization.
2. If state exists, each group uses its watermark and applies overlap buffer (default 1 day).
3. Incremental query uses `lastUpdatedDate` range filtering.
4. Overlap duplicates are removed by existing dedupe logic.
5. After successful run, watermark is updated.

### Historical Merge Behavior
1. Load historical `google_scholar_crawler/cache/normalized_papers.json`.
2. Merge historical papers with this run's filtered incremental papers.
3. Only papers not seen in historical set are sent to classification.
4. Keep output compatible with `_data/embedded_ai_papers.json` frontend schema.

## Incremental Classification Checkpoint

### Checkpoint File
- Location: `google_scholar_crawler/state/classification_checkpoint.json`
- Format: `{ "dedupe_key": { classification_result, dedupe_key, checkpoint_saved_at } }`

### Process
1. Load checkpoint on startup
2. For each truly new paper, call classifier
3. Reuse existing classifications when available
4. Persist checkpoint atomically after each successful classification
5. Persist each successful classification immediately (atomic write)
6. Merge historical + incremental results for output

### Benefits
- Avoids re-processing historical papers
- Reduces API costs and latency
- Supports interruption recovery
- Maintains data consistency

## Classification Progress

Terminal output includes:
- Total papers, reused count, new count
- Completed/failed counters
- Provider usage (tencent/heuristic/fallback)
- Elapsed time and ETA
- Current paper title

GitHub Actions compatible with line-by-line logs.

## Local Development

### Prerequisites
- Node.js 18+
- Python 3.8+ with scholarly
- API keys for LLM providers

### Setup
```bash
cd scripts/embedded-ai
npm install
pip install -r ../../google_scholar_crawler/requirements.txt
```

### Run Full Pipeline
```bash
node update-papers.mjs --source arxiv
```

### Force Full Search Rebuild
```bash
node update-papers.mjs --source arxiv --force-full-search
```

### Run Classification Only
```bash
node update-papers.mjs --skip-search --skip-download
```

### Debug Single Paper
```bash
node update-papers.mjs --source arxiv --groups A --max-results 5
```

## GitHub Actions Automation

### Workflow: update-papers.yml
- Runs daily (`cron: 0 0 * * *`, UTC)
- Defaults to arXiv-only search
- Defaults to skip PDF download
- Uses search watermark + overlap buffer for incremental search
- Uses checkpoint for incremental classification
- Commits changes to:
  - `_data/embedded_ai_papers.json`
  - `google_scholar_crawler/cache/normalized_papers.json`
  - `google_scholar_crawler/state/last_search_state.json`
  - `google_scholar_crawler/state/classification_checkpoint.json`
  - `google_scholar_crawler/state/download_state.json`
  - `google_scholar_crawler/state/download_quota.json`
  - `artifacts/*.bib`

### Manual Trigger
Use `workflow_dispatch` with:
- `year_low`
- `year_high`
- `total_limit`
- `skip_download` (default `true`)

### How To Verify Scheduled Run
1. Open GitHub Actions `Update papers daily` workflow history.
2. Check latest scheduled run status is `success`.
3. In logs, confirm printed search mode (`full` or `incremental`) and skip-download behavior.
4. Confirm recent commit updates `_data/embedded_ai_papers.json` and state files.

### Only New Papers Logic
- Compares filtered papers against checkpoint
- Reuses complete classifications
- Only calls LLM for new papers
- Preserves all historical data in output

## Failure Recovery

### Single Paper Failure
- Logged with title/ID/error
- Does not stop batch processing
- Can be retried in next run

### Checkpoint Corruption
- Graceful fallback to empty checkpoint
- Re-classify all papers if needed

### Network/API Issues
- Retries with backoff
- Fallback to heuristic classification

## Persisted Files

The pipeline updates these files in the repository:

- `_data/embedded_ai_papers.json`: Frontend data
- `google_scholar_crawler/cache/normalized_papers.json`: Raw normalized papers
- `google_scholar_crawler/state/classification_checkpoint.json`: Classification cache
- `google_scholar_crawler/state/last_search_state.json`: arXiv incremental watermark state
- `google_scholar_crawler/state/download_state.json`: Download status
- `google_scholar_crawler/state/download_quota.json`: Download limits
- `artifacts/efficient_model_design.bib`: BibTeX by category
- `artifacts/novel_architecture_accelerator.bib`
- `artifacts/embedded_ai_applications.bib`

## Common Commands

```bash
# 1) Default incremental update (arXiv only, skip download by default)
npm run update-papers

# 2) Incremental update with year range
npm run update-papers -- --source arxiv --year-low 2024 --year-high 2026

# 3) Force full search (ignore watermark)
npm run update-papers -- --source arxiv --force-full-search

# Skip search, re-classify existing
npm run update-papers -- --skip-search

# Heuristic only (no LLM)
npm run update-papers -- --heuristic-only

# Specific groups
npm run update-papers -- --groups A,B

# Year filter
npm run update-papers -- --year-low 2024

# Dry run downloads
npm run update-papers -- --download-dry-run
```

## Debugging

### Check Logs
- Classification progress in stderr
- Step-by-step logs in stdout
- Errors include paper titles and reasons

### Inspect Checkpoint
```bash
cat google_scholar_crawler/state/classification_checkpoint.json | jq '. | length'
```

### Manual Classification Test
Modify `classify.mjs` to add debug logging.

### Reset State
Delete `google_scholar_crawler/state/last_search_state.json` to reset incremental search watermark.

If you also want to reset classification cache, delete:
- `google_scholar_crawler/state/classification_checkpoint.json`

### 1. Source Search Modules

#### Scholar Search (`scholar-bridge.mjs`)
- Executes Python Google Scholar crawler (`google_scholar_crawler/main.py`)
- Uses `scholarly` library (requires `scholarly` Python package)
- Supports query list per group with fallback queries
- Outputs: `cache/scholar_[A|B|C]_raw.json`
- Format: Complex JSON with metadata + papers array

#### arXiv Search (`arxiv-bridge.mjs`)
- Executes Python arXiv API client (`google_scholar_crawler/arxiv_search.py`)
- Uses official arXiv API (no external Python deps except stdlib)
- Queries defined in `config.mjs` ARXIV_QUERY_GROUPS
- Supports category filtering + full-text search
- Outputs: `cache/arxiv/arxiv_[A|B|C]_raw.json`
- Format: JSON array of papers

### 2. Orchestration Layer (`update-papers.mjs`)

Main entry point that coordinates the entire pipeline:

```javascript
// Parameter validation & parsing
parseCliArgs(argv)
  ├─ source: 'scholar' | 'arxiv' | 'all' (default: 'arxiv')
  ├─ groups: ['A', 'B', 'C'] (default: all)
  ├─ skipSearch: boolean
  ├─ skipDownload: boolean
  ├─ proxyMode: 'none' | 'free' | 'single'
  └─ ... (see --help)

// Main execution flow
main()
  └─ executeSearchStep()
     ├─ if source='all': run both Scholar + arXiv, merge results
     ├─ if source='scholar': run Scholar only
     └─ if source='arxiv': run arXiv only
  └─ runSetOperations()          // Dedup + merge (set-ops.mjs)
  └─ applyFilterRules()          // Filter (filter-rules.mjs)
  └─ executeClassificationStep() // Classify (classify.mjs)
  └─ buildAndWriteOutputJson()   // Export (output-builder.mjs)
  └─ generateBibtexArtifacts()   // BibTeX (bibtex-builder.mjs)
  └─ executeDownloadStep()       // Download PDFs (downloader.py)
```

### 3. Data Normalization (`set-ops.mjs`)

Handles:
- Paper object normalization (consistent field names)
- Within-group deduplication (DOI > arXiv ID > title+year hash)
- Cross-group merging (identify same paper from different queries)
- Search set tracking (which groups contain each paper)
- Source field preservation (mark papers as 'scholar' or 'arxiv')

**Key Function**: `extractItemsFromGroupPayload(payload)`
- Handles both array and object payloads for compatibility
- Extracts from `papers` or `items` fields if present

### 4. Filtering (`filter-rules.mjs`)

Applies multi-layer filtering:
- **TH-CPL signal**: Post-filter logic per group (keep only TH-CPL papers in group A)
- **arXiv categories**: Paper categories already filtered in API query
- **Post-filter**: Custom rules per group/provider

### 5. Classification (`classify.mjs`)

Two-tier classification:
1. **Tencent TokenHub LLM** (primary): Fast parallel classification via API
2. **Heuristic fallback**: Rule-based keywords if TokenHub fails/disabled

Output categories:
- `MODEL`: Efficient Model Design and Optimization
- `ARCH`: Novel Computing Architectures
- `APP`: Embedded AI Applications

### 6. Output Generation

#### Frontend JSON (`output-builder.mjs`)
- Generates `_data/embedded_ai_papers.json`
- Format: 3-category structure with top-N papers per category
- Used by Jekyll templates for rendering

#### BibTeX Artifacts (`bibtex-builder.mjs`)
- Generates category-specific `.bib` files
- Outputs: `artifacts/embedded_ai_all.bib`, category-specific bibs
- Links papers back to PDF downloads via `@misc` fields

#### PDF Downloads (`downloader.py`)
- Parallel downloads from papers' URLs (Scholar links, arXiv PDFs)
- Tracks download state and daily quota
- Outputs: `google_scholar_crawler/downloads/embedded-ai/`

## Configuration (`config.mjs`)

### Search Source Modes
```javascript
SEARCH_SOURCES = ['scholar', 'arxiv', 'all']
DEFAULT_SEARCH_SOURCE = 'arxiv'
```

### arXiv Query Groups
```javascript
ARXIV_QUERY_GROUPS = {
  A: {
    primaryQuery: '(embedded AND machine AND learning) OR (embedded AND ai)',
    categories: ['cs.AI', 'cs.LG', 'cs.AR', 'cs.CV'],
  },
  B: {
    primaryQuery: '(embedded OR edge) AND ("low power" OR "ultra-low-power" OR "energy efficient")',
    categories: ['cs.AI', 'cs.LG', 'cs.AR'],
  },
  C: {
    primaryQuery: '(tinyml OR "tiny machine learning" OR microcontroller)',
    categories: ['cs.AI', 'cs.LG', 'cs.AR', 'eess.SY'],
  },
}
```

### Directory Structure
```
google_scholar_crawler/
  ├─ cache/
  │  ├─ scholar_A_raw.json     # Scholar group A results
  │  ├─ scholar_B_raw.json
  │  ├─ scholar_C_raw.json
  │  ├─ arxiv/                 # arXiv cache directory
  │  │  ├─ arxiv_A_raw.json
  │  │  ├─ arxiv_B_raw.json
  │  │  └─ arxiv_C_raw.json
  │  ├─ normalized_papers.json # After dedup + merge
  │  └─ state/
  │     ├─ download_state.json
  │     └─ download_quota.json
  ├─ downloads/
  │  └─ embedded-ai/           # Downloaded PDFs
  ├─ main.py                   # Python entry point
  ├─ arxiv_search.py          # arXiv API client
  ├─ downloader.py
  └─ ... (Scholar crawler scripts)

scripts/embedded-ai/
  ├─ config.mjs                # Configuration
  ├─ update-papers.mjs         # Main orchestrator
  ├─ scholar-bridge.mjs        # Scholar Python bridge
  ├─ arxiv-bridge.mjs          # arXiv Python bridge
  ├─ set-ops.mjs               # Dedup + merge
  ├─ filter-rules.mjs          # Filtering logic
  ├─ classify.mjs              # Classification
  ├─ output-builder.mjs        # JSON generation
  ├─ bibtex-builder.mjs        # BibTeX generation
  └─ README.md                 # This file
```

## Usage


### Example Command
```bash
  node scripts/embedded-ai/update-papers.mjs --skip-search --skip-download --source arxiv --year-low 2025 --skip-arxiv-in-a
  node scripts/embedded-ai/update-papers.mjs --skip-download --source arxiv --year-low 2025  --skip-arxiv-in-a
```
### Display Help
```bash
node scripts/embedded-ai/update-papers.mjs --help
```

### Run Full Pipeline (arXiv only, default)
```bash
node scripts/embedded-ai/update-papers.mjs --source arxiv
```

### Run Full Pipeline (Scholar only)
```bash
node scripts/embedded-ai/update-papers.mjs --source scholar
```

### Run Full Pipeline (Both sources, merged)
```bash
node scripts/embedded-ai/update-papers.mjs --source all
```

### Skip Search, Reuse Cache
```bash
node scripts/embedded-ai/update-papers.mjs --source all --skip-search --skip-download
```

### Dry-run Downloads
```bash
node scripts/embedded-ai/update-papers.mjs --source arxiv --download-dry-run --download-max 5
```

### Process Only Group A+B
```bash
node scripts/embedded-ai/update-papers.mjs --groups A,B --skip-search --skip-download
```

### Use Scholar with Proxy
```bash
node scripts/embedded-ai/update-papers.mjs \
  --source scholar \
  --proxy-mode single \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890
```

## Key Implementation Patterns

### 1. Multi-Source Merging
When `--source all` is specified, the pipeline:
1. Loads/runs Scholar search for all groups → `groupedData['scholar']`
2. Loads/runs arXiv search for all groups → `groupedData['arxiv']`
3. Merges papers from both sources into single arrays per group
4. Passes merged arrays downstream (set-ops doesn't care about source)

**Important**: Each paper keeps its `source` field ('scholar' or 'arxiv') through normalization for downstream filter rules and analytics.

### 2. Payload Flexibility
Raw cache files may contain:
- Simple arrays: `[{paper1}, {paper2}, ...]`
- Metadata objects: `{command, queries, stats, papers: [...]}`
- Objects with items: `{items: [...]}`

`extractItemsFromPayload()` normalizes all formats to arrays before processing.

### 3. Source Field Preservation
```javascript
// In set-ops.mjs normalization
source: toTrimmedString(paper.source) || 'google_scholar'
```
- If incoming paper has source field → keep it ('arxiv')
- If missing → default to 'google_scholar' (backward compat)

### 4. Minimal Invasiveness
- No changes to downstream modules (set-ops, classify, output-builder)
- Single dispatch point in `executeSearchStep()`
- Backward compatible: `--source arxiv` is new default, Scholar still works

## Testing the Multi-Source Feature

### Test 1: Parameter Validation
```bash
node scripts/embedded-ai/update-papers.mjs --source invalid
# Expected: Error "Invalid --source "invalid". Expected one of: scholar, arxiv, all."
```

### Test 2: arXiv Only
```bash
node scripts/embedded-ai/update-papers.mjs --source arxiv --skip-search --skip-download
# Expected: Logs show "source(s): arxiv"
```

### Test 3: Scholar Only
```bash
node scripts/embedded-ai/update-papers.mjs --source scholar --skip-search --skip-download
# Expected: Same logs/behavior as before update
```

### Test 4: Multi-Source Merge
```bash
node scripts/embedded-ai/update-papers.mjs --source all --skip-search --skip-download
# Expected: Logs show "source(s): scholar, arxiv"
```

### Test 5: API Integration (with network)
```bash
python google_scholar_crawler/arxiv_search.py \
  --query "embedded AND ai" \
  --categories "cs.AI,cs.LG" \
  --max-results 5
# Expected: JSON output with paper metadata
```

## Troubleshooting

### "Cannot Fetch from Google Scholar"
- Scholar is blocked or requires proxy
- Solution: Use `--proxy-mode free` or `--source arxiv`

### "Network error" on arXiv search
- Environment network restrictions
- Solution: Use `--source scholar` if available, or `--skip-search --skip-download`

### "No Scholar results available"
- No cached Scholar data and search skipped
- Solution: Remove `--skip-search` or manually run Scholar search

### Empty arXiv cache files
- arXiv queries not run yet
- Solution: Remove `--skip-search` to populate cache

## GitHub Actions Integration

Add `--source all` to your CI/CD workflow to search both sources:

```yaml
- name: Update Embedded AI Papers
  run: |
    node scripts/embedded-ai/update-papers.mjs \
      --source all \
      --groups A,B,C \
      --concurrency 5
```

Add `--source arxiv` if Scholar is frequently blocked:

```yaml
- name: Update via arXiv (fallback)
  run: |
    node scripts/embedded-ai/update-papers.mjs \
      --source arxiv \
      --skip-download
```

## File Formats

### Scholar Raw Cache (`scholar_A_raw.json`)
```json
{
  "command": "keyword-search",
  "group": "A",
  "generated_at": "2024-04-19T...",
  "queries": ["query1", "query2"],
  "papers": [
    {
      "title": "...",
      "authors": [],
      "year": 2024,
      "pub_url": "...",
      "scholar_url": "...",
      "snippet": "..."
    }
  ]
}
```

### arXiv Raw Cache (`arxiv_A_raw.json`)
```json
[
  {
    "arxiv_id": "2404.12345",
    "title": "...",
    "authors": ["Author 1", "Author 2"],
    "year": 2024,
    "abstract": "...",
    "arxiv_url": "https://arxiv.org/abs/2404.12345",
    "pdf_url": "https://arxiv.org/pdf/2404.12345.pdf",
    "source": "arxiv",
    "venue": "arXiv"
  }
]
```

### Normalized Papers (`normalized_papers.json`)
```json
[
  {
    "id": "sha1-hash",
    "source": "arxiv",
    "title": "...",
    "authors": [],
    "year": 2024,
    "arxiv_id": "2404.12345",
    "urls": {
      "arxiv": "https://...",
      "pdf": "https://..."
    },
    "search_sets_final": ["A", "C"],
    ...
  }
]
```

## Performance Notes

- Scholar search: ~30-120 papers per group, 3s sleep between requests → 10-15 min per group
- arXiv search: ~200 papers per group, single API call → <1s per group
- Classification: ~50 papers per minute with 5 concurrency at TokenHub
- Total pipeline: 20-30 minutes for Scholar, 5-15 minutes for arXiv, 15-20 minutes for both

Use `--groups A` to test specific groups first, or `--skip-search --skip-download` to test downstream processing.
