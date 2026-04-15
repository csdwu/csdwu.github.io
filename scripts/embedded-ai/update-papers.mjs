import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { XMLParser } from "fast-xml-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../..");

const OUTPUT_PATH = path.join(REPO_ROOT, "_data", "embedded_ai_papers.json");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const TENCENT_TOKENHUB_API_KEY =
  process.env.TENCENT_TOKENHUB_API_KEY || "";
const TENCENT_TOKENHUB_MODEL =
  process.env.TENCENT_TOKENHUB_MODEL || "hunyuan-2.0-instruct-20251111";
const TENCENT_TOKENHUB_BASE_URL =
  "https://tokenhub.tencentmaas.com/v1/chat/completions";

const ARXIV_API_BASE = "http://export.arxiv.org/api/query";

const MAX_RESULTS_PER_QUERY = Number.parseInt(
  process.env.MAX_RESULTS_PER_QUERY || "10",
  10
);

const REQUEST_DELAY_MS = Number.parseInt(
  process.env.REQUEST_DELAY_MS || "6000",
  10
);

const LLM_DELAY_MS = Number.parseInt(
  process.env.LLM_DELAY_MS || "500",
  10
);

const ARXIV_MAX_ATTEMPTS = Number.parseInt(
  process.env.ARXIV_MAX_ATTEMPTS || "5",
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
 * TinyML:
 * - does NOT apply CCF-A filtering
 *
 * Embedded AI:
 * - DOES apply CCF-A filtering
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
 * Only used for embedded_ai filtering.
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

  // Networking / edge-relevant conferences
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
    patterns: [
      /\bsigcomm\b/i,
      /applications,\s*technologies,\s*architectures,\s*and protocols for computer communication/i,
    ],
  },

  // Security conferences
  {
    canonical: "NDSS",
    patterns: [/\bndss\b/i, /network and distributed system security symposium/i],
  },
  {
    canonical: "S&P",
    patterns: [
      /\bs&p\b/i,
      /\bieee symposium on security and privacy\b/i,
      /\bsecurity and privacy\b/i,
    ],
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
    patterns: [
      /\bieee transactions on computers\b/i,
      /\btransactions on computers\b/i,
    ],
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
      /ieee\/acm transactions on networking/i,
      /\btransactions on networking\b/i,
      /\bton\b/i,
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
    patterns: [/\binternational journal of computer vision\b/i, /\bijcv\b/i],
  },
  {
    canonical: "JMLR",
    patterns: [/\bjournal of machine learning research\b/i, /\bjmlr\b/i],
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

function toInt(value, fallback = 0) {
  const num = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(num) ? num : fallback;
}

function cleanText(text) {
  if (!text) return "";
  return String(text).replace(/\s+/g, " ").trim();
}

function normalizeTitle(title) {
  return cleanText(title).toLowerCase();
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

function makePaperCacheKey(paper) {
  return `${paper.source_group}::${paper.id || normalizeTitle(paper.title)}`;
}

async function readExistingOutput() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, "utf8");
    return JSON.parse(raw);
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

function getSourceDefinition(sourceKey) {
  return SOURCE_DEFINITIONS.find((item) => item.key === sourceKey) || null;
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
    comment,
    source: "arXiv",
    source_group: sourceDef.key,
    source_group_title: sourceDef.title,
    source_query: query,
    matched_venue: null,
    provider_used: null,
    category: null,
    classification_confidence: null,
    classification_reason: null,
  };
}

