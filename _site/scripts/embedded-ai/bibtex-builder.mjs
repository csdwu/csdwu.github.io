import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import {
  ARTIFACT_DIR,
  BIBTEX_ALL_PATH,
  CATEGORY_BIB_PATHS,
  CATEGORY_DISPLAY_ORDER,
  ensureCategory,
} from './config.mjs';

function ensureDir(dir) {
  return fs.mkdir(dir, { recursive: true });
}

function safeString(value) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function safeInt(value) {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function bibtexEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/([{}])/g, '\\$1')
    .trim();
}

function formatBibField(name, value) {
  const text = safeString(value);
  if (!text) return '';
  return `  ${name} = {${bibtexEscape(text)}}`;
}

function buildBibKey(paper) {
  const year = safeInt(paper.year);
  const firstAuthor = safeString(paper.authors?.[0] || '') || 'anon';
  const normalizedAuthor = firstAuthor
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .pop() || 'anon';

  const titleTokens = safeString(paper.title)
    ? safeString(paper.title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join('-')
    : 'paper';

  const stableHash = crypto
    .createHash('sha1')
    .update(`${paper.id || ''}||${paper.doi || ''}||${paper.arxiv_id || ''}`)
    .digest('hex')
    .slice(0, 8);

  return `${normalizedAuthor}${year ? year : 'na'}-${titleTokens}-${stableHash}`;
}

function pickBestUrl(paper) {
  const urls = paper.urls || {};
  return (
    safeString(urls.arxiv) ||
    safeString(urls.pdf) ||
    safeString(paper.pub_url) ||
    safeString(paper.scholar_url) ||
    null
  );
}

function buildBibEntry(paper) {
  const entryType = paper.arxiv_id ? 'article' : 'misc';
  const entryKey = buildBibKey(paper);
  const fields = [];

  if (Array.isArray(paper.authors) && paper.authors.length > 0) {
    fields.push(formatBibField('author', paper.authors.join(' and ')));
  }

  fields.push(formatBibField('title', paper.title));

  const year = safeInt(paper.year);
  if (year) {
    fields.push(formatBibField('year', String(year)));
  }

  const venue = safeString(paper.venue) || safeString(paper.matched_venue);
  if (venue) {
    fields.push(formatBibField(entryType === 'article' ? 'journal' : 'howpublished', venue));
  }

  if (safeString(paper.doi)) {
    fields.push(formatBibField('doi', paper.doi));
  }

  if (safeString(paper.arxiv_id)) {
    fields.push(formatBibField('eprint', paper.arxiv_id));
    fields.push(formatBibField('archivePrefix', 'arXiv'));
  }

  const url = pickBestUrl(paper);
  if (url) {
    fields.push(formatBibField('url', url));
  }

  if (safeString(paper.abstract)) {
    fields.push(formatBibField('abstract', paper.abstract));
  }

  if (safeString(paper.scholar_url)) {
    fields.push(formatBibField('note', `Google Scholar: ${paper.scholar_url}`));
  }

  const filteredFields = fields.filter(Boolean);
  return `@${entryType}{${entryKey},\n${filteredFields.join(',\n')}\n}`;
}

function getCategoryBibPath(category) {
  const normalizedCategory = ensureCategory(category);
  return CATEGORY_BIB_PATHS[normalizedCategory] || path.resolve(ARTIFACT_DIR, `${normalizedCategory}.bib`);
}

export async function generateBibtexArtifacts(papers = []) {
  await ensureDir(ARTIFACT_DIR);

  const categoryBuckets = new Map(
    CATEGORY_DISPLAY_ORDER.map((category) => [category, []]),
  );
  const allEntries = [];

  for (const paper of papers) {
    const category = ensureCategory(paper.category);
    const entry = buildBibEntry(paper);
    allEntries.push(entry);

    if (!categoryBuckets.has(category)) {
      categoryBuckets.set(category, []);
    }
    categoryBuckets.get(category).push(entry);
  }

  const allContent = `${allEntries.join('\n\n')}\n`;
  await fs.writeFile(BIBTEX_ALL_PATH, allContent, 'utf8');

  const artifactPaths = { all: BIBTEX_ALL_PATH };
  const counts = {
    total: papers.length,
    by_category: {},
  };

  for (const [category, entries] of categoryBuckets.entries()) {
    const outputPath = getCategoryBibPath(category);
    const content = `${entries.join('\n\n')}\n`;
    await fs.writeFile(outputPath, content, 'utf8');
    artifactPaths[category] = outputPath;
    counts.by_category[category] = entries.length;
  }

  return {
    ok: true,
    artifactPaths,
    counts,
  };
}
