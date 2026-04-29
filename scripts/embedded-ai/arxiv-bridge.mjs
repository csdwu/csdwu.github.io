import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

import {
  GROUP_ORDER,
  ARXIV_QUERY_GROUPS,
  ARXIV_CRAWLER_DIR,
  ARXIV_CACHE_DIR,
  ARXIV_RAW_A_PATH,
  ARXIV_RAW_B_PATH,
  ARXIV_RAW_C_PATH,
  LAST_SEARCH_STATE_PATH,
  ARXIV_INCREMENTAL_OVERLAP_DAYS,
} from './config.mjs';

const ARXIV_SEARCH_PY_PATH = path.resolve(ARXIV_CRAWLER_DIR, 'arxiv_search.py');

const DEFAULT_PYTHON_CANDIDATES = Object.freeze([
  ...(process.env.PYTHON_BIN ? [process.env.PYTHON_BIN] : []),
  'python3',
  'python',
]);

const RAW_PATH_BY_GROUP = Object.freeze({
  A: ARXIV_RAW_A_PATH,
  B: ARXIV_RAW_B_PATH,
  C: ARXIV_RAW_C_PATH,
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function validateGroupKey(groupKey) {
  if (!GROUP_ORDER.includes(groupKey)) {
    throw new Error(
      `Invalid arXiv group "${groupKey}". Expected one of: ${GROUP_ORDER.join(', ')}`,
    );
  }
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

export async function ensureArxivRuntimeDirs() {
  await Promise.all([
    ensureDir(ARXIV_CRAWLER_DIR),
    ensureDir(ARXIV_CACHE_DIR),
  ]);
}

export async function safeReadJson(filePath, fallbackValue = null) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) {
      return fallbackValue;
    }
    throw error;
  }
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function tryParseJson(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // ignore
  }

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      // ignore
    }
  }

  return null;
}

function buildArxivSearchArgs(groupKey, options = {}) {
  validateGroupKey(groupKey);

  const group = ARXIV_QUERY_GROUPS[groupKey];
  if (!group) {
    throw new Error(`arXiv group "${groupKey}" not found in config.`);
  }

  const {
    pageSize = 50,
    totalLimit = null,
    yearLow = null,
    yearHigh = null,
    updatedAfter = null,
  } = options;

  const args = [
    ARXIV_SEARCH_PY_PATH,
    '--query',
    group.primaryQuery,
    '--categories',
    group.categories.join(','),
    '--page-size',
    String(pageSize),
  ];

  if (totalLimit != null) {
    args.push('--total-limit', String(totalLimit));
  }

  if (yearLow != null) {
    args.push('--year-low', String(yearLow));
  }

  if (yearHigh != null) {
    args.push('--year-high', String(yearHigh));
  }

  if (updatedAfter) {
    args.push('--updated-after', String(updatedAfter));
  }

  return args;
}

function toIsoString(value) {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function shiftIsoByDays(isoValue, days) {
  const dt = new Date(isoValue);
  if (Number.isNaN(dt.getTime())) return null;
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString();
}

function buildDefaultSearchState() {
  return {
    source: 'arxiv',
    last_successful_search_at: null,
    overlap_buffer_days: ARXIV_INCREMENTAL_OVERLAP_DAYS,
    groups: Object.fromEntries(
      GROUP_ORDER.map((group) => [group, { last_successful_search_at: null }]),
    ),
  };
}

function normalizeSearchState(rawState) {
  const base = buildDefaultSearchState();
  const raw = rawState && typeof rawState === 'object' ? rawState : {};

  base.source = 'arxiv';
  base.last_successful_search_at = toIsoString(raw.last_successful_search_at);
  base.overlap_buffer_days = Number.isFinite(Number(raw.overlap_buffer_days))
    ? Number(raw.overlap_buffer_days)
    : ARXIV_INCREMENTAL_OVERLAP_DAYS;

  for (const group of GROUP_ORDER) {
    const g = raw.groups?.[group] ?? {};
    base.groups[group] = {
      last_successful_search_at: toIsoString(g.last_successful_search_at),
    };
  }

  return base;
}

function getGroupWatermark(state, groupKey) {
  return toIsoString(state?.groups?.[groupKey]?.last_successful_search_at)
    || toIsoString(state?.last_successful_search_at)
    || null;
}

function streamChildLines(stream, prefix, onChunk, options = {}) {
  const { echo = true } = options;
  let buffer = '';

  stream.on('data', (chunk) => {
    const text = String(chunk);
    onChunk(text);
    buffer += text;

    if (!echo) {
      return;
    }

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) {
        console.log(`[${prefix}] ${line}`);
      }
    }
  });

  stream.on('end', () => {
    if (!echo) {
      return;
    }
    if (buffer.trim()) {
      console.log(`[${prefix}] ${buffer}`);
    }
  });
}

function spawnWithCandidate(pythonBin, args, options = {}) {
  const { cwd = ARXIV_CRAWLER_DIR, env = {} } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    streamChildLines(
      child.stdout,
      `arxiv:${pythonBin}`,
      (text) => {
        stdout += text;
      },
      { echo: false },
    );

    streamChildLines(
      child.stderr,
      `arxiv-err:${pythonBin}`,
      (text) => {
        stderr += text;
      },
      { echo: true },
    );

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      resolve({
        pythonBin,
        code,
        stdout,
        stderr,
        ok: code === 0,
      });
    });
  });
}

