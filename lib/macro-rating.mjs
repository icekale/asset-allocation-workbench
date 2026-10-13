import { scoreLeverageCurve } from "./macro-leverage-curve.mjs";
import { scoreContinuous } from "./macro-scoring-continuous.mjs";
import { scoreLeverageMatrix } from "./macro-leverage-scoring.mjs";
import { validateStandaloneProfitBreadthObservation } from "./macro-profit-breadth.mjs";

const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const canonical = (value) => Number(value.toFixed(6));
const approximately = (actual, expected, tolerance = .051) => finite(actual) && Math.abs(actual - expected) <= tolerance;
const monthNumber = (period) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period || "");
  return match ? Number(match[1]) * 12 + Number(match[2]) : null;
};
const quarterNumber = (period) => {
  const match = /^(\d{4})-Q([1-4])$/.exec(period || "");
  return match ? Number(match[1]) * 4 + Number(match[2]) : null;
};
const calendarDate = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const monthEnd = (period) => {
  if (monthNumber(period) === null) return null;
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};
const quarterEnd = (period) => {
  const match = /^(\d{4})-Q([1-4])$/.exec(period || "");
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) * 3, 0)).toISOString().slice(0, 10) : null;
};
const dateAfterMonths = (date, months) => {
  const [year, month, day] = date.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10);
};
const consecutive = (months) => months.every((month, index) => month !== null && (!index || month === months[index - 1] + 1));
const agencySource = (sourceUrl, domain) => {
  try {
    const url = new URL(sourceUrl);
    return (url.protocol === "https:" || (url.protocol === "http:" && ["nifd.cn", "customs.gov.cn"].includes(domain)))
      && (url.hostname === domain || url.hostname.endsWith("." + domain));
  } catch { return false; }
};
const traceableSource = (sourceUrl) => {
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" || (url.protocol === "http:" && ["nifd.cn", "customs.gov.cn"].some((domain) => agencySource(sourceUrl, domain)));
  } catch { return false; }
};
const ruleDomains = (rule) => rule.id === "G10" ? ["customs.gov.cn"]
  : /^E|^G/.test(rule.id) ? ["stats.gov.cn"]
    : ["F09", "F10"].includes(rule.id) ? ["nifd.cn", "cnbs.org.cn"]
      : /^F|^P02/.test(rule.id) ? ["pbc.gov.cn"]
        : /^P01/.test(rule.id) ? ["mof.gov.cn"] : ["gov.cn"];
const sourceValid = (rule, item, cutoff, domains = ruleDomains(rule)) => {
  if (!item || !traceableSource(item.sourceUrl) || !calendarDate(item.releaseDate) || item.releaseDate > cutoff) return false;
  if (item.originalPublisher !== undefined && item.originalPublisher !== rule.originalPublisher) return false;
  const audit = item.sourceAudit;
  if (audit && ["Wind", "财新"].includes(audit.provider)) {
    return audit.originalPublisher === rule.originalPublisher && nonempty(audit.seriesCode)
      && nonempty(audit.officialFallbackReason) && nonempty(audit.crossCheckNote)
      && (audit.provider !== "财新" || nonempty(audit.windFallbackReason))
      && calendarDate(audit.availableDate) && audit.availableDate <= cutoff
      && audit.availableDate >= item.releaseDate;
  }
  if (audit && audit.provider !== "官方") return false;
  return domains.some((domain) => agencySource(item.sourceUrl, domain));
};
const evidenceRecordValid = (item, cutoff) => {
  if (!item || !nonempty(item.originalPublisher) || !nonempty(item.period)
    || !nonempty(item.metric) || !(finite(item.value) && nonempty(item.unit) || nonempty(item.finding))) return false;
  const end = monthEnd(item.period) || quarterEnd(item.period) || (/^\d{4}$/.test(item.period) ? item.period + "-12-31" : null);
  if (!end || end > cutoff) return false;
  return sourceValid({ id: "evidence", originalPublisher: item.originalPublisher }, item, cutoff, ["gov.cn", "nifd.cn", "cnbs.org.cn"]);
};
const evidenceSectionValid = (section, cutoff) => nonempty(section?.summary)
  && Array.isArray(section.evidence) && section.evidence.length > 0
  && section.evidence.every((item) => evidenceRecordValid(item, cutoff));

