import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjects } from '../contexts/ProjectContext';
// Task modes, presets, and model formatting removed — now using AI-assisted generation
import Terminal, { useTerminal } from '../components/Terminal';
import HistoryPanel from '../components/HistoryPanel';
import PlansPanel from '../components/PlansPanel';
import FilesPanel from '../components/FilesPanel';
import BigProjectPanel from '../components/BigProjectPanel';
import ProjectManagerPanel from '../components/ProjectManagerPanel';
import {
  FolderOpen,
  Files,
  ChevronRight,
  ChevronDown,
  Plus,
  Settings,
  Sparkles,
  Send,
  Copy,
  Check,
  BookOpen,
  History,
  Target,
  Layers,
  Bot,
  Bug,
  RefreshCw,
  Eye,
  Zap,
  Shield,
  TestTube,
  FileText,
  FlaskConical,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  ListTodo,
  X,
} from 'lucide-react';

// Storage keys
const STORAGE_KEYS = {
  SELECTED_PROJECT: 'ide-selected-project',
  SESSION_ID: 'ide-session-id',
  LEFT_PANEL_WIDTH: 'ide-left-panel-width',
  MIDDLE_PANEL_WIDTH: 'ide-middle-panel-width',
  LEFT_PANEL_COLLAPSED: 'ide-left-collapsed',
  LEFT_PANEL_TAB: 'ide-left-tab',
};

// Icon mapping removed — AI-assisted generation replaces task modes

