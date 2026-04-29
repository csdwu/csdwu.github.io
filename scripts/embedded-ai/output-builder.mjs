import fs from 'node:fs/promises';
import path from 'node:path';

import {
  OUTPUT_SCHEMA_VERSION,
  OUTPUT_JSON_PATH,
  QUERY_GROUPS,
  CATEGORY_DISPLAY_ORDER,
  mergeAndNormalizeTags,
} from './config.mjs';
import {
  regroupClassifiedPapersByCategory,
  summarizeClassificationStats,
} from './classify.mjs';

function toTrimmedString(value) {
  return String(value ?? '').trim();
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function safeInt(value) {
  if (value == null) return null;
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractMonthNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (Number.isFinite(num) && num >= 1 && num <= 12) return num;
  const match = String(value).match(/(0?[1-9]|1[0-2])/);
  return match ? Number(match[1]) : null;
}

function deriveYearMonthFromArxivId(arxivId) {
  const text = toTrimmedString(arxivId);
  const match = text.match(/^(\d{2})(\d{2})\./);
  if (!match) return { year: null, month: null };
  return {
    year: Number(`20${match[1]}`),
    month: Number(match[2]),
  };
}

function buildSortKey(paper = {}) {
  const explicitYear = safeInt(paper.year);
  const explicitMonth = extractMonthNumber(paper.month);
  if (explicitYear != null) {
    return explicitYear * 100 + (explicitMonth ?? 0);
  }

  const derived = deriveYearMonthFromArxivId(paper.arxiv_id);
  if (derived.year != null) {
    return derived.year * 100 + (derived.month ?? 0);
  }

  return 0;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = toTrimmedString(value);
    if (text) return text;
  }
  return '';
}

function normalizeSourceKey(paper = {}) {
  const source = toTrimmedString(paper.source).toLowerCase();
  if (source === 'arxiv') return 'arxiv';
  if (source === 'scholar' || source === 'google_scholar') return 'scholar';

  if (toTrimmedString(paper.arxiv_id) || toTrimmedString(paper.urls?.arxiv)) {
    return 'arxiv';
  }

  return 'unknown';
}

function normalizeVenueKey(paper = {}) {
  return firstNonEmpty(paper.matched_venue, paper.venue) || 'unknown';
}

function normalizeVenueTypeKey(paper = {}) {
  const matchedType = toTrimmedString(paper.matched_venue_type).toLowerCase();
  if (matchedType) return matchedType;

  const venueType = toTrimmedString(paper.venue_type).toLowerCase();
  if (venueType) return venueType;

  const source = normalizeSourceKey(paper);
  const venue = toTrimmedString(paper.matched_venue || paper.venue);
  if (source === 'arxiv' || venue.toLowerCase() === 'arxiv') {
    return 'preprint';
  }

  return 'unknown';
}

function makeSourceGroupCounts() {
  return { arxiv: 0, scholar: 0, unknown: 0 };
}

function ensureCountKey(bucket, key) {
  if (bucket[key] == null) {
    bucket[key] = 0;
  }
}

export function summarizeSourceStats(papers = [], options = {}) {
  const sourceStats = {
    generated_at: options.generatedAt ?? new Date().toISOString(),
    total_papers: papers.length,
    skip_arxiv_in_a: Boolean(options.skipArxivInA),
    by_source: { arxiv: 0, scholar: 0, unknown: 0 },
    by_venue: { unknown: 0 },
    by_venue_type: { conference: 0, journal: 0, preprint: 0, unknown: 0 },
    by_search_group: { A: 0, B: 0, C: 0 },
    by_search_group_and_source: {
      A: makeSourceGroupCounts(),
      B: makeSourceGroupCounts(),
      C: makeSourceGroupCounts(),
    },
  };

  for (const paper of papers) {
    const sourceKey = normalizeSourceKey(paper);
    sourceStats.by_source[sourceKey] += 1;

    const venueKey = normalizeVenueKey(paper);
    ensureCountKey(sourceStats.by_venue, venueKey);
    sourceStats.by_venue[venueKey] += 1;

    const venueTypeKey = normalizeVenueTypeKey(paper);
    ensureCountKey(sourceStats.by_venue_type, venueTypeKey);
    sourceStats.by_venue_type[venueTypeKey] += 1;

    const searchGroups = ensureArray(paper.search_sets_final)
      .map((group) => toTrimmedString(group))
      .filter((group) => ['A', 'B', 'C'].includes(group));

    for (const group of searchGroups) {
      sourceStats.by_search_group[group] += 1;
      sourceStats.by_search_group_and_source[group][sourceKey] += 1;
    }
  }

  return sourceStats;
}

