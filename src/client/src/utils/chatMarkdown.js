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
