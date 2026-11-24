import { useEffect, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  LlmAnalysisResult,
  LlmAnalysisTask,
  LlmChatMessage,
  LlmContextPayload,
} from '../types/sales.ts';
import { formatMoney, formatNumber } from '../utils/salesAnalytics.ts';

interface LlmAnalystDrawerProps {
  isOpen: boolean;
  initialTask: LlmAnalysisTask | null;
  contextPayload: LlmContextPayload;
  onClose: () => void;
}

const SUGGESTED_QUESTIONS = [
  'Which SKUs and stores drive the highest net revenue in the current filter?',
  'Which flagged anomalies look like data-quality issues vs high-volume orders?',
  'Compare performance across promotion codes in this view.',
  'What operational actions should a store manager take next based on these numbers?',
];

export function LlmAnalystDrawer({
  isOpen,
  initialTask,
  contextPayload,
  onClose,
}: LlmAnalystDrawerProps) {
  const [activeTab, setActiveTab] = useState<'copilot' | 'architecture'>('copilot');
  const [briefing, setBriefing] = useState<LlmAnalysisResult | null>(null);
  const [briefingTask, setBriefingTask] = useState<LlmAnalysisTask>('executive-briefing');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const [messages, setMessages] = useState<LlmChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [health, setHealth] = useState<{ model: string; keyConfigured: boolean } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setHealth({ model: data.model, keyConfigured: Boolean(data.keyConfigured) });
      })
      .catch(() => {});
  }, [isOpen]);

  const runAnalysis = async (task: LlmAnalysisTask) => {
    setBriefingTask(task);
    setAnalyzing(true);
    setAnalyzeError(null);

    try {
      const res = await fetch('/api/llm/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, context: contextPayload }),
      });
      const data = (await res.json()) as Partial<LlmAnalysisResult> & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Server responded with status ${res.status}`);
      }
      setBriefing(data as LlmAnalysisResult);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : 'Unable to reach Gemini analysis API.');
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (isOpen && initialTask) {
      setActiveTab('copilot');
      runAnalysis(initialTask);
    }
    // Only auto-trigger when drawer opens with a specific requested task
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialTask]);

  const sendChatQuestion = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || streaming) return;

    const now = new Date().toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    const priorHistory = messages;
    const userMsg: LlmChatMessage = { role: 'user', content: trimmed, timestamp: now };
    const placeholderAssistant: LlmChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: now,
    };

    setMessages([...priorHistory, userMsg, placeholderAssistant]);
    setInput('');
    setStreaming(true);
    setChatError(null);

    try {
      const res = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmed,
          history: priorHistory.map((m) => ({ role: m.role, content: m.content })),
          context: contextPayload,
        }),
      });

      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `Chat request failed with status ${res.status}`);
      }

      if (!res.body) {
        throw new Error('Streaming response body unavailable.');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const clean = line.trim();
          if (!clean.startsWith('data:')) continue;
          const payload = clean.slice(5).trim();
          if (payload === '[DONE]') continue;

          const parsed = JSON.parse(payload) as { delta?: string; error?: string };
          if (parsed.error) {
            throw new Error(parsed.error);
          }
          if (parsed.delta) {
            accumulated += parsed.delta;
            setMessages((prev) => {
              const copy = [...prev];
              const lastIdx = copy.length - 1;
              if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
                copy[lastIdx] = { ...copy[lastIdx], content: accumulated };
              }
              return copy;
            });
          }
        }
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : 'Unable to complete Gemini chat request.');
      setMessages((prev) => prev.filter((m) => m.content.trim().length > 0));
    } finally {
      setStreaming(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/75"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gemini-drawer-title"
    >
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#0D131D]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-sky-600 dark:text-lime-300">
              <Sparkles className="h-3.5 w-3.5" />
              <span>Gemini AI Sales Analyst · {health?.model || 'gemini-4-hydrogen'}</span>
            </div>
            <h2 id="gemini-drawer-title" className="mt-1 text-lg font-bold text-slate-900 dark:text-white">
              Grounded Retail Intelligence
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Gemini AI panel"
            className="rounded-md border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs inside drawer */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-5 py-2.5 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('copilot')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'copilot'
                  ? 'bg-slate-900 text-white dark:bg-lime-400 dark:text-slate-950'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111824] dark:text-slate-300'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Briefings &amp; Q&amp;A</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('architecture')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === 'architecture'
                  ? 'bg-slate-900 text-white dark:bg-lime-400 dark:text-slate-950'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111824] dark:text-slate-300'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>How LLM Is Integrated</span>
            </button>
          </div>

          <div className="text-[11px] font-medium">
            {health ? (
              health.keyConfigured ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Server Key Active</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-3.5 w-3.5" />
                  <span>Set GEMINI_API_KEY in Secrets</span>
                </span>
              )
            ) : null}
          </div>
        </div>

        {/* Grounded Context Banner */}
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-xs dark:border-slate-800 dark:bg-[#111824]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Active Grounding Scope: {contextPayload.viewLabel}
            </span>
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
              {formatNumber(contextPayload.kpis.recordCount)} rows ·{' '}
              {formatMoney(contextPayload.kpis.totalNetSales)} ·{' '}
              {formatNumber(contextPayload.anomalySummary.totalFlags)} IQR flags
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
            Filters: {contextPayload.filterDescription}
          </p>
        </div>

        {activeTab === 'copilot' ? (
          <>
            {/* Scrollable Body */}
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
              {/* Structured Briefing Controls */}
              <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Structured Gemini Briefings
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        ['executive-briefing', 'Executive Briefing'],
                        ['anomaly-explanation', 'Explain Anomalies'],
                        ['scenario-deep-dive', 'Deep Dive'],
                      ] as const
                    ).map(([taskId, label]) => (
                      <button
                        key={taskId}
                        type="button"
                        disabled={analyzing}
                        onClick={() => runAnalysis(taskId)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50 ${
                          briefingTask === taskId && briefing
                            ? 'border-sky-500 bg-sky-50 text-sky-800 dark:border-lime-400/50 dark:bg-lime-950/30 dark:text-lime-300'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {analyzing && (
                  <div className="mt-4 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                    <Loader2 className="h-4 w-4 animate-spin text-sky-500" />
                    <span>Synthesizing grounded metrics with Gemini ({health?.model || 'gemini-4-hydrogen'})...</span>
                  </div>
                )}

                {analyzeError && (
                  <div
                    role="alert"
                    className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {analyzeError}
                  </div>
                )}

                {briefing && !analyzing && (
                  <div className="mt-4 space-y-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
                    <div className="text-sm font-bold text-slate-900 dark:text-lime-300">
                      {briefing.headline}
                    </div>
                    <p className="leading-relaxed text-slate-700 dark:text-slate-200">
                      {briefing.executiveSummary}
                    </p>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#0D131D]">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Key Revenue Drivers
                        </div>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700 dark:text-slate-300">
                          {briefing.keyDrivers.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#0D131D]">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Anomaly &amp; Quality Audit
                        </div>
                        <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700 dark:text-slate-300">
                          {briefing.anomalyAssessment.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-[#0D131D]">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Recommended Actions
                      </div>
                      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-slate-700 dark:text-slate-300">
                        {briefing.recommendedActions.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    </div>

                    <p className="text-[11px] italic text-slate-500 dark:text-slate-400">
                      {briefing.dataCaveat}
                    </p>
                  </div>
                )}
              </div>

              {/* Interactive Chat Thread */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Ask Questions About Filtered Sales
                  </h3>
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMessages([])}
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Clear chat</span>
                    </button>
                  )}
                </div>

                {messages.length === 0 && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => sendChatQuestion(q)}
                        className="rounded-md border border-slate-200 bg-white p-3 text-left text-xs leading-relaxed text-slate-700 transition hover:border-sky-400 hover:bg-slate-50 dark:border-slate-800 dark:bg-[#111824] dark:text-slate-300 dark:hover:border-lime-400/50"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`rounded-lg border p-3.5 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'ml-8 border-sky-200 bg-sky-50 text-slate-900 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-slate-100'
                        : 'mr-4 border-slate-200 bg-white text-slate-800 dark:border-slate-800 dark:bg-[#111824] dark:text-slate-200'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      <span>{msg.role === 'user' ? 'You' : 'Gemini Analyst'}</span>
                      <span className="font-mono">{msg.timestamp}</span>
                    </div>
                    <div className="whitespace-pre-wrap">
                      {msg.content || (streaming && msg.role === 'assistant' ? 'Thinking...' : '')}
                    </div>
                  </div>
                ))}

                {chatError && (
                  <div
                    role="alert"
                    className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-800/60 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {chatError}
                  </div>
                )}
              </div>
            </div>

            {/* Chat Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendChatQuestion(input);
              }}
              className="border-t border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  disabled={streaming}
                  placeholder="Ask about SKUs, stores, promos, or anomalies..."
                  aria-label="Ask Gemini about sales data"
                  className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none dark:border-slate-700 dark:bg-[#0D131D] dark:text-slate-100"
                />
                <button
                  type="submit"
                  disabled={streaming || !input.trim()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-800 disabled:opacity-45 dark:bg-lime-400 dark:text-slate-950 dark:hover:bg-lime-300"
                >
                  {streaming ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  <span>Send</span>
                </button>
              </div>
            </form>
          </>
        ) : (
          /* Integration Blueprint Tab */
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                How the LLM Was Added to UNIQLO Sales Management
              </h3>
              <p className="mt-1.5">
                Your original offline HTML dashboard ran client-side Isolation Forest scoring and Tukey IQR checks. Upgrading it to a real LLM system adds a 3-stage pipeline while keeping secrets strictly off the browser:
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                1. Grounded Context Aggregation (Frontend)
              </div>
              <p className="mt-1">
                Sending all 1,500 raw JSON rows on every prompt wastes tokens and obscures patterns.{' '}
                <code className="font-mono text-slate-900 dark:text-lime-300">
                  buildLlmContextPayload()
                </code>{' '}
                compiles the active view’s KPIs, top 12 SKUs, store &amp; promo totals, monthly buckets, IQR flags, and Isolation Forest outliers into a compact ~4 KB JSON payload.
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                2. Secure Express Proxy (/api/llm/*)
              </div>
              <p className="mt-1">
                An Express server reads{' '}
                <code className="font-mono text-slate-900 dark:text-lime-300">
                  process.env.GEMINI_API_KEY
                </code>{' '}
                exclusively on the backend. Browser clients never touch credentials and only call{' '}
                <code className="font-mono">POST /api/llm/analyze</code> (structured JSON schema) and{' '}
                <code className="font-mono">POST /api/llm/chat</code> (SSE streaming).
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-[#111824]">
              <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-sky-600 dark:text-sky-400">
                3. @google/genai SDK (gemini-4-hydrogen)
              </div>
              <p className="mt-1">
                The backend initializes{' '}
                <code className="font-mono">new GoogleGenAI({'{ apiKey }'})</code>, enforces strict grounding &amp; simulated-date caveats via{' '}
                <code className="font-mono">systemInstruction</code>, and returns either schema-validated JSON briefings or live streamed answers.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
