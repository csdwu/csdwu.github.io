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
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 3  # seconds
PAGE_SLEEP = 4  # seconds between pages
USER_AGENT = "embedded-ai-crawler/1.1 (compatible)"

ATOM_NAMESPACES = {
    "atom": "http://www.w3.org/2005/Atom",
    "opensearch": "http://a9.com/-/spec/opensearch/1.1/",
}


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
            "doi": "",
            "venue": "arXiv",
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
) -> List[Dict[str, Any]]:
    """
    Search arXiv with full pagination until all results are fetched or limit reached.
    """
    all_papers = []
    start_index = 0

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
            print(
                f"[arxiv_search] Failed to fetch page starting at {start_index}: {e}",
                file=sys.stderr,
            )
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

    return all_papers


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

        total_available = fetch_total_available(
            query=args.query,
            categories=categories,
            year_low=args.year_low,
            year_high=args.year_high,
            updated_after=args.updated_after,
        )

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

        papers = search_arxiv_full(
            query=args.query,
            categories=categories,
            page_size=page_size,
            total_limit=total_limit,
            year_low=args.year_low,
            year_high=args.year_high,
            updated_after=args.updated_after,
        )

        result = {
            "papers": papers,
            "query": args.query,
            "categories": categories,
            "count": len(papers),
            "total_available": total_available,
            "page_size": page_size,
            "total_limit": total_limit,
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