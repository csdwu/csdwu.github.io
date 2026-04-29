#!/usr/bin/env python3
"""
arXiv API search implementation.

Queries arXiv and outputs paper data in JSON format compatible with the
existing Scholar-style pipeline. Supports:
- full pagination
- retry with backoff
- optional year filtering via submittedDate
- total count lookup via opensearch:totalResults
"""

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode
from xml.etree import ElementTree as ET

# arXiv API endpoint
ARXIV_API_BASE = "https://export.arxiv.org/api/query"

# Default parameters
DEFAULT_PAGE_SIZE = 50
DEFAULT_TOTAL_LIMIT = None  # No limit by default
ARXIV_REQUEST_TIMEOUT = 30
MAX_RETRIES = 6
RETRY_BACKOFF_BASE = 10  # seconds
PAGE_SLEEP = 6  # seconds between pages
USER_AGENT = "embedded-ai-crawler/1.1 (compatible)"

ATOM_NAMESPACES = {
    "atom": "http://www.w3.org/2005/Atom",
    "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
    "arxiv": "http://arxiv.org/schemas/atom",
}

ARXIV_VENUE_PATTERNS = [
    (re.compile(r"\b(neurips|nips|neural information processing systems|advances in neural information processing systems|conference on neural information processing systems)\b", re.I), "NeurIPS"),
    (re.compile(r"\b(icml|international conference on machine learning)\b", re.I), "ICML"),
    (re.compile(r"\b(iclr|international conference on learning representations)\b", re.I), "ICLR"),
    (re.compile(r"\b(cvpr|conference on computer vision and pattern recognition)\b", re.I), "CVPR"),
    (re.compile(r"\b(iccv|international conference on computer vision)\b", re.I), "ICCV"),
    (re.compile(r"\b(eccv|european conference on computer vision)\b", re.I), "ECCV"),
    (re.compile(r"\b(aaai|association for the advancement of artificial intelligence)\b", re.I), "AAAI"),
    (re.compile(r"\b(ijcai|international joint conference on artificial intelligence)\b", re.I), "IJCAI"),
    (re.compile(r"\b(asplos|architectural support for programming languages and operating systems)\b", re.I), "ASPLOS"),
    (re.compile(r"\b(isca|international symposium on computer architecture)\b", re.I), "ISCA"),
    (re.compile(r"\b(microarchitecture|ieee/acm international symposium on microarchitecture|\bmicro\b)\b", re.I), "MICRO"),
    (re.compile(r"\b(hpca|high performance computer architecture|international symposium on high-performance computer architecture)\b", re.I), "HPCA"),
    (re.compile(r"\b(dac|design automation conference)\b", re.I), "DAC"),
    (re.compile(r"\b(date|design, automation and test in europe)\b", re.I), "DATE"),
    (re.compile(r"\b(iccad|international conference on computer-aided design|computer aided design)\b", re.I), "ICCAD"),
    (re.compile(r"\b(codes\+isss|codes and isss|codes/isss|hardware/software co-design and system synthesis)\b", re.I), "CODES+ISSS"),
    (re.compile(r"\b(emsoft|embedded software)\b", re.I), "EMSOFT"),
    (re.compile(r"\b(rtas|real-time and embedded technology and applications symposium)\b", re.I), "RTAS"),
    (re.compile(r"\b(rtss|real-time systems symposium)\b", re.I), "RTSS"),
    (re.compile(r"\b(islped|international symposium on low power electronics and design|low power electronics and design)\b", re.I), "ISLPED"),
    (re.compile(r"\b(ipsn|information processing in sensor networks)\b", re.I), "IPSN"),
    (re.compile(r"\b(sensys|sensor systems|embedded networked sensor systems)\b", re.I), "SenSys"),
    (re.compile(r"\b(ieee transactions on computers|ieee trans\.? on computers|ieee tc)\b", re.I), "IEEE Transactions on Computers"),
    (re.compile(r"\b(ieee transactions on computer-aided design|ieee transactions on computer aided design|ieee trans\.? on computer[- ]aided design|ieee tcad|tcad)\b", re.I), "IEEE Transactions on Computer-Aided Design of Integrated Circuits and Systems"),
    (re.compile(r"\b(acm transactions on embedded computing systems|acm tecs|tecs)\b", re.I), "ACM Transactions on Embedded Computing Systems"),
]