async function runPythonCommand(args, options = {}) {
  const pythonCandidates = unique([
    ...(options.pythonCandidates ?? []),
    ...DEFAULT_PYTHON_CANDIDATES,
  ]);

  let lastFailure = null;

  for (const pythonBin of pythonCandidates) {
    try {
      const result = await spawnWithCandidate(pythonBin, args, options);

      if (result.ok) {
        return result;
      }

      lastFailure = new Error(
        [
          `Python command failed with exit code ${result.code}.`,
          `Interpreter: ${pythonBin}`,
          `Args: ${args.join(' ')}`,
          result.stderr ? `stderr:\n${result.stderr.trim()}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        lastFailure = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastFailure ?? new Error('Unable to run Python command.')
  );
}

export async function loadArxivRawGroup(groupKey) {
  validateGroupKey(groupKey);
  return safeReadJson(RAW_PATH_BY_GROUP[groupKey], []);
}

export async function loadAllArxivRawGroups() {
  const result = {};
  for (const groupKey of GROUP_ORDER) {
    result[groupKey] = await loadArxivRawGroup(groupKey);
  }
  return result;
}

export async function runArxivKeywordSearch(groupKey, options = {}) {
  validateGroupKey(groupKey);
  await ensureArxivRuntimeDirs();

  const outputPath = RAW_PATH_BY_GROUP[groupKey];
  const args = buildArxivSearchArgs(groupKey, options);

  const execResult = await runPythonCommand(args, options);
  const stdoutJson = tryParseJson(execResult.stdout);

  // Extract papers from the result object
  let papers = [];
  if (stdoutJson && Array.isArray(stdoutJson.papers)) {
    papers = stdoutJson.papers;
  } else if (Array.isArray(stdoutJson)) {
    papers = stdoutJson;
  }

  // Save to file
  await writeJson(outputPath, papers);

  return {
    group: groupKey,
    outputPath,
    command: ['python', ...args],
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    parsedStdout: stdoutJson,
    data: papers,
    searchMode: options.searchMode ?? 'full',
    watermark: options.watermark ?? null,
    overlapBufferDays: options.overlapBufferDays ?? ARXIV_INCREMENTAL_OVERLAP_DAYS,
    updatedAfter: options.updatedAfter ?? null,
  };
}

export async function runAllArxivKeywordSearches(options = {}) {
  await ensureArxivRuntimeDirs();
  const groups = options.groups?.length ? options.groups : GROUP_ORDER;
  const forceFullSearch = Boolean(options.forceFullSearch);
  const overlapBufferDays = Number.isFinite(Number(options.overlapBufferDays))
    ? Number(options.overlapBufferDays)
    : ARXIV_INCREMENTAL_OVERLAP_DAYS;

  const stateRaw = await safeReadJson(LAST_SEARCH_STATE_PATH, null);
  const state = normalizeSearchState(stateRaw);

  const runStartedAt = new Date().toISOString();
  const results = [];
  const groupedData = {};
  const perGroupStats = {};

  const runMode = forceFullSearch
    ? 'full'
    : (groups.every((groupKey) => getGroupWatermark(state, groupKey)) ? 'incremental' : 'full');

  console.log(
    `[embedded-ai] arXiv search mode: ${runMode} | force_full_search=${forceFullSearch} | overlap_buffer_days=${overlapBufferDays}`,
  );

  for (const groupKey of groups) {
    const watermark = forceFullSearch ? null : getGroupWatermark(state, groupKey);
    const incrementalUpdatedAfter = watermark
      ? shiftIsoByDays(watermark, -overlapBufferDays)
      : null;
    const searchMode = incrementalUpdatedAfter ? 'incremental' : 'full';

    console.log(
      `[embedded-ai] arXiv group ${groupKey}: mode=${searchMode}, watermark=${watermark ?? 'none'}, updated_after=${incrementalUpdatedAfter ?? 'none'}, overlap_buffer_days=${overlapBufferDays}`,
    );

    console.log(`[embedded-ai] arXiv group start: ${groupKey}`);
    const result = await runArxivKeywordSearch(groupKey, {
      ...options,
      updatedAfter: incrementalUpdatedAfter,
      searchMode,
      watermark,
      overlapBufferDays,
    });
    console.log(`[embedded-ai] arXiv group done: ${groupKey}`);
    results.push(result);
    groupedData[groupKey] = result.data;

    const pulledCount = Array.isArray(result.data) ? result.data.length : 0;
    perGroupStats[groupKey] = {
      mode: searchMode,
      watermark,
      updated_after: incrementalUpdatedAfter,
      overlap_buffer_days: overlapBufferDays,
      pulled_count: pulledCount,
      dedupe_kept_count: pulledCount,
    };

    console.log(
      `[embedded-ai] arXiv group ${groupKey} stats: pulled=${pulledCount}, dedupe_kept=${pulledCount}`,
    );

    state.groups[groupKey] = {
      last_successful_search_at: runStartedAt,
    };

    // Sleep between groups to avoid rate limiting
    if (groups.indexOf(groupKey) < groups.length - 1) {
      console.log(`[embedded-ai] Sleeping 3s before next arXiv group...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }

  state.source = 'arxiv';
  state.overlap_buffer_days = overlapBufferDays;
  state.last_successful_search_at = runStartedAt;
  await writeJson(LAST_SEARCH_STATE_PATH, state);

  const totalPulled = Object.values(perGroupStats).reduce(
    (sum, item) => sum + Number(item.pulled_count ?? 0),
    0,
  );
  console.log(
    `[embedded-ai] arXiv run summary: mode=${runMode}, watermark=${stateRaw?.last_successful_search_at ?? 'none'}, overlap_buffer_days=${overlapBufferDays}, pulled_total=${totalPulled}`,
  );

  return {
    results,
    groupedData,
    searchState: state,
    runMeta: {
      source: 'arxiv',
      mode: runMode,
      overlap_buffer_days: overlapBufferDays,
      watermark: stateRaw?.last_successful_search_at ?? null,
      per_group: perGroupStats,
      pulled_total: totalPulled,
      dedupe_kept_total: totalPulled,
    },
  };
}
