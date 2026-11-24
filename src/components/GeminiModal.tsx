import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LlmAnalysisResult,
  LlmAnalysisTask,
  LlmChatMessage,
  LlmContextPayload,
} from '../types/sales.ts';
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
  const [error, setError] = useState('');
  const [minimized, setMinimized] = useState(false);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

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
    setAnalyzing(true);
    setActiveTask(task);
    setMode('briefing');
    setError('');
    shouldAutoScrollRef.current = true;
    try {
      const res = await fetch('/api/llm/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, context: contextPayload }),
      });
      const data = (await res.json()) as LlmAnalysisResult & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      setAnalysis(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to run Gemini analysis. Please try again in a moment.'
      );
    } finally {
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMinimized(true);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, minimized, onClose]);

  const sendQuestion = async (rawQuestion: string) => {
    const question = rawQuestion.trim();
    if (!question || streaming) return;

    setMode('chat');
    setError('');
    setInput('');
    shouldAutoScrollRef.current = true;
    const historyPayload = messages.map((m) => ({ role: m.role, content: m.content }));
    const nowTime = new Date().toLocaleTimeString('en-PH', {
      hour: 'numeric',
      minute: '2-digit',
    });
    const userMsg: LlmChatMessage = {
      role: 'user',
      content: question,
      timestamp: nowTime,
    };
    const assistantMsg: LlmChatMessage = {
      role: 'assistant',
      content: '',
      timestamp: nowTime,
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setStreaming(true);

    try {
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
            `Gemini AI service returned status ${res.status}. Please check server settings or retry.`
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
        throw new Error('Gemini returned an empty response. Please try asking again.');
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to reach Gemini AI right now. Verify your connection or try again.'
      );
      setMessages((prev) => prev.filter((_, idx) => idx !== prev.length - 1 || prev[idx].content));
    } finally {
      setStreaming(false);
    }
  };

  const handleClearChat = () => {
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
              ? `Open UNIQLO Sales Assistant (${userTurnCount} saved questions)`
              : 'Open UNIQLO Sales Assistant'
          }
        >
          <span className="chatbot-launcher-mark" aria-hidden="true">
            ✦
          </span>
          <span className="chatbot-launcher-label">
            {userTurnCount > 0 ? `Sales Assistant (${userTurnCount})` : 'Sales Assistant'}
          </span>
        </button>
      )}

      {isOpen && !minimized && (
        <div
          className="chatbot-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="llmModalTitle"
        >
          <div className="llm-modal-header">
            <div className="llm-header-copy">
              <div className="ai-eyebrow">SALES ANALYTICS GUIDE</div>
              <h2 id="llmModalTitle">UNIQLO Sales Assistant</h2>
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
                ↺ Clear
              </button>
              <button
                type="button"
                id="chatbotMinimizeBtn"
                className="llm-icon-btn"
                onClick={handleMinimize}
                title="Minimize chat"
                aria-label="Minimize Sales Assistant"
              >
                —
              </button>
              <button
                type="button"
                id="chatbotCloseBtn"
                className="llm-icon-btn"
                onClick={handleClose}
                title="Close chat"
                aria-label="Close Sales Assistant"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="chatbot-mode-bar" role="tablist" aria-label="Sales Assistant Modes">
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
                    <div className="explanation-kicker">{`GEMINI STRUCTURED OUTPUT · ${analysis.model}`}</div>
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
                <div className="llm-welcome-card">
                  <div className="llm-welcome-head">
                    <span className="llm-msg-role">SYSTEM &amp; DATA GUIDE</span>
                    {messages.length > 0 && (
                      <span className="chatbot-saved-note">History saved</span>
                    )}
                  </div>
                  <p>
                    Ask about navigating dashboards, importing snapshots, <strong>IQR</strong> or{' '}
                    <strong>Isolation Forest</strong> alerts, or sales trends in{' '}
                    <strong>English, Filipino, or Taglish</strong>.
                  </p>
                  <div className="llm-welcome-meta">
                    Active view: <strong>{contextPayload.viewLabel}</strong> ({formatNumber(
                      contextPayload.kpis.recordCount
                    )}{' '}
                    shown / {formatNumber(contextPayload.overallSummary.totalLoadedCount)} total)
                  </div>
                </div>

                <div className="llm-suggestions-wrap">
                  <div className="llm-suggestions-head">
                    <span>Suggested questions</span>
                    <button
                      type="button"
                      className="llm-text-toggle"
                      onClick={() => setSuggestionsExpanded((s) => !s)}
                    >
                      {suggestionsExpanded ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {suggestionsExpanded && (
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
                          {msg.role === 'user' ? 'You' : 'Sales Assistant'}
                          {msg.timestamp ? ` · ${msg.timestamp}` : ''}
                        </div>
                        {isTyping ? (
                          <div className="chatbot-typing" aria-label="Sales Assistant is typing">
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-label">Thinking…</span>
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
                aria-label="Ask UNIQLO Sales Assistant a question"
              />
              <button
                type="submit"
                className="action-btn primary"
                disabled={streaming || !input.trim()}
              >
                {streaming ? 'Sending…' : 'Send'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