const periodValid = (rule, observation, asOf, freshness) => {
  const monthlyAge = freshness?.monthlyMaxAgeMonths ?? 3;
  const quarterlyAge = freshness?.quarterlyMaxAgeMonths ?? 6;
  let end;
  let maxAge;
  if (rule.aggregation === "财政融资资源比重同比差") {
    return /^\d{4}$/.test(observation.period) && observation.period === asOf.slice(0, 4)
      && calendarDate(observation.reviewDate) && observation.reviewDate <= asOf
      && observation.reviewDate >= observation.releaseDate
      && observation.reviewDate.slice(0, 7) === asOf.slice(0, 7);
  }
  if (rule.evidenceType === "政策实施") {
    // Policy remains effective without a new monthly announcement. The review, not the document date, is current.
    return monthNumber(observation.period) !== null && observation.period <= asOf.slice(0, 7)
      && monthNumber(asOf.slice(0, 7)) - monthNumber(observation.period) <= monthlyAge;
  }
  if (rule.frequency?.startsWith("季度")) {
    if (rule.aggregation === "企业贷款利率同比变化") {
      end = monthEnd(observation.period);
      if (![3, 6, 9, 12].includes(Number(observation.period?.slice(5)))) return false;
    } else {
      end = quarterEnd(observation.period);
    }
    maxAge = quarterlyAge;
  } else {
    end = monthEnd(observation.period);
    maxAge = monthlyAge;
  }
  if (!end || end > asOf || asOf > dateAfterMonths(end, maxAge)) return false;
  // A monetary policy announcement may legitimately precede the observed month-end snapshot.
  return rule.aggregation === "近6月政策利率变动" || observation.releaseDate >= end;
};

const policyReviewValid = (rule, observation, asOf) => {
  const review = observation.policyReview;
  if (!review || !calendarDate(review.reviewDate) || review.reviewDate > asOf
    || review.reviewDate < observation.releaseDate || observation.period !== review.reviewDate.slice(0, 7)
    || !["scope", "instruments", "responsibleAgency", "timetable", "beneficiaries", "risks", "counterEvidence", "noDoubleCounting"].every((key) => nonempty(review[key]))) return false;
  const expectedDirection = observation.value >= 4 ? "改善" : observation.value <= 2 ? "恶化" : "中性或混合";
  if (review.direction !== expectedDirection || !Array.isArray(review.evidence) || !review.evidence.length) return false;
  if (review.evidence.some((item) => !item || item.theme !== rule.policyTheme || !nonempty(item.title) || !nonempty(item.summary)
    || !nonempty(item.eventId) || !nonempty(item.mechanism) || !["正式文件", "执行进展"].includes(item.stage)
    || !sourceValid(rule, item, observation.releaseDate, ["gov.cn"]) || item.releaseDate > review.reviewDate)) return false;
  if (!review.evidence.some((item) => item.sourceUrl === observation.sourceUrl && item.releaseDate === observation.releaseDate)) return false;
  const formal = review.evidence.filter((item) => item.stage === "正式文件" && item.status === "有效"
    && calendarDate(item.effectiveDate) && item.effectiveDate <= review.reviewDate
    && (!item.expiresOn || calendarDate(item.expiresOn) && item.expiresOn >= review.reviewDate));
  if (!formal.length) return false;
  if (rule.policyEvidenceMatrixRequired) {
    const coverage = review.coverageAssessment;
    const checks = review.implementationChecks;
    if (!coverage || !["全国行业", "全国专项", "全国制度"].includes(coverage.level)
      || coverage.wholeEconomyClaim !== false || !nonempty(coverage.representativeness)
      || !Array.isArray(coverage.coveredAreas) || !coverage.coveredAreas.length || !coverage.coveredAreas.every(nonempty)
      || !Array.isArray(coverage.unverifiedAreas) || !coverage.unverifiedAreas.every(nonempty)
      || !Array.isArray(checks) || checks.length !== 4
      || new Set(checks.map((item) => item?.dimension)).size !== 4
      || checks.some((item) => !["instruments", "responsibleAgency", "timetable", "beneficiaries"].includes(item?.dimension)
        || item.finding !== review[item.dimension] || !nonempty(item.finding)
        || !Array.isArray(item.evidenceRefs) || !item.evidenceRefs.length
        || item.evidenceRefs.some((id) => !formal.some((document) => document.eventId === id)))) return false;
    if (observation.value === 5 && (coverage.unverifiedAreas.length > 0 || coverage.executionMatchesScope !== true
      || !review.evidence.some((item) => item.stage === "执行进展" && item.scope === review.scope
        && nonempty(item.formalEventId) && formal.some((document) => document.eventId === item.formalEventId
          && document.mechanism === item.mechanism)))) return false;
  }
  if (observation.value === 5 && (!nonempty(review.executionSummary)
    || !review.evidence.some((item) => item.stage === "执行进展" && item.scope === review.scope
      && formal.some((document) => item.releaseDate >= document.effectiveDate)))) return false;
  return true;
};

