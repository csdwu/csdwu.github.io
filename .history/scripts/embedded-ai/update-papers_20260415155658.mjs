import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { XMLParser } from "fast-xml-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const OUTPUT_PATH = path.join(REPO_ROOT, "_data", "embedded_ai_papers.json");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const ARXIV_API_BASE = "http://export.arxiv.org/api/query";

/**
 * arXiv suggests adding delays when making multiple API calls.
 * Default here is 3 seconds to be conservative.
 */
const REQUEST_DELAY_MS = Number.parseInt(
  process.env.REQUEST_DELAY_MS || "3000",
  10
);

const LLM_DELAY_MS = Number.parseInt(
  process.env.LLM_DELAY_MS || "400",
  10
);

/**
 * Keep these small. Better precision, lower cost, cleaner page.
 */
const MAX_RESULTS_PER_QUERY = Number.parseInt(
  process.env.MAX_RESULTS_PER_QUERY || "25",
  10
);

const CATEGORIES = [
  "Chip / Hardware",
  "Model / Algorithm",
  "System / Deployment",
  "Sensing / Application",
  "Security / Reliability",
];

/**
 * Search strategy:
 * - TinyML mirrors the "Tiny Machine Learning TinyML" idea,
 *   but in API form and tightened with AND.
 * - Embedded AI uses strict AND queries and then CCF-A venue filtering.
 */
const SOURCE_DEFINITIONS = [
  {
    key: "tinyml",
    title: "TinyML Papers",
    queries: ['all:"tiny machine learning" AND all:tinyml'],
    venueFilter: "none",
  },
  {
    key: "embedded_ai",
    title: "Embedded AI Papers",
    queries: [
      'all:"embedded ai" AND all:"embedded systems"',
      'all:"edge ai" AND all:"embedded devices"',
    ],
    venueFilter: "ccf_a_only",
  },
];

/**
 * Selected CCF-A venues most relevant to Embedded AI,
 * drawn from architecture/systems, AI, networking, and security.
 * Match against arXiv journal_ref / comment text.
 */
