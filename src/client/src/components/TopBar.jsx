import {
  GitBranch,
  GitCompareArrows,
  MousePointer,
  ChevronDown,
  UserCircle,
  Settings,
  HelpCircle,
  MessageSquare,
  Smartphone,
} from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import SystemHealth from './SystemHealth';
import LLMSettingsPanel from './LLMSettingsPanel';
import WelcomeGuide from './WelcomeGuide';
import SlackSetupPanel from './SlackSetupPanel';
import VersionBadge from './VersionBadge';
import { CLI_TOOLS } from '../utils/sessionAssistantOptions';

export default function TopBar({
  selectedProject,
  currentBranch,
  planRunning,
  planSteps,
  planCurrentStep,
  selectedTool,
  onToolChange,
  forceMobileLayout = false,
  onForceMobileLayoutChange,
  onProjectUpdated,
  notificationSlot,
  layoutControls,
  projects,
}) {
  const completedSteps = planSteps ? planSteps.filter((_, i) => i < (planCurrentStep || 0)).length : 0;
  const totalSteps = planSteps?.length || 0;
  const compactLayout = forceMobileLayout;
  const [showToolMenu, setShowToolMenu] = useState(false);
  const [showLLMSettings, setShowLLMSettings] = useState(false);
  const [showSlack, setShowSlack] = useState(false);
  const [showGuide, setShowGuide] = useState(() => localStorage.getItem('hideWelcomeGuide') !== 'true');
  const toolMenuRef = useRef(null);

  const activeTool = CLI_TOOLS.find(t => t.id === selectedTool) || CLI_TOOLS[0];

  const updateProjectStack = async (stack) => {
    if (!selectedProject?.id) return;
    try {
      const response = await fetch('/api/salesforce/project-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject.id, stack }),
      });
      const data = await response.json();
      if (response.ok && data.ok) onProjectUpdated?.(data.data.project);
    } catch {}
  };

  useEffect(() => {
    const handler = (e) => {
      if (toolMenuRef.current && !toolMenuRef.current.contains(e.target)) setShowToolMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="flex-shrink-0">
      <div className={`flex flex-wrap items-center bg-surface-850 border-b border-surface-700 px-2 py-1.5 gap-1.5 ${compactLayout ? '' : 'sm:flex-nowrap sm:px-3 sm:gap-3'}`}>

        {/* Logo + Project */}
        <div className={`flex items-center gap-2 ${compactLayout ? 'min-w-0' : 'flex-shrink-0'}`}>
          <div className="w-6 h-6 rounded-md bg-primary-500 flex items-center justify-center flex-shrink-0">
            <span className="text-surface-950 font-display font-bold text-[10px]">P</span>
          </div>
          <span className={`text-[11px] font-medium text-surface-400 tracking-tight ${compactLayout ? 'hidden' : 'hidden sm:inline'}`}>IDE</span>
          <VersionBadge />
          {selectedProject && (
            <>
              <span className={`text-surface-600 text-[11px] ${compactLayout ? 'hidden' : 'hidden sm:inline'}`}>/</span>
              <span className={`text-[11px] text-surface-200 font-medium truncate ${compactLayout ? 'max-w-[110px]' : 'max-w-[110px] sm:max-w-[160px]'}`}>{selectedProject.name}</span>
            </>
          )}
        </div>

        {/* Branch info */}
        {currentBranch?.branch && (
          <div className={`${compactLayout ? 'hidden' : 'hidden sm:flex'} min-w-0 items-center gap-1.5 text-[11px] text-surface-400`}>
            <GitBranch className="w-3 h-3" />
            <span className="truncate max-w-[120px]">{currentBranch.branch}</span>
            {currentBranch.hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" title="Uncommitted changes" />}
          </div>
        )}

        <div className={`${compactLayout ? 'hidden' : 'hidden sm:block'} w-px h-4 bg-surface-700`} />

        {/* Tool selector */}
        <div className="relative" ref={toolMenuRef}>
          <button
            onClick={() => setShowToolMenu(!showToolMenu)}
            title="Default assistant for new sessions"
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

        <div className={`${compactLayout ? 'hidden' : 'hidden sm:block'} w-px h-4 bg-surface-700`} />

        {selectedProject && (
          <select
            value={selectedProject.stack || 'generic'}
            onChange={(e) => updateProjectStack(e.target.value)}
            className={`bg-surface-800 border border-surface-700 rounded px-1.5 py-1 text-[11px] text-surface-300 focus:outline-none focus:ring-1 focus:ring-primary-500 ${compactLayout ? 'max-w-[92px]' : ''}`}
            title="Project stack"
          >
            <option value="generic">Generic</option>
            <option value="salesforce">Salesforce</option>
          </select>
        )}

        <div className={`${compactLayout ? 'hidden' : 'hidden sm:block'} w-px h-4 bg-surface-700`} />

        {/* Slack */}
        <button
          onClick={() => setShowSlack(true)}
          className={`${compactLayout ? 'flex px-1.5' : 'hidden px-2 sm:flex'} items-center gap-1.5 py-1 rounded-md text-[11px] font-medium text-surface-400 hover:text-surface-200 hover:bg-surface-750 transition-colors`}
          title="Connect Slack"
        >
          <MessageSquare size={12} className="text-[#4A154B]" />
          <span className={compactLayout ? 'sr-only' : 'hidden sm:inline'}>Slack</span>
        </button>

        <button
          onClick={() => onForceMobileLayoutChange?.(!forceMobileLayout)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
            forceMobileLayout
              ? 'bg-primary-500/15 text-primary-300 ring-1 ring-primary-500/30'
              : 'text-surface-400 hover:text-surface-200 hover:bg-surface-750'
          }`}
          title={forceMobileLayout ? 'Use responsive layout' : 'Force mobile layout'}
          aria-pressed={forceMobileLayout}
        >
          <Smartphone size={12} />
          <span className={compactLayout ? 'sr-only' : 'hidden sm:inline'}>Mobile</span>
        </button>

        {/* Spacer */}
        <div className="flex-1 min-w-2" />

        {/* Tools */}
        <div className="flex items-center gap-0.5 flex-shrink-0 sm:gap-1">
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

          <button
            onClick={() => setShowGuide(true)}
            className="p-1.5 rounded hover:bg-surface-750 text-surface-400 hover:text-surface-200 transition-colors"
            title="Welcome Guide"
          >
            <HelpCircle className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setShowLLMSettings(true)}
            className="p-1.5 rounded hover:bg-surface-750 text-surface-400 hover:text-surface-200 transition-colors"
            title="LLM Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          <SystemHealth containerName={selectedProject?.containerName} />

          {layoutControls}

          {notificationSlot}
        </div>
      </div>

      {/* Modals */}
      <LLMSettingsPanel isOpen={showLLMSettings} onClose={() => setShowLLMSettings(false)} project={selectedProject} />
      <WelcomeGuide isOpen={showGuide} onClose={() => setShowGuide(false)} />
      <SlackSetupPanel isOpen={showSlack} onClose={() => setShowSlack(false)} projects={projects || []} />
    </div>
  );
}
