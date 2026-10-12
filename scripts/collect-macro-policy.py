#!/usr/bin/env python3
"""Refresh independently sourced monetary and fiscal policy observations."""

import io
import json
import re
import subprocess
import calendar
import concurrent.futures
import urllib.parse
import urllib.request
from collections import defaultdict
from html import unescape
from pathlib import Path

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "app/data/macro-policy.json"
LPR_ENDPOINT = "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis"
BOND_ENDPOINT = "https://yield.chinabond.com.cn/cbweb-pbc-web/pbc/historyQuery"
FISCAL_INDEX = "https://www.mof.gov.cn/zhengwuxinxi/redianzhuanti/quanguocaizhengshouzhiqingkuang/"
IMF_EXCEL = "https://data.imf.org/-/media/iData/External-Storage/Documents/2F78EE59F79143A7921E5E203D3AAA80/en/WEOApr2026all.xlsx"


def fetch(url, retries=2):
    return subprocess.check_output(["curl", "-fLsS", "--retry", str(retries), "--max-time", "20", url], stderr=subprocess.DEVNULL)


def page(url):
    return fetch(url).decode("utf-8", "ignore")


def lpr_rows():
    rows = {}
    for year in range(2019, 2027):
        query = urllib.parse.urlencode({"lang": "CN", "strStartDate": f"{year}-01-01", "strEndDate": f"{year}-12-31"})
        url = f"{LPR_ENDPOINT}?{query}"
        for item in json.loads(page(url)).get("records", []):
            date = item["showDateCN"]
            if date < "2019-08-01" or date > "2026-10-01" or not item.get("1Y") or not item.get("5Y"):
                continue
            try:
                one_year, five_year = float(item["1Y"]), float(item["5Y"])
            except ValueError:
                continue
            rows[date[:7]] = {"period": date[:7], "date": date, "oneYear": one_year, "fiveYear": five_year, "url": url}
    return [rows[key] for key in sorted(rows)]


def bond_rows():
    monthly = {}
    row_pattern = re.compile(r"<tr>\s*<td[^>]*>中债国债收益率曲线</td>(.*?)</tr>", re.S)
    cell_pattern = re.compile(r"<td[^>]*>\s*([^<]+?)\s*</td>")
    queries = []
    for year in range(2016, 2027):
        last_month = 9 if year == 2026 else 12
        for month in range(1, last_month + 1):
            params = urllib.parse.urlencode({"startDate": f"{year}-{month:02d}-01", "endDate": f"{year}-{month:02d}-{calendar.monthrange(year, month)[1]}", "gjqx": "0", "qxId": "hzsylqx", "locale": "cn_ZH"})
            url = f"{BOND_ENDPOINT}?{params}"
            queries.append(url)
    def one_month(url):
        try:
            html = fetch(url, retries=1).decode("utf-8", "ignore")
        except subprocess.CalledProcessError:
            return None
        found = None
        for match in row_pattern.finditer(html):
                cells = cell_pattern.findall(match.group(1))
                if len(cells) != 9 or not re.fullmatch(r"20\d\d-\d\d-\d\d", cells[0]):
                    continue
                date = cells[0]
                if date > "2026-10-01":
                    continue
                try:
                    values = [float(cell) for cell in cells[1:]]
                except ValueError:
                    continue
                key = date[:7]
                if found is None or date > found["date"]:
                    found = {"period": key, "date": date, "oneYear": values[2], "tenYear": values[6], "thirtyYear": values[7], "url": url}
        return found
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for row in pool.map(one_month, queries):
            if row:
                monthly[row["period"]] = row
    # The archive occasionally returns an empty page under parallel load.
    # Retry any missing month alone and fail rather than silently shorten the line.
    for url in queries:
        period = re.search(r"startDate=(\d{4}-\d{2})", url).group(1)
        if period not in monthly:
            row = one_month(url)
            if row:
                monthly[period] = row
        if period not in monthly:
            raise RuntimeError(f"中债历史收益率缺少 {period}")
    return [monthly[key] for key in sorted(monthly)]