const leverageReviewValid = (rule, observation, asOf) => {
  const parts = observation.leverageComponents;
  const series = rule.id === "F09" ? "householdLeverage" : "corporateLeverage";
  if (!Array.isArray(parts) || parts.length !== 2 || quarterNumber(parts[0]?.period) === null
    || quarterNumber(parts[1]?.period) - quarterNumber(parts[0]?.period) !== 4
    || parts[1].period !== observation.period
    || parts.some((part) => part.series !== series || part.unit !== "%"
      || part.basis !== "部门债务/过去四季名义GDP" || !finite(part.value) || part.value < 0
      || !sourceValid(rule, part, observation.releaseDate) || part.releaseDate < quarterEnd(part.period))
    || !approximately(observation.yearAgoLeverageRatio, parts[0].value, .001)
    || !approximately(observation.leverageRatio, parts[1].value, .001)) return false;
  const review = observation.leverageReview;
  if (!review || !calendarDate(review.reviewDate) || review.reviewDate > asOf
    || review.reviewDate < observation.releaseDate || !nonempty(review.scoreReason)
    || !finite(review.nominalGdpEffect?.debtGrowthPct) || !finite(review.nominalGdpEffect?.nominalGdpGrowthPct)
    || !nonempty(review.nominalGdpEffect?.revisionVersion)) return false;
  return ["nominalGdpEffect", "incomeOrProfit", "debtService", "counterEvidence"]
    .every((key) => evidenceSectionValid(review[key], review.reviewDate));
};

const profitQualityValid = (rule, observation) => {
  const quality = observation.profitQuality;
  if (!quality || quality.period !== observation.period || quality.sameScope !== true
    || !nonempty(quality.comparabilityNote) || !nonempty(quality.limitations)) return false;
  for (const [key, units] of [["profitMargin", ["%"]], ["receivables", ["天", "%", "亿元"]]]) {
    const item = quality[key];
    if (!item || item.period !== observation.period || !finite(item.value) || !units.includes(item.unit)
      || item.scope !== "规模以上工业企业" || !nonempty(item.basis)
      || !sourceValid(rule, item, observation.releaseDate) || item.releaseDate < monthEnd(item.period)) return false;
  }
  return evidenceSectionValid(quality.counterEvidence, observation.releaseDate);
};

