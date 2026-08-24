import { parseAgentReport } from './diligence.js';

const RAW_TELEMETRY_PATTERNS = [
  /^\{.*"(?:type|sessionID|session_id|part|tokens)".*\}?$/i,
  /^"?sessionID"?\s*:\s*"[^"\n]+".*"?type"?\s*:/i,
  /^"?type"?\s*:\s*"(?:step|text|tool|result|error)/i,
  /^"?tokens"?\s*:/i,
  /^"?cost"?\s*:/i,
];

function stripAnsi(value) {
  return String(value || '')
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B[P^_][\s\S]*?\x1B\\/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[()][A-Za-z0-9]/g, '')
    .replace(/\x1B[78=><]/g, '')
    .replace(/\x1B./g, '')
    .replace(/\r/g, '');
}

function isRawTelemetryLine(line) {
  const text = String(line || '').trim().replace(/^Error:\s*/i, '');
  if (!text) return false;
  return RAW_TELEMETRY_PATTERNS.some(pattern => pattern.test(text));
}

export function sanitizeAgentFailureDetail(value, maxLength = 700) {
  const withoutTelemetry = stripAnsi(value)
    .split('\n')
    .map(line => line.trim().replace(/\bAutonomous run (?:failed|blocked):\s*/gi, ''))
    .filter(line => line && !isRawTelemetryLine(line))
    .join('\n')
    .replace(/\bAutonomous run (?:failed|blocked):\s*/gi, '')
    .replace(/^Error:\s*/i, '')
    .trim();

  const collapsed = withoutTelemetry.replace(/\n{3,}/g, '\n\n').trim();
  if (!collapsed) return '';
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength).trim()}...` : collapsed;
}

function safeModelName(value) {
  const text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!text) return null;
  if (/[\\[\]{}()*+?^$|\s]/.test(text)) return null;
  if (!/^[A-Za-z0-9._:/-]+$/.test(text)) return null;
  return text;
}

function extractSafeModelName(error, explicitModel) {
  const explicit = safeModelName(explicitModel);
  if (explicit) return explicit;
  const raw = String(error || '');
  const matches = [
    raw.match(/modelID:\s*["']([^"'\n]+)["']/i),
    raw.match(/Model\s+["']([^"'\n]+)["']\s+is not registered/i),
    raw.match(/model\s+["']([^"'\n]+)["']\s+(?:not found|not registered)/i),
  ].filter(Boolean);
  for (const match of matches) {
    const model = safeModelName(match[1]);
    if (model) return model;
  }
  return null;
}

function toolName(tool) {
  const text = String(tool || 'coding agent').trim();
  if (!text) return 'coding agent';
  if (text.toLowerCase() === 'opencode') return 'OpenCode';
  if (text.toLowerCase() === 'claude') return 'Claude';
  if (text.toLowerCase() === 'codex') return 'Codex';
  return text;
}

function firstName(profile = null) {
  const name = String(profile?.name || '').trim();
  if (!name) return '';
  return name.split(/\s+/)[0].replace(/[^a-zA-Z0-9._-]/g, '');
}

function withName(profile, message) {
  const name = firstName(profile);
  return name ? `${name}, ${message}` : message;
}

export function describeAgentFailure({ error = '', tool = null, model = null, retryable = null, errorType = null } = {}) {
  const raw = String(error || '');
  const detail = sanitizeAgentFailureDetail(raw, errorType === 'needs-user' ? 4000 : 700);
  const agent = toolName(tool);
  const selectedModel = extractSafeModelName(raw, model);

  if (errorType === 'needs-user' || /coding agent needs your input|please answer these questions/i.test(raw)) {
    return {
      title: 'The coding agent needs your input.',
      reason: detail || `${agent} needs a decision before it can safely continue.`,
      nextSteps: [
        'Reply with your choices or instructions for the questions above.',
        'Then ask me to continue and I will push the coding agent from that decision.',
      ],
      shortReason: `${agent} needs your input before continuing.`,
    };
  }

  if (/ProviderModelNotFound|could not find this Ollama model|model .*not (?:found|registered)|not registered/i.test(raw)) {
    return {
      title: 'The selected coding model is not available.',
      reason: `${agent} could not start because the selected model${selectedModel ? ` (${selectedModel})` : ''} is not registered in the project container.`,
      nextSteps: [
        `Choose a registered ${agent} model, or restart the project container to refresh its provider config.`,
        'Then ask me to continue and I will retry from the same request.',
      ],
      shortReason: `${agent} model is not registered in the project container.`,
    };
  }

  if (errorType === 'context-limit' || /context.*(limit|length|overflow)|token.*(limit|length)|too many tokens|max_tokens/i.test(raw)) {
    return {
      title: 'The coding agent hit its context limit.',
      reason: `${agent} ran out of usable context before it could finish cleanly.`,
      nextSteps: [
        'I kept the session recoverable and preserved any progress that was reported.',
        'Ask me to continue and I will push the agent forward with a shorter handoff.',
      ],
      shortReason: `${agent} hit a context limit.`,
    };
  }

  if (/authentication failed|unauthorized|forbidden|login required|not logged in|api key|token/i.test(raw)) {
    return {
      title: 'The coding agent needs authentication.',
      reason: `${agent} could not continue because its authentication or provider credentials are not ready.`,
      nextSteps: [
        `Reconnect or refresh the ${agent} credentials in the project container.`,
        'Then ask me to continue and I will resume from the current state.',
      ],
      shortReason: `${agent} needs authentication.`,
    };
  }

  if (/timeout|timed out|No .* output|stalled|stream.*interrupted|connection.*interrupted/i.test(raw)) {
    return {
      title: 'The coding agent stopped responding.',
      reason: `${agent} stopped sending useful progress before it returned a final answer.`,
      nextSteps: [
        'I kept the run state available so it can be retried safely.',
        'Ask me to continue and I will nudge the coding agent from the latest state.',
      ],
      shortReason: `${agent} stopped responding.`,
    };
  }

  const cleanDetail = detail && !/[{}]"?type"?:|"sessionID"/i.test(detail)
    ? detail
    : '';
  return {
    title: retryable === false ? 'The coding agent is blocked.' : 'The coding agent did not finish cleanly.',
    reason: cleanDetail || `${agent} stopped before it returned a usable final answer.`,
    nextSteps: [
      'I kept the session recoverable and avoided exposing raw tool output here.',
      retryable === false
        ? 'Fix the tool or environment issue, then ask me to continue.'
        : 'Ask me to continue and I will push the coding agent from the latest state.',
    ],
    shortReason: cleanDetail || `${agent} did not finish cleanly.`,
  };
}

export function buildRunFailureEventMessage({ status = 'failed', taskTitle = null, error = '', tool = null, model = null, retryable = null, errorType = null } = {}) {
  const description = describeAgentFailure({ error, tool, model, retryable, errorType });
  const prefix = status === 'blocked' ? 'Paused' : 'Needs attention';
  return `${prefix}${taskTitle ? ` at ${taskTitle}` : ''}: ${description.shortReason}`;
}

export function buildRunFailureResponse({ status = 'failed', taskTitle = null, error = '', tool = null, model = null, retryable = null, errorType = null, profile = null } = {}) {
  const description = describeAgentFailure({ error, tool, model, retryable, errorType });
  const baseHeading = status === 'blocked'
    ? 'I paused this run before making more changes.'
    : 'I could not complete this run yet.';
  const heading = withName(profile, baseHeading);
  const taskLine = taskTitle ? [`Current step: ${taskTitle}`, ''] : [];
  const reasonLines = description.reason.includes('\n')
    ? [description.reason]
    : [`- ${description.reason}`];
  return [
    heading,
    '',
    ...taskLine,
    'What happened:',
    ...reasonLines,
    '',
    'Next steps:',
    ...description.nextSteps.map(step => `- ${step}`),
  ].join('\n');
}

const PROGRESS_VERB_RE = /(?:checking|starting|deploying|running|doing|looking|rerunning|confirming|keeping|trying|rechecking|inspecting|reviewing|making)\b/i;
const PROGRESS_LEAD_RE = /^(?:[-*•]\s*)?(?:I(?:'ll| will)|Let me)\b/i;
const PROGRESS_GERUND_RE = /^(?:[-*•]\s*)?I(?:'m| am)(?:\s+\w+){0,4}\s+/i;
const PROGRESS_CLAUSE_RE = /\b(?:then |and )I(?:'ll| will)\b|\bonce (?:it|that|the)\s+\w+\s+(?:finishes|completes|succeeds)\b|\b(?:build|deploy(?:ment)?|release|script) is (?:now )?running\b|\bwill (?:publish|deploy|rerun|report|confirm|hand off)\b/i;

function normalizeNarrativeApostrophes(value) {
  return String(value || '').replace(/[\u2018\u2019]/g, "'");
}

function splitSentences(paragraph) {
  const text = String(paragraph || '').trim();
  if (!text) return [];
  return text.split(/(?<=[.!?])\s+(?=[A-Z"'I])/).map((part) => part.trim()).filter(Boolean);
}

function isProgressSentence(sentence) {
  const text = normalizeNarrativeApostrophes(sentence).trim();
  if (!text) return false;
  if (PROGRESS_LEAD_RE.test(text)) return true;
  if (PROGRESS_GERUND_RE.test(text) && PROGRESS_VERB_RE.test(text)) return true;
  return PROGRESS_CLAUSE_RE.test(text);
}

/**
 * Drop "I'll check / I'm deploying" play-by-play from a finished report.
 * Keeps completed facts, commands, versions, and decisions.
 */
export function stripInProgressNarration(content) {
  const paragraphs = String(content || '')
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const kept = splitSentences(paragraph).filter((sentence) => !isProgressSentence(sentence));
      if (kept.length) return kept.join(' ');
      const leftover = String(paragraph || '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !isProgressSentence(line));
      return leftover.join('\n').trim();
    })
    .filter(Boolean);
  return paragraphs.join('\n\n').trim();
}

function countReportBullets(text) {
  return (String(text || '').match(/^\s*[-*•]/gm) || []).length;
}

function extractDetailsBlock(text) {
  const match = String(text || '').match(/(?:^|\n)#{1,3}\s*Details\s*\n+([\s\S]*?)(?=\n#{1,3}\s|\s*$)/i);
  return match?.[1]?.trim() || '';
}

function isThinReport(text) {
  const src = String(text || '').trim();
  if (!src) return true;
  const details = extractDetailsBlock(src);
  if (details.length >= 180 || countReportBullets(details) >= 3) return false;
  if (countReportBullets(src) >= 3 && src.length >= 280) return false;
  return src.length < 700 && countReportBullets(src) < 3;
}

function substanceScore(text) {
  const src = String(text || '').trim();
  if (!src) return 0;
  let score = Math.min(src.length, 6000);
  if (extractDetailsBlock(src)) score += 2000;
  if (/(?:^|\n)#{1,3}\s*(?:Outcome|Summary)\b/i.test(src)) score += 300;
  score += countReportBullets(src) * 90;
  score += Math.min(src.split('\n').filter((line) => line.trim()).length, 50) * 15;
  return score;
}

/**
 * Prefer the last completed handoff over earlier "I'm about to…" updates.
 * If Codex then emits a two-sentence closer, keep the richer report instead.
 */
export function selectFinalAgentMessage(parts = []) {
  const cleaned = parts.map((part) => String(part || '').trim()).filter(Boolean);
  if (cleaned.length === 0) return '';

  const usable = cleaned
    .map((part) => stripInProgressNarration(part))
    .filter(Boolean);
  if (usable.length === 0) return cleaned[cleaned.length - 1];
  if (usable.length === 1) return usable[0];

  const last = usable[usable.length - 1];
  if (!isThinReport(last)) return last;

  let richest = last;
  let richestScore = substanceScore(last);
  for (const candidate of usable.slice(0, -1)) {
    const score = substanceScore(candidate);
    if (score > richestScore + 250) {
      richest = candidate;
      richestScore = score;
    }
  }
  if (richest === last) return last;
  if (/(?:^|\n)#{1,3}\s*(?:Outcome|Summary|Details)\b/i.test(richest)) return richest;
  return `## Outcome\n\n${last}\n\n## Details\n\n${richest}`.trim();
}

function extractAgentSummary(content) {
  const text = String(content || '').trim();
  if (!text) return '';

  const summaryMatch = text.match(/(?:^|\n)#{1,3}\s*(?:Outcome|Summary)\s*\n+([\s\S]*?)(?=\n#{1,3}\s|\s*$)/i);
  const extracted = summaryMatch?.[1]?.trim()
    ? summaryMatch[1].trim()
    : text
      .split('\n')
      .filter((line) => !/^\s*#{1,6}\s/.test(line))
      .join('\n')
      .trim() || text;
  return stripInProgressNarration(extracted) || extracted;
}

export function formatStoppedPartial(content) {
  return extractAgentSummary(content).trim();
}

export function buildStoppedRunResponse({
  profile = null,
  partialContent = '',
  completed = [],
  changedFiles = [],
  tool = null,
} = {}) {
  const body = formatStoppedPartial(partialContent);
  const completedLines = (completed || [])
    .map((item) => {
      const title = String(item?.title || item?.task?.title || 'Task').trim() || 'Task';
      const summary = oneLineSummary(item?.content || item?.result?.content || item?.result || '', 220);
      return summary ? `- ${title}: ${summary}` : `- ${title}`;
    })
    .filter((line, index, all) => all.indexOf(line) === index);
  const fileLines = (changedFiles || [])
    .map((file) => {
      const filePath = typeof file === 'string' ? file : file?.path;
      if (!filePath) return '';
      const status = typeof file === 'object' && file.status ? ` (${file.status})` : '';
      return `- \`${filePath}\`${status}`;
    })
    .filter(Boolean)
    .slice(0, 30);

  const heading = withName(profile, 'I stopped this run. Here is what had already happened.');
  const parts = ['## Outcome', '', heading, ''];
  const detailBits = [];
  if (body) detailBits.push(body);
  if (completedLines.length) {
    detailBits.push(['Already completed:', ...completedLines].join('\n'));
  }
  if (fileLines.length) {
    detailBits.push(['Files already touched:', ...fileLines].join('\n'));
  }
  if (!body && completedLines.length === 0 && fileLines.length === 0) {
    const agent = toolName(tool);
    detailBits.push(`${agent} had not produced a usable report yet. The workspace may still have in-progress edits.`);
  }
  if (detailBits.length) {
    parts.push('## Details', '', detailBits.join('\n\n'), '');
  }
  parts.push('You can keep going from this state — tell me what to do next.');
  return parts.join('\n').trim();
}

const COMPACT_REPORT_MAX = 1800;

function heuristicCompact(text, maxLength = COMPACT_REPORT_MAX) {
  const lines = String(text || '').split('\n');
  const kept = [];
  let size = 0;
  for (const line of lines) {
    if (!kept.length && !line.trim()) continue;
    const nextSize = size + line.length + 1;
    if (kept.length >= 4 && nextSize > maxLength && !/^\s*(?:#{1,3}\s+|[-*•]|\d+[.)])/.test(line)) break;
    kept.push(line);
    size = nextSize;
    if (size >= maxLength) break;
  }
  return kept.join('\n').trim();
}

function promoteFindingsIntoDetails(body, activity) {
  const strippedActivity = stripInProgressNarration(activity);
  if (!strippedActivity || strippedActivity.length < 120) {
    return { body, promoted: false };
  }
  if (!isThinReport(body)) return { body, promoted: false };
  if (countReportBullets(strippedActivity) < 2 && strippedActivity.length < 180) {
    return { body, promoted: false };
  }
  const next = /#{1,3}\s*Details\b/i.test(body)
    ? `${body.trim()}\n\n${strippedActivity}`
    : `${body.trim()}\n\n## Details\n\n${strippedActivity}`;
  return { body: next, promoted: true };
}

/**
 * Prefer a titled Outcome/Details report for the chat bubble. Stash leftover
 * play-by-play as `detail` (Working notes). Findings that landed before
 * ## Outcome are promoted into Details so they stay visible.
 */
export function compactChatReport(content) {
  const raw = String(content || '').trim();
  if (!raw) return { body: '', detail: '', compact: false };

  const parsed = parseAgentReport(raw);
  if (parsed.hasReport && parsed.body.trim()) {
    const body = stripInProgressNarration(parsed.body) || parsed.body.trim();
    const promoted = promoteFindingsIntoDetails(body, parsed.activity);
    const detail = !promoted.promoted && parsed.activity && parsed.activity !== promoted.body
      ? parsed.activity
      : '';
    return { body: promoted.body, detail, compact: true };
  }

  const stripped = stripInProgressNarration(raw) || raw;

  if (countReportBullets(stripped) >= 3 || stripped.length <= COMPACT_REPORT_MAX) {
    return { body: stripped, detail: '', compact: false };
  }

  const body = heuristicCompact(stripped);
  return {
    body: body || stripped.slice(0, COMPACT_REPORT_MAX).trim(),
    detail: stripped,
    compact: true,
  };
}

function oneLineSummary(value, maxLength = 280) {
  const text = extractAgentSummary(sanitizeAgentFailureDetail(value, maxLength * 2))
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^#{1,6}\s/.test(line))
    .join(' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

function pickPriorityCompletedTask(completed = []) {
  for (const phase of ['validate', 'consolidate']) {
    const item = [...completed].reverse().find(
      (entry) => entry?.task?.data?.phase === phase && extractAgentSummary(entry?.result?.content),
    );
    if (item) return item;
  }
  return null;
}

export function buildThinFinalResponse({ completed = [], profile = null } = {}) {
  const successful = completed.filter(item => item?.result?.success !== false);
  const priority = pickPriorityCompletedTask(successful);
  if (priority) {
    const content = extractAgentSummary(priority.result?.content);
    if (content) return compactChatReport(content).body || content;
  }

  if (successful.length === 1) {
    const item = successful[0];
    const content = extractAgentSummary(item.result?.content || item.task?.result || '');
    if (content) return compactChatReport(content).body || content;
  }

  if (successful.length === 0) {
    return withName(profile, 'the coding agent finished without returning a usable summary. Ask me to continue and I will inspect the current state.');
  }

  const lines = successful.map(({ task, result }) => {
    const summary = oneLineSummary(result?.content || task?.result || 'Completed.');
    const title = task?.title || 'Agent step';
    return `- ${title}: ${summary || 'Completed.'}`;
  });
  return [withName(profile, 'the coding agent completed the run.'), '', ...lines].join('\n');
}
