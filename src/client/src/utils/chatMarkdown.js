/**
 * Parse agent/plan markdown into renderable blocks so chat can show
 * tight lists, nested bullets, and schema tables.
 */

export function listIndentLevel(leadingWhitespace = '') {
  const expanded = String(leadingWhitespace).replace(/\t/g, '  ');
  return Math.min(6, Math.floor(expanded.length / 2));
}

export function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

export function splitTableRow(line) {
  const trimmed = String(line || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

function isListLine(line) {
  return /^\s*(?:[-*]|\d+[.)])\s+/.test(line);
}

const LIST_BLOCK_TYPES = new Set(['bullet', 'number', 'check']);

/**
 * Last bullet / last paragraph in a run get trailing space so the next
 * heading or section does not sit flush against them.
 */
export function blockNeedsTrailSpace(blocks, index) {
  const block = blocks?.[index];
  if (!block) return false;
  const next = blocks[index + 1];
  if (LIST_BLOCK_TYPES.has(block.type)) {
    return !next || !LIST_BLOCK_TYPES.has(next.type);
  }
  if (block.type === 'p') {
    return !next || next.type !== 'p';
  }
  return false;
}

/** Tight but readable gap between consecutive list items. */
export function listItemSpacingClass(blocks, index) {
  return blockNeedsTrailSpace(blocks, index) ? 'mb-2.5' : 'mb-1';
}

export const CHAT_COLLAPSE_CHARS = 320;
export const CHAT_COLLAPSE_LINES = 6;

export function shouldCollapseChatText(text) {
  const source = String(text || '');
  if (source.length > CHAT_COLLAPSE_CHARS) return true;
  return source.split('\n').length > CHAT_COLLAPSE_LINES;
}

export function previewChatText(text, { maxChars = 280, maxLines = 4 } = {}) {
  const lines = String(text || '').split('\n');
  let preview = lines.slice(0, maxLines).join('\n');
  if (preview.length > maxChars) preview = preview.slice(0, maxChars).trimEnd();
  return preview;
}

export function isSafeHttpUrl(url) {
  try {
    const href = String(url || '').trim();
    // Absolute filesystem paths must not be coerced into https://...
    if (!href || href.startsWith('/') || href.startsWith('\\')) return false;
    const withScheme = /^https?:\/\//i.test(href) ? href : `https://${href}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

export function normalizeHttpUrl(url) {
  const href = String(url || '').trim().replace(/[),.;!?]+$/g, '');
  if (!href) return '';
  return /^https?:\/\//i.test(href) ? href : `https://${href}`;
}

/**
 * True for absolute container paths the IDE can open in the file editor.
 * Rejects schemes and path traversal.
 */
export function isWorkspaceFilePath(href) {
  const raw = String(href || '').trim().replace(/[),.;!?]+$/g, '');
  if (!raw) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  if (raw.includes('\0') || /\\/.test(raw)) return false;

  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    path = raw;
  }
  path = path.replace(/\\/g, '/');
  if (!(path === '/workspace' || path === '/home/dev' || path.startsWith('/workspace/') || path.startsWith('/home/dev/'))) {
    return false;
  }
  const segments = path.split('/');
  if (segments.some((part) => part === '..')) return false;
  return true;
}

export function normalizeWorkspaceFilePath(href) {
  const raw = String(href || '').trim().replace(/[),.;!?]+$/g, '');
  if (!isWorkspaceFilePath(raw)) return '';
  try {
    return decodeURIComponent(raw).replace(/\\/g, '/');
  } catch {
    return raw.replace(/\\/g, '/');
  }
}

/**
 * Compact label for GitHub PRs, issues, and repo URLs.
 */
export function githubLinkLabel(url) {
  try {
    const parsed = new URL(normalizeHttpUrl(url));
    if (!/(^|\.)github\.com$/i.test(parsed.hostname)) return '';
    const pull = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/(pull|issues)\/(\d+)/i);
    if (pull) {
      const kind = pull[3].toLowerCase() === 'pull' ? 'PR' : 'Issue';
      return `${kind} #${pull[4]} (${pull[1]}/${pull[2]})`;
    }
    const repo = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (repo) return `${repo[1]}/${repo[2]}`;
    const rest = parsed.pathname.replace(/^\//, '');
    return rest || 'GitHub';
  } catch {
    return '';
  }
}

export function linkLabelForUrl(href, explicitLabel = '') {
  const label = String(explicitLabel || '').trim();
  if (isWorkspaceFilePath(href)) {
    if (label) return label;
    const path = normalizeWorkspaceFilePath(href);
    return path.split('/').pop() || path;
  }
  const normalized = normalizeHttpUrl(href);
  const rawLooksLikeUrl = !label
    || label === href
    || label === normalized
    || label === String(href || '').replace(/^https?:\/\//i, '');
  if (!rawLooksLikeUrl) return label;
  return githubLinkLabel(normalized) || label || normalized;
}

/**
 * Turn markdown links and bare URLs (especially GitHub PRs) into tokens.
 * Workspace file paths become kind:"file" links for the IDE editor.
 * @returns {Array<{ type: 'text'|'code'|'bold'|'link', value?: string, href?: string, label?: string, kind?: 'http'|'file' }>}
 */
export function parseInlineTokens(line) {
  const tokens = [];
  let remaining = String(line || '');

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
    if (codeMatch) {
      if (codeMatch[1]) tokens.push(...parseInlineTokens(codeMatch[1]));
      tokens.push({ type: 'code', value: codeMatch[2] });
      remaining = codeMatch[3];
      continue;
    }

    const mdLink = remaining.match(/^(.*?)\[([^\]]+)\]\(\s*([^)\s]+)\s*\)(.*)$/);
    if (mdLink) {
      if (mdLink[1]) tokens.push(...parseInlineTokens(mdLink[1]));
      const href = String(mdLink[3] || '').trim();
      if (isWorkspaceFilePath(href)) {
        const path = normalizeWorkspaceFilePath(href);
        tokens.push({ type: 'link', kind: 'file', href: path, label: linkLabelForUrl(path, mdLink[2]) });
      } else if (isSafeHttpUrl(href)) {
        tokens.push({ type: 'link', kind: 'http', href, label: linkLabelForUrl(href, mdLink[2]) });
      } else {
        tokens.push({ type: 'text', value: `[${mdLink[2]}](${mdLink[3]})` });
      }
      remaining = mdLink[4];
      continue;
    }

    const urlMatch = remaining.match(/^(.*?)((?:https?:\/\/|github\.com\/)[^\s<>\]\)]+)(.*)$/i);
    if (urlMatch) {
      if (urlMatch[1]) tokens.push(...parseInlineTokens(urlMatch[1]));
      const href = normalizeHttpUrl(urlMatch[2]);
      if (isSafeHttpUrl(href)) {
        tokens.push({ type: 'link', kind: 'http', href, label: linkLabelForUrl(href, urlMatch[2]) });
      } else {
        tokens.push({ type: 'text', value: urlMatch[2] });
      }
      remaining = urlMatch[3];
      continue;
    }

    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*(.*)$/);
    if (boldMatch) {
      if (boldMatch[1]) tokens.push({ type: 'text', value: boldMatch[1] });
      tokens.push({ type: 'bold', value: boldMatch[2] });
      remaining = boldMatch[3];
      continue;
    }

    tokens.push({ type: 'text', value: remaining });
    break;
  }

  return tokens;
}

/**
 * @param {string} text
 * @returns {Array<{ type: string, [key: string]: any }>}
 */
export function parseMarkdownBlocks(text) {
  if (!text) return [];

  const lines = String(text).split('\n');
  const blocks = [];
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeLines = [];

  const flushCode = () => {
    if (!inCode) return;
    blocks.push({ type: 'code', lang: codeLang, text: codeLines.join('\n') });
    inCode = false;
    codeLang = '';
    codeLines = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLang = line.trim().slice(3).trim();
      }
      i += 1;
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      i += 1;
      continue;
    }

    if (isTableSeparator(lines[i + 1] || '') && /\|/.test(line)) {
      const headers = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && !isTableSeparator(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (!line.trim()) {
      const prev = blocks[blocks.length - 1];
      const next = lines[i + 1] || '';
      if (prev && (prev.type === 'bullet' || prev.type === 'number' || prev.type === 'check') && isListLine(next)) {
        i += 1;
        continue;
      }
      blocks.push({ type: 'gap' });
      i += 1;
      continue;
    }

    if (line.startsWith('### ')) {
      blocks.push({ type: 'h4', text: line.slice(4) });
      i += 1;
      continue;
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h3', text: line.slice(3) });
      i += 1;
      continue;
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h2', text: line.slice(2) });
      i += 1;
      continue;
    }

    const checkMatch = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/);
    if (checkMatch) {
      blocks.push({
        type: 'check',
        indent: listIndentLevel(checkMatch[1]),
        checked: checkMatch[2] !== ' ',
        text: checkMatch[3],
      });
      i += 1;
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bulletMatch) {
      blocks.push({ type: 'bullet', indent: listIndentLevel(bulletMatch[1]), text: bulletMatch[2] });
      i += 1;
      continue;
    }

    const numMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numMatch) {
      blocks.push({
        type: 'number',
        indent: listIndentLevel(numMatch[1]),
        n: numMatch[2],
        text: numMatch[3],
      });
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      blocks.push({ type: 'hr' });
      i += 1;
      continue;
    }

    blocks.push({ type: 'p', text: line });
    i += 1;
  }

  flushCode();
  return blocks;
}