const componentArray = (rule, observation, count) => {
  const parts = observation.components;
  return Array.isArray(parts) && parts.length === count && parts.every((part) => finite(part?.value)
    && sourceValid(rule, part, observation.releaseDate)) ? parts : null;
};
const monthlyComponents = (rule, observation, count, policySnapshot = false) => {
  const parts = componentArray(rule, observation, count);
  if (!parts || parts.at(-1).period !== observation.period
    || parts.some((part) => monthNumber(part.period) === null
      || (!policySnapshot && part.releaseDate < monthEnd(part.period)))) return null;
  return parts;
};
const exGovernmentStock = (item) => {
  if (item.unit !== "万亿元" || item.basis !== "同口径月末存量"
    || !finite(item.totalStock) || !finite(item.governmentBondStock)
    || item.totalStock <= item.governmentBondStock || item.governmentBondStock < 0) return null;
  const net = item.totalStock - item.governmentBondStock;
  return approximately(item.value, net, .011) ? net : null;
};
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[34] + sorted[35]) / 2;
};
const deflatorValue = (rule, observation) => {
  const evidence = observation.gdpDeflatorEvidence;
  if (!evidence || evidence.period !== observation.period || !nonempty(evidence.revisionVersion)) return null;
  const current = evidence.currentNominal, prior = evidence.priorNominal, real = evidence.realGrowth;
  if (quarterNumber(current?.period) === null || current.period !== observation.period
    || quarterNumber(current.period) - quarterNumber(prior?.period) !== 4 || real?.period !== current.period
    || [current, prior, real].some((item) => item.revisionVersion !== evidence.revisionVersion
      || !finite(item.value) || !sourceValid(rule, item, observation.releaseDate)
      || item.releaseDate < quarterEnd(item.period))
    || current.unit !== "亿元" || prior.unit !== "亿元" || current.value <= 0 || prior.value <= 0
    || real.unit !== "%" || real.basis !== "单季实际同比" || real.value <= -100) return null;
  return (current.value / prior.value / (1 + real.value / 100) - 1) * 100;
};
const fiscalExpenditureValue = (rule, observation) => {
  const item = observation.fiscalExpenditure;
  if (observation.period.endsWith("-01") || !item || item.period !== observation.period
    || item.series !== rule.componentSeries || item.scope !== "全国" || item.basis !== "年初累计可比同比"
    || item.unit !== "亿元" || !finite(item.cumulativeExpenditure) || item.cumulativeExpenditure < 0
    || !finite(item.reportedYoyPct) || !nonempty(item.comparabilityNote)
    || !sourceValid(rule, item, observation.releaseDate) || item.releaseDate < monthEnd(item.period)) return null;
  // MOF reports comparable growth: do not divide incompatible published prior-year aggregates.
  return item.reportedYoyPct;
};
const fiscalResourcesValue = (rule, observation) => {
  const parts = componentArray(rule, observation, 2);
  if (!parts || !/^\d{4}$/.test(parts[0]?.period) || !/^\d{4}$/.test(parts[1]?.period)
    || Number(parts[1].period) - Number(parts[0].period) !== 1 || parts[1].period !== observation.period
    || parts[0].budgetStage !== parts[1].budgetStage || !nonempty(parts[0].budgetStage)) return null;
  const ratios = [];
  for (const part of parts) {
    if (part.year !== Number(part.period) || part.series !== "fiscalFinancingResources"
      || part.basis !== "正式批准财政融资资源占上年GDP" || part.unit !== "百分点"
      || !nonempty(part.noDoubleCounting) || !Array.isArray(part.items) || !part.items.length) return null;
    const names = part.items.map((item) => item?.component);
    if (new Set(names).size !== names.length || part.items.some((item) =>
      !item || !["赤字融资", "新增地方专项债", "特别国债", "其他正式新增工具"].includes(item.component)
      || !nonempty(item.purpose) || /置换|再融资/.test(item.purpose) || !finite(item.amount) || item.amount < 0
      || item.unit !== "亿元" || !sourceValid(rule, item, observation.releaseDate)
      || !calendarDate(item.approvalDate) || item.approvalDate.slice(0, 4) !== part.period
      || item.approvalDate > item.releaseDate || item.releaseDate.slice(0, 4) !== part.period)) return null;
    const gdp = part.gdp;
    if (!gdp || gdp.year !== part.year - 1 || !finite(gdp.value) || gdp.value <= 0 || gdp.unit !== "亿元"
      || !nonempty(gdp.revisionVersion) || !sourceValid({ id: "E01", originalPublisher: "国家统计局" }, gdp, observation.releaseDate)
      || gdp.releaseDate < String(gdp.year) + "-12-31") return null;
    const ratio = part.items.reduce((sum, item) => sum + item.amount, 0) / gdp.value * 100;
    if (!approximately(part.value, ratio, .011)) return null;
    ratios.push(ratio);
  }
  if (parts[0].gdp.revisionVersion !== parts[1].gdp.revisionVersion) return null;
  return ratios[1] - ratios[0];
};

