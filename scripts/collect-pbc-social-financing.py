"""Collect official monthly PBC AFRE stock and RMB-loan growth rates."""

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
FINANCE_CREDIT = json.loads((ROOT / "app/data/macro-finance-credit.json").read_text())
ARCHIVE = "https://www.pbc.gov.cn/en/3688247/3688978/3709140/48b09237-{}.html"
HISTORICAL_TABLE = "https://www.pbc.gov.cn/diaochatongjisi/attachDir/2025/11/2025110511314347909.pdf"

# PBC's retrospectively adjusted monthly series (official 2017-2019 table).
# Each pair is AFRE stock YoY, then RMB loans to the real economy YoY (%).
HISTORICAL_2017_2019 = [
    ("2017-01",16.4,12.8),("2017-02",16.4,12.9),("2017-03",15.7,12.6),("2017-04",15.5,13.1),("2017-05",15.5,13.2),("2017-06",14.9,13.1),("2017-07",15.5,13.5),("2017-08",15.1,13.8),("2017-09",14.9,13.5),("2017-10",15.0,13.5),("2017-11",14.5,13.7),("2017-12",14.1,13.2),
    ("2018-01",13.4,13.2),("2018-02",13.4,13.1),("2018-03",12.7,12.9),("2018-04",12.7,12.8),("2018-05",12.2,12.6),("2018-06",11.8,12.7),("2018-07",11.5,12.9),("2018-08",11.5,12.9),("2018-09",11.2,13.0),("2018-10",10.8,13.0),("2018-11",10.3,12.9),("2018-12",10.3,13.2),
    ("2019-01",10.9,13.6),("2019-02",10.6,13.3),("2019-03",11.2,13.8),("2019-04",10.8,13.5),("2019-05",11.0,13.4),("2019-06",11.2,13.2),("2019-07",10.8,12.7),("2019-08",10.7,12.6),("2019-09",10.7,12.7),("2019-10",10.6,12.5),("2019-11",10.7,12.5),("2019-12",10.7,12.5),
]


class ArchiveParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.href = ""; self.text = ""; self.links = []
    def handle_starttag(self, tag, attrs):
        if tag == "a": self.href = dict(attrs).get("href", ""); self.text = ""
    def handle_data(self, data):
        if self.href: self.text += data
    def handle_endtag(self, tag):
        if tag == "a" and self.href:
            title = " ".join(self.text.split())
            if "Report on Aggregate Financing to the Real Economy (Stock)" in title:
                self.links.append((title, self.href))
            self.href = ""; self.text = ""


class TextParser(HTMLParser):
    def __init__(self): super().__init__(); self.parts = []
    def handle_data(self, data): self.parts.append(data)


def get(url):
    for attempt in range(4):
        try:
            return urlopen(Request(url, headers={"User-Agent": "Mozilla/5.0"}), timeout=25).read()
        except Exception:
            if attempt == 3: raise
            time.sleep(1 + attempt * 2)


MONTHS = {name.lower(): number for number, name in enumerate(("January February March April May June July August September October November December").split(), 1)}
reports = {}
for page in range(1, 16):
    parser = ArchiveParser(); parser.feed(get(ARCHIVE.format(page)).decode("utf-8", "ignore"))
    for title, href in parser.links:
        match = re.search(r"\((January|February|March|April|May|June|July|August|September|October|November|December) (20\d{2})\)", title)
        if match:
            year = int(match.group(2))
            if 2020 <= year <= 2026:
                period = f"{year}-{MONTHS[match.group(1).lower()]:02d}"
                reports[period] = "https://www.pbc.gov.cn" + href


