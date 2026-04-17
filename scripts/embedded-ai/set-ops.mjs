import crypto from 'node:crypto';

import {
  GROUP_ORDER,
  TAGS,
  normalizeText,
} from './config.mjs';

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function safeInt(value) {
  if (value == null) return null;
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function toTrimmedString(value) {
  return String(value ?? '').trim();
}

function pickLongerText(a, b) {
  const aa = toTrimmedString(a);
  const bb = toTrimmedString(b);
  return bb.length > aa.length ? bb : aa;
}

function pickBetterTitle(a, b) {
  const aa = toTrimmedString(a);
  const bb = toTrimmedString(b);

  if (!aa) return bb;
  if (!bb) return aa;

  const aScore = aa.length + (/[A-Z]/.test(aa) ? 5 : 0);
  const bScore = bb.length + (/[A-Z]/.test(bb) ? 5 : 0);
  return bScore > aScore ? bb : aa;
}

function pickBetterVenue(a, b) {
  const aa = toTrimmedString(a);
  const bb = toTrimmedString(b);

  if (!aa) return bb;
  if (!bb) return aa;

  if (bb.length > aa.length) return bb;
  return aa;
}

function mergeAuthors(a = [], b = []) {
  const seen = new Map();

  for (const author of [...ensureArray(a), ...ensureArray(b)]) {
    const raw = toTrimmedString(author);
    if (!raw) continue;
    const key = normalizeText(raw);
    if (!seen.has(key)) {
      seen.set(key, raw);
    }
  }

  return [...seen.values()];
}

function buildUrlMap(paper = {}) {
  const urls = { ...(paper.urls ?? {}) };

  const scholar = toTrimmedString(paper.scholar_url ?? urls.scholar);
  const paperUrl = toTrimmedString(paper.pub_url ?? urls.paper);
  const pdf = toTrimmedString(paper.pdf_url ?? paper.eprint_url ?? urls.pdf);
  const arxiv = toTrimmedString(paper.arxiv_url ?? urls.arxiv);

  if (scholar) urls.scholar = scholar;
  if (paperUrl) urls.paper = paperUrl;
  if (pdf) urls.pdf = pdf;
  if (arxiv) urls.arxiv = arxiv;

  return Object.fromEntries(
    Object.entries(urls).filter(([, value]) => toTrimmedString(value)),
  );
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = toTrimmedString(value);
    if (text) return text;
  }
  return '';
}

function extractDoiFromText(value) {
  const text = String(value ?? '');
  const match = text.match(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/i);
  return match ? match[0].replace(/[),.;]+$/, '') : '';
}

function extractDoi(paper = {}) {
  return firstNonEmpty(
    paper.doi,
    extractDoiFromText(paper.pub_url),
    extractDoiFromText(paper.eprint_url),
    extractDoiFromText(paper.scholar_url),
    extractDoiFromText(paper.abstract),
    extractDoiFromText(paper.snippet),
  );
}

