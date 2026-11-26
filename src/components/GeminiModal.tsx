import { ArrowUp, Maximize2, MessageCircle, Minimize2, Minus, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LlmAnalysisResult,
  LlmAnalysisTask,
  LlmChatMessage,
  LlmContextPayload,
} from '../types/sales.ts';
import type { SalesFilters, SalesLookupResult } from '../types/salesLookup.ts';
import { SalesLookupTable } from './SalesLookupTable.tsx';
import { answerFromDashboard } from '../utils/dashboardAnswers.ts';
import { buildDashboardBriefing } from '../utils/dashboardBriefing.ts';
import {
  clearPersistedChatHistory,
  loadPersistedChatHistory,
  savePersistedChatHistory,
} from '../utils/chatStorage.ts';
import { formatMoney, formatNumber } from '../utils/salesAnalytics.ts';

interface GeminiModalProps {
  isOpen: boolean;
  initialTask: LlmAnalysisTask | null;
  triggerNonce: number;
  contextPayload: LlmContextPayload;
  onOpen: () => void;
  onClose: () => void;
}

type CopilotMode = 'chat' | 'briefing';

const SUGGESTED_QUESTIONS = [
  'How do I use this system?',
  'What does the Overview Dashboard show?',
  'How does Isolation Forest work?',
  'How do I import sales records?',
  'What are the highest-performing products?',
  'Explain the current sales anomalies.',
];

async function fetchSalesLookup(body: object): Promise<SalesLookupResult | null> {
  const response = await fetch('/api/sales-assistant/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Sales lookup failed.');
  return data as SalesLookupResult;
}

