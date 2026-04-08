import { Bot, User, AlertTriangle, CheckCircle, Loader, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useState, useMemo } from 'react';

const ROLE_STYLES = {
  user: { align: 'justify-end', bubble: 'bg-blue-600/15 border-blue-500/20', icon: User, label: 'You' },
  agent: { align: 'justify-start', bubble: 'bg-surface-800/60 border-surface-700/40', icon: Bot, label: 'Agent' },
  system: { align: 'justify-center', bubble: 'bg-yellow-900/15 border-yellow-600/15 text-yellow-300/70 text-sm', icon: Info, label: 'System' },
  progress: { align: 'justify-start', bubble: 'bg-surface-800/30 border-surface-700/20', icon: Loader, label: 'Progress' },
  error: { align: 'justify-start', bubble: 'bg-red-900/15 border-red-500/20 text-red-300', icon: AlertTriangle, label: 'Error' },
};

/**
 * Lightweight markdown renderer — handles the common formatting cases
 * without pulling in a heavy library.
 */
function renderMarkdown(text) {
  if (!text) return null;

  // Convert common HTML tags to markdown before processing
  let cleaned = text
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

export default function ChatMessage({ message, wsRef, projectId, onSend, onRetry }) {
  const [showRaw, setShowRaw] = useState(false);
  const style = ROLE_STYLES[message.role] || ROLE_STYLES.agent;
  const Icon = style.icon;
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const tasks = message.metadata?.tasks;
  const tool = message.metadata?.tool;
  const rawOutput = message.metadata?.rawOutput;
  const plan = message.metadata?.plan;
  const suggestions = message.metadata?.suggestions;
  const review = message.metadata?.review;

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

  // Memoize markdown rendering
  const renderedContent = useMemo(() => renderMarkdown(message.content), [message.content]);

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

  return (
    <div className={`flex ${style.align} mb-3 px-3`}>
      <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${style.bubble}`}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-1.5 text-[11px] text-surface-500">
          <Icon size={12} />
          <span>{style.label}</span>
          {tool && <span className="text-purple-400">via {tool}</span>}
          <span className="ml-auto tabular-nums">{time}</span>
        </div>

        {/* Content — rendered as markdown */}
        <div className="text-sm leading-relaxed break-words">
          {renderedContent}
        </div>

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

        {/* Raw output toggle */}
        {rawOutput && (
          <button onClick={() => setShowRaw(!showRaw)} className="flex items-center gap-1 mt-2 text-[11px] text-surface-500 hover:text-surface-300 transition-colors">
            {showRaw ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            Raw output
          </button>
        )}
        {showRaw && rawOutput && (
          <pre className="mt-1 p-2 bg-surface-950/80 rounded border border-surface-700/20 text-[11px] font-mono text-surface-400 overflow-x-auto max-h-48 overflow-y-auto">
            {rawOutput}
          </pre>
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
              <pre className="mt-1 p-2 bg-surface-950/80 rounded border border-surface-700/20 text-[11px] font-mono text-surface-300 overflow-x-auto max-h-56 overflow-y-auto">{review.docPreview}</pre>
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

        {(message.role === 'agent' || message.role === 'error') && (
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
