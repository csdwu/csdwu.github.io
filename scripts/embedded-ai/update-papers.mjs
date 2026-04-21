import path from 'node:path';

import {
  OUTPUT_JSON_PATH,
  SCHOLAR_NORMALIZED_PATH,
  DOWNLOAD_STATE_PATH,
  DOWNLOAD_QUOTA_PATH,
  GROUP_ORDER,
  SCHOLAR_MAX_RESULTS_PER_GROUP,
  SCHOLAR_REQUEST_SLEEP_SECONDS,
  SCHOLAR_RETRY_LIMIT,
  SEARCH_SOURCES,
  DEFAULT_SEARCH_SOURCE,
} from './config.mjs';
import {
  ensureScholarRuntimeDirs,
  clearScholarCache,
  loadAllScholarRawGroups,
  runAllScholarKeywordSearches,
  saveNormalizedPapers,
  runDownloadManager,
  safeReadJson,
} from './scholar-bridge.mjs';
import { runAllArxivKeywordSearches, loadAllArxivRawGroups } from './arxiv-bridge.mjs';
import { runSetOperations } from './set-ops.mjs';
import { applyFilterRulesToSetOps } from './filter-rules.mjs';
import { classifyPapers, summarizeClassificationStats } from './classify.mjs';
import { buildAndWriteOutputJson } from './output-builder.mjs';
import { generateBibtexArtifacts } from './bibtex-builder.mjs';

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function parseBooleanFlag(args, flag) {
  return args.includes(flag);
}

function parseDefaultTrueFlag(args, positiveFlag, negativeFlag) {
  if (args.includes(negativeFlag)) return false;
  if (args.includes(positiveFlag)) return true;
  return true;
}

function parseStringOption(args, flag, defaultValue = null) {
  const exact = `${flag}=`;
  const withEquals = args.find((arg) => arg.startsWith(exact));
  if (withEquals) {
    return withEquals.slice(exact.length);
  }

  const index = args.indexOf(flag);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }

  return defaultValue;
}

function parseNumberOption(args, flag, defaultValue = null) {
  const raw = parseStringOption(args, flag, null);
  if (raw == null || raw === '') return defaultValue;
  const num = Number(raw);
  return Number.isFinite(num) ? num : defaultValue;
}

function parseGroups(raw) {
  if (!raw) return GROUP_ORDER;

  const groups = unique(
    String(raw)
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter(Boolean),
  );

  const invalid = groups.filter((group) => !GROUP_ORDER.includes(group));
  if (invalid.length > 0) {
    throw new Error(
      `Invalid group(s): ${invalid.join(', ')}. Expected subset of ${GROUP_ORDER.join(', ')}.`,
    );
  }

  return groups.length ? groups : GROUP_ORDER;
}

function parseProxyMode(raw) {
  const value = String(raw ?? 'none').trim().toLowerCase();
  if (['none', 'free', 'single'].includes(value)) {
    return value;
  }
  throw new Error(`Invalid --proxy-mode "${raw}". Expected one of: none, free, single.`);
}

function logStep(message) {
  console.log(`[embedded-ai] ${message}`);
}

