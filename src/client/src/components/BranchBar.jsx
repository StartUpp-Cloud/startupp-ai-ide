import { useState, useEffect, useCallback, useRef } from 'react';
import {
  GitBranch, ChevronDown, ArrowDownToLine, ArrowUpFromLine, Check,
  GitPullRequest, GitMerge, Loader, AlertCircle, RefreshCw, X,
} from 'lucide-react';

/**
 * BranchBar — sits above ChatInput, shows current branch info and git quick actions.
 * Similar to Claude Code desktop's branch indicator.
 */
export default function BranchBar({ containerName, session, projectId, onBranchChange }) {
  const sessionBranch = session?.branch || null;
  const [gitStatus, setGitStatus] = useState(null);
  const [branches, setBranches] = useState(null);
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [actionLoading, setActionLoading] = useState(null); // 'pull' | 'commit' | 'pr' | 'merge'
  const [actionResult, setActionResult] = useState(null);   // { type, success, message }
  const switcherRef = useRef(null);
  const resultTimer = useRef(null);

  // Resolve the git path based on session branch
  const gitPathQuery = sessionBranch
    ? `worktreePath=${encodeURIComponent(`/workspace/.worktrees/${sessionBranch.replace(/[^a-zA-Z0-9._-]/g, '-')}`)}`
    : '';

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

  // Fetch branches for switcher
  useEffect(() => {
    if (!containerName || !showSwitcher) return;
    fetch(`/api/containers/${containerName}/branches`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.branches) {
          const localSet = new Set(data.branches);
          const remote = (data.remoteBranches || [])
            .map(b => b.replace(/^origin\//, ''))
            .filter(b => !localSet.has(b));
          setBranches([...data.branches, ...remote]);
        }
      })
      .catch(() => {});
  }, [containerName, showSwitcher]);

  // Close switcher on outside click
  useEffect(() => {
    if (!showSwitcher) return;
    const handler = (e) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target)) setShowSwitcher(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showSwitcher]);

  // Auto-dismiss result after 4s
  const showResult = (type, success, message) => {
    setActionResult({ type, success, message });
    clearTimeout(resultTimer.current);
    resultTimer.current = setTimeout(() => setActionResult(null), 4000);
  };

  const handleAction = async (action) => {
    if (actionLoading) return;
    setActionLoading(action);
    setActionResult(null);

    const bodyBase = sessionBranch
      ? { worktreePath: `/workspace/.worktrees/${sessionBranch.replace(/[^a-zA-Z0-9._-]/g, '-')}` }
      : {};

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

        case 'merge':
          res = await fetch(`/api/containers/${containerName}/git-merge-pr`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...bodyBase, method: 'squash' }),
          });
          data = await res.json();
          showResult('merge', res.ok, res.ok ? (data.output || 'PR merged') : data.error);
          break;
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
      // Ensure worktree before switching
      try {
        const res = await fetch(`/api/containers/${containerName}/worktree`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch }),
        });
        if (!res.ok) {
          const err = await res.json();
          showResult('switch', false, err.error || 'Failed to create worktree');
          return;
        }
      } catch (err) {
        showResult('switch', false, err.message);
        return;
      }
    }

    onBranchChange?.(branch || null);
  };

  if (!containerName) return null;

  const branch = gitStatus?.branch || sessionBranch || 'main';
  const isMain = ['main', 'master'].includes(branch);
  const pr = gitStatus?.pr;
  const hasDirty = gitStatus?.dirty > 0;
  const hasAhead = gitStatus?.ahead > 0;
  const hasBehind = gitStatus?.behind > 0;

  const prStateColors = {
    OPEN: 'text-green-400',
    CLOSED: 'text-red-400',
    MERGED: 'text-purple-400',
  };

  return (
    <div className="flex-shrink-0 px-4 pt-1 pb-0.5 w-full">
      <div className="flex items-center gap-1.5 w-full min-w-0 flex-wrap">

        {/* Branch name + switcher */}
        <div className="relative" ref={switcherRef}>
          <button
            onClick={() => setShowSwitcher(!showSwitcher)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-mono transition-colors ${
              isMain
                ? 'bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20'
                : 'bg-green-500/10 text-green-300 hover:bg-green-500/20'
            }`}
          >
            <GitBranch size={12} />
            <span className="truncate max-w-[140px]">{branch}</span>
            <ChevronDown size={10} />
          </button>

          {/* Branch switcher dropdown */}
          {showSwitcher && branches && (
            <div className="absolute bottom-full left-0 mb-1 w-56 max-h-64 overflow-y-auto bg-surface-800 border border-surface-600 rounded-lg shadow-2xl z-50">
              <div className="px-2 py-1.5 border-b border-surface-700 text-[10px] uppercase tracking-wide text-surface-500">
                Switch branch
              </div>
              <button
                onClick={() => handleBranchSwitch('')}
                className={`w-full text-left px-3 py-1.5 text-[11px] hover:bg-surface-700/50 transition-colors flex items-center gap-2 ${
                  !sessionBranch ? 'text-primary-400' : 'text-surface-300'
                }`}
              >
                Default workspace
                {!sessionBranch && <Check size={10} className="ml-auto" />}
              </button>
              {branches.map(b => (
                <button
                  key={b}
                  onClick={() => handleBranchSwitch(b)}
                  className={`w-full text-left px-3 py-1.5 text-[11px] font-mono hover:bg-surface-700/50 transition-colors flex items-center gap-2 ${
                    b === sessionBranch ? 'text-primary-400' : 'text-surface-300'
                  }`}
                >
                  <span className="truncate">{b}</span>
                  {b === sessionBranch && <Check size={10} className="ml-auto flex-shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status badges */}
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

        {/* PR status badge */}
        {pr && (
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-surface-700/50 hover:bg-surface-600/50 transition-colors ${
              prStateColors[pr.state] || 'text-surface-400'
            }`}
            title={`PR #${pr.number}: ${pr.title}`}
          >
            {pr.state === 'MERGED' ? <GitMerge size={10} /> : <GitPullRequest size={10} />}
            #{pr.number} {pr.state?.toLowerCase()}
          </a>
        )}

        {/* Quick actions */}
        <div className="flex items-center gap-0.5 ml-auto">
          {/* Refresh */}
          <button
            onClick={fetchStatus}
            className="p-1 text-surface-500 hover:text-surface-200 rounded transition-colors"
            title="Refresh status"
          >
            <RefreshCw size={12} />
          </button>

          {/* Pull */}
          <button
            onClick={() => handleAction('pull')}
            disabled={!!actionLoading}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-surface-400 hover:text-surface-200 hover:bg-surface-700/50 rounded transition-colors disabled:opacity-40"
            title="Pull latest"
          >
            {actionLoading === 'pull' ? <Loader size={11} className="animate-spin" /> : <ArrowDownToLine size={11} />}
            Pull
          </button>

          {/* Commit & Push */}
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

          {/* Create PR */}
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

          {/* Merge PR */}
          {pr?.state === 'OPEN' && (
            <button
              onClick={() => handleAction('merge')}
              disabled={!!actionLoading}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors disabled:opacity-40"
              title="Squash and merge PR"
            >
              {actionLoading === 'merge' ? <Loader size={11} className="animate-spin" /> : <GitMerge size={11} />}
              Merge PR
            </button>
          )}
        </div>
      </div>

      {/* Action result toast */}
      {actionResult && (
        <div className={`flex items-center gap-1.5 mt-1 px-2 py-1 rounded text-[10px] ${
          actionResult.success
            ? 'bg-green-500/10 text-green-400'
            : 'bg-red-500/10 text-red-400'
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
