import { useMemo, useState } from 'react';
import type { ChartConfiguration } from 'chart.js/auto';
import { Download, RotateCcw, Search, Sparkles } from 'lucide-react';
import type {
  AnomalyFlag,
  GroupingMode,
  OverviewSortOrder,
  SalesRecord,
} from '../types/sales.ts';
import {
  customerOf,
  dateOf,
  employeeOf,
  formatCompactPhp,
  formatMoney,
  formatNumber,
  metricSum,
  productOf,
  promoOf,
  saleWeekStart,
  SCENARIO_META,
  skuOf,
  storeOf,
} from '../utils/salesAnalytics.ts';
import { buildCsvDocument } from '../utils/snapshotParser.ts';
import { AnomalyDetectorPanel } from './AnomalyDetectorPanel.tsx';
import { ChartCanvas } from './ChartCanvas.tsx';

interface OverviewDashboardProps {
  allRows: SalesRecord[];
  filteredRows: SalesRecord[];
  anomalies: AnomalyFlag[];
  skuChoices: string[];
  search: string;
  selectedSku: string;
  fromDate: string;
  toDate: string;
  sortOrder: OverviewSortOrder;
  grouping: 'month' | 'week' | 'day';
  isDark: boolean;
  onSearchChange: (v: string) => void;
  onSkuChange: (v: string) => void;
  onFromDateChange: (v: string) => void;
  onToDateChange: (v: string) => void;
  onSortOrderChange: (v: OverviewSortOrder) => void;
  onGroupingChange: (v: 'month' | 'week' | 'day') => void;
  onClearFilters: () => void;
  onOpenGemini: (task: 'executive-briefing' | 'anomaly-explanation') => void;
}

const CHART_COLORS = [
  '#a3e635',
  '#38bdf8',
  '#fb923c',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#f472b6',
  '#22d3ee',
];

export function OverviewDashboard({
  allRows,
  filteredRows,
  anomalies,
  skuChoices,
  search,
  selectedSku,
  fromDate,
  toDate,
  sortOrder,
  grouping,
  isDark,
  onSearchChange,
  onSkuChange,
  onFromDateChange,
  onToDateChange,
  onSortOrderChange,
  onGroupingChange,
  onClearFilters,
  onOpenGemini,
}: OverviewDashboardProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const distinctDateKeys = useMemo(() => {
    return new Set(allRows.map((r) => r.date_key).filter((k) => k !== null && k !== undefined));
  }, [allRows]);

  const singleDateKeyWarning = allRows.length > 1 && distinctDateKeys.size === 1;

  const stats = useMemo(() => {
    const netSales = metricSum(filteredRows, 'net_sales_collected');
    const units = metricSum(filteredRows, 'quantity_sold');
    const aov = filteredRows.length ? netSales / filteredRows.length : 0;
    const uniqueDates = [...new Set(filteredRows.map(dateOf).filter(Boolean))].sort();
    return {
      netSales,
      units,
      aov,
      uniqueDateCount: uniqueDates.length,
      dateSpan: uniqueDates.length
        ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
        : 'No readable sale dates',
    };
  }, [filteredRows]);

  const aggregations = useMemo(() => {
    const grouped = new Map<string, { sales: number; units: number }>();
    const products = new Map<string, number>();

    for (const row of filteredRows) {
      const day = dateOf(row);
      if (day) {
        const key =
          grouping === 'day' ? day : grouping === 'week' ? saleWeekStart(day) : day.slice(0, 7);
        const existing = grouped.get(key) ?? { sales: 0, units: 0 };
        existing.sales += Number(row.net_sales_collected) || 0;
        existing.units += Number(row.quantity_sold) || 0;
        grouped.set(key, existing);
      }
      const sku = skuOf(row) || 'Unspecified';
      products.set(sku, (products.get(sku) || 0) + (Number(row.net_sales_collected) || 0));
    }

    const labels = [...grouped.keys()].sort();
    const values = labels.map((k) => grouped.get(k)?.sales ?? 0);
    const rankedProducts = [...products.entries()].sort((a, b) => b[1] - a[1]);

    let peak: { date: string; value: number } | null = null;
    for (let i = 0; i < labels.length; i++) {
      if (!peak || values[i] > peak.value) {
        peak = { date: labels[i], value: values[i] };
      }
    }

    return { labels, values, rankedProducts, distinctProducts: products.size, peak };
  }, [filteredRows, grouping]);

  const tickColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.08)';
  const donutBorder = isDark ? '#111824' : '#ffffff';

  const trendConfig = useMemo<ChartConfiguration>(
    () => ({
      type: 'line',
      data: {
        labels: aggregations.labels,
        datasets: [
          {
            label: 'Net sales',
            data: aggregations.values,
            borderColor: isDark ? '#a3e635' : '#16a34a',
            backgroundColor: isDark ? 'rgba(163, 230, 53, 0.12)' : 'rgba(22, 163, 74, 0.1)',
            fill: true,
            borderWidth: 2.5,
            tension: 0.28,
            pointRadius: aggregations.labels.length > 55 ? 0 : 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: tickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: tickColor,
              callback: (v) => formatCompactPhp(Number(v)),
            },
            grid: { color: gridColor },
          },
        },
      },
    }),
    [aggregations, isDark, tickColor, gridColor]
  );

  const topProductsConfig = useMemo<ChartConfiguration>(() => {
    const top = aggregations.rankedProducts.slice(0, 8);
    return {
      type: 'bar',
      data: {
        labels: top.map((x) => x[0]),
        datasets: [
          {
            label: 'Net sales',
            data: top.map((x) => x[1]),
            backgroundColor: top.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderRadius: 6,
            maxBarThickness: 24,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Net sales: ${formatMoney(ctx.parsed.x)}`,
            },
          },
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: {
              color: tickColor,
              callback: (v) => formatCompactPhp(Number(v)),
            },
            grid: { color: gridColor },
          },
          y: {
            ticks: { color: tickColor },
            grid: { display: false },
          },
        },
      },
    };
  }, [aggregations.rankedProducts, tickColor, gridColor]);

  const donutConfig = useMemo<ChartConfiguration>(() => {
    const slice = aggregations.rankedProducts.slice(0, 6);
    const remaining = aggregations.rankedProducts.slice(6).reduce((s, p) => s + p[1], 0);
    if (remaining > 0) slice.push(['Other products', remaining]);

    return {
      type: 'doughnut',
      data: {
        labels: slice.map((x) => x[0]),
        datasets: [
          {
            label: 'Net sales',
            data: slice.map((x) => x[1]),
            backgroundColor: slice.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
            borderColor: donutBorder,
            borderWidth: 2,
            hoverOffset: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '66%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: tickColor, boxWidth: 11, padding: 12, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${formatMoney(Number(ctx.parsed))}`,
            },
          },
        },
      },
    };
  }, [aggregations.rankedProducts, donutBorder, tickColor]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const currentRows = filteredRows.slice(start, start + pageSize);

  const handleExportAll = () => {
    const heading = [
      'Sale ID',
      'Date',
      'Date Key',
      'SKU',
      'Product',
      'Customer',
      'Employee',
      'Store',
      'Promotion',
      'Quantity',
      'Gross Unit Price PHP',
      'Net Sales PHP',
    ];
    const data = filteredRows.map((row) => [
      row.sales_fact_id,
      dateOf(row),
      row.date_key,
      skuOf(row),
      productOf(row),
      customerOf(row),
      employeeOf(row),
      storeOf(row),
      promoOf(row),
      row.quantity_sold,
      row.gross_unit_price,
      row.net_sales_collected,
    ]);
    const csv = buildCsvDocument(heading, data);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'uniqlo-all-sales-records.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1400);
  };

  const intervalWord: Record<GroupingMode, string> = {
    day: 'daily',
    week: 'weekly',
    month: 'monthly',
    sale: 'per-sale',
  };

  return (
    <div className="space-y-6">
      {/* Section Heading */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            00 / Full Dataset Overview
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {SCENARIO_META.overview.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            {SCENARIO_META.overview.description}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onOpenGemini('executive-briefing')}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-lime-400 dark:text-slate-950 dark:hover:bg-lime-300"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>Generate Executive Briefing</span>
        </button>
      </div>

      {singleDateKeyWarning && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200"
        >
          Date quality warning: all {formatNumber(allRows.length)} sales share a single date_key (
          {[...distinctDateKeys][0]}). Run the companion SQL date repair before drawing historical conclusions.
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Sales Records</div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatNumber(filteredRows.length)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {filteredRows.length === allRows.length
              ? 'All loaded transactions'
              : `Filtered from ${formatNumber(allRows.length)} loaded`}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Net Sales</div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-emerald-700 dark:text-lime-300">
            {formatMoney(stats.netSales)}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Collected net revenue
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Units Sold</div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatNumber(stats.units)}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            Avg ticket: {formatMoney(stats.aov)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Distinct Sale Dates
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatNumber(stats.uniqueDateCount)}
          </div>
          <div className="mt-1 truncate font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {stats.dateSpan}
          </div>
        </div>
      </div>

      {/* Filter & Controls Toolbar */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-7">
          <label className="block lg:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Search
            </span>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  onSearchChange(e.target.value);
                  setPage(1);
                }}
                placeholder="ID, SKU, customer, store, promo..."
                className="w-full rounded-md border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Product SKU
            </span>
            <select
              value={selectedSku}
              onChange={(e) => {
                onSkuChange(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value="">All products</option>
              {skuChoices.map((sku) => (
                <option key={sku} value={sku}>
                  {sku}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              From Date
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                onFromDateChange(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              To Date
            </span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                onToDateChange(e.target.value);
                setPage(1);
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Sort Order
            </span>
            <select
              value={sortOrder}
              aria-label="Sort sales records"
              onChange={(e) => {
                onSortOrderChange(e.target.value as OverviewSortOrder);
                setPage(1);
              }}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value="id-desc">Newest ID</option>
              <option value="date-desc">Date ↓</option>
              <option value="date-asc">Date ↑</option>
              <option value="revenue-desc">Net Sales ↓</option>
              <option value="quantity-desc">Units ↓</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Group By
            </span>
            <select
              value={grouping}
              aria-label="Trend grouping"
              onChange={(e) => onGroupingChange(e.target.value as 'month' | 'week' | 'day')}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value="month">Month</option>
              <option value="week">Week</option>
              <option value="day">Day</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
          <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {formatNumber(filteredRows.length)} matching records from {formatNumber(allRows.length)} loaded
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClearFilters();
                setPage(1);
              }}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Filters</span>
            </button>
            <button
              type="button"
              onClick={handleExportAll}
              disabled={filteredRows.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>
      </div>

      {/* Charts Bento */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-12 dark:border-slate-800 dark:bg-[#111824]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Revenue Trend ({intervalWord[grouping]})
            </h2>
            <span className="font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {aggregations.labels.length} periods
            </span>
          </div>
          <ChartCanvas config={trendConfig} heightClass="h-72" ariaLabel="Revenue trend chart" />
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
            {filteredRows.length > 0
              ? `This ${intervalWord[grouping]} series aggregates net revenue across ${formatNumber(filteredRows.length)} filtered transactions.${aggregations.peak ? ` Peak period: ${aggregations.peak.date} (${formatMoney(aggregations.peak.value)}).` : ''}`
              : 'No sales match the current filters.'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7 dark:border-slate-800 dark:bg-[#111824]">
          <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
            Top Selling Products by Net Sales
          </h2>
          <ChartCanvas
            config={topProductsConfig}
            heightClass="h-72"
            ariaLabel="Top selling products bar chart"
          />
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
            {aggregations.rankedProducts[0]
              ? `Ranked by net revenue collected. ${aggregations.rankedProducts[0][0]} leads at ${formatMoney(aggregations.rankedProducts[0][1])}.`
              : 'No matching product revenue to rank.'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5 dark:border-slate-800 dark:bg-[#111824]">
          <h2 className="mb-3 text-base font-bold text-slate-900 dark:text-white">
            Product Revenue Distribution
          </h2>
          <ChartCanvas
            config={donutConfig}
            heightClass="h-72"
            ariaLabel="Product revenue distribution doughnut chart"
          />
          <p className="mt-3 border-t border-slate-200 pt-3 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:text-slate-400">
            {stats.netSales > 0
              ? `Share of ${formatMoney(stats.netSales)} filtered net sales across top SKUs and remaining catalog.`
              : 'No positive sales revenue available for distribution.'}
          </p>
        </div>
      </div>

      {/* Quick Insights Row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Top Product</div>
          <div className="mt-1.5 font-mono text-lg font-bold text-slate-900 dark:text-white">
            {aggregations.rankedProducts[0]?.[0] || '—'}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
            {aggregations.rankedProducts[0]
              ? `${formatMoney(aggregations.rankedProducts[0][1])} net sales`
              : 'No sales'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Best {grouping === 'day' ? 'Day' : grouping === 'week' ? 'Week' : 'Month'}
          </div>
          <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            {aggregations.peak?.date || '—'}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
            {aggregations.peak ? `${formatMoney(aggregations.peak.value)} net sales` : 'No dated sales'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Distinct Products
          </div>
          <div className="mt-1.5 font-mono text-lg font-bold tabular-nums text-slate-900 dark:text-white">
            {formatNumber(aggregations.distinctProducts)}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-600 dark:text-slate-400">
            {formatNumber(filteredRows.length)} filtered records
          </div>
        </div>
      </div>

      {/* Anomaly Detection Panel */}
      <AnomalyDetectorPanel
        anomalies={anomalies}
        filteredRowCount={filteredRows.length}
        onAskGeminiAnomalies={() => onOpenGemini('anomaly-explanation')}
      />

      {/* Complete Sales Records Table */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111824]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Complete Sales Records
            </h2>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {filteredRows.length
                ? `Showing ${formatNumber(start + 1)}–${formatNumber(Math.min(start + pageSize, filteredRows.length))} of ${formatNumber(filteredRows.length)} records`
                : '0 matching records'}
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span>Rows</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#0D131D] dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-3 py-2.5">ID</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">SKU</th>
                <th className="px-3 py-2.5">Product</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Employee</th>
                <th className="px-3 py-2.5">Store</th>
                <th className="px-3 py-2.5">Promo</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Unit Price</th>
                <th className="px-3 py-2.5 text-right">Net Sales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {currentRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={11}
                    className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    No sales match these filters.
                  </td>
                </tr>
              ) : (
                currentRows.map((row) => (
                  <tr
                    key={row.sales_fact_id}
                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/35"
                  >
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      #{row.sales_fact_id}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {dateOf(row) || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-800 dark:text-slate-200">
                      {skuOf(row) || '—'}
                    </td>
                    <td className="max-w-[210px] truncate px-3 py-2 text-slate-700 dark:text-slate-300">
                      {productOf(row) || '—'}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-700 dark:text-slate-300">
                      {customerOf(row) || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {employeeOf(row) || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {storeOf(row) || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap text-slate-600 dark:text-slate-400">
                      {promoOf(row) || '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatNumber(row.quantity_sold)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap text-slate-700 dark:text-slate-300">
                      {formatMoney(row.gross_unit_price)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums whitespace-nowrap text-slate-900 dark:text-lime-300">
                      {formatMoney(row.net_sales_collected)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono tabular-nums">
            Page {safePage} of {totalPages}
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={safePage <= 1}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              First
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={safePage >= totalPages}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              Last
            </button>
          </div>
        </div>

        <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
          Dates are read from <code className="font-mono">fact_sales.date_key</code> and{' '}
          <code className="font-mono">dim_date.full_date</code> (Jan 1, 2024 – Sep 26, 2026 simulated repair range).
        </p>
      </section>
    </div>
  );
}
