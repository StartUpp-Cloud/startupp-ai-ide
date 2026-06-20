import { Bot, User, AlertTriangle, CheckCircle, Loader, ChevronDown, ChevronRight, Info, Terminal, FileText } from 'lucide-react';
import { useEffect, useState, useMemo } from 'react';

const ROLE_STYLES = {
  user: { align: 'justify-end', bubble: 'bg-blue-600/15 border-blue-500/20', icon: User, label: 'You' },
  agent: { align: 'justify-start', bubble: 'bg-surface-800/60 border-surface-700/40', icon: Bot, label: 'Agent' },
  system: { align: 'justify-center', bubble: 'bg-yellow-900/15 border-yellow-600/15 text-yellow-300/70 text-sm', icon: Info, label: 'System' },
  progress: { align: 'justify-start', bubble: 'bg-surface-800/30 border-surface-700/20', icon: Loader, label: 'Progress' },
  error: { align: 'justify-start', bubble: 'bg-red-900/15 border-red-500/20 text-red-300', icon: AlertTriangle, label: 'Error' },
};

/**
 * Verification strip — renders the diligence verdict attached by the server's
 * completion gate (whether the agent's work was judged done + verified, how it
 * was validated, and any outstanding items). Compact by default.
 */
function DiligenceStrip({ diligence }) {
  const [open, setOpen] = useState(false);
  const v = diligence.verification || {};
  const done = !!diligence.done;
  const ran = !!v.ran;
  const passed = v.passed;

  const tone = done && (passed !== false)
    ? { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-300', Icon: CheckCircle }
    : passed === false
      ? { border: 'border-red-500/30', bg: 'bg-red-500/5', text: 'text-red-300', Icon: AlertTriangle }
      : { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-300', Icon: AlertTriangle };

  const verifyLabel = !ran
    ? 'not verified'
    : passed === true ? `verified · ${v.kind || 'tests'}`
    : passed === false ? `${v.kind || 'tests'} failing`
    : `ran ${v.kind || 'checks'}`;

  const outstanding = Array.isArray(diligence.outstanding) ? diligence.outstanding : [];
  const hasDetail = outstanding.length > 0 || v.details;

  return (
    <div className={`mt-2 rounded-md border ${tone.border} ${tone.bg} px-2 py-1.5`}>
      <button
        type="button"
        onClick={() => hasDetail && setOpen(!open)}
        className={`flex w-full items-center gap-2 text-left text-[11px] ${tone.text} ${hasDetail ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <tone.Icon size={12} className="flex-shrink-0" />
        <span className="font-medium">{done ? 'Done' : 'Needs follow-up'}</span>
        <span className="text-surface-400">·</span>
        <span className="text-surface-300">{verifyLabel}</span>
        {typeof diligence.confidence === 'number' && (
          <>
            <span className="text-surface-400">·</span>
            <span className="text-surface-400">{Math.round(diligence.confidence * 100)}% conf</span>
          </>
        )}
        {diligence.rounds > 0 && (
          <>
            <span className="text-surface-400">·</span>
            <span className="text-surface-400">{diligence.rounds} nudge{diligence.rounds > 1 ? 's' : ''}</span>
          </>
        )}
        {hasDetail && (open ? <ChevronDown size={11} className="ml-auto" /> : <ChevronRight size={11} className="ml-auto" />)}
      </button>
      {open && hasDetail && (
        <div className="mt-1.5 space-y-1 text-[11px] text-surface-300">
          {v.details && <div className="text-surface-400">{v.details}</div>}
          {outstanding.length > 0 && (
            <ul className="list-disc ml-4 space-y-0.5">
              {outstanding.map((o, i) => <li key={i}>{o}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Final checklist rendered on a completed agent message — the run's steps and
 * the report's verification checks, each with a pass/fail/skip icon.
 */
function MessageChecks({ checks }) {
  if (!checks || checks.length === 0) return null;
  const iconFor = (status) => {
    if (status === 'done') return { Icon: CheckCircle, cls: 'text-emerald-400' };
    if (status === 'fail') return { Icon: AlertTriangle, cls: 'text-red-400' };
    if (status === 'skip') return { Icon: Info, cls: 'text-amber-400' };
    return { Icon: Info, cls: 'text-surface-500' };
  };
  return (
    <div className="mt-2 rounded-md border border-surface-700/30 bg-surface-950/40 p-2">
      <div className="mb-1.5 text-[11px] font-medium text-surface-400">Checks</div>
      <div className="space-y-1">
        {checks.map((c, i) => {
          const { Icon, cls } = iconFor(c.status);
          return (
            <div key={c.id ?? i} className="flex items-start gap-2">
              <Icon size={12} className={`mt-0.5 flex-shrink-0 ${cls}`} />
              <div className="min-w-0 text-[11px] leading-snug">
                <span className="text-surface-200">
                  {c.verify && <span className="mr-1.5 rounded bg-surface-700/60 px-1 py-px text-[9px] uppercase tracking-wide text-surface-400">verify</span>}
                  {c.label}
                </span>
                {c.detail && <span className="text-surface-500"> — {c.detail}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Post-deploy visual validation result — the deployed URL was loaded in a real
 * browser; shows the verdict, a screenshot, and any console/network errors.
 */
function VisualValidationCard({ vv }) {
  const [open, setOpen] = useState(!vv.passed);
  const screenshotUrl = vv.screenshot ? `/api/debug/screenshots/${vv.screenshot.split('/').pop()}` : null;
  const tone = vv.passed
    ? { border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', text: 'text-emerald-300', Icon: CheckCircle }
    : { border: 'border-amber-500/30', bg: 'bg-amber-500/5', text: 'text-amber-300', Icon: AlertTriangle };
  const errors = [...(vv.consoleErrors || []), ...(vv.failedRequests || [])];
  return (
    <div className={`mt-2 rounded-md border ${tone.border} ${tone.bg} p-2`}>
      <button type="button" onClick={() => setOpen(!open)} className={`flex w-full items-center gap-2 text-left text-[12px] ${tone.text}`}>
        <tone.Icon size={13} className="flex-shrink-0" />
        <span className="font-medium">Visual validation {vv.passed ? 'passed' : 'found issues'}</span>
        {vv.httpStatus ? <span className="text-surface-400">· HTTP {vv.httpStatus}</span> : null}
        {vv.url ? <span className="truncate text-surface-500" title={vv.url}>· {vv.url}</span> : null}
        <span className="ml-auto">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
      </button>
      <div className="mt-1 text-[11px] text-surface-300">{vv.summary}</div>
      {open && (
        <div className="mt-2 space-y-2">
          {screenshotUrl && (
            <a href={screenshotUrl} target="_blank" rel="noreferrer" className="block">
              <img src={screenshotUrl} alt="Deployed page screenshot" className="max-h-72 w-full rounded border border-surface-700/40 object-contain object-top bg-surface-950/40" loading="lazy" />
            </a>
          )}
          {errors.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-red-300/90">
              {errors.slice(0, 8).map((e, i) => (
                <li key={i} className="truncate" title={e.text || e.url}>• {e.text || `${e.url || ''} ${e.status || e.error || ''}`}</li>
              ))}
            </ul>
          )}
          {vv.intentMatch?.assessed && !vv.intentMatch.matches && (
            <div className="text-[11px] text-amber-300/90">
              <div className="font-medium">Visual review: doesn't match the request</div>
              <ul className="mt-0.5 space-y-0.5">
                {(vv.intentMatch.issues || []).slice(0, 6).map((it, i) => <li key={i}>• {it}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lightweight markdown renderer — handles the common formatting cases
 * without pulling in a heavy library.
 */
function renderMarkdown(text) {
  if (!text) return null;

  // Convert common HTML tags to markdown before processing
  let cleaned = String(text)
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[()][A-Za-z0-9]/g, '')
    .replace(/\x1B[78=><]/g, '')
    .replace(/\x1B./g, '')
    .replace(/␛\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/␛[78=><]?/g, '')
    .replace(/<b>([\s\S]*?)<\/b>/gi, '**$1**')
    .replace(/<strong>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<i>([\s\S]*?)<\/i>/gi, '*$1*')
    .replace(/<em>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/?p>/gi, '')
    .replace(/<\/?div>/gi, '\n')
    .replace(/<li>([\s\S]*?)<\/li>/gi, '- $1')
    .replace(/<\/?[uo]l>/gi, '')
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gi, (_, level, content) => '#'.repeat(parseInt(level)) + ' ' + content)
    // Catch any remaining HTML tags
    .replace(/<\/?[a-z][a-z0-9]*[^>]*>/gi, '');

  const lines = cleaned.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeLines = [];
  let codeLang = '';

  const processInline = (line) => {
    // Bold: **text** or __text__
    // Inline code: `text`
    // Links: [text](url)
    const parts = [];
    let remaining = line;
    let key = 0;

    while (remaining.length > 0) {
      // Code inline: `...`
      const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
      if (codeMatch) {
        if (codeMatch[1]) parts.push(<span key={key++}>{processInlineSimple(codeMatch[1])}</span>);
        parts.push(<code key={key++} className="px-1 py-0.5 rounded bg-surface-700/60 text-primary-300 text-[12px] font-mono">{codeMatch[2]}</code>);
        remaining = codeMatch[3];
        continue;
      }

      // Bold: **...**
      const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/);
      if (boldMatch) {
        if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>);
        parts.push(<strong key={key++} className="font-semibold text-surface-100">{boldMatch[2]}</strong>);
        remaining = boldMatch[3];
        continue;
      }

      // No more matches
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    return parts;
  };

  const processInlineSimple = (text) => {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/__(.+?)__/g, '<b>$1</b>');
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${i}`} className="my-2 p-3 rounded-md bg-surface-950/80 border border-surface-700/30 text-[12px] font-mono text-surface-300 overflow-x-auto">
            {codeLang && <div className="text-[10px] text-surface-500 mb-1 uppercase">{codeLang}</div>}
            {codeLines.join('\n')}
          </pre>
        );
        codeLines = [];
        codeLang = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={`br-${i}`} className="h-2" />);
      continue;
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="text-[13px] font-semibold text-surface-100 mt-2 mb-1">{processInline(line.slice(4))}</h4>);
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="text-sm font-semibold text-surface-100 mt-2 mb-1">{processInline(line.slice(3))}</h3>);
      continue;
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={i} className="text-[15px] font-bold text-surface-100 mt-2 mb-1">{processInline(line.slice(2))}</h2>);
      continue;
    }

    // Checkbox list: - [ ] or - [x]
    const checkMatch = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checkMatch) {
      const checked = checkMatch[1] !== ' ';
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-1 py-0.5">
          {checked
            ? <CheckCircle size={13} className="text-green-400 mt-0.5 flex-shrink-0" />
            : <div className="w-[13px] h-[13px] rounded border border-surface-600 mt-0.5 flex-shrink-0" />
          }
          <span className={checked ? 'text-surface-400 line-through' : 'text-surface-200'}>{processInline(checkMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Bullet list: - item or * item
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-1 py-0.5">
          <span className="text-primary-400 mt-0.5 flex-shrink-0">•</span>
          <span className="text-surface-200">{processInline(bulletMatch[1])}</span>
        </div>
      );
      continue;
    }

    // Numbered list: 1. item
    const numMatch = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numMatch) {
      elements.push(
        <div key={i} className="flex items-start gap-2 pl-1 py-0.5">
          <span className="text-surface-500 text-[11px] font-mono mt-0.5 flex-shrink-0 w-4 text-right">{numMatch[1]}.</span>
          <span className="text-surface-200">{processInline(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/) || line.match(/^\*\*\*+$/)) {
      elements.push(<hr key={i} className="border-surface-700/50 my-2" />);
      continue;
    }

    // Regular paragraph
    elements.push(<p key={i} className="text-surface-200">{processInline(line)}</p>);
  }

  // Close unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key="code-end" className="my-2 p-3 rounded-md bg-surface-950/80 border border-surface-700/30 text-[12px] font-mono text-surface-300 overflow-x-auto">
        {codeLines.join('\n')}
      </pre>
    );
  }

  return elements;
}

function useTypedContent(content, enabled) {
  const fullText = String(content || '');
  const [typedText, setTypedText] = useState(enabled ? '' : fullText);

  useEffect(() => {
    if (!enabled) {
      setTypedText(fullText);
      return undefined;
    }

    let index = 0;
    setTypedText('');
    const timer = setInterval(() => {
      index = Math.min(fullText.length, index + 8);
      setTypedText(fullText.slice(0, index));
      if (index >= fullText.length) clearInterval(timer);
    }, 8);

    return () => clearInterval(timer);
  }, [enabled, fullText]);

  return typedText;
}

export default function ChatMessage({ message, wsRef, projectId, onSend, onRetry, animateContent = false, threadKind = 'session' }) {
  const [showRaw, setShowRaw] = useState(false);
  const [showChangedFiles, setShowChangedFiles] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [logFilePath, setLogFilePath] = useState('');
  const [showLogInput, setShowLogInput] = useState(false);
  const shellPrompt = message.metadata?.shell?.prompt;
  const isShellMessage = message.metadata?.channel === 'shell' || Boolean(message.metadata?.shell);
  const style = isShellMessage && message.role !== 'user'
    ? { align: 'justify-start', bubble: 'bg-amber-500/10 border-amber-500/20', icon: Terminal, label: 'Shell' }
    : ROLE_STYLES[message.role] || ROLE_STYLES.agent;
  const Icon = style.icon;
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const tasks = message.metadata?.tasks;
  const tool = message.metadata?.tool;
  const rawOutput = message.metadata?.rawOutput;
  const changedFiles = Array.isArray(message.metadata?.changedFiles)
    ? message.metadata.changedFiles.filter(file => file?.path)
    : [];
  const plan = message.metadata?.plan;
  const suggestions = message.metadata?.suggestions;
  const review = message.metadata?.review;
  const logContext = message.metadata?.logContext;
  const diligence = message.metadata?.diligence;
  const checks = Array.isArray(message.metadata?.checks) ? message.metadata.checks : [];
  const activity = message.metadata?.activity;
  const visualValidation = message.metadata?.visualValidation;

  // Suggestion buttons: render as a row of clickable chips
  if (suggestions && message.metadata?.hidden) {
    return (
      <div className="flex flex-wrap gap-1.5 mb-3 px-3">
        {suggestions.map((s, i) => (
          <button
            key={i}
            onClick={() => onSend?.(s)}
            className="px-3 py-1 text-[11px] rounded-full border border-primary-500/30 bg-primary-500/10 text-primary-300 hover:bg-primary-500/20 hover:border-primary-500/50 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    );
  }

  const typedContent = useTypedContent(message.content, animateContent && (message.role === 'agent' || message.role === 'error'));
  const isTyping = animateContent && typedContent.length < String(message.content || '').length;

  // Memoize markdown rendering
  const renderedContent = useMemo(() => renderMarkdown(typedContent), [typedContent]);

  const handleApprovePlan = () => {
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-approve-plan',
        projectId: projectId || message.projectId,
        steps: plan,
      }));
    }
  };

  const handleRetry = () => {
    if (typeof onRetry === 'function') {
      onRetry(message);
    }
  };

  const handleApproveReview = () => {
    if (typeof onRetry === 'function') {
      onRetry(message, { executeReviewedPlan: true });
    }
  };

  const shellResponseLabel = (response) => {
    if (response === 'y') return 'Yes';
    if (response === 'n') return 'No';
    if (response === 'ctrl-c') return 'Ctrl-C';
    if (response === 'enter') return 'Enter';
    if (response === 'down') return 'Down';
    if (response === 'up') return 'Up';
    return response;
  };

  return (
    <div className={`flex ${style.align} mb-3 w-full min-w-0 px-3`}>
      <div className={`min-w-0 max-w-[85%] rounded-lg border px-3 py-2 ${style.bubble} ${threadKind === 'main' ? 'shadow-[0_0_0_1px_rgba(14,165,233,0.08)]' : ''}`}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5 text-[11px] text-surface-500">
          <Icon size={12} />
          <span>{style.label}</span>
          <span className={`rounded px-1.5 py-0.5 text-[9px] ${threadKind === 'main' ? 'bg-primary-500/10 text-primary-300' : 'bg-surface-700/50 text-surface-400'}`}>
            {threadKind === 'main' ? 'Main' : 'Session'}
          </span>
          {tool && <span className="text-purple-400">via {tool}</span>}
          <span className="ml-auto tabular-nums">{time}</span>
        </div>

        {/* Content — rendered as markdown */}
        <div className="text-sm leading-relaxed break-words">
          {renderedContent}
          {isTyping && <span className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse bg-surface-300" />}
        </div>

        {shellPrompt?.responses?.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {shellPrompt.responses.map((response) => {
              return (
                <button
                  key={response}
                  onClick={() => onSend?.(response, [], { channel: 'shell' })}
                  className="px-2 py-1 rounded border border-amber-500/40 text-[11px] text-amber-200 hover:bg-amber-500/10 transition-colors"
                >
                  {shellResponseLabel(response)}
                </button>
              );
            })}
          </div>
        )}

        {/* Task list */}
        {tasks && tasks.length > 0 && (
          <div className="mt-2 space-y-1">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {task.status === 'done' && <CheckCircle size={12} className="text-green-400" />}
                {task.status === 'running' && <Loader size={12} className="text-blue-400 animate-spin" />}
                {task.status === 'pending' && <div className="w-3 h-3 rounded-full border border-surface-600" />}
                {task.status === 'failed' && <AlertTriangle size={12} className="text-red-400" />}
                <span className={task.status === 'done' ? 'text-surface-500 line-through' : 'text-surface-300'}>
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Plan approval button */}
        {plan && plan.length > 0 && (
          <div className="mt-2">
            <button onClick={handleApprovePlan} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-md transition-colors">
              Approve &amp; Execute Plan
            </button>
          </div>
        )}

        {checks.length > 0 && <MessageChecks checks={checks} />}

        {visualValidation && <VisualValidationCard vv={visualValidation} />}

        {diligence && (
          <DiligenceStrip diligence={diligence} />
        )}

        {(rawOutput || changedFiles.length > 0 || activity) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {activity && (
              <button onClick={() => setShowActivity(!showActivity)} className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-surface-300 transition-colors">
                {showActivity ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Show activity
              </button>
            )}
            {rawOutput && (
              <button onClick={() => setShowRaw(!showRaw)} className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-surface-300 transition-colors">
                {showRaw ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Raw output
              </button>
            )}
            {changedFiles.length > 0 && (
              <button onClick={() => setShowChangedFiles(!showChangedFiles)} className="flex items-center gap-1 text-[11px] text-surface-500 hover:text-surface-300 transition-colors">
                {showChangedFiles ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Files edited in this session ({changedFiles.length})
              </button>
            )}
          </div>
        )}
        {showActivity && activity && (
          <div className="mt-1 p-2 bg-surface-950/60 rounded border border-surface-700/20 text-[12px] text-surface-400 max-h-72 overflow-y-auto whitespace-pre-wrap leading-relaxed">
            {activity}
          </div>
        )}
        {showRaw && rawOutput && (
          <pre className="mt-1 p-2 bg-surface-950/80 rounded border border-surface-700/20 text-[11px] font-mono text-surface-400 overflow-x-auto max-h-48 overflow-y-auto">
            {rawOutput}
          </pre>
        )}
        {showChangedFiles && changedFiles.length > 0 && (
          <div className="mt-1 rounded border border-surface-700/20 bg-surface-950/50 p-2">
            <div className="grid gap-1 sm:grid-cols-2">
              {changedFiles.map(file => (
                <div key={`${file.status}:${file.path}`} className="flex min-w-0 items-center gap-2 font-mono text-[11px] text-surface-300">
                  <span className="w-5 flex-shrink-0 rounded bg-primary-500/10 px-1 text-center text-[10px] text-primary-300">{file.status || 'M'}</span>
                  <span className="truncate" title={file.path}>{file.path}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {review?.type === 'prd-review' && (
          <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2">
            <div className="text-[11px] text-emerald-300 font-medium">Review Document: {review.docPath}</div>
            {review.summary?.title && <div className="text-xs text-surface-200 mt-1 font-medium">{review.summary.title}</div>}
            {Array.isArray(review.summary?.highlights) && review.summary.highlights.length > 0 && (
              <ul className="mt-1 text-xs text-surface-300 list-disc ml-4">
                {review.summary.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            )}
            <details className="mt-2">
              <summary className="text-[11px] text-surface-400 cursor-pointer">Open markdown preview</summary>
              {review.docPreview ? (
                <pre className="mt-1 p-2 bg-surface-950/80 rounded border border-surface-700/20 text-[11px] font-mono text-surface-300 overflow-x-auto max-h-56 overflow-y-auto">{review.docPreview}</pre>
              ) : (
                <div className="mt-1 p-2 rounded border border-surface-700/20 text-[11px] text-surface-400">
                  Preview unavailable from filesystem path in this workspace. You can still approve execution.
                </div>
              )}
            </details>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={handleApproveReview}
                className="px-2 py-1 rounded border border-emerald-500/50 text-[11px] text-emerald-200 hover:bg-emerald-500/10 transition-colors"
              >
                Approve & Execute
              </button>
              <button
                onClick={handleRetry}
                className="px-2 py-1 rounded border border-surface-600/60 text-[11px] text-surface-300 hover:text-surface-100 hover:border-primary-500/50 hover:bg-primary-500/10 transition-colors"
              >
                Re-evaluate
              </button>
            </div>
          </div>
        )}

        {logContext?.detected && (
          <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
            <div className="text-[11px] text-amber-300 font-medium mb-1.5">The agent may need additional context</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => {
                  if (wsRef?.current?.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                      type: 'chat-capture-logs',
                      projectId: projectId || message.projectId,
                      sessionId: message.sessionId,
                    }));
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 rounded border border-amber-500/40 text-[11px] text-amber-200 hover:bg-amber-500/10 transition-colors"
              >
                <Terminal size={10} />
                Share Terminal Output
              </button>
              <button
                onClick={() => setShowLogInput(!showLogInput)}
                className="flex items-center gap-1 px-2 py-1 rounded border border-amber-500/40 text-[11px] text-amber-200 hover:bg-amber-500/10 transition-colors"
              >
                <FileText size={10} />
                Capture Log File
              </button>
            </div>
            {showLogInput && (
              <div className="flex items-center gap-1.5 mt-2">
                <input
                  type="text"
                  value={logFilePath}
                  onChange={e => setLogFilePath(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && logFilePath.trim()) {
                      if (wsRef?.current?.readyState === WebSocket.OPEN) {
                        wsRef.current.send(JSON.stringify({
                          type: 'chat-capture-logs',
                          projectId: projectId || message.projectId,
                          sessionId: message.sessionId,
                          filePath: logFilePath.trim(),
                        }));
                        setLogFilePath('');
                        setShowLogInput(false);
                      }
                    }
                  }}
                  placeholder="/var/log/app.log"
                  className="flex-1 px-2 py-1 bg-surface-900 border border-surface-600 rounded text-[11px] text-surface-200 outline-none focus:border-amber-500/50 font-mono"
                />
                <button
                  onClick={() => {
                    if (logFilePath.trim() && wsRef?.current?.readyState === WebSocket.OPEN) {
                      wsRef.current.send(JSON.stringify({
                        type: 'chat-capture-logs',
                        projectId: projectId || message.projectId,
                        sessionId: message.sessionId,
                        filePath: logFilePath.trim(),
                      }));
                      setLogFilePath('');
                      setShowLogInput(false);
                    }
                  }}
                  className="px-2 py-1 rounded border border-amber-500/50 text-[11px] text-amber-200 hover:bg-amber-500/10 transition-colors"
                >
                  Send
                </button>
              </div>
            )}
          </div>
        )}

        {!isShellMessage && (message.role === 'agent' || message.role === 'error') && (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={handleRetry}
              className="px-2 py-1 rounded border border-surface-600/60 text-[11px] text-surface-300 hover:text-surface-100 hover:border-primary-500/50 hover:bg-primary-500/10 transition-colors"
              title="Retry this response"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
