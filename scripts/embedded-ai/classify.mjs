import {
  CATEGORY_KEYS,
  CATEGORY_DISPLAY_ORDER,
  TAGS,
  applyForcedTags,
  ensureCategory,
  mergeAndNormalizeTags,
} from './config.mjs';

const TENCENT_TOKENHUB_API_KEY =
  process.env.TENCENT_TOKENHUB_API_KEY || '';
const TENCENT_TOKENHUB_MODEL =
  process.env.TENCENT_TOKENHUB_MODEL || 'hunyuan-2.0-instruct-20251111';
const TENCENT_TOKENHUB_BASE_URL =
  process.env.TENCENT_TOKENHUB_BASE_URL ||
  'https://tokenhub.tencentmaas.com/v1/chat/completions';

export const CLASSIFICATION_PROMPT = `
You are an "Embedded AI Paper Classification and Tagging Assistant".

Your task has only two objectives:
1. Assign exactly one main category to the paper.
2. Assign zero or more tags to the paper.

Do not filter papers.
Do not summarize papers.
Do not explain your reasoning.
Return only one JSON object.

====================
1. MAIN CATEGORY
====================

You must assign exactly one category from the following list:

1. Efficient Model Design and Optimization
Use this category if the main contribution is primarily about algorithms, models, or optimization methods, including but not limited to:
- model compression
- pruning
- quantization
- knowledge distillation
- lightweight neural network design
- neural architecture search (NAS)
- sparsity / sparse modeling
- training, adaptation, fine-tuning, or online learning for resource-constrained devices
- work mainly focused on accuracy-efficiency trade-offs, model size, compute cost, memory usage, or inference efficiency

2. Novel Computing Architectures and Domain-Specific Accelerators
Use this category if the main contribution is primarily about hardware, chip architecture, accelerator design, or hardware-software co-design, including but not limited to:
- MCU-class AI accelerators, micro-NPU, NPU, ASIC, FPGA
- compute-in-memory (CIM), processing-in-memory (PIM)
- SRAM / ReRAM / memristor / FeFET based in-memory computing
- neuromorphic computing, SNN hardware implementation, event-driven hardware
- near-sensor computing, in-sensor computing
- accelerator architecture, dataflow, memory hierarchy optimization, hardware energy efficiency
- algorithm-hardware co-design where the main innovation is in hardware or architecture

3. Embedded AI Applications
Use this category if the main contribution is primarily about application deployment or a system in a concrete embedded AI scenario, including but not limited to:
- wearable devices, biomedical sensing, health monitoring
- industrial monitoring, predictive maintenance, environmental sensing
- smart home, wake-word detection, gesture recognition, presence detection
- autonomous driving, robotics, SLAM, visual perception
- other embedded, edge, or on-device AI application systems

====================
2. CATEGORY RULES
====================

1. Exactly one main category must be selected.
2. Classify based on the paper's primary contribution, not by keyword matching alone.
3. If the paper involves both algorithms and hardware:
   - choose "Efficient Model Design and Optimization" if the core innovation is in model design, compression, quantization, pruning, or learning methods
   - choose "Novel Computing Architectures and Domain-Specific Accelerators" if the core innovation is in chips, architecture, accelerators, CIM, PIM, SNN hardware, or hardware mechanisms
4. If the paper is an application/system paper and the core contribution is deployment or application realization, choose "Embedded AI Applications"
5. If the paper is in an application domain but the real innovation is model optimization, choose "Efficient Model Design and Optimization"
6. If the paper is in an application domain but the real innovation is specialized hardware or architecture, choose "Novel Computing Architectures and Domain-Specific Accelerators"
7. Prefer the title, abstract, venue, and explicit metadata; do not invent missing details.

====================
3. TAG RULES
====================

Allowed tags:
- TinyML
- LP
- ULP

Tags may be empty.
TinyML may co-exist with LP or ULP.
LP and ULP must never appear together.
If both LP and ULP are applicable, keep only ULP.

1. TinyML
Assign TinyML if any of the following is clearly indicated:
- explicit mention of TinyML
- clear deployment on MCU / microcontroller
- extremely small model / memory footprint / compute footprint on highly resource-constrained devices
- explicit use of typical TinyML or MCU inference ecosystem

2. ULP
Assign ULP if any of the following is clearly indicated:
- explicit mention of ultra-low-power
- explicit mention of sub-mW, microwatt, µW, nW
- explicit focus on always-on, energy harvesting, sub-milliwatt, or microwatt-class operation

3. LP
Assign LP if any of the following is clearly indicated:
- explicit mention of low-power
- explicit mention of energy-efficient, power-efficient, or power-aware
- explicit focus on low-power optimization, but not clearly in the ULP regime

====================
4. OUTPUT FORMAT
====================

Return exactly one JSON object in this format:

{
  "category": "Efficient Model Design and Optimization",
  "tags": ["TinyML", "ULP"]
}

Requirements:
1. category must be exactly one of:
   - Efficient Model Design and Optimization
   - Novel Computing Architectures and Domain-Specific Accelerators
   - Embedded AI Applications
2. tags may only contain:
   - TinyML
   - LP
   - ULP
3. tags may be an empty array []
4. do not output markdown
5. do not output explanations
6. do not output any extra fields
`.trim();

