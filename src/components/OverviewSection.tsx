import { useMemo, useState } from 'react';
import type { ChartConfiguration } from 'chart.js/auto';
import type {
  AnomalyCategory,
  AnomalyFlag,
  LlmAnalysisTask,
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
  promoOf,
  saleWeekStart,
  skuOf,
  storeOf,
  productOf,
} from '../utils/salesAnalytics.ts';
import { buildCsvDocument } from '../utils/snapshotParser.ts';
import { ChartCanvas } from './ChartCanvas.tsx';

interface OverviewSectionProps {
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
  isLight: boolean;
  statusMessage: string;
  statusType: '' | 'success' | 'warning' | 'error';
  alertMessage: string;
  onSearchChange: (val: string) => void;
  onSkuChange: (val: string) => void;
  onFromDateChange: (val: string) => void;
  onToDateChange: (val: string) => void;
  onSortOrderChange: (val: OverviewSortOrder) => void;
  onGroupingChange: (val: 'month' | 'week' | 'day') => void;
  onClearFilters: () => void;
  onOpenGemini: (task: LlmAnalysisTask | null) => void;
}

const OVERVIEW_COLORS = [
  '#cf493a',
  '#76baff',
  '#ff9e77',
  '#b5a1ff',
  '#65dcb2',
  '#ffcf82',
  '#ef8bb3',
  '#8ee0ed',
];

function valueText(v: unknown): string {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

function downloadBlob(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

const systemOverview = [
  ['Who uses UniQlick?', 'Store managers and sales analysts can use it to see what sold, where it sold, and which promotions were applied.'],
  ['What can I see?', 'Start with net sales and units sold, then open the records behind those totals. The comparison page shows how the four Midterm scenarios look with the Finals data.'],
  ['Where do the records come from?', 'Sales are stored in Supabase. Each transaction links to its date, product, customer, store, employee, and promotion.'],
  ['When do the numbers update?', 'The dashboard loads the latest available records when you open it. Choose an auto-refresh interval in the header, or use Refresh on the cover page.'],
  ['Why use it?', 'If sales spike or drop, you can compare periods and inspect the transactions behind the change.'],
  ['How do I get started?', 'Pick a view in the sidebar, filter the records, or ask Scout a sales question. In Data Mining, Isolation Forest flags unusual patterns for you to review.'],
] as const;

export function OverviewSection({
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
  isLight,
  statusMessage,
  statusType,
  alertMessage,
  onSearchChange,
  onSkuChange,
  onFromDateChange,
  onToDateChange,
  onSortOrderChange,
  onGroupingChange,
  onClearFilters,
  onOpenGemini,
}: OverviewSectionProps) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | AnomalyCategory>('all');
  const [anomalyPage, setAnomalyPage] = useState(1);

  const totalSales = useMemo(() => metricSum(filteredRows, 'net_sales_collected'), [filteredRows]);
  const totalUnits = useMemo(() => metricSum(filteredRows, 'quantity_sold'), [filteredRows]);
  const avgTransaction = filteredRows.length ? totalSales / filteredRows.length : 0;

  const uniqueDates = useMemo(
    () => [...new Set(filteredRows.map(dateOf).filter(Boolean))].sort(),
    [filteredRows]
  );

  const { groupedLabels, groupedValues, rankedProducts, peakPeriod } = useMemo(() => {
    const grouped = new Map<string, { sales: number; units: number }>();
    const products = new Map<string, number>();

    for (const row of filteredRows) {
      const day = dateOf(row);
      if (day) {
        const key =
          grouping === 'day'
            ? day
            : grouping === 'week'
              ? saleWeekStart(day)
              : day.slice(0, 7);
        const existing = grouped.get(key) ?? { sales: 0, units: 0 };
        existing.sales += Number(row.net_sales_collected) || 0;
        existing.units += Number(row.quantity_sold) || 0;
        grouped.set(key, existing);
      }
      const sku = skuOf(row) || 'Unspecified';
      products.set(sku, (products.get(sku) ?? 0) + (Number(row.net_sales_collected) || 0));
    }

    const labels = [...grouped.keys()].sort();
    const values = labels.map((key) => grouped.get(key)!.sales);
    const ranked = [...products.entries()].sort((a, b) => b[1] - a[1]);
    const peak = labels.reduce<{ date: string; value: number } | null>(
      (best, date, i) => (values[i] > (best?.value ?? -Infinity) ? { date, value: values[i] } : best),
      null
    );

    return { groupedLabels: labels, groupedValues: values, rankedProducts: ranked, peakPeriod: peak };
  }, [filteredRows, grouping]);

  const axisTickColor = isLight ? '#513e46' : '#dccbd1';
  const gridColor = isLight ? '#d9e4f280' : '#ffffff12';
  const barLabelColor = isLight ? '#302128' : '#f3e2e7';
  const legendLabelColor = isLight ? '#49343c' : '#eedce3';
  const donutBorder = isLight ? '#ffffff' : '#0a1220';

  const trendConfig = useMemo<ChartConfiguration>(
    () => ({
      type: 'line',
      data: {
        labels: groupedLabels,
        datasets: [
          {
            label: 'Net sales',
            data: groupedValues,
            borderColor: isLight ? '#b32020' : '#cf493a',
            backgroundColor: isLight ? 'rgba(180,19,44,.09)' : 'rgba(226,50,75,.15)',
            fill: true,
            borderWidth: 3,
            tension: 0.3,
            pointRadius: groupedLabels.length > 55 ? 0 : 3,
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
            ticks: { color: axisTickColor, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: axisTickColor,
              callback: (v) => formatCompactPhp(Number(v)),
            },
            grid: { color: gridColor },
          },
        },
      },
    }),
    [groupedLabels, groupedValues, isLight, axisTickColor, gridColor]
  );

  const barsConfig = useMemo<ChartConfiguration>(() => {
    const top = rankedProducts.slice(0, 8);
    return {
      type: 'bar',
      data: {
        labels: top.map((x) => x[0]),
        datasets: [
          {
            label: 'Net sales',
            data: top.map((x) => x[1]),
            backgroundColor: top.map((_, i) => OVERVIEW_COLORS[i % OVERVIEW_COLORS.length]),
            borderRadius: 7,
            maxBarThickness: 25,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `Net sales: ${formatMoney(ctx.parsed.x)}`,
            },
          },
        },
        scales: {
          y: {
            ticks: { color: barLabelColor },
            grid: { display: false },
          },
          x: {
            beginAtZero: true,
            ticks: {
              color: axisTickColor,
              callback: (v) => formatCompactPhp(Number(v)),
            },
            grid: { color: gridColor },
          },
        },
      },
    };
  }, [rankedProducts, barLabelColor, axisTickColor, gridColor]);

  const donutConfig = useMemo<ChartConfiguration>(() => {
    const donut: Array<[string, number]> = rankedProducts.slice(0, 6);
    const remaining = rankedProducts.slice(6).reduce((sum, p) => sum + p[1], 0);
    if (remaining > 0) donut.push(['Other products', remaining]);

    return {
      type: 'doughnut',
      data: {
        labels: donut.map((x) => x[0]),
        datasets: [
          {
            label: 'Net sales',
            data: donut.map((x) => x[1]),
            backgroundColor: donut.map((_, i) => OVERVIEW_COLORS[i % OVERVIEW_COLORS.length]),
            borderColor: donutBorder,
            borderWidth: 3,
            hoverOffset: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: legendLabelColor, boxWidth: 12, padding: 14 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.label}: ${formatMoney(Number(ctx.parsed))}`,
            },
          },
        },
      },
    };
  }, [rankedProducts, donutBorder, legendLabelColor]);

  const intervalLabel = grouping === 'day' ? 'daily' : grouping === 'week' ? 'weekly' : 'monthly';
  const topProduct = rankedProducts[0] ?? null;

  const visibleAnomalies = useMemo(
    () =>
      anomalyFilter === 'all'
        ? anomalies
        : anomalies.filter((a) => a.type === anomalyFilter),
    [anomalies, anomalyFilter]
  );

  const anomalyPageSize = 10;
  const anomalyPages = Math.max(1, Math.ceil(visibleAnomalies.length / anomalyPageSize));
  const safeAnomalyPage = Math.min(anomalyPage, anomalyPages);
  const anomalyStart = (safeAnomalyPage - 1) * anomalyPageSize;
  const pagedAnomalies = visibleAnomalies.slice(anomalyStart, anomalyStart + anomalyPageSize);
  const highSeverityCount = anomalies.filter((x) => x.severity === 'High').length;

  const totalRecordPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, totalRecordPages);
  const recordStart = (safePage - 1) * pageSize;
  const pagedRows = filteredRows.slice(recordStart, recordStart + pageSize);

  const handleExportAllSales = () => {
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
    downloadBlob(buildCsvDocument(heading, data), 'uniqlick-all-sales-records.csv');
  };

  const handleExportAnomalies = () => {
    if (!visibleAnomalies.length) return;
    const header = ['Severity', 'Sale / Period', 'Date', 'Product SKU', 'Anomaly type', 'Explanation'];
    const data = visibleAnomalies.map((a) => [a.severity, a.id, a.date, a.sku, a.type, a.reason]);
    downloadBlob(buildCsvDocument(header, data), 'uniqlick-sales-anomaly-flags.csv');
  };

  return (
    <section id="overview" aria-labelledby="overviewHeading">
      <div className="card full-dash-title overview-intro">
        <div>
          <span className="overview-eyebrow">Executive Dashboard</span>
          <h2 id="overviewHeading">UNIQLO Retail Sales Overview</h2>
          <p>
            <strong>UNIQLO</strong> is a Japanese apparel retailer built around LifeWear, its approach to practical clothing for everyday life. Its product lines include HEATTECH and AIRism.
          </p>
          <p>
            <strong>UniQlick</strong> is a sales analytics project that uses a simulated UNIQLO retail dataset. Review net sales and units sold by product and store, see which purchases were made under promotions, and open the transactions behind a change in sales.
          </p>
        </div>
        <div className="full-dash-actions">
          <button
            id="overviewExport"
            className="action-btn primary"
            type="button"
            disabled={filteredRows.length === 0}
            onClick={handleExportAllSales}
          >
            ↓ Export filtered CSV
          </button>
        </div>
      </div>

      <section className="card system-overview" aria-labelledby="system-overview-heading">
        <h3 id="system-overview-heading">The Story Behind the Sale</h3>
        <dl>
          {systemOverview.map(([label, description]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div id="overviewStatus" className={`status ${statusType}`} role="status" aria-live="polite">
        {statusMessage}
      </div>

      <div
        id="overviewAlert"
        className={`overview-alert${alertMessage ? '' : ' hidden'}`}
        role="alert"
      >
        {alertMessage}
      </div>

      <div className="overview-kpis">
        <article className="overview-kpi">
          <div className="kpi-label">Sales records</div>
          <div id="ovCount" className="kpi-number">
            {formatNumber(filteredRows.length)}
          </div>
          <div id="ovCountDetail" className="kpi-detail">
            {filteredRows.length === allRows.length
              ? 'All loaded transactions'
              : `Filtered from ${formatNumber(allRows.length)} loaded`}
          </div>
        </article>
        <article className="overview-kpi">
          <div className="kpi-label">Total net sales</div>
          <div id="ovRevenue" className="kpi-number">
            {formatMoney(totalSales)}
          </div>
          <div className="kpi-detail">Filtered transactions</div>
        </article>
        <article className="overview-kpi">
          <div className="kpi-label">Units sold</div>
          <div id="ovUnits" className="kpi-number">
            {formatNumber(totalUnits)}
          </div>
          <div className="kpi-detail">Total quantity sold</div>
        </article>
        <article className="overview-kpi">
          <div className="kpi-label">Average transaction</div>
          <div id="ovAov" className="kpi-number">
            {formatMoney(avgTransaction)}
          </div>
          <div className="kpi-detail">Net sales / transactions</div>
        </article>
        <article className="overview-kpi date-quality-card">
          <div className="kpi-label">Distinct sale dates</div>
          <div id="ovUniqueDates" className="kpi-number">
            {formatNumber(uniqueDates.length)}
          </div>
          <div id="ovDateSpan" className="kpi-detail">
            {uniqueDates.length
              ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`
              : 'No readable sale dates'}
          </div>
        </article>
      </div>

      <div className="card full-filter-panel">
        <div className="overview-chart-head">
          <h3>Explore transactions</h3>
          <span>Search, filter, and inspect all available sales</span>
        </div>
        <div className="full-filters">
          <label className="search-field">
            Search records
            <input
              id="overviewSearch"
              type="search"
              placeholder="Sale ID, SKU, customer, store, promotion…"
              autoComplete="off"
              value={search}
              onChange={(e) => {
                onSearchChange(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Product
            <select
              id="overviewProduct"
              value={selectedSku}
              onChange={(e) => {
                onSkuChange(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All products</option>
              {skuChoices.map((sku) => (
                <option key={sku} value={sku}>
                  {sku}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date
            <input
              id="overviewFrom"
              type="date"
              value={fromDate}
              onChange={(e) => {
                onFromDateChange(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            End date
            <input
              id="overviewTo"
              type="date"
              value={toDate}
              onChange={(e) => {
                onToDateChange(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Sort by
            <select
              id="overviewSort"
              value={sortOrder}
              onChange={(e) => {
                onSortOrderChange(e.target.value as OverviewSortOrder);
                setPage(1);
              }}
            >
              <option value="id-desc">Sale ID · newest first</option>
              <option value="date-desc">Date · newest first</option>
              <option value="date-asc">Date · oldest first</option>
              <option value="revenue-desc">Highest net sales</option>
              <option value="quantity-desc">Highest quantity</option>
            </select>
          </label>
          <button
            id="overviewClear"
            className="action-btn"
            type="button"
            onClick={() => {
              onClearFilters();
              setPage(1);
            }}
          >
            Clear filters
          </button>
        </div>
      </div>

      <div id="overviewContents">
        <div className="overview-visual-grid">
          <div className="card">
            <div className="overview-chart-head">
              <h3>Sales Revenue Trend</h3>
              <label className="mini-select">
                Group by{' '}
                <select
                  id="overviewGroup"
                  value={grouping}
                  onChange={(e) =>
                    onGroupingChange(e.target.value as 'month' | 'week' | 'day')
                  }
                >
                  <option value="month">Month</option>
                  <option value="week">Week</option>
                  <option value="day">Day</option>
                </select>
              </label>
            </div>
            <ChartCanvas
              id="overviewTrend"
              containerClassName="overview-chart"
              config={trendConfig}
              ariaLabel="Sales revenue trend chart"
              isLight={isLight}
            />
            <div className="graph-explanation" id="overviewExplainTrend" aria-live="polite">
              {filteredRows.length
                ? `This ${intervalLabel} chart adds up net revenue from the ${formatNumber(
                    filteredRows.length
                  )} currently selected sales. ${
                    peakPeriod
                      ? `The highest ${grouping} is ${peakPeriod.date} with ${formatMoney(
                          peakPeriod.value
                        )}. `
                      : ''
                  }Changes may reflect the simulated dates, so this is descriptive rather than a verified historical trend.`
                : 'No sales match the current filters. Clear filters to restore the sales trend.'}
            </div>
          </div>

          <div className="card">
            <div className="overview-chart-head">
              <h3>Top Selling Products</h3>
              <span>Ranked by net sales</span>
            </div>
            <ChartCanvas
              id="overviewBars"
              containerClassName="overview-chart"
              config={barsConfig}
              ariaLabel="Top selling products bar chart"
              isLight={isLight}
            />
            <div className="graph-explanation" id="overviewExplainProducts" aria-live="polite">
              {topProduct
                ? `Products are ranked by total net sales, not transaction quantity. ${topProduct[0]} currently leads with ${formatMoney(
                    topProduct[1]
                  )}. Search, date, and product filters affect this ranking.`
                : 'No matching product revenue to rank.'}
            </div>
          </div>

          <div className="card overview-wide">
            <div className="overview-chart-head">
              <h3>Product Revenue Distribution</h3>
              <span>Revenue share of top products</span>
            </div>
            <ChartCanvas
              id="overviewMixed"
              containerClassName="overview-chart full-donut-chart"
              config={donutConfig}
              ariaLabel="Product revenue distribution doughnut chart"
              isLight={isLight}
            />
            <div className="graph-explanation" id="overviewExplainShare" aria-live="polite">
              {totalSales > 0
                ? `Each slice represents a product’s portion of ${formatMoney(
                    totalSales
                  )} in filtered net sales. The smaller categories are grouped as Other products. This does not represent profit margins.`
                : 'No positive sales revenue is available for a distribution chart.'}
            </div>
          </div>
        </div>

        <div className="section-label">QUICK INSIGHTS</div>
        <div className="overview-insights" id="overviewInsights">
          <div className="insight">
            <div className="insight-label">Top product</div>
            <div className="insight-value">{topProduct?.[0] ?? '—'}</div>
            <div className="insight-detail">
              {topProduct ? `${formatMoney(topProduct[1])} in net sales` : 'No sales'}
            </div>
          </div>
          <div className="insight">
            <div className="insight-label">{`Best ${grouping === 'day' ? 'day' : 'month'}`}</div>
            <div className="insight-value">{peakPeriod?.date ?? '—'}</div>
            <div className="insight-detail">
              {peakPeriod ? `${formatMoney(peakPeriod.value)} in net sales` : 'No dated transactions'}
            </div>
          </div>
          <div className="insight">
            <div className="insight-label">Distinct products</div>
            <div className="insight-value">{formatNumber(rankedProducts.length)}</div>
            <div className="insight-detail">{`${formatNumber(filteredRows.length)} filtered records`}</div>
          </div>
        </div>

        <section className="card anomaly-panel" aria-labelledby="anomalyHeading" id="anomalyDetector">
          <div className="anomaly-head">
            <div>
              <div className="explanation-kicker">DATA QUALITY / STATISTICAL SIGNALS</div>
              <h2 id="anomalyHeading">Data Quality &amp; Statistical Alerts</h2>
              <p className="description">
                Automatically highlights unusual sales and data-quality issues in the currently
                filtered records. A flag is a reason to review a record—not proof of fraud.
              </p>
            </div>
            <div className="anomaly-count-card">
              <strong id="anomalyCount">{formatNumber(anomalies.length)}</strong>
              <span>flags found</span>
            </div>
          </div>

          <div className="anomaly-summary" id="anomalySummary" role="status" aria-live="polite">
            {anomalies.length
              ? `${formatNumber(anomalies.length)} potential flags across ${formatNumber(
                  filteredRows.length
                )} filtered sales, including ${formatNumber(
                  highSeverityCount
                )} data-integrity warnings. Open the table to see the affected records and the detection reason.`
              : `No statistical outliers or invalid values were found among ${formatNumber(
                  filteredRows.length
                )} filtered sales using the currently enabled checks.`}
          </div>

          <div className="anomaly-controls">
            <label htmlFor="anomalyType">Show signals</label>
            <select
              id="anomalyType"
              aria-label="Filter anomaly types"
              value={anomalyFilter}
              onChange={(e) => {
                setAnomalyFilter(e.target.value as 'all' | AnomalyCategory);
                setAnomalyPage(1);
              }}
            >
              <option value="all">All anomaly types</option>
              <option value="High sale value">High sale value</option>
              <option value="Unusual quantity">Unusual quantity</option>
              <option value="Monthly sales spike">Monthly sales spike</option>
              <option value="Date issue">Date issue</option>
              <option value="Invalid value">Invalid value</option>
            </select>
            <button
              type="button"
              id="anomalyExport"
              className="action-btn"
              disabled={visibleAnomalies.length === 0}
              onClick={handleExportAnomalies}
            >
              ↓ Export flags CSV
            </button>
            <button
              type="button"
              className="action-btn"
              onClick={() => onOpenGemini('anomaly-explanation')}
            >
              ✦ Explain flags with Groq
            </button>
          </div>

          <div className="table-wrapper anomaly-table-wrapper">
            <table className="anomaly-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Sale / Period</th>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th>Why it was flagged</th>
                </tr>
              </thead>
              <tbody id="anomalyRows">
                {pagedAnomalies.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      {anomalyFilter === 'all'
                        ? 'No unusual records detected in the current view.'
                        : `No records matched "${anomalyFilter}".`}
                    </td>
                  </tr>
                ) : (
                  pagedAnomalies.map((a, idx) => (
                    <tr key={`${a.id}-${a.type}-${idx}`}>
                      <td>
                        <span className={`severity ${a.severity === 'High' ? 'high' : 'review'}`}>
                          {a.severity}
                        </span>
                      </td>
                      <td>{a.id}</td>
                      <td>{a.date}</td>
                      <td>{a.sku}</td>
                      <td>{a.type}</td>
                      <td>{a.reason}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="anomaly-pagination">
            <span id="anomalyPageInfo">
              {visibleAnomalies.length
                ? `Showing ${anomalyStart + 1}–${Math.min(
                    anomalyStart + anomalyPageSize,
                    visibleAnomalies.length
                  )} of ${visibleAnomalies.length} flags · Page ${safeAnomalyPage} of ${anomalyPages}`
                : 'No matching flags'}
            </span>
            <div className="pager-buttons">
              <button
                className="action-btn"
                id="anomalyPrev"
                type="button"
                disabled={safeAnomalyPage <= 1}
                onClick={() => setAnomalyPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <button
                className="action-btn"
                id="anomalyNext"
                type="button"
                disabled={safeAnomalyPage >= anomalyPages}
                onClick={() => setAnomalyPage((p) => Math.min(anomalyPages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>

          <p className="anomaly-method">
            Method: for product groups with at least 8 transactions, unusually high net sale values
            or quantities are identified using the upper Tukey fence (Q3 + 1.5 × IQR). Monthly
            revenue spikes use the same rule when at least 8 months contain sales.
            Missing/out-of-range dates and invalid amounts are also flagged. These checks use only
            records returned by Supabase and do not modify the database. Synthetic dates (2024–2026)
            can create artificial time-based patterns.
          </p>
        </section>

        <div className="card full-records-card">
          <div className="overview-chart-head">
            <div>
              <h3 id="complete-sales-records" tabIndex={-1}>Complete Sales Records</h3>
              <p id="overviewRecordCount" className="description">
                {`${formatNumber(filteredRows.length)} matching transactions out of ${formatNumber(
                  allRows.length
                )} loaded`}
              </p>
            </div>
            <label className="mini-select">
              Rows per page
              <select
                id="overviewPageSize"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) || 50);
                  setPage(1);
                }}
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={250}>250</option>
              </select>
            </label>
          </div>

          <div className="table-wrapper full-record-table">
            <table>
              <thead>
                <tr>
                  <th>Sale ID</th>
                  <th>Sale Date</th>
                  <th>Date Key</th>
                  <th>Product SKU</th>
                  <th>Product Name</th>
                  <th>Customer</th>
                  <th>Employee</th>
                  <th>Store</th>
                  <th>Promotion</th>
                  <th>Quantity</th>
                  <th>Gross Unit Price</th>
                  <th>Net Sales</th>
                </tr>
              </thead>
              <tbody id="overviewRows">
                {pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={12} className="empty">
                      No sales records match your search or date range.
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row) => (
                    <tr key={row.sales_fact_id}>
                      <td>{valueText(row.sales_fact_id)}</td>
                      <td>{valueText(dateOf(row))}</td>
                      <td>{valueText(row.date_key)}</td>
                      <td>{valueText(skuOf(row))}</td>
                      <td>{valueText(productOf(row))}</td>
                      <td>{valueText(customerOf(row))}</td>
                      <td>{valueText(employeeOf(row))}</td>
                      <td>{valueText(storeOf(row))}</td>
                      <td>{valueText(promoOf(row))}</td>
                      <td>{formatNumber(row.quantity_sold)}</td>
                      <td>{formatMoney(row.gross_unit_price)}</td>
                      <td>{formatMoney(row.net_sales_collected)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="full-pagination">
            <span id="overviewPageInfo">
              {filteredRows.length
                ? `Showing ${formatNumber(recordStart + 1)}–${formatNumber(
                    Math.min(recordStart + pageSize, filteredRows.length)
                  )} of ${formatNumber(filteredRows.length)} sales`
                : '0 matching sales'}
            </span>
            <div className="pager-buttons">
              <button
                id="overviewFirst"
                className="action-btn"
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage(1)}
              >
                « First
              </button>
              <button
                id="overviewPrev"
                className="action-btn"
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ‹ Previous
              </button>
              <span id="overviewPageLabel">{`Page ${safePage} of ${totalRecordPages}`}</span>
              <button
                id="overviewNext"
                className="action-btn"
                type="button"
                disabled={safePage >= totalRecordPages}
                onClick={() => setPage((p) => Math.min(totalRecordPages, p + 1))}
              >
                Next ›
              </button>
              <button
                id="overviewLast"
                className="action-btn"
                type="button"
                disabled={safePage >= totalRecordPages}
                onClick={() => setPage(totalRecordPages)}
              >
                Last »
              </button>
            </div>
          </div>

          <p className="overview-footnote">
            Dates are read directly from <code>fact_sales.date_key</code> and{' '}
            <code>dim_date.full_date</code>. The exam dataset spans dates
            from <strong>January 1, 2024 through November 25, 2026</strong> (inclusive). These
            are <strong>simulated dates</strong>, not recovered historical sale dates. Search, KPIs,
            charts, and exports reflect the current database values.
          </p>
        </div>
      </div>
    </section>
  );
}
