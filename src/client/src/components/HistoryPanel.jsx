import { useState, useEffect } from 'react';
import {
  History,
  MessageSquare,
  User,
  Bot,
  Search,
  ChevronDown,
  ChevronRight,
  Clock,
  Trash2,
  Copy,
  Check,
  X,
} from 'lucide-react';

export default function HistoryPanel({ sessionId, projectId }) {
  const [histories, setHistories] = useState([]);
  const [currentHistory, setCurrentHistory] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [expandedHistories, setExpandedHistories] = useState({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(null);

  // Load histories
  useEffect(() => {
    if (projectId) {
      loadProjectHistories();
    } else {
      loadAllHistories();
    }
  }, [projectId]);

  // Load current session history
  useEffect(() => {
    if (sessionId) {
      loadSessionHistory(sessionId);
    }
  }, [sessionId]);

  const loadAllHistories = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/history');
      const data = await res.json();
      setHistories(data);
    } catch (error) {
      console.error('Failed to load histories:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectHistories = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/history/project/${projectId}`);
      const data = await res.json();
      setHistories(data);
    } catch (error) {
      console.error('Failed to load project histories:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionHistory = async (sessionId) => {
    try {
      const res = await fetch(`/api/history/session/${sessionId}`);
      const data = await res.json();
      setCurrentHistory(data);
      setExpandedHistories(prev => ({ ...prev, [sessionId]: true }));
    } catch (error) {
      console.error('Failed to load session history:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const url = projectId
        ? `/api/history/search?q=${encodeURIComponent(searchQuery)}&projectId=${projectId}`
        : `/api/history/search?q=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(url);
      const data = await res.json();
      setSearchResults(data);
    } catch (error) {
      console.error('Failed to search:', error);
    }
  };

  const deleteHistory = async (sessionId) => {
    if (!confirm('Delete this conversation history?')) return;

    try {
      await fetch(`/api/history/session/${sessionId}`, { method: 'DELETE' });
      setHistories(prev => prev.filter(h => h.sessionId !== sessionId));
      if (currentHistory?.sessionId === sessionId) {
        setCurrentHistory(null);
      }
    } catch (error) {
      console.error('Failed to delete history:', error);
    }
  };

  const copyEntry = async (content) => {
    await navigator.clipboard.writeText(content);
    setCopied(content);
    setTimeout(() => setCopied(null), 2000);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700">
        <History className="w-4 h-4 text-primary-400" />
        <span className="text-sm font-medium text-surface-200">History</span>
        <span className="text-xs text-surface-500">
          ({histories.length} sessions)
        </span>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-surface-700">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search history..."
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-primary-500"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-surface-500 hover:text-surface-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Search Results */}
        {searchResults.length > 0 && (
          <div className="p-2 border-b border-surface-700">
            <p className="text-xs text-surface-400 mb-2">
              Search results ({searchResults.length})
            </p>
            <div className="space-y-2">
              {searchResults.map((result, i) => (
                <div
                  key={i}
                  className="p-2 bg-surface-800 rounded border border-surface-700 hover:border-surface-600 cursor-pointer"
                  onClick={() => loadSessionHistory(result.sessionId)}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    {result.entry.role === 'user' ? (
                      <User className="w-3 h-3 text-blue-400" />
                    ) : (
                      <Bot className="w-3 h-3 text-green-400" />
                    )}
                    <span className="text-[10px] text-surface-500">
                      {result.entry.role}
                    </span>
                  </div>
                  <p className="text-xs text-surface-300 line-clamp-2">
                    {result.entry.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Current Session History */}
        {currentHistory && currentHistory.entries?.length > 0 && (
          <div className="border-b border-surface-700">
            <button
              onClick={() =>
                setExpandedHistories(prev => ({
                  ...prev,
                  [currentHistory.sessionId]: !prev[currentHistory.sessionId],
                }))
              }
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-800 transition-colors"
            >
              {expandedHistories[currentHistory.sessionId] ? (
                <ChevronDown className="w-3 h-3 text-surface-500" />
              ) : (
                <ChevronRight className="w-3 h-3 text-surface-500" />
              )}
              <MessageSquare className="w-3.5 h-3.5 text-green-400" />
              <span className="text-xs font-medium text-surface-200 flex-1 text-left">
                Current Session
              </span>
              <span className="text-[10px] text-surface-500">
                {currentHistory.entries.length} messages
              </span>
            </button>

            {expandedHistories[currentHistory.sessionId] && (
              <div className="px-3 pb-2 space-y-2">
                {currentHistory.entries.slice(-20).map((entry, i) => (
                  <div
                    key={entry.id || i}
                    className={`p-2 rounded text-xs ${
                      entry.role === 'user'
                        ? 'bg-blue-500/10 border border-blue-500/20'
                        : entry.role === 'assistant'
                        ? 'bg-green-500/10 border border-green-500/20'
                        : 'bg-surface-800 border border-surface-700'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {entry.role === 'user' ? (
                          <User className="w-3 h-3 text-blue-400" />
                        ) : entry.role === 'assistant' ? (
                          <Bot className="w-3 h-3 text-green-400" />
                        ) : (
                          <MessageSquare className="w-3 h-3 text-surface-400" />
                        )}
                        <span className="text-[10px] text-surface-500 capitalize">
                          {entry.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-surface-600">
                          {formatTime(entry.timestamp)}
                        </span>
                        <button
                          onClick={() => copyEntry(entry.content)}
                          className="p-0.5 hover:bg-surface-700 rounded"
                        >
                          {copied === entry.content ? (
                            <Check className="w-3 h-3 text-green-400" />
                          ) : (
                            <Copy className="w-3 h-3 text-surface-500" />
                          )}
                        </button>
                      </div>
                    </div>
                    <p className="text-surface-300 whitespace-pre-wrap line-clamp-4">
                      {entry.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Past Sessions */}
        {histories.filter(h => h.sessionId !== currentHistory?.sessionId).length > 0 && (
          <div className="p-2">
            <p className="text-xs text-surface-400 mb-2">Past Sessions</p>
            <div className="space-y-1">
              {histories
                .filter(h => h.sessionId !== currentHistory?.sessionId)
                .map((history) => (
                  <div
                    key={history.sessionId}
                    className="p-2 bg-surface-800 rounded border border-surface-700 hover:border-surface-600 group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <button
                        onClick={() => loadSessionHistory(history.sessionId)}
                        className="flex items-center gap-1.5 text-left flex-1"
                      >
                        <MessageSquare className="w-3 h-3 text-surface-400" />
                        <span className="text-xs text-surface-300 truncate">
                          {history.firstMessage || 'Session'}
                        </span>
                      </button>
                      <button
                        onClick={() => deleteHistory(history.sessionId)}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-opacity"
                      >
                        <Trash2 className="w-3 h-3 text-red-400" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-surface-500">
                      <Clock className="w-3 h-3" />
                      <span>{formatTime(history.lastActivity)}</span>
                      <span>•</span>
                      <span>{history.messageCount} messages</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {histories.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-32 text-center p-4">
            <History className="w-8 h-8 text-surface-600 mb-2" />
            <p className="text-xs text-surface-400">No history yet</p>
            <p className="text-[10px] text-surface-500">
              Start a conversation to build history
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