const CCF_A_VENUE_RULES = [
  // Architecture / systems conferences
  {
    canonical: "ASPLOS",
    patterns: [
      /\basplos\b/i,
      /architectural support for programming languages and operating systems/i,
    ],
  },
  {
    canonical: "DAC",
    patterns: [/\bdac\b/i, /design automation conference/i],
  },
  {
    canonical: "EuroSys",
    patterns: [/\beurosys\b/i, /european conference on computer systems/i],
  },
  {
    canonical: "HPCA",
    patterns: [/\bhpca\b/i, /high performance computer architecture/i],
  },
  {
    canonical: "ISCA",
    patterns: [/\bisca\b/i, /international symposium on computer architecture/i],
  },
  {
    canonical: "MICRO",
    patterns: [/\bmicro\b/i, /international symposium on microarchitecture/i],
  },

  // Networking / mobile / edge-relevant conferences
  {
    canonical: "MobiCom",
    patterns: [/\bmobicom\b/i, /mobile computing and networking/i],
  },
  {
    canonical: "INFOCOM",
    patterns: [/\binfocom\b/i, /conference on computer communications/i],
  },
  {
    canonical: "NSDI",
    patterns: [/\bnsdi\b/i, /networked systems design and implementation/i],
  },
  {
    canonical: "SIGCOMM",
    patterns: [/\bsigcomm\b/i, /applications,\s*technologies,\s*architectures,\s*and protocols for computer communication/i],
  },

  // Security conferences
  {
    canonical: "NDSS",
    patterns: [/\bndss\b/i, /network and distributed system security symposium/i],
  },
  {
    canonical: "S&P",
    patterns: [/\bs&p\b/i, /\bsp\b/i, /security and privacy/i],
  },
  {
    canonical: "CCS",
    patterns: [/\bccs\b/i, /computer and communications security/i],
  },

  // AI conferences
  {
    canonical: "AAAI",
    patterns: [/\baaai\b/i, /aaai conference on artificial intelligence/i],
  },
  {
    canonical: "NeurIPS",
    patterns: [
      /\bneurips\b/i,
      /\bnips\b/i,
      /neural information processing systems/i,
    ],
  },
  {
    canonical: "CVPR",
    patterns: [/\bcvpr\b/i, /computer vision and pattern recognition/i],
  },
  {
    canonical: "ICCV",
    patterns: [/\biccv\b/i, /international conference on computer vision/i],
  },
  {
    canonical: "ICML",
    patterns: [/\bicml\b/i, /international conference on machine learning/i],
  },
  {
    canonical: "IJCAI",
    patterns: [/\bijcai\b/i, /international joint conference on artificial intelligence/i],
  },

  // Architecture / systems journals
  {
    canonical: "IEEE TCAD",
    patterns: [
      /transactions on computer-aided design of integrated circuits and systems/i,
      /\btcad\b/i,
    ],
  },
  {
    canonical: "IEEE TC",
    patterns: [/\btransactions on computers\b/i, /\bieee transactions on computers\b/i],
  },
  {
    canonical: "IEEE TPDS",
    patterns: [
      /transactions on parallel and distributed systems/i,
      /\btpds\b/i,
    ],
  },
  {
    canonical: "ACM TACO",
    patterns: [
      /transactions on architecture and code optimization/i,
      /\btaco\b/i,
    ],
  },

  // Networking journals
  {
    canonical: "IEEE JSAC",
    patterns: [
      /journal on selected areas in communications/i,
      /\bjsac\b/i,
    ],
  },
  {
    canonical: "IEEE TMC",
    patterns: [/\btransactions on mobile computing\b/i, /\btmc\b/i],
  },
  {
    canonical: "IEEE/ACM TON",
    patterns: [
      /transactions on networking/i,
      /\bton\b/i,
      /ieee\/acm transactions on networking/i,
    ],
  },

  // Security journals
  {
    canonical: "IEEE TDSC",
    patterns: [
      /transactions on dependable and secure computing/i,
      /\btdsc\b/i,
    ],
  },
  {
    canonical: "IEEE TIFS",
    patterns: [
      /transactions on information forensics and security/i,
      /\btifs\b/i,
    ],
  },

  // AI journals
  {
    canonical: "Artificial Intelligence",
    patterns: [/^artificial intelligence$/i, /\bartificial intelligence\b/i],
  },
  {
    canonical: "IEEE TPAMI",
    patterns: [
      /transactions on pattern analysis and machine intelligence/i,
      /\btpami\b/i,
    ],
  },
  {
    canonical: "IJCV",
    patterns: [/\bijcv\b/i, /international journal of computer vision/i],
  },
  {
    canonical: "JMLR",
    patterns: [/\bjmlr\b/i, /journal of machine learning research/i],
  },
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: true,
  trimValues: true,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

function normalizeTitle(title) {
  return cleanText(title).toLowerCase();
}

function paperKey(paper) {
  return `${paper.source_group}::${paper.id || normalizeTitle(paper.title)}`;
}

function buildCategoryBuckets() {
  return CATEGORIES.map((name) => ({
    name,
    papers: [],
  }));
}

function buildEmptyOutput() {
  return {
    last_updated: null,
    paper_sources: SOURCE_DEFINITIONS.map((source) => ({
      key: source.key,
      title: source.title,
      categories: buildCategoryBuckets(),
    })),
  };
}

async function readExistingOutput() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return buildEmptyOutput();
  }
}

function flattenExistingPapers(outputJson) {
  const result = [];
  for (const source of outputJson.paper_sources || []) {
    for (const category of source.categories || []) {
      for (const paper of category.papers || []) {
        result.push({
          ...paper,
          source_group: paper.source_group || source.key,
          source_group_title: paper.source_group_title || source.title,
          category: paper.category || category.name,
        });
      }
    }
  }
  return result;
}

function getArxivIdFromEntryId(entryId) {
  const value = cleanText(entryId);
  if (!value) return "";
  const match = value.match(/\/abs\/([^/]+)$/);
  return match ? match[1] : value;
}

