import { useState, useEffect, useRef, useCallback } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import ModeToggle from './ModeToggle';
import { MessageSquare, Loader } from 'lucide-react';

export default function ChatPanel({ projectId, wsRef }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem('agent-mode') || 'agent');
  const [agentBusy, setAgentBusy] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const messagesEndRef = useRef(null);

  // Persist mode preference
  useEffect(() => {
    localStorage.setItem('agent-mode', mode);
  }, [mode]);

  // Load messages when project changes
  useEffect(() => {
    if (!projectId) { setMessages([]); return; }
    setLoading(true);
    setSearchResults(null);
    setAgentBusy(false);
    fetch(`/api/projects/${projectId}/chat?limit=100`)
      .then(r => r.json())
      .then(data => {
        // API returns newest-first, reverse for chronological display
        setMessages((data.messages || []).reverse());
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for real-time chat messages via WebSocket
  useEffect(() => {
    if (!wsRef?.current) return;

    const handler = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'chat-message' && msg.message?.projectId === projectId) {
        setMessages(prev => [...prev, msg.message]);
        if (msg.message.role === 'agent' || msg.message.role === 'error') {
          setAgentBusy(false);
        }
      }
      if (msg.type === 'chat-progress' && msg.projectId === projectId) {
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
      if (msg.type === 'agent-status' && msg.projectId === projectId) {
        setAgentBusy(msg.busy);
      }
    };

    const ws = wsRef.current;
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, projectId]);

  const handleSend = useCallback((content) => {
    if (!projectId) return;

    // Optimistically add user message
    const optimistic = {
      id: 'pending-' + Date.now(),
      projectId,
      role: 'user',
      content,
      metadata: { mode },
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setAgentBusy(true);

    // Send via WebSocket for real-time processing
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-send',
        projectId,
        content,
        mode,
      }));
    }
  }, [projectId, mode, wsRef]);

  const handleSearch = useCallback(async (query) => {
    if (!query || !projectId) { setSearchResults(null); return; }
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/search?q=${encodeURIComponent(query)}`);
      const data = await r.json();
      setSearchResults(data.messages || []);
    } catch {
      setSearchResults([]);
    }
  }, [projectId]);

  const displayMessages = searchResults || messages;

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600">
        <div className="text-center">
          <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
          <p>Select a project to start</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900/90">
        <ModeToggle mode={mode} onChange={setMode} />
        {agentBusy && (
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <Loader size={12} className="animate-spin" />
            Working...
          </div>
        )}
        {searchResults && (
          <span className="text-xs text-gray-500">{searchResults.length} results</span>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader size={24} className="animate-spin text-gray-600" />
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            {searchResults ? 'No results found' : 'Start a conversation...'}
          </div>
        ) : (
          displayMessages.map(msg => (
            <ChatMessage key={msg.id} message={msg} wsRef={wsRef} projectId={projectId} />
          ))
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