def infer_venue_from_arxiv_metadata(journal_ref: str = "", comment: str = "", doi: str = "") -> str:
    """
    Conservatively infer a real venue from arXiv metadata.
    Returns an empty string when no reliable venue can be recognized.
    """
    for source_text in (journal_ref, comment, doi):
        text = source_text.strip()
        if not text:
            continue

        for pattern, venue in ARXIV_VENUE_PATTERNS:
            if pattern.search(text):
                return venue

    return ""


def parse_arxiv_entry(entry, namespaces: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """
    Parse an arXiv entry (paper) from Atom XML format.
    Returns a dict compatible with the existing Scholar-style output.
    """
    try:
        id_elem = entry.find("atom:id", namespaces)
        title_elem = entry.find("atom:title", namespaces)
        summary_elem = entry.find("atom:summary", namespaces)
        published_elem = entry.find("atom:published", namespaces)
        updated_elem = entry.find("atom:updated", namespaces)

        if not (id_elem is not None and title_elem is not None):
            return None

        arxiv_id = id_elem.text.strip().split("/abs/")[-1] if id_elem.text else ""
        title = title_elem.text.strip() if title_elem.text else ""
        if not arxiv_id or not title:
            return None

        abstract = summary_elem.text.strip() if summary_elem is not None and summary_elem.text else ""
        published = published_elem.text.strip() if published_elem is not None and published_elem.text else ""
        updated = updated_elem.text.strip() if updated_elem is not None and updated_elem.text else ""
        journal_ref = entry.findtext("arxiv:journal_ref", default="", namespaces=namespaces).strip()
        doi = entry.findtext("arxiv:doi", default="", namespaces=namespaces).strip()
        comment = entry.findtext("arxiv:comment", default="", namespaces=namespaces).strip()

        inferred_venue = infer_venue_from_arxiv_metadata(journal_ref, comment, doi)
        if inferred_venue:
            if journal_ref:
                venue = inferred_venue
                raw_venue = journal_ref
                venue_source = "arxiv_journal_ref"
            elif comment:
                venue = inferred_venue
                raw_venue = comment
                venue_source = "arxiv_comment"
            else:
                venue = inferred_venue
                raw_venue = ""
                venue_source = "arxiv_doi"
        elif journal_ref:
            venue = journal_ref
            raw_venue = journal_ref
            venue_source = "arxiv_journal_ref"
        elif comment:
            venue = comment
            raw_venue = comment
            venue_source = "arxiv_comment"
        else:
            venue = ""
            raw_venue = ""
            venue_source = ""

        year = None
        month = None
        if published:
            try:
                # published format is typically YYYY-MM-DDTHH:MM:SSZ
                year = int(published[:4])
                month = int(published[5:7])
            except (ValueError, IndexError):
                year = None
                month = None

        authors = []
        for author_elem in entry.findall("atom:author", namespaces):
            name_elem = author_elem.find("atom:name", namespaces)
            if name_elem is not None and name_elem.text:
                authors.append(name_elem.text.strip())

        pdf_url = ""
        paper_url = ""
        for link_elem in entry.findall("atom:link", namespaces):
            href = link_elem.get("href", "")
            rel = link_elem.get("rel", "alternate")
            title_attr = link_elem.get("title", "")

            if "pdf" in title_attr.lower():
                pdf_url = href
            elif rel == "alternate":
                paper_url = href

        if not paper_url and arxiv_id:
            paper_url = f"https://arxiv.org/abs/{arxiv_id}"
        if not pdf_url and arxiv_id:
            pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"

        paper = {
            "arxiv_id": arxiv_id,
            "title": title,
            "abstract": abstract,
            "authors": authors,
            "year": year,
            "month": month,
            "published": published,
            "updated": updated,
            "urls": {
                "arxiv": paper_url,
                "pdf": pdf_url,
            },
            "arxiv_url": paper_url,
            "pdf_url": pdf_url,
            "eprint_url": pdf_url,
            "pub_url": paper_url,
            "snippet": abstract[:200] if abstract else "",
            "source": "arxiv",
            "is_preprint_on_arxiv": True,
            "preprint_source": "arXiv",
            "journal_ref": journal_ref,
            "doi": doi,
            "arxiv_comment": comment,
            "venue": venue,
            "raw_venue": raw_venue,
            "venue_source": venue_source,
            "cited_by": 0,
        }
        return paper

    except Exception as e:
        print(f"[arxiv_search] Error parsing entry: {e}", file=sys.stderr)
        return None


def normalize_categories(raw_categories: Optional[str]) -> Optional[List[str]]:
    if not raw_categories:
        return None
    categories = [c.strip() for c in raw_categories.split(",") if c.strip()]
    return categories or None


def build_submitted_date_clause(
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
) -> Optional[str]:
    if year_low is None and year_high is None:
        return None

    lower = year_low if year_low is not None else 1991
    upper = year_high if year_high is not None else datetime.now(timezone.utc).year

    start_str = f"{lower}01010000"
    end_str = f"{upper}12312359"

    # Important: use spaces around TO here.
    # urlencode() will convert spaces to URL-safe encoding.
    return f"submittedDate:[{start_str} TO {end_str}]"


def parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    text = str(value).strip()
    if not text:
        return None

    if text.endswith("Z"):
        text = text[:-1] + "+00:00"

    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def format_arxiv_date(dt: datetime) -> str:
    utc_dt = dt.astimezone(timezone.utc)
    return utc_dt.strftime("%Y%m%d%H%M")


def build_last_updated_clause(
    updated_after: Optional[str] = None,
) -> Optional[str]:
    dt = parse_iso_datetime(updated_after)
    if dt is None:
        return None

    start_str = format_arxiv_date(dt)
    end_str = format_arxiv_date(datetime.now(timezone.utc))

    # Important: use spaces around TO here.
    return f"lastUpdatedDate:[{start_str} TO {end_str}]"


def build_full_query(
    query: str,
    categories: Optional[List[str]] = None,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
    updated_after: Optional[str] = None,
) -> str:
    query_parts = [f"({query})"]

    if categories:
        cat_query = " OR ".join([f"cat:{cat}" for cat in categories])
        query_parts.append(f"({cat_query})")

    date_clause = build_submitted_date_clause(year_low, year_high)
    if date_clause:
        query_parts.append(date_clause)

    updated_clause = build_last_updated_clause(updated_after)
    if updated_clause:
        query_parts.append(updated_clause)

    return " AND ".join(query_parts)


def perform_arxiv_request(post_data: Dict[str, Any]) -> str:
    data = urlencode(post_data).encode("utf-8")

    req = urllib.request.Request(ARXIV_API_BASE, data=data, method="POST")
    req.add_header("User-Agent", USER_AGENT)
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urllib.request.urlopen(req, timeout=ARXIV_REQUEST_TIMEOUT) as response:
        return response.read().decode("utf-8")


def parse_total_results(xml_data: str) -> int:
    root = ET.fromstring(xml_data)
    total_elem = root.find("opensearch:totalResults", ATOM_NAMESPACES)
    if total_elem is None or total_elem.text is None:
        return 0
    return int(total_elem.text.strip())


def fetch_total_available(
    query: str,
    categories: Optional[List[str]] = None,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
    updated_after: Optional[str] = None,
) -> Optional[int]:
    """
    Fetch total result count for this query. If it fails, return None and continue.
    """
    full_query = build_full_query(
        query=query,
        categories=categories,
        year_low=year_low,
        year_high=year_high,
        updated_after=updated_after,
    )

    post_data = {
        "search_query": full_query,
        "start": 0,
        "max_results": 1,
        "sortBy": "lastUpdatedDate",
        "sortOrder": "descending",
    }

    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            xml_data = perform_arxiv_request(post_data)
            return parse_total_results(xml_data)
        except Exception as e:
            last_error = e
            if attempt < MAX_RETRIES - 1:
                wait_time = RETRY_BACKOFF_BASE * (2 ** attempt)
                print(
                    f"[arxiv_search] Total-count attempt {attempt + 1} failed, retrying in {wait_time}s: {e}",
                    file=sys.stderr,
                )
                time.sleep(wait_time)

    print(
        f"[arxiv_search] Failed to fetch total count after {MAX_RETRIES} attempts: {last_error}",
        file=sys.stderr,
    )
    return None


def search_arxiv_page(
    query: str,
    categories: Optional[List[str]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    start_index: int = 0,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
    updated_after: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Search arXiv for a single page and return papers.
    Uses POST request for better stability with long queries.
    """
    try:
        full_query = build_full_query(
            query=query,
            categories=categories,
            year_low=year_low,
            year_high=year_high,
            updated_after=updated_after,
        )

        post_data = {
            "search_query": full_query,
            "start": start_index,
            "max_results": page_size,
            "sortBy": "lastUpdatedDate",
            "sortOrder": "descending",
        }

        print(
            f"[arxiv_search] Querying page start={start_index}, size={page_size}: {full_query}",
            file=sys.stderr,
        )

        xml_data = perform_arxiv_request(post_data)

        root = ET.fromstring(xml_data)
        entries = root.findall("atom:entry", ATOM_NAMESPACES)

        papers = []
        for entry in entries:
            paper = parse_arxiv_entry(entry, ATOM_NAMESPACES)
            if paper:
                papers.append(paper)

        end_index = start_index + max(len(papers) - 1, 0)
        print(
            f"[arxiv_search] Page {start_index}-{end_index}: found {len(papers)} papers",
            file=sys.stderr,
        )
        return papers

    except urllib.error.URLError as e:
        print(f"[arxiv_search] Network error: {e}", file=sys.stderr)
        raise
    except Exception as e:
        print(f"[arxiv_search] Error searching arXiv page: {e}", file=sys.stderr)
        raise


def search_arxiv_with_retry(
    query: str,
    categories: Optional[List[str]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    start_index: int = 0,
    max_retries: int = MAX_RETRIES,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
    updated_after: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Search arXiv with retry logic and exponential backoff.
    """
    last_error = None
    for attempt in range(max_retries):
        try:
            return search_arxiv_page(
                query=query,
                categories=categories,
                page_size=page_size,
                start_index=start_index,
                year_low=year_low,
                year_high=year_high,
                updated_after=updated_after,
            )
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                wait_time = RETRY_BACKOFF_BASE * (2 ** attempt)
                print(
                    f"[arxiv_search] Attempt {attempt + 1} failed, retrying in {wait_time}s: {e}",
                    file=sys.stderr,
                )
                time.sleep(wait_time)
            else:
                print(
                    f"[arxiv_search] All {max_retries} attempts failed",
                    file=sys.stderr,
                )
                raise last_error


def search_arxiv_full(
    query: str,
    categories: Optional[List[str]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    total_limit: Optional[int] = DEFAULT_TOTAL_LIMIT,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
    updated_after: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Search arXiv with full pagination until all results are fetched or limit reached.
    
    Returns a dict with:
    {
        "papers": [...],
        "complete": bool,
        "total_available": int or None,
        "fetched_count": int,
        "failed_start": int or None,
        "error": str or None
    }
    """
    all_papers = []
    start_index = 0
    total_available = None
    failed_start = None
    error_message = None

    # Fetch total count first
    try:
        total_available = fetch_total_available(
            query=query,
            categories=categories,
            year_low=year_low,
            year_high=year_high,
            updated_after=updated_after,
        )
    except Exception as e:
        print(f"[arxiv_search] Warning: Could not fetch total count: {e}", file=sys.stderr)

    while True:
        if total_limit is not None and len(all_papers) >= total_limit:
            print(
                f"[arxiv_search] Reached total limit of {total_limit} papers",
                file=sys.stderr,
            )
            break

        remaining = total_limit - len(all_papers) if total_limit else page_size
        current_page_size = min(page_size, remaining) if total_limit else page_size

        try:
            papers = search_arxiv_with_retry(
                query=query,
                categories=categories,
                page_size=current_page_size,
                start_index=start_index,
                max_retries=MAX_RETRIES,
                year_low=year_low,
                year_high=year_high,
                updated_after=updated_after,
            )
        except Exception as e:
            error_str = str(e)
            print(
                f"[arxiv_search] Failed to fetch page starting at {start_index}: {e}",
                file=sys.stderr,
            )
            failed_start = start_index
            error_message = error_str
            break

        if not papers:
            print(f"[arxiv_search] No more results from page {start_index}", file=sys.stderr)
            break

        all_papers.extend(papers)
        start_index += current_page_size

        if len(papers) < current_page_size:
            print("[arxiv_search] Reached end of results", file=sys.stderr)
            break

        if start_index < 30000:
            print(f"[arxiv_search] Sleeping {PAGE_SLEEP}s before next page...", file=sys.stderr)
            time.sleep(PAGE_SLEEP)

    # Determine if this is a complete fetch
    complete = True
    if failed_start is not None:
        complete = False
    elif total_available is not None and total_limit is None and len(all_papers) < total_available:
        # Fetched fewer papers than total available in unlimited full search
        complete = False

    return {
        "papers": all_papers,
        "complete": complete,
        "total_available": total_available,
        "fetched_count": len(all_papers),
        "failed_start": failed_start,
        "error": error_message,
    }


def main():
    parser = argparse.ArgumentParser(description="Search arXiv and output JSON.")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument(
        "--categories",
        help="Comma-separated arXiv categories (e.g., cs.AI,cs.LG)",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=DEFAULT_PAGE_SIZE,
        help="Page size (default: 50)",
    )
    parser.add_argument(
        "--total-limit",
        type=int,
        help="Total limit (default: no limit)",
    )
    parser.add_argument(
        "--year-low",
        type=int,
        default=None,
        help="Only include papers with year >= this value",
    )
    parser.add_argument(
        "--year-high",
        type=int,
        default=None,
        help="Only include papers with year <= this value",
    )
    parser.add_argument(
        "--updated-after",
        type=str,
        default=None,
        help="Only include papers with lastUpdatedDate after this ISO-8601 timestamp",
    )

    # Backward compatibility
    parser.add_argument(
        "--max-results",
        type=int,
        help="DEPRECATED: Use --page-size and --total-limit",
    )

    args = parser.parse_args()

    try:
        categories = normalize_categories(args.categories)

        page_size = args.page_size
        total_limit = args.total_limit

        if args.max_results is not None:
            if total_limit is None:
                total_limit = args.max_results
                page_size = min(page_size, total_limit)
            else:
                print(
                    "[arxiv_search] Warning: --max-results ignored when --total-limit is specified",
                    file=sys.stderr,
                )

        print(
            f"[arxiv_search] Sleeping {PAGE_SLEEP}s before paginated search...",
            file=sys.stderr,
        )
        time.sleep(PAGE_SLEEP)

        search_result = search_arxiv_full(
            query=args.query,
            categories=categories,
            page_size=page_size,
            total_limit=total_limit,
            year_low=args.year_low,
            year_high=args.year_high,
            updated_after=args.updated_after,
        )

        papers = search_result.get("papers", [])
        total_available = search_result.get("total_available")
        complete = search_result.get("complete", False)

        if total_available is not None:
            print(
                f"[arxiv_search] Total available papers for this query: {total_available}",
                file=sys.stderr,
            )
            if total_limit is None:
                print(
                    f"[arxiv_search] Will fetch all available papers in pages of {page_size}",
                    file=sys.stderr,
                )
            else:
                print(
                    f"[arxiv_search] Will fetch up to {min(total_available, total_limit)} papers in pages of {page_size}",
                    file=sys.stderr,
                )

        print(
            f"[arxiv_search] Fetched {len(papers)} papers (complete={complete}, total_available={total_available})",
            file=sys.stderr,
        )

        # If this is a full search (no total_limit) and it's incomplete, exit with error
        if total_limit is None and not complete:
            error_msg = search_result.get("error", "Unknown error")
            failed_start = search_result.get("failed_start")
            print(
                f"[arxiv_search] CRITICAL: Incomplete full search | "
                f"fetched={len(papers)} | total_available={total_available} | "
                f"failed_start={failed_start} | error={error_msg}",
                file=sys.stderr,
            )
            sys.exit(1)

        result = {
            "papers": papers,
            "query": args.query,
            "categories": categories,
            "count": len(papers),
            "total_available": total_available,
            "page_size": page_size,
            "total_limit": total_limit,
            "complete": complete,
            "failed_start": search_result.get("failed_start"),
            "error": search_result.get("error"),
            "year_low": args.year_low,
            "year_high": args.year_high,
            "updated_after": args.updated_after,
        }

        print(json.dumps(result, indent=2, ensure_ascii=False))

    except Exception as e:
        print(f"[arxiv_search] Fatal error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()