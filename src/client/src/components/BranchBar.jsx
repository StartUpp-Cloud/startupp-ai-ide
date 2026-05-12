import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, ChevronDown, ArrowDownToLine, ArrowUpFromLine, Check,
  GitPullRequest, GitMerge, Loader, AlertCircle, RefreshCw, X,
  Folder, Trash2, Search, User, Users, Circle, Plus, KeyRound,
} from 'lucide-react';

// PR state display config
const PR_BADGE = {
  OPEN:   { color: 'text-green-400 bg-green-500/10', icon: GitPullRequest, label: 'open' },
  CLOSED: { color: 'text-red-400 bg-red-500/10', icon: GitPullRequest, label: 'closed' },
  MERGED: { color: 'text-purple-400 bg-purple-500/10', icon: GitMerge, label: 'merged' },
};

const BRANCH_FAST_TIMEOUT_MS = 6000;
const BRANCH_ENRICH_TIMEOUT_MS = 12000;

function buildQuery(params) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') query.set(key, value);
  });
  return query.toString();
}

function appendQuery(queryString, key, value) {
  const query = new URLSearchParams(queryString);
  query.set(key, value);
  return query.toString();
}

async function fetchJsonWithTimeout(url, { signal, timeoutMs }) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeoutMs);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function BranchItem({ branch, isActive, onSelect }) {
  const pr = branch.pr;
  const badge = pr ? PR_BADGE[pr.state] : null;
  const BadgeIcon = badge?.icon;

  return (
    <button
      onClick={() => onSelect(branch.name)}
      className={`w-full text-left px-3 py-1.5 hover:bg-surface-700/50 transition-colors flex items-center gap-2 min-w-0 ${
        isActive ? 'text-primary-400 bg-primary-500/5' : 'text-surface-300'
      }`}
    >
      <span className="text-[11px] font-mono truncate flex-1">{branch.name}</span>
      {badge && (
        <span className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] flex-shrink-0 ${badge.color}`}>
          <BadgeIcon size={9} />
          {badge.label}
        </span>
      )}
      {isActive && <Check size={10} className="flex-shrink-0 text-primary-400" />}
    </button>
  );
}

function SectionHeader({ icon: Icon, label, count }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-surface-700/50 bg-surface-850/50">
      <Icon size={10} className="text-surface-500" />
      <span className="text-[10px] uppercase tracking-wide text-surface-500">{label}</span>
      <span className="text-[9px] text-surface-600 ml-auto">{count}</span>
    </div>
  );
}

/**
 * BranchBar — sits above ChatInput, shows current branch + working directory
 * and git quick actions.
 */
export default function BranchBar({ containerName, session, projectId, onBranchChange, onSessionUpdate }) {
  const sessionBranch = session?.branch || null;
  const sessionRepoPath = session?.repoPath || null;
  const [gitStatus, setGitStatus] = useState(null);
  const [branchData, setBranchData] = useState(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [showCreateBranch, setShowCreateBranch] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [folders, setFolders] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [branchLoadError, setBranchLoadError] = useState(null);
  const [branchLoadKey, setBranchLoadKey] = useState(0);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  const switcherRef = useRef(null);
  const folderRef = useRef(null);
  const searchRef = useRef(null);
  const sshInputRef = useRef(null);
  const resultTimer = useRef(null);
  const statusAbortRef = useRef(null);
  const branchAbortRef = useRef(null);
  const branchRequestRef = useRef(0);

  const worktreePath = sessionBranch
    ? `/workspace/.worktrees/${sessionBranch.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    : null;
  // Priority: worktree > explicit user selection > workspace root.
  // Do not auto-detect a repo for the default state; multi-repo workspaces must
  // stay at /workspace until the user selects a folder or branch.
  const hasExplicitPath = sessionRepoPath !== null && sessionRepoPath !== undefined;
  const effectivePath = worktreePath || (hasExplicitPath ? sessionRepoPath : null) || '/workspace';
  const displayPath = effectivePath;
  const sourceRepoPath = worktreePath ? null : (hasExplicitPath ? sessionRepoPath : '/workspace');

  // Build query params for git endpoints; /workspace is passed explicitly.
  const gitPathQuery = buildQuery({
    worktreePath,
    repoPath: !worktreePath ? sourceRepoPath : null,
  });

  // Fetch git status
  const fetchStatus = useCallback((options = {}) => {
    if (!containerName) return;
    if (!options.force && typeof document !== 'undefined' && document.hidden) return;

    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    const query = options.force ? appendQuery(gitPathQuery, 'refresh', '1') : gitPathQuery;
    const suffix = query ? `?${query}` : '';

    fetch(`/api/containers/${containerName}/git-status${suffix}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGitStatus(data); })
      .catch(err => { if (err.name !== 'AbortError') {} });
  }, [containerName, gitPathQuery]);

  useEffect(() => {
    // Git status is side data; defer it so opening a chat session is not competing
    // with Docker/git polling during the first paint.
    const initialTimer = setTimeout(fetchStatus, 300);
    const interval = setInterval(fetchStatus, 10000);
    const handleVisibility = () => {
      if (!document.hidden) fetchStatus({ force: true });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      statusAbortRef.current?.abort();
    };
  }, [fetchStatus]);

  // Fetch local branches first, then enrich with remote branches and PR metadata in the background.
  useEffect(() => {
    if (!containerName || !showSwitcher) return;

    branchAbortRef.current?.abort();
    const controller = new AbortController();
    const requestId = branchRequestRef.current + 1;
    branchRequestRef.current = requestId;
    branchAbortRef.current = controller;
    let hasFastData = false;

    setBranchLoadError(null);
    setBranchData(prev => (prev?.repoPath && prev.repoPath === sourceRepoPath ? prev : null));

    const fetchBranches = async ({ includePr, includeRemote, timeoutMs }) => {
      const query = buildQuery({
        repoPath: sourceRepoPath,
        includePr: includePr ? '1' : '0',
        includeRemote: includeRemote ? '1' : '0',
      });
      const suffix = query ? `?${query}` : '';
      return fetchJsonWithTimeout(`/api/containers/${containerName}/branches${suffix}`, {
        signal: controller.signal,
        timeoutMs,
      });
    };

    const applyBranchData = (data) => {
      if (!data || branchRequestRef.current !== requestId || controller.signal.aborted) return;
      setBranchData(data);
    };

    fetchBranches({ includePr: false, includeRemote: false, timeoutMs: BRANCH_FAST_TIMEOUT_MS })
      .then(data => {
        hasFastData = true;
        applyBranchData(data);
        return fetchBranches({ includePr: true, includeRemote: true, timeoutMs: BRANCH_ENRICH_TIMEOUT_MS }).catch(() => null);
      })
      .then(applyBranchData)
      .catch(err => {
        if (controller.signal.aborted || branchRequestRef.current !== requestId) return;
        if (!hasFastData) {
          setBranchLoadError(err.name === 'AbortError'
            ? 'Branch loading timed out. Try again.'
            : 'Could not load branches. Try again.');
        }
      });

    return () => controller.abort();
  }, [containerName, showSwitcher, sourceRepoPath, branchLoadKey]);

  // Fetch workspace folders when folder picker opens
  useEffect(() => {
    if (!containerName || !showFolderPicker) return;
    fetch(`/api/containers/${containerName}/repos`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.repos) setFolders(data.repos); })
      .catch(() => {});
  }, [containerName, showFolderPicker]);

  // Close folder picker on outside click
  useEffect(() => {
    if (!showFolderPicker) return;
    const handler = (e) => {
      if (folderRef.current && !folderRef.current.contains(e.target)) setShowFolderPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showFolderPicker]);

  // Focus search when switcher opens
  useEffect(() => {
    if (showSwitcher) {
      setSearchQuery('');
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [showSwitcher]);

  // Close switcher on outside click
  useEffect(() => {
    if (!showSwitcher) return;
    const handler = (e) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target)) setShowSwitcher(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSwitcher]);

  const showResult = (type, success, message) => {
    setActionResult({ type, success, message });
    clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => setActionResult(null), 4000);
  };

  const bodyBase = worktreePath ? { worktreePath } : sourceRepoPath ? { repoPath: sourceRepoPath } : {};

  const cleanupWorktree = async (branchToClean) => {
    if (!branchToClean || !containerName) return;
    try {
      await fetch(`/api/containers/${containerName}/worktree-cleanup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: branchToClean }),
      });
    } catch { /* best-effort */ }
  };

  const handleAction = async (action) => {
    if (actionLoading) return;
    setActionLoading(action);
    setActionResult(null);

    try {
      let res, data;
      switch (action) {
        case 'pull':
          res = await fetch(`/api/containers/${containerName}/git-pull`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyBase),
          });
          data = await res.json();
          showResult('pull', res.ok, res.ok ? (data.output || 'Up to date') : data.error);
          break;

        case 'commit':
          res = await fetch(`/api/containers/${containerName}/git-commit-push`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyBase),
          });
          data = await res.json();
          showResult('commit', res.ok, res.ok ? `Pushed: ${data.message}` : data.error);
          break;

        case 'pr':
          res = await fetch(`/api/containers/${containerName}/git-create-pr`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyBase),
          });
          data = await res.json();
          if (res.ok && data.url) {
            showResult('pr', true, data.title);
            window.open(data.url, '_blank');
          } else {
            showResult('pr', res.ok, res.ok ? (data.output || 'PR created') : data.error);
          }
          break;

        case 'merge': {
          res = await fetch(`/api/containers/${containerName}/git-merge-pr`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...bodyBase, method: 'squash' }),
          });
          data = await res.json();
          if (res.ok) {
            showResult('merge', true, 'PR merged! Switching to default workspace...');
            const mergedBranch = sessionBranch;
            onBranchChange?.(null);
            cleanupWorktree(mergedBranch);
          } else {
            showResult('merge', false, data.error);
          }
          break;
        }
      }
      fetchStatus();
    } catch (err) {
      showResult(action, false, err.message);
    } finally {
      setActionLoading(null);
    }
  };

  const handleSshUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !containerName) return;

    setActionLoading('ssh');
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    try {
      const res = await fetch(`/api/containers/${containerName}/ssh-keys`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        const ok = data.uploaded?.filter(u => !u.error).length || 0;
        showResult('ssh', true, `${ok} SSH key${ok !== 1 ? 's' : ''} uploaded to ~/.ssh`);
      } else {
        showResult('ssh', false, data.error || 'SSH key upload failed');
      }
    } catch (err) {
      showResult('ssh', false, err.message);
    } finally {
      setActionLoading(null);
      if (sshInputRef.current) sshInputRef.current.value = '';
    }
  };

  const handleCreateBranch = async () => {
    const name = newBranchName.trim();
    if (!name || !containerName) return;

    setShowCreateBranch(false);
    setShowSwitcher(false);
    setNewBranchName('');

    // The worktree endpoint already handles creating new branches from HEAD
    // when the branch doesn't exist locally or on remote
    try {
      const res = await fetch(`/api/containers/${containerName}/worktree`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch: name, ...(sourceRepoPath ? { repoPath: sourceRepoPath } : {}) }),
      });
      if (!res.ok) {
        const err = await res.json();
        showResult('create', false, err.detail || err.error || 'Failed to create branch');
        return;
      }
      const data = await res.json();
      setGitStatus(null);
      setBranchData(null);
      setBranchLoadError(null);
      const sessionUpdates = { branch: name };
      if (data.repoPath && data.repoPath !== '/workspace') sessionUpdates.repoPath = data.repoPath;
      if (data.worktreePath && !data.worktreePath.includes('.worktrees')) {
        sessionUpdates.repoPath = data.worktreePath;
      }
      if (onSessionUpdate) {
        onSessionUpdate(sessionUpdates);
      } else {
        onBranchChange?.(name);
      }
      showResult('create', true, `Created branch '${name}'`);
    } catch (err) {
      showResult('create', false, err.message);
    }
  };

  const handleBranchSwitch = async (branch) => {
    setShowSwitcher(false);
    if (branch === sessionBranch) return;

    if (!branch) {
      setGitStatus(null);
      setBranchData(null);
      setBranchLoadError(null);
      if (onSessionUpdate) {
        onSessionUpdate({ branch: null, repoPath: '/workspace' });
      } else {
        onBranchChange?.(null);
      }
      return;
    }

    try {
      const res = await fetch(`/api/containers/${containerName}/worktree`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branch, ...(sourceRepoPath ? { repoPath: sourceRepoPath } : {}) }),
      });
      if (!res.ok) {
        const err = await res.json();
        const msg = err.detail
          ? `${err.error}: ${err.detail}`
          : err.error || 'Failed to create worktree';
        showResult('switch', false, msg);
        return;
      }
      const data = await res.json();
      // If the branch is checked out at a non-standard location (e.g. main repo),
      // also update the session repoPath so the folder picker reflects it
      const sessionUpdates = { branch };
      if (data.repoPath && data.repoPath !== '/workspace') sessionUpdates.repoPath = data.repoPath;
      if (data.reused && data.worktreePath && !data.worktreePath.includes('.worktrees')) {
        sessionUpdates.repoPath = data.worktreePath;
      }
      if (Object.keys(sessionUpdates).length > 1 && onSessionUpdate) {
        setGitStatus(null);
        setBranchData(null);
        setBranchLoadError(null);
        onSessionUpdate(sessionUpdates);
        return;
      }
    } catch (err) {
      showResult('switch', false, err.message);
      return;
    }

    setGitStatus(null);
    setBranchData(null);
    setBranchLoadError(null);
    onBranchChange?.(branch || null);
  };

  if (!containerName) return null;

  // Session branch (user's explicit selection) takes priority over polled git status
  const branch = sessionBranch || gitStatus?.branch || 'Workspace';
  const isMain = ['main', 'master'].includes(branch);
  const pr = gitStatus?.pr;
  const hasDirty = gitStatus?.dirty > 0;
  const hasAhead = gitStatus?.ahead > 0;
  const hasBehind = gitStatus?.behind > 0;

  // Build categorized branch list for the switcher
  const buildGroups = () => {
    if (!branchData) return null;
    const { branches: enriched = [], remoteBranches = [] } = branchData;
    const q = searchQuery.toLowerCase();

    // Filter by search
    const filtered = enriched.filter(b => !q || b.name.toLowerCase().includes(q));
    const filteredRemote = remoteBranches.filter(b => !q || b.toLowerCase().includes(q));

    // Separate mine vs others
    const mine = filtered.filter(b => b.isMine);
    const others = filtered.filter(b => !b.isMine);

    // Within each group, sort: open PRs first, then no PR, then merged/closed
    const prOrder = { OPEN: 0, undefined: 1, CLOSED: 2, MERGED: 3 };
    const sortFn = (a, b) => {
      const aOrder = prOrder[a.pr?.state] ?? 1;
      const bOrder = prOrder[b.pr?.state] ?? 1;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    };
    mine.sort(sortFn);
    others.sort(sortFn);

    // Remote branches as simple objects
    const remoteItems = filteredRemote.map(name => ({ name, pr: null, isMine: false }));

    return { mine, others, remote: remoteItems };
  };

  const groups = showSwitcher ? buildGroups() : null;
  const totalResults = groups
    ? groups.mine.length + groups.others.length + groups.remote.length
    : 0;

  const prBadge = pr ? PR_BADGE[pr.state] : null;
  const PrIcon = prBadge?.icon;

  return (
    <div className="flex-shrink-0 px-4 pt-1.5 pb-0.5 w-full">
      {/* Row 1: Branch + path + status badges */}
      <div className="flex items-center gap-1.5 w-full min-w-0">
        {/* Branch name + switcher */}
        <div className="relative flex-shrink-0" ref={switcherRef}>
          <button
            onClick={() => setShowSwitcher(!showSwitcher)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-mono transition-colors ${
              isMain
                ? 'bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20'
                : sessionBranch
                ? 'bg-green-500/10 text-green-300 hover:bg-green-500/20'
                : 'bg-surface-700/50 text-surface-300 hover:bg-surface-700'
            }`}
          >
            <GitBranch size={12} />
            <span className="truncate max-w-[140px]">{branch}</span>
            <ChevronDown size={10} />
          </button>

          {/* Branch switcher panel */}
          {showSwitcher && (
            <div className="absolute bottom-full left-0 mb-1 w-80 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl z-50 overflow-hidden">
              {/* Search */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700">
                <Search size={12} className="text-surface-500 flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search branches..."
                  className="flex-1 bg-transparent text-[11px] text-surface-200 outline-none placeholder:text-surface-500"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-surface-500 hover:text-surface-300">
                    <X size={10} />
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto">
                {/* Default workspace option */}
                {(!searchQuery || 'default workspace'.includes(searchQuery.toLowerCase())) && (
                  <button
                    onClick={() => handleBranchSwitch('')}
                    className={`w-full text-left px-3 py-2 text-[11px] hover:bg-surface-700/50 transition-colors flex items-center gap-2 border-b border-surface-700/30 ${
                      !sessionBranch ? 'text-primary-400 bg-primary-500/5' : 'text-surface-300'
                    }`}
                  >
                    <Folder size={11} className="flex-shrink-0" />
                    <span className="flex-1">Default workspace</span>
                    <span className="text-[9px] text-surface-500 font-mono">/workspace</span>
                    {!sessionBranch && <Check size={10} className="flex-shrink-0 text-primary-400" />}
                  </button>
                )}

                {!groups ? (
                  branchLoadError ? (
                    <div className="px-3 py-4 text-center text-[11px] text-surface-400 space-y-2">
                      <div className="flex items-center justify-center gap-1.5 text-red-400">
                        <AlertCircle size={12} />
                        <span>{branchLoadError}</span>
                      </div>
                      <button
                        onClick={() => {
                          setBranchLoadError(null);
                          setBranchLoadKey(k => k + 1);
                        }}
                        className="px-2 py-1 rounded bg-surface-700 hover:bg-surface-600 text-surface-200 transition-colors"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-surface-500">
                      <Loader size={14} className="animate-spin" />
                      Loading branches...
                    </div>
                  )
                ) : totalResults === 0 && searchQuery ? (
                  <div className="px-3 py-4 text-center text-[11px] text-surface-500">
                    No branches matching "{searchQuery}"
                  </div>
                ) : totalResults === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-surface-500">
                    No branches found
                  </div>
                ) : (
                  <>
                    {/* My branches */}
                    {groups.mine.length > 0 && (
                      <>
                        <SectionHeader icon={User} label="My branches" count={groups.mine.length} />
                        {groups.mine.map(b => (
                          <BranchItem key={b.name} branch={b} isActive={b.name === sessionBranch} onSelect={handleBranchSwitch} />
                        ))}
                      </>
                    )}

                    {/* Other branches */}
                    {groups.others.length > 0 && (
                      <>
                        <SectionHeader icon={Users} label="Other branches" count={groups.others.length} />
                        {groups.others.map(b => (
                          <BranchItem key={b.name} branch={b} isActive={b.name === sessionBranch} onSelect={handleBranchSwitch} />
                        ))}
                      </>
                    )}

                    {/* Remote-only branches */}
                    {groups.remote.length > 0 && (
                      <>
                        <SectionHeader icon={Circle} label="Remote only" count={groups.remote.length} />
                        {groups.remote.map(b => (
                          <BranchItem key={`r-${b.name}`} branch={b} isActive={b.name === sessionBranch} onSelect={handleBranchSwitch} />
                        ))}
                      </>
                    )}
                  </>
                )}

                {/* Create Branch */}
                <div className="border-t border-surface-700 px-2 py-2">
                  {showCreateBranch ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newBranchName}
                        onChange={(e) => setNewBranchName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBranch(); if (e.key === 'Escape') setShowCreateBranch(false); }}
                        placeholder="feature/my-branch"
                        className="flex-1 bg-surface-900 border border-surface-600 rounded px-2 py-1 text-[11px] font-mono text-surface-200 outline-none focus:border-primary-500/50"
                        autoFocus
                      />
                      <button
                        onClick={handleCreateBranch}
                        disabled={!newBranchName.trim()}
                        className="px-2 py-1 text-[10px] bg-primary-600 hover:bg-primary-500 text-white rounded disabled:opacity-40 transition-colors"
                      >
                        Create
                      </button>
                      <button
                        onClick={() => { setShowCreateBranch(false); setNewBranchName(''); }}
                        className="p-1 text-surface-500 hover:text-surface-300"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowCreateBranch(true)}
                      className="w-full flex items-center justify-center gap-1.5 px-2 py-1 text-[10px] text-primary-400 hover:text-primary-300 hover:bg-primary-500/10 rounded transition-colors"
                    >
                      <Plus size={11} />
                      Create Branch
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Working directory — clickable to switch folders */}
        <div className="relative min-w-0" ref={folderRef}>
          <button
            onClick={() => { if (!worktreePath) setShowFolderPicker(!showFolderPicker); }}
            disabled={!!worktreePath}
            className={`flex items-center gap-1 min-w-0 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
              worktreePath
                ? 'text-surface-500 cursor-default'
                : 'text-surface-400 hover:text-surface-200 hover:bg-surface-700/50'
            }`}
            title={worktreePath ? `Worktree: ${displayPath}` : 'Click to change folder'}
          >
            <Folder size={10} className="flex-shrink-0" />
            <span className="truncate">{displayPath}</span>
            {!worktreePath && <ChevronDown size={9} className="flex-shrink-0 opacity-60" />}
          </button>

          {/* Folder picker dropdown */}
          {showFolderPicker && (
            <div className="absolute bottom-full left-0 mb-1 w-72 bg-surface-800 border border-surface-600 rounded-lg shadow-2xl z-50 overflow-hidden">
              <div className="px-2 py-1.5 border-b border-surface-700 text-[10px] uppercase tracking-wide text-surface-500">
                Working directory
              </div>
              {/* Default /workspace option — highlight if effective path is /workspace */}
              <button
                onClick={() => { setGitStatus(null); onSessionUpdate?.({ repoPath: '/workspace' }); setShowFolderPicker(false); }}
                className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-surface-700/50 transition-colors flex items-center gap-2 ${
                  displayPath === '/workspace' ? 'text-primary-400' : 'text-surface-300'
                }`}
              >
                <Folder size={11} className="flex-shrink-0" />
                <span className="truncate flex-1">/workspace</span>
                <span className="text-[9px] text-surface-500">root</span>
                {displayPath === '/workspace' && <Check size={10} className="flex-shrink-0 text-primary-400" />}
              </button>
              {!folders ? (
                <div className="flex items-center justify-center py-4">
                  <Loader size={14} className="animate-spin text-surface-500" />
                </div>
              ) : folders.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-surface-500 text-center">No subdirectories found</div>
              ) : (
                folders.map(f => (
                  <button
                    key={f.path}
                    onClick={() => { setGitStatus(null); onSessionUpdate?.({ repoPath: f.path }); setShowFolderPicker(false); }}
                    className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-surface-700/50 transition-colors flex items-center gap-2 ${
                      displayPath === f.path ? 'text-primary-400' : 'text-surface-300'
                    }`}
                  >
                    <Folder size={11} className="flex-shrink-0" />
                    <span className="truncate flex-1">{f.path}</span>
                    {f.isGitRepo && (
                      <span className="flex items-center gap-0.5 text-[9px] text-green-400 flex-shrink-0">
                        <GitBranch size={8} />
                        {f.branch || 'git'}
                      </span>
                    )}
                    {displayPath === f.path && <Check size={10} className="flex-shrink-0 text-primary-400" />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          {hasDirty && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-yellow-500/10 text-yellow-400">
              {gitStatus.dirty} change{gitStatus.dirty !== 1 ? 's' : ''}
            </span>
          )}
          {hasAhead && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-green-500/10 text-green-400">
              {gitStatus.ahead}&uarr;
            </span>
          )}
          {hasBehind && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400">
              {gitStatus.behind}&darr;
            </span>
          )}
          {pr && PrIcon && (
            <a
              href={pr.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] hover:bg-surface-600/50 transition-colors ${prBadge.color}`}
              title={`PR #${pr.number}: ${pr.title}`}
            >
              <PrIcon size={10} />
              #{pr.number} {prBadge.label}
            </a>
          )}
        </div>
      </div>

      {/* Row 2: Quick actions */}
      <div className="flex items-center gap-0.5 mt-0.5">
        <button
          onClick={() => fetchStatus({ force: true })}
          className="p-1 text-surface-500 hover:text-surface-200 rounded transition-colors"
          title="Refresh status"
        >
          <RefreshCw size={11} />
        </button>

        <button
          onClick={() => handleAction('pull')}
          disabled={!!actionLoading}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-700/50 rounded transition-colors disabled:opacity-40"
          title="Pull latest"
        >
          {actionLoading === 'pull' ? <Loader size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
          Pull
        </button>

        {/* Create Branch — always visible in action bar */}
        {showCreateBranch ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBranch(); if (e.key === 'Escape') { setShowCreateBranch(false); setNewBranchName(''); } }}
              placeholder="feature/my-branch"
              className="w-40 bg-surface-900 border border-surface-600 rounded px-1.5 py-0.5 text-[10px] font-mono text-surface-200 outline-none focus:border-primary-500/50"
              autoFocus
            />
            <button
              onClick={handleCreateBranch}
              disabled={!newBranchName.trim()}
              className="px-1.5 py-0.5 text-[10px] bg-primary-600 hover:bg-primary-500 text-white rounded disabled:opacity-40 transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setShowCreateBranch(false); setNewBranchName(''); }}
              className="p-0.5 text-surface-500 hover:text-surface-300"
            >
              <X size={10} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowCreateBranch(true)}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-primary-400 hover:text-primary-300 hover:bg-primary-500/10 rounded transition-colors"
            title="Create a new branch and switch to it"
          >
            <Plus size={11} />
            Branch
          </button>
        )}

        {hasDirty && (
          <button
            onClick={() => handleAction('commit')}
            disabled={!!actionLoading}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors disabled:opacity-40"
            title="Auto-commit and push all changes"
          >
            {actionLoading === 'commit' ? <Loader size={11} className="animate-spin" /> : <ArrowUpFromLine size={11} />}
            Commit &amp; Push
          </button>
        )}

        {!isMain && !pr && (
          <button
            onClick={() => handleAction('pr')}
            disabled={!!actionLoading}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors disabled:opacity-40"
            title="Create pull request"
          >
            {actionLoading === 'pr' ? <Loader size={11} className="animate-spin" /> : <GitPullRequest size={11} />}
            Create PR
          </button>
        )}

        {pr?.state === 'OPEN' && (
          <button
            onClick={() => handleAction('merge')}
            disabled={!!actionLoading}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors disabled:opacity-40"
            title="Squash and merge PR, then switch to default workspace"
          >
            {actionLoading === 'merge' ? <Loader size={11} className="animate-spin" /> : <GitMerge size={11} />}
            Merge PR
          </button>
        )}

        {sessionBranch && pr?.state === 'MERGED' && (
          <button
            onClick={() => {
              cleanupWorktree(sessionBranch);
              onBranchChange?.(null);
              showResult('cleanup', true, `Cleaned up worktree for ${sessionBranch}`);
            }}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
            title="Remove worktree and switch to default workspace"
          >
            <Trash2 size={11} />
            Clean up
          </button>
        )}

        {/* SSH key upload */}
        <input
          ref={sshInputRef}
          type="file"
          multiple
          onChange={handleSshUpload}
          className="hidden"
        />
        <button
          onClick={() => sshInputRef.current?.click()}
          disabled={!!actionLoading}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-700/50 rounded transition-colors disabled:opacity-40 ml-auto"
          title="Upload SSH keys to container ~/.ssh"
        >
          {actionLoading === 'ssh' ? <Loader size={11} className="animate-spin" /> : <KeyRound size={11} />}
          SSH Keys
        </button>
      </div>

      {/* Action result toast */}
      {actionResult && (
        <div className={`flex items-center gap-1.5 mt-1 px-2 py-1 rounded text-[10px] ${
          actionResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
        }`}>
          {actionResult.success ? <Check size={10} /> : <AlertCircle size={10} />}
          <span className="truncate flex-1">{actionResult.message}</span>
          <button onClick={() => setActionResult(null)} className="p-0.5 hover:text-surface-200">
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
