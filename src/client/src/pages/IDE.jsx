import { useState, useEffect, useCallback } from 'react';
import { useProjects } from '../contexts/ProjectContext';
import Terminal, { useTerminal } from '../components/Terminal';
import ProjectManagerPanel from '../components/ProjectManagerPanel';
import QuickActionsPanel from '../components/QuickActionsPanel';
import TopBar from '../components/TopBar';
import RightPanel from '../components/RightPanel';
// SessionManager retired — sessions now shown inline under each project
import NotificationCenter, { sendDesktopNotification } from '../components/NotificationCenter';
import {
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  ChevronUp,
  GitBranch,
  FolderOpen,
  Sparkles,
} from 'lucide-react';

// Storage keys
const STORAGE_KEYS = {
  SELECTED_PROJECT: 'ide-selected-project',
  SESSION_ID: 'ide-session-id',
  UTIL_SESSION_ID: 'ide-util-session-id',
  LEFT_PANEL_WIDTH: 'ide-left-panel-width',
  RIGHT_PANEL_WIDTH: 'ide-right-panel-width',
  LEFT_PANEL_COLLAPSED: 'ide-left-collapsed',
};

export default function IDE() {
  const { projects, getProject, getGlobalRules, notify } = useProjects();
  const { sendToTerminal } = useTerminal();

  // Layout state (with persistence)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.LEFT_PANEL_WIDTH);
    return saved ? parseInt(saved) : 220;
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL_WIDTH);
    return saved ? parseInt(saved) : 280;
  });
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.LEFT_PANEL_COLLAPSED) === 'true';
  });

  // Project state (with persistence)
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT) || null;
  });
  const [selectedProject, setSelectedProject] = useState(null);

  // Session state (with persistence)
  const [currentSessionId, setCurrentSessionId] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.SESSION_ID) || null;
  });
  const [utilSessionId, setUtilSessionId] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.UTIL_SESSION_ID) || null;
  });

  // Utility terminal
  const [utilTerminalCollapsed, setUtilTerminalCollapsed] = useState(false);

  // Sessions & notifications state
  const [allSessions, setAllSessions] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Git branch state (legacy local projects)
  const [currentBranch, setCurrentBranch] = useState(null);
  // Container repos state
  const [containerRepos, setContainerRepos] = useState([]);

  // Plan execution state (shared with TopBar)
  const [executionId, setExecutionId] = useState(null);
  const [planRunning, setPlanRunning] = useState(false);
  const [planSteps, setPlanSteps] = useState(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planCurrentStep, setPlanCurrentStep] = useState(0);

  // Resizer state
  const [isResizing, setIsResizing] = useState(null);

  // ── Persist state ──

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LEFT_PANEL_WIDTH, leftPanelWidth.toString());
  }, [leftPanelWidth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RIGHT_PANEL_WIDTH, rightPanelWidth.toString());
  }, [rightPanelWidth]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.LEFT_PANEL_COLLAPSED, leftPanelCollapsed.toString());
  }, [leftPanelCollapsed]);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, selectedProjectId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SELECTED_PROJECT);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem(STORAGE_KEYS.SESSION_ID, currentSessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SESSION_ID);
    }
  }, [currentSessionId]);

  useEffect(() => {
    if (utilSessionId) {
      localStorage.setItem(STORAGE_KEYS.UTIL_SESSION_ID, utilSessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.UTIL_SESSION_ID);
    }
  }, [utilSessionId]);

  // ── Load project ──

  useEffect(() => {
    if (selectedProjectId) {
      loadProject(selectedProjectId);
    } else {
      setSelectedProject(null);
    }
  }, [selectedProjectId]);

  const loadProject = async (id) => {
    try {
      const project = await getProject(id);
      if (!project) {
        // Project was deleted or DB was wiped — clear stale selection
        setSelectedProjectId(null);
        setSelectedProject(null);
        return;
      }
      setSelectedProject(project);
    } catch (error) {
      // Project not found (404) — clear stale selection
      setSelectedProjectId(null);
      setSelectedProject(null);
    }
  };

  // ── New session pair — creates main + utility together ──
  useEffect(() => {
    window.createNewSessionPair = () => {
      // Trigger both terminals to create new sessions
      // Each terminal's createSession is exposed via the "New" button internally
      // But we need a way to trigger both. Use a custom event.
      window.dispatchEvent(new CustomEvent('create-new-session-pair'));
    };
    return () => { window.createNewSessionPair = null; };
  }, []);

  // ── Repos + branches polling (container or local) ──

  useEffect(() => {
    if (!selectedProject) {
      setCurrentBranch(null);
      setContainerRepos([]);
      return;
    }

    const fetchInfo = () => {
      if (selectedProject.containerName) {
        // Container project: fetch repos from inside the container
        fetch(`/api/containers/${selectedProject.containerName}/repos`)
          .then(r => r.ok ? r.json() : { repos: [] })
          .then(data => {
            setContainerRepos(data.repos || []);
            // Set currentBranch from first repo for backward compat
            const firstGit = (data.repos || []).find(r => r.isGitRepo);
            if (firstGit) setCurrentBranch({ branch: firstGit.branch, isMainBranch: ['main','master'].includes(firstGit.branch), hasChanges: firstGit.hasChanges });
            else setCurrentBranch(null);
          })
          .catch(() => { setContainerRepos([]); setCurrentBranch(null); });
      } else if (selectedProject.folderPath) {
        // Local project: use git-info endpoint
        fetch(`/api/orchestrator/git-info?projectPath=${encodeURIComponent(selectedProject.folderPath)}`)
          .then(r => r.json())
          .then(data => {
            if (data.isGitRepo) setCurrentBranch(data);
            else setCurrentBranch(null);
          })
          .catch(() => setCurrentBranch(null));
        setContainerRepos([]);
      } else {
        setCurrentBranch(null);
        setContainerRepos([]);
      }
    };
    fetchInfo();
    const interval = setInterval(fetchInfo, 15000);
    return () => clearInterval(interval);
  }, [selectedProject?.containerName, selectedProject?.folderPath]);

  // ── Listen for run-in-util events from QuickActionsPanel ──

  useEffect(() => {
    const handler = (e) => {
      if (window.sendUtilTerminal) {
        window.sendUtilTerminal(e.detail.command);
      }
    };
    window.addEventListener('run-in-util', handler);
    return () => window.removeEventListener('run-in-util', handler);
  }, []);

  // ── Notification helpers ──

  const addNotification = useCallback((type, title, detail, sessionId, projectName) => {
    const notification = {
      id: Date.now() + Math.random(),
      type, title, detail, sessionId, projectName,
      timestamp: new Date().toISOString(),
      read: false,
    };
    setNotifications(prev => [notification, ...prev].slice(0, 50));

    // Desktop notification for important types
    if (['needs-input', 'error-detected'].includes(type)) {
      sendDesktopNotification(title, detail || '', { tag: sessionId });
    }
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const dismissAllNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const handleNotificationClick = useCallback((notification) => {
    if (notification.sessionId && window.switchMainSession) {
      window.switchMainSession(notification.sessionId);
    }
    // Mark as read
    setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n));
  }, []);

  // ── Listen for session events (needs-input, errors) via window events ──

  useEffect(() => {
    const handleNeedsInput = (e) => {
      const { sessionId, text } = e.detail;
      const session = allSessions.find(s => s.id === sessionId);
      const proj = projects.find(p => p.id === session?.projectId);
      addNotification('needs-input', 'Input needed', text, sessionId, proj?.name);
    };

    window.addEventListener('session-needs-input', handleNeedsInput);
    return () => {
      window.removeEventListener('session-needs-input', handleNeedsInput);
    };
  }, [allSessions, projects, addNotification]);

  // ── TopBar callbacks ──

  const handleSendRaw = useCallback((text) => {
    if (!currentSessionId || !text?.trim()) return;
    sendToTerminal(text.trim() + '\n');
  }, [currentSessionId, sendToTerminal]);

  const handleGeneratePlan = useCallback((plan) => {
    setPlanSteps(plan.steps);
    setPlanTitle(plan.title);
    setPlanCurrentStep(0);
    setPlanRunning(false);
    setExecutionId(null);
    notify(`Plan ready: ${plan.steps.length} steps`);
  }, [notify]);

  const handleStartAutonomous = useCallback(() => {
    if (!planSteps || !currentSessionId || !selectedProject) return;
    fetch('/api/orchestrator/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        projectId: selectedProjectId,
        projectPath: selectedProject.folderPath || null,
        steps: planSteps,
        planTitle,
        cliTool: 'claude',
        config: { autoCommit: true, runTests: false, maxRetries: 1, gitStrategy: 'current-branch' },
      }),
    }).then(r => r.json()).then(data => {
      if (data.executionId) {
        setExecutionId(data.executionId);
        setPlanRunning(true);
        notify('Autonomous execution started');
      } else if (data.error) {
        notify(data.error, 'error');
      }
    }).catch(err => notify(err.message, 'error'));
  }, [planSteps, currentSessionId, selectedProject, selectedProjectId, planTitle, notify]);

  const handlePlanControl = useCallback((action) => {
    if (!executionId) return;
    fetch(`/api/orchestrator/${action}/${executionId}`, { method: 'POST' })
      .then(r => r.json())
      .then(() => {
        if (action === 'stop') { setPlanRunning(false); setExecutionId(null); }
        if (action === 'pause') { setPlanRunning(false); }
        if (action === 'resume') { setPlanRunning(true); }
      })
      .catch(err => notify(err.message, 'error'));
  }, [executionId, notify]);

  const handleKill = useCallback(() => {
    if (!executionId) return;
    fetch(`/api/orchestrator/kill/${executionId}`, { method: 'POST' });
    setPlanRunning(false);
    setExecutionId(null);
    notify('Execution killed', 'error');
  }, [executionId, notify]);

  // ── Resize handling ──

  const handleMouseMove = useCallback((e) => {
    if (isResizing === 'left') {
      setLeftPanelWidth(Math.max(180, Math.min(350, e.clientX)));
    } else if (isResizing === 'right') {
      setRightPanelWidth(Math.max(200, Math.min(500, window.innerWidth - e.clientX)));
    }
  }, [isResizing]);

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

  // ── Render ──

  return (
    <div className="h-screen flex flex-col bg-surface-900 overflow-hidden">
      {/* ── Top Bar: prompt sender + status ── */}
      <TopBar
        selectedProject={selectedProject}
        selectedProjectId={selectedProjectId}
        currentBranch={currentBranch}
        currentSessionId={currentSessionId}
        executionId={executionId}
        planRunning={planRunning}
        planSteps={planSteps}
        planTitle={planTitle}
        planCurrentStep={planCurrentStep}
        onSendRaw={handleSendRaw}
        onOptimizeAndSend={handleSendRaw}
        onGeneratePlan={handleGeneratePlan}
        onStartAutonomous={handleStartAutonomous}
        onPlanControl={handlePlanControl}
        onKill={handleKill}
        notify={notify}
        notificationSlot={
          <NotificationCenter
            notifications={notifications}
            onDismiss={dismissNotification}
            onDismissAll={dismissAllNotifications}
            onClickNotification={handleNotificationClick}
          />
        }
      />

      {/* ── Main IDE Layout ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left Panel: Projects + Quick Actions ── */}
        {!leftPanelCollapsed && (
          <>
            <div
              className="flex flex-col bg-surface-850 border-r border-surface-700"
              style={{ width: leftPanelWidth }}
            >
              {/* Projects with inline sessions */}
              <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-2 py-1.5 border-b border-surface-700 flex-shrink-0">
                  <span className="text-[11px] font-medium text-surface-300 uppercase tracking-wide">Projects</span>
                  <button
                    onClick={() => setLeftPanelCollapsed(true)}
                    className="p-1 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
                  >
                    <PanelLeftClose className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  <ProjectManagerPanel
                    selectedProjectId={selectedProjectId}
                    onSelectProject={(id) => setSelectedProjectId(id)}
                    onProjectChanged={() => {
                      if (selectedProjectId) loadProject(selectedProjectId);
                    }}
                    sessions={allSessions}
                    activeSessionId={currentSessionId}
                  />
                </div>
              </div>

              {/* ── Repos + Branches (middle drawer) ── */}
              {selectedProject && (containerRepos.length > 0 || currentBranch) && (
                <div className="flex-shrink-0 px-2 py-2 bg-surface-800/50 border-y border-surface-700 space-y-1 max-h-48 overflow-y-auto">
                  {containerRepos.length > 0 ? (
                    // Container project: show each repo
                    containerRepos.map(repo => (
                      <div key={repo.path} className="px-2 py-1.5 rounded-md bg-surface-850 border border-surface-700/50">
                        <div className="flex items-center gap-1.5">
                          <FolderOpen className="w-3 h-3 text-surface-500 flex-shrink-0" />
                          <span className="text-[11px] font-medium text-surface-200 truncate">{repo.name}</span>
                          {repo.isGitRepo && repo.branch && (
                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ml-auto flex-shrink-0 ${
                              ['main','master'].includes(repo.branch)
                                ? 'bg-yellow-500/10 text-yellow-300'
                                : 'bg-green-500/10 text-green-300'
                            }`}>
                              <GitBranch className="w-2.5 h-2.5" />
                              <span className="truncate max-w-20">{repo.branch}</span>
                              {repo.hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                            </div>
                          )}
                        </div>
                        {/* Scripts preview */}
                        {Object.keys(repo.scripts).length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {Object.keys(repo.scripts).slice(0, 4).map(s => (
                              <button
                                key={s}
                                onClick={() => {
                                  const cmd = `cd ${repo.path} && ${repo.packageManager} run ${s}\n`;
                                  window.dispatchEvent(new CustomEvent('run-in-util', { detail: { command: cmd } }));
                                }}
                                className="px-1.5 py-0.5 text-[9px] bg-surface-700 text-surface-400 hover:text-surface-200 hover:bg-surface-600 rounded transition-colors"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))
                  ) : currentBranch ? (
                    // Local project: show single branch
                    <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md ${
                      currentBranch.isMainBranch ? 'bg-yellow-500/10 border border-yellow-500/20' : 'bg-green-500/10 border border-green-500/20'
                    }`}>
                      <GitBranch className={`w-3.5 h-3.5 ${currentBranch.isMainBranch ? 'text-yellow-400' : 'text-green-400'}`} />
                      <span className={`text-[11px] font-mono font-semibold truncate ${currentBranch.isMainBranch ? 'text-yellow-300' : 'text-green-300'}`}>
                        {currentBranch.branch}
                      </span>
                      {currentBranch.hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                    </div>
                  ) : null}
                  {/* Review Changes button */}
                  <button
                    onClick={() => window.open('/branch-review', '_blank')}
                    className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    Review Changes
                  </button>
                </div>
              )}

              {/* Quick Actions (bottom) */}
              <div className="overflow-hidden" style={{ minHeight: '120px', maxHeight: '40%' }}>
                <QuickActionsPanel
                  projectId={selectedProjectId}
                  projectPath={selectedProject?.folderPath}
                />
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

        {/* ── Center: Terminals ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Main Terminal */}
          <div className="flex-1 flex flex-col min-h-0" style={{ flex: utilTerminalCollapsed ? 1 : 0.65 }}>
            <Terminal
              projectId={selectedProjectId}
              projects={projects}
              onSessionChange={setCurrentSessionId}
              onSessionsChange={setAllSessions}
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

          {/* Utility Terminal */}
          {!utilTerminalCollapsed && (
            <div className="flex flex-col min-h-0" style={{ flex: 0.35 }}>
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

        {/* Right Resizer */}
        <div
          className="w-1 bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
          onMouseDown={() => setIsResizing('right')}
        />

        {/* ── Right Panel: Live Analysis + Scheduler ── */}
        <div style={{ width: rightPanelWidth }} className="flex-shrink-0">
          <RightPanel
            projectId={selectedProjectId}
            projectPath={selectedProject?.folderPath}
            sessionId={currentSessionId}
          />
        </div>
      </div>
    </div>
  );
}
