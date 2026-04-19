#!/usr/bin/env python3
"""
arXiv API search implementation.
Queries arXiv and outputs paper data in JSON format compatible with Scholar format.
"""

import sys
import json
import urllib.request
import urllib.parse
import urllib.error
from urllib.parse import urlencode, quote
from xml.etree import ElementTree as ET
import time
from typing import List, Dict, Any, Optional

# arXiv API endpoint
ARXIV_API_BASE = 'https://export.arxiv.org/api/query'

# Default parameters
DEFAULT_MAX_RESULTS = 100
ARXIV_REQUEST_TIMEOUT = 30


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
        if published:
            try:
                year = int(published[:4])
            except (ValueError, IndexError):
                pass

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


def search_arxiv(
    query: str,
    categories: Optional[List[str]] = None,
    max_results: int = DEFAULT_MAX_RESULTS,
    start_index: int = 0,
) -> List[Dict[str, Any]]:
    """
    Search arXiv and return papers in Scholar-compatible format.

    Args:
        query: Search query string (e.g., "embedded AND machine AND learning")
        categories: List of arXiv categories to filter (e.g., ['cs.AI', 'cs.LG'])
        max_results: Maximum number of results to return
        start_index: Starting index for pagination

    Returns:
        List of paper dicts compatible with Scholar format
    """
    try:
        # Build query string
        query_parts = [f'all:{query}']

        if categories:
            # Add category filters
            cat_query = ' OR '.join([f'cat:{cat}' for cat in categories])
            query_parts.append(f'({cat_query})')

        full_query = ' AND '.join(query_parts)

        # Build URL parameters
        params = {
            'search_query': full_query,
            'start': start_index,
            'max_results': max_results,
            'sortBy': 'lastUpdatedDate',
            'sortOrder': 'descending',
        }

        url = f'{ARXIV_API_BASE}?{urlencode(params)}'

        print(f'[arxiv_search] Querying: {url}', file=sys.stderr)

        # Make request
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'embedded-ai-crawler (compatible)')

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

        print(
            f'[arxiv_search] Found {len(papers)} papers for query: {query}',
            file=sys.stderr,
        )

        return papers

    except urllib.error.URLError as e:
        print(f'[arxiv_search] Network error: {e}', file=sys.stderr)
        raise
    except Exception as e:
        print(f'[arxiv_search] Error searching arXiv: {e}', file=sys.stderr)
        raise


def main():
    """Command-line entry point."""
    import argparse

    parser = argparse.ArgumentParser(description='Search arXiv and output JSON.')
    parser.add_argument('--query', required=True, help='Search query')
    parser.add_argument('--categories', help='Comma-separated arXiv categories (e.g., cs.AI,cs.LG)')
    parser.add_argument('--max-results', type=int, default=DEFAULT_MAX_RESULTS, help='Max results')
    parser.add_argument('--start-index', type=int, default=0, help='Start index for pagination')

    args = parser.parse_args()

    try:
        categories = None
        if args.categories:
            categories = [c.strip() for c in args.categories.split(',') if c.strip()]

        papers = search_arxiv(
            query=args.query,
            categories=categories,
            max_results=args.max_results,
            start_index=args.start_index,
        )

        # Output as JSON
        result = {
            'papers': papers,
            'query': args.query,
            'categories': categories,
            'count': len(papers),
        }
        print(json.dumps(result, indent=2))

    except Exception as e:
        print(f'[arxiv_search] Fatal error: {e}', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
