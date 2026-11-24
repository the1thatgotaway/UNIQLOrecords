import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Sparkles } from 'lucide-react';
import type { AnomalyFlag } from '../types/sales.ts';
import { formatNumber } from '../utils/salesAnalytics.ts';
import { buildCsvDocument } from '../utils/snapshotParser.ts';

interface AnomalyDetectorPanelProps {
  anomalies: AnomalyFlag[];
  filteredRowCount: number;
  onAskGeminiAnomalies: () => void;
}

const ANOMALY_PAGE_SIZE = 12;

export function AnomalyDetectorPanel({
  anomalies,
  filteredRowCount,
  onAskGeminiAnomalies,
}: AnomalyDetectorPanelProps) {
  const [selectedType, setSelectedType] = useState<string>('all');
  const [page, setPage] = useState<number>(1);

  const visibleFlags = useMemo(() => {
    if (selectedType === 'all') return anomalies;
    return anomalies.filter((flag) => flag.type === selectedType);
  }, [anomalies, selectedType]);

  const highCount = useMemo(
    () => anomalies.filter((a) => a.severity === 'High').length,
    [anomalies]
  );

  const totalPages = Math.max(1, Math.ceil(visibleFlags.length / ANOMALY_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * ANOMALY_PAGE_SIZE;
  const pageItems = visibleFlags.slice(start, start + ANOMALY_PAGE_SIZE);

  const handleExport = () => {
    if (!visibleFlags.length) return;
    const headers = ['Severity', 'Sale / Period', 'Date', 'Product SKU', 'Anomaly Type', 'Explanation'];
    const rows = visibleFlags.map((a) => [a.severity, a.id, a.date, a.sku, a.type, a.reason]);
    const csv = buildCsvDocument(headers, rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'uniqlo-sales-anomaly-flags.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-[#111824]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>Statistical Audit &amp; Data Quality</span>
          </div>
          <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
            Data Quality &amp; Statistical Alerts
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {anomalies.length > 0
              ? `${formatNumber(anomalies.length)} potential flags across ${formatNumber(filteredRowCount)} filtered sales, including ${formatNumber(highCount)} data-integrity warnings.`
              : `No statistical outliers or invalid values detected among ${formatNumber(filteredRowCount)} filtered sales.`}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2 text-right dark:border-slate-700 dark:bg-[#0D131D]">
            <div className="font-mono text-xl font-bold tabular-nums text-slate-900 dark:text-lime-300">
              {formatNumber(anomalies.length)}
            </div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Total Flags
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400">
            <span>Filter type</span>
            <select
              value={selectedType}
              onChange={(e) => {
                setSelectedType(e.target.value);
                setPage(1);
              }}
              aria-label="Filter anomaly type"
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
            >
              <option value="all">All anomaly checks</option>
              <option value="Date issue">Date issues</option>
              <option value="Invalid value">Invalid values</option>
              <option value="High sale value">High sale value (IQR)</option>
              <option value="Unusual quantity">Unusual quantity (IQR)</option>
              <option value="Monthly sales spike">Monthly sales spike</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onAskGeminiAnomalies}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-sky-600/30 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 dark:border-sky-400/30 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/50"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0" />
            <span>Explain with Gemini AI</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={visibleFlags.length === 0}
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span>Export Flags CSV</span>
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:bg-[#0D131D] dark:text-slate-400">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="px-3 py-2.5">Severity</th>
              <th className="px-3 py-2.5">Sale / Period</th>
              <th className="px-3 py-2.5">Date</th>
              <th className="px-3 py-2.5">SKU</th>
              <th className="px-3 py-2.5">Check Type</th>
              <th className="px-3 py-2.5">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80">
            {pageItems.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-sm text-slate-500 dark:text-slate-400"
                >
                  {anomalies.length > 0
                    ? 'No flags in the selected category.'
                    : 'No unusual records detected by these checks in the current filter.'}
                </td>
              </tr>
            ) : (
              pageItems.map((flag, idx) => (
                <tr
                  key={`${flag.id}-${flag.type}-${idx}`}
                  className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/35"
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${
                        flag.severity === 'High'
                          ? 'border border-red-300 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-300'
                          : 'border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300'
                      }`}
                    >
                      {flag.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {flag.id}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                    {flag.date}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                    {flag.sku}
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">
                    {flag.type}
                  </td>
                  <td className="min-w-[280px] px-3 py-2 leading-relaxed text-slate-600 dark:text-slate-300">
                    {flag.reason}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span className="font-mono tabular-nums">
          {visibleFlags.length > 0
            ? `Showing ${start + 1}–${Math.min(start + ANOMALY_PAGE_SIZE, visibleFlags.length)} of ${visibleFlags.length} flags · Page ${safePage} of ${totalPages}`
            : 'No matching flags'}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200"
          >
            Next
          </button>
        </div>
      </div>

      <p className="mt-3 border-t border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Tukey IQR fences (Q3 + 1.5 × IQR) evaluate net sales and unit quantity per SKU alongside date integrity validation. Flags are statistical indicators requiring receipt audit rather than confirmed errors.
      </p>
    </section>
  );
}