function sortPapers(a, b) {
  const ask = buildSortKey(a);
  const bsk = buildSortKey(b);
  if (bsk !== ask) return bsk - ask;

  const ac = Number(a.cited_by ?? 0);
  const bc = Number(b.cited_by ?? 0);
  if (bc !== ac) return bc - ac;

  return toTrimmedString(a.title).localeCompare(toTrimmedString(b.title));
}

function buildQueryGroupsSnapshot() {
  return {
    A: QUERY_GROUPS.A.primaryQuery,
    B: QUERY_GROUPS.B.primaryQuery,
    C: QUERY_GROUPS.C.primaryQuery,
  };
}

function normalizeDownloadState(downloadState = null) {
  const state = downloadState && typeof downloadState === 'object'
    ? downloadState
    : { papers: {} };

  const papers = state.papers && typeof state.papers === 'object'
    ? state.papers
    : {};

  return { papers };
}

function buildDownloadLookup(downloadState = null) {
  const state = normalizeDownloadState(downloadState);
  const lookup = new Map();

  for (const [paperId, record] of Object.entries(state.papers)) {
    if (!record || typeof record !== 'object') continue;
    lookup.set(String(paperId), record);
  }

  return lookup;
}

function resolveDownloadInfo(paper, downloadLookup) {
  const record = downloadLookup.get(String(paper.id)) || null;

  if (!record) {
    return {
      status: 'pending',
      source: null,
      path: null,
      last_attempt_at: null,
    };
  }

  return {
    status: toTrimmedString(record.status) || 'pending',
    source: record.source ?? null,
    path: record.path ?? null,
    last_attempt_at: record.last_attempt_at ?? null,
  };
}

function buildUrlsObject(paper = {}) {
  const urls = { ...(paper.urls ?? {}) };

  const scholar = firstNonEmpty(paper.scholar_url, urls.scholar);
  const paperUrl = firstNonEmpty(paper.pub_url, urls.paper);
  const pdf = firstNonEmpty(paper.pdf_url, paper.eprint_url, urls.pdf);
  const arxiv = firstNonEmpty(
    paper.arxiv_url,
    urls.arxiv,
    paper.arxiv_id ? `https://arxiv.org/abs/${paper.arxiv_id}` : '',
  );

  if (scholar) urls.scholar = scholar;
  if (paperUrl) urls.paper = paperUrl;
  if (pdf) urls.pdf = pdf;
  if (arxiv) urls.arxiv = arxiv;

  return Object.fromEntries(
    Object.entries(urls).filter(([, value]) => toTrimmedString(value)),
  );
}

function sanitizePaperForOutput(paper, downloadLookup) {
  const urls = buildUrlsObject(paper);
  const finalTags = mergeAndNormalizeTags(paper.final_tags ?? []);
  const llmTags = mergeAndNormalizeTags(paper.llm_tags ?? []);
  const forcedTags = mergeAndNormalizeTags(
    finalTags.filter((tag) => !llmTags.includes(tag)),
  );
  const download = resolveDownloadInfo(paper, downloadLookup);

  return {
    id: String(paper.id),
    title: toTrimmedString(paper.title),
    authors: ensureArray(paper.authors).map((item) => String(item)).filter(Boolean),
    year: safeInt(paper.year),
    month: extractMonthNumber(paper.month) ?? deriveYearMonthFromArxivId(paper.arxiv_id).month,
    source: toTrimmedString(paper.source),
    venue: toTrimmedString(paper.venue),
    venue_type: toTrimmedString(paper.matched_venue_type || paper.venue_type),
    abstract: toTrimmedString(paper.abstract),
    urls,
    search_sets_raw: unique(ensureArray(paper.search_sets_raw)),
    search_sets_final: unique(ensureArray(paper.search_sets_final)),
    filter_bucket: toTrimmedString(paper.filter_bucket),
    matched_venue: toTrimmedString(paper.matched_venue),
    matched_th_cpl_level: toTrimmedString(paper.matched_th_cpl_level),
    matched_th_cpl_area: toTrimmedString(paper.matched_th_cpl_area),
    category: toTrimmedString(paper.category),
    llm_tags: llmTags,
    forced_tags: forcedTags,
    final_tags: finalTags,
    cited_by: Number(paper.cited_by ?? 0) || 0,
    is_preprint_on_arxiv: Boolean(paper.is_preprint_on_arxiv),
    preprint_source: toTrimmedString(paper.preprint_source),
    journal_ref: toTrimmedString(paper.journal_ref),
    doi: toTrimmedString(paper.doi),
    arxiv_comment: toTrimmedString(paper.arxiv_comment),
    arxiv_id: toTrimmedString(paper.arxiv_id),
    raw_venue: toTrimmedString(paper.raw_venue),
    venue_source: toTrimmedString(paper.venue_source),
    sort_key: buildSortKey(paper),
    download,
  };
}