def collect(item):
    period, url = item
    parser = TextParser(); parser.feed(get(url).decode("utf-8", "ignore"))
    text = " ".join(" ".join(parser.parts).split())
    # This report's headline gives AFRE stock growth; the RMB-to-real-economy
    # paragraph gives the corresponding loan-stock growth.
    afre = re.search(r"AFRE(?:\s*\(stock\))?.{0,280}?increasing\s+([\d.]+)\s+percent year on year", text, re.I)
    if not afre:
        afre = re.search(r"financing to the real economy \(AFRE\).{0,240}?increasing\s+([\d.]+)\s+percent year on year", text, re.I)
    loan = re.search(r"outstanding RMB loans to the real economy.{0,220}?increasing\s+([\d.]+)\s+percent year on year", text, re.I)
    if not afre or not loan:
        # Chinese releases are also published alongside the English archive.
        # Missing/non-matching releases remain absent for visible disclosure.
        return None
    return {"period": period, "total": float(afre.group(1)), "rmbLoan": float(loan.group(1)), "sourceUrl": url}


def collect_chinese_report(item):
    period, url = item
    parser = TextParser(); parser.feed(get(url).decode("utf-8", "ignore"))
    text = " ".join(" ".join(parser.parts).split())
    total = re.search(r"社会融资规模存量(?:同比增长|同比增速为?)\s*([\d.]+)%", text)
    loan = re.search(r"对实体经济发放的人民币贷款余额[^。]{0,100}?同比(?:增长|增速为?)\s*([\d.]+)%", text)
    if not total or not loan:
        return None
    return {"period": period, "total": float(total.group(1)), "rmbLoan": float(loan.group(1)), "sourceUrl": url}


with ThreadPoolExecutor(max_workers=3) as pool:
    recent_rows = [row for row in pool.map(collect, sorted(reports.items())) if row]

# Since 2023, the PBC's Chinese monthly financial-statistics reports are
# consistently archived in the credit dataset and include both stock growth
# rates. Prefer those direct official monthly reports where available (including
# the newer archive years not present in the English AFRE-stock index).
chinese_reports = {
    row["period"]: row["url"] for row in FINANCE_CREDIT["rows"]
    if row["period"] >= "2023-01"
}
with ThreadPoolExecutor(max_workers=3) as pool:
    chinese_rows = [row for row in pool.map(collect_chinese_report, sorted(chinese_reports.items())) if row]

rows = [{"period": period, "total": total, "rmbLoan": loan, "sourceUrl": HISTORICAL_TABLE} for period, total, loan in HISTORICAL_2017_2019]
by_period = {row["period"]: row for row in recent_rows}
by_period.update({row["period"]: row for row in chinese_rows})
rows.extend(by_period.values())
rows.sort(key=lambda row: row["period"])
data = {
    "unit": "%",
    "basis": "月末存量同比；人民币贷款为社融构成项“对实体经济发放的人民币贷款余额”，非金融机构人民币贷款总额。2017—2019采用人民银行回溯调整后的官方表；2020—2022采用逐月人民银行存量报告；2023年起采用逐月人民银行金融统计报告。官方原表无法核验的月份保留缺口，不插值。2023年起统计范围变化按人民银行公布的可比口径。",
    "rows": rows,
    "historicalSource": HISTORICAL_TABLE,
    "coverageStart": rows[0]["period"],
    "coverageEnd": rows[-1]["period"],
}
target = ROOT / "app/data/macro-social-financing.json"
# 定时抓取会整体重写该文件：继承本脚本不产出的字段（flowComponents 等），
# 否则会把人工/Wind 维护的构成项口径数据一并抹掉。
if target.exists():
    try:
        previous = json.loads(target.read_text())
    except (json.JSONDecodeError, OSError):
        previous = None
    if isinstance(previous, dict):
        data = {**previous, **data}
target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
periods = {row["period"] for row in rows}
all_months = {f"{year}-{month:02d}" for year in range(2017, 2027) for month in range(1, 13) if f"{year}-{month:02d}" <= "2026-08"}
missing = sorted(all_months - periods)
print(f"Wrote {len(rows)} verified official points from {rows[0]['period']} through {rows[-1]['period']}; unverified months left blank: {', '.join(missing) or 'none'}")
