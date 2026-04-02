import { useState, useMemo, useCallback } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  Monitor,
  Bot,
  Terminal as TerminalIcon,
} from 'lucide-react';

/**
 * SessionManager — tree-view panel showing sessions grouped by project.
 *
 * Designed to replace the flat session tabs in the Terminal toolbar.
 * Receives all data via props; the parent (IDE.jsx) owns the state.
 *
 * Integration TODO (IDE.jsx):
 *  1. Lift `sessions` state out of Terminal.jsx — Terminal should report
 *     sessions via an `onSessionsChange` callback (or via a global event bus).
 *  2. Merge Terminal-internal `promptSuggestion` / `capturedError` into each
 *     session object so `needsInput` and `hasError` fields are populated.
 *  3. Render <SessionManager /> in the left panel (below or replacing the
 *     ProjectManagerPanel), passing projects, sessions, and the callbacks.
 *  4. Wire onSwitchSession / onCreateSession / onKillSession to the
 *     WebSocket layer that Terminal currently owns.
 */

// ── CLI tool badge labels ──────────────────────────────────────────────────────
const CLI_LABELS = {
  claude: 'Claude',
  copilot: 'Copilot',
  aider: 'Aider',
};

// ── Status dot component ───────────────────────────────────────────────────────
function StatusDot({ status, needsInput, hasError }) {
  if (hasError) {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-danger-400 flex-shrink-0"
        title="Error detected"
      />
    );
  }
  if (needsInput) {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0 animate-pulse"
        title="Needs input"
      />
    );
  }
  if (status === 'running') {
    return (
      <span
        className="inline-block w-2 h-2 rounded-full bg-green-400 flex-shrink-0"
        title="Running"
      />
    );
  }
  // idle / terminated / unknown
  return (
    <span
      className="inline-block w-2 h-2 rounded-full bg-surface-500 flex-shrink-0"
      title={status || 'Idle'}
    />
  );
}

// ── Single session row ─────────────────────────────────────────────────────────
function SessionRow({ session, isActive, onSwitch, onKill }) {
  const [hovered, setHovered] = useState(false);

  const displayName = session.name || `Session ${(session.id || '').slice(0, 6)}`;
  const cliBadge = CLI_LABELS[session.cliTool];

  return (
    <button
      type="button"
      onClick={() => onSwitch(session.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`
        group w-full flex items-center gap-1.5 px-3 py-1 text-left text-[11px] rounded
        transition-colors cursor-pointer select-none
        ${isActive
          ? 'bg-primary-500/15 text-primary-300'
          : 'text-surface-300 hover:bg-surface-700/60 hover:text-surface-100'
        }
      `}
    >
      <StatusDot
        status={session.status}
        needsInput={session.needsInput}
        hasError={session.hasError}
      />

      <span className="flex-1 truncate" title={displayName}>
        {displayName}
      </span>

      {cliBadge && (
        <span className="flex-shrink-0 px-1 py-px rounded bg-surface-700 text-[9px] text-surface-400 font-medium uppercase tracking-wider">
          {cliBadge}
        </span>
      )}

      {/* Kill button — appears on hover */}
      {hovered && (
        <span
          role="button"
          tabIndex={-1}
          title="Kill session"
          onClick={(e) => {
            e.stopPropagation();
            onKill(session.id);
          }}
          className="flex-shrink-0 p-0.5 rounded hover:bg-danger-500/20 text-surface-500 hover:text-danger-400 transition-colors"
        >
          <X className="w-3 h-3" />
        </span>
      )}
    </button>
  );
}

// ── Project group ──────────────────────────────────────────────────────────────
function ProjectGroup({
  project,
  sessions,
  activeSessionId,
  defaultExpanded,
  onSwitchSession,
  onCreateSession,
  onKillSession,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const sessionCount = sessions.length;

  return (
    <div className="mb-0.5">
      {/* Project header */}
      <div className="flex items-center group">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex-1 flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-surface-300 hover:text-surface-100 hover:bg-surface-700/40 rounded transition-colors select-none"
        >
          {expanded ? (
            <ChevronDown className="w-3 h-3 flex-shrink-0 text-surface-500" />
          ) : (
            <ChevronRight className="w-3 h-3 flex-shrink-0 text-surface-500" />
          )}
          <span className="truncate">{project.name}</span>
          {sessionCount > 0 && (
            <span className="ml-auto flex-shrink-0 px-1.5 py-px rounded-full bg-surface-700 text-[9px] text-surface-400 font-medium tabular-nums">
              {sessionCount}
            </span>
          )}
        </button>

        {/* Add session for this project */}
        <button
          type="button"
          title={`New session for ${project.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onCreateSession(project.id);
            if (!expanded) setExpanded(true);
          }}
          className="flex-shrink-0 p-1 mr-1 rounded text-surface-500 hover:text-surface-200 hover:bg-surface-700 opacity-0 group-hover:opacity-100 transition-all"
        >
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {/* Session list */}
      {expanded && (
        <div className="ml-2 border-l border-surface-700/50 pl-0.5">
          {sessions.length === 0 ? (
            <div className="px-3 py-1.5 text-[10px] text-surface-500 italic">
              No active sessions
            </div>
          ) : (
            sessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                onSwitch={onSwitchSession}
                onKill={onKillSession}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SessionManager({
  projects = [],
  sessions = [],
  activeSessionId,
  onSwitchSession,
  onCreateSession,
  onKillSession,
}) {
  // Group sessions by project
  const sessionsByProject = useMemo(() => {
    const map = new Map();
    for (const session of sessions) {
      const pid = session.projectId || '__unassigned__';
      if (!map.has(pid)) map.set(pid, []);
      map.get(pid).push(session);
    }
    return map;
  }, [sessions]);

  // Sort projects: those with sessions first, then alphabetically
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aHas = sessionsByProject.has(a.id) ? 1 : 0;
      const bHas = sessionsByProject.has(b.id) ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [projects, sessionsByProject]);

  // Collect sessions that don't belong to any known project
  const orphanSessions = useMemo(() => {
    const projectIds = new Set(projects.map((p) => p.id));
    return sessions.filter((s) => !s.projectId || !projectIds.has(s.projectId));
  }, [projects, sessions]);

  // Totals for the header
  const totalActive = sessions.filter(
    (s) => s.status === 'running' || s.needsInput
  ).length;

  return (
    <div className="flex flex-col h-full select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-surface-700 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <TerminalIcon className="w-3.5 h-3.5 text-surface-400" />
          <span className="text-[11px] font-medium text-surface-300 uppercase tracking-wide">
            Sessions
          </span>
          {totalActive > 0 && (
            <span className="px-1.5 py-px rounded-full bg-green-500/15 text-[9px] text-green-400 font-medium tabular-nums">
              {totalActive}
            </span>
          )}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 min-h-0 overflow-auto py-1 px-0.5">
        {sortedProjects.length === 0 && sessions.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-surface-500">
            No projects or sessions yet
          </div>
        )}

        {sortedProjects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            sessions={sessionsByProject.get(project.id) || []}
            activeSessionId={activeSessionId}
            defaultExpanded={(sessionsByProject.get(project.id) || []).length > 0}
            onSwitchSession={onSwitchSession}
            onCreateSession={onCreateSession}
            onKillSession={onKillSession}
          />
        ))}

        {/* Orphan sessions (no project or project deleted) */}
        {orphanSessions.length > 0 && (
          <ProjectGroup
            project={{ id: '__unassigned__', name: 'Unassigned' }}
            sessions={orphanSessions}
            activeSessionId={activeSessionId}
            defaultExpanded={true}
            onSwitchSession={onSwitchSession}
            onCreateSession={() => {}}
            onKillSession={onKillSession}
          />
        )}
      </div>
    </div>
  );
}
