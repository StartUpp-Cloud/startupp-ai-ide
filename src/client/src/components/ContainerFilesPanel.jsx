import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, File, RefreshCw, ChevronRight, ChevronDown,
  Circle, AlertCircle, Plus, Trash2, Pencil, Eye,
} from 'lucide-react';

const GIT_STATUS_CONFIG = {
  untracked:  { color: 'text-green-400', bg: 'bg-green-500/10', label: 'U', title: 'Untracked (new file)' },
  modified:   { color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'M', title: 'Modified' },
  deleted:    { color: 'text-red-400', bg: 'bg-red-500/10', label: 'D', title: 'Deleted' },
  renamed:    { color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'R', title: 'Renamed' },
  tracked:    { color: 'text-surface-600', bg: '', label: '', title: 'Tracked' },
};

function FileEntry({ entry, depth = 0, expanded, onToggle }) {
  const isDir = entry.type === 'directory';
  const status = GIT_STATUS_CONFIG[entry.gitStatus] || GIT_STATUS_CONFIG.tracked;
  const indent = depth * 12;
  const isHighlighted = entry.gitStatus === 'untracked' || entry.gitStatus === 'modified';

  return (
    <div
      className={`flex items-center gap-1 px-2 py-0.5 hover:bg-surface-700/30 transition-colors cursor-default ${
        isHighlighted ? 'bg-surface-800/50' : ''
      }`}
      style={{ paddingLeft: `${8 + indent}px` }}
      title={`${entry.name} — ${status.title}`}
    >
      {isDir ? (
        <button onClick={onToggle} className="p-0 text-surface-500 hover:text-surface-300">
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </button>
      ) : (
        <span className="w-[10px]" />
      )}

      {isDir ? (
        <FolderOpen size={12} className="text-amber-500/70 flex-shrink-0" />
      ) : (
        <File size={11} className="text-surface-500 flex-shrink-0" />
      )}

      <span className={`text-[11px] font-mono truncate flex-1 ${isHighlighted ? status.color : 'text-surface-300'}`}>
        {entry.name.split('/').pop()}
      </span>

      {status.label && (
        <span className={`px-1 py-0 rounded text-[9px] font-bold flex-shrink-0 ${status.color} ${status.bg}`}>
          {status.label}
        </span>
      )}
    </div>
  );
}

export default function ContainerFilesPanel({ projectId, containerName }) {
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(false);
  const [currentPath, setCurrentPath] = useState(null);
  const [expandedDirs, setExpandedDirs] = useState(new Set());
  const [gitStatusCount, setGitStatusCount] = useState(0);

  const fetchFiles = useCallback((dirPath) => {
    if (!containerName) return;
    setLoading(true);
    const pathParam = dirPath ? `?path=${encodeURIComponent(dirPath)}&depth=2` : '?depth=2';
    fetch(`/api/containers/${containerName}/files${pathParam}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data) {
          setFiles(data.files);
          setCurrentPath(data.path);
          setGitStatusCount(data.gitStatusCount || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [containerName]);

  useEffect(() => {
    fetchFiles();
    const interval = setInterval(() => fetchFiles(currentPath), 15000);
    return () => clearInterval(interval);
  }, [fetchFiles, currentPath]);

  const toggleDir = (dirName) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirName)) next.delete(dirName);
      else next.add(dirName);
      return next;
    });
  };

  // Build a tree structure from flat file list
  const buildTree = () => {
    if (!files) return [];
    const topLevel = [];
    const children = {};

    for (const f of files) {
      const parts = f.name.split('/');
      if (parts.length === 1) {
        topLevel.push(f);
      } else {
        const parent = parts[0];
        if (!children[parent]) children[parent] = [];
        children[parent].push({ ...f, shortName: parts.slice(1).join('/') });
      }
    }

    return { topLevel, children };
  };

  const tree = buildTree();
  const untrackedCount = files?.filter(f => f.gitStatus === 'untracked').length || 0;
  const modifiedCount = files?.filter(f => f.gitStatus === 'modified').length || 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700 flex-shrink-0">
        <FolderOpen size={13} className="text-surface-400" />
        <span className="text-[11px] font-medium text-surface-300 flex-1">Container Files</span>

        {/* Status summary */}
        {gitStatusCount > 0 && (
          <div className="flex items-center gap-1.5">
            {untrackedCount > 0 && (
              <span className="text-[9px] text-green-400 bg-green-500/10 px-1 rounded" title="Untracked files">
                +{untrackedCount}
              </span>
            )}
            {modifiedCount > 0 && (
              <span className="text-[9px] text-yellow-400 bg-yellow-500/10 px-1 rounded" title="Modified files">
                ~{modifiedCount}
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => fetchFiles(currentPath)}
          disabled={loading}
          className="p-1 text-surface-500 hover:text-surface-200 rounded transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Current path breadcrumb */}
      {currentPath && (
        <div className="px-3 py-1 border-b border-surface-700/50 bg-surface-850/50">
          <span className="text-[10px] font-mono text-surface-500 truncate block" title={currentPath}>
            {currentPath}
          </span>
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {!containerName ? (
          <div className="px-3 py-6 text-center text-[11px] text-surface-500">
            No container linked
          </div>
        ) : !files ? (
          <div className="px-3 py-6 text-center text-[11px] text-surface-500">
            {loading ? 'Loading...' : 'No files found'}
          </div>
        ) : files.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-surface-500">
            Empty directory
          </div>
        ) : (
          <div className="py-1">
            {tree.topLevel?.map(entry => {
              const isDir = entry.type === 'directory';
              const isExpanded = expandedDirs.has(entry.name);

              return (
                <div key={entry.name}>
                  <FileEntry
                    entry={entry}
                    depth={0}
                    expanded={isExpanded}
                    onToggle={() => toggleDir(entry.name)}
                  />
                  {isDir && isExpanded && tree.children[entry.name]?.map(child => (
                    <FileEntry key={child.name} entry={child} depth={1} />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
