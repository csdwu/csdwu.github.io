import {
  FILTER_POLICIES,
  getVenueCandidates,
  pickBestVenueMatch,
  isArxivUrl,
} from './config.mjs';

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

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = toTrimmedString(value);
    if (text) return text;
  }
  return '';
}

function isArxivVenue(value) {
  return /^arxiv(\.org)?$/i.test(toTrimmedString(value));
}

function firstRealVenue(...values) {
  for (const value of values) {
    const text = toTrimmedString(value);
    if (text && !isArxivVenue(text)) {
      return text;
    }
  }
  return '';
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
    extractArxivIdFromText(paper.title),
  );
}

function inferGroupPolicy(paper = {}, options = {}) {
  const rawSets = ensureArray(paper.search_sets_raw);
  const finalSets = ensureArray(paper.search_sets_final);
  const source = toTrimmedString(paper.source);
  const skipArxivInA = Boolean(options.skipArxivInA);

  const rawInA = rawSets.includes('A');
  const inA = finalSets.includes('A');
  const inB = finalSets.includes('B');
  const inC = finalSets.includes('C');

  // When the flag is on, anything that originally matched A must satisfy TH_CPL_A strictly.
  if (skipArxivInA && rawInA) {
    return FILTER_POLICIES.TH_CPL_A;
  }

  // arXiv papers should keep the broad fallback for B/C and the default A behavior.
  if (source === 'arxiv') {
    return FILTER_POLICIES.TH_CPL_AB_OR_ARXIV;
  }

  if (inA) {
    return FILTER_POLICIES.TH_CPL_A;
  }

  if (inB || inC) {
    return FILTER_POLICIES.TH_CPL_AB_OR_ARXIV;
  }

  return FILTER_POLICIES.TH_CPL_AB_OR_ARXIV;
}

function getPrimaryVenueString(paper = {}) {
  return firstRealVenue(
    paper.venue,
    paper.inferred_venue,
    paper.publication_venue,
    paper.journal_ref,
    paper.matched_venue,
    paper.raw_venue,
  );
}

function collectArxivSignals(paper = {}) {
  const urls = buildUrlMap(paper);
  const candidates = unique([
    urls.arxiv,
    urls.pdf,
    urls.paper,
    paper.scholar_url,
    paper.pub_url,
    paper.eprint_url,
  ]);

  const matchedUrls = candidates.filter((url) => isArxivUrl(url));
  const arxivId = extractArxivId(paper);
  const source = toTrimmedString(paper.source).toLowerCase();
  const preprintSource = toTrimmedString(paper.preprint_source).toLowerCase();
  const isPreprintOnArxiv = Boolean(paper.is_preprint_on_arxiv) || source === 'arxiv' || preprintSource === 'arxiv';

  return {
    is_on_arxiv: matchedUrls.length > 0 || Boolean(arxivId) || isPreprintOnArxiv,
    arxiv_id: arxivId || '',
    matched_urls: matchedUrls,
  };
}

function buildVenueMatchPayload(venueValue, policy) {
  const venueCandidates = getVenueCandidates(venueValue);
  const best = pickBestVenueMatch(venueValue, policy);

  return {
    raw_venue: venueCandidates.raw,
    normalized_venue: venueCandidates.normalized,
    normalized_venue_candidates: venueCandidates.normalizedCandidates,
    venue_candidates_debug: venueCandidates,
    match_result: best,
  };
}

function normalizeFilterBucket({ policy, hasVenueMatch, hasArxiv, hasRealVenue }) {
  if (policy === FILTER_POLICIES.TH_CPL_A) {
    return hasVenueMatch ? 'th_cpl_a' : 'rejected';
  }

  if (hasVenueMatch) {
    const level = policy === FILTER_POLICIES.TH_CPL_A ? 'A' : 'AB';
    return level === 'A' ? 'th_cpl_a' : 'th_cpl_ab';
  }

  if (hasArxiv && !hasRealVenue) {
    return 'arxiv';
  }

  return 'rejected';
}

