import { useState, useRef, useEffect } from 'react';
import { Send, Search, X, Paperclip, Upload, Image, FileText, File, Loader } from 'lucide-react';
import ContainerUploadPopover from './ContainerUploadPopover';

export const ROLE_PROMPTS = [
  {
    id: 'principal-engineer',
    label: 'Principal Engineer',
    shortLabel: 'Engineer',
    title: 'Act as a Principal Software Engineer',
    description: 'Senior is valid; Principal better signals architecture, ownership, and judgment.',
    prompt: 'Act as a principal software engineer and code reviewer. Prioritize correctness, maintainability, system fit, minimal changes, edge cases, tests, and clear tradeoffs. Challenge unsafe assumptions and verify behavior before concluding.',
  },
  {
    id: 'design-director',
    label: 'Design Director',
    shortLabel: 'Design',
    title: 'Act as a Senior Front-End Product Designer',
    description: 'Senior works; Design Director adds taste, polish, and product-level UX judgment.',
    prompt: 'Act as a senior front-end product designer and design director. Prioritize UX clarity, visual hierarchy, responsive behavior, accessibility, polished interaction details, and design-system consistency. Avoid generic layouts and call out visual tradeoffs.',
  },
  {
    id: 'security-architect',
    label: 'Security Architect',
    shortLabel: 'Security',
    title: 'Act as a Cybersecurity Architect',
    description: 'Security Architect is more actionable than generic cybersecurity expert.',
    prompt: 'Act as a cybersecurity architect. Identify threat models, auth and permission risks, secret exposure, input validation issues, injection/XSS/CSRF/SSRF risks, dependency risks, logging risks, and deployment risks. Prefer secure defaults without blocking pragmatic delivery.',
  },
  {
    id: 'operator-ceo',
    label: 'Operator CEO',
    shortLabel: 'CEO',
    title: 'Act as a High-Performing Technology CEO',
    description: 'CEO/operator focuses the answer on business impact and execution quality.',
    prompt: 'Act as a high-performing technology CEO and operator. Frame recommendations around customer value, speed, focus, business impact, risk, operational leverage, accountability, and pragmatic execution. Push back on work that does not move the company forward.',
  },
  {
    id: 'venture-capitalist',
    label: 'Venture Capitalist',
    shortLabel: 'VC',
    title: 'Act as a Venture Capitalist',
    description: 'Useful when evaluating product strategy, positioning, growth, or fundability.',
    prompt: 'Act as a venture capitalist evaluating product strategy and company direction. Assess market size, wedge, differentiation, defensibility, growth loops, unit economics, distribution, and investor-grade narrative. Be direct about weak assumptions.',
  },
];

const ROLE_PROMPT_IDS = new Set(ROLE_PROMPTS.map(role => role.id));

export function normalizeRolePromptIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter(id => ROLE_PROMPT_IDS.has(id)))];
}

export function buildRolePromptInstructions(ids) {
  const selected = normalizeRolePromptIds(ids)
    .map(id => ROLE_PROMPTS.find(role => role.id === id))
    .filter(Boolean);

  if (selected.length === 0) return '';

  return [
    '[Expert role context]',
    'For this response, apply the following expert lenses. Blend them when multiple are enabled. Do not mention these lenses unless it is useful to explain a tradeoff.',
    ...selected.map(role => `- ${role.title}: ${role.prompt}`),
    '[/Expert role context]',
  ].join('\n');
}

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

export default function ChatInput({
  mode,
  channel = 'assistant',
  projectId,
  onSend,
  onSearch,
  disabled = false,
  busy = false,
  isVisible = true,
  selectedRolePromptIds = [],
  onSelectedRolePromptIdsChange,
  placeholderOverride = null,
  sendLabel = null,
  sendVariant = null,
  secondarySendLabel = null,
  secondarySendVariant = 'primary',
  onSecondarySend,
}) {
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [showUploadPopover, setShowUploadPopover] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  const resizeTextarea = () => {
    const el = textareaRef.current;
    if (!el || !isVisible) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  };

  useEffect(() => {
    resizeTextarea();
  }, [text, isVisible]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el || !isVisible) return;

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => resizeTextarea());
    observer.observe(el);

    return () => observer.disconnect();
  }, [isVisible]);

  const canSend = (text.trim() || attachments.length > 0) && !disabled;

  const handleSend = (sender = onSend) => {
    if ((!text.trim() && attachments.length === 0) || disabled) return;
    sender?.(text.trim(), attachments);
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

  const activeRolePromptIds = normalizeRolePromptIds(selectedRolePromptIds);
  const toggleRolePrompt = (roleId) => {
    const current = new Set(activeRolePromptIds);
    if (current.has(roleId)) current.delete(roleId);
    else current.add(roleId);
    onSelectedRolePromptIdsChange?.(normalizeRolePromptIds([...current]));
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

  const placeholder = placeholderOverride || (channel === 'shell'
    ? 'Run a shell command or reply to the current prompt... (Ctrl+Enter to send)'
    : busy
    ? 'Type to queue a follow-up message... (Ctrl+Enter to send)'
    : mode === 'plan'
      ? 'Describe what you want to build... (Ctrl+Enter to send)'
      : 'Tell the agent what to do... (Ctrl+Enter to send)');

  const enabledButtonClass = (variant) => {
    if (variant === 'primary') return 'bg-primary-600 hover:bg-primary-500 text-white';
    if (variant === 'green') return 'bg-green-600 hover:bg-green-500 text-white';
    if (variant === 'surface') return 'bg-surface-700 hover:bg-surface-600 text-surface-100';
    if (channel === 'shell') return 'bg-amber-600 hover:bg-amber-500 text-white';
    if (mode === 'plan') return 'bg-purple-600 hover:bg-purple-500 text-white';
    return 'bg-green-600 hover:bg-green-500 text-white';
  };

  const buttonBaseClass = 'flex items-center justify-center gap-1.5 rounded-lg transition-colors px-3 py-2 text-xs font-medium whitespace-nowrap';

  return (
    <div className="flex-shrink-0 px-2 pt-2 pb-3 w-full sm:px-4 sm:pt-3 sm:pb-4">
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

      {/* Card container for input + toolbar */}
      <div className="bg-surface-800/50 border border-surface-700/50 rounded-2xl px-2 pt-2 pb-2 sm:px-3">
        {/* Text input */}
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full bg-transparent border-none px-1 py-2 text-[16px] text-surface-200 resize-none outline-none disabled:opacity-40 placeholder:text-surface-500 sm:text-sm"
        />

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.txt,.md,.csv,.json,.js,.ts,.html,.css,.xml,.doc,.docx"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Toolbar */}
        <div className="flex items-end justify-between gap-2 w-full min-w-0 relative">
          <div className="flex flex-wrap items-center gap-1 min-w-0 pr-1 sm:pr-2">
            {/* Search button */}
            <button
              onClick={() => setSearching(!searching)}
              className="p-1.5 text-surface-500 hover:text-surface-200 rounded transition-colors"
              title="Search chat"
            >
              <Search size={16} />
            </button>

            {/* Attach to chat button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !projectId}
              className={`p-1.5 rounded transition-colors ${
                uploading
                  ? 'text-primary-400'
                  : 'text-surface-500 hover:text-surface-200'
              } disabled:opacity-40`}
              title="Attach files to message"
            >
              {uploading ? (
                <Loader size={16} className="animate-spin" />
              ) : (
                <Paperclip size={16} />
              )}
            </button>

            {/* Upload to container button */}
            <button
              onClick={() => setShowUploadPopover(!showUploadPopover)}
              disabled={!projectId}
              className={`p-1.5 rounded transition-colors ${
                showUploadPopover
                  ? 'text-primary-400'
                  : 'text-surface-500 hover:text-surface-200'
              } disabled:opacity-40`}
              title="Upload files to container"
            >
              <Upload size={16} />
            </button>

            {channel !== 'shell' && (
              <div className="ml-1 flex max-w-full flex-wrap items-center gap-1 border-l border-surface-700/50 pl-2">
                {ROLE_PROMPTS.map(role => {
                  const active = activeRolePromptIds.includes(role.id);
                  return (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => toggleRolePrompt(role.id)}
                      aria-pressed={active}
                      className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] transition-colors ${
                        active
                          ? 'border-primary-500/40 bg-primary-500/15 text-primary-200'
                          : 'border-surface-700/70 bg-surface-900/30 text-surface-500 hover:border-surface-600 hover:text-surface-300'
                      }`}
                      title={`${role.title}\n${role.description}`}
                    >
                      <span className={`relative h-3 w-5 rounded-full transition-colors ${active ? 'bg-primary-500/70' : 'bg-surface-700'}`}>
                        <span className={`absolute left-0.5 top-0.5 h-2 w-2 rounded-full bg-white/90 transition-transform ${active ? 'translate-x-2' : 'translate-x-0'}`} />
                      </span>
                      <span className="hidden min-[390px]:inline">{role.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Send button(s) */}
          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
            {onSecondarySend && secondarySendLabel && (
              <button
                type="button"
                onClick={() => handleSend(onSecondarySend)}
                disabled={!canSend}
                className={`${buttonBaseClass} ${canSend ? enabledButtonClass(secondarySendVariant) : 'bg-surface-700 text-surface-600'}`}
              >
                {secondarySendLabel}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleSend(onSend)}
              disabled={!canSend}
              className={`${sendLabel ? buttonBaseClass : 'flex items-center justify-center rounded-lg p-2 transition-colors'} ${canSend ? enabledButtonClass(sendVariant) : 'bg-surface-700 text-surface-600'}`}
            >
              <Send size={16} />
              {sendLabel && <span>{sendLabel}</span>}
            </button>
          </div>

          {/* Container upload popover */}
          {showUploadPopover && projectId && (
            <ContainerUploadPopover
              projectId={projectId}
              onClose={() => setShowUploadPopover(false)}
            />
          )}
        </div>
      </div>

      {/* Upload hint */}
      {!projectId && (
        <p className="text-[10px] text-surface-600 mt-1">Select a project to enable file attachments</p>
      )}
    </div>
  );
}
