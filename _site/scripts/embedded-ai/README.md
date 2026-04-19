# Embedded AI Paper Discovery Pipeline

## Architecture Overview

The embedded AI paper discovery system automatically searches academic literature, deduplicates results, filters by relevance, and classifies papers into categories. The system supports multiple paper sources (Google Scholar, arXiv) with unified downstream processing.

### High-Level Data Flow

```
┌──────────────────────┐    ┌──────────────────────┐
│ Google Scholar       │    │ arXiv API            │
│ (via scholarly)      │    │ (official API)       │
└──────────────────────┘    └──────────────────────┘
         │                            │
         └──────────┬─────────────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │ Normalize & Dedupe  │  (set-ops.mjs)
          │ - Extract papers    │
          │ - Build keys        │
          │ - Merge duplicates  │
          └─────────────────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │ Apply Filter Rules  │  (filter-rules.mjs)
          │ - TH-CPL signal     │
          │ - arXiv category    │
          │ - Post-filter logic │
          └─────────────────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │ Classification      │  (classify.mjs)
          │ - Tencent TokenHub  │
          │ - Heuristic backup  │
          │ - Categorize papers │
          └─────────────────────┘
                    │
                    ▼
          ┌─────────────────────┐
          │ Output & Artifacts  │
          │ - JSON for frontend │  (output-builder.mjs)
          │ - BibTeX files      │  (bibtex-builder.mjs)
          │ - PDF downloads     │  (downloader.py)
          └─────────────────────┘
```

## Architecture Components

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
  ├─ arxiv_search.py          # arXiv API client (NEW)
  ├─ downloader.py
  └─ ... (Scholar crawler scripts)

scripts/embedded-ai/
  ├─ config.mjs                # Configuration
  ├─ update-papers.mjs         # Main orchestrator
  ├─ scholar-bridge.mjs        # Scholar Python bridge
  ├─ arxiv-bridge.mjs          # arXiv Python bridge (NEW)
  ├─ set-ops.mjs               # Dedup + merge
  ├─ filter-rules.mjs          # Filtering logic
  ├─ classify.mjs              # Classification
  ├─ output-builder.mjs        # JSON generation
  ├─ bibtex-builder.mjs        # BibTeX generation
  └─ README.md                 # This file
```

## Usage

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