function buildFilterDecision(paper = {}, policy = inferGroupPolicy(paper)) {
  const venueValue = getPrimaryVenueString(paper);
  const venuePayload = buildVenueMatchPayload(venueValue, policy);
  const arxivSignals = collectArxivSignals(paper);

  const hasRealVenue = Boolean(venueValue);
  const venueMatched = Boolean(venuePayload.match_result?.matched);
  const arxivMatched = Boolean(arxivSignals.is_on_arxiv);

  let accepted = false;
  let reason = 'rejected_no_matching_venue_or_arxiv';

  if (policy === FILTER_POLICIES.TH_CPL_A) {
    accepted = venueMatched;
    reason = accepted
      ? 'matched_th_cpl_a'
      : 'rejected_not_in_th_cpl_a';
  } else if (policy === FILTER_POLICIES.TH_CPL_AB_OR_ARXIV) {
    accepted = venueMatched || (!hasRealVenue && arxivMatched);
    if (venueMatched) {
      reason = 'matched_th_cpl_ab';
    } else if (!hasRealVenue && arxivMatched) {
      reason = 'matched_arxiv';
    } else if (hasRealVenue) {
      reason = 'rejected_real_venue_did_not_match_th_cpl';
    } else {
      reason = 'rejected_not_in_th_cpl_ab_and_not_on_arxiv';
    }
  }

  const bucket = normalizeFilterBucket({
    policy,
    hasVenueMatch: venueMatched,
    hasArxiv: arxivMatched,
    hasRealVenue,
  });

  const match = venuePayload.match_result?.match ?? null;

  return {
    accepted,
    policy,
    filter_bucket: bucket,
    filter_reason: reason,
    matched_venue: match?.canonicalShort || match?.canonicalFull || '',
    matched_th_cpl_level: match?.level || '',
    matched_th_cpl_area: match?.area || '',
    matched_venue_type: match?.type || '',
    venue_match: {
      matched: venueMatched,
      raw: venuePayload.raw_venue,
      normalized: venuePayload.normalized_venue,
      normalized_candidates: venuePayload.normalized_venue_candidates,
      match,
    },
    arxiv_match: {
      matched: arxivMatched,
      arxiv_id: arxivSignals.arxiv_id,
      matched_urls: arxivSignals.matched_urls,
    },
  };
}

function attachDecisionToPaper(paper, decision) {
  const urls = buildUrlMap(paper);

  return {
    ...paper,
    urls: {
      ...urls,
      ...(decision.arxiv_match?.matched && decision.arxiv_match.arxiv_id
        ? { arxiv: urls.arxiv || `https://arxiv.org/abs/${decision.arxiv_match.arxiv_id}` }
        : {}),
    },
    arxiv_id: paper.arxiv_id || decision.arxiv_match?.arxiv_id || '',
    filter_policy: decision.policy,
    filter_bucket: decision.filter_bucket,
    filter_reason: decision.filter_reason,
    matched_venue: decision.matched_venue,
    matched_th_cpl_level: decision.matched_th_cpl_level,
    matched_th_cpl_area: decision.matched_th_cpl_area,
    matched_venue_type: decision.matched_venue_type,
    venue_match: decision.venue_match,
    arxiv_match: decision.arxiv_match,
    is_in_arxiv: Boolean(decision.arxiv_match?.matched),
  };
}

function sortFilteredPapers(a, b) {
  const ay = safeInt(a.year) ?? 0;
  const by = safeInt(b.year) ?? 0;
  if (by !== ay) return by - ay;

  const ac = Number(a.cited_by ?? 0);
  const bc = Number(b.cited_by ?? 0);
  if (bc !== ac) return bc - ac;

  return toTrimmedString(a.title).localeCompare(toTrimmedString(b.title));
}

export function filterPaperByVenueRule(paper, policy = inferGroupPolicy(paper)) {
  const decision = buildFilterDecision(paper, policy);
  return {
    accepted: decision.accepted,
    decision,
    paper: attachDecisionToPaper(paper, decision),
  };
}

export function applyFilterRulesToPapers(papers = [], options = {}) {
  const accepted = [];
  const rejected = [];

  for (const paper of papers) {
    const policy = inferGroupPolicy(paper, options);
    const result = filterPaperByVenueRule(paper, policy);

    if (result.accepted) {
      accepted.push(result.paper);
    } else {
      rejected.push(result.paper);
    }
  }

  accepted.sort(sortFilteredPapers);
  rejected.sort(sortFilteredPapers);

  return {
    accepted,
    rejected,
    stats: summarizeFilterStats(accepted, rejected),
  };
}