const rrrActionValue = (rule, observation) => {
  const ledger = observation.rrrActionLedger;
  const end = monthEnd(observation.period);
  if (!ledger || ledger.windowEnd !== end || !calendarDate(ledger.windowStart)
    || ledger.windowStart !== dateAfterMonths(observation.period + "-01", -11)
    || !Array.isArray(ledger.monthlyChecks) || ledger.monthlyChecks.length !== 12
    || !Array.isArray(ledger.adjustmentEvents) || !Array.isArray(ledger.crossChecks)
    || !ledger.crossChecks.length) return null;
  const months = ledger.monthlyChecks.map((item) => monthNumber(item?.period));
  if (!consecutive(months) || months[0] !== monthNumber(ledger.windowStart.slice(0, 7))
    || months.at(-1) !== monthNumber(observation.period)) return null;
  const sourceUrls = new Set();
  for (const item of ledger.monthlyChecks) {
    if (!item || item.tableComplete !== true || item.policyReviewComplete !== true
      || item.tool !== "调整法定存款准备金率" || item.unit !== "亿元" || !nonempty(item.finding)
      || !sourceValid(rule, item, observation.releaseDate) || item.releaseDate < monthEnd(item.period)
      || sourceUrls.has(item.sourceUrl)
      || ![item.injection, item.withdrawal, item.netInjection].every((cell) => finite(cell) || ["—", "-"].includes(cell))) return null;
    sourceUrls.add(item.sourceUrl);
  }
  // Monthly RMB-flow disclosures only establish coverage. Basis points come from executed policy notices.
  const ids = new Set();
  const actionKeys = new Set();
  let value = 0;
  for (const event of ledger.adjustmentEvents) {
    if (!event || !nonempty(event.eventId) || ids.has(event.eventId) || event.executed !== true
      || !["普遍", "定向", "行业专属", "外币", "机构个别"].includes(event.scopeType)
      || !["人民币", "外币"].includes(event.currency) || event.unit !== "基点"
      || !finite(event.signedChangeBp) || event.signedChangeBp === 0
      || !finite(event.rawChange?.value) || !["百分点", "基点"].includes(event.rawChange.unit)
      || !approximately(event.signedChangeBp, event.rawChange.value * (event.rawChange.unit === "百分点" ? 100 : 1), .000001)
      || !nonempty(event.institutionCoverage) || !nonempty(event.exceptionNote)
      || !calendarDate(event.announcementDate) || !calendarDate(event.effectiveDate)
      || event.announcementDate !== event.releaseDate || event.announcementDate > event.effectiveDate
      || event.effectiveDate < ledger.windowStart || event.effectiveDate > ledger.windowEnd
      || !sourceValid(rule, event, observation.releaseDate)) return null;
    ids.add(event.eventId);
    const notice = new URL(event.sourceUrl);
    const key = [notice.origin + notice.pathname, event.effectiveDate, event.scopeType, event.currency,
      event.scopeType === "普遍" ? "普遍" : event.institutionCoverage].join("|");
    if (actionKeys.has(key)) return null;
    actionKeys.add(key);
    if (event.scopeType === "普遍" && event.currency === "人民币") value += event.signedChangeBp;
  }
  for (const item of ledger.monthlyChecks) {
    const reportedAdjustment = [item.injection, item.withdrawal, item.netInjection].some((cell) => finite(cell) && cell !== 0);
    if (reportedAdjustment && !ledger.adjustmentEvents.some((event) => event.effectiveDate.slice(0, 7) === item.period)) return null;
    if (ledger.adjustmentEvents.some((event) => event.scopeType === "普遍" && event.currency === "人民币"
      && event.effectiveDate.slice(0, 7) === item.period) && !reportedAdjustment) return null;
  }
  const reportTypes = ["年度执行报告", "半年度大事记", "季度执行报告", "年度大事记"];
  if (!ledger.crossChecks.some((item) => reportTypes.includes(item.type))
    || !ledger.crossChecks.some((item) => item.type === "政策公告复核")) return null;
  // Coverage intervals may overlap but cannot leave any month or day unreviewed.
  const intervals = [];
  for (const item of ledger.crossChecks) {
    if (![...reportTypes, "政策公告复核"].includes(item?.type) || !calendarDate(item.coverageStart)
      || !calendarDate(item.coverageEnd) || item.coverageStart > item.coverageEnd
      || item.coverageEnd > ledger.windowEnd
      || item.releaseDate < item.coverageEnd || !nonempty(item.finding)
      || !sourceValid(rule, item, observation.releaseDate)) return null;
    if (item.type === "政策公告复核") {
      if (!Array.isArray(item.reviewedSources) || item.reviewedSources.length < 2
        || !item.reviewedSources.every((source) => agencySource(source?.sourceUrl, "pbc.gov.cn") && nonempty(source.finding))) return null;
      const directories = item.reviewedSources.filter((source) => calendarDate(source.reviewDate));
      const notices = item.reviewedSources.filter((source) => source.releaseDate !== undefined);
      if (!directories.some((source) => source.reviewDate >= item.coverageEnd && source.reviewDate <= observation.verifiedAt)
        || !notices.length || notices.some((source) => !sourceValid(rule, source, observation.releaseDate))) return null;
    }
    intervals.push([item.coverageStart, item.coverageEnd]);
  }
  intervals.sort((a, b) => a[0].localeCompare(b[0]));
  let covered = ledger.windowStart;
  for (const [start, finish] of intervals) {
    if (start > covered) return null;
    if (finish >= covered) {
      const next = new Date(finish + "T00:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
      covered = next.toISOString().slice(0, 10);
    }
  }
  return covered > ledger.windowEnd ? value : null;
};

const derivedValue = (rule, observation, asOf) => {
  const aggregation = rule.aggregation;
  if (aggregation === "行业利润改善广度") {
    return rule.id === "G19" ? validateStandaloneProfitBreadthObservation(observation, asOf) : null;
  }
  if (aggregation === "近12完整月普遍法定准备金率动作累计") return rrrActionValue(rule, observation);
  if (aggregation === "GDP平减指数单季同比") return deflatorValue(rule, observation);
  if (aggregation === "财政支出累计同比") return fiscalExpenditureValue(rule, observation);
  if (aggregation === "财政融资资源比重同比差") return fiscalResourcesValue(rule, observation);
  if (aggregation === "季度同比差") {
    const parts = componentArray(rule, observation, 2);
    if (!parts || quarterNumber(parts[0]?.period) === null
      || quarterNumber(parts[1]?.period) - quarterNumber(parts[0]?.period) !== 4 || parts[1].period !== observation.period
      || parts.some((part) => part.series !== rule.componentSeries || part.unit !== "%"
        || part.basis !== "季度工业产能利用率" || part.value < 0 || part.value > 100
        || part.releaseDate < quarterEnd(part.period))) return null;
    return parts[1].value - parts[0].value;
  }
  const count = { "近3月均值": 3, "70城二手房价近3月均值": 3, "近3月同比多增": 6,
    "近3月变动": 2, "同月同比差": 2, "剔除政府债后社融存量同比": 2,
    "剔除政府债后社融同比近3月变动": 4, "近6月政策利率变动": 2, "企业贷款利率同比变化": 2 }[aggregation];
  if (!count) return null;
  const parts = monthlyComponents(rule, observation, count, aggregation === "近6月政策利率变动");
  if (!parts) return null;
  const months = parts.map((part) => monthNumber(part.period));
  if (aggregation === "近3月均值") {
    if (!consecutive(months) || parts.some((part) => part.series !== rule.componentSeries
      || part.unit !== "指数点" || part.basis !== "季调当月指数" || part.value < 0 || part.value > 100)) return null;
    return parts.reduce((sum, part) => sum + part.value, 0) / 3;
  }
  if (aggregation === "70城二手房价近3月均值") {
    if (!consecutive(months)) return null;
    let cityNames = null;
    const monthlyMedians = [];
    for (const part of parts) {
      if (part.unit !== "%" || part.basis !== "70城二手住宅环比中位数"
        || !Array.isArray(part.cities) || part.cities.length !== 70) return null;
      const names = part.cities.map((city) => typeof city?.city === "string" ? city.city.replace(/\s/g, "") : "");
      if (names.some((name) => !name) || new Set(names).size !== 70 || part.cities.some((city) =>
        !finite(city?.momIndex) || city.momIndex < 80 || city.momIndex > 120)) return null;
      const sortedNames = [...names].sort().join("|");
      if (cityNames !== null && cityNames !== sortedNames) return null;
      cityNames = sortedNames;
      const value = median(part.cities.map((city) => city.momIndex - 100));
      if (!approximately(part.value, value, .001)) return null;
      monthlyMedians.push(value);
    }
    return monthlyMedians.reduce((sum, value) => sum + value, 0) / 3;
  }
  if (aggregation === "近3月同比多增") {
    if (!consecutive(months.slice(0, 3)) || !consecutive(months.slice(3))
      || months.slice(3).some((month, index) => month - months[index] !== 12)
      || parts.some((part) => part.series !== rule.componentSeries || part.unit !== "亿元" || part.basis !== "当月新增")) return null;
    return parts.slice(3).reduce((sum, part) => sum + part.value, 0) - parts.slice(0, 3).reduce((sum, part) => sum + part.value, 0);
  }
  if (aggregation === "近3月变动") {
    return months[1] - months[0] === 3 && parts.every((part) => part.series === rule.componentSeries)
      ? parts[1].value - parts[0].value : null;
  }
  if (aggregation === "同月同比差") {
    if (months[0] !== months[1] || parts[0].series !== "m1New" || parts[1].series !== "m2"
      || parts.some((part) => part.unit !== "%" || part.basis !== "月末余额同比")
      || parts[0].releaseDate < "2025-01-01") return null;
    return parts[0].value - parts[1].value;
  }
  if (aggregation === "近6月政策利率变动") {
    if (months[1] - months[0] !== 6 || parts.some((part) => part.series !== rule.componentSeries || part.unit !== "%"
      || part.value < 0 || part.value > 100 || !calendarDate(part.effectiveDate)
      || part.effectiveDate > monthEnd(part.period) || part.releaseDate > monthEnd(part.period))) return null;
    if (rule.componentSeries === "reserveRequirementRatio" && (!parts.every((part) => nonempty(part.institution) && nonempty(part.coverage))
      || parts[0].institution !== parts[1].institution || parts[0].coverage !== parts[1].coverage)) return null;
    return (parts[1].value - parts[0].value) * 100;
  }
  if (aggregation === "企业贷款利率同比变化") {
    if (months[1] - months[0] !== 12 || parts.some((part) => ![3, 6, 9, 12].includes(Number(part.period.slice(5)))
      || part.series !== rule.componentSeries || part.unit !== "%" || part.basis !== "当月新发放企业贷款加权平均利率"
      || part.value < 0 || part.value > 100)) return null;
    return (parts[1].value - parts[0].value) * 100;
  }
  if (["剔除政府债后社融存量同比", "剔除政府债后社融同比近3月变动"].includes(aggregation)) {
    const stocks = parts.map(exGovernmentStock);
    if (stocks.some((stock) => stock === null)) return null;
    if (aggregation === "剔除政府债后社融存量同比") {
      return months[1] - months[0] === 12 ? (stocks[1] / stocks[0] - 1) * 100 : null;
    }
    if (months[1] - months[0] !== 12 || months[2] - months[0] !== 3 || months[3] - months[2] !== 12) return null;
    return (stocks[3] / stocks[2] - stocks[1] / stocks[0]) * 100;
  }
  return null;
};

const pointsFor = (rule, value) => {
  const limits = rule.limits || [];
  if (rule.mode === "高优" && limits.length === 4) {
    return value < limits[0] ? 1 : value < limits[1] ? 2 : value < limits[2] ? 3 : value < limits[3] ? 4 : 5;
  }
  if (rule.mode === "低优" && limits.length === 4) {
    return value < limits[0] ? 5 : value < limits[1] ? 4 : value < limits[2] ? 3 : value < limits[3] ? 2 : 1;
  }
  if (rule.mode === "目标" && limits.length === 8) {
    // Target ranges are nested and closed: matching the innermost range has priority.
    for (const [lower, upper, points] of [[6, 7, 5], [4, 5, 4], [2, 3, 3], [0, 1, 2]]) {
      if (value >= limits[lower] && value <= limits[upper]) return points;
    }
    return 1;
  }
  return null;
};

/** Score only period-, definition-, publisher- and cutoff-verified observations. No missing value receives a neutral score. */
export function scoreIndicator(rule, observation, asOf, freshness) {
  if (!rule || !observation || observation.verified !== true || !calendarDate(asOf) || !finite(observation.value)
    || observation.unit !== rule.unit || observation.basis !== rule.measurementBasis
    || observation.originalPublisher !== rule.originalPublisher
    || observation.latestAvailablePeriod !== observation.period
    || !calendarDate(observation.verifiedAt) || observation.verifiedAt > asOf || observation.verifiedAt < observation.releaseDate
    || !sourceValid(rule, observation, asOf) || !periodValid(rule, observation, asOf, freshness)) return null;
  if (rule.minimumPeriod && (monthNumber(observation.period) === null || observation.period < rule.minimumPeriod)) return null;
  if (["G16", "G17"].includes(rule.id) && observation.series !== rule.componentSeries) return null;
  if (rule.id === "G13" && observation.investmentScope !== "含电力、热力、燃气及水生产和供应业") return null;
  if (["G01", "G17", "P01E", "P01F"].includes(rule.id)
    && (observation.period.endsWith("-01") || observation.period.endsWith("-02") && observation.periodScope !== "1—2月合并")) return null;
  if (rule.profitQualityRequired && !profitQualityValid(rule, observation)) return null;
  if (rule.id === "G19" && validateStandaloneProfitBreadthObservation(observation, asOf) === null) return null;
  if (rule.scoring?.method === "leverage-curve-composite") return scoreLeverageCurve(rule, observation);
  if (rule.mode === "原文研判") {
    const step = rule.scoring?.method === "evidence-matrix" ? .5 : 1;
    if (!Number.isInteger(observation.value / step) || observation.value < 1 || observation.value > 5 || !nonempty(observation.rationale)) return null;
    if (rule.evidenceType === "政策实施" && !policyReviewValid(rule, observation, asOf)) return null;
    if (rule.evidenceType === "部门杠杆率" && !leverageReviewValid(rule, observation, asOf)) return null;
    if (rule.scoring?.method === "evidence-matrix") {
      const calculated = scoreLeverageMatrix(rule, observation, asOf);
      return finite(calculated) && Math.abs(calculated - observation.value) < 1e-9 ? calculated : null;
    }
    return rule.scoring && rule.scoring.method !== "evidence-rubric" ? null : observation.value;
  }
  let value = observation.value;
  if (rule.aggregation) {
    const calculated = derivedValue(rule, observation, asOf);
    if (!finite(calculated) || !approximately(value, calculated, rule.aggregation === "70城二手房价近3月均值" ? .001 : .051)) return null;
    // Display/input rounding must not promote a derived value across a scoring boundary.
    value = canonical(calculated);
  }
  return rule.scoring ? scoreContinuous(rule, { ...observation, value }, asOf) : pointsFor(rule, value);
}

export function evaluateMacroRating(framework, current) {
  const pillars = Object.entries(framework.pillars).map(([name, weight]) => {
    const rules = framework.indicators.filter((item) => item.pillar === name);
    const scored = rules.map((rule) => ({ rule, points: scoreIndicator(rule, current.observations?.[rule.id], current.asOf, framework.freshness) }))
      .filter((item) => item.points !== null);
    const verifiedWeight = scored.reduce((sum, item) => sum + item.rule.weight, 0);
    const contribution = scored.reduce((sum, item) => sum + item.rule.weight * item.points, 0);
    return { name, weight, count: rules.length, verifiedCount: scored.length, verifiedWeight,
      coverage: verifiedWeight / weight, observedScore: verifiedWeight ? contribution / verifiedWeight : null, contribution };
  });
  const verifiedWeight = pillars.reduce((sum, pillar) => sum + pillar.verifiedWeight, 0);
  const coverage = verifiedWeight;
  const status = Math.abs(coverage - 1) < 1e-9 ? "正式"
    : coverage >= framework.coverage.provisional && pillars.every((pillar) => pillar.coverage >= framework.coverage.eachPillar) ? "暂定" : "资料不足";
  const formalScore = status === "正式" ? pillars.reduce((sum, pillar) => sum + pillar.contribution, 0) : null;
  const grade = formalScore === null ? null : framework.ratingBands.find((band) => formalScore >= band.minimum)?.label ?? null;
  return { pillars, verifiedWeight, coverage, status, formalScore, grade };
}
