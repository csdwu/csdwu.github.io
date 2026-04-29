from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen


USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

DEFAULT_TIMEOUT = 30
MAX_BYTES = 100 * 1024 * 1024  # 100 MB


@dataclass
class DownloadCandidate:
    source: str
    url: str


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path, default: Any) -> Any:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        return default


def write_json(path: Path, value: Any) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as f:
        json.dump(value, f, ensure_ascii=False, indent=2)


def normalize_text(value: Any) -> str:
    text = str(value or "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[’'`]+", "", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def slugify(value: Any, max_len: int = 100) -> str:
    text = normalize_text(value)
    text = text.replace(" ", "-")
    text = re.sub(r"-+", "-", text).strip("-")
    if not text:
        text = "paper"
    return text[:max_len].strip("-") or "paper"


def safe_int(value: Any) -> Optional[int]:
    if value is None:
        return None
    match = re.search(r"(19|20)\d{2}", str(value))
    return int(match.group(0)) if match else None


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def extract_papers(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        return [x for x in payload if isinstance(x, dict)]

    if not isinstance(payload, dict):
        return []

    if isinstance(payload.get("items"), list):
        return [x for x in payload["items"] if isinstance(x, dict)]

    if isinstance(payload.get("papers"), list):
        return [x for x in payload["papers"] if isinstance(x, dict)]

    categories = payload.get("categories")
    if isinstance(categories, list):
        result: List[Dict[str, Any]] = []
        for category in categories:
            if not isinstance(category, dict):
                continue
            papers = category.get("papers")
            if isinstance(papers, list):
                result.extend([x for x in papers if isinstance(x, dict)])
        return result

    return []


def make_paper_id(paper: Dict[str, Any]) -> str:
    given = str(paper.get("id") or "").strip()
    if given:
        return given

    title = str(paper.get("title") or "").strip()
    year = safe_int(paper.get("year")) or "na"
    pub_url = (
        str(paper.get("pub_url") or "")
        or str((paper.get("urls") or {}).get("paper") or "")
        or str((paper.get("urls") or {}).get("scholar") or "")
    )
    payload = f"{normalize_text(title)}||{year}||{pub_url}"
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()


def parse_content_disposition_filename(value: str) -> Optional[str]:
    if not value:
        return None

    # filename*=UTF-8''name.pdf
    match = re.search(r"filename\*\s*=\s*[^']*''([^;]+)", value, flags=re.I)
    if match:
        return unquote(match.group(1)).strip().strip('"').strip("'")

    # filename="name.pdf"
    match = re.search(r'filename\s*=\s*"([^"]+)"', value, flags=re.I)
    if match:
        return match.group(1).strip()

    match = re.search(r"filename\s*=\s*([^;]+)", value, flags=re.I)
    if match:
        return match.group(1).strip().strip('"').strip("'")

    return None


def is_probably_pdf_headers(headers: Any, url: str) -> bool:
    content_type = str(headers.get("Content-Type") or "").lower()
    if "application/pdf" in content_type:
        return True

    if url.lower().endswith(".pdf"):
        return True

    disposition = str(headers.get("Content-Disposition") or "")
    filename = parse_content_disposition_filename(disposition)
    if filename and filename.lower().endswith(".pdf"):
        return True

    return False


def is_arxiv_url(url: str) -> bool:
    try:
        hostname = (urlparse(url).hostname or "").lower()
    except Exception:
        return False
    return hostname in {"arxiv.org", "www.arxiv.org", "export.arxiv.org"}


def extract_arxiv_id(text: str) -> Optional[str]:
    if not text:
        return None

    patterns = [
        r"arxiv\.org/(?:abs|pdf)/([a-z\-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?",
        r"\barxiv:\s*([a-z\-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b",
        r"\b([a-z\-]+/\d{7}|\d{4}\.\d{4,5})(?:v\d+)?\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I)
        if match:
            return match.group(1)
    return None


def build_arxiv_pdf_url(identifier: str) -> str:
    return f"https://arxiv.org/pdf/{identifier}.pdf"


def collect_candidate_urls(paper: Dict[str, Any]) -> List[DownloadCandidate]:
    candidates: List[DownloadCandidate] = []

    def add(source: str, url: Any) -> None:
        url_s = str(url or "").strip()
        if not url_s:
            return
        candidates.append(DownloadCandidate(source=source, url=url_s))

    urls = paper.get("urls") or {}

    # Explicit arXiv id/url first.
    arxiv_id = (
        paper.get("arxiv_id")
        or extract_arxiv_id(str(urls.get("arxiv") or ""))
        or extract_arxiv_id(str(paper.get("eprint_url") or ""))
        or extract_arxiv_id(str(paper.get("pub_url") or ""))
        or extract_arxiv_id(str(paper.get("title") or ""))
        or extract_arxiv_id(str(paper.get("abstract") or ""))
    )
    if arxiv_id:
        add("arxiv", build_arxiv_pdf_url(str(arxiv_id)))

    add("pdf_url", urls.get("pdf"))
    add("pdf_url", paper.get("pdf_url"))
    add("eprint_url", paper.get("eprint_url"))

    pub_url = str(paper.get("pub_url") or urls.get("paper") or "").strip()
    if pub_url.lower().endswith(".pdf"):
        add("publisher_pdf", pub_url)
    elif is_arxiv_url(pub_url):
        maybe_id = extract_arxiv_id(pub_url)
        if maybe_id:
            add("arxiv", build_arxiv_pdf_url(maybe_id))
    elif pub_url:
        add("doi_landing", pub_url)

    scholar_url = str(paper.get("scholar_url") or urls.get("scholar") or "").strip()
    if scholar_url.lower().endswith(".pdf"):
        add("pdf_url", scholar_url)

    # De-duplicate while preserving order.
    seen = set()
    unique: List[DownloadCandidate] = []
    for c in candidates:
        key = (c.source, c.url)
        if key in seen:
            continue
        seen.add(key)
        unique.append(c)

    return unique


def pick_file_stem(paper: Dict[str, Any], paper_id: str) -> str:
    year = safe_int(paper.get("year"))
    title = str(paper.get("title") or "").strip()
    title_slug = slugify(title, max_len=90)
    if year:
        return f"{year}-{title_slug}-{paper_id[:8]}"
    return f"{title_slug}-{paper_id[:8]}"


def probe_url(url: str, timeout: int = DEFAULT_TIMEOUT) -> Tuple[bool, Optional[Dict[str, str]], str]:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
        },
        method="GET",
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            final_url = response.geturl()
            headers = {k: v for k, v in response.headers.items()}
            head = response.read(8)
            ok = is_probably_pdf_headers(headers, final_url) or head.startswith(b"%PDF-")
            return ok, headers, final_url
    except (HTTPError, URLError, TimeoutError, OSError):
        return False, None, url


def download_pdf(url: str, dest_path: Path, timeout: int = DEFAULT_TIMEOUT) -> Dict[str, Any]:
    ensure_dir(dest_path.parent)

    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.8",
        },
        method="GET",
    )

    tmp_fd, tmp_name = tempfile.mkstemp(prefix="paper-", suffix=".part", dir=str(dest_path.parent))
    os.close(tmp_fd)
    tmp_path = Path(tmp_name)

    total_bytes = 0
    final_url = url
    headers_dict: Dict[str, str] = {}

    try:
        with urlopen(request, timeout=timeout) as response, tmp_path.open("wb") as out:
            final_url = response.geturl()
            headers_dict = {k: v for k, v in response.headers.items()}
            first_chunk = response.read(8192)
            if not first_chunk:
                raise RuntimeError("Empty response")

            total_bytes += len(first_chunk)
            if not (is_probably_pdf_headers(headers_dict, final_url) or first_chunk.startswith(b"%PDF-")):
                raise RuntimeError("Response is not a PDF")

            out.write(first_chunk)

            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total_bytes += len(chunk)
                if total_bytes > MAX_BYTES:
                    raise RuntimeError(f"File too large: exceeded {MAX_BYTES} bytes")
                out.write(chunk)

        shutil.move(str(tmp_path), str(dest_path))
        return {
            "ok": True,
            "final_url": final_url,
            "headers": headers_dict,
            "bytes": total_bytes,
        }
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def ensure_quota_shape(quota: Dict[str, Any], daily_limit: int) -> Dict[str, Any]:
    today = today_iso()
    date = str(quota.get("date") or "")
    downloaded_today = int(quota.get("downloaded_today") or 0)

    if date != today:
        downloaded_today = 0
        date = today

    remaining = max(0, int(daily_limit) - downloaded_today)

    return {
        "date": date,
        "daily_limit": int(daily_limit),
        "downloaded_today": downloaded_today,
        "remaining": remaining,
    }


def load_state(path: Path) -> Dict[str, Any]:
    state = read_json(path, {"papers": {}})
    if not isinstance(state, dict):
        state = {"papers": {}}
    papers = state.get("papers")
    if not isinstance(papers, dict):
        state["papers"] = {}
    return state


def load_quota(path: Path, daily_limit: int) -> Dict[str, Any]:
    quota = read_json(path, {})
    if not isinstance(quota, dict):
        quota = {}
    return ensure_quota_shape(quota, daily_limit)


def update_quota_after_download(quota: Dict[str, Any]) -> Dict[str, Any]:
    quota = ensure_quota_shape(quota, int(quota["daily_limit"]))
    quota["downloaded_today"] += 1
    quota["remaining"] = max(0, quota["daily_limit"] - quota["downloaded_today"])
    return quota


def flatten_input(input_path: Path) -> List[Dict[str, Any]]:
    payload = read_json(input_path, [])
    return extract_papers(payload)


def choose_downloadable_candidate(paper: Dict[str, Any]) -> Tuple[Optional[DownloadCandidate], List[Dict[str, Any]]]:
    audit: List[Dict[str, Any]] = []

    for candidate in collect_candidate_urls(paper):
        ok, headers, final_url = probe_url(candidate.url)
        audit.append(
            {
                "source": candidate.source,
                "requested_url": candidate.url,
                "final_url": final_url,
                "probe_ok": ok,
                "content_type": str((headers or {}).get("Content-Type") or ""),
            }
        )
        if ok:
            return DownloadCandidate(source=candidate.source, url=final_url), audit

    return None, audit


def save_state_and_quota(state_path: Path, quota_path: Path, state: Dict[str, Any], quota: Dict[str, Any]) -> None:
    write_json(state_path, state)
    write_json(quota_path, quota)


def process_downloads(
    papers: List[Dict[str, Any]],
    output_dir: Path,
    state_path: Path,
    quota_path: Path,
    daily_limit: int,
    max_downloads: Optional[int],
    dry_run: bool,
) -> Dict[str, Any]:
    ensure_dir(output_dir)
    ensure_dir(state_path.parent)
    ensure_dir(quota_path.parent)

    state = load_state(state_path)
    quota = load_quota(quota_path, daily_limit)

    results: List[Dict[str, Any]] = []
    downloaded_count = 0
    skipped_count = 0
    already_downloaded_count = 0
    quota_blocked_count = 0
    failed_count = 0

    for paper in papers:
        paper_id = make_paper_id(paper)
        title = str(paper.get("title") or "").strip()
        year = safe_int(paper.get("year"))
        existing = state["papers"].get(paper_id)

        if existing and existing.get("status") == "downloaded":
            result = {
                "paper_id": paper_id,
                "title": title,
                "status": "already_downloaded",
                "path": existing.get("path"),
                "source": existing.get("source"),
            }
            results.append(result)
            already_downloaded_count += 1
            continue

        quota = ensure_quota_shape(quota, daily_limit)
        if quota["remaining"] <= 0 or (max_downloads is not None and downloaded_count >= max_downloads):
            state["papers"][paper_id] = {
                "title": title,
                "year": year,
                "status": "quota_limited",
                "downloaded": False,
                "source": None,
                "path": None,
                "last_attempt_at": now_iso(),
                "attempt_count": int((existing or {}).get("attempt_count") or 0) + 1,
                "skip_reason": "daily_limit_reached",
            }
            results.append(
                {
                    "paper_id": paper_id,
                    "title": title,
                    "status": "quota_limited",
                    "reason": "daily_limit_reached",
                }
            )
            quota_blocked_count += 1
            continue

        candidate, audit = choose_downloadable_candidate(paper)
        if not candidate:
            state["papers"][paper_id] = {
                "title": title,
                "year": year,
                "status": "skipped",
                "downloaded": False,
                "source": None,
                "path": None,
                "last_attempt_at": now_iso(),
                "attempt_count": int((existing or {}).get("attempt_count") or 0) + 1,
                "skip_reason": "no_direct_pdf_found",
                "candidate_audit": audit,
            }
            results.append(
                {
                    "paper_id": paper_id,
                    "title": title,
                    "status": "skipped",
                    "reason": "no_direct_pdf_found",
                }
            )
            skipped_count += 1
            continue

        stem = pick_file_stem(paper, paper_id)
        dest_path = output_dir / f"{stem}.pdf"

        if dry_run:
            state["papers"][paper_id] = {
                "title": title,
                "year": year,
                "status": "dry_run",
                "downloaded": False,
                "source": candidate.source,
                "path": str(dest_path),
                "last_attempt_at": now_iso(),
                "attempt_count": int((existing or {}).get("attempt_count") or 0) + 1,
                "candidate_audit": audit,
            }
            results.append(
                {
                    "paper_id": paper_id,
                    "title": title,
                    "status": "dry_run",
                    "source": candidate.source,
                    "url": candidate.url,
                    "path": str(dest_path),
                }
            )
            continue

        try:
            info = download_pdf(candidate.url, dest_path)
            file_hash = sha256_file(dest_path)
            quota = update_quota_after_download(quota)

            state["papers"][paper_id] = {
                "title": title,
                "year": year,
                "downloaded": True,
                "status": "downloaded",
                "source": candidate.source,
                "path": str(dest_path),
                "final_url": info["final_url"],
                "sha256": file_hash,
                "bytes": info["bytes"],
                "last_attempt_at": now_iso(),
                "attempt_count": int((existing or {}).get("attempt_count") or 0) + 1,
                "candidate_audit": audit,
            }
            results.append(
                {
                    "paper_id": paper_id,
                    "title": title,
                    "status": "downloaded",
                    "source": candidate.source,
                    "path": str(dest_path),
                    "bytes": info["bytes"],
                }
            )
            downloaded_count += 1
        except Exception as exc:  # noqa: BLE001
            state["papers"][paper_id] = {
                "title": title,
                "year": year,
                "downloaded": False,
                "status": "failed",
                "source": candidate.source,
                "path": str(dest_path),
                "last_attempt_at": now_iso(),
                "attempt_count": int((existing or {}).get("attempt_count") or 0) + 1,
                "error": str(exc),
                "candidate_audit": audit,
            }
            results.append(
                {
                    "paper_id": paper_id,
                    "title": title,
                    "status": "failed",
                    "source": candidate.source,
                    "error": str(exc),
                }
            )
            failed_count += 1

    save_state_and_quota(state_path, quota_path, state, quota)

    return {
        "ok": True,
        "generated_at": now_iso(),
        "input_count": len(papers),
        "downloaded_count": downloaded_count,
        "already_downloaded_count": already_downloaded_count,
        "skipped_count": skipped_count,
        "quota_blocked_count": quota_blocked_count,
        "failed_count": failed_count,
        "state_path": str(state_path),
        "quota_path": str(quota_path),
        "output_dir": str(output_dir),
        "quota": quota,
        "results": results,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Download manager for embedded AI papers.")
    parser.add_argument("--input", required=True, help="Path to normalized paper JSON or output JSON.")
    parser.add_argument("--output-dir", required=True, help="Directory to save PDFs.")
    parser.add_argument("--state", required=True, help="Path to download_state.json.")
    parser.add_argument("--quota", required=True, help="Path to download_quota.json.")
    parser.add_argument("--daily-limit", type=int, required=True, help="Daily download limit.")
    parser.add_argument("--max-downloads", type=int, default=None, help="Optional per-run max downloads.")
    parser.add_argument("--dry-run", action="store_true", help="Do not actually download files.")
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    input_path = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()
    state_path = Path(args.state).resolve()
    quota_path = Path(args.quota).resolve()

    papers = flatten_input(input_path)
    result = process_downloads(
        papers=papers,
        output_dir=output_dir,
        state_path=state_path,
        quota_path=quota_path,
        daily_limit=args.daily_limit,
        max_downloads=args.max_downloads,
        dry_run=args.dry_run,
    )
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())