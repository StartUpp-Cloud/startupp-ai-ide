export const STREAM_RECOVERY_STALE_MS = 5 * 60 * 1000;
export const VISIBLE_STREAM_RECOVERY_STALE_MS = 45 * 1000;
export const STREAM_AUTO_RETRY_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const RELIABILITY_SWEEP_INTERVAL_MS = 5000;
export const ACTIVE_RUN_STALE_MS = 90 * 1000;
export const LLM_STEP_TIMEOUT_MS = 30 * 1000;

export function streamingSilenceMs({ now = Date.now(), streamStartedAt = null, lastChunkAt = null }) {
  const started = streamStartedAt ? new Date(streamStartedAt).getTime() : 0;
  const chunk = lastChunkAt ? new Date(lastChunkAt).getTime() : 0;
  const lastActivity = chunk || started || now;
  return Math.max(0, now - lastActivity);
}

export function shouldRecoverStreamingMessage({ now = Date.now(), streamStartedAt = null, lastChunkAt = null, staleMs = STREAM_RECOVERY_STALE_MS }) {
  return streamingSilenceMs({ now, streamStartedAt, lastChunkAt }) > staleMs;
}

export function buildStreamingRecoveryContent({ tool = 'coding agent', retrying = false } = {}) {
  const agent = tool && tool !== 'agent' ? tool : 'coding agent';
  const suffix = retrying
    ? ' I am retrying the request automatically.'
    : ' A visible response is being recorded so this session is not left stuck.';
  return `The previous ${agent} attempt stopped before it produced a final response.${suffix}`;
}
