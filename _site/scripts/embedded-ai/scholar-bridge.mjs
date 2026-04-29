import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

import {
  GROUP_ORDER,
  QUERY_GROUPS,
  DAILY_DOWNLOAD_LIMIT,
  SCHOLAR_MAX_RESULTS_PER_GROUP,
  SCHOLAR_REQUEST_SLEEP_SECONDS,
  SCHOLAR_RETRY_LIMIT,
  SCHOLAR_CRAWLER_DIR,
  SCHOLAR_CACHE_DIR,
  SCHOLAR_STATE_DIR,
  SCHOLAR_DOWNLOAD_DIR,
  SCHOLAR_RAW_A_PATH,
  SCHOLAR_RAW_B_PATH,
  SCHOLAR_RAW_C_PATH,
  SCHOLAR_NORMALIZED_PATH,
  DOWNLOAD_STATE_PATH,
  DOWNLOAD_QUOTA_PATH,
} from './config.mjs';

const MAIN_PY_PATH = path.resolve(SCHOLAR_CRAWLER_DIR, 'main.py');

const DEFAULT_PYTHON_CANDIDATES = Object.freeze([
  ...(process.env.PYTHON_BIN ? [process.env.PYTHON_BIN] : []),
  'python3',
  'python',
]);

const RAW_PATH_BY_GROUP = Object.freeze({
  A: SCHOLAR_RAW_A_PATH,
  B: SCHOLAR_RAW_B_PATH,
  C: SCHOLAR_RAW_C_PATH,
});

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function validateGroupKey(groupKey) {
  if (!GROUP_ORDER.includes(groupKey)) {
    throw new Error(
      `Invalid Scholar group "${groupKey}". Expected one of: ${GROUP_ORDER.join(', ')}`,
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

export async function ensureScholarRuntimeDirs() {
  await Promise.all([
    ensureDir(SCHOLAR_CRAWLER_DIR),
    ensureDir(SCHOLAR_CACHE_DIR),
    ensureDir(SCHOLAR_STATE_DIR),
    ensureDir(SCHOLAR_DOWNLOAD_DIR),
  ]);
}

export async function safeReadJson(filePath, fallbackValue = null) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (
      error?.code === 'ENOENT' ||
      error instanceof SyntaxError
    ) {
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

function buildQueryList(groupKey, overrideQueries = null) {
  validateGroupKey(groupKey);

  const group = QUERY_GROUPS[groupKey];
  if (overrideQueries?.length) {
    return unique(overrideQueries.map((q) => String(q).trim()));
  }

  return unique([
    group.primaryQuery,
    ...(group.fallbackQueries ?? []),
  ]);
}

function getRawOutputPath(groupKey, overridePath = null) {
  validateGroupKey(groupKey);
  return overridePath ?? RAW_PATH_BY_GROUP[groupKey];
}

function buildKeywordSearchArgs(groupKey, options = {}) {
  validateGroupKey(groupKey);

  const {
    outputPath = getRawOutputPath(groupKey),
    maxResults = SCHOLAR_MAX_RESULTS_PER_GROUP,
    sleepSeconds = SCHOLAR_REQUEST_SLEEP_SECONDS,
    retryLimit = SCHOLAR_RETRY_LIMIT,
    queries = null,
    yearLow = null,
    yearHigh = null,
    extraArgs = [],
  } = options;

  const finalQueries = buildQueryList(groupKey, queries);

  const args = [
    MAIN_PY_PATH,
    'keyword-search',
    '--group',
    groupKey,
    '--output',
    outputPath,
    '--max-results',
    String(maxResults),
    '--sleep-seconds',
    String(sleepSeconds),
    '--retry-limit',
    String(retryLimit),
    '--queries-json',
    JSON.stringify(finalQueries),
  ];

  if (yearLow != null) {
    args.push('--year-low', String(yearLow));
  }

  if (yearHigh != null) {
    args.push('--year-high', String(yearHigh));
  }

  args.push(...extraArgs);

  return args;
}

function buildDownloadArgs(options = {}) {
  const {
    inputPath = SCHOLAR_NORMALIZED_PATH,
    outputDir = SCHOLAR_DOWNLOAD_DIR,
    statePath = DOWNLOAD_STATE_PATH,
    quotaPath = DOWNLOAD_QUOTA_PATH,
    dailyLimit = DAILY_DOWNLOAD_LIMIT,
    maxDownloads = null,
    dryRun = false,
    extraArgs = [],
  } = options;

  const args = [
    MAIN_PY_PATH,
    'download',
    '--input',
    inputPath,
    '--output-dir',
    outputDir,
    '--state',
    statePath,
    '--quota',
    quotaPath,
    '--daily-limit',
    String(dailyLimit),
  ];

  if (maxDownloads != null) {
    args.push('--max-downloads', String(maxDownloads));
  }

  if (dryRun) {
    args.push('--dry-run');
  }

  args.push(...extraArgs);

  return args;
}

function streamChildLines(stream, prefix, onChunk) {
  let buffer = '';

  stream.on('data', (chunk) => {
    const text = String(chunk);
    onChunk(text);
    buffer += text;

    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (line.trim()) {
        console.log(`[${prefix}] ${line}`);
      }
    }
  });

  stream.on('end', () => {
    if (buffer.trim()) {
      console.log(`[${prefix}] ${buffer}`);
    }
  });
}

function spawnWithCandidate(pythonBin, args, options = {}) {
  const {
    cwd = SCHOLAR_CRAWLER_DIR,
    env = {},
  } = options;

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
      `scholar:${pythonBin}`,
      (text) => {
        stdout += text;
      },
    );

    streamChildLines(
      child.stderr,
      `scholar-err:${pythonBin}`,
      (text) => {
        stderr += text;
      },
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

  throw lastFailure ?? new Error('Unable to run Python command.');
}

export async function loadScholarRawGroup(groupKey) {
  validateGroupKey(groupKey);
  return safeReadJson(RAW_PATH_BY_GROUP[groupKey], []);
}

export async function loadAllScholarRawGroups() {
  const result = {};
  for (const groupKey of GROUP_ORDER) {
    result[groupKey] = await loadScholarRawGroup(groupKey);
  }
  return result;
}

export async function loadNormalizedPapers() {
  return safeReadJson(SCHOLAR_NORMALIZED_PATH, []);
}

export async function saveNormalizedPapers(papers) {
  await writeJson(SCHOLAR_NORMALIZED_PATH, papers ?? []);
  return SCHOLAR_NORMALIZED_PATH;
}

export async function runScholarKeywordSearch(groupKey, options = {}) {
  validateGroupKey(groupKey);
  await ensureScholarRuntimeDirs();

  const outputPath = getRawOutputPath(groupKey, options.outputPath);
  const args = buildKeywordSearchArgs(groupKey, {
    ...options,
    outputPath,
  });

  const execResult = await runPythonCommand(args, options);
  const fileData = await safeReadJson(outputPath, null);
  const stdoutJson = tryParseJson(execResult.stdout);

  return {
    group: groupKey,
    outputPath,
    command: [execResult.pythonBin, ...args],
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    parsedStdout: stdoutJson,
    data: fileData ?? stdoutJson ?? [],
  };
}

export async function runAllScholarKeywordSearches(options = {}) {
  await ensureScholarRuntimeDirs();
  const groups = options.groups?.length ? options.groups : GROUP_ORDER;
  const results = [];
  const groupedData = {};

  for (const groupKey of groups) {
    console.log(`[embedded-ai] Scholar group start: ${groupKey}`);
    const result = await runScholarKeywordSearch(groupKey, options);
    console.log(`[embedded-ai] Scholar group done: ${groupKey}`);
    results.push(result);
    groupedData[groupKey] = result.data;
  }

  return { results, groupedData };
}

export async function runDownloadManager(options = {}) {
  await ensureScholarRuntimeDirs();

  const args = buildDownloadArgs(options);
  const execResult = await runPythonCommand(args, options);

  const stdoutJson = tryParseJson(execResult.stdout);
  const state = await safeReadJson(DOWNLOAD_STATE_PATH, { papers: {} });
  const quota = await safeReadJson(DOWNLOAD_QUOTA_PATH, {});

  return {
    command: [execResult.pythonBin, ...args],
    stdout: execResult.stdout,
    stderr: execResult.stderr,
    parsedStdout: stdoutJson,
    state,
    quota,
    ok: execResult.ok,
    exitCode: execResult.code,
  };
}

export async function clearScholarCache({ includeNormalized = false } = {}) {
  const targets = [
    SCHOLAR_RAW_A_PATH,
    SCHOLAR_RAW_B_PATH,
    SCHOLAR_RAW_C_PATH,
  ];

  if (includeNormalized) {
    targets.push(SCHOLAR_NORMALIZED_PATH);
  }

  await Promise.all(
    targets.map(async (target) => {
      if (await pathExists(target)) {
        await fs.rm(target, { force: true });
      }
    }),
  );
}

export function summarizeRawCounts(groupedData = {}) {
  const summary = {};
  for (const groupKey of GROUP_ORDER) {
    const items = groupedData[groupKey];
    summary[groupKey] = Array.isArray(items) ? items.length : 0;
  }
  return summary;
}

export function getScholarBridgeConfigSnapshot() {
  return {
    crawlerDir: SCHOLAR_CRAWLER_DIR,
    cacheDir: SCHOLAR_CACHE_DIR,
    stateDir: SCHOLAR_STATE_DIR,
    downloadDir: SCHOLAR_DOWNLOAD_DIR,
    rawPaths: { ...RAW_PATH_BY_GROUP },
    normalizedPath: SCHOLAR_NORMALIZED_PATH,
    downloadStatePath: DOWNLOAD_STATE_PATH,
    downloadQuotaPath: DOWNLOAD_QUOTA_PATH,
    queryGroups: QUERY_GROUPS,
    groupOrder: GROUP_ORDER,
    defaults: {
      dailyDownloadLimit: DAILY_DOWNLOAD_LIMIT,
      scholarMaxResultsPerGroup: SCHOLAR_MAX_RESULTS_PER_GROUP,
      scholarSleepSeconds: SCHOLAR_REQUEST_SLEEP_SECONDS,
      scholarRetryLimit: SCHOLAR_RETRY_LIMIT,
    },
  };
}