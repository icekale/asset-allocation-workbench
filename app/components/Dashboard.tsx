"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssetName, MarketInputPayload, ModelSnapshot } from "../../lib/types";
import { calculateModel, modelParameters } from "../../lib/model";
import advisory from "../data/advisory.json";
import intrayear from "../data/macro-intrayear.json";
import gdpDeflatorHistory from "../data/macro-gdp-deflator-history.json";
import priceHistory from "../data/macro-price-history.json";
import additional from "../data/macro-additional.json";
import realEstate from "../data/macro-real-estate.json";
import realEstateSupplyHistory from "../data/macro-real-estate-supply-history.json";
import financeCredit from "../data/macro-finance-credit.json";
import socialFinancing from "../data/macro-social-financing.json";
import moneySupply from "../data/macro-money-supply.json";
import leverage from "../data/macro-leverage.json";
import macroPolicy from "../data/macro-policy.json";
import dataRevision from "../data/data-revision.json";
import { PolicyTracker } from "./PolicyTracker";
import { CoreMeetingTracker } from "./CoreMeetingTracker";
import { MacroRatingWorkbook, macroRatingHeadline } from "./MacroRatingV1";
import { StockRatingIndicators, StockRatingStandards, stockRatingDimensions } from "./StockRating";

const PRIMARY_TABS = ["宏观", "大类资产", "中观", "微观", "资产配置"] as const;
const ALLOCATION_TABS = ["配置总览", "市场因子", "细分配置", "情景压力", "参数与方法"] as const;
type PrimaryTab = (typeof PRIMARY_TABS)[number];
type AllocationTab = (typeof ALLOCATION_TABS)[number];

const ASSET_COLOR: Record<AssetName, string> = {
  股票: "var(--stock)",
  债券: "var(--bond)",
  商品: "var(--commodity)",
  另类: "var(--alternative)",
};

const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;
const signedPct = (value: number) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
const score = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(2)}`;

function formatAgeLabel(iso: string | null | undefined, suffix = "更新") {
  if (!iso) return "更新时间未知";
  const age = Date.now() - Date.parse(iso);
  if (!Number.isFinite(age)) return "更新时间未知";
  const hours = Math.max(0, Math.floor(age / 3_600_000));
  if (hours < 1) return `刚刚${suffix}`;
  if (hours < 24) return `${hours} 小时前${suffix}`;
  return `${Math.floor(hours / 24)} 天前${suffix}`;
}

/** Topbar "N 天前" should track last official macro apply, not the seed portfolio payload. */
function freshness(input: MarketInputPayload) {
  const macroAt = (dataRevision as { refreshedAt?: string } | null)?.refreshedAt;
  if (macroAt && Number.isFinite(Date.parse(macroAt))) {
    return formatAgeLabel(macroAt, "更新");
  }
  return formatAgeLabel(input.collectedAt, "更新");
}

function ResearchHeader({ kicker, title, note }: { kicker: string; title: string; note: string }) {
  return <div className="research-header"><div><p className="eyebrow">{kicker}</p><h2>{title}</h2></div><p>{note}</p></div>;
}

function MacroOverviewHeader() {
  return <header className="research-header macro-overview-header">
    <div><p className="eyebrow">MACRO OVERVIEW</p><h2>中国宏观四维概览</h2></div>
    <div className="macro-overview-guide" aria-label="宏观概览阅读说明">
      <p className="macro-overview-guide-lead">先看四个维度的判断与关键证据</p>
      <p className="macro-overview-guide-detail">点击卡片进入相关图表；评分指标、评分标准与本期结果统一在“宏观评级”中查看。</p>
    </div>
  </header>;
}

function MacroChartHeader({ kicker, title, lead, detail }: { kicker: string; title: string; lead: string; detail: string }) {
  return <header className="research-header macro-chart-header">
    <div><p className="eyebrow">{kicker}</p><h2>{title}</h2></div>
    <div className="macro-chart-guide" aria-label={`${title}阅读说明`}>
      <p className="macro-chart-guide-lead">{lead}</p>
      <p className="macro-chart-guide-detail">{detail}</p>
    </div>
  </header>;
}

const display = (value: unknown) => value == null || value === "" ? "—" : String(value);

function ResearchTabs({ items, active, onChange, label }: { items: readonly string[]; active: string; onChange: (item: string) => void; label: string }) {
  return <nav className="subtabs research-subtabs" aria-label={label}>{items.map((item) => <button key={item} className={active === item ? "active" : ""} onClick={() => onChange(item)}>{item}</button>)}</nav>;
}

function AnnualSparkline({ values, label }: { values: number[]; label: string }) {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = high - low || 1;
  const y = (value: number) => 38 - ((value - low) / span) * 30;
  const points = values.map((value, index) => `${8 + index * 26},${y(value)}`).join(" ");
  return <svg className="annual-sparkline" viewBox="0 0 94 46" role="img" aria-label={`${label}，2022 至 2025 年度趋势`}>
    <line x1="5" y1={y(0)} x2="89" y2={y(0)} className="zero-line" />
    <polyline points={points} />
    {values.map((value, index) => <circle key={index} cx={8 + index * 26} cy={y(value)} r="2.6" />)}
  </svg>;
}

function IntrayearChart({ metric, periods, values, unit, precision = 1, approximate = false, breakOnYearChange = false, zeroAxis = false }: { metric: string; periods: string[]; values: number[]; unit: string; precision?: number; approximate?: boolean; breakOnYearChange?: boolean; zeroAxis?: boolean }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chartLeft = 54;
  const chartRight = 550;
  const chartTop = 17;
  const chartBottom = 154;
  const benchmark = zeroAxis ? 0 : metric === "消费者信心指数" ? 100 : metric.includes("PMI") ? 50 : null;
  const floor = Math.min(...values, benchmark ?? Infinity);
  const ceiling = Math.max(...values, benchmark ?? -Infinity);
  const padding = Math.max((ceiling - floor) * 0.18, 0.35);
  const halfRange = benchmark === null ? null : Math.max(Math.abs(floor - benchmark), Math.abs(ceiling - benchmark)) * 1.18;
  const low = benchmark !== null && halfRange !== null ? benchmark - halfRange : floor - padding;
  const high = benchmark !== null && halfRange !== null ? benchmark + halfRange : ceiling + padding;
  const x = (index: number) => chartLeft + (index * (chartRight - chartLeft)) / Math.max(1, values.length - 1);
  const y = (value: number) => chartBottom - ((value - low) / (high - low)) * (chartBottom - chartTop);
  const lineSegments = values.reduce<number[][]>((segments, _value, index) => {
    const year = periods[index].match(/^\d{4}/)?.[0];
    const previousYear = periods[index - 1]?.match(/^\d{4}/)?.[0];
    if (index === 0 || (breakOnYearChange && year && previousYear && year !== previousYear)) segments.push([]);
    segments.at(-1)!.push(index);
    return segments;
  }, []);
  const ticks = benchmark === null ? [low, (low + high) / 2, high] : [low, benchmark, high];
  const reference = benchmark ?? (low <= 0 && high >= 0 ? 0 : null);
  const activeIndex = hoveredIndex ?? selectedIndex;
  const nearestIndex = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * 620;
    return Math.max(0, Math.min(values.length - 1, Math.round(((chartX - chartLeft) / (chartRight - chartLeft)) * (values.length - 1))));
  };
  const tooltipX = activeIndex === null ? 0 : Math.max(72, Math.min(548, x(activeIndex)));
  const tooltipY = activeIndex === null ? 0 : y(values[activeIndex]) < 65 ? y(values[activeIndex]) + 53 : y(values[activeIndex]) - 12;
  return <svg className="intrayear-chart" viewBox="0 0 620 194" role="img" tabIndex={0} aria-label={`${metric}逐期走势。移动鼠标、点击或使用左右方向键查看最近的已发布数据点。${periods.map((period, index) => `${period}${approximate ? "约" : ""}${values[index]}${unit}`).join("，")}`}
    onPointerMove={(event) => setHoveredIndex(nearestIndex(event.clientX, event.currentTarget))}
    onPointerLeave={() => setHoveredIndex(null)}
    onPointerDown={(event) => { if (event.pointerType !== "mouse") setSelectedIndex(nearestIndex(event.clientX, event.currentTarget)); }}
    onClick={(event) => setSelectedIndex(nearestIndex(event.clientX, event.currentTarget))}
    onKeyDown={(event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        setSelectedIndex((current) => Math.max(0, Math.min(values.length - 1, (current ?? (event.key === "ArrowRight" ? -1 : values.length)) + (event.key === "ArrowRight" ? 1 : -1))));
      } else if (event.key === "Escape") setSelectedIndex(null);
    }}>
    <rect x="0" y="0" width="620" height="194" fill="transparent" />
    {ticks.map((tick, index) => <g key={index}><line x1={chartLeft} x2={chartRight} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x={chartLeft - 7} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick.toFixed(precision)}</text></g>)}
    {reference !== null ? <line x1={chartLeft} x2={chartRight} y1={y(reference)} y2={y(reference)} className="intrayear-reference" /> : null}
    {lineSegments.map((indices) => <polyline key={indices[0]} points={indices.map((index) => `${x(index)},${y(values[index])}`).join(" ")} className="intrayear-line" />)}
    {activeIndex !== null ? <line x1={x(activeIndex)} x2={x(activeIndex)} y1={chartTop} y2={chartBottom} className="intrayear-hover-guide" pointerEvents="none" /> : null}
    {values.map((value, index) => <g key={`${periods[index]}-${index}`}><circle cx={x(index)} cy={y(value)} r={activeIndex === index ? 6 : index === values.length - 1 ? 5 : 3.5} className={activeIndex === index ? "intrayear-active-point" : index === values.length - 1 ? "intrayear-last-point" : "intrayear-point"}><title>{periods[index]}：{approximate ? "约" : ""}{value.toFixed(precision)}{unit}</title></circle>{(values.length <= 14 || index % 3 === 0 || index === values.length - 1) ? <text x={x(index)} y="181" textAnchor={index === 0 ? "start" : index === values.length - 1 ? "end" : "middle"} className="intrayear-axis-label">{periods[index]}</text> : null}</g>)}
    {activeIndex !== null ? <g className="intrayear-tooltip" transform={`translate(${tooltipX},${tooltipY})`} pointerEvents="none"><rect x="-64" y="-38" width="128" height="42" rx="7" /><text y="-22" textAnchor="middle">{periods[activeIndex]}</text><text y="-7" textAnchor="middle">{approximate ? "约" : ""}{values[activeIndex].toFixed(precision)}{unit}</text></g> : null}
  </svg>;
}

function IndustrialLineChart({ periods, series, unit, precision = 1, breakBeforeLast = false, zeroCentered = false }: { periods: string[]; series: { name: string; color: string; values: number[] }[]; unit: string; precision?: number; breakBeforeLast?: boolean; zeroCentered?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const allValues = series.flatMap((item) => item.values).filter(Number.isFinite);
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const padding = Math.max((max - min) * 0.18, 1);
  const zeroLimit = Math.max(Math.abs(min), Math.abs(max), 1) * 1.1;
  const low = zeroCentered ? -zeroLimit : min - padding;
  const high = zeroCentered ? zeroLimit : max + padding;
  const left = 64;
  const right = 738;
  const top = 18;
  const bottom = 180;
  const x = (index: number) => left + (index * (right - left)) / Math.max(1, periods.length - 1);
  const y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  const ticks = zeroCentered ? [low, 0, high] : [low, (low + high) / 2, high];
  const nearest = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * 760;
    return Math.max(0, Math.min(periods.length - 1, Math.round(((chartX - left) / (right - left)) * (periods.length - 1))));
  };
  const activeValues = active === null ? null : series.map((item) => ({ name: item.name, color: item.color, value: item.values[active] }));
  return <div className="industrial-chart-wrap">
    <div className="intrayear-chart-scroll"><svg className="industrial-chart" viewBox="0 0 760 222" role="img" tabIndex={0} aria-label={`${periods.join("、")}；${series.map((item) => `${item.name}：${item.values.map((value) => `${value}${unit}`).join("、")}`).join("；")}。指向或点按查看具体数据。`}
      onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onPointerLeave={() => setActive(null)}
      onPointerDown={(event) => { if (event.pointerType !== "mouse") setActive(nearest(event.clientX, event.currentTarget)); }}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(periods.length - 1, (current ?? (event.key === "ArrowRight" ? -1 : periods.length)) + (event.key === "ArrowRight" ? 1 : -1)))); } else if (event.key === "Escape") setActive(null); }}>
      {ticks.map((tick, index) => <g key={index}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick.toFixed(precision)}</text></g>)}
      {zeroCentered ? <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="intrayear-reference" /> : null}
      {series.map((item) => { const lineValues = breakBeforeLast ? item.values.slice(0, -1) : item.values; return <g key={item.name}><polyline points={lineValues.map((value, index) => `${x(index)},${y(value)}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />{item.values.map((value, index) => <circle key={`${item.name}-${index}`} cx={x(index)} cy={y(value)} r={active === index ? 5 : 3} fill={item.color} stroke="#fcfaf7" strokeWidth="1.5"><title>{periods[index]} · {item.name}：{value.toFixed(precision)}{unit}</title></circle>)}</g>; })}
      {active !== null ? <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className="intrayear-hover-guide" pointerEvents="none" /> : null}
      {periods.map((period, index) => <text key={period} x={x(index)} y="204" textAnchor={index === 0 ? "start" : index === periods.length - 1 ? "end" : "middle"} className="intrayear-axis-label">{period}</text>)}
    </svg></div>
    {activeValues ? <div className="macro-chart-readout"><strong>{periods[active!]}</strong>{activeValues.map((item) => <span key={item.name} style={{ color: item.color }}>{item.name}：{item.value.toFixed(precision)}{unit}</span>)}</div> : null}
  </div>;
}

type FinanceSeries = { name: string; color: string; values: (number | null)[] };

function FinanceTrendChart({ periods, series, unit, kind = "line", axisMode = "auto", minPadding, tickPrecision, sourceUrl, breakBeforeIndices = [] }: {
  periods: string[]; series: FinanceSeries[]; unit: string; kind?: "line" | "bar"; axisMode?: "auto" | "zero-centered"; minPadding?: number; tickPrecision?: number; sourceUrl?: (period: string) => string | undefined; breakBeforeIndices?: number[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const allValues = series.flatMap((item) => item.values).filter((value): value is number => value !== null && Number.isFinite(value));
  const minimum = Math.min(...allValues, kind === "bar" ? 0 : Infinity);
  const maximum = Math.max(...allValues, kind === "bar" ? 0 : -Infinity);
  const paddingFloor = minPadding ?? (unit === "%" || unit.includes("百分点") ? 0.5 : 200);
  const padding = Math.max((maximum - minimum) * 0.12, paddingFloor);
  const zeroCenteredLimit = Math.ceil(Math.max(Math.abs(minimum), Math.abs(maximum), 1) * 1.1);
  const low = axisMode === "zero-centered" ? -zeroCenteredLimit : minimum - padding;
  const high = axisMode === "zero-centered" ? zeroCenteredLimit : maximum + padding;
  const left = 58; const right = 742; const top = 18; const bottom = 180;
  const x = (index: number) => left + index * (right - left) / Math.max(1, periods.length - 1);
  const y = (value: number) => bottom - (value - low) * (bottom - top) / (high - low);
  const xStep = (right - left) / Math.max(1, periods.length - 1);
  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const bounds = svg.getBoundingClientRect();
    return Math.max(0, Math.min(periods.length - 1, Math.round((((clientX - bounds.left) / bounds.width) * 760 - left) / (right - left) * (periods.length - 1))));
  };
  const tickIndices = [...new Set([0, Math.floor((periods.length - 1) / 4), Math.floor((periods.length - 1) / 2), Math.floor(3 * (periods.length - 1) / 4), periods.length - 1])];
  const activeRows = active === null ? [] : series.filter((item) => item.values[active] !== null);
  return <div className="finance-trend-wrap">
    <div className="intrayear-chart-scroll"><svg className="finance-trend-svg" viewBox="0 0 760 215" role="img" tabIndex={0} aria-label={`${series.map((item) => item.name).join("、")}逐期走势；移动鼠标、点按或用方向键查看数据`}
      onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onPointerLeave={() => setActive(null)}
      onPointerDown={(event) => { if (event.pointerType !== "mouse") setActive(nearest(event.clientX, event.currentTarget)); }}
      onClick={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(periods.length - 1, (current ?? (event.key === "ArrowRight" ? -1 : periods.length)) + (event.key === "ArrowRight" ? 1 : -1)))); } else if (event.key === "Escape") setActive(null); }}>
      {[low, (low + high) / 2, high].map((tick, index) => <g key={index}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x={left - 6} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{unit === "%" ? tick.toFixed(tickPrecision ?? (high - low < 4 ? 1 : 0)) : Math.round(tick).toLocaleString("zh-CN")}</text></g>)}
      {low < 0 && high > 0 ? <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="intrayear-reference" /> : null}
      {series.map((item, seriesIndex) => kind === "bar" ? <g key={item.name} fill={item.color}>{item.values.map((value, index) => value === null ? null : <rect key={periods[index]} x={x(index) - Math.min(13, xStep * 0.34) + seriesIndex * 2 * Math.min(13, xStep * 0.34) / series.length} y={Math.min(y(value), y(0))} width={Math.max(2, Math.min(13, xStep * 0.34) * 2 / series.length - 1)} height={Math.max(1, Math.abs(y(value) - y(0)))}><title>{periods[index]} · {item.name} {value.toLocaleString("zh-CN")}{unit}</title></rect>)}</g> : <g key={item.name}>
        {item.values.reduce<number[][]>((segments, value, index) => { if (value === null) return segments; if (index === 0 || item.values[index - 1] === null || breakBeforeIndices.includes(index)) segments.push([]); segments.at(-1)!.push(index); return segments; }, []).map((indices) => <polyline key={indices[0]} points={indices.map((index) => `${x(index)},${y(item.values[index]!)}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />)}
        {active !== null && item.values[active] !== null ? <circle cx={x(active)} cy={y(item.values[active]!)} r="4.5" fill={item.color} stroke="white" strokeWidth="1.5" /> : null}
      </g>)}
      {active !== null ? <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className="intrayear-hover-guide" pointerEvents="none" /> : null}
      {tickIndices.map((index) => <text key={periods[index]} x={x(index)} y="204" textAnchor={index === 0 ? "start" : index === periods.length - 1 ? "end" : "middle"} className="intrayear-axis-label">{periods[index]}</text>)}
    </svg></div>
    <div className="finance-trend-legend">{series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
    {active !== null ? <div className="macro-chart-readout"><strong>{periods[active]}</strong>{activeRows.map((item) => <span key={item.name} style={{ color: item.color }}>{item.name}：{item.values[active]!.toLocaleString("zh-CN")}{unit}</span>)}{sourceUrl?.(periods[active]) ? <a href={sourceUrl(periods[active])} target="_blank" rel="noreferrer">本期来源 ↗</a> : null}</div> : null}
  </div>;
}

function FinanceCreditCharts() {
  const [modes, setModes] = useState<Record<string, "month" | "ytd">>({});
  const entries = [
    { key: "householdLong", label: "居民中长期贷款" },
    { key: "householdShort", label: "居民短期贷款" },
    { key: "enterpriseLong", label: "企（事）业单位中长期贷款" },
    { key: "enterpriseShort", label: "企（事）业单位短期贷款" },
  ] as const;
  const sourceByPeriod = new Map(financeCredit.rows.map((row) => [row.period, row.url]));
  return <div className="intrayear-grid-cards finance-credit-grid">{entries.map((entry) => {
    const mode = modes[entry.key] ?? "month";
    const field = mode === "month" ? entry.key : `${entry.key}Ytd` as keyof (typeof financeCredit.rows)[number];
    const values = financeCredit.rows.map((row) => row[field] as number);
    const latest = values.at(-1)!;
    return <article className="intrayear-card" key={entry.key}>
      <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>信贷结构 · {mode === "month" ? "当月增量" : "年初累计"}</span></div><h3>{entry.label}</h3><p>人民银行金融机构人民币贷款分部门口径</p></div><div className="intrayear-latest"><strong>{latest.toLocaleString("zh-CN")} 亿元</strong><small>2026年8月{mode === "month" ? "当月" : "累计"}</small></div></div>
      <div className="intrayear-switch" role="group" aria-label={`${entry.label}统计口径`}><button type="button" aria-pressed={mode === "month"} onClick={() => setModes((current) => ({ ...current, [entry.key]: "month" }))}>当月增量</button><button type="button" aria-pressed={mode === "ytd"} onClick={() => setModes((current) => ({ ...current, [entry.key]: "ytd" }))}>年初累计</button></div>
      <FinanceTrendChart periods={financeCredit.rows.map((row) => row.period)} series={[{ name: entry.label, color: entry.key.includes("Long") ? "#741918" : "#bc9157", values }]} unit="亿元" kind="bar" sourceUrl={(period) => sourceByPeriod.get(period)} />
      <div className="intrayear-card-bottom"><span>{mode === "month" ? "优先采用央行原报当月值；累计披露期差分计算当月，四舍五入可能产生误差" : "每年1月重新起算；2023年部分累计值按原报当月数逐月汇总"}</span><a href={financeCredit.rows.at(-1)?.url} target="_blank" rel="noreferrer">最新央行月报 ↗</a></div>
    </article>;
  })}</div>;
}

function LeverageCharts() {
  const china = leverage.china;
  const periods = china.map((row) => row.period);
  const colors = { china: "#741918", central: "#bc9157", local: "#a6a696", advanced: "#bc9157", emerging: "#a6a696" };
  const bisMap = (key: keyof typeof leverage.bis) => new Map(leverage.bis[key].rows.map((row) => [row.period, row.value]));
  const advancedCorporate = bisMap("corporateAdvanced");
  const advancedHousehold = bisMap("householdAdvanced");
  const advancedGovernment = bisMap("governmentAdvanced");
  const emergingCorporate = bisMap("corporateEmerging");
  const emergingHousehold = bisMap("householdEmerging");
  const emergingGovernment = bisMap("governmentEmerging");
  const cards = [
    { title: "宏观部门杠杆率", start: "2005-Q1", series: [
      { name: "居民部门", color: colors.china, values: china.map((row) => row.household) },
      { name: "非金融企业", color: colors.advanced, values: china.map((row) => row.corporate) },
      { name: "政府部门", color: colors.local, values: china.map((row) => row.government) },
      { name: "中央政府", color: "#d08b4d", values: china.map((row) => row.centralGovernment) },
    ] },
    ...(["corporate", "household", "government"] as const).map((sector) => {
      const title = sector === "corporate" ? "非金融企业部门杠杆率" : sector === "household" ? "居民部门杠杆率" : "政府部门杠杆率";
      const field = sector === "corporate" ? "corporate" : sector === "household" ? "household" : "government";
      const advanced = bisMap(`${sector}Advanced`);
      const emerging = bisMap(`${sector}Emerging`);
      return { title, start: "2011-Q1", series: [
        { name: "中国", color: colors.china, values: china.map((row) => row[field]) },
        { name: "发达经济体（BIS）", color: colors.advanced, values: china.map((row) => advanced.get(row.period) ?? null) },
        { name: "新兴市场（BIS）", color: colors.emerging, values: china.map((row) => emerging.get(row.period) ?? null) },
      ] };
    }),
    { title: "全社会杠杆率（不含金融）", start: "2014-Q2", end: "2026-Q1", series: [
      { name: "中国（CNBS/NIFD）", color: colors.china, values: china.map((row) => row.corporate + row.household + row.government) },
      { name: "发达经济体（BIS）", color: colors.advanced, values: china.map((row) => [advancedCorporate.get(row.period), advancedHousehold.get(row.period), advancedGovernment.get(row.period)].every(Number.isFinite) ? advancedCorporate.get(row.period)! + advancedHousehold.get(row.period)! + advancedGovernment.get(row.period)! : null) },
      { name: "新兴市场（BIS）", color: colors.emerging, values: china.map((row) => [emergingCorporate.get(row.period), emergingHousehold.get(row.period), emergingGovernment.get(row.period)].every(Number.isFinite) ? emergingCorporate.get(row.period)! + emergingHousehold.get(row.period)! + emergingGovernment.get(row.period)! : null) },
    ] },
  ];
  const sourceByPeriod = new Map(china.map((row) => [row.period, row.sourceUrl]));
  return <div className="finance-leverage-section"><div className="intrayear-subgroup-heading"><h4>部门杠杆率 · 存量背景</h4><span>季度数据，不等同于社融当月增量</span></div><div className="intrayear-grid-cards finance-leverage-grid">{cards.map((card) => {
    const firstIndex = periods.indexOf(card.start);
    const endIndex = card.end ? periods.indexOf(card.end) + 1 : periods.length;
    const shownPeriods = periods.slice(firstIndex, endIndex);
    const shownSeries = card.series.map((item) => ({ ...item, values: item.values.slice(firstIndex, endIndex) }));
    const latestBySeries = shownSeries.map((item) => {
      const index = item.values.reduce((last, value, current) => value === null ? last : current, -1);
      return index < 0 ? null : { name: item.name, value: item.values[index], period: shownPeriods[index] };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
    const chinaLatest = latestBySeries[0];
    return <article className="intrayear-card" key={card.title}><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>季度 · 占 GDP 比重</span></div><h3>{card.title}</h3><p>右上角列示各序列最新值及对应季度</p></div><div className="intrayear-latest"><strong>{chinaLatest ? `${chinaLatest.value!.toFixed(1)}%` : "—"}</strong>{chinaLatest ? <small>{chinaLatest.name} · {chinaLatest.period}</small> : null}{latestBySeries.slice(1).map((item) => <small key={item.name}>{item.name} {item.value!.toFixed(1)}% · {item.period}</small>)}</div></div>
      <FinanceTrendChart periods={shownPeriods} series={shownSeries} unit="%" sourceUrl={(period) => sourceByPeriod.get(period)} />
      <div className="intrayear-card-bottom"><span>{card.title === "全社会杠杆率（不含金融）" ? "按居民、非金融企业、政府部门杠杆率求和；国际合计按 BIS 三部门信贷/GDP 求和。中外数据定义不同，侧重趋势对照。" : "中国：CNBS/NIFD；国际：BIS 信贷/GDP，定义不完全相同，仅供趋势对照"}</span><a href="http://www.nifd.cn/SeriesReport/Details/4976" target="_blank" rel="noreferrer">最新季度原报 ↗</a></div>
    </article>;
  })}</div><p className="intrayear-subgroup-note">中国序列以 CNBS 原始下载及后续 NIFD 季报为准，个别历史值按后续报告修订；BIS 发达与新兴经济体为聚合序列，口径不宜与中国直接比较绝对高低。</p></div>;
}

function SocialFinancingCharts() {
  const [view, setView] = useState<"stock" | "flow">("stock");
  const periods = socialFinancing.rows.map((row) => row.period);
  const latest = socialFinancing.rows.at(-1)!;
  const flowRows = socialFinancing.monthlyIncrement.rows;
  const flowLatest = flowRows.at(-1)!;
  const isStock = view === "stock";
  return <><article className="intrayear-card finance-social-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>{isStock ? "社会融资 · 月末存量同比" : "社会融资 · 当月流量"}</span></div><h3>{isStock ? "社融与实体经济人民币贷款增速" : "社会融资规模当月增量"}</h3><p>{isStock ? "看融资余额扩张趋势；同属人民银行社会融资规模存量统计口径" : "看当月融资流量；总量按人民银行社会融资规模增量口径"}</p></div><div className="intrayear-latest"><strong>{isStock ? `${latest.total.toFixed(1)}% / ${latest.rmbLoan.toFixed(1)}%` : `${flowLatest.total.toLocaleString("zh-CN")}亿元`}</strong><small>{isStock ? `${latest.period} 月末 · 社融 / 其中人民币贷款` : `${flowLatest.period} · 当月增量`}</small></div></div>
    <div className="intrayear-switch" role="group" aria-label="社会融资图表口径"><button type="button" aria-pressed={isStock} onClick={() => setView("stock")}>月末存量同比</button><button type="button" aria-pressed={!isStock} onClick={() => setView("flow")}>当月增量</button></div>
    {isStock ? <><FinanceTrendChart periods={periods} series={[{ name: "社融规模存量", color: "#741918", values: socialFinancing.rows.map((row) => row.total) }, { name: "其中：实体经济人民币贷款", color: "#bc9157", values: socialFinancing.rows.map((row) => row.rmbLoan) }]} unit="%" sourceUrl={(period) => socialFinancing.rows.find((row) => row.period === period)?.sourceUrl} />
      <div className="intrayear-card-bottom"><span>其中人民币贷款为社融构成项，不等于金融机构各项人民币贷款增速；报告未核到的月份留空。</span><a href={latest.sourceUrl} target="_blank" rel="noreferrer">{latest.period} 央行月报 ↗</a></div></>
      : <><FinanceTrendChart periods={flowRows.map((row) => row.period)} series={[{ name: "社融当月增量", color: "#741918", values: flowRows.map((row) => row.total) }]} unit="亿元" kind="bar" sourceUrl={(period) => flowRows.find((row) => row.period === period)?.sourceUrl} />
      <div className="intrayear-card-bottom"><span>当月新增融资总量，与存量同比互补；流量有明显季节性，适合作为辅助观察。当前官方在线历史表更新至{flowLatest.period}。</span><a href={socialFinancing.monthlyIncrement.sourceUrl} target="_blank" rel="noreferrer">官方月度数据表 ↗</a></div></>}
  </article><LeverageCharts /></>;
}

function MoneySupplyCards() {
  const rows = moneySupply.rows;
  const displayRows = rows.filter((row) => row.period >= "2024-01");
  const periods = displayRows.map((row) => row.period);
  const latest = displayRows.at(-1)!;
  const monthlySource = (period: string) => rows.find((row) => row.period === period)?.sourceUrl;
  return <div className="finance-money-trends">
    <article className="intrayear-card finance-money-trend-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>货币供给 · 月末余额同比</span></div><h3>M0、M1、M2 增速</h3><p>2024年1月以来；悬停或点按可读当月数值与来源</p></div><div className="intrayear-latest"><strong>M0 {latest.m0.toFixed(1)}%</strong><small>M1 {latest.m1.toFixed(1)}% · M2 {latest.m2.toFixed(1)}%</small><small>{latest.period} · 月末同比</small></div></div>
      <FinanceTrendChart periods={periods} series={[
        { name: "M0 同比", color: "#bc9157", values: displayRows.map((row) => row.m0) },
        { name: "M1 同比（新口径可比序列）", color: "#d07835", values: displayRows.map((row) => row.m1) },
        { name: "M2 同比", color: "#7c8d88", values: displayRows.map((row) => row.m2) },
      ]} unit="%" sourceUrl={monthlySource} />
      <div className="intrayear-card-bottom"><span>趋势图统一从2024年1月展示；M1采用央行新口径及其回溯可比序列。M0自2022年12月起含流通中数字人民币；更早历史数据仍保留在底层资料中。</span><a href={moneySupply.m1RevisionSource} target="_blank" rel="noreferrer">央行 M1 口径及回溯数据 ↗</a></div>
    </article>
    <article className="intrayear-card finance-money-trend-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>资金活化 · 同比差值</span></div><h3>M1－M2 剪刀差</h3><p>2024年1月以来；M1 同比减 M2 同比，单位为百分点</p></div><div className="intrayear-latest"><strong>{latest.scissors > 0 ? "+" : ""}{latest.scissors.toFixed(1)} 个百分点</strong><small>{latest.period} · 月末同比差值</small></div></div>
      <FinanceTrendChart periods={periods} series={[
        { name: "M1－M2 剪刀差", color: "#d07835", values: displayRows.map((row) => row.scissors) },
      ]} unit=" 个百分点" axisMode="zero-centered" sourceUrl={monthlySource} />
      <div className="intrayear-card-bottom"><span>只展示2024年1月及以后数据，剪刀差由同月 M1、M2 官方同比相减；更早月份不在此图显示。</span><a href={moneySupply.m1RevisionSource} target="_blank" rel="noreferrer">央行 M1 口径及回溯数据 ↗</a></div>
    </article>
  </div>;
}

function MacroPolicyCharts({ section }: { section: "货币政策" | "财政政策" }) {
  if (section === "货币政策") {
    const lpr = macroPolicy.lpr.rows;
    const bond = macroPolicy.bond.rows;
    return <div className="intrayear-grid-cards finance-credit-grid">
      <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>货币政策 · 月度报价</span></div><h3>贷款市场报价利率</h3><p>1年期、5年期以上 LPR；2019年8月新机制起</p></div><div className="intrayear-latest"><strong>{lpr.at(-1)?.oneYear.toFixed(2)}% / {lpr.at(-1)?.fiveYear.toFixed(2)}%</strong><small>{lpr.at(-1)?.date} · 1年 / 5年以上</small></div></div><FinanceTrendChart periods={lpr.map((row) => row.period)} series={[{ name: "1年期 LPR", color: "#bc9157", values: lpr.map((row) => row.oneYear) }, { name: "5年期以上 LPR", color: "#741918", values: lpr.map((row) => row.fiveYear) }]} unit="%" sourceUrl={(period) => lpr.find((row) => row.period === period)?.url} /><div className="intrayear-card-bottom"><span>{macroPolicy.mlfNote.text}</span><a href={macroPolicy.mlfNote.url} target="_blank" rel="noreferrer">人民银行口径说明 ↗</a></div></article>
      <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>货币政策 · 月末交易日</span></div><h3>中债国债收益率曲线</h3><p>1年、10年、30年期；每月最后可得交易日</p></div><div className="intrayear-latest"><strong>{bond.at(-1)?.tenYear.toFixed(2)}%</strong><small>{bond.at(-1)?.date} · 10年期</small></div></div><FinanceTrendChart periods={bond.map((row) => row.period)} series={[{ name: "1年期", color: "#bc9157", values: bond.map((row) => row.oneYear) }, { name: "10年期", color: "#741918", values: bond.map((row) => row.tenYear) }, { name: "30年期", color: "#7e8d87", values: bond.map((row) => row.thirtyYear) }]} unit="%" sourceUrl={(period) => bond.find((row) => row.period === period)?.url} /><div className="intrayear-card-bottom"><span>{macroPolicy.bond.basis}；此图为市场收益率，不等同央行政策利率。</span><a href={macroPolicy.bond.source} target="_blank" rel="noreferrer">中债原始曲线 ↗</a></div></article>
    </div>;
  }
  const fiscal = macroPolicy.fiscal.rows;
  const specialBonds = macroPolicy.specialBondIssuance.rows;
  const targets = macroPolicy.deficitTarget.rows;
  const imf = macroPolicy.imfDeficit.rows.filter((row) => row.year >= 2022);
  return <div className="intrayear-grid-cards finance-credit-grid">
    <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>财政政策 · 年初累计同比</span></div><h3>全国一般公共预算收入与支出</h3><p>财政部月度原始发布；1—2月合并</p></div><div className="intrayear-latest"><strong>{fiscal.at(-1)?.income.toFixed(1)}% / {fiscal.at(-1)?.expense.toFixed(1)}%</strong><small>{fiscal.at(-1)?.period} · 收入 / 支出</small></div></div><FinanceTrendChart periods={fiscal.map((row) => row.period)} series={[{ name: "收入累计同比", color: "#bc9157", values: fiscal.map((row) => row.income) }, { name: "支出累计同比", color: "#741918", values: fiscal.map((row) => row.expense) }]} unit="%" kind="bar" sourceUrl={(period) => fiscal.find((row) => row.period === period)?.url} /><div className="intrayear-card-bottom"><span>{macroPolicy.fiscal.basis}；同一年内逐月累计，跨年重新起算。</span><a href={fiscal.at(-1)?.url} target="_blank" rel="noreferrer">最新财政部月报 ↗</a></div></article>
    <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>财政政策 · 年初累计发行</span></div><h3>新增地方专项债发行</h3><p>只看新增专项债，不混入再融资债券</p></div><div className="intrayear-latest"><strong>{specialBonds.at(-1)?.amount.toLocaleString("zh-CN")}亿元</strong><small>{specialBonds.at(-1)?.period} · 年初累计</small></div></div><FinanceTrendChart periods={specialBonds.map((row) => row.period)} series={[{ name: "新增专项债累计发行", color: "#741918", values: specialBonds.map((row) => row.amount) }]} unit="亿元" sourceUrl={(period) => specialBonds.find((row) => row.period === period)?.url} /><div className="intrayear-card-bottom"><span>{macroPolicy.specialBondIssuance.basis}</span><a href={specialBonds.at(-1)?.url} target="_blank" rel="noreferrer">财政部最新发行报告 ↗</a></div></article>
    <article className="intrayear-card fiscal-deficit-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>财政政策 · 年度目标与预测</span></div><h3>财政赤字率观察</h3><p>官方预算目标与 IMF 广义政府口径并列查看</p></div><div className="intrayear-latest"><strong>约{targets.at(-1)?.target.toFixed(1)}%</strong><small>2026年全国预算赤字率目标</small></div></div><div className="fiscal-deficit-charts"><div><div className="intrayear-card-top"><p className="intrayear-subgroup-note">全国预算安排目标</p><div className="intrayear-latest"><strong>{targets.at(-1)?.target.toFixed(1)}%</strong><small>{targets.at(-1)?.year}年</small></div></div><FinanceTrendChart periods={targets.map((row) => String(row.year))} series={[{ name: "官方预算赤字率目标", color: "#bc9157", values: targets.map((row) => row.target) }]} unit="%" sourceUrl={(period) => targets.find((row) => String(row.year) === period)?.url} /></div><div><div className="intrayear-card-top"><p className="intrayear-subgroup-note">IMF 广义政府净借入预测及历史估计</p><div className="intrayear-latest"><strong>{imf.at(-1)?.deficit.toFixed(1)}%</strong><small>{imf.at(-1)?.year}年 · IMF</small></div></div><FinanceTrendChart periods={imf.map((row) => String(row.year))} series={[{ name: "IMF 广义政府赤字率", color: "#741918", values: imf.map((row) => row.deficit) }]} unit="%" sourceUrl={() => macroPolicy.imfDeficit.source} /></div></div><div className="intrayear-card-bottom"><span>{macroPolicy.imfDeficit.basis}</span><a href={macroPolicy.imfDeficit.source} target="_blank" rel="noreferrer">IMF 原始数据 ↗</a></div></article>
  </div>;
}

function IndustrialMetricsCharts() {
  const margin = intrayear.industrialProfitMargin;
  const inventory = intrayear.industrialInventoryDays;
  const capacity = intrayear.industrialCapacityUtilization;
  const valueAdded = intrayear.industrialValueAddedCumulative;
  const ownershipNote = (current: { period: string; values: number[] }, labels: { name: string; color: string }[], unit: string, precision: number) => <div className="industrial-current-readout"><strong>{current.period} · 最新观测（不与年度线连接）</strong><div>{labels.map((item, index) => <span key={item.name}><i style={{ background: item.color }} />{item.name} {current.values[index].toFixed(precision)}{unit}</span>)}</div></div>;
  return <section className="industrial-observations" aria-label="工业生产经营观察">
    <div className="industrial-observations-heading"><div><h4>工业生产 · 经营与产能观察</h4><p>年度历史与最新年内读数分开，避免把全年值和年内累计/期末值连成一条线。</p></div><span>国家统计局官方数据</span></div>
    <div className="intrayear-grid-cards industrial-chart-grid">
      <article className="intrayear-card industrial-observation-card">
        <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>企业效益 · 年度</span></div><h3>规模以上工业企业营业收入利润率</h3><p>2015—2025 年度值；按企业所有制对照</p></div></div>
        <div className="macro-chart-legend">{margin.series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
        <IndustrialLineChart periods={margin.years.map(String)} series={margin.series} unit={margin.unit} precision={2} />
        <div className="industrial-monthly-heading"><strong>2026 年内逐期观察</strong><span>利润率为年初累计值，不是单月值</span></div>
        <IndustrialLineChart periods={margin.currentYear.periods} series={margin.currentYear.series} unit={margin.currentYear.unit} precision={2} />
        {ownershipNote(margin.current, margin.series, margin.unit, 2)}
        <div className="intrayear-card-bottom"><span>2015—2018 年原表称“主营业务收入利润率”，2019 年起称“营业收入利润率”；按利润/收入比例展示。移动鼠标或点按 2026 年内曲线查看各期值。</span><span>{margin.currentYear.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">{margin.currentYear.periods[index]} ↗{index < margin.currentYear.sourceUrls.length - 1 ? " · " : ""}</a>)}</span></div>
      </article>
      <article className="intrayear-card industrial-observation-card">
        <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>库存效率 · 年末</span></div><h3>产成品周转天数</h3><p>2015—2025 年末值；按企业所有制对照</p></div></div>
        <div className="macro-chart-legend">{inventory.series.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}</span>)}</div>
        <IndustrialLineChart periods={inventory.years.map(String)} series={inventory.series} unit={inventory.unit} precision={1} />
        <div className="industrial-monthly-heading"><strong>2026 年内逐月观察</strong><span>月末值</span></div>
        <IndustrialLineChart periods={inventory.currentYear.periods} series={inventory.currentYear.series} unit={inventory.currentYear.unit} precision={1} />
        {ownershipNote(inventory.current, inventory.series, inventory.unit, 1)}
        <div className="intrayear-card-bottom"><span>年度点为年末值；2026 年按月末值展示。2022 年起统计局计算说明采用营业成本口径，口径提示保留。</span><span>{inventory.currentYear.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">{inventory.currentYear.periods[index]} ↗{index < inventory.currentYear.sourceUrls.length - 1 ? " · " : ""}</a>)}</span></div>
      </article>
      <article className="intrayear-card industrial-observation-card">
        <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>产能利用 · 季度</span></div><h3>工业产能利用率</h3><p>年度历史以 Q4 对照；保留最近六个季度看年内变化</p></div><div className="intrayear-latest"><strong>{capacity.values.at(-1)!.toFixed(1)}{capacity.unit}</strong><small>{capacity.periods.at(-1)}</small></div></div>
        <IndustrialLineChart periods={capacity.periods} series={[{ name: "工业产能利用率", color: "#741918", values: capacity.values }]} unit={capacity.unit} precision={1} breakBeforeLast />
        <div className="industrial-monthly-heading"><strong>最近六季逐期观察</strong><span>官方按季度发布</span></div>
        <IndustrialLineChart periods={capacity.recentPeriods} series={[{ name: "工业产能利用率", color: "#741918", values: capacity.recentValues }]} unit={capacity.unit} precision={1} />
        <div className="intrayear-card-bottom"><span>产能利用率不是月度指标；不补造月值。移动鼠标或点按最近季度曲线可查看统计期和值。</span><span>{capacity.recentSourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">{capacity.recentPeriods[index]} ↗{index < capacity.recentSourceUrls.length - 1 ? " · " : ""}</a>)}</span></div>
      </article>
      <article className="intrayear-card industrial-observation-card">
        <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>工业增加值 · 累计同比</span></div><h3>规模以上工业增加值累计同比</h3><p>年初至当期累计实际同比；逐期展示当年累计进度</p></div><div className="intrayear-latest"><strong>{valueAdded.values.at(-1)!.toFixed(1)}{valueAdded.unit}</strong><small>{valueAdded.periods.at(-1)}</small></div></div>
        <IndustrialLineChart periods={valueAdded.periods} series={[{ name: "累计同比", color: "#bc9157", values: valueAdded.values }]} unit={valueAdded.unit} precision={1} zeroCentered />
        <div className="intrayear-card-bottom"><span>年初累计同比每年重新起算；本图仅展示 2026 年 1—8 月，不与其他年度累计值拼接。</span><span>{valueAdded.sourceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">{valueAdded.periods[index]} ↗{index < valueAdded.sourceUrls.length - 1 ? " · " : ""}</a>)}</span></div>
      </article>
    </div>
    <details className="intrayear-source-details industrial-source-details"><summary>查看年度原始发布（2015—2025）</summary><div>{intrayear.industrialAnnualSources.map((source) => <a key={source.year} href={source.url} target="_blank" rel="noreferrer">{source.year} 年统计局原表 ↗</a>)}</div></details>
  </section>;
}

function RealEstateSupplyChart() {
  const { rows } = realEstateSupplyHistory;
  const { basis, unit } = realEstate.supply;
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const left = 80;
  const right = 1460;
  const bottom = 216;
  const x = (index: number) => left + (index * (right - left)) / (rows.length - 1);
  const salesY = (value: number) => bottom - (value / 200000) * 170;
  const unsoldY = (value: number) => bottom - ((value - 45000) / 40000) * 170;
  const nearest = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.round(((((clientX - bounds.left) / bounds.width) * 1540 - left) / (right - left)) * (rows.length - 1))));
  };
  return <article className="intrayear-card macro-wide-card real-estate-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>房地产 · 供需</span></div><h3>商品房销售与待售面积</h3><p>2014—2026 年逐月观测；销售为年初累计，待售为月末存量</p></div><div className="intrayear-latest"><strong>{row.unsoldEnd.toLocaleString("zh-CN")} 万平方米</strong><small>{row.period} 月末待售</small></div></div>
    <div className="macro-chart-legend"><span><i style={{ background: "#bc9157" }} />新建商品房销售面积 · 累计</span><span><i style={{ background: "#741918" }} />商品房待售面积 · 月末</span></div>
    <div className="intrayear-chart-scroll"><svg className="real-estate-chart real-estate-supply-chart" viewBox="0 0 1540 265" role="img" tabIndex={0} aria-label="2014至2026年商品房销售面积累计值与待售面积月末值；移动鼠标、点按或使用方向键逐期查看"
      onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onPointerDown={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect width="1540" height="265" fill="transparent" />
      <text x={left} y="22" className="intrayear-axis-label">销售累计 · {unit}</text><text x={right} y="22" textAnchor="end" className="intrayear-axis-label">待售月末 · {unit}</text>
      {[0, 50000, 100000, 150000, 200000].map((tick) => <g key={tick}><line x1={left} x2={right} y1={salesY(tick)} y2={salesY(tick)} className="intrayear-grid" /><text x={left - 9} y={salesY(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick / 10000}万</text></g>)}
      {[50000, 60000, 70000, 80000].map((tick) => <text key={tick} x={right + 8} y={unsoldY(tick) + 4} className="intrayear-axis-label">{tick / 10000}万</text>)}
      {rows.map((item, index) => item.period.endsWith("-02") && index > 0 ? <line key={`${item.period}-divider`} x1={x(index) - 5} x2={x(index) - 5} y1="43" y2={bottom} className="real-estate-year-divider" /> : null)}
      {rows.map((item, index) => <rect key={item.period} x={x(index) - 3} y={salesY(item.salesCumulative)} width="6" height={bottom - salesY(item.salesCumulative)} className="real-estate-sales-bar"><title>{item.period}累计销售面积：{item.salesCumulative.toLocaleString("zh-CN")}{unit}</title></rect>)}
      <polyline points={rows.map((item, index) => `${x(index)},${unsoldY(item.unsoldEnd)}`).join(" ")} className="real-estate-unsold-line" />
      {rows.map((item, index) => <circle key={`${item.period}-stock`} cx={x(index)} cy={unsoldY(item.unsoldEnd)} r={active === index ? 6 : 4} className="real-estate-unsold-point"><title>{item.period}末待售面积：{item.unsoldEnd.toLocaleString("zh-CN")}{unit}</title></circle>)}
      <line x1={x(active)} x2={x(active)} y1="43" y2={bottom} className="intrayear-hover-guide" pointerEvents="none" />
      {rows.map((item, index) => item.period.endsWith("-02") || index === rows.length - 1 ? <text key={`${item.period}-label`} x={x(index)} y="242" textAnchor="middle" className="intrayear-axis-label">{index === rows.length - 1 ? "26年8月" : item.period.slice(2, 4) + "年"}</text> : null)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.period}</strong><span>累计销售：{row.salesCumulative.toLocaleString("zh-CN")} {unit}</span><span>月末待售：{row.unsoldEnd.toLocaleString("zh-CN")} {unit}</span>{"officialPressUrl" in row ? <a href={row.officialPressUrl} target="_blank" rel="noreferrer">当期统计局原表 ↗</a> : <span>待售：Wind S0029672 补充</span>}</div>
    <div className="intrayear-card-bottom"><span>{basis} 销售逐月值来自国家统计局数据平台；待售历史来自 Wind S0029672（原始机构：国家统计局），2025—2026 年 18 期与统计局月报一致。</span><a href={realEstate.supply.rows.at(-1)!.url} target="_blank" rel="noreferrer">最新官方发布 ↗</a></div>
  </article>;
}

function RealEstatePriceChart() {
  const { rows, basis } = realEstate.prices;
  const [mode, setMode] = useState<"yoy" | "mom">("yoy");
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const isYoy = mode === "yoy";
  const cityValue = (item: typeof row) => isYoy ? item.city70Yoy : item.city70Mom;
  const tierValue = (item: typeof row) => isYoy ? item.tier1Yoy : item.tier1Mom;
  const values = rows.flatMap((item) => [cityValue(item), tierValue(item)]);
  const zeroLimit = Math.max(Math.abs(Math.min(...values)), Math.abs(Math.max(...values)), isYoy ? 0.5 : 0.1) * 1.12;
  const low = -zeroLimit;
  const high = zeroLimit;
  const left = 67;
  const right = 709;
  const top = 35;
  const bottom = 211;
  const x = (index: number) => left + (index * (right - left)) / (rows.length - 1);
  const y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  const nearest = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.round(((((clientX - bounds.left) / bounds.width) * 760 - left) / (right - left)) * (rows.length - 1))));
  };
  const axes = [low, 0, high];
  return <article className="intrayear-card macro-wide-card real-estate-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>房地产 · 价格</span></div><h3>新建商品住宅价格变化</h3><p>70 城等权均值与一线城市；同比、环比分开查看</p></div><div className="intrayear-latest"><strong>{tierValue(row).toFixed(1)}%</strong><small>{row.period}一线城市{isYoy ? "同比" : "环比"}</small></div></div>
    <div className="intrayear-switch" role="group" aria-label="房价变化统计口径"><button type="button" aria-pressed={isYoy} onClick={() => setMode("yoy")}>当月同比</button><button type="button" aria-pressed={!isYoy} onClick={() => setMode("mom")}>当月环比</button></div>
    <div className="macro-chart-legend"><span><i style={{ background: "#741918" }} />70 城等权均值 · 自算</span><span><i style={{ background: "#bc9157" }} />一线城市 · 官方发布</span></div>
    <div className="intrayear-chart-scroll"><svg className="real-estate-chart" viewBox="0 0 760 260" role="img" tabIndex={0} aria-label={`2026年新建商品住宅价格${isYoy ? "当月同比" : "当月环比"}；移动鼠标、点按或使用方向键逐月查看`}
      onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onPointerDown={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect width="760" height="260" fill="transparent" />
      <text x={left} y="22" className="intrayear-axis-label">{isYoy ? "当月同比" : "当月环比"} · %</text>
      {axes.map((tick, index) => <g key={index}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick.toFixed(1)}</text></g>)}
      <line x1={left} x2={right} y1={y(0)} y2={y(0)} className="intrayear-reference" />
      <polyline points={rows.map((item, index) => `${x(index)},${y(cityValue(item))}`).join(" ")} className="real-estate-city-line" />
      <polyline points={rows.map((item, index) => `${x(index)},${y(tierValue(item))}`).join(" ")} className="real-estate-tier-line" />
      {rows.map((item, index) => <g key={item.period}><circle cx={x(index)} cy={y(cityValue(item))} r={active === index ? 6 : 4} className="real-estate-city-point"><title>{item.period}70 城等权均值{isYoy ? "同比" : "环比"}：{cityValue(item).toFixed(2)}%</title></circle><circle cx={x(index)} cy={y(tierValue(item))} r={active === index ? 6 : 4} className="real-estate-tier-point"><title>{item.period}一线城市{isYoy ? "同比" : "环比"}：{tierValue(item).toFixed(1)}%</title></circle><text x={x(index)} y="239" textAnchor="middle" className="intrayear-axis-label">{index + 1}月</text></g>)}
      <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className="intrayear-hover-guide" pointerEvents="none" />
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.period} · {isYoy ? "同比" : "环比"}</strong><span>70 城等权：{cityValue(row).toFixed(2)}%</span><span>一线城市：{tierValue(row).toFixed(1)}%</span><a href={row.tableUrl} target="_blank" rel="noreferrer">70 城原表 ↗</a><a href={row.tier1Url} target="_blank" rel="noreferrer">一线城市解读 ↗</a></div>
    <div className="intrayear-card-bottom"><span>{basis}</span><span>来源：国家统计局 · 复核 {realEstate.reviewedAt}</span></div>
  </article>;
}

function RealEstateCharts() {
  return <section className="real-estate-observations" aria-label="房地产供需与价格逐期观察"><RealEstateSupplyChart /><RealEstatePriceChart /></section>;
}

function PopulationStructureChart() {
  const rows = additional.population.rows.filter((item) => item[0] >= 2015);
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const colors = ["#b9bba9", "#bc9157", "#741918"];
  const names = ["0—14岁", "15—64岁", "65岁及以上"];
  const x = (index: number) => 42 + index * 64;
  const barWidth = 30;
  return <article className="intrayear-card macro-wide-card population-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>就业市场 · 年度结构</span></div><h3>人口结构占比</h3><p>2015—2025 年末，按年龄组统计</p></div><div className="intrayear-latest"><strong>{row[0]} 年</strong><small>指向、点按柱体或用方向键查看</small></div></div>
    <div className="macro-chart-legend">{names.map((name, index) => <span key={name}><i style={{ background: colors[index] }} />{name}</span>)}</div>
    <div className="intrayear-chart-scroll"><svg className="population-chart" viewBox="0 0 740 260" role="img" tabIndex={0} aria-label={`2015至2025年人口结构百分比堆叠柱图；当前选中${row[0]}年，0至14岁${row[1].toFixed(1)}%，15至64岁${row[2].toFixed(1)}%，65岁及以上${row[3].toFixed(1)}%`}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line x1="35" x2="730" y1={222 - tick * 1.9} y2={222 - tick * 1.9} className="intrayear-grid" /><text x="30" y={226 - tick * 1.9} textAnchor="end" className="intrayear-axis-label">{tick}</text></g>)}
      {rows.map((item, index) => { const sum = item[1] + item[2] + item[3]; let bottom = 222; return <g key={item[0]} onPointerEnter={() => setActive(index)} onClick={() => setActive(index)} className={active === index ? "population-active" : ""}>
        {[3, 2, 1].map((part) => { const height = (item[part] / sum) * 190; bottom -= height; return <rect key={part} x={x(index)} y={bottom} width={barWidth} height={height} fill={colors[part - 1]}><title>{item[0]}年 {names[part - 1]}：{item[part].toFixed(1)}%</title></rect>; })}
        <rect x={x(index)} y="32" width={barWidth} height="190" fill="transparent" />
        {index % 2 === 0 || index === rows.length - 1 ? <text x={x(index) + barWidth / 2} y="240" textAnchor="middle" className="intrayear-axis-label">{item[0]}</text> : null}
      </g>; })}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row[0]} 年</strong>{names.map((name, index) => <span key={name}>{name}：{row[index + 1].toFixed(1)}%</span>)}</div>
    <div className="intrayear-card-bottom"><span>国家统计局年鉴；2025 年按年末公报人数计算，占比四舍五入。年龄结构不是劳动参与率。</span><span><a href={additional.population.yearbookUrl} target="_blank" rel="noreferrer">1990—2024 年鉴 ↗</a> · <a href={additional.population.latestUrl} target="_blank" rel="noreferrer">2025 公报 ↗</a></span></div>
  </article>;
}

function PopulationChangeChart() {
  const rows = additional.demographics.naturalHistory.filter((item) => item.year >= 2015);
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const latest = rows.at(-1)!;
  const left = 110;
  const right = 704;
  const x = (index: number) => left + (index * (right - left)) / (rows.length - 1);
  const populationY = (value: number) => 127 - ((value - 138000) / 4000) * 90;
  const naturalY = (value: number) => 255 - value * 10.8;
  const nearest = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.round((((clientX - bounds.left) / bounds.width) * 740 - left) / (right - left) * (rows.length - 1))));
  };
  return <article className="intrayear-card macro-wide-card demographic-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>就业市场 · 年度人口变化</span></div><h3>人口总量与自然增长率</h3><p>2015—2025 年同一时间轴；上下分图、分别标注万人和千分率</p></div><div className="intrayear-latest"><strong>{latest.populationWan.toLocaleString("zh-CN")} 万人</strong><small>{latest.year} 年末 · 自然增长率 {latest.rate.toFixed(2)}‰</small></div></div>
    <div className="macro-chart-legend"><span><i style={{ background: "#bc9157" }} />年末人口 · 万人</span><span><i style={{ background: "#741918" }} />自然增长率 · ‰</span></div>
    <div className="intrayear-chart-scroll"><svg className="demographic-chart" viewBox="0 0 740 322" role="img" tabIndex={0} aria-label={`2015至2025年人口总量与自然增长率分区年度图；当前${row.year}年末人口${row.populationWan}万人，自然增长率${row.rate}千分之；移动、点按或方向键查看各年`}
      onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onPointerDown={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect x="0" y="0" width="740" height="322" fill="transparent" />
      <rect x={x(active) - 15} y="28" width="30" height="265" fill="#bc915716" pointerEvents="none" />
      <text x={left} y="18" className="intrayear-axis-label">年末人口 · 万人</text>
      {[138000, 140000, 142000].map((tick) => <g key={tick}><line x1={left} x2={right} y1={populationY(tick)} y2={populationY(tick)} className="intrayear-grid" /><text x="88" y={populationY(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick.toLocaleString("zh-CN")}</text></g>)}
      <polyline points={rows.map((item, index) => `${x(index)},${populationY(item.populationWan)}`).join(" ")} className="demographic-population-line" />
      {rows.map((item, index) => <circle key={item.year} cx={x(index)} cy={populationY(item.populationWan)} r={active === index ? 5 : 3} className="demographic-population-point"><title>{item.year} 年末人口：{item.populationWan.toLocaleString("zh-CN")} 万人</title></circle>)}
      <text x={left} y="151" className="intrayear-axis-label">自然增长率 · ‰</text>
      {[8, 4, 0, -2].map((tick) => <g key={tick}><line x1={left} x2={right} y1={naturalY(tick)} y2={naturalY(tick)} className={tick === 0 ? "intrayear-reference" : "intrayear-grid"} /><text x="88" y={naturalY(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}</text></g>)}
      {rows.map((item, index) => <g key={item.year} onPointerEnter={() => setActive(index)} onClick={() => setActive(index)}><rect x={x(index) - 10} y={Math.min(naturalY(0), naturalY(item.rate))} width="20" height={Math.abs(naturalY(0) - naturalY(item.rate))} className="demographic-natural-bar" opacity={active === index ? 1 : .78}><title>{item.year} 年人口自然增长率：{item.rate.toFixed(item.year >= 2021 ? 2 : 1)}‰</title></rect><rect x={x(index) - 16} y="29" width="32" height="265" fill="transparent" />{index % 2 === 0 || index === rows.length - 1 ? <text x={x(index)} y="309" textAnchor="middle" className="intrayear-axis-label">{item.year}</text> : null}</g>)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.year} 年</strong><span>年末人口：{row.populationWan.toLocaleString("zh-CN")} 万人</span><span>自然增长率：{row.rate.toFixed(row.year <= 2010 || row.year >= 2021 ? 2 : 1)}‰</span><a href={row.populationUrl ?? row.url} target="_blank" rel="noreferrer">人口来源 ↗</a><a href={row.url} target="_blank" rel="noreferrer">增长率来源 ↗</a></div>
    <div className="intrayear-card-bottom"><span>两图区分人口总量与自然增长率，各用独立纵轴；自然增长率不是总人口同比增速。2015—2020 年自然增长率原表为一位小数。</span></div>
  </article>;
}

function UrbanizationChart() {
  const rows = additional.demographics.rows.filter((item) => item.year >= 2015);
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const left = 66;
  const right = 720;
  const x = (index: number) => left + (index * (right - left)) / (rows.length - 1);
  const y = (value: number) => 176 - ((value - 54) / 16) * 142;
  const nearest = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    return Math.max(0, Math.min(rows.length - 1, Math.round((((clientX - bounds.left) / bounds.width) * 740 - left) / (right - left) * (rows.length - 1))));
  };
  return <article className="intrayear-card demographic-card urbanization-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>就业市场 · 年度指标</span></div><h3>常住人口城镇化率</h3><p>2015—2025 年末；2020 年为第七次人口普查口径</p></div><div className="intrayear-latest"><strong>{row.urbanizationRate.toFixed(2)}%</strong><small>{row.year} 年末</small></div></div>
    <div className="intrayear-chart-scroll"><svg className="demographic-chart" viewBox="0 0 740 220" role="img" tabIndex={0} aria-label={`2015至2025年末常住人口城镇化率走势；当前${row.year}年${row.urbanizationRate.toFixed(2)}%；2019至2020年以虚线标注普查口径衔接；移动、点按或方向键查看各年`}
      onPointerMove={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onPointerDown={(event) => setActive(nearest(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect x="0" y="0" width="740" height="220" fill="transparent" />
      {[55, 60, 65, 70].map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x="48" y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}%</text></g>)}
      {[rows.filter((item) => item.year <= 2019), rows.filter((item) => item.year >= 2020)].map((segment) => <polyline key={segment[0].year} points={segment.map((item) => `${x(rows.indexOf(item))},${y(item.urbanizationRate)}`).join(" ")} className="demographic-urban-line" />)}
      <line x1={x(rows.findIndex((item) => item.year === 2019))} y1={y(rows.find((item) => item.year === 2019)!.urbanizationRate)} x2={x(rows.findIndex((item) => item.year === 2020))} y2={y(rows.find((item) => item.year === 2020)!.urbanizationRate)} className="demographic-urban-transition" />
      {rows.map((item, index) => <g key={item.year} onPointerEnter={() => setActive(index)} onClick={() => setActive(index)}><circle cx={x(index)} cy={y(item.urbanizationRate)} r={active === index ? 6 : 4} className="demographic-urban-point"><title>{item.year} 年末城镇化率：{item.urbanizationRate.toFixed(2)}%</title></circle><rect x={x(index) - 23} y="24" width="46" height="168" fill="transparent" />{index % 2 === 0 || index === rows.length - 1 ? <text x={x(index)} y="210" textAnchor="middle" className="intrayear-axis-label">{item.year}</text> : null}</g>)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.year} 年末</strong><span>常住人口城镇化率：{row.urbanizationRate.toFixed(2)}%</span><a href={row.url} target="_blank" rel="noreferrer">当年国家统计局发布 ↗</a></div>
    <div className="intrayear-card-bottom"><span>年度数据，2015—2019 年为当年公报值；2020 年起按第七次人口普查及后续公报。2019—2020 年的虚线表示统计口径衔接，不应将两点差额全视为单年城镇化增幅。</span></div>
  </article>;
}

function InwardFdiChart() {
  const rows = additional.inwardFdi.rows;
  const annualRows = additional.inwardFdi.annualRows;
  const [active, setActive] = useState(rows.length - 1);
  const [annualActive, setAnnualActive] = useState(annualRows.length - 1);
  const [mode, setMode] = useState<"monthly" | "annual">("monthly");
  const annualLimit = Math.max(10, Math.ceil(Math.max(...annualRows.map((item) => Math.abs(item.yoy))) / 5) * 5);
  const monthlyYoyLimit = Math.max(10, Math.ceil(Math.max(...rows.map((item) => Math.abs(item.yoy))) / 5) * 5);
  const annualY = (value: number) => 108 - (value / annualLimit) * 72;
  const row = rows[active];
  const x = (index: number) => 58 + index * 73;
  const amountY = (value: number) => 186 - value / 5200 * 145;
  const yoyY = (value: number) => 108 - (value / monthlyYoyLimit) * 72;
  const selectedAnnual = annualRows[annualActive];
  return <article className="intrayear-card macro-wide-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>投资 · 实际使用外资</span></div><h3>外商直接投资</h3><p>{mode === "monthly" ? "2026 年人民币累计金额（柱）与累计同比（线），双轴分别标注" : "2018 年以来全国实际使用外资年度同比"}<br /><span>不是中国对外直接投资</span></p>
      <div className="intrayear-switch" role="group" aria-label="外商直接投资统计周期"><button type="button" aria-pressed={mode === "monthly"} onClick={() => setMode("monthly")}>月度累计同比</button><button type="button" aria-pressed={mode === "annual"} onClick={() => setMode("annual")}>年度同比</button></div>
    </div><div className="intrayear-latest">{mode === "monthly" ? <><strong>{row.amount.toFixed(1)} 亿元</strong><small>{row.period}累计 · 同比 {row.yoy.toFixed(1)}%</small></> : <><strong>{selectedAnnual.yoy.toFixed(1)}%</strong><small>{selectedAnnual.year} 年 · {selectedAnnual.amount.toLocaleString("zh-CN")} 亿元</small></>}</div></div>
    {mode === "monthly" ? <>
    <div className="macro-chart-legend"><span><i style={{ background: "#bc9157" }} />实际使用外资 · 亿元</span><span><i style={{ background: "#741918" }} />累计同比 · %</span></div>
    <div className="intrayear-chart-scroll"><svg className="fdi-chart" viewBox="0 0 620 232" role="img" tabIndex={0} aria-label={`2026年实际使用外资金额和累计同比；当前${row.period}累计${row.amount}亿元，同比${row.yoy}%`}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      {[0, 2000, 4000].map((tick) => <g key={tick}><line x1="42" x2="574" y1={amountY(tick)} y2={amountY(tick)} className="intrayear-grid" /><text x="37" y={amountY(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}</text></g>)}
      {[-monthlyYoyLimit, 0, monthlyYoyLimit].map((tick) => <g key={tick}><line x1="42" x2="574" y1={yoyY(tick)} y2={yoyY(tick)} className={tick === 0 ? "intrayear-reference" : "intrayear-grid"} /><text x="580" y={yoyY(tick) + 4} className="intrayear-axis-label">{tick}%</text></g>)}
      {rows.map((item, index) => <g key={item.period} onPointerEnter={() => setActive(index)} onClick={() => setActive(index)}><rect x={x(index) - 13} y={amountY(item.amount)} width="26" height={186 - amountY(item.amount)} fill="#bc9157" opacity={active === index ? 1 : .8}><title>{item.period}：{item.amount}亿元，同比{item.yoy}%</title></rect><rect x={x(index) - 29} y="30" width="58" height="167" fill="transparent" /><text x={x(index)} y="213" textAnchor="middle" className="intrayear-axis-label">{item.period}</text></g>)}
      <polyline points={rows.map((item, index) => `${x(index)},${yoyY(item.yoy)}`).join(" ")} className="fdi-yoy-line" />
      {rows.map((item, index) => <circle key={item.period} cx={x(index)} cy={yoyY(item.yoy)} r={active === index ? 5 : 3} className="fdi-yoy-point" onPointerEnter={() => setActive(index)} onClick={() => setActive(index)} />)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.period}累计</strong><span>金额：{row.amount.toFixed(1)} 亿元</span><span>累计同比：{row.yoy.toFixed(1)}%</span><a href={row.url} target="_blank" rel="noreferrer">当期商务部发布 ↗</a></div>
    <div className="intrayear-card-bottom"><span>{additional.inwardFdi.basis}</span><a href={additional.inwardFdi.rows.at(-1)?.url} target="_blank" rel="noreferrer">最新官方发布 ↗</a></div>
    </> : <>
      <div className="macro-chart-legend"><span><i style={{ background: "#741918" }} />年度同比 · %</span></div>
      <div className="intrayear-chart-scroll"><svg className="fdi-chart" viewBox="0 0 620 232" role="img" tabIndex={0} aria-label={`2018年以来全国实际使用外资年度同比柱状图；当前选中${selectedAnnual.year}年，同比${selectedAnnual.yoy}%`} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setAnnualActive((current) => Math.max(0, Math.min(annualRows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
        {[-annualLimit, 0, annualLimit].map((tick) => <g key={tick}><line x1="42" x2="574" y1={annualY(tick)} y2={annualY(tick)} className={tick === 0 ? "intrayear-reference" : "intrayear-grid"} /><text x="37" y={annualY(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}%</text></g>)}
        {annualRows.map((item, index) => { const zero = annualY(0); const top = Math.min(zero, annualY(item.yoy)); return <g key={item.year} role="button" tabIndex={0} aria-label={`${item.year}年，实际使用外资${item.amount.toLocaleString("zh-CN")}亿元，年度同比${item.yoy}%`} onPointerEnter={() => setAnnualActive(index)} onClick={() => setAnnualActive(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setAnnualActive(index); } }}><rect x={x(index) - 29} y="30" width="58" height="190" fill="transparent" /><rect x={x(index) - 17} y={top} width="34" height={Math.max(1, Math.abs(zero - annualY(item.yoy)))} fill="#741918" opacity={annualActive === index ? 1 : .78}><title>{item.year}年：实际使用外资{item.amount}亿元，官方公布同比{item.yoy}%</title></rect><text x={x(index)} y="213" textAnchor="middle" className="intrayear-axis-label">{String(item.year).slice(2)}</text></g>; })}
      </svg></div>
      <div className="macro-chart-readout"><strong>{selectedAnnual.year} 年</strong><span>实际使用外资：{selectedAnnual.amount.toLocaleString("zh-CN")} 亿元</span><span>年度同比：{selectedAnnual.yoy.toFixed(1)}%</span><a href={selectedAnnual.url} target="_blank" rel="noreferrer">该年度商务部发布 ↗</a></div>
      <div className="intrayear-card-bottom"><span>{additional.inwardFdi.annualBasis}</span><a href={selectedAnnual.url} target="_blank" rel="noreferrer">所选年度原文 ↗</a></div>
    </>}
  </article>;
}

function GoodsTradeCards() {
  const trade = additional.goodsTrade.rows;
  const ccfi = additional.ccfi.rows;
  const periods = trade.map((item) => item.period);
  return <div className="intrayear-grid-cards goods-trade-grid">
    {(["export", "import"] as const).map((kind) => {
      const isExport = kind === "export";
      const title = isExport ? "出口金额与增速" : "进口金额与增速";
      const values = trade.map((item) => isExport ? item.exportYoy : item.importYoy);
      const latest = trade.at(-1)!;
      return <article className="intrayear-card" key={kind}><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 当月同比</span></div><h3>{title}</h3><p>上图为美元计价的当月同比；下方逐月列出当月金额</p></div><div className="intrayear-latest"><strong>{values.at(-1)?.toFixed(1)}%</strong><small>8月金额 {(isExport ? latest.export : latest.import).toFixed(2)} 亿美元</small></div></div>
        <div className="intrayear-chart-scroll"><IntrayearChart metric={title} periods={periods} values={values} unit="%" zeroAxis /></div>
        <div className="trade-month-amounts" aria-label={`${title}逐月金额`}>{trade.map((item) => <span key={item.period}><small>{item.period}</small><strong>{(isExport ? item.export : item.import).toFixed(2)}</strong></span>)}</div>
        <div className="intrayear-card-bottom"><span>金额单位：亿美元 · 当月值</span><a href={additional.goodsTrade.sourceUrl} target="_blank" rel="noreferrer">海关月度原表 ↗</a></div>
      </article>;
    })}
    <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 当月值</span></div><h3>货物贸易顺差</h3><p>海关口径，美元计价，当月出口减进口</p></div><div className="intrayear-latest"><strong>{trade.at(-1)?.surplus.toFixed(2)} 亿美元</strong><small>8月</small></div></div><div className="intrayear-chart-scroll"><IntrayearChart metric="货物贸易顺差" periods={periods} values={trade.map((item) => item.surplus)} unit="亿美元" precision={2} /></div><div className="intrayear-card-bottom"><span>与国际收支口径货物顺差不可直接混用</span><a href={additional.goodsTrade.sourceUrl} target="_blank" rel="noreferrer">海关月度原表 ↗</a></div></article>
    <article className="intrayear-card"><div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 月均指数</span></div><h3>出口集装箱运价指数（CCFI）</h3><p>中国出口集装箱综合运价指数月平均值</p></div><div className="intrayear-latest"><strong>{ccfi.at(-1)?.value.toFixed(2)} 点</strong><small>8月</small></div></div><div className="intrayear-chart-scroll"><IntrayearChart metric="CCFI" periods={ccfi.map((item) => item.period)} values={ccfi.map((item) => item.value)} unit="点" precision={2} /></div><div className="intrayear-card-bottom"><span>上海航运交易所发布；非即期 SCFI</span><a href={ccfi.at(-1)?.url} target="_blank" rel="noreferrer">最新官方月报 ↗</a></div></article>
  </div>;
}

function ExportPartnerChart() {
  const rows = intrayear.exportPartnerRows;
  const sources = intrayear.exportStructureSources;
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const yearRange = `${rows[0].year}至${rows.at(-1)?.year}`;
  const left = 48;
  const right = 570;
  const top = 20;
  const bottom = 157;
  const x = (index: number) => left + index * (right - left) / (rows.length - 1);
  const y = (value: number) => bottom - value / 20 * (bottom - top);
  const series = [
    { name: "东盟", className: "export-partner-asean", at: 0 },
    { name: "欧盟", className: "export-partner-eu", at: 1 },
    { name: "美国", className: "export-partner-us", at: 2 }
  ];
  const nearestIndex = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const chartX = (clientX - bounds.left) / bounds.width * 620;
    return Math.max(0, Math.min(rows.length - 1, Math.round((chartX - left) / (right - left) * (rows.length - 1))));
  };
  return <article className="intrayear-card export-observation-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 年度出口市场</span></div><h3>中国出口贸易伙伴占比</h3><p>主要市场占全部货物出口的比重；点位同时显示出口额</p></div><div className="intrayear-latest"><strong>{row.year} 年</strong><small>东盟 {row.markets[0].share}% · 欧盟 {row.markets[1].share}%</small><small>美国 {row.markets[2].share}%</small></div></div>
    <div className="macro-chart-legend">{series.map((item) => <span key={item.name}><i className={item.className} />{item.name}</span>)}</div>
    <div className="intrayear-chart-scroll"><svg className="export-structure-chart" viewBox="0 0 620 218" role="img" tabIndex={0} aria-label={`${yearRange}年东盟、欧盟、美国占中国货物出口比重；当前${row.year}年，东盟${row.markets[0].share}%，欧盟${row.markets[1].share}%，美国${row.markets[2].share}%。可用方向键查看各年。`}
      onPointerMove={(event) => setActive(nearestIndex(event.clientX, event.currentTarget))}
      onPointerDown={(event) => { if (event.pointerType !== "mouse") setActive(nearestIndex(event.clientX, event.currentTarget)); }}
      onClick={(event) => setActive(nearestIndex(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect x="0" y="0" width="620" height="218" fill="transparent" />
      {[0, 5, 10, 15, 20].map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}%</text></g>)}
      <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className="intrayear-hover-guide" pointerEvents="none" />
      {series.map((item) => <polyline key={item.name} points={rows.map((period, index) => `${x(index)},${y(period.markets[item.at].share)}`).join(" ")} className={`export-partner-line ${item.className}`} />)}
      {rows.map((period, index) => <g key={period.year}>{series.map((item) => <circle key={item.name} cx={x(index)} cy={y(period.markets[item.at].share)} r={active === index ? 4.5 : 3.2} className={`export-partner-point ${item.className}`}><title>{period.year}年{item.name}：占出口{period.markets[item.at].share}% · {period.markets[item.at].amount.toLocaleString("zh-CN")}亿元</title></circle>)}<text x={x(index)} y="181" textAnchor="middle" className="intrayear-axis-label">{period.year}</text></g>)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.year} 年</strong>{row.markets.map((market) => <span key={market.name}>{market.name} {market.share}% · {market.amount.toLocaleString("zh-CN")} 亿元</span>)}<a href={sources[active].url} target="_blank" rel="noreferrer">当年统计局原表 ↗</a></div>
    <div className="intrayear-card-bottom"><span>年度公报口径；所选三个市场为主要伙伴，不代表全部出口市场。</span><a href={sources.at(-1)?.url} target="_blank" rel="noreferrer">2025 官方公报 ↗</a></div>
  </article>;
}

function ExportStructureChart() {
  const rows = intrayear.exportProductRows;
  const sources = intrayear.exportStructureSources;
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const yearRange = `${rows[0].year}至${rows.at(-1)?.year}`;
  const left = 48;
  const right = 570;
  const top = 20;
  const bottom = 157;
  const x = (index: number) => left + index * (right - left) / (rows.length - 1);
  const y = (value: number) => bottom - value / 70 * (bottom - top);
  const series = [
    { name: "机电产品", className: "export-product-mechanical", share: (item: (typeof rows)[number]) => item.mechanical / item.total * 100, amount: (item: (typeof rows)[number]) => item.mechanical },
    { name: "高新技术产品", className: "export-product-hightech", share: (item: (typeof rows)[number]) => item.highTech / item.total * 100, amount: (item: (typeof rows)[number]) => item.highTech },
    { name: "七类劳动密集型商品", className: "export-product-labor", share: (item: (typeof rows)[number]) => item.laborIntensive == null ? null : item.laborIntensive / item.total * 100, amount: (item: (typeof rows)[number]) => item.laborIntensive }
  ];
  const displayShare = (value: number | null) => value == null ? "未列示" : `${value.toFixed(1)}%`;
  const nearestIndex = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const chartX = (clientX - bounds.left) / bounds.width * 620;
    return Math.max(0, Math.min(rows.length - 1, Math.round((chartX - left) / (right - left) * (rows.length - 1))));
  };
  return <article className="intrayear-card export-observation-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>进出口 · 出口产品结构</span></div><h3>出口结构升级观察</h3><p>各类产品出口额占货物出口额比重；年度占比口径</p></div><div className="intrayear-latest"><strong>{row.year} 年</strong><small>机电 {displayShare(series[0].share(row))}</small><small>高技术 {displayShare(series[1].share(row))} · 劳动密集 {displayShare(series[2].share(row))}</small></div></div>
    <div className="macro-chart-legend">{series.map((item) => <span key={item.name}><i className={item.className} />{item.name}</span>)}</div>
    <div className="intrayear-chart-scroll"><svg className="export-structure-chart" viewBox="0 0 620 218" role="img" tabIndex={0} aria-label={`${yearRange}年机电、高新技术、七类劳动密集型商品出口占比；当前${row.year}年，分别为${series.map((item) => `${item.name}${displayShare(item.share(row))}`).join("、")}。分类定义有交叉，不可相加。可用方向键查看年份。`}
      onPointerMove={(event) => setActive(nearestIndex(event.clientX, event.currentTarget))}
      onPointerDown={(event) => { if (event.pointerType !== "mouse") setActive(nearestIndex(event.clientX, event.currentTarget)); }}
      onClick={(event) => setActive(nearestIndex(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect x="0" y="0" width="620" height="218" fill="transparent" />
      {[0, 20, 40, 60].map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className="intrayear-grid" /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}%</text></g>)}
      <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className="intrayear-hover-guide" pointerEvents="none" />
      {series.map((item) => <polyline key={item.name} points={rows.map((period, index) => ({ period, index })).filter(({ period }) => item.share(period) != null).map(({ period, index }) => `${x(index)},${y(item.share(period)!)}`).join(" ")} className={`export-product-line ${item.className}`} />)}
      {rows.map((period, index) => <g key={period.year}>{series.map((item) => item.share(period) == null ? null : <circle key={item.name} cx={x(index)} cy={y(item.share(period)!)} r={active === index ? 4.5 : 3.2} className={`export-product-point ${item.className}`}><title>{period.year}年{item.name}：{item.share(period)!.toFixed(1)}%{item.amount(period) == null ? "" : ` · ${item.amount(period)!.toLocaleString("zh-CN")}亿元`}</title></circle>)}<text x={x(index)} y="181" textAnchor="middle" className="intrayear-axis-label">{period.year}</text></g>)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.year} 年</strong>{series.map((item) => <span key={item.name}>{item.name} {displayShare(item.share(row))}{item.amount(row) == null ? "" : ` · ${item.amount(row)!.toLocaleString("zh-CN")} 亿元`}</span>)}<a href={sources[active].url} target="_blank" rel="noreferrer">当年统计局原表 ↗</a></div>
    <div className="intrayear-card-bottom"><span>机电与高技术分类有交叉，三线不可相加，均为结构代理指标。所用官方年报未列示可直接核验的七类劳动密集商品合计，2016—2017留空；该线不等同于出口国内增加值。</span><a href={sources.at(-1)?.url} target="_blank" rel="noreferrer">2025 官方公报 ↗</a></div>
  </article>;
}

function ConsumerCategoryChart() {
  const rows = intrayear.consumerCategoryRows;
  const sources = intrayear.consumerCategorySources;
  const [active, setActive] = useState(rows.length - 1);
  const row = rows[active];
  const left = 54;
  const right = 550;
  const top = 18;
  const bottom = 155;
  const zeroLimit = Math.max(5, Math.ceil(Math.max(...rows.flatMap((item) => [Math.abs(item.autoYoy), Math.abs(item.applianceYoy)])) / 5) * 5) * 1.1;
  const low = -zeroLimit;
  const high = zeroLimit;
  const x = (index: number) => left + (index * (right - left)) / (rows.length - 1);
  const y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  const nearestIndex = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * 620;
    return Math.max(0, Math.min(rows.length - 1, Math.round(((chartX - left) / (right - left)) * (rows.length - 1))));
  };
  const autoPoints = rows.map((item, index) => `${x(index)},${y(item.autoYoy)}`).join(" ");
  const appliancePoints = rows.map((item, index) => `${x(index)},${y(item.applianceYoy)}`).join(" ");
  return <article className="intrayear-card consumer-category-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>消费 · 限额以上商品零售类值</span></div><h3>汽车与家电当月同比</h3><p>名义同比，未扣除价格因素；首期为 1—2 月合并发布</p></div><div className="intrayear-latest"><strong>汽车 {row.autoYoy > 0 ? "+" : ""}{row.autoYoy.toFixed(1)}%</strong><small>家电 {row.applianceYoy > 0 ? "+" : ""}{row.applianceYoy.toFixed(1)}%</small><small>{row.period}当月值</small></div></div>
    <div className="macro-chart-legend"><span><i className="consumer-auto-swatch" />汽车类</span><span><i className="consumer-appliance-swatch" />家用电器和音像器材类</span></div>
    <div className="intrayear-chart-scroll"><svg className="consumer-category-chart" viewBox="0 0 620 224" role="img" tabIndex={0} aria-label={`汽车类及家用电器和音像器材类当月名义同比；当前${row.period}汽车${row.autoYoy}%、家电${row.applianceYoy}%；可用左右方向键查看各期。首期为1至2月合并发布。`}
      onPointerMove={(event) => setActive(nearestIndex(event.clientX, event.currentTarget))}
      onPointerLeave={() => {}}
      onPointerDown={(event) => { if (event.pointerType !== "mouse") setActive(nearestIndex(event.clientX, event.currentTarget)); }}
      onClick={(event) => setActive(nearestIndex(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect x="0" y="0" width="620" height="224" fill="transparent" />
      {[-zeroLimit, 0, zeroLimit].map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "intrayear-reference" : "intrayear-grid"} /><text x={left - 8} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick.toFixed(0)}%</text></g>)}
      <line x1={x(active)} x2={x(active)} y1={top} y2={bottom} className="intrayear-hover-guide" pointerEvents="none" />
      <polyline points={autoPoints} className="consumer-auto-line" />
      <polyline points={appliancePoints} className="consumer-appliance-line" />
      {rows.map((item, index) => <g key={item.period}><circle cx={x(index)} cy={y(item.autoYoy)} r={active === index ? 5 : 3.5} className="consumer-auto-point"><title>{item.period}汽车类：{item.autoYoy.toFixed(1)}%</title></circle><circle cx={x(index)} cy={y(item.applianceYoy)} r={active === index ? 5 : 3.5} className="consumer-appliance-point"><title>{item.period}家用电器和音像器材类：{item.applianceYoy.toFixed(1)}%</title></circle><text x={x(index)} y="181" textAnchor={index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"} className="intrayear-axis-label">{item.period}</text></g>)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{row.period}</strong><span>汽车 {row.autoAmount.toLocaleString("zh-CN")} 亿元 · 当月 {row.autoYoy > 0 ? "+" : ""}{row.autoYoy.toFixed(1)}% · 累计 {row.autoCumulativeYoy > 0 ? "+" : ""}{row.autoCumulativeYoy.toFixed(1)}%</span><span>家电 {row.applianceAmount.toLocaleString("zh-CN")} 亿元 · 当月 {row.applianceYoy > 0 ? "+" : ""}{row.applianceYoy.toFixed(1)}% · 累计 {row.applianceCumulativeYoy > 0 ? "+" : ""}{row.applianceCumulativeYoy.toFixed(1)}%</span><a href={sources[active].url} target="_blank" rel="noreferrer">当期统计局原表 ↗</a></div>
    <div className="intrayear-card-bottom"><span>金额单位：亿元；累计同比只作辅助读数，不与当月同比混画。统计范围为限额以上单位。</span><a href={sources.at(-1)?.url} target="_blank" rel="noreferrer">最新官方发布 ↗</a></div>
  </article>;
}

function ExternalBalanceChart({ goods, services }: { goods: { periods: string[]; values: number[] }; services: { periods: string[]; values: number[] } }) {
  const monthlyTotal = intrayear.tradeTotal;
  const quarterlyTotal = intrayear.tradeQuarterly;
  const [view, setView] = useState<"monthly" | "quarterly">("monthly");
  const periods = view === "monthly" ? monthlyTotal.periods : quarterlyTotal.periods;
  const goodsValues = view === "monthly" ? goods.values : quarterlyTotal.goodsValues;
  const servicesValues = view === "monthly" ? services.values : quarterlyTotal.servicesValues;
  const totalValues = view === "monthly" ? monthlyTotal.values : quarterlyTotal.values;
  const allValues = [...goodsValues, ...servicesValues, ...totalValues, 0];
  const low = Math.floor(Math.min(...allValues) / 500) * 500;
  const high = Math.ceil(Math.max(...allValues) / 500) * 500;
  const ticks = Array.from({ length: Math.max(2, Math.round((high - low) / 500) + 1) }, (_, index) => low + index * 500);
  const [activeIndex, setActiveIndex] = useState(monthlyTotal.periods.length - 1);
  const safeActiveIndex = Math.min(activeIndex, periods.length - 1);
  const isQuarterly = view === "quarterly";
  const left = 90;
  const right = 705;
  const top = 20;
  const bottom = 208;
  const x = (index: number) => left + (index * (right - left)) / Math.max(1, periods.length - 1);
  const y = (value: number) => bottom - ((value - low) / (high - low)) * (bottom - top);
  const zeroY = y(0);
  const nearestIndex = (clientX: number, element: SVGSVGElement) => {
    const bounds = element.getBoundingClientRect();
    const chartX = ((clientX - bounds.left) / bounds.width) * 760;
    return Math.max(0, Math.min(periods.length - 1, Math.round(((chartX - left) / (right - left)) * (periods.length - 1))));
  };
  const totalValue = totalValues[safeActiveIndex];
  const periodLabel = (period: string) => isQuarterly ? period.replace(/^(\d{4})-Q(\d)$/, (_match, year, quarter) => `${year.slice(2)}Q${quarter}`) : period;
  const xLabelIndices = isQuarterly ? [...new Set([0, ...periods.map((period, index) => period.endsWith("Q1") ? index : -1).filter((index) => index >= 0), periods.length - 1])] : periods.map((_period, index) => index);
  const latestLabel = isQuarterly ? `${totalValue.toFixed(1)} 亿美元` : `${Math.round(totalValue).toLocaleString("zh-CN")} 亿美元`;
  const sourceUrl = isQuarterly ? quarterlyTotal.dataUrl : intrayear.tradeSources[safeActiveIndex]?.url;
  return <article className="intrayear-card macro-wide-card external-balance-card">
    <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>国际收支 · {isQuarterly ? "季度美元差额" : "当月美元差额"}</span></div><h3>货物与服务贸易差额</h3><p>货物、服务分别为柱状；合计为折线。零轴上方是顺差，下方是逆差。</p></div><div className="intrayear-latest"><strong>{totalValue >= 0 ? "合计顺差" : "合计逆差"} {latestLabel}</strong><small>{periods[safeActiveIndex]} · 国际收支口径</small></div></div>
    <div className="intrayear-switch" role="group" aria-label="国际收支贸易差额频率"><button type="button" aria-pressed={!isQuarterly} onClick={() => { setView("monthly"); setActiveIndex(monthlyTotal.periods.length - 1); }}>月度</button><button type="button" aria-pressed={isQuarterly} onClick={() => { setView("quarterly"); setActiveIndex(quarterlyTotal.periods.length - 1); }}>季度</button></div>
    <div className="macro-chart-legend"><span><i style={{ background: "#bc9157" }} />货物贸易差额</span><span><i style={{ background: "#b9bba9" }} />服务贸易差额</span><span><i style={{ background: "#741918" }} />货物和服务合计差额</span></div>
    <div className="intrayear-chart-scroll"><svg className="external-balance-chart" viewBox="0 0 760 252" role="img" tabIndex={0} aria-label={`国际收支货物、服务和合计贸易差额，${isQuarterly ? "季度" : "当月"}值，单位亿美元；当前${periods[safeActiveIndex]}货物${goodsValues[safeActiveIndex]}、服务${servicesValues[safeActiveIndex]}、合计${totalValue}；可用左右方向键查看各期`}
      onPointerMove={(event) => setActiveIndex(nearestIndex(event.clientX, event.currentTarget))}
      onPointerDown={(event) => setActiveIndex(nearestIndex(event.clientX, event.currentTarget))}
      onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setActiveIndex((current) => Math.max(0, Math.min(periods.length - 1, current + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
      <rect x="0" y="0" width="760" height="252" fill="transparent" />
      {ticks.map((tick) => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? "intrayear-reference" : "intrayear-grid"} /><text x={left - 30} y={y(tick) + 4} textAnchor="end" className="intrayear-axis-label">{tick}</text></g>)}
      <rect x={x(safeActiveIndex) - (isQuarterly ? 9 : 31)} y={top} width={isQuarterly ? 18 : 62} height={bottom - top} className="external-balance-highlight" pointerEvents="none" />
      {periods.map((period, index) => <g key={period}>
        <rect x={x(index) - (isQuarterly ? 7.5 : 20)} y={Math.min(zeroY, y(goodsValues[index]))} width={isQuarterly ? 6 : 16} height={Math.abs(zeroY - y(goodsValues[index]))} className="external-goods-bar"><title>{period}货物贸易差额：{goodsValues[index]}亿美元</title></rect>
        <rect x={x(index) + (isQuarterly ? 1.5 : 4)} y={Math.min(zeroY, y(servicesValues[index]))} width={isQuarterly ? 6 : 16} height={Math.abs(zeroY - y(servicesValues[index]))} className="external-services-bar"><title>{period}服务贸易差额：{servicesValues[index]}亿美元</title></rect>
        {xLabelIndices.includes(index) ? <text x={x(index)} y="239" textAnchor={index === 0 ? "start" : index === periods.length - 1 ? "end" : "middle"} className="intrayear-axis-label">{periodLabel(period)}</text> : null}
      </g>)}
      <polyline points={totalValues.map((value, index) => `${x(index)},${y(value)}`).join(" ")} className="external-balance-total-line" />
      {totalValues.map((value, index) => <circle key={periods[index]} cx={x(index)} cy={y(value)} r={safeActiveIndex === index ? 5 : 3.5} className="external-balance-total-point"><title>{periods[index]}货物和服务合计差额：{value.toFixed(1)}亿美元</title></circle>)}
    </svg></div>
    <div className="macro-chart-readout"><strong>{periods[safeActiveIndex]}</strong><span>货物：{goodsValues[safeActiveIndex].toFixed(1)} 亿美元</span><span>服务：{servicesValues[safeActiveIndex].toFixed(1)} 亿美元</span><span>合计：{totalValue.toFixed(1)} 亿美元</span><a href={sourceUrl} target="_blank" rel="noreferrer">{isQuarterly ? "外汇局季度原表 ↗" : "当月外汇局原表 ↗"}</a></div>
    <div className="intrayear-card-bottom"><span>{isQuarterly ? `2018Q1—${periods.at(-1)?.replace("-", " ")}；单位：亿美元。采用外汇局国际收支平衡表最新季度修订序列。` : `${monthlyTotal.basis}。单位：亿美元；不同于“增长动力·进出口”的海关货物顺差。`}</span><a href={isQuarterly ? quarterlyTotal.sourceUrl : intrayear.tradeSources.at(-1)?.url} target="_blank" rel="noreferrer">{isQuarterly ? "外汇局季度序列说明 ↗" : "最新官方发布 ↗"}</a></div>
  </article>;
}

function MacroHistoryView({ initialGroup = "经济运行" }: { initialGroup?: "全部" | "经济运行" | "增长动力" | "金融信贷" | "宏观调控" | "核心会议" }) {
  const groups = ["全部", "经济运行", "增长动力", "金融信贷", "宏观调控", "核心会议"] as const;
  const economicSubgroups = ["经济增长", "物价水平", "国际收支", "景气指数", "就业市场"] as const;
  const growthSubgroups = ["投资", "消费", "进出口", "工业生产", "房地产"] as const;
  const featuredMetrics = new Set(["GDP 单季实际增速", "GDP 平减指数", "CPI", "PPI", "核心 CPI", "PPI－CPI 剪刀差", "制造业 PMI", "制造业 PMI 新订单", "非制造业 PMI", "综合 PMI 产出指数", "消费者信心指数", "城镇调查失业率", "规模以上工业增加值", "服务零售额", "制造业投资", "基础设施投资", "民间固定资产投资", "新建商品房销售面积", "社融存量增速", "一般公共预算支出"]);
  const priceMetricOrder = ["CPI", "PPI", "核心 CPI", "PPI－CPI 剪刀差"];
  const [group, setGroup] = useState<(typeof groups)[number]>(initialGroup);
  const [trendModes, setTrendModes] = useState<Record<string, "primary" | "alternate">>({});
  const rows = advisory.macroHistory.series;
  const visiblePillars = group === "全部" ? groups.slice(1) : [group];
  const indicatorsById = new Map(advisory.macroIndicators.map((item) => [item.id, item]));
  const renderIntrayearCard = (item: (typeof intrayear.series)[number]) => {
    if (item.metric === "GDP 平减指数") {
      const chartRows = gdpDeflatorHistory.rows.filter((row) => row.period >= "2015-Q1");
      const periods = chartRows.map((row) => row.period.replace("-", " "));
      const sourceByPeriod = new Map(chartRows.map((row) => [row.period.replace("-", " "), row.sourceUrl]));
      return <article className="intrayear-card" key={item.metric}>
        <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>经济增长</span><span className="intrayear-role">2015Q1 起 · 单季同比</span></div><h3>GDP 平减指数</h3><p>{gdpDeflatorHistory.basis}，依据同季名义 GDP 与实际 GDP 同比指数计算</p></div><div className="intrayear-latest"><strong>约 {chartRows.at(-1)?.value.toFixed(2)}%</strong><small>{periods.at(-1)}</small></div></div>
        <FinanceTrendChart periods={periods} series={[{ name: "GDP 平减指数（单季同比）", color: "#741918", values: chartRows.map((row) => row.value) }]} unit="%" tickPrecision={1} axisMode="zero-centered" sourceUrl={(period) => sourceByPeriod.get(period)} />
        <div className="intrayear-card-bottom"><span>展示范围从 2015 年一季度开始；均采用国家统计局 2026 年 9 月 15 日 SDDS 同一版本的季度现价 GDP 与实际 GDP 同比指数计算。国家统计局自 2015 年三季度起改为分季核算，比较时请留意统计核算方式说明。</span><a href={chartRows.at(-1)?.sourceUrl} target="_blank" rel="noreferrer">最新季度原表 ↗</a></div>
      </article>;
    }
    if (["CPI", "PPI", "核心 CPI", "PPI－CPI 剪刀差"].includes(item.metric)) {
      const key = item.metric === "核心 CPI" ? "coreCpi" : item.metric === "PPI－CPI 剪刀差" ? "scissors" : item.metric.toLowerCase();
      const rows = priceHistory.rows;
      const periods = rows.filter((row) => row.period >= (item.metric === "PPI－CPI 剪刀差" ? "2015-01" : "2020-01")).map((row) => row.period);
      const values = periods.map((period) => rows.find((row) => row.period === period)?.[key] ?? null);
      const urls = new Map(rows.map((row) => [row.period, item.metric === "CPI" ? row.cpiUrl : item.metric === "PPI" ? row.ppiUrl : item.metric === "核心 CPI" ? row.coreCpiUrl : row.cpiUrl]));
      const latestIndex = values.findLastIndex((value) => value !== null);
      const latestValue = latestIndex >= 0 ? values[latestIndex] : null;
      const missingCount = values.filter((value) => value === null).length;
      const unit = item.metric === "PPI－CPI 剪刀差" ? "个百分点" : "%";
      const title = item.metric === "PPI－CPI 剪刀差" ? "PPI－CPI 剪刀差" : item.metric;
      const seriesName = item.metric === "PPI－CPI 剪刀差" ? "PPI 当月同比－CPI 当月同比" : `${title}当月同比`;
      const sourceNote = item.metric === "PPI－CPI 剪刀差"
        ? "按同月国家统计局 PPI、CPI 当月同比相减，单位为百分点；缺失月份保留断点。"
        : "国家统计局逐月原始发布，当月同比，单位%；缺失月份保留断点。";
      const latestPeriod = latestIndex >= 0 ? periods[latestIndex] : "暂无可核验读数";
      const latestDataUrl = latestIndex >= 0 ? urls.get(periods[latestIndex]) : undefined;
      return <article className="intrayear-card" key={item.metric}>
        <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>物价水平</span><span className="intrayear-role">{item.metric === "PPI－CPI 剪刀差" ? "2015 年以来" : "2020 年以来"}</span></div><h3>{title}</h3><p>{item.metric === "核心 CPI" ? "扣除食品和能源价格的核心 CPI" : item.metric === "PPI－CPI 剪刀差" ? "制造业出厂价格与居民消费价格的同比差" : "当月同比"}</p></div><div className="intrayear-latest"><strong>{latestValue === null ? "—" : `${latestValue > 0 && item.metric === "PPI－CPI 剪刀差" ? "+" : ""}${latestValue.toFixed(1)}${unit}`}</strong><small>{latestIndex >= 0 ? periods[latestIndex] : "暂无可核验读数"}</small></div></div>
        <FinanceTrendChart periods={periods} series={[{ name: seriesName, color: "#741918", values }]} unit={unit} tickPrecision={1} axisMode="zero-centered" minPadding={0.5} sourceUrl={(period) => urls.get(period)} />
        <div className="intrayear-card-bottom"><span>{sourceNote} {latestValue === null ? "暂无已核验数据。" : `本序列最新已核验至 ${latestPeriod}；当前展示窗口内保留 ${missingCount} 个月空档。`}{item.metric === "PPI－CPI 剪刀差" ? "展示起点为2015年1月。" : item.metric === "核心 CPI" ? "官方月度原文未能核实的月份不补值。" : "2011年CPI/PPI统计基期或调查制度调整，长序列存在口径变化。"}</span>{latestDataUrl ? <a href={latestDataUrl} target="_blank" rel="noreferrer">查看最新官方发布 ↗</a> : null}</div>
      </article>;
    }
    if (item.metric === "外汇储备") {
      const history = intrayear.reserveHistory;
      const sourceByYear = new Map(history.sources.map((source) => [source.year, source.url]));
      const latestValue = history.values.at(-1)!;
      const latestPeriod = history.periods.at(-1)!;
      return <article className="intrayear-card" key={item.metric}>
        <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>国际收支</span><span className="intrayear-role">2022 年以来 · 月末存量</span></div><h3>外汇储备</h3><p>{history.basis}</p></div><div className="intrayear-latest"><strong>{Math.round(latestValue).toLocaleString("zh-CN")} 亿美元</strong><small>{latestPeriod} · 月末</small></div></div>
        <FinanceTrendChart periods={history.periods} series={[{ name: "外汇储备", color: "#741918", values: history.values }]} unit="亿美元" tickPrecision={0} sourceUrl={(period) => sourceByYear.get(period.slice(0, 4))} />
        <div className="intrayear-card-bottom"><span>2022年1月至{latestPeriod}，共 {history.values.length} 个月度点；储备规模以美元计值，会受汇率折算和资产价格变化影响。</span><a href={sourceByYear.get(latestPeriod.slice(0, 4))} target="_blank" rel="noreferrer">最新官方月表 ↗</a></div>
        <details className="intrayear-source-list"><summary>查看逐年官方原表</summary><div>{history.sources.map((source) => <a key={source.year} href={source.url} target="_blank" rel="noreferrer">{source.year} 年 ↗</a>)}</div></details>
      </article>;
    }
    const hasAlternate = "alternate" in item && Boolean(item.alternate);
    const isAlternate = trendModes[item.metric] === "alternate" && hasAlternate;
    const active = isAlternate && "alternate" in item && item.alternate ? item.alternate : item;
    const sourceSet = "sourceSet" in item ? item.sourceSet : undefined;
    const sources = sourceSet === "activity" ? intrayear.activitySources
      : sourceSet === "fiscal" ? intrayear.fiscalSources
      : sourceSet === "coreCpi" ? intrayear.coreCpiSources
      : sourceSet === "privateInvestment" ? intrayear.privateInvestmentSources
      : sourceSet === "investmentStructure" ? intrayear.investmentStructureSources
      : sourceSet === "credit" ? intrayear.creditSources
      : sourceSet === "deflator" ? intrayear.deflatorSources
      : sourceSet === "nonManufacturingPmi" ? intrayear.nonManufacturingPmiSources
      : sourceSet === "reserve" ? intrayear.reserveSources
      : sourceSet === "trade" ? intrayear.tradeSources : undefined;
    const itemSources = "sourceUrls" in item ? item.sourceUrls
      : sourceSet === "investmentStructure" ? intrayear.investmentStructureSources.map((source) => source.url)
      : sourceSet === "nonManufacturingPmi" ? intrayear.nonManufacturingPmiSources.map((source) => source.url)
      : undefined;
    const priceSource = intrayear.priceSources.at(-1);
    const sourceUrl = "url" in active && active.url ? active.url
      : item.metric === "CPI" || item.metric === "核心 CPI" ? priceSource?.cpiUrl
      : item.metric === "PPI" ? priceSource?.ppiUrl
      : sourceSet === "deflator" ? sources?.[isAlternate ? 2 : 1]?.url
      : "url" in item ? item.url : itemSources?.at(-1) ?? sources?.[sources.length - 1]?.url;
    const last = active.values[active.values.length - 1];
    const previous = active.values[active.values.length - 2];
    const delta = last - previous;
    const precision = "precision" in item ? item.precision : 1;
    const changeUnit = item.unit === "%" ? "个百分点" : item.unit || "点";
    const approximate = item.metric === "GDP 平减指数";
    const displayMetric = item.metric === "GDP 单季实际增速" ? "GDP 实际增速" : item.metric;
    const comparisonLabel = item.metric === "GDP 单季实际增速" ? "增速较上季" : isAlternate && approximate ? "较上个累计期" : isAlternate ? "较上月环比增速" : "较上个披露期";
    const primaryLabel = item.metric === "GDP 单季实际增速" ? "单季实际同比" : approximate ? "单季同比" : "当月同比";
    const alternateLabel = hasAlternate && "alternate" in item && item.alternate ? item.alternate.label : "";
    const cumulativeLatest = "cumulativeLatest" in item ? item.cumulativeLatest : undefined;
    return <article className="intrayear-card" key={item.metric}>
      <div className="intrayear-card-top"><div><div className="intrayear-tags"><span>{item.subgroup}</span>{"role" in item && item.role ? <span className="intrayear-role">{item.role}</span> : null}</div><h3>{displayMetric}</h3><p>{active.basis}</p></div><div className="intrayear-latest"><strong>{approximate ? "约" : ""}{last.toFixed(precision)}{item.unit}</strong><small>{active.periods[active.periods.length - 1]}</small><small>{comparisonLabel} {delta >= 0 ? "+" : ""}{delta.toFixed(precision)} {changeUnit}</small>{cumulativeLatest ? <small className="intrayear-cumulative-latest">{cumulativeLatest.period}{cumulativeLatest.basis} {cumulativeLatest.value.toFixed(1)}%</small> : null}</div></div>
      {hasAlternate ? <div className="intrayear-switch" role="group" aria-label={`${displayMetric}统计口径`}><button type="button" aria-pressed={!isAlternate} onClick={() => setTrendModes((current) => ({ ...current, [item.metric]: "primary" }))}>{primaryLabel}</button><button type="button" aria-pressed={isAlternate} onClick={() => setTrendModes((current) => ({ ...current, [item.metric]: "alternate" }))}>{alternateLabel}</button></div> : null}
      <div className="intrayear-chart-scroll"><IntrayearChart metric={displayMetric} periods={active.periods} values={active.values} unit={item.unit} precision={precision} approximate={approximate} breakOnYearChange={"breakOnYearChange" in active && active.breakOnYearChange === true} zeroAxis={(item.unit === "%" && /同比|环比/.test(active.basis)) || (item.metric === "GDP 单季实际增速" && isAlternate)} /></div>
      <div className="intrayear-card-bottom"><span>{active.source}</span>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{"sourceLinkLabel" in item ? item.sourceLinkLabel : "查看官方发布 ↗"}</a> : null}</div>
      {itemSources ? <details className="intrayear-source-list"><summary>查看逐期原始发布</summary><div>{itemSources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">{item.periods[index]} ↗</a>)}</div></details> : null}
    </article>;
  };
  return <div className="research-stack">
    <section className="panel">
      <MacroChartHeader kicker="MACRO ATLAS" title="宏观图谱" lead="按维度查看趋势，点按图表查看各期读数" detail="最新读数显示在图表右上角；不同统计期与口径分开观察。" />
      <div className="macro-chart-toolbar"><div className="history-filters" aria-label="宏观趋势与核心会议五大板块">{groups.map((item) => <button key={item} type="button" aria-pressed={item === group} className={item === group ? "active" : ""} onClick={() => setGroup(item)}>{item}</button>)}</div><span>复核日：{additional.reviewedAt}</span></div>
      <details className="macro-chart-help"><summary>图表口径与操作说明</summary><p>{intrayear.note}</p><p>{intrayear.series.length} 条基础序列 · 5 项专项观察 · 1 项国际收支合计 · 3 项年度人口观察。鼠标指向、点击或使用左右方向键查看真实观测点；各图分别保留来源、统计期与口径，不将不同口径拼接。</p></details>
      {visiblePillars.map((pillar) => {
        const pillarRows = intrayear.series.filter((item) => item.group === pillar);
        if (pillar === "经济运行") return <section className="intrayear-pillar" key={pillar} aria-label="经济运行逐期走势">
          <div className="intrayear-pillar-heading"><h3>经济运行</h3><span>{pillarRows.length} 条逐期曲线及年度人口指标 · 按五类查看</span></div>
          {economicSubgroups.map((subgroup) => {
            const rows = pillarRows.filter((item) => "subgroup" in item && item.subgroup === subgroup)
              .sort((a, b) => subgroup === "物价水平" ? priceMetricOrder.indexOf(a.metric) - priceMetricOrder.indexOf(b.metric) : 0);
            const isExternal = subgroup === "国际收支";
            const reserve = isExternal ? rows.find((item) => item.metric === "外汇储备") : undefined;
            const goods = isExternal ? rows.find((item) => item.metric === "国际收支货物贸易差额") : undefined;
            const services = isExternal ? rows.find((item) => item.metric === "国际收支服务贸易差额") : undefined;
            const primaryRows = group === "全部" ? rows.filter((item) => featuredMetrics.has(item.metric)) : rows;
            const secondaryRows = group === "全部" ? rows.filter((item) => !featuredMetrics.has(item.metric)) : [];
            return <div className="intrayear-subgroup-pair" key={subgroup}>
            <section className="intrayear-subgroup" aria-label={`${subgroup}走势`}>
              <div className="intrayear-subgroup-heading"><h4>{subgroup}</h4><span>{subgroup === "就业市场" ? "4 项月度与年度指标" : `${rows.length} 条曲线${isExternal ? " · 辅助观察" : ""}`}</span></div>
              {isExternal ? <details className="intrayear-more intrayear-external" open><summary>国际收支观察：外储与贸易差额</summary><p>外储是月末存量，趋势自2022年1月起，最新至 {intrayear.reserveHistory.latestPeriod}；贸易差额是当月流量，已核验至 {intrayear.tradeTotal.periods.at(-1)}。货物、服务及合计均采用外汇局国际收支月度口径，与海关货物贸易顺差不可直接混用。</p><div className="intrayear-grid-cards external-observation-grid">{reserve ? renderIntrayearCard(reserve) : null}{goods && services ? <ExternalBalanceChart goods={goods} services={services} /> : null}</div></details> : <>
                <div className={`intrayear-grid-cards${subgroup === "就业市场" ? " employment-grid-cards" : ""}`}>{primaryRows.map(renderIntrayearCard)}{subgroup === "就业市场" ? <><UrbanizationChart /><PopulationChangeChart /><PopulationStructureChart /></> : null}</div>
                {secondaryRows.length ? <details className="intrayear-more"><summary>查看{subgroup}其他 {secondaryRows.length} 条曲线</summary><div className="intrayear-grid-cards">{secondaryRows.map(renderIntrayearCard)}</div></details> : null}
              </>}
            </section>
            </div>;
          })}
        </section>;
        if (pillar === "增长动力") return <section className="intrayear-pillar" key={pillar} aria-label="增长动力逐期走势">
          <div className="intrayear-pillar-heading"><h3>增长动力</h3><span>{pillarRows.length} 条已核验逐期曲线 · 按五类查看</span></div>
          {growthSubgroups.map((subgroup) => {
            const rows = pillarRows.filter((item) => "subgroup" in item && item.subgroup === subgroup);
            return <section className="intrayear-subgroup" key={subgroup} aria-label={`${subgroup}走势`}>
              <div className="intrayear-subgroup-heading"><h4>{subgroup}</h4><span>{subgroup === "进出口" ? "4 项官方逐月指标" : `${rows.length} 条曲线${subgroup === "投资" ? " · 外商直接投资另列" : ""}`}</span></div>
              {subgroup === "进出口" ? <><p className="intrayear-subgroup-note">出口与进口上方为美元当月同比，金额逐月列在图下；货物顺差为海关口径，运价为 CCFI 月均值。下方两图分别观察出口市场份额和商品结构变化。</p><GoodsTradeCards /><div className="intrayear-grid-cards export-observation-grid"><ExportPartnerChart /><ExportStructureChart /></div></> : <>{subgroup === "消费" ? <p className="intrayear-subgroup-note">商品侧社零按当月同比，服务零售按年初累计同比：两张图分开观察，不把两种增速连成一条线。</p> : null}{subgroup === "投资" ? <p className="intrayear-subgroup-note">总投资、民间、制造业与基础设施投资均为年初累计同比；基建采用国家统计局现行含电力口径。比较结构方向，不将各项增速相加。</p> : null}{subgroup === "工业生产" ? <p className="intrayear-subgroup-note">制造业 PMI 新订单是后续需求的扩散指数，规模以上工业增加值是已实现产出；二者可前后对照，但指数点与同比增速不可直接比较或相加。</p> : null}<div className="intrayear-grid-cards">{rows.map(renderIntrayearCard)}{subgroup === "消费" ? <ConsumerCategoryChart /> : null}</div>{subgroup === "工业生产" ? <IndustrialMetricsCharts /> : null}{subgroup === "房地产" ? <RealEstateCharts /> : null}</>}
              {subgroup === "投资" ? <InwardFdiChart /> : null}
            </section>;
          })}
        </section>;
        if (pillar === "金融信贷") return <section className="intrayear-pillar" key={pillar} aria-label="金融信贷逐期走势">
          <div className="intrayear-pillar-heading"><h3>金融信贷</h3><span>按信贷结构、社会融资、货币供给分组；逐月与季度口径分开</span></div>
          <section className="intrayear-subgroup" aria-label="信贷结构走势"><div className="intrayear-subgroup-heading"><h4>信贷结构</h4><span>居民与企（事）业单位 · 短期及中长期</span></div><p className="intrayear-subgroup-note">展示2023年至2026年人民银行逐月可核验的分部门新增贷款；每张图可切换当月增量与年初累计。截图只作版式参考，不从图像读取数值。</p><FinanceCreditCharts /></section>
          <section className="intrayear-subgroup" aria-label="社会融资走势"><div className="intrayear-subgroup-heading"><h4>社会融资</h4><span>存量增速与当月融资总量</span></div><p className="intrayear-subgroup-note">存量同比看融资余额趋势；当月增量看融资流量，两者频率口径各自独立，不重复展示信贷结构中的分部门贷款。</p><SocialFinancingCharts /></section>
          <section className="intrayear-subgroup" aria-label="货币供给观察"><div className="intrayear-subgroup-heading"><h4>货币供给</h4><span>M0、M1、M2 与 M1－M2</span></div><MoneySupplyCards /></section>
        </section>;
        if (pillar === "宏观调控") return <section className="intrayear-pillar" key={pillar} aria-label="宏观调控逐期走势">
          <div className="intrayear-pillar-heading"><h3>宏观调控</h3><span>货币与财政看逐期指标，产业政策与制度建设看官方事项进展</span></div>
          <section className="intrayear-subgroup" aria-label="货币政策走势"><div className="intrayear-subgroup-heading"><h4>货币政策</h4><span>LPR 与国债期限结构</span></div><MacroPolicyCharts section="货币政策" /></section>
          <section className="intrayear-subgroup" aria-label="财政政策走势"><div className="intrayear-subgroup-heading"><h4>财政政策</h4><span>财政收支、专项债发行与赤字率</span></div><MacroPolicyCharts section="财政政策" /></section>
          <PolicyTracker />
        </section>;
        if (pillar === "核心会议") return <section className="intrayear-pillar" key={pillar} aria-label="核心会议跟踪"><CoreMeetingTracker /></section>;
        const primaryRows = group === "全部" ? pillarRows.filter((item) => featuredMetrics.has(item.metric)) : pillarRows;
        const secondaryRows = group === "全部" ? pillarRows.filter((item) => !featuredMetrics.has(item.metric)) : [];
        return <section className="intrayear-pillar" key={pillar} aria-label={`${pillar}逐期走势`}>
          <div className="intrayear-pillar-heading"><h3>{pillar}</h3><span>{pillarRows.length} 条已核验逐期曲线</span></div>
          <div className="intrayear-grid-cards">{primaryRows.map(renderIntrayearCard)}</div>
          {secondaryRows.length ? <details className="intrayear-more"><summary>查看{pillar}其他 {secondaryRows.length} 条曲线</summary><div className="intrayear-grid-cards">{secondaryRows.map(renderIntrayearCard)}</div></details> : null}
        </section>;
      })}
      <details className="intrayear-source-details"><summary>查看逐期原始发布与统计期</summary><div><strong>国家统计局 GDP 单季实际同比、环比</strong>{intrayear.gdpQuarterlySources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局经济运行</strong>{intrayear.activitySources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局价格月报</strong>{intrayear.priceSources.flatMap((source) => [<a href={source.cpiUrl} key={`${source.period}-cpi`} target="_blank" rel="noreferrer">{source.period} CPI/核心 CPI ↗</a>, <a href={source.ppiUrl} key={`${source.period}-ppi`} target="_blank" rel="noreferrer">{source.period} PPI ↗</a>])}</div><div><strong>国家统计局核心 CPI</strong>{intrayear.coreCpiSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局民间投资</strong>{intrayear.privateInvestmentSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局非制造业 PMI</strong>{intrayear.nonManufacturingPmiSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家统计局 GDP 平减指数推算</strong>{intrayear.deflatorSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>中国人民银行社融</strong>{intrayear.creditSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>财政部财政收支</strong>{intrayear.fiscalSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家外汇管理局外汇储备</strong>{intrayear.reserveSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家外汇管理局货物及服务贸易月度数据</strong>{intrayear.tradeSources.map((source) => <a href={source.url} key={source.period} target="_blank" rel="noreferrer">{source.period} ↗</a>)}</div><div><strong>国家外汇管理局国际收支季度序列</strong><a href={intrayear.tradeQuarterly.sourceUrl} target="_blank" rel="noreferrer">季度序列说明 ↗</a><a href={intrayear.tradeQuarterly.dataUrl} target="_blank" rel="noreferrer">最新季度BPM6数据表 ↗</a></div></details>
    </section>
    <section className="panel">
      <details className="history-annual-details"><summary><strong>2022—2025 年度参照</strong><span>长期背景 · 不与2026逐期数据连线</span></summary>
      <MacroChartHeader kicker="ANNUAL COMPARISON" title="完整年度比较" lead="完整年度作背景，当期读数看最新方向" detail="年度趋势不与单季、单月或累计数据直接连线。" />
      <details className="macro-chart-help"><summary>年度比较口径</summary><p>{advisory.macroHistory.note}</p></details>
      <div className="table-wrap"><table className="dense-table macro-history-table"><thead><tr><th>指标 / 年度口径</th>{advisory.macroHistory.periods.map((item) => <th key={item}>{item}</th>)}<th>年度轨迹</th><th>2026 当前观察<br /><small>不与全年直接比较</small></th><th>阅读要点</th></tr></thead><tbody>{rows.map((item) => {
        const indicator = "latestIndicatorId" in item && item.latestIndicatorId ? indicatorsById.get(item.latestIndicatorId) : undefined;
        const latest = "latest" in item ? item.latest : undefined;
        const currentValue = indicator?.currentValue ?? latest?.value;
        const currentPeriod = indicator?.period ?? latest?.period;
        const currentSource = indicator?.currentSource ?? latest?.source;
        return <tr key={item.metric}><td><strong>{item.metric}</strong><small>{item.group} · {item.basis} · {item.unit}</small></td>{item.values.map((value, index) => <td key={advisory.macroHistory.periods[index]}>{value.toFixed(1)}</td>)}<td><AnnualSparkline values={item.values} label={item.metric} /></td><td className="history-current"><strong>{display(currentValue)}</strong><small>{display(currentPeriod)}</small><small>{display(currentSource)}</small>{latest?.url ? <a href={latest.url} target="_blank" rel="noreferrer">当期官方发布 ↗</a> : null}</td><td className="wide-cell">{item.interpretation}</td></tr>;
      })}</tbody></table></div>
      <p className="research-footnote">年度折线只连接 2022—2025 完整年度读数；“2026 当前观察”可能是单季、单月或年初累计，用来查看最新方向，不计算与全年值的差额。</p>
      <div className="history-sources"><span>年度原始来源：</span>{advisory.macroHistory.annualSources.map((source) => <a href={source.url} key={source.year} target="_blank" rel="noreferrer">{source.year} 国家统计局公报 ↗</a>)}</div>
      </details>
    </section>
  </div>;
}

function MacroView() {
  const tabs = ["宏观概览", "宏观图谱", "宏观评级", "资产传导"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const [historyGroup, setHistoryGroup] = useState<"经济运行" | "增长动力" | "金融信贷" | "宏观调控">("经济运行");
  return <div className="research-stack macro-research">
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="宏观研究页面" />
    {tab === "宏观概览" ? <section className="panel macro-overview"><MacroOverviewHeader /><div className="macro-overview-brief"><div className="macro-overview-brief-heading"><b>当前宏观简评</b><span>截至 {advisory.macroBrief.asOf} · 研究判断，不等同于新版宏观评级</span></div><p>{advisory.macroBrief.summary}</p><details><summary>查看官方数据依据</summary><div>{advisory.macroBrief.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</div></details></div><div className="macro-overview-grid">{advisory.macroPillars.map((item) => <article key={item.name}><div className="macro-overview-card-top"><h3>{item.name}</h3><span>{item.signal}</span></div><strong>{item.direction}</strong><p>{item.evidence}</p><small>后续观察：{item.watch}</small><button type="button" onClick={() => { setHistoryGroup(item.name as typeof historyGroup); setTab("宏观图谱"); }}>查看相关图表 →</button></article>)}</div></section> : null}
    {tab === "宏观图谱" ? <MacroHistoryView key={historyGroup} initialGroup={historyGroup} /> : null}
    {tab === "宏观评级" ? <section className="panel macro-rating"><MacroRatingWorkbook /></section> : null}
    {tab === "资产传导" ? <section className="panel"><ResearchHeader kicker="MACRO TO ASSET" title="宏观变量如何决定各类资产" note="增长、通胀、信用、政策、全球利率和风险偏好共同决定赔率。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>决定因素</th><th>当前读数</th><th>权益</th><th>债券</th><th>商品</th><th>黄金</th><th>另类策略</th></tr></thead><tbody>{advisory.assetTransmission.map((item) => <tr key={item.driver}><td><strong>{item.driver}</strong></td><td>{item.current}</td><td>{item.equity}</td><td>{item.bond}</td><td>{item.commodity}</td><td>{item.gold}</td><td>{item.alternatives}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function StockScoreView() {
  const dimensions = stockRatingDimensions;
  const totalWeight = dimensions.reduce((total, item) => total + item.weight, 0);
  return <section className="panel">
    <ResearchHeader kicker="EQUITY SCORECARD" title="评分总览" note="中国股票 · 中长线配置，兼顾周期买卖点。" />
    <div className="table-wrap"><table className="dense-table" aria-label="股票评分权重与得分">
      <thead><tr><th scope="col">评分维度</th><th scope="col">权重</th><th scope="col">当前得分</th></tr></thead>
      <tbody>{dimensions.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.weight}%</td><td className="muted">待评分</td></tr>)}</tbody>
      <tfoot><tr><td><strong>合计 / 综合得分</strong></td><td><strong>{totalWeight}%</strong></td><td className="muted">待评分</td></tr></tfoot>
    </table></div>
    <p className="research-footnote">六项权重合计 {totalWeight}%，各项得分将在评分规则与依据确认后填写。“机会与风险”不参与加权评分。</p>
  </section>;
}

function StockView() {
  const tabs = ["评分总览", "股票图谱", "评分指标", "评分标准", "评分记录"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const viewStandard = (id: string) => { setSelectedRuleId(id); setTab("评分标准"); };
  return <div className="research-stack stock-research">
    <ResearchTabs items={tabs} active={tab} onChange={(item) => { setTab(item as (typeof tabs)[number]); setSelectedRuleId(null); }} label="股票研究分项" />
    {tab === "评分总览" ? <StockScoreView /> : null}
    {tab === "评分指标" ? <StockRatingIndicators onViewStandard={viewStandard} /> : null}
    {tab === "评分标准" ? <StockRatingStandards key={selectedRuleId ?? "all"} selectedRuleId={selectedRuleId} /> : null}
    {tab === "股票图谱" || tab === "评分记录" ? <section className="panel"><ResearchHeader kicker="EQUITIES" title={tab} note={tab === "评分记录" ? "暂无评分记录。" : "研究内容待补充。"} /></section> : null}
  </div>;
}

function AssetView() {
  const tabs = ["资产总表", "股票", "债券", "商品"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  return <div className="research-stack">
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="大类资产研究页面" />
    {tab === "资产总表" ? <><section className="panel"><ResearchHeader kicker="PERFORMANCE" title="大类资产表现" note="不同日期、币种和指数口径不可直接排名。" /><div className="market-snapshot-grid">{advisory.marketSnapshots.map((item) => <article key={item.name}><span>{item.name}</span><strong className={item.ytd.includes("−") ? "negative" : "positive"}>{item.ytd}</strong><small>YTD · {item.asOf}</small></article>)}</div><p className="research-footnote">表现只是结果；建议由宏观、估值/赔率、盈利/Carry、趋势、流动性和尾部风险共同推导。</p></section><section className="panel"><ResearchHeader kicker="SIX-DIMENSION METHOD" title="大类资产建议如何推导" note="每个资产回答六个问题，避免用单一涨跌给结论。" /><div className="dimension-grid">{advisory.assetRatingDimensions.map((item) => <article key={item.name}><span>{item.weight}</span><h3>{item.name}</h3><p>{item.question}</p></article>)}</div></section><section className="panel"><ResearchHeader kicker="ASSET SCORECARD" title="估值、赔率、风险与结论在一张表" note="继承 2026 年中期内参观点并补齐证据链。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>资产</th><th>观点</th><th>宏观匹配</th><th>估值/赔率</th><th>盈利/Carry</th><th>趋势/资金</th><th>流动性</th><th>主要风险</th><th>实施结论</th></tr></thead><tbody>{advisory.assetScorecards.map((item) => <tr key={item.asset}><td><strong>{item.asset}</strong></td><td><span className={`view-chip ${item.stance.includes("超配") ? "up" : item.stance.includes("低配") ? "down" : "flat"}`}>{item.stance}</span></td><td>{item.macro}</td><td>{item.valuation}</td><td>{item.carry}</td><td>{item.trend}</td><td>{item.liquidity}</td><td>{item.risk}</td><td className="wide-cell"><strong>{item.conclusion}</strong></td></tr>)}</tbody></table></div></section></> : null}
    {tab === "股票" ? <StockView /> : null}
    {tab === "债券" || tab === "商品" ? <section className="panel"><ResearchHeader kicker={tab === "债券" ? "BONDS" : "COMMODITIES"} title={tab} note="研究内容待补充。" /></section> : null}
  </div>;
}

function MesoView() {
  const tabs = ["区域比较", "分析框架", "风格数据", "产业数据"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  return <div className="research-stack">
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="中观研究页面" />
    {tab === "区域比较" ? <section className="panel"><ResearchHeader kicker="REGIONAL MAP" title="中国、日韩、美国与全球同表比较" note="缺失的海外最新数据留空；后续采集增长、通胀、利率、盈利修正、估值和资金流。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>区域</th><th>增长</th><th>通胀</th><th>利率</th><th>盈利</th><th>估值</th><th>产业抓手</th><th>观点</th><th>待补数据</th></tr></thead><tbody>{advisory.regionalIndicators.map((item) => <tr key={item.region}><td><strong>{item.region}</strong></td><td>{item.growth}</td><td>{item.inflation}</td><td>{item.rates}</td><td>{item.earnings}</td><td>{item.valuation}</td><td>{item.industries}</td><td><span className="view-chip flat">{item.stance}</span></td><td>{item.missing}</td></tr>)}</tbody></table></div></section> : null}
    {tab === "分析框架" ? <section className="panel"><ResearchHeader kicker="MESO SIX LENSES" title="中观不止产业和风格" note="盈利、估值、供需、资本开支、资金拥挤与全球映射六层交叉。" /><div className="framework-grid">{advisory.mesoLenses.map((item, index) => <article key={item.lens}><span>0{index + 1}</span><h3>{item.lens}</h3><p>{item.metrics}</p><small>{item.decision}</small></article>)}</div></section> : null}
    {tab === "风格数据" ? <><section className="panel"><ResearchHeader kicker="STYLE TAPE" title="交易结构与拥挤度" note="成交结构用于控制风险预算，不替代盈利与估值。" /><div className="style-monitor">{advisory.styles.map((item) => <div key={item.factor}><span>{item.factor}</span><strong>{item.reading}</strong><p>{item.signal}</p><small>{item.action}</small></div>)}</div></section><section className="panel"><ResearchHeader kicker="STYLE FUNDAMENTALS" title="风格估值与盈利表" note="估值截至 2026-07-18，盈利截至 2026-03-31。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>风格</th><th>ERP%</th><th>PE/分位</th><th>PB/分位</th><th>ROE%</th><th>股息%</th><th>收入%</th><th>利润%</th><th>观点与逻辑</th></tr></thead><tbody>{advisory.styleValuations.map((item) => <tr key={item.style}><td><strong>{item.style}</strong></td><td>{item.erp}</td><td>{item.pe}/{item.pePct}%</td><td>{item.pb}/{item.pbPct}%</td><td>{item.roe}</td><td>{item.dividend}</td><td>{item.revenueGrowth}</td><td>{item.profitGrowth}</td><td className="wide-cell"><strong>{item.view}</strong><small>{item.logic}</small></td></tr>)}</tbody></table></div></section></> : null}
    {tab === "产业数据" ? <section className="panel"><ResearchHeader kicker="INDUSTRY MATRIX" title="11 个行业：估值、质量与盈利同表" note="不再用“景气强/弱”替代数据；地产 PE 无意义时明确留空。" /><div className="table-wrap"><table className="dense-table numeric-table"><thead><tr><th>行业</th><th>ERP%</th><th>PE/分位</th><th>PB/分位</th><th>ROE%</th><th>股息%</th><th>收入增速%</th><th>利润增速%</th><th>观点</th><th>判断依据</th></tr></thead><tbody>{advisory.industries.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.erp}</td><td>{display(item.pe)} / {display(item.pePct)}{item.pePct == null ? "" : "%"}</td><td>{item.pb} / {item.pbPct}%</td><td>{item.roe}</td><td>{item.dividend}</td><td>{item.revenueGrowth}</td><td>{item.profitGrowth}</td><td><span className={`view-chip ${item.stance.includes("超配") ? "up" : item.stance.includes("低配") ? "down" : "flat"}`}>{item.stance}</span></td><td className="wide-cell">{item.logic}</td></tr>)}</tbody></table></div></section> : null}
  </div>;
}

function MicroView() {
  const tabs = ["当下实施", "公募与ETF", "私募策略", "评级体系"] as const;
  const [tab, setTab] = useState<(typeof tabs)[number]>(tabs[0]);
  return <div className="research-stack">
    <section className="panel"><ResearchHeader kicker="PRODUCT UNIVERSE" title="公募、ETF 与 11 类私募策略" note="现有截图保留为候选池来源；看不清的产品名不猜测，先用策略层和公开 ETF 建立可用版面。" /><div className="coverage-chips">{advisory.productCoverage.map((item) => <span key={item}>{item}</span>)}</div></section>
    <ResearchTabs items={tabs} active={tab} onChange={(item) => setTab(item as (typeof tabs)[number])} label="微观产品研究页面" />
    {tab === "当下实施" ? <><section className="panel"><ResearchHeader kicker="TOP-DOWN TO PRODUCT" title="宏观—资产—中观—产品实施链" note="公募用于透明、低成本、流动性好的 Beta/主题；私募用于难复制 Alpha、做空/衍生品和低相关收益。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>目标</th><th>宏观依据</th><th>资产结论</th><th>中观落点</th><th>优先工具</th><th>候选</th><th>当前动作</th></tr></thead><tbody>{advisory.implementationMap.map((item) => <tr key={item.objective}><td><strong>{item.objective}</strong></td><td>{item.macro}</td><td>{item.asset}</td><td>{item.meso}</td><td><span className="view-chip flat">{item.preferred}</span></td><td>{item.candidates}</td><td className="wide-cell"><strong>{item.action}</strong></td></tr>)}</tbody></table></div></section><section className="micro-grid"><article className="panel"><ResearchHeader kicker="BENCHMARK STRESS" title="策略基准压力表" note="用户上传快照，截至 2026-07-24" /><div className="table-wrap"><table><thead><tr><th>基准</th><th>本月</th><th>今年</th><th>近一年 Sharpe</th><th>近一年回撤</th></tr></thead><tbody>{advisory.benchmarks.map((item) => <tr key={item.name}><td><strong>{item.name}</strong></td><td>{item.mtd}</td><td>{item.ytd}</td><td>{item.sharpe}</td><td>{item.drawdown}</td></tr>)}</tbody></table></div></article><article className="panel gate-panel"><p className="eyebrow">FIVE GATES</p><h2>进入组合前的五道门</h2><ol><li>观察：数据完整、策略可解释</li><li>短名单：同基准、同周期比较</li><li>尽调：团队、流程、风控与治理</li><li>试配：小仓位验证相关性与流动性</li><li>复核：季度归因、年度深度复审</li></ol></article></section></> : null}
    {tab === "公募与ETF" ? <section className="panel"><ResearchHeader kicker="PUBLIC VEHICLES" title="公开 ETF 候选与待补数据" note="产品身份已由交易所来源确认；规模、跟踪误差、成交和费率未核验前不打分。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>代码 / 产品</th><th>组合角色</th><th>基准</th><th>当前判断</th><th>规模</th><th>跟踪误差</th><th>日均成交</th><th>总费率</th><th>内部评分</th><th>缺口 / 官方来源</th></tr></thead><tbody>{advisory.etfCandidates.map((item) => <tr key={item.code}><td><strong>{item.code}</strong><small>{item.name}</small></td><td>{item.role}</td><td>{item.benchmark}</td><td><span className="view-chip flat">{item.currentView}</span></td><td>{display(item.aum)}</td><td>{display(item.trackingError)}</td><td>{display(item.avgTurnover)}</td><td>{display(item.totalFee)}</td><td>{display(item.score)}</td><td className="wide-cell">{item.missing}<small><a href={item.source} target="_blank" rel="noreferrer">交易所来源 ↗</a></small></td></tr>)}</tbody></table></div><div className="professional-boundary"><b>公募选择原则</b><p>需要可交易 Beta、透明持仓、较高流动性和低费率时优先 ETF；需要可验证的选股 Alpha 且能接受风格偏离时，再考虑主动公募。所有比较必须统一基准与持有期。</p></div></section> : null}
    {tab === "私募策略" ? <section className="panel"><ResearchHeader kicker="PRIVATE STRATEGY DUE DILIGENCE" title="11 类私募策略的评价方法与当前用途" note="策略之间不能按同一收益排名；每类使用不同的风险与归因指标。" /><div className="table-wrap"><table className="dense-table"><thead><tr><th>策略</th><th>必须分析的数据</th><th>与宏观/中观的连接</th><th>当前用途</th><th>产品级状态</th></tr></thead><tbody>{advisory.privateStrategyMatrix.map((item) => <tr key={item.strategy}><td><strong>{item.strategy}</strong></td><td className="wide-cell">{item.mustSee}</td><td>{item.macroLink}</td><td>{item.currentUse}</td><td><span className="pending-text">{item.status}</span></td></tr>)}</tbody></table></div><p className="research-footnote">原截图中的具体产品在可辨识度不足时不录入名称；补充原始 Excel/净值文件后，可自动进入同策略排名、归因和评级。</p></section> : null}
    {tab === "评级体系" ? <><section className="rating-policy"><div><span>评级性质</span><strong>{advisory.ratingPolicy.title}</strong></div><div><span>数据门槛</span><strong>{advisory.ratingPolicy.dataGate}</strong></div><div><span>复核频率</span><strong>{advisory.ratingPolicy.review}</strong></div></section><section className="panel"><ResearchHeader kicker="INTERNAL RATING" title="ETF、主动公募与私募分别评级" note="先过数据完整性和准入门，再比较收益、风险、稳定性、治理与组合适配。" /><div className="rating-model-grid">{advisory.productRatingModels.map((model) => <article key={model.type}><h3>{model.type}</h3><p>{model.grade}</p><div>{model.dimensions.map((item) => <div key={String(item[0])}><span>{item[0]}</span><b>{item[1]}%</b><small>{item[2]}</small></div>)}</div></article>)}</div><div className="grade-row">{advisory.ratingPolicy.grades.map((item) => <span key={item}>{item}</span>)}</div></section></> : null}
  </div>;
}

function AllocationBars({ model }: { model: ModelSnapshot }) {
  return (
    <div className="allocation-bars" aria-label="当前仓位与建议目标对比">
      {model.allocations.map((item) => (
        <div className="bar-row" key={item.asset}>
          <div className="bar-label">
            <span>{item.asset}</span>
            <strong>{pct(item.target)}</strong>
          </div>
          <div className="bar-track">
            <span className="bar-current" style={{ width: pct(item.current), background: ASSET_COLOR[item.asset] }} />
            <span className="bar-target-marker" style={{ left: pct(item.target) }} />
          </div>
          <div className="bar-legend"><span>当前 {pct(item.current)}</span><span>目标 {pct(item.target)}</span></div>
        </div>
      ))}
    </div>
  );
}

function Overview({ model }: { model: ModelSnapshot }) {
  const triggerCount = model.allocations.filter((item) => item.action !== "观察").length;
  return (
    <>
      <section className="kpi-grid">
        <article className="kpi-card primary">
          <p>上证指数</p>
          <strong>{model.input.index.value.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</strong>
          <span className={Number(model.input.index.changePct ?? 0) >= 0 ? "positive" : "negative"}>
            {model.input.index.changePct == null ? "—" : `${model.input.index.changePct > 0 ? "+" : ""}${model.input.index.changePct.toFixed(2)}%`}
          </span>
        </article>
        <article className="kpi-card">
          <p>股票建议仓位</p>
          <strong>{pct(model.allocations[0].target)}</strong>
          <span>点位锚与战术信号共同生成</span>
        </article>
        <article className="kpi-card">
          <p>组合目标合计</p>
          <strong>{pct(model.checks.targetTotal)}</strong>
          <span>上下限与归一约束</span>
        </article>
        <article className={`kpi-card ${model.checks.status === "模型通过" ? "success" : "warning"}`}>
          <p>模型状态</p>
          <strong>{model.checks.status}</strong>
          <span>{triggerCount} 项触发调仓</span>
        </article>
      </section>

      {model.input.notes[0] ? <p className="research-footnote">{model.input.notes[0]}</p> : null}

      <section className="two-column">
        <article className="panel">
          <div className="section-heading">
            <div><p className="eyebrow">目标组合</p><h2>大类资产调仓建议</h2></div>
            <span className="muted">阈值抑制频繁交易</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>资产</th><th>当前</th><th>目标</th><th>差额</th><th>信号</th><th>观点</th><th>执行</th></tr></thead>
              <tbody>
                {model.allocations.map((item) => (
                  <tr key={item.asset}>
                    <td><span className="asset-dot" style={{ background: ASSET_COLOR[item.asset] }} />{item.asset}</td>
                    <td>{pct(item.current)}</td><td><strong>{pct(item.target)}</strong></td>
                    <td className={item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : ""}>{signedPct(item.difference)}</td>
                    <td>{score(item.signal)}</td><td>{item.view}</td>
                    <td><span className={`action ${item.action}`}>{item.action}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <div className="section-heading"><div><p className="eyebrow">仓位对比</p><h2>当前 vs 建议目标</h2></div></div>
          <AllocationBars model={model} />
        </article>
      </section>

      <section className="panel rationale-panel">
        <div className="section-heading"><div><p className="eyebrow">审计线索</p><h2>建议依据</h2></div></div>
        <div className="rationale-grid">
          {model.allocations.map((item) => (
            <div key={item.asset} className="rationale-card">
              <span>{item.asset}</span><strong>{item.rationale}</strong><p>{item.trigger} · 调仓阈值 {pct(item.threshold)}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Factors({ model }: { model: ModelSnapshot }) {
  const sourceById = Object.fromEntries(model.input.sources.map((source) => [source.id, source]));
  return (
    <div className="stack">
      {(["股票", "债券", "商品", "另类"] as AssetName[]).map((asset) => (
        <section className="panel" key={asset}>
          <div className="section-heading">
            <div><p className="eyebrow">{asset}信号</p><h2>{asset}因子证据</h2></div>
            <strong className="signal-badge">{score(model.allocations.find((item) => item.asset === asset)?.signal ?? 0)}</strong>
          </div>
          <div className="factor-list">
            {model.input.factors.filter((factor) => factor.asset === asset).map((factor) => (
              <article className="factor-card" key={factor.factor}>
                <div className="factor-top"><div><h3>{factor.factor}</h3><p>{factor.indicator}</p></div><span className={`score-pill score-${String(factor.score).replace("-", "n").replace(".", "_")}`}>{factor.score > 0 ? "+" : ""}{factor.score.toFixed(1)}</span></div>
                <div className="factor-meta"><span>权重 {pct(factor.weight, 0)}</span><span>{factor.frequency}</span><span className={factor.verified ? "verified" : "unverified"}>{factor.verified ? "已核验" : "待核验"}</span></div>
                <p className="evidence">{factor.evidence}</p>
                {factor.sourceIds.length ? <div className="source-links">{factor.sourceIds.map((id) => sourceById[id] ? <a href={sourceById[id].url} target="_blank" rel="noreferrer" key={id}>{sourceById[id].publisher} ↗</a> : null)}</div> : null}
              </article>
            ))}
          </div>
        </section>
      ))}

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">股票风格</p><h2>风格轮动信号矩阵</h2></div></div>
        <div className="style-score-grid">
          {Object.entries(model.styleScores).map(([name, value]) => <div key={name}><span>{name}</span><strong>{score(value)}</strong></div>)}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>风格因子</th><th>评分</th><th>权重</th><th>红利暴露</th><th>GARP暴露</th><th>成长暴露</th><th>判定口径</th></tr></thead>
            <tbody>{model.input.styleFactors.map((factor) => <tr key={factor.factor}><td>{factor.factor}</td><td>{factor.score.toFixed(1)}</td><td>{pct(factor.weight, 0)}</td><td>{factor.exposure.dividend.toFixed(1)}</td><td>{factor.exposure.garp.toFixed(1)}</td><td>{factor.exposure.growth.toFixed(1)}</td><td>{factor.methodology}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function SubAllocationView({ model }: { model: ModelSnapshot }) {
  return <section className="panel"><div className="section-heading"><div><p className="eyebrow">母资产内归一</p><h2>细分方向建议</h2></div><span className="muted">组合目标合计 {pct(model.checks.subTargetTotal)}</span></div><div className="table-wrap"><table><thead><tr><th>母资产</th><th>细分方向</th><th>母资产内基准</th><th>评分</th><th>母资产内目标</th><th>组合目标</th><th>当前</th><th>差额</th><th>执行</th><th>核心观察</th></tr></thead><tbody>{model.subAllocations.map((item) => <tr key={`${item.parent}-${item.name}`}><td>{item.parent}</td><td><strong>{item.name}</strong></td><td>{pct(item.baseWithinParent)}</td><td>{score(item.score)}</td><td>{pct(item.targetWithinParent)}</td><td>{pct(item.portfolioTarget)}</td><td>{pct(item.currentPortfolio)}</td><td className={item.difference > 0 ? "positive" : item.difference < 0 ? "negative" : ""}>{signedPct(item.difference)}</td><td><span className={`action ${item.action}`}>{item.action}</span></td><td>{item.watch}</td></tr>)}</tbody></table></div></section>;
}

function StressView({ model }: { model: ModelSnapshot }) {
  const maxStock = Math.max(...model.stressScenarios.map((item) => item.stock));
  return <div className="two-column stress-layout"><section className="panel"><div className="section-heading"><div><p className="eyebrow">点位路径</p><h2>指数点位与股票建议仓位</h2></div></div><div className="scenario-chart">{model.stressScenarios.map((item) => <div className="scenario-column" key={item.indexPoint}><div className="scenario-fill" style={{ height: `${(item.stock / maxStock) * 100}%` }}><span>{pct(item.stock, 0)}</span></div><strong>{item.indexPoint}</strong></div>)}</div></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">约束结果</p><h2>大类资产情景表</h2></div></div><div className="table-wrap"><table><thead><tr><th>上证点位</th><th>股票</th><th>债券</th><th>商品</th><th>另类</th></tr></thead><tbody>{model.stressScenarios.map((item) => <tr key={item.indexPoint}><td><strong>{item.indexPoint}</strong></td><td>{pct(item.stock)}</td><td>{pct(item.bond)}</td><td>{pct(item.commodity)}</td><td>{pct(item.alternative)}</td></tr>)}</tbody></table></div></section></div>;
}

function MethodView({ model }: { model: ModelSnapshot }) {
  return <div className="stack"><section className="panel"><div className="section-heading"><div><p className="eyebrow">模型参数</p><h2>大类资产约束</h2></div></div><div className="table-wrap"><table><thead><tr><th>资产</th><th>战略中枢</th><th>下限</th><th>上限</th><th>信号敏感度/分</th><th>调仓阈值</th></tr></thead><tbody>{Object.entries(modelParameters.assets).map(([asset, param]) => <tr key={asset}><td><strong>{asset}</strong></td><td>{pct(param.strategic)}</td><td>{pct(param.min)}</td><td>{pct(param.max)}</td><td>{pct(param.sensitivity)}</td><td>{pct(param.threshold)}</td></tr>)}</tbody></table></div></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">点位锚</p><h2>上证指数—股票基础仓位</h2></div></div><div className="anchor-grid">{modelParameters.indexAnchors.map((item) => <div key={item.point}><strong>{item.point}</strong><span>{pct(item.position, 0)}</span></div>)}</div></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">治理原则</p><h2>更新、复核与边界</h2></div></div><ol className="method-list"><li><strong>股票先定总仓位：</strong>点位分段线性插值，基本面、流动性、趋势与风险信号只做有限修正。</li><li><strong>剩余预算再分配：</strong>债券、商品、另类先形成各自原始目标，再在非股票预算内按相对强弱分配。</li><li><strong>上下限硬约束：</strong>所有目标不得突破产品约束，残差按可用空间二次分配并归一到 100%。</li><li><strong>阈值抑制换手：</strong>偏离不足阈值时只观察，达到阈值才生成增配或减配动作。</li><li><strong>证据化评分：</strong>定时任务记录来源、时间与结论；证据不足保持原值或中性，不猜测。</li><li><strong>人工复核边界：</strong>极端行情可临时触发，但政策、地缘和执行约束仍应由负责人复核。</li></ol></section><section className="panel"><div className="section-heading"><div><p className="eyebrow">数据来源</p><h2>本期证据清单</h2></div></div><div className="source-list">{model.input.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}><div><strong>{source.title}</strong><span>{source.publisher} · {new Date(source.observedAt).toLocaleString("zh-CN")}</span></div><span>打开来源 ↗</span></a>)}</div></section></div>;
}

function AllocationSystem({ model }: { model: ModelSnapshot }) {
  const [tab, setTab] = useState<AllocationTab>("配置总览");
  return <div className="allocation-system">
    <section className="allocation-intro">
      <div><p className="eyebrow">LIVE PORTFOLIO ENGINE</p><h2>资产配置与调仓建议</h2></div>
      <p>完整保留当前持仓、点位锚、19 项资产因子、6 项风格因子、细分目标、压力测试、参数约束和证据清单；本页数据仍按原有接口每 60 秒同步。</p>
    </section>
    <nav className="subtabs" aria-label="资产配置功能">
      {ALLOCATION_TABS.map((item) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
    </nav>
    {tab === "配置总览" ? <Overview model={model} /> : null}
    {tab === "市场因子" ? <Factors model={model} /> : null}
    {tab === "细分配置" ? <SubAllocationView model={model} /> : null}
    {tab === "情景压力" ? <StressView model={model} /> : null}
    {tab === "参数与方法" ? <MethodView model={model} /> : null}
  </div>;
}

export function Dashboard({ initialPayload }: { initialPayload: MarketInputPayload }) {
  const [payload, setPayload] = useState(initialPayload);
  const [tab, setTab] = useState<PrimaryTab>("宏观");
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const model = useMemo(() => calculateModel(payload), [payload]);

  async function refresh(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      if (response.status === 401) { window.location.reload(); return; }
      if (!response.ok) throw new Error("refresh failed");
      const next = (await response.json()) as { payload: MarketInputPayload };
      if (next.payload.collectedAt !== payload.collectedAt) {
        setPayload(next.payload);
        setMessage("已同步最新数据");
        window.setTimeout(() => setMessage(""), 3000);
      }
    } catch {
      if (!silent) setMessage("同步失败，将自动重试");
    } finally {
      if (!silent) setRefreshing(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(true); }, 60_000);
    return () => window.clearInterval(timer);
  });

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  }

  return <main className="app-shell">
    <header className="topbar"><div><p className="eyebrow">ASSET ALLOCATION WORKBENCH</p><h1>资产配置工作台</h1></div><div className="topbar-actions"><div className="live-status"><span /><div><strong>{freshness(payload)}</strong><small>宏观采集 · 组合数据日 {payload.asOf}</small></div></div><button className="ghost-button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "同步中…" : "同步最新"}</button><a className="ghost-button" href="/rating-draft">待发布评分</a><a className="ghost-button" href="/ops">运维健康</a><a className="ghost-button" href="/rating-tools">归因与情景</a><button className="ghost-button" onClick={logout}>退出</button></div></header>
    <div className={`data-banner ${payload.status}`}><strong>{payload.status === "verified" ? "本期数据已核验" : payload.status === "partial" ? "部分数据已核验" : "初始模板数据"}</strong><span>{payload.notes[0]}</span>{message ? <em>{message}</em> : null}</div>
    <section className="ic-strip"><div><span>宏观评级</span><strong>{macroRatingHeadline}</strong></div><div><span>增长范式</span><strong>{advisory.regime}</strong></div><div><span>当前组合</span><strong>{model.allocations.map((item) => `${item.asset}${pct(item.current, 0)}`).join(" · ")}</strong></div><div><span>模型状态</span><strong>{model.checks.status}</strong></div></section>
    <nav className="tabs primary-tabs" aria-label="五层投顾体系">{PRIMARY_TABS.map((item, index) => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}><span>0{index + 1}</span>{item}</button>)}</nav>
    <div className="content">{tab === "宏观" ? <MacroView /> : null}{tab === "大类资产" ? <AssetView /> : null}{tab === "中观" ? <MesoView /> : null}{tab === "微观" ? <MicroView /> : null}{tab === "资产配置" ? <AllocationSystem model={model} /> : null}</div>
  </main>;
}
