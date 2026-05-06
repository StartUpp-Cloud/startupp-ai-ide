import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, ChevronDown, ArrowDownToLine, ArrowUpFromLine, Check,
  GitPullRequest, GitMerge, Loader, AlertCircle, RefreshCw, X,
  Folder, Trash2, Search, User, Users, Circle,
} from 'lucide-react';

// PR state display config
const PR_BADGE = {
  OPEN:   { color: 'text-green-400 bg-green-500/10', icon: GitPullRequest, label: 'open' },
  CLOSED: { color: 'text-red-400 bg-red-500/10', icon: GitPullRequest, label: 'closed' },
  MERGED: { color: 'text-purple-400 bg-purple-500/10', icon: GitMerge, label: 'merged' },
};

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
  const [folders, setFolders] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(null);
  const [actionResult, setActionResult] = useState(null);
  const switcherRef = useRef(null);
  const folderRef = useRef(null);
  const searchRef = useRef(null);
  const resultTimer = useRef(null);

  const worktreePath = sessionBranch
    ? `/workspace/.worktrees/${sessionBranch.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    : null;
  // Priority: worktree > explicit user selection > auto-detected > fallback
  const effectivePath = worktreePath || sessionRepoPath || gitStatus?.repoPath || '/workspace';
  const displayPath = effectivePath;

  // Build query params for git endpoints — explicit path always sent
  const gitPathQuery = (() => {
    if (worktreePath) return `worktreePath=${encodeURIComponent(worktreePath)}`;
    if (sessionRepoPath) return `repoPath=${encodeURIComponent(sessionRepoPath)}`;
    return '';
  })();

  // Fetch git status
  const fetchStatus = useCallback(() => {
    if (!containerName) return;
    fetch(`/api/containers/${containerName}/git-status?${gitPathQuery}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setGitStatus(data); })
      .catch(() => {});
  }, [containerName, gitPathQuery]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Fetch enriched branches when switcher opens
  useEffect(() => {
    if (!containerName || !showSwitcher) return;
    const repoParam = sessionRepoPath ? `?repoPath=${encodeURIComponent(sessionRepoPath)}` : '';
    fetch(`/api/containers/${containerName}/branches${repoParam}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBranchData(data); })
      .catch(() => {});
  }, [containerName, showSwitcher, sessionRepoPath]);

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

  const bodyBase = worktreePath ? { worktreePath } : {};

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

  const handleBranchSwitch = async (branch) => {
    setShowSwitcher(false);
    if (branch === sessionBranch) return;

    if (branch && branch !== '') {
      try {
        const res = await fetch(`/api/containers/${containerName}/worktree`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch }),
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
        if (data.reused && data.worktreePath && !data.worktreePath.includes('.worktrees')) {
          setGitStatus(null);
          onSessionUpdate?.({ branch, repoPath: data.worktreePath });
          return;
        }
      } catch (err) {
        showResult('switch', false, err.message);
        return;
      }
    }

    setGitStatus(null);
    onBranchChange?.(branch || null);
  };

  if (!containerName) return null;

  const branch = gitStatus?.branch || sessionBranch || 'main';
  const isMain = !sessionBranch && ['main', 'master'].includes(branch);
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
                  <div className="flex items-center justify-center py-6">
                    <Loader size={14} className="animate-spin text-surface-500" />
                  </div>
                ) : totalResults === 0 && searchQuery ? (
                  <div className="px-3 py-4 text-center text-[11px] text-surface-500">
                    No branches matching "{searchQuery}"
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
                onClick={() => { setGitStatus(null); onSessionUpdate?.({ repoPath: null }); setShowFolderPicker(false); }}
                className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-surface-700/50 transition-colors flex items-center gap-2 ${
                  displayPath === '/workspace' ? 'text-primary-400' : 'text-surface-300'
                }`}
              >
                <Folder size={11} className="flex-shrink-0" />
                <span className="truncate flex-1">/workspace</span>
                <span className="text-[9px] text-surface-500">auto-detect</span>
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
          onClick={fetchStatus}
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
