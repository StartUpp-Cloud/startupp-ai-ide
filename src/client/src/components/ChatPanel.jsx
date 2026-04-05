import { useState, useEffect, useRef, useCallback } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { MessageSquare, Loader, Plus, ChevronDown, Trash2, MessageCircle, Bot, Square, Zap, X, MoreHorizontal } from 'lucide-react';

/**
 * Working indicator with live timer and stop button.
 * Shows as a single message that counts up, not spammed progress messages.
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

  // Listen for agent shell output to show live stream
  useEffect(() => {
    if (!wsRef?.current) return;
    const handler = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'agent-shell-output') {
        // Strip ANSI codes and clean up for display
        const clean = msg.data
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
          .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, '')
          .replace(/\x1b\][^\x07]*\x07/g, '')
          .replace(/\r/g, '');
        setLiveOutput(prev => {
          const combined = prev + clean;
          // Keep last 3000 chars
          return combined.length > 3000 ? combined.slice(-3000) : combined;
        });
      }
    };
    const ws = wsRef.current;
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef]);

  // Auto-scroll the live output
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

  // Extract meaningful lines from the output (skip JSON, show actions)
  const getDisplayLines = () => {
    if (!liveOutput) return [];
    return liveOutput.split('\n')
      .filter(l => {
        const t = l.trim();
        if (!t) return false;
        if (t.startsWith('{') && t.includes('"type"')) return false; // Skip JSON events
        if (t.startsWith('claude -p')) return false; // Skip command echo
        return true;
      })
      .slice(-8);
  };

  const displayLines = getDisplayLines();

  return (
    <div className="flex justify-start mb-3 px-3">
      <div className="w-full max-w-[85%] rounded-lg border border-surface-700/30 bg-surface-800/40">
        {/* Header */}
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

        {/* Live output stream */}
        {showLive && displayLines.length > 0 && (
          <div
            ref={outputRef}
            className="px-3 pb-2 max-h-32 overflow-y-auto"
          >
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

export default function ChatPanel({ projectId, wsRef, mode = 'agent', tool = 'claude' }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const messagesEndRef = useRef(null);

  // Session state
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [openTabs, setOpenTabs] = useState([]); // Session IDs that are visible as tabs
  const [showSessionList, setShowSessionList] = useState(false);
  const sessionListRef = useRef(null);

  // Close session dropdown on outside click
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
    if (!projectId) { setSessions([]); setActiveSessionId(null); setOpenTabs([]); return; }
    fetch(`/api/projects/${projectId}/chat/sessions`)
      .then(r => r.json())
      .then(data => {
        const list = data.sessions || [];
        setSessions(list);
        if (list.length > 0) {
          // Open the most recent session as a tab
          setOpenTabs([list[0].id]);
          setActiveSessionId(list[0].id);
        } else {
          createNewSession();
        }
      })
      .catch(() => { setSessions([]); setActiveSessionId(null); setOpenTabs([]); });
  }, [projectId]);

  // Load messages when active session changes
  const knownIdsRef = useRef(new Set());
  const busyClearRef = useRef(false);

  // Streaming message state for real-time updates
  const [streamingMessage, setStreamingMessage] = useState(null);
  const streamingChunksRef = useRef('');

  useEffect(() => {
    if (!projectId || !activeSessionId) { setMessages([]); knownIdsRef.current.clear(); return; }
    setLoading(true);
    setSearchResults(null);
    setAgentBusy(false);
    setStreamingMessage(null);
    streamingChunksRef.current = '';

    fetch(`/api/projects/${projectId}/chat?limit=100&sessionId=${activeSessionId}`)
      .then(r => r.json())
      .then(data => {
        const msgs = (data.messages || []).reverse();
        knownIdsRef.current = new Set(msgs.map(m => m.id));
        setMessages(msgs);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [projectId, activeSessionId]);

  // Attach to chat session when it changes (for isolated per-session communication)
  useEffect(() => {
    if (!projectId || !activeSessionId || !wsRef?.current) return;

    const attachToSession = () => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'attach-chat-session',
          chatSessionId: activeSessionId,
          projectId,
        }));
        console.log(`[ChatPanel] Attached to chat session ${activeSessionId}`);
      }
    };

    // Attach immediately if connected
    attachToSession();

    // Re-attach when WebSocket reconnects
    const handleOpen = () => attachToSession();
    wsRef.current?.addEventListener('open', handleOpen);

    return () => {
      wsRef.current?.removeEventListener('open', handleOpen);
    };
  }, [projectId, activeSessionId, wsRef]);

  // Handle streaming message events from WebSocket
  useEffect(() => {
    if (!wsRef?.current) return;

    const handleMessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Only handle messages for our active session
      if (msg.sessionId && msg.sessionId !== activeSessionId) return;

      switch (msg.type) {
        case 'chat-message-stream-start':
          // A new streaming message started
          setStreamingMessage({
            id: msg.messageId,
            role: 'agent',
            content: 'Thinking...',
            createdAt: new Date().toISOString(),
            streaming: true,
          });
          streamingChunksRef.current = '';
          break;

        case 'chat-message-chunk':
          // Append chunk to streaming message
          streamingChunksRef.current += msg.chunk || '';
          // Update display (throttled - only update every 100ms worth of content)
          setStreamingMessage(prev => prev ? {
            ...prev,
            content: streamingChunksRef.current.slice(-2000) || 'Processing...',
          } : null);
          break;

        case 'chat-message-stream-complete':
          // Streaming finished - add the final message
          setStreamingMessage(null);
          streamingChunksRef.current = '';
          if (msg.message) {
            knownIdsRef.current.add(msg.message.id);
            setMessages(prev => [...prev.filter(m => m.id !== msg.messageId), msg.message]);
            setAgentBusy(false);
          }
          break;

        case 'chat-message-recovered':
          // A previously incomplete message was recovered
          if (msg.message) {
            knownIdsRef.current.add(msg.message.id);
            setMessages(prev => {
              const filtered = prev.filter(m => m.id !== msg.message.id);
              return [...filtered, msg.message];
            });
          }
          break;

        case 'chat-session-recovery':
          // Server detected incomplete streaming messages - offer to recover
          console.log('[ChatPanel] Session has incomplete messages:', msg.incompleteMessages);
          // Auto-recover incomplete messages
          for (const incomplete of msg.incompleteMessages || []) {
            wsRef.current?.send(JSON.stringify({
              type: 'recover-streaming-message',
              projectId: msg.projectId,
              sessionId: msg.chatSessionId,
              messageId: incomplete.messageId,
            }));
          }
          break;
      }
    };

    wsRef.current.addEventListener('message', handleMessage);
    return () => wsRef.current?.removeEventListener('message', handleMessage);
  }, [wsRef, activeSessionId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentBusy]);

  // ── SINGLE SOURCE OF TRUTH: Poll API every 2s for new messages ──
  // No WebSocket for messages — polling is 100% reliable
  useEffect(() => {
    if (!projectId || !activeSessionId) return;

    const poll = setInterval(() => {
      fetch(`/api/projects/${projectId}/chat?limit=20&sessionId=${activeSessionId}`)
        .then(r => r.json())
        .then(data => {
          const serverMsgs = (data.messages || []).reverse();
          if (serverMsgs.length === 0) return;

          setMessages(prev => {
            const newMsgs = serverMsgs.filter(m => !knownIdsRef.current.has(m.id));
            if (newMsgs.length === 0) return prev;

            // Track all new IDs
            for (const m of newMsgs) knownIdsRef.current.add(m.id);

            // Remove optimistic pending messages ONLY when the real version exists on the server
            let result = prev.filter(m => {
              if (!m.id.startsWith('pending-')) return true;
              // Only remove if we found the real message in THIS poll batch
              const hasReal = newMsgs.some(sm => sm.role === 'user' && sm.content === m.content);
              return !hasReal;
            });

            const lastUserIdx = result.findLastIndex(m => m.role === 'user');
            const lastUserTime = lastUserIdx >= 0 ? result[lastUserIdx].createdAt : '';

            // Split new messages
            const newProgress = newMsgs.filter(m => m.role === 'progress');
            const newFinal = newMsgs.filter(m => m.role === 'agent' || m.role === 'error');
            const newOther = newMsgs.filter(m => m.role !== 'progress' && m.role !== 'agent' && m.role !== 'error');

            // Only count final messages that are AFTER the last user message as truly new
            const hasNewFinalAfterUser = newFinal.some(m => m.createdAt > lastUserTime);

            // Progress: keep only the latest one after last user
            if (newProgress.length > 0) {
              result = result.filter((m, i) => !(m.role === 'progress' && i > lastUserIdx));
              result.push(newProgress[newProgress.length - 1]);
            }

            // Final response: clear progress, clear busy
            if (hasNewFinalAfterUser) {
              result = result.filter(m => m.role !== 'progress' || result.indexOf(m) <= lastUserIdx);
              // Clear busy OUTSIDE this updater via a ref
              busyClearRef.current = true;
            }

            // Add final + other messages
            result.push(...newFinal, ...newOther);

            return result;
          });

          // Clear busy state outside the updater (side effects not allowed inside)
          if (busyClearRef.current) {
            busyClearRef.current = false;
            setAgentBusy(false);
          }
        })
        .catch(() => {});
    }, 2000);

    return () => clearInterval(poll);
  }, [projectId, activeSessionId]);

  // No WebSocket handlers — polling is the single source of truth for everything.
  // agentBusy is set to true on send, cleared when polling finds agent/error response.

  // ── Session actions ──

  const createNewSession = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const session = await r.json();
      setSessions(prev => [session, ...prev]);
      // Add to open tabs and make active
      setOpenTabs(prev => [...prev, session.id]);
      setActiveSessionId(session.id);
      setMessages([]);
      setShowSessionList(false);
    } catch {}
  }, [projectId]);

  const deleteSession = useCallback(async (sessionId) => {
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, { method: 'DELETE' });
      // Remove from open tabs
      setOpenTabs(prev => prev.filter(id => id !== sessionId));
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== sessionId);
        if (sessionId === activeSessionId) {
          // Switch to another open tab or create new
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

  // Switch to a session tab (doesn't open from dropdown, just switches active)
  const switchToTab = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
  }, []);

  // Open a session from the dropdown (adds to tabs and makes active)
  const openSession = useCallback((sessionId) => {
    if (!openTabs.includes(sessionId)) {
      setOpenTabs(prev => [...prev, sessionId]);
    }
    setActiveSessionId(sessionId);
    setShowSessionList(false);
  }, [openTabs]);

  // Close a tab (removes from tabs but keeps session in history)
  const closeTab = useCallback((sessionId, e) => {
    e?.stopPropagation();
    setOpenTabs(prev => {
      const filtered = prev.filter(id => id !== sessionId);
      // If closing active tab, switch to another
      if (sessionId === activeSessionId) {
        if (filtered.length > 0) {
          setActiveSessionId(filtered[filtered.length - 1]);
        } else {
          // No tabs left, create a new one
          createNewSession();
        }
      }
      return filtered;
    });
  }, [activeSessionId, createNewSession]);

  // Legacy switchSession for backward compatibility
  const switchSession = useCallback((sessionId) => {
    openSession(sessionId);
  }, [openSession]);

  // Sessions not currently open as tabs (for dropdown)
  const closedSessions = sessions.filter(s => !openTabs.includes(s.id));

  // ── Send ──

  const handleSend = useCallback((content) => {
    if (!projectId || !activeSessionId) return;

    const optimistic = {
      id: 'pending-' + Date.now(),
      projectId,
      sessionId: activeSessionId,
      role: 'user',
      content,
      metadata: { mode },
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setAgentBusy(true);

    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-send',
        projectId,
        sessionId: activeSessionId,
        content,
        mode,
        tool,
      }));
      // No timeout — polling clears busy when response arrives
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
  }, [projectId, activeSessionId, mode, tool, wsRef]);

  const handleSearch = useCallback(async (query) => {
    if (!query || !projectId) { setSearchResults(null); return; }
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/search?q=${encodeURIComponent(query)}&sessionId=${activeSessionId || ''}`);
      const data = await r.json();
      setSearchResults(data.messages || []);
    } catch {
      setSearchResults([]);
    }
  }, [projectId, activeSessionId]);

  const displayMessages = searchResults || messages;
  const activeSession = sessions.find(s => s.id === activeSessionId);

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

  // Get session data for tabs
  const openTabSessions = openTabs.map(id => sessions.find(s => s.id === id)).filter(Boolean);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Session tabs bar */}
      <div className="flex items-center border-b border-surface-700/50 bg-surface-850/60" style={{ flexShrink: 0 }}>
        {/* Tab strip - horizontally scrollable */}
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-none min-w-0">
          {openTabSessions.map((s, idx) => (
            <div
              key={s.id}
              onClick={() => switchToTab(s.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-surface-700/30 min-w-0 max-w-[180px] transition-colors ${
                s.id === activeSessionId
                  ? 'bg-surface-800 text-surface-100'
                  : 'bg-surface-850/80 text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'
              }`}
            >
              <MessageCircle size={11} className={s.id === activeSessionId ? 'text-primary-400 flex-shrink-0' : 'text-surface-600 flex-shrink-0'} />
              <span className="truncate text-[11px]">{s.name || 'Chat'}</span>
              {/* Close tab button */}
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

          {/* New tab button */}
          <button
            onClick={createNewSession}
            className="p-1.5 text-surface-500 hover:text-primary-400 hover:bg-surface-700/50 transition-colors flex-shrink-0"
            title="New conversation"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Right side controls */}
        <div className="flex items-center gap-0.5 px-1 border-l border-surface-700/30 flex-shrink-0">
          {/* History dropdown - shows closed sessions */}
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
                {/* Header */}
                <div className="px-3 py-2 text-[10px] text-surface-500 uppercase tracking-wider border-b border-surface-700/50 bg-surface-850/50">
                  {closedSessions.length > 0 ? 'Closed Sessions' : 'All Sessions Open'}
                </div>

                {closedSessions.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto">
                    {closedSessions.map(s => (
                      <div
                        key={s.id}
                        onClick={() => openSession(s.id)}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] cursor-pointer transition-colors group text-surface-300 hover:bg-surface-750"
                      >
                        <MessageCircle size={11} className="text-surface-600" />
                        <span className="flex-1 truncate">{s.name}</span>
                        <span className="text-[9px] text-surface-600 flex-shrink-0 tabular-nums">
                          {s.messageCount || 0} msg
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                          className="p-0.5 text-surface-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                          title="Delete permanently"
                        >
                          <Trash2 size={10} />
                        </button>
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

          {/* Skills quick access */}
          <button
            onClick={() => window.open('/skills', '_blank')}
            className="p-1.5 rounded text-surface-500 hover:text-purple-400 hover:bg-surface-700/50 transition-colors"
            title="Manage skills & plugins"
          >
            <Zap size={14} />
          </button>
        </div>
      </div>

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

        {/* Streaming message preview - shows real-time response as it arrives */}
        {streamingMessage && (
          <ChatMessage
            key={streamingMessage.id}
            message={streamingMessage}
            wsRef={wsRef}
            projectId={projectId}
            onSend={handleSend}
          />
        )}

        {/* Working indicator with timer and stop button */}
        {agentBusy && !streamingMessage && <WorkingIndicator wsRef={wsRef} projectId={projectId} sessionId={activeSessionId} />}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        mode={mode}
        onSend={handleSend}
        onSearch={handleSearch}
        busy={agentBusy}
      />
    </div>
  );
}
