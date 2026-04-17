from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import subprocess
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from scholarly import ProxyGenerator, scholarly


ROOT_DIR = Path(__file__).resolve().parent
CACHE_DIR = ROOT_DIR / "cache"
STATE_DIR = ROOT_DIR / "state"
DOWNLOADS_DIR = ROOT_DIR / "downloads" / "embedded-ai"

DEFAULT_OUTPUT_BY_GROUP = {
    "A": CACHE_DIR / "scholar_A_raw.json",
    "B": CACHE_DIR / "scholar_B_raw.json",
    "C": CACHE_DIR / "scholar_C_raw.json",
}

# IMPORTANT:
# These defaults are intentionally centralized here because
# the search logic is likely to change repeatedly.
DEFAULT_QUERIES = {
    "A": [
        '("embedded ai" OR "embedded artificial intelligence") '
        '("machine learning" OR ML OR "deep learning" OR "neural network" OR NN)',
        '"embedded system" '
        '("machine learning" OR ML OR "deep learning" OR "neural network" OR NN)',
    ],
    "B": [
        '("embedded ai" OR "embedded artificial intelligence") '
        '("machine learning" OR ML OR "deep learning" OR "neural network" OR NN) '
        '("low power" OR "low-power" OR "ultra-low-power" OR "ultra low power")',
        '"embedded system" '
        '("machine learning" OR ML OR "deep learning" OR "neural network" OR NN) '
        '("low power" OR "low-power" OR "ultra-low-power" OR "ultra low power")',
    ],
    "C": [
        '("embedded ai" OR "embedded artificial intelligence") '
        '("machine learning" OR ML OR "deep learning" OR "neural network" OR NN) '
        '("tinyml" OR "tiny machine learning") '
        '("microcontroller" OR MCU)',
        '"embedded system" '
        '("machine learning" OR ML OR "deep learning" OR "neural network" OR NN) '
        '("tinyml" OR "tiny machine learning") '
        '("microcontroller" OR MCU)',
    ],
}

TOKEN_GROUPS = {
    "embedded_abstract": [
        "embedded ai",
        "embedded artificial intelligence",
        "embedded system",
        "embedded systems",
    ],
    "ml": [
        "machine learning",
        "ml",
        "deep learning",
        "neural network",
        "neural networks",
        "nn",
    ],
    "power": [
        "low power",
        "low-power",
        "ultra-low-power",
        "ultra low power",
    ],
    "tinyml": [
        "tinyml",
        "tiny machine learning",
    ],
    "mcu": [
        "microcontroller",
        "microcontrollers",
        "mcu",
        "mcus",
    ],
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_text(value: Any) -> str:
    text = str(value or "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[’'`]+", "", text)
    text = re.sub(r"[^a-z0-9+./ -]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def contains_token(text: str, token: str) -> bool:
    token = normalize_text(token)

    if token in {"ml", "nn", "mcu", "mcus"}:
        return re.search(rf"(?<![a-z0-9]){re.escape(token)}(?![a-z0-9])", text) is not None

    if token == "microcontroller":
        return re.search(r"\bmicrocontroller(s)?\b", text) is not None

    if token == "embedded system":
        return re.search(r"\bembedded system(s)?\b", text) is not None

    if token == "neural network":
        return re.search(r"\bneural network(s)?\b", text) is not None

    return token in text


def match_any(text: str, tokens: Iterable[str]) -> Tuple[bool, List[str]]:
    matched: List[str] = []
    for token in tokens:
        if contains_token(text, token):
            matched.append(token)
    return (len(matched) > 0, matched)


def split_authors(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]

    text = str(value or "").strip()
    if not text:
        return []

    parts = re.split(r"\s+and\s+|\s*,\s*", text)
    return [p.strip() for p in parts if p.strip()]


def coalesce(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        return value
    return None


def safe_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    match = re.search(r"(19|20)\d{2}", str(value))
    return int(match.group(0)) if match else None


def fingerprint_for(pub: Dict[str, Any]) -> str:
    title = normalize_text(pub.get("title"))
    year = pub.get("year") or ""
    pub_url = pub.get("pub_url") or ""
    eprint_url = pub.get("eprint_url") or ""
    scholar_url = pub.get("scholar_url") or ""

    payload = "||".join([title, str(year), pub_url, eprint_url, scholar_url])
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def build_text_fields(pub: Dict[str, Any]) -> Dict[str, str]:
    title = normalize_text(pub.get("title"))
    abstract = normalize_text(pub.get("abstract"))
    snippet = normalize_text(pub.get("snippet"))
    venue = normalize_text(pub.get("venue"))
    pub_url = normalize_text(pub.get("pub_url"))
    eprint_url = normalize_text(pub.get("eprint_url"))
    scholar_url = normalize_text(pub.get("scholar_url"))

    title_or_abstract = " ".join(v for v in [title, abstract] if v).strip()
    anywhere = " ".join(
        v for v in [title, abstract, snippet, venue, pub_url, eprint_url, scholar_url] if v
    ).strip()

    return {
        "title": title,
        "abstract": abstract,
        "snippet": snippet,
        "venue": venue,
        "title_or_abstract": title_or_abstract,
        "anywhere": anywhere,
    }


def evaluate_post_filter(group: str, pub: Dict[str, Any]) -> Dict[str, Any]:
    text = build_text_fields(pub)
    checks: List[Dict[str, Any]] = []

    def add_check(name: str, source: str, tokens: List[str]) -> bool:
        ok, matched = match_any(text[source], tokens)
        checks.append(
            {
                "name": name,
                "source": source,
                "passed": ok,
                "matched_tokens": matched,
            }
        )
        return ok

    passed = True

    # A/B/C all require one embedded-* token in ABSTRACT.
    passed &= add_check(
        "embedded_term_in_abstract",
        "abstract",
        TOKEN_GROUPS["embedded_abstract"],
    )

    # A/B/C all require one ML-related term in TITLE or ABSTRACT.
    passed &= add_check(
        "ml_term_in_title_or_abstract",
        "title_or_abstract",
        TOKEN_GROUPS["ml"],
    )

    if group == "B":
        passed &= add_check(
            "power_term_in_title_or_abstract",
            "title_or_abstract",
            TOKEN_GROUPS["power"],
        )

    elif group == "C":
        passed &= add_check(
            "tinyml_term_in_title_or_abstract",
            "title_or_abstract",
            TOKEN_GROUPS["tinyml"],
        )

        # Scholar cannot reliably expose full paper body text.
        # Here "body/full text allowed" is approximated by the union of
        # all accessible metadata text we can obtain from Scholar.
        passed &= add_check(
            "mcu_term_anywhere_accessible",
            "anywhere",
            TOKEN_GROUPS["mcu"],
        )

    return {
        "passed": bool(passed),
        "checks": checks,
        "text_fields_used": {
            "title": pub.get("title") or "",
            "abstract": pub.get("abstract") or "",
            "snippet": pub.get("snippet") or "",
            "venue": pub.get("venue") or "",
        },
    }


def sleep_with_jitter(seconds: float) -> None:
    if seconds <= 0:
        return
    time.sleep(seconds + random.uniform(0, min(0.5, seconds * 0.1)))


def configure_proxy(
    proxy_mode: str,
    single_http_proxy: str = "",
    single_https_proxy: str = "",
) -> Dict[str, Any]:
    """
    proxy_mode:
      - none
      - free
      - single
    """
    result = {
        "requested_mode": proxy_mode,
        "enabled": False,
        "effective_mode": "none",
        "message": "",
    }

    if proxy_mode == "none":
        result["message"] = "Proxy disabled."
        return result

    pg = ProxyGenerator()

    if proxy_mode == "free":
        try:
            ok = pg.FreeProxies()
            if ok:
                scholarly.use_proxy(pg)
                result["enabled"] = True
                result["effective_mode"] = "free"
                result["message"] = "Using ProxyGenerator.FreeProxies()."
                return result
            result["message"] = "Free proxy initialization returned False."
            return result
        except Exception as exc:  # noqa: BLE001
            result["message"] = f"Free proxy initialization failed: {exc}"
            return result

    if proxy_mode == "single":
        if not single_http_proxy and not single_https_proxy:
            result["message"] = (
                "Proxy mode 'single' requested, but no HTTP/HTTPS proxy URL was provided."
            )
            return result

        try:
            ok = pg.SingleProxy(
                http=single_http_proxy or None,
                https=single_https_proxy or None,
            )
            if ok:
                scholarly.use_proxy(pg)
                result["enabled"] = True
                result["effective_mode"] = "single"
                result["message"] = "Using ProxyGenerator.SingleProxy()."
                return result
            result["message"] = "Single proxy initialization returned False."
            return result
        except Exception as exc:  # noqa: BLE001
            result["message"] = f"Single proxy initialization failed: {exc}"
            return result

    result["message"] = f"Unknown proxy mode: {proxy_mode}"
    return result


def fill_publication_with_retry(
    publication: Dict[str, Any],
    retry_limit: int,
    sleep_seconds: float,
) -> Dict[str, Any]:
    last_error: Optional[BaseException] = None

    for attempt in range(retry_limit + 1):
        try:
            return scholarly.fill(publication)
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= retry_limit:
                break
            sleep_with_jitter(sleep_seconds)

    raise RuntimeError(f"Failed to fill publication after retries: {last_error}") from last_error


def extract_publication_record(raw_pub: Dict[str, Any], group: str, query_used: str) -> Dict[str, Any]:
    bib = raw_pub.get("bib") or {}

    title = coalesce(bib.get("title"), raw_pub.get("title"), "")
    abstract = coalesce(bib.get("abstract"), raw_pub.get("abstract"), "")
    authors = split_authors(coalesce(bib.get("author"), raw_pub.get("author"), []))
    venue = coalesce(
        bib.get("venue"),
        bib.get("journal"),
        bib.get("conference"),
        raw_pub.get("venue"),
        "",
    )
    year = safe_int(coalesce(bib.get("pub_year"), raw_pub.get("pub_year"), bib.get("year")))
    cited_by = raw_pub.get("num_citations") or raw_pub.get("citedby") or 0

    record = {
        "id": "",
        "source": "google_scholar",
        "group": group,
        "query_used": query_used,
        "title": str(title or "").strip(),
        "abstract": str(abstract or "").strip(),
        "authors": authors,
        "venue": str(venue or "").strip(),
        "year": year,
        "pub_url": raw_pub.get("pub_url") or "",
        "eprint_url": raw_pub.get("eprint_url") or "",
        "scholar_url": raw_pub.get("url_scholarbib") or raw_pub.get("scholar_url") or "",
        "cited_by": int(cited_by or 0),
        "snippet": str(raw_pub.get("snippet") or "").strip(),
        "container_type": raw_pub.get("container_type") or "",
        "bib": {
            "title": str(title or "").strip(),
            "author": str(coalesce(bib.get("author"), raw_pub.get("author"), "") or "").strip(),
            "abstract": str(abstract or "").strip(),
            "venue": str(venue or "").strip(),
            "pub_year": year,
        },
        "raw": raw_pub,
    }
    record["id"] = fingerprint_for(record)
    return record


def search_group(
    group: str,
    queries: List[str],
    max_results: int,
    sleep_seconds: float,
    retry_limit: int,
) -> Dict[str, Any]:
    seen: Dict[str, Dict[str, Any]] = {}
    raw_candidate_count = 0
    kept_count = 0
    filtered_out_count = 0
    fill_error_count = 0
    query_stats: List[Dict[str, Any]] = []

    for query in queries:
        query_seen = 0
        query_kept = 0
        query_filtered = 0
        query_fill_errors = 0

        try:
            search_iter = scholarly.search_pubs(query)
        except Exception as exc:  # noqa: BLE001
            query_stats.append(
                {
                    "query": query,
                    "raw_seen": 0,
                    "kept": 0,
                    "filtered": 0,
                    "fill_errors": 0,
                    "search_error": str(exc),
                }
            )
            continue

        while len(seen) < max_results:
            try:
                pub = next(search_iter)
            except StopIteration:
                break
            except Exception:
                sleep_with_jitter(sleep_seconds)
                break

            raw_candidate_count += 1
            query_seen += 1

            try:
                filled = fill_publication_with_retry(
                    pub,
                    retry_limit=retry_limit,
                    sleep_seconds=sleep_seconds,
                )
            except Exception:  # noqa: BLE001
                fill_error_count += 1
                query_fill_errors += 1
                continue

            record = extract_publication_record(filled, group=group, query_used=query)
            post_filter = evaluate_post_filter(group, record)
            record["post_filter"] = post_filter

            if not post_filter["passed"]:
                filtered_out_count += 1
                query_filtered += 1
                continue

            key = record["id"]
            if key not in seen:
                seen[key] = record
                kept_count += 1
                query_kept += 1

            sleep_with_jitter(sleep_seconds)

        query_stats.append(
            {
                "query": query,
                "raw_seen": query_seen,
                "kept": query_kept,
                "filtered": query_filtered,
                "fill_errors": query_fill_errors,
            }
        )

    items = list(seen.values())
    items.sort(
        key=lambda item: ((item.get("year") or 0), item.get("cited_by") or 0),
        reverse=True,
    )

    return {
        "command": "keyword-search",
        "group": group,
        "generated_at": now_iso(),
        "queries": queries,
        "max_results": max_results,
        "sleep_seconds": sleep_seconds,
        "retry_limit": retry_limit,
        "stats": {
            "raw_candidates_seen": raw_candidate_count,
            "fill_errors": fill_error_count,
            "filtered_out_by_post_filter": filtered_out_count,
            "kept_after_post_filter_and_dedupe": kept_count,
        },
        "query_stats": query_stats,
        "items": items,
    }


def ensure_parent_dir(file_path: Path) -> None:
    file_path.parent.mkdir(parents=True, exist_ok=True)


def write_json(file_path: Path, payload: Dict[str, Any]) -> None:
    ensure_parent_dir(file_path)
    with file_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def parse_queries_json(value: Optional[str], group: str) -> List[str]:
    if not value:
        return list(DEFAULT_QUERIES[group])

    data = json.loads(value)
    if not isinstance(data, list) or not all(isinstance(x, str) and x.strip() for x in data):
        raise ValueError("--queries-json must be a JSON array of non-empty strings")

    return [x.strip() for x in data]


def run_keyword_search(args: argparse.Namespace) -> int:
    queries = parse_queries_json(args.queries_json, args.group)
    output_path = Path(args.output) if args.output else DEFAULT_OUTPUT_BY_GROUP[args.group]
    output_path = output_path if output_path.is_absolute() else (ROOT_DIR / output_path).resolve()

    proxy_info = configure_proxy(
        proxy_mode=args.proxy_mode,
        single_http_proxy=args.http_proxy or "",
        single_https_proxy=args.https_proxy or "",
    )

    result = search_group(
        group=args.group,
        queries=queries,
        max_results=args.max_results,
        sleep_seconds=args.sleep_seconds,
        retry_limit=args.retry_limit,
    )
    result["proxy"] = proxy_info

    write_json(output_path, result)

    summary = {
        "ok": True,
        "group": args.group,
        "output": str(output_path),
        "proxy": proxy_info,
        "stats": result["stats"],
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


def run_download(args: argparse.Namespace) -> int:
    downloader_path = ROOT_DIR / "downloader.py"
    if not downloader_path.exists():
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": f"downloader.py not found at {downloader_path}",
                },
                ensure_ascii=False,
            )
        )
        return 2

    cmd = [
        sys.executable,
        str(downloader_path),
        "--input",
        str(args.input),
        "--output-dir",
        str(args.output_dir),
        "--state",
        str(args.state),
        "--quota",
        str(args.quota),
        "--daily-limit",
        str(args.daily_limit),
    ]

    if args.max_downloads is not None:
        cmd.extend(["--max-downloads", str(args.max_downloads)])

    if args.dry_run:
        cmd.append("--dry-run")

    completed = subprocess.run(cmd, check=False)
    return completed.returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Google Scholar crawler entrypoint for embedded AI paper search."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    search_parser = subparsers.add_parser(
        "keyword-search",
        help="Run keyword-based Google Scholar search for group A/B/C.",
    )
    search_parser.add_argument("--group", choices=["A", "B", "C"], required=True)
    search_parser.add_argument("--output", default=None)
    search_parser.add_argument(
        "--queries-json",
        default=None,
        help="JSON array of query strings. If omitted, built-in defaults are used.",
    )
    search_parser.add_argument("--max-results", type=int, default=120)
    search_parser.add_argument("--sleep-seconds", type=float, default=3.0)
    search_parser.add_argument("--retry-limit", type=int, default=3)

    search_parser.add_argument(
        "--proxy-mode",
        choices=["none", "free", "single"],
        default="none",
        help="Proxy mode for scholarly.",
    )
    search_parser.add_argument(
        "--http-proxy",
        default="",
        help="HTTP proxy URL used when --proxy-mode single.",
    )
    search_parser.add_argument(
        "--https-proxy",
        default="",
        help="HTTPS proxy URL used when --proxy-mode single.",
    )
    search_parser.set_defaults(handler=run_keyword_search)

    download_parser = subparsers.add_parser("download", help="Delegate to downloader.py.")
    download_parser.add_argument("--input", required=True)
    download_parser.add_argument("--output-dir", required=True)
    download_parser.add_argument("--state", required=True)
    download_parser.add_argument("--quota", required=True)
    download_parser.add_argument("--daily-limit", type=int, required=True)
    download_parser.add_argument("--max-downloads", type=int, default=None)
    download_parser.add_argument("--dry-run", action="store_true")
    download_parser.set_defaults(handler=run_download)

    return parser


def main(argv: Optional[List[str]] = None) -> int:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

    parser = build_parser()
    args = parser.parse_args(argv)
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())