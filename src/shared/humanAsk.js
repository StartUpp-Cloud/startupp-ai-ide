/**
 * Structured human asks (Claude AskUserQuestion / Cline-style follow-ups).
 * Shared by the gateway (parse + markdown fallback) and the chat UI (choice chips).
 */

function slugId(value, fallback) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return text.slice(0, 48) || fallback;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function looksRecommended(label, description, src = {}) {
  if (src.recommended === true || src.default === true || src.isRecommended === true) return true;
  return /\brecommended\b/i.test(`${label} ${description}`);
}

export function normalizeAskOption(raw, index = 0) {
  if (typeof raw === 'string') {
    const label = raw.trim();
    if (!label) return null;
    return {
      id: slugId(label, `opt-${index}`),
      label,
      description: '',
      recommended: looksRecommended(label, ''),
    };
  }
  const src = asObject(raw);
  if (!src) return null;
  const label = String(src.label || src.title || src.value || src.text || '').trim();
  const description = String(src.description || src.desc || src.detail || '').trim();
  if (!label && !description) return null;
  return {
    id: String(src.id || slugId(label || description, `opt-${index}`)),
    label: label || `Option ${index + 1}`,
    description,
    recommended: looksRecommended(label, description, src),
  };
}

export function pickRecommendedOption(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  return options.find((opt) => opt?.recommended) || options[0] || null;
}

export function normalizeAskQuestion(raw, index = 0) {
  if (typeof raw === 'string') {
    const question = raw.trim();
    if (!question) return null;
    return {
      id: slugId(question, `q-${index}`),
      header: '',
      question,
      options: [],
      multiSelect: false,
    };
  }
  const src = asObject(raw);
  if (!src) return null;
  const question = String(src.question || src.prompt || src.text || '').trim();
  if (!question) return null;
  const header = String(src.header || src.title || src.label || '').trim();
  const options = (Array.isArray(src.options) ? src.options : [])
    .map((opt, i) => normalizeAskOption(opt, i))
    .filter(Boolean);
  const recommended = pickRecommendedOption({ options });
  return {
    id: String(src.id || slugId(header || question, `q-${index}`)),
    header,
    question,
    options: options.map((opt) => (
      recommended && opt.id === recommended.id
        ? { ...opt, recommended: true }
        : { ...opt, recommended: false }
    )),
    multiSelect: !!(src.multiSelect || src.multiple || src.multiselect),
  };
}

export function normalizeAskQuestions(raw = []) {
  const unique = [];
  const seen = new Set();
  const list = Array.isArray(raw) ? raw : [];
  list.forEach((item, index) => {
    const question = normalizeAskQuestion(item, index);
    if (!question) return;
    const key = `${question.header}:${question.question}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(question);
  });
  return unique;
}

export function formatAskMarkdown(questions = []) {
  const unique = normalizeAskQuestions(questions);
  if (unique.length === 0) return '';

  const lines = [
    'The coding agent needs your input before it can safely continue.',
    '',
    'Please answer these questions:',
  ];
  unique.forEach((question, index) => {
    const header = question.header ? `${question.header}: ` : '';
    lines.push('', `${index + 1}. ${header}${question.question}`);
    if (question.multiSelect) lines.push('   Select one or more options.');
    for (const option of question.options) {
      const rec = option.recommended ? ' (recommended)' : '';
      const description = option.description ? `: ${option.description}` : '';
      lines.push(`   - ${option.label}${description}${rec}`);
    }
  });
  lines.push('', 'Reply with your choices or custom instructions, then ask me to continue.');
  return lines.join('\n');
}

export function formatAskReply({ questions = [], selections = {}, extra = '' } = {}) {
  const unique = normalizeAskQuestions(questions);
  const lines = ['Answers:'];
  for (const question of unique) {
    const selected = selections[question.id];
    const labels = Array.isArray(selected) ? selected : (selected ? [selected] : []);
    const text = labels.map((value) => String(value).trim()).filter(Boolean).join(', ');
    if (!text) continue;
    lines.push(`- ${question.header || question.question}: ${text}`);
  }
  const extraText = String(extra || '').trim();
  if (extraText) lines.push('', extraText);
  if (lines.length === 1) {
    return extraText ? `${extraText}\n\nPlease continue from these choices.` : '';
  }
  lines.push('', 'Please continue from these choices.');
  return lines.join('\n').trim();
}

export function recommendedSelections(questions = []) {
  const unique = normalizeAskQuestions(questions);
  const selections = {};
  for (const question of unique) {
    const rec = pickRecommendedOption(question);
    if (!rec) continue;
    selections[question.id] = question.multiSelect ? [rec.label] : rec.label;
  }
  return selections;
}

export function extractAskQuestionsFromAgentEvent(json) {
  const questions = [];
  const denials = json?.permission_denials;
  if (Array.isArray(denials)) {
    for (const denial of denials) {
      const toolName = String(denial?.tool_name || denial?.toolName || '').toLowerCase();
      if (toolName !== 'askuserquestion') continue;
      const inputQuestions = Array.isArray(denial?.tool_input?.questions)
        ? denial.tool_input.questions
        : Array.isArray(denial?.input?.questions)
          ? denial.input.questions
          : [];
      questions.push(...inputQuestions);
    }
  }

  const content = json?.message?.content || json?.content;
  if (Array.isArray(content)) {
    for (const part of content) {
      const name = String(part?.name || part?.tool_name || part?.toolName || '').toLowerCase();
      const isAsk = name === 'askuserquestion' || name === 'ask_followup_question';
      if (!isAsk) continue;
      const qs = part.input?.questions || part.tool_input?.questions;
      if (Array.isArray(qs)) questions.push(...qs);
      else if (part.input?.question || part.tool_input?.question) {
        questions.push(part.input || part.tool_input);
      }
    }
  }

  if (Array.isArray(json?.questions)) questions.push(...json.questions);
  return questions.filter((item) => item && (item.question || item.prompt || item.text));
}

export function collectAskQuestionsFromOutput(cleanOutput) {
  const questions = [];
  for (const line of String(cleanOutput || '').split('\n')) {
    const idx = line.indexOf('{');
    if (idx < 0) continue;
    try {
      questions.push(...extractAskQuestionsFromAgentEvent(JSON.parse(line.slice(idx))));
    } catch {
      // Ignore non-JSON stream noise.
    }
  }
  return normalizeAskQuestions(questions);
}

/**
 * Recover structured asks from the markdown we (or the agent) already wrote,
 * so older messages and orchestrator-wrapped failures still get chips.
 */
export function extractAsksFromContent(text) {
  const src = String(text || '');
  if (!src.trim()) return [];

  const looksLikeAskDoc = /needs your input|please answer these questions/i.test(src);
  const questions = [];
  let current = null;

  const flush = () => {
    if (current?.question) questions.push(current);
    current = null;
  };

  for (const raw of src.split('\n')) {
    const numbered = raw.match(/^\s*(\d+)\.\s+(?:([^:\n]{1,80}):\s+)?(.+)$/);
    if (numbered && !/^\s*[-*•]/.test(raw)) {
      flush();
      current = {
        header: (numbered[2] || '').trim(),
        question: numbered[3].trim(),
        options: [],
        multiSelect: false,
      };
      continue;
    }
    if (current && /^\s+Select one or more/i.test(raw)) {
      current.multiSelect = true;
      continue;
    }
    const option = raw.match(/^\s+[-*•]\s+(.+)$/);
    if (current && option) {
      const body = option[1].trim();
      if (/^select one or more/i.test(body)) {
        current.multiSelect = true;
        continue;
      }
      const recommended = /\(recommended\)\s*$/i.test(body);
      const cleaned = body.replace(/\s*\(recommended\)\s*$/i, '');
      const split = cleaned.match(/^([^:]+):\s*(.*)$/);
      current.options.push({
        label: (split ? split[1] : cleaned).trim(),
        description: split ? split[2].trim() : '',
        recommended,
      });
    }
  }
  flush();

  return normalizeAskQuestions(questions).filter((question) => (
    question.options.length > 0 || looksLikeAskDoc
  ));
}

export function resolveAsks(rawAsks, content = '') {
  const fromMeta = normalizeAskQuestions(rawAsks);
  if (fromMeta.length) return fromMeta;
  return extractAsksFromContent(content);
}
