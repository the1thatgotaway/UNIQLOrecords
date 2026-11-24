import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Database,
  Menu,
  Moon,
  Printer,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
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
import { OverviewDashboard } from './components/OverviewDashboard.tsx';
import { ScenarioView } from './components/ScenarioView.tsx';
import { LlmAnalystDrawer } from './components/LlmAnalystDrawer.tsx';
import { SnapshotImportModal } from './components/SnapshotImportModal.tsx';

const INITIAL_ROWS = rawSalesData as SalesRecord[];
const DEFAULT_SOURCE = 'Nov 20, 2026 Midterm Snapshot';

export default function App() {
  const [salesRows, setSalesRows] = useState<SalesRecord[]>(INITIAL_ROWS);
  const [sourceLabel, setSourceLabel] = useState<string>(DEFAULT_SOURCE);
  const [activeTab, setActiveTab] = useState<ScenarioId>('overview');
  const [isDark, setIsDark] = useState<boolean>(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Overview filter state (lifted so LLM grounding always sees exact active slice)
  const [search, setSearch] = useState('');
  const [selectedSku, setSelectedSku] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [sortOrder, setSortOrder] = useState<OverviewSortOrder>('id-desc');
  const [overviewGroup, setOverviewGroup] = useState<'month' | 'week' | 'day'>('month');

  // Midterm comparison snapshot for Scenarios 01-04
  const [midtermSnapshot, setMidtermSnapshot] = useState<MidtermSnapshot | null>(null);

  // Modals & Drawers
  const [llmOpen, setLlmOpen] = useState(false);
  const [llmInitialTask, setLlmInitialTask] = useState<LlmAnalysisTask | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  const skuChoices = useMemo(
    () => [...new Set(salesRows.map(skuOf).filter(Boolean))].sort(),
    [salesRows]
  );

  const scenarioCounts = useMemo(
    () => ({
      overview: salesRows.length,
      '1': filterScenarioRows(salesRows, '1'),
      '2': filterScenarioRows(salesRows, '2'),
      '3': filterScenarioRows(salesRows, '3'),
      '4': filterScenarioRows(salesRows, '4'),
    }),
    [salesRows]
  );

  const overviewFilteredRows = useMemo(
    () =>
      filterAndSortOverview(salesRows, {
        search,
        sku: selectedSku,
        from: fromDate,
        to: toDate,
        sort: sortOrder,
      }),
    [salesRows, search, selectedSku, fromDate, toDate, sortOrder]
  );

  const overviewAnomalies = useMemo(
    () => detectSalesAnomalies(overviewFilteredRows),
    [overviewFilteredRows]
  );

  const llmContextPayload = useMemo(() => {
    if (activeTab === 'overview') {
      const parts: string[] = [];
      if (selectedSku) parts.push(`SKU=${selectedSku}`);
      if (fromDate || toDate) parts.push(`Dates=${fromDate || 'start'}..${toDate || 'end'}`);
      if (search.trim()) parts.push(`Query="${search.trim()}"`);

      return buildLlmContextPayload({
        viewId: 'overview',
        filteredRows: overviewFilteredRows,
        totalLoadedCount: salesRows.length,
        snapshotSource: sourceLabel,
        filterDescription: parts.length ? parts.join(' · ') : 'All loaded transactions (unfiltered)',
        anomalies: overviewAnomalies,
      });
    }

    const qRows = scenarioCounts[activeTab];
    const bucketsMap = groupSales(qRows, 'day');
    const sortedBuckets = [...bucketsMap.keys()]
      .sort()
      .map((k) => bucketsMap.get(k)!);
    const mlModel = computeIsolationForest(sortedBuckets, activeTab, 'trend', 'day');
    const qAnomalies = detectSalesAnomalies(qRows);

    return buildLlmContextPayload({
      viewId: activeTab,
      filteredRows: qRows,
      totalLoadedCount: salesRows.length,
      snapshotSource: sourceLabel,
      filterDescription: SCENARIO_META[activeTab].subtitle,
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
    salesRows.length,
    sourceLabel,
    overviewAnomalies,
    scenarioCounts,
  ]);

  const openGemini = (task: LlmAnalysisTask | null = null) => {
    setLlmInitialTask(task);
    setLlmOpen(true);
  };

  const handleSelectTab = (tab: ScenarioId) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  const navItems: Array<{ id: ScenarioId; count: number }> = [
    { id: 'overview', count: scenarioCounts.overview },
    { id: '1', count: scenarioCounts['1'].length },
    { id: '2', count: scenarioCounts['2'].length },
    { id: '3', count: scenarioCounts['3'].length },
    { id: '4', count: scenarioCounts['4'].length },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-[#0B111A] dark:text-slate-100">
      <div className="flex min-h-screen">
        {/* Desktop Sidebar */}
        <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex dark:border-slate-800 dark:bg-[#0D131D]">
          <div className="border-b border-slate-200 px-4 py-4 dark:border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-600 font-display text-sm font-extrabold text-white">
                U
              </div>
              <div className="min-w-0">
                <div className="truncate font-display text-sm font-bold text-slate-900 dark:text-white">
                  UNIQLO Analytics
                </div>
                <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  Sales &amp; Gemini AI
                </div>
              </div>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-3" aria-label="Sales analytics views">
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Analytical Views
            </div>
            {navItems.map(({ id, count }) => {
              const meta = SCENARIO_META[id];
              const isActive = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleSelectTab(id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-xs transition ${
                    isActive
                      ? 'bg-slate-900 font-semibold text-white dark:bg-lime-400/15 dark:text-lime-300 dark:ring-1 dark:ring-lime-400/35'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="font-mono text-[11px] opacity-70">{meta.code}</span>
                    <span className="truncate">{meta.shortTitle}</span>
                  </span>
                  <span className="font-mono text-[11px] tabular-nums opacity-75">
                    {formatNumber(count)}
                  </span>
                </button>
              );
            })}

            <div className="pt-4">
              <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Workspace Tools
              </div>
              <button
                type="button"
                onClick={() => openGemini('executive-briefing')}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-sky-700 transition hover:bg-sky-50 dark:text-lime-300 dark:hover:bg-lime-950/30"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Gemini AI Copilot</span>
              </button>
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
              >
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Import Snapshot</span>
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800/60"
              >
                <Printer className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Print Active Report</span>
              </button>
            </div>
          </nav>

          <div className="border-t border-slate-200 p-3 text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <div className="font-semibold text-slate-700 dark:text-slate-300">Active Dataset</div>
            <div className="mt-0.5 truncate">{sourceLabel}</div>
            <div className="mt-0.5 font-mono tabular-nums">
              {formatNumber(salesRows.length)} records loaded
            </div>
          </div>
        </aside>

        {/* Mobile Slide-Over Sidebar */}
        {mobileMenuOpen && (
          <div className="no-print fixed inset-0 z-40 flex lg:hidden">
            <div
              className="fixed inset-0 bg-slate-950/60"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative z-10 flex w-72 max-w-[85vw] flex-col border-r border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#0D131D]">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3 dark:border-slate-800">
                <div className="flex items-center gap-2 font-display text-sm font-bold">
                  <BarChart3 className="h-4 w-4 text-red-600" />
                  <span>UNIQLO Analytics</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-1">
                {navItems.map(({ id, count }) => {
                  const meta = SCENARIO_META[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSelectTab(id)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-xs ${
                        activeTab === id
                          ? 'bg-slate-900 font-semibold text-white dark:bg-lime-400/15 dark:text-lime-300'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span>
                        {meta.code} · {meta.shortTitle}
                      </span>
                      <span className="font-mono tabular-nums">{formatNumber(count)}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setImportModalOpen(true);
                  }}
                  className="mt-3 flex w-full items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium dark:border-slate-700"
                >
                  <Database className="h-3.5 w-3.5" />
                  <span>Import Snapshot</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Bar Contract: Breadcrumb Left + Max 2 Primary Actions Right */}
          <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-xs sm:px-6 dark:border-slate-800 dark:bg-[#0D131D]/95">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                className="rounded-md border border-slate-300 p-1.5 text-slate-700 lg:hidden dark:border-slate-700 dark:text-slate-200"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
                  <span>UNIQLO Sales</span>
                  <span>/</span>
                  <span className="font-semibold text-slate-900 dark:text-white">
                    {SCENARIO_META[activeTab].shortTitle}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => openGemini(null)}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-lime-400 dark:text-slate-950 dark:hover:bg-lime-300"
              >
                <Sparkles className="h-3.5 w-3.5 shrink-0" />
                <span>Ask Gemini AI</span>
              </button>

              <button
                type="button"
                onClick={() => setIsDark((d) => !d)}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111824] dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>
              </button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-[1380px] flex-1 p-4 sm:p-6">
            {activeTab === 'overview' ? (
              <OverviewDashboard
                allRows={salesRows}
                filteredRows={overviewFilteredRows}
                anomalies={overviewAnomalies}
                skuChoices={skuChoices}
                search={search}
                selectedSku={selectedSku}
                fromDate={fromDate}
                toDate={toDate}
                sortOrder={sortOrder}
                grouping={overviewGroup}
                isDark={isDark}
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
              <ScenarioView
                questionId={activeTab as FocusedQuestionId}
                scenarioRows={scenarioCounts[activeTab]}
                midtermSnapshot={midtermSnapshot}
                isDark={isDark}
                onMidtermLoaded={(snap) => setMidtermSnapshot(snap)}
                onAskGeminiScenario={() => openGemini('scenario-deep-dive')}
              />
            )}
          </main>
        </div>
      </div>

      <LlmAnalystDrawer
        isOpen={llmOpen}
        initialTask={llmInitialTask}
        contextPayload={llmContextPayload}
        onClose={() => setLlmOpen(false)}
      />

      <SnapshotImportModal
        isOpen={importModalOpen}
        currentSourceLabel={sourceLabel}
        currentCount={salesRows.length}
        onClose={() => setImportModalOpen(false)}
        onImportRows={(rows, fileName) => {
          setSalesRows(rows);
          setSourceLabel(fileName);
        }}
        onResetDefault={() => {
          setSalesRows(INITIAL_ROWS);
          setSourceLabel(DEFAULT_SOURCE);
        }}
      />
    </div>
  );
}
