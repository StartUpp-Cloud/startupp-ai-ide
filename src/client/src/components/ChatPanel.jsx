import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { MessageSquare, Loader, Plus, ChevronDown, Trash2, MessageCircle, Bot, Square, Zap, X, MoreHorizontal, Pin, Pencil, Check } from 'lucide-react';

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
  isVisible,
  onSessionUpdate,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState(null);
  const [recoveryStatus, setRecoveryStatus] = useState({ active: false, message: null, startedAt: null, stalled: false });

  const messagesEndRef = useRef(null);
  const knownIdsRef = useRef(new Set());
  const busyClearRef = useRef(false);
  const streamingChunksRef = useRef('');
  const prevMessageCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);

  // Load messages on mount
  useEffect(() => {
    if (!projectId || !sessionId) return;

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
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      isInitialLoadRef.current = false;
    } else if (currentCount > prevCount && prevCount > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }

    prevMessageCountRef.current = currentCount;
  }, [messages, isVisible]);

  // Scroll to bottom when becoming visible
  useEffect(() => {
    if (isVisible) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

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

  // Send message handler
  const handleSend = useCallback((content, attachments = []) => {
    if (!projectId || !sessionId) return;

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
      metadata: { mode, attachments },
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
        tool,
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
  }, [projectId, sessionId, mode, tool, wsRef]);

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

  // Prepare display messages
  const sortedMessages = useMemo(() =>
    [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages]
  );

  const filteredMessages = useMemo(() => {
    const lastUserMsg = [...sortedMessages].reverse().find(m => m.role === 'user');
    const lastUserTime = lastUserMsg ? new Date(lastUserMsg.createdAt).getTime() : 0;
    return sortedMessages.filter(m =>
      m.role !== 'progress' || new Date(m.createdAt).getTime() > lastUserTime
    );
  }, [sortedMessages]);

  const displayMessages = searchResults || filteredMessages;

  return (
    <div
      style={{
        display: isVisible ? 'flex' : 'none',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden'
      }}
    >
      {/* Search result indicator */}
      {searchResults && (
        <div className="px-3 py-1 text-[10px] text-surface-500 bg-surface-850/30 border-b border-surface-700/30">
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="px-1 py-4">
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
            <ChatMessage key={msg.id} message={msg} wsRef={wsRef} projectId={projectId} onSend={handleSend} />
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

      {/* Input */}
      <ChatInput
        mode={mode}
        projectId={projectId}
        onSend={handleSend}
        onSearch={handleSearch}
        busy={agentBusy}
      />
    </div>
  );
}

/**
 * Main ChatPanel - manages sessions/tabs and renders all open sessions.
 * Sessions stay mounted when hidden to preserve state and continue working.
 */
export default function ChatPanel({ projectId, wsRef, mode = 'agent', tool = 'claude', isActive = true }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [showSessionList, setShowSessionList] = useState(false);
  const sessionListRef = useRef(null);

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
          setOpenTabs([list[0].id]);
          setActiveSessionId(list[0].id);
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

  // Session actions
  const createNewSession = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const session = await r.json();
      setSessions(prev => [session, ...prev]);
      setOpenTabs(prev => [...prev, session.id]);
      setActiveSessionId(session.id);
      setShowSessionList(false);
    } catch {}
  }, [projectId]);

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

      {/* Render ALL open sessions - hidden ones use display:none but stay mounted */}
      {openTabs.map(tabId => (
        <ChatSessionContent
          key={tabId}
          projectId={projectId}
          sessionId={tabId}
          wsRef={wsRef}
          mode={mode}
          tool={tool}
          isVisible={tabId === activeSessionId}
          onSessionUpdate={handleSessionUpdate}
        />
      ))}
    </div>
  );
}
