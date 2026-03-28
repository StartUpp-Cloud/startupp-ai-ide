import { useState, useEffect, useRef } from 'react';
import {
  GitCommit, GitBranch, Play, Pause, CheckCircle2, XCircle, AlertTriangle,
  RotateCcw, TestTube, Shield, Brain, Zap, Clock, ChevronDown, ChevronRight,
  Activity, RefreshCw,
} from 'lucide-react';

const ICON_MAP = {
  'step-started': Play,
  'step-completed': CheckCircle2,
  'step-failed': XCircle,
  'step-retried': RotateCcw,
  'git-commit': GitCommit,
  'git-branch': GitBranch,
  'git-rollback': RotateCcw,
  'test-passed': TestTube,
  'test-failed': TestTube,
  'safety-blocked': Shield,
  'safety-warning': AlertTriangle,
  'orchestrator-started': Play,
  'orchestrator-paused': Pause,
  'orchestrator-completed': CheckCircle2,
  'user-intervention': Zap,
  'memory-learned': Brain,
};

const COLOR_MAP = {
  'step-completed': 'text-green-400',
  'step-failed': 'text-red-400',
  'step-retried': 'text-yellow-400',
  'git-commit': 'text-blue-400',
  'git-branch': 'text-blue-300',
  'git-rollback': 'text-orange-400',
  'test-passed': 'text-green-400',
  'test-failed': 'text-red-400',
  'safety-blocked': 'text-red-400',
  'safety-warning': 'text-yellow-400',
  'orchestrator-started': 'text-primary-400',
  'orchestrator-paused': 'text-yellow-400',
  'orchestrator-completed': 'text-green-400',
  'user-intervention': 'text-yellow-300',
  'memory-learned': 'text-purple-400',
};

function relativeTime(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.max(0, now - then);

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diff / 86400000);
  return `${days}d ago`;
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export default function ActivityFeed({ projectId }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const scrollRef = useRef(null);
  const isFirstLoad = useRef(true);

  const fetchActivities = async () => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/activity?projectId=${projectId}&limit=50`);
      if (!res.ok) throw new Error('Failed to fetch activity');
      const data = await res.json();
      setActivities(data);
    } catch (error) {
      console.error('Failed to load activity:', error);
    } finally {
      if (isFirstLoad.current) {
        setLoading(false);
        isFirstLoad.current = false;
      }
    }
  };

  // Fetch on mount and when projectId changes
  useEffect(() => {
    isFirstLoad.current = true;
    setLoading(true);
    setActivities([]);
    fetchActivities();
  }, [projectId]);

  // Poll every 10 seconds
  useEffect(() => {
    if (!projectId) return;

    const interval = setInterval(fetchActivities, 10000);
    return () => clearInterval(interval);
  }, [projectId]);

  // Auto-scroll to top when new entries arrive
  useEffect(() => {
    if (scrollRef.current && activities.length > 0) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activities.length]);

  const toggleExpanded = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // No project selected
  if (!projectId) {
    return (
      <div className="flex flex-col h-full bg-surface-850">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700">
          <Activity className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Activity</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-surface-500 text-center">
            Select a project to view activity
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Activity</span>
          <span className="text-xs text-surface-500">
            ({activities.length})
          </span>
        </div>
        <button
          onClick={fetchActivities}
          className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        {/* Loading spinner on first load */}
        {loading && (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-5 h-5 text-surface-500 animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && activities.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center p-4">
            <Activity className="w-8 h-8 text-surface-600 mb-2" />
            <p className="text-xs text-surface-400">No activity yet</p>
            <p className="text-[10px] text-surface-500">
              Actions will appear here as the orchestrator runs
            </p>
          </div>
        )}

        {/* Timeline */}
        {!loading && activities.length > 0 && (
          <div className="relative">
            {/* Vertical timeline line */}
            <div className="absolute left-[19px] top-0 bottom-0 w-px bg-surface-700" />

            {activities.map((entry) => {
              const Icon = ICON_MAP[entry.type] || Zap;
              const colorClass = COLOR_MAP[entry.type] || 'text-surface-400';
              const isExpanded = expanded[entry.id];
              const hasDetail = entry.detail || entry.metadata;
              const duration = formatDuration(entry.duration);

              return (
                <div
                  key={entry.id}
                  className="relative flex items-start gap-2.5 px-3 py-2 hover:bg-surface-800/50 transition-colors group"
                >
                  {/* Icon dot */}
                  <div className={`relative z-10 flex-shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center rounded-full bg-surface-850 ${colorClass}`}>
                    <Icon className="w-3 h-3" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Title row */}
                    <div className="flex items-center gap-1.5">
                      {hasDetail && (
                        <button
                          onClick={() => toggleExpanded(entry.id)}
                          className="flex-shrink-0 text-surface-500 hover:text-surface-300"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-3 h-3" />
                          ) : (
                            <ChevronRight className="w-3 h-3" />
                          )}
                        </button>
                      )}
                      {!hasDetail && <span className="w-3 flex-shrink-0" />}

                      <span
                        className={`text-xs text-surface-200 truncate ${hasDetail ? 'cursor-pointer hover:text-surface-100' : ''}`}
                        onClick={() => hasDetail && toggleExpanded(entry.id)}
                        title={entry.title}
                      >
                        {entry.title}
                      </span>
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-0.5 ml-[18px]">
                      <span className="text-[10px] text-surface-500">
                        {relativeTime(entry.timestamp)}
                      </span>

                      {duration && (
                        <span className="inline-flex items-center gap-0.5 px-1 py-0 text-[10px] rounded bg-surface-700/60 text-surface-400">
                          <Clock className="w-2.5 h-2.5" />
                          {duration}
                        </span>
                      )}

                      <span className="text-[10px] text-surface-600">
                        {entry.type}
                      </span>
                    </div>

                    {/* Expandable detail */}
                    {isExpanded && hasDetail && (
                      <div className="mt-1.5 ml-[18px] p-2 bg-surface-800 rounded border border-surface-700 text-[11px] text-surface-300 whitespace-pre-wrap break-words">
                        {entry.detail && <p>{entry.detail}</p>}
                        {entry.metadata && (
                          <pre className="mt-1 text-[10px] text-surface-400 overflow-x-auto">
                            {typeof entry.metadata === 'string'
                              ? entry.metadata
                              : JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