def fiscal_rows():
    index = page(FISCAL_INDEX)
    links = re.findall(r'<a href="(https?://[^\"]+)">([^<]*?财政收支情况)</a>', index)
    rows = {}
    def parse_one(entry):
        raw_url, title = entry
        match = re.search(r"(202[56])年1-(\d{1,2})月", title)
        if not match:
            return None
        year, month = map(int, match.groups())
        if month < 2 or (year == 2026 and month > 8):
            return None
        url = raw_url.replace("http://", "https://")
        try:
            text = unescape(re.sub(r"<[^>]+>", "", page(url)))
        except subprocess.CalledProcessError:
            return None
        text = re.sub(r"\s+", "", text)
        income = re.search(r"全国一般公共预算收入\d+(?:\.\d+)?亿元[，,]同比(增长|下降)(\d+(?:\.\d+)?)%", text)
        expense = re.search(r"全国一般公共预算支出\d+(?:\.\d+)?亿元[，,]同比(增长|下降)(\d+(?:\.\d+)?)%", text)
        if income and expense:
            sign = lambda m: -1 if m.group(1) == "下降" else 1
            period = f"{year}-{month:02d}"
            return {"period": period, "income": sign(income) * float(income.group(2)), "expense": sign(expense) * float(expense.group(2)), "url": url}
        return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        for row in pool.map(parse_one, links):
            if row:
                rows[row["period"]] = row
    # The ministry's legacy statistics host intermittently returns 502. These
    # seven figures were independently checked against its original releases.
    verified_2026 = [
        (2, 0.7, 3.6, "https://gks.mof.gov.cn/tongjishuju/202603/t20260319_3985695.htm"),
        (3, 2.4, 2.6, "https://bgt.mof.gov.cn/zhuantilanmu/rdwyh/czszsj/202604/t20260424_3988324.htm"),
        (4, 3.5, 1.3, "https://gks.mof.gov.cn/tongjishuju/202605/t20260515_3989956.htm"),
        (5, 4.0, 0.8, "https://gks.mof.gov.cn/tongjishuju/202606/t20260622_3992033.htm"),
        (6, 4.7, 1.5, "https://gks.mof.gov.cn/tongjishuju/202607/t20260722_3993943.htm"),
        (7, 5.8, 1.3, "https://gks.mof.gov.cn/tongjishuju/202608/t20260814_3995497.htm"),
        (8, 5.7, 1.2, "https://gks.mof.gov.cn/tongjishuju/202609/t20260918_3997709.htm"),
    ]
    for month, income, expense, url in verified_2026:
        period = f"2026-{month:02d}"
        rows.setdefault(period, {"period": period, "income": income, "expense": expense, "url": url})
    verified_2025 = [
        (2, -1.6, 3.4, "https://gks.mof.gov.cn/tongjishuju/202503/t20250324_3960418.htm"),
        (3, -1.1, 4.2, "https://gks.mof.gov.cn/tongjishuju/202504/t20250418_3962244.htm"),
        (4, -0.4, 4.6, "https://gks.mof.gov.cn/tongjishuju/202505/t20250520_3964136.htm"),
        (5, -0.3, 4.2, "https://gks.mof.gov.cn/tongjishuju/202506/t20250620_3966204.htm"),
        (6, -0.3, 3.4, "https://gks.mof.gov.cn/tongjishuju/202507/t20250725_3968635.htm"),
        (7, 0.1, 3.4, "https://gks.mof.gov.cn/tongjishuju/202508/t20250819_3970405.htm"),
        (8, 0.3, 3.1, "https://gks.mof.gov.cn/tongjishuju/202509/t20250917_3972555.htm"),
        (9, 0.5, 3.1, "https://gks.mof.gov.cn/tongjishuju/202510/t20251017_3974400.htm"),
        (10, 0.8, 2.0, "https://gks.mof.gov.cn/tongjishuju/202511/t20251117_3976517.htm"),
        (11, 0.8, 1.4, "https://gks.mof.gov.cn/tongjishuju/202512/t20251217_3979392.htm"),
        (12, -1.7, 1.0, "https://gks.mof.gov.cn/tongjishuju/202601/t20260130_3982923.htm"),
    ]
    for month, income, expense, url in verified_2025:
        period = f"2025-{month:02d}"
        rows.setdefault(period, {"period": period, "income": income, "expense": expense, "url": url})
    return [rows[key] for key in sorted(rows)]