export function GeminiModal({
  isOpen,
  initialTask,
  triggerNonce,
  contextPayload,
  onOpen,
  onClose,
}: GeminiModalProps) {
  const [mode, setMode] = useState<CopilotMode>('chat');
  const [analysis, setAnalysis] = useState<LlmAnalysisResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [activeTask, setActiveTask] = useState<LlmAnalysisTask | null>(null);
  const [messages, setMessages] = useState<LlmChatMessage[]>(() => loadPersistedChatHistory());
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [checkingSales, setCheckingSales] = useState(false);
  const [lookup, setLookup] = useState<SalesLookupResult | null>(null);
  const [pagingLookup, setPagingLookup] = useState(false);
  const lastFilters = useRef<SalesFilters | undefined>(undefined);
  const [error, setError] = useState('');
  const [minimized, setMinimized] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState<boolean | null>(null);
  const [wide, setWide] = useState(false);
  const showSuggestions = suggestionsExpanded ?? messages.length === 0;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const analysisPending = useRef(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior, block: 'end' });
    } else if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior,
      });
    }
  }, []);

  const handleBodyScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= 100;
  };

  useEffect(() => {
    savePersistedChatHistory(messages);
  }, [messages]);

  const runAnalysis = async (task: LlmAnalysisTask) => {
    if (analysisPending.current) return;
    analysisPending.current = true;
    setAnalyzing(true);
    setAnalysis(null);
    setActiveTask(task);
    setMode('briefing');
    setError('');
    shouldAutoScrollRef.current = true;
    try {
      const res = await fetch('/api/llm/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, context: {
          ...contextPayload,
          sampleRecords: [],
          anomalySummary: {
            ...contextPayload.anomalySummary,
            topFlags: contextPayload.anomalySummary.topFlags.slice(0, 5),
          },
          mlGraphFlags: contextPayload.mlGraphFlags.slice(0, 5),
        } }),
      });
      const data = (await res.json()) as LlmAnalysisResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setAnalysis(data);
    } catch {
      setAnalysis(buildDashboardBriefing(task, contextPayload));
    } finally {
      analysisPending.current = false;
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setMinimized(false);
    shouldAutoScrollRef.current = true;
    if (initialTask) {
      setMode('briefing');
      void runAnalysis(initialTask);
    } else {
      setMode('chat');
      setTimeout(() => {
        inputRef.current?.focus();
        scrollToBottom('auto');
      }, 40);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, triggerNonce]);

  useEffect(() => {
    if (!isOpen || minimized || !shouldAutoScrollRef.current) return;
    scrollToBottom(streaming ? 'auto' : 'smooth');
  }, [messages, analysis, streaming, analyzing, mode, isOpen, minimized, scrollToBottom]);

  useEffect(() => {
    if (!isOpen || minimized) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [isOpen, minimized]);

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || streaming) return;

    setMode('chat');
    setLookup(null);
    setError('');
    setInput('');
    shouldAutoScrollRef.current = true;
    const historyPayload = messages.slice(-4).map((m) => ({
      role: m.role,
      content: m.content.slice(0, 1000),
    }));
    const nowTime = new Date().toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const userMsg: LlmChatMessage = {
      role: 'user',
      content: question,
      timestamp: nowTime,
    };
    const dashboardAnswer = answerFromDashboard(question, contextPayload);
    if (dashboardAnswer) {
      setMessages(prev => [...prev, userMsg, {
        role: 'assistant', content: dashboardAnswer, timestamp: nowTime,
      }]);
      return;
    }
    const assistantMsg: LlmChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: nowTime,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);
    setCheckingSales(true);

    try {
      const result = await fetchSalesLookup({ question, previousFilters: lastFilters.current });
      setCheckingSales(false);
      if (result) {
        lastFilters.current = result.filters;
        setLookup(result);
        const summary = result.count
          ? `Found ${formatNumber(result.count)} matching sales in live Supabase.`
          : 'No matching sales were found in live Supabase.';
        setMessages(prev => [...prev.slice(0, -1), {
          ...assistantMsg,
          content: `${summary}\nFilters: ${result.explanation}`,
        }]);
        return;
      }
      const res = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: historyPayload,
          context: contextPayload,
        }),
      });

      if (!res.ok || !res.body) {
        const bodyErr = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          bodyErr.error ||
            `Groq chat returned status ${res.status}. Please check server settings or retry.`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const chunk of events) {
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6).trim();
            if (payload === '[DONE]') continue;
            const parsed = JSON.parse(payload) as { delta?: string; error?: string };
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.delta) {
              accumulated += parsed.delta;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: accumulated,
                    timestamp: new Date().toLocaleTimeString('en-PH', {
                      hour: 'numeric',
                      minute: '2-digit',
                    }),
                  };
                }
                return updated;
              });
            }
          }
        }
      }

      if (!accumulated.trim()) {
        throw new Error('Groq returned an empty response. Please try asking again.');
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to reach Groq chat right now. Verify your connection or try again.'
      );
      setMessages((prev) => prev.filter((_, idx) => idx !== prev.length - 1 || prev[idx].content));
    } finally {
      setCheckingSales(false);
      setStreaming(false);
    }
  };

  const showLookupPage = async (offset: number) => {
    if (!lookup || pagingLookup) return;
    const current = lookup;
    setPagingLookup(true);
    setError('');
    try {
      const page = await fetchSalesLookup({ filters: current.filters, offset });
      if (page) setLookup(latest => latest === current ? page : latest);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load the requested page.');
    } finally {
      setPagingLookup(false);
    }
  };

  const handleClearChat = () => {
    lastFilters.current = undefined;
    setLookup(null);
    if (streaming) return;
    setMessages([]);
    clearPersistedChatHistory();
    setError('');
    setSuggestionsExpanded(true);
    shouldAutoScrollRef.current = true;
  };

  const handleMinimize = () => {
    setMinimized(true);
    onClose();
  };

  const handleClose = () => {
    setMinimized(false);
    onClose();
  };

  const handleLauncherClick = () => {
    setMinimized(false);
    shouldAutoScrollRef.current = true;
    onOpen();
  };

  const showFloatingLauncher = !isOpen || minimized;
  const userTurnCount = messages.filter((m) => m.role === 'user').length;

  return (
    <>
      {showFloatingLauncher && (
        <button
          id="chatbotLauncher"
          type="button"
          className="chatbot-launcher"
          onClick={handleLauncherClick}
          aria-label={
            userTurnCount > 0
              ? `Open Scout (${userTurnCount} saved questions)`
              : 'Open Scout'
          }
        >
          <MessageCircle size={22} strokeWidth={1.6} aria-hidden="true" />
        </button>
      )}

      {isOpen && !minimized && (
        <dialog
          ref={dialogRef}
          className={`chatbot-panel${wide ? ' chatbot-panel-wide' : ''}`}
          onCancel={(event) => {
            event.preventDefault();
            handleClose();
          }}
          aria-labelledby="llmModalTitle"
        >
          <div className="llm-modal-header">
            <span className="llm-header-mark" aria-hidden="true"><MessageCircle size={20} strokeWidth={1.6} /></span>
            <div className="llm-header-copy">
              <h2 id="llmModalTitle">Scout</h2>
              <p className="llm-scope-line">
                {contextPayload.viewLabel} ·{' '}
                {contextPayload.isFiltered
                  ? `${formatNumber(contextPayload.kpis.recordCount)} of ${formatNumber(
                      contextPayload.overallSummary.totalLoadedCount
                    )} records`
                  : `${formatNumber(contextPayload.kpis.recordCount)} records`}{' '}
                · {formatMoney(contextPayload.kpis.totalNetSales)}
              </p>
            </div>

            <div className="llm-header-controls">
              <button
                type="button"
                id="chatbotClearBtn"
                className="llm-icon-btn"
                onClick={handleClearChat}
                disabled={streaming || messages.length === 0}
                title="Clear saved conversation"
                aria-label="Clear saved conversation"
              >
                <RotateCcw size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="llm-icon-btn llm-width-btn"
                onClick={() => setWide((expanded) => !expanded)}
                title={wide ? 'Restore panel width' : 'Expand panel for sales tables'}
                aria-label={wide ? 'Restore panel width' : 'Expand panel for sales tables'}
              >
                {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
              <button
                type="button"
                id="chatbotMinimizeBtn"
                className="llm-icon-btn"
                onClick={handleMinimize}
                title="Minimize chat"
                aria-label="Minimize Scout"
              >
                <Minus size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                id="chatbotCloseBtn"
                className="llm-icon-btn"
                onClick={handleClose}
                title="Close chat"
                aria-label="Close Scout"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="chatbot-mode-bar" role="tablist" aria-label="Scout Modes">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'chat'}
              className={`chatbot-mode-tab${mode === 'chat' ? ' active' : ''}`}
              onClick={() => {
                shouldAutoScrollRef.current = true;
                setMode('chat');
              }}
            >
              Chat
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'briefing'}
              className={`chatbot-mode-tab${mode === 'briefing' ? ' active' : ''}`}
              onClick={() => {
                shouldAutoScrollRef.current = true;
                setMode('briefing');
              }}
            >
              Briefings
            </button>
            <button
              type="button"
              className="chatbot-mode-action"
              disabled={analyzing}
              onClick={() => void runAnalysis('executive-briefing')}
            >
              {analyzing ? 'Analyzing…' : '✦ Quick Briefing'}
            </button>
          </div>

          <div className="llm-modal-body" ref={scrollRef} onScroll={handleBodyScroll}>
            {mode === 'briefing' ? (
              <>
                <div className="llm-task-bar">
                  <button
                    type="button"
                    className={`action-btn${activeTask === 'executive-briefing' ? ' primary' : ''}`}
                    disabled={analyzing}
                    onClick={() => runAnalysis('executive-briefing')}
                  >
                    {analyzing && activeTask === 'executive-briefing'
                      ? 'Analyzing…'
                      : '✦ Executive Briefing'}
                  </button>
                  <button
                    type="button"
                    className={`action-btn${activeTask === 'anomaly-explanation' ? ' primary' : ''}`}
                    disabled={analyzing}
                    onClick={() => runAnalysis('anomaly-explanation')}
                  >
                    {analyzing && activeTask === 'anomaly-explanation'
                      ? 'Analyzing…'
                      : '✦ Explain Anomalies & ML'}
                  </button>
                  <button
                    type="button"
                    className={`action-btn${activeTask === 'scenario-deep-dive' ? ' primary' : ''}`}
                    disabled={analyzing}
                    onClick={() => runAnalysis('scenario-deep-dive')}
                  >
                    {analyzing && activeTask === 'scenario-deep-dive'
                      ? 'Analyzing…'
                      : '✦ Deep-Dive Slice'}
                  </button>
                </div>

                {analyzing ? (
                  <div className="llm-msg assistant" aria-live="polite">
                    <div className="llm-msg-role">STRUCTURED BRIEFINGS</div>
                    <div className="chatbot-typing" aria-label="Generating briefing">
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-dot" />
                      <span className="typing-label">Synthesizing dashboard insights…</span>
                    </div>
                  </div>
                ) : analysis ? (
                  <div className="llm-section-card">
                    <div className="explanation-kicker">{analysis.model === 'Dashboard data'
                      ? 'DASHBOARD BRIEFING'
                      : `GROQ BRIEFING · ${analysis.model}`}</div>
                    <h3>{analysis.headline}</h3>
                    <div className="ai-narrative">{analysis.executiveSummary}</div>

                    {analysis.keyDrivers?.length > 0 && (
                      <div className="ai-finding llm-finding-spaced">
                        <b>Key Revenue &amp; Operational Drivers</b>
                        <ul className="llm-bullets">
                          {analysis.keyDrivers.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.anomalyAssessment?.length > 0 && (
                      <div className="ai-finding llm-finding-spaced">
                        <b>Anomaly &amp; ML Assessment</b>
                        <ul className="llm-bullets">
                          {analysis.anomalyAssessment.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.recommendedActions?.length > 0 && (
                      <div className="ai-finding llm-finding-spaced">
                        <b>Recommended Audit &amp; Merchandising Actions</b>
                        <ul className="llm-bullets">
                          {analysis.recommendedActions.map((item, i) => (
                            <li key={i}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {analysis.dataCaveat && <div className="ai-caveat">{analysis.dataCaveat}</div>}
                  </div>
                ) : (
                  <div className="llm-welcome-card">
                    <div className="llm-msg-role">STRUCTURED BRIEFINGS</div>
                    <p>
                      Select one of the structured briefing actions above to generate a
                      schema-verified executive synthesis for{' '}
                      <strong>{contextPayload.viewLabel}</strong> ({contextPayload.filterDescription}
                      ).
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                {messages.length === 0 && (
                  <div className="llm-welcome-card llm-chat-welcome">
                    <h3>What would you like to find?</h3>
                    <p>Find sales records or ask about trends, dashboard views, and anomalies in English, Filipino, or Taglish.</p>
                  </div>
                )}

                <div className="llm-suggestions-wrap">
                  <div className="llm-suggestions-head">
                    <span>Suggested questions</span>
                    <button
                      type="button"
                      className="llm-text-toggle"
                      aria-expanded={showSuggestions}
                      onClick={() => setSuggestionsExpanded(!showSuggestions)}
                    >
                      {showSuggestions ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {showSuggestions && (
                    <div className="llm-chips">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          className="llm-chip"
                          disabled={streaming}
                          onClick={() => sendQuestion(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="llm-chat-list" aria-live="polite">
                  {messages.map((msg, i) => {
                    const isTyping =
                      streaming && msg.role === 'assistant' && i === messages.length - 1 && !msg.content;
                    return (
                      <div key={i} className={`llm-msg ${msg.role}`}>
                        <div className="llm-msg-role">
                          {msg.role === 'user' ? 'You' : 'Scout'}
                          {msg.timestamp ? ` · ${msg.timestamp}` : ''}
                        </div>
                        {isTyping ? (
                          <div className="chatbot-typing" aria-label="Scout is typing">
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-label">{checkingSales ? 'Checking live sales…' : 'Thinking…'}</span>
                          </div>
                        ) : (
                          <div className="llm-msg-body">
                            {msg.content
                              .replace(/`([^`]+)`/g, '$1')
                              .split(/(\*\*[^*]+\*\*)/g)
                              .map((part, idx) =>
                                part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
                                  <strong key={idx}>{part.slice(2, -2)}</strong>
                                ) : (
                                  <span key={idx}>{part}</span>
                                )
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {lookup && <SalesLookupTable result={lookup} loading={pagingLookup} onPage={showLookupPage} />}
              </>
            )}
            <div ref={messagesEndRef} className="chatbot-scroll-anchor" aria-hidden="true" />
          </div>

          <div className="llm-modal-footer">
            {error && (
              <div className="llm-error llm-error-dock" role="alert">
                <strong>Assistant notice:</strong> {error}
              </div>
            )}
            <form
              className="llm-form"
              onSubmit={(e) => {
                e.preventDefault();
                void sendQuestion(input);
              }}
            >
              <input
                ref={inputRef}
                type="text"
                placeholder="Ask about sales, charts, or features…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={streaming}
                aria-label="Ask Scout a question"
              />
              <button
                type="submit"
                className="action-btn primary"
                disabled={streaming || !input.trim()}
              >
                <ArrowUp size={16} aria-hidden="true" />
                {streaming ? 'Sending…' : 'Send'}
              </button>
            </form>
          </div>
        </dialog>
      )}
    </>
  );
}
