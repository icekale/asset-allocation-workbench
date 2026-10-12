#!/usr/bin/env python3
"""Derive quarterly GDP deflator YoY from two original NBS quarterly tables.

2001-2011 uses the 2015 quarterly GDP revision table; 2012 onward uses the
current NBS SDDS table. The output marks a vintage break at 2011/2012.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
from pathlib import Path

import pandas as pd


HISTORICAL_URL = "https://www.stats.gov.cn/sj/zxfb/202302/t20230203_1898897.html"
CURRENT_URL = "https://www.stats.gov.cn/english/Statisticaldata/nsdp/201508/t20150831_1238096.html"
# Transcribed from the NBS 2015-09-09 quarterly revision table. Each row is
# year, four current-price amounts (100 million yuan), four real YoY indices (%).
HISTORICAL_TABLE = """
2000 21215 24129 25492 28940 8.6 9.0 8.8 7.5
2001 23950 26796 28086 31438 9.4 8.5 8.0 7.6
2002 26133 29246 30971 34652 8.8 8.7 9.6 9.1
2003 29631 32563 34968 39402 11.0 9.1 10.0 10.0
2004 34291 38713 41436 46275 10.5 11.5 9.8 8.8
2005 40131 44748 47550 53466 11.0 11.0 10.8 12.4
2006 46678 52560 55468 62950 12.5 13.6 12.2 12.5
2007 56687 64649 68790 77894 13.8 14.9 14.2 13.9
2008 68778 78538 81619 87816 11.5 10.9 9.6 7.1
2009 73284 83614 88923 99808 6.2 8.0 10.4 11.7
2010 86684 99060 104951 118208 12.2 10.7 9.9 10.0
2011 103457 118465 125279 136922 10.2 9.9 9.4 8.7
"""


def read_tables(url: str, snapshot: Path | None = None) -> list[pd.DataFrame]:
    body = snapshot.read_text() if snapshot else subprocess.check_output(["curl", "-L", "--max-time", "30", "-sS", url]).decode("utf-8", errors="replace")
    return pd.read_html(io.StringIO(body), flavor="lxml")


def historical() -> dict[str, dict]:
    nominal: dict[str, float] = {}
    real: dict[str, float] = {}
    for line in HISTORICAL_TABLE.strip().splitlines():
        parts = line.split()
        year = int(parts[0])
        for quarter in range(1, 5):
            period = f"{year}-Q{quarter}"
            nominal[period] = float(parts[quarter])
            real[period] = float(parts[quarter + 4]) + 100
    output = {}
    for year in range(2001, 2012):
        for quarter in range(1, 5):
            period = f"{year}-Q{quarter}"
            prior = f"{year - 1}-Q{quarter}"
            if period not in nominal or prior not in nominal or period not in real:
                continue
            value = ((nominal[period] / nominal[prior]) / (real[period] / 100) - 1) * 100
            output[period] = {
                "period": period,
                "value": round(value, 2),
                "nominalGdp": nominal[period],
                "priorYearNominalGdp": nominal[prior],
                "realGdpIndex": real[period],
                "sourceUrl": HISTORICAL_URL,
                "vintage": "2015-quarterly-revision",
            }
    return output


def current(snapshot: Path | None = None) -> dict[str, dict]:
    tables = read_tables(CURRENT_URL, snapshot)
    nominal: dict[str, float] = {}
    real: dict[str, float] = {}
    for frame, destination in ((tables[5], nominal), (tables[6], real)):
        for _, row in frame.iloc[3:].iterrows():
            match = re.fullmatch(r"Q([1-4])/([0-9]{2})", str(row.iloc[0]).strip())
            if not match:
                continue
            year = 2000 + int(match.group(2))
            period = f"{year}-Q{match.group(1)}"
            value = pd.to_numeric(row.iloc[1], errors="coerce")
            if pd.notna(value):
                destination[period] = float(value)
    output = {}
    for year in range(2012, 2027):
        for quarter in range(1, 5):
            period = f"{year}-Q{quarter}"
            prior = f"{year - 1}-Q{quarter}"
            if period not in nominal or prior not in nominal or period not in real:
                continue
            value = ((nominal[period] / nominal[prior]) / (real[period] / 100) - 1) * 100
            output[period] = {
                "period": period,
                "value": round(value, 2),
                "nominalGdp": nominal[period],
                "priorYearNominalGdp": nominal[prior],
                "realGdpIndex": real[period],
                "sourceUrl": CURRENT_URL,
                "vintage": "2026-09-15-SDDS",
            }
    return output


def previous_latest_period(path: Path) -> str | None:
    """现有文件的最后一条期间；官方发布有延迟，用它做"不许倒退"的守卫。"""
    try:
        rows = json.loads(path.read_text())["rows"]
    except (OSError, KeyError, ValueError):
        return None
    return rows[-1]["period"] if rows else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sdds-file", type=Path, help="Use an already downloaded official SDDS HTML snapshot")
    args = parser.parse_args()
    historical_rows = historical()
    current_rows = current(args.sdds_file)
    rows = [*historical_rows.values(), *current_rows.values()]
    rows.sort(key=lambda row: row["period"])
    # 定时抓取会随官方发布推进：首期固定、长度不减，末期只要求不早于现有文件
    # （季度数据发布时间本身有延迟，硬编码季度会误报失败）。
    assert rows[0]["period"] == "2001-Q1", f"序列起始期异常：{rows[0]['period']}"
    assert len(rows) >= 102, f"序列长度异常：{len(rows)}"
    existing_latest = previous_latest_period(args.output)
    assert existing_latest is None or rows[-1]["period"] >= existing_latest, (
        f"新序列末期 {rows[-1]['period']} 早于现有文件 {existing_latest}"
    )
    result = {
        "metric": "GDP 平减指数",
        "basis": "单季同比，按同版现价GDP单季值和实际GDP单季同比指数计算",
        "unit": "%",
        "formula": "((本季现价GDP / 上年同季现价GDP) / (本季实际GDP同比指数/100) - 1) × 100",
        "vintageBreakAfter": "2011-Q4",
        "vintageNote": "2001—2011采用2015年季度修订表；2012年以来采用2026-09-15更新的国家统计局SDDS同版现价与实际序列；两段不跨版计算，图上标注断点。",
        "rows": rows,
    }
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print("saved", args.output, "rows", len(rows), "first", rows[0], "last", rows[-1])


if __name__ == "__main__":
    main()
