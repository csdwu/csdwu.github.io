#!/usr/bin/env python3
"""
arXiv API search implementation.
Queries arXiv and outputs paper data in JSON format compatible with Scholar format.
Supports full pagination with retries and throttling.
"""

import sys
import json
import urllib.request
import urllib.parse
import urllib.error
from urllib.parse import urlencode, quote
from xml.etree import ElementTree as ET
import time
from datetime import datetime
from typing import List, Dict, Any, Optional

# arXiv API endpoint
ARXIV_API_BASE = 'https://export.arxiv.org/api/query'

# Default parameters
DEFAULT_PAGE_SIZE = 50
DEFAULT_TOTAL_LIMIT = None  # No limit by default
ARXIV_REQUEST_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_BACKOFF_BASE = 3  # seconds
PAGE_SLEEP = 4  # seconds between pages
USER_AGENT = 'embedded-ai-crawler/1.0 (compatible)'


def parse_arxiv_list(elem, namespaces):
    """Parse 'list' from atom entry namespace."""
    list_elem = elem.find('atom:id', namespaces)
    if list_elem is not None and list_elem.text:
        # Extract list number from arxiv ID like "http://arxiv.org/abs/2101.01234v1"
        text = list_elem.text
        if 'arxiv.org' in text:
            # Extract the ID part after /abs/ or /pdf/
            if '/abs/' in text:
                return text.split('/abs/')[-1].split('v')[0]
            elif '/pdf/' in text:
                return text.split('/pdf/')[-1].split('v')[0]
    return ''


def parse_arxiv_entry(entry, namespaces: Dict[str, str]) -> Optional[Dict[str, Any]]:
    """
    Parse an arXiv entry (paper) from Atom XML format.
    Returns a dict compatible with Scholar format.
    """
    try:
        # Extract fields
        id_elem = entry.find('atom:id', namespaces)
        title_elem = entry.find('atom:title', namespaces)
        summary_elem = entry.find('atom:summary', namespaces)
        published_elem = entry.find('atom:published', namespaces)

        if not (id_elem is not None and title_elem is not None):
            return None

        arxiv_id = id_elem.text.strip().split('/abs/')[-1] if id_elem.text else ''
        title = title_elem.text.strip() if title_elem.text else ''

        if not arxiv_id or not title:
            return None

        abstract = summary_elem.text.strip() if summary_elem.text else ''
        published = published_elem.text if published_elem.text else ''

        # Extract year from published date (YYYY-MM-DD)
        year = None
        month = None
        if published:
            try:
                year = int(published[:4])
            except (ValueError, IndexError):
                pass
            try:
                month = int(published[5:7])
            except (ValueError, IndexError):
                month = None

        # Extract authors
        authors = []
        for author_elem in entry.findall('atom:author', namespaces):
            name_elem = author_elem.find('atom:name', namespaces)
            if name_elem is not None and name_elem.text:
                authors.append(name_elem.text.strip())

        # Extract URLs
        pdf_url = ''
        paper_url = ''
        for link_elem in entry.findall('atom:link', namespaces):
            href = link_elem.get('href', '')
            rel = link_elem.get('rel', 'alternate')
            title_attr = link_elem.get('title', '')

            if 'pdf' in title_attr.lower():
                pdf_url = href
            elif rel == 'alternate':
                paper_url = href

        # Clean up URLs
        if not paper_url and arxiv_id:
            paper_url = f'https://arxiv.org/abs/{arxiv_id}'
        if not pdf_url and arxiv_id:
            pdf_url = f'https://arxiv.org/pdf/{arxiv_id}.pdf'

        # Extract DOI if present (usually in the arxiv categories or subject)
        doi = ''
        # arXiv entries don't have DOI in standard location; skip for now

        # Build paper object compatible with Scholar format
        paper = {
            'arxiv_id': arxiv_id,
            'title': title,
            'abstract': abstract,
            'authors': authors,
            'year': year,
            'month': month,
            'urls': {
                'arxiv': paper_url,
                'pdf': pdf_url,
            },
            'arxiv_url': paper_url,
            'pdf_url': pdf_url,
            'eprint_url': pdf_url,
            'pub_url': paper_url,
            'snippet': abstract[:200] if abstract else '',
            'source': 'arxiv',  # Mark as from arXiv
            'doi': doi,
            'venue': 'arXiv',
            'cited_by': 0,  # arXiv doesn't track citations directly
        }

        return paper

    except Exception as e:
        print(f'[arxiv_search] Error parsing entry: {e}', file=sys.stderr)
        return None