function getPdfUrl(entry) {
  const links = toArray(entry.link);
  for (const link of links) {
    const href = link?.["@_href"];
    const title = cleanText(link?.["@_title"]);
    const type = cleanText(link?.["@_type"]);
    if (title.toLowerCase() === "pdf" || type === "application/pdf") {
      return href;
    }
  }

  const arxivId = getArxivIdFromEntryId(entry.id);
  return arxivId ? `https://arxiv.org/pdf/${arxivId}.pdf` : null;
}

function getVenueUrl(entry) {
  const doi = cleanText(entry.doi);
  if (doi) return `https://doi.org/${doi}`;

  const id = cleanText(entry.id);
  return id || null;
}

function getVenueDisplay(entry) {
  const journalRef = cleanText(entry.journal_ref);
  if (journalRef) return journalRef;

  const comment = cleanText(entry.comment);
  if (comment) return comment;

  return "arXiv";
}

function shouldShowMonth(dateString) {
  if (!dateString) return false;
  const publishedDate = new Date(dateString);
  if (Number.isNaN(publishedDate.getTime())) return false;

  const now = new Date();
  const twoYearsAgo = new Date(now);
  twoYearsAgo.setFullYear(now.getFullYear() - 2);

  return publishedDate >= twoYearsAgo;
}

function getMonthName(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
}

function normalizeArxivEntry(entry, sourceDef, query) {
  const arxivId = getArxivIdFromEntryId(entry.id);
  const title = cleanText(entry.title);
  const abstract = cleanText(entry.summary);
  const publishedAt = cleanText(entry.published);
  const updatedAt = cleanText(entry.updated);
  const journalRef = cleanText(entry.journal_ref) || null;
  const comment = cleanText(entry.comment) || null;
  const doi = cleanText(entry.doi) || null;

  const authors = toArray(entry.author)
    .map((author) => cleanText(author?.name))
    .filter(Boolean);

  const publishedDate = new Date(publishedAt);
  const year = Number.isNaN(publishedDate.getTime())
    ? null
    : publishedDate.getUTCFullYear();

  const month = shouldShowMonth(publishedAt) ? getMonthName(publishedAt) : null;

  return {
    id: doi || `arxiv:${arxivId || normalizeTitle(title)}`,
    arxiv_id: arxivId || null,
    doi,
    title,
    abstract,
    authors,
    published_at: publishedAt || null,
    updated_at: updatedAt || null,
    year,
    month,
    pdf_url: getPdfUrl(entry),
    venue_url: getVenueUrl(entry),
    venue: getVenueDisplay(entry),
    journal_ref: journalRef,
    comment: comment,
    source: "arXiv",
    source_group: sourceDef.key,
    source_group_title: sourceDef.title,
    source_query: query,
    matched_venue: null,
    category: null,
    classification_confidence: null,
    classification_reason: null,
  };
}

async function fetchArxivEntriesForQuery(sourceDef, query) {
  const url = new URL(ARXIV_API_BASE);
  url.searchParams.set("search_query", query);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(MAX_RESULTS_PER_QUERY));
  url.searchParams.set("sortBy", "submittedDate");
  url.searchParams.set("sortOrder", "descending");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "embedded-ai-page-updater/1.0",
      Accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(
      `arXiv request failed for ${sourceDef.key}: ${response.status} ${response.statusText}`
    );
  }

  const xml = await response.text();
  const parsed = xmlParser.parse(xml);
  const entries = toArray(parsed?.feed?.entry);

  return entries.map((entry) => normalizeArxivEntry(entry, sourceDef, query));
}

