export function normalizeAgentEventType(type) {
  return String(type || '').replace(/-/g, '_').toLowerCase();
}

function parseOpencodeJsonLine(line) {
  const idx = line.indexOf('{');
  if (idx < 0) return null;
  try {
    return JSON.parse(line.slice(idx));
  } catch {
    return null;
  }
}

function safeModelName(value) {
  const text = String(value || '').trim().replace(/^['"]|['"]$/g, '');
  if (!text) return null;
  if (/[\\[\]{}()*+?^$|\s]/.test(text)) return null;
  if (!/^[A-Za-z0-9._:/-]+$/.test(text)) return null;
  return text;
}

function extractProviderModel(cleanOutput) {
  const raw = String(cleanOutput || '');
  const matches = [
    raw.match(/modelID:\s*["']([^"'\n]+)["']/i),
    raw.match(/Model\s+["']([^"'\n]+)["']\s+(?:is\s+)?(?:not found|not registered)/i),
  ].filter(Boolean);
  for (const match of matches) {
    const model = safeModelName(match[1]);
    if (model) return model;
  }
  return null;
}

function opencodeFinishReason(event) {
  return normalizeAgentEventType(
    event?.finishReason || event?.part?.finishReason || event?.reason || event?.part?.reason,
  );
}

function isTerminalFinishReason(reason) {
  return !reason || reason === 'stop' || reason === 'end_turn';
}

function opencodeTextPhase(event) {
  return normalizeAgentEventType(
    event?.part?.metadata?.openai?.phase
      || event?.metadata?.openai?.phase
      || event?.part?.metadata?.phase
      || event?.metadata?.phase,
  );
}

function isCommentaryTextEvent(event) {
  return normalizeAgentEventType(event?.type) === 'text' && opencodeTextPhase(event) === 'commentary';
}

export function isOpencodeQuietCompletion(cleanOutput) {
  let lastEvent = null;
  let seenTerminalStepFinish = false;

  for (const line of String(cleanOutput || '').split('\n')) {
    const event = parseOpencodeJsonLine(line);
    if (event?.type || event?.part?.type) {
      const type = normalizeAgentEventType(event.type);
      const partType = normalizeAgentEventType(event.part?.type);
      if ((type === 'step_finish' || partType === 'step_finish') && isTerminalFinishReason(opencodeFinishReason(event))) {
        seenTerminalStepFinish = true;
      }
      lastEvent = event;
    }
  }

  if (!lastEvent) return false;
  const type = normalizeAgentEventType(lastEvent.type);
  const partType = normalizeAgentEventType(lastEvent.part?.type);
  const reason = opencodeFinishReason(lastEvent);

  return ((type === 'step_finish' || partType === 'step_finish') && isTerminalFinishReason(reason))
    || (
      seenTerminalStepFinish
      && type === 'text'
      && !isCommentaryTextEvent(lastEvent)
      && typeof lastEvent.part?.text === 'string'
      && lastEvent.part.text.length > 0
    );
}

export function parseOpencodeJsonOutput(cleanOutput, cmd, extractToolResponse = () => '') {
  let text = '';
  let sessionId = null;
  let isError = false;
  let isPermanentError = false;
  let isIncomplete = false;
  let lastFinishReason = null;
  let seenToolUse = false;
  let hasPostToolText = false;
  const textParts = [];
  const commentaryParts = [];

  for (const line of cleanOutput.split('\n')) {
    const json = parseOpencodeJsonLine(line);
    if (!json) continue;
    try {
      const type = normalizeAgentEventType(json.type);
      const partType = normalizeAgentEventType(json.part?.type);
      if (json.sessionID && !sessionId) sessionId = json.sessionID;

      if (type === 'tool_call' || type === 'tool_use' || partType === 'tool_call' || partType === 'tool_result') {
        seenToolUse = true;
      }

      if (type === 'text' && json.part?.text) {
        const phase = opencodeTextPhase(json);
        if (phase === 'commentary') {
          commentaryParts.push(json.part.text);
        } else {
          textParts.push(json.part.text);
          if (seenToolUse) hasPostToolText = true;
        }
      }

      if (type === 'result' && typeof json.result === 'string' && json.result.trim()) {
        textParts.push(json.result);
        if (seenToolUse) hasPostToolText = true;
      }

      if (type === 'item_completed' && json.item?.type === 'agent_message' && typeof json.item?.text === 'string' && json.item.text.trim()) {
        textParts.push(json.item.text);
        if (seenToolUse) hasPostToolText = true;
      }

      if (type === 'step_finish' || partType === 'step_finish') {
        const reason = opencodeFinishReason(json);
        if (reason) lastFinishReason = reason;
      }

      if (type === 'error' || partType === 'error') {
        isError = true;
        const errMsg = json.error?.data?.message
          || json.error?.message
          || (typeof json.error === 'string' ? json.error : '')
          || json.part?.message
          || json.message
          || '';
        if (errMsg) textParts.push(`\n\n**Error:** ${errMsg}`);
        if (/model.*not found|provider.*not found|ProviderModelNotFound/i.test(errMsg)) {
          isPermanentError = true;
        }
      }

      if (Number.isInteger(json.exitCode) && json.exitCode !== 0) {
        isError = true;
        textParts.push(`\n\n**Error:** OpenCode exited with code ${json.exitCode}`);
      }
    } catch {}
  }

  if (/ProviderModelNotFoundError|Model not found:/i.test(cleanOutput) && !textParts.some(p => p.includes('Error:'))) {
    isError = true;
    isPermanentError = true;
    const model = extractProviderModel(cleanOutput);
    const hint = model ? ` Model "${model}" is not registered.` : '';
    textParts.push(`\n\n**Error:** OpenCode could not find this Ollama model in its provider config.${hint} Restart the project container to refresh the model list, then try again.`);
  }

  text = textParts.join('').trim();
  const commentaryOnly = !text && commentaryParts.length > 0;
  if (commentaryOnly) text = commentaryParts.join('').trim();

  if (!text) {
    text = extractToolResponse(cleanOutput, cmd);
  }

  const isCleanStop = lastFinishReason === 'stop' || lastFinishReason === 'end_turn';
  const isContextLimit = lastFinishReason === 'length' || lastFinishReason === 'max_tokens';

  if (isContextLimit) {
    const warning = '⚠️ Context limit reached — implementation may be incomplete. Send a follow-up to continue.';
    text = text.trim() ? `${text}\n\n${warning}` : warning;
    isError = true;
    isPermanentError = true;
  } else if (!text.trim()) {
    if (isCleanStop && sessionId && !isError) {
      text = '✓ Done.';
    } else {
      text = sessionId
        ? '⚠️ Response received but could not be parsed. OpenCode may still be processing.'
        : '⚠️ No response received from OpenCode. Please try again.';
    }
  } else if (commentaryOnly && !isError) {
    isIncomplete = true;
    text += '\n\nOpenCode returned only progress updates and did not provide a final answer.';
  } else if (!isError && seenToolUse && !hasPostToolText && isCleanStop) {
    text += '\n\n✓ Task completed.';
  }

  return { text, sessionId, isError, isPermanentError, isIncomplete, finishReason: lastFinishReason };
}
