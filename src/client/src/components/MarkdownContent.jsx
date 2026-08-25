import { CheckCircle } from 'lucide-react';
import {
  parseMarkdownBlocks,
  blockNeedsTrailSpace,
  listItemSpacingClass,
  parseInlineTokens,
} from '../utils/chatMarkdown.js';

function cleanMarkdownSource(text) {
  return String(text || '')
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
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/gi, (_, level, content) => `${'#'.repeat(parseInt(level, 10))} ${content}`)
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)')
    .replace(/<\/?[a-z][a-z0-9]*[^>]*>/gi, '');
}

/**
 * Shared markdown renderer for chat bubbles and the markdown file reader.
 */
export default function MarkdownContent({ text, onOpenWorkspaceFile = null, className = '' }) {
  if (!text) return null;

  const cleaned = cleanMarkdownSource(text);

  const processInline = (line) => parseInlineTokens(line).map((token, key) => {
    if (token.type === 'code') {
      return <code key={key} className="px-1 py-0.5 rounded bg-surface-700/60 text-primary-300 text-[12px] font-mono">{token.value}</code>;
    }
    if (token.type === 'bold') {
      return <strong key={key} className="font-semibold text-surface-100">{token.value}</strong>;
    }
    if (token.type === 'link') {
      if (token.kind === 'file') {
        if (typeof onOpenWorkspaceFile === 'function') {
          return (
            <button
              key={key}
              type="button"
              onClick={() => onOpenWorkspaceFile(token.href)}
              title={token.href}
              className="inline text-left text-primary-300 underline decoration-primary-500/40 underline-offset-2 hover:text-primary-200"
            >
              {token.label}
            </button>
          );
        }
        return (
          <span key={key} className="font-mono text-[12px] text-primary-300/90" title={token.href}>
            {token.label}
          </span>
        );
      }
      return (
        <a
          key={key}
          href={token.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-300 underline decoration-primary-500/40 underline-offset-2 hover:text-primary-200"
        >
          {token.label}
        </a>
      );
    }
    return <span key={key}>{token.value}</span>;
  });

  const listRow = (key, indent, marker, body, extraClass = '') => (
    <div key={key} className={`flex items-start gap-1.5 leading-snug ${extraClass}`.trim()} style={{ paddingLeft: `${4 + indent * 16}px` }}>
      {marker}
      <span className="min-w-0 flex-1 text-surface-200">{body}</span>
    </div>
  );

  const blocks = parseMarkdownBlocks(cleaned);
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const isList = block.type === 'bullet' || block.type === 'number' || block.type === 'check';
        const trail = isList ? listItemSpacingClass(blocks, i) : (blockNeedsTrailSpace(blocks, i) ? 'mb-2.5' : '');
        const headingMt = i === 0 ? 'mt-0' : 'mt-3';
        if (block.type === 'code') {
          return (
            <pre key={`code-${i}`} className="my-2 p-3 rounded-md bg-surface-950/80 border border-surface-700/30 text-[12px] font-mono text-surface-300 overflow-x-auto">
              {block.lang && <div className="text-[10px] text-surface-500 mb-1 uppercase">{block.lang}</div>}
              {block.text}
            </pre>
          );
        }
        if (block.type === 'gap') return <div key={`gap-${i}`} className="h-1.5" />;
        if (block.type === 'h4') return <h4 key={i} className={`text-sm font-semibold text-surface-100 ${headingMt} mb-1.5`}>{processInline(block.text)}</h4>;
        if (block.type === 'h3') return <h3 key={i} className={`text-[15px] font-semibold text-surface-100 ${headingMt} mb-1.5`}>{processInline(block.text)}</h3>;
        if (block.type === 'h2') return <h2 key={i} className={`text-base font-bold text-surface-100 ${headingMt} mb-1.5`}>{processInline(block.text)}</h2>;
        if (block.type === 'hr') return <hr key={i} className="border-surface-700/50 my-2" />;
        if (block.type === 'bullet') {
          return listRow(i, block.indent, <span className="text-primary-400 mt-0.5 flex-shrink-0">•</span>, processInline(block.text), trail);
        }
        if (block.type === 'number') {
          return listRow(
            i,
            block.indent,
            <span className="w-4 flex-shrink-0 text-right text-[11px] font-mono text-surface-500 mt-0.5">{block.n}.</span>,
            processInline(block.text),
            trail,
          );
        }
        if (block.type === 'check') {
          return listRow(
            i,
            block.indent,
            block.checked
              ? <CheckCircle size={13} className="text-green-400 mt-0.5 flex-shrink-0" />
              : <div className="w-[13px] h-[13px] rounded border border-surface-600 mt-0.5 flex-shrink-0" />,
            <span className={block.checked ? 'text-surface-400 line-through' : undefined}>{processInline(block.text)}</span>,
            trail,
          );
        }
        if (block.type === 'table') {
          return (
            <div key={i} className="my-2 overflow-x-auto rounded-md border border-surface-700/40">
              <table className="min-w-full text-left text-[12px]">
                <thead className="bg-surface-900/80 text-surface-300">
                  <tr>
                    {block.headers.map((cell, ci) => (
                      <th key={ci} className="border-b border-surface-700/40 px-2 py-1 font-semibold">{processInline(cell)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={ri} className="odd:bg-surface-950/30">
                      {row.map((cell, ci) => (
                        <td key={ci} className="border-t border-surface-700/25 px-2 py-0.5 text-surface-200">{processInline(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i} className={`text-surface-200 leading-relaxed ${trail}`.trim()}>{processInline(block.text)}</p>;
      })}
    </div>
  );
}

export function isMarkdownPath(path) {
  return /\.md$/i.test(String(path || ''));
}
