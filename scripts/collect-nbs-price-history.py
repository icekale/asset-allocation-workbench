#!/usr/bin/env python3
"""Collect auditable monthly prices from original National Bureau of Statistics pages.

The NBS site search only locates articles; all values are read from stats.gov.cn
titles/bodies. Missing or ambiguous observations remain missing.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from pathlib import Path


SEARCH_URL = "https://api.so-gov.cn/query/s"
ARTICLE_HOST = "www.stats.gov.cn"
TITLE_PATTERN = re.compile(r"(?P<year>20\d{2})年(?P<month>\d{1,2})月(?:份)?")
NUMBER_PATTERN = r"([0-9]+(?:\.[0-9]+)?)"


class TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style"}:
            self.skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style"} and self.skip:
            self.skip -= 1

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def get(url: str, data: bytes | None = None) -> str:
    if data is None and urllib.parse.urlparse(url).hostname == ARTICLE_HOST:
        for attempt in range(3):
            try:
                body = subprocess.check_output(["curl", "-L", "--max-time", "60", "-sS", url]).decode("utf-8", errors="replace")
                if "Please enable JavaScript and refresh the page" not in body:
                    return body
            except subprocess.CalledProcessError:
                pass
            time.sleep(0.7 * (attempt + 1))
        raise RuntimeError("NBS original page temporarily unavailable")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": "Mozilla/5.0 (compatible; macro-source-audit/1.0)"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        encoding = response.headers.get_content_charset() or "utf-8"
    return raw.decode(encoding, errors="replace")


def find_articles(query: str) -> list[dict[str, str]]:
    data = urllib.parse.urlencode(
        {"siteCode": "bm36000002", "qt": query, "keyPlace": "1", "page": "1", "pageSize": "100"}
    ).encode()
    payload = json.loads(get(SEARCH_URL, data))
    return [item["data"] for item in payload.get("resultDocs", [])]


def valid_article_url(url: str) -> bool:
    parsed = urllib.parse.urlparse(url)
    return parsed.hostname == ARTICLE_HOST and parsed.scheme in {"http", "https"}


def parse_title_value(title: str, family: str) -> float | None:
    if family == "cpi" and "居民消费价格同比" not in title:
        return None
    if family == "ppi" and not (
        "工业生产者出厂价格同比" in title or "工业品出厂价格同比" in title
    ):
        return None
    if "同比持平" in title:
        return 0.0
    match = re.search(r"同比(?:上涨|上升|增长|下降)\s*" + NUMBER_PATTERN + "%", title)
    if not match:
        return None
    value = float(match.group(1))
    return -value if "下降" in title[match.start() : match.end()] else value


def clean_text(source: str) -> str:
    parser = TextParser()
    parser.feed(source)
    return re.sub(r"\s+", " ", html.unescape(" ".join(parser.parts)))


def fetch_core(entry: dict[str, str]) -> tuple[str, float | None, str, str]:
    url = entry["url"].replace("http://", "https://")
    title = entry.get("titleO") or entry.get("title") or ""
    match = TITLE_PATTERN.search(title)
    if not match or not valid_article_url(url):
        return "", None, url, "title-or-domain"
    period = f"{match.group('year')}-{int(match.group('month')):02d}"
    try:
        body = clean_text(get(url))
    except Exception as exc:  # keep a visible source gap
        return period, None, url, type(exc).__name__
    # Match only the official definition, not a food/non-food sub-index.
    patterns = [
        r"扣除食品和能源(?:价格)?(?:后)?的?核心\s*CPI.{0,70}?同比(上涨|上升|增长|下降|持平)",
        r"核心\s*CPI.{0,60}?同比(上涨|上升|增长|下降|持平)",
    ]
    for pattern in patterns:
        match = re.search(pattern, body)
        if not match:
            continue
        direction = match.group(1)
        if direction == "持平":
            return period, 0.0, url, "official-article"
        amount = re.match(r"\s*" + NUMBER_PATTERN + r"\s*%", body[match.end() :])
        if amount:
            value = float(amount.group(1))
            return period, -value if direction == "下降" else value, url, "official-article"
    return period, None, url, "core-not-found"


def parse_article_value(body: str, family: str) -> float | None:
    if family == "cpi":
        start = r"(?:全国)?居民消费价格(?:指数)?"
    elif family == "ppi":
        start = r"(?:全国)?工业(?:生产者|品)出厂价格(?:指数)?"
    else:
        start = r"扣除食品和能源(?:价格)?(?:后)?的?核心\s*CPI|核心\s*CPI"
    forms = [
        re.compile(r"(?:" + start + r")[^。；]{0,100}?同比\s*(上涨|上升|增长|下降)\s*" + NUMBER_PATTERN + r"\s*%"),
        re.compile(r"(?:" + start + r")[^。；]{0,100}?比(?:上年同月|去年同月)\s*(上涨|上升|增长|下降)\s*" + NUMBER_PATTERN + r"\s*%"),
    ]
    for form in forms:
        match = form.search(body)
        if not match:
            continue
        value = float(match.group(2))
        return -value if match.group(1) == "下降" else value
    if re.search(r"(?:" + start + r")[^。；]{0,100}?(?:同比|比上年同月)\s*持平", body):
        return 0.0
    return None


def fetch_monthly(entry: dict[str, str], family: str) -> tuple[str, float | None, str, str]:
    url = entry["url"].replace("http://", "https://")
    title = entry.get("titleO") or entry.get("title") or ""
    match = TITLE_PATTERN.search(title)
    if not match or not valid_article_url(url):
        return "", None, url, "title-or-domain"
    period = f"{match.group('year')}-{int(match.group('month')):02d}"
    try:
        body = clean_text(get(url))
    except Exception as exc:
        return period, None, url, type(exc).__name__
    # Avoid matches from navigation, related links and later years.
    body = body[body.find(title) + len(title) :] if title in body else body
    value = parse_article_value(body[:6000], family)
    return period, value, url, "official-article" if value is not None else "value-not-found"


def collect(start_year: int, end_year: int) -> dict:
    rows: dict[str, dict] = {}
    all_core: list[dict[str, str]] = []
    all_monthly: list[tuple[dict[str, str], str]] = []
    for year in range(start_year, end_year + 1):
        for family, queries in (
            ("cpi", [f"{year}年居民消费价格同比", f"{year}年居民消费价格变动情况"]),
            ("ppi", [f"{year}年工业生产者出厂价格同比", f"{year}年工业生产者价格变动情况"]),
        ):
            articles = [entry for query in queries for entry in find_articles(query)]
            for entry in articles:
                title = entry.get("titleO") or entry.get("title") or ""
                match = TITLE_PATTERN.search(title)
                url = entry.get("url", "")
                if not match or int(match.group("year")) != year or not valid_article_url(url):
                    continue
                value = parse_title_value(title, family)
                period = f"{year}-{int(match.group('month')):02d}"
                row = rows.setdefault(period, {"period": period})
                if value is not None and family not in row:
                    row[family] = value
                    row[f"{family}Url"] = url.replace("http://", "https://")
                elif value is None:
                    all_monthly.append((entry, family))
            print(year, family, sum(family in row for period, row in rows.items() if period.startswith(f"{year}-")), flush=True)
        if year >= 2020:
            for entry in find_articles(f"{year}年CPI和PPI数据解读"):
                title = entry.get("titleO") or entry.get("title") or ""
                match = TITLE_PATTERN.search(title)
                if match and int(match.group("year")) == year and valid_article_url(entry.get("url", "")):
                    all_core.append(entry)
            print(year, "core-articles", sum((entry.get("titleO") or "").find(str(year)) >= 0 for entry in all_core), flush=True)
        time.sleep(0.15)

    # Core CPI is usually reported in the original NBS interpretation.
    with ThreadPoolExecutor(max_workers=3) as executor:
        for future in as_completed(executor.submit(fetch_core, entry) for entry in all_core):
            period, value, url, status = future.result()
            if not period:
                continue
            row = rows.setdefault(period, {"period": period})
            if value is not None and "coreCpi" not in row:
                row["coreCpi"] = value
                row["coreCpiUrl"] = url
            elif value is None:
                row.setdefault("auditNotes", []).append({"source": url, "status": status})

    missing = {
        (period, family)
        for period, row in rows.items()
        for family in ("cpi", "ppi", "coreCpi")
        if family not in row
    }
    candidates = []
    for entry, family in all_monthly:
        title = entry.get("titleO") or entry.get("title") or ""
        match = TITLE_PATTERN.search(title)
        period = f"{match.group('year')}-{int(match.group('month')):02d}"
        if (period, family) in missing or (period, "coreCpi") in missing and family == "cpi":
            candidates.append((entry, family))
    print("monthly-fallback-articles", len(candidates), flush=True)
    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [executor.submit(fetch_monthly, entry, family) for entry, family in candidates]
        for future, (_, family) in zip(futures, candidates):
            period, value, url, status = future.result()
            if not period:
                continue
            row = rows.setdefault(period, {"period": period})
            if value is not None and family not in row:
                row[family] = value
                row[f"{family}Url"] = url
            elif value is None:
                row.setdefault("auditNotes", []).append({"source": url, "status": status})

    # The original CPI release can supply a missing core-CPI observation.
    core_candidates = [
        entry for entry, family in all_monthly
        if family == "cpi" and (lambda m: m and int(m.group('year')) >= 2020 and "coreCpi" not in rows.get(f"{m.group('year')}-{int(m.group('month')):02d}", {}))(TITLE_PATTERN.search(entry.get("titleO") or ""))
    ]
    with ThreadPoolExecutor(max_workers=3) as executor:
        for future in as_completed(executor.submit(fetch_core, entry) for entry in core_candidates):
            period, value, url, status = future.result()
            if period and value is not None and "coreCpi" not in rows[period]:
                rows[period]["coreCpi"] = value
                rows[period]["coreCpiUrl"] = url

    ordered_rows = [rows[period] for period in sorted(rows)]
    latest_core = next((row["period"] for row in reversed(ordered_rows) if row.get("coreCpi") is not None), None)
    return {
        "description": "国家统计局原始月度发布及CPI/PPI解读，当月同比，单位%；缺失不插值",
        "sourcePriority": "official-original-release",
        "latestPeriod": ordered_rows[-1]["period"] if ordered_rows else None,
        "latestCorePeriod": latest_core,
        "rows": ordered_rows,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-year", type=int, default=2020)
    parser.add_argument("--end-year", type=int, default=2026)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = collect(args.start_year, args.end_year)
    # 定时抓取会整体重写该文件：先继承旧文件中本脚本不产出的说明字段
    # （basis、seriesNotes 等），避免覆盖时丢掉口径与来源注释。
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text())
        except (json.JSONDecodeError, OSError):
            previous = None
        if isinstance(previous, dict):
            result = {**previous, **result}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print("saved", args.output, "rows", len(result["rows"]))


if __name__ == "__main__":
    main()