function toTrimmedString(value) {
  return String(value ?? '').trim();
}

function safeInt(value) {
  if (value == null) return null;
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-zA-Z0-9+./ -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function unique(values) {
  return [...new Set((values ?? []).filter(Boolean))];
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function heuristicCategoryFromText(text) {
  const hardwarePatterns = [
    /\baccelerator\b/i,
    /\basic\b/i,
    /\bfpga\b/i,
    /\bnpu\b/i,
    /\bmicro[- ]?npu\b/i,
    /\bcim\b/i,
    /\bpim\b/i,
    /\bcompute[- ]in[- ]memory\b/i,
    /\bprocessing[- ]in[- ]memory\b/i,
    /\bsram\b/i,
    /\breram\b/i,
    /\bmemristor\b/i,
    /\bfefet\b/i,
    /\bdataflow\b/i,
    /\bmemory hierarchy\b/i,
    /\bneuromorphic\b/i,
    /\bsnn\b/i,
    /\bspiking neural network\b/i,
    /\bnear[- ]sensor\b/i,
    /\bin[- ]sensor\b/i,
    /\bchip\b/i,
    /\bhardware[- ]software co[- ]design\b/i,
  ];

  const modelPatterns = [
    /\bquanti[sz]ation\b/i,
    /\bprun(?:e|ing)\b/i,
    /\bdistillation\b/i,
    /\bknowledge distillation\b/i,
    /\bcompression\b/i,
    /\blightweight\b/i,
    /\bneural architecture search\b/i,
    /\bnas\b/i,
    /\bspars(?:e|ity)\b/i,
    /\bmodel optimization\b/i,
    /\blow[- ]rank\b/i,
    /\bresource[- ]constrained training\b/i,
    /\bonline learning\b/i,
    /\bfine[- ]tuning\b/i,
  ];

  const appPatterns = [
    /\bwearable\b/i,
    /\bhealth\b/i,
    /\bbiomedical\b/i,
    /\bgesture\b/i,
    /\bwake[- ]word\b/i,
    /\bpresence detection\b/i,
    /\bsmart home\b/i,
    /\bindustrial\b/i,
    /\bpredictive maintenance\b/i,
    /\benvironmental monitoring\b/i,
    /\brobot(?:ics)?\b/i,
    /\bslam\b/i,
    /\bautonomous\b/i,
    /\bvisual perception\b/i,
    /\bapplication\b/i,
    /\bdeployment\b/i,
    /\bsystem\b/i,
  ];

  const hardwareScore = hardwarePatterns.reduce((acc, p) => acc + (p.test(text) ? 1 : 0), 0);
  const modelScore = modelPatterns.reduce((acc, p) => acc + (p.test(text) ? 1 : 0), 0);
  const appScore = appPatterns.reduce((acc, p) => acc + (p.test(text) ? 1 : 0), 0);

  if (hardwareScore >= modelScore && hardwareScore >= appScore && hardwareScore > 0) {
    return CATEGORY_KEYS.ARCH;
  }

  if (modelScore >= hardwareScore && modelScore >= appScore && modelScore > 0) {
    return CATEGORY_KEYS.MODEL;
  }

  return CATEGORY_KEYS.APP;
}

function heuristicTagsFromText(text) {
  const tags = new Set();

  const tinyml = hasAny(text, [
    /\btinyml\b/i,
    /\btiny machine learning\b/i,
    /\bmicrocontroller(s)?\b/i,
    /\bmcu(s)?\b/i,
  ]);

  const ulp = hasAny(text, [
    /\bultra[- ]low[- ]power\b/i,
    /\bsub[- ]?mw\b/i,
    /\bmicrowatt\b/i,
    /\bµw\b/i,
    /\buw\b/i,
    /\bnw\b/i,
    /\balways[- ]on\b/i,
    /\benergy harvesting\b/i,
  ]);

  const lp = hasAny(text, [
    /\blow[- ]power\b/i,
    /\benergy[- ]efficient\b/i,
    /\bpower[- ]efficient\b/i,
    /\bpower[- ]aware\b/i,
  ]);

  if (tinyml) tags.add(TAGS.TINYML);
  if (ulp) tags.add(TAGS.ULP);
  else if (lp) tags.add(TAGS.LP);

  return mergeAndNormalizeTags([...tags]);
}

function buildClassifierInput(paper = {}) {
  const payload = {
    title: toTrimmedString(paper.title),
    abstract: toTrimmedString(paper.abstract),
    venue: toTrimmedString(paper.venue || paper.matched_venue),
    year: safeInt(paper.year),
    search_sets_final: paper.search_sets_final ?? [],
    tag_hints: {
      force_tinyml: Boolean(paper.tag_hints?.force_tinyml),
      require_power_tag: Boolean(paper.tag_hints?.require_power_tag),
      seed_tags: paper.seed_tags ?? [],
    },
  };

  return JSON.stringify(payload, null, 2);
}

function buildHeuristicClassification(paper = {}) {
  const text = [
    paper.title,
    paper.abstract,
    paper.venue,
    paper.matched_venue,
    ...(paper.seed_tags ?? []),
  ]
    .filter(Boolean)
    .join('\n');

  const category = heuristicCategoryFromText(text);
  const llmLikeTags = heuristicTagsFromText(text);
  const finalTags = applyForcedTags(paper.search_sets_final ?? [], llmLikeTags);

  return {
    category: ensureCategory(category),
    llm_tags: llmLikeTags,
    final_tags: finalTags,
    provider_used: 'heuristic',
    raw_response: null,
    model: null,
  };
}

function sanitizeModelOutput(output = {}, paper = {}) {
  const rawCategory = toTrimmedString(output.category);
  const rawTags = Array.isArray(output.tags) ? output.tags : [];

  const category = ensureCategory(rawCategory);
  const llmTags = mergeAndNormalizeTags(
    rawTags.map((tag) => toTrimmedString(tag)).filter(Boolean),
  );
  const finalTags = applyForcedTags(paper.search_sets_final ?? [], llmTags);

  return {
    category,
    llm_tags: llmTags,
    final_tags: finalTags,
  };
}

function tryParseJson(text) {
  const raw = toTrimmedString(text);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
      // continue
    }
  }

  const objectMatch = raw.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

function buildTokenHubMessages(paper) {
  return [
    {
      role: 'system',
      content: CLASSIFICATION_PROMPT,
    },
    {
      role: 'user',
      content: `Paper metadata:\n${buildClassifierInput(paper)}`,
    },
  ];
}

async function runTokenHubClassification(paper, options = {}) {
  const apiKey = options.apiKey ?? TENCENT_TOKENHUB_API_KEY;
  const model = options.model ?? TENCENT_TOKENHUB_MODEL;
  const baseUrl = options.baseUrl ?? TENCENT_TOKENHUB_BASE_URL;

  if (!apiKey) {
    throw new Error('Missing TENCENT_TOKENHUB_API_KEY.');
  }

  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: buildTokenHubMessages(paper),
      temperature: options.temperature ?? 0.1,
      top_p: options.topP ?? 0.9,
      max_tokens: options.maxTokens ?? 400,
      stream: false,
      seed: options.seed ?? 42,
    }),
  });

  const responseText = await response.text();
  let parsedHttp = null;

  try {
    parsedHttp = JSON.parse(responseText);
  } catch {
    parsedHttp = null;
  }

  if (!response.ok) {
    throw new Error(
      `TokenHub request failed with status ${response.status}: ${responseText}`,
    );
  }

  const content =
    parsedHttp?.choices?.[0]?.message?.content ??
    '';

  const parsedContent = tryParseJson(content);
  if (!parsedContent || typeof parsedContent !== 'object') {
    throw new Error(`TokenHub returned invalid classification JSON: ${content}`);
  }

  const sanitized = sanitizeModelOutput(parsedContent, paper);

  return {
    ...sanitized,
    provider_used: 'tencent_tokenhub',
    raw_response: parsedHttp,
    model,
  };
}

