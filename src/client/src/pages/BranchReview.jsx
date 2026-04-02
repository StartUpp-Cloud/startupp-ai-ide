import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../contexts/ProjectContext";
import {
  ArrowLeft,
  GitBranch,
  GitCommit,
  FolderOpen,
  FileText,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  Edit3,
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Sparkles,
  RefreshCw,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const FILE_STATUS = {
  added: { label: "Added", color: "text-emerald-400", bg: "bg-emerald-400", icon: Plus, badge: "bg-emerald-500/15 text-emerald-400" },
  modified: { label: "Modified", color: "text-amber-400", bg: "bg-amber-400", icon: Edit3, badge: "bg-amber-500/15 text-amber-400" },
  deleted: { label: "Deleted", color: "text-rose-400", bg: "bg-rose-400", icon: Minus, badge: "bg-rose-500/15 text-rose-400" },
  renamed: { label: "Renamed", color: "text-blue-400", bg: "bg-blue-400", icon: GitBranch, badge: "bg-blue-500/15 text-blue-400" },
};

const IMPACT_STYLES = {
  high: { border: "border-rose-500/40", badge: "bg-rose-500/15 text-rose-400", dot: "bg-rose-400" },
  medium: { border: "border-amber-500/40", badge: "bg-amber-500/15 text-amber-400", dot: "bg-amber-400" },
  low: { border: "border-blue-500/40", badge: "bg-blue-500/15 text-blue-400", dot: "bg-blue-400" },
  cosmetic: { border: "border-surface-600", badge: "bg-surface-700 text-surface-300", dot: "bg-surface-400" },
};

const CATEGORY_STYLES = {
  feature: "bg-purple-500/15 text-purple-400",
  bugfix: "bg-rose-500/15 text-rose-400",
  refactor: "bg-blue-500/15 text-blue-400",
  config: "bg-surface-700 text-surface-300",
  test: "bg-emerald-500/15 text-emerald-400",
  docs: "bg-cyan-500/15 text-cyan-400",
  style: "bg-surface-700 text-surface-300",
};

const FILE_STATE = { pending: "pending", analyzing: "analyzing", done: "done", error: "error" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildFileTree(files) {
  const root = { name: "", children: {}, files: [] };

  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;

    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!node.children[dir]) {
        node.children[dir] = { name: dir, children: {}, files: [] };
      }
      node = node.children[dir];
    }

    node.files.push(file);
  }

  return root;
}

function flattenSingleChildDirs(node) {
  // Collapse directories that contain only a single child directory and no files
  const dirEntries = Object.entries(node.children);
  if (dirEntries.length === 1 && node.files.length === 0) {
    const [childName, childNode] = dirEntries[0];
    const flattened = flattenSingleChildDirs(childNode);
    return {
      ...flattened,
      name: node.name ? `${node.name}/${flattened.name}` : flattened.name,
    };
  }

  const newChildren = {};
  for (const [key, child] of Object.entries(node.children)) {
    const flattened = flattenSingleChildDirs(child);
    newChildren[flattened.name] = flattened;
  }

  return { ...node, children: newChildren };
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function BranchReview() {
  const navigate = useNavigate();
  const { projects } = useProjects();

  // Config state
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [mode, setMode] = useState("branch");
  const [baseBranch, setBaseBranch] = useState("main");
  const [commitCount, setCommitCount] = useState(5);
  const [currentBranch, setCurrentBranch] = useState(null); // current branch name for display

  // Analysis state
  const [phase, setPhase] = useState("idle"); // idle | loading | analyzing | done | error
  const [files, setFiles] = useState([]);
  const [fileStates, setFileStates] = useState({}); // path -> { state, explanation }
  const [summary, setSummary] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [globalError, setGlobalError] = useState(null);
  const [analyzedCount, setAnalyzedCount] = useState(0);

  // Abort controller ref for cancelling in-flight requests
  const abortRef = useRef(null);

  const eligibleProjects = useMemo(
    () => projects.filter((p) => p.folderPath),
    [projects],
  );

  const selectedProject = useMemo(
    () => eligibleProjects.find((p) => p.id === selectedProjectId),
    [eligibleProjects, selectedProjectId],
  );

  // Auto-select the first project if only one exists
  useEffect(() => {
    if (eligibleProjects.length === 1 && !selectedProjectId) {
      setSelectedProjectId(eligibleProjects[0].id);
    }
  }, [eligibleProjects, selectedProjectId]);

  // Fetch current branch when project changes
  useEffect(() => {
    if (!selectedProject?.folderPath) { setCurrentBranch(null); return; }
    fetch(`/api/orchestrator/git-info?projectPath=${encodeURIComponent(selectedProject.folderPath)}`)
      .then(r => r.json())
      .then(data => {
        if (data.isGitRepo) {
          setCurrentBranch(data.branch);
        } else {
          setCurrentBranch(null);
        }
      })
      .catch(() => setCurrentBranch(null));
  }, [selectedProject?.folderPath]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Analysis pipeline ────────────────────────────────────────────────────

  const runAnalysis = useCallback(async () => {
    if (!selectedProject) return;

    // Reset state
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("loading");
    setFiles([]);
    setFileStates({});
    setSummary(null);
    setSelectedFile(null);
    setGlobalError(null);
    setAnalyzedCount(0);

    try {
      // Step 1: Fetch changed files
      const params = new URLSearchParams({
        projectPath: selectedProject.folderPath,
        mode,
        baseBranch,
        ...(mode === "commits" && { commitCount: commitCount.toString() }),
      });

      const changesRes = await fetch(`/api/branch-review/changes?${params}`, {
        signal: controller.signal,
      });

      if (!changesRes.ok) {
        const err = await changesRes.json().catch(() => ({}));
        throw new Error(err.error || `Failed to fetch changes (${changesRes.status})`);
      }

      const changesData = await changesRes.json();
      const changedFiles = changesData.files || [];

      if (changedFiles.length === 0) {
        setPhase("done");
        setFiles([]);
        return;
      }

      setFiles(changedFiles);
      setPhase("analyzing");

      // Initialize all files as pending
      const initialStates = {};
      for (const f of changedFiles) {
        initialStates[f.path] = { state: FILE_STATE.pending, explanation: null };
      }
      setFileStates(initialStates);

      // Auto-select first file
      setSelectedFile(changedFiles[0].path);

      // Step 2: Explain each file progressively
      const explanations = [];
      let completed = 0;

      for (const file of changedFiles) {
        if (controller.signal.aborted) return;

        // Mark as analyzing
        setFileStates((prev) => ({
          ...prev,
          [file.path]: { ...prev[file.path], state: FILE_STATE.analyzing },
        }));

        try {
          const explainRes = await fetch("/api/branch-review/explain-file", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              projectPath: selectedProject.folderPath,
              filePath: file.path,
              diff: file.diff,
              status: file.status,
              projectId: selectedProject.id,
            }),
            signal: controller.signal,
          });

          if (!explainRes.ok) {
            throw new Error(`Failed to explain ${file.path}`);
          }

          const explanation = await explainRes.json();
          explanations.push({ filePath: file.path, ...explanation });

          setFileStates((prev) => ({
            ...prev,
            [file.path]: { state: FILE_STATE.done, explanation },
          }));
        } catch (fileErr) {
          if (controller.signal.aborted) return;
          setFileStates((prev) => ({
            ...prev,
            [file.path]: {
              state: FILE_STATE.error,
              explanation: { error: fileErr.message },
            },
          }));
        }

        completed++;
        setAnalyzedCount(completed);
      }

      if (controller.signal.aborted) return;

      // Step 3: Generate overall summary
      try {
        const summaryRes = await fetch("/api/branch-review/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectPath: selectedProject.folderPath,
            mode,
            baseBranch,
            projectId: selectedProject.id,
            fileExplanations: explanations,
          }),
          signal: controller.signal,
        });

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          setSummary(summaryData);
        }
      } catch (summaryErr) {
        if (!controller.signal.aborted) {
          console.error("Summary generation failed:", summaryErr);
        }
      }

      setPhase("done");
    } catch (err) {
      if (controller.signal.aborted) return;
      setGlobalError(err.message);
      setPhase("error");
    }
  }, [selectedProject, mode, baseBranch, commitCount]);

  // ── Computed data ────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const f of files) {
      if (counts[f.status] !== undefined) counts[f.status]++;
    }
    return counts;
  }, [files]);

  const progress = files.length > 0 ? (analyzedCount / files.length) * 100 : 0;

  const fileTree = useMemo(() => {
    if (files.length === 0) return null;
    return flattenSingleChildDirs(buildFileTree(files));
  }, [files]);

  const activeFileData = useMemo(() => {
    if (!selectedFile) return null;
    return files.find((f) => f.path === selectedFile) || null;
  }, [files, selectedFile]);

  const activeExplanation = useMemo(() => {
    if (!selectedFile || !fileStates[selectedFile]) return null;
    return fileStates[selectedFile];
  }, [selectedFile, fileStates]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-950 text-surface-100 flex flex-col">
      {/* ── Top Bar ── */}
      <header className="flex-shrink-0 border-b border-surface-700/60 bg-surface-900/80 backdrop-blur-md">
        <div className="flex items-center gap-4 px-5 py-3">
          <button
            onClick={() => navigate("/")}
            className="btn-ghost !px-2.5 !py-1.5 !gap-1.5 !text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to IDE
          </button>

          <div className="h-5 w-px bg-surface-700" />

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="font-display font-semibold text-white text-base tracking-tight">
              Branch Review
            </h1>
          </div>
        </div>
      </header>

      {/* ── Config Bar ── */}
      <div className="flex-shrink-0 border-b border-surface-700/60 bg-surface-900/50">
        <div className="flex items-center gap-3 px-5 py-3 flex-wrap">
          {/* Project selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-surface-400 uppercase tracking-wider">
              Project
            </label>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="select !py-1.5 !px-3 !text-sm !w-52"
              disabled={phase === "loading" || phase === "analyzing"}
            >
              <option value="">Select a project...</option>
              {eligibleProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Current branch indicator */}
          {currentBranch && (
            <>
              <div className="h-5 w-px bg-surface-700" />
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-500/10 border border-green-500/20 rounded-md">
                <GitBranch className="w-3.5 h-3.5 text-green-400" />
                <span className="text-sm font-mono font-medium text-green-300">{currentBranch}</span>
              </div>
            </>
          )}

          <div className="h-5 w-px bg-surface-700" />

          {/* Mode selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-surface-400 uppercase tracking-wider">
              Mode
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="select !py-1.5 !px-3 !text-sm !w-40"
              disabled={phase === "loading" || phase === "analyzing"}
            >
              <option value="branch">Branch Changes</option>
              <option value="commits">Recent Commits</option>
            </select>
          </div>

          {/* Branch / commit count */}
          {mode === "branch" ? (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-surface-400 uppercase tracking-wider">
                Base
              </label>
              <input
                type="text"
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                className="input !py-1.5 !px-3 !text-sm !w-28"
                placeholder="main"
                disabled={phase === "loading" || phase === "analyzing"}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-surface-400 uppercase tracking-wider">
                Commits
              </label>
              <input
                type="number"
                value={commitCount}
                onChange={(e) =>
                  setCommitCount(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))
                }
                min={1}
                max={50}
                className="input !py-1.5 !px-3 !text-sm !w-20"
                disabled={phase === "loading" || phase === "analyzing"}
              />
            </div>
          )}

          <div className="h-5 w-px bg-surface-700" />

          {/* Analyze button */}
          <button
            onClick={runAnalysis}
            disabled={
              !selectedProjectId ||
              phase === "loading" ||
              phase === "analyzing"
            }
            className="btn-primary !py-1.5 !px-4 !text-sm"
          >
            {phase === "loading" || phase === "analyzing" ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {phase === "loading" ? "Fetching..." : "Analyzing..."}
              </>
            ) : phase === "done" ? (
              <>
                <RefreshCw className="w-3.5 h-3.5" />
                Re-analyze
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                Analyze
              </>
            )}
          </button>

          {/* Progress indicator */}
          {phase === "analyzing" && files.length > 0 && (
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-surface-400">
                {analyzedCount}/{files.length} files
              </span>
              <div className="w-32 h-1.5 bg-surface-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex overflow-hidden">
        {phase === "idle" && <IdleState />}
        {phase === "loading" && <LoadingState />}
        {phase === "error" && <ErrorState error={globalError} onRetry={runAnalysis} />}
        {phase === "done" && files.length === 0 && <EmptyState mode={mode} />}

        {(phase === "analyzing" || (phase === "done" && files.length > 0)) && (
          <>
            {/* ── Left Panel ── */}
            <div className="w-[380px] flex-shrink-0 border-r border-surface-700/60 flex flex-col overflow-hidden bg-surface-900/30">
              {/* Summary Card */}
              {summary && (
                <SummaryCard summary={summary} stats={stats} />
              )}

              {/* File Tree */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center gap-2 mb-3">
                  <FolderOpen className="w-4 h-4 text-surface-400" />
                  <span className="text-xs font-medium text-surface-400 uppercase tracking-wider">
                    Changed Files
                  </span>
                  <span className="ml-auto badge bg-surface-800 text-surface-300">
                    {files.length}
                  </span>
                </div>

                {fileTree && (
                  <FileTreeNode
                    node={fileTree}
                    depth={0}
                    selectedFile={selectedFile}
                    fileStates={fileStates}
                    onSelect={setSelectedFile}
                    isRoot
                  />
                )}
              </div>
            </div>

            {/* ── Right Panel (File Detail) ── */}
            <div className="flex-1 overflow-y-auto bg-surface-950">
              {activeFileData ? (
                <FileDetailPanel
                  file={activeFileData}
                  explanationState={activeExplanation}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <FileText className="w-10 h-10 text-surface-600 mx-auto mb-3" />
                    <p className="text-surface-400 text-sm">
                      Select a file to view its analysis
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Idle State ──────────────────────────────────────────────────────────────

function IdleState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md animate-fade-in">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500/20 to-indigo-600/20 border border-purple-500/20 flex items-center justify-center mx-auto mb-5">
          <GitBranch className="w-7 h-7 text-purple-400" />
        </div>
        <h2 className="font-display text-xl font-semibold text-white mb-2">
          Ready to Review
        </h2>
        <p className="text-surface-400 text-sm leading-relaxed">
          Select a project and analysis mode above, then click{" "}
          <span className="text-primary-400 font-medium">Analyze</span> to get
          an AI-powered breakdown of your changes.
        </p>
      </div>
    </div>
  );
}

// ─── Loading State ───────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <div className="w-10 h-10 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin mx-auto mb-4" />
        <p className="text-surface-300 text-sm font-medium">
          Fetching changed files...
        </p>
        <p className="text-surface-500 text-xs mt-1">
          Comparing branches and computing diffs
        </p>
      </div>
    </div>
  );
}

// ─── Error State ─────────────────────────────────────────────────────────────

function ErrorState({ error, onRetry }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-danger-500/10 border border-danger-500/20 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-danger-400" />
        </div>
        <h3 className="font-display text-lg font-semibold text-white mb-2">
          Analysis Failed
        </h3>
        <p className="text-surface-400 text-sm mb-5 leading-relaxed">{error}</p>
        <button onClick={onRetry} className="btn-primary !text-sm">
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>
      </div>
    </div>
  );
}

// ─── Empty State ─────────────────────────────────────────────────────────────

function EmptyState({ mode }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-md animate-fade-in">
        <div className="w-14 h-14 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-6 h-6 text-success-400" />
        </div>
        <h3 className="font-display text-lg font-semibold text-white mb-2">
          No Changes Found
        </h3>
        <p className="text-surface-400 text-sm leading-relaxed">
          {mode === "branch"
            ? "This branch is up to date with the base branch. There are no differences to review."
            : "No changes found in the specified commit range."}
        </p>
      </div>
    </div>
  );
}

// ─── Summary Card ────────────────────────────────────────────────────────────

function SummaryCard({ summary, stats }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex-shrink-0 border-b border-surface-700/60 animate-slide-down">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-4 py-3 hover:bg-surface-800/50 transition-colors text-left"
      >
        <Sparkles className="w-4 h-4 text-primary-400 flex-shrink-0" />
        <span className="text-sm font-display font-semibold text-white truncate flex-1">
          {summary.title || "Analysis Summary"}
        </span>
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-surface-500 flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-surface-500 flex-shrink-0" />
        )}
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-3">
          {/* Stats bar */}
          <div className="flex items-center gap-2 flex-wrap">
            {stats.added > 0 && (
              <span className="badge bg-emerald-500/15 text-emerald-400">
                <Plus className="w-3 h-3" />
                {stats.added} added
              </span>
            )}
            {stats.modified > 0 && (
              <span className="badge bg-amber-500/15 text-amber-400">
                <Edit3 className="w-3 h-3" />
                {stats.modified} modified
              </span>
            )}
            {stats.deleted > 0 && (
              <span className="badge bg-rose-500/15 text-rose-400">
                <Minus className="w-3 h-3" />
                {stats.deleted} deleted
              </span>
            )}
            {stats.renamed > 0 && (
              <span className="badge bg-blue-500/15 text-blue-400">
                <GitBranch className="w-3 h-3" />
                {stats.renamed} renamed
              </span>
            )}
          </div>

          {/* Summary text */}
          {summary.summary && (
            <p className="text-surface-300 text-sm leading-relaxed">
              {summary.summary}
            </p>
          )}

          {/* Highlights */}
          {summary.highlights && summary.highlights.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-success-400" />
                <span className="text-xs font-medium text-surface-300 uppercase tracking-wider">
                  Highlights
                </span>
              </div>
              <ul className="space-y-1">
                {summary.highlights.map((h, i) => (
                  <li key={i} className="text-sm text-surface-300 flex gap-2">
                    <span className="text-success-400 mt-0.5 flex-shrink-0">-</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {summary.risks && summary.risks.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-medium text-surface-300 uppercase tracking-wider">
                  Risks
                </span>
              </div>
              <ul className="space-y-1">
                {summary.risks.map((r, i) => (
                  <li key={i} className="text-sm text-surface-300 flex gap-2">
                    <span className="text-amber-400 mt-0.5 flex-shrink-0">-</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── File Tree Node ──────────────────────────────────────────────────────────

function FileTreeNode({ node, depth, selectedFile, fileStates, onSelect, isRoot }) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = Object.keys(node.children).length > 0 || node.files.length > 0;
  const indent = depth * 16;

  const dirEntries = Object.entries(node.children).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const sortedFiles = [...node.files].sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  return (
    <div>
      {/* Directory name (skip root) */}
      {!isRoot && node.name && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full py-1 px-1 rounded hover:bg-surface-800/50 transition-colors group"
          style={{ paddingLeft: `${indent}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-surface-500 flex-shrink-0" />
          )}
          <FolderOpen className="w-3.5 h-3.5 text-primary-500/70 flex-shrink-0" />
          <span className="text-sm text-surface-300 truncate group-hover:text-surface-100 transition-colors">
            {node.name}
          </span>
        </button>
      )}

      {/* Children */}
      {(isRoot || expanded) && (
        <>
          {dirEntries.map(([key, child]) => (
            <FileTreeNode
              key={key}
              node={child}
              depth={isRoot ? depth : depth + 1}
              selectedFile={selectedFile}
              fileStates={fileStates}
              onSelect={onSelect}
            />
          ))}

          {sortedFiles.map((file) => {
            const fileName = file.path.split("/").pop();
            const statusDef = FILE_STATUS[file.status] || FILE_STATUS.modified;
            const fileState = fileStates[file.path];
            const isSelected = selectedFile === file.path;
            const fileIndent = (isRoot ? depth : depth + 1) * 16;

            return (
              <button
                key={file.path}
                onClick={() => onSelect(file.path)}
                className={`flex items-center gap-1.5 w-full py-1 px-1 rounded transition-colors group ${
                  isSelected
                    ? "bg-primary-500/10 text-white"
                    : "hover:bg-surface-800/50 text-surface-300"
                }`}
                style={{ paddingLeft: `${fileIndent + 20}px` }}
              >
                {/* Status icon */}
                <FileStateIcon
                  status={file.status}
                  analysisState={fileState?.state}
                />

                {/* File name */}
                <span
                  className={`text-sm truncate flex-1 text-left transition-colors ${
                    isSelected
                      ? "text-white"
                      : `${statusDef.color} group-hover:text-surface-100`
                  }`}
                >
                  {fileName}
                </span>

                {/* Analysis state indicator */}
                {fileState?.state === FILE_STATE.analyzing && (
                  <Loader2 className="w-3 h-3 text-primary-400 animate-spin flex-shrink-0" />
                )}
                {fileState?.state === FILE_STATE.done && (
                  <CheckCircle2 className="w-3 h-3 text-success-400/60 flex-shrink-0" />
                )}
                {fileState?.state === FILE_STATE.error && (
                  <AlertTriangle className="w-3 h-3 text-danger-400/60 flex-shrink-0" />
                )}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

// ─── File State Icon ─────────────────────────────────────────────────────────

function FileStateIcon({ status }) {
  const statusDef = FILE_STATUS[status] || FILE_STATUS.modified;
  const Icon = statusDef.icon;

  return (
    <div
      className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
        status === "added"
          ? "bg-emerald-500/20"
          : status === "deleted"
            ? "bg-rose-500/20"
            : status === "renamed"
              ? "bg-blue-500/20"
              : "bg-amber-500/20"
      }`}
    >
      <Icon className={`w-2.5 h-2.5 ${statusDef.color}`} />
    </div>
  );
}

// ─── File Detail Panel ───────────────────────────────────────────────────────

function FileDetailPanel({ file, explanationState }) {
  const [showDiff, setShowDiff] = useState(false);
  const explanation = explanationState?.explanation;
  const state = explanationState?.state || FILE_STATE.pending;
  const statusDef = FILE_STATUS[file.status] || FILE_STATUS.modified;

  const impact = explanation?.impact || "low";
  const category = explanation?.category || null;
  const impactStyle = IMPACT_STYLES[impact] || IMPACT_STYLES.low;
  const categoryStyle = category
    ? CATEGORY_STYLES[category] || CATEGORY_STYLES.config
    : null;

  return (
    <div className="p-6 max-w-4xl animate-fade-in">
      {/* File header */}
      <div className="flex items-start gap-3 mb-6">
        <FileStateIcon status={file.status} />

        <div className="flex-1 min-w-0">
          <h2 className="font-mono text-base text-white font-medium truncate">
            {file.path}
          </h2>

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {/* Status badge */}
            <span className={`badge ${statusDef.badge}`}>
              {statusDef.label}
            </span>

            {/* Category badge */}
            {state === FILE_STATE.done && category && (
              <span className={`badge ${categoryStyle} uppercase`}>
                {category}
              </span>
            )}

            {/* Impact badge */}
            {state === FILE_STATE.done && (
              <span className={`badge ${impactStyle.badge} uppercase`}>
                <span className={`w-1.5 h-1.5 rounded-full ${impactStyle.dot}`} />
                {impact} impact
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Analysis content */}
      <div className={`rounded-xl border p-5 mb-5 ${
        state === FILE_STATE.done
          ? impactStyle.border
          : "border-surface-700/60"
      } bg-surface-900/50`}>
        {state === FILE_STATE.pending && (
          <div className="flex items-center gap-3 text-surface-400">
            <div className="w-2 h-2 rounded-full bg-surface-500 animate-pulse" />
            <span className="text-sm">Waiting for analysis...</span>
          </div>
        )}

        {state === FILE_STATE.analyzing && (
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
            <span className="text-sm text-primary-300">
              Analyzing this file...
            </span>
          </div>
        )}

        {state === FILE_STATE.error && (
          <div className="flex items-center gap-3 text-danger-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">
              {explanation?.error || "Failed to analyze this file"}
            </span>
          </div>
        )}

        {state === FILE_STATE.done && explanation && !explanation.error && (
          <div className="space-y-4">
            {/* Main explanation */}
            {explanation.explanation && (
              <p className="text-surface-200 text-sm leading-relaxed">
                {explanation.explanation}
              </p>
            )}

            {/* Key changes */}
            {explanation.keyChanges && explanation.keyChanges.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-surface-400 uppercase tracking-wider mb-2">
                  Key Changes
                </h4>
                <ul className="space-y-1.5">
                  {explanation.keyChanges.map((change, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-surface-300"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 flex-shrink-0" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Diff Section */}
      {file.diff && (
        <div>
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="flex items-center gap-2 text-sm font-medium text-surface-400 hover:text-surface-200 transition-colors mb-3"
          >
            {showDiff ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span>Diff</span>
            <div className="h-px flex-1 bg-surface-700/60" />
          </button>

          {showDiff && (
            <div className="rounded-lg border border-surface-700/60 overflow-hidden bg-surface-900/80 animate-slide-down">
              <pre className="text-xs leading-relaxed overflow-x-auto p-4 font-mono">
                {file.diff.split("\n").map((line, i) => {
                  let lineClass = "text-surface-400";
                  if (line.startsWith("+") && !line.startsWith("+++")) {
                    lineClass = "text-emerald-400 bg-emerald-500/5";
                  } else if (line.startsWith("-") && !line.startsWith("---")) {
                    lineClass = "text-rose-400 bg-rose-500/5";
                  } else if (line.startsWith("@@")) {
                    lineClass = "text-blue-400 bg-blue-500/5";
                  }

                  return (
                    <div key={i} className={`${lineClass} px-2 -mx-2`}>
                      {line || " "}
                    </div>
                  );
                })}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