async function fetchAllCandidates() {
  const papers = [];

  for (const sourceDef of SOURCE_DEFINITIONS) {
    for (const query of sourceDef.queries) {
      const partial = await fetchArxivEntriesForQuery(sourceDef, query);
      papers.push(...partial);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return papers;
}

function dedupeWithinSource(papers) {
  const seen = new Set();
  const seenTitle = new Set();
  const result = [];

  for (const paper of papers) {
    const idKey = `${paper.source_group}::${paper.id}`;
    const titleKey = `${paper.source_group}::${normalizeTitle(paper.title)}`;

    if (paper.id && seen.has(idKey)) continue;
    if (paper.title && seenTitle.has(titleKey)) continue;

    if (paper.id) seen.add(idKey);
    if (paper.title) seenTitle.add(titleKey);

    result.push(paper);
  }

  return result;
}

function getSourceDefinition(sourceKey) {
  return SOURCE_DEFINITIONS.find((item) => item.key === sourceKey) || null;
}

function matchCcfAVenue(paper) {
  const text = cleanText(
    [paper.journal_ref, paper.comment, paper.venue].filter(Boolean).join(" | ")
  );

  if (!text) {
    return { pass: false, matchedVenue: null };
  }

  for (const rule of CCF_A_VENUE_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(text)) {
        return { pass: true, matchedVenue: rule.canonical };
      }
    }
  }

  return { pass: false, matchedVenue: null };
}

function applySourceFilter(paper) {
  const sourceDef = getSourceDefinition(paper.source_group);
  if (!sourceDef) {
    return { pass: false, matchedVenue: null };
  }

  if (sourceDef.venueFilter !== "ccf_a_only") {
    return { pass: true, matchedVenue: null };
  }

  return matchCcfAVenue(paper);
}

async function screenAndClassifyPaper(ai, paper) {
  const prompt =
    `You are screening and classifying research papers for an Embedded AI literature page.\n\n` +
    `First, decide whether the paper is genuinely relevant to this collection.\n` +
    `A relevant paper should clearly focus on AI models, systems, deployment, hardware, sensing, or reliability for embedded devices, edge devices, resource-constrained systems, microcontrollers, or TinyML.\n` +
    `Reject papers that are mainly about generic cloud-edge orchestration, networking without embedded-AI contribution, or broad AI topics with no embedded deployment context.\n\n` +
    `If the paper is relevant, assign exactly one primary category from the allowed labels.\n\n` +
    `Allowed categories:\n- ${CATEGORIES.join("\n- ")}\n\n` +
    `Category guidance:\n` +
    `- Chip / Hardware: accelerators, chips, ASIC, FPGA, MCU AI hardware, CIM/PIM, neuromorphic hardware.\n` +
    `- Model / Algorithm: efficient models, pruning, quantization, distillation, NAS, compression, algorithm design.\n` +
    `- System / Deployment: runtime, compiler, framework, operator optimization, memory planning, deployment pipeline.\n` +
    `- Sensing / Application: sensor intelligence, in-sensor/near-sensor computing, applications in wearables, vision, audio, robotics, health, industry.\n` +
    `- Security / Reliability: robustness, privacy, trustworthiness, uncertainty, safety, secure deployment, reliability.\n\n` +
    `Title: ${paper.title}\n\n` +
    `Abstract: ${paper.abstract || "No abstract available."}\n\n` +
    `Venue hint: ${paper.matched_venue || paper.venue || "Unknown"}`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          relevant: {
            type: "boolean",
            description: "Whether the paper belongs on this Embedded AI literature page.",
          },
          category: {
            type: ["string", "null"],
            enum: [...CATEGORIES, null],
            description: "The single best primary category if relevant, otherwise null.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence score between 0 and 1.",
          },
          reason: {
            type: "string",
            description: "Short explanation for the relevance/classification decision.",
          },
        },
        required: ["relevant", "category", "confidence", "reason"],
      },
    },
  });

  const parsed = JSON.parse(response.text);

  return {
    relevant: Boolean(parsed.relevant),
    category: parsed.category,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    reason: cleanText(parsed.reason),
  };
}

async function classifyPapers(ai, papers, cachedMap) {
  const result = [];

  for (const paper of papers) {
    const cacheKey = paperKey(paper);
    const cached = cachedMap.get(cacheKey);

    if (
      cached &&
      typeof cached.category === "string" &&
      CATEGORIES.includes(cached.category)
    ) {
      result.push({
        ...paper,
        category: cached.category,
        classification_confidence: cached.classification_confidence ?? null,
        classification_reason: cached.classification_reason ?? null,
      });
      continue;
    }

    const decision = await screenAndClassifyPaper(ai, paper);

    if (!decision.relevant || !decision.category) {
      await sleep(LLM_DELAY_MS);
      continue;
    }

    result.push({
      ...paper,
      category: decision.category,
      classification_confidence: decision.confidence,
      classification_reason: decision.reason,
    });

    await sleep(LLM_DELAY_MS);
  }

  return result;
}