def build_submitted_date_clause(year_low: Optional[int], year_high: Optional[int]) -> Optional[str]:
    if year_low is None and year_high is None:
        return None

    lower = year_low if year_low is not None else 1991
    upper = year_high if year_high is not None else datetime.utcnow().year
    return f'submittedDate:[{lower}01010000+TO+{upper}12312359]'


def paper_in_year_range(paper: Dict[str, Any], year_low: Optional[int], year_high: Optional[int]) -> bool:
    year = paper.get('year')
    if year is None:
        return True
    if year_low is not None and year < year_low:
        return False
    if year_high is not None and year > year_high:
        return False
    return True

def fetch_arxiv_total_results(
    query: str,
    categories: Optional[List[str]] = None,
) -> int:
    """
    Query arXiv once and return the total available results from
    opensearch:totalResults.
    """
    query_parts = [f'all:{query}']
    if categories:
        cat_query = ' OR '.join([f'cat:{cat}' for cat in categories])
        query_parts.append(f'({cat_query})')

    full_query = ' AND '.join(query_parts)

    post_data = {
        'search_query': full_query,
        'start': 0,
        'max_results': 1,
        'sortBy': 'lastUpdatedDate',
        'sortOrder': 'descending',
    }

    data = urlencode(post_data).encode('utf-8')

    req = urllib.request.Request(ARXIV_API_BASE, data=data, method='POST')
    req.add_header('User-Agent', USER_AGENT)
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    with urllib.request.urlopen(req, timeout=ARXIV_REQUEST_TIMEOUT) as response:
        xml_data = response.read().decode('utf-8')

    namespaces = {
        'atom': 'http://www.w3.org/2005/Atom',
        'opensearch': 'http://a9.com/-/spec/opensearch/1.1/',
    }

    root = ET.fromstring(xml_data)
    total_node = root.find('opensearch:totalResults', namespaces)
    if total_node is None or not total_node.text:
        return 0

    return int(total_node.text)

