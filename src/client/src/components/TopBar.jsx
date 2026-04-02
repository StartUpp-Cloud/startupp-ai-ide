import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Send,
  ListTodo,
  Paperclip,
  X,
  ChevronDown,
  GitBranch,
  Upload,
  Monitor,
  Play,
  Pause,
  Square,
  SkipForward,
  Loader2,
} from 'lucide-react';

export default function TopBar({
  selectedProject,
  selectedProjectId,
  currentBranch,
  currentSessionId,
  executionId,
  planRunning,
  planSteps,
  planTitle,
  planCurrentStep,
  onSendRaw,
  onOptimizeAndSend,
  onGeneratePlan,
  onStartAutonomous,
  onPlanControl,
  onKill,
  notify,
  notificationSlot,
}) {
  const [promptText, setPromptText] = useState('');
  const [planMode, setPlanMode] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showPlanDropdown, setShowPlanDropdown] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const textareaRef = useRef(null);
  const attachMenuRef = useRef(null);
  const planDropdownRef = useRef(null);
  const fileInputRef = useRef(null);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target)) setShowAttachMenu(false);
      if (planDropdownRef.current && !planDropdownRef.current.contains(e.target)) setShowPlanDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Show plan dropdown when steps arrive
  useEffect(() => {
    if (planSteps?.length > 0) setShowPlanDropdown(true);
  }, [planSteps]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '0';
    const scrollH = el.scrollHeight;
    // Min 28px (single line), max 160px (~6 lines)
    el.style.height = Math.min(Math.max(scrollH, 28), 160) + 'px';
  }, [promptText]);

  // ── Helpers ──

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

  const clearInput = () => {
    setPromptText('');
    setAttachments([]);
  };

  const hasInput = promptText.trim().length > 0;
  const hasSession = !!currentSessionId;
  const showKill = !!(executionId && planRunning);
  const completedSteps = planSteps ? planSteps.filter((_, i) => i < (planCurrentStep || 0)).length : 0;
  const totalSteps = planSteps?.length || 0;

  // ── Actions ──

  const handleSendRaw = () => {
    if (!hasInput || !hasSession) return;
    onSendRaw?.(promptText.trim());
    clearInput();
  };

  const handleAISend = async () => {
    if (!hasInput || !selectedProjectId) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/llm/generate-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId, description: buildFullText(promptText), targetCLI: 'claude' }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify?.('LLM not available — sending raw', 'error');
        onSendRaw?.(promptText.trim());
      } else if (!data.prompt?.trim()) {
        notify?.('LLM returned empty — sending raw', 'error');
        onSendRaw?.(promptText.trim());
      } else {
        onSendRaw?.(data.prompt);
      }
      clearInput();
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (!hasInput || !selectedProjectId) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/llm/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProjectId, goal: buildFullText(promptText), targetCLI: 'claude' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Plan generation failed');
      if (!data.plan?.steps?.length) throw new Error('Empty plan. Try rephrasing.');
      onGeneratePlan?.(data.plan);
      clearInput();
    } catch (err) {
      notify?.(err.message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  // ── Attachments ──

  const addAttachment = (type, label, content) => {
    setAttachments(prev => [...prev, { id: Date.now(), type, label, content: content.slice(0, 10000) }]);
  };
  const removeAttachment = (id) => setAttachments(prev => prev.filter(a => a.id !== id));

  const handleFileAttach = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try { addAttachment('file', file.name, await file.text()); }
    catch { notify?.('Could not read file', 'error'); }
    setShowAttachMenu(false);
  };

  const handleCaptureTerminal = () => {
    const output = window._getTerminalOutput?.();
    if (output) { addAttachment('terminal', 'Terminal', output.slice(-3000)); notify?.('Captured'); }
    else { notify?.('No output', 'error'); }
    setShowAttachMenu(false);
  };

  const handleCaptureDiff = async () => {
    if (!selectedProject?.folderPath) { notify?.('No folder', 'error'); setShowAttachMenu(false); return; }
    try {
      const res = await fetch('/api/prompt-from-file/from-git-diff', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: selectedProject.folderPath, projectId: selectedProjectId }),
      });
      const data = await res.json();
      if (data.prompt) { addAttachment('diff', 'Git diff', data.sourceContent || 'Diff'); notify?.('Diff captured'); }
      else { notify?.('No diff', 'error'); }
    } catch { notify?.('Could not capture diff', 'error'); }
    setShowAttachMenu(false);
  };

  // ── Keyboard ──

  const handleKeyDown = (e) => {
    const isMod = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && isMod) {
      // Ctrl/Cmd + Enter = insert newline
      e.preventDefault();
      const el = textareaRef.current;
      if (!el) return;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const val = promptText;
      setPromptText(val.substring(0, start) + '\n' + val.substring(end));
      // Move cursor after the newline on next tick
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1;
      });
    } else if (e.key === 'Enter' && !isMod) {
      // Enter = send
      e.preventDefault();
      if (planMode) handleGeneratePlan();
      else handleSendRaw();
    }
  };

  // ── Render ──

  return (
    <div className="relative flex-shrink-0">
      <div className="flex items-start bg-surface-850 border-b border-surface-700 px-2 py-1.5 gap-2">

        {/* Logo + Project */}
        <div className="flex items-center gap-2 flex-shrink-0 pt-1">
          <div className="w-6 h-6 rounded-md bg-primary-500 flex items-center justify-center">
            <span className="text-surface-950 font-display font-bold text-[10px]">P</span>
          </div>
          <span className="text-[11px] font-medium text-surface-400 tracking-tight hidden sm:inline">IDE</span>
          {selectedProject && (
            <>
              <span className="text-surface-600 text-[11px]">/</span>
              <span className="text-[11px] text-surface-200 font-medium truncate max-w-[100px]">{selectedProject.name}</span>
            </>
          )}

          {/* Plan progress */}
          {planRunning && totalSteps > 0 && (
            <div className="flex items-center gap-1 ml-1">
              <div className="w-12 h-1.5 bg-surface-700 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 transition-all" style={{ width: `${Math.round((completedSteps / totalSteps) * 100)}%` }} />
              </div>
              <span className="text-[10px] text-surface-400">{completedSteps}/{totalSteps}</span>
            </div>
          )}
        </div>

        <div className="w-px h-6 bg-surface-700 flex-shrink-0 mt-0.5" />

        {/* Attachments */}
        <div className="relative flex-shrink-0 pt-0.5" ref={attachMenuRef}>
          <button onClick={() => setShowAttachMenu(!showAttachMenu)} className="p-1.5 rounded hover:bg-surface-750 text-surface-400 hover:text-surface-200" title="Attach context">
            <Paperclip className="w-3.5 h-3.5" />
          </button>
          {showAttachMenu && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-50 py-1">
              <button onClick={() => fileInputRef.current?.click()} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-surface-300 hover:bg-surface-750"><Upload className="w-3.5 h-3.5 text-surface-400" />File</button>
              <button onClick={handleCaptureTerminal} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-surface-300 hover:bg-surface-750"><Monitor className="w-3.5 h-3.5 text-surface-400" />Terminal</button>
              <button onClick={handleCaptureDiff} className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] text-surface-300 hover:bg-surface-750"><GitBranch className="w-3.5 h-3.5 text-surface-400" />Git Diff</button>
            </div>
          )}
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileAttach} />
        </div>

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="flex items-center gap-1 flex-shrink-0 pt-1 overflow-x-auto max-w-[150px]">
            {attachments.map(att => (
              <div key={att.id} className="flex items-center gap-1 px-1.5 py-0.5 bg-surface-750 border border-surface-700 rounded text-[10px] text-surface-300 whitespace-nowrap">
                <span className="truncate max-w-[50px]">{att.label}</span>
                <button onClick={() => removeAttachment(att.id)} className="text-surface-500 hover:text-surface-200"><X className="w-2.5 h-2.5" /></button>
              </div>
            ))}
          </div>
        )}

        {/* ── Auto-resizing textarea ── */}
        <div className="flex-1 min-w-0">
          <textarea
            ref={textareaRef}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={!hasSession}
            placeholder={!hasSession ? 'Start a session first...' : planMode ? 'Describe your goal... (Ctrl+Enter for newline)' : 'Type a prompt... (Ctrl+Enter for newline)'}
            className="w-full px-2.5 py-1 text-[13px] bg-surface-800 border border-surface-700 rounded-md text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors outline-none resize-none overflow-hidden leading-5"
            style={{ minHeight: '28px', maxHeight: '160px' }}
          />
        </div>

        {/* ── Action buttons ── */}
        <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
          <button onClick={handleSendRaw} disabled={!hasInput || !hasSession} className="flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-surface-700 hover:bg-surface-650 text-surface-300 rounded-full border border-surface-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Send raw (Enter)">
            <Send className="w-3 h-3" />
            <span className="hidden lg:inline">Raw</span>
          </button>

          {planMode ? (
            <button onClick={handleGeneratePlan} disabled={!hasInput || !selectedProjectId || generating} className="flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-primary-500 hover:bg-primary-600 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <ListTodo className="w-3 h-3" />}
              <span className="hidden lg:inline">{generating ? 'Planning...' : 'Plan'}</span>
            </button>
          ) : (
            <button onClick={handleAISend} disabled={!hasInput || !selectedProjectId || generating} className="flex items-center gap-1 px-2.5 py-1 text-[12px] font-medium bg-green-600 hover:bg-green-700 text-white rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-colors" title="Optimize with AI + send">
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              <span className="hidden lg:inline">{generating ? 'AI...' : 'AI Send'}</span>
            </button>
          )}

          {/* Plan toggle */}
          <div className="relative" ref={planDropdownRef}>
            <button
              onClick={() => planSteps?.length > 0 ? setShowPlanDropdown(!showPlanDropdown) : setPlanMode(!planMode)}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-full border transition-colors ${
                planMode || planSteps?.length
                  ? 'bg-primary-500/20 text-primary-400 border-primary-500/40'
                  : 'bg-surface-750 text-surface-400 border-surface-600 hover:text-surface-200'
              }`}
            >
              <ListTodo className="w-3 h-3" />
              {planSteps?.length > 0 && <ChevronDown className="w-3 h-3" />}
            </button>

            {/* Plan dropdown */}
            {showPlanDropdown && planSteps?.length > 0 && (
              <div className="absolute top-full right-0 mt-1 w-80 bg-surface-800 border border-surface-700 rounded-lg shadow-xl z-50 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
                  <div className="flex items-center gap-2">
                    <ListTodo className="w-3.5 h-3.5 text-primary-400" />
                    <span className="text-[12px] font-medium text-surface-200 truncate">{planTitle || 'Plan'}</span>
                    <span className="text-[10px] text-surface-500">{totalSteps} steps</span>
                  </div>
                  <button onClick={() => setShowPlanDropdown(false)} className="p-1 hover:bg-surface-700 rounded text-surface-400"><X className="w-3 h-3" /></button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {planSteps.map((step, idx) => {
                    const done = idx < (planCurrentStep || 0);
                    const active = idx === (planCurrentStep || 0) && planRunning;
                    return (
                      <div key={idx} className={`flex items-start gap-2 px-3 py-2 border-b border-surface-700/50 ${active ? 'bg-primary-500/10' : done ? 'bg-green-500/5' : ''}`}>
                        <span className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-medium flex-shrink-0 ${done ? 'bg-green-500/20 text-green-400' : active ? 'bg-primary-500/20 text-primary-400' : 'bg-surface-700 text-surface-400'}`}>{idx + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className={`text-[12px] font-medium ${done ? 'text-surface-500 line-through' : active ? 'text-primary-300' : 'text-surface-300'}`}>{step.title || `Step ${idx + 1}`}</div>
                          {step.prompt && <div className="text-[10px] text-surface-500 mt-0.5 truncate">{step.prompt.slice(0, 80)}</div>}
                        </div>
                        {active && <Loader2 className="w-3 h-3 text-primary-400 animate-spin flex-shrink-0 mt-1" />}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 px-3 py-2 border-t border-surface-700 bg-surface-850">
                  {!planRunning ? (
                    <button onClick={() => { onStartAutonomous?.(); setShowPlanDropdown(false); }} disabled={!hasSession} className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium bg-green-600 hover:bg-green-700 text-white rounded-md disabled:opacity-40 transition-colors"><Play className="w-3 h-3" />Run</button>
                  ) : (
                    <>
                      <button onClick={() => onPlanControl?.('pause')} className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 rounded-md"><Pause className="w-3 h-3" />Pause</button>
                      <button onClick={() => onPlanControl?.('stop')} className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-md"><Square className="w-3 h-3" />Stop</button>
                      <button onClick={() => onPlanControl?.('skip')} className="flex items-center gap-1 px-2 py-1.5 text-[11px] bg-surface-700 text-surface-300 hover:bg-surface-650 rounded-md"><SkipForward className="w-3 h-3" />Skip</button>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {notificationSlot}

          {showKill && <div className="w-px h-5 bg-surface-700" />}
          {showKill && (
            <button onClick={onKill} className="flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-medium bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors">
              <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-300 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-red-100" /></span>
              KILL
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
