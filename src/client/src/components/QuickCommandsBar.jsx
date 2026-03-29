import { useState, useEffect, useCallback } from 'react';
import { Plus, Play, Trash2, X, Terminal, Rocket, Database, TestTube, Wrench, Globe } from 'lucide-react';

const ICON_MAP = {
  rocket: Rocket,
  database: Database,
  'test-tube': TestTube,
  wrench: Wrench,
  globe: Globe,
  terminal: Terminal,
};

const ICON_OPTIONS = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'database', label: 'Database' },
  { value: 'test-tube', label: 'Test' },
  { value: 'wrench', label: 'Wrench' },
  { value: 'globe', label: 'Globe' },
];

const COLOR_MAP = {
  green: 'bg-green-500/20 text-green-400 border-green-500/30',
  blue: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  yellow: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  red: 'bg-red-500/20 text-red-400 border-red-500/30',
  purple: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  default: 'bg-surface-700 text-surface-300 border-surface-600',
};

const COLOR_OPTIONS = [
  { value: 'default', label: 'Default' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'yellow', label: 'Yellow' },
  { value: 'red', label: 'Red' },
  { value: 'purple', label: 'Purple' },
];

export default function QuickCommandsBar({ projectId, sessionId }) {
  const [commands, setCommands] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', command: '', icon: 'terminal', color: 'default' });
  const [runningId, setRunningId] = useState(null);

  // Fetch quick commands when projectId changes
  const fetchCommands = useCallback(async () => {
    if (!projectId) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/quick-commands`);
      if (!res.ok) throw new Error('Failed to fetch quick commands');
      const data = await res.json();
      setCommands(data);
    } catch (error) {
      console.error('Failed to load quick commands:', error);
    }
  }, [projectId]);

  useEffect(() => {
    setCommands([]);
    setShowForm(false);
    fetchCommands();
  }, [fetchCommands]);

  // Run a command
  const runCommand = useCallback(async (cmdId) => {
    if (!projectId || !sessionId) return;

    setRunningId(cmdId);
    try {
      await fetch(`/api/projects/${projectId}/quick-commands/${cmdId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch (error) {
      console.error('Failed to run quick command:', error);
    } finally {
      setTimeout(() => setRunningId(null), 600);
    }
  }, [projectId, sessionId]);

  // Add a new command
  const addCommand = useCallback(async () => {
    if (!projectId || !formData.name.trim() || !formData.command.trim()) return;

    try {
      const res = await fetch(`/api/projects/${projectId}/quick-commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error('Failed to add quick command');
      setFormData({ name: '', command: '', icon: 'terminal', color: 'default' });
      setShowForm(false);
      fetchCommands();
    } catch (error) {
      console.error('Failed to add quick command:', error);
    }
  }, [projectId, formData, fetchCommands]);

  // Delete a command
  const deleteCommand = useCallback(async (cmdId) => {
    if (!projectId) return;

    try {
      await fetch(`/api/projects/${projectId}/quick-commands/${cmdId}`, {
        method: 'DELETE',
      });
      setCommands((prev) => prev.filter((c) => c.id !== cmdId));
    } catch (error) {
      console.error('Failed to delete quick command:', error);
    }
  }, [projectId]);

  // Render nothing if no project or no commands and form is closed
  if (!projectId) return null;
  if (commands.length === 0 && !showForm) return null;

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-gray-800/80 border-b border-gray-700 overflow-x-auto">
      {/* Command buttons */}
      {commands.map((cmd) => {
        const Icon = ICON_MAP[cmd.icon] || Terminal;
        const colorClass = COLOR_MAP[cmd.color] || COLOR_MAP.default;
        const isRunning = runningId === cmd.id;

        return (
          <div key={cmd.id} className="relative group flex-shrink-0">
            <button
              onClick={() => runCommand(cmd.id)}
              disabled={!sessionId || isRunning}
              className={`flex items-center gap-1 px-2 py-0.5 text-[11px] border rounded transition-all whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${colorClass} ${
                isRunning ? 'animate-pulse' : 'hover:brightness-125'
              }`}
              title={cmd.command}
            >
              <Icon className="w-3 h-3" />
              <span>{cmd.name}</span>
            </button>

            {/* Delete button on hover */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteCommand(cmd.id);
              }}
              className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-red-600 text-white items-center justify-center text-[8px] hidden group-hover:flex transition-opacity"
              title="Delete command"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        );
      })}

      {/* Inline add form */}
      {showForm ? (
        <div className="flex items-center gap-1 flex-shrink-0">
          <input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Name"
            className="w-16 px-1.5 py-0.5 text-[11px] bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCommand();
              if (e.key === 'Escape') setShowForm(false);
            }}
          />
          <input
            type="text"
            value={formData.command}
            onChange={(e) => setFormData((prev) => ({ ...prev, command: e.target.value }))}
            placeholder="Command"
            className="w-28 px-1.5 py-0.5 text-[11px] bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCommand();
              if (e.key === 'Escape') setShowForm(false);
            }}
          />
          <select
            value={formData.icon}
            onChange={(e) => setFormData((prev) => ({ ...prev, icon: e.target.value }))}
            className="px-1 py-0.5 text-[11px] bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none"
          >
            {ICON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select
            value={formData.color}
            onChange={(e) => setFormData((prev) => ({ ...prev, color: e.target.value }))}
            className="px-1 py-0.5 text-[11px] bg-gray-900 border border-gray-600 rounded text-gray-200 focus:outline-none"
          >
            {COLOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            onClick={addCommand}
            disabled={!formData.name.trim() || !formData.command.trim()}
            className="px-1.5 py-0.5 text-[11px] bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => {
              setShowForm(false);
              setFormData({ name: '', command: '', icon: 'terminal', color: 'default' });
            }}
            className="p-0.5 text-gray-500 hover:text-gray-300 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center justify-center w-5 h-5 text-gray-500 hover:text-gray-300 hover:bg-gray-700 rounded transition-colors flex-shrink-0"
          title="Add quick command"
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
