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

function oneLineSummary(value, maxLength = 180) {
  const text = sanitizeAgentFailureDetail(value, maxLength)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .find(Boolean) || '';
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}...` : text;
}

export function buildThinFinalResponse({ completed = [], profile = null } = {}) {
  const successful = completed.filter(item => item?.result?.success !== false);
  if (successful.length === 1) {
    const item = successful[0];
    const content = String(item.result?.content || item.task?.result || '').trim();
    if (content) return content;
  }

  if (successful.length === 0) {
    return withName(profile, 'the coding agent finished without returning a usable summary. Ask me to continue and I will inspect the current state.');
  }

  const lines = successful.map(({ task, result }) => {
    const summary = oneLineSummary(result?.content || task?.result || 'Completed.');
    return `- ${task?.title || 'Agent step'}: ${summary || 'Completed.'}`;
  });
  return [withName(profile, 'the coding agent completed the run.'), '', ...lines].join('\n');
}
