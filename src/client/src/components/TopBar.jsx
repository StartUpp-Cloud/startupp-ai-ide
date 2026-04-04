import {
  GitBranch,
  GitCompareArrows,
  MousePointer,
  ChevronDown,
  UserCircle,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import SystemHealth from './SystemHealth';
import ModeToggle from './ModeToggle';

const CLI_TOOLS = [
  { id: 'claude', name: 'Claude', color: 'text-orange-400', context: 'Full conversation memory via --resume' },
  { id: 'copilot', name: 'Copilot', color: 'text-blue-400', context: 'Full conversation memory via --resume' },
  { id: 'aider', name: 'Aider', color: 'text-green-400', context: 'Context from git history + repo map' },
  { id: 'gemini', name: 'Gemini', color: 'text-cyan-400', context: 'Per-message context' },
  { id: 'shell', name: 'Shell only', color: 'text-surface-400', context: 'Direct shell commands' },
];

export default function TopBar({
  selectedProject,
  currentBranch,
  planRunning,
  planSteps,
  planCurrentStep,
  agentMode,
  onModeChange,
  selectedTool,
  onToolChange,
  notificationSlot,
}) {
  const completedSteps = planSteps ? planSteps.filter((_, i) => i < (planCurrentStep || 0)).length : 0;
  const totalSteps = planSteps?.length || 0;
  const [showToolMenu, setShowToolMenu] = useState(false);
  const toolMenuRef = useRef(null);

  const activeTool = CLI_TOOLS.find(t => t.id === selectedTool) || CLI_TOOLS[0];

  useEffect(() => {
    const handler = (e) => {
      if (toolMenuRef.current && !toolMenuRef.current.contains(e.target)) setShowToolMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="flex-shrink-0">
      <div className="flex items-center bg-surface-850 border-b border-surface-700 px-3 py-1.5 gap-3">

        {/* Logo + Project */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-6 h-6 rounded-md bg-primary-500 flex items-center justify-center">
            <span className="text-surface-950 font-display font-bold text-[10px]">P</span>
          </div>
          <span className="text-[11px] font-medium text-surface-400 tracking-tight hidden sm:inline">IDE</span>
          {selectedProject && (
            <>
              <span className="text-surface-600 text-[11px]">/</span>
              <span className="text-[11px] text-surface-200 font-medium truncate max-w-[160px]">{selectedProject.name}</span>
            </>
          )}
        </div>

        {/* Branch info */}
        {currentBranch?.branch && (
          <div className="flex items-center gap-1.5 text-[11px] text-surface-400">
            <GitBranch className="w-3 h-3" />
            <span className="truncate max-w-[120px]">{currentBranch.branch}</span>
            {currentBranch.hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Uncommitted changes" />}
          </div>
        )}

        <div className="w-px h-4 bg-surface-700" />

        {/* Mode toggle */}
        <ModeToggle mode={agentMode} onChange={onModeChange} />

        <div className="w-px h-4 bg-surface-700" />

        {/* Tool selector */}
        <div className="relative" ref={toolMenuRef}>
          <button
            onClick={() => setShowToolMenu(!showToolMenu)}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium hover:bg-surface-750 transition-colors"
          >
            <span className={activeTool.color}>{activeTool.name}</span>
            <ChevronDown size={10} className="text-surface-500" />
          </button>

          {showToolMenu && (
            <div className="absolute top-full left-0 mt-1 w-56 bg-surface-800 border border-surface-700 rounded-lg shadow-modal z-50 py-1 animate-scale-in">
              {CLI_TOOLS.map(t => (
                <button
                  key={t.id}
                  onClick={() => { onToolChange(t.id); setShowToolMenu(false); }}
                  className={`flex items-start gap-2 w-full px-3 py-2 text-left transition-colors ${
                    t.id === selectedTool
                      ? 'bg-surface-750 text-surface-100'
                      : 'text-surface-300 hover:bg-surface-750'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${t.color.replace('text-', 'bg-')}`} />
                  <div>
                    <div className="text-[11px] font-medium">{t.name}</div>
                    <div className="text-[9px] text-surface-500">{t.context}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Plan progress (if running) */}
        {planRunning && totalSteps > 0 && (
          <div className="flex items-center gap-1.5 text-[11px] text-surface-400">
            <div className="w-16 h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 transition-all" style={{ width: `${Math.round((completedSteps / totalSteps) * 100)}%` }} />
            </div>
            <span className="text-[10px]">{completedSteps}/{totalSteps}</span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tools */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => window.open('/branch-review', '_blank')}
            className="p-1.5 rounded hover:bg-surface-750 text-surface-400 hover:text-surface-200 transition-colors"
            title="Branch Review"
          >
            <GitCompareArrows className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => window.open('/debug', '_blank')}
            className="p-1.5 rounded hover:bg-surface-750 text-surface-400 hover:text-surface-200 transition-colors"
            title="Debug Element"
          >
            <MousePointer className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => window.open('/profile', '_blank')}
            className="p-1.5 rounded hover:bg-surface-750 text-surface-400 hover:text-surface-200 transition-colors"
            title="Profile & Preferences"
          >
            <UserCircle className="w-3.5 h-3.5" />
          </button>

          <SystemHealth />

          {notificationSlot}
        </div>
      </div>
    </div>
  );
}