def search_arxiv_page(
    query: str,
    categories: Optional[List[str]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    start_index: int = 0,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Search arXiv for a single page and return papers.
    Uses POST request for better stability with long queries.
    """
    try:
        # Build query string
        query_parts = [f'all:{query}']

        if categories:
            # Add category filters
            cat_query = ' OR '.join([f'cat:{cat}' for cat in categories])
            query_parts.append(f'({cat_query})')

        date_clause = build_submitted_date_clause(year_low, year_high)
        if date_clause:
            query_parts.append(date_clause)

        full_query = ' AND '.join(query_parts)

        # Build POST data
        post_data = {
            'search_query': full_query,
            'start': start_index,
            'max_results': page_size,
            'sortBy': 'lastUpdatedDate',
            'sortOrder': 'descending',
        }

        data = urlencode(post_data).encode('utf-8')

        print(f'[arxiv_search] Querying page start={start_index}, size={page_size}: {full_query}', file=sys.stderr)

        # Create request with POST
        req = urllib.request.Request(ARXIV_API_BASE, data=data, method='POST')
        req.add_header('User-Agent', USER_AGENT)
        req.add_header('Content-Type', 'application/x-www-form-urlencoded')

        with urllib.request.urlopen(req, timeout=ARXIV_REQUEST_TIMEOUT) as response:
            xml_data = response.read().decode('utf-8')

        # Parse XML response
        namespaces = {
            'atom': 'http://www.w3.org/2005/Atom',
        }

        root = ET.fromstring(xml_data)
        entries = root.findall('atom:entry', namespaces)

        papers = []
        for entry in entries:
            paper = parse_arxiv_entry(entry, namespaces)
            if paper:
                papers.append(paper)

        print(f'[arxiv_search] Page {start_index}-{start_index + page_size - 1}: found {len(papers)} papers', file=sys.stderr)

        return papers

    except urllib.error.URLError as e:
        print(f'[arxiv_search] Network error: {e}', file=sys.stderr)
        raise
    except Exception as e:
        print(f'[arxiv_search] Error searching arXiv page: {e}', file=sys.stderr)
        raise


def search_arxiv_with_retry(
    query: str,
    categories: Optional[List[str]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    start_index: int = 0,
    max_retries: int = MAX_RETRIES,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Search arXiv with retry logic and exponential backoff.
    """
    last_error = None

    for attempt in range(max_retries):
        try:
            return search_arxiv_page(query, categories, page_size, start_index, year_low, year_high)
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                wait_time = RETRY_BACKOFF_BASE * (2 ** attempt)
                print(f'[arxiv_search] Attempt {attempt + 1} failed, retrying in {wait_time}s: {e}', file=sys.stderr)
                time.sleep(wait_time)
            else:
                print(f'[arxiv_search] All {max_retries} attempts failed', file=sys.stderr)

    raise last_error


def search_arxiv_full(
    query: str,
    categories: Optional[List[str]] = None,
    page_size: int = DEFAULT_PAGE_SIZE,
    total_limit: Optional[int] = DEFAULT_TOTAL_LIMIT,
    year_low: Optional[int] = None,
    year_high: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Search arXiv with full pagination until all results are fetched or limit reached.
    """
    all_papers = []
    start_index = 0

    while True:
        # Check if we've reached the total limit
        if total_limit is not None and len(all_papers) >= total_limit:
            print(f'[arxiv_search] Reached total limit of {total_limit} papers', file=sys.stderr)
            break

        # Calculate how many to fetch in this page
        remaining = total_limit - len(all_papers) if total_limit else page_size
        current_page_size = min(page_size, remaining) if total_limit else page_size

        try:
            papers = search_arxiv_with_retry(
                query,
                categories,
                current_page_size,
                start_index,
                year_low=year_low,
                year_high=year_high,
            )
        except Exception as e:
            print(f'[arxiv_search] Failed to fetch page starting at {start_index}: {e}', file=sys.stderr)
            # If a page fails completely, we stop to avoid infinite loops
            break

        papers = [paper for paper in papers if paper_in_year_range(paper, year_low, year_high)]

        if not papers:
            print(f'[arxiv_search] No more results from page {start_index}', file=sys.stderr)
            break

        all_papers.extend(papers)
        start_index += current_page_size

        # If we got fewer than requested, we've reached the end
        if len(papers) < current_page_size:
            print(f'[arxiv_search] Reached end of results', file=sys.stderr)
            break

        # Sleep between pages to avoid rate limiting
        if start_index < 10000:  # arXiv API has a 10k limit anyway
            print(f'[arxiv_search] Sleeping {PAGE_SLEEP}s before next page...', file=sys.stderr)
            time.sleep(PAGE_SLEEP)

    return all_papers


def main():
    """Command-line entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Search arXiv and output JSON.')
    parser.add_argument('--query', required=True, help='Search query')
    parser.add_argument('--categories', help='Comma-separated arXiv categories (e.g., cs.AI,cs.LG)')
    parser.add_argument('--page-size', type=int, default=DEFAULT_PAGE_SIZE, help='Page size (default: 50)')
    parser.add_argument('--total-limit', type=int, help='Total limit (default: no limit)')
    parser.add_argument('--year-low', type=int, help='Keep papers with year >= this value')
    parser.add_argument('--year-high', type=int, help='Keep papers with year <= this value')
    # Backward compatibility: if --max-results is used without --total-limit, treat as page size
    parser.add_argument('--max-results', type=int, help='DEPRECATED: Use --page-size and --total-limit')

    args = parser.parse_args()

    try:
        categories = None
        if args.categories:
            categories = [c.strip() for c in args.categories.split(',') if c.strip()]

        # Handle backward compatibility
        page_size = args.page_size
        total_limit = args.total_limit

        if args.max_results is not None:
            if total_limit is None:
                # If only --max-results provided, treat as total limit for backward compatibility
                total_limit = args.max_results
                page_size = min(page_size, total_limit)  # But don't exceed page_size
            else:
                print('[arxiv_search] Warning: --max-results ignored when --total-limit is specified', file=sys.stderr)

        papers = search_arxiv_full(
            query=args.query,
            categories=categories,
            page_size=page_size,
            total_limit=total_limit,
            year_low=args.year_low,
            year_high=args.year_high,
        )

        # Output as JSON
        result = {
            'papers': papers,
            'query': args.query,
            'categories': categories,
            'count': len(papers),
            'page_size': page_size,
            'total_limit': total_limit,
            'year_low': args.year_low,
            'year_high': args.year_high,
        }
        print(json.dumps(result, indent=2))

    except Exception as e:
        print(f'[arxiv_search] Fatal error: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