function buildSearchExtraArgs(cliOptions) {
  const extraArgs = ['--proxy-mode', cliOptions.proxyMode];

  if (cliOptions.proxyMode === 'single') {
    if (cliOptions.httpProxy) {
      extraArgs.push('--http-proxy', cliOptions.httpProxy);
    }
    if (cliOptions.httpsProxy) {
      extraArgs.push('--https-proxy', cliOptions.httpsProxy);
    }
  }

  return extraArgs;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/embedded-ai/update-papers.mjs [options]

Options:
  --source MODE              Paper source: scholar | arxiv | all. Default: ${DEFAULT_SEARCH_SOURCE}
  --groups A,B,C             Which groups to process. Default: A,B,C
  --force-full-search        Ignore watermark and run full arXiv search
  --skip-search              Reuse existing raw cache instead of running search
  --skip-download            Skip downloader.py (default: true)
  --no-skip-download         Enable downloader.py
  --download-dry-run         Run downloader in dry-run mode
  --download-max N           Max number of downloads in this run
  --heuristic-only           Skip Tencent TokenHub and use heuristic classifier only
  --clear-cache              Remove raw Scholar cache before running
  --max-results N            Max kept results per group from Scholar (default from config)
  --sleep-seconds N          Sleep seconds between Scholar requests
  --retry-limit N            Retry count for Scholar fill()
  --concurrency N            Classification concurrency
  --proxy-mode MODE          Proxy mode for scholarly: none | free | single
  --http-proxy URL           HTTP proxy URL when --proxy-mode single
  --https-proxy URL          HTTPS proxy URL when --proxy-mode single
  --page-size N              Page size for arXiv pagination (default: 50)
  --total-limit N            Total limit for arXiv results (default: no limit)
  --year-low N              Only include papers with year >= N
  --year-high N             Only include papers with year <= N
  --output PATH              Output JSON path (default: _data/embedded_ai_papers.json)
  --help                     Show this help

Examples:
  node scripts/embedded-ai/update-papers.mjs --source arxiv
  node scripts/embedded-ai/update-papers.mjs --source arxiv --force-full-search
  node scripts/embedded-ai/update-papers.mjs --source all
  node scripts/embedded-ai/update-papers.mjs --source scholar --proxy-mode free
  node scripts/embedded-ai/update-papers.mjs --groups A,B --max-results 80
  node scripts/embedded-ai/update-papers.mjs --skip-search --skip-download
  node scripts/embedded-ai/update-papers.mjs --source arxiv --page-size 100 --total-limit 500
`.trim());
}

function parseSource(raw) {
  const value = String(raw ?? DEFAULT_SEARCH_SOURCE).trim().toLowerCase();
  if (!SEARCH_SOURCES.includes(value)) {
    throw new Error(
      `Invalid --source "${raw}". Expected one of: ${SEARCH_SOURCES.join(', ')}.`,
    );
  }
  return value;
}

function parseCliArgs(argv) {
  if (parseBooleanFlag(argv, '--help')) {
    return { help: true };
  }

  const proxyMode = parseProxyMode(parseStringOption(argv, '--proxy-mode', 'none'));
  const source = parseSource(parseStringOption(argv, '--source', DEFAULT_SEARCH_SOURCE));

  return {
    help: false,
    source,
    groups: parseGroups(parseStringOption(argv, '--groups', null)),
    forceFullSearch: parseBooleanFlag(argv, '--force-full-search'),
    skipSearch: parseBooleanFlag(argv, '--skip-search'),
    skipDownload: parseDefaultTrueFlag(argv, '--skip-download', '--no-skip-download'),
    downloadDryRun: parseBooleanFlag(argv, '--download-dry-run'),
    heuristicOnly: parseBooleanFlag(argv, '--heuristic-only'),
    clearCache: parseBooleanFlag(argv, '--clear-cache'),
    maxResults: parseNumberOption(argv, '--max-results', SCHOLAR_MAX_RESULTS_PER_GROUP),
    sleepSeconds: parseNumberOption(argv, '--sleep-seconds', SCHOLAR_REQUEST_SLEEP_SECONDS),
    retryLimit: parseNumberOption(argv, '--retry-limit', SCHOLAR_RETRY_LIMIT),
    concurrency: parseNumberOption(argv, '--concurrency', 3),
    downloadMax: parseNumberOption(argv, '--download-max', null),
    outputPath: parseStringOption(argv, '--output', OUTPUT_JSON_PATH),
    proxyMode,
    httpProxy: parseStringOption(argv, '--http-proxy', ''),
    httpsProxy: parseStringOption(argv, '--https-proxy', ''),
    pageSize: parseNumberOption(argv, '--page-size', 50),
    totalLimit: parseNumberOption(argv, '--total-limit', null),
    yearLow: parseNumberOption(argv, '--year-low', null),
    yearHigh: parseNumberOption(argv, '--year-high', null),
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeTitleKey(title) {
  return String(title ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPaperIdentityKey(paper = {}) {
  const dedupeKey = String(paper.dedupe_key ?? '').trim();
  if (dedupeKey) return `dedupe:${dedupeKey}`;

  const arxivId = String(paper.arxiv_id ?? '').trim().toLowerCase();
  if (arxivId) return `arxiv:${arxivId}`;

  const doi = String(paper.doi ?? '').trim().toLowerCase();
  if (doi) return `doi:${doi}`;

  const title = normalizeTitleKey(paper.title);
  const year = String(paper.year ?? '').trim();
  if (title) return `title:${title}::${year}`;

  return `id:${String(paper.id ?? '').trim()}`;
}

function mergeUniqueStrings(...lists) {
  return [...new Set(lists.flatMap((list) => safeArray(list).map((item) => String(item).trim()).filter(Boolean)))];
}

function mergeExistingWithIncoming(existing = {}, incoming = {}) {
  const merged = {
    ...existing,
    ...incoming,
  };

  merged.id = existing.id ?? incoming.id;
  merged.dedupe_key = existing.dedupe_key ?? incoming.dedupe_key;
  merged.search_sets_raw = mergeUniqueStrings(existing.search_sets_raw, incoming.search_sets_raw);
  merged.search_sets_final = mergeUniqueStrings(existing.search_sets_final, incoming.search_sets_final);
  merged.raw_group_hits = mergeUniqueStrings(existing.raw_group_hits, incoming.raw_group_hits);
  merged.query_useds = mergeUniqueStrings(existing.query_useds, incoming.query_useds);
  merged.seed_tags = mergeUniqueStrings(existing.seed_tags, incoming.seed_tags);

  // Keep existing classification so updated metadata does not trigger re-classification.
  merged.category = existing.category;
  merged.llm_tags = safeArray(existing.llm_tags);
  merged.final_tags = safeArray(existing.final_tags);
  merged.provider_used = existing.provider_used;
  merged.classification_model = existing.classification_model;
  merged.classification_raw_response = existing.classification_raw_response;

  return merged;
}

function mergeHistoricalWithFilteredPapers(historicalPapers = [], filteredPapers = []) {
  const historicalMap = new Map();

  for (const paper of historicalPapers) {
    const key = buildPaperIdentityKey(paper);
    historicalMap.set(key, paper);
  }

  const newCandidates = [];

  for (const paper of filteredPapers) {
    const key = buildPaperIdentityKey(paper);
    if (historicalMap.has(key)) {
      const merged = mergeExistingWithIncoming(historicalMap.get(key), paper);
      historicalMap.set(key, merged);
      continue;
    }
    newCandidates.push(paper);
  }

  return {
    preservedHistorical: [...historicalMap.values()],
    newCandidates,
  };
}

function ensureGroupedPayloadShape(groupedPayloads = {}, groups = GROUP_ORDER) {
  const normalized = {};
  for (const group of groups) {
    normalized[group] = groupedPayloads[group] ?? [];
  }
  return normalized;
}

function extractItemsFromPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.filter(Boolean);
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload.items)) {
    return payload.items.filter(Boolean);
  }

  if (Array.isArray(payload.papers)) {
    return payload.papers.filter(Boolean);
  }

  return [];
}

function countRawItems(groupPayload) {
  if (Array.isArray(groupPayload)) return groupPayload.length;
  if (groupPayload && Array.isArray(groupPayload.items)) return groupPayload.items.length;
  if (groupPayload && Array.isArray(groupPayload.papers)) return groupPayload.papers.length;
  return 0;
}

function summarizeGroupedPayloads(groupedPayloads = {}, groups = GROUP_ORDER) {
  const summary = {};
  for (const group of groups) {
    summary[group] = countRawItems(groupedPayloads[group]);
  }
  return summary;
}

function buildPipelineSummary({
  cliOptions,
  searchMeta,
  groupedPayloads,
  setOpsResult,
  filteredResult,
  classifiedResult,
  outputPath,
  bibtexRun,
  downloadRun,
  generatedAt,
}) {
  return {
    ok: true,
    generated_at: generatedAt,
    options: {
      source: cliOptions.source,
      groups: cliOptions.groups,
      force_full_search: cliOptions.forceFullSearch,
      skip_search: cliOptions.skipSearch,
      skip_download: cliOptions.skipDownload,
      download_dry_run: cliOptions.downloadDryRun,
      heuristic_only: cliOptions.heuristicOnly,
      max_results: cliOptions.maxResults,
      sleep_seconds: cliOptions.sleepSeconds,
      retry_limit: cliOptions.retryLimit,
      concurrency: cliOptions.concurrency,
      output_path: outputPath,
      proxy_mode: cliOptions.proxyMode,
      http_proxy: cliOptions.httpProxy || null,
      https_proxy: cliOptions.httpsProxy || null,
      year_low: cliOptions.yearLow ?? null,
      year_high: cliOptions.yearHigh ?? null,
    },
    search: searchMeta ?? null,
    counts: {
      raw_search: summarizeGroupedPayloads(groupedPayloads, cliOptions.groups),
      after_set_ops: setOpsResult?.stats?.after_set_ops ?? {},
      after_filter: filteredResult?.filtered_papers?.length ?? 0,
      after_classification: classifiedResult?.papers?.length ?? 0,
    },
    classification: classifiedResult?.stats ?? {},
    bibtex: bibtexRun
      ? {
          artifact_paths: bibtexRun.artifactPaths ?? {},
          counts: bibtexRun.counts ?? {},
          error: bibtexRun.error ?? null,
        }
      : null,
    download: downloadRun
      ? {
          quota: downloadRun.quota ?? {},
          parsed_stdout: downloadRun.parsedStdout ?? null,
          error: downloadRun.error ?? null,
        }
      : null,
  };
}

async function executeSearchStep(cliOptions) {
  const { source, groups, skipSearch } = cliOptions;

  // Determine which sources to search
  const sourcesToRun =
    source === 'all' ? ['scholar', 'arxiv'] : [source];

  logStep(`Starting search for source(s): ${sourcesToRun.join(', ')} | groups: ${groups.join(', ')}`);

  if (skipSearch) {
    // Load from cache for all specified sources
    let allGroupedPayloads = {};

    for (const src of sourcesToRun) {
      let groupedPayloads;
      if (src === 'scholar') {
        groupedPayloads = await loadAllScholarRawGroups();
      } else if (src === 'arxiv') {
        groupedPayloads = await loadAllArxivRawGroups();
      }

      if (groupedPayloads) {
        // Merge payloads from different sources
        for (const group of groups) {
          const items = extractItemsFromPayload(groupedPayloads[group]);
          allGroupedPayloads[group] = [
            ...(allGroupedPayloads[group] ?? []),
            ...items,
          ];
        }
      }
    }

    const summary = summarizeGroupedPayloads(allGroupedPayloads, groups);
    logStep(`Loaded existing raw cache (sources: ${sourcesToRun.join(', ')}): ${JSON.stringify(summary)}`);
    return {
      groupedPayloads: ensureGroupedPayloadShape(allGroupedPayloads, groups),
      searchMeta: {
        source: source,
        mode: 'cache',
      },
    };
  }

  // Run searches for each source
  let allGroupedPayloads = {};
  let latestSearchMeta = {
    source,
    mode: 'full',
  };

  for (const src of sourcesToRun) {
    logStep(`Running ${src} search for groups: ${groups.join(', ')}`);
    let searchResult;

    if (src === 'scholar') {
      searchResult = await runAllScholarKeywordSearches({
        groups,
        maxResults: cliOptions.maxResults,
        sleepSeconds: cliOptions.sleepSeconds,
        retryLimit: cliOptions.retryLimit,
        extraArgs: buildSearchExtraArgs(cliOptions),
        yearLow: cliOptions.yearLow,
        yearHigh: cliOptions.yearHigh,
      });
    } else if (src === 'arxiv') {
      searchResult = await runAllArxivKeywordSearches({
        groups,
        pageSize: cliOptions.pageSize ?? 50,
        totalLimit: cliOptions.totalLimit,
        yearLow: cliOptions.yearLow,
        yearHigh: cliOptions.yearHigh,
        forceFullSearch: cliOptions.forceFullSearch,
      });
      if (searchResult?.runMeta) {
        latestSearchMeta = searchResult.runMeta;
      }
    }

    if (searchResult?.groupedData) {
      // Merge results from this source
      for (const group of groups) {
        const items = extractItemsFromPayload(searchResult.groupedData[group]);
        allGroupedPayloads[group] = [
          ...(allGroupedPayloads[group] ?? []),
          ...items,
        ];
      }

      const summary = summarizeGroupedPayloads(searchResult.groupedData, groups);
      logStep(`${src} search completed: ${JSON.stringify(summary)}`);
    }
  }

  const pulledTotal = Object.values(summarizeGroupedPayloads(allGroupedPayloads, groups)).reduce(
    (sum, count) => sum + Number(count || 0),
    0,
  );
  const uniqueIds = new Set();
  for (const group of groups) {
    for (const item of extractItemsFromPayload(allGroupedPayloads[group])) {
      uniqueIds.add(buildPaperIdentityKey(item));
    }
  }
  logStep(`Search fetched ${pulledTotal} raw records, unique pre-set-ops=${uniqueIds.size}`);

  return {
    groupedPayloads: ensureGroupedPayloadShape(allGroupedPayloads, groups),
    searchMeta: latestSearchMeta,
  };
}

function buildFilterStatsPayload(filteredResult) {
  return {
    after_filter: filteredResult?.filtered_papers?.length ?? 0,
    filter_breakdown: filteredResult?.stats?.filter_breakdown ?? filteredResult?.stats ?? {},
  };
}

async function executeClassificationStep(filteredResult, cliOptions) {
  const papersToClassify = filteredResult?.filtered_papers ?? [];

  if (!papersToClassify.length) {
    return {
      papers: [],
      stats: {
        total: 0,
        by_category: {},
        by_tag: {},
        by_provider: {},
      },
    };
  }

  return classifyPapers(papersToClassify, {
    useHeuristicOnly: cliOptions.heuristicOnly,
    concurrency: cliOptions.concurrency,
  });
}

async function executeDownloadStep(cliOptions) {
  if (cliOptions.skipDownload) {
    return null;
  }

  return runDownloadManager({
    inputPath: SCHOLAR_NORMALIZED_PATH,
    dryRun: cliOptions.downloadDryRun,
    maxDownloads: cliOptions.downloadMax,
  });
}

async function main() {
  const cliOptions = parseCliArgs(process.argv.slice(2));

  if (cliOptions.help) {
    printHelp();
    return;
  }

  await ensureScholarRuntimeDirs();

  if (cliOptions.clearCache) {
    await clearScholarCache({ includeNormalized: true });
  }

  const generatedAt = new Date().toISOString();

  logStep('Starting embedded AI paper update pipeline');

  const { groupedPayloads, searchMeta } = await executeSearchStep(cliOptions);

  const rawCounts = summarizeGroupedPayloads(groupedPayloads, cliOptions.groups);
  const totalRawCount = Object.values(rawCounts).reduce((sum, count) => sum + count, 0);

  logStep(`Raw candidates total: ${totalRawCount}`);

  if (totalRawCount === 0) {
    throw new Error(
      'No search results available. Check raw cache or rerun without --skip-search.',
    );
  }

  logStep('Running set operations and deduplication');
  const setOpsResult = runSetOperations(groupedPayloads);
  logStep(`After set operations: ${JSON.stringify(setOpsResult.stats.after_set_ops)}`);

  logStep('Applying TH-CPL / arXiv filter rules');
  const filteredResult = applyFilterRulesToSetOps(setOpsResult);
  logStep(`After filtering: ${filteredResult.filtered_papers.length} papers remain`);

  const historicalPapers = await safeReadJson(SCHOLAR_NORMALIZED_PATH, []);
  const { preservedHistorical, newCandidates } = mergeHistoricalWithFilteredPapers(
    safeArray(historicalPapers),
    filteredResult.filtered_papers,
  );

  logStep(
    `Merge baseline ready: historical=${preservedHistorical.length}, incremental_filtered=${filteredResult.filtered_papers.length}, new_for_classification=${newCandidates.length}`,
  );

  logStep('Classifying new papers only');
  const classifiedResult = await classifyPapers(newCandidates, {
    useHeuristicOnly: cliOptions.heuristicOnly,
    concurrency: cliOptions.concurrency,
  });
  logStep(`Classification completed: ${classifiedResult.papers.length} new papers classified`);

  const finalPapers = [...preservedHistorical];
  const finalMap = new Map(finalPapers.map((paper) => [buildPaperIdentityKey(paper), paper]));
  for (const paper of classifiedResult.papers) {
    finalMap.set(buildPaperIdentityKey(paper), paper);
  }
  const mergedPapers = [...finalMap.values()];
  const mergedClassificationStats = summarizeClassificationStats(mergedPapers);
  logStep(`Final merged paper count: ${mergedPapers.length}`);

  await saveNormalizedPapers(mergedPapers);
  logStep(`Saved normalized paper data to ${SCHOLAR_NORMALIZED_PATH}`);

  const { outputJson, outputPath } = await buildAndWriteOutputJson({
    classifiedPapers: mergedPapers,
    setOpsStats: setOpsResult.stats,
    filterStats: buildFilterStatsPayload(filteredResult),
    classificationStats: mergedClassificationStats,
    downloadState: await safeReadJson(DOWNLOAD_STATE_PATH, { papers: {} }),
    generatedAt,
    outputPath: cliOptions.outputPath,
  });

  logStep(`Wrote JSON output to ${outputPath}`);

  logStep('Generating BibTeX artifacts');
  let bibtexRun = null;
  try {
    bibtexRun = await generateBibtexArtifacts(mergedPapers);
    logStep('BibTeX artifact generation completed');
  } catch (error) {
    bibtexRun = {
      ok: false,
      error: String(error?.message || error),
      artifactPaths: {},
      counts: {},
    };
    console.error(
      JSON.stringify(
        {
          ok: false,
          phase: 'bibtex',
          error: String(error?.message || error),
        },
        null,
        2,
      ),
    );
  }

  let downloadRun = null;
  if (!cliOptions.skipDownload) {
    logStep('Starting PDF download step');
    try {
      downloadRun = await executeDownloadStep(cliOptions);
      logStep('Download step finished');
    } catch (error) {
      downloadRun = {
        ok: false,
        error: String(error?.message || error),
      };
      console.error(
        JSON.stringify(
          {
            ok: false,
            phase: 'download',
            error: String(error?.message || error),
          },
          null,
          2,
        ),
      );
    }
  } else {
    logStep('Skipping PDF download step (--skip-download)');
  }

  const downloadState = await safeReadJson(DOWNLOAD_STATE_PATH, { papers: {} });
  const downloadQuota = await safeReadJson(DOWNLOAD_QUOTA_PATH, {});

  if (downloadRun) {
    await buildAndWriteOutputJson({
      classifiedPapers: mergedPapers,
      setOpsStats: setOpsResult.stats,
      filterStats: buildFilterStatsPayload(filteredResult),
      classificationStats: mergedClassificationStats,
      downloadState,
      generatedAt,
      outputPath: cliOptions.outputPath,
    });
  }

  const summary = buildPipelineSummary({
    cliOptions,
    searchMeta,
    groupedPayloads,
    setOpsResult,
    filteredResult,
    classifiedResult: {
      papers: mergedPapers,
      stats: mergedClassificationStats,
    },
    outputPath,
    bibtexRun,
    downloadRun: downloadRun
      ? {
          ...downloadRun,
          quota: downloadQuota,
        }
      : null,
    generatedAt,
  });

  logStep(
    `Run mode summary: source=${searchMeta?.source ?? cliOptions.source}, mode=${searchMeta?.mode ?? 'full'}, skip_download=${cliOptions.skipDownload}`,
  );

  console.log(
    JSON.stringify(
      {
        ...summary,
        output_preview: {
          version: outputJson.version,
          categories: outputJson.categories.map((category) => ({
            key: category.key,
            title: category.title,
            count: category.count,
          })),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: String(error?.message || error),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});