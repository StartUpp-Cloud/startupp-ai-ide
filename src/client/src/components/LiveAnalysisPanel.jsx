import { useState, useEffect, useRef, useCallback } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Info,
  AlertTriangle,
  Pause,
  Play,
  RefreshCw,
  Loader2,
  Trash2,
  Activity,
} from 'lucide-react';

/**
 * LiveAnalysisPanel - LLM-powered terminal output analyzer.
 * Listens for 'terminal-output' window events, accumulates output, and
 * periodically sends it to POST /api/llm/analyze-terminal-output for
 * structured checklist generation.
 *
 * NOTE: Terminal.jsx should dispatch terminal output events in the 'output'
 * message handler:
 *   window.dispatchEvent(new CustomEvent('terminal-output', {
 *     detail: { sessionId: msg.sessionId, data: msg.data }
 *   }));
 */

const STATUS_CONFIG = {
  completed: {
    icon: CheckCircle2,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
  },
  'in-progress': {
    icon: Clock,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/20',
  },
  error: {
    icon: XCircle,
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/20',
  },
  info: {
    icon: Info,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
};

const ANALYSIS_INTERVAL_MS = 15000;
const MIN_OUTPUT_LENGTH = 100;
const MAX_BUFFER_LENGTH = 5000;
const ANALYSIS_COOLDOWN_MS = 10000;

export default function LiveAnalysisPanel({ projectId, sessionId }) {
  const [items, setItems] = useState([]);
  const [enabled, setEnabled] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState(null);

  const outputBufferRef = useRef('');
  const lastAnalysisRef = useRef(0);
  const scrollRef = useRef(null);

  // Listen for terminal output events
  useEffect(() => {
    const handler = (e) => {
      if (!enabled) return;
      const { data } = e.detail || {};
      if (!data) return;

      // Strip ANSI escape codes and accumulate
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      outputBufferRef.current += clean;

      // Keep last MAX_BUFFER_LENGTH chars
      if (outputBufferRef.current.length > MAX_BUFFER_LENGTH) {
        outputBufferRef.current = outputBufferRef.current.slice(-MAX_BUFFER_LENGTH);
      }
    };

    window.addEventListener('terminal-output', handler);
    return () => window.removeEventListener('terminal-output', handler);
  }, [enabled]);

  // Analyze the accumulated output
  const analyzeOutput = useCallback(async () => {
    if (!projectId || analyzing) return;
    if (outputBufferRef.current.length < MIN_OUTPUT_LENGTH) return;

    const bufferSnapshot = outputBufferRef.current;

    setAnalyzing(true);
    lastAnalysisRef.current = Date.now();

    try {
      const res = await fetch('/api/llm/analyze-terminal-output', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          output: bufferSnapshot,
          previousItems: items.slice(-10).map(({ text, status }) => ({ text, status })),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.error('Analysis failed:', errData.error || res.statusText);
        return;
      }

      const data = await res.json();

      if (data.items && Array.isArray(data.items)) {
        setItems((prev) => {
          // Merge: update existing items by text match, add new ones
          const merged = [...prev];
          for (const newItem of data.items) {
            const existingIndex = merged.findIndex(
              (m) => m.text.toLowerCase() === newItem.text.toLowerCase()
            );
            if (existingIndex >= 0) {
              merged[existingIndex] = {
                ...merged[existingIndex],
                status: newItem.status,
                updatedAt: new Date().toISOString(),
              };
            } else {
              merged.push({
                ...newItem,
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              });
            }
          }

          // Cap at 20 items, keep most recent
          return merged.slice(-20);
        });

        setLastAnalyzedAt(new Date().toISOString());
      }

      // Clear the buffer after successful analysis
      outputBufferRef.current = '';
    } catch (err) {
      console.error('Terminal analysis error:', err);
    } finally {
      setAnalyzing(false);
    }
  }, [projectId, analyzing, items]);

  // Periodic analysis interval
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const hasOutput = outputBufferRef.current.length >= MIN_OUTPUT_LENGTH;
      const cooldownPassed = now - lastAnalysisRef.current > ANALYSIS_COOLDOWN_MS;

      if (hasOutput && cooldownPassed) {
        analyzeOutput();
      }
    }, ANALYSIS_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [enabled, analyzeOutput]);

  // Auto-scroll to bottom when new items are added
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  // Clear all items
  const clearItems = useCallback(() => {
    setItems([]);
    outputBufferRef.current = '';
    lastAnalysisRef.current = 0;
    setLastAnalyzedAt(null);
  }, []);

  // Format relative time
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const diff = Date.now() - new Date(timestamp).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return `${Math.floor(diff / 3600000)}h ago`;
  };

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Live Analysis</span>
          {items.length > 0 && (
            <span className="text-xs text-surface-500">({items.length})</span>
          )}
          {analyzing && (
            <Loader2 className="w-3 h-3 text-primary-400 animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {lastAnalyzedAt && (
            <span className="text-[10px] text-surface-500 mr-1">
              {formatTime(lastAnalyzedAt)}
            </span>
          )}
          <button
            onClick={analyzeOutput}
            disabled={analyzing || !enabled}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
            title="Analyze now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
          </button>
          {items.length > 0 && (
            <button
              onClick={clearItems}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-red-400 transition-colors"
              title="Clear analysis"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setEnabled((prev) => !prev)}
            className={`p-1.5 rounded transition-colors ${
              enabled
                ? 'bg-primary-500/20 text-primary-300 hover:bg-primary-500/30'
                : 'text-surface-500 hover:bg-surface-700 hover:text-surface-300'
            }`}
            title={enabled ? 'Pause analysis' : 'Resume analysis'}
          >
            {enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Empty state */}
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center p-4">
            <Activity className="w-8 h-8 text-surface-600 mb-2" />
            <p className="text-xs text-surface-400">
              {enabled ? 'Waiting for terminal output...' : 'Analysis paused'}
            </p>
            <p className="text-[10px] text-surface-500 mt-0.5">
              {enabled
                ? 'Run commands to see real-time analysis'
                : 'Click play to resume analysis'}
            </p>
          </div>
        )}

        {/* Checklist items */}
        {items.length > 0 && (
          <div className="py-1">
            {items.map((item) => {
              const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.info;
              const StatusIcon = config.icon;

              return (
                <div
                  key={item.id || item.text}
                  className={`flex items-start gap-2 px-3 py-1.5 border-b border-surface-700/50 ${config.bg} transition-colors`}
                >
                  <StatusIcon className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${config.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-surface-200 leading-relaxed">
                      {item.text}
                    </p>
                    {item.updatedAt && (
                      <p className="text-[10px] text-surface-500 mt-0.5">
                        {formatTime(item.updatedAt)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Disabled overlay hint */}
      {!enabled && items.length > 0 && (
        <div className="px-3 py-1.5 border-t border-surface-700 bg-surface-800/60">
          <p className="text-[10px] text-surface-500 text-center">
            Analysis paused -- click <Play className="w-2.5 h-2.5 inline" /> to resume
          </p>
        </div>
      )}
    </div>
  );
}
