import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { MessageSquare, Loader, Plus, ChevronDown, ChevronUp, Trash2, MessageCircle, Bot, Square, Zap, X, MoreHorizontal, Pin, Pencil, Check } from 'lucide-react';
import {
  CLI_TOOLS,
  getToolConfig,
  getToolEffortOptions,
  getToolModelOptions,
  supportsEffortSelection,
  supportsModelSelection,
} from '../utils/sessionAssistantOptions';

/**
 * Format job progress for display
 */
function formatJobProgress(progress) {
  if (!progress) return 'Working...';

  const statusEmoji = {
    starting: '🚀',
    thinking: '🤔',
    reading: '📖',
    writing: '✍️',
    running: '⚡',
    searching: '🔍',
    responding: '💬',
    working: '⚙️',
    done: '✅',
    error: '❌',
  };

  const emoji = statusEmoji[progress.status] || '⏳';
  let text = `${emoji} ${progress.status.charAt(0).toUpperCase() + progress.status.slice(1)}`;

  if (progress.detail) {
    const detail = progress.detail.length > 60
      ? progress.detail.slice(0, 60) + '...'
      : progress.detail;
    text += `: ${detail}`;
  }

  if (progress.summary) {
    text = progress.summary;
  }

  return text;
}

/**
 * Working indicator with live timer and stop button.
 */
function WorkingIndicator({ wsRef, projectId, sessionId }) {
  const [elapsed, setElapsed] = useState(0);
  const [liveOutput, setLiveOutput] = useState('');
  const [showLive, setShowLive] = useState(true);
  const outputRef = useRef(null);

  useEffect(() => {
    setElapsed(0);
    setLiveOutput('');
    const interval = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!wsRef?.current) return;
    const handler = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'agent-shell-output' && (!msg.chatSessionId || msg.chatSessionId === sessionId)) {
        const clean = msg.data
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
          .replace(/\x1b\][^\x07]*\x07/g, '')
          .replace(/\r/g, '');
        setLiveOutput(prev => {
          const combined = prev + clean;
          return combined.length > 3000 ? combined.slice(-3000) : combined;
        });
      }
    };
    const ws = wsRef.current;
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, sessionId]);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [liveOutput]);

  const handleStop = () => {
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat-stop', projectId, sessionId }));
    }
  };

  const formatTime = (s) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const getDisplayLines = () => {
    if (!liveOutput) return [];
    return liveOutput.split('\n')
      .filter(l => {
        const t = l.trim();
        if (!t) return false;
        if (t.startsWith('{') && t.includes('"type"')) return false;
        if (t.startsWith('claude -p')) return false;
        return true;
      })
      .slice(-8);
  };

  const displayLines = getDisplayLines();

  return (
    <div className="flex justify-start mb-3 px-3">
      <div className="w-full max-w-[85%] rounded-lg border border-surface-700/30 bg-surface-800/40">
        <div className="flex items-center gap-3 px-3 py-2">
          <Bot size={13} className="text-primary-400" />
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
            <span className="text-[11px] text-surface-300">AI assistant working...</span>
            <span className="text-[11px] text-surface-500 tabular-nums ml-1">{formatTime(elapsed)}</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowLive(!showLive)}
            className="text-[10px] text-surface-500 hover:text-surface-300 transition-colors"
          >
            {showLive ? 'Hide' : 'Show'} live
          </button>
          <button
            onClick={handleStop}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <Square size={9} />
            Stop
          </button>
        </div>

        {showLive && displayLines.length > 0 && (
          <div ref={outputRef} className="px-3 pb-2 max-h-32 overflow-y-auto">
            <div className="font-mono text-[10px] text-surface-500 space-y-0.5">
              {displayLines.map((line, i) => (
                <div key={i} className="truncate">{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionAssistantControls({ session, defaultTool, disabled = false, projectId, onUpdate }) {
  const effectiveTool = session?.tool || defaultTool || 'claude';
  const rawModel = session?.model || '';
  const rawEffort = session?.effort || '';

  // Dynamic Ollama model loading — queries host + container, shows installed models at top
  // Also loads for OpenCode and Aider since they support ollama/ provider prefix
  const [ollamaModels, setOllamaModels] = useState(null);
  const [opencodeModels, setOpencodeModels] = useState(null);
  useEffect(() => {
    if (effectiveTool !== 'ollama' && effectiveTool !== 'opencode' && effectiveTool !== 'aider') return;
    // Use project-specific endpoint (merges host + container) if projectId is available
    const url = projectId
      ? `/api/projects/${projectId}/ollama-models`
      : '/api/llm/ollama/models';
    fetch(url)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const models = data?.models;
        if (Array.isArray(models) && models.length > 0) {
          if (effectiveTool === 'ollama') {
            setOllamaModels([
              { value: '', label: 'Select installed model' },
              ...models.map(m => ({ value: m.name, label: m.source === 'container' ? `${m.name} ✓` : m.name })),
            ]);
          } else if (effectiveTool === 'opencode' || effectiveTool === 'aider') {
            // For OpenCode and Aider, use ollama/ prefix format (required by both tools)
            setOllamaModels(
              models.map(m => ({
                value: `ollama/${m.name}`,
                label: m.source === 'container' ? `ollama/${m.name} ✓` : `ollama/${m.name}`,
              }))
            );
          }
        } else {
          setOllamaModels(null);
        }
      })
      .catch(() => { setOllamaModels(null); }); // Fall back to static list silently
  }, [effectiveTool, projectId]);

  useEffect(() => {
    if (effectiveTool !== 'opencode' || !projectId) {
      setOpencodeModels(null);
      return;
    }

    fetch(`/api/projects/${projectId}/opencode-models`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const models = data?.models;
        if (Array.isArray(models) && models.length > 0) {
          setOpencodeModels([
            { value: '', label: 'Tool default' },
            ...models.map(m => ({
              value: m.name,
              label: m.source === 'container' ? `${m.name} ✓` : m.name,
            })),
          ]);
        } else {
          setOpencodeModels(null);
        }
      })
      .catch(() => { setOpencodeModels(null); });
  }, [effectiveTool, projectId]);

  // Only show the model/effort if it belongs to this tool's options — prevents
  // stale values from a previous tool leaking into the dropdown.
  // For Ollama: use dynamic models if available, otherwise static fallback
  // For OpenCode/Aider: merge static models with dynamic Ollama models (ollama/ prefix)
  const toolModels = (() => {
    if (effectiveTool === 'ollama' && ollamaModels) {
      return ollamaModels;
    }
    if (effectiveTool === 'opencode' && opencodeModels) {
      return opencodeModels;
    }
    if ((effectiveTool === 'opencode' || effectiveTool === 'aider') && ollamaModels && ollamaModels.length > 0) {
      // Insert Ollama models after "Tool default" option
      const staticModels = getToolModelOptions(effectiveTool);
      const ollamaSection = [
        { value: '', label: '── Ollama (Local) ──', disabled: true },
        ...ollamaModels,
        { value: '', label: '── Cloud Providers ──', disabled: true },
      ];
      // Insert after first option (Tool default)
      return [staticModels[0], ...ollamaSection, ...staticModels.slice(1)];
    }
    return getToolModelOptions(effectiveTool);
  })();
  const toolEfforts = getToolEffortOptions(effectiveTool);
  const selectedEffort = toolEfforts.some(o => o.value === rawEffort) ? rawEffort : '';
  const modelOptions = effectiveTool === 'ollama' && ollamaModels
    ? (ollamaModels.some(o => o.value === rawModel) ? ollamaModels : [...ollamaModels, ...(rawModel ? [{ value: rawModel, label: `${rawModel} (current)` }] : [])])
    : (rawModel && !toolModels.some(o => o.value === rawModel) ? [...toolModels, { value: rawModel, label: `${rawModel} (current)` }] : toolModels);
  const selectedModel = modelOptions.some(o => o.value === rawModel) ? rawModel : '';
  const effortOptions = toolEfforts;

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-surface-700/40 bg-surface-850/40">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[10px] uppercase tracking-wide text-surface-500">Assistant</span>
        <select
          value={effectiveTool}
          disabled={disabled}
          onChange={(e) => onUpdate({ tool: e.target.value, model: '', effort: '' })}
          className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-200 outline-none focus:border-primary-500/50 disabled:opacity-50"
        >
          {CLI_TOOLS.map((toolOption) => (
            <option key={toolOption.id} value={toolOption.id}>
              {toolOption.name}
            </option>
          ))}
        </select>
      </div>

      {supportsModelSelection(effectiveTool) && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-surface-500">Model</span>
          <select
            value={selectedModel}
            disabled={disabled}
            onChange={(e) => onUpdate({ model: e.target.value })}
            className="max-w-[220px] bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-200 outline-none focus:border-primary-500/50 disabled:opacity-50"
          >
            {modelOptions.map((option, idx) => (
              <option
                key={option.value || `__sep_${idx}__`}
                value={option.value}
                disabled={option.disabled}
                style={option.disabled ? { fontWeight: 'bold', color: '#888' } : undefined}
              >
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {supportsEffortSelection(effectiveTool) && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wide text-surface-500">Effort</span>
          <select
            value={selectedEffort}
            disabled={disabled}
            onChange={(e) => onUpdate({ effort: e.target.value })}
            className="bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-200 outline-none focus:border-primary-500/50 disabled:opacity-50"
          >
            {effortOptions.map((option) => (
              <option key={option.value || '__default__'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="ml-auto text-[10px] text-surface-500 truncate">
        {getToolConfig(effectiveTool).context}
      </div>
    </div>
  );
}

/**
 * Individual session content - manages its own state independently.
 * Stays mounted when hidden to preserve scroll position and continue receiving updates.
 */
function ChatSessionContent({
  projectId,
  sessionId,
  wsRef,
  mode,
  tool,
  session,
  isVisible,
  projectSwitchKey,
  onSessionUpdate,
  onUpdateSessionConfig,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState(null);
  const [recoveryStatus, setRecoveryStatus] = useState({ active: false, message: null, startedAt: null, stalled: false });

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const knownIdsRef = useRef(new Set());
  const busyClearRef = useRef(false);
  const streamingChunksRef = useRef('');
  const prevMessageCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);

  // Scroll position tracking for jump buttons
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const [showJumpTop, setShowJumpTop] = useState(false);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const distFromTop = el.scrollTop;
    setShowJumpBottom(distFromBottom > 300);
    setShowJumpTop(distFromTop > 300);
  }, []);

  // Scroll the messages container to the bottom directly — more reliable than
  // scrollIntoView() which can be defeated by overflow:hidden ancestors.
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const scrollToTop = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = 0;
  }, []);

  // Load messages on mount
  useEffect(() => {
    if (!projectId || !sessionId) return;

    // Reset scroll state for fresh load
    isInitialLoadRef.current = true;
    prevMessageCountRef.current = 0;

    setLoading(true);
    fetch(`/api/projects/${projectId}/chat?limit=100&sessionId=${sessionId}`)
      .then(r => r.json())
      .then(data => {
        const msgs = (data.messages || []).reverse();
        knownIdsRef.current = new Set(msgs.map(m => m.id));
        setMessages(msgs);
        // Mark as read
        fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}/read`, { method: 'POST' }).catch(() => {});
        onSessionUpdate?.(sessionId, { hasUnread: false });
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [projectId, sessionId]);

  // Attach to chat session for WebSocket events
  useEffect(() => {
    if (!projectId || !sessionId || !wsRef?.current) return;

    let cancelled = false;
    let retryCount = 0;
    const maxRetries = 10;

    const attachToSession = () => {
      if (cancelled) return false;
      if (wsRef?.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'attach-chat-session',
          chatSessionId: sessionId,
          projectId,
        }));
        return true;
      }
      return false;
    };

    if (!attachToSession() && retryCount < maxRetries) {
      const tryAttach = () => {
        if (cancelled) return;
        retryCount++;
        if (!attachToSession() && retryCount < maxRetries) {
          setTimeout(tryAttach, 200);
        }
      };
      setTimeout(tryAttach, 100);
    }

    const handleOpen = () => attachToSession();
    wsRef?.current?.addEventListener('open', handleOpen);

    return () => {
      cancelled = true;
      wsRef?.current?.removeEventListener('open', handleOpen);
    };
  }, [projectId, sessionId, wsRef]);

  // Handle WebSocket messages for THIS session
  useEffect(() => {
    if (!wsRef?.current || !sessionId) return;

    const handleMessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Only handle messages for THIS session
      if (msg.sessionId && msg.sessionId !== sessionId) return;

      switch (msg.type) {
        case 'chat-message':
          if (msg.message?.sessionId === sessionId && msg.message?.id) {
            knownIdsRef.current.add(msg.message.id);
            setMessages(prev => {
              const filtered = prev.filter(m => {
                if (m.id === msg.message.id) return false;
                // Replace optimistic pending user message once server echoes real one
                if (
                  msg.message.role === 'user' &&
                  m.role === 'user' &&
                  typeof m.id === 'string' &&
                  m.id.startsWith('pending-') &&
                  m.content === msg.message.content
                ) {
                  return false;
                }
                return true;
              });
              return [...filtered, msg.message];
            });
          }
          break;

        case 'chat-message-stream-start':
          setStreamingMessage({
            id: msg.messageId,
            jobId: msg.jobId,
            role: 'agent',
            content: 'Thinking...',
            createdAt: new Date().toISOString(),
            streaming: true,
          });
          streamingChunksRef.current = '';
          break;

        case 'chat-message-chunk':
          streamingChunksRef.current += msg.chunk || '';
          setStreamingMessage(prev => prev ? {
            ...prev,
            content: streamingChunksRef.current.slice(-2000) || 'Processing...',
          } : null);
          break;

        case 'chat-message-stream-complete':
          setStreamingMessage(null);
          streamingChunksRef.current = '';
          if (msg.message) {
            knownIdsRef.current.add(msg.message.id);
            setMessages(prev => [...prev.filter(m => m.id !== msg.messageId), msg.message]);
            setAgentBusy(false);
          }
          break;

        case 'chat-message-recovered':
          if (msg.message) {
            knownIdsRef.current.add(msg.message.id);
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== msg.message.id);
              return [...filtered, msg.message];
            });
          }
          break;

        case 'chat-session-recovery':
          for (const incomplete of msg.incompleteMessages || []) {
            wsRef.current?.send(JSON.stringify({
              type: 'recover-streaming-message',
              projectId: msg.projectId,
              sessionId: msg.chatSessionId,
              messageId: incomplete.messageId,
            }));
          }
          break;

        case 'chat-recovery-starting':
          setRecoveryStatus({ active: true, message: msg.message || 'Recovering interrupted work...', startedAt: Date.now(), stalled: false });
          break;

        case 'chat-recovery-complete':
          setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
          break;

        case 'chat-progress':
          // Progress messages during agent work - check sessionId inside message
          if (msg.message?.sessionId === sessionId && msg.message?.content) {
            setStreamingMessage(prev => prev ? {
              ...prev,
              content: msg.message.content,
              progressTimestamp: Date.now(),
            } : {
              id: 'progress-' + Date.now(),
              role: 'progress',
              content: msg.message.content,
              createdAt: new Date().toISOString(),
              streaming: true,
            });
          }
          break;

        case 'job-progress':
          if (msg.progress) {
            setStreamingMessage(prev => prev ? {
              ...prev,
              content: formatJobProgress(msg.progress),
              progress: msg.progress,
            } : null);
          }
          break;

        case 'session-unread':
          if (msg.projectId === projectId && msg.sessionId === sessionId) {
            onSessionUpdate?.(sessionId, { hasUnread: msg.hasUnread });
          }
          break;

        case 'agent-status':
          // Agent busy state - needs sessionId to target correct session
          if (msg.projectId === projectId && (!msg.sessionId || msg.sessionId === sessionId)) {
            setAgentBusy(msg.busy || false);
          }
          break;
      }
    };

    wsRef.current.addEventListener('message', handleMessage);
    return () => wsRef.current?.removeEventListener('message', handleMessage);
  }, [wsRef, sessionId, projectId, onSessionUpdate]);

  // Detect stalled recovery after 30 seconds
  useEffect(() => {
    if (!recoveryStatus.active || !recoveryStatus.startedAt || recoveryStatus.stalled) return;

    const timeout = setTimeout(() => {
      setRecoveryStatus(prev => prev.active ? { ...prev, stalled: true } : prev);
    }, 30000);

    return () => clearTimeout(timeout);
  }, [recoveryStatus.active, recoveryStatus.startedAt, recoveryStatus.stalled]);

  // Retry handler for stalled recovery
  const handleRetry = () => {
    setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
    // Get the last user message to retry
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg && wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-message',
        projectId,
        sessionId,
        content: lastUserMsg.content,
        mode,
        tool,
      }));
      setAgentBusy(true);
    }
  };

  // Scroll handling - only when visible and new messages arrive
  useEffect(() => {
    if (!isVisible) return;

    const currentCount = messages.length;
    const prevCount = prevMessageCountRef.current;

    if (isInitialLoadRef.current && currentCount > 0) {
      scrollToBottom();
      isInitialLoadRef.current = false;
    } else if (currentCount > prevCount && prevCount > 0) {
      scrollToBottom();
    }

    prevMessageCountRef.current = currentCount;
  }, [messages, isVisible, scrollToBottom]);

  // Scroll to bottom when becoming visible
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(scrollToBottom, 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible, scrollToBottom]);

  // Ensure visible sessions jump to latest when switching projects
  useEffect(() => {
    if (!isVisible) return;
    const timer = setTimeout(scrollToBottom, 80);
    return () => clearTimeout(timer);
  }, [projectSwitchKey, isVisible, scrollToBottom]);

  // Poll for new messages (runs even when hidden)
  useEffect(() => {
    if (!projectId || !sessionId) return;

    const poll = setInterval(() => {
      fetch(`/api/projects/${projectId}/chat?limit=20&sessionId=${sessionId}`)
        .then(r => r.json())
        .then(data => {
          const serverMsgs = (data.messages || []).reverse();
          if (serverMsgs.length === 0) return;

          setMessages(prev => {
            const newMsgs = serverMsgs.filter(m => !knownIdsRef.current.has(m.id));
            if (newMsgs.length === 0) return prev;

            for (const m of newMsgs) knownIdsRef.current.add(m.id);

            let result = prev.filter(m => {
              if (!m.id.startsWith('pending-')) return true;
              const hasReal = newMsgs.some(sm => sm.role === 'user' && sm.content === m.content);
              return !hasReal;
            });

            const lastUserIdx = result.findLastIndex(m => m.role === 'user');
            const lastUserTime = lastUserIdx >= 0 ? result[lastUserIdx].createdAt : '';

            const newProgress = newMsgs.filter(m => m.role === 'progress');
            const newFinal = newMsgs.filter(m => m.role === 'agent' || m.role === 'error');
            const newOther = newMsgs.filter(m => m.role !== 'progress' && m.role !== 'agent' && m.role !== 'error');

            const hasNewFinalAfterUser = newFinal.some(m => m.createdAt > lastUserTime);

            if (newProgress.length > 0) {
              result = result.filter((m, i) => !(m.role === 'progress' && i > lastUserIdx));
              result.push(newProgress[newProgress.length - 1]);
            }

            if (hasNewFinalAfterUser) {
              result = result.filter(m => m.role !== 'progress' || result.indexOf(m) <= lastUserIdx);
              busyClearRef.current = true;
            }

            result.push(...newFinal, ...newOther);
            return result;
          });

          if (busyClearRef.current) {
            busyClearRef.current = false;
            setAgentBusy(false);
          }
        })
        .catch(() => {});
    }, 2000);

    return () => clearInterval(poll);
  }, [projectId, sessionId]);

  const effectiveTool = session?.tool || tool || 'claude';
  const sessionModel = session?.model || '';
  const sessionEffort = session?.effort || '';
  const settingsDisabled = agentBusy || Boolean(streamingMessage) || recoveryStatus.active;

  // Send message handler
  const handleSend = useCallback((content, attachments = []) => {
    if (!projectId || !sessionId) return;

    // ── /logs command: capture logs from container and share with agent ──
    const logsMatch = content.match(/^\/logs\s*(.*)?$/i);
    if (logsMatch) {
      const filePath = (logsMatch[1] || '').trim();
      const instruction = filePath
        ? `User requested logs from \`${filePath}\`. Analyze and continue.`
        : 'User shared recent terminal output. Analyze and continue.';

      // Show optimistic message
      setMessages(prev => [...prev, {
        id: 'pending-' + Date.now(),
        projectId,
        sessionId,
        role: 'user',
        content: filePath ? `📋 Capturing logs from \`${filePath}\`...` : '📋 Sharing terminal output...',
        metadata: { source: 'log-capture' },
        createdAt: new Date().toISOString(),
      }]);
      setAgentBusy(true);

      if (wsRef?.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'chat-capture-logs',
          projectId,
          sessionId,
          filePath: filePath || undefined,
          instruction,
        }));
      }
      return;
    }

    let displayContent = content;
    if (attachments.length > 0) {
      const attachmentList = attachments.map(a => `📎 ${a.name}`).join('\n');
      displayContent = content ? `${content}\n\n${attachmentList}` : attachmentList;
    }

    const optimistic = {
      id: 'pending-' + Date.now(),
      projectId,
      sessionId,
      role: 'user',
      content: displayContent,
      metadata: { mode, attachments, tool: effectiveTool, model: sessionModel || null, effort: sessionEffort || null },
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setAgentBusy(true);

    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-send',
        projectId,
        sessionId,
        content,
        attachments: attachments.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          size: a.size,
          path: a.path,
          url: a.url,
        })),
        mode,
        tool: effectiveTool,
        model: sessionModel || null,
        effort: sessionEffort || null,
      }));
    } else {
      setAgentBusy(false);
      setMessages(prev => [...prev, {
        id: 'err-' + Date.now(),
        projectId,
        role: 'error',
        content: 'Not connected to server. Please wait and retry.',
        createdAt: new Date().toISOString(),
      }]);
    }
  }, [projectId, sessionId, mode, wsRef, effectiveTool, sessionModel, sessionEffort]);

  const handleSearch = useCallback(async (query) => {
    if (!query || !projectId) { setSearchResults(null); return; }
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/search?q=${encodeURIComponent(query)}&sessionId=${sessionId || ''}`);
      const data = await r.json();
      setSearchResults(data.messages || []);
    } catch {
      setSearchResults([]);
    }
  }, [projectId, sessionId]);

  const handleRetryMessage = useCallback((targetMessage, options = {}) => {
    if (!targetMessage || !projectId || !sessionId) return;

    const all = [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const idx = all.findIndex(m => m.id === targetMessage.id);
    if (idx < 0) return;

    // Retry using the user prompt that led to this response
    const priorUser = [...all.slice(0, idx)].reverse().find(m => m.role === 'user');
    let retryContent = (priorUser?.content || targetMessage.content || '').trim();
    if (!retryContent) return;

    if (options.executeReviewedPlan && targetMessage?.metadata?.review?.docPath) {
      retryContent += `\n\nApproved. Execute the plan from ${targetMessage.metadata.review.docPath}. Start implementation now.`;
    }

    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-retry',
        projectId,
        sessionId,
        content: retryContent,
        mode,
        tool: effectiveTool,
        model: sessionModel || null,
        effort: sessionEffort || null,
        targetMessageId: targetMessage.id,
        review: targetMessage?.metadata?.review || null,
        executeReviewedPlan: !!options.executeReviewedPlan,
      }));
      setAgentBusy(true);
    }
  }, [messages, projectId, sessionId, wsRef, mode, effectiveTool, sessionModel, sessionEffort]);

  // Prepare display messages
  const sortedMessages = useMemo(() =>
    [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages]
  );

  const filteredMessages = useMemo(() => {
    const lastUserMsg = [...sortedMessages].reverse().find(m => m.role === 'user');
    const lastUserTime = lastUserMsg ? new Date(lastUserMsg.createdAt).getTime() : 0;
    const recent = sortedMessages.filter(m =>
      m.role !== 'progress' || new Date(m.createdAt).getTime() > lastUserTime
    );

    // De-duplicate noisy repeated progress updates while keeping final outputs/messages.
    const seenProgressAt = new Map();
    const deduped = [];
    for (const m of recent) {
      if (m.role !== 'progress') {
        deduped.push(m);
        continue;
      }

      const key = (m.content || '').trim();
      if (!key) continue;

      const ts = new Date(m.createdAt).getTime() || 0;
      const prevTs = seenProgressAt.get(key);
      // Hide repeated identical progress text within 2 minutes
      if (prevTs && Math.abs(ts - prevTs) < 120000) continue;

      seenProgressAt.set(key, ts);
      deduped.push(m);
    }

    return deduped;
  }, [sortedMessages]);

  const displayMessages = searchResults || filteredMessages;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: '1 1 0%',
        minHeight: 0,
        overflow: 'hidden',
        width: '100%',
        height: '100%',
      }}
    >
      {/* Search result indicator */}
      {searchResults && (
        <div className="px-3 py-1 text-[10px] text-surface-500 bg-surface-850/30 border-b border-surface-700/30">
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
        </div>
      )}

      <SessionAssistantControls
        session={session}
        defaultTool={tool}
        disabled={settingsDisabled}
        projectId={projectId}
        onUpdate={(updates) => onUpdateSessionConfig?.(sessionId, updates)}
      />

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }} className="px-1 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader size={22} className="animate-spin text-surface-600" />
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-surface-500 text-sm">
            {searchResults ? 'No results found' : 'Start a conversation...'}
          </div>
        ) : (
          displayMessages.map(msg => (
            <ChatMessage key={msg.id} message={msg} wsRef={wsRef} projectId={projectId} onSend={handleSend} onRetry={handleRetryMessage} />
          ))
        )}

        {recoveryStatus.active && (
          <div className={`mx-4 mb-2 px-4 py-2 border rounded-lg flex items-center gap-2 text-sm ${
            recoveryStatus.stalled
              ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
              : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
          }`}>
            {!recoveryStatus.stalled && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
            <span className="flex-1">
              {recoveryStatus.stalled
                ? 'Recovery seems to have stalled. You can retry your last message.'
                : (recoveryStatus.message || 'Resuming where we left off...')}
            </span>
            {recoveryStatus.stalled && (
              <button
                onClick={handleRetry}
                className="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 rounded text-amber-300 text-xs font-medium transition-colors"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {streamingMessage && (
          <ChatMessage
            key={streamingMessage.id}
            message={streamingMessage}
            wsRef={wsRef}
            projectId={projectId}
            onSend={handleSend}
          />
        )}

        {(agentBusy || streamingMessage || recoveryStatus.active) && (
          <WorkingIndicator wsRef={wsRef} projectId={projectId} sessionId={sessionId} />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Jump to top / bottom floating buttons */}
      <div className="relative">
        {showJumpTop && (
          <button
            onClick={scrollToTop}
            className="absolute -top-10 right-3 z-10 w-7 h-7 rounded-full bg-surface-700/90 border border-surface-600/50 text-surface-300 hover:text-surface-100 hover:bg-surface-600 flex items-center justify-center shadow-lg transition-all"
            title="Jump to top"
          >
            <ChevronUp size={14} />
          </button>
        )}
        {showJumpBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute -top-10 left-3 z-10 w-7 h-7 rounded-full bg-primary-600/90 border border-primary-500/50 text-white hover:bg-primary-500 flex items-center justify-center shadow-lg transition-all"
            title="Jump to bottom"
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>

      <ChatInput
        mode={mode}
        projectId={projectId}
        onSend={handleSend}
        onSearch={handleSearch}
        busy={agentBusy}
        isVisible={isVisible}
      />
    </div>
  );
}

/**
 * Main ChatPanel - manages sessions/tabs and renders all open sessions.
 * Sessions stay mounted when hidden to preserve state and continue working.
 */
export default function ChatPanel({ projectId, wsRef, mode = 'agent', tool = 'claude', isActive = true, onActiveSessionChange }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [splitCount, setSplitCount] = useState(1);
  const [showSessionList, setShowSessionList] = useState(false);
  const sessionListRef = useRef(null);
  const sessionsRef = useRef([]);
  const [projectSwitchKey, setProjectSwitchKey] = useState(0);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    if (projectId) setProjectSwitchKey(k => k + 1);
  }, [projectId]);

  // Scroll to bottom when this panel becomes the active project
  useEffect(() => {
    if (isActive) setProjectSwitchKey(k => k + 1);
  }, [isActive]);

  // Notify parent of active session changes (used by InternalConsole sharing)
  useEffect(() => {
    if (isActive && activeSessionId) {
      onActiveSessionChange?.(activeSessionId);
    }
  }, [isActive, activeSessionId, onActiveSessionChange]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (sessionListRef.current && !sessionListRef.current.contains(e.target)) {
        setShowSessionList(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Load sessions when project changes
  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setActiveSessionId(null);
      setOpenTabs([]);
      return;
    }

    fetch(`/api/projects/${projectId}/chat/sessions`)
      .then(r => r.json())
      .then(data => {
        const list = data.sessions || [];
        setSessions(list);
        if (list.length > 0) {
          // Auto-open all pinned sessions + the most recent session
          const pinnedIds = list.filter(s => s.pinned).map(s => s.id);
          const mostRecentId = list[0].id;
          const tabsToOpen = pinnedIds.includes(mostRecentId)
            ? pinnedIds
            : [mostRecentId, ...pinnedIds];
          setOpenTabs(tabsToOpen);
          setActiveSessionId(mostRecentId);
        } else {
          createNewSession();
        }
      })
      .catch(() => {
        setSessions([]);
        setActiveSessionId(null);
        setOpenTabs([]);
      });
  }, [projectId]);

  // Keep session list in sync so server-created sessions (e.g. Slack) appear automatically
  useEffect(() => {
    if (!projectId) return;

    const syncSessions = async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/chat/sessions`);
        const data = await r.json();
        const latest = data.sessions || [];
        const prev = sessionsRef.current;

        const prevIds = new Set(prev.map(s => s.id));
        const newSessions = latest.filter(s => !prevIds.has(s.id));

        if (newSessions.length > 0) {
          const newest = newSessions[0];
          setOpenTabs(prevTabs => (prevTabs.includes(newest.id) ? prevTabs : [newest.id, ...prevTabs]));
          setActiveSessionId(newest.id);
        }

        // Merge server data into local state.
        // Server is authoritative for metadata (messageCount, hasUnread, name),
        // but we preserve local tool/model/effort to avoid clobbering optimistic
        // updates that are still in-flight (PATCH sent but response not yet back).
        setSessions(prev => {
          const localMap = new Map(prev.map(s => [s.id, s]));
          return latest.map(serverSession => {
            const local = localMap.get(serverSession.id);
            if (!local) return serverSession; // brand-new session from server
            return {
              ...serverSession,
              // Keep local assistant settings — they're set via PATCH and confirmed
              // by the PATCH response handler; the background poll must not overwrite them.
              tool: local.tool,
              model: local.model,
              effort: local.effort,
            };
          });
        });
      } catch {}
    };

    const interval = setInterval(syncSessions, 2000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Session actions
  const createNewSession = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool })
      });
      const session = await r.json();
      setSessions(prev => [session, ...prev]);
      setOpenTabs(prev => [...prev, session.id]);
      setActiveSessionId(session.id);
      setShowSessionList(false);
    } catch {}
  }, [projectId, tool]);

  const deleteSession = useCallback(async (sessionId) => {
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, { method: 'DELETE' });
      setOpenTabs(prev => prev.filter(id => id !== sessionId));
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== sessionId);
        if (sessionId === activeSessionId) {
          const remainingTabs = openTabs.filter(id => id !== sessionId);
          if (remainingTabs.length > 0) {
            setActiveSessionId(remainingTabs[remainingTabs.length - 1]);
          } else if (filtered.length > 0) {
            setOpenTabs([filtered[0].id]);
            setActiveSessionId(filtered[0].id);
          } else {
            createNewSession();
          }
        }
        return filtered;
      });
    } catch {}
  }, [projectId, activeSessionId, openTabs, createNewSession]);

  const markSessionRead = useCallback((sessionId) => {
    if (!projectId || !sessionId) return;
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, hasUnread: false } : s
    ));
    fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}/read`, { method: 'POST' }).catch(() => {});
  }, [projectId]);

  const switchToTab = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
    markSessionRead(sessionId);
  }, [markSessionRead]);

  const openSession = useCallback((sessionId) => {
    if (!openTabs.includes(sessionId)) {
      setOpenTabs(prev => [...prev, sessionId]);
    }
    setActiveSessionId(sessionId);
    setShowSessionList(false);
    markSessionRead(sessionId);
  }, [openTabs, markSessionRead]);

  const closeTab = useCallback((sessionId, e) => {
    e?.stopPropagation();
    setOpenTabs(prev => {
      const filtered = prev.filter(id => id !== sessionId);
      if (sessionId === activeSessionId) {
        if (filtered.length > 0) {
          setActiveSessionId(filtered[filtered.length - 1]);
        } else {
          createNewSession();
        }
      }
      return filtered;
    });
  }, [activeSessionId, createNewSession]);

  // Handle session state updates from child components
  const handleSessionUpdate = useCallback((sessionId, updates) => {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, ...updates } : s
    ));
  }, []);

  const updateSessionAssistantConfig = useCallback(async (sessionId, updates) => {
    if (!projectId) return;

    const previous = sessionsRef.current.find((session) => session.id === sessionId);
    if (!previous) return;

    const optimistic = { ...previous, ...updates };
    setSessions((prev) => prev.map((session) => (
      session.id === sessionId ? optimistic : session
    )));

    try {
      const response = await fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update session settings');
      if (data.session) {
        setSessions((prev) => prev.map((session) => (
          session.id === sessionId ? data.session : session
        )));
      }
    } catch {
      setSessions((prev) => prev.map((session) => (
        session.id === sessionId ? previous : session
      )));
    }
  }, [projectId]);

  // Pin/unpin a session
  const togglePin = useCallback(async (sessionId, e) => {
    e?.stopPropagation();
    if (!projectId) return;
    const session = sessions.find(s => s.id === sessionId);
    const newPinned = !session?.pinned;

    // Optimistic update
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, pinned: newPinned } : s
    ));

    try {
      await fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: newPinned }),
      });
    } catch {
      // Revert on error
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, pinned: !newPinned } : s
      ));
    }
  }, [projectId, sessions]);

  // Rename a session
  const renameSession = useCallback(async (sessionId, newName) => {
    if (!projectId || !newName?.trim()) return;
    const trimmedName = newName.trim();

    // Optimistic update
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, name: trimmedName } : s
    ));

    try {
      await fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName }),
      });
    } catch {
      // Could revert, but name changes are not critical
    }
  }, [projectId]);

  // State for inline editing
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingName, setEditingName] = useState('');
  const editInputRef = useRef(null);

  const startEditing = useCallback((sessionId, currentName, e) => {
    e?.stopPropagation();
    setEditingSessionId(sessionId);
    setEditingName(currentName || '');
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, []);

  const finishEditing = useCallback(() => {
    if (editingSessionId && editingName.trim()) {
      renameSession(editingSessionId, editingName);
    }
    setEditingSessionId(null);
    setEditingName('');
  }, [editingSessionId, editingName, renameSession]);

  const cancelEditing = useCallback(() => {
    setEditingSessionId(null);
    setEditingName('');
  }, []);

  // Sort sessions: pinned first, then by most recent
  const sortedSessions = useMemo(() =>
    [...sessions].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return 0; // Keep original order (most recent) for same pin status
    }),
    [sessions]
  );

  const closedSessions = sortedSessions.filter(s => !openTabs.includes(s.id));
  const openTabSessions = openTabs.map(id => sessions.find(s => s.id === id)).filter(Boolean);
  const visibleTabIds = useMemo(() => {
    const ordered = [activeSessionId, ...openTabs.filter(id => id !== activeSessionId)].filter(Boolean);
    return ordered.slice(0, Math.min(Math.max(splitCount, 1), 4));
  }, [activeSessionId, openTabs, splitCount]);

  const gridStyle = useMemo(() => {
    const count = visibleTabIds.length;
    if (count <= 1) {
      return { gridTemplateColumns: '1fr', gridTemplateRows: '1fr' };
    }
    if (count === 2) {
      return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr' };
    }
    // 3-4 panes: 2x2 grid for readability
    return { gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr' };
  }, [visibleTabIds.length]);

  if (!projectId) {
    return (
      <div className="h-full flex items-center justify-center text-surface-500">
        <div className="text-center">
          <MessageSquare size={40} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-sans">Select a project to start</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Session tabs bar */}
      <div className="flex items-center border-b border-surface-700/50 bg-surface-850/60" style={{ flexShrink: 0 }}>
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-none min-w-0">
          {openTabSessions.map((s) => (
            <div
              key={s.id}
              onClick={() => switchToTab(s.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-surface-700/30 min-w-0 max-w-[200px] transition-colors ${
                s.id === activeSessionId
                  ? 'bg-surface-800 text-surface-100'
                  : 'bg-surface-850/80 text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'
              }`}
            >
              {s.pinned ? (
                <Pin size={10} className="text-amber-400 flex-shrink-0 -rotate-45" />
              ) : (
                <MessageCircle size={11} className={s.id === activeSessionId ? 'text-primary-400 flex-shrink-0' : 'text-surface-600 flex-shrink-0'} />
              )}
              {editingSessionId === s.id ? (
                <input
                  ref={editInputRef}
                  type="text"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') finishEditing();
                    if (e.key === 'Escape') cancelEditing();
                  }}
                  onBlur={finishEditing}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1 py-0 text-[11px] text-surface-100 focus:outline-none focus:border-primary-500"
                  style={{ maxWidth: '120px' }}
                  placeholder="Name..."
                />
              ) : (
                <span className="truncate text-[11px]">{s.name || 'Chat'}</span>
              )}
              {s.hasUnread && s.id !== activeSessionId && (
                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
              )}
              {/* Pin button - show on hover for active tab */}
              {s.id === activeSessionId && (
                <>
                  <button
                    onClick={(e) => togglePin(s.id, e)}
                    className={`p-0.5 rounded flex-shrink-0 transition-all opacity-0 group-hover:opacity-100 ${
                      s.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-surface-500 hover:text-amber-400'
                    }`}
                    title={s.pinned ? 'Unpin session' : 'Pin session'}
                  >
                    <Pin size={9} className={s.pinned ? '-rotate-45' : ''} />
                  </button>
                  <button
                    onClick={(e) => startEditing(s.id, s.name, e)}
                    className="p-0.5 rounded flex-shrink-0 transition-all opacity-0 group-hover:opacity-100 text-surface-500 hover:text-surface-200"
                    title="Rename session"
                  >
                    <Pencil size={9} />
                  </button>
                </>
              )}
              <button
                onClick={(e) => closeTab(s.id, e)}
                className={`p-0.5 rounded flex-shrink-0 transition-all ${
                  s.id === activeSessionId
                    ? 'text-surface-500 hover:text-surface-200 hover:bg-surface-700'
                    : 'text-surface-600 hover:text-surface-300 hover:bg-surface-700 opacity-0 group-hover:opacity-100'
                }`}
                title="Close tab"
              >
                <X size={10} />
              </button>
            </div>
          ))}

          <button
            onClick={createNewSession}
            className="p-1.5 text-surface-500 hover:text-primary-400 hover:bg-surface-700/50 transition-colors flex-shrink-0"
            title="New conversation"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex items-center gap-0.5 px-1 border-l border-surface-700/30 flex-shrink-0">
          <div className="flex items-center gap-0.5 mr-1 border-r border-surface-700/30 pr-1">
            {[1, 2, 3, 4].map(n => (
              <button
                key={n}
                onClick={() => setSplitCount(n)}
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  splitCount === n
                    ? 'bg-primary-500/20 text-primary-300 border border-primary-500/30'
                    : 'text-surface-500 hover:text-surface-200 hover:bg-surface-700/50 border border-transparent'
                }`}
                title={`Show ${n} pane${n > 1 ? 's' : ''}`}
              >
                {n}
              </button>
            ))}
          </div>

          <div className="relative" ref={sessionListRef}>
            <button
              onClick={() => setShowSessionList(!showSessionList)}
              className={`p-1.5 rounded transition-colors ${
                closedSessions.length > 0
                  ? 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
                  : 'text-surface-600 hover:text-surface-400 hover:bg-surface-700/30'
              }`}
              title={closedSessions.length > 0 ? `${closedSessions.length} closed session(s)` : 'No closed sessions'}
            >
              <MoreHorizontal size={14} />
            </button>

            {showSessionList && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-surface-800 border border-surface-700 rounded-lg shadow-modal z-50 overflow-hidden animate-scale-in">
                <div className="px-3 py-2 text-[10px] text-surface-500 uppercase tracking-wider border-b border-surface-700/50 bg-surface-850/50">
                  {closedSessions.length > 0 ? 'Closed Sessions' : 'All Sessions Open'}
                </div>

                {closedSessions.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto">
                    {closedSessions.map(s => (
                      <div
                        key={s.id}
                        onClick={() => editingSessionId !== s.id && openSession(s.id)}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] cursor-pointer transition-colors group text-surface-300 hover:bg-surface-750"
                      >
                        {s.pinned ? (
                          <Pin size={11} className="text-amber-400 flex-shrink-0 -rotate-45" />
                        ) : (
                          <MessageCircle size={11} className="text-surface-600 flex-shrink-0" />
                        )}
                        {editingSessionId === s.id ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') finishEditing();
                              if (e.key === 'Escape') cancelEditing();
                            }}
                            onBlur={finishEditing}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 min-w-0 bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-[11px] text-surface-100 focus:outline-none focus:border-primary-500"
                            placeholder="Session name..."
                          />
                        ) : (
                          <span className="flex-1 truncate">{s.name}</span>
                        )}
                        {editingSessionId === s.id ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); finishEditing(); }}
                            className="p-0.5 text-green-400 hover:text-green-300 transition-colors flex-shrink-0"
                            title="Save"
                          >
                            <Check size={10} />
                          </button>
                        ) : (
                          <>
                            <span className="text-[9px] text-surface-600 flex-shrink-0 tabular-nums group-hover:hidden">
                              {s.messageCount || 0} msg
                            </span>
                            <button
                              onClick={(e) => togglePin(s.id, e)}
                              className={`p-0.5 transition-all hidden group-hover:block flex-shrink-0 ${
                                s.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-surface-500 hover:text-amber-400'
                              }`}
                              title={s.pinned ? 'Unpin' : 'Pin'}
                            >
                              <Pin size={10} className={s.pinned ? '-rotate-45' : ''} />
                            </button>
                            <button
                              onClick={(e) => startEditing(s.id, s.name, e)}
                              className="p-0.5 text-surface-500 hover:text-surface-200 transition-all hidden group-hover:block flex-shrink-0"
                              title="Rename"
                            >
                              <Pencil size={10} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                              className="p-0.5 text-surface-700 hover:text-red-400 hidden group-hover:block transition-all flex-shrink-0"
                              title="Delete permanently"
                            >
                              <Trash2 size={10} />
                            </button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-[11px] text-surface-500 text-center">
                    Close tabs to see them here
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => window.open('/skills', '_blank')}
            className="p-1.5 rounded text-surface-500 hover:text-purple-400 hover:bg-surface-700/50 transition-colors"
            title="Manage skills & plugins"
          >
            <Zap size={14} />
          </button>
        </div>
      </div>

      {/* Render ALL open sessions; visible ones in split grid, hidden ones stay mounted */}
      <div
        style={{
          position: 'relative',
          flex: '1 1 0%',
          minHeight: 0,
          overflow: 'hidden',
          display: 'grid',
          gap: visibleTabIds.length > 1 ? 8 : 0,
          padding: visibleTabIds.length > 1 ? 8 : 0,
          ...gridStyle,
        }}
      >
        {openTabs.map(tabId => (
          <div
            key={tabId}
            style={{
              position: visibleTabIds.includes(tabId) ? 'relative' : 'absolute',
              top: visibleTabIds.includes(tabId) ? 'auto' : 0,
              left: visibleTabIds.includes(tabId) ? 'auto' : 0,
              right: visibleTabIds.includes(tabId) ? 'auto' : 0,
              bottom: visibleTabIds.includes(tabId) ? 'auto' : 0,
              width: visibleTabIds.includes(tabId) ? 'auto' : 0,
              height: visibleTabIds.includes(tabId) ? 'auto' : 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              visibility: visibleTabIds.includes(tabId) ? 'visible' : 'hidden',
              pointerEvents: visibleTabIds.includes(tabId) ? 'auto' : 'none',
              zIndex: visibleTabIds.includes(tabId) ? 1 : 0,
              backgroundColor: '#0d1117',
              minHeight: 0,
              border: visibleTabIds.length > 1 ? '1px solid rgba(71,85,105,0.35)' : 'none',
              borderRadius: visibleTabIds.length > 1 ? 8 : 0,
            }}
          >
            {visibleTabIds.length > 1 && visibleTabIds.includes(tabId) && (
              <div className="px-2 py-1 border-b border-surface-700/40 bg-surface-850/70 text-[11px] text-surface-300 flex items-center gap-1.5 group/pane-hdr">
                <MessageCircle size={10} className="text-primary-400 flex-shrink-0" />
                <span className="truncate flex-1">{sessions.find(s => s.id === tabId)?.name || 'Chat'}</span>
                <button
                  onClick={(e) => togglePin(tabId, e)}
                  className={`p-0.5 rounded flex-shrink-0 transition-all opacity-0 group-hover/pane-hdr:opacity-100 ${
                    sessions.find(s => s.id === tabId)?.pinned
                      ? 'text-amber-400 opacity-100'
                      : 'text-surface-500 hover:text-amber-400'
                  }`}
                  title={sessions.find(s => s.id === tabId)?.pinned ? 'Unpin session' : 'Pin session'}
                >
                  <Pin size={9} className={sessions.find(s => s.id === tabId)?.pinned ? '-rotate-45' : ''} />
                </button>
              </div>
            )}
            <ChatSessionContent
              projectId={projectId}
              sessionId={tabId}
              wsRef={wsRef}
              mode={mode}
              tool={tool}
              session={sessions.find(s => s.id === tabId)}
              isVisible={visibleTabIds.includes(tabId)}
              projectSwitchKey={projectSwitchKey}
              onSessionUpdate={handleSessionUpdate}
              onUpdateSessionConfig={updateSessionAssistantConfig}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
