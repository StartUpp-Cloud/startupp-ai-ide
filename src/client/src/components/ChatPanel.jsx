import { useState, useEffect, useRef, useCallback } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import { MessageSquare, Loader, Plus, ChevronDown, Trash2, MessageCircle, Bot } from 'lucide-react';

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
  useEffect(() => {
    if (!projectId || !activeSessionId) { setMessages([]); return; }
    setLoading(true);
    setSearchResults(null);
    setAgentBusy(false);
    fetch(`/api/projects/${projectId}/chat?limit=100&sessionId=${activeSessionId}`)
      .then(r => r.json())
      .then(data => {
        setMessages((data.messages || []).reverse());
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [projectId, activeSessionId]);

  // Scroll to bottom on new messages or when busy state changes
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentBusy]);

  // Polling fallback: while agent is busy, poll API every 5s for new messages
  // This catches responses even if the WebSocket disconnected
  useEffect(() => {
    if (!agentBusy || !projectId || !activeSessionId) return;

    const poll = setInterval(() => {
      fetch(`/api/projects/${projectId}/chat?limit=5&sessionId=${activeSessionId}`)
        .then(r => r.json())
        .then(data => {
          const latest = (data.messages || []).reverse();
          if (latest.length === 0) return;

          // Check if there's a newer agent/error message we don't have
          const lastKnownId = messages.length > 0 ? messages[messages.length - 1].id : null;
          const newMsgs = latest.filter(m =>
            m.role !== 'user' && m.role !== 'progress' &&
            !messages.some(existing => existing.id === m.id)
          );

          if (newMsgs.length > 0) {
            setMessages(prev => {
              const ids = new Set(prev.map(m => m.id));
              const toAdd = newMsgs.filter(m => !ids.has(m.id));
              return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
            });
            setAgentBusy(false);
          }
        })
        .catch(() => {});
    }, 5000);

    return () => clearInterval(poll);
  }, [agentBusy, projectId, activeSessionId, messages]);

  // Listen for real-time chat messages via WebSocket
  useEffect(() => {
    if (!wsRef?.current) return;

    const handler = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'chat-message' && msg.message?.projectId === projectId) {
        if (!msg.message.sessionId || msg.message.sessionId === activeSessionId) {
          // Skip user messages — we already added them optimistically
          if (msg.message.role === 'user') return;
          setMessages(prev => [...prev, msg.message]);
          if (msg.message.role === 'agent' || msg.message.role === 'error') {
            setAgentBusy(false);
          }
        }
      }
      if (msg.type === 'chat-progress' && msg.projectId === projectId) {
        if (!msg.message?.sessionId || msg.message.sessionId === activeSessionId) {
          setMessages(prev => {
            const copy = [...prev];
            const lastProgressIdx = copy.findLastIndex(m => m.role === 'progress');
            if (lastProgressIdx >= 0 && msg.message) {
              copy[lastProgressIdx] = msg.message;
            } else if (msg.message) {
              copy.push(msg.message);
            }
            return copy;
          });
        }
      }
      if (msg.type === 'agent-status' && msg.projectId === projectId) {
        setAgentBusy(msg.busy);
      }
    };

    const ws = wsRef.current;
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, projectId, activeSessionId]);

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
      setTimeout(() => setAgentBusy(prev => prev ? false : prev), 60000);
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
            <ChatMessage key={msg.id} message={msg} wsRef={wsRef} projectId={projectId} />
          ))
        )}

        {/* Thinking indicator — inline at the bottom of the chat stream */}
        {agentBusy && (
          <div className="flex justify-start mb-3 px-3">
            <div className="flex items-center gap-2.5 rounded-lg border border-surface-700/30 bg-surface-800/40 px-3 py-2">
              <Bot size={13} className="text-primary-400" />
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" style={{ animationDelay: '200ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" style={{ animationDelay: '400ms' }} />
              </div>
              <span className="text-[11px] text-surface-400">Thinking...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        mode={mode}
        onSend={handleSend}
        onSearch={handleSearch}
        disabled={agentBusy}
      />
    </div>
  );
}
