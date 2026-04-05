import { useState, useRef, useEffect } from 'react';
import { Send, Search, X } from 'lucide-react';

export default function ChatInput({ mode, onSend, onSearch, disabled = false, busy = false }) {
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSearch = (q) => {
    setSearchQuery(q);
    onSearch?.(q);
  };

  const placeholder = busy
    ? 'Type to queue a follow-up message... (Ctrl+Enter to send)'
    : mode === 'plan'
      ? 'Describe what you want to build... (Ctrl+Enter to send)'
      : 'Tell the agent what to do... (Ctrl+Enter to send)';

  return (
    <div className="flex-shrink-0 border-t border-surface-700 bg-surface-850/80 px-3 py-2">
      {searching && (
        <div className="flex items-center gap-2 mb-2">
          <Search size={14} className="text-surface-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search chat history..."
            className="flex-1 bg-surface-800 border border-surface-700 rounded px-2 py-1 text-sm text-surface-200 outline-none focus:border-primary-500/50"
            autoFocus
          />
          <button onClick={() => { setSearching(false); setSearchQuery(''); handleSearch(''); }}>
            <X size={14} className="text-surface-500 hover:text-surface-200" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <button
          onClick={() => setSearching(!searching)}
          className="p-1.5 text-surface-500 hover:text-surface-200 rounded"
          title="Search chat"
        >
          <Search size={16} />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 resize-none outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/20 disabled:opacity-40 placeholder:text-surface-500 transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className={`p-2 rounded-lg transition-colors ${
            text.trim() && !disabled
              ? mode === 'plan'
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-surface-800 text-surface-600'
          }`}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