function attachClassification(paper, classification) {
  return {
    ...paper,
    category: classification.category,
    llm_tags: classification.llm_tags,
    final_tags: classification.final_tags,
    provider_used: classification.provider_used,
    classification_model: classification.model || null,
    classification_raw_response: classification.raw_response,
  };
}

function sortByCategoryThenYear(a, b) {
  const categoryCmp =
    CATEGORY_DISPLAY_ORDER.indexOf(a.category) -
    CATEGORY_DISPLAY_ORDER.indexOf(b.category);
  if (categoryCmp !== 0) return categoryCmp;

  const ay = safeInt(a.year) ?? 0;
  const by = safeInt(b.year) ?? 0;
  if (by !== ay) return by - ay;

  const ac = Number(a.cited_by ?? 0);
  const bc = Number(b.cited_by ?? 0);
  if (bc !== ac) return bc - ac;

  return toTrimmedString(a.title).localeCompare(toTrimmedString(b.title));
}

export async function classifyPaper(paper, options = {}) {
  const useHeuristicOnly = Boolean(options.useHeuristicOnly);

  if (useHeuristicOnly) {
    return attachClassification(paper, buildHeuristicClassification(paper));
  }

  try {
    const result = await runTokenHubClassification(paper, options);
    return attachClassification(paper, result);
  } catch (error) {
    if (options.throwOnError) {
      throw error;
    }

    const fallback = buildHeuristicClassification(paper);
    return attachClassification(paper, {
      ...fallback,
      provider_used: 'heuristic_fallback',
      raw_response: {
        error: String(error?.message || error),
      },
      model: options.model ?? TENCENT_TOKENHUB_MODEL,
    });
  }
}