async function fetchArxivEntriesPage(sourceDef, query, start) {
  const maxAttempts = ARXIV_MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const url = new URL(ARXIV_API_BASE);
    url.searchParams.set("search_query", query);
    url.searchParams.set("start", String(start));
    url.searchParams.set("max_results", String(MAX_RESULTS_PER_QUERY));
    url.searchParams.set("sortBy", "submittedDate");
    url.searchParams.set("sortOrder", "descending");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent":
          "embedded-ai-page-updater/1.0 (contact: guo.qilong.self@gmail.com)",
        Accept: "application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
    });

    if (response.ok) {
      const xml = await response.text();
      const parsed = xmlParser.parse(xml);
      const entries = toArray(parsed?.feed?.entry);

      const totalResults = toInt(parsed?.feed?.totalResults, entries.length);
      const startIndex = toInt(parsed?.feed?.startIndex, start);
      const itemsPerPage = toInt(parsed?.feed?.itemsPerPage, entries.length);

      return {
        papers: entries.map((entry) => normalizeArxivEntry(entry, sourceDef, query)),
        stats: {
          sourceKey: sourceDef.key,
          sourceTitle: sourceDef.title,
          query,
          totalResults,
          startIndex,
          itemsPerPage,
          fetchedCount: entries.length,
        },
      };
    }

    if (response.status === 429 && attempt < maxAttempts) {
      const backoffMs = REQUEST_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `[arXiv] 429 for ${sourceDef.key}, query="${query}", pageStart=${start}, attempt ${attempt}/${maxAttempts}. Retrying in ${backoffMs} ms.`
      );
      await sleep(backoffMs);
      continue;
    }

    const body = await response.text().catch(() => "");
    throw new Error(
      `arXiv request failed for ${sourceDef.key}: ${response.status} ${response.statusText} ${body}`
    );
  }

  throw new Error(
    `arXiv request failed for ${sourceDef.key}, query="${query}", start=${start}: exceeded retry limit`
  );
}

async function fetchArxivEntriesForQuery(sourceDef, query) {
  let start = 0;
  let totalResults = null;
  let pagesFetched = 0;
  const allPapers = [];

  while (true) {
    const pageResult = await fetchArxivEntriesPage(sourceDef, query, start);
    const pagePapers = pageResult.papers;
    const stats = pageResult.stats;

    if (totalResults === null) {
      totalResults = stats.totalResults;
    }

    allPapers.push(...pagePapers);
    pagesFetched += 1;

    console.log(
      `[arXiv] ${sourceDef.key} | query="${query}" | page=${pagesFetched} | start=${stats.startIndex} | fetched_this_page=${stats.fetchedCount} | total=${stats.totalResults}`
    );

    if (pagePapers.length === 0) {
      break;
    }

    start = stats.startIndex + pagePapers.length;

    if (start >= stats.totalResults) {
      break;
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return {
    papers: allPapers,
    stats: {
      sourceKey: sourceDef.key,
      sourceTitle: sourceDef.title,
      query,
      totalResults: totalResults ?? allPapers.length,
      startIndex: 0,
      itemsPerPage: MAX_RESULTS_PER_QUERY,
      fetchedCount: allPapers.length,
      pagesFetched,
      isComplete:
        totalResults === null ? true : allPapers.length >= totalResults,
    },
  };
}

async function fetchAllCandidates() {
  const papers = [];
  const stats = [];

  for (const sourceDef of SOURCE_DEFINITIONS) {
    for (const query of sourceDef.queries) {
      const result = await fetchArxivEntriesForQuery(sourceDef, query);
      papers.push(...result.papers);
      stats.push(result.stats);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  return { papers, stats };
}

function dedupeWithinSource(papers) {
  const seenIds = new Set();
  const seenTitles = new Set();
  const result = [];

  for (const paper of papers) {
    const idKey = `${paper.source_group}::${paper.id}`;
    const titleKey = `${paper.source_group}::${normalizeTitle(paper.title)}`;

    if (paper.id && seenIds.has(idKey)) continue;
    if (paper.title && seenTitles.has(titleKey)) continue;

    if (paper.id) seenIds.add(idKey);
    if (paper.title) seenTitles.add(titleKey);

    result.push(paper);
  }

  return result;
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
  if (!sourceDef) return { pass: false, matchedVenue: null };

  // TinyML: no CCF-A filter
  if (sourceDef.venueFilter !== "ccf_a_only") {
    return { pass: true, matchedVenue: null };
  }

  // Only Embedded AI reaches here
  return matchCcfAVenue(paper);
}

function buildScreeningPrompt(paper) {
  return (
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
    `Venue hint: ${paper.matched_venue || paper.venue || "Unknown"}`
  );
}

function buildDecisionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      relevant: {
        type: "boolean",
        description: "Whether this paper belongs on the Embedded AI literature page.",
      },
      category: {
        type: ["string", "null"],
        enum: [...CATEGORIES, null],
        description: "One primary category if relevant, otherwise null.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Confidence score between 0 and 1.",
      },
      reason: {
        type: "string",
        description: "Short explanation for the decision.",
      },
    },
    required: ["relevant", "category", "confidence", "reason"],
  };
}

function extractFirstJsonObject(text) {
  const raw = cleanText(text);
  if (!raw) {
    throw new Error("Model returned empty content.");
  }

  try {
    return JSON.parse(raw);
  } catch {}

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`No JSON object found in model output: ${raw}`);
  }

  const candidate = raw.slice(start, end + 1);
  return JSON.parse(candidate);
}

async function classifyWithGemini(ai, paper) {
  if (!ai) {
    throw new Error("Gemini client not initialized.");
  }

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: buildScreeningPrompt(paper),
    config: {
      responseMimeType: "application/json",
      responseJsonSchema: buildDecisionSchema(),
    },
  });

  const parsed = JSON.parse(response.text);

  return {
    provider: "gemini",
    relevant: Boolean(parsed.relevant),
    category: parsed.category,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    reason: cleanText(parsed.reason),
  };
}

async function classifyWithOpenRouter(paper) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("Missing OPENROUTER_API_KEY for OpenRouter fallback.");
  }

  const response = await fetch(OPENROUTER_BASE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/csdwu/csdwu.github.io",
      "X-OpenRouter-Title": "Embedded AI Paper Updater",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "user",
          content: buildScreeningPrompt(paper),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "paper_decision",
          strict: true,
          schema: buildDecisionSchema(),
        },
      },
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `OpenRouter request failed: ${response.status} ${response.statusText} :: ${text}`
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("OpenRouter returned no message content.");
  }

  const parsed = JSON.parse(content);

  return {
    provider: "openrouter",
    relevant: Boolean(parsed.relevant),
    category: parsed.category,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    reason: cleanText(parsed.reason),
  };
}

async function classifyWithTencentTokenHub(paper) {
  if (!TENCENT_TOKENHUB_API_KEY) {
    throw new Error("Missing TENCENT_TOKENHUB_API_KEY for Tencent TokenHub fallback.");
  }

  const prompt =
    `${buildScreeningPrompt(paper)}\n\n` +
    `Return JSON only. Do not use markdown fences.\n` +
    `The JSON must have exactly these keys:\n` +
    `{\n` +
    `  "relevant": boolean,\n` +
    `  "category": string | null,\n` +
    `  "confidence": number,\n` +
    `  "reason": string\n` +
    `}\n\n` +
    `Rules:\n` +
    `- "category" must be one of: ${CATEGORIES.join(", ")}\n` +
    `- If not relevant, set "category" to null.\n` +
    `- "confidence" must be between 0 and 1.\n`;

  const response = await fetch(TENCENT_TOKENHUB_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TENCENT_TOKENHUB_API_KEY}`,
    },
    body: JSON.stringify({
      model: TENCENT_TOKENHUB_MODEL,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
      stream: false,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Tencent TokenHub request failed: ${response.status} ${response.statusText} :: ${text}`
    );
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Tencent TokenHub returned no message content.");
  }

  const parsed = extractFirstJsonObject(content);

  return {
    provider: "tencent_tokenhub",
    relevant: Boolean(parsed.relevant),
    category: parsed.category,
    confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
    reason: cleanText(parsed.reason),
  };
}

async function classifyWithFallback(ai, paper) {
  const errors = [];

  if (ai) {
    try {
      return await classifyWithGemini(ai, paper);
    } catch (error) {
      errors.push(`Gemini: ${error.message}`);
      console.warn(
        `[fallback] Gemini failed for "${paper.title}". Trying OpenRouter / Tencent next. ${error.message}`
      );
    }
  }

  if (OPENROUTER_API_KEY) {
    try {
      return await classifyWithOpenRouter(paper);
    } catch (error) {
      errors.push(`OpenRouter: ${error.message}`);
      console.warn(
        `[fallback] OpenRouter failed for "${paper.title}". Trying Tencent TokenHub next. ${error.message}`
      );
    }
  }

  if (TENCENT_TOKENHUB_API_KEY) {
    try {
      return await classifyWithTencentTokenHub(paper);
    } catch (error) {
      errors.push(`Tencent TokenHub: ${error.message}`);
    }
  }

  throw new Error(
    `All providers failed for "${paper.title}". ${errors.join(" | ")}`
  );
}

async function classifyPapers(ai, papers, cachedMap) {
  const result = [];

  for (const paper of papers) {
    const cacheKey = makePaperCacheKey(paper);
    const cached = cachedMap.get(cacheKey);
    console.log(`[classifying] ${paper.source_group} | ${paper.title}`);
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
        provider_used: cached.provider_used ?? null,
      });
      continue;
    }

    const decision = await classifyWithFallback(ai, paper);

    if (!decision.relevant || !decision.category) {
      await sleep(LLM_DELAY_MS);
      continue;
    }

    result.push({
      ...paper,
      category: decision.category,
      classification_confidence: decision.confidence,
      classification_reason: decision.reason,
      provider_used: decision.provider,
    });

    await sleep(LLM_DELAY_MS);
  }

  return result;
}

function mergePapers(existingPapers, newPapers) {
  const byKey = new Map();

  for (const paper of existingPapers) {
    byKey.set(makePaperCacheKey(paper), paper);
  }

  for (const paper of newPapers) {
    byKey.set(makePaperCacheKey(paper), paper);
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
  if (!GEMINI_API_KEY && !OPENROUTER_API_KEY && !TENCENT_TOKENHUB_API_KEY) {
    throw new Error(
      "At least one of GEMINI_API_KEY, OPENROUTER_API_KEY, or TENCENT_TOKENHUB_API_KEY must be set."
    );
  }

  const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

  const existingOutput = await readExistingOutput();
  const existingPapers = flattenExistingPapers(existingOutput);

  const existingMap = new Map(
    existingPapers.map((paper) => [makePaperCacheKey(paper), paper])
  );
  const existingTitleMap = new Map(
    existingPapers.map((paper) => [
      `${paper.source_group}::${normalizeTitle(paper.title)}`,
      paper,
    ])
  );

  const fetchResult = await fetchAllCandidates();
  const fetchedCandidates = fetchResult.papers;
  const fetchStats = fetchResult.stats;

  console.log("\n=== arXiv Query Stats ===");
  for (const item of fetchStats) {
    console.log(
      `[${item.sourceKey}] query="${item.query}" | total=${item.totalResults} | fetched=${item.fetchedCount} | pages=${item.pagesFetched} | complete=${item.isComplete}`
    );
  }

  const uniqueCandidates = dedupeWithinSource(fetchedCandidates);

  console.log(`\nFetched raw candidates: ${fetchedCandidates.length}`);
  console.log(`After dedupe: ${uniqueCandidates.length}`);

  const filteredByVenue = [];

  for (const paper of uniqueCandidates) {
    const venueCheck = applySourceFilter(paper);
    if (!venueCheck.pass) continue;

    filteredByVenue.push({
      ...paper,
      matched_venue: venueCheck.matchedVenue,
    });
  }

  console.log(`After CCF-A venue filter: ${filteredByVenue.length}`);

  const prepared = filteredByVenue.map((paper) => {
    const cacheKey = makePaperCacheKey(paper);
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
      provider_used: cached.provider_used ?? null,
      matched_venue: paper.matched_venue || cached.matched_venue || null,
    };
  });

  const classified = await classifyPapers(ai, prepared, existingMap);
  console.log(`After relevance + classification: ${classified.length}`);

  const merged = mergePapers(existingPapers, classified);

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
    .filter(
      (paper) =>
        typeof paper.category === "string" && CATEGORIES.includes(paper.category)
    );

  console.log(`Final retained papers: ${mergedFiltered.length}`);

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