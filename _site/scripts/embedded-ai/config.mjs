import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const DATA_DIR = path.resolve(REPO_ROOT, '_data');
export const ASSETS_DIR = path.resolve(REPO_ROOT, 'assets');
export const SCHOLAR_CRAWLER_DIR = path.resolve(REPO_ROOT, 'google_scholar_crawler');
export const ARXIV_CRAWLER_DIR = path.resolve(REPO_ROOT, 'google_scholar_crawler');

export const OUTPUT_JSON_PATH = path.resolve(DATA_DIR, 'embedded_ai_papers.json');

export const SCHOLAR_CACHE_DIR = path.resolve(SCHOLAR_CRAWLER_DIR, 'cache');
export const SCHOLAR_STATE_DIR = path.resolve(SCHOLAR_CRAWLER_DIR, 'state');
export const SCHOLAR_DOWNLOAD_DIR = path.resolve(SCHOLAR_CRAWLER_DIR, 'downloads', 'embedded-ai');

export const ARXIV_CACHE_DIR = path.resolve(ARXIV_CRAWLER_DIR, 'cache', 'arxiv');

export const SCHOLAR_RAW_A_PATH = path.resolve(SCHOLAR_CACHE_DIR, 'scholar_A_raw.json');
export const SCHOLAR_RAW_B_PATH = path.resolve(SCHOLAR_CACHE_DIR, 'scholar_B_raw.json');
export const SCHOLAR_RAW_C_PATH = path.resolve(SCHOLAR_CACHE_DIR, 'scholar_C_raw.json');
export const SCHOLAR_NORMALIZED_PATH = path.resolve(SCHOLAR_CACHE_DIR, 'normalized_papers.json');

export const ARXIV_RAW_A_PATH = path.resolve(ARXIV_CACHE_DIR, 'arxiv_A_raw.json');
export const ARXIV_RAW_B_PATH = path.resolve(ARXIV_CACHE_DIR, 'arxiv_B_raw.json');
export const ARXIV_RAW_C_PATH = path.resolve(ARXIV_CACHE_DIR, 'arxiv_C_raw.json');

export const DOWNLOAD_STATE_PATH = path.resolve(SCHOLAR_STATE_DIR, 'download_state.json');
export const DOWNLOAD_QUOTA_PATH = path.resolve(SCHOLAR_STATE_DIR, 'download_quota.json');
export const CLASSIFICATION_CHECKPOINT_PATH = path.resolve(SCHOLAR_STATE_DIR, 'classification_checkpoint.json');
export const LAST_SEARCH_STATE_PATH = path.resolve(SCHOLAR_STATE_DIR, 'last_search_state.json');
export const SOURCE_STATS_PATH = path.resolve(SCHOLAR_STATE_DIR, 'source_stats.json');
export const ARXIV_INCREMENTAL_OVERLAP_DAYS = 1;

export const OUTPUT_SCHEMA_VERSION = '2.0.0';

export const CATEGORY_KEYS = Object.freeze({
  MODEL: 'Efficient Model Design and Optimization',
  ARCH: 'Novel Computing Architectures and Domain-Specific Accelerators',
  APP: 'Embedded AI Applications',
});

export const CATEGORY_DISPLAY_ORDER = Object.freeze([
  CATEGORY_KEYS.MODEL,
  CATEGORY_KEYS.ARCH,
  CATEGORY_KEYS.APP,
]);

export const ARTIFACT_DIR = path.resolve(REPO_ROOT, 'artifacts');
export const BIBTEX_ALL_PATH = path.resolve(ARTIFACT_DIR, 'embedded_ai_all.bib');
export const CATEGORY_BIB_FILENAMES = Object.freeze({
  [CATEGORY_KEYS.MODEL]: 'efficient_model_design.bib',
  [CATEGORY_KEYS.ARCH]: 'novel_architecture_accelerator.bib',
  [CATEGORY_KEYS.APP]: 'embedded_ai_applications.bib',
});
export const CATEGORY_BIB_PATHS = Object.freeze(
  Object.fromEntries(
    Object.entries(CATEGORY_BIB_FILENAMES).map(([category, filename]) => [
      category,
      path.resolve(ARTIFACT_DIR, filename),
    ]),
  ),
);

export const TAGS = Object.freeze({
  TINYML: 'TinyML',
  LP: 'LP',
  ULP: 'ULP',
});

export const TAG_DISPLAY_ORDER = Object.freeze([
  TAGS.TINYML,
  TAGS.ULP,
  TAGS.LP,
]);

export const GROUP_ORDER = Object.freeze(['A', 'B', 'C']);

export const SEARCH_SOURCES = Object.freeze(['scholar', 'arxiv', 'all']);
export const DEFAULT_SEARCH_SOURCE = 'arxiv';

export const FRONTEND_TOP_N = 20;
export const DAILY_DOWNLOAD_LIMIT = 20;
export const SCHOLAR_MAX_RESULTS_PER_GROUP = 120;
export const SCHOLAR_REQUEST_SLEEP_SECONDS = 3;
export const SCHOLAR_RETRY_LIMIT = 3;

export const ARXIV_HOSTS = Object.freeze([
  'arxiv.org',
  'www.arxiv.org',
  'export.arxiv.org',
]);

export const QUERY_GROUPS = Object.freeze({
  A: {
    key: 'A',
    title: 'Embedded AI',
    description: 'General Embedded AI search group.',
    primaryQuery: '"embedded ai"',
    fallbackQueries: [
      '"embedded ai"',
      '"embedded machine learning"',
      '"embedded deep learning"',
      '"edge ai" embedded',
      '"on-device ai" embedded',
    ],
    filterPolicy: 'TH_CPL_A',
    forceTags: [],
    requireOneOfTags: [],
  },
  B: {
    key: 'B',
    title: 'Low-Power / Ultra-Low-Power Embedded AI',
    description: 'Low-power and ultra-low-power Embedded AI search group.',
    primaryQuery: '("low power" OR "ultra-low-power") "embedded ai"',
    fallbackQueries: [
      '("low power" OR "ultra-low-power") "embedded ai"',
      '("energy-efficient" OR "power-efficient" OR "power-aware") "embedded ai"',
      '("low-power" OR "ultra-low-power") "embedded machine learning"',
      '("low-power" OR "ultra-low-power") "edge ai"',
    ],
    filterPolicy: 'TH_CPL_AB_OR_ARXIV',
    forceTags: [],
    requireOneOfTags: [TAGS.LP, TAGS.ULP],
    defaultTagIfMissing: TAGS.LP,
  },
  C: {
    key: 'C',
    title: 'TinyML Embedded AI',
    description: 'TinyML-focused Embedded AI search group.',
    primaryQuery: '"tinyml" "embedded ai"',
    fallbackQueries: [
      '"tinyml" "embedded ai"',
      '"tinyml" embedded',
      '"tinyml" "edge ai"',
      '"microcontroller" tinyml embedded ai',
      '"mcu" tinyml embedded ai',
    ],
    filterPolicy: 'TH_CPL_AB_OR_ARXIV',
    forceTags: [TAGS.TINYML],
    requireOneOfTags: [],
  },
});

export const TAG_RULES = Object.freeze({
  allowMultiple: true,
  mutuallyExclusiveGroups: [[TAGS.LP, TAGS.ULP]],
  forcedByGroup: {
    A: [],
    B: [],
    C: [TAGS.TINYML],
  },
  requiredOneOfByGroup: {
    A: [],
    B: [TAGS.LP, TAGS.ULP],
    C: [],
  },
  defaultTagIfMissingByGroup: {
    A: null,
    B: TAGS.LP,
    C: null,
  },
});

export const FILTER_POLICIES = Object.freeze({
  TH_CPL_A: 'TH_CPL_A',
  TH_CPL_AB_OR_ARXIV: 'TH_CPL_AB_OR_ARXIV',
});

export const DOWNLOAD_PRIORITIES = Object.freeze([
  'arxiv',
  'pdf_url',
  'publisher_pdf',
  'doi_landing',
]);

export const FILE_NAMES = Object.freeze({
  outputJson: 'embedded_ai_papers.json',
  rawA: 'scholar_A_raw.json',
  rawB: 'scholar_B_raw.json',
  rawC: 'scholar_C_raw.json',
  arxivRawA: 'arxiv_A_raw.json',
  arxivRawB: 'arxiv_B_raw.json',
  arxivRawC: 'arxiv_C_raw.json',
  normalized: 'normalized_papers.json',
  downloadState: 'download_state.json',
  downloadQuota: 'download_quota.json',
});

// arXiv-specific queries (using arXiv API query syntax)
export const ARXIV_QUERY_GROUPS = Object.freeze({
  A: {
    key: 'A',
    title: 'Embedded AI (arXiv)',
    description: 'General Embedded AI papers from arXiv.',
    primaryQuery: '(embedded AND machine AND learning) OR (embedded AND ai)',
    categories: ['cs.AI', 'cs.LG', 'cs.AR', 'cs.CV'],
  },
  B: {
    key: 'B',
    title: 'Low-Power / Ultra-Low-Power Embedded AI (arXiv)',
    description: 'Low-power and ultra-low-power Embedded AI from arXiv.',
    primaryQuery: '(embedded OR edge) AND ("low power" OR "ultra-low-power" OR "energy efficient") AND (machine AND learning)',
    categories: ['cs.AI', 'cs.LG', 'cs.AR'],
  },
  C: {
    key: 'C',
    title: 'TinyML (arXiv)',
    description: 'TinyML-focused papers from arXiv.',
    primaryQuery: '(tinyml OR "tiny machine learning" OR microcontroller OR mcu) AND (embedded OR edge)',
    categories: ['cs.AI', 'cs.LG', 'cs.AR', 'eess.SY'],
  },
});

function v(full, short = null, aliases = []) {
  return { full, short, aliases };
}

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’'`]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase();
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function stripOuterBrackets(value) {
  return String(value ?? '')
    .replace(/^\s*[\[\(\{]\s*/, '')
    .replace(/\s*[\]\)\}]\s*$/, '')
    .trim();
}

function stripVenueDecorations(value) {
  let s = String(value ?? '').trim();
  if (!s) return '';

  // 常见前缀
  s = s.replace(/^proceedings of (the )?/i, '');
  s = s.replace(/^in (the )?/i, '');
  s = s.replace(/^proc\.?\s+of (the )?/i, '');
  s = s.replace(/^preprint\s+at\s+/i, '');
  s = s.replace(/^presented at\s+/i, '');

  // 去括号附加信息，例如 (Oral), (Poster), (Workshop Track)
  s = s.replace(/\(([^)]*)\)/g, ' ');
  s = s.replace(/\[([^\]]*)\]/g, ' ');

  // 去常见后缀信息
  s = s.replace(/\b(oral|poster|spotlight|demo|tutorial|workshop|industry track|journal track)\b/gi, ' ');

  // 去年份写法
  s = s.replace(/\b(19|20)\d{2}\b/g, ' ');
  s = s.replace(/'\d{2}\b/g, ' ');
  s = s.replace(/\b\d{2}\b/g, (m) => {
    const n = Number(m);
    return n >= 20 && n <= 99 ? ' ' : m;
  });

  // 去尾部标点和连接符噪声
  s = s.replace(/[:|,/\\-]+$/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

function extractBracketedAcronyms(value) {
  const text = String(value ?? '');
  const matches = [...text.matchAll(/\(([^)]{2,20})\)/g)];
  return uniq(
    matches
      .map((m) => stripOuterBrackets(m[1]))
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z0-9+./ -]{2,20}$/.test(s)),
  );
}

