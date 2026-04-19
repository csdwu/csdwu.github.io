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
import { classifyPapers } from './classify.mjs';
import { buildAndWriteOutputJson } from './output-builder.mjs';
import { generateBibtexArtifacts } from './bibtex-builder.mjs';

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function parseBooleanFlag(args, flag) {
  return args.includes(flag);
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
  --skip-search              Reuse existing raw cache instead of running search
  --skip-download            Skip downloader.py
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
  --output PATH              Output JSON path (default: _data/embedded_ai_papers.json)
  --help                     Show this help

Examples:
  node scripts/embedded-ai/update-papers.mjs --source arxiv
  node scripts/embedded-ai/update-papers.mjs --source all
  node scripts/embedded-ai/update-papers.mjs --source scholar --proxy-mode free
  node scripts/embedded-ai/update-papers.mjs --groups A,B --max-results 80
  node scripts/embedded-ai/update-papers.mjs --skip-search --skip-download
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
    skipSearch: parseBooleanFlag(argv, '--skip-search'),
    skipDownload: parseBooleanFlag(argv, '--skip-download'),
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
      groups: cliOptions.groups,
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
    },
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
    return ensureGroupedPayloadShape(allGroupedPayloads, groups);
  }

  // Run searches for each source
  let allGroupedPayloads = {};

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
      });
    } else if (src === 'arxiv') {
      searchResult = await runAllArxivKeywordSearches({
        groups,
      });
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

  return ensureGroupedPayloadShape(allGroupedPayloads, groups);
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

  const groupedPayloads = await executeSearchStep(cliOptions);

  const rawCounts = summarizeGroupedPayloads(groupedPayloads, cliOptions.groups);
  const totalRawCount = Object.values(rawCounts).reduce((sum, count) => sum + count, 0);

  logStep(`Raw Scholar candidates total: ${totalRawCount}`);

  if (totalRawCount === 0) {
    throw new Error(
      'No Scholar results available. Check raw cache or rerun without --skip-search.',
    );
  }

  logStep('Running set operations and deduplication');
  const setOpsResult = runSetOperations(groupedPayloads);
  logStep(`After set operations: ${JSON.stringify(setOpsResult.stats.after_set_ops)}`);

  logStep('Applying TH-CPL / arXiv filter rules');
  const filteredResult = applyFilterRulesToSetOps(setOpsResult);
  logStep(`After filtering: ${filteredResult.filtered_papers.length} papers remain`);

  logStep('Classifying papers');
  const classifiedResult = await executeClassificationStep(filteredResult, cliOptions);
  logStep(`Classification completed: ${classifiedResult.papers.length} papers classified`);

  await saveNormalizedPapers(classifiedResult.papers);
  logStep(`Saved normalized paper data to ${SCHOLAR_NORMALIZED_PATH}`);

  const { outputJson, outputPath } = await buildAndWriteOutputJson({
    classifiedPapers: classifiedResult.papers,
    setOpsStats: setOpsResult.stats,
    filterStats: buildFilterStatsPayload(filteredResult),
    classificationStats: classifiedResult.stats,
    downloadState: await safeReadJson(DOWNLOAD_STATE_PATH, { papers: {} }),
    generatedAt,
    outputPath: cliOptions.outputPath,
  });

  logStep(`Wrote JSON output to ${outputPath}`);

  logStep('Generating BibTeX artifacts');
  let bibtexRun = null;
  try {
    bibtexRun = await generateBibtexArtifacts(classifiedResult.papers);
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
      classifiedPapers: classifiedResult.papers,
      setOpsStats: setOpsResult.stats,
      filterStats: buildFilterStatsPayload(filteredResult),
      classificationStats: classifiedResult.stats,
      downloadState,
      generatedAt,
      outputPath: cliOptions.outputPath,
    });
  }

  const summary = buildPipelineSummary({
    cliOptions,
    groupedPayloads,
    setOpsResult,
    filteredResult,
    classifiedResult,
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