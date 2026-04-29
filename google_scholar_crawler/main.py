import argparse
import json
import os
import random
import re
import sys
import time
import webbrowser
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# IMPORTANT:
# 不要在模块加载时立刻 import scholarly
# 先处理代理环境变量，再导入 scholarly
ProxyGenerator = None
scholarly = None
CaptchaException = None


DEBUG_SCHOLAR = str(os.getenv("SCHOLAR_DEBUG", "")).strip().lower() in {
    "1", "true", "yes", "on"
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_progress(event: str, **fields: Any) -> None:
    if not DEBUG_SCHOLAR:
        return
    payload = {
        "ts": now_iso(),
        "event": event,
        **fields,
    }
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def short_title(value: Any, limit: int = 120) -> str:
    text = str(value or "").replace("\n", " ").strip()
    return text[:limit]


def sleep_with_jitter(seconds: float) -> None:
    delay = max(0.0, float(seconds)) + random.uniform(0.0, 0.4)
    time.sleep(delay)


def prepare_proxy_env(
    proxy_mode: str,
    http_proxy: Optional[str] = None,
    https_proxy: Optional[str] = None,
) -> None:
    # 先清理所有代理环境变量，避免 ALL_PROXY / SOCKS 污染
    for key in [
        "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
        "http_proxy", "https_proxy", "all_proxy",
    ]:
        os.environ.pop(key, None)

    # env 模式：只设置 HTTP(S)_PROXY，不调用 ProxyGenerator
    if proxy_mode == "env":
        if http_proxy:
            os.environ["HTTP_PROXY"] = http_proxy
            os.environ["http_proxy"] = http_proxy
        if https_proxy:
            os.environ["HTTPS_PROXY"] = https_proxy
            os.environ["https_proxy"] = https_proxy


def ensure_scholarly_imported() -> None:
    global ProxyGenerator, scholarly, CaptchaException
    if scholarly is not None:
        return

    from scholarly import ProxyGenerator as _ProxyGenerator
    from scholarly import scholarly as _scholarly

    try:
        from scholarly import CaptchaException as _CaptchaException
    except Exception:
        class _CaptchaException(Exception):
            pass

    ProxyGenerator = _ProxyGenerator
    scholarly = _scholarly
    CaptchaException = _CaptchaException


def handle_captcha_if_enabled(interactive_captcha: bool) -> bool:
    if not interactive_captcha:
        return False

    print("Captcha detected. Opening Google Scholar in browser...", flush=True)
    try:
        webbrowser.open_new_tab("https://scholar.google.com")
    except Exception:
        pass

    input("Please finish Scholar verification in your browser, then press Enter to continue...")
    return True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()

    parser.add_argument("command", choices=["keyword-search"])
    parser.add_argument("--group", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-results", type=int, default=20)
    parser.add_argument("--sleep-seconds", type=float, default=2.0)
    parser.add_argument("--retry-limit", type=int, default=1)
    parser.add_argument("--queries-json", default=None)
    parser.add_argument("--year-low", type=int, default=None)
    parser.add_argument("--year-high", type=int, default=None)

    parser.add_argument(
        "--proxy-mode",
        choices=["none", "env", "single", "free"],
        default="none",
    )
    parser.add_argument("--http-proxy", default=None)
    parser.add_argument("--https-proxy", default=None)

    parser.add_argument(
        "--interactive-captcha",
        action="store_true",
        help="Open browser and wait for manual verification when Scholar asks for captcha.",
    )

    return parser.parse_args()


def configure_proxy(args: argparse.Namespace) -> bool:
    ensure_scholarly_imported()

    if args.proxy_mode == "none":
        return True

    if args.proxy_mode == "env":
        # env 模式：代理环境变量已经提前设置好了
        # 这里不调用 ProxyGenerator
        return True

    pg = ProxyGenerator()

    if args.proxy_mode == "single":
        try:
            ok = pg.SingleProxy(http=args.http_proxy, https=args.https_proxy)
        except Exception as exc:
            print(
                f"Exception while testing proxy: {exc}",
                file=sys.stderr,
                flush=True,
            )
            ok = False

    elif args.proxy_mode == "free":
        try:
            ok = pg.FreeProxies()
        except Exception as exc:
            print(
                f"Exception while testing proxy: {exc}",
                file=sys.stderr,
                flush=True,
            )
            ok = False
    else:
        ok = False

    if ok:
        scholarly.use_proxy(pg)
        return True

    print(
        f"Unable to setup the proxy: http={args.http_proxy} https={args.https_proxy}. Reason unknown.",
        file=sys.stderr,
        flush=True,
    )
    return False


def normalize_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return re.sub(r"\s+", " ", text)


def make_record_id(title: str, year: Optional[int], url: str, query_used: str, group: str) -> str:
    base = url or f"{title}|{year}|{query_used}|{group}"
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", base.lower()).strip("-")
    return slug[:240] or f"{group}-{int(time.time())}"


def extract_publication_record(
    publication: Dict[str, Any],
    group: str,
    query_used: str,
) -> Dict[str, Any]:
    bib = publication.get("bib") or {}

    title = normalize_text(bib.get("title") or publication.get("title"))
    abstract = normalize_text(bib.get("abstract") or publication.get("abstract"))
    venue = normalize_text(
        bib.get("venue")
        or bib.get("journal")
        or bib.get("conference")
        or bib.get("booktitle")
    )

    authors_raw = bib.get("author") or publication.get("author") or ""
    if isinstance(authors_raw, list):
        authors = [normalize_text(x) for x in authors_raw if normalize_text(x)]
    else:
        authors = [normalize_text(x) for x in re.split(r"\s+and\s+|,", str(authors_raw)) if normalize_text(x)]

    year = bib.get("pub_year") or bib.get("year") or publication.get("pub_year") or publication.get("year")
    try:
        year = int(year) if year not in (None, "") else None
    except Exception:
        year = None

    cited_by = publication.get("num_citations") or publication.get("citedby") or publication.get("cited_by") or 0
    try:
        cited_by = int(cited_by)
    except Exception:
        cited_by = 0

    pub_url = (
        publication.get("pub_url")
        or publication.get("eprint_url")
        or publication.get("url")
        or ""
    )
    pdf_url = publication.get("eprint_url") or publication.get("pdf_url") or ""

    record = {
        "id": make_record_id(title=title, year=year, url=pub_url, query_used=query_used, group=group),
        "group": group,
        "query_used": query_used,
        "title": title,
        "abstract": abstract,
        "venue": venue,
        "authors": authors,
        "year": year,
        "cited_by": cited_by,
        "pub_url": pub_url,
        "pdf_url": pdf_url,
        "source": "google_scholar",
        "raw": {
            "author_pub_id": publication.get("author_pub_id"),
            "container_type": publication.get("container_type"),
            "filled": publication.get("filled"),
        },
    }
    return record




def year_in_range(year: Optional[int], year_low: Optional[int], year_high: Optional[int]) -> bool:
    if year is None:
        return True
    if year_low is not None and year < year_low:
        return False
    if year_high is not None and year > year_high:
        return False
    return True

def evaluate_post_filter(group: str, record: Dict[str, Any], year_low: Optional[int] = None, year_high: Optional[int] = None) -> Dict[str, Any]:
    title = normalize_text(record.get("title"))
    passed = bool(title) and year_in_range(record.get("year"), year_low, year_high)
    if not title:
        reason = "missing_title"
    elif not year_in_range(record.get("year"), year_low, year_high):
        reason = "outside_year_range"
    else:
        reason = "ok"
    return {
        "passed": passed,
        "reason": reason,
        "group": group,
    }


def fill_publication_with_retry(
    publication: Dict[str, Any],
    retry_limit: int,
    sleep_seconds: float,
    interactive_captcha: bool = False,
    debug_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    last_error: Optional[BaseException] = None
    ctx = debug_context or {}

    for attempt in range(retry_limit + 1):
        try:
            if attempt == 0:
                log_progress("fill_start", **ctx)

            result = scholarly.fill(publication)

            log_progress("fill_ok", attempt=attempt + 1, **ctx)
            return result

        except CaptchaException:
            if handle_captcha_if_enabled(interactive_captcha):
                log_progress("fill_captcha_resolved", **ctx)
                continue
            raise

        except Exception as exc:
            last_error = exc
            log_progress(
                "fill_error",
                attempt=attempt + 1,
                retry_limit=retry_limit + 1,
                error=str(exc),
                error_type=type(exc).__name__,
                **ctx,
            )
            if attempt >= retry_limit:
                break
            sleep_with_jitter(sleep_seconds)

    raise RuntimeError(f"Failed to fill publication after retries: {last_error}") from last_error


def search_group(
    group: str,
    queries: List[str],
    max_results: int,
    sleep_seconds: float,
    retry_limit: int,
    interactive_captcha: bool = False,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
) -> Dict[str, Any]:
    seen: Dict[str, Dict[str, Any]] = {}
    raw_candidate_count = 0
    kept_count = 0
    filtered_out_count = 0
    fill_error_count = 0
    query_stats: List[Dict[str, Any]] = []

    log_progress(
        "group_start",
        group=group,
        total_queries=len(queries),
        max_results=max_results,
        sleep_seconds=sleep_seconds,
        retry_limit=retry_limit,
    )

    for query_index, query in enumerate(queries, start=1):
        query_seen = 0
        query_kept = 0
        query_filtered = 0
        query_fill_errors = 0

        log_progress(
            "query_start",
            group=group,
            query_index=query_index,
            total_queries=len(queries),
            query=query,
        )

        search_iter = None

        while True:
            try:
                log_progress(
                    "query_search_begin",
                    group=group,
                    query_index=query_index,
                    query=query,
                )

                search_iter = scholarly.search_pubs(
                    query,
                    year_low=year_low,
                    year_high=year_high,
                    sort_by='date',
                )

                log_progress(
                    "query_search_ready",
                    group=group,
                    query_index=query_index,
                    query=query,
                )
                break

            except CaptchaException:
                if handle_captcha_if_enabled(interactive_captcha):
                    log_progress(
                        "query_search_captcha_resolved",
                        group=group,
                        query_index=query_index,
                        query=query,
                    )
                    continue
                raise

            except Exception as exc:
                log_progress(
                    "query_search_error",
                    group=group,
                    query_index=query_index,
                    query=query,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
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
                search_iter = None
                break

        if search_iter is None:
            continue

        while len(seen) < max_results:
            log_progress(
                "candidate_request",
                group=group,
                query_index=query_index,
                query_seen=query_seen,
                kept_total=len(seen),
            )

            try:
                pub = next(search_iter)

            except StopIteration:
                log_progress(
                    "query_exhausted",
                    group=group,
                    query_index=query_index,
                    query=query,
                    kept_total=len(seen),
                )
                break

            except CaptchaException:
                if handle_captcha_if_enabled(interactive_captcha):
                    log_progress(
                        "candidate_captcha_resolved",
                        group=group,
                        query_index=query_index,
                        query=query,
                    )
                    continue
                raise

            except Exception as exc:
                log_progress(
                    "candidate_request_error",
                    group=group,
                    query_index=query_index,
                    query=query,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
                sleep_with_jitter(sleep_seconds)
                break

            raw_candidate_count += 1
            query_seen += 1

            pub_title = short_title((pub.get("bib") or {}).get("title") or pub.get("title") or "")

            log_progress(
                "candidate_received",
                group=group,
                query_index=query_index,
                candidate_index=query_seen,
                title=pub_title,
            )

            try:
                filled = fill_publication_with_retry(
                    pub,
                    retry_limit=retry_limit,
                    sleep_seconds=sleep_seconds,
                    interactive_captcha=interactive_captcha,
                    debug_context={
                        "group": group,
                        "query_index": query_index,
                        "candidate_index": query_seen,
                        "title": pub_title,
                    },
                )
            except Exception as exc:
                fill_error_count += 1
                query_fill_errors += 1
                log_progress(
                    "candidate_drop_fill_failed",
                    group=group,
                    query_index=query_index,
                    candidate_index=query_seen,
                    title=pub_title,
                    error=str(exc),
                    error_type=type(exc).__name__,
                )
                continue

            record = extract_publication_record(filled, group=group, query_used=query)
            post_filter = evaluate_post_filter(group, record, year_low=year_low, year_high=year_high)
            record["post_filter"] = post_filter

            if not post_filter["passed"]:
                filtered_out_count += 1
                query_filtered += 1
                log_progress(
                    "candidate_filtered_out",
                    group=group,
                    query_index=query_index,
                    candidate_index=query_seen,
                    title=short_title(record.get("title")),
                )
                continue

            key = record["id"]
            if key not in seen:
                seen[key] = record
                kept_count += 1
                query_kept += 1
                log_progress(
                    "candidate_kept",
                    group=group,
                    query_index=query_index,
                    candidate_index=query_seen,
                    kept_total=len(seen),
                    title=short_title(record.get("title")),
                    year=record.get("year"),
                )
            else:
                log_progress(
                    "candidate_duplicate",
                    group=group,
                    query_index=query_index,
                    candidate_index=query_seen,
                    title=short_title(record.get("title")),
                )

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

        log_progress(
            "query_done",
            group=group,
            query_index=query_index,
            query=query,
            raw_seen=query_seen,
            kept=query_kept,
            filtered=query_filtered,
            fill_errors=query_fill_errors,
            kept_total=len(seen),
        )

    items = list(seen.values())
    items.sort(
        key=lambda item: ((item.get("year") or 0), item.get("cited_by") or 0),
        reverse=True,
    )

    log_progress(
        "group_done",
        group=group,
        raw_candidates_seen=raw_candidate_count,
        kept=kept_count,
        filtered_out=filtered_out_count,
        fill_errors=fill_error_count,
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


def main() -> int:
    args = parse_args()

    prepare_proxy_env(
        proxy_mode=args.proxy_mode,
        http_proxy=args.http_proxy,
        https_proxy=args.https_proxy,
    )
    ensure_scholarly_imported()

    ok = configure_proxy(args)
    if not ok:
        return 1

    if args.command == "keyword-search":
        if args.queries_json:
            queries = json.loads(args.queries_json)
            if not isinstance(queries, list):
                raise ValueError("--queries-json must decode to a list")
            queries = [str(q) for q in queries]
        else:
            queries = [args.group]

        result = search_group(
            group=args.group,
            queries=queries,
            max_results=args.max_results,
            sleep_seconds=args.sleep_seconds,
            retry_limit=args.retry_limit,
            interactive_captcha=args.interactive_captcha,
            year_low=args.year_low,
            year_high=args.year_high,
        )

        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())