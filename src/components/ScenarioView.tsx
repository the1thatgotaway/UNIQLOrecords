import { useMemo, useRef, useState } from 'react';
import type { ChartConfiguration } from 'chart.js/auto';
import { Download, Image as ImageIcon, RotateCcw, Search, Sparkles } from 'lucide-react';
import type {
  FocusedQuestionId,
  GroupingMode,
  MidtermSnapshot,
  SalesRecord,
  StudioChartView,
} from '../types/sales.ts';
import {
  computeIsolationForest,
  describeStudioGraph,
  explainTrendSummary,
} from '../utils/isolationForest.ts';
import {
  customerOf,
  dateOf,
  employeeOf,
  formatCompactPhp,
  formatMoney,
  formatNumber,
  groupSales,
  metricSum,
  pointKey,
  productOf,
  promoOf,
  SCENARIO_META,
  skuOf,
  storeOf,
} from '../utils/salesAnalytics.ts';
import { buildCsvDocument, parseMidtermSnapshot } from '../utils/snapshotParser.ts';
import { ChartCanvas } from './ChartCanvas.tsx';

interface ScenarioViewProps {
  questionId: FocusedQuestionId;
  scenarioRows: SalesRecord[];
  midtermSnapshot: MidtermSnapshot | null;
  isDark: boolean;
  onMidtermLoaded: (snap: MidtermSnapshot, fileName: string) => void;
  onAskGeminiScenario: () => void;
}

const SCENARIO_ACCENT: Record<FocusedQuestionId, string> = {
  '1': '#a3e635',
  '2': '#38bdf8',
  '3': '#fb923c',
  '4': '#a78bfa',
};