function extractArxivIdFromText(value) {
  const text = String(value ?? '');

  const patterns = [
    /arxiv\.org\/(?:abs|pdf)\/([a-z\-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?/i,
    /\barxiv:\s*([a-z\-]+\/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  return '';
}

function extractArxivId(paper = {}) {
  const urls = buildUrlMap(paper);

  return firstNonEmpty(
    paper.arxiv_id,
    extractArxivIdFromText(urls.arxiv),
    extractArxivIdFromText(urls.pdf),
    extractArxivIdFromText(urls.paper),
    extractArxivIdFromText(paper.abstract),
    extractArxivIdFromText(paper.snippet),
  );
}

function normalizedTitle(title) {
  return normalizeText(title)
    .replace(/\b(preprint|extended abstract|poster|oral)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTitleYearKey(title, year) {
  const t = normalizedTitle(title);
  const y = safeInt(year);
  if (!t) return '';
  return y ? `title-year:${t}::${y}` : `title:${t}`;
}

function buildDedupeKey(paper = {}) {
  const doi = normalizeText(extractDoi(paper));
  if (doi) return `doi:${doi}`;

  const arxivId = normalizeText(extractArxivId(paper));
  if (arxivId) return `arxiv:${arxivId}`;

  const titleYear = buildTitleYearKey(paper.title, paper.year);
  if (titleYear) return titleYear;

  const fallbackPayload = [
    normalizeText(paper.title),
    safeInt(paper.year) ?? '',
    normalizeText(paper.pub_url),
    normalizeText(paper.scholar_url),
  ].join('||');

  return `hash:${crypto.createHash('sha1').update(fallbackPayload).digest('hex')}`;
}

function extractItemsFromGroupPayload(payload) {
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

function makeStableId(paper) {
  const existingId = toTrimmedString(paper.id);
  if (existingId) return existingId;

  const base = [
    normalizedTitle(paper.title),
    safeInt(paper.year) ?? '',
    normalizeText(extractDoi(paper)),
    normalizeText(extractArxivId(paper)),
  ].join('||');

  return crypto.createHash('sha1').update(base).digest('hex');
}

function normalizeIncomingPaper(paper, groupKey) {
  const urls = buildUrlMap(paper);
  const doi = extractDoi(paper);
  const arxivId = extractArxivId(paper);
  const title = toTrimmedString(paper.title);
  const abstract = toTrimmedString(paper.abstract);
  const snippet = toTrimmedString(paper.snippet);
  const venue = toTrimmedString(paper.venue);
  const year = safeInt(paper.year);
  const citedBy = Number(paper.cited_by ?? 0) || 0;
  const queryUsed = toTrimmedString(paper.query_used);

  return {
    id: makeStableId({ ...paper, doi, arxiv_id: arxivId }),
    source: 'google_scholar',
    title,
    abstract,
    snippet,
    authors: mergeAuthors(paper.authors ?? [], []),
    venue,
    year,
    cited_by: citedBy,
    doi,
    arxiv_id: arxivId,
    urls,
    scholar_url: toTrimmedString(paper.scholar_url ?? urls.scholar),
    pub_url: toTrimmedString(paper.pub_url ?? urls.paper),
    eprint_url: toTrimmedString(paper.eprint_url ?? urls.pdf),
    container_type: toTrimmedString(paper.container_type),
    query_useds: queryUsed ? [queryUsed] : [],
    raw_group_hits: [groupKey],
    search_sets_raw: [groupKey],
    search_sets_final: [groupKey],
    post_filter: paper.post_filter ?? null,
    raw_payloads: [paper],
    dedupe_key: buildDedupeKey({ ...paper, doi, arxiv_id: arxivId }),
    seed_tags: groupKey === 'C' ? [TAGS.TINYML] : [],
    tag_hints: {
      force_tinyml: groupKey === 'C',
      require_power_tag: groupKey === 'B',
    },
  };
}

function mergeUrlMaps(a = {}, b = {}) {
  return Object.fromEntries(
    Object.entries({ ...a, ...b }).filter(([, value]) => toTrimmedString(value)),
  );
}

function mergePaperRecords(existing, incoming) {
  const mergedGroups = unique([
    ...ensureArray(existing.raw_group_hits),
    ...ensureArray(incoming.raw_group_hits),
  ]);

  const mergedQueryUseds = unique([
    ...ensureArray(existing.query_useds),
    ...ensureArray(incoming.query_useds),
  ]);

  const mergedSeedTags = unique([
    ...ensureArray(existing.seed_tags),
    ...ensureArray(incoming.seed_tags),
  ]);

  return {
    ...existing,
    id: existing.id || incoming.id,
    title: pickBetterTitle(existing.title, incoming.title),
    abstract: pickLongerText(existing.abstract, incoming.abstract),
    snippet: pickLongerText(existing.snippet, incoming.snippet),
    authors: mergeAuthors(existing.authors, incoming.authors),
    venue: pickBetterVenue(existing.venue, incoming.venue),
    year: safeInt(existing.year) ?? safeInt(incoming.year),
    cited_by: Math.max(Number(existing.cited_by ?? 0), Number(incoming.cited_by ?? 0)),
    doi: firstNonEmpty(existing.doi, incoming.doi),
    arxiv_id: firstNonEmpty(existing.arxiv_id, incoming.arxiv_id),
    urls: mergeUrlMaps(existing.urls, incoming.urls),
    scholar_url: firstNonEmpty(existing.scholar_url, incoming.scholar_url),
    pub_url: firstNonEmpty(existing.pub_url, incoming.pub_url),
    eprint_url: firstNonEmpty(existing.eprint_url, incoming.eprint_url),
    container_type: firstNonEmpty(existing.container_type, incoming.container_type),
    query_useds: mergedQueryUseds,
    raw_group_hits: mergedGroups,
    search_sets_raw: mergedGroups,
    raw_payloads: [
      ...ensureArray(existing.raw_payloads),
      ...ensureArray(incoming.raw_payloads),
    ],
    seed_tags: mergedSeedTags,
    tag_hints: {
      force_tinyml:
        Boolean(existing.tag_hints?.force_tinyml) ||
        Boolean(incoming.tag_hints?.force_tinyml),
      require_power_tag:
        Boolean(existing.tag_hints?.require_power_tag) ||
        Boolean(incoming.tag_hints?.require_power_tag),
    },
    dedupe_key: existing.dedupe_key || incoming.dedupe_key,
  };
}

function dedupeWithinGroup(items, groupKey) {
  const map = new Map();

  for (const rawPaper of items) {
    const normalized = normalizeIncomingPaper(rawPaper, groupKey);
    const key = normalized.dedupe_key;

    if (!map.has(key)) {
      map.set(key, normalized);
      continue;
    }

    map.set(key, mergePaperRecords(map.get(key), normalized));
  }

  return [...map.values()];
}

function computeFinalSearchSets(rawSets = []) {
  const raw = unique(rawSets);

  if ((raw.includes('B') || raw.includes('C')) && raw.includes('A')) {
    return raw.filter((group) => group !== 'A');
  }

  return raw;
}

function computePrimaryGroup(finalSets = []) {
  if (finalSets.includes('C')) return 'C';
  if (finalSets.includes('B')) return 'B';
  if (finalSets.includes('A')) return 'A';
  return finalSets[0] ?? null;
}

function finalizeMergedRecord(paper) {
  const finalSets = computeFinalSearchSets(paper.search_sets_raw);

  const seedTags = unique([
    ...(paper.seed_tags ?? []),
    ...(finalSets.includes('C') ? [TAGS.TINYML] : []),
  ]);

  return {
    ...paper,
    search_sets_final: finalSets,
    primary_group: computePrimaryGroup(finalSets),
    seed_tags: seedTags,
    tag_hints: {
      ...(paper.tag_hints ?? {}),
      force_tinyml: finalSets.includes('C'),
      require_power_tag: finalSets.includes('B'),
    },
  };
}

function sortMergedPapers(a, b) {
  const ay = safeInt(a.year) ?? 0;
  const by = safeInt(b.year) ?? 0;
  if (by !== ay) return by - ay;

  const ac = Number(a.cited_by ?? 0);
  const bc = Number(b.cited_by ?? 0);
  if (bc !== ac) return bc - ac;

  return toTrimmedString(a.title).localeCompare(toTrimmedString(b.title));
}

export function summarizeRawGroupCounts(groupedPayloads = {}) {
  const summary = {};
  for (const groupKey of GROUP_ORDER) {
    summary[groupKey] = extractItemsFromGroupPayload(groupedPayloads[groupKey]).length;
  }
  return summary;
}

export function runSetOperations(groupedPayloads = {}) {
  const rawCounts = summarizeRawGroupCounts(groupedPayloads);

  const groupDeduped = {};
  const crossGroupMap = new Map();

  for (const groupKey of GROUP_ORDER) {
    const rawItems = extractItemsFromGroupPayload(groupedPayloads[groupKey]);
    const dedupedItems = dedupeWithinGroup(rawItems, groupKey);

    groupDeduped[groupKey] = dedupedItems;

    for (const paper of dedupedItems) {
      const key = paper.dedupe_key;
      if (!crossGroupMap.has(key)) {
        crossGroupMap.set(key, paper);
      } else {
        crossGroupMap.set(key, mergePaperRecords(crossGroupMap.get(key), paper));
      }
    }
  }

  const mergedPapers = [...crossGroupMap.values()]
    .map(finalizeMergedRecord)
    .sort(sortMergedPapers);

  const partitions = {
    A_only: [],
    B: [],
    C: [],
    BC_overlap: [],
  };

  for (const paper of mergedPapers) {
    const sets = paper.search_sets_final;

    if (sets.includes('A') && !sets.includes('B') && !sets.includes('C')) {
      partitions.A_only.push(paper);
      continue;
    }

    if (sets.includes('B') && sets.includes('C')) {
      partitions.BC_overlap.push(paper);
      partitions.B.push(paper);
      partitions.C.push(paper);
      continue;
    }

    if (sets.includes('B')) {
      partitions.B.push(paper);
    }

    if (sets.includes('C')) {
      partitions.C.push(paper);
    }
  }

  const stats = {
    raw_counts: rawCounts,
    after_set_ops: {
      A_only: partitions.A_only.length,
      B: partitions.B.length,
      C: partitions.C.length,
      merged_total: mergedPapers.length,
      bc_overlap: partitions.BC_overlap.length,
    },
  };

  return {
    stats,
    grouped_deduped: groupDeduped,
    merged_papers: mergedPapers,
    partitions,
  };
}

export function buildCandidateListForFiltering(setOpsResult) {
  return [...(setOpsResult?.merged_papers ?? [])];
}

export function explainPaperSetMembership(paper) {
  const raw = paper?.search_sets_raw ?? [];
  const finalSets = paper?.search_sets_final ?? [];

  return {
    raw_sets: raw,
    final_sets: finalSets,
    removed_from_A: raw.includes('A') && !finalSets.includes('A'),
    is_A_only: finalSets.length === 1 && finalSets[0] === 'A',
    is_B_only: finalSets.length === 1 && finalSets[0] === 'B',
    is_C_only: finalSets.length === 1 && finalSets[0] === 'C',
    is_BC_overlap: finalSets.includes('B') && finalSets.includes('C'),
  };
}