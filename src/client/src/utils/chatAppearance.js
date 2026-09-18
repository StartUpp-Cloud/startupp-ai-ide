/**
 * Chat bubble typography preferences. Stored in localStorage so the setting
 * is immediate and does not depend on the profile/LLM APIs.
 */

export const CHAT_APPEARANCE_STORAGE_KEY = 'ide-chat-appearance';
export const CHAT_FONT_SIZE_MIN = 13;
export const CHAT_FONT_SIZE_MAX = 18;

export const CHAT_HEADING_SCALES = [
  { id: 'normal', label: 'Normal', desc: 'Slightly larger than body text' },
  { id: 'large', label: 'Large', desc: 'Clear section titles' },
  { id: 'xlarge', label: 'Extra large', desc: 'Strong title contrast' },
];

export const CHAT_LINE_SPACINGS = [
  { id: 'compact', label: 'Compact', desc: 'Tighter paragraphs and lists' },
  { id: 'comfortable', label: 'Comfortable', desc: 'Default reading space' },
  { id: 'relaxed', label: 'Relaxed', desc: 'More air between lines' },
];

export const DEFAULT_CHAT_APPEARANCE = {
  fontSize: 15,
  headingScale: 'large',
  lineSpacing: 'comfortable',
  emphasizeHeadings: true,
};

const HEADING_SIZES = {
  normal: { h2: '1.2em', h3: '1.1em', h4: '1.04em' },
  large: { h2: '1.42em', h3: '1.24em', h4: '1.1em' },
  xlarge: { h2: '1.62em', h3: '1.34em', h4: '1.16em' },
};

const LINE_HEIGHTS = {
  compact: '1.45',
  comfortable: '1.7',
  relaxed: '1.9',
};

const LIST_GAPS = {
  compact: '0.2em',
  comfortable: '0.35em',
  relaxed: '0.5em',
};

function clampFontSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CHAT_APPEARANCE.fontSize;
  return Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, Math.round(n)));
}

function pickId(value, allowed, fallback) {
  const id = String(value || '').trim().toLowerCase();
  return allowed.includes(id) ? id : fallback;
}

export function normalizeChatAppearance(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    fontSize: clampFontSize(src.fontSize),
    headingScale: pickId(src.headingScale, CHAT_HEADING_SCALES.map((item) => item.id), DEFAULT_CHAT_APPEARANCE.headingScale),
    lineSpacing: pickId(src.lineSpacing, CHAT_LINE_SPACINGS.map((item) => item.id), DEFAULT_CHAT_APPEARANCE.lineSpacing),
    emphasizeHeadings: src.emphasizeHeadings !== false,
  };
}

export function chatAppearanceCssVars(appearance = DEFAULT_CHAT_APPEARANCE) {
  const a = normalizeChatAppearance(appearance);
  const heading = HEADING_SIZES[a.headingScale];
  return {
    '--chat-md-size': `${a.fontSize}px`,
    '--chat-md-leading': LINE_HEIGHTS[a.lineSpacing],
    '--chat-md-h2': heading.h2,
    '--chat-md-h3': heading.h3,
    '--chat-md-h4': heading.h4,
    '--chat-md-list-gap': LIST_GAPS[a.lineSpacing],
    '--chat-md-heading-color': a.emphasizeHeadings ? '#f4f6fb' : '#dfe2ee',
    '--chat-md-heading-weight': a.emphasizeHeadings ? '750' : '650',
    '--chat-md-heading-accent': a.emphasizeHeadings ? '3px solid rgba(245, 158, 11, 0.75)' : '0',
    '--chat-md-heading-pad': a.emphasizeHeadings ? '0.15em 0 0.2em 0.65em' : '0',
  };
}

export function loadChatAppearance() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_CHAT_APPEARANCE };
  try {
    const raw = localStorage.getItem(CHAT_APPEARANCE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CHAT_APPEARANCE };
    return normalizeChatAppearance(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CHAT_APPEARANCE };
  }
}

export function saveChatAppearance(appearance) {
  const next = normalizeChatAppearance(appearance);
  if (typeof localStorage === 'undefined') return next;
  try {
    localStorage.setItem(CHAT_APPEARANCE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota / private-mode failures; in-memory state still updates.
  }
  return next;
}