export function ScenarioView({
  questionId,
  scenarioRows,
  midtermSnapshot,
  isDark,
  onMidtermLoaded,
  onAskGeminiScenario,
}: ScenarioViewProps) {
  const [chartView, setChartView] = useState<StudioChartView>('trend');
  const [grouping, setGrouping] = useState<GroupingMode>('day');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [midtermStatus, setMidtermStatus] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(25);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const meta = SCENARIO_META[questionId];

  const studioRows = useMemo(() => {
    return scenarioRows.filter((r) => {
      const d = dateOf(r);
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });
  }, [scenarioRows, fromDate, toDate]);

  const studioStats = useMemo(() => {
    const net = metricSum(studioRows, 'net_sales_collected');
    const qty = metricSum(studioRows, 'quantity_sold');
    const avgPrice = studioRows.length
      ? metricSum(studioRows, 'gross_unit_price') / studioRows.length
      : 0;
    const distinctDates = new Set(studioRows.map(dateOf).filter(Boolean));
    return { net, qty, avgPrice, avgSale: studioRows.length ? net / studioRows.length : 0, distinctDates: distinctDates.size };
  }, [studioRows]);

  const bucketed = useMemo(() => {
    const map = groupSales(studioRows, grouping);
    const labels = [...map.keys()].sort();
    const groups = labels.map((k) => map.get(k)!);
    const model = computeIsolationForest(groups, questionId, chartView, grouping);
    const flaggedSet = new Set(model.indices);

    const sales = groups.map((g) => g.sales);
    const qty = groups.map((g) => g.qty);
    let values = sales;
    let title = 'Net sales';
    let isCurrency = true;
    let chartType: 'line' | 'bar' = 'line';

    if (chartView === 'quantity') {
      values = qty;
      title = 'Units sold';
      isCurrency = false;
      chartType = 'bar';
    } else if (chartView === 'price') {
      values = groups.map((g) => g.price / Math.max(1, g.count));
      title = 'Average gross unit price';
      chartType = 'bar';
    } else if (chartView === 'cumulative') {
      let acc = 0;
      values = sales.map((v) => (acc += v));
      title = 'Cumulative net sales';
      chartType = 'line';
    } else if (chartView === 'mix') {
      values = sales;
      title = 'Net sales vs units sold';
      chartType = 'bar';
    }

    return {
      labels,
      groups,
      qty,
      values,
      title,
      isCurrency,
      chartType,
      model,
      flaggedSet,
    };
  }, [studioRows, grouping, questionId, chartView]);

  const tickColor = isDark ? '#94a3b8' : '#475569';
  const gridColor = isDark ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.08)';
  const accent = SCENARIO_ACCENT[questionId];

  const primaryChartConfig = useMemo<ChartConfiguration>(() => {
    const datasets: ChartConfiguration<'line' | 'bar'>['data']['datasets'] = [
      {
        type: bucketed.chartType,
        label: bucketed.title,
        data: bucketed.values,
        borderColor: accent,
        backgroundColor: bucketed.labels.map((_, i) =>
          bucketed.flaggedSet.has(i)
            ? 'rgba(251, 146, 60, 0.9)'
            : chartView === 'trend'
              ? isDark
                ? 'rgba(56, 189, 248, 0.12)'
                : 'rgba(14, 165, 233, 0.12)'
              : accent
        ),
        borderWidth: 2.5,
        tension: 0.3,
        fill: chartView === 'trend',
        borderRadius: 5,
        maxBarThickness: 44,
        pointRadius: bucketed.labels.map((_, i) =>
          bucketed.flaggedSet.has(i) ? 6 : bucketed.labels.length > 50 ? 0 : 3
        ),
        pointBackgroundColor: bucketed.labels.map((_, i) =>
          bucketed.flaggedSet.has(i) ? '#fb923c' : accent
        ),
        ...(chartView === 'mix' ? { yAxisID: 'y' } : {}),
      },
    ];

    if (chartView === 'mix') {
      datasets.push({
        type: 'line',
        label: 'Units sold',
        data: bucketed.qty,
        borderColor: '#fb923c',
        backgroundColor: '#fb923c',
        borderWidth: 2.5,
        tension: 0.25,
        yAxisID: 'y1',
      });
    }

    return {
      type: bucketed.chartType,
      data: {
        labels: bucketed.labels,
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: chartView === 'mix',
            labels: { color: tickColor },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (ctx) =>
                ctx.dataset.label === 'Units sold' || !bucketed.isCurrency
                  ? `${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`
                  : `${ctx.dataset.label}: ${formatMoney(ctx.parsed.y)}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: tickColor, autoSkip: true, maxTicksLimit: 12, maxRotation: 40 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: tickColor,
              callback: (v) =>
                bucketed.isCurrency ? formatCompactPhp(Number(v)) : formatNumber(Number(v)),
            },
            grid: { color: gridColor },
          },
          ...(chartView === 'mix'
            ? {
                y1: {
                  position: 'right' as const,
                  beginAtZero: true,
                  grid: { drawOnChartArea: false },
                  ticks: { color: '#fb923c' },
                },
              }
            : {}),
        },
      },
    };
  }, [bucketed, accent, chartView, isDark, tickColor, gridColor]);

  const midtermComparison = useMemo(() => {
    if (!midtermSnapshot) return null;
    const beforeRows = midtermSnapshot.scenarios[questionId].filter((row) => {
      const d = dateOf(row);
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });
    const baseMap = groupSales(beforeRows, grouping);
    const keys = [...new Set([...baseMap.keys(), ...bucketed.labels])].sort();
    let cum = 0;
    const oldValues = keys.map((k) => {
      const b = baseMap.get(k);
      if (chartView === 'cumulative') return (cum += b?.sales || 0);
      if (!b) return chartView === 'price' || grouping === 'sale' ? null : 0;
      if (chartView === 'quantity') return b.qty;
      return chartView === 'price' ? b.price / Math.max(1, b.count) : b.sales;
    });

    const beforeNet = metricSum(beforeRows, 'net_sales_collected');
    const nowNet = studioStats.net;
    const deltaNet = nowNet - beforeNet;

    const config: ChartConfiguration = {
      type: bucketed.chartType,
      data: {
        labels: keys,
        datasets: [
          {
            label: `Midterm (${bucketed.title})`,
            data: oldValues,
            borderColor: '#64748b',
            backgroundColor: 'rgba(100, 116, 139, 0.35)',
            borderWidth: 2,
            tension: 0.3,
            pointRadius: keys.length > 50 ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            ticks: { color: tickColor, autoSkip: true, maxTicksLimit: 10 },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: tickColor,
              callback: (v) =>
                bucketed.isCurrency ? formatCompactPhp(Number(v)) : formatNumber(Number(v)),
            },
            grid: { color: gridColor },
          },
        },
      },
    };

    return {
      beforeRows,
      beforeNet,
      deltaNet,
      config,
    };
  }, [midtermSnapshot, questionId, fromDate, toDate, grouping, bucketed, chartView, studioStats.net, tickColor, gridColor]);

  const sortedScenarioRows = useMemo(() => {
    const query = tableSearch.trim().toLowerCase();
    return [...scenarioRows]
      .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.sales_fact_id - a.sales_fact_id)
      .filter((row) => {
        if (!query) return true;
        return [
          row.sales_fact_id,
          dateOf(row),
          skuOf(row),
          productOf(row),
          customerOf(row),
          employeeOf(row),
          storeOf(row),
          promoOf(row),
          row.quantity_sold,
          row.gross_unit_price,
          row.net_sales_collected,
        ].some((v) => String(v ?? '').toLowerCase().includes(query));
      });
  }, [scenarioRows, tableSearch]);

  const totalPages = Math.max(1, Math.ceil(sortedScenarioRows.length / tablePageSize));
  const safePage = Math.min(tablePage, totalPages);
  const start = (safePage - 1) * tablePageSize;
  const pagedRows = sortedScenarioRows.slice(start, start + tablePageSize);

  const topFlagMembers = useMemo(() => {
    const topFlag = bucketed.model.flags[0];
    if (!topFlag) return [];
    return studioRows.filter((r) => pointKey(r, grouping) === topFlag.period);
  }, [bucketed.model.flags, studioRows, grouping]);

  const handleMidtermFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const snap = parseMidtermSnapshot(await file.text());
      onMidtermLoaded(snap, file.name);
      setMidtermStatus(`Loaded comparison snapshot: ${file.name}`);
    } catch (err) {
      setMidtermStatus(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSavePng = () => {
    if (!canvasRef.current) return;
    const a = document.createElement('a');
    a.href = canvasRef.current.toDataURL('image/png');
    a.download = `uniqlo-scenario-${questionId}-graph.png`;
    a.click();
  };

  const handleExportAiCsv = () => {
    if (!bucketed.model.flags.length) return;
    const headers = [
      'Question',
      'Graph grouping',
      'Graph view',
      'Period or sale',
      'Net sales (PHP)',
      'Units',
      'Transactions',
      'Anomaly score',
      'Explanation',
    ];
    const lines = bucketed.model.flags.map((f) => [
      questionId,
      grouping,
      chartView,
      f.period,
      f.sales,
      f.qty,
      f.count,
      f.score.toFixed(4),
      f.reason,
    ]);
    const preamble = `Question ${questionId} | ${studioRows.length} transactions | ${bucketed.model.flags.length} ML flags | ${grouping} | ${chartView}`;
    const csv = buildCsvDocument(headers, lines, preamble);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `uniqlo-question-${questionId}-ml-graph-report.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  };

  const handleExportRecordsCsv = () => {
    const headers = [
      'Sale ID',
      'Date',
      'SKU',
      'Product',
      'Customer',
      'Employee',
      'Store',
      'Promotion',
      'Quantity',
      'Gross Unit Price',
      'Net Sales',
    ];
    const lines = sortedScenarioRows.map((r) => [
      r.sales_fact_id,
      dateOf(r),
      skuOf(r),
      productOf(r),
      customerOf(r),
      employeeOf(r),
      storeOf(r),
      promoOf(r),
      r.quantity_sold,
      r.gross_unit_price,
      r.net_sales_collected,
    ]);
    const csv = buildCsvDocument(headers, lines);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `uniqlo-question-${questionId}-sales.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {meta.code} / Focused Scenario Analysis
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {meta.title}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            {meta.description}
          </p>
        </div>

        <button
          type="button"
          onClick={onAskGeminiScenario}
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-lime-400 dark:text-slate-950 dark:hover:bg-lime-300"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>Deep Dive with Gemini AI</span>
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Matching Records
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {formatNumber(studioRows.length)}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {formatNumber(studioStats.distinctDates)} active dates
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Total Net Sales
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-emerald-700 dark:text-lime-300">
            {formatMoney(studioStats.net)}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            Avg sale: {formatMoney(studioStats.avgSale)}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {questionId === '1' ? 'Average Gross Unit Price' : 'Total Quantity Sold'}
          </div>
          <div className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {questionId === '1' ? formatMoney(studioStats.avgPrice) : formatNumber(studioStats.qty)}
          </div>
          <div className="mt-1 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {questionId === '1'
              ? `${formatNumber(studioStats.qty)} total units`
              : `Mean unit price: ${formatMoney(studioStats.avgPrice)}`}
          </div>
        </div>
      </div>

      {/* Visualization Studio */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111824]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              Visualization Studio — {bucketed.title}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {describeStudioGraph(
                studioRows,
                chartView,
                grouping,
                bucketed.labels,
                bucketed.values
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setChartView('trend');
                setGrouping('day');
                setFromDate('');
                setToDate('');
              }}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Reset</span>
            </button>
            <button
              type="button"
              onClick={handleSavePng}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              <ImageIcon className="h-3.5 w-3.5" />
              <span>Save PNG</span>
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Chart View
            </span>
            <select
              value={chartView}
              onChange={(e) => setChartView(e.target.value as StudioChartView)}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value="trend">Sales trend</option>
              <option value="quantity">Quantity analysis</option>
              <option value="price">Unit price analysis</option>
              <option value="mix">Sales vs quantity</option>
              <option value="cumulative">Cumulative sales</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Group By
            </span>
            <select
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as GroupingMode)}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="sale">Individual sale</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              From Date
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              To Date
            </span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            />
          </label>
        </div>

        <div className={`mt-5 grid gap-5 ${midtermComparison ? 'lg:grid-cols-2' : 'grid-cols-1'}`}>
          {midtermComparison && (
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                Saved Midterm Snapshot ({formatNumber(midtermComparison.beforeRows.length)} rows ·{' '}
                {formatMoney(midtermComparison.beforeNet)})
              </div>
              <ChartCanvas
                config={midtermComparison.config}
                heightClass="h-72"
                ariaLabel="Midterm comparison chart"
              />
            </div>
          )}
          <div>
            {midtermComparison && (
              <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                Current Snapshot ({formatNumber(studioRows.length)} rows ·{' '}
                {formatMoney(studioStats.net)} · Δ {formatMoney(midtermComparison.deltaNet)})
              </div>
            )}
            <ChartCanvas
              config={primaryChartConfig}
              heightClass="h-72"
              ariaLabel={`${meta.title} chart`}
              onCanvasReady={(c) => {
                canvasRef.current = c;
              }}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
          <label className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
            <span>Compare against Midterm step 02 file:</span>
            <input
              type="file"
              accept=".csv,.json,.txt"
              onChange={handleMidtermFile}
              className="text-xs file:mr-2 file:rounded file:border file:border-slate-300 file:bg-slate-50 file:px-2.5 file:py-1 file:text-xs file:font-medium dark:file:border-slate-700 dark:file:bg-slate-800 dark:file:text-slate-200"
            />
          </label>
          {midtermStatus && (
            <span role="status" className="text-xs text-sky-600 dark:text-sky-400">
              {midtermStatus}
            </span>
          )}
        </div>
      </section>

      {/* Local ML Isolation Forest Analysis */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111824]">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
              Client-Side Unsupervised ML · Isolation Forest
            </div>
            <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              ML Graph Anomaly Analysis
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {explainTrendSummary(studioRows, bucketed.groups, bucketed.model)}
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportAiCsv}
            disabled={bucketed.model.flags.length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export ML Flags CSV</span>
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#0D131D]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Chart Points
            </div>
            <div className="mt-1 font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-white">
              {formatNumber(bucketed.groups.length)}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#0D131D]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Flagged Points
            </div>
            <div className="mt-1 font-mono text-xl font-bold tabular-nums text-amber-600 dark:text-amber-300">
              {formatNumber(bucketed.model.flags.length)}
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#0D131D]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Model Status
            </div>
            <div className="mt-1 text-sm font-bold text-slate-900 dark:text-lime-300">
              {bucketed.model.reason ? 'Needs 8+ Points' : 'Trained on Active Graph'}
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#0D131D] dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-3 py-2.5">Period / Sale</th>
                <th className="px-3 py-2.5 text-right">Net Sales</th>
                <th className="px-3 py-2.5 text-right">Units</th>
                <th className="px-3 py-2.5 text-right">ML Score</th>
                <th className="px-3 py-2.5">Explanation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {bucketed.model.flags.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-6 text-center text-xs text-slate-500 dark:text-slate-400"
                  >
                    {bucketed.model.reason
                      ? `Analysis unavailable: ${bucketed.model.reason}`
                      : 'No anomalies detected at the current cutoff.'}
                  </td>
                </tr>
              ) : (
                bucketed.model.flags.map((flag) => (
                  <tr key={flag.period} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/35">
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {flag.period}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-800 dark:text-slate-200">
                      {formatMoney(flag.sales)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                      {formatNumber(flag.qty)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      <span className="inline-block rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300">
                        {flag.score.toFixed(3)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{flag.reason}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {bucketed.model.flags.length > 0 && topFlagMembers.length > 0 && (
          <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-[#0D131D]">
            <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">
              Inspect top flag {bucketed.model.flags[0].period} ({topFlagMembers.length} underlying sales · cutoff{' '}
              {bucketed.model.threshold?.toFixed(3)})
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <th className="py-1.5 pr-3">Sale ID</th>
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3 text-right">Qty</th>
                    <th className="py-1.5 pr-3 text-right">Unit Price</th>
                    <th className="py-1.5 pr-3 text-right">Net Sales</th>
                    <th className="py-1.5">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {topFlagMembers.map((m) => (
                    <tr key={m.sales_fact_id}>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">#{m.sales_fact_id}</td>
                      <td className="py-1.5 pr-3 font-mono tabular-nums">{dateOf(m)}</td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {m.quantity_sold}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {formatMoney(m.gross_unit_price)}
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                        {formatMoney(m.net_sales_collected)}
                      </td>
                      <td className="py-1.5 text-slate-600 dark:text-slate-400">
                        {[skuOf(m), customerOf(m), employeeOf(m), storeOf(m), promoOf(m)]
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      {/* Matching Records Table */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111824]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Matching Scenario Records
            </h2>
            <p className="mt-0.5 font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400">
              {formatNumber(sortedScenarioRows.length)} matching records
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={tableSearch}
                onChange={(e) => {
                  setTableSearch(e.target.value);
                  setTablePage(1);
                }}
                placeholder="Filter records..."
                className="rounded-md border border-slate-300 bg-white py-1.5 pr-3 pl-8 text-xs text-slate-900 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
              />
            </div>

            <select
              value={tablePageSize}
              onChange={(e) => {
                setTablePageSize(Number(e.target.value));
                setTablePage(1);
              }}
              aria-label="Scenario rows per page"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
            </select>

            <button
              type="button"
              onClick={handleExportRecordsCsv}
              disabled={sortedScenarioRows.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#0D131D] dark:text-slate-400">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-3 py-2.5">Sale ID</th>
                <th className="px-3 py-2.5">Date</th>
                <th className="px-3 py-2.5">SKU</th>
                <th className="px-3 py-2.5">Customer / Store / Promo</th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5 text-right">Unit Price</th>
                <th className="px-3 py-2.5 text-right">Net Sales</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
              {pagedRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                  >
                    No matching records found for this scenario.
                  </td>
                </tr>
              ) : (
                pagedRows.map((row) => (
                  <tr
                    key={row.sales_fact_id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/35"
                  >
                    <td className="px-3 py-2 font-mono tabular-nums">#{row.sales_fact_id}</td>
                    <td className="px-3 py-2 font-mono tabular-nums whitespace-nowrap">
                      {dateOf(row) || '—'}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {skuOf(row)} · <span className="font-sans text-slate-500">{productOf(row)}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                      {[customerOf(row), employeeOf(row), storeOf(row), promoOf(row)]
                        .filter(Boolean)
                        .join(' · ')}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {formatNumber(row.quantity_sold)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
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
            Page {safePage} of {totalPages} ·{' '}
            {sortedScenarioRows.length
              ? `${start + 1}–${Math.min(start + tablePageSize, sortedScenarioRows.length)}`
              : '0'}{' '}
            shown
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setTablePage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