function inferAfterFilterCount(payload = {}) {
  if (typeof payload.after_filter === 'number') {
    return payload.after_filter;
  }

  if (payload.filter_breakdown?.accepted_count != null) {
    return Number(payload.filter_breakdown.accepted_count) || 0;
  }

  return 0;
}

function buildStats({
  setOpsStats = {},
  filterStats = {},
  classificationStats = {},
  sourceStats = null,
}) {
  return {
    raw_counts: {
      A: Number(setOpsStats?.raw_counts?.A ?? 0),
      B: Number(setOpsStats?.raw_counts?.B ?? 0),
      C: Number(setOpsStats?.raw_counts?.C ?? 0),
    },
    after_set_ops: {
      A_only: Number(setOpsStats?.after_set_ops?.A_only ?? 0),
      B: Number(setOpsStats?.after_set_ops?.B ?? 0),
      C: Number(setOpsStats?.after_set_ops?.C ?? 0),
      merged_total: Number(setOpsStats?.after_set_ops?.merged_total ?? 0),
      bc_overlap: Number(setOpsStats?.after_set_ops?.bc_overlap ?? 0),
    },
    after_filter: inferAfterFilterCount(filterStats),
    classification: {
      total: Number(classificationStats?.total ?? 0),
      by_category: { ...(classificationStats?.by_category ?? {}) },
      by_tag: { ...(classificationStats?.by_tag ?? {}) },
      by_provider: { ...(classificationStats?.by_provider ?? {}) },
    },
    source_stats: sourceStats ? { ...sourceStats } : null,
  };
}

function ensureCategoryBuckets(classifiedPapers = []) {
  const buckets = regroupClassifiedPapersByCategory(classifiedPapers);

  for (const bucket of buckets) {
    bucket.papers = ensureArray(bucket.papers);
    bucket.count = bucket.papers.length;
  }

  return buckets.filter((bucket) => CATEGORY_DISPLAY_ORDER.includes(bucket.title));
}

export function buildOutputJson({
  classifiedPapers = [],
  setOpsStats = {},
  filterStats = {},
  classificationStats = null,
  sourceStats = null,
  downloadState = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const papers = ensureArray(classifiedPapers);
  const effectiveClassificationStats =
    classificationStats ?? summarizeClassificationStats(papers);

  const downloadLookup = buildDownloadLookup(downloadState);
  const regrouped = ensureCategoryBuckets(papers);

  const categories = regrouped.map((bucket) => {
    const sanitizedPapers = bucket.papers.map((paper) => sanitizePaperForOutput(paper, downloadLookup));
    sanitizedPapers.sort(sortPapers);
    return {
      key: bucket.key,
      title: bucket.title,
      count: bucket.count,
      papers: sanitizedPapers,
    };
  });

  return {
    version: OUTPUT_SCHEMA_VERSION,
    generated_at: generatedAt,
    query_groups: buildQueryGroupsSnapshot(),
    stats: buildStats({
      setOpsStats,
      filterStats,
      classificationStats: effectiveClassificationStats,
      sourceStats,
    }),
    categories,
  };
}

export async function writeOutputJson(outputJson, outputPath = OUTPUT_JSON_PATH) {
  const targetPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    JSON.stringify(outputJson, null, 2),
    'utf8',
  );
  return targetPath;
}

export async function buildAndWriteOutputJson({
  classifiedPapers = [],
  setOpsStats = {},
  filterStats = {},
  classificationStats = null,
  sourceStats = null,
  downloadState = null,
  generatedAt = new Date().toISOString(),
  outputPath = OUTPUT_JSON_PATH,
} = {}) {
  const outputJson = buildOutputJson({
    classifiedPapers,
    setOpsStats,
    filterStats,
    classificationStats,
    sourceStats,
    downloadState,
    generatedAt,
  });

  const writtenPath = await writeOutputJson(outputJson, outputPath);

  return {
    outputJson,
    outputPath: writtenPath,
  };
}

export function buildOutputFromPipeline({
  setOpsResult = {},
  filteredResult = {},
  classifiedResult = {},
  sourceStats = null,
  downloadState = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const classifiedPapers =
    classifiedResult?.papers ??
    filteredResult?.accepted ??
    [];

  const setOpsStats = deepClone(setOpsResult?.stats ?? {});
  const filterStats = deepClone(
    filteredResult?.stats ??
    (setOpsResult?.stats
      ? {
          after_filter: setOpsResult.stats.after_filter ?? 0,
          filter_breakdown: setOpsResult.stats.filter_breakdown ?? {},
        }
      : {}),
  );
  const classificationStats = deepClone(
    classifiedResult?.stats ?? summarizeClassificationStats(classifiedPapers),
  );

  return buildOutputJson({
    classifiedPapers,
    setOpsStats,
    filterStats,
    classificationStats,
    sourceStats,
    downloadState,
    generatedAt,
  });
}