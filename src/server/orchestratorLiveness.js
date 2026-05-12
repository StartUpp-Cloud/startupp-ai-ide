export const INTERRUPTED_RUN_ERROR = 'Autonomous run was interrupted before it could send a final response. Review the persisted events or retry the request.';

export function shouldSuppressAgentProgress(content) {
  return /^Working: coding assistant is using a tool/i.test(String(content || ''));
}

export function shouldEmitLivenessHeartbeat({ now, lastActivityAt, staleMs }) {
  return now - (lastActivityAt || 0) >= staleMs;
}

export function buildLivenessHeartbeatMessage({ taskTitle = null, phase = null, silenceMs = 0 }) {
  const seconds = Math.max(1, Math.round(silenceMs / 1000));
  const label = taskTitle
    ? `Task still running: ${taskTitle}`
    : phase === 'planning'
      ? 'Still planning agent tasks'
      : phase === 'synthesizing'
        ? 'Still synthesizing final response'
        : 'Autonomous run still active';
  return `${label}; no new agent output for ${seconds}s.`;
}
