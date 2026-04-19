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

  const { maxResults = 200 } = options;

  const args = [
    ARXIV_SEARCH_PY_PATH,
    '--query',
    group.primaryQuery,
    '--categories',
    group.categories.join(','),
    '--max-results',
    String(maxResults),
  ];

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
    );

    streamChildLines(
      child.stderr,
      `arxiv-err:${pythonBin}`,
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
  };
}

export async function runAllArxivKeywordSearches(options = {}) {
  await ensureArxivRuntimeDirs();
  const groups = options.groups?.length ? options.groups : GROUP_ORDER;
  const results = [];
  const groupedData = {};

  for (const groupKey of groups) {
    console.log(`[embedded-ai] arXiv group start: ${groupKey}`);
    const result = await runArxivKeywordSearch(groupKey, options);
    console.log(`[embedded-ai] arXiv group done: ${groupKey}`);
    results.push(result);
    groupedData[groupKey] = result.data;
  }

  return { results, groupedData };
}
