import { useState, useEffect, useRef, useCallback } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { MessageSquare, Loader, Plus, ChevronDown, Trash2, MessageCircle, Bot, Square } from 'lucide-react';

/**
 * Working indicator with live timer and stop button.
 * Shows as a single message that counts up, not spammed progress messages.
 */
function WorkingIndicator({ wsRef, projectId, sessionId }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    setElapsed(0);
    const interval = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleStop = () => {
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat-stop', projectId, sessionId }));
    }
  };

  const formatTime = (s) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  return (
    <div className="flex justify-start mb-3 px-3">
      <div className="flex items-center gap-3 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-2">
        <Bot size={13} className="text-primary-400" />
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
          <span className="text-[11px] text-surface-300">AI assistant working...</span>
          <span className="text-[11px] text-surface-500 tabular-nums ml-1">{formatTime(elapsed)}</span>
        </div>
        <button
          onClick={handleStop}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-red-400 hover:bg-red-500/10 transition-colors"
          title="Stop"
        >
          <Square size={9} />
          Stop
        </button>
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
    if (!projectId) { setSessions([]); setActiveSessionId(null); return; }
    fetch(`/api/projects/${projectId}/chat/sessions`)
      .then(r => r.json())
      .then(data => {
        const list = data.sessions || [];
        setSessions(list);
        if (list.length > 0) {
          setActiveSessionId(list[0].id);
        } else {
          createNewSession();
        }
      })
      .catch(() => { setSessions([]); setActiveSessionId(null); });
  }, [projectId]);

  // Load messages when active session changes
  const knownIdsRef = useRef(new Set());
  const busyClearRef = useRef(false);

  useEffect(() => {
    if (!projectId || !activeSessionId) { setMessages([]); knownIdsRef.current.clear(); return; }
    setLoading(true);
    setSearchResults(null);
    setAgentBusy(false);
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

            // Remove optimistic pending messages that now have real versions
            let result = prev.filter(m => {
              if (!m.id.startsWith('pending-')) return true;
              return !serverMsgs.some(sm => sm.role === 'user' && sm.content === m.content);
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
      setActiveSessionId(session.id);
      setMessages([]);
      setShowSessionList(false);
    } catch {}
  }, [projectId]);

  const deleteSession = useCallback(async (sessionId) => {
    if (!projectId) return;
    try {
      await fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, { method: 'DELETE' });
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== sessionId);
        if (sessionId === activeSessionId) {
          if (filtered.length > 0) {
            setActiveSessionId(filtered[0].id);
          } else {
            createNewSession();
          }
        }
        return filtered;
      });
    } catch {}
  }, [projectId, activeSessionId, createNewSession]);

  const switchSession = useCallback((sessionId) => {
    setActiveSessionId(sessionId);
    setShowSessionList(false);
  }, []);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Session bar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-surface-700/50 bg-surface-850/60" style={{ flexShrink: 0 }}>
        {/* Session selector dropdown */}
        <div className="relative" ref={sessionListRef}>
          <button
            onClick={() => setShowSessionList(!showSessionList)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-surface-300 hover:text-surface-100 hover:bg-surface-700/50 transition-colors"
          >
            <MessageCircle size={11} className="text-surface-500" />
            <span className="truncate max-w-[200px]">{activeSession?.name || 'Chat'}</span>
            <ChevronDown size={10} className="text-surface-500" />
          </button>

          {showSessionList && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-surface-800 border border-surface-700 rounded-lg shadow-modal z-50 overflow-hidden animate-scale-in">
              {/* New session button inside dropdown */}
              <button
                onClick={createNewSession}
                className="flex items-center gap-2 w-full px-3 py-2 text-[11px] text-primary-400 hover:bg-surface-750 border-b border-surface-700/50 transition-colors"
              >
                <Plus size={13} />
                New conversation
              </button>

              <div className="max-h-56 overflow-y-auto">
                {sessions.map(s => (
                  <div
                    key={s.id}
                    onClick={() => switchSession(s.id)}
                    className={`flex items-center gap-2 px-3 py-2 text-[11px] cursor-pointer transition-colors group ${
                      s.id === activeSessionId
                        ? 'bg-primary-500/10 text-primary-300'
                        : 'text-surface-300 hover:bg-surface-750'
                    }`}
                  >
                    <MessageCircle size={11} className={s.id === activeSessionId ? 'text-primary-400' : 'text-surface-600'} />
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="text-[9px] text-surface-600 flex-shrink-0 tabular-nums">
                      {s.messageCount || 0} msg
                    </span>
                    {sessions.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                        className="p-0.5 text-surface-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Quick new session button (always visible) */}
        <button
          onClick={createNewSession}
          className="p-1 rounded text-surface-500 hover:text-primary-400 hover:bg-surface-700/50 transition-colors"
          title="New conversation"
        >
          <Plus size={14} />
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Search result count */}
        {searchResults && (
          <span className="text-[10px] text-surface-500">{searchResults.length} result{searchResults.length !== 1 ? 's' : ''}</span>
        )}
      </div>

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

        {/* Working indicator with timer and stop button */}
        {agentBusy && <WorkingIndicator wsRef={wsRef} projectId={projectId} sessionId={activeSessionId} />}

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