function buildAcronymFromWords(value) {
  const words = String(value ?? '')
    .replace(/[^A-Za-z0-9+ ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length < 2) return '';

  const stopwords = new Set([
    'on', 'of', 'and', 'for', 'the', 'in', 'to', 'at', 'a', 'an', 'international',
  ]);

  const letters = words
    .filter((w) => !stopwords.has(w.toLowerCase()))
    .map((w) => w[0])
    .join('');

  return letters.length >= 3 ? letters.toUpperCase() : '';
}

function generateVenueCandidateStrings(rawValue) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return [];

  const stripped = stripVenueDecorations(raw);
  const bracketedAcronyms = extractBracketedAcronyms(raw);

  const candidates = [
    raw,
    stripped,
    ...bracketedAcronyms,
  ];

  const strippedAcronym = buildAcronymFromWords(stripped);
  if (strippedAcronym) candidates.push(strippedAcronym);

  return uniq(
    candidates
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export function expandVenueVariants(entry) {
  const variants = new Set();

  if (entry.full) variants.add(normalizeText(entry.full));
  if (entry.short) variants.add(normalizeText(entry.short));

  for (const alias of entry.aliases ?? []) {
    if (alias) variants.add(normalizeText(alias));
  }

  return [...variants].filter(Boolean);
}

function buildVenueIndex(thCplData, includedLevels = ['A', 'B']) {
  const index = new Map();

  for (const [area, areaData] of Object.entries(thCplData)) {
    for (const level of includedLevels) {
      const levelData = areaData[level];
      if (!levelData) continue;

      for (const type of ['conferences', 'journals']) {
        for (const entry of levelData[type]) {
          for (const variant of expandVenueVariants(entry)) {
            const current = index.get(variant) ?? [];
            current.push({
              area,
              level,
              type: type === 'conferences' ? 'conference' : 'journal',
              canonicalFull: entry.full,
              canonicalShort: entry.short,
            });
            index.set(variant, current);
          }
        }
      }
    }
  }

  return index;
}

export const TH_CPL = Object.freeze({
  'High Performance Computing': {
    A: {
      conferences: [
        v('International Symposium on Computer Architecture', 'ISCA'),
        v('USENIX Conference on File and Storage Technologies', 'FAST'),
        v('International Conference on Architectural Support for Programming Languages and Operating Systems', 'ASPLOS'),
        v('European Conference on Computer Systems', 'EuroSys'),
        v('International Symposium on High-Performance Computer Architecture', 'HPCA'),
        v('International Conference on Measurement and Modeling of Computer Systems', 'SIGMETRICS'),
        v('ACM/SIGDA International Symposium on Field-Programmable Gate Arrays', 'FPGA'),
        v('USENIX Annual Technical Conference', 'USENIX ATC'),
        v('IEEE/ACM International Symposium on Microarchitecture', 'MICRO'),
        v('International Conference for High Performance Computing, Networking, Storage, and Analysis', 'SC'),
        v('ACM SIGPLAN Symposium on Principles and Practice of Parallel Programming', 'PPoPP'),
        v('Design Automation Conference', 'DAC'),
      ],
      journals: [
        v('ACM Transactions on Computer Systems', 'TOCS'),
        v('IEEE Transactions on Parallel and Distributed Systems', 'TPDS'),
        v('IEEE Transactions on Computers', 'TC'),
        v('IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems', 'TCAD'),
        v('ACM Transactions on Storage', 'TOS'),
      ],
    },
    B: {
      conferences: [
        v('International Symposium on High Performance Distributed Computing', 'HPDC'),
        v('ACM Symposium on Cloud Computing', 'SoCC'),
        v('Real-Time and Embedded Technology and Applications Symposium', 'RTAS'),
        v('Mass Storage Systems and Technologies', 'MSST'),
        v('ACM/IEEE International Symposium on Code Generation and Optimization', 'CGO'),
        v('International Conference on Parallel Architectures and Compilation Techniques', 'PACT'),
        v('International Conference on Hardware/Software Co-design and System Synthesis', 'CODES+ISSS'),
        v('ACM Symposium on Principles of Distributed Computing', 'PODC'),
        v('International Conference on Virtual Execution Environments', 'VEE'),
        v('International Parallel and Distributed Processing Symposium', 'IPDPS'),
        v('International Conference on Supercomputing', 'ICS'),
        v('Design, Automation and Test in Europe Conference', 'DATE'),
        v('ACM Symposium on Parallelism in Algorithms and Architectures', 'SPAA'),
        v('International Symposium on Computer Performance, Modeling, Measurements and Evaluation', 'Performance'),
        v('International Conference on Distributed Computing Systems', 'ICDCS'),
        v('International Conference on Computer-Aided Design', 'ICCAD'),
        v('IEEE/ACM International Symposium on Cluster, Cloud and Grid Computing', 'CCGRID'),
        v('Hot Chips: A Symposium on High Performance Chips', 'HOT CHIPS'),
        v('IEEE International Conference on Cluster Computing', 'CLUSTER'),
        v('Asia and South Pacific Design Automation Conference', 'ASP-DAC'),
        v('International Symposium on Low Power Electronics and Design', 'ISLPED'),
        v('IEEE International Conference on Cloud Computing', null),
        v('Real-Time Systems Symposium', 'RTSS'),
        v('International Conference on Computer Design', 'ICCD'),
        v('International Symposium on Circuits and Systems', 'ISCAS'),
        v('International Symposium on Physical Design', 'ISPD'),
        v('International Conference on Parallel Processing', 'ICPP'),
        v('IEEE International Electron Devices Meeting', 'IEDM'),
        v('International Solid-State Circuits Conference', 'ISSCC'),
      ],
      journals: [
        v('ACM Transactions on Autonomous and Adaptive Systems', 'TAAS'),
        v('Journal of Parallel and Distributed Computing', 'JPDC'),
        v('IEEE Transactions on Very Large Scale Integration (VLSI) Systems', 'TVLSI'),
        v('ACM Transactions on Architecture and Code Optimization', 'TACO'),
        v('Parallel Computing', 'PARCO'),
        v('IEEE Transactions on Cloud Computing', 'TCC'),
        v('ACM Journal on Emerging Technologies in Computing Systems', 'JETC'),
        v('Cluster Computing', null),
      ],
    },
  },

  'Computer Networks': {
    A: {
      conferences: [
        v('ACM International Conference on the Applications, Technologies, Architectures, and Protocols for Computer Communication', 'SIGCOMM'),
        v('Symposium on Network System Design and Implementation', 'NSDI'),
        v('ACM International Conference on Mobile Computing and Networking', 'MOBICOM'),
        v('International Conference on Mobile Systems, Applications, and Services', 'MobiSys'),
        v('Internet Measurement Conference', 'IMC'),
        v('International Conference on Information Processing in Sensor Networks', 'IPSN'),
        v('ACM Conference on Embedded Networked Sensor Systems', 'SenSys'),
        v('IEEE International Conference on Computer Communications', 'INFOCOM'),
        v('ACM International Conference on Emerging Networking Experiments and Technologies', 'CoNEXT'),
        v('International Conference on Network Protocols', 'ICNP'),
      ],
      journals: [
        v('IEEE Journal of Selected Areas in Communications', 'JSAC'),
        v('IEEE Transactions on Mobile Computing', 'TMC'),
        v('IEEE/ACM Transactions on Networking', 'TON'),
        v('IEEE Transactions on Communications', 'TCOM'),
      ],
    },
    B: {
      conferences: [
        v('International Symposium on Mobile Ad Hoc Networking and Computing', 'MobiHoc'),
        v('The Workshop on Hot Topics in Networks', 'HotNets'),
        v('IEEE Global Communications Conference', 'Globecom'),
        v('IEEE International Conference on Communications', 'ICC'),
        v('International Workshop on Network and Operating System Support for Digital Audio and Video', 'NOSSDAV'),
        v('IEEE Communications Society Conference on Sensor and Ad Hoc Communications and Networks', 'SECON'),
        v('IFIP International Conferences on Networking', 'Networking'),
        v('IEEE International Symposium on a World of Wireless, Mobile and Multimedia Networks', 'WoWMoM'),
        v('IEEE Wireless Communications and Networking Conference', 'WCNC'),
        v('Architectures for Networking and Communications Systems', 'ANCS'),
        v('International Workshop on Quality of Service', 'IWQoS'),
        v('The International Symposium on Modeling and Optimization in Mobile, Ad Hoc, and Wireless Networks', 'WiOpt'),
        v('ACM Conference on Information-Centric Networking', 'ICN'),
        v('International Conference on Network and Service Management', 'CNSM'),
      ],
      journals: [
        v('IEEE Transactions on Wireless Communications', 'TWC'),
        v('Wireless Networks', null),
        v('ACM Transactions on Sensor Networks', 'TOSN'),
        v('Journal of Network and Computer Applications', null),
        v('Computer Networks', 'CN'),
        v('Ad Hoc Networks', null),
        v('IEEE Transactions on Network and Service Management', 'TNSM'),
        v('Computer Communications', null, ['CC']),
        v('Mobile Networks and Applications', 'MONET'),
        v('ACM Transactions on Multimedia Computing, Communications, and Applications', 'TOMCCAP'),
        v('ACM Transactions on Internet Technology', 'TOIT'),
        v('IEEE Transactions on Vehicular Technology', 'TVT'),
        v('IEEE Transactions on Aerospace and Electronic Systems', null),
        v('IEEE Internet of Things Journal', null),
        v('Journal of Communications', '通信学报'),
      ],
    },
  },

  'Network and Information Security': {
    A: {
      conferences: [
        v('IEEE Symposium on Security and Privacy', 'S&P'),
        v('ISOC Network and Distributed System Security Symposium', 'NDSS'),
        v('USENIX Security Symposium', 'USENIX Security'),
        v('ACM Conference on Computer and Communications Security', 'CCS'),
        v('European Cryptology Conference', 'EUROCRYPT'),
        v('International Cryptology Conference', 'CRYPTO'),
        v('International Conference on Cryptographic Hardware and Embedded Systems', 'CHES'),
        v('International Conference on the Theory and Application of Cryptology and Information Security', 'ASIACRYPT'),
      ],
      journals: [
        v('IEEE Transactions on Information Forensics and Security', 'TIFS'),
        v('Journal of Cryptology', null),
        v('IEEE Transactions on Dependable and Secure Computing', 'TDSC'),
      ],
    },
    B: {
      conferences: [
        v('Symposium on Usable Privacy and Security', 'SOUPS'),
        v('Financial Cryptography and Data Security', 'FC'),
        v('Privacy Enhancing Technologies Symposium', 'PETS'),
        v('Theory of Cryptography Conference', 'TCC'),
        v('International Workshop on Practice and Theory in Public Key Cryptography', 'PKC'),
        v('Detection of Intrusions and Malware and Vulnerability Assessment', 'DIMVA'),
        v('IEEE Computer Security Foundations Workshop', 'CSFW'),
        v('Fast Software Encryption', 'FSE'),
        v('European Symposium on Research in Computer Security', 'ESORICS'),
        v('The International Conference on Dependable Systems and Networks', 'DSN'),
        v('International Symposium on Recent Advances in Intrusion Detection', 'RAID'),
        v('IFIP/IEEE International Symposium on Integrated Network Management', 'IM'),
        v('Cryptographer’s Track at RSA Conference', 'CT-RSA'),
        v('Annual Computer Security Applications Conference', 'ACSAC'),
        v('Passive and Active Network Measurement Conference', 'PAM'),
        v('Selected Areas in Cryptography', 'SAC'),
        v('Asia Conference on Computer and Communications Security', 'AsiaCCS'),
        v('ACM Conference on Security and Privacy in Wireless and Mobile Networks', 'WiSec'),
        v('Applied Cryptography and Network Security', 'ACNS'),
        v('ACM Workshop on Information Hiding and Multimedia Security', 'IH&MMSec'),
        v('IFIP International Information Security Conference', 'SEC'),
        v('IEEE/IFIP Network Operations and Management Symposium', 'NOMS'),
      ],
      journals: [
        v('Computers and Security', null, ['Computers & Security']),
        v('Journal of Computer Security', 'JCS'),
        v('ACM Transactions on Privacy and Security', 'TOPS'),
        v('Journal of Cryptologic Research', '密码学报'),
      ],
    },
  },

  'Theoretical Computer Science': {
    A: {
      conferences: [
        v('ACM Symposium on the Theory of Computing', 'STOC'),
        v('IEEE Annual Symposium on Foundations of Computer Science', 'FOCS'),
        v('ACM-SIAM Symposium on Discrete Algorithms', 'SODA'),
        v('Computer Aided Verification', 'CAV'),
        v('IEEE Symposium on Logic in Computer Science', 'LICS'),
        v('IEEE Conference on Computational Complexity', 'CCC'),
        v('International Colloquium on Automata, Languages and Programming', 'ICALP'),
      ],
      journals: [
        v('SIAM Journal on Computing', 'SICOMP'),
        v('IEEE Transactions on Information Theory', 'TIT'),
        v('ACM Transactions on Algorithms', 'TALG'),
        v('Information and Computation', 'IANDC'),
      ],
    },
    B: {
      conferences: [
        v('Theory and Applications of Satisfiability Testing', 'SAT'),
        v('International Conference on Automated Deduction / International Joint Conference on Automated Reasoning', 'CADE/IJCAR'),
        v('ACM Symposium on Computational Geometry', 'SoCG'),
        v('International Conference on Concurrency Theory', 'CONCUR'),
        v('Symposium on Theoretical Aspects of Computer Science', 'STACS'),
        v('European Symposium on Algorithms', 'ESA'),
        v('Computer Science Logic', 'CSL'),
        v('Formal Methods in Computer-Aided Design', 'FMCAD'),
        v('Innovations in Theoretical Computer Science', 'ITCS/ICS'),
        v('Scandinavian Symposium and Workshops on Algorithm Theory / the Algorithms and Data Structures Symposium', 'SWAT/WADS'),
        v('IEEE International Symposium on Information Theory', 'ISIT'),
      ],
      journals: [
        v('ACM Transactions on Mathematical Software', 'TOMS'),
        v('Journal of Computer and System Sciences', 'JCSS'),
        v('Future Generation Computer Systems', 'FGCS'),
        v('Algorithmica', 'Algorithmica'),
        v('Computational Complexity', null, ['CC']),
        v('INFORMS Journal on Computing', 'INFORMS'),
        v('ACM Transactions on Computational Logic', 'TOCL'),
        v('Journal of Grid Computing', 'JGC'),
        v('Formal Methods in System Design', 'FMSD'),
        v('Journal of Global Optimization', 'JGO'),
        v('Journal of Symbolic Computation', 'JSC'),
        v('Formal Aspects of Computing', 'FAC'),
        v('Theoretical Computer Science', 'TCS'),
      ],
    },
  },

  'System Software and Software Engineering': {
    A: {
      conferences: [
        v('USENIX Symposium on Operating Systems Design and Implementations', 'OSDI'),
        v('International Conference on Software Engineering', 'ICSE'),
        v('ACM Symposium on Operating Systems Principles', 'SOSP'),
        v('ACM SIGPLAN-SIGACT Symposium on Principles of Programming Languages', 'POPL'),
        v('ACM SIGPLAN Conference on Programming Language Design and Implementation', 'PLDI'),
        v('ACM SIGSOFT Symposium on the Foundations of Software Engineering / European Software Engineering Conference', 'FSE/ESEC'),
        v('International Symposium on Software Testing and Analysis', 'ISSTA'),
        v('Conference on Object-Oriented Programming Systems, Languages, and Applications', 'OOPSLA'),
        v('International Conference on Automated Software Engineering', 'ASE'),
      ],
      journals: [
        v('IEEE Transactions on Software Engineering', 'TSE'),
        v('ACM Transactions on Software Engineering and Methodology', 'TOSEM'),
        v('ACM Transactions on Programming Languages and Systems', 'TOPLAS'),
      ],
    },
    B: {
      conferences: [
        v('Mining Software Repositories', 'MSR'),
        v('International Conference on Software Analysis, Evolution, and Reengineering', 'SANER'),
        v('International Middleware Conference', 'Middleware'),
        v('Evaluation and Assessment in Software Engineering', 'EASE'),
        v('IEEE International Conference on Program Comprehension', 'ICPC'),
        v('International Conference on Software Maintenance and Evolution', 'ICSME'),
        v('IEEE International Symposium on Performance Analysis of Systems and Software', 'ISPASS'),
        v('European Conference on Object-Oriented Programming', 'ECOOP'),
        v('IEEE International Conference on Software Testing, Verification and Validation', 'ICST'),
        v('International Conference on Functional Programming', 'ICFP'),
        v('IEEE International Requirements Engineering Conference', 'RE'),
        v('International Conference on Advanced Information Systems Engineering', 'CAiSE'),
        v('USENIX Workshop on Hot Topics in Operating Systems', 'HotOS'),
        v('European Joint Conferences on Theory and Practice of Software', 'ETAPS'),
        v('International Conference on Verification, Model Checking, and Abstract Interpretation', 'VMCAI'),
        v('International Symposium on Software Reliability Engineering', 'ISSRE'),
        v('International Conference on Model Driven Engineering Languages and Systems', 'MoDELS'),
        v('International Symposium on Empirical Software Engineering and Measurement', 'ESEM'),
        v('International Symposium on Formal Methods', 'FM'),
        v('International Conference on Embedded Software', 'EMSOFT'),
        v('International Conference on Service Computing', 'SCC'),
        v('International Conference on Web Services (Research Track)', 'ICWS'),
        v('International Conference on Principles and Practice of Constraint Programming', 'CP'),
        v('International Symposium on Automated Technology for Verification and Analysis', 'ATVA'),
      ],
      journals: [
        v('IEEE Transactions on Service Computing', 'TSC'),
        v('Information and Software Technology', 'IST'),
        v('Empirical Software Engineering', 'ESE'),
        v('Software and Systems Modeling', 'SoSyM'),
        v('Requirements Engineering', 'RE'),
        v('Journal of Systems and Software', 'JSS'),
        v('Automated Software Engineering', 'ASE'),
        v('Science of Computer Programming', 'SCP'),
        v('International Journal on Software Tools for Technology Transfer', 'STTT'),
        v('Software Testing, Verification and Reliability', 'STVR'),
        v('Software: Practice and Experience', 'SPE'),
        v('Journal of Software', '软件学报'),
      ],
    },
  },

  'Database and Data Mining': {
    A: {
      conferences: [
        v('ACM Conference on Management of Data', 'SIGMOD'),
        v('ACM Knowledge Discovery and Data Mining', 'SIGKDD'),
        v('International Conference on Research and Development in Information Retrieval', 'SIGIR'),
        v('ACM International Conference on Web Search and Data Mining', 'WSDM'),
        v('International Conference on Very Large Data Bases', 'VLDB'),
        v('IEEE International Conference on Data Engineering', 'ICDE'),
        v('ACM Symposium on Principles of Database Systems', 'PODS'),
      ],
      journals: [
        v('IEEE Transactions on Knowledge and Data Engineering', 'TKDE'),
        v('The VLDB Journal', 'VLDBJ'),
        v('ACM Transactions on Database Systems', 'TODS'),
        v('ACM Transactions on Information Systems', 'TOIS'),
      ],
    },
    B: {
      conferences: [
        v('IEEE International Semantic Web Conference', 'ISWC'),
        v('ACM International Conference on Information and Knowledge Management', 'CIKM'),
        v('SIAM International Conference on Data Mining', 'SDM'),
        v('International Conference on Database Theory', 'ICDT'),
        v('International Conference on Data Mining', 'ICDM'),
        v('European Conference on IR Research', 'ECIR'),
        v('International Conference on Extending Database Technology', 'EDBT'),
        v('International Conference on Innovative Data Systems Research', 'CIDR'),
        v('Database Systems for Advanced Applications', 'DASFAA'),
      ],
      journals: [
        v('Information and Management', 'I&M'),
        v('European Journal of Information Systems', 'EJIS'),
        v('International Journal of Geographical Information Science', 'IJGIS'),
        v('Journal of Strategic Information Systems', 'J. Strategic Inf. Sys.'),
        v('Journal of the American Society for Information Science and Technology', 'JASIST'),
        v('Information Processing and Management', 'IPM'),
        v('Information Systems', 'IS'),
        v('Journal of Web Semantics', 'JWS'),
        v('Data Mining and Knowledge Discovery', 'DMKD'),
        v('Knowledge and Information Systems', 'KAIS'),
        v('ACM Transactions on Knowledge Discovery from Data', 'TKDD'),
        v('Advanced Engineering Informatics', 'AEI'),
        v('International Journal of Intelligent Systems', 'IJIS'),
        v('ACM Transactions on the Web', 'TWEB'),
        v('Information Sciences', null),
        v('GeoInformatica', null),
        v('Data and Knowledge Engineering', 'DKE'),
      ],
    },
  },

  'Artificial Intelligence and Pattern Recognition': {
    A: {
      conferences: [
        v('IEEE Conference on Computer Vision and Pattern Recognition', 'CVPR'),
        v('International Conference on Computer Vision', 'ICCV'),
        v('International Conference on Machine Learning', 'ICML'),
        v('Annual Meeting of the Association for Computational Linguistics', 'ACL'),
        v('European Conference on Computer Vision', 'ECCV'),
        v('Annual Conference on Computational Learning Theory', 'COLT'),
        v('Annual Conference on Neural Information Processing Systems', 'NeurIPS', [
          'NIPS',
          'Advances in Neural Information Processing Systems',
        ]),
        v('AAAI Conference on Artificial Intelligence', 'AAAI'),
        v('Conference on Empirical Methods in Natural Language Processing', 'EMNLP'),
        v('IEEE International Conference on Robotics and Automation', 'ICRA'),
        v('International Conference on Learning Representations', 'ICLR'),
        v('Robotics: Science and Systems', 'RSS'),
      ],
      journals: [
        v('IEEE Transactions on Pattern Analysis and Machine Intelligence', 'TPAMI'),
        v('International Journal of Computer Vision', 'IJCV'),
        v('Journal of Machine Learning Research', 'JMLR'),
        v('IEEE Transactions on Robotics', 'TR'),
        v('Artificial Intelligence', 'AI'),
        v('IEEE Transactions on Audio, Speech, and Language Processing', 'TASLP'),
      ],
    },
    B: {
      conferences: [
        v('British Machine Vision Conference', 'BMVC'),
        v('Artificial Intelligence and Statistics', 'AISTATS'),
        v('The Annual Conference of the North American Chapter of the Association for Computational Linguistics', 'NAACL'),
        v('International Joint Conference on Artificial Intelligence', 'IJCAI'),
        v('International Joint Conference on Autonomous Agents and Multi-agent Systems', 'AAMAS'),
        v('International Conference on Automated Planning and Scheduling', 'ICAPS'),
        v('International Joint Conference on Biometrics', 'ICB'),
        v('Genetic and Evolutionary Computation Conference', 'GECCO'),
        v('International Conference on Pattern Recognition', 'ICPR'),
        v('International Conference on Automatic Face and Gesture Recognition', 'FG'),
        v('International Conference on Document Analysis and Recognition', 'ICDAR'),
        v('IEEE/RSJ International Conference on Intelligent Robots and Systems', 'IROS'),
        v('International Conference on Computational Linguistics', 'COLING'),
        v('International Joint Conference on Neural Networks', 'IJCNN'),
        v('International Conference on Uncertainty in Artificial Intelligence', 'UAI'),
        v('International Conference on Algorithmic Learning Theory', 'ALT'),
        v('Conference on Recommender Systems', 'RecSys'),
      ],
      journals: [
        v('IEEE Transactions on Evolutionary Computation', 'TEC'),
        v('IEEE Transactions on Neural Networks and Learning Systems', 'TNNLS'),
        v('IEEE Transactions on Cybernetics', null),
        v('IEEE Transactions on Fuzzy Systems', 'TFS'),
        v('Pattern Recognition', 'PR'),
        v('IEEE Transactions on Affective Computing', 'TAC'),
        v('Journal of Biomedical Informatics', 'JBI'),
        v('Neural Networks', null),
        v('Knowledge-Based Systems', null, ['KNOWLEDGE-BASED SYSTEMS']),
        v('Expert Systems with Applications', 'Expert Syst. Appl.'),
        v('Pattern Recognition Letters', 'PRL'),
        v('Journal of Artificial Intelligence Research', 'JAIR'),
        v('Computer Vision and Image Understanding', 'CVIU'),
        v('Engineering Applications of Artificial Intelligence', 'EAAI'),
        v('International Journal of Neural Systems', null),
        v('Neurocomputing', null),
        v('Evolutionary Computation', null),
        v('Computational Linguistics', null),
        v('Machine Learning', null),
        v('Artificial Intelligence in Medicine', 'AIM'),
        v('Image and Vision Computing', null),
        v('Computer Speech and Language', null),
        v('Journal of Automated Reasoning', null),
        v('International Journal of Approximate Reasoning', 'IJAR'),
        v('Autonomous Agents and Multi-Agent Systems', 'AAMAS'),
        v('International Journal of Intelligent Systems', 'IJIS'),
        v('IEEE Transactions on Games', 'TG'),
        v('Journal of Speech, Language, and Hearing Research', 'JSLHR'),
        v('Neural Computation', null),
        v('Applied Intelligence', null),
        v('Transactions of the Association for Computational Linguistics', 'TACL'),
        v('CAAI Transactions on Intelligent Systems', '智能系统学报'),
        v('Journal of Chinese Information Processing', '中文信息学报'),
      ],
    },
  },

  'Computer Graphics and Multimedia': {
    A: {
      conferences: [
        v('ACM SIGGRAPH Annual Conference', 'SIGGRAPH'),
        v('IEEE Visualization Conference', 'IEEE VIS'),
        v('ACM International Conference on Multimedia', 'ACM MM'),
        v('IEEE Virtual Reality', 'VR'),
      ],
      journals: [
        v('IEEE Transactions on Image Processing', 'TIP'),
        v('ACM Transactions on Graphics', 'TOG'),
        v('IEEE Transactions on Multimedia', 'TMM'),
        v('IEEE Transactions on Visualization and Computer Graphics', 'TVCG'),
        v('Computer-Aided Design', 'CAD'),
      ],
    },
    B: {
      conferences: [
        v('Symposium on Solid and Physical Modeling', 'SPM'),
        v('Eurographics Symposium on Rendering', 'EGSR'),
        v('International Symposium on Mixed and Augmented Reality', 'ISMAR'),
        v('Eurographics', 'EG'),
        v('Eurographics Symposium on Geometry Processing', 'SGP'),
        v('ACM/Eurographics Symposium on Computer Animation', 'SCA'),
        v('Eurographics Conference on Visualization', 'EuroVis'),
        v('IEEE International Conference on Acoustics, Speech, and Signal Processing', 'ICASSP'),
        v('ACM SIGMM International Conference on Multimedia Retrieval', 'ICMR'),
        v('International Conference on Image Processing', 'ICIP'),
        v('ACM Symposium on Interactive 3D Graphics', 'SI3D'),
        v('IEEE Pacific Visualization Symposium', 'PacificVis'),
        v('Pacific Graphics: The Pacific Conference on Computer Graphics and Applications', 'PG'),
        v('Data Compression Conference', 'DCC'),
      ],
      journals: [
        v('Signal Processing', null),
        v('IEEE Transactions on Circuits and Systems for Video Technology', 'TCSVT'),
        v('SIAM Journal on Imaging Sciences', 'SIIMS'),
        v('Computers and Graphics', null, ['Computers & Graphics']),
        v('IEEE Signal Processing Letters', 'SPL'),
        v('Computer Graphics Forum', 'CGF'),
        v('Speech Communication', 'Speech Com'),
        v('Computer Aided Geometric Design', 'CAGD'),
        v('Journal of Computer-Aided Design and Computer Graphics', '计算机辅助设计与图形学学报'),
        v('Journal of Image and Graphics', '中国图像图形学报'),
        v('Journal of Graphics', '图学学报'),
      ],
    },
  },

  'Human-Computer Interaction and Pervasive Computing': {
    A: {
      conferences: [
        v('ACM Conference on Computer Supported Cooperative Work and Social Computing', 'CSCW'),
        v('ACM International Conference on Ubiquitous Computing', 'UbiComp'),
        v('ACM Symposium on User Interface Software and Technology', 'UIST'),
        v('ACM Conference on Human Factors in Computing Systems', 'CHI'),
      ],
      journals: [
        v('International Journal of Human-Computer Studies', 'IJHCS'),
        v('ACM Transactions on Computer-Human Interaction', 'TOCHI'),
      ],
    },
    B: {
      conferences: [
        v('IEEE International Conference on Pervasive Computing and Communications', 'PERCOM'),
        v('ACM International Conference on Intelligent User Interfaces', 'IUI'),
        v('International Conference on Human-Computer Interaction with Mobile Devices and Services', 'MobileHCI'),
        v('ACM Conference on Designing Interactive Systems', 'DIS'),
        v('ACM International Conference on Multimodal Interaction', 'ICMI'),
      ],
      journals: [
        v('User Modeling and User-Adapted Interaction', 'UMUAI'),
        v('IEEE Transactions on Human-Machine Systems', null),
        v('Human-Computer Interaction', 'HCI'),
        v('Pervasive and Mobile Computing', 'PMC'),
        v('International Journal of Human-Computer Interaction', 'IJHCI'),
        v('Behaviour and Information Technology', 'BIT'),
        v('Computer Supported Cooperative Work', 'CSCW'),
        v('Interacting with Computers', 'IWC'),
      ],
    },
  },

  Interdisciplinary: {
    A: {
      conferences: [
        v('International Conference on Research in Computational Molecular Biology', 'RECOMB'),
        v('International Conference on Intelligent Systems for Molecular Biology', 'ISMB'),
        v('International World Wide Web Conferences', 'WWW', ['The Web Conference', 'WWW Conference']),
        v('ACM Conference on Economics and Computation', 'EC'),
      ],
      journals: [
        v('Journal of the ACM', 'JACM'),
        v('Proceedings of the IEEE', 'Proc. IEEE'),
        v('Science China', null),
        v('Chinese Science', '中国科学'),
      ],
    },
    B: {
      conferences: [
        v('International Conference on Hybrid Systems: Computation and Control', 'HSCC'),
        v('International Conference on Medical Image Computing and Computer Assisted Intervention', 'MICCAI'),
        v('International Conference on Business Process Management', 'BPM'),
      ],
      journals: [
        v('IEEE Transactions on Medical Imaging', 'TMI'),
        v('Briefings in Bioinformatics', null),
        v('IEEE Transactions on Intelligent Transportation Systems', 'TITS'),
        v('IEEE Transactions on Geoscience and Remote Sensing', 'TGARS'),
        v('IEEE Transactions on Automation Science and Engineering', 'TASAE'),
        v('Bioinformatics', null),
        v('Journal of the American Medical Informatics Association', 'JAMIA'),
        v('IEEE Journal of Biomedical and Health Informatics', 'JBHI'),
        v('IEEE Transactions on Big Data', 'TBD'),
        v('BMC Bioinformatics', null),
        v('IEEE Geoscience and Remote Sensing Letters', 'GRSL'),
        v('IEEE-ACM Transactions on Computational Biology and Bioinformatics', 'TCBB'),
        v('Journal of Computer Science and Technology', 'JCST'),
        v('Tsinghua Science and Technology', null),
        v('Chinese Journal of Computers', '计算机学报'),
        v('Journal of Computer Research and Development', '计算机研究与发展'),
        v('Acta Electronica Sinica', '电子学报'),
        v('Acta Automatica Sinica', '自动化学报'),
        v('Journal of System Simulation', '系统仿真学报'),
        v('Journal of Tsinghua University (Science and Technology)', '清华大学学报（自然科学版）'),
      ],
    },
  },
});

export const TH_CPL_A_LOOKUP = buildVenueIndex(TH_CPL, ['A']);
export const TH_CPL_AB_LOOKUP = buildVenueIndex(TH_CPL, ['A', 'B']);

export const VENUE_ALIASES = Object.freeze({
  // NeurIPS / NIPS
  [normalizeText('Advances in Neural Information Processing Systems')]: normalizeText('NeurIPS'),
  [normalizeText('Conference on Neural Information Processing Systems')]: normalizeText('NeurIPS'),
  [normalizeText('Neural Information Processing Systems')]: normalizeText('NeurIPS'),
  [normalizeText('NIPS')]: normalizeText('NeurIPS'),

  // WWW
  [normalizeText('The Web Conference')]: normalizeText('WWW'),
  [normalizeText('WWW Conference')]: normalizeText('WWW'),
  [normalizeText('International World Wide Web Conference')]: normalizeText('WWW'),
  [normalizeText('International World Wide Web Conferences')]: normalizeText('WWW'),

  // IROS
  [normalizeText('IEEE RSJ International Conference on Intelligent Robots and Systems')]: normalizeText('IROS'),
  [normalizeText('IEEE/RSJ International Conference on Intelligent Robots and Systems')]: normalizeText('IROS'),
  [normalizeText('IEEE RSJ IROS')]: normalizeText('IROS'),
  [normalizeText('IEEE/RSJ IROS')]: normalizeText('IROS'),

  // CVPR / ICCV / ECCV / ICML / ICLR / ACL / EMNLP / RSS
  [normalizeText('IEEE Conference on Computer Vision and Pattern Recognition')]: normalizeText('CVPR'),
  [normalizeText('International Conference on Computer Vision')]: normalizeText('ICCV'),
  [normalizeText('European Conference on Computer Vision')]: normalizeText('ECCV'),
  [normalizeText('International Conference on Machine Learning')]: normalizeText('ICML'),
  [normalizeText('International Conference on Learning Representations')]: normalizeText('ICLR'),
  [normalizeText('Annual Meeting of the Association for Computational Linguistics')]: normalizeText('ACL'),
  [normalizeText('Conference on Empirical Methods in Natural Language Processing')]: normalizeText('EMNLP'),
  [normalizeText('Robotics Science and Systems')]: normalizeText('RSS'),
  [normalizeText('Robotics: Science and Systems')]: normalizeText('RSS'),

  // hardware / systems
  [normalizeText('International Symposium on Low Power Electronics and Design')]: normalizeText('ISLPED'),
  [normalizeText('International Solid State Circuits Conference')]: normalizeText('ISSCC'),
  [normalizeText('Design Automation Conference')]: normalizeText('DAC'),
  [normalizeText('IEEE ACM International Symposium on Microarchitecture')]: normalizeText('MICRO'),
  [normalizeText('International Conference on Architectural Support for Programming Languages and Operating Systems')]: normalizeText('ASPLOS'),
  [normalizeText('International Conference on Computer Aided Design')]: normalizeText('ICCAD'),
  [normalizeText('Asia and South Pacific Design Automation Conference')]: normalizeText('ASP-DAC'),

  // embedded / sensor / RT
  [normalizeText('Real Time and Embedded Technology and Applications Symposium')]: normalizeText('RTAS'),
  [normalizeText('Real-Time and Embedded Technology and Applications Symposium')]: normalizeText('RTAS'),
  [normalizeText('International Conference on Embedded Software')]: normalizeText('EMSOFT'),
  [normalizeText('ACM Conference on Embedded Networked Sensor Systems')]: normalizeText('SenSys'),

  // journals commonly seen with punctuation variants
  [normalizeText('IEEE Transactions on Computer Aided Design of Integrated Circuits and Systems')]: normalizeText('TCAD'),
  [normalizeText('IEEE Transactions on Very Large Scale Integration Systems')]: normalizeText('TVLSI'),
  [normalizeText('ACM Transactions on Architecture and Code Optimization')]: normalizeText('TACO'),
  [normalizeText('IEEE ACM Transactions on Networking')]: normalizeText('TON'),
  [normalizeText('IEEE Internet of Things Journal')]: normalizeText('IEEE Internet of Things Journal'),
});

export function resolveVenueAlias(value) {
  const candidates = generateVenueCandidateStrings(value);

  for (const candidate of candidates) {
    const normalized = normalizeText(candidate);
    if (VENUE_ALIASES[normalized]) {
      return VENUE_ALIASES[normalized];
    }
  }

  // 如果没有命中 alias，则返回“清洗后的主候选”
  const fallback = candidates[1] ?? candidates[0] ?? '';
  return normalizeText(fallback);
}

export function getVenueCandidates(value) {
  const rawCandidates = generateVenueCandidateStrings(value);

  const normalizedCandidates = uniq(
    rawCandidates.map((candidate) => resolveVenueAlias(candidate)),
  );

  const thCplA = [];
  const thCplAB = [];
  const seenA = new Set();
  const seenAB = new Set();

  for (const candidate of normalizedCandidates) {
    for (const hit of TH_CPL_A_LOOKUP.get(candidate) ?? []) {
      const key = `${hit.area}::${hit.level}::${hit.type}::${hit.canonicalShort ?? ''}::${hit.canonicalFull}`;
      if (!seenA.has(key)) {
        seenA.add(key);
        thCplA.push(hit);
      }
    }

    for (const hit of TH_CPL_AB_LOOKUP.get(candidate) ?? []) {
      const key = `${hit.area}::${hit.level}::${hit.type}::${hit.canonicalShort ?? ''}::${hit.canonicalFull}`;
      if (!seenAB.has(key)) {
        seenAB.add(key);
        thCplAB.push(hit);
      }
    }
  }

  return {
    raw: String(value ?? '').trim(),
    normalized: normalizedCandidates[0] ?? '',
    normalizedCandidates,
    thCplA,
    thCplAB,
  };
}

export function pickBestVenueMatch(value, policy = FILTER_POLICIES.TH_CPL_AB_OR_ARXIV) {
  const result = getVenueCandidates(value);

  const hits =
    policy === FILTER_POLICIES.TH_CPL_A
      ? result.thCplA
      : result.thCplAB;

  if (!hits.length) {
    return {
      matched: false,
      normalized: result.normalized,
      normalizedCandidates: result.normalizedCandidates,
      match: null,
    };
  }

  // 优先 short name 命中，其次 full name
  const best = hits[0];

  return {
    matched: true,
    normalized: result.normalized,
    normalizedCandidates: result.normalizedCandidates,
    match: {
      area: best.area,
      level: best.level,
      type: best.type,
      canonicalFull: best.canonicalFull,
      canonicalShort: best.canonicalShort,
    },
  };
}

export function isArxivUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ARXIV_HOSTS.includes(hostname);
  } catch {
    return false;
  }
}