export default function IDE() {
  const { projects, getProject, getGlobalRules } = useProjects();
  const { sendToTerminal } = useTerminal();

  // Layout state (with persistence)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.LEFT_PANEL_WIDTH);
    return saved ? parseInt(saved) : 220;
  });
  const [middlePanelWidth, setMiddlePanelWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MIDDLE_PANEL_WIDTH);
    return saved ? parseInt(saved) : 380;
  });
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.LEFT_PANEL_COLLAPSED) === 'true';
  });
  const [leftPanelTab, setLeftPanelTab] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.LEFT_PANEL_TAB) || 'projects';
  });

  // Project state (with persistence)
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT) || null;
  });
  const [selectedProject, setSelectedProject] = useState(null);
  const [globalRules, setGlobalRules] = useState([]);

  // Prompt state
  const [promptText, setPromptText] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState('');
  const [panelMode, setPanelMode] = useState('prompt'); // 'prompt' | 'plan'

  // Plan state
  const [planSteps, setPlanSteps] = useState(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planCurrentStep, setPlanCurrentStep] = useState(0);
  const [planRunning, setPlanRunning] = useState(false);

  // Session state (with persistence)
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SESSION_ID) || null;
  });

  // Resizer state
  const [isResizing, setIsResizing] = useState(null);

  // Persist layout state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LEFT_PANEL_WIDTH, leftPanelWidth.toString());
  }, [leftPanelWidth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MIDDLE_PANEL_WIDTH, middlePanelWidth.toString());
  }, [middlePanelWidth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LEFT_PANEL_COLLAPSED, leftPanelCollapsed.toString());
  }, [leftPanelCollapsed]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LEFT_PANEL_TAB, leftPanelTab);
  }, [leftPanelTab]);

  // Persist selected project
  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, selectedProjectId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SELECTED_PROJECT);
    }
  }, [selectedProjectId]);

  // Persist session ID
  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem(STORAGE_KEYS.SESSION_ID, currentSessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
    }
  }, [currentSessionId]);

  // Load global rules
  useEffect(() => {
    loadGlobalRules();
  }, []);

  // Load selected project
  useEffect(() => {
    if (selectedProjectId) {
      loadProject(selectedProjectId);
    } else {
      setSelectedProject(null);
    }
  }, [selectedProjectId]);

  const loadGlobalRules = async () => {
    try {
      const rules = await getGlobalRules();
      setGlobalRules(rules || []);
    } catch (error) {
      console.error('Failed to load global rules:', error);
    }
  };

  const loadProject = async (id) => {
    try {
      const project = await getProject(id);
      setSelectedProject(project);
    } catch (error) {
      console.error('Failed to load project:', error);
    }
  };

  // AI-assisted prompt generation
  const handleAIGenerate = async () => {
    if (!selectedProject || !promptText.trim()) return;
    try {
      setAiGenerating(true);
      setAiError('');
      setGeneratedPrompt('');
      const res = await fetch('/api/llm/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          description: promptText.trim(),
          targetCLI: 'claude',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      setGeneratedPrompt(data.prompt);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiGenerating(false);
    }
  };

  // AI-assisted plan generation
  const handleAIPlan = async () => {
    if (!selectedProject || !promptText.trim()) return;
    try {
      setAiGenerating(true);
      setAiError('');
      setPlanSteps(null);
      const res = await fetch('/api/llm/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          goal: promptText.trim(),
          targetCLI: 'claude',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.raw || 'Plan generation failed');
      setPlanTitle(data.plan.title || 'Plan');
      setPlanSteps(data.plan.steps || []);
      setPlanCurrentStep(0);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiGenerating(false);
    }
  };

  // Execute the current plan step
  const handlePlanExecute = () => {
    if (!planSteps || planCurrentStep >= planSteps.length || !currentSessionId) return;
    const step = planSteps[planCurrentStep];
    sendToTerminal(step.prompt + '\n');
    setPlanCurrentStep(prev => prev + 1);
  };

  // Send to terminal
  const handleSendToTerminal = () => {
    if (!generatedPrompt || !currentSessionId) return;
    sendToTerminal(generatedPrompt + '\n');
  };

  // Copy to clipboard
  const handleCopy = async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle big project launch - sends prompt to terminal
  const handleBigProjectLaunch = useCallback(({ prompt, projectId: bigProjectProjectId, bigProjectId, iterationId, workflowStep }) => {
    if (!prompt) return;

    // If we have a session, send the prompt to terminal
    if (currentSessionId) {
      sendToTerminal(prompt + '\n');
    } else {
      // If no session, copy to clipboard and notify user
      navigator.clipboard.writeText(prompt);
      alert('Prompt copied to clipboard. Please start a terminal session first, then paste the prompt.');
    }
  }, [currentSessionId, sendToTerminal]);

  // Handle panel resize
  const handleMouseMove = useCallback((e) => {
    if (isResizing === 'left') {
      const newWidth = Math.max(180, Math.min(350, e.clientX));
      setLeftPanelWidth(newWidth);
    } else if (isResizing === 'middle') {
      const newWidth = Math.max(280, Math.min(500, e.clientX - leftPanelWidth - 4));
      setMiddlePanelWidth(newWidth);
    }
  }, [isResizing, leftPanelWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const renderLeftPanelContent = () => {
    switch (leftPanelTab) {
      case 'history':
        return (
          <HistoryPanel
            sessionId={currentSessionId}
            projectId={selectedProjectId}
          />
        );
      case 'plans':
        return (
          <PlansPanel
            projectId={selectedProjectId}
            sessionId={currentSessionId}
          />
        );
      case 'files':
        return (
          <FilesPanel
            projectId={selectedProjectId}
            project={selectedProject}
          />
        );
      case 'big-projects':
        return (
          <BigProjectPanel
            projectId={selectedProjectId}
            projectPath={selectedProject?.folderPath}
            cliTool={selectedProject?.cliTool}
            onLaunchTerminal={handleBigProjectLaunch}
          />
        );
      default:
        return (
          <ProjectManagerPanel
            selectedProjectId={selectedProjectId}
            onSelectProject={(id) => setSelectedProjectId(id)}
            onProjectChanged={() => {
              if (selectedProjectId) loadProject(selectedProjectId);
            }}
          />
        );
    }
  };

  return (
    <div className="h-screen flex bg-surface-900 overflow-hidden">
      {/* Left Panel */}
      {!leftPanelCollapsed && (
        <>
          <div
            className="flex flex-col bg-surface-850 border-r border-surface-700"
            style={{ width: leftPanelWidth }}
          >
            {/* Tab Bar */}
            <div className="flex items-center border-b border-surface-700">
              <button
                onClick={() => setLeftPanelTab('projects')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'projects'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Projects</span>
              </button>
              <button
                onClick={() => setLeftPanelTab('history')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'history'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>History</span>
              </button>
              <button
                onClick={() => setLeftPanelTab('plans')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'plans'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <ListTodo className="w-3.5 h-3.5" />
                <span>Plans</span>
              </button>
              <button
                onClick={() => setLeftPanelTab('files')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'files'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                <Files className="w-3.5 h-3.5" />
                <span>Files</span>
              </button>
              <button
                onClick={() => setLeftPanelTab('big-projects')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'big-projects'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
                title="Big Project Planner"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Big</span>
              </button>
              <button
                onClick={() => setLeftPanelCollapsed(true)}
                className="p-2 hover:bg-surface-700 text-surface-400 hover:text-surface-200"
              >
                <PanelLeftClose className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {renderLeftPanelContent()}
            </div>
          </div>

          {/* Left Resizer */}
          <div
            className="w-1 bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
            onMouseDown={() => setIsResizing('left')}
          />
        </>
      )}

      {/* Collapsed sidebar toggle */}
      {leftPanelCollapsed && (
        <div className="flex flex-col items-center py-2 px-1 bg-surface-850 border-r border-surface-700">
          <button
            onClick={() => setLeftPanelCollapsed(false)}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Middle Panel - AI Prompt Maker */}
      <div
        className="flex flex-col bg-surface-800 border-r border-surface-700"
        style={{ width: middlePanelWidth }}
      >
        {/* Header with mode toggle */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-medium text-surface-200">AI Prompt</span>
          </div>
          {selectedProject && (
            <div className="flex items-center bg-surface-850 rounded p-0.5">
              <button
                onClick={() => setPanelMode('prompt')}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  panelMode === 'prompt'
                    ? 'bg-primary-500/20 text-primary-300'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Prompt
              </button>
              <button
                onClick={() => setPanelMode('plan')}
                className={`px-2 py-0.5 text-[11px] rounded transition-colors ${
                  panelMode === 'plan'
                    ? 'bg-primary-500/20 text-primary-300'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                Plan
              </button>
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {selectedProject ? (
            <>
              {/* Selected Project */}
              <div className="p-2 rounded-lg bg-surface-850 border border-surface-700">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary-400" />
                  <span className="text-sm font-medium text-surface-200 truncate">
                    {selectedProject.name}
                  </span>
                </div>
              </div>

              {panelMode === 'prompt' ? (
                <>
                  {/* Describe what you want */}
                  <div>
                    <label className="text-xs font-medium text-surface-400 mb-1.5 block">
                      What do you want to do?
                    </label>
                    <textarea
                      value={promptText}
                      onChange={(e) => setPromptText(e.target.value)}
                      rows={4}
                      className="w-full px-2 py-1.5 text-xs bg-surface-850 border border-surface-700 rounded text-surface-200 focus:ring-1 focus:ring-primary-500 resize-none"
                      placeholder="Describe the task... e.g. 'Add user authentication with JWT tokens' or 'Fix the login form validation bug'"
                    />
                  </div>

                  {/* Generate with AI */}
                  <button
                    onClick={handleAIGenerate}
                    disabled={!promptText.trim() || aiGenerating}
                    className="w-full py-2 text-sm bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-2"
                  >
                    {aiGenerating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        Generate with AI
                      </>
                    )}
                  </button>

                  {aiError && (
                    <p className="text-xs text-danger-400 bg-danger-500/10 rounded p-2">{aiError}</p>
                  )}

                  {/* Generated prompt - editable */}
                  {generatedPrompt && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-surface-400">
                          AI Draft
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-surface-500">
                            {generatedPrompt.length} chars
                          </span>
                          <button
                            onClick={() => setGeneratedPrompt('')}
                            className="p-0.5 hover:bg-surface-700 rounded"
                          >
                            <X className="w-3 h-3 text-surface-500" />
                          </button>
                        </div>
                      </div>

                      <textarea
                        value={generatedPrompt}
                        onChange={(e) => setGeneratedPrompt(e.target.value)}
                        rows={8}
                        className="w-full px-2 py-1.5 text-xs bg-surface-900 border border-surface-700 rounded text-surface-300 focus:ring-1 focus:ring-primary-500 resize-y font-mono"
                      />

                      <div className="flex gap-2">
                        <button
                          onClick={handleCopy}
                          className="flex-1 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-surface-200 rounded transition-colors flex items-center justify-center gap-1.5"
                        >
                          {copied ? (
                            <><Check className="w-3 h-3" /> Copied</>
                          ) : (
                            <><Copy className="w-3 h-3" /> Copy</>
                          )}
                        </button>

                        <button
                          onClick={handleSendToTerminal}
                          disabled={!currentSessionId}
                          className="flex-1 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-1.5"
                          title={!currentSessionId ? 'Start a terminal session first' : 'Send to terminal'}
                        >
                          <Send className="w-3 h-3" />
                          Send to CLI
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                /* ── Plan Mode ── */
                <>
                  {!planSteps ? (
                    <>
                      <div>
                        <label className="text-xs font-medium text-surface-400 mb-1.5 block">
                          What's the big goal?
                        </label>
                        <textarea
                          value={promptText}
                          onChange={(e) => setPromptText(e.target.value)}
                          rows={4}
                          className="w-full px-2 py-1.5 text-xs bg-surface-850 border border-surface-700 rounded text-surface-200 focus:ring-1 focus:ring-primary-500 resize-none"
                          placeholder="Describe the full goal... e.g. 'Build a complete user dashboard with auth, profile page, settings, and role-based access control'"
                        />
                      </div>

                      <button
                        onClick={handleAIPlan}
                        disabled={!promptText.trim() || aiGenerating}
                        className="w-full py-2 text-sm bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-2"
                      >
                        {aiGenerating ? (
                          <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Planning...
                          </>
                        ) : (
                          <>
                            <ListTodo className="w-4 h-4" />
                            Generate Plan
                          </>
                        )}
                      </button>

                      {aiError && (
                        <p className="text-xs text-danger-400 bg-danger-500/10 rounded p-2">{aiError}</p>
                      )}
                    </>
                  ) : (
                    <>
                      {/* Plan header */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-surface-200">
                          {planTitle || 'Plan'}
                        </span>
                        <button
                          onClick={() => { setPlanSteps(null); setPlanTitle(''); setPlanCurrentStep(0); setPlanRunning(false); }}
                          className="text-xs text-surface-400 hover:text-surface-200"
                        >
                          Clear
                        </button>
                      </div>

                      {/* Plan steps */}
                      <div className="space-y-1.5">
                        {planSteps.map((step, i) => {
                          const isCurrent = i === planCurrentStep;
                          const isDone = i < planCurrentStep;
                          const isWaiting = i > planCurrentStep;
                          return (
                            <div
                              key={i}
                              className={`p-2 rounded border text-xs transition-all ${
                                isCurrent
                                  ? 'bg-primary-500/10 border-primary-500/30 text-primary-200'
                                  : isDone
                                    ? 'bg-surface-850 border-surface-700/50 text-surface-500'
                                    : 'bg-surface-850 border-surface-700 text-surface-300'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                                  isDone
                                    ? 'bg-green-500/20 text-green-400'
                                    : isCurrent
                                      ? 'bg-primary-500/20 text-primary-300'
                                      : 'bg-surface-700 text-surface-400'
                                }`}>
                                  {isDone ? <Check className="w-3 h-3" /> : i + 1}
                                </span>
                                <span className={`flex-1 ${isDone ? 'line-through' : ''}`}>
                                  {step.title}
                                </span>
                                {step.requiresApproval && (
                                  <Shield className="w-3 h-3 text-yellow-400 flex-shrink-0" title="Requires approval" />
                                )}
                              </div>
                              {isCurrent && (
                                <div className="mt-2 p-1.5 bg-surface-900 rounded text-[11px] text-surface-400 font-mono max-h-20 overflow-y-auto">
                                  {step.prompt}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Plan controls */}
                      <div className="flex gap-2">
                        {!planRunning ? (
                          <button
                            onClick={handlePlanExecute}
                            disabled={!currentSessionId || planCurrentStep >= planSteps.length}
                            className="flex-1 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-1.5"
                          >
                            <Send className="w-3 h-3" />
                            {planCurrentStep > 0 ? 'Send Next Step' : 'Start Plan'}
                          </button>
                        ) : (
                          <button
                            onClick={() => setPlanRunning(false)}
                            className="flex-1 py-1.5 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors flex items-center justify-center gap-1.5"
                          >
                            Pause
                          </button>
                        )}
                        {planCurrentStep > 0 && planCurrentStep < planSteps.length && (
                          <button
                            onClick={() => setPlanCurrentStep(prev => prev + 1)}
                            className="py-1.5 px-3 text-xs bg-surface-700 hover:bg-surface-600 text-surface-200 rounded transition-colors"
                          >
                            Skip
                          </button>
                        )}
                      </div>

                      {planCurrentStep >= planSteps.length && (
                        <p className="text-xs text-green-400 bg-green-500/10 rounded p-2 text-center">
                          Plan completed!
                        </p>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <FolderOpen className="w-10 h-10 text-surface-600 mb-3" />
              <p className="text-sm text-surface-400">Select a project</p>
              <p className="text-xs text-surface-500 mt-1">
                Choose from the Projects tab
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Middle Resizer */}
      <div
        className="w-1 bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
        onMouseDown={() => setIsResizing('middle')}
      />

      {/* Right Panel - Terminal */}
      <div className="flex-1 flex flex-col min-w-0">
        <Terminal
          projectId={selectedProjectId}
          projects={projects}
          onSessionChange={setCurrentSessionId}
        />
      </div>
    </div>
  );
}
