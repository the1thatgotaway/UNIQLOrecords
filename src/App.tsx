import { Activity, Columns2, Database, ArrowUpRight, LayoutDashboard, Moon, Printer, Store, Sun, Table2, Tag, TrendingUp, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import rawMidtermRows from './data/offlineSales.json';
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
import { parseImportedSnapshot } from './utils/snapshotParser.ts';
import { MidtermComparison } from './components/MidtermComparison.tsx';
import { OverviewSection } from './components/OverviewSection.tsx';
import { WarehouseSchema } from './components/WarehouseSchema.tsx';
import { QuestionSection } from './components/QuestionSection.tsx';
import { GeminiModal } from './components/GeminiModal.tsx';

const sourceName = 'Live Supabase';
const midtermLabel = 'November 20, 2026 Midterm snapshot';
const midtermRows = rawMidtermRows as SalesRecord[];
const midtermSnapshot: Pick<MidtermSnapshot, 'captured_at' | 'baseline' | 'scenarios'> = {
  captured_at: 'November 20, 2026',
  baseline: midtermRows.length,
  scenarios: {
    '1': filterScenarioRows(midtermRows, '1'),
    '2': filterScenarioRows(midtermRows, '2'),
    '3': filterScenarioRows(midtermRows, '3'),
    '4': filterScenarioRows(midtermRows, '4'),
  },
};

export default function App() {
  const view = new URLSearchParams(window.location.search).get('view');
  return view ? <Dashboard /> : <CoverPage />;
}

function CoverPage() {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');

  async function refreshSales() {
    setRefreshing(true);
    setRefreshMessage('Checking for the latest sales…');
    try {
      const response = await fetch('/api/sales');
      if (!response.ok) throw new Error('Sales request failed');
      const snapshot = parseImportedSnapshot(await response.text());
      setRefreshMessage(formatNumber(snapshot.count) + ' sales records available from Supabase.');
    } catch {
      setRefreshMessage('Could not refresh sales. Try again in a moment.');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="uniqlick-cover">
      <div className="uniqlick-cover-content">
        <h1>UniQlick</h1>
        <p>One Click. Every Sale. Complete Control.</p>
        <p className="uniqlick-cover-intro">
          UniQlick helps you understand your retail sales. Track product and store performance, explore customer purchases, and investigate unusual activity.
        </p>
        <div className="cover-actions">
          <a className="uniqlick-cover-link" href="?view=dashboard">
          Open dashboard <ArrowUpRight size={19} aria-hidden="true" />
          </a>
          <button type="button" className="uniqlick-cover-link cover-refresh" disabled={refreshing} onClick={refreshSales}>
            {refreshing ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>
        {refreshMessage && <p className="cover-refresh-status" role="status">{refreshMessage}</p>}
      </div>
      <div className="uniqlick-cover-art" aria-hidden="true">
        <span>U</span>
      </div>
    </main>
  );
}

function Dashboard() {
  const [snapshotRows, setSnapshotRows] = useState<SalesRecord[]>([]);
  const [schemaOpen, setSchemaOpen] = useState(() => new URLSearchParams(window.location.search).get('view') === 'schema');
  const [activeTab, setActiveTab] = useState<ScenarioId | 'comparison' | 'mining'>(() => {
    const view = new URLSearchParams(window.location.search).get('view');
    return view === 'comparison' ? view : 'overview';
  });
  const [miningQuestion, setMiningQuestion] = useState<FocusedQuestionId>('3');
  const [isLight, setIsLight] = useState<boolean>(true);
  const [recordsRequested, setRecordsRequested] = useState(false);
  const [loadedAt, setLoadedAt] = useState('');
  const [salesTiming, setSalesTiming] = useState<{ requestMs: number; supabaseMs: number | null } | null>(null);

  // Refresh / Sync status feedback (matching SYNC ENGINE v4)
  const [refreshSeconds, setRefreshSeconds] = useState(0);
  const [isReloading, setIsReloading] = useState(true);
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

  // Non-invasive Gemini AI Copilot / Chatbot
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [geminiInitialTask, setGeminiInitialTask] = useState<LlmAnalysisTask | null>(null);
  const [geminiTriggerNonce, setGeminiTriggerNonce] = useState(0);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    document.body.classList.toggle('light', isLight);
  }, [isLight]);

  useEffect(() => {
    if (!recordsRequested || activeTab !== 'overview' || !loadedAt) return;
    const heading = document.getElementById('complete-sales-records');
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
    setRecordsRequested(false);
  }, [recordsRequested, activeTab, loadedAt]);

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
      )} sales records from ${sourceName} · ${loadedAt}${
        oneDate ? ' · Only one distinct date key detected' : ''
      }`,
      statusType: (oneDate ? 'warning' : 'success') as '' | 'success' | 'warning' | 'error',
      alertMessage: notices.join('  '),
    };
  }, [snapshotRows, loadedAt, sourceName]);

  const llmContextPayload = useMemo(() => {
    if (activeTab === 'overview' || activeTab === 'comparison') {
      const parts: string[] = [];
      if (selectedSku) parts.push(`SKU=${selectedSku}`);
      if (fromDate || toDate) parts.push(`Dates=${fromDate || 'start'}..${toDate || 'end'}`);
      if (search.trim()) parts.push(`Query="${search.trim()}"`);

      return buildLlmContextPayload({
        viewId: 'overview',
        filteredRows: overviewFilteredRows,
        allRows: snapshotRows,
        totalLoadedCount: snapshotRows.length,
        snapshotSource: sourceName,
        filterDescription: parts.length ? parts.join(' · ') : 'All loaded transactions',
        activeGrouping: overviewGroup,
        midtermLoaded: true,
        midtermLabel,
        overallAnomalyCount,
        anomalies: overviewAnomalies,
      });
    }

    const questionId = activeTab === 'mining' ? miningQuestion : activeTab;
    const qRows = scenarioRowsMap[questionId];
    const grouping = activeTab === '4' ? 'day' : 'month';
    const bucketsMap = groupSales(qRows, grouping);
    const sortedBuckets = [...bucketsMap.keys()]
      .sort()
      .map((k) => bucketsMap.get(k)!);
    const mlModel = computeIsolationForest(sortedBuckets, questionId, 'trend', grouping);
    const qAnomalies = detectSalesAnomalies(qRows);

    return buildLlmContextPayload({
      viewId: questionId,
      filteredRows: qRows,
      allRows: snapshotRows,
      totalLoadedCount: snapshotRows.length,
      snapshotSource: sourceName,
      filterDescription: SCENARIO_META[questionId].subtitle,
      activeGrouping: grouping,
      midtermLoaded: true,
      midtermLabel,
      overallAnomalyCount,
      anomalies: qAnomalies,
      mlFlags: mlModel.flags,
    });
  }, [
    activeTab,
    miningQuestion,
    selectedSku,
    fromDate,
    toDate,
    search,
    overviewFilteredRows,
    snapshotRows,
    sourceName,
    overviewGroup,
    overallAnomalyCount,
    overviewAnomalies,
    scenarioRowsMap,
  ]);

  const loadLiveSales = useCallback(async (signal?: AbortSignal, quiet = false) => {
    setIsReloading(true);
    try {
      const requestStarted = performance.now();
      const response = await fetch('/api/sales', { signal });
      const data = await response.text();
      const requestMs = performance.now() - requestStarted;
      if (!response.ok) {
        const error = JSON.parse(data);
        throw new Error(error.error || 'Could not load live sales.');
      }
      const snapshot = parseImportedSnapshot(data);
      const supabaseDuration = response.headers.get('Server-Timing')?.match(/supabase;dur=([\d.]+)/)?.[1];
      setSalesTiming({ requestMs, supabaseMs: supabaseDuration ? Number(supabaseDuration) : null });
      setSnapshotRows(snapshot.rows);
      setLoadedAt(new Date().toLocaleTimeString('en-PH'));
      setRefreshNotice(null);
      if (!signal && !quiet) {
        setRefreshToast({
          title: 'Live sales loaded',
          detail: formatNumber(snapshot.count) + ' records loaded from Supabase.',
          kind: '',
        });
      }
    } catch (err) {
      if (!signal?.aborted) {
        setRefreshNotice({
          message: err instanceof Error ? err.message : 'Could not load live sales.',
          kind: 'error',
        });
      }
    } finally {
      if (!signal?.aborted) setIsReloading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadLiveSales(controller.signal);
    return () => controller.abort();
  }, [loadLiveSales]);

  useEffect(() => {
    if (!refreshSeconds || isReloading) return;
    const timer = window.setTimeout(() => void loadLiveSales(undefined, true), refreshSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [refreshSeconds, isReloading, loadLiveSales]);

  const handleReloadRecords = () => {
    if (!isReloading) void loadLiveSales();
  };

  const openGemini = (task: LlmAnalysisTask | null = null) => {
    setGeminiInitialTask(task);
    setGeminiTriggerNonce((n) => n + 1);
    setGeminiOpen(true);
  };

  const focusedQuestion = activeTab === 'mining' ? miningQuestion : activeTab as FocusedQuestionId;
  const tabOrder: (ScenarioId | 'comparison' | 'mining')[] = ['overview', '1', '2', '3', '4', 'comparison'];

  const handleTabsKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.target instanceof HTMLElement && e.target.closest('[aria-haspopup="dialog"]')) return;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const previous = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!next && !previous) return;
    const currentIdx = activeTab === 'mining' ? 0 : tabOrder.indexOf(activeTab);
    const nextIdx =
      (currentIdx + (next ? 1 : -1) + tabOrder.length) % tabOrder.length;
    setActiveTab(tabOrder[nextIdx]);
    tabRefs.current[nextIdx]?.focus();
    e.preventDefault();
  };

  return (
    <>
      <header className="dashboard-header">
        <div className="header-inner">
          <div className="dashboard-header-brand">
            <div className="brand">
              <span className="brand-mark">U</span> SALES ANALYTICS
            </div>
            <h1>
              <span>UniQlick - LifeWear</span>
            </h1>
            <p>One Click. Every Sale. Complete Control.</p>
          </div>
          <div className="header-actions">
            <label className="dashboard-auto-refresh">
              Auto:
              <select aria-label="Auto refresh interval" value={refreshSeconds} onChange={event => setRefreshSeconds(Number(event.target.value))}>
                <option value={0}>Manual</option>
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            </label>
            <button type="button" className="head-btn header-shortcut" disabled={!loadedAt}
              onClick={() => {
                setActiveTab('overview');
                setRecordsRequested(true);
              }}>
              <Table2 size={16} aria-hidden="true" /> Records
            </button>
            <button type="button" className="head-btn header-shortcut"
              aria-haspopup="dialog" onClick={() => setSchemaOpen(true)}>
              <Database size={16} aria-hidden="true" /> Schema
            </button>
            <button
              id="geminiTrigger"
              className="head-btn"
              type="button"
              onClick={() => openGemini(null)}
            >
              ✦ Ask Scout
            </button>
            <button
              id="printReport"
              className="head-btn"
              type="button"
              onClick={() => window.print()}
            >
              <Printer size={16} aria-hidden="true" /> PDF
            </button>
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

      <main className="dashboard-layout">
        <aside className="dashboard-sidebar" aria-label="Sales Analytics">
          <h2 className="dashboard-sidebar-title">Sales Analytics</h2>

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
              <LayoutDashboard size={17} aria-hidden="true" /><span>Executive Dashboard</span>
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
              <TrendingUp size={17} aria-hidden="true" /><span>Premium Pricing</span>
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
              <Users size={17} aria-hidden="true" /><span>Customer Behavior</span>
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
              <Store size={17} aria-hidden="true" /><span>Store Performance</span>
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
              <Tag size={17} aria-hidden="true" /><span>Promo Analytics</span>
            </button>
            <button type="button" ref={el => { tabRefs.current[5] = el; }}
              className={`tab${activeTab === 'comparison' ? ' active' : ''}`}
              aria-selected={activeTab === 'comparison'} onClick={() => setActiveTab('comparison')}>
              <Columns2 size={17} aria-hidden="true" /><span>Comparative Analysis</span>
            </button>
          </nav>

          <div className="dashboard-mining">
            <h2 className="dashboard-sidebar-title">Data Mining</h2>
            <button
              type="button"
              className="dashboard-mining-link"
              disabled={!loadedAt}
              aria-current={activeTab === 'mining' ? 'page' : undefined}
              onClick={() => setActiveTab('mining')}
            >
              <Activity size={17} aria-hidden="true" />
              <span>Isolation Forest <small>Anomaly Detection</small></span>
            </button>
          </div>
          <div className="dashboard-sidebar-footer">
            <div className="dashboard-sidebar-data">
              <div className="dashboard-sidebar-source">
                <span className={loadedAt && !refreshNotice ? "data-dot connected" : "data-dot"} aria-hidden="true" />
                {isReloading ? "Syncing sales" : refreshNotice ? "Sync unavailable" : loadedAt ? "Live Supabase" : "Awaiting data"}
              </div>
              {loadedAt && (
                <>
                  <div className="dashboard-sidebar-count">{formatNumber(snapshotRows.length)} <span>sales records</span></div>
                  <div className="dashboard-sidebar-sync">Last loaded {loadedAt}</div>
                </>
              )}
            </div>
            <a className="dashboard-sidebar-home" href="./">Back to cover <ArrowUpRight size={15} aria-hidden="true" /></a>
          </div>
        </aside>

        <div className="dashboard-content">
          <div
            id="refreshNotice"
            className={`refresh-notice${refreshNotice ? (refreshNotice.kind ? ` ${refreshNotice.kind}` : '') : ' hidden'}`}
            role="status"
            aria-live="polite"
          >
            {refreshNotice?.message ?? ''}
            {refreshNotice && loadedAt ? ' Showing the last successfully loaded records.' : null}
          </div>

          {!loadedAt && isReloading && <p role="status">Loading sales from Supabase…</p>}
          {schemaOpen && <WarehouseSchema onClose={() => setSchemaOpen(false)} />}
          {loadedAt && (activeTab === 'comparison' ? <MidtermComparison midtermSnapshot={midtermSnapshot} midterm={midtermRows} finals={snapshotRows} isLight={isLight} salesTiming={salesTiming} isReloading={isReloading} onReloadRecords={handleReloadRecords} statusTime={loadedAt} onOpenGemini={openGemini} /> : activeTab === 'overview' ? (
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
              onOpenGemini={(task) => openGemini(task)}
            />
          ) : (
            <>
              {activeTab === 'mining' && (
                <div className="card">
                  <label htmlFor="miningQuestion">Scenario</label>{' '}
                  <select id="miningQuestion" value={miningQuestion}
                    onChange={event => setMiningQuestion(event.target.value as FocusedQuestionId)}>
                    {(['1', '2', '3', '4'] as const).map(id => (
                      <option key={id} value={id}>{SCENARIO_META[id].title}</option>
                    ))}
                  </select>
                </div>
              )}
            <QuestionSection
              key={activeTab === 'mining' ? `mining-${miningQuestion}` : activeTab}
              miningOnly={activeTab === 'mining'}
              questionId={focusedQuestion}
              rows={scenarioRowsMap[focusedQuestion]}
              midtermSnapshot={midtermSnapshot}
              salesTiming={salesTiming}
              isReloading={isReloading}
              onReloadRecords={handleReloadRecords}
              totalOverviewCount={snapshotRows.length}
              isLight={isLight}
              statusTime={loadedAt}
              onOpenGemini={(task) => openGemini(task)}
            />
            </>
          ))}

          <div className="footer">
            UniQlick • Live results depend on Supabase access
          </div>
        </div>
      </main>

      <button
        id="themeToggle"
        className="theme-launcher"
        type="button"
        title={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
        aria-label={isLight ? 'Switch to dark mode' : 'Switch to light mode'}
        onClick={() => setIsLight((light) => !light)}
      >
        {isLight ? <Moon size={22} aria-hidden="true" /> : <Sun size={22} aria-hidden="true" />}
      </button>

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