export function applyFilterRulesToSetOps(setOpsResult = {}, options = {}) {
  const mergedPapers = ensureArray(setOpsResult.merged_papers);
  const { accepted, rejected, stats } = applyFilterRulesToPapers(mergedPapers, options);

  const acceptedByPartition = {
    A_only: [],
    B: [],
    C: [],
    BC_overlap: [],
  };

  for (const paper of accepted) {
    const finalSets = ensureArray(paper.search_sets_final);

    if (finalSets.includes('A') && !finalSets.includes('B') && !finalSets.includes('C')) {
      acceptedByPartition.A_only.push(paper);
    }

    if (finalSets.includes('B')) {
      acceptedByPartition.B.push(paper);
    }

    if (finalSets.includes('C')) {
      acceptedByPartition.C.push(paper);
    }

    if (finalSets.includes('B') && finalSets.includes('C')) {
      acceptedByPartition.BC_overlap.push(paper);
    }
  }

  return {
    ...setOpsResult,
    filtered_papers: accepted,
    rejected_papers: rejected,
    filtered_partitions: acceptedByPartition,
    stats: {
      ...(setOpsResult.stats ?? {}),
      after_filter: accepted.length,
      filter_breakdown: stats,
    },
  };
}

export function summarizeFilterStats(accepted = [], rejected = []) {
  const bucketCounts = {
    th_cpl_a: 0,
    th_cpl_ab: 0,
    arxiv: 0,
    rejected: 0,
  };

  const policyCounts = {
    [FILTER_POLICIES.TH_CPL_A]: 0,
    [FILTER_POLICIES.TH_CPL_AB_OR_ARXIV]: 0,
  };

  const rejectionReasons = {};
  const acceptedLevels = {
    A: 0,
    B: 0,
    other: 0,
  };

  for (const paper of accepted) {
    const bucket = paper.filter_bucket || 'rejected';
    if (bucketCounts[bucket] != null) {
      bucketCounts[bucket] += 1;
    }

    const policy = paper.filter_policy;
    if (policyCounts[policy] != null) {
      policyCounts[policy] += 1;
    }

    const level = paper.matched_th_cpl_level;
    if (level === 'A') {
      acceptedLevels.A += 1;
    } else if (level === 'B') {
      acceptedLevels.B += 1;
    } else {
      acceptedLevels.other += 1;
    }
  }

  for (const paper of rejected) {
    bucketCounts.rejected += 1;
    const reason = paper.filter_reason || 'unknown_rejection_reason';
    rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
  }

  return {
    accepted_count: accepted.length,
    rejected_count: rejected.length,
    bucket_counts: bucketCounts,
    policy_counts: policyCounts,
    accepted_levels: acceptedLevels,
    rejection_reasons: rejectionReasons,
  };
}

export function inferPaperFilterPolicy(paper = {}, options = {}) {
  return inferGroupPolicy(paper, options);
}

/**
 * Determines whether a paper should be hidden from final output (frontend JSON).
 * Used when --refilter-all is enabled to exclude papers that don't meet current criteria.
 * 
 * Note: This only determines visibility for frontend output. Papers remain in canonical data.
 * 
 * @param {object} paper Paper object
 * @param {object} options Options
 * @param {boolean} options.skipArxivInA Whether to hide A-only arXiv papers
 * @returns {boolean} true if paper should be hidden from frontend output
 */
export function shouldHideFromFinalOutput(paper = {}, options = {}) {
  const { skipArxivInA = false } = options;

  if (!skipArxivInA) {
    return false;
  }

  const groups = ensureArray(paper.search_sets_raw ?? paper.search_sets_final ?? paper.search_sets ?? [])
    .map((g) => toTrimmedString(g))
    .filter((g) => ['A', 'B', 'C'].includes(g));

  const inA = groups.includes('A');

  if (!inA) {
    return false;
  }

  const hasThCplA = toTrimmedString(paper.matched_th_cpl_level) === 'A';

  if (hasThCplA) {
    return false;
  }

  // Raw A membership is enough to require a real TH_CPL A match when the flag is enabled.
  return !hasThCplA;
}