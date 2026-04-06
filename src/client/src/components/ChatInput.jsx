import { useState, useRef, useEffect } from 'react';
import { Send, Search, X, Paperclip, Image, FileText, File, Loader } from 'lucide-react';

const FILE_ICONS = {
  image: Image,
  pdf: FileText,
  text: FileText,
  default: File,
};

function getFileIcon(type) {
  if (type.startsWith('image/')) return FILE_ICONS.image;
  if (type === 'application/pdf') return FILE_ICONS.pdf;
  if (type.startsWith('text/')) return FILE_ICONS.text;
  return FILE_ICONS.default;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ChatInput({ mode, projectId, onSend, onSearch, disabled = false, busy = false }) {
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const handleSend = () => {
    if ((!text.trim() && attachments.length === 0) || disabled) return;
    onSend(text.trim(), attachments);
    setText('');
    setAttachments([]);
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

  const handleFileSelect = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !projectId) return;

    setUploading(true);
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));

    try {
      const res = await fetch(`/api/files/upload/${projectId}`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        console.error('Upload failed:', err.message);
        return;
      }

      const data = await res.json();
      setAttachments(prev => [...prev, ...data.attachments]);
    } catch (err) {
      console.error('Upload error:', err);
    } finally {
      setUploading(false);
      // Reset input so the same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = async (attachment) => {
    // Remove from UI immediately
    setAttachments(prev => prev.filter(a => a.id !== attachment.id));

    // Delete from server (fire and forget)
    if (projectId) {
      fetch(`/api/files/upload/${projectId}/${attachment.id}`, { method: 'DELETE' }).catch(() => {});
    }
  };

  const placeholder = busy
    ? 'Type to queue a follow-up message... (Ctrl+Enter to send)'
    : mode === 'plan'
      ? 'Describe what you want to build... (Ctrl+Enter to send)'
      : 'Tell the agent what to do... (Ctrl+Enter to send)';

  return (
    <div className="flex-shrink-0 border-t border-surface-700 bg-surface-850/80 px-3 py-2">
      {/* Search bar */}
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

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {attachments.map(att => {
            const Icon = getFileIcon(att.type);
            const isImage = att.type.startsWith('image/');

            return (
              <div
                key={att.id}
                className="relative group flex items-center gap-1.5 px-2 py-1.5 bg-surface-800 border border-surface-700 rounded-lg text-xs"
              >
                {isImage ? (
                  <img src={att.url} alt={att.name} className="w-8 h-8 rounded object-cover" />
                ) : (
                  <Icon size={14} className="text-surface-400" />
                )}
                <div className="flex flex-col min-w-0 max-w-[120px]">
                  <span className="truncate text-surface-300">{att.name}</span>
                  <span className="text-[9px] text-surface-500">{formatFileSize(att.size)}</span>
                </div>
                <button
                  onClick={() => removeAttachment(att)}
                  className="p-0.5 rounded hover:bg-surface-700 text-surface-500 hover:text-red-400 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        {/* Search button */}
        <button
          onClick={() => setSearching(!searching)}
          className="p-1.5 text-surface-500 hover:text-surface-200 rounded"
          title="Search chat"
        >
          <Search size={16} />
        </button>

        {/* Attach file button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !projectId}
          className={`p-1.5 rounded transition-colors ${
            uploading
              ? 'text-primary-400'
              : 'text-surface-500 hover:text-surface-200'
          } disabled:opacity-40`}
          title="Attach files (images, PDF, text)"
        >
          {uploading ? (
            <Loader size={16} className="animate-spin" />
          ) : (
            <Paperclip size={16} />
          )}
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.html,.css,.xml,.doc,.docx"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Text input */}
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

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={(!text.trim() && attachments.length === 0) || disabled}
          className={`p-2 rounded-lg transition-colors ${
            (text.trim() || attachments.length > 0) && !disabled
              ? mode === 'plan'
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-surface-800 text-surface-600'
          }`}
        >
          <Send size={16} />
        </button>
      </div>

      {/* Upload hint */}
      {!projectId && (
        <p className="text-[10px] text-surface-600 mt-1">Select a project to enable file attachments</p>
      )}
    </div>
  );
}
