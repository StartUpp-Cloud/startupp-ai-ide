export const INTERRUPTED_RUN_ERROR = 'Autonomous run was interrupted before it could send a final response. Review the persisted events or retry the request.';

export function shouldSuppressAgentProgress(content) {
  return /^Working: coding assistant is using a tool/i.test(String(content || ''));
}

export function shouldEmitLivenessHeartbeat({ now, lastActivityAt, staleMs }) {
  return now - (lastActivityAt || 0) >= staleMs;
}

export function shouldPersistProgressMessage(eventType) {
  return eventType !== 'run-heartbeat';
}

export function buildProgressMessageId({ eventType, runId, messageId }) {
  if (eventType === 'run-heartbeat') return `orchestrator-heartbeat-${runId}`;
  return messageId;
}

export function buildLivenessHeartbeatMessage({ taskTitle = null, phase = null, silenceMs = 0 }) {
  const seconds = Math.max(1, Math.round(silenceMs / 1000));
  if (taskTitle) return `Listening for the next signal from ${taskTitle}... ${seconds}s`;
  if (phase === 'planning') return `Charting the route through the fog... ${seconds}s`;
  if (phase === 'synthesizing') return `Gathering the final threads... ${seconds}s`;
  return `Keeping the lantern lit... ${seconds}s`;
}