function mergePapers(existingPapers, newPapers) {
  const byKey = new Map();

  for (const paper of existingPapers) {
    byKey.set(paperKey(paper), paper);
  }

  for (const paper of newPapers) {
    byKey.set(paperKey(paper), paper);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const aTime = new Date(a.published_at || 0).getTime();
    const bTime = new Date(b.published_at || 0).getTime();
    return bTime - aTime;
  });
}

function regroupForSite(allPapers) {
  const output = {
    last_updated: new Date().toISOString(),
    paper_sources: SOURCE_DEFINITIONS.map((source) => ({
      key: source.key,
      title: source.title,
      categories: buildCategoryBuckets(),
    })),
  };

  const sourceMap = new Map(
    output.paper_sources.map((source) => [source.key, source])
  );

  for (const paper of allPapers) {
    const source = sourceMap.get(paper.source_group);
    if (!source) continue;

    const category = source.categories.find((item) => item.name === paper.category);
    if (!category) continue;

    category.papers.push(paper);
  }

  for (const source of output.paper_sources) {
    for (const category of source.categories) {
      category.papers.sort((a, b) => {
        const aTime = new Date(a.published_at || 0).getTime();
        const bTime = new Date(b.published_at || 0).getTime();
        return bTime - aTime;
      });
    }
  }

  return output;
}

async function writeOutput(data) {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  if (!GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const existingOutput = await readExistingOutput();
  const existingPapers = flattenExistingPapers(existingOutput);

  const existingMap = new Map(existingPapers.map((paper) => [paperKey(paper), paper]));
  const existingTitleMap = new Map(
    existingPapers.map((paper) => [
      `${paper.source_group}::${normalizeTitle(paper.title)}`,
      paper,
    ])
  );

  const fetchedCandidates = await fetchAllCandidates();
  const uniqueCandidates = dedupeWithinSource(fetchedCandidates);

  const filteredByVenue = [];

  for (const paper of uniqueCandidates) {
    const venueCheck = applySourceFilter(paper);
    if (!venueCheck.pass) continue;

    filteredByVenue.push({
      ...paper,
      matched_venue: venueCheck.matchedVenue,
    });
  }

  const prepared = filteredByVenue.map((paper) => {
    const cacheKey = paperKey(paper);
    const cachedByKey = existingMap.get(cacheKey);
    const cachedByTitle = existingTitleMap.get(
      `${paper.source_group}::${normalizeTitle(paper.title)}`
    );
    const cached = cachedByKey || cachedByTitle;

    if (!cached) return paper;

    return {
      ...paper,
      category: cached.category ?? null,
      classification_confidence: cached.classification_confidence ?? null,
      classification_reason: cached.classification_reason ?? null,
      matched_venue: paper.matched_venue || cached.matched_venue || null,
    };
  });

  const classified = await classifyPapers(ai, prepared, existingMap);
  const merged = mergePapers(existingPapers, classified);

  /**
   * Re-apply current source filters to the merged set so old stale records
   * that no longer satisfy the latest rules do not remain in the output.
   */
  const mergedFiltered = merged
    .map((paper) => {
      const venueCheck = applySourceFilter(paper);
      return {
        paper: {
          ...paper,
          matched_venue: paper.matched_venue || venueCheck.matchedVenue || null,
        },
        pass: venueCheck.pass,
      };
    })
    .filter((item) => item.pass)
    .map((item) => item.paper)
    .filter((paper) => typeof paper.category === "string" && CATEGORIES.includes(paper.category));

  const output = regroupForSite(mergedFiltered);

  await writeOutput(output);

  console.log(
    `Updated ${OUTPUT_PATH} with ${mergedFiltered.length} papers at ${output.last_updated}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});