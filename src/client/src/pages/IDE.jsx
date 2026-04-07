import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjects } from '../contexts/ProjectContext';
import ChatPanel from '../components/ChatPanel';
import InternalConsole from '../components/InternalConsole';
import ProjectManagerPanel from '../components/ProjectManagerPanel';
import QuickActionsPanel from '../components/QuickActionsPanel';
import TopBar from '../components/TopBar';
import RightPanel from '../components/RightPanel';
import NotificationCenter, { sendDesktopNotification } from '../components/NotificationCenter';
import { useWebSocket, WS_STATUS } from '../hooks/useWebSocket';
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
  LEFT_PANEL_WIDTH: 'ide-left-panel-width',
  RIGHT_PANEL_WIDTH: 'ide-right-panel-width',
  LEFT_PANEL_COLLAPSED: 'ide-left-collapsed',
};

export default function IDE() {
  const { projects, getProject, getGlobalRules, notify } = useProjects();
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

  // Project cache - keeps recently visited projects' ChatPanels mounted for instant switching
  // Limit to 5 projects to avoid excessive memory usage
  const MAX_CACHED_PROJECTS = 5;
  const [cachedProjectIds, setCachedProjectIds] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_PROJECT);
    return saved ? [saved] : [];
  });

  // Update cached projects when selection changes
  useEffect(() => {
    if (!selectedProjectId) return;
    setCachedProjectIds(prev => {
      // If already cached, move to end (most recent)
      if (prev.includes(selectedProjectId)) {
        return [...prev.filter(id => id !== selectedProjectId), selectedProjectId];
      }
      // Add to cache, remove oldest if at limit
      const updated = [...prev, selectedProjectId];
      if (updated.length > MAX_CACHED_PROJECTS) {
        return updated.slice(-MAX_CACHED_PROJECTS);
      }
      return updated;
    });
  }, [selectedProjectId]);

  // Notifications state
  const [notifications, setNotifications] = useState([]);

  // Agent mode state (shared between TopBar toggle and ChatPanel)
  const [agentMode, setAgentMode] = useState(() => localStorage.getItem('agent-mode') || 'agent');

  // Selected CLI tool (shared between TopBar selector and ChatPanel)
  const [selectedTool, setSelectedTool] = useState(() => localStorage.getItem('selected-tool') || 'claude');

  // Git branch state (legacy local projects)
  const [currentBranch, setCurrentBranch] = useState(null);
  // Container repos state
  const [containerRepos, setContainerRepos] = useState([]);

  // Unread session counts per project: { projectId: count }
  const [unreadCounts, setUnreadCounts] = useState({});

  // Plan execution state (shared with TopBar)
  const [executionId, setExecutionId] = useState(null);
  const [planRunning, setPlanRunning] = useState(false);
  const [planSteps, setPlanSteps] = useState(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planCurrentStep, setPlanCurrentStep] = useState(0);

  // Resizer state
  const [isResizing, setIsResizing] = useState(null);

  // Chat WebSocket connection with robust reconnection
  const { wsRef: chatWsRef, status: wsStatus, isConnected: wsConnected, forceReconnect } = useWebSocket('/ws/terminal', {
    reconnectOnVisible: true,  // Reconnect when tab becomes visible
    checkOnFocus: true,        // Check connection when window gains focus
    heartbeatInterval: 25000,  // Ping every 25 seconds
    heartbeatTimeout: 60000,   // Reconnect if no activity for 60 seconds
    onStatusChange: (status) => {
      // Log status changes for debugging
      if (status === WS_STATUS.RECONNECTING) {
        console.log('[IDE] WebSocket reconnecting...');
      } else if (status === WS_STATUS.CONNECTED) {
        console.log('[IDE] WebSocket connected');
      }
    },
  });

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
    localStorage.setItem('agent-mode', agentMode);
  }, [agentMode]);

  useEffect(() => {
    localStorage.setItem('selected-tool', selectedTool);
  }, [selectedTool]);

  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(STORAGE_KEYS.SELECTED_PROJECT, selectedProjectId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.SELECTED_PROJECT);
    }
  }, [selectedProjectId]);

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
        setSelectedProjectId(null);
        setSelectedProject(null);
        return;
      }
      setSelectedProject(project);
    } catch (error) {
      setSelectedProjectId(null);
      setSelectedProject(null);
    }
  };

  // ── Repos + branches polling (container or local) ──

  useEffect(() => {
    if (!selectedProject) {
      setCurrentBranch(null);
      setContainerRepos([]);
      return;
    }

    const fetchInfo = () => {
      if (selectedProject.containerName) {
        fetch(`/api/containers/${selectedProject.containerName}/repos`)
          .then(r => r.ok ? r.json() : { repos: [] })
          .then(data => {
            setContainerRepos(data.repos || []);
            const firstGit = (data.repos || []).find(r => r.isGitRepo);
            if (firstGit) setCurrentBranch({ branch: firstGit.branch, isMainBranch: ['main','master'].includes(firstGit.branch), hasChanges: firstGit.hasChanges });
            else setCurrentBranch(null);
          })
          .catch(() => { setContainerRepos([]); setCurrentBranch(null); });
      } else if (selectedProject.folderPath) {
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

  // ── Unread counts fetching ──

  useEffect(() => {
    const fetchUnreadCounts = () => {
      fetch('/api/unread-counts')
        .then(r => r.ok ? r.json() : { unread: {} })
        .then(data => setUnreadCounts(data.unread || {}))
        .catch(() => {});
    };
    fetchUnreadCounts();
    const interval = setInterval(fetchUnreadCounts, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Handle unread WebSocket events
  useEffect(() => {
    const ws = chatWsRef.current;
    if (!ws) return;

    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'session-unread') {
          setUnreadCounts(prev => ({
            ...prev,
            [data.projectId]: (prev[data.projectId] || 0) + (data.hasUnread ? 1 : -1),
          }));
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [chatWsRef.current]);

  // Clear unread count when viewing a project's session
  const markProjectRead = useCallback((projectId) => {
    setUnreadCounts(prev => {
      const { [projectId]: _, ...rest } = prev;
      return rest;
    });
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
    setNotifications(prev => prev.map(n => n.id === notification.id ? { ...n, read: true } : n));
  }, []);

  // ── TopBar callbacks ──

  const handleGeneratePlan = useCallback((plan) => {
    setPlanSteps(plan.steps);
    setPlanTitle(plan.title);
    setPlanCurrentStep(0);
    setPlanRunning(false);
    setExecutionId(null);
    notify(`Plan ready: ${plan.steps.length} steps`);
  }, [notify]);

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

  // ── Computed layout values ──

  const leftW = leftPanelCollapsed ? 'auto' : `${leftPanelWidth}px`;

  // ── Render ──

  return (
    <div
      className="fixed inset-0 bg-surface-900"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        gridTemplateColumns: '1fr',
      }}
    >
      {/* ═══ Row 1: TopBar ═══ */}
      <TopBar
        selectedProject={selectedProject}
        currentBranch={currentBranch}
        planRunning={planRunning}
        planSteps={planSteps}
        planCurrentStep={planCurrentStep}
        agentMode={agentMode}
        onModeChange={setAgentMode}
        selectedTool={selectedTool}
        onToolChange={setSelectedTool}
        projects={projects}
        notificationSlot={
          <NotificationCenter
            notifications={notifications}
            onDismiss={dismissNotification}
            onDismissAll={dismissAllNotifications}
            onClickNotification={handleNotificationClick}
          />
        }
      />

      {/* ═══ Row 2: Main content (3-column) ═══ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `${leftPanelCollapsed ? 'auto' : `${leftPanelWidth}px 4px`} 1fr 4px ${rightPanelWidth}px`,
          overflow: 'hidden',
        }}
      >
        {/* ── Left Panel ── */}
        {!leftPanelCollapsed ? (
          <>
            <div className="flex flex-col overflow-hidden bg-surface-850 border-r border-surface-700">
              {/* Projects header */}
              <div className="flex items-center justify-between px-2 py-1.5 border-b border-surface-700 flex-shrink-0">
                <span className="text-[11px] font-medium text-surface-300 uppercase tracking-wide">Projects</span>
                <button
                  onClick={() => setLeftPanelCollapsed(true)}
                  className="p-1 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
                >
                  <PanelLeftClose className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Project list */}
              <div className="flex-1 min-h-0 overflow-auto">
                <ProjectManagerPanel
                  selectedProjectId={selectedProjectId}
                  onSelectProject={(id) => {
                    setSelectedProjectId(id);
                    if (id) markProjectRead(id);
                  }}
                  onProjectChanged={() => {
                    if (selectedProjectId) loadProject(selectedProjectId);
                  }}
                  unreadCounts={unreadCounts}
                />
              </div>

              {/* Repos + Branches */}
              {selectedProject && (containerRepos.length > 0 || currentBranch) && (
                <div className="flex-shrink-0 px-2 py-2 bg-surface-800/50 border-y border-surface-700 space-y-1 max-h-48 overflow-y-auto">
                  {containerRepos.length > 0 ? (
                    containerRepos.map(repo => (
                      <div key={repo.path} className="px-2 py-1.5 rounded-md bg-surface-850 border border-surface-700/50">
                        <div className="flex items-center gap-1.5">
                          <FolderOpen className="w-3 h-3 text-surface-500 flex-shrink-0" />
                          <span className="text-[11px] font-medium text-surface-200 truncate">{repo.name}</span>
                          {repo.isGitRepo && repo.branch && (
                            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ml-auto flex-shrink-0 ${
                              ['main','master'].includes(repo.branch) ? 'bg-yellow-500/10 text-yellow-300' : 'bg-green-500/10 text-green-300'
                            }`}>
                              <GitBranch className="w-2.5 h-2.5" />
                              <span className="truncate max-w-20">{repo.branch}</span>
                              {repo.hasChanges && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />}
                            </div>
                          )}
                        </div>
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
                  <button
                    onClick={() => window.open('/branch-review', '_blank')}
                    className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors"
                  >
                    <Sparkles className="w-3 h-3" />
                    Review Changes
                  </button>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex-shrink-0 overflow-hidden" style={{ minHeight: '120px', maxHeight: '40%' }}>
                <QuickActionsPanel
                  projectId={selectedProjectId}
                  projectPath={selectedProject?.folderPath}
                />
              </div>
            </div>

            {/* Left resizer */}
            <div
              className="bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
              onMouseDown={() => setIsResizing('left')}
            />
          </>
        ) : (
          <div className="flex flex-col items-center py-2 px-1 bg-surface-850 border-r border-surface-700">
            <button
              onClick={() => setLeftPanelCollapsed(false)}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Center: Chat ── */}
        {/* Render cached ChatPanels - keeps them mounted for instant switching */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, maxHeight: '100%', position: 'relative' }}>
          {cachedProjectIds.map(projectId => (
            <div
              key={projectId}
              style={{
                display: projectId === selectedProjectId ? 'flex' : 'none',
                flexDirection: 'column',
                overflow: 'hidden',
                minHeight: 0,
                maxHeight: '100%',
                flex: 1,
              }}
            >
              <ChatPanel
                projectId={projectId}
                wsRef={chatWsRef}
                mode={agentMode}
                tool={selectedTool}
                isActive={projectId === selectedProjectId}
              />
            </div>
          ))}
          {/* Show empty state if no project selected */}
          {!selectedProjectId && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="text-surface-500 text-center">
                <p className="text-sm">Select a project to start chatting</p>
              </div>
            </div>
          )}
          <InternalConsole projectId={selectedProjectId} wsRef={chatWsRef} />
        </div>

        {/* Right resizer */}
        <div
          className="bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
          onMouseDown={() => setIsResizing('right')}
        />

        {/* ── Right Panel ── */}
        <div className="overflow-hidden">
          <RightPanel
            projectId={selectedProjectId}
            projectPath={selectedProject?.folderPath}
            selectedTool={selectedTool}
          />
        </div>
      </div>
    </div>
  );
}
