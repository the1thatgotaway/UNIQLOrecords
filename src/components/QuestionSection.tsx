import { useCallback, useMemo, useRef, useState } from 'react';
import type { ChartConfiguration, Plugin } from 'chart.js/auto';
import type {
  FocusedQuestionId,
  GroupingMode,
  LlmAnalysisTask,
  MidtermSnapshot,
  SalesRecord,
  StudioChartView,
} from '../types/sales.ts';
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
  PRICE_THRESHOLD,
  SCENARIO_META,
  promoOf,
  skuOf,
  storeOf,
  productOf,
} from '../utils/salesAnalytics.ts';
import {
  computeIsolationForest,
  describeStudioGraph,
  explainTrendSummary,
} from '../utils/isolationForest.ts';
import { buildCsvDocument } from '../utils/snapshotParser.ts';
import { TukeyChart } from './TukeyChart.tsx';
import { ChartCanvas } from './ChartCanvas.tsx';

interface QuestionSectionProps {
  comparisonOnly?: boolean;
  miningOnly?: boolean;
  questionId: FocusedQuestionId;
  rows: SalesRecord[];
  midtermSnapshot: Pick<MidtermSnapshot, 'captured_at' | 'baseline' | 'scenarios'>;
  totalOverviewCount: number;
  isLight: boolean;
  statusTime: string;
  salesSource?: string;
  salesTiming: { requestMs: number; supabaseMs: number | null } | null;
  isReloading: boolean;
  onReloadRecords: () => void;
  onOpenGemini: (task: LlmAnalysisTask | null) => void;
}

const STUDIO_PALETTE = ['#ef766e', '#6db8ff', '#ffab7b', '#b29bff'];

const thresholdPlugin: Plugin = {
  id: 'thresholdLine',
  afterDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea || !scales.y) return;
    const y = scales.y.getPixelForValue(PRICE_THRESHOLD);
    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = '#fb7185';
    ctx.lineWidth = 2;
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#fb7185';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'right';
    ctx.fillText('₱1,000 threshold', chartArea.right - 5, y - 8);
    ctx.restore();
  },
};

function formatTiming(value: number | null | undefined): string {
  return value == null ? '—' : value.toFixed(1) + ' ms';
}

function changeText(oldVal: number, newVal: number, formatter: (v: number) => string): string {
  const diff = newVal - oldVal;
  const sign = diff > 0 ? '+' : '';
  return `${formatter(oldVal)} → ${formatter(newVal)} (${sign}${formatter(diff)})`;
}

function downloadFile(content: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function QuestionSection({
  comparisonOnly = false,
  miningOnly = false,
  questionId,
  rows,
  midtermSnapshot,
  totalOverviewCount,
  isLight,
  statusTime,
  salesSource = 'Live Supabase',
  salesTiming,
  isReloading,
  onReloadRecords,
  onOpenGemini,
}: QuestionSectionProps) {
  const qNum = Number(questionId);
  const [viewMode, setViewMode] = useState<StudioChartView>('trend');
  const [grouping, setGrouping] = useState<GroupingMode>(questionId === '4' ? 'day' : 'month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [tablePageSize, setTablePageSize] = useState(25);
  const [tablePage, setTablePage] = useState(1);
  const [mlRunTick, setMlRunTick] = useState(0);
  const primaryCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const savePrimaryCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    primaryCanvasRef.current = canvas;
  }, []);
  const [midtermRender, setMidtermRender] = useState<{ config: ChartConfiguration; ms: number }>();
  const [finalsRender, setFinalsRender] = useState<{ config: ChartConfiguration; ms: number }>();

  const summaryStats = useMemo(() => {
    const net = metricSum(rows, 'net_sales_collected');
    const qty = metricSum(rows, 'quantity_sold');
    const avgPrice = rows.length ? metricSum(rows, 'gross_unit_price') / rows.length : 0;
    const distinctDates = new Set(rows.map(dateOf).filter(Boolean)).size;

    const dailyMap = groupSales(rows, 'day');
    const dailyKeys = [...dailyMap.keys()].sort();
    let peakDay = '—';
    let peakVal = 0;
    for (const key of dailyKeys) {
      const s = dailyMap.get(key)!.sales;
      if (s > peakVal || peakDay === '—') {
        peakVal = s;
        peakDay = key;
      }
    }

    return {
      count: rows.length,
      net,
      qty,
      avgPrice,
      distinctDates,
      avgSale: rows.length ? net / rows.length : 0,
      peakDay,
      peakVal,
    };
  }, [rows]);

  const filteredChartRows = useMemo(
    () =>
      rows.filter((r) => {
        const d = dateOf(r);
        return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
      }),
    [rows, fromDate, toDate]
  );

  const { labels, groups, values, metricTitle, isCurrency, mlResult } = useMemo(() => {
    void mlRunTick;
    const bucketsMap = groupSales(filteredChartRows, grouping);
    const sortedLabels = [...bucketsMap.keys()].sort();
    const bucketList = sortedLabels.map((k) => bucketsMap.get(k)!);
    const model = computeIsolationForest(bucketList, questionId, viewMode, grouping);

    let vals: number[];
    let title: string;
    let currency = true;

    if (viewMode === 'quantity') {
      vals = bucketList.map((b) => b.qty);
      title = 'Units sold';
      currency = false;
    } else if (viewMode === 'price') {
      vals = bucketList.map((b) => b.price / Math.max(1, b.count));
      title = 'Average gross unit price';
    } else if (viewMode === 'cumulative') {
      let sum = 0;
      vals = bucketList.map((b) => {
        sum += b.sales;
        return sum;
      });
      title = 'Cumulative net sales';
    } else {
      vals = bucketList.map((b) => b.sales);
      title = 'Net sales';
    }

    return {
      labels: sortedLabels,
      groups: bucketList,
      values: vals,
      metricTitle: title,
      isCurrency: currency,
      mlResult: model,
    };
  }, [filteredChartRows, grouping, viewMode, questionId, mlRunTick]);

  const flaggedSet = useMemo(() => new Set(mlResult.indices), [mlResult.indices]);
  const accentStroke = isLight && qNum === 1 ? '#b32020' : STUDIO_PALETTE[(qNum - 1) % 4];
  const tickColor = isLight ? '#513e46' : '#dccbd1';
  const gridColor = isLight ? '#d9e4f280' : '#ffffff12';

  const { primaryConfig, midtermConfig, compareNotes } = useMemo(() => {
    const qtySeries = groups.map((g) => g.qty);
    const isLine = viewMode === 'trend' || viewMode === 'cumulative';
    const chartType = isLine ? 'line' : 'bar';

    const primaryDataset: ChartConfiguration<'line' | 'bar'>['data']['datasets'][number] = {
      label: viewMode === 'mix' ? 'Net sales' : metricTitle,
      data: values,
      type: viewMode === 'mix' ? 'bar' : undefined,
      borderColor: accentStroke,
      backgroundColor: labels.map((_, i) =>
        flaggedSet.has(i)
          ? 'rgba(255,161,99,.93)'
          : viewMode === 'trend'
            ? isLight
              ? 'rgba(82,114,0,.10)'
              : 'rgba(109,184,255,.10)'
            : accentStroke
      ),
      borderWidth: 3,
      tension: 0.32,
      fill: viewMode === 'trend',
      borderRadius: 6,
      maxBarThickness: 52,
      pointRadius: labels.map((_, i) => (flaggedSet.has(i) ? 7 : labels.length > 50 ? 0 : 3)),
      pointBackgroundColor: labels.map((_, i) => (flaggedSet.has(i) ? '#ffb06a' : accentStroke)),
      pointBorderColor: labels.map((_, i) => (flaggedSet.has(i) ? '#fff2d8' : accentStroke)),
      pointBorderWidth: labels.map((_, i) => (flaggedSet.has(i) ? 2 : 0)),
      pointHoverRadius: 9,
      ...(viewMode === 'mix' ? { yAxisID: 'y' } : {}),
    };

    const datasets: ChartConfiguration<'line' | 'bar'>['data']['datasets'] = [primaryDataset];
    if (viewMode === 'mix') {
      datasets.push({
        type: 'line',
        label: 'Units sold',
        data: qtySeries,
        borderColor: '#ffab7b',
        backgroundColor: '#ffab7b',
        borderWidth: 3,
        tension: 0.25,
        yAxisID: 'y1',
      });
    }

    const baseScales: NonNullable<ChartConfiguration<'line' | 'bar'>['options']>['scales'] = {
      x: { ticks: { color: tickColor }, grid: { display: false } },
      y: {
        beginAtZero: true,
        ticks: {
          color: tickColor,
          callback: (value) =>
            isCurrency ? formatMoney(Number(value)) : formatNumber(Number(value)),
        },
        grid: { color: gridColor },
      },
    };

    if (viewMode === 'mix') {
      baseScales.y1 = {
        position: 'right',
        beginAtZero: true,
        grid: { drawOnChartArea: false },
        ticks: { color: isLight ? '#8a461e' : '#ffc5a1' },
      };
    }

    const sharedOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: viewMode === 'mix', labels: { color: tickColor } },
        tooltip: { mode: 'index' as const, intersect: false },
      },
      scales: baseScales,
    };

    if (!comparisonOnly) {
      const liveConfig = { type: chartType, data: { labels, datasets }, options: sharedOpts } as ChartConfiguration;
      return { primaryConfig: liveConfig, midtermConfig: liveConfig, compareNotes: [] };
    }

    const before = midtermSnapshot.scenarios[questionId].filter((row) => {
      const d = dateOf(row);
      return (!fromDate || d >= fromDate) && (!toDate || d <= toDate);
    });
    const baseBins = groupSales(before, grouping);
    const nowBins = groupSales(filteredChartRows, grouping);
    const keys = [...new Set([...baseBins.keys(), ...nowBins.keys()])].sort();

    const extractValues = (bins: Map<string, ReturnType<typeof groupSales> extends Map<string, infer V> ? V : never>, isUnits = false) => {
      let cumulative = 0;
      return keys.map((k) => {
        const b = bins.get(k);
        if (viewMode === 'cumulative') return (cumulative += b?.sales ?? 0);
        if (!b) return viewMode === 'price' || grouping === 'sale' ? null : 0;
        if (isUnits || viewMode === 'quantity') return b.qty;
        return viewMode === 'price' ? b.price / Math.max(1, b.count) : b.sales;
      });
    };

    const indexByKey = new Map(labels.map((k, i) => [k, i]));
    const alignedDatasets = datasets.map((ds, dsIdx) => {
      const aligned = { ...ds, data: extractValues(nowBins, dsIdx === 1) } as Record<string, unknown>;
      const rawDs = ds as unknown as Record<string, unknown>;
      for (const attr of [
        'backgroundColor',
        'pointRadius',
        'pointBackgroundColor',
        'pointBorderColor',
        'pointBorderWidth',
      ]) {
        const src = rawDs[attr];
        if (Array.isArray(src)) {
          aligned[attr] = keys.map(
            (k) => src[indexByKey.get(k) ?? -1] ?? (attr.includes('Color') ? 'transparent' : 0)
          );
        }
      }
      return aligned as unknown as ChartConfiguration<'line' | 'bar'>['data']['datasets'][number];
    });

    const oldDatasets = datasets.map((ds, dsIdx) => ({
      ...ds,
      data: extractValues(baseBins, dsIdx === 1),
      backgroundColor: dsIdx ? '#ffab7b' : '#87a1b9',
      borderColor: dsIdx ? '#ffab7b' : '#87a1b9',
      pointRadius: keys.length > 50 ? 0 : 2,
      pointBackgroundColor: '#87a1b9',
      pointBorderWidth: 0,
      pointBorderColor: '#87a1b9',
    })) as ChartConfiguration<'line' | 'bar'>['data']['datasets'];

    for (let i = 0; i < alignedDatasets.length; i++) {
      const axisId = i === 1 ? 'y1' : 'y';
      const axis = baseScales[axisId] as { min?: number; max?: number } | undefined;
      if (axis) {
        let lo = 0;
        let hi = 0;
        const dNow = alignedDatasets[i].data as Array<number | null>;
        const dOld = oldDatasets[i].data as Array<number | null>;
        for (const v of [...dNow, ...dOld]) {
          if (v !== null && Number.isFinite(v)) {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
        axis.min = lo;
        axis.max = hi === lo ? lo + 1 : hi;
      }
    }

    const oldDays = groupSales(before, 'day');
    const newDays = groupSales(filteredChartRows, 'day');
    const movers = [...new Set([...oldDays.keys(), ...newDays.keys()])]
      .map(
        (day) =>
          [day, (newDays.get(day)?.sales ?? 0) - (oldDays.get(day)?.sales ?? 0)] as [string, number]
      )
      .filter(([, delta]) => Math.abs(delta) >= 0.005)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 3);

    const oldIds = new Set(before.map((r) => r.sales_fact_id));
    const newIds = new Set(filteredChartRows.map((r) => r.sales_fact_id));
    const added = filteredChartRows
      .filter((r) => !oldIds.has(r.sales_fact_id))
      .sort((a, b) => b.net_sales_collected - a.net_sales_collected);
    const missing = before.filter((r) => !newIds.has(r.sales_fact_id)).length;

    const notes = [
      `Midterm ${midtermSnapshot.captured_at} · saved fact count ${formatNumber(
        midtermSnapshot.baseline
      )}`,
      `Matching rows ${changeText(before.length, filteredChartRows.length, formatNumber)}`,
      `Net sales (primary KPI) ${changeText(
        metricSum(before, 'net_sales_collected'),
        metricSum(filteredChartRows, 'net_sales_collected'),
        formatMoney
      )}`,
      `Units ${changeText(
        metricSum(before, 'quantity_sold'),
        metricSum(filteredChartRows, 'quantity_sold'),
        formatNumber
      )}`,
      ...(viewMode === 'price'
        ? [
            before.length && filteredChartRows.length
              ? `Mean gross unit price ${changeText(
                  metricSum(before, 'gross_unit_price') / before.length,
                  metricSum(filteredChartRows, 'gross_unit_price') / filteredChartRows.length,
                  formatMoney
                )}`
              : 'Mean gross unit price needs at least one matching row on each side.',
          ]
        : []),
      `Largest date contributions to net change: ${
        movers.map(([d, v]) => `${d} ${formatMoney(v)}`).join(' · ') || 'No date changed.'
      }`,
      `${added.length} newly matching IDs. ${
        added.length
          ? `Largest new net sales: ${added
              .slice(0, 3)
              .map((r) => `#${r.sales_fact_id} ${formatMoney(r.net_sales_collected)}`)
              .join(' · ')}`
          : 'No new sale meets this scenario and the selected date range.'
      }`,
      ...(missing
        ? [`${missing} saved IDs no longer match. Check source changes and database access.`]
        : []),
      ...(qNum === 4
        ? [
            `March 1 through March 31, 2024 inclusive · UQ-BAG-01 · PROMO-LIMITED. Loaded dataset currently has ${formatNumber(
              totalOverviewCount
            )} records.`,
          ]
        : []),
    ];



    return {
      primaryConfig: {
        type: chartType,
        data: { labels: keys, datasets: alignedDatasets },
        options: sharedOpts,
      } as ChartConfiguration,
      midtermConfig: {
        type: chartType,
        data: { labels: keys, datasets: oldDatasets },
        options: sharedOpts,
      } as ChartConfiguration,
      compareNotes: notes,
    };
  }, [
    comparisonOnly,
    groups,
    viewMode,
    metricTitle,
    values,
    accentStroke,
    labels,
    flaggedSet,
    isLight,
    tickColor,
    isCurrency,
    gridColor,
    midtermSnapshot,
    questionId,
    fromDate,
    toDate,
    grouping,
    filteredChartRows,
    qNum,
    totalOverviewCount,
  ]);

  const recordMidtermRender = useCallback((ms: number) => {
    setMidtermRender({ config: midtermConfig, ms });
  }, [midtermConfig]);
  const recordFinalsRender = useCallback((ms: number) => {
    setFinalsRender({ config: primaryConfig, ms });
  }, [primaryConfig]);

  const activePlugins = useMemo(
    () => (qNum === 1 && viewMode === 'price' ? [thresholdPlugin] : undefined),
    [qNum, viewMode]
  );

  const periodNoun =
    { day: 'day', week: 'week', month: 'month', sale: 'transaction' }[grouping] || 'period';
  const studioTitle =
    (viewMode === 'mix' ? 'Net sales vs units sold' : metricTitle) + ' by ' + periodNoun;
  const quickTakeaway = describeStudioGraph(filteredChartRows, viewMode, grouping, labels, values);
  const aiNarrative = explainTrendSummary(filteredChartRows, groups, mlResult);
  const topFlag = mlResult.flags[0] ?? null;
  const topFlagMembers = useMemo(
    () =>
      topFlag
        ? filteredChartRows.filter((r) => pointKey(r, grouping) === topFlag.period)
        : [],
    [topFlag, filteredChartRows, grouping]
  );

  // Matching records table filtering & pagination
  const sortedTableRows = useMemo(() => {
    const sorted = [...rows].sort(
      (a, b) => dateOf(b).localeCompare(dateOf(a)) || Number(b.sales_fact_id) - Number(a.sales_fact_id)
    );
    const term = tableSearch.trim().toLowerCase();
    if (!term) return sorted;
    return sorted.filter((row) =>
      [
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
      ].some((v) => String(v ?? '').toLowerCase().includes(term))
    );
  }, [rows, tableSearch]);

  const totalTablePages = Math.max(1, Math.ceil(sortedTableRows.length / tablePageSize));
  const safeTablePage = Math.min(tablePage, totalTablePages);
  const tableStart = (safeTablePage - 1) * tablePageSize;
  const pagedTableRows = sortedTableRows.slice(tableStart, tableStart + tablePageSize);

  const handleExportAiReport = () => {
    if (mlResult.reason) return;
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
    const total = groups.reduce((s, b) => s + b.sales, 0);
    const summaryLine = `Question ${questionId} | ${filteredChartRows.length} transactions | ${mlResult.flags.length} AI flags | ${grouping} | ${viewMode} | Total ${total.toFixed(2)}`;
    const body = mlResult.flags.map((f) => [
      questionId,
      grouping,
      viewMode,
      f.period,
      f.sales,
      f.qty,
      f.count,
      f.score.toFixed(4),
      f.reason,
    ]);
    downloadFile(
      buildCsvDocument(headers, body, summaryLine),
      `uniqlick-question-${questionId}-ai-graph-report.csv`
    );
  };

  const handleExportTableCsv = () => {
    const headers =
      qNum === 1
        ? ['Sale ID', 'Date', 'SKU', 'Product', 'Quantity', 'Gross Unit Price', 'Net Sales']
        : qNum === 2
          ? ['Sale ID', 'Date', 'Customer', 'SKU', 'Product', 'Quantity', 'Gross Unit Price', 'Net Sales']
          : qNum === 3
            ? ['Sale ID', 'Date', 'Employee ID', 'Store Code', 'Quantity', 'Gross Unit Price', 'Net Sales']
            : ['Sale ID', 'Date', 'SKU', 'Promotion', 'Quantity', 'Gross Unit Price', 'Net Sales'];
    const body = sortedTableRows.map((row) => {
      if (qNum === 1) {
        return [
          row.sales_fact_id,
          dateOf(row),
          skuOf(row),
          productOf(row),
          row.quantity_sold,
          row.gross_unit_price,
          row.net_sales_collected,
        ];
      }
      if (qNum === 2) {
        return [
          row.sales_fact_id,
          dateOf(row),
          customerOf(row),
          skuOf(row),
          productOf(row),
          row.quantity_sold,
          row.gross_unit_price,
          row.net_sales_collected,
        ];
      }
      if (qNum === 3) {
        return [
          row.sales_fact_id,
          dateOf(row),
          employeeOf(row),
          storeOf(row),
          row.quantity_sold,
          row.gross_unit_price,
          row.net_sales_collected,
        ];
      }
      return [
        row.sales_fact_id,
        dateOf(row),
        skuOf(row),
        promoOf(row),
        row.quantity_sold,
        row.gross_unit_price,
        row.net_sales_collected,
      ];
    });
    downloadFile(buildCsvDocument(headers, body), `uniqlick-question-${questionId}-sales.csv`);
  };

  const comparisonPanel = (
    <>

      <div className="exam-pair">
        <div id={`midPane${questionId}`}>
          <h3>Midterm</h3>
          <ChartCanvas
            id={`midChart${questionId}`}
            containerClassName="chart-container"
            config={midtermConfig}
            onFirstRender={recordMidtermRender}
            plugins={activePlugins}
            ariaLabel={`Midterm Question ${questionId} chart`}
            isLight={isLight}
          />
        </div>
        <div>
          <h3 id={`currentLabel${questionId}`} hidden={!midtermConfig}>
            Finals
          </h3>
          <ChartCanvas
            id={qNum === 2 ? 'chart2a' : `chart${questionId}`}
            containerClassName="chart-container"
            config={primaryConfig}
            plugins={activePlugins}
            ariaLabel={`Question ${questionId} studio chart`}
            isLight={isLight}
            onCanvasReady={savePrimaryCanvas}
            onFirstRender={recordFinalsRender}
          />
        </div>
      </div>

      <details className="comparison-timing">
        <summary>Comparison timings</summary>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th scope="col">Measurement</th><th scope="col">Midterm</th><th scope="col">Finals</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">Supabase retrieval</th><td>Bundled data</td><td>{formatTiming(salesTiming?.supabaseMs)}</td></tr>
              <tr><th scope="row">Browser data request</th><td>Bundled data</td><td>{formatTiming(salesTiming?.requestMs)}</td></tr>
              <tr>
                <th scope="row">Chart render</th>
                <td>{formatTiming(midtermRender?.config === midtermConfig ? midtermRender.ms : null)}</td>
                <td>{formatTiming(finalsRender?.config === primaryConfig ? finalsRender.ms : null)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="description">
          All four scenarios share one paginated Supabase load. Chart times measure each chart
          separately through its first completed draw, including animation.
        </p>
        <button type="button" className="action-btn" disabled={isReloading} onClick={onReloadRecords}>
          {isReloading ? 'Refreshing live data…' : 'Refresh live data and timings'}
        </button>
      </details>

      <div id={`compareNotes${questionId}`} aria-live="polite">
        {compareNotes.map((msg, idx) => (
          <p key={idx}>{msg}</p>
        ))}
      </div>
    </>
  );

  if (comparisonOnly) return comparisonPanel;

  const miningPanel = (
    <div className="card ai-question-card" id={`aiPanel${questionId}`} tabIndex={-1} aria-live="polite">
      <div className="ai-question-head">
        <div className="ai-head-copy">
          <span className="ai-eyebrow">{`UniQlick / MACHINE LEARNING / QUESTION ${questionId}`}</span>
          <h2>{miningOnly ? 'Isolation Forest Anomaly Detection' : 'AI Graph Analysis'}</h2>
          <p>{miningOnly ? SCENARIO_META[questionId].subtitle : 'Finds unusual patterns in this question’s graph.'}</p>
        </div>
        <span
          className={`ai-status ${
            mlResult.reason ? 'neutral' : mlResult.flags.length ? 'warning' : ''
          }`}
          id={`aiStatus${questionId}`}
        >
          {mlResult.reason
            ? 'Insufficient data'
            : mlResult.flags.length
              ? `Review ${mlResult.flags.length} flagged`
              : 'No strong anomalies'}
        </span>
        <div className="ai-question-actions">
          <button
            type="button"
            id={`aiRun${questionId}`}
            className="action-btn"
            title="Recalculate ML findings"
            onClick={() => setMlRunTick((n) => n + 1)}
          >
            ↻ Analyze
          </button>
          <button
            type="button"
            id={`aiExport${questionId}`}
            className="action-btn primary"
            disabled={Boolean(mlResult.reason)}
            onClick={handleExportAiReport}
          >
            ↓ Export
          </button>
          <button
            type="button"
            className="action-btn"
            onClick={() => onOpenGemini('anomaly-explanation')}
          >
            ✦ Explain with Groq
          </button>
        </div>
      </div>

      <div className="ai-metrics">
        <div className="ai-metric">
          <span>Chart points</span>
          <strong id={`aiPoints${questionId}`}>{formatNumber(groups.length)}</strong>
        </div>
        <div className="ai-metric">
          <span>Anomalies</span>
          <strong id={`aiFlags${questionId}`}>{formatNumber(mlResult.flags.length)}</strong>
        </div>
        <div className="ai-metric">
          <span>Model</span>
          <strong className="text-[17px]!" id={`aiModel${questionId}`}>
            {mlResult.reason ? 'Needs data' : 'Trained locally'}
          </strong>
        </div>
      </div>

      <div className="ai-narrative" id={`aiNarrative${questionId}`}>
        {aiNarrative}
      </div>

      <div className="ai-findings" id={`aiFindings${questionId}`}>
        {mlResult.reason ? (
          <div className="ai-finding">
            <b>Model status</b>
            {mlResult.reason}
          </div>
        ) : topFlag ? (
          <div className="ai-finding">
            <b>Top flag</b>
            {`${topFlag.period}: ${topFlag.reason}`}
          </div>
        ) : null}
      </div>

      <div className="ai-anomaly-label">Flagged graph points</div>
      <div className="ai-table-wrap">
        <table aria-label={`Question ${questionId} AI anomaly results`}>
          <thead>
            <tr>
              <th>Period / sale</th>
              <th>Net sales</th>
              <th>Units</th>
              <th>ML score</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody id={`aiRows${questionId}`}>
            {mlResult.flags.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  {mlResult.reason
                    ? `Analysis unavailable: ${mlResult.reason}`
                    : 'No anomalies detected.'}
                </td>
              </tr>
            ) : (
              mlResult.flags.map((f) => (
                <tr key={f.period}>
                  <td>{f.period}</td>
                  <td>{formatMoney(f.sales)}</td>
                  <td>{formatNumber(f.qty)}</td>
                  <td>
                    <span className="ai-score">{f.score.toFixed(3)}</span>
                  </td>
                  <td>{f.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div id={`flagDetail${questionId}`}>
          {topFlag && mlResult.threshold !== undefined && (
            <details>
              <summary>
                {`Inspect ${topFlag.period} · ${topFlagMembers.length} underlying sales · score ${topFlag.score.toFixed(
                  3
                )} / cutoff ${mlResult.threshold.toFixed(3)}`}
              </summary>
              <p>
                {`Check these receipts against the source or generated-ID ledger before acting on this flag. Net sales ${formatMoney(
                  topFlag.sales
                )} across ${topFlag.qty} units.`}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Sale ID</th>
                    <th>Date</th>
                    <th>Quantity</th>
                    <th>Gross unit price</th>
                    <th>Net sales</th>
                    <th>Scenario fields</th>
                  </tr>
                </thead>
                <tbody>
                  {topFlagMembers.map((row) => (
                    <tr key={row.sales_fact_id}>
                      <td>{row.sales_fact_id}</td>
                      <td>{dateOf(row)}</td>
                      <td>{row.quantity_sold}</td>
                      <td>{formatMoney(row.gross_unit_price)}</td>
                      <td>{formatMoney(row.net_sales_collected)}</td>
                      <td>
                        {[
                          skuOf(row),
                          customerOf(row),
                          employeeOf(row),
                          storeOf(row),
                          promoOf(row),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      </div>

      <details className="ai-extra">
        <summary>How detection works</summary>
        <p>
          Isolation Forest compares the current graph’s sales, units, and prices. Flags are
          statistical signals, not confirmed errors. Dates are simulated, so time-based spikes
          are not verified real events.
        </p>
      </details>
    </div>
  );

  if (miningOnly) return <>
    {miningPanel}
    <TukeyChart groups={groups} rows={filteredChartRows} grouping={grouping} period={periodNoun} isLight={isLight} />
  </>;

  return (
    <section id={`question${questionId}`}>
      <div className="card question-heading">
        <div className="heading-eyebrow">Focused analysis</div>
        {qNum === 1 && (
          <>
            <h2>High-Price Sales</h2>
            <p className="description">
              Sales with gross unit price greater than ₱1,000 for product{' '}
              <strong>UQ-HT-02</strong>.
            </p>
          </>
        )}
        {qNum === 2 && (
          <>
            <h2>Customer Product Sales</h2>
            <p className="description">
              Customer <strong>Benjamin Aquino</strong> purchasing product{' '}
              <strong>UQ-AIR-01</strong>.
            </p>
          </>
        )}
        {qNum === 3 && (
          <>
            <h2>Employee and Store Sales</h2>
            <p className="description">
              Employee <strong>EMP-003</strong> at store <strong>STORE-003</strong>.
            </p>
          </>
        )}
        {qNum === 4 && (
          <>
            <h2>March 2024 Promotional Sales</h2>
            <p className="description">
              Sales in <strong>March 2024</strong> for product <strong>UQ-BAG-01</strong> with
              promotion <strong>PROMO-LIMITED</strong>.
            </p>
          </>
        )}
      </div>

      <div id={`status${questionId}`} className="status success" role="status" aria-live="polite">
        {`Loaded ${formatNumber(rows.length)} matching records from ${salesSource} · ${statusTime}`}
      </div>

      <div id={`summary${questionId}`} className="summary-grid">
        <div className="summary-card">
          <h3>Matching Records</h3>
          <div id={`count${questionId}`} className="value">
            {formatNumber(summaryStats.count)}
          </div>
        </div>
        <div className="summary-card">
          <h3>Total Net Sales</h3>
          <div id={`total${questionId}`} className="value">
            {formatMoney(summaryStats.net)}
          </div>
        </div>
        <div className="summary-card">
          <h3>{qNum === 1 ? 'Average Gross Unit Price' : 'Total Quantity Sold'}</h3>
          <div id={`third${questionId}`} className="value">
            {qNum === 1
              ? formatMoney(summaryStats.avgPrice)
              : formatNumber(summaryStats.qty)}
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div id={`insights${questionId}`} className="insights">
          <div className="insight">
            <div className="insight-label">Average sale value</div>
            <div className="insight-value">{formatMoney(summaryStats.avgSale)}</div>
            <div className="insight-detail">Net revenue per matching sale</div>
          </div>
          <div className="insight">
            <div className="insight-label">Active sales days</div>
            <div className="insight-value">{formatNumber(summaryStats.distinctDates)}</div>
            <div className="insight-detail">Unique transaction dates</div>
          </div>
          <div className="insight">
            <div className="insight-label">Highest sales day</div>
            <div className="insight-value">{summaryStats.peakDay}</div>
            <div className="insight-detail">
              {summaryStats.peakDay !== '—'
                ? `${formatMoney(summaryStats.peakVal)} net revenue`
                : 'No dated sales'}
            </div>
          </div>
        </div>
      )}

      <div id={`charts${questionId}`}>
        <div className="card analytics-tools">
          <div className="analytics-title">
            <strong>Visualization Studio</strong>
            <span>Explore and compare your sales data</span>
          </div>
          <div className="analytics-controls">
            <label>
              Chart view{' '}
              <select
                id={`view${questionId}`}
                value={viewMode}
                onChange={(e) => setViewMode(e.target.value as StudioChartView)}
              >
                <option value="trend">Sales trend</option>
                <option value="quantity">Quantity analysis</option>
                <option value="price">Unit price analysis</option>
                <option value="mix">Sales vs quantity</option>
                <option value="cumulative">Cumulative sales</option>
              </select>
            </label>
            <label>
              Group by{' '}
              <select
                id={`group${questionId}`}
                value={grouping}
                onChange={(e) => setGrouping(e.target.value as GroupingMode)}
              >
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="sale">Individual sale</option>
              </select>
            </label>
            <label>
              From{' '}
              <input
                type="date"
                id={`from${questionId}`}
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </label>
            <label>
              To{' '}
              <input
                type="date"
                id={`to${questionId}`}
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="action-btn"
              id={`reset${questionId}`}
              onClick={() => {
                setFromDate('');
                setToDate('');
                setViewMode('trend');
                setGrouping(questionId === '4' ? 'day' : 'month');
              }}
            >
              Reset filters
            </button>
            <button
              type="button"
              className="action-btn primary"
              id={`png${questionId}`}
              onClick={() => {
                const canvas = primaryCanvasRef.current;
                if (!canvas) return;
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/png');
                a.download = `uniqlick-sales-question-${questionId}-graph.png`;
                a.click();
              }}
            >
              ↓ Save graph
            </button>
          </div>

          <div id={`analyticsSummary${questionId}`} className="analytics-summary">
            <span>
              Filtered sales: <b>{formatMoney(metricSum(filteredChartRows, 'net_sales_collected'))}</b>
            </span>
            <span>
              Units: <b>{formatNumber(metricSum(filteredChartRows, 'quantity_sold'))}</b>
            </span>
            <span>
              Average sale:{' '}
              <b>
                {formatMoney(
                  filteredChartRows.length
                    ? metricSum(filteredChartRows, 'net_sales_collected') / filteredChartRows.length
                    : 0
                )}
              </b>
            </span>
            <span>
              Records: <b>{formatNumber(filteredChartRows.length)}</b>
            </span>
          </div>
        </div>

        <div className="card">
          <h2 id={`studioChartTitle${questionId}`}>{studioTitle}</h2>
          {qNum === 1 && (
            <p className="description">
              Only UQ-HT-02 transactions above the ₱1,000 gross unit-price threshold are included.
            </p>
          )}
          {qNum === 4 && (
            <p className="description">Daily net sales for UQ-BAG-01 under PROMO-LIMITED.</p>
          )}
          <ChartCanvas
            id={qNum === 2 ? 'chart2a' : `chart${questionId}`}
            config={primaryConfig}
            plugins={activePlugins}
            ariaLabel={`Question ${questionId} studio chart`}
            isLight={isLight}
            onCanvasReady={savePrimaryCanvas}
          />
        </div>

        <div className="card interpretation-card" aria-live="polite">
          <div className="interpretation-head-row">
            <div>
              <div className="explanation-kicker">Graph summary</div>
              <h3>Quick takeaway</h3>
            </div>
            <button
              type="button"
              className="action-btn llm-inline-btn"
              onClick={() => onOpenGemini('scenario-deep-dive')}
            >
              ✦ Ask Scout
            </button>
          </div>
          <p id={`graphExplain${questionId}`} className="description">
            {quickTakeaway}
          </p>
        </div>

      </div>

      {rows.length > 0 ? (
        <div id={`tableSection${questionId}`} className="card">
          <h2>{qNum === 4 ? 'Matching Promotional Sales Records' : 'Matching Records'}</h2>
          <p id={`tableCount${questionId}`} className="description">
            {`${formatNumber(sortedTableRows.length)} matching transactions`}
          </p>

          <div className="toolbar">
            <input
              id={`search${questionId}`}
              type="search"
              aria-label="Search sales records"
              placeholder="⌕  Search dates, IDs, products, values..."
              value={tableSearch}
              onChange={(e) => {
                setTableSearch(e.target.value);
                setTablePage(1);
              }}
            />
            <select
              id={`size${questionId}`}
              aria-label="Rows per page"
              value={tablePageSize}
              onChange={(e) => {
                setTablePageSize(Number(e.target.value));
                setTablePage(1);
              }}
            >
              <option value={25}>25 rows</option>
              <option value={50}>50 rows</option>
              <option value={100}>100 rows</option>
            </select>
            <button
              className="action-btn primary"
              id={`export${questionId}`}
              type="button"
              onClick={handleExportTableCsv}
            >
              ↓ Export CSV
            </button>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                {qNum === 1 && (
                  <tr>
                    <th>Sale ID</th>
                    <th>Date</th>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Gross Unit Price</th>
                    <th>Net Sales</th>
                  </tr>
                )}
                {qNum === 2 && (
                  <tr>
                    <th>Sale ID</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>SKU</th>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th>Gross Unit Price</th>
                    <th>Net Sales</th>
                  </tr>
                )}
                {qNum === 3 && (
                  <tr>
                    <th>Sale ID</th>
                    <th>Date</th>
                    <th>Employee ID</th>
                    <th>Store Code</th>
                    <th>Quantity</th>
                    <th>Gross Unit Price</th>
                    <th>Net Sales</th>
                  </tr>
                )}
                {qNum === 4 && (
                  <tr>
                    <th>Sale ID</th>
                    <th>Date</th>
                    <th>SKU</th>
                    <th>Promotion</th>
                    <th>Quantity</th>
                    <th>Gross Unit Price</th>
                    <th>Net Sales</th>
                  </tr>
                )}
              </thead>
              <tbody id={`tableBody${questionId}`}>
                {pagedTableRows.length === 0 ? (
                  <tr>
                    <td colSpan={qNum === 2 ? 8 : 7} className="empty">
                      No matching rows in search.
                    </td>
                  </tr>
                ) : (
                  pagedTableRows.map((row) => (
                    <tr key={row.sales_fact_id}>
                      <td>{row.sales_fact_id}</td>
                      <td>{dateOf(row) || '—'}</td>
                      {qNum === 2 && <td>{customerOf(row) || '—'}</td>}
                      {(qNum === 1 || qNum === 2 || qNum === 4) && (
                        <td>{skuOf(row) || '—'}</td>
                      )}
                      {(qNum === 1 || qNum === 2) && <td>{productOf(row) || '—'}</td>}
                      {qNum === 3 && <td>{employeeOf(row) || '—'}</td>}
                      {qNum === 3 && <td>{storeOf(row) || '—'}</td>}
                      {qNum === 4 && <td>{promoOf(row) || '—'}</td>}
                      <td>{formatNumber(row.quantity_sold)}</td>
                      <td>{formatMoney(row.gross_unit_price)}</td>
                      <td>{formatMoney(row.net_sales_collected)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <span id={`pageInfo${questionId}`}>
              {sortedTableRows.length
                ? `Showing ${tableStart + 1}–${Math.min(
                    tableStart + tablePageSize,
                    sortedTableRows.length
                  )} of ${formatNumber(sortedTableRows.length)} records · Page ${safeTablePage} of ${totalTablePages}`
                : '0 matching records'}
            </span>
            <div className="pager-buttons">
              <button
                className="action-btn"
                id={`prev${questionId}`}
                type="button"
                disabled={safeTablePage <= 1}
                onClick={() => setTablePage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </button>
              <button
                className="action-btn"
                id={`next${questionId}`}
                type="button"
                disabled={safeTablePage >= totalTablePages}
                onClick={() => setTablePage((p) => Math.min(totalTablePages, p + 1))}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div id={`empty${questionId}`} className="card empty">
          {qNum === 4
            ? 'No matching promotional sales found for March 2024.'
            : `No matching records found for Question ${questionId}.`}
        </div>
      )}
    </section>
  );
}
