import { useState, useEffect } from 'react';
import {
  Clock, Plus, Play, Pause, Trash2, X, Check, AlertCircle,
  Terminal, TestTube, ListTodo, ChevronDown, ChevronRight,
  RefreshCw, Loader2, Globe, Sparkles,
} from 'lucide-react';

// Interval presets for easy selection
const INTERVAL_PRESETS = [
  { label: '1 min', ms: 60000 },
  { label: '5 min', ms: 300000 },
  { label: '15 min', ms: 900000 },
  { label: '30 min', ms: 1800000 },
  { label: '1 hour', ms: 3600000 },
  { label: '6 hours', ms: 21600000 },
  { label: '24 hours', ms: 86400000 },
];

const TYPE_ICONS = {
  command: Terminal,
  test: TestTube,
  plan: ListTodo,
  webhook: Globe,
};

const TYPE_LABELS = {
  command: 'Command',
  test: 'Test',
  plan: 'Plan',
  webhook: 'Webhook',
};

function formatInterval(ms) {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

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

export default function SchedulerPanel({ projectId, projectPath, selectedTool }) {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [aiQuery, setAiQuery] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [triggeringIds, setTriggeringIds] = useState({});

  // Create form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('command');
  const [formCommand, setFormCommand] = useState('');
  const [formIntervalMs, setFormIntervalMs] = useState(300000);
  const [formCliTool, setFormCliTool] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchSchedules = async () => {
    try {
      const query = projectId ? `?projectId=${projectId}` : '';
      const res = await fetch(`/api/schedules${query}`);
      if (!res.ok) throw new Error('Failed to fetch schedules');
      const data = await res.json();
      setSchedules(data);
    } catch (error) {
      console.error('Failed to load schedules:', error);
    } finally {
      setLoading(false);
    }
  };

  // Fetch on mount and when projectId changes
  useEffect(() => {
    setLoading(true);
    setSchedules([]);
    fetchSchedules();
  }, [projectId]);

  // Poll every 15 seconds
  useEffect(() => {
    const interval = setInterval(fetchSchedules, 15000);
    return () => clearInterval(interval);
  }, [projectId]);

  const handleCreate = async () => {
    if (!formName.trim()) return;
    if (formType === 'command' && !formCommand.trim()) return;

    try {
      setCreating(true);
      const res = await fetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: formName.trim(),
          type: formType,
          command: formCommand.trim(),
          cliTool: formCliTool || undefined,
          projectPath,
          intervalMs: formIntervalMs,
          enabled: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to create schedule');
      const schedule = await res.json();
      setSchedules(prev => [schedule, ...prev]);
      resetForm();
    } catch (error) {
      console.error('Failed to create schedule:', error);
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setShowCreateForm(false);
    setFormName('');
    setFormType('command');
    setFormCommand('');
    setFormIntervalMs(300000);
    setFormCliTool('');
  };

  const handleToggle = async (schedule) => {
    try {
      const res = await fetch(`/api/schedules/${schedule.id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !schedule.enabled }),
      });
      if (!res.ok) throw new Error('Failed to toggle schedule');
      setSchedules(prev =>
        prev.map(s =>
          s.id === schedule.id ? { ...s, enabled: !s.enabled } : s
        )
      );
    } catch (error) {
      console.error('Failed to toggle schedule:', error);
    }
  };

  const handleTrigger = async (schedule) => {
    try {
      setTriggeringIds(prev => ({ ...prev, [schedule.id]: true }));
      const res = await fetch(`/api/schedules/${schedule.id}/trigger`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to trigger schedule');
      // Refresh to pick up new last result
      await fetchSchedules();
    } catch (error) {
      console.error('Failed to trigger schedule:', error);
    } finally {
      setTriggeringIds(prev => ({ ...prev, [schedule.id]: false }));
    }
  };

  const handleDelete = async (schedule) => {
    try {
      const res = await fetch(`/api/schedules/${schedule.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete schedule');
      setSchedules(prev => prev.filter(s => s.id !== schedule.id));
    } catch (error) {
      console.error('Failed to delete schedule:', error);
    }
  };

  const toggleExpanded = (id) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Schedules</span>
          <span className="text-xs text-surface-500">({schedules.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchSchedules}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowCreateForm(!showCreateForm)}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            title="New schedule"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Create Form */}
      {/* AI Schedule Assistant */}
      {showCreateForm && (
        <div className="px-2 pt-2 pb-1 border-b border-surface-700/50">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-purple-400 flex-shrink-0" />
            <input
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && aiQuery.trim() && !aiGenerating) {
                  e.preventDefault();
                  setAiGenerating(true);
                  try {
                    const res = await fetch('/api/schedules/generate', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ description: aiQuery.trim(), projectId }),
                    });
                    const data = await res.json();
                    if (data.config) {
                      setFormName(data.config.name || '');
                      setFormType(data.config.type || 'command');
                      setFormCommand(data.config.command || data.config.webhookUrl || '');
                      setFormIntervalMs(data.config.intervalMs || 300000);
                      setFormCliTool(selectedTool || 'claude');
                      setAiQuery('');
                    }
                  } catch { /* ignore */ }
                  finally { setAiGenerating(false); }
                }
              }}
              placeholder="Describe what to schedule... (Enter to generate)"
              className="flex-1 px-2 py-1 text-[11px] bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-purple-500/50"
            />
            {aiGenerating && <Loader2 className="w-3 h-3 text-purple-400 animate-spin flex-shrink-0" />}
          </div>
          <p className="text-[10px] text-surface-600 mt-1 mb-1">e.g. "Send a Slack message every hour with test results" or "Check disk usage every 6 hours"</p>
        </div>
      )}

      {showCreateForm && (
        <div className="p-2 border-b border-surface-700 space-y-2">
          {/* Name input */}
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="Schedule name..."
            className="w-full px-2 py-1.5 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-primary-500"
            autoFocus
          />

          {/* Type selector */}
          <div className="flex gap-1">
            {Object.entries(TYPE_LABELS).map(([type, label]) => {
              const Icon = TYPE_ICONS[type];
              return (
                <button
                  key={type}
                  onClick={() => setFormType(type)}
                  className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors ${
                    formType === type
                      ? 'bg-primary-500/20 text-primary-300 border border-primary-500/40'
                      : 'bg-surface-800 text-surface-400 border border-surface-700 hover:text-surface-200'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Command input (only for type=command) */}
          {formType === 'command' && (
            <input
              type="text"
              value={formCommand}
              onChange={(e) => setFormCommand(e.target.value)}
              placeholder="Command to run..."
              className="w-full px-2 py-1.5 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-primary-500 font-mono"
            />
          )}

          {/* CLI Tool selector */}
          <div>
            <label className="text-[10px] text-surface-500 uppercase mb-1 block">Run via</label>
            <div className="flex gap-1 flex-wrap">
              {[
                { id: '', label: 'Shell', color: 'surface' },
                { id: 'claude', label: 'Claude', color: 'orange' },
                { id: 'copilot', label: 'Copilot', color: 'blue' },
                { id: 'aider', label: 'Aider', color: 'green' },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => setFormCliTool(t.id)}
                  className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                    formCliTool === t.id
                      ? `bg-${t.color}-500/20 border-${t.color}-500/40 text-${t.color}-300`
                      : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interval dropdown */}
          <select
            value={formIntervalMs}
            onChange={(e) => setFormIntervalMs(Number(e.target.value))}
            className="w-full px-2 py-1.5 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 focus:ring-1 focus:ring-primary-500"
          >
            {INTERVAL_PRESETS.map((preset) => (
              <option key={preset.ms} value={preset.ms}>
                Every {preset.label}
              </option>
            ))}
          </select>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !formName.trim() || (formType === 'command' && !formCommand.trim())}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              {creating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              Create
            </button>
            <button
              onClick={resetForm}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading spinner */}
        {loading && (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-5 h-5 text-surface-500 animate-spin" />
          </div>
        )}

        {/* Empty state */}
        {!loading && schedules.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center p-4">
            <Clock className="w-8 h-8 text-surface-600 mb-2" />
            <p className="text-xs text-surface-400">No schedules yet</p>
            <p className="text-[10px] text-surface-500">
              Create a schedule to run tasks automatically
            </p>
          </div>
        )}

        {/* Schedule list */}
        {!loading && schedules.length > 0 && (
          <div>
            {schedules.map((schedule) => {
              const TypeIcon = TYPE_ICONS[schedule.type] || Terminal;
              const isExpanded = expanded[schedule.id];
              const isTriggering = triggeringIds[schedule.id];
              const lastResult = schedule.lastResult;
              const hasLastResult = lastResult && (lastResult.output || lastResult.error || lastResult.time);

              return (
                <div
                  key={schedule.id}
                  className="border-b border-surface-700"
                >
                  {/* Schedule row */}
                  <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-800/50 transition-colors group">
                    {/* Expand toggle */}
                    {hasLastResult ? (
                      <button
                        onClick={() => toggleExpanded(schedule.id)}
                        className="flex-shrink-0 text-surface-500 hover:text-surface-300"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                      </button>
                    ) : (
                      <span className="w-3 flex-shrink-0" />
                    )}

                    {/* Type icon */}
                    <TypeIcon className={`w-3.5 h-3.5 flex-shrink-0 ${
                      schedule.enabled ? 'text-surface-300' : 'text-surface-600'
                    }`} />

                    {/* Name and meta */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`text-xs truncate ${
                            schedule.enabled ? 'text-surface-200' : 'text-surface-500'
                          }`}
                          title={schedule.name}
                        >
                          {schedule.name}
                        </span>

                        {/* Interval badge */}
                        <span className="inline-flex items-center gap-0.5 px-1 py-0 text-[10px] rounded bg-surface-700/60 text-surface-400 flex-shrink-0">
                          <Clock className="w-2.5 h-2.5" />
                          {formatInterval(schedule.intervalMs)}
                        </span>

                        {/* Last result dot */}
                        {lastResult && (
                          <span
                            className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                              lastResult.success ? 'bg-green-400' : 'bg-red-400'
                            }`}
                            title={lastResult.success ? 'Last run succeeded' : 'Last run failed'}
                          />
                        )}
                      </div>

                      {/* Last run time */}
                      {lastResult?.time && (
                        <div className="mt-0.5">
                          <span className="text-[10px] text-surface-500">
                            {relativeTime(lastResult.time)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {/* Enable/Disable toggle */}
                      <button
                        onClick={() => handleToggle(schedule)}
                        className={`p-1 rounded transition-colors ${
                          schedule.enabled
                            ? 'text-green-400 hover:bg-green-500/20'
                            : 'text-surface-500 hover:bg-surface-700'
                        }`}
                        title={schedule.enabled ? 'Disable' : 'Enable'}
                      >
                        {schedule.enabled ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                      </button>

                      {/* Trigger now */}
                      <button
                        onClick={() => handleTrigger(schedule)}
                        disabled={isTriggering}
                        className="p-1 rounded text-surface-400 hover:text-primary-400 hover:bg-primary-500/20 transition-colors disabled:opacity-50"
                        title="Run now"
                      >
                        {isTriggering ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(schedule)}
                        className="p-1 rounded text-surface-400 opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/20 transition-all"
                        title="Delete"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded last result */}
                  {isExpanded && hasLastResult && (
                    <div className="mx-3 mb-2 ml-[30px] p-2 bg-surface-800 rounded border border-surface-700">
                      <div className="flex items-center gap-1.5 mb-1">
                        {lastResult.success ? (
                          <Check className="w-3 h-3 text-green-400" />
                        ) : (
                          <AlertCircle className="w-3 h-3 text-red-400" />
                        )}
                        <span className={`text-[11px] font-medium ${
                          lastResult.success ? 'text-green-400' : 'text-red-400'
                        }`}>
                          {lastResult.success ? 'Success' : 'Failed'}
                        </span>
                        {lastResult.time && (
                          <span className="text-[10px] text-surface-500">
                            {relativeTime(lastResult.time)}
                          </span>
                        )}
                      </div>
                      {(lastResult.output || lastResult.error) && (
                        <pre className="text-[10px] text-surface-400 whitespace-pre-wrap break-words overflow-x-auto max-h-32 overflow-y-auto">
                          {lastResult.error || lastResult.output}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
