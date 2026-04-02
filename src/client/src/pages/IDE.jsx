import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjects } from '../contexts/ProjectContext';
// Task modes, presets, and model formatting removed — now using AI-assisted generation
import Terminal, { useTerminal } from '../components/Terminal';
import HistoryPanel from '../components/HistoryPanel';
import PlansPanel from '../components/PlansPanel';
import FilesPanel from '../components/FilesPanel';
import BigProjectPanel from '../components/BigProjectPanel';
import ActivityFeed from '../components/ActivityFeed';
import SchedulerPanel from '../components/SchedulerPanel';
import QuickCommandsBar from '../components/QuickCommandsBar';
import SkillsPanel from '../components/SkillsPanel';
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
  GitBranch,
  Clock,
  ChevronUp,
  Paperclip,
  Monitor,
} from 'lucide-react';

// Storage keys
const STORAGE_KEYS = {
  SELECTED_PROJECT: 'ide-selected-project',
  SESSION_ID: 'ide-session-id',
  UTIL_SESSION_ID: 'ide-util-session-id',
  LEFT_PANEL_WIDTH: 'ide-left-panel-width',
  MIDDLE_PANEL_WIDTH: 'ide-middle-panel-width',
  LEFT_PANEL_COLLAPSED: 'ide-left-collapsed',
  LEFT_PANEL_TAB: 'ide-left-tab',
};

// Icon mapping removed — AI-assisted generation replaces task modes

export default function IDE() {
  const { projects, getProject, getGlobalRules, notify } = useProjects();
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
  const [attachments, setAttachments] = useState([]); // Array of { id, type, label, content }

  // Git branch state
  const [currentBranch, setCurrentBranch] = useState(null); // { branch, isMainBranch, hasChanges }

  // Plan state
  const [planSteps, setPlanSteps] = useState(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planCurrentStep, setPlanCurrentStep] = useState(0);
  const [planRunning, setPlanRunning] = useState(false);
  const [executionId, setExecutionId] = useState(null);

  // Session state (with persistence)
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SESSION_ID) || null;
  });

  // Utility terminal state
  const [utilTerminalCollapsed, setUtilTerminalCollapsed] = useState(false);
  const [utilSessionId, setUtilSessionId] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.UTIL_SESSION_ID) || null;
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

  // Persist utility session ID
  useEffect(() => {
    if (utilSessionId) {
      localStorage.setItem(STORAGE_KEYS.UTIL_SESSION_ID, utilSessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.UTIL_SESSION_ID);
    }
  }, [utilSessionId]);

  // Load global rules
  useEffect(() => {
    loadGlobalRules();
  }, []);

  // Load git branch info for current project
  useEffect(() => {
    if (!selectedProject?.folderPath) {
      setCurrentBranch(null);
      return;
    }
    const fetchBranch = () => {
      fetch(`/api/orchestrator/git-info?projectPath=${encodeURIComponent(selectedProject.folderPath)}`)
        .then(r => r.json())
        .then(data => {
          if (data.isGitRepo) setCurrentBranch(data);
          else setCurrentBranch(null);
        })
        .catch(() => setCurrentBranch(null));
    };
    fetchBranch();
    const interval = setInterval(fetchBranch, 15000); // Refresh every 15s
    return () => clearInterval(interval);
  }, [selectedProject?.folderPath]);

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

      // Build description with attachments
      let fullDescription = promptText.trim();
      if (attachments.length > 0) {
        fullDescription += '\n\n--- Attached Context ---';
        for (const att of attachments) {
          fullDescription += `\n\n### ${att.label} (${att.type})\n${att.content}`;
        }
      }

      const res = await fetch('/api/llm/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          description: fullDescription,
          targetCLI: 'claude',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      if (!data.prompt?.trim()) throw new Error('LLM returned an empty prompt. Try rephrasing or check your model.');
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
      setPlanTitle('');
      setPlanCurrentStep(0);
      setPlanRunning(false);

      // Build goal with attachments
      let fullGoal = promptText.trim();
      if (attachments.length > 0) {
        fullGoal += '\n\n--- Attached Context ---';
        for (const att of attachments) {
          fullGoal += `\n\n### ${att.label} (${att.type})\n${att.content}`;
        }
      }

      const res = await fetch('/api/llm/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          goal: fullGoal,
          targetCLI: 'claude',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.raw || 'Plan generation failed');
      if (!data.plan?.steps?.length) throw new Error('LLM returned an empty plan. Try rephrasing your goal.');
      setPlanTitle(data.plan.title || 'Plan');
      setPlanSteps(data.plan.steps);
      setPlanCurrentStep(0);
      notify(`Plan ready: ${data.plan.steps.length} steps`);
    } catch (err) {
      setAiError(err.message);
    } finally {
      setAiGenerating(false);
    }
  };

  // Git branch state for pre-execution choice
  const [gitInfo, setGitInfo] = useState(null); // null | { isGitRepo, branch, isMainBranch, hasChanges }
  const [showBranchChoice, setShowBranchChoice] = useState(false);

  // Start autonomous execution — first check git state
  const handleStartAutonomous = async () => {
    if (!planSteps || !currentSessionId || !selectedProject) return;

    const projectPath = selectedProject.folderPath;
    if (projectPath) {
      try {
        const res = await fetch(`/api/orchestrator/git-info?projectPath=${encodeURIComponent(projectPath)}`);
        const info = await res.json();
        setGitInfo(info);
        if (info.isGitRepo) {
          // Show branch choice dialog
          setShowBranchChoice(true);
          return;
        }
      } catch { /* not a git repo or path issue — proceed without git */ }
    }

    // No git repo — start directly
    startExecution('current-branch');
  };

  const startExecution = (gitStrategy) => {
    setShowBranchChoice(false);
    fetch('/api/orchestrator/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        projectId: selectedProjectId,
        projectPath: selectedProject.folderPath || null,
        steps: planSteps,
        planTitle: planTitle,
        cliTool: 'claude',
        config: { autoCommit: true, runTests: false, maxRetries: 1, gitStrategy },
      }),
    }).then(res => res.json()).then(data => {
      if (data.executionId) {
        setExecutionId(data.executionId);
        setPlanRunning(true);
        notify('Autonomous execution started');
      } else if (data.error) {
        notify(data.error, 'error');
      }
    }).catch(err => notify(err.message, 'error'));
  };

  const handlePlanControl = (action) => {
    if (!executionId) return;
    fetch(`/api/orchestrator/${action}/${executionId}`, { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        if (action === 'stop') { setPlanRunning(false); }
        if (action === 'pause') { setPlanRunning(false); }
        if (action === 'resume') { setPlanRunning(true); }
      })
      .catch(err => notify(err.message, 'error'));
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

  // Add a context attachment
  const addAttachment = (type, label, content) => {
    setAttachments(prev => [...prev, { id: Date.now(), type, label, content: content.slice(0, 10000) }]);
  };

  const removeAttachment = (id) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  // Handle file attachment
  const handleFileAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      addAttachment('file', file.name, text);
    } catch {
      notify('Could not read file', 'error');
    }
  };

  // Capture terminal output as attachment
  const handleCaptureTerminal = () => {
    const output = window._getTerminalOutput?.();
    if (output) {
      addAttachment('terminal', 'Terminal output', output.slice(-3000));
      notify('Terminal output captured');
    } else {
      notify('No terminal output to capture', 'error');
    }
  };

  // Capture git diff as attachment
  const handleCaptureDiff = async () => {
    if (!selectedProject?.folderPath) return;
    try {
      const res = await fetch('/api/prompt-from-file/from-git-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: selectedProject.folderPath, projectId: selectedProjectId }),
      });
      const data = await res.json();
      if (data.prompt) {
        addAttachment('diff', 'Git diff', data.sourceContent || 'Diff captured');
      }
    } catch {
      notify('Could not capture git diff', 'error');
    }
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

  // Wire terminal error capture to prompt panel
  useEffect(() => {
    window._onCaptureTerminalOutput = (output) => {
      addAttachment('error', 'Terminal error', output);
      setPanelMode('prompt');
      setPromptText(prev => prev || 'Fix the error shown in the terminal output');
    };
    return () => { window._onCaptureTerminalOutput = null; };
  }, []);

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
      case 'activity':
        return (
          <ActivityFeed projectId={selectedProjectId} />
        );
      case 'scheduler':
        return (
          <SchedulerPanel
            projectId={selectedProjectId}
            projectPath={selectedProject?.folderPath}
          />
        );
      case 'skills':
        return (
          <SkillsPanel projectId={selectedProjectId} />
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
    <div className="h-screen flex flex-col bg-surface-900 overflow-hidden">
      {/* ── Top Status Bar ── */}
      <div className="flex items-center justify-between px-3 py-1 bg-surface-850 border-b border-surface-700 flex-shrink-0">
        <div className="flex items-center gap-3">
          {/* Brand */}
          <span className="text-[11px] font-semibold text-surface-400 tracking-wide uppercase">StartUpp AI IDE</span>

          {/* Project name */}
          {selectedProject && (
            <>
              <span className="text-surface-600">/</span>
              <span className="text-[11px] font-medium text-surface-200">{selectedProject.name}</span>
            </>
          )}

          {/* Git branch */}
          {currentBranch && (
            <>
              <span className="text-surface-600">/</span>
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium ${
                currentBranch.isMainBranch
                  ? 'bg-yellow-500/15 text-yellow-300 border border-yellow-500/25'
                  : 'bg-green-500/15 text-green-300 border border-green-500/25'
              }`}>
                <GitBranch className="w-3 h-3" />
                <span>{currentBranch.branch}</span>
                {currentBranch.hasChanges && (
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" title="Uncommitted changes" />
                )}
              </div>
            </>
          )}
        </div>

        {/* Right side: kill switch when running */}
        {executionId && planRunning && (
          <button
            onClick={() => {
              fetch(`/api/orchestrator/kill/${executionId}`, { method: 'POST' });
              setPlanRunning(false);
              setExecutionId(null);
              notify('Execution killed', 'error');
            }}
            className="flex items-center gap-1.5 px-3 py-0.5 text-[11px] bg-red-600 hover:bg-red-500 text-white rounded font-medium transition-colors"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-red-300 animate-pulse" />
            KILL SWITCH
          </button>
        )}
      </div>

      {/* ── Main IDE Layout ── */}
      <div className="flex-1 flex overflow-hidden">

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
                onClick={() => setLeftPanelTab('activity')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'activity'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
                title="Activity Feed"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Activity</span>
              </button>
              <button
                onClick={() => setLeftPanelTab('scheduler')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'scheduler'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
                title="Scheduled Tasks"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Cron</span>
              </button>
              <button
                onClick={() => setLeftPanelTab('skills')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs transition-colors ${
                  leftPanelTab === 'skills'
                    ? 'text-primary-400 bg-primary-500/10 border-b-2 border-primary-500'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
                title="Skills"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Skills</span>
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

      {/* Middle Panel - AI Prompt */}
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

                  {/* Context Attachments */}
                  <div className="space-y-2">
                    {/* Attachment buttons */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <label className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-850 border border-surface-700 rounded cursor-pointer hover:border-surface-600 text-surface-400 hover:text-surface-200 transition-colors">
                        <Paperclip className="w-3 h-3" />
                        <span>File</span>
                        <input type="file" onChange={handleFileAttach} className="hidden" accept=".txt,.md,.js,.ts,.jsx,.tsx,.py,.json,.yaml,.yml,.html,.css,.sql,.sh,.csv,.go,.rs" />
                      </label>
                      <button
                        onClick={handleCaptureTerminal}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-850 border border-surface-700 rounded hover:border-surface-600 text-surface-400 hover:text-surface-200 transition-colors"
                      >
                        <Monitor className="w-3 h-3" />
                        <span>Terminal</span>
                      </button>
                      {selectedProject?.folderPath && (
                        <button
                          onClick={handleCaptureDiff}
                          className="flex items-center gap-1 px-2 py-1 text-[11px] bg-surface-850 border border-surface-700 rounded hover:border-surface-600 text-surface-400 hover:text-surface-200 transition-colors"
                        >
                          <GitBranch className="w-3 h-3" />
                          <span>Git Diff</span>
                        </button>
                      )}
                    </div>

                    {/* Attached items */}
                    {attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {attachments.map(att => (
                          <div key={att.id} className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] bg-primary-500/10 text-primary-300 border border-primary-500/20 rounded">
                            <span className="truncate max-w-24">{att.label}</span>
                            <button onClick={() => removeAttachment(att.id)} className="hover:text-white">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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
                        {!planRunning && !executionId ? (
                          <>
                            <button
                              onClick={handleStartAutonomous}
                              disabled={!currentSessionId || planCurrentStep >= planSteps.length}
                              className="flex-1 py-1.5 text-xs bg-green-600 hover:bg-green-700 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-1.5"
                            >
                              <Send className="w-3 h-3" />
                              Run Autonomously
                            </button>
                            <button
                              onClick={() => {
                                if (!planSteps || planCurrentStep >= planSteps.length || !currentSessionId) return;
                                sendToTerminal(planSteps[planCurrentStep].prompt + '\n');
                                setPlanCurrentStep(prev => prev + 1);
                              }}
                              disabled={!currentSessionId || planCurrentStep >= planSteps.length}
                              className="py-1.5 px-3 text-xs bg-surface-700 hover:bg-surface-600 text-surface-200 rounded transition-colors"
                            >
                              Manual
                            </button>
                          </>
                        ) : planRunning ? (
                          <>
                            <button
                              onClick={() => handlePlanControl('pause')}
                              className="flex-1 py-1.5 text-xs bg-yellow-600 hover:bg-yellow-700 text-white rounded transition-colors flex items-center justify-center gap-1.5"
                            >
                              Pause
                            </button>
                            <button
                              onClick={() => handlePlanControl('stop')}
                              className="py-1.5 px-3 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                            >
                              Stop
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handlePlanControl('resume')}
                              className="flex-1 py-1.5 text-xs bg-green-600 hover:bg-green-700 text-white rounded transition-colors flex items-center justify-center gap-1.5"
                            >
                              Resume
                            </button>
                            <button
                              onClick={() => handlePlanControl('stop')}
                              className="py-1.5 px-3 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                            >
                              Stop
                            </button>
                            <button
                              onClick={() => handlePlanControl('skip')}
                              className="py-1.5 px-3 text-xs bg-surface-700 hover:bg-surface-600 text-surface-200 rounded transition-colors"
                            >
                              Skip
                            </button>
                          </>
                        )}
                      </div>

                      {/* Branch choice dialog */}
                      {showBranchChoice && gitInfo && (
                        <div className="p-2.5 bg-surface-850 border border-surface-700 rounded-lg space-y-2">
                          <div className="flex items-center gap-2">
                            <GitBranch className="w-3.5 h-3.5 text-primary-400" />
                            <span className="text-xs font-medium text-surface-200">
                              On branch: <code className="text-primary-300">{gitInfo.branch}</code>
                            </span>
                          </div>
                          {gitInfo.hasChanges && (
                            <p className="text-[10px] text-yellow-400">Has uncommitted changes</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => startExecution('current-branch')}
                              className="flex-1 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 text-white rounded transition-colors"
                            >
                              Continue on {gitInfo.branch}
                            </button>
                            <button
                              onClick={() => startExecution('new-branch')}
                              className="flex-1 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-surface-200 rounded transition-colors"
                            >
                              New branch
                            </button>
                          </div>
                          <button
                            onClick={() => setShowBranchChoice(false)}
                            className="w-full text-[10px] text-surface-500 hover:text-surface-300"
                          >
                            Cancel
                          </button>
                        </div>
                      )}

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

      {/* Right Panel - Terminals */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Main Terminal (AI Agent) */}
        <div className="flex-1 flex flex-col min-h-0" style={{ flex: utilTerminalCollapsed ? 1 : 0.65 }}>
          <Terminal
            projectId={selectedProjectId}
            projects={projects}
            onSessionChange={setCurrentSessionId}
            initialSessionId={currentSessionId}
          />
        </div>

        {/* Utility Terminal Divider */}
        <div className="flex items-center bg-surface-800 border-y border-surface-700 px-2">
          <button
            onClick={() => setUtilTerminalCollapsed(prev => !prev)}
            className="flex items-center gap-1.5 py-0.5 text-[11px] text-surface-400 hover:text-surface-200"
          >
            {utilTerminalCollapsed ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            <span>&gt;_ Utility Shell</span>
          </button>
        </div>

        {/* Utility Terminal (manual commands) */}
        {!utilTerminalCollapsed && (
          <div className="flex flex-col min-h-0" style={{ flex: 0.35 }}>
            <QuickCommandsBar
              projectId={selectedProjectId}
              sessionId={utilSessionId}
            />
            <Terminal
              projectId={selectedProjectId}
              projects={projects}
              onSessionChange={setUtilSessionId}
              initialSessionId={utilSessionId}
              isUtility={true}
            />
          </div>
        )}
      </div>
      </div>{/* close flex-1 flex overflow-hidden */}
    </div>
  );
}
