import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useProjects } from '../contexts/ProjectContext';
import ChatPanel from '../components/ChatPanel';
import ProjectManagerPanel from '../components/ProjectManagerPanel';
import TopBar from '../components/TopBar';
import RightPanel from '../components/RightPanel';
import NotificationCenter, { sendDesktopNotification } from '../components/NotificationCenter';
import { useWebSocket, WS_STATUS } from '../hooks/useWebSocket';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronUp,
  GitBranch,
  FolderOpen,
  Sparkles,
  FileCode,
  ArrowUpFromLine,
  Rocket,
  PackageCheck,
} from 'lucide-react';

// Storage keys
const STORAGE_KEYS = {
  SELECTED_PROJECT: 'ide-selected-project',
  LEFT_PANEL_WIDTH: 'ide-left-panel-width',
  RIGHT_PANEL_WIDTH: 'ide-right-panel-width',
  LEFT_PANEL_COLLAPSED: 'ide-left-collapsed',
  FORCE_MOBILE_LAYOUT: 'ide-force-mobile-layout',
};

function useIsMobileLayout() {
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 767px)').matches : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function normalizeUnreadSessions(value) {
  if (!value || typeof value !== 'object') return {};

  const normalized = {};
  for (const [projectId, sessionIds] of Object.entries(value)) {
    if (!Array.isArray(sessionIds)) continue;
    const ids = [...new Set(sessionIds.filter(id => typeof id === 'string' && id.length > 0))];
    if (ids.length > 0) normalized[projectId] = ids;
  }
  return normalized;
}

function getDeployCapability(repo) {
  const scripts = repo?.scripts || {};
  const deployScripts = Array.isArray(repo?.deployScripts) ? repo.deployScripts : [];
  const script = deployScripts[0] || ['deploy', 'release', 'publish'].find(name => scripts[name]);
  if (script) return { label: script, reason: `${repo.packageManager || 'npm'} run ${script}` };
  if (repo?.hasVercel) return { label: 'vercel', reason: 'vercel.json' };
  if (repo?.hasNetlify) return { label: 'netlify', reason: 'netlify.toml' };
  if (repo?.hasCompose) return { label: 'compose', reason: 'compose file' };
  if (repo?.hasDockerfile) return { label: 'docker', reason: 'Dockerfile' };
  return null;
}

function WorkspaceProjectsList({ repos, currentBranch, onSelectRepo, onRepoAction }) {
  const visibleRepos = repos.length > 0
    ? repos
    : currentBranch
      ? [{ path: '/workspace', name: 'workspace', isGitRepo: true, branch: currentBranch.branch, hasChanges: currentBranch.hasChanges }]
      : [];

  if (visibleRepos.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-y border-surface-700 bg-surface-800/50 px-2 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[10px] font-medium uppercase tracking-wide text-surface-500">
        <PackageCheck className="h-3 w-3 text-primary-400" />
        Workspace Projects
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto">
        {visibleRepos.map(repo => {
          const deploy = getDeployCapability(repo);
          const branchIsMain = ['main', 'master'].includes(repo.branch);
          return (
            <div
              key={repo.path}
              role="button"
              tabIndex={0}
              onClick={() => onSelectRepo?.(repo)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectRepo?.(repo);
                }
              }}
              className="group w-full rounded-lg border border-surface-700/50 bg-surface-850 px-2 py-1.5 text-left transition-colors hover:border-primary-500/35 hover:bg-surface-800"
              title={`Use ${repo.path} as the main thread folder`}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <FolderOpen className="h-3 w-3 flex-shrink-0 text-surface-500 group-hover:text-primary-400" />
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-surface-200">{repo.name}</span>
                {repo.isGitRepo && repo.branch && (
                  <span className={`flex max-w-24 flex-shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ${branchIsMain ? 'bg-yellow-500/10 text-yellow-300' : 'bg-green-500/10 text-green-300'}`}>
                    <GitBranch className="h-2.5 w-2.5" />
                    <span className="truncate">{repo.branch}</span>
                    {repo.hasChanges && <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" />}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-1 pl-4">
                <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-surface-600">{repo.path}</span>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onRepoAction?.('push', repo); }}
                  disabled={!repo.isGitRepo}
                  className="rounded-md p-1 text-surface-500 transition-colors hover:bg-green-500/10 hover:text-green-300 disabled:cursor-not-allowed disabled:opacity-30"
                  title={repo.isGitRepo ? 'Ask main thread to push this project' : 'No git repository detected'}
                >
                  <ArrowUpFromLine className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onRepoAction?.('deploy', repo); }}
                  disabled={!deploy}
                  className="rounded-md p-1 text-surface-500 transition-colors hover:bg-purple-500/10 hover:text-purple-300 disabled:cursor-not-allowed disabled:opacity-30"
                  title={deploy ? `Ask main thread to deploy via ${deploy.reason}` : 'No deploy signal detected'}
                >
                  <Rocket className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function IDE() {
  const { projects, getProject, getGlobalRules, notify } = useProjects();
  const viewportIsMobile = useIsMobileLayout();
  const [forceMobileLayout, setForceMobileLayout] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.FORCE_MOBILE_LAYOUT) === 'true';
  });
  const isMobileLayout = viewportIsMobile || forceMobileLayout;
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
  const [mobileDrawer, setMobileDrawer] = useState(null);

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
  const [selectedSessionFiles, setSelectedSessionFiles] = useState([]);

  // Unread session IDs per project. Counts are derived so duplicate events stay idempotent.
  const [unreadSessions, setUnreadSessions] = useState({});
  const unreadCounts = useMemo(() => {
    const counts = {};
    for (const [projectId, sessionIds] of Object.entries(unreadSessions)) {
      if (sessionIds.length > 0) counts[projectId] = sessionIds.length;
    }
    return counts;
  }, [unreadSessions]);

  // Plan execution state (shared with TopBar)
  const [executionId, setExecutionId] = useState(null);
  const [planRunning, setPlanRunning] = useState(false);
  const [planSteps, setPlanSteps] = useState(null);
  const [planTitle, setPlanTitle] = useState('');
  const [planCurrentStep, setPlanCurrentStep] = useState(0);

  // Resizer state
  const [isResizing, setIsResizing] = useState(null);

  // Chat WebSocket connection with robust reconnection
  const { wsRef: chatWsRef, status: wsStatus, isConnected: wsConnected, connectionVersion: wsConnectionVersion, forceReconnect } = useWebSocket('/ws/terminal', {
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
    localStorage.setItem(STORAGE_KEYS.FORCE_MOBILE_LAYOUT, forceMobileLayout.toString());
  }, [forceMobileLayout]);

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

    let cancelled = false;
    const fetchInfo = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      if (selectedProject.containerName) {
        fetch(`/api/containers/${selectedProject.containerName}/repos`)
          .then(r => r.ok ? r.json() : { repos: [] })
          .then(data => {
            if (cancelled) return;
            setContainerRepos(data.repos || []);
            const firstGit = (data.repos || []).find(r => r.isGitRepo);
            if (firstGit) setCurrentBranch({ branch: firstGit.branch, isMainBranch: ['main','master'].includes(firstGit.branch), hasChanges: firstGit.hasChanges });
            else setCurrentBranch(null);
          })
          .catch(() => { if (!cancelled) { setContainerRepos([]); setCurrentBranch(null); } });
      } else if (selectedProject.folderPath) {
        fetch(`/api/orchestrator/git-info?projectPath=${encodeURIComponent(selectedProject.folderPath)}`)
          .then(r => r.json())
          .then(data => {
            if (cancelled) return;
            if (data.isGitRepo) setCurrentBranch(data);
            else setCurrentBranch(null);
          })
          .catch(() => { if (!cancelled) setCurrentBranch(null); });
        setContainerRepos([]);
      } else {
        setCurrentBranch(null);
        setContainerRepos([]);
      }
    };
    // Repo/script detection is side data. Delay it so project/session UI paints first.
    const initialTimer = setTimeout(fetchInfo, 500);
    const interval = setInterval(fetchInfo, 15000);
    const handleVisibility = () => {
      if (!document.hidden) fetchInfo();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [selectedProject?.containerName, selectedProject?.folderPath]);

  const handleWorkspaceRepoSelect = useCallback((repo) => {
    if (!selectedProjectId || !repo?.path) return;
    window.dispatchEvent(new CustomEvent('main-thread-repo-select', {
      detail: { projectId: selectedProjectId, repo },
    }));
  }, [selectedProjectId]);

  const handleWorkspaceRepoAction = useCallback((action, repo) => {
    if (!selectedProjectId || !repo?.path) return;
    window.dispatchEvent(new CustomEvent('main-thread-repo-action', {
      detail: { projectId: selectedProjectId, action, repo },
    }));
  }, [selectedProjectId]);

  // ── Unread counts fetching ──

  useEffect(() => {
    const fetchUnreadCounts = () => {
      fetch('/api/unread-counts')
        .then(r => r.ok ? r.json() : { unread: {} })
        .then(data => {
          if (data.sessions) {
            setUnreadSessions(normalizeUnreadSessions(data.sessions));
            return;
          }

          const fallback = {};
          for (const [projectId, count] of Object.entries(data.unread || {})) {
            const unreadCount = Number(count);
            if (Number.isFinite(unreadCount) && unreadCount > 0) {
              fallback[projectId] = Array.from({ length: unreadCount }, (_, i) => `unknown-${i}`);
            }
          }
          setUnreadSessions(fallback);
        })
        .catch(() => {});
    };
    fetchUnreadCounts();
    const interval = setInterval(fetchUnreadCounts, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const handleUnreadChange = useCallback((projectId, sessionId, hasUnread) => {
    if (!projectId || !sessionId) return;
    console.log('[unread] handleUnreadChange', { projectId, sessionId, hasUnread });

    setUnreadSessions(prev => {
      const current = new Set(prev[projectId] || []);
      if (hasUnread) current.add(sessionId);
      else current.delete(sessionId);

      const next = { ...prev };
      if (current.size > 0) next[projectId] = Array.from(current);
      else delete next[projectId];
      console.log('[unread] unreadSessions updated', next);
      return next;
    });
  }, []);

  // Clear all unread for a project when the user opens it
  const handleProjectRead = useCallback((projectId) => {
    if (!projectId) return;
    console.log('[unread] handleProjectRead - clearing all for', projectId);
    fetch(`/api/projects/${projectId}/chat/read-all`, { method: 'POST' }).catch(() => {});
    setUnreadSessions(prev => {
      if (!prev[projectId]) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
  }, []);

  // Handle unread WebSocket events
  useEffect(() => {
    const ws = chatWsRef.current;
    if (!ws) return;

    const handleMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'session-unread') {
          handleUnreadChange(data.projectId, data.sessionId, data.hasUnread);
        }
      } catch {}
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [chatWsRef.current, handleUnreadChange]);

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

  const projectPanel = (
    <>
      {/* Projects header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-surface-700 flex-shrink-0">
        <span className="text-[11px] font-medium text-surface-300 uppercase tracking-wide">Projects</span>
        <button
          onClick={() => isMobileLayout ? setMobileDrawer(null) : setLeftPanelCollapsed(true)}
          className="p-1 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
          title={isMobileLayout ? 'Close projects' : 'Collapse projects'}
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
            if (isMobileLayout) setMobileDrawer(null);
          }}
          onProjectChanged={() => {
            if (selectedProjectId) loadProject(selectedProjectId);
          }}
          onProjectRead={handleProjectRead}
          unreadCounts={unreadCounts}
        />
      </div>

      {/* Workspace projects */}
      {selectedProject && (
        <WorkspaceProjectsList
          repos={containerRepos}
          currentBranch={currentBranch}
          onSelectRepo={handleWorkspaceRepoSelect}
          onRepoAction={handleWorkspaceRepoAction}
        />
      )}

      {selectedProject && (containerRepos.length > 0 || currentBranch) && (
        <div className="flex-shrink-0 border-b border-surface-700 bg-surface-800/40 px-2 pb-2">
          <button
            onClick={() => window.open('/branch-review', '_blank')}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] font-medium text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            Review Changes
          </button>
        </div>
      )}

      {/* Selected session changed files */}
      <div className="flex-shrink-0 overflow-hidden border-t border-surface-700 bg-surface-850" style={{ minHeight: '120px', maxHeight: '40%' }}>
        <div className="flex items-center gap-1.5 border-b border-surface-700 px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-surface-300">
          <FileCode className="h-3 w-3 text-primary-400" />
          Session Files
        </div>
        <div className="max-h-56 overflow-y-auto p-2">
          {selectedSessionFiles.length > 0 ? selectedSessionFiles.map(file => (
            <div key={`${file.status}:${file.path}`} className="mb-1 flex items-center gap-2 rounded border border-surface-700/50 bg-surface-900/45 px-2 py-1 font-mono text-[10px] text-surface-300">
              <span className="w-4 flex-shrink-0 text-primary-300">{file.status || 'M'}</span>
              <span className="truncate" title={file.path}>{file.path}</span>
            </div>
          )) : (
            <div className="rounded border border-dashed border-surface-700/60 px-3 py-4 text-center text-[11px] text-surface-500">
              Select a session to see files it changed.
            </div>
          )}
        </div>
      </div>
    </>
  );

  // ── Render ──

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-surface-900"
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
        forceMobileLayout={forceMobileLayout}
        onForceMobileLayoutChange={setForceMobileLayout}
        onProjectUpdated={(project) => setSelectedProject(project)}
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

      {/* ═══ Row 2: Main content ═══ */}
      <div
        className="relative min-h-0"
        style={{
          display: 'grid',
          gridTemplateColumns: isMobileLayout
            ? '1fr'
            : `${leftPanelCollapsed ? 'auto' : `${leftPanelWidth}px 4px`} 1fr 4px ${rightPanelWidth}px`,
          overflow: 'hidden',
        }}
      >
        {isMobileLayout && (
          <div className="absolute left-2 right-2 top-2 z-20 flex items-center justify-between pointer-events-none">
            <button
              onClick={() => setMobileDrawer('left')}
              className="pointer-events-auto flex items-center gap-1 rounded-full border border-surface-700/70 bg-surface-900/90 px-3 py-1.5 text-[11px] font-medium text-surface-200 shadow-lg backdrop-blur"
            >
              <PanelLeftOpen className="h-3.5 w-3.5" />
              Projects
            </button>
            <button
              onClick={() => setMobileDrawer('right')}
              className="pointer-events-auto flex items-center gap-1 rounded-full border border-surface-700/70 bg-surface-900/90 px-3 py-1.5 text-[11px] font-medium text-surface-200 shadow-lg backdrop-blur"
            >
              Tools
              <PanelRightOpen className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* ── Left Panel ── */}
        {!isMobileLayout && !leftPanelCollapsed ? (
          <>
            <div className="flex flex-col overflow-hidden bg-surface-850 border-r border-surface-700">
              {projectPanel}
            </div>

            {/* Left resizer */}
            <div
              className="bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
              onMouseDown={() => setIsResizing('left')}
            />
          </>
        ) : !isMobileLayout ? (
          <div className="flex flex-col items-center py-2 px-1 bg-surface-850 border-r border-surface-700">
            <button
              onClick={() => setLeftPanelCollapsed(false)}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {/* ── Center: Chat ── */}
        {/* Render cached ChatPanels - keeps them mounted for instant switching */}
        <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0, height: '100%', width: '100%' }}>
          {/* Sessions container - position relative with flex:1 to fill available space */}
          <div style={{ position: 'relative', flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}>
            {cachedProjectIds.map(projectId => {
              const chatProject = projectId === selectedProjectId
                ? selectedProject
                : projects.find((project) => project.id === projectId);
              const chatContainerRepos = projectId === selectedProjectId ? containerRepos : [];

              return (
                <div
                  key={projectId}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    visibility: projectId === selectedProjectId ? 'visible' : 'hidden',
                    pointerEvents: projectId === selectedProjectId ? 'auto' : 'none',
                    zIndex: projectId === selectedProjectId ? 1 : 0,
                    backgroundColor: '#0d1117',
                  }}
                >
                  <ChatPanel
                    projectId={projectId}
                    wsRef={chatWsRef}
                    wsConnectionVersion={wsConnectionVersion}
                    mode={agentMode}
                    tool={selectedTool}
                    isActive={projectId === selectedProjectId}
                    onUnreadChange={handleUnreadChange}
                    onProjectRead={handleProjectRead}
                    project={chatProject}
                    containerRepos={chatContainerRepos}
                    mobileLayout={isMobileLayout}
                    onProjectUpdated={(project) => setSelectedProject(project)}
                    onSelectedSessionFilesChange={(sessionId, files) => {
                      if (projectId === selectedProjectId) setSelectedSessionFiles(sessionId ? (files || []) : []);
                    }}
                  />
                </div>
              );
            })}
            {/* Show empty state if no project selected */}
            {!selectedProjectId && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div className="text-surface-500 text-center">
                  <p className="text-sm">Select a project to start chatting</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right resizer */}
        {!isMobileLayout && <div
          className="bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
          onMouseDown={() => setIsResizing('right')}
        />}

        {/* ── Right Panel ── */}
        {!isMobileLayout && <div className="overflow-hidden">
          <RightPanel
            projectId={selectedProjectId}
            projectPath={selectedProject?.folderPath}
            selectedTool={selectedTool}
            containerName={selectedProject?.containerName}
          />
        </div>}

        {isMobileLayout && mobileDrawer && (
          <div className="absolute inset-0 z-40 bg-surface-950/60 backdrop-blur-sm" onClick={() => setMobileDrawer(null)}>
            <div
              className={`absolute top-0 h-full w-[min(88vw,360px)] overflow-hidden border-surface-700 bg-surface-850 shadow-2xl ${
                mobileDrawer === 'left' ? 'left-0 border-r' : 'right-0 border-l'
              }`}
              onClick={(e) => e.stopPropagation()}
            >
              {mobileDrawer === 'left' ? (
                <div className="flex h-full flex-col overflow-hidden">
                  {projectPanel}
                </div>
              ) : (
                <div className="flex h-full flex-col overflow-hidden">
                  <div className="flex items-center justify-between border-b border-surface-700 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-surface-300">
                    Tools
                    <button
                      onClick={() => setMobileDrawer(null)}
                      className="rounded p-1 text-surface-400 hover:bg-surface-700 hover:text-surface-200"
                      title="Close tools"
                    >
                      <PanelRightClose className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <RightPanel
                    projectId={selectedProjectId}
                    projectPath={selectedProject?.folderPath}
                    selectedTool={selectedTool}
                    containerName={selectedProject?.containerName}
                  />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
