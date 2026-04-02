import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Send,
  ListTodo,
  Paperclip,
  X,
  ChevronDown,
  ChevronUp,
  GitBranch,
  FolderOpen,
  Upload,
  Monitor,
  Play,
  Pause,
  Square,
  SkipForward,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

export default function TopBar({
  selectedProject,
  selectedProjectId,
  currentBranch,
  currentSessionId,
  // Plan execution state
  executionId,
  planRunning,
  planSteps,
  planTitle,
  planCurrentStep,
  // Callbacks
  onSendRaw,
  onOptimizeAndSend,
  onGeneratePlan,
  onStartAutonomous,
  onPlanControl,
  onKill,
  notify,
}) {
  // Internal state
  const [promptText, setPromptText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [planMode, setPlanMode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showPlanDropdown, setShowPlanDropdown] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const inputRef = useRef(null);
  const textareaRef = useRef(null);
  const attachMenuRef = useRef(null);
  const planDropdownRef = useRef(null);
  const fileInputRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) {
        setShowAttachMenu(false);
      }
      if (planDropdownRef.current && !planDropdownRef.current.contains(e.target)) {
        setShowPlanDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus textarea when expanding
  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [expanded]);

  // Show plan dropdown automatically when steps arrive
  useEffect(() => {
    if (planSteps?.length > 0) {
      setShowPlanDropdown(true);
    }
  }, [planSteps]);

  // Build full description with attachments appended
  const buildFullText = useCallback((text) => {
    let full = text.trim();
    if (attachments.length > 0) {
      full += '\n\n--- Attached Context ---';
      for (const att of attachments) {
        full += `\n\n### ${att.label} (${att.type})\n${att.content}`;
      }
    }
    return full;
  }, [attachments]);

  // ── Send Raw ──────────────────────────────────────────────────────────
  const handleSendRaw = () => {
    if (!promptText.trim() || !currentSessionId) return;
    onSendRaw?.(promptText.trim());
    setPromptText('');
    setExpanded(false);
    setAttachments([]);
  };

  // ── AI Send (Optimize & Send) ─────────────────────────────────────────
  const handleAISend = async () => {
    if (!promptText.trim() || !selectedProjectId) return;

    setGenerating(true);
    try {
      const fullDescription = buildFullText(promptText);

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

      if (!res.ok) {
        // LLM not enabled or other server error — fall back to raw send
        if (res.status === 400 || res.status === 503) {
          notify?.('LLM not available — sending raw prompt', 'warning');
          onSendRaw?.(promptText.trim());
        } else {
          throw new Error(data.error || 'Generation failed');
        }
      } else if (!data.prompt?.trim()) {
        notify?.('LLM returned empty result — sending raw prompt', 'warning');
        onSendRaw?.(promptText.trim());
      } else {
        onSendRaw?.(data.prompt);
      }

      setPromptText('');
      setExpanded(false);
      setAttachments([]);
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  // ── Generate Plan ─────────────────────────────────────────────────────
  const handleGeneratePlan = async () => {
    if (!promptText.trim() || !selectedProjectId) return;

    setGenerating(true);
    try {
      const fullGoal = buildFullText(promptText);

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

      if (!res.ok) {
        throw new Error(data.error || data.raw || 'Plan generation failed');
      }
      if (!data.plan?.steps?.length) {
        throw new Error('LLM returned an empty plan. Try rephrasing your goal.');
      }

      onGeneratePlan?.(data.plan);
      notify?.(`Plan ready: ${data.plan.steps.length} steps`);
      setPromptText('');
      setExpanded(false);
      setAttachments([]);
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  // ── Attachments ───────────────────────────────────────────────────────
  const addAttachment = (type, label, content) => {
    setAttachments((prev) => [
      ...prev,
      { id: Date.now(), type, label, content: content.slice(0, 10000) },
    ]);
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleFileAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      addAttachment('file', file.name, text);
      setShowAttachMenu(false);
    } catch {
      notify?.('Could not read file', 'error');
    }
  };

  const handleCaptureTerminal = () => {
    const output = window._getTerminalOutput?.();
    if (output) {
      addAttachment('terminal', 'Terminal output', output.slice(-3000));
      notify?.('Terminal output captured');
    } else {
      notify?.('No terminal output to capture', 'error');
    }
    setShowAttachMenu(false);
  };

  const handleCaptureDiff = async () => {
    if (!selectedProject?.folderPath) {
      notify?.('No project folder selected', 'error');
      setShowAttachMenu(false);
      return;
    }
    try {
      const res = await fetch('/api/prompt-from-file/from-git-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectPath: selectedProject.folderPath,
          projectId: selectedProjectId,
        }),
      });
      const data = await res.json();
      if (data.prompt) {
        addAttachment('diff', 'Git diff', data.sourceContent || 'Diff captured');
        notify?.('Git diff captured');
      } else {
        notify?.('No diff available', 'warning');
      }
    } catch {
      notify?.('Could not capture git diff', 'error');
    }
    setShowAttachMenu(false);
  };

  // ── Input key handling ────────────────────────────────────────────────
  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (planMode) {
        handleGeneratePlan();
      } else {
        handleSendRaw();
      }
    }
    if (e.key === 'Escape') {
      setExpanded(false);
    }
  };

  const handleTextareaKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (planMode) {
        handleGeneratePlan();
      } else {
        handleSendRaw();
      }
    }
    if (e.key === 'Escape') {
      setExpanded(false);
    }
  };

  // Check if input should auto-expand
  const handleInputChange = (e) => {
    const val = e.target.value;
    setPromptText(val);
    if (val.includes('\n')) {
      setExpanded(true);
    }
  };

  const handleTextareaChange = (e) => {
    setPromptText(e.target.value);
  };

  // Determine computed states
  const hasInput = promptText.trim().length > 0;
  const hasSession = !!currentSessionId;
  const showKill = !!(executionId && planRunning);
  const completedSteps = planSteps
    ? planSteps.filter((_, i) => i < (planCurrentStep || 0)).length
    : 0;
  const totalSteps = planSteps?.length || 0;

  return (
    <div className="relative flex-shrink-0">
      {/* ── Main bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center h-[44px] bg-surface-850 border-b border-surface-700 px-2 gap-2">

        {/* Logo + Project + Branch info */}
        <div className="flex items-center gap-2 flex-shrink-0 min-w-0">
          {/* Logo */}
          <div className="w-6 h-6 rounded-md bg-primary-500 flex items-center justify-center flex-shrink-0">
            <span className="text-surface-950 font-display font-bold text-[10px]">P</span>
          </div>

          <span className="text-[12px] font-medium text-surface-300 tracking-tight whitespace-nowrap hidden sm:inline">
            STARTUPP AI IDE
          </span>

          {selectedProject && (
            <>
              <span className="text-surface-600 text-[12px]">/</span>
              <span className="text-[12px] text-surface-200 font-medium truncate max-w-[120px]">
                {selectedProject.name}
              </span>
            </>
          )}

          {currentBranch && (
            <>
              <span className="text-surface-600 text-[12px]">/</span>
              <div className="flex items-center gap-1 text-[11px] text-surface-400 flex-shrink-0">
                <GitBranch className="w-3 h-3" />
                <span className="truncate max-w-[80px]">{currentBranch.branch}</span>
                {currentBranch.hasChanges && (
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" />
                )}
              </div>
            </>
          )}

          {/* Plan progress inline */}
          {planRunning && totalSteps > 0 && (
            <div className="flex items-center gap-1.5 ml-1 flex-shrink-0">
              <div className="w-16 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 transition-all duration-300"
                  style={{ width: `${Math.round((completedSteps / totalSteps) * 100)}%` }}
                />
              </div>
              <span className="text-[10px] text-surface-400">
                {completedSteps}/{totalSteps}
              </span>
            </div>
          )}
        </div>

        {/* Separator */}
        <div className="w-px h-5 bg-surface-700 flex-shrink-0" />

        {/* ── Attachments button + chips ────────────────────────────── */}
        <div className="relative flex-shrink-0" ref={attachMenuRef}>
          <button
            onClick={() => setShowAttachMenu(!showAttachMenu)}
            className="p-1.5 rounded hover:bg-surface-750 text-surface-400 hover:text-surface-200 transition-colors"
            title="Attach context"
          >
            <Paperclip className="w-3.5 h-3.5" />
          </button>

          {/* Attach dropdown */}
          {showAttachMenu && (
            <div className="absolute top-full left-0 mt-1 w-44 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-50 py-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-surface-300 hover:bg-surface-750 transition-colors"
              >
                <Upload className="w-3.5 h-3.5 text-surface-400" />
                File
              </button>
              <button
                onClick={handleCaptureTerminal}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-surface-300 hover:bg-surface-750 transition-colors"
              >
                <Monitor className="w-3.5 h-3.5 text-surface-400" />
                Terminal Output
              </button>
              <button
                onClick={handleCaptureDiff}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-surface-300 hover:bg-surface-750 transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5 text-surface-400" />
                Git Diff
              </button>
            </div>
          )}

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileAttach}
          />
        </div>

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0 overflow-x-auto max-w-[180px]">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-750 border border-surface-700 rounded text-[10px] text-surface-300 whitespace-nowrap"
              >
                <span className="truncate max-w-[60px]">{att.label}</span>
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="text-surface-500 hover:text-surface-200 transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Prompt input ─────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 relative">
          <input
            ref={inputRef}
            type="text"
            value={promptText}
            onChange={handleInputChange}
            onKeyDown={handleInputKeyDown}
            onFocus={() => {
              if (promptText.includes('\n')) setExpanded(true);
            }}
            placeholder={
              !hasSession
                ? 'Start a terminal session first...'
                : planMode
                ? 'Describe your goal for the plan...'
                : 'Type a prompt to send...'
            }
            disabled={!hasSession}
            className="w-full h-7 px-2.5 text-[13px] bg-surface-800 border border-surface-700 rounded-md text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors outline-none"
          />
          {/* Expand toggle */}
          {hasInput && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-surface-500 hover:text-surface-300 transition-colors"
              title={expanded ? 'Collapse' : 'Expand to multiline'}
            >
              {expanded ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
            </button>
          )}
        </div>

        {/* ── Action buttons ───────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Send Raw */}
          <button
            onClick={handleSendRaw}
            disabled={!hasInput || !hasSession}
            className="flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-surface-700 hover:bg-surface-650 text-surface-300 hover:text-surface-100 rounded-full border border-surface-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Send raw text to terminal"
          >
            <Send className="w-3 h-3" />
            <span className="hidden lg:inline">Send Raw</span>
          </button>

          {/* AI Send / Generate Plan */}
          {planMode ? (
            <button
              onClick={handleGeneratePlan}
              disabled={!hasInput || !selectedProjectId || generating}
              className="flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-primary-500 hover:bg-primary-600 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Generate an execution plan from your goal"
            >
              {generating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ListTodo className="w-3 h-3" />
              )}
              <span className="hidden lg:inline">
                {generating ? 'Generating...' : 'Generate Plan'}
              </span>
            </button>
          ) : (
            <button
              onClick={handleAISend}
              disabled={!hasInput || !selectedProjectId || generating}
              className="flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-green-600 hover:bg-green-700 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Optimize prompt with AI, then send to terminal"
            >
              {generating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              <span className="hidden lg:inline">
                {generating ? 'Optimizing...' : 'AI Send'}
              </span>
            </button>
          )}

          {/* Plan mode toggle */}
          <div className="relative" ref={planDropdownRef}>
            <button
              onClick={() => {
                if (planSteps?.length > 0) {
                  setShowPlanDropdown(!showPlanDropdown);
                } else {
                  setPlanMode(!planMode);
                }
              }}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-full border transition-colors ${
                planMode || planSteps?.length
                  ? 'bg-primary-500/20 text-primary-400 border-primary-500/40'
                  : 'bg-surface-750 text-surface-400 border-surface-600 hover:text-surface-200 hover:bg-surface-700'
              }`}
              title={planSteps?.length ? 'Show plan steps' : 'Toggle plan mode'}
            >
              <ListTodo className="w-3 h-3" />
              <span>Plan</span>
              {planSteps?.length > 0 && <ChevronDown className="w-3 h-3" />}
            </button>

            {/* ── Plan steps dropdown ─────────────────────────────── */}
            {showPlanDropdown && planSteps?.length > 0 && (
              <div className="absolute top-full right-0 mt-1 w-80 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-50 overflow-hidden">
                {/* Plan header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
                  <div className="flex items-center gap-2 min-w-0">
                    <ListTodo className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
                    <span className="text-[12px] font-medium text-surface-200 truncate">
                      {planTitle || 'Execution Plan'}
                    </span>
                    <span className="text-[10px] text-surface-500 flex-shrink-0">
                      {totalSteps} steps
                    </span>
                  </div>
                  <button
                    onClick={() => setShowPlanDropdown(false)}
                    className="p-1 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>

                {/* Steps list */}
                <div className="max-h-64 overflow-y-auto">
                  {planSteps.map((step, idx) => {
                    const isComplete = idx < (planCurrentStep || 0);
                    const isCurrent = idx === (planCurrentStep || 0) && planRunning;
                    return (
                      <div
                        key={idx}
                        className={`flex items-start gap-2 px-3 py-2 border-b border-surface-700/50 ${
                          isCurrent
                            ? 'bg-primary-500/10'
                            : isComplete
                            ? 'bg-green-500/5'
                            : ''
                        }`}
                      >
                        <span
                          className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-medium flex-shrink-0 mt-0.5 ${
                            isComplete
                              ? 'bg-green-500/20 text-green-400'
                              : isCurrent
                              ? 'bg-primary-500/20 text-primary-400'
                              : 'bg-surface-700 text-surface-400'
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[12px] font-medium ${
                            isComplete
                              ? 'text-surface-500 line-through'
                              : isCurrent
                              ? 'text-primary-300'
                              : 'text-surface-300'
                          }`}>
                            {step.title || step.name || `Step ${idx + 1}`}
                          </div>
                          {step.prompt && (
                            <div className="text-[10px] text-surface-500 mt-0.5 truncate">
                              {step.prompt.slice(0, 80)}
                              {step.prompt.length > 80 ? '...' : ''}
                            </div>
                          )}
                        </div>
                        {isCurrent && (
                          <Loader2 className="w-3 h-3 text-primary-400 animate-spin flex-shrink-0 mt-1" />
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Plan controls */}
                <div className="flex items-center gap-2 px-3 py-2 border-t border-surface-700 bg-surface-850">
                  {!planRunning ? (
                    <button
                      onClick={() => {
                        onStartAutonomous?.();
                        setShowPlanDropdown(false);
                      }}
                      disabled={!hasSession}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      Run Autonomously
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => onPlanControl?.('pause')}
                        className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 rounded-md transition-colors"
                        title="Pause execution"
                      >
                        <Pause className="w-3 h-3" />
                        Pause
                      </button>
                      <button
                        onClick={() => onPlanControl?.('stop')}
                        className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-md transition-colors"
                        title="Stop execution"
                      >
                        <Square className="w-3 h-3" />
                        Stop
                      </button>
                      <button
                        onClick={() => onPlanControl?.('skip')}
                        className="flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium bg-surface-700 text-surface-300 hover:bg-surface-650 rounded-md transition-colors"
                        title="Skip current step"
                      >
                        <SkipForward className="w-3 h-3" />
                        Skip
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Separator before kill */}
          {showKill && <div className="w-px h-5 bg-surface-700 flex-shrink-0" />}

          {/* Kill switch */}
          {showKill && (
            <button
              onClick={onKill}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors animate-pulse"
              title="Kill autonomous execution"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-100" />
              </span>
              <span>KILL</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Expanded textarea overlay ──────────────────────────────────── */}
      {expanded && (
        <div className="absolute top-[44px] left-0 right-0 z-40">
          <div className="mx-2 bg-surface-800 border border-surface-700 border-t-0 rounded-b-lg shadow-xl overflow-hidden">
            <textarea
              ref={textareaRef}
              value={promptText}
              onChange={handleTextareaChange}
              onKeyDown={handleTextareaKeyDown}
              rows={5}
              placeholder={
                planMode
                  ? 'Describe your goal in detail...\nShift+Enter for newline, Enter to send'
                  : 'Type your prompt...\nShift+Enter for newline, Enter to send'
              }
              className="w-full px-3 py-2 text-[13px] bg-transparent text-surface-200 placeholder-surface-500 resize-none outline-none"
            />
            <div className="flex items-center justify-between px-3 py-1.5 border-t border-surface-700/50 bg-surface-850/50">
              <span className="text-[10px] text-surface-500">
                Enter to send {'\u00B7'} Shift+Enter for newline {'\u00B7'} Esc to collapse
              </span>
              <button
                onClick={() => setExpanded(false)}
                className="text-[10px] text-surface-400 hover:text-surface-200 transition-colors"
              >
                Collapse
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
