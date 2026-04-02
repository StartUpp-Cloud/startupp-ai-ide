import { useState, useEffect, useCallback } from 'react';
import { Play, Package, RefreshCw, Loader2, Terminal, Wrench, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * QuickActionsPanel - Auto-detected project scripts displayed as buttons.
 * Fetches package.json scripts via /api/context/:projectId/scripts and
 * dispatches 'run-in-util' custom events when a script button is clicked.
 */

const SCRIPT_CATEGORIES = {
  dev: { label: 'Dev', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
  build: { label: 'Build', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  test: { label: 'Test', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20' },
  lint: { label: 'Lint', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  other: { label: 'Other', color: 'text-surface-400', bg: 'bg-surface-700/40', border: 'border-surface-600/30' },
};

function categorizeScript(name) {
  const lower = name.toLowerCase();
  if (lower.includes('dev') || lower === 'start' || lower === 'serve') return 'dev';
  if (lower.includes('build') || lower.includes('compile') || lower.includes('bundle')) return 'build';
  if (lower.includes('test') || lower.includes('spec') || lower.includes('e2e') || lower.includes('jest') || lower.includes('vitest')) return 'test';
  if (lower.includes('lint') || lower.includes('format') || lower.includes('prettier') || lower.includes('eslint') || lower.includes('check')) return 'lint';
  return 'other';
}

export default function QuickActionsPanel({ projectId, projectPath }) {
  const [scripts, setScripts] = useState({});
  const [packageManager, setPackageManager] = useState('npm');
  const [framework, setFramework] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [runningScript, setRunningScript] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  const fetchScripts = useCallback(async () => {
    if (!projectId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/context/${projectId}/scripts`);
      if (!res.ok) {
        throw new Error('Failed to fetch scripts');
      }
      const data = await res.json();
      setScripts(data.scripts || {});
      setPackageManager(data.packageManager || 'npm');
      setFramework(data.framework || null);
    } catch (err) {
      console.error('Failed to load detected scripts:', err);
      setError(err.message);
      setScripts({});
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    setScripts({});
    setError(null);
    fetchScripts();
  }, [fetchScripts]);

  const runScript = useCallback((scriptName) => {
    const command = `${packageManager} run ${scriptName}\n`;

    setRunningScript(scriptName);

    // Dispatch event for the IDE to write to the utility terminal
    window.dispatchEvent(
      new CustomEvent('run-in-util', {
        detail: { command, scriptName, projectId },
      })
    );

    // Visual feedback then clear
    setTimeout(() => setRunningScript(null), 1200);
  }, [packageManager, projectId]);

  const toggleCategory = useCallback((category) => {
    setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  // Group scripts by category
  const scriptEntries = Object.entries(scripts);
  const grouped = {};
  for (const [name, command] of scriptEntries) {
    const cat = categorizeScript(name);
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push({ name, command });
  }

  // Sort categories: dev, build, test, lint, other
  const categoryOrder = ['dev', 'build', 'test', 'lint', 'other'];
  const sortedCategories = categoryOrder.filter((cat) => grouped[cat]?.length > 0);

  if (!projectId) return null;

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Scripts</span>
          {scriptEntries.length > 0 && (
            <span className="text-xs text-surface-500">({scriptEntries.length})</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {framework && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-300 border border-primary-500/20">
              {framework}
            </span>
          )}
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700/60 text-surface-400">
            {packageManager}
          </span>
          <button
            onClick={fetchScripts}
            disabled={loading}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
            title="Refresh detected scripts"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading */}
        {loading && scriptEntries.length === 0 && (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="w-5 h-5 text-surface-500 animate-spin" />
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center h-24 text-center p-4">
            <Wrench className="w-6 h-6 text-surface-600 mb-1.5" />
            <p className="text-[11px] text-red-400">{error}</p>
            <button
              onClick={fetchScripts}
              className="mt-2 text-[10px] text-primary-400 hover:text-primary-300 underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && scriptEntries.length === 0 && (
          <div className="flex flex-col items-center justify-center h-24 text-center p-4">
            <Terminal className="w-6 h-6 text-surface-600 mb-1.5" />
            <p className="text-xs text-surface-400">No scripts detected</p>
            <p className="text-[10px] text-surface-500 mt-0.5">
              Add scripts to package.json
            </p>
          </div>
        )}

        {/* Grouped scripts */}
        {!loading && sortedCategories.length > 0 && (
          <div className="py-1">
            {sortedCategories.map((category) => {
              const catConfig = SCRIPT_CATEGORIES[category];
              const catScripts = grouped[category];
              const isCollapsed = collapsed[category];

              return (
                <div key={category}>
                  {/* Category header */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="flex items-center gap-1.5 w-full px-3 py-1 text-left hover:bg-surface-800/50 transition-colors"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3 h-3 text-surface-500" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-surface-500" />
                    )}
                    <span className={`text-[10px] font-medium uppercase tracking-wider ${catConfig.color}`}>
                      {catConfig.label}
                    </span>
                    <span className="text-[10px] text-surface-600">
                      {catScripts.length}
                    </span>
                  </button>

                  {/* Script buttons */}
                  {!isCollapsed && (
                    <div className="px-3 pb-1.5 space-y-0.5">
                      {catScripts.map(({ name, command }) => {
                        const isRunning = runningScript === name;

                        return (
                          <button
                            key={name}
                            onClick={() => runScript(name)}
                            disabled={isRunning}
                            className={`flex items-center gap-1.5 w-full px-2 py-1 text-left rounded border transition-all group ${catConfig.bg} ${catConfig.border} hover:brightness-125 disabled:opacity-60`}
                            title={command}
                          >
                            {isRunning ? (
                              <Loader2 className={`w-3 h-3 flex-shrink-0 animate-spin ${catConfig.color}`} />
                            ) : (
                              <Play className={`w-3 h-3 flex-shrink-0 ${catConfig.color} opacity-60 group-hover:opacity-100`} />
                            )}
                            <span className="text-[11px] text-surface-200 truncate font-mono">
                              {name}
                            </span>
                          </button>
                        );
                      })}
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
