import { useState, useEffect, useRef } from 'react';
import { useProjects } from '../contexts/ProjectContext';
import { TASK_MODES, getTaskMode } from '../data/taskModes';
import { PRESETS } from '../data/presets';
import { AI_MODELS, getModel, formatPromptForModel } from '../data/models';
import Terminal, { useTerminal } from '../components/Terminal';
import {
  FolderOpen,
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
} from 'lucide-react';

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

  // Layout state
  const [leftPanelWidth, setLeftPanelWidth] = useState(200);
  const [middlePanelWidth, setMiddlePanelWidth] = useState(400);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);

  // Project state
  const [selectedProjectId, setSelectedProjectId] = useState(null);
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

  // Session state
  const [currentSessionId, setCurrentSessionId] = useState(null);

  // Resizer refs
  const leftResizerRef = useRef(null);
  const middleResizerRef = useRef(null);

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

    // Build template text
    const templateText = selectedTaskMode === 'custom'
      ? promptText
      : taskMode.template.replace(/{projectName}/g, selectedProject.name);

    const contextText = selectedTaskMode === 'custom'
      ? promptText
      : promptText
        ? `${templateText}\n\nAdditional Context: ${promptText}`
        : templateText;

    // Gather all rules
    const projectRules = selectedProject.rules || [];
    const activeGlobalRules = includeGlobalRules
      ? globalRules.filter(r => r.enabled !== false).map(r => r.text)
      : [];

    // Get preset rules
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

    // Combine rules
    const allRules = [...new Set([
      ...activeGlobalRules,
      ...presetRules,
      ...projectRules,
      ...(taskMode.additionalRules || []),
    ])];

    // Format rules
    const rulesSection = allRules.length > 0
      ? `Rules:\n${allRules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')}`
      : '';

    // Build sections
    const sectionsContent = {
      projectDetails: `Project: ${selectedProject.name}\nDescription: ${selectedProject.description}`,
      rules: rulesSection,
      context: contextText,
    };

    // Apply model-specific formatting
    let prompt = formatPromptForModel(
      sectionsContent,
      targetModel,
      ['projectDetails', 'rules', 'context']
    );

    // Add checklist if available
    if (taskMode.checklist?.length > 0) {
      prompt += `\n\nBefore completing, verify:\n${taskMode.checklist.map(item => `[ ] ${item}`).join('\n')}`;
    }

    setGeneratedPrompt(prompt);
  };

  // Send to terminal
  const handleSendToTerminal = () => {
    if (!generatedPrompt || !currentSessionId) return;

    // Send the prompt followed by Enter
    sendToTerminal(generatedPrompt + '\n');
  };

  // Copy to clipboard
  const handleCopy = async () => {
    if (!generatedPrompt) return;
    await navigator.clipboard.writeText(generatedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Handle panel resize
  useEffect(() => {
    const handleLeftResize = (e) => {
      if (!leftResizerRef.current?.dragging) return;
      const newWidth = Math.max(150, Math.min(400, e.clientX));
      setLeftPanelWidth(newWidth);
    };

    const handleMiddleResize = (e) => {
      if (!middleResizerRef.current?.dragging) return;
      const newWidth = Math.max(300, Math.min(600, e.clientX - leftPanelWidth - 4));
      setMiddlePanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (leftResizerRef.current) leftResizerRef.current.dragging = false;
      if (middleResizerRef.current) middleResizerRef.current.dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleLeftResize);
    document.addEventListener('mousemove', handleMiddleResize);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleLeftResize);
      document.removeEventListener('mousemove', handleMiddleResize);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [leftPanelWidth]);

  const startLeftResize = () => {
    leftResizerRef.current = { dragging: true };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const startMiddleResize = () => {
    middleResizerRef.current = { dragging: true };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div className="h-screen flex bg-surface-900 overflow-hidden">
      {/* Left Panel - Projects */}
      {!leftPanelCollapsed && (
        <>
          <div
            className="flex flex-col bg-surface-850 border-r border-surface-700"
            style={{ width: leftPanelWidth }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
              <span className="text-sm font-medium text-surface-200">Projects</span>
              <button
                onClick={() => setLeftPanelCollapsed(true)}
                className="p-1 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            {/* Project List */}
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

                  {/* Expanded project details */}
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
                      <div className="flex items-center gap-1.5 text-xs text-surface-500">
                        <MessageSquare className="w-3 h-3" />
                        <span>{project.promptCount || 0} prompts</span>
                      </div>
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

          {/* Left Resizer */}
          <div
            className="w-1 bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
            onMouseDown={startLeftResize}
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
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700">
          <Sparkles className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Prompt Maker</span>
        </div>

        {/* Content */}
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

              {/* Task Mode Selection */}
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

              {/* Context Input */}
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

              {/* Generate Button */}
              <button
                onClick={generatePrompt}
                disabled={!selectedTaskMode}
                className="w-full py-2 text-sm bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Generate Prompt
              </button>

              {/* Generated Prompt */}
              {generatedPrompt && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-surface-400">
                      Generated Prompt
                    </span>
                    <span className="text-xs text-surface-500">
                      {generatedPrompt.length} chars
                    </span>
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
                Choose a project from the left panel
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Middle Resizer */}
      <div
        className="w-1 bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
        onMouseDown={startMiddleResize}
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
