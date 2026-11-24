import { useState } from 'react';
import { Check, Copy, Database, Upload, X } from 'lucide-react';
import type { SalesRecord } from '../types/sales.ts';
import { parseImportedSnapshot, SUPABASE_SNAPSHOT_SQL } from '../utils/snapshotParser.ts';

interface SnapshotImportModalProps {
  isOpen: boolean;
  currentSourceLabel: string;
  currentCount: number;
  onClose: () => void;
  onImportRows: (rows: SalesRecord[], sourceName: string) => void;
  onResetDefault: () => void;
}

export function SnapshotImportModal({
  isOpen,
  currentSourceLabel,
  currentCount,
  onClose,
  onImportRows,
  onResetDefault,
}: SnapshotImportModalProps) {
  const [copied, setCopied] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  );

  if (!isOpen) return null;

  const handleCopySql = async () => {
    try {
      await navigator.clipboard.writeText(SUPABASE_SNAPSHOT_SQL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setStatusMessage({ kind: 'error', text: 'Clipboard access unavailable in this browser context.' });
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const raw = await file.text();
      const parsed = parseImportedSnapshot(raw);
      onImportRows(parsed.rows, file.name);
      setStatusMessage({
        kind: 'success',
        text: `${parsed.count.toLocaleString('en-PH')} records loaded from ${file.name}.`,
      });
    } catch (err) {
      setStatusMessage({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Unable to read snapshot file.',
      });
    } finally {
      event.target.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="snapshot-modal-title"
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-[#111824]">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-sky-400">
              <Database className="h-3.5 w-3.5" />
              <span>Dataset Snapshot Loader</span>
            </div>
            <h2 id="snapshot-modal-title" className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              Load Snapshot from Supabase Export
            </h2>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              Active source: <strong className="text-slate-900 dark:text-slate-200">{currentSourceLabel}</strong> ({currentCount.toLocaleString('en-PH')} records)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Run the SQL query below in the Supabase SQL Editor, export the single JSON/CSV result, and select it below to refresh all 5 dashboard views and LLM context.
          </p>

          <div className="rounded-md border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-[#0B111A]">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="font-mono text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                SQL Snapshot Export Query
              </span>
              <button
                type="button"
                onClick={handleCopySql}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? 'Copied' : 'Copy SQL'}</span>
              </button>
            </div>
            <pre className="max-h-48 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
              {SUPABASE_SNAPSHOT_SQL}
            </pre>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-[#0D131D]">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 dark:bg-lime-400 dark:text-slate-950 dark:hover:bg-lime-300">
              <Upload className="h-3.5 w-3.5" />
              <span>Choose CSV or JSON Snapshot</span>
              <input
                type="file"
                accept=".csv,.json"
                onChange={handleFileChange}
                className="sr-only"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                onResetDefault();
                setStatusMessage({ kind: 'success', text: 'Restored bundled 1,500-row Midterm snapshot.' });
              }}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              Restore Bundled Snapshot
            </button>
          </div>

          {statusMessage && (
            <div
              role="status"
              className={`rounded-md border px-3 py-2 text-xs font-medium ${
                statusMessage.kind === 'error'
                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              }`}
            >
              {statusMessage.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