export function mergeAndNormalizeTags(tags = []) {
  const unique = new Set(
    tags
      .map((tag) => String(tag ?? '').trim())
      .filter(Boolean)
      .filter((tag) => Object.values(TAGS).includes(tag)),
  );

  if (unique.has(TAGS.LP) && unique.has(TAGS.ULP)) {
    unique.delete(TAGS.LP);
  }

  return TAG_DISPLAY_ORDER.filter((tag) => unique.has(tag));
}

export function applyForcedTags(searchSets = [], llmTags = []) {
  const merged = new Set(llmTags);

  for (const group of searchSets) {
    for (const forcedTag of TAG_RULES.forcedByGroup[group] ?? []) {
      merged.add(forcedTag);
    }
  }

  const finalTags = mergeAndNormalizeTags([...merged]);

  const requiresPowerTag = searchSets.includes('B');
  if (requiresPowerTag && !finalTags.includes(TAGS.LP) && !finalTags.includes(TAGS.ULP)) {
    return mergeAndNormalizeTags([...finalTags, TAG_RULES.defaultTagIfMissingByGroup.B]);
  }

  return finalTags;
}

export function ensureCategory(category) {
  return CATEGORY_DISPLAY_ORDER.includes(category)
    ? category
    : CATEGORY_KEYS.APP;
}

export const JSON_OUTPUT_TEMPLATE = Object.freeze({
  version: OUTPUT_SCHEMA_VERSION,
  generated_at: '',
  query_groups: {
    A: QUERY_GROUPS.A.primaryQuery,
    B: QUERY_GROUPS.B.primaryQuery,
    C: QUERY_GROUPS.C.primaryQuery,
  },
  stats: {
    raw_counts: { A: 0, B: 0, C: 0 },
    after_set_ops: { A_only: 0, B: 0, C: 0, merged_total: 0 },
    after_filter: 0,
  },
  categories: CATEGORY_DISPLAY_ORDER.map((title, index) => ({
    key: ['efficient_model_design', 'novel_architecture_accelerator', 'embedded_ai_applications'][index],
    title,
    count: 0,
    papers: [],
  })),
});