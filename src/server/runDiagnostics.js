const ACTIVE_STATUSES = new Set(['running', 'waiting-approval', 'paused']);

function ageMs(value, now) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? Math.max(0, now - parsed) : null;
}

export function buildRunObservation(run, tasks = [], events = [], { maxEvents = 24 } = {}) {
  if (!run) return null;
  const safeTasks = tasks.slice(-40).map(task => ({
    id: task.id,
    title: task.title,
    status: task.status,
    attempt: task.attempt,
    maxAttempts: task.maxAttempts,
    result: String(task.result || '').slice(-600),
    error: String(task.error || '').slice(-400),
  }));
  const safeEvents = events.slice(-maxEvents).map(event => ({
    eventType: event.eventType,
    level: event.level,
    message: String(event.message || '').slice(0, 500),
    createdAt: event.createdAt,
  }));
  return {
    run: {
      id: run.id,
      status: run.status,
      phase: run.phase,
      goal: String(run.goal || '').slice(0, 1000),
      tool: run.tool,
      model: run.model,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      policy: run.policy || run.data?.policy || null,
      pendingApproval: run.data?.pendingApproval || null,
    },
    tasks: safeTasks,
    events: safeEvents,
  };
}

export function buildDiagnostics({ health = {}, docker = null, runs = [], sessions = [], activities = [], now = Date.now() } = {}) {
  const activeRuns = runs.filter(run => ACTIVE_STATUSES.has(run?.status));
  const staleRuns = activeRuns.filter(run => (ageMs(run.updatedAt, now) || 0) > 60_000);
  const retries = runs.reduce((total, run) => total + (run?.data?.recoveryAttempts || 0), 0);
  const recentRetries = activities
    .filter(entry => /retry|recover/i.test(`${entry?.type || ''} ${entry?.title || ''}`))
    .slice(0, 20)
    .map(entry => ({ id: entry.id, timestamp: entry.timestamp, type: entry.type, title: entry.title, detail: entry.detail }));
  const approvals = activities
    .filter(entry => /approval|policy/i.test(`${entry?.type || ''} ${entry?.title || ''}`))
    .slice(0, 20)
    .map(entry => ({ id: entry.id, timestamp: entry.timestamp, type: entry.type, title: entry.title, detail: entry.detail }));

  const checks = [
    { id: 'server', label: 'IDE server', status: 'ok', detail: 'Process is serving diagnostics.' },
    { id: 'runs', label: 'Active runs', status: staleRuns.length ? 'warning' : 'ok', detail: `${activeRuns.length} active, ${staleRuns.length} stale.` },
    { id: 'sessions', label: 'Chat sessions', status: sessions.some(session => session?.status === 'open') ? 'ok' : 'idle', detail: `${sessions.filter(session => session?.status === 'open').length} open.` },
    { id: 'docker', label: 'Docker runtime', status: docker?.dockerAvailable === false ? 'warning' : 'ok', detail: docker?.dockerAvailable === false ? 'Docker is unavailable.' : 'Runtime status is available.' },
  ];

  return {
    generatedAt: new Date(now).toISOString(),
    status: checks.some(check => check.status === 'warning') ? 'warning' : 'ok',
    summary: {
      activeRuns: activeRuns.length,
      staleRuns: staleRuns.length,
      recoveryAttempts: retries,
      recentRetries: recentRetries.length,
      openSessions: sessions.filter(session => session?.status === 'open').length,
    },
    checks,
    server: health,
    docker: docker || { dockerAvailable: null },
    activeRuns: activeRuns.map(run => ({ id: run.id, projectId: run.projectId, sessionId: run.sessionId, status: run.status, phase: run.phase, updatedAt: run.updatedAt })),
    recentRetries,
    approvals,
  };
}