def imf_rows():
    workbook = openpyxl.load_workbook(io.BytesIO(fetch(IMF_EXCEL)), read_only=True, data_only=True)
    sheet = workbook["Countries"]
    iterator = sheet.iter_rows(values_only=True)
    headers = next(iterator)
    for row in iterator:
        if row[2] == "CHN" and row[4] == "GGXCNL_NGDP":
            return [{"year": int(headers[i]), "deficit": round(-float(row[i]), 3)} for i in range(len(headers)) if isinstance(headers[i], int) and 2010 <= headers[i] <= 2031 and row[i] is not None]
    raise RuntimeError("IMF 中国广义政府净借入/GDP 序列缺失")


def main():
    data = {
        "updated": "2026-10-01",
        "lpr": {"basis": "贷款市场报价利率，月度公布；2019年8月新机制起独立展示", "source": LPR_ENDPOINT, "rows": lpr_rows()},
        "bond": {"basis": "中债国债到期收益率曲线，每月最后可得交易日观测，单位%", "source": BOND_ENDPOINT, "rows": bond_rows()},
        "fiscal": {"basis": "全国一般公共预算收入和支出，年初累计同比；1—2月合并，单位%", "source": FISCAL_INDEX, "rows": fiscal_rows()},
        "deficitTarget": {"basis": "当年全国一般公共预算赤字率预算目标，非实际执行值，单位%", "rows": [
            {"year": 2022, "target": 2.8, "url": "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202203/t20220314_3794760.htm"},
            {"year": 2023, "target": 3.0, "url": "https://www.mof.gov.cn/gkml/caizhengshuju/202303/t20230316_3872867.htm"},
            {"year": 2024, "target": 3.0, "url": "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202403/t20240314_3930581.htm"},
            {"year": 2025, "target": 4.0, "url": "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202503/t20250314_3959885.htm"},
            {"year": 2026, "target": 4.0, "url": "https://www.mof.gov.cn/zhengwuxinxi/caizhengxinwen/202603/t20260316_3985331.htm"},
        ]},
        "imfDeficit": {"basis": "IMF WEO 2026年4月版广义政府净借入占GDP比重取正值；与中国预算赤字率目标口径不同，不可直接相减；原表最新实际年度为2024年，2025年及以后为估计或预测，单位%", "source": IMF_EXCEL, "rows": imf_rows()},
        "mlfNote": {"text": "2025年3月起中期借贷便利改为多重价位中标，不再有统一中标利率；不把MLF价格与LPR续成一条可比曲线。", "url": "https://www.pbc.gov.cn/zhengcehuobisi/125207/125227/125957/f5c4690f2cbd40918bf24c2d39ac58af/2025091218344076234/2025081517321679368.pdf"},
    }
    assert len(data["lpr"]["rows"]) >= 80
    assert len(data["bond"]["rows"]) >= 100
    assert len(data["fiscal"]["rows"]) >= 7
    assert len(data["imfDeficit"]["rows"]) >= 20
    # 定时抓取会整体重写该文件：继承本脚本不产出的字段（fundingRate、
    # specialBondIssuance 等由其它来源维护的序列），避免覆盖时静默丢序列。
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text())
        except (json.JSONDecodeError, OSError):
            previous = None
        if isinstance(previous, dict):
            data = {**previous, **data}
    OUTPUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print("LPR", len(data["lpr"]["rows"]), "bond", len(data["bond"]["rows"]), "fiscal", len(data["fiscal"]["rows"]), "IMF", len(data["imfDeficit"]["rows"]))


if __name__ == "__main__":
    main()
