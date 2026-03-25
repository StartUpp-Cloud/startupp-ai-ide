import { useState, useEffect, useRef, useCallback } from 'react';
import { useProjects } from '../contexts/ProjectContext';
import { TASK_MODES, getTaskMode } from '../data/taskModes';
import { PRESETS } from '../data/presets';
import { AI_MODELS, getModel, formatPromptForModel } from '../data/models';
import Terminal, { useTerminal } from '../components/Terminal';
import HistoryPanel from '../components/HistoryPanel';
import PlansPanel from '../components/PlansPanel';
import FilesPanel from '../components/FilesPanel';
import BigProjectPanel from '../components/BigProjectPanel';
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

// Icon mapping for task modes
const TASK_MODE_ICONS = {
  Bug,
  Sparkles,
  RefreshCw,
  Eye,
  Zap,
  Shield,
  TestTube,
  FileText,
  FlaskConical,
  Settings,
};

const getTaskModeIcon = (iconName) => TASK_MODE_ICONS[iconName] || Settings;

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
  const [expandedProjects, setExpandedProjects] = useState({});
  const [globalRules, setGlobalRules] = useState([]);

  // Prompt state
  const [selectedTaskMode, setSelectedTaskMode] = useState('');
  const [promptText, setPromptText] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [targetModel, setTargetModel] = useState('claude');
  const [includeGlobalRules, setIncludeGlobalRules] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Generate prompt
  const generatePrompt = () => {
    if (!selectedProject || !selectedTaskMode) return;

    const taskMode = getTaskMode(selectedTaskMode);
    if (!taskMode) return;

    const templateText = selectedTaskMode === 'custom'
      ? promptText
      : taskMode.template.replace(/{projectName}/g, selectedProject.name);

    const contextText = selectedTaskMode === 'custom'
      ? promptText
      : promptText
        ? `${templateText}\n\nAdditional Context: ${promptText}`
        : templateText;

    const projectRules = selectedProject.rules || [];
    const activeGlobalRules = includeGlobalRules
      ? globalRules.filter(r => r.enabled !== false).map(r => r.text)
      : [];

    const presetRules = [];
    (selectedProject.selectedPresets || []).forEach(presetId => {
      const preset = PRESETS.find(p => p.id === presetId);
      if (preset) {
        preset.rules.forEach(rule => {
          if (!presetRules.includes(rule)) {
            presetRules.push(rule);
          }
        });
      }
    });

    const allRules = [...new Set([
      ...activeGlobalRules,
      ...presetRules,
      ...projectRules,
      ...(taskMode.additionalRules || []),
    ])];

    const rulesSection = allRules.length > 0
      ? `Rules:\n${allRules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`
      : '';

    const sectionsContent = {
      projectDetails: `Project: ${selectedProject.name}\nDescription: ${selectedProject.description}`,
      rules: rulesSection,
      context: contextText,
    };

    let prompt = formatPromptForModel(
      sectionsContent,
      targetModel,
      ['projectDetails', 'rules', 'context']
    );

    if (taskMode.checklist?.length > 0) {
      prompt += `\n\nBefore completing, verify:\n${taskMode.checklist.map(item => `[ ] ${item}`).join('\n')}`;
    }

    setGeneratedPrompt(prompt);
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
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto py-2">
              {projects.map((project) => (
                <div key={project.id}>
                  <button
                    onClick={() => {
                      setSelectedProjectId(project.id);
                      setExpandedProjects(prev => ({
                        ...prev,
                        [project.id]: !prev[project.id],
                      }));
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-750 transition-colors ${
                      selectedProjectId === project.id ? 'bg-primary-500/10 text-primary-300' : 'text-surface-300'
                    }`}
                  >
                    {expandedProjects[project.id] ? (
                      <ChevronDown className="w-3 h-3 text-surface-500" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-surface-500" />
                    )}
                    <FolderOpen className="w-4 h-4 text-surface-400" />
                    <span className="text-sm truncate flex-1">{project.name}</span>
                  </button>

                  {expandedProjects[project.id] && (
                    <div className="pl-8 pr-2 py-1 space-y-1">
                      {project.rules?.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-surface-500">
                          <BookOpen className="w-3 h-3" />
                          <span>{project.rules.length} rules</span>
                        </div>
                      )}
                      {project.selectedPresets?.length > 0 && (
                        <div className="flex items-center gap-1.5 text-xs text-surface-500">
                          <Layers className="w-3 h-3" />
                          <span>{project.selectedPresets.length} presets</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {projects.length === 0 && (
                <div className="px-3 py-4 text-center text-surface-500 text-sm">
                  No projects yet
                </div>
              )}
            </div>
          </div>
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

      {/* Middle Panel - Prompt Maker */}
      <div
        className="flex flex-col bg-surface-800 border-r border-surface-700"
        style={{ width: middlePanelWidth }}
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700">
          <Sparkles className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Prompt Maker</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {selectedProject ? (
            <>
              {/* Selected Project */}
              <div className="p-2 rounded-lg bg-surface-850 border border-surface-700">
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-primary-400" />
                  <span className="text-sm font-medium text-surface-200">
                    {selectedProject.name}
                  </span>
                </div>
                <p className="text-xs text-surface-500 mt-1 line-clamp-2">
                  {selectedProject.description}
                </p>
              </div>

              {/* Task Mode */}
              <div>
                <label className="text-xs font-medium text-surface-400 mb-2 block">
                  Task Mode
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {TASK_MODES.slice(0, 6).map((mode) => {
                    const IconComponent = getTaskModeIcon(mode.icon);
                    const isSelected = selectedTaskMode === mode.id;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => setSelectedTaskMode(mode.id)}
                        className={`flex items-center gap-1.5 p-2 rounded text-left text-xs transition-all ${
                          isSelected
                            ? 'bg-primary-500/15 text-primary-300 border border-primary-500/30'
                            : 'bg-surface-850 text-surface-300 border border-surface-700 hover:border-surface-600'
                        }`}
                      >
                        <IconComponent className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{mode.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Target Model */}
              <div>
                <label className="text-xs font-medium text-surface-400 mb-2 block">
                  Target Model
                </label>
                <select
                  value={targetModel}
                  onChange={(e) => setTargetModel(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs bg-surface-850 border border-surface-700 rounded text-surface-200 focus:ring-1 focus:ring-primary-500"
                >
                  {AI_MODELS.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Context */}
              <div>
                <label className="text-xs font-medium text-surface-400 mb-2 block">
                  Additional Context
                </label>
                <textarea
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  rows={3}
                  className="w-full px-2 py-1.5 text-xs bg-surface-850 border border-surface-700 rounded text-surface-200 focus:ring-1 focus:ring-primary-500 resize-none"
                  placeholder="Add specific details..."
                />
              </div>

              {/* Options */}
              <label className="flex items-center gap-2 text-xs text-surface-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeGlobalRules}
                  onChange={(e) => setIncludeGlobalRules(e.target.checked)}
                  className="accent-primary-500"
                />
                Include global rules
              </label>

              {/* Generate */}
              <button
                onClick={generatePrompt}
                disabled={!selectedTaskMode}
                className="w-full py-2 text-sm bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Generate Prompt
              </button>

              {/* Generated */}
              {generatedPrompt && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-surface-400">
                      Generated
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

                  <div className="p-2 bg-surface-900 rounded border border-surface-700 max-h-40 overflow-y-auto">
                    <pre className="text-xs text-surface-300 whitespace-pre-wrap font-mono">
                      {generatedPrompt}
                    </pre>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleCopy}
                      className="flex-1 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-surface-200 rounded transition-colors flex items-center justify-center gap-1.5"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Copy
                        </>
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
          onSessionChange={setCurrentSessionId}
        />
      </div>
    </div>
  );
}