export async function classifyPapers(papers = [], options = {}) {
  const concurrency = Math.max(1, Number(options.concurrency ?? 3) || 3);
  const queue = [...papers];
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const paper = queue.shift();
      if (!paper) return;

      const classified = await classifyPaper(paper, options);
      results.push(classified);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(queue.length, 1)) },
      () => worker(),
    ),
  );

  results.sort(sortByCategoryThenYear);

  return {
    papers: results,
    stats: summarizeClassificationStats(results),
  };
}

export function summarizeClassificationStats(papers = []) {
  const categoryCounts = Object.fromEntries(
    CATEGORY_DISPLAY_ORDER.map((category) => [category, 0]),
  );

  const tagCounts = Object.fromEntries(
    Object.values(TAGS).map((tag) => [tag, 0]),
  );

  const providerCounts = {
    tencent_tokenhub: 0,
    heuristic: 0,
    heuristic_fallback: 0,
  };

  for (const paper of papers) {
    const category = ensureCategory(paper.category);
    categoryCounts[category] += 1;

    for (const tag of unique(paper.final_tags ?? [])) {
      if (tagCounts[tag] != null) {
        tagCounts[tag] += 1;
      }
    }

    const provider = toTrimmedString(paper.provider_used);
    if (providerCounts[provider] != null) {
      providerCounts[provider] += 1;
    }
  }

  return {
    total: papers.length,
    by_category: categoryCounts,
    by_tag: tagCounts,
    by_provider: providerCounts,
  };
}

export function regroupClassifiedPapersByCategory(papers = []) {
  const buckets = new Map(
    CATEGORY_DISPLAY_ORDER.map((category) => [
      category,
      {
        key: categoryToKey(category),
        title: category,
        count: 0,
        papers: [],
      },
    ]),
  );

  for (const paper of papers) {
    const category = ensureCategory(paper.category);
    const bucket = buckets.get(category);
    bucket.papers.push(paper);
    bucket.count += 1;
  }

  return CATEGORY_DISPLAY_ORDER.map((category) => {
    const bucket = buckets.get(category);
    bucket.papers.sort(sortByCategoryThenYear);
    return bucket;
  });
}

export function categoryToKey(category) {
  switch (category) {
    case CATEGORY_KEYS.MODEL:
      return 'efficient_model_design';
    case CATEGORY_KEYS.ARCH:
      return 'novel_architecture_accelerator';
    case CATEGORY_KEYS.APP:
    default:
      return 'embedded_ai_applications';
  }
}