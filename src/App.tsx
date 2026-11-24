import { useEffect, useMemo, useRef, useState } from 'react';
import rawSalesData from './data/offlineSales.json';
import type {
  FocusedQuestionId,
  LlmAnalysisTask,
  MidtermSnapshot,
  OverviewSortOrder,
  SalesRecord,
  ScenarioId,
} from './types/sales.ts';
import {
  buildLlmContextPayload,
  detectSalesAnomalies,
  filterAndSortOverview,
  filterScenarioRows,
  formatNumber,
  groupSales,
  SCENARIO_META,
  skuOf,
} from './utils/salesAnalytics.ts';
import { computeIsolationForest } from './utils/isolationForest.ts';
import { parseImportedSnapshot, SUPABASE_SNAPSHOT_SQL } from './utils/snapshotParser.ts';
import { OverviewSection } from './components/OverviewSection.tsx';
import { QuestionSection } from './components/QuestionSection.tsx';
import { GeminiModal } from './components/GeminiModal.tsx';

const INITIAL_ROWS = rawSalesData as SalesRecord[];
const DEFAULT_SOURCE_NAME = 'November 20, 2026 Midterm snapshot';

export default function App() {
  const [snapshotRows, setSnapshotRows] = useState<SalesRecord[]>(INITIAL_ROWS);
  const [sourceName, setSourceName] = useState<string>(DEFAULT_SOURCE_NAME);
  const [activeTab, setActiveTab] = useState<ScenarioId>('overview');
  const [isLight, setIsLight] = useState<boolean>(false);
  const [importMessage, setImportMessage] = useState<string>('');
  const [loadedAt, setLoadedAt] = useState<string>(() =>
    new Date().toLocaleTimeString('en-PH')
  );

  // Refresh / Sync status feedback (matching SYNC ENGINE v4)
  const [isReloading, setIsReloading] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<{
    message: string;
    kind: '' | 'warning' | 'error';
  } | null>(null);
  const [refreshToast, setRefreshToast] = useState<{
    title: string;
    detail: string;
    kind: '' | 'warning' | 'error';
  } | null>(null);

  // Overview filter state
  const [search, setSearch] = useState('');
  const [selectedSku, setSelectedSku] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<OverviewSortOrder>('id-desc');
  const [overviewGroup, setOverviewGroup] = useState<'month' | 'week' | 'day'>('month');

  // Midterm comparison snapshot
  const [midtermSnapshot, setMidtermSnapshot] = useState<MidtermSnapshot | null>(null);
  const [midtermFileName, setMidtermFileName] = useState<string>('');

  // Non-invasive Gemini AI Copilot / Chatbot
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [geminiInitialTask, setGeminiInitialTask] = useState<LlmAnalysisTask | null>(null);
  const [geminiTriggerNonce, setGeminiTriggerNonce] = useState(0);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    document.body.classList.toggle('light', isLight);
  }, [isLight]);

  const skuChoices = useMemo(
    () => [...new Set(snapshotRows.map(skuOf).filter(Boolean))].sort(),
    [snapshotRows]
  );

  const scenarioRowsMap = useMemo(
    () => ({
      '1': filterScenarioRows(snapshotRows, '1'),
      '2': filterScenarioRows(snapshotRows, '2'),
      '3': filterScenarioRows(snapshotRows, '3'),
      '4': filterScenarioRows(snapshotRows, '4'),
    }),
    [snapshotRows]
  );

  const overviewFilteredRows = useMemo(
    () =>
      filterAndSortOverview(snapshotRows, {
        search,
        sku: selectedSku,
        from: fromDate,
        to: toDate,
        sort: sortOrder,
      }),
    [snapshotRows, search, selectedSku, fromDate, toDate, sortOrder]
  );

  const overallAnomalyCount = useMemo(
    () => detectSalesAnomalies(snapshotRows).length,
    [snapshotRows]
  );

  const overviewAnomalies = useMemo(
    () => detectSalesAnomalies(overviewFilteredRows),
    [overviewFilteredRows]
  );

  const { statusMessage, statusType, alertMessage } = useMemo(() => {
    const distinctKeys = new Set(
      snapshotRows.map((r) => r.date_key).filter((k) => k !== null && k !== undefined)
    );
    const oneDate = snapshotRows.length > 1 && distinctKeys.size === 1;
    const notices: string[] = [];
    if (oneDate) {
      notices.push(
        `DATE QUALITY WARNING: all ${formatNumber(snapshotRows.length)} sales have date_key ${
          [...distinctKeys][0]
        }. This comes from the SQL seed, not the chart. Run UNIQLO_Repair_Sales_Dates_2024_to_2026.sql in the Supabase SQL Editor, then reload records. The repair generates labeled synthetic dates, not historical facts.`
      );
    }
    if (!snapshotRows.length) {
      notices.push(
        'Supabase returned zero visible sales. Check the stored fact_sales count in the SQL Editor and the read policy for your dashboard role.'
      );
    }
    return {
      statusMessage: `Loaded ${formatNumber(
        snapshotRows.length
      )} sales records from the offline snapshot · ${loadedAt}${
        oneDate ? ' · Only one distinct date key detected' : ''
      }`,
      statusType: (oneDate ? 'warning' : 'success') as '' | 'success' | 'warning' | 'error',
      alertMessage: notices.join('  '),
    };
  }, [snapshotRows, loadedAt]);

  const llmContextPayload = useMemo(() => {
    if (activeTab === 'overview') {
      const parts: string[] = [];
      if (selectedSku) parts.push(`SKU=${selectedSku}`);
      if (fromDate || toDate) parts.push(`Dates=${fromDate || 'start'}..${toDate || 'end'}`);
      if (search.trim()) parts.push(`Query="${search.trim()}"`);

      return buildLlmContextPayload({
        viewId: 'overview',
        filteredRows: overviewFilteredRows,
        allRows: snapshotRows,
        totalLoadedCount: snapshotRows.length,
        snapshotSource: `Offline · ${sourceName}`,
        filterDescription: parts.length ? parts.join(' · ') : 'All loaded transactions',
        activeGrouping: overviewGroup,
        midtermLoaded: Boolean(midtermSnapshot),
        midtermLabel: midtermFileName || undefined,
        overallAnomalyCount,
        anomalies: overviewAnomalies,
      });
    }

    const qRows = scenarioRowsMap[activeTab];
    const bucketsMap = groupSales(qRows, 'day');
    const sortedBuckets = [...bucketsMap.keys()]
      .sort()
      .map((k) => bucketsMap.get(k)!);
    const mlModel = computeIsolationForest(sortedBuckets, activeTab, 'trend', 'day');
    const qAnomalies = detectSalesAnomalies(qRows);

    return buildLlmContextPayload({
      viewId: activeTab,
      filteredRows: qRows,
      allRows: snapshotRows,
      totalLoadedCount: snapshotRows.length,
      snapshotSource: `Offline · ${sourceName}`,
      filterDescription: SCENARIO_META[activeTab].subtitle,
      activeGrouping: 'day',
      midtermLoaded: Boolean(midtermSnapshot),
      midtermLabel: midtermFileName || undefined,
      overallAnomalyCount,
      anomalies: qAnomalies,
      mlFlags: mlModel.flags,
    });
  }, [
    activeTab,
    selectedSku,
    fromDate,
    toDate,
    search,
    overviewFilteredRows,
    snapshotRows,
    sourceName,
    overviewGroup,
    midtermSnapshot,
    midtermFileName,
    overallAnomalyCount,
    overviewAnomalies,
    scenarioRowsMap,
  ]);

  const handleReloadSnapshot = () => {
    if (isReloading) return;
    setIsReloading(true);
    const nowTime = new Date().toLocaleTimeString('en-PH');
    setLoadedAt(nowTime);
    const msg = `Reloaded ${formatNumber(snapshotRows.length)} records from Offline · ${sourceName} (${nowTime}).`;
    setRefreshNotice({ message: msg, kind: '' });
    setRefreshToast({
      title: 'Snapshot synchronized',
      detail: msg,
      kind: '',
    });
    setTimeout(() => setIsReloading(false), 180);
  };

  const handleOfflineImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = parseImportedSnapshot(await file.text());
      setSnapshotRows(parsed.rows);
      setSourceName(file.name);
      setLoadedAt(new Date().toLocaleTimeString('en-PH'));
      setImportMessage(`${parsed.count} records loaded.`);
      setActiveTab('overview');
    } catch (err) {
      setImportMessage(err instanceof Error ? err.message : 'Unable to import snapshot.');
    } finally {
      e.target.value = '';
    }
  };

  const openGemini = (task: LlmAnalysisTask | null = null) => {
    setGeminiInitialTask(task);
    setGeminiTriggerNonce((n) => n + 1);
    setGeminiOpen(true);
  };

  const tabOrder: ScenarioId[] = ['overview', '1', '2', '3', '4'];

  const handleTabsKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const currentIdx = tabOrder.indexOf(activeTab);
    const nextIdx =
      (currentIdx + (e.key === 'ArrowRight' ? 1 : -1) + tabOrder.length) % tabOrder.length;
    setActiveTab(tabOrder[nextIdx]);
    tabRefs.current[nextIdx]?.focus();
    e.preventDefault();
  };

  return (
    <>
      <header>
        <div className="header-inner">
          <div>
            <div className="brand">
              <span className="brand-mark">U</span> UNIQLO / SALES MANAGEMENT
            </div>
            <h1>
              UNIQLO <span>Sales Management Records</span>
            </h1>
            <p>Sales records, visual analytics, and retail performance insights</p>
          </div>
          <div className="header-actions">
            <span className="online">SUPABASE DATA CONNECTION</span>
            <button
              id="geminiTrigger"
              className="head-btn"
              type="button"
              onClick={() => openGemini(null)}
            >
              ✦ Gemini AI
            </button>
            <button
              id="printReport"
              className="head-btn"
              type="button"
              onClick={() => window.print()}
            >
              ▤ Print report
            </button>
            <button
              id="themeToggle"
              className="head-btn"
              type="button"
              onClick={() => setIsLight((l) => !l)}
            >
              {isLight ? '☾ Dark mode' : '☀ Light mode'}
            </button>
            <div className="refresh-control-group">
              <button
                id="refreshData"
                className="head-btn"
                type="button"
                title="Reload the selected snapshot"
                disabled={isReloading}
                onClick={handleReloadSnapshot}
              >
                {isReloading ? '⟳ Syncing…' : '↻ Reload snapshot'}
              </button>
              <span className="refresh-build">SYNC ENGINE v4</span>
            </div>
          </div>
        </div>
      </header>

      <div
        id="refreshFeedback"
        className={`refresh-feedback${refreshToast ? (refreshToast.kind ? ` ${refreshToast.kind}` : '') : ' hidden'}`}
        role="status"
        aria-live="polite"
      >
        <div className="refresh-feedback-copy">
          <strong id="refreshFeedbackTitle">{refreshToast?.title ?? 'Synchronizing'}</strong>
          <span id="refreshFeedbackDetail" className="feedback-details">
            {refreshToast?.detail ?? ''}
          </span>
        </div>
        <button
          id="refreshFeedbackClose"
          className="feedback-dismiss"
          type="button"
          aria-label="Dismiss message"
          onClick={() => setRefreshToast(null)}
        >
          ×
        </button>
      </div>

      <main>
        <div className="section-label">
          SALES ANALYTICS <span className="module-count">05 VIEWS</span>
        </div>
        <p className="sales-analytics-description">
          Explore sales records and trends across pricing, customer behavior, store performance, and
          promotions through interactive dashboards.
        </p>

        <section className="card">
          <strong id="sourceName">{`Offline · ${sourceName}`}</strong>
          <details>
            <summary>Load newer sales from Supabase</summary>
            <p>
              Run the query below in the project SQL Editor. Export its single result as CSV and
              choose that file here.
            </p>
            <pre id="exportQuery">{SUPABASE_SNAPSHOT_SQL}</pre>
            <input
              id="offlineImport"
              type="file"
              accept=".csv,.json"
              onChange={handleOfflineImport}
            />
            <p role="status" id="importMessage">
              {importMessage}
            </p>
          </details>
        </section>

        <nav className="tabs" aria-label="Dashboard sections" onKeyDown={handleTabsKeyDown}>
          <button
            ref={(el) => {
              tabRefs.current[0] = el;
            }}
            className={`tab overview-tab${activeTab === 'overview' ? ' active' : ''}`}
            id="tabOverview"
            type="button"
            aria-controls="overview"
            aria-selected={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
          >
            ◫ &nbsp; All Sales Dashboard <span className="tab-index">00</span>
          </button>
          <button
            ref={(el) => {
              tabRefs.current[1] = el;
            }}
            className={`tab${activeTab === '1' ? ' active' : ''}`}
            id="tab1"
            type="button"
            aria-selected={activeTab === '1'}
            onClick={() => setActiveTab('1')}
          >
            ◈ &nbsp; Premium Pricing <span className="tab-index">01</span>
          </button>
          <button
            ref={(el) => {
              tabRefs.current[2] = el;
            }}
            className={`tab${activeTab === '2' ? ' active' : ''}`}
            id="tab2"
            type="button"
            aria-selected={activeTab === '2'}
            onClick={() => setActiveTab('2')}
          >
            ◎ &nbsp; Customer Behavior <span className="tab-index">02</span>
          </button>
          <button
            ref={(el) => {
              tabRefs.current[3] = el;
            }}
            className={`tab${activeTab === '3' ? ' active' : ''}`}
            id="tab3"
            type="button"
            aria-selected={activeTab === '3'}
            onClick={() => setActiveTab('3')}
          >
            ▥ &nbsp; Store Performance <span className="tab-index">03</span>
          </button>
          <button
            ref={(el) => {
              tabRefs.current[4] = el;
            }}
            className={`tab${activeTab === '4' ? ' active' : ''}`}
            id="tab4"
            type="button"
            aria-selected={activeTab === '4'}
            onClick={() => setActiveTab('4')}
          >
            ✦ &nbsp; Promo Analytics <span className="tab-index">04</span>
          </button>
        </nav>

        <div
          id="refreshNotice"
          className={`refresh-notice${refreshNotice ? (refreshNotice.kind ? ` ${refreshNotice.kind}` : '') : ' hidden'}`}
          role="status"
          aria-live="polite"
        >
          {refreshNotice?.message ?? ''}
        </div>

        {activeTab === 'overview' ? (
          <OverviewSection
            allRows={snapshotRows}
            filteredRows={overviewFilteredRows}
            anomalies={overviewAnomalies}
            skuChoices={skuChoices}
            search={search}
            selectedSku={selectedSku}
            fromDate={fromDate}
            toDate={toDate}
            sortOrder={sortOrder}
            grouping={overviewGroup}
            isLight={isLight}
            statusMessage={statusMessage}
            statusType={statusType}
            alertMessage={alertMessage}
            isReloading={isReloading}
            onSearchChange={setSearch}
            onSkuChange={setSelectedSku}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
            onSortOrderChange={setSortOrder}
            onGroupingChange={setOverviewGroup}
            onClearFilters={() => {
              setSearch('');
              setSelectedSku('');
              setFromDate('');
              setToDate('');
              setSortOrder('id-desc');
              setOverviewGroup('month');
            }}
            onReloadRecords={handleReloadSnapshot}
            onOpenGemini={(task) => openGemini(task)}
          />
        ) : (
          <QuestionSection
            key={activeTab}
            questionId={activeTab as FocusedQuestionId}
            rows={scenarioRowsMap[activeTab as FocusedQuestionId]}
            midtermSnapshot={midtermSnapshot}
            totalOverviewCount={snapshotRows.length}
            isLight={isLight}
            statusTime={loadedAt}
            midtermStatusLabel={midtermFileName ? `Loaded ${midtermFileName}` : ''}
            onMidtermLoaded={(snap, fname) => {
              setMidtermSnapshot(snap);
              setMidtermFileName(fname);
            }}
            onOpenGemini={(task) => openGemini(task)}
          />
        )}

        <div className="footer">
          UNIQLO SALES MANAGEMENT RECORDS • Live results depend on Supabase access
        </div>
      </main>

      <GeminiModal
        isOpen={geminiOpen}
        initialTask={geminiInitialTask}
        triggerNonce={geminiTriggerNonce}
        contextPayload={llmContextPayload}
        onOpen={() => openGemini(null)}
        onClose={() => setGeminiOpen(false)}
      />
    </>
  );
}
