import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput, { buildRolePromptInstructions, normalizeRolePromptIds } from './ChatInput';
import BranchBar from './BranchBar';
import InternalConsole from './InternalConsole';
import SalesforceInlineWorkspace from './salesforce/SalesforceInlineWorkspace';
import { MessageSquare, Loader, Plus, ChevronDown, ChevronUp, Trash2, MessageCircle, Bot, Square, Zap, X, MoreHorizontal, Pin, Pencil, Check, Terminal, GitBranch, Cloud, ArrowLeft, Info, BookOpen, RefreshCw, Copy, CheckCircle2, Circle, XCircle, MinusCircle } from 'lucide-react';
import ModeToggle from './ModeToggle';
import {
  CLI_TOOLS,
  getToolConfig,
  getToolEffortOptions,
  getToolModelOptions,
  supportsEffortSelection,
  supportsModelSelection,
} from '../utils/sessionAssistantOptions';

const VISIBLE_SESSION_HEALTH_INTERVAL_MS = 5000;
const NOT_BUSY_CLEAR_GRACE_MS = 12000;
const CHAT_HISTORY_LOOKBACK_DAYS = 7;
const CHAT_HISTORY_PAGE_SIZE = 100;

function chatHistorySinceIso() {
  return new Date(Date.now() - CHAT_HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Format job progress for display
 */
function formatJobProgress(progress) {
  if (!progress) return null;

  if (progress.summary) {
    return progress.summary;
  }

  if (progress.status === 'error' && progress.detail) {
    const detail = progress.detail.length > 60
      ? progress.detail.slice(0, 60) + '...'
      : progress.detail;
    return `Progress error: ${detail}`;
  }

  return null;
}

function formatProgressLineTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function mergeChangedFiles(current = [], incoming = []) {
  const byPath = new Map();
  for (const file of current) {
    if (file?.path) byPath.set(file.path, { path: file.path, status: file.status || 'M' });
  }
  for (const file of incoming) {
    if (file?.path) byPath.set(file.path, { path: file.path, status: file.status || 'M' });
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, 80);
}

function getSessionMode(session, fallback = 'agent') {
  return session?.mode || fallback || 'agent';
}

function getSessionStatus(session, { expanded = false, active = false } = {}) {
  if (session?.pending || session?.busy || session?.working) {
    return { label: 'In Progress', color: 'bg-blue-400', text: 'text-blue-300', ring: 'ring-blue-400/20', pulse: true };
  }
  if (session?.waitingForInput || session?.needsInput || session?.awaitingFeedback) {
    return { label: 'Waiting for feedback', color: 'bg-amber-400', text: 'text-amber-300', ring: 'ring-amber-400/20', pulse: false };
  }
  if (session?.hasUnread || (session?.messageCount > 0 && !active && !expanded)) {
    return { label: 'Done', color: 'bg-green-400', text: 'text-green-300', ring: 'ring-green-400/20', pulse: session?.hasUnread };
  }
  return { label: 'Stand By', color: 'bg-surface-500', text: 'text-surface-400', ring: 'ring-surface-600/20', pulse: false };
}

function getSessionTimeValue(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortSessionsOldestFirst(a, b) {
  return getSessionTimeValue(a?.createdAt || a?.updatedAt) - getSessionTimeValue(b?.createdAt || b?.updatedAt);
}

function formatSessionTimestamp(value) {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No timestamp';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getSessionStarterText(session) {
  const value = session?.starter || session?.matchSnippet || session?.name || 'New thread';
  return String(value).replace(/\s+/g, ' ').trim();
}

function collectChangedFilesFromMessages(messages = [], liveChangedFiles = []) {
  let files = mergeChangedFiles([], liveChangedFiles);
  for (const message of messages) {
    const metadata = message?.metadata || {};
    const changedFiles = Array.isArray(metadata.changedFiles) ? metadata.changedFiles : [];
    if (changedFiles.length > 0) files = mergeChangedFiles(files, changedFiles);
  }
  return files;
}

function getRepoDeployHint(repo) {
  const scripts = repo?.scripts || {};
  const deployScripts = Array.isArray(repo?.deployScripts) ? repo.deployScripts : [];
  const script = deployScripts[0] || ['deploy', 'release', 'publish'].find(name => scripts[name]);
  if (script) return `${repo.packageManager || 'npm'} run ${script}`;
  if (repo?.hasVercel) return 'Vercel project detected via vercel.json';
  if (repo?.hasNetlify) return 'Netlify project detected via netlify.toml';
  if (repo?.hasCompose) return 'Docker Compose project detected';
  if (repo?.hasDockerfile) return 'Dockerfile detected';
  return 'No deploy signal was detected; inspect the stack before choosing a deploy path.';
}

function buildMainThreadRepoActionMessage(action, repo) {
  const path = repo?.path || '/workspace';
  const name = repo?.name || path.split('/').pop() || 'workspace';
  if (action === 'deploy') {
    return `Deploy ${name} from ${path}. Use the existing project conventions and detected deployment signal: ${getRepoDeployHint(repo)}. Confirm the target command before running anything destructive, execute the safest production deployment flow available, then summarize the result here in the main thread.`;
  }
  return `Push ${name} from ${path}. Inspect git status, commit any relevant completed changes if needed, push to the tracked remote without force pushing, and summarize the result here in the main thread.`;
}

function useTypedLine(text, enabled) {
  const fullText = String(text || '');
  const [typedText, setTypedText] = useState(enabled ? '' : fullText);

  useEffect(() => {
    if (!enabled) {
      setTypedText(fullText);
      return undefined;
    }

    let index = 0;
    setTypedText('');
    const timer = setInterval(() => {
      index = Math.min(fullText.length, index + 6);
      setTypedText(fullText.slice(0, index));
      if (index >= fullText.length) clearInterval(timer);
    }, 12);

    return () => clearInterval(timer);
  }, [enabled, fullText]);

  return typedText;
}

function ProgressTranscriptLine({ entry, latest }) {
  const text = useTypedLine(entry.content, latest);
  const isTyping = latest && text.length < String(entry.content || '').length;

  return (
    <div className="flex gap-2 border-t border-surface-700/30 py-1.5 first:border-t-0 first:pt-0 last:pb-0">
      <span className="w-[70px] flex-shrink-0 font-mono text-[10px] tabular-nums text-surface-500">
        {formatProgressLineTime(entry.createdAt)}
      </span>
      <span className="min-w-0 flex-1 text-surface-300">
        {text}
        {isTyping && <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-primary-300" />}
      </span>
    </div>
  );
}

function ProgressTranscriptBubble({ entries, changedFiles = [], wsRef, projectId, sessionId }) {
  if (!entries.length) return null;

  const handleStop = () => {
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat-stop', projectId, sessionId }));
    }
  };

  return (
    <div className="flex justify-start mb-3 px-3">
      <div className="w-full max-w-[85%] rounded-lg border border-surface-700/35 bg-surface-900/45 px-3 py-2">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-surface-500">
          <Loader size={12} className="animate-spin text-primary-400" />
          <span>Live progress</span>
          <span className="text-surface-600">{entries.length} update{entries.length === 1 ? '' : 's'}</span>
          <button
            onClick={handleStop}
            className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-400 transition-colors hover:bg-red-500/10"
          >
            <Square size={9} />
            Stop
          </button>
        </div>
        <div className="font-mono text-[11px] leading-relaxed">
          {entries.map((entry, index) => (
            <ProgressTranscriptLine key={entry.id} entry={entry} latest={index === entries.length - 1} />
          ))}
        </div>
        {changedFiles.length > 0 && (
          <div className="mt-2 border-t border-surface-700/35 pt-2">
            <div className="mb-1 text-[10px] uppercase tracking-wide text-surface-500">Files edited in this session</div>
            <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
              {changedFiles.slice(0, 16).map(file => (
                <span key={`${file.status}:${file.path}`} className="rounded border border-surface-700/60 bg-surface-950/45 px-1.5 py-0.5 font-mono text-[10px] text-surface-300">
                  <span className="mr-1 text-primary-300">{file.status}</span>{file.path}
                </span>
              ))}
              {changedFiles.length > 16 && <span className="px-1.5 py-0.5 text-[10px] text-surface-500">+{changedFiles.length - 16} more</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function mergeSessionLists(current, incoming) {
  const byId = new Map(current.map(session => [session.id, session]));
  const currentIds = new Set(current.map(session => session.id));

  for (const session of incoming) {
    if (!session?.id) continue;
    byId.set(session.id, { ...(byId.get(session.id) || {}), ...session });
  }

  const merged = current.map(session => byId.get(session.id));
  for (const session of incoming) {
    if (session?.id && !currentIds.has(session.id)) merged.push(byId.get(session.id));
  }
  return merged;
}

function SessionBubble({
  session,
  active,
  editing,
  editingName,
  editInputRef,
  onEditingNameChange,
  onFinishEditing,
  onCancelEditing,
  onOpen,
  onCollapse,
  onTogglePin,
  onStartEditing,
  onDelete,
  compactPreview = false,
  collapsed = false,
}) {
  const status = getSessionStatus(session, { expanded: active, active });
  const timestamp = formatSessionTimestamp(session?.createdAt || session?.updatedAt);
  const name = session?.name || 'Chat';
  const starterText = getSessionStarterText(session);
  const showStarterPreview = starterText && name !== starterText;

  const handleOpen = () => {
    if (!editing) onOpen?.(session);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpen();
        }
      }}
      className={`group max-w-full cursor-pointer rounded-2xl border text-left shadow-sm transition-all duration-500 ${collapsed ? 'px-2 py-1.5' : 'px-3 py-2'} ${
        active
          ? 'border-primary-500/45 bg-primary-500/10 ring-1 ring-primary-500/20'
          : session?.pinned
          ? 'border-amber-500/25 bg-amber-500/5 hover:border-amber-400/40 hover:bg-amber-500/10'
          : 'border-surface-700/55 bg-surface-850/75 hover:border-surface-600 hover:bg-surface-800/80'
      }`}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${active ? 'bg-primary-500/20 text-primary-200' : 'bg-surface-700/70 text-surface-300'}`}>
          <MessageCircle size={collapsed ? 12 : 14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 flex min-w-0 items-center gap-2">
            <span className={`min-w-0 flex-1 truncate font-semibold text-surface-100 transition-all duration-500 ${collapsed ? 'text-[11px]' : 'text-sm'}`} title={name}>{name}</span>
            <span className={`flex-shrink-0 text-[10px] tabular-nums text-surface-500 transition-opacity duration-500 ${collapsed ? 'hidden' : ''}`}>{timestamp}</span>
          </div>
          {editing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editingName}
              onChange={(event) => onEditingNameChange?.(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onFinishEditing?.();
                if (event.key === 'Escape') onCancelEditing?.();
              }}
              onBlur={onFinishEditing}
              onClick={(event) => event.stopPropagation()}
              className="w-full rounded border border-surface-600 bg-surface-900 px-2 py-1 text-xs text-surface-100 outline-none focus:border-primary-500"
              placeholder="Session name..."
            />
          ) : (
            <div
              className={`mt-1 overflow-hidden break-words transition-all duration-500 ${
                collapsed ? 'h-6 text-[10px] leading-3 text-surface-500' : 'h-10 text-xs leading-5 text-surface-400'
              }`}
              title={starterText}
            >
              {showStarterPreview ? (
                <div className={collapsed || compactPreview ? 'line-clamp-2' : ''}>{starterText}</div>
              ) : (
                <span className="text-surface-700">&nbsp;</span>
              )}
            </div>
          )}
          {session?.matchSnippet && session?.matchType === 'content' && (
            <div className={`mt-1 truncate text-[11px] text-surface-500 transition-opacity duration-500 ${collapsed ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>{session.matchSnippet}</div>
          )}
        </div>
      </div>

      <div className={`${collapsed ? 'mt-1 pl-8' : 'mt-2 pl-9'} flex min-w-0 items-center gap-2 text-[10px] text-surface-500 transition-all duration-500`}>
        <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 ${collapsed ? 'text-[8px]' : 'text-[9px]'} ${status.text}`} title={status.label}>
          <span className={`h-1.5 w-1.5 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
          {status.label}
        </span>
        {session?.pinned && <Pin size={collapsed ? 9 : 11} className="flex-shrink-0 -rotate-45 text-amber-400" />}
        {session?.branch && (
          <span className={`flex min-w-0 items-center gap-0.5 rounded bg-green-500/10 px-1 py-0.5 font-mono text-[9px] text-green-400 ${collapsed ? 'max-w-[6.5rem]' : 'max-w-[12rem]'}`} title={`Branch: ${session.branch}`}>
            <GitBranch size={8} />
            <span className="truncate">{session.branch}</span>
          </span>
        )}
        <span className={`transition-opacity duration-500 ${collapsed ? 'hidden' : ''}`}>{session?.messageCount || 0} msg</span>
        {session?.hasUnread && !active && <span className="rounded-full bg-primary-500/15 px-1.5 py-0.5 text-primary-300">new</span>}
        {!session?.pending && !collapsed && (
          <div className="ml-auto flex items-center gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
            <button
              type="button"
              onClick={(event) => onTogglePin?.(session.id, event)}
              className={`rounded p-1 transition-colors ${session?.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-surface-500 hover:text-amber-400'}`}
              title={session?.pinned ? 'Unpin session' : 'Pin session'}
            >
              <Pin size={11} className={session?.pinned ? '-rotate-45' : ''} />
            </button>
            <button
              type="button"
              onClick={(event) => onStartEditing?.(session.id, name, event)}
              className="rounded p-1 text-surface-500 transition-colors hover:text-surface-200"
              title="Rename session"
            >
              <Pencil size={11} />
            </button>
            {active ? (
              <button
                type="button"
                onClick={(event) => onCollapse?.(session.id, event)}
                className="rounded p-1 text-surface-500 transition-colors hover:bg-surface-700 hover:text-surface-200"
                title="Collapse thread"
              >
                <X size={12} />
              </button>
            ) : (
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); onDelete?.(session.id); }}
                className="rounded p-1 text-surface-700 transition-colors hover:text-red-400"
                title="Delete permanently"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SessionBubbleDock({
  sessions,
  mainSession,
  activeSessionId,
  editingSessionId,
  editingName,
  editInputRef,
  onEditingNameChange,
  onFinishEditing,
  onCancelEditing,
  onOpenSession,
  onOpenMain,
  onCollapseSession,
  onTogglePin,
  onStartEditing,
  onDeleteSession,
  historySearch,
  onHistorySearchChange,
  historySearchLoading,
  hasHistorySearch,
  onLoadArchived,
  variant = 'dock',
  scrollSignal = 0,
}) {
  const orderedSessions = useMemo(() => [...sessions].sort(sortSessionsOldestFirst), [sessions]);
  const normalSessions = orderedSessions.filter(session => !session?.pinned);
  const pinnedSessions = orderedSessions.filter(session => session?.pinned);
  const mainStatus = getSessionStatus(mainSession, { expanded: mainSession?.id === activeSessionId, active: mainSession?.id === activeSessionId });
  const scrollRef = useRef(null);
  const didInitialScrollRef = useRef(false);
  const isSidebar = variant === 'sidebar';
  const isMain = variant === 'main';
  const containerClass = isSidebar
    ? 'flex max-h-64 min-h-0 w-full flex-col border-b border-surface-700/50 bg-surface-950/80 md:h-full md:max-h-none md:w-80 md:flex-shrink-0 md:border-b-0 md:border-r lg:w-96'
    : isMain
    ? 'flex h-full min-h-0 flex-col bg-surface-950/30 px-4 py-4'
    : 'flex-shrink-0 border-t border-surface-700/50 px-3 py-2 shadow-[0_-10px_30px_rgba(0,0,0,0.22)]';
  const headerClass = isSidebar
    ? 'border-b border-surface-700/50 px-3 py-3'
    : isMain
    ? 'pb-3'
    : 'mb-2 flex flex-col gap-2 sm:flex-row sm:items-center';
  const scrollClass = isSidebar
    ? 'min-h-0 flex-1 overflow-y-auto px-3 py-3'
    : isMain
    ? 'min-h-0 flex-1 overflow-y-auto pb-4'
    : 'max-h-52 overflow-y-auto pr-1 sm:max-h-60';

  useEffect(() => {
    didInitialScrollRef.current = false;
  }, [variant, hasHistorySearch, scrollSignal]);

  useEffect(() => {
    if (didInitialScrollRef.current || historySearchLoading || orderedSessions.length === 0) return undefined;
    didInitialScrollRef.current = true;

    const scrollToBottom = () => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    };

    const rafId = requestAnimationFrame(scrollToBottom);
    const timeoutIds = [0, 80, 240, 600].map(delay => setTimeout(scrollToBottom, delay));
    return () => {
      cancelAnimationFrame(rafId);
      timeoutIds.forEach(clearTimeout);
    };
  }, [orderedSessions.length, historySearchLoading, variant, hasHistorySearch, scrollSignal]);

  const renderBubble = (session) => (
    <SessionBubble
      key={session.id}
      session={session}
      active={session.id === activeSessionId}
      editing={editingSessionId === session.id}
      editingName={editingName}
      editInputRef={editInputRef}
      onEditingNameChange={onEditingNameChange}
      onFinishEditing={onFinishEditing}
      onCancelEditing={onCancelEditing}
      onOpen={onOpenSession}
      onCollapse={onCollapseSession}
      onTogglePin={onTogglePin}
      onStartEditing={onStartEditing}
      onDelete={onDeleteSession}
      compactPreview={variant === 'main'}
    />
  );

  return (
    <div className={containerClass}>
      {mainSession && !isSidebar && (
        <button
          type="button"
          onClick={onOpenMain}
          className={`mx-0 mb-2 flex w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition-all ${
            mainSession.id === activeSessionId
              ? 'border-primary-500/45 bg-primary-500/10 text-surface-100 shadow-[0_0_24px_rgba(14,165,233,0.12)]'
              : 'border-surface-700/70 bg-surface-900/70 text-surface-300 hover:border-surface-600 hover:bg-surface-850'
          } ${isSidebar ? 'mt-3 md:mx-3 md:w-auto' : ''}`}
        >
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-300">
            <Bot size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold">Main thread</span>
              <span className={`h-1.5 w-1.5 rounded-full ${mainStatus.color} ${mainStatus.pulse ? 'animate-pulse' : ''}`} />
              <span className={`text-[10px] ${mainStatus.text}`}>{mainStatus.label}</span>
            </div>
            <div className="truncate text-[11px] text-surface-500">Project memory, review queue, and starting point for new work</div>
          </div>
        </button>
      )}
      <div className={headerClass}>
        <div className={`${isSidebar || isMain ? 'mb-2' : ''} flex min-w-0 items-center gap-2`}>
          <MessageSquare size={isMain ? 16 : 13} className="text-primary-400" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-surface-400">Thread sessions</span>
          <span className="text-[10px] text-surface-600">oldest to newest</span>
        </div>
        {isMain && (
          <div className="mb-3 rounded-2xl border border-surface-800 bg-surface-900/40 px-4 py-3">
            <div className="text-sm font-medium text-surface-200">Main chat</div>
            <div className="mt-1 text-xs leading-5 text-surface-500">Open a child session below, or return to the main thread as the project home base.</div>
          </div>
        )}
        <div className={`flex min-w-0 items-center gap-2 ${isSidebar ? 'flex-col sm:flex-row md:flex-col lg:flex-row' : 'flex-1 sm:ml-auto sm:max-w-md'}`}>
          <input
            type="text"
            value={historySearch}
            onChange={(event) => onHistorySearchChange?.(event.target.value)}
            placeholder="Search sessions..."
            className={`min-w-0 flex-1 rounded-full border border-surface-700 bg-surface-900 px-3 py-1 text-[11px] text-surface-200 outline-none placeholder:text-surface-600 focus:border-primary-500/60 ${isSidebar ? 'w-full' : ''}`}
          />
        </div>
      </div>

      <div ref={scrollRef} className={scrollClass}>
        {historySearchLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-surface-800 bg-surface-900/50 px-3 py-4 text-xs text-surface-500">
            <Loader size={13} className="animate-spin" />
            Searching sessions...
          </div>
        ) : orderedSessions.length > 0 ? (
          <div className="space-y-2">
            {normalSessions.length > 0 ? normalSessions.map(renderBubble) : (
              <div className="rounded-xl border border-dashed border-surface-700 px-3 py-3 text-center text-xs text-surface-600">
                {hasHistorySearch ? 'No matching unpinned sessions' : 'No child sessions yet'}
              </div>
            )}

            {pinnedSessions.length > 0 && (
              <div className="border-t border-surface-700/50 pt-2">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-300/80">
                  <Pin size={10} className="-rotate-45" />
                  Pinned sessions stay at the bottom
                </div>
                <div className="space-y-2">{pinnedSessions.map(renderBubble)}</div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-surface-700 px-3 py-4 text-center text-xs text-surface-600">
            {hasHistorySearch ? 'No matching sessions found' : 'No child sessions yet. Use the main thread as home base.'}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onLoadArchived}
        className={`${isSidebar ? 'mx-3 mb-3 w-auto' : 'mt-2 w-full'} rounded-lg border border-surface-800 px-3 py-1.5 text-center text-[10px] text-surface-500 transition-colors hover:border-surface-700 hover:bg-surface-900 hover:text-surface-300`}
      >
        Load older sessions
      </button>
    </div>
  );
}

function MainThreadSessionBubbles({
  sessions,
  activeSessionId,
  editingSessionId,
  editingName,
  editInputRef,
  onEditingNameChange,
  onFinishEditing,
  onCancelEditing,
  onOpenSession,
  onCollapseSession,
  onTogglePin,
  onStartEditing,
  onDeleteSession,
  onLoadArchived,
  collapsed = false,
}) {
  const orderedSessions = useMemo(() => [...sessions].sort(sortSessionsOldestFirst), [sessions]);
  const normalSessions = orderedSessions.filter(session => !session?.pinned);
  const pinnedSessions = orderedSessions.filter(session => session?.pinned);

  if (orderedSessions.length === 0) return null;

  const renderBubble = (session) => (
    <SessionBubble
      key={session.id}
      session={session}
      active={session.id === activeSessionId}
      editing={editingSessionId === session.id}
      editingName={editingName}
      editInputRef={editInputRef}
      onEditingNameChange={onEditingNameChange}
      onFinishEditing={onFinishEditing}
      onCancelEditing={onCancelEditing}
      onOpen={onOpenSession}
      onCollapse={onCollapseSession}
      onTogglePin={onTogglePin}
      onStartEditing={onStartEditing}
      onDelete={onDeleteSession}
      compactPreview
      collapsed={collapsed}
    />
  );

  return (
    <div className={`${collapsed ? 'mx-2' : 'mx-3'} my-4 border-t border-surface-800/80 pt-3 transition-all duration-500`}>
      <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-wide text-surface-500">
        <MessageSquare size={12} className="text-primary-400" />
        <span>Threads</span>
        <span className={`text-surface-600 transition-opacity duration-500 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>open a session bubble to continue it</span>
      </div>
      <div className="space-y-2">
        {normalSessions.map(renderBubble)}
        {pinnedSessions.length > 0 && (
          <div className="border-t border-surface-800/80 pt-2">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-300/80">
              <Pin size={10} className="-rotate-45" />
              Pinned threads
            </div>
            <div className="space-y-2">{pinnedSessions.map(renderBubble)}</div>
          </div>
        )}
      </div>
      {onLoadArchived && (
        <button
          type="button"
          onClick={onLoadArchived}
          className="mt-2 rounded-lg border border-surface-800 px-3 py-1.5 text-[10px] text-surface-500 transition-all duration-500 hover:border-surface-700 hover:bg-surface-900 hover:text-surface-300"
        >
          Load older sessions
        </button>
      )}
    </div>
  );
}

function ProjectContextPanel({ projectId, project, onClose, onStartSession }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadOverview = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/context/${projectId}/overview?memoryLimit=50&handoffLimit=20`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load project context');
      setOverview(data);
    } catch (err) {
      setError(err.message || 'Failed to load project context');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const contextPack = overview?.contextPack || '';
  const status = overview?.status || { level: 'building', label: 'Building', reason: 'Context is still being collected.' };
  const statusClass = status.level === 'ready'
    ? 'border-green-500/30 bg-green-500/10 text-green-200'
    : status.level === 'partial'
      ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
      : 'border-surface-700 bg-surface-900 text-surface-300';
  const memoryItems = overview?.memories || [];
  const handoffs = overview?.handoffs || [];
  const rules = overview?.project?.rules || [];
  const build = overview?.buildSystem;
  const scripts = build?.scripts ? Object.keys(build.scripts).slice(0, 8) : [];

  const copyPack = useCallback(async () => {
    if (!contextPack) return;
    try {
      await navigator.clipboard.writeText(contextPack);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }, [contextPack]);

  const startContextSession = useCallback(() => {
    if (!contextPack) return;
    onStartSession?.(`${contextPack}\n\n[User Request]\nUse this context as the handoff for a fresh AI coding session. Briefly confirm the current project state and ask what to tackle next if no clear next step is listed.`);
  }, [contextPack, onStartSession]);

  return (
    <div className="absolute inset-0 z-50 flex bg-surface-950/80 backdrop-blur-sm">
      <div className="ml-auto flex h-full w-full max-w-3xl flex-col border-l border-surface-700 bg-surface-950 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-surface-700 px-4 py-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-primary-400/25 bg-primary-500/10 text-primary-300">
            <BookOpen size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-surface-100">Project Context</div>
            <div className="truncate text-xs text-surface-500">{project?.name || overview?.project?.name || 'Project'} knowledge, memory, and handoff pack</div>
          </div>
          <button
            type="button"
            onClick={loadOverview}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900 px-3 py-1.5 text-[11px] text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-surface-700 bg-surface-900 p-2 text-surface-400 transition-colors hover:text-surface-100"
            title="Close project context"
          >
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-surface-500">
              <Loader size={16} className="animate-spin" />
              Loading project context...
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">{error}</div>
          ) : (
            <div className="space-y-4">
              <div className={`rounded-2xl border px-4 py-3 ${statusClass}`}>
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <span>{status.label}</span>
                  <span className="text-[11px] font-normal opacity-80">generated {overview?.generatedAt ? new Date(overview.generatedAt).toLocaleString() : 'now'}</span>
                </div>
                <div className="mt-1 text-xs leading-5 opacity-90">{status.reason}</div>
              </div>

              <section className="rounded-2xl border border-surface-800 bg-surface-900/45 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">What This Project Is</div>
                <p className="text-sm leading-6 text-surface-200">
                  {overview?.project?.description || 'No project description has been captured yet. The context will improve as main thread and child sessions complete work.'}
                </p>
                <div className="mt-3 grid gap-2 text-xs text-surface-500 sm:grid-cols-2">
                  <div>Stack: <span className="text-surface-300">{overview?.project?.stack || 'generic'}</span></div>
                  <div>Sessions: <span className="text-surface-300">{overview?.sessions?.childCount || 0} child / {overview?.sessions?.total || 0} total</span></div>
                  {overview?.project?.containerName && <div>Container: <span className="text-surface-300">{overview.project.containerName}</span></div>}
                  {overview?.project?.repos?.length > 0 && <div>Repos: <span className="text-surface-300">{overview.project.repos.length}</span></div>}
                </div>
              </section>

              <section className="rounded-2xl border border-surface-800 bg-surface-900/45 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Build And Tooling</div>
                {build ? (
                  <div className="space-y-1 text-sm text-surface-300">
                    <div>{[build.language, build.framework, build.testRunner].filter(Boolean).join(' / ') || 'No build details detected'}</div>
                    <div className="text-xs text-surface-500">Package manager: {build.packageManager || 'unknown'}</div>
                    {scripts.length > 0 && <div className="text-xs text-surface-500">Scripts: {scripts.join(', ')}</div>}
                  </div>
                ) : (
                  <div className="text-sm text-surface-500">Build details are not available yet for this project.</div>
                )}
              </section>

              <section className="rounded-2xl border border-surface-800 bg-surface-900/45 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-surface-400">Durable Memory</div>
                  <span className="text-[11px] text-surface-600">{memoryItems.length} item{memoryItems.length === 1 ? '' : 's'}</span>
                </div>
                {memoryItems.length > 0 ? (
                  <div className="space-y-2">
                    {memoryItems.slice(0, 10).map(memory => (
                      <div key={memory.id} className="rounded-xl border border-surface-800 bg-surface-950/50 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-primary-300">{memory.type} / {memory.category}</div>
                        <div className="mt-1 text-sm leading-5 text-surface-200">{memory.content}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-surface-700 px-3 py-3 text-sm text-surface-500">No durable memory yet. Completed sessions will slowly populate this.</div>
                )}
              </section>

              <section className="rounded-2xl border border-surface-800 bg-surface-900/45 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Recent Session Handoffs</div>
                {handoffs.length > 0 ? (
                  <div className="space-y-2">
                    {handoffs.slice(0, 8).map(handoff => (
                      <div key={handoff.id} className="rounded-xl border border-surface-800 bg-surface-950/50 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-medium text-surface-100">{handoff.name}</div>
                          {handoff.tool && <span className="rounded bg-surface-800 px-1.5 py-0.5 text-[10px] text-surface-400">{handoff.tool}</span>}
                          {handoff.branch && <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-300">{handoff.branch}</span>}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-surface-400">{handoff.summary || handoff.starter || 'No handoff summary captured yet.'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-surface-700 px-3 py-3 text-sm text-surface-500">No child session handoffs yet.</div>
                )}
              </section>

              {rules.length > 0 && (
                <section className="rounded-2xl border border-surface-800 bg-surface-900/45 p-4">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Project Rules</div>
                  <div className="space-y-1 text-sm text-surface-300">
                    {rules.slice(0, 8).map((rule, index) => <div key={`${index}-${rule}`}>{index + 1}. {rule}</div>)}
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-surface-800 bg-surface-900/45 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="mr-auto text-xs font-semibold uppercase tracking-wide text-surface-400">Context Pack</div>
                  <button
                    type="button"
                    onClick={copyPack}
                    disabled={!contextPack}
                    className="inline-flex items-center gap-1.5 rounded-full border border-surface-700 bg-surface-950 px-3 py-1.5 text-[11px] text-surface-300 transition-colors hover:border-surface-600 hover:text-surface-100 disabled:opacity-50"
                  >
                    <Copy size={12} />
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={startContextSession}
                    disabled={!contextPack || !onStartSession}
                    className="inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                  >
                    <Plus size={12} />
                    Start handoff session
                  </button>
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-surface-800 bg-surface-950/70 p-3 text-[11px] leading-5 text-surface-300">{contextPack || 'No context pack available yet.'}</pre>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Working indicator with live timer and stop button.
 */
// Renders a single check row with a status icon. Shared by the live panel and
// the final message render.
function CheckRow({ check, active }) {
  const status = active && check.status === 'active' ? 'active' : check.status;
  const Icon = status === 'active' ? Loader
    : status === 'done' ? CheckCircle2
    : status === 'fail' ? XCircle
    : status === 'skip' ? MinusCircle
    : Circle;
  const color = status === 'active' ? 'text-primary-300'
    : status === 'done' ? 'text-emerald-400'
    : status === 'fail' ? 'text-red-400'
    : status === 'skip' ? 'text-amber-400'
    : 'text-surface-500';
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className={`mt-0.5 flex-shrink-0 ${color} ${status === 'active' ? 'animate-spin' : ''}`} />
      <div className="min-w-0">
        <div className={`text-[12px] leading-snug ${status === 'active' ? 'text-surface-100' : 'text-surface-300'}`}>
          {check.verify && <span className="mr-1.5 rounded bg-surface-700/60 px-1 py-px text-[9px] uppercase tracking-wide text-surface-400">verify</span>}
          {check.label}
        </div>
        {status === 'active' && check.detail && (
          <div className="mt-0.5 text-[11px] leading-snug text-surface-400 line-clamp-2">{check.detail}</div>
        )}
      </div>
    </div>
  );
}

// Live checklist shown while the agent works — discrete steps fill in, the
// current one spins with a short "what's happening now" detail. Replaces the
// wall-of-reasoning "status conversation".
function LiveChecksPanel({ checks }) {
  if (!checks || checks.length === 0) return null;
  const done = checks.filter(c => c.status === 'done' || c.status === 'fail' || c.status === 'skip').length;
  return (
    <div className="mx-4 mb-2 rounded-xl border border-primary-500/20 bg-primary-500/5 px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium text-primary-200">
        <Loader size={12} className="animate-spin" />
        Working — {done}/{checks.length} checks
      </div>
      <div className="space-y-1.5">
        {checks.map((c, i) => (
          <CheckRow key={c.id ?? i} check={c} active={i === checks.length - 1} />
        ))}
      </div>
    </div>
  );
}

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

function OrchestratorRunIndicator({ run }) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!run || !['running', 'planning', 'executing'].includes(run.status)) return undefined;
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, [run?.id, run?.status]);

  if (!run) return null;

  const started = new Date(run.startedAt || Date.now()).getTime();
  const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const tasks = run.tasks || [];
  const done = tasks.filter(t => t.status === 'completed').length;
  const total = tasks.length;

  const statusIcon = (status) => {
    if (status === 'completed') return { Icon: CheckCircle2, cls: 'text-emerald-400', spin: false };
    if (status === 'running' || status === 'retrying') return { Icon: Loader, cls: 'text-primary-300', spin: true };
    if (status === 'blocked' || status === 'failed' || status === 'cancelled') return { Icon: XCircle, cls: 'text-red-400', spin: false };
    return { Icon: Circle, cls: 'text-surface-500', spin: false };
  };

  return (
    <div className="mx-3 mb-2 rounded-lg border border-primary-500/25 bg-primary-500/10 px-3 py-2 text-xs text-primary-100">
      <div className="flex items-center gap-2">
        <Bot size={13} className="text-primary-300" />
        <span className="font-medium">AI orchestrator</span>
        <span className="text-primary-300 capitalize">{run.phase || run.status}</span>
        <span className="ml-auto tabular-nums text-primary-200">
          {total > 0 ? `${done}/${total} · ` : ''}{mins}m {String(secs).padStart(2, '0')}s
        </span>
      </div>
      {total > 0 ? (
        <div className="mt-1.5 space-y-1">
          {tasks.map((t) => {
            const { Icon, cls, spin } = statusIcon(t.status);
            return (
              <div key={t.id} className="flex items-start gap-2">
                <Icon size={12} className={`mt-0.5 flex-shrink-0 ${cls} ${spin ? 'animate-spin' : ''}`} />
                <span className={t.status === 'completed' ? 'text-primary-200/70' : 'text-primary-100'}>{t.title}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-1 text-[11px] text-primary-200/80">Planning tasks…</div>
      )}
    </div>
  );
}

function dedupeModelOptions(options) {
  const seen = new Set();
  return options.filter((option) => {
    if (!option.value || option.disabled) return true;
    if (seen.has(option.value)) return false;
    seen.add(option.value);
    return true;
  });
}

function MainThreadHeader({ project, session }) {
  const settings = [session?.tool, session?.model, session?.effort].filter(Boolean).join(' / ');
  const tooltip = 'Main thread is the durable project home base. Use it for project memory, summaries, coordination, and starting child sessions. Child sessions inherit these defaults unless changed.';

  return (
    <div className="border-b border-surface-700/45 px-3 py-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-primary-400/25 text-primary-300">
          <Bot size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-sm font-semibold text-surface-100">Main thread</div>
            <span className="truncate text-[11px] text-surface-500">{project?.name || 'Project'} home base</span>
          </div>
        </div>
        <span className="hidden truncate text-[10px] text-surface-500 sm:inline" title={settings || 'Default assistant'}>
          Defaults: {settings || 'Default assistant'}
        </span>
        <button
          type="button"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-surface-700 bg-surface-900 text-surface-400"
          title={tooltip}
        >
          <Info size={13} />
        </button>
      </div>
    </div>
  );
}

function ChildThreadHeader({ project, session, mainSession, onOpenMain, onCloseSession }) {
  const status = getSessionStatus(session, { expanded: true, active: true });
  const sessionName = session?.name || 'Thread';

  return (
    <div className="border-b border-surface-700/45 bg-surface-950/95 px-3 py-2 shadow-[0_6px_18px_rgba(0,0,0,0.18)] sm:px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          onClick={onOpenMain}
          disabled={!mainSession?.id}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-[11px] font-medium text-surface-300 transition-colors hover:border-primary-500/45 hover:bg-primary-500/10 hover:text-primary-200 disabled:cursor-not-allowed disabled:opacity-50"
          title="Back to main thread"
        >
          <ArrowLeft size={13} />
          <span className="hidden sm:inline">Back</span>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <MessageCircle size={14} className="flex-shrink-0 text-primary-400" />
            <span className="truncate text-sm font-semibold text-surface-100">{sessionName}</span>
            <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
            <span className={`hidden text-[10px] sm:inline ${status.text}`}>{status.label}</span>
          </div>
          <div className="truncate text-[11px] text-surface-500">
            {project?.name || 'Project'} child session
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseSession}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-[11px] font-medium text-surface-300 transition-colors hover:border-red-500/45 hover:bg-red-500/10 hover:text-red-200"
          title="Close this child session"
        >
          <X size={13} />
          <span className="hidden sm:inline">Close</span>
        </button>
      </div>
    </div>
  );
}

function SessionAssistantControls({ session, defaultTool, disabled = false, projectId, onUpdate, channel = 'assistant', onChannelChange, project, onOpenProjectContext, mobileLayout = false }) {
  const effectiveTool = session?.tool || defaultTool || 'claude';
  const rawModel = session?.model || '';
  const rawEffort = session?.effort || '';
  const sessionMode = getSessionMode(session);

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
  const rawModelOptions = effectiveTool === 'ollama' && ollamaModels
    ? (ollamaModels.some(o => o.value === rawModel) ? ollamaModels : [...ollamaModels, ...(rawModel ? [{ value: rawModel, label: `${rawModel} (current)` }] : [])])
    : (rawModel && !toolModels.some(o => o.value === rawModel) ? [...toolModels, { value: rawModel, label: `${rawModel} (current)` }] : toolModels);
  const modelOptions = dedupeModelOptions(rawModelOptions);
  const selectedModel = modelOptions.some(o => o.value === rawModel) ? rawModel : '';
  const effortOptions = toolEfforts;
  const channelTabsClass = mobileLayout ? 'w-full' : 'w-full sm:w-auto';
  const assistantSelectClass = mobileLayout ? 'max-w-[140px]' : 'max-w-[140px] sm:max-w-none';
  const modelSelectClass = mobileLayout ? 'max-w-[150px]' : 'max-w-[150px] sm:max-w-[220px]';

  return (
    <div className={`flex flex-wrap items-center gap-2 px-2 py-2 border-b border-surface-700/40 bg-surface-850/40 ${mobileLayout ? '' : 'sm:px-3'}`}>
      <div className={`flex ${channelTabsClass} items-center gap-1 overflow-x-auto rounded-md border border-surface-700 bg-surface-900/60 p-0.5`}>
        <button
          onClick={() => onChannelChange?.('assistant')}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
            channel === 'assistant'
              ? 'bg-primary-600 text-white'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
          }`}
        >
          <Bot size={11} />
          Assistant
        </button>
        <button
          onClick={() => onChannelChange?.('shell')}
          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
            channel === 'shell'
              ? 'bg-amber-600 text-white'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
          }`}
        >
          <Terminal size={11} />
          Shell
        </button>
        {project && (
          <button
            onClick={() => onChannelChange?.('salesforce')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors ${
              channel === 'salesforce'
                ? 'bg-sky-600 text-white'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
            }`}
          >
            <Cloud size={11} />
            Salesforce
          </button>
        )}
      </div>

      {onOpenProjectContext && (
        <button
          type="button"
          onClick={onOpenProjectContext}
          className="inline-flex items-center gap-1.5 rounded-md border border-surface-700 bg-surface-900/70 px-2 py-1 text-[11px] text-surface-300 transition-colors hover:border-primary-500/40 hover:bg-primary-500/10 hover:text-primary-200"
          title="View collected project context and handoff pack"
        >
          <BookOpen size={12} />
          <span>Project Context</span>
        </button>
      )}

      {channel === 'assistant' && (
        <>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[10px] uppercase tracking-wide text-surface-500">Mode</span>
        <ModeToggle mode={sessionMode} onChange={(nextMode) => onUpdate({ mode: nextMode })} compact disabled={disabled} />
      </div>

      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[10px] uppercase tracking-wide text-surface-500">Assistant</span>
        <select
          value={effectiveTool}
          disabled={disabled}
          onChange={(e) => onUpdate({ tool: e.target.value, model: '', effort: '' })}
          className={`${assistantSelectClass} bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-200 outline-none focus:border-primary-500/50 disabled:opacity-50`}
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
            className={`${modelSelectClass} bg-surface-800 border border-surface-700 rounded px-2 py-1 text-[11px] text-surface-200 outline-none focus:border-primary-500/50 disabled:opacity-50`}
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

      <label
        className="flex items-center gap-1.5 min-w-0 cursor-pointer"
        title="After the work is done, load the deployed URL in a browser, log in with a configured test user, and verify it renders cleanly — looping failures back to the agent. Uses the project's Environments config. Off by default."
      >
        <input
          type="checkbox"
          checked={!!session?.validateVisually}
          disabled={disabled}
          onChange={(e) => onUpdate({ validateVisually: e.target.checked })}
          className="w-3.5 h-3.5 accent-primary-500 disabled:opacity-50"
        />
        <span className="text-[11px] text-surface-300">Validate visually</span>
      </label>
        </>
      )}

      <div className={`${mobileLayout ? 'hidden' : 'hidden sm:block sm:ml-auto'} min-w-0 text-[10px] text-surface-500 truncate`}>
        {channel === 'salesforce'
          ? 'Salesforce workbench: schema, SOQL, flows, debug, REST, data'
          : channel === 'shell'
          ? 'Interactive shell: full terminal PTY inside the project container'
          : effectiveTool === 'ollama'
          ? 'IDE orchestrator enabled: workspace scan, retrieval, stack guidance, task planning'
          : getToolConfig(effectiveTool).context}
      </div>
    </div>
  );
}

/**
 * Individual session content - manages its own state independently.
 * Hidden tabs stay mounted, but expensive side work waits until the tab is visible.
 */
function ChatSessionContent({
  projectId,
  sessionId,
  wsRef,
  wsConnectionVersion = 0,
  mode,
  tool,
  session,
  isVisible,
  projectSwitchKey,
  onSessionUpdate,
  onUnreadChange,
  onUpdateSessionConfig,
  containerName,
  project,
  containerRepos,
  onProjectUpdated,
  initialMessage,
  directMainMessage,
  onInitialMessageHandled,
  onDirectMainMessageHandled,
  isSelected,
  onChangedFilesChange,
  mainSession,
  onOpenMain,
  onCloseSession,
  onMainThreadSend,
  mainThreadSessionBubbles,
  anchorScrollSignal,
  focusInputSignal = 0,
  contracted = false,
  mobileLayout = false,
}) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [agentBusy, setAgentBusy] = useState(false);
  const [chatChannel, setChatChannel] = useState('assistant');
  const [showProjectContext, setShowProjectContext] = useState(false);
  const [queuedShellCommand, setQueuedShellCommand] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState(null);
  const [liveProgressEntries, setLiveProgressEntries] = useState([]);
  const [liveChangedFiles, setLiveChangedFiles] = useState([]);
  const [liveChecks, setLiveChecks] = useState([]);
  const [typingMessageIds, setTypingMessageIds] = useState(() => new Set());
  const [orchestratorRun, setOrchestratorRun] = useState(null);
  const [recoveryStatus, setRecoveryStatus] = useState({ active: false, message: null, startedAt: null, stalled: false });
  const [historyLoadingOlder, setHistoryLoadingOlder] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);

  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const messagesRef = useRef([]);
  const knownIdsRef = useRef(new Set());
  const streamingChunksRef = useRef('');
  const agentBusyRef = useRef(false);
  const streamingMessageIdRef = useRef(null);
  const notBusySinceRef = useRef(null);
  const prevMessageCountRef = useRef(0);
  const isInitialLoadRef = useRef(true);
  const messagesLoadedRef = useRef(false);
  const visibleSinceRef = useRef(isVisible ? Date.now() : 0);
  const historyCursorRef = useRef(null);
  const historySinceRef = useRef(chatHistorySinceIso());
  const historyLoadingOlderRef = useRef(false);
  const suppressNextAutoScrollRef = useRef(false);

  // Scroll position tracking for jump buttons
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const [showJumpTop, setShowJumpTop] = useState(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const updateMessages = useCallback((updater) => {
    setMessages(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      messagesRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    agentBusyRef.current = agentBusy;
  }, [agentBusy]);

  useEffect(() => {
    streamingMessageIdRef.current = streamingMessage?.id || null;
  }, [streamingMessage?.id]);

  const appendLiveProgressEntry = useCallback((message) => {
    const content = String(message?.content || '').trim();
    if (!content) return;

    const id = message?.id || `live-progress-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = message?.createdAt || new Date().toISOString();

    setLiveProgressEntries(prev => {
      if (prev.some(entry => entry.id === id)) {
        return prev.map(entry => entry.id === id ? { ...entry, content, createdAt } : entry);
      }
      // Suppress identical content within 8s window to avoid visual repetition
      const isDuplicate = prev.some(entry =>
        entry.content === content && Math.abs(new Date(createdAt).getTime() - new Date(entry.createdAt).getTime()) < 8000
      );
      if (isDuplicate) return prev;
      return [...prev, { id, content, createdAt }].slice(-80);
    });
  }, []);

  useEffect(() => {
    if (isVisible) visibleSinceRef.current = Date.now();
  }, [isVisible]);

  const markMessageForTyping = useCallback((message) => {
    if (!message?.id || (message.role !== 'agent' && message.role !== 'error')) return;
    if (!isVisible || !visibleSinceRef.current) return;

    const createdAt = new Date(message.createdAt || 0).getTime();
    if (!Number.isFinite(createdAt) || createdAt < visibleSinceRef.current) return;

    setTypingMessageIds(prev => {
      const next = new Set(prev);
      next.add(message.id);
      return next;
    });
  }, [isVisible]);

  const applyPersistedOrchestratorRuns = useCallback((runs = []) => {
    const activeRun = runs.find(run => run && !['completed', 'failed', 'blocked', 'cancelled'].includes(run.status));
    if (activeRun) {
      setOrchestratorRun(activeRun);
      setAgentBusy(true);
      setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
      return;
    }

    setOrchestratorRun(null);
    setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
  }, []);

  const rehydrateOrchestratorRuns = useCallback((signal) => {
    if (!projectId || !sessionId) return Promise.resolve();
    return fetch(`/api/orchestrator/runs/${projectId}/${sessionId}?limit=5`, { signal })
      .then(r => (r.ok ? r.json() : null))
      .then(data => applyPersistedOrchestratorRuns(data?.runs || []))
      .catch(err => {
        if (err?.name !== 'AbortError') console.warn('[chat] Failed to rehydrate orchestrator runs:', err.message);
      });
  }, [projectId, sessionId, applyPersistedOrchestratorRuns]);

  const loadOlderMessages = useCallback(async () => {
    if (!projectId || !sessionId || !isVisible || searchResults) return;
    if (!hasMoreHistory || historyLoadingOlderRef.current) return;

    const before = historyCursorRef.current || messagesRef.current[0]?.id;
    if (!before) {
      setHasMoreHistory(false);
      return;
    }

    const el = scrollContainerRef.current;
    const previousHeight = el?.scrollHeight || 0;
    const previousTop = el?.scrollTop || 0;

    historyLoadingOlderRef.current = true;
    setHistoryLoadingOlder(true);

    try {
      const params = new URLSearchParams({
        limit: String(CHAT_HISTORY_PAGE_SIZE),
        sessionId,
        before,
        since: historySinceRef.current,
      });
      const r = await fetch(`/api/projects/${projectId}/chat?${params.toString()}`);
      const data = await r.json();
      const older = (data.messages || []).reverse();

      if (older.length === 0) {
        setHasMoreHistory(false);
        return;
      }

      let nextCursor = before;
      suppressNextAutoScrollRef.current = true;
      for (const message of older) {
        if (message?.id) knownIdsRef.current.add(message.id);
      }
      updateMessages(prev => {
        const byId = new Map(prev.map(message => [message.id, message]));
        for (const message of older) {
          if (message?.id) byId.set(message.id, message);
        }
        const merged = [...byId.values()].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        nextCursor = merged[0]?.id || before;
        return merged;
      });
      historyCursorRef.current = data.nextBefore || nextCursor;
      setHasMoreHistory(Boolean(data.hasMore));

      requestAnimationFrame(() => {
        const current = scrollContainerRef.current;
        if (!current) return;
        current.scrollTop = current.scrollHeight - previousHeight + previousTop;
      });
    } catch (err) {
      console.warn('[chat] Failed to load older messages:', err.message);
    } finally {
      historyLoadingOlderRef.current = false;
      setHistoryLoadingOlder(false);
    }
  }, [projectId, sessionId, isVisible, searchResults, hasMoreHistory, updateMessages]);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const distFromTop = el.scrollTop;
    setShowJumpBottom(distFromBottom > 300);
    setShowJumpTop(distFromTop > 300);
    if (distFromTop < 120) loadOlderMessages();
  }, [loadOlderMessages]);

  // Scroll the messages container to the bottom directly — more reliable than
  // scrollIntoView() which can be defeated by overflow:hidden ancestors.
  const scrollToBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setShowJumpBottom(false);
      setShowJumpTop(el.scrollHeight > el.clientHeight + 300);
    }
  }, []);

  const scheduleScrollToBottom = useCallback(() => {
    if (!isVisible) return undefined;

    let rafId = null;
    const timeoutIds = [0, 80, 240, 600].map(delay => setTimeout(scrollToBottom, delay));
    rafId = requestAnimationFrame(() => {
      scrollToBottom();
      rafId = requestAnimationFrame(scrollToBottom);
    });

    return () => {
      timeoutIds.forEach(clearTimeout);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isVisible, scrollToBottom]);

  useEffect(() => {
    if (!isVisible || !anchorScrollSignal) return undefined;

    const endAt = Date.now() + 650;
    let rafId = null;
    const keepAnchored = () => {
      scrollToBottom();
      if (Date.now() < endAt) rafId = requestAnimationFrame(keepAnchored);
    };

    rafId = requestAnimationFrame(keepAnchored);
    const timeoutId = setTimeout(scrollToBottom, 700);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearTimeout(timeoutId);
    };
  }, [isVisible, anchorScrollSignal, scrollToBottom]);

  useEffect(() => {
    messagesLoadedRef.current = false;
    isInitialLoadRef.current = true;
    prevMessageCountRef.current = 0;
    knownIdsRef.current = new Set();
    historySinceRef.current = chatHistorySinceIso();
    historyCursorRef.current = null;
    suppressNextAutoScrollRef.current = false;
    setMessages([]);
    setLoading(true);
    setSearchResults(null);
    setHasMoreHistory(false);
    setShowJumpBottom(false);
    setShowJumpTop(false);
  }, [projectId, sessionId]);

  const scrollToTop = useCallback(() => {
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = 0;
  }, []);

  const markCurrentSessionRead = useCallback(() => {
    if (!projectId || !sessionId) return;
    console.log('[unread] markCurrentSessionRead', { projectId, sessionId });
    fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}/read`, { method: 'POST' }).catch(() => {});
    onSessionUpdate?.(sessionId, { hasUnread: false });
    onUnreadChange?.(projectId, sessionId, false);
  }, [projectId, sessionId, onSessionUpdate, onUnreadChange]);

  const clearBusyState = useCallback(() => {
    setAgentBusy(false);
    setStreamingMessage(null);
    streamingChunksRef.current = '';
    setLiveProgressEntries([]);
    setLiveChangedFiles([]);
    setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
  }, []);

  const mergeServerMessages = useCallback((serverMessages = [], { authoritativeBusy = null } = {}) => {
    const incoming = [...(serverMessages || [])]
      .filter(message => message?.id)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    let finalMessageChanged = false;

    if (incoming.length > 0) {
      let merged = [...messagesRef.current];

      for (const message of incoming) {
        knownIdsRef.current.add(message.id);

        if (message.role === 'user') {
          merged = merged.filter(existing => {
            const id = String(existing.id || '');
            return !(id.startsWith('pending-') && existing.role === 'user' && (
              existing.content === message.content ||
              (existing.metadata?.clientMessageId && existing.metadata.clientMessageId === message.metadata?.clientMessageId)
            ));
          });
        }

        const index = merged.findIndex(existing => existing.id === message.id);
        if (index >= 0) {
          const existing = merged[index];
          if (
            existing.content !== message.content ||
            existing.role !== message.role ||
            existing.createdAt !== message.createdAt ||
            JSON.stringify(existing.metadata || {}) !== JSON.stringify(message.metadata || {})
          ) {
            merged[index] = message;
            if (message.role === 'agent' || message.role === 'error') finalMessageChanged = true;
          }
        } else {
          merged.push(message);
          if (message.role === 'agent' || message.role === 'error') finalMessageChanged = true;
        }

        if (message.role === 'agent' || message.role === 'error') {
          markMessageForTyping(message);
        }
      }

      merged = merged.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      messagesRef.current = merged;
      updateMessages(merged);
    }

    const current = messagesRef.current;
    const lastUserIndex = current.findLastIndex(message => message.role === 'user');
    const hasFinalAfterUser = lastUserIndex >= 0
      ? current.slice(lastUserIndex + 1).some(message => message.role === 'agent' || message.role === 'error')
      : current.some(message => message.role === 'agent' || message.role === 'error');
    const hasPendingUser = current.some(message => String(message.id || '').startsWith('pending-') && message.role === 'user');

    if (authoritativeBusy === true) {
      notBusySinceRef.current = null;
      setAgentBusy(true);
    } else if (finalMessageChanged && hasFinalAfterUser) {
      notBusySinceRef.current = null;
      clearBusyState();
    } else if (authoritativeBusy === false && agentBusyRef.current && !hasPendingUser && !streamingMessageIdRef.current) {
      const now = Date.now();
      notBusySinceRef.current ||= now;
      if (now - notBusySinceRef.current >= NOT_BUSY_CLEAR_GRACE_MS) {
        notBusySinceRef.current = null;
        clearBusyState();
      }
    } else if (authoritativeBusy !== false) {
      notBusySinceRef.current = null;
    }
  }, [clearBusyState, markMessageForTyping, updateMessages]);

  // Load messages only when visible. Hidden pinned tabs should not block the
  // active session by reading chat files or recovering stale streams.
  useEffect(() => {
    if (!projectId || !sessionId || !isVisible || messagesLoadedRef.current) return;

    // Reset scroll state for fresh load
    isInitialLoadRef.current = true;
    prevMessageCountRef.current = 0;
    historySinceRef.current = chatHistorySinceIso();
    historyCursorRef.current = null;
    setHasMoreHistory(false);

    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      limit: String(CHAT_HISTORY_PAGE_SIZE),
      sessionId,
      since: historySinceRef.current,
    });
    fetch(`/api/projects/${projectId}/chat?${params.toString()}`, { signal: controller.signal })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        const msgs = (data.messages || []).reverse();
        knownIdsRef.current = new Set(msgs.map(m => m.id));
        historyCursorRef.current = data.nextBefore || msgs[0]?.id || null;
        setHasMoreHistory(Boolean(data.hasMore));
        updateMessages(msgs);
        messagesLoadedRef.current = true;
        // Mark as read
        markCurrentSessionRead();
        rehydrateOrchestratorRuns(controller.signal);
      })
      .catch(() => {
        if (!cancelled) {
          updateMessages([]);
          setHasMoreHistory(false);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectId, sessionId, isVisible, markCurrentSessionRead, rehydrateOrchestratorRuns, updateMessages]);

  useEffect(() => {
    if (isVisible) markCurrentSessionRead();
  }, [isVisible, markCurrentSessionRead]);

  // Attach to chat session for WebSocket events
  useEffect(() => {
    if (!projectId || !sessionId || !isVisible || !wsRef?.current) return;

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
        rehydrateOrchestratorRuns();
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
  }, [projectId, sessionId, isVisible, wsRef, wsConnectionVersion, rehydrateOrchestratorRuns]);

  const requestSessionHealth = useCallback((reason = 'visible', recover = false) => {
    if (!projectId || !sessionId || !isVisible) return false;
    const ws = wsRef?.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({
      type: 'chat-session-health',
      projectId,
      chatSessionId: sessionId,
      reason,
      recover,
      client: {
        busy: agentBusyRef.current,
        streamingMessageId: streamingMessageIdRef.current,
      },
    }));
    return true;
  }, [projectId, sessionId, isVisible, wsRef, wsConnectionVersion]);

  useEffect(() => {
    if (!isVisible) return undefined;
    requestSessionHealth('visible', true);

    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      requestSessionHealth('interval', false);
    }, VISIBLE_SESSION_HEALTH_INTERVAL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') requestSessionHealth('tab-visible', true);
    };
    const handleFocus = () => requestSessionHealth('focus', true);

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
    };
  }, [isVisible, requestSessionHealth, projectSwitchKey, wsConnectionVersion]);

  // Handle WebSocket messages for THIS session
  useEffect(() => {
    if (!wsRef?.current || !sessionId || !isVisible) return;

    const handleMessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      // Only handle messages for THIS session
      if (msg.sessionId && msg.sessionId !== sessionId) return;

      switch (msg.type) {
        case 'chat-message':
          if (msg.message?.sessionId === sessionId && msg.message?.id) {
            knownIdsRef.current.add(msg.message.id);
            if (msg.message.role === 'agent' || msg.message.role === 'error') {
              setStreamingMessage(null);
              setLiveProgressEntries([]);
              setLiveChangedFiles([]);
              setLiveChecks([]);
              markMessageForTyping(msg.message);
              streamingChunksRef.current = '';
              setAgentBusy(false);
              setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
            } else if (msg.message.role === 'user') {
              setLiveProgressEntries([]);
              setLiveChangedFiles([]);
            }
            updateMessages(prev => {
              const filtered = prev.filter(m => {
                if (m.id === msg.message.id) return false;
                // Replace optimistic pending user message once server echoes real one
                if (
                  msg.message.role === 'user' &&
                  m.role === 'user' &&
                  typeof m.id === 'string' &&
                  m.id.startsWith('pending-') &&
                  (
                    m.content === msg.message.content ||
                    (m.metadata?.clientMessageId && m.metadata.clientMessageId === msg.message.metadata?.clientMessageId)
                  )
                ) {
                  return false;
                }
                return true;
              });
              return [...filtered, msg.message];
            });
          }
          break;

        case 'chat-session-health':
          if (msg.projectId === projectId && (msg.sessionId === sessionId || msg.chatSessionId === sessionId)) {
            mergeServerMessages(msg.messages || [], { authoritativeBusy: msg.busy === true });
            if (Array.isArray(msg.runs)) applyPersistedOrchestratorRuns(msg.runs);
          }
          break;

        case 'chat-message-stream-start':
          setStreamingMessage({
            id: msg.messageId,
            jobId: msg.jobId,
            role: 'agent',
            content: msg.content || (msg.shell ? 'Running shell command...' : 'Thinking...'),
            createdAt: new Date().toISOString(),
            streaming: true,
            shell: !!msg.shell,
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
            if (msg.message.role === 'agent' || msg.message.role === 'error') {
              setLiveProgressEntries([]);
              setLiveChangedFiles([]);
              setLiveChecks([]);
              markMessageForTyping(msg.message);
            }
            updateMessages(prev => [
              ...prev.filter(m => m.id !== msg.messageId && m.id !== msg.message.id),
              msg.message,
            ]);
            setAgentBusy(false);
          }
          break;

        case 'chat-message-recovered':
          if (msg.message) {
            knownIdsRef.current.add(msg.message.id);
            setStreamingMessage(null);
            streamingChunksRef.current = '';
            setAgentBusy(false);
            updateMessages(prev => {
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
            const isTransient = msg.message.metadata?.transient !== false;
            if (isTransient) {
              appendLiveProgressEntry(msg.message);
            } else if (msg.message.id && !knownIdsRef.current.has(msg.message.id)) {
              knownIdsRef.current.add(msg.message.id);
              updateMessages(prev => [...prev, msg.message]);
            }
          }
          break;

        case 'chat-checks':
          // Live checklist derived from the agent's streaming output.
          if ((!msg.sessionId || msg.sessionId === sessionId) && Array.isArray(msg.checks)) {
            setLiveChecks(msg.checks);
          }
          break;

        case 'orchestrator-run':
          if (msg.projectId === projectId && msg.sessionId === sessionId && msg.run) {
            if (['completed', 'failed', 'blocked', 'cancelled'].includes(msg.run.status)) {
              setOrchestratorRun(null);
              setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
              setAgentBusy(false);
            } else {
              setOrchestratorRun(msg.run);
              setAgentBusy(true);
            }
          }
          break;

        case 'job-progress':
          if (msg.progress) {
            if (Array.isArray(msg.progress.changedFiles)) {
              setLiveChangedFiles(prev => mergeChangedFiles(prev, msg.progress.changedFiles));
            }
            const content = formatJobProgress(msg.progress);
            if (content) {
              appendLiveProgressEntry({
                id: `job-${msg.progress.jobId || msg.progress.id || ''}-${msg.progress.status || ''}-${msg.progress.updatedAt || Date.now()}`,
                content,
                createdAt: msg.progress.updatedAt || msg.progress.timestamp || new Date().toISOString(),
              });
            }
          }
          break;

        case 'session-file-changes':
          if (msg.projectId === projectId && (!msg.sessionId || msg.sessionId === sessionId) && Array.isArray(msg.files)) {
            setLiveChangedFiles(prev => mergeChangedFiles(prev, msg.files));
          }
          break;

        case 'session-unread':
          if (msg.projectId === projectId && msg.sessionId === sessionId) {
            console.log('[unread] session-unread received', { projectId, sessionId, hasUnread: msg.hasUnread, isVisible });
            if (msg.hasUnread && isVisible) {
              markCurrentSessionRead();
            } else {
              onSessionUpdate?.(sessionId, { hasUnread: msg.hasUnread });
              onUnreadChange?.(projectId, sessionId, msg.hasUnread);
            }
          }
          break;

        case 'agent-status':
          // Agent busy state - needs sessionId to target correct session
          if (msg.projectId === projectId && (!msg.sessionId || msg.sessionId === sessionId)) {
            setAgentBusy(msg.busy || false);
            if (!msg.busy) {
              setStreamingMessage(null);
              streamingChunksRef.current = '';
              setLiveProgressEntries([]);
              setLiveChangedFiles([]);
              setLiveChecks([]);
              setRecoveryStatus({ active: false, message: null, startedAt: null, stalled: false });
            }
          }
          break;
      }
    };

    wsRef.current.addEventListener('message', handleMessage);
    return () => wsRef.current?.removeEventListener('message', handleMessage);
  }, [wsRef, wsConnectionVersion, sessionId, projectId, isVisible, markCurrentSessionRead, onSessionUpdate, onUnreadChange, appendLiveProgressEntry, markMessageForTyping, mergeServerMessages, applyPersistedOrchestratorRuns, updateMessages]);

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
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-session-reconcile',
        projectId,
        sessionId,
        intent: 'recover-latest',
      }));
    }
  };

  // Scroll handling - only when visible and new messages arrive
  useEffect(() => {
    if (!isVisible) return;

    const currentCount = messages.length;
    const prevCount = prevMessageCountRef.current;

    if (suppressNextAutoScrollRef.current) {
      suppressNextAutoScrollRef.current = false;
    } else if (isInitialLoadRef.current && currentCount > 0) {
      scheduleScrollToBottom();
      isInitialLoadRef.current = false;
    } else if (currentCount > prevCount && prevCount > 0) {
      scheduleScrollToBottom();
    }

    prevMessageCountRef.current = currentCount;
  }, [messages, isVisible, scheduleScrollToBottom]);

  useEffect(() => {
    if (!isVisible) return;
    if (!streamingMessage && !agentBusy && !recoveryStatus.active) return;

    return scheduleScrollToBottom();
  }, [
    isVisible,
    streamingMessage?.id,
    streamingMessage?.content,
    agentBusy,
    recoveryStatus.active,
    recoveryStatus.message,
    scheduleScrollToBottom,
  ]);

  // Scroll to bottom when becoming visible
  useEffect(() => {
    if (isVisible) {
      return scheduleScrollToBottom();
    }
  }, [isVisible, scheduleScrollToBottom]);

  useEffect(() => {
    if (!isVisible || loading) return undefined;
    return scheduleScrollToBottom();
  }, [isVisible, loading, scheduleScrollToBottom]);

  // Ensure visible sessions jump to latest when switching projects
  useEffect(() => {
    if (!isVisible) return;
    return scheduleScrollToBottom();
  }, [projectSwitchKey, isVisible, scheduleScrollToBottom]);

  // Poll only the visible pane. Hidden sessions still receive WebSocket events.
  useEffect(() => {
    if (!projectId || !sessionId || !isVisible) return;

    const syncMessages = () => {
      fetch(`/api/projects/${projectId}/chat?limit=20&sessionId=${sessionId}`)
        .then(r => r.json())
        .then(data => {
          mergeServerMessages(data.messages || []);
        })
        .catch(() => {});

    };

    syncMessages();
    const poll = setInterval(syncMessages, 2000);

    return () => clearInterval(poll);
  }, [projectId, sessionId, isVisible, mergeServerMessages]);

  const effectiveTool = session?.tool || tool || 'claude';
  const sessionModel = session?.model || '';
  const sessionEffort = session?.effort || '';
  const sessionMode = getSessionMode(session, mode);
  const selectedRolePromptIds = useMemo(
    () => normalizeRolePromptIds(session?.activeRolePromptIds),
    [session?.activeRolePromptIds],
  );
  const rolePromptInstructions = useMemo(
    () => buildRolePromptInstructions(selectedRolePromptIds),
    [selectedRolePromptIds],
  );
  const settingsDisabled = agentBusy || Boolean(streamingMessage) || recoveryStatus.active;

  const handleStartProjectContextSession = useCallback((contextPrompt) => {
    if (!contextPrompt || !onMainThreadSend) return;
    onMainThreadSend(contextPrompt, [], {
      mode: sessionMode,
      tool: effectiveTool,
      model: sessionModel || null,
      effort: sessionEffort || null,
      activeRolePromptIds: selectedRolePromptIds,
    });
    setShowProjectContext(false);
  }, [onMainThreadSend, sessionMode, effectiveTool, sessionModel, sessionEffort, selectedRolePromptIds]);

  // Send message handler
  const handleSend = useCallback((content, attachments = [], options = {}) => {
    if (!projectId || !sessionId) return;

    const targetChannel = options.channel || chatChannel;
    const clientMessageId = options.clientMessageId || `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (session?.isMainThread && targetChannel === 'assistant' && onMainThreadSend && !options.directMain && options.startSession) {
      onMainThreadSend(content, attachments, {
        mode: sessionMode,
        tool: effectiveTool,
        model: sessionModel || null,
        effort: sessionEffort || null,
        activeRolePromptIds: selectedRolePromptIds,
      });
      return;
    }

    if (targetChannel === 'shell') {
      const shellContent = (content || '').trim();
      if (!shellContent) return;

      updateMessages(prev => [...prev, {
        id: 'pending-' + Date.now(),
        projectId,
        sessionId,
        role: 'user',
        content: shellContent,
        metadata: { mode: 'shell', channel: 'shell' },
        createdAt: new Date().toISOString(),
      }]);

      if (wsRef?.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'chat-shell-send',
          projectId,
          sessionId,
          content: shellContent,
        }));
      } else {
        updateMessages(prev => [...prev, {
          id: 'err-' + Date.now(),
          projectId,
          role: 'error',
          content: 'Not connected to server. Please wait and retry.',
          createdAt: new Date().toISOString(),
        }]);
      }
      return;
    }

    setLiveProgressEntries([]);
    setLiveChangedFiles([]);

    // ── /logs command: capture logs from container and share with agent ──
    const logsMatch = content.match(/^\/logs\s*(.*)?$/i);
    if (logsMatch) {
      const filePath = (logsMatch[1] || '').trim();
      const instruction = filePath
        ? `User requested logs from \`${filePath}\`. Analyze and continue.`
        : 'User shared recent terminal output. Analyze and continue.';

      // Show optimistic message
      updateMessages(prev => [...prev, {
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
          activeRolePromptIds: selectedRolePromptIds,
          rolePromptInstructions,
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
      id: `pending-${clientMessageId}`,
      projectId,
      sessionId,
      role: 'user',
      content: displayContent,
      metadata: { mode: sessionMode, attachments, tool: effectiveTool, model: sessionModel || null, effort: sessionEffort || null, activeRolePromptIds: selectedRolePromptIds, clientMessageId },
      createdAt: new Date().toISOString(),
    };
    updateMessages(prev => [...prev, optimistic]);
    setAgentBusy(true);

    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-send',
        projectId,
        sessionId,
        content,
        clientMessageId,
        attachments: attachments.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          size: a.size,
          path: a.path,
          url: a.url,
        })),
        mode: sessionMode,
        tool: effectiveTool,
        model: sessionModel || null,
        effort: sessionEffort || null,
        validateVisually: !!session?.validateVisually,
        activeRolePromptIds: selectedRolePromptIds,
        rolePromptInstructions,
      }));
    } else {
      setAgentBusy(false);
      updateMessages(prev => [...prev, {
        id: 'err-' + Date.now(),
        projectId,
        role: 'error',
        content: 'Not connected to server. Please wait and retry.',
        createdAt: new Date().toISOString(),
      }]);
    }
  }, [projectId, sessionId, session?.isMainThread, sessionMode, wsRef, effectiveTool, sessionModel, sessionEffort, chatChannel, selectedRolePromptIds, rolePromptInstructions, updateMessages, onMainThreadSend]);

  useEffect(() => {
    if (!isVisible || !initialMessage) return;
    const text = String(initialMessage.content || '').trim();
    if (!text) {
      onInitialMessageHandled?.(sessionId, initialMessage.id);
      return;
    }

    const targetChannel = initialMessage.channel || 'assistant';
    if (targetChannel !== chatChannel) setChatChannel(targetChannel);
    handleSend(text, initialMessage.attachments || [], { channel: targetChannel, directMain: initialMessage.directMain, clientMessageId: initialMessage.id });
    onInitialMessageHandled?.(sessionId, initialMessage.id);
  }, [isVisible, initialMessage, sessionId, chatChannel, handleSend, onInitialMessageHandled]);

  useEffect(() => {
    if (!isVisible || !directMainMessage || !session?.isMainThread) return;
    const text = String(directMainMessage.content || '').trim();
    if (!text) {
      onDirectMainMessageHandled?.(sessionId, directMainMessage.id);
      return;
    }
    setChatChannel('assistant');
    handleSend(text, [], { channel: 'assistant', directMain: true });
    onDirectMainMessageHandled?.(sessionId, directMainMessage.id);
  }, [isVisible, directMainMessage, session?.isMainThread, sessionId, handleSend, onDirectMainMessageHandled]);

  useEffect(() => {
    if (!isVisible) return;

    const runShellCommand = (command) => {
      const text = String(command || '').trim();
      if (!text) return;
      setChatChannel('shell');
      setQueuedShellCommand(text);
    };

    const handleRunInUtil = (event) => runShellCommand(event.detail?.command);
    window.addEventListener('run-in-util', handleRunInUtil);
    window.sendShellCommand = runShellCommand;

    return () => {
      window.removeEventListener('run-in-util', handleRunInUtil);
      if (window.sendShellCommand === runShellCommand) delete window.sendShellCommand;
    };
  }, [isVisible]);

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

    setLiveProgressEntries([]);
    setLiveChangedFiles([]);

    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-session-reconcile',
        projectId,
        sessionId,
        intent: options.executeReviewedPlan ? 'execute-reviewed-plan' : 'retry-target',
        mode: sessionMode,
        tool: effectiveTool,
        model: sessionModel || null,
        effort: sessionEffort || null,
        activeRolePromptIds: selectedRolePromptIds,
        rolePromptInstructions,
        targetMessageId: targetMessage.id,
        review: targetMessage?.metadata?.review || null,
        executeReviewedPlan: !!options.executeReviewedPlan,
      }));
    }
  }, [messages, projectId, sessionId, wsRef, sessionMode, effectiveTool, sessionModel, sessionEffort, selectedRolePromptIds, rolePromptInstructions]);

  useEffect(() => {
    if (!isSelected) return;
    onChangedFilesChange?.(sessionId, collectChangedFilesFromMessages(messages, liveChangedFiles));
  }, [isSelected, sessionId, messages, liveChangedFiles, onChangedFilesChange]);

  // Prepare display messages
  const sortedMessages = useMemo(() =>
    [...messages].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    [messages]
  );

  useEffect(() => {
    const lastMessage = sortedMessages[sortedMessages.length - 1] || null;
    const working = agentBusy || Boolean(streamingMessage) || recoveryStatus.active || Boolean(orchestratorRun);
    const awaitingFeedback = !working && (lastMessage?.role === 'agent' || lastMessage?.role === 'error');
    onSessionUpdate?.(sessionId, {
      busy: working,
      working,
      awaitingFeedback,
      lastMessageRole: lastMessage?.role || null,
      messageCount: Math.max(session?.messageCount || 0, sortedMessages.filter(message => message.role !== 'progress').length),
    });
  }, [agentBusy, streamingMessage, recoveryStatus.active, orchestratorRun, sortedMessages, sessionId, session?.messageCount, onSessionUpdate]);

  const progressTranscriptEntries = useMemo(() => {
    if (searchResults) return [];

    const lastUserIndex = [...sortedMessages].map(m => m.role).lastIndexOf('user');
    if (lastUserIndex < 0) return [];

    const lastUser = sortedMessages[lastUserIndex];
    const lastUserTime = new Date(lastUser.createdAt).getTime() || 0;
    const afterLastUser = sortedMessages.slice(lastUserIndex + 1);
    const hasFinalResponse = afterLastUser.some(m => m.role === 'agent' || m.role === 'error');
    if (hasFinalResponse) return [];

    const entries = [
      ...afterLastUser.filter(m => m.role === 'progress'),
      ...liveProgressEntries.filter(entry => (new Date(entry.createdAt).getTime() || Date.now()) >= lastUserTime),
    ];

    const byKey = new Map();
    for (const entry of entries) {
      const content = String(entry.content || '').trim();
      if (!content) continue;
      const key = entry.id || `${entry.createdAt}-${content}`;
      byKey.set(key, {
        id: key,
        content,
        createdAt: entry.createdAt || new Date().toISOString(),
      });
    }

    // Collapse consecutive entries with identical content (server-side dedup
    // may miss tight races, so we catch them here before rendering).
    const sorted = [...byKey.values()]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const deduped = [];
    for (const entry of sorted) {
      if (deduped.length > 0 && deduped[deduped.length - 1].content === entry.content) continue;
      deduped.push(entry);
    }
    return deduped.slice(-80);
  }, [sortedMessages, liveProgressEntries, searchResults]);

  const filteredMessages = useMemo(() => {
    return sortedMessages.filter(m => m.role !== 'progress');
  }, [sortedMessages]);

  useEffect(() => {
    if (!isVisible || progressTranscriptEntries.length === 0) return undefined;
    return scheduleScrollToBottom();
  }, [isVisible, progressTranscriptEntries.length, scheduleScrollToBottom]);

  const displayMessages = searchResults || filteredMessages;
  const showMainThreadSessionBubbles = session?.isMainThread && !searchResults && mainThreadSessionBubbles;
  const renderedChatChannel = contracted ? 'assistant' : chatChannel;
  const showOnlySessions = contracted && session?.isMainThread;

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
        position: 'relative',
      }}
    >
      {showProjectContext && session?.isMainThread && (
        <ProjectContextPanel
          projectId={projectId}
          project={project}
          onClose={() => setShowProjectContext(false)}
          onStartSession={handleStartProjectContextSession}
        />
      )}

      {/* Search result indicator */}
      {searchResults && (
        <div className="px-3 py-1 text-[10px] text-surface-500 bg-surface-850/30 border-b border-surface-700/30">
          {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
        </div>
      )}

      {!session?.isMainThread && (
        <ChildThreadHeader project={project} session={session} mainSession={mainSession} onOpenMain={onOpenMain} onCloseSession={onCloseSession} />
      )}

      {!contracted && (
        <SessionAssistantControls
          session={session}
          defaultTool={tool}
          disabled={settingsDisabled}
          projectId={projectId}
          onUpdate={(updates) => onUpdateSessionConfig?.(sessionId, updates)}
          channel={chatChannel}
          onChannelChange={setChatChannel}
          project={project}
          onOpenProjectContext={session?.isMainThread ? () => setShowProjectContext(true) : null}
          mobileLayout={mobileLayout}
        />
      )}

      {renderedChatChannel === 'shell' ? (
        <InternalConsole
          projectId={projectId}
          chatWsRef={wsRef}
          activeChatSessionId={sessionId}
          embedded
          active={isVisible}
          queuedCommand={queuedShellCommand}
          onQueuedCommandHandled={() => setQueuedShellCommand(null)}
        />
      ) : renderedChatChannel === 'salesforce' ? (
        <SalesforceInlineWorkspace projectId={projectId} />
      ) : (
        <>
      <OrchestratorRunIndicator run={orchestratorRun} />

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative' }} className="px-1 py-4">
        {!showOnlySessions && !searchResults && displayMessages.length > 0 && (hasMoreHistory || historyLoadingOlder) && (
          <div className="mb-3 flex justify-center px-3">
            <button
              type="button"
              onClick={loadOlderMessages}
              disabled={historyLoadingOlder}
              className="inline-flex items-center gap-2 rounded-full border border-surface-700/60 bg-surface-900/80 px-3 py-1.5 text-[11px] text-surface-400 transition-colors hover:border-surface-600 hover:text-surface-200 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {historyLoadingOlder && <Loader size={12} className="animate-spin" />}
              {historyLoadingOlder ? 'Loading earlier messages...' : `Load earlier messages from last ${CHAT_HISTORY_LOOKBACK_DAYS} days`}
            </button>
          </div>
        )}

        {showOnlySessions ? null : loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader size={22} className="animate-spin text-surface-600" />
          </div>
        ) : displayMessages.length === 0 ? (
          <div className={`${showMainThreadSessionBubbles ? 'px-3 py-6 text-center' : 'flex h-full items-center justify-center'} text-surface-500 text-sm`}>
            {searchResults ? 'No results found' : (session?.isMainThread ? 'Message the main thread to coordinate this project...' : 'Start a conversation...')}
          </div>
        ) : (
          displayMessages.map(msg => (
            <ChatMessage
              key={msg.id}
              message={msg}
              wsRef={wsRef}
              projectId={projectId}
              onSend={handleSend}
              onRetry={handleRetryMessage}
              animateContent={typingMessageIds.has(msg.id)}
              threadKind={session?.isMainThread ? 'main' : 'session'}
            />
          ))
        )}

        {showMainThreadSessionBubbles}

        {!showOnlySessions && progressTranscriptEntries.length > 0 && (
          <ProgressTranscriptBubble
            entries={progressTranscriptEntries}
            changedFiles={liveChangedFiles}
            wsRef={wsRef}
            projectId={projectId}
            sessionId={sessionId}
          />
        )}

        {!showOnlySessions && recoveryStatus.active && (
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

        {!showOnlySessions && liveChecks.length > 0 && (
          <LiveChecksPanel checks={liveChecks} />
        )}

        {!showOnlySessions && streamingMessage && (
          <ChatMessage
            key={streamingMessage.id}
            message={streamingMessage}
            wsRef={wsRef}
            projectId={projectId}
            onSend={handleSend}
            threadKind={session?.isMainThread ? 'main' : 'session'}
          />
        )}

        {!showOnlySessions && (agentBusy || recoveryStatus.active || (streamingMessage && !streamingMessage.shell)) && (
          progressTranscriptEntries.length === 0 && liveChecks.length === 0 && <WorkingIndicator wsRef={wsRef} projectId={projectId} sessionId={sessionId} />
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Jump to top / bottom floating buttons */}
      {!contracted && <div className="relative">
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
      </div>}

      {isVisible && containerName && !contracted && (
        <BranchBar
          containerName={containerName}
          session={session}
          projectId={projectId}
          onBranchChange={(branch) => onUpdateSessionConfig?.(sessionId, { branch })}
          onSessionUpdate={(updates) => onUpdateSessionConfig?.(sessionId, updates)}
          containerRepos={containerRepos}
        />
      )}

      <div className={contracted ? 'hidden' : ''}>
        <ChatInput
          mode={sessionMode}
          channel={renderedChatChannel}
          projectId={projectId}
          onSend={session?.isMainThread && renderedChatChannel === 'assistant'
            ? (content, attachments) => handleSend(content, attachments, { channel: 'assistant', startSession: true })
            : handleSend}
          onSearch={handleSearch}
          busy={agentBusy}
          isVisible={isVisible && !contracted}
          focusSignal={focusInputSignal}
          selectedRolePromptIds={selectedRolePromptIds}
          onSelectedRolePromptIdsChange={(nextIds) => onUpdateSessionConfig?.(sessionId, { activeRolePromptIds: nextIds })}
          hideRolePrompts={contracted}
          placeholderOverride={session?.isMainThread && renderedChatChannel === 'assistant'
            ? 'Write in Main, then choose where to send... (Ctrl+Enter starts a new session)'
            : null}
          sendLabel={session?.isMainThread && renderedChatChannel === 'assistant' ? 'Send as new session' : null}
          sendVariant={session?.isMainThread && renderedChatChannel === 'assistant' ? 'green' : null}
          sendIconOnly={session?.isMainThread && renderedChatChannel === 'assistant'}
          secondarySendLabel={session?.isMainThread && renderedChatChannel === 'assistant' ? 'Ask in main thread' : null}
          secondarySendVariant="primary"
          secondarySendIconOnly={session?.isMainThread && renderedChatChannel === 'assistant'}
          onSecondarySend={session?.isMainThread && renderedChatChannel === 'assistant'
            ? (content, attachments) => handleSend(content, attachments, { channel: 'assistant', directMain: true })
            : null}
        />
      </div>
        </>
      )}
    </div>
  );
}

/**
 * Main ChatPanel - manages sessions/tabs and renders all open sessions.
 * Sessions stay mounted when hidden to preserve state and continue working.
 */
export default function ChatPanel({ projectId, wsRef, wsConnectionVersion = 0, mode = 'agent', tool = 'claude', isActive = true, onActiveSessionChange, onUnreadChange, onProjectRead, project, containerRepos = [], mobileLayout = false, onProjectUpdated, onSelectedSessionFilesChange }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [openTabs, setOpenTabs] = useState([]);
  const [splitCount, setSplitCount] = useState(1);
  const [showSessionList, setShowSessionList] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historySearchResults, setHistorySearchResults] = useState([]);
  const [historySearchLoading, setHistorySearchLoading] = useState(false);
  const [pendingInitialMessages, setPendingInitialMessages] = useState({});
  const [pendingDirectMainMessages, setPendingDirectMainMessages] = useState({});
  const [activeChangedFiles, setActiveChangedFiles] = useState([]);
  const [mainThreadPaneHovered, setMainThreadPaneHovered] = useState(false);
  const [mainThreadPaneFocused, setMainThreadPaneFocused] = useState(false);
  const [mainThreadHoverSuppressed, setMainThreadHoverSuppressed] = useState(false);
  const [sessionInputFocusSignal, setSessionInputFocusSignal] = useState(0);
  const sessionListRef = useRef(null);
  const sessionsRef = useRef([]);
  const openTabsRef = useRef([]);
  const [projectSwitchKey, setProjectSwitchKey] = useState(0);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    if (projectId) setProjectSwitchKey(k => k + 1);
  }, [projectId]);

  // Scroll to bottom when this panel becomes the active project
  useEffect(() => {
    if (isActive) setProjectSwitchKey(k => k + 1);
  }, [isActive]);

  // Clear project-level unread badge when this project becomes active via non-click paths
  const prevIsActiveRef = useRef(isActive);
  useEffect(() => {
    const wasActive = prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;
    if (isActive && !wasActive && projectId) {
      onProjectRead?.(projectId);
    }
  }, [isActive, projectId, onProjectRead]);

  // Fetch containerName from project for branch-per-session feature
  const [containerName, setContainerName] = useState(null);
  useEffect(() => {
    if (!projectId) { setContainerName(null); return; }
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setContainerName(data?.containerName || null))
      .catch(() => setContainerName(null));
  }, [projectId]);

  // Notify parent of active session changes for integrations that target a chat tab.
  // Also pass the active session's branch so the sidebar can update.
  useEffect(() => {
    if (isActive && activeSessionId) {
      const activeSession = sessions.find(s => s.id === activeSessionId);
      onActiveSessionChange?.(activeSessionId, activeSession?.branch || null);
    } else if (isActive) {
      onActiveSessionChange?.(null, null);
    }
  }, [isActive, activeSessionId, sessions, onActiveSessionChange]);

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

  useEffect(() => {
    const query = historySearch.trim();
    if (!projectId || query.length < 2) {
      setHistorySearchResults([]);
      setHistorySearchLoading(false);
      return;
    }

    let cancelled = false;
    setHistorySearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/chat/sessions/search?q=${encodeURIComponent(query)}&limit=40`);
        const data = await r.json();
        if (!cancelled) setHistorySearchResults(data.sessions || []);
      } catch {
        if (!cancelled) setHistorySearchResults([]);
      } finally {
        if (!cancelled) setHistorySearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [historySearch, projectId]);

  // Load sessions when project changes
  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setActiveSessionId(null);
      setOpenTabs([]);
      return;
    }

    Promise.all([
      fetch(`/api/projects/${projectId}/chat/sessions`).then(r => r.json()),
      fetch(`/api/projects/${projectId}/chat/sessions/main?tool=${encodeURIComponent(tool)}&mode=${encodeURIComponent(mode || 'agent')}`).then(r => r.json()),
    ])
      .then(([data, mainData]) => {
        const mainSession = mainData.session;
        const list = mergeSessionLists(data.sessions || [], mainSession ? [mainSession] : []);
        setSessions(list);
        setOpenTabs(mainSession?.id ? [mainSession.id] : []);
        setActiveSessionId(mainSession?.id || null);
      })
      .catch(() => {
        setSessions([]);
        setActiveSessionId(null);
        setOpenTabs([]);
      });
  }, [projectId, tool, mode]);

  // Keep session list in sync so server-created sessions (e.g. Slack) appear automatically
  useEffect(() => {
    if (!projectId) return;

    const syncSessions = async () => {
      try {
        const r = await fetch(`/api/projects/${projectId}/chat/sessions`);
        const data = await r.json();
        const latest = data.sessions || [];
        const prev = sessionsRef.current;

        // New sessions should appear as bubbles without stealing focus. Sending
        // from the empty composer is the only automatic expansion path.

        // Reconcile session status: openTabs is the client source-of-truth.
        // If a status PATCH was lost (network glitch, tab closed mid-flight),
        // fire a corrective PATCH so the server stays in sync for recovery.
        const currentOpenTabs = new Set(openTabsRef.current);
        for (const serverSession of latest) {
          if (serverSession.pending) continue;
          const expectedStatus = currentOpenTabs.has(serverSession.id) ? 'open' : 'closed';
          if (serverSession.status !== expectedStatus) {
            fetch(`/api/projects/${projectId}/chat/sessions/${serverSession.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: expectedStatus }),
            }).catch(() => {});
          }
        }

        // Merge server data into local state.
        // Server is authoritative for metadata (messageCount, hasUnread, name),
        // but we preserve local composer settings to avoid clobbering optimistic
        // updates that are still in-flight (PATCH sent but response not yet back).
        setSessions(prev => {
          const localMap = new Map(prev.map(s => [s.id, s]));
          const latestIds = new Set(latest.map(s => s.id));
          const preservedLocal = prev.filter(s => (
            !latestIds.has(s.id) && (s.pending || openTabsRef.current.includes(s.id))
          ));
          const mergedLatest = latest.map(serverSession => {
            const local = localMap.get(serverSession.id);
            const expectedStatus = currentOpenTabs.has(serverSession.id) ? 'open' : 'closed';
            if (!local) return { ...serverSession, status: expectedStatus };
            return {
              ...serverSession,
              // Keep local assistant settings — they're set via PATCH and confirmed
              // by the PATCH response handler; the background poll must not overwrite them.
              tool: local.tool,
              model: local.model,
              effort: local.effort,
              status: expectedStatus,
              activeRolePromptIds: Object.prototype.hasOwnProperty.call(local, 'activeRolePromptIds')
                ? local.activeRolePromptIds
                : serverSession.activeRolePromptIds,
            };
          });
          return [...preservedLocal, ...mergedLatest];
        });
      } catch {}
    };

    const interval = setInterval(syncSessions, 10000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Session actions
  const creatingRef = useRef(false);
  const getTabsWithMain = useCallback((sessionId) => {
    const mainId = sessionsRef.current.find(session => session?.isMainThread)?.id;
    if (!sessionId) return mainId ? [mainId] : [];
    if (!mainId || sessionId === mainId) return [sessionId];
    return [mainId, sessionId];
  }, []);

  const createNewSession = useCallback(async ({ initialMessage = null, channel = 'assistant', mode: requestedMode = null, settings = {} } = {}) => {
    if (!projectId || creatingRef.current) return null;
    creatingRef.current = true;
    const tempId = `pending-${Date.now()}`;
    const previousActiveId = activeSessionId;
    const mainSession = sessionsRef.current.find(session => session?.isMainThread);
    const inheritedSettings = {
      tool: settings.tool || mainSession?.tool || tool,
      model: settings.model !== undefined ? settings.model : (mainSession?.model || null),
      effort: settings.effort !== undefined ? settings.effort : (mainSession?.effort || null),
      branch: settings.branch !== undefined ? settings.branch : (mainSession?.branch || null),
      repoPath: settings.repoPath !== undefined ? settings.repoPath : (mainSession?.repoPath || null),
      worktreePath: settings.worktreePath !== undefined ? settings.worktreePath : (mainSession?.worktreePath || null),
      activeRolePromptIds: settings.activeRolePromptIds !== undefined
        ? normalizeRolePromptIds(settings.activeRolePromptIds)
        : (mainSession?.activeRolePromptIds || []),
    };
    const optimisticSession = {
      id: tempId,
      name: 'New conversation',
      createdAt: new Date().toISOString(),
      messageCount: 0,
      manualName: false,
      status: 'open',
      ...inheritedSettings,
      mode: requestedMode || mainSession?.mode || mode || 'agent',
      pending: true,
    };

    setSessions(prev => [optimisticSession, ...prev]);
    setOpenTabs(getTabsWithMain(tempId));
    setActiveSessionId(tempId);
    setShowSessionList(false);
    if (initialMessage) {
      setPendingInitialMessages(prev => ({
        ...prev,
        [tempId]: { ...initialMessage, id: initialMessage.id || `initial-${Date.now()}`, channel },
      }));
    }

    try {
      const r = await fetch(`/api/projects/${projectId}/chat/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...inheritedSettings,
          mode: requestedMode || mainSession?.mode || mode || 'agent',
        })
      });
      if (!r.ok) throw new Error('Failed to create session');
      const session = await r.json();
      setSessions(prev => {
        let replaced = false;
        const next = prev.map(s => {
          if (s.id !== tempId) return s;
          replaced = true;
          return session;
        });
        return replaced ? next : [session, ...prev];
      });
      setOpenTabs(getTabsWithMain(session.id));
      setActiveSessionId(prev => (prev === tempId ? session.id : prev));
      if (initialMessage) {
        setPendingInitialMessages(prev => {
          const next = { ...prev };
          next[session.id] = next[tempId] || { ...initialMessage, id: initialMessage.id || `initial-${Date.now()}`, channel };
          delete next[tempId];
          return next;
        });
      }
      return session.id;
    } catch {
      setSessions(prev => prev.filter(s => s.id !== tempId));
      setOpenTabs(prev => prev.filter(id => id !== tempId));
      setActiveSessionId(prev => (prev === tempId ? previousActiveId : prev));
      setPendingInitialMessages(prev => {
        const next = { ...prev };
        delete next[tempId];
        return next;
      });
      return null;
    } finally {
      creatingRef.current = false;
    }
  }, [projectId, tool, mode, activeSessionId, getTabsWithMain]);

  const deleteSession = useCallback(async (sessionId) => {
    if (!projectId) return;
    const session = sessionsRef.current.find(s => s.id === sessionId);
    if (session?.pending) {
      const remainingTabs = openTabsRef.current.filter(id => id !== sessionId);
      setOpenTabs(prev => prev.filter(id => id !== sessionId));
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      setActiveSessionId(prev => (prev === sessionId ? (remainingTabs[remainingTabs.length - 1] || getTabsWithMain(null)[0] || null) : prev));
      return;
    }
    try {
      await fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, { method: 'DELETE' });
      setOpenTabs(prev => prev.filter(id => id !== sessionId));
      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== sessionId);
        if (sessionId === activeSessionId) {
          const remainingTabs = openTabs.filter(id => id !== sessionId);
          if (remainingTabs.length > 0) {
            setActiveSessionId(remainingTabs[remainingTabs.length - 1]);
          } else {
            setActiveSessionId(getTabsWithMain(null)[0] || null);
          }
        }
        return filtered;
      });
    } catch {}
  }, [projectId, activeSessionId, openTabs, getTabsWithMain]);

  const markSessionRead = useCallback((sessionId) => {
    if (!projectId || !sessionId) return;
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, hasUnread: false } : s
    ));
    onUnreadChange?.(projectId, sessionId, false);
    fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}/read`, { method: 'POST' }).catch(() => {});
  }, [projectId, onUnreadChange]);

  const switchToTab = useCallback((sessionId) => {
    const nextTabs = getTabsWithMain(sessionId);
    const nextOpen = new Set(nextTabs);
    const previouslyOpen = openTabsRef.current.filter(id => !nextOpen.has(id));
    setOpenTabs(nextTabs);
    setActiveSessionId(sessionId);
    markSessionRead(sessionId);
    if (projectId) {
      for (const id of previouslyOpen) {
        fetch(`/api/projects/${projectId}/chat/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'closed' }),
        }).catch(() => {});
      }
      fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      }).catch(() => {});
    }
  }, [projectId, markSessionRead, getTabsWithMain]);

  const openSession = useCallback((sessionId) => {
    const nextTabs = getTabsWithMain(sessionId);
    const nextOpen = new Set(nextTabs);
    const previouslyOpen = openTabsRef.current.filter(id => !nextOpen.has(id));
    setOpenTabs(nextTabs);
    setActiveSessionId(sessionId);
    setShowSessionList(false);
    markSessionRead(sessionId);
    if (projectId) {
      for (const id of previouslyOpen) {
        fetch(`/api/projects/${projectId}/chat/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'closed' }),
        }).catch(() => {});
      }
      fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'open' }),
      }).catch(() => {});
    }
  }, [projectId, markSessionRead, getTabsWithMain]);

  const openHistorySession = useCallback((session) => {
    if (!session?.id) return;
    setSessions(prev => mergeSessionLists(prev, [session]));
    openSession(session.id);
  }, [openSession]);

  const closeTab = useCallback((sessionId, e) => {
    e?.stopPropagation();
    const session = sessionsRef.current.find(item => item.id === sessionId);
    if (session?.isMainThread) {
      setOpenTabs(getTabsWithMain(sessionId));
      setActiveSessionId(sessionId);
      return;
    }
    setOpenTabs(prev => {
      const filtered = prev.filter(id => id !== sessionId);
      if (sessionId === activeSessionId) {
        setActiveSessionId(filtered[filtered.length - 1] || getTabsWithMain(null)[0] || null);
      }
      return filtered;
    });
    // Persist closed status for recovery on refresh
    if (projectId) {
      fetch(`/api/projects/${projectId}/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      }).catch(() => {});
    }
  }, [projectId, activeSessionId, getTabsWithMain]);

  const clearActiveSession = useCallback(() => {
    const mainId = getTabsWithMain(null)[0] || null;
    if (activeSessionId && activeSessionId !== mainId) {
      closeTab(activeSessionId);
      return;
    }
    setOpenTabs(mainId ? [mainId] : []);
    setActiveSessionId(mainId);
  }, [activeSessionId, closeTab, getTabsWithMain]);

  const toggleSessionExpanded = useCallback((sessionId, e) => {
    e?.stopPropagation();
    const isOpen = openTabsRef.current.includes(sessionId);
    if (isOpen) closeTab(sessionId, e);
    else openSession(sessionId);
  }, [closeTab, openSession]);

  // Handle session state updates from child components
  const handleSessionUpdate = useCallback((sessionId, updates) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const changed = Object.entries(updates || {}).some(([key, value]) => s[key] !== value);
      return changed ? { ...s, ...updates } : s;
    }));
  }, []);

  useEffect(() => {
    const ws = wsRef?.current;
    if (!ws || !projectId) return undefined;

    const handleThreadStatusMessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'agent-status' && msg.projectId === projectId && msg.sessionId) {
        handleSessionUpdate(msg.sessionId, {
          busy: !!msg.busy,
          working: !!msg.busy,
          awaitingFeedback: !msg.busy,
        });
        return;
      }

      if (msg.type === 'chat-message-stream-start' && msg.projectId === projectId && msg.sessionId) {
        handleSessionUpdate(msg.sessionId, { busy: true, working: true, awaitingFeedback: false });
        return;
      }

      if (msg.type === 'chat-message-stream-complete' && msg.projectId === projectId && msg.sessionId) {
        handleSessionUpdate(msg.sessionId, { busy: false, working: false, awaitingFeedback: true });
        return;
      }

      if (msg.type === 'chat-message' && msg.message?.projectId === projectId && msg.message?.sessionId) {
        const role = msg.message.role;
        handleSessionUpdate(msg.message.sessionId, {
          busy: role === 'user',
          working: role === 'user',
          awaitingFeedback: role === 'agent' || role === 'error',
          lastMessageRole: role,
        });
      }
    };

    ws.addEventListener('message', handleThreadStatusMessage);
    return () => ws.removeEventListener('message', handleThreadStatusMessage);
  }, [wsRef, wsConnectionVersion, projectId, handleSessionUpdate]);

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

  const handleGlobalSend = useCallback((content, attachments = [], options = {}) => {
    const trimmed = String(content || '').trim();
    if (!trimmed && attachments.length === 0) return;
    createNewSession({
      initialMessage: { content: trimmed, attachments, id: `initial-${Date.now()}` },
      channel: 'assistant',
      mode: options.mode || mode,
      settings: {
        tool: options.tool,
        model: options.model,
        effort: options.effort,
        branch: options.branch,
        repoPath: options.repoPath,
        worktreePath: options.worktreePath,
        activeRolePromptIds: options.activeRolePromptIds,
      },
    });
  }, [createNewSession, mode]);

  const handleInitialMessageHandled = useCallback((sessionId, messageId) => {
    setPendingInitialMessages(prev => {
      if (!prev[sessionId] || prev[sessionId].id !== messageId) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  const handleDirectMainMessageHandled = useCallback((sessionId, messageId) => {
    setPendingDirectMainMessages(prev => {
      if (!prev[sessionId] || prev[sessionId].id !== messageId) return prev;
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!projectId) return undefined;

    const selectRepo = (event) => {
      if (event.detail?.projectId !== projectId) return;
      const repo = event.detail?.repo;
      const main = sessionsRef.current.find(session => session?.isMainThread);
      if (!main?.id || !repo?.path) return;
      updateSessionAssistantConfig(main.id, { repoPath: repo.path });
      openSession(main.id);
    };

    const requestAction = (event) => {
      if (event.detail?.projectId !== projectId) return;
      const repo = event.detail?.repo;
      const action = event.detail?.action === 'deploy' ? 'deploy' : 'push';
      const main = sessionsRef.current.find(session => session?.isMainThread);
      if (!main?.id || !repo?.path) return;
      updateSessionAssistantConfig(main.id, { repoPath: repo.path });
      openSession(main.id);
      setPendingDirectMainMessages(prev => ({
        ...prev,
        [main.id]: {
          id: `repo-action-${Date.now()}`,
          content: buildMainThreadRepoActionMessage(action, repo),
          directMain: true,
        },
      }));
    };

    window.addEventListener('main-thread-repo-select', selectRepo);
    window.addEventListener('main-thread-repo-action', requestAction);
    return () => {
      window.removeEventListener('main-thread-repo-select', selectRepo);
      window.removeEventListener('main-thread-repo-action', requestAction);
    };
  }, [projectId, openSession, updateSessionAssistantConfig]);

  const handleChangedFilesChange = useCallback((sessionId, files) => {
    if (sessionId === activeSessionId) setActiveChangedFiles(files || []);
  }, [activeSessionId]);

  useEffect(() => {
    if (!isActive) return;
    onSelectedSessionFilesChange?.(activeSessionId, activeChangedFiles);
  }, [isActive, activeSessionId, activeChangedFiles, onSelectedSessionFilesChange]);

  useEffect(() => {
    if (!activeSessionId) {
      setActiveChangedFiles([]);
      return;
    }
    const active = sessionsRef.current.find(s => s.id === activeSessionId);
    if (!active) setActiveChangedFiles([]);
  }, [activeSessionId]);

  useEffect(() => {
    if (!projectId) return;
    const runCommandInNewSession = (event) => {
      const command = String(event.detail?.command || '').trim();
      if (!command) return;
      createNewSession({
        initialMessage: { content: command, id: `command-${Date.now()}` },
        channel: 'shell',
        mode: 'agent',
      });
    };
    window.addEventListener('chat-command-session', runCommandInNewSession);
    return () => window.removeEventListener('chat-command-session', runCommandInNewSession);
  }, [projectId, createNewSession]);

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

  // Chat thread bubbles are chronological, with pinned sessions rendered as a
  // separate bottom group by SessionBubbleDock.
  const sortedSessions = useMemo(() =>
    [...sessions].sort(sortSessionsOldestFirst),
    [sessions]
  );
  const mainSession = useMemo(() =>
    sortedSessions.find(session => session?.isMainThread) || null,
    [sortedSessions]
  );
  const childSessions = useMemo(() =>
    sortedSessions.filter(session => !session?.isMainThread),
    [sortedSessions]
  );

  const hasHistorySearch = historySearch.trim().length >= 2;
  const displayedHistorySessions = hasHistorySearch
    ? historySearchResults.filter(session => !session?.isMainThread)
    : childSessions;
  const allCollapsed = !activeSessionId;
  const activeChildSessionId = mainSession?.id && activeSessionId && activeSessionId !== mainSession.id ? activeSessionId : null;
  const mainThreadPaneExpanded = !activeChildSessionId || (!mainThreadHoverSuppressed && (mainThreadPaneHovered || mainThreadPaneFocused));
  const mainThreadAnchorScrollSignal = activeChildSessionId
    ? `${activeChildSessionId}:${mainThreadPaneExpanded ? 'expanded' : 'collapsed'}`
    : '';
  const splitGridClass = activeChildSessionId && !mobileLayout
    ? 'md:grid-cols-[minmax(10.75rem,16.75rem)_minmax(0,1fr)] md:gap-2 md:p-2'
    : '';

  const handleSessionBubbleOpen = useCallback((session) => {
    if (!session?.id) return;
    setMainThreadPaneHovered(false);
    setMainThreadPaneFocused(false);
    setMainThreadHoverSuppressed(true);
    setSessionInputFocusSignal(Date.now());
    if (hasHistorySearch) openHistorySession(session);
    else openSession(session.id);
  }, [hasHistorySearch, openHistorySession, openSession]);

  const openMainThread = useCallback(() => {
    if (mainSession?.id) openSession(mainSession.id);
  }, [mainSession?.id, openSession]);

  useEffect(() => {
    if (!isActive || !mainSession?.id) return;
    const activeSessionStillExists = activeSessionId && sessions.some(session => session.id === activeSessionId);
    if (!activeSessionStillExists) openSession(mainSession.id);
  }, [isActive, projectId, mainSession?.id, activeSessionId, sessions, openSession]);

  const handleLoadArchivedSessions = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/sessions?includeArchived=true`);
      const data = await r.json();
      if (data.sessions) setSessions(prev => mergeSessionLists(prev, data.sessions));
    } catch {}
  }, [projectId]);

  const mainThreadSessionBubbles = (
    <MainThreadSessionBubbles
      sessions={childSessions}
      activeSessionId={activeSessionId}
      editingSessionId={editingSessionId}
      editingName={editingName}
      editInputRef={editInputRef}
      onEditingNameChange={setEditingName}
      onFinishEditing={finishEditing}
      onCancelEditing={cancelEditing}
      onOpenSession={handleSessionBubbleOpen}
      onCollapseSession={closeTab}
      onTogglePin={togglePin}
      onStartEditing={startEditing}
      onDeleteSession={deleteSession}
      onLoadArchived={handleLoadArchivedSessions}
      collapsed={Boolean(activeChildSessionId && !mainThreadPaneExpanded)}
    />
  );

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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', position: 'relative' }}>
      {/* Legacy tab controls are kept mounted for now but hidden; session navigation is rendered as chat bubbles near the composer. */}
      <div className="hidden" style={{ flexShrink: 0 }}>
        <div className="flex-1 flex items-center overflow-x-auto scrollbar-none min-w-0">
          {sortedSessions.map((s) => {
            const expanded = openTabs.includes(s.id);
            const status = getSessionStatus(s, { expanded, active: s.id === activeSessionId });
            return (
            <div
              key={s.id}
              onClick={() => expanded ? switchToTab(s.id) : openSession(s.id)}
              className={`group flex items-center gap-1.5 px-2.5 py-1.5 cursor-pointer border-r border-surface-700/30 min-w-[150px] max-w-[190px] transition-all duration-200 sm:min-w-0 sm:max-w-[220px] sm:px-3 ${
                s.id === activeSessionId
                  ? 'bg-surface-800 text-surface-100'
                  : 'bg-surface-850/80 text-surface-400 hover:bg-surface-800/50 hover:text-surface-200'
              }`}
            >
              <button onClick={(e) => toggleSessionExpanded(s.id, e)} className="p-0.5 rounded text-surface-500 hover:text-surface-200 hover:bg-surface-700" title={expanded ? 'Contract session' : 'Expand session'}>
                {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
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
              {s.branch && (
                <span className="flex items-center gap-0.5 px-1 rounded bg-green-500/10 text-green-400 text-[9px] font-mono flex-shrink-0" title={`Branch: ${s.branch}`}>
                  <GitBranch size={7} />
                </span>
              )}
              {s.hasUnread && s.id !== activeSessionId && (
                <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse" />
              )}
              <span className={`hidden items-center gap-1 rounded-full px-1 py-0.5 text-[9px] sm:flex ${status.text}`} title={status.label}>
                <span className={`h-1.5 w-1.5 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
                {status.label}
              </span>
              {/* Pin button - show on hover for active tab */}
              {s.id === activeSessionId && !s.pending && (
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
          );
          })}

          <button
            onClick={createNewSession}
            className="p-1.5 text-surface-500 hover:text-primary-400 hover:bg-surface-700/50 transition-colors flex-shrink-0"
            title="New conversation"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex items-center gap-0.5 px-1 border-l border-surface-700/30 flex-shrink-0">
          <div className="hidden items-center gap-0.5 mr-1 border-r border-surface-700/30 pr-1 sm:flex">
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
                sortedSessions.length > 0
                  ? 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
                  : 'text-surface-600 hover:text-surface-400 hover:bg-surface-700/30'
              }`}
              title={sortedSessions.length > 0 ? `${sortedSessions.length} session(s)` : 'No sessions'}
            >
              <MoreHorizontal size={14} />
            </button>

            {showSessionList && (
              <div className="absolute top-full right-0 mt-1 w-72 bg-surface-800 border border-surface-700 rounded-lg shadow-modal z-50 overflow-hidden animate-scale-in">
                <div className="px-3 py-2 text-[10px] text-surface-500 uppercase tracking-wider border-b border-surface-700/50 bg-surface-850/50">
                  {hasHistorySearch ? 'History Search' : 'All Sessions'}
                </div>

                <div className="p-2 border-b border-surface-700/50 bg-surface-850/30">
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Search subjects, then content..."
                    className="w-full px-2 py-1 text-[11px] bg-surface-900 border border-surface-700 rounded text-surface-200 placeholder:text-surface-600 focus:outline-none focus:border-primary-500/60"
                  />
                </div>

                {historySearchLoading ? (
                  <div className="px-3 py-4 text-[11px] text-surface-500 text-center flex items-center justify-center gap-2">
                    <Loader size={12} className="animate-spin" />
                    Searching history...
                  </div>
                ) : displayedHistorySessions.length > 0 ? (
                  <div className="max-h-56 overflow-y-auto">
                    {displayedHistorySessions.map(s => (
                      <div
                        key={s.id}
                        onClick={() => editingSessionId !== s.id && (hasHistorySearch ? openHistorySession(s) : openSession(s.id))}
                        className="flex items-center gap-2 px-3 py-2 text-[11px] cursor-pointer transition-colors group text-surface-300 hover:bg-surface-750"
                      >
                        {s.pinned ? (
                          <Pin size={11} className="text-amber-400 flex-shrink-0 -rotate-45" />
                        ) : (
                          <MessageCircle size={11} className="text-surface-600 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
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
                              className="w-full bg-surface-700 border border-surface-600 rounded px-1.5 py-0.5 text-[11px] text-surface-100 focus:outline-none focus:border-primary-500"
                              placeholder="Session name..."
                            />
                          ) : (
                            <>
                              <div className="truncate">{s.name}</div>
                              {hasHistorySearch && s.matchSnippet && s.matchType === 'content' && (
                                <div className="truncate text-[10px] text-surface-500 mt-0.5">{s.matchSnippet}</div>
                              )}
                            </>
                          )}
                        </div>
                        {s.branch && (
                          <span className="flex items-center gap-0.5 px-1 py-0.5 rounded bg-green-500/10 text-green-400 text-[9px] font-mono flex-shrink-0">
                            <GitBranch size={8} />
                            {s.branch}
                          </span>
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
                              {hasHistorySearch ? (s.matchType || 'match') : `${s.messageCount || 0} msg`}
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
                    {hasHistorySearch ? 'No matching sessions found' : 'Close tabs to see them here'}
                  </div>
                )}

                {/* Load archived sessions */}
                <button
                  onClick={async () => {
                    try {
                      const r = await fetch(`/api/projects/${projectId}/chat/sessions?includeArchived=true`);
                      const data = await r.json();
                      if (data.sessions) setSessions(prev => mergeSessionLists(prev, data.sessions));
                    } catch {}
                  }}
                  className="w-full px-3 py-1.5 text-[10px] text-surface-500 hover:text-surface-300 hover:bg-surface-700/30 text-center border-t border-surface-700/50 transition-colors"
                >
                  Load older sessions
                </button>
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

      {allCollapsed ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-surface-500">
          Loading main thread...
        </div>
      ) : (
          <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${mobileLayout ? '' : 'md:flex-row'}`}>
            <div
              className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden ${splitGridClass}`}
            >
              {openTabs.map(tabId => {
                const tabSession = sessions.find(s => s.id === tabId);
                const isMainTab = tabId === mainSession?.id;
                const isActiveChildTab = tabId === activeChildSessionId;
                const tabVisible = isMainTab || isActiveChildTab;
                const mainThreadRailActive = isMainTab && activeChildSessionId;
                const mainThreadPaneCollapsed = mainThreadRailActive && !mainThreadPaneExpanded;
                const visibilityClass = isMainTab
                  ? (activeChildSessionId ? (mobileLayout ? 'hidden' : 'hidden md:flex') : 'flex')
                  : isActiveChildTab
                    ? 'flex'
                    : 'hidden';
                const paneFrameClass = activeChildSessionId && !mobileLayout
                  ? isMainTab
                    ? `md:justify-self-start md:rounded-2xl md:border md:border-surface-700/55 md:shadow-[0_14px_40px_rgba(0,0,0,0.22)] md:transition-all md:duration-500 ${mainThreadPaneCollapsed ? 'md:w-full' : 'md:z-30 md:w-[min(56rem,calc(100vw-2rem))] md:shadow-[0_20px_70px_rgba(0,0,0,0.45)]'}`
                    : 'md:rounded-2xl md:border md:border-surface-800 md:shadow-[0_14px_40px_rgba(0,0,0,0.22)]'
                  : '';

              return (
                <div
                  key={tabId}
                  onMouseEnter={isMainTab ? () => {
                    if (!mainThreadHoverSuppressed) setMainThreadPaneHovered(true);
                  } : undefined}
                  onMouseLeave={isMainTab ? () => {
                    setMainThreadPaneHovered(false);
                    setMainThreadHoverSuppressed(false);
                  } : undefined}
                  onFocusCapture={isMainTab ? () => {
                    if (!mainThreadHoverSuppressed) setMainThreadPaneFocused(true);
                  } : undefined}
                  onBlurCapture={isMainTab ? (event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setMainThreadPaneFocused(false);
                  } : undefined}
                  className={`${visibilityClass} ${paneFrameClass} relative min-h-0 flex-col overflow-hidden bg-[#0d1117]`}
                >
                  <div className="flex min-h-0 flex-1 flex-col">
                    {tabSession?.pending ? (
                      <div className="flex-1 min-h-0 flex items-center justify-center text-surface-500 text-sm gap-2">
                        <Loader size={16} className="animate-spin" />
                        Creating session...
                      </div>
                    ) : (
                      <ChatSessionContent
                        projectId={projectId}
                        sessionId={tabId}
                        wsRef={wsRef}
                        wsConnectionVersion={wsConnectionVersion}
                        mode={mode}
                        tool={tool}
                        session={tabSession}
                        isVisible={isActive && tabVisible}
                        projectSwitchKey={projectSwitchKey}
                        onSessionUpdate={handleSessionUpdate}
                        onUnreadChange={onUnreadChange}
                        onUpdateSessionConfig={updateSessionAssistantConfig}
                        containerName={containerName}
                        project={project}
                        containerRepos={containerRepos}
                        onProjectUpdated={onProjectUpdated}
                        initialMessage={pendingInitialMessages[tabId]}
                        directMainMessage={pendingDirectMainMessages[tabId]}
                        onInitialMessageHandled={handleInitialMessageHandled}
                        onDirectMainMessageHandled={handleDirectMainMessageHandled}
                        isSelected={activeSessionId === tabId}
                        onChangedFilesChange={handleChangedFilesChange}
                        mainSession={mainSession}
                        onOpenMain={openMainThread}
                        onCloseSession={() => closeTab(tabId)}
                        onMainThreadSend={handleGlobalSend}
                        mainThreadSessionBubbles={mainThreadSessionBubbles}
                        anchorScrollSignal={isMainTab ? mainThreadAnchorScrollSignal : ''}
                        focusInputSignal={isActiveChildTab ? sessionInputFocusSignal : 0}
                        contracted={mainThreadPaneCollapsed}
                        mobileLayout={mobileLayout}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
