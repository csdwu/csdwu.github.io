/**
 * Source Statistics Module
 * 
 * Computes raw and final source statistics for Embedded AI paper pipeline,
 * including per-group breakdown by source (arxiv vs. TH-CPL venues).
 */

import { TH_CPL } from './config.mjs';

function toTrimmedString(value) {
  return String(value ?? '').trim();
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

/**
 * Extracts all TH-CPL venue short forms from config.
 * Returns both A-level and B-level venue abbreviations.
 * Venue entries are { full, short, aliases }, short is the abbreviation.
 * @returns {string[]} Sorted unique venue abbreviations (e.g., ['DAC', 'HPCA', 'ISCA', ...])
 */
export function extractAllThCplVenues() {
  const venues = new Set();

  for (const areaData of Object.values(TH_CPL)) {
    // Process A-level venues
    if (areaData.A) {
      if (areaData.A.conferences) {
        for (const conf of areaData.A.conferences) {
          if (conf && conf.short) {
            venues.add(conf.short);
          }
        }
      }
      if (areaData.A.journals) {
        for (const journal of areaData.A.journals) {
          if (journal && journal.short) {
            venues.add(journal.short);
          }
        }
      }
    }

    // Process B-level venues
    if (areaData.B) {
      if (areaData.B.conferences) {
        for (const conf of areaData.B.conferences) {
          if (conf && conf.short) {
            venues.add(conf.short);
          }
        }
      }
      if (areaData.B.journals) {
        for (const journal of areaData.B.journals) {
          if (journal && journal.short) {
            venues.add(journal.short);
          }
        }
      }
    }
  }

  return Array.from(venues).sort();
}

/**
 * Normalizes a paper's venue to TH-CPL short form, other_venue, or unknown.
 * Priority:
 * 1) matched_venue (non-empty)
 * 2) venue (non-empty and not arxiv)
 * 3) filter_bucket=arxiv OR source=arxiv
 * 4) unknown
 * @param {object} paper Paper object
 * @returns {object} { type: 'arxiv' | 'th_cpl' | 'other_venue' | 'unknown', value: string }
 */
export function normalizeVenue(paper = {}) {
  const matchedVenue = toTrimmedString(paper.matched_venue);
  if (matchedVenue && matchedVenue.toLowerCase() !== 'unknown') {
    return { type: 'th_cpl', value: matchedVenue };
  }

  const venue = toTrimmedString(paper.venue);
  if (venue && venue.toLowerCase() !== 'arxiv' && venue.toLowerCase() !== 'unknown') {
    return { type: 'other_venue', value: venue };
  }

  const filterBucket = toTrimmedString(paper.filter_bucket).toLowerCase();
  const source = toTrimmedString(paper.source).toLowerCase();
  if (filterBucket === 'arxiv' || source === 'arxiv') {
    return { type: 'arxiv', value: 'arxiv' };
  }

  return { type: 'unknown', value: 'unknown' };
}

/**
 * Extracts the group(s) for a paper.
 * Priority: search_sets_final > search_sets > group > fallback to ungrouped
 * @param {object} paper Paper object
 * @returns {string[]} Array of group abbreviations ('A', 'B', 'C', or 'ungrouped')
 */
export function extractGroups(paper = {}) {
  const sets = ensureArray(paper.search_sets_final ?? paper.search_sets ?? paper.group ?? [])
    .map((g) => toTrimmedString(g))
    .filter((g) => g && ['A', 'B', 'C'].includes(g));

  if (sets.length > 0) {
    return [...new Set(sets)];
  }

  return ['ungrouped'];
}

/**
 * Builds the structure for a single group's statistics.
 * @param {string[]} allThCplVenues All available TH-CPL venue abbreviations
 * @returns {object} Initialized group stats object
 */
function buildGroupStatsTemplate(allThCplVenues = []) {
  return {
    total: 0,
    arxiv: 0,
    venues: Object.fromEntries(
      allThCplVenues.map((v) => [v, 0]),
    ),
    other_venue: 0,
    unknown: 0,
  };
}

/**
 * Computes source statistics for a batch of papers.
 * Returns per-group and total summaries with full TH-CPL venue enumeration.
 * @param {object[]} papers Array of paper objects
 * @param {object} options Options object
 * @param {string} options.mode 'raw' or 'final' (used for logging)
 * @param {string[]} options.allThCplVenues All TH-CPL venues
 * @returns {object} Statistics with by_group and total_summary
 */
export function computeSourceStats(papers = [], options = {}) {
  const { mode = 'final', allThCplVenues = extractAllThCplVenues() } = options;

  const stats = {
    total: papers.length,
    by_group: {
      A: buildGroupStatsTemplate(allThCplVenues),
      B: buildGroupStatsTemplate(allThCplVenues),
      C: buildGroupStatsTemplate(allThCplVenues),
      ungrouped: buildGroupStatsTemplate(allThCplVenues),
    },
    total_summary: buildGroupStatsTemplate(allThCplVenues),
  };

  for (const paper of papers) {
    const groups = extractGroups(paper);
    const venueInfo = normalizeVenue(paper);

    for (const group of groups) {
      if (!stats.by_group[group]) {
        stats.by_group[group] = buildGroupStatsTemplate(allThCplVenues);
      }

      const groupStats = stats.by_group[group];
      groupStats.total += 1;

      if (venueInfo.type === 'arxiv') {
        groupStats.arxiv += 1;
      } else if (venueInfo.type === 'th_cpl') {
        groupStats.venues[venueInfo.value] = (groupStats.venues[venueInfo.value] ?? 0) + 1;
      } else if (venueInfo.type === 'other_venue') {
        if (groupStats.venues[venueInfo.value] != null) {
          groupStats.venues[venueInfo.value] += 1;
        } else {
          groupStats.other_venue += 1;
        }
      } else {
        groupStats.unknown += 1;
      }

      // Also update total summary
      stats.total_summary.total += 1;
      if (venueInfo.type === 'arxiv') {
        stats.total_summary.arxiv += 1;
      } else if (venueInfo.type === 'th_cpl') {
        stats.total_summary.venues[venueInfo.value] = (stats.total_summary.venues[venueInfo.value] ?? 0) + 1;
      } else if (venueInfo.type === 'other_venue') {
        if (stats.total_summary.venues[venueInfo.value] != null) {
          stats.total_summary.venues[venueInfo.value] += 1;
        } else {
          stats.total_summary.other_venue += 1;
        }
      } else {
        stats.total_summary.unknown += 1;
      }
    }
  }

  return stats;
}

/**
 * Creates a full source statistics report with raw, final, and metadata.
 * @param {object} params Parameters
 * @param {object[]} params.rawPapers Raw papers (before filtering)
 * @param {object[]} params.finalPapers Final papers (after filtering and classification)
 * @param {object} params.cliOptions CLI options from update-papers.mjs
 * @param {string} params.generatedAt ISO timestamp
 * @returns {object} Complete statistics report
 */
export function buildSourceStatsReport({
  rawPapers = [],
  finalPapers = [],
  cliOptions = {},
  generatedAt = new Date().toISOString(),
}) {
  const allThCplVenues = extractAllThCplVenues();

  const rawStats = computeSourceStats(rawPapers, {
    mode: 'raw',
    allThCplVenues,
  });

  const finalStats = computeSourceStats(finalPapers, {
    mode: 'final',
    allThCplVenues,
  });

  return {
    generated_at: generatedAt,
    options: {
      source: cliOptions.source ?? 'unknown',
      groups: cliOptions.groups ?? [],
      skip_arxiv_in_a: Boolean(cliOptions.skipArxivInA),
      skip_search: Boolean(cliOptions.skipSearch),
      year_low: cliOptions.yearLow ?? null,
      year_high: cliOptions.yearHigh ?? null,
    },
    raw: rawStats,
    final: finalStats,
  };
}

/**
 * Extracts final statistics suitable for embedding in _data/embedded_ai_papers.json
 * (includes only final stats, not raw)
 * @param {object} statsReport Full source statistics report from buildSourceStatsReport
 * @returns {object} Final statistics only
 */
export function extractFinalStatsForJson(statsReport = {}) {
  if (!statsReport.final) return null;

  const finalStats = statsReport.final;
  return {
    total: finalStats.total,
    by_group: { ...finalStats.by_group },
    total_summary: { ...finalStats.total_summary },
  };
}

/**
 * Generates human-readable log lines for source statistics.
 * NOTE: These logs do NOT include [embedded-ai] prefix; logStep() will add it.
 * @param {object} params
 * @param {object} params.rawStats Raw statistics
 * @param {object} params.finalStats Final statistics
 * @param {object} params.cliOptions CLI options
 * @returns {string[]} Array of log lines (without [embedded-ai] prefix)
 */
export function generateSourceStatsLogs({
  rawStats = {},
  finalStats = {},
  cliOptions = {},
}) {
  const logs = [];

  // Raw counts by group
  if (rawStats.by_group) {
    const rawArxivByGroup = [];
    for (const group of ['A', 'B', 'C']) {
      const count = rawStats.by_group[group]?.arxiv ?? 0;
      rawArxivByGroup.push(`${group} arxiv=${count}`);
    }
    logs.push(`Raw source stats: ${rawArxivByGroup.join(', ')}`);
  }

  // Final counts by group
  if (finalStats.by_group) {
    const finalArxivByGroup = [];
    for (const group of ['A', 'B', 'C']) {
      const count = finalStats.by_group[group]?.arxiv ?? 0;
      finalArxivByGroup.push(`${group} arxiv=${count}`);
    }
    logs.push(`Final source stats: ${finalArxivByGroup.join(', ')}`);
  }

  // Explanation for --skip-arxiv-in-a
  if (cliOptions.skipArxivInA) {
    logs.push('skipArxivInA removes A-only arXiv from final output, but raw cache/search results are preserved.');
  }

  return logs;
}
