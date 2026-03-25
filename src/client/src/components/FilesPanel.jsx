import { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileJson,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Copy,
  Send,
  FolderPlus,
  AlertCircle,
} from 'lucide-react';

// File icon mapping based on extension
const FILE_ICONS = {
  js: FileCode,
  jsx: FileCode,
  ts: FileCode,
  tsx: FileCode,
  py: FileCode,
  rb: FileCode,
  go: FileCode,
  rs: FileCode,
  java: FileCode,
  json: FileJson,
  md: FileText,
  txt: FileText,
  yml: FileText,
  yaml: FileText,
  default: File,
};

function getFileIcon(extension) {
  return FILE_ICONS[extension] || FILE_ICONS.default;
}

function FileTreeNode({ node, depth = 0, onFileSelect, onSendToTerminal, expandedPaths, toggleExpand }) {
  const isExpanded = expandedPaths.has(node.path);
  const isDirectory = node.type === 'directory';
  const FileIcon = isDirectory
    ? (isExpanded ? FolderOpen : Folder)
    : getFileIcon(node.extension);

  const handleClick = () => {
    if (isDirectory) {
      toggleExpand(node.path);
    } else {
      onFileSelect?.(node);
    }
  };

  return (
    <div>
      <div
        className={`flex items-center gap-1 py-1 px-2 hover:bg-surface-700 rounded cursor-pointer group ${
          depth > 0 ? 'ml-' + (depth * 3) : ''
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {isDirectory && (
          <span className="w-3 h-3 flex items-center justify-center text-surface-500">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
        {!isDirectory && <span className="w-3" />}

        <FileIcon className={`w-4 h-4 flex-shrink-0 ${
          isDirectory ? 'text-yellow-400' : 'text-surface-400'
        }`} />

        <span className="text-xs text-surface-300 truncate flex-1">
          {node.name}
        </span>

        {!isDirectory && (
          <div className="hidden group-hover:flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(node.path);
              }}
              className="p-1 hover:bg-surface-600 rounded"
              title="Copy path"
            >
              <Copy className="w-3 h-3 text-surface-400" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSendToTerminal?.(node.path);
              }}
              className="p-1 hover:bg-surface-600 rounded"
              title="Send path to terminal"
            >
              <Send className="w-3 h-3 text-surface-400" />
            </button>
          </div>
        )}
      </div>

      {isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onFileSelect={onFileSelect}
              onSendToTerminal={onSendToTerminal}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function FilesPanel({ projectId, project, onFileSelect }) {
  const [fileTree, setFileTree] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedPaths, setExpandedPaths] = useState(new Set());
  const [folderPath, setFolderPath] = useState('');
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [validating, setValidating] = useState(false);

  // Load file tree when project changes
  useEffect(() => {
    if (projectId && project?.folderPath) {
      loadFileTree();
    } else {
      setFileTree(null);
    }
  }, [projectId, project?.folderPath]);

  const loadFileTree = async () => {
    if (!projectId) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/files/scan/${projectId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to scan folder');
      }

      const data = await res.json();
      setFileTree(data.tree);

      // Auto-expand root
      if (data.tree?.path) {
        setExpandedPaths(new Set([data.tree.path]));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = useCallback((path) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSendToTerminal = useCallback((filePath) => {
    if (window.sendToTerminal) {
      window.sendToTerminal(filePath + ' ');
    }
  }, []);

  const handleSetFolder = async () => {
    if (!folderPath.trim() || !projectId) return;

    setValidating(true);
    try {
      // Validate path first
      const validateRes = await fetch('/api/files/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: folderPath.trim() }),
      });
      const validateData = await validateRes.json();

      if (!validateData.valid) {
        setError('Invalid folder path. Make sure it exists and is a directory.');
        return;
      }

      // Update project
      const updateRes = await fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath: validateData.resolvedPath }),
      });

      if (!updateRes.ok) {
        throw new Error('Failed to update project');
      }

      setShowFolderInput(false);
      setFolderPath('');
      // Trigger reload by parent component
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setValidating(false);
    }
  };

  // No project selected
  if (!projectId) {
    return (
      <div className="flex flex-col h-full bg-surface-850">
        <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-medium text-surface-200">Files</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-surface-500 text-center">
            Select a project to browse files
          </p>
        </div>
      </div>
    );
  }

  // Project has no folder configured
  if (!project?.folderPath) {
    return (
      <div className="flex flex-col h-full bg-surface-850">
        <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-medium text-surface-200">Files</span>
          </div>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4 gap-3">
          <FolderPlus className="w-8 h-8 text-surface-600" />
          <p className="text-xs text-surface-400 text-center">
            No folder configured for this project
          </p>

          {showFolderInput ? (
            <div className="w-full space-y-2">
              <input
                type="text"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/path/to/your/project"
                className="w-full px-2 py-1.5 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={handleSetFolder}
                  disabled={validating || !folderPath.trim()}
                  className="flex-1 px-2 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 disabled:bg-surface-600 text-white rounded"
                >
                  {validating ? 'Validating...' : 'Set Folder'}
                </button>
                <button
                  onClick={() => {
                    setShowFolderInput(false);
                    setFolderPath('');
                    setError(null);
                  }}
                  className="px-2 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 text-surface-300 rounded"
                >
                  Cancel
                </button>
              </div>
              {error && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" />
                  {error}
                </p>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowFolderInput(true)}
              className="px-3 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 text-white rounded"
            >
              Configure Folder
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Folder className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Files</span>
        </div>
        <button
          onClick={loadFileTree}
          disabled={loading}
          className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Folder path */}
      <div className="px-3 py-1.5 border-b border-surface-700 bg-surface-800/50">
        <p className="text-[10px] text-surface-500 truncate" title={project.folderPath}>
          {project.folderPath}
        </p>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto">
        {loading && !fileTree && (
          <div className="flex items-center justify-center h-32">
            <RefreshCw className="w-5 h-5 text-surface-500 animate-spin" />
          </div>
        )}

        {error && (
          <div className="p-3 text-xs text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {fileTree && (
          <div className="py-1">
            <FileTreeNode
              node={fileTree}
              onFileSelect={onFileSelect}
              onSendToTerminal={handleSendToTerminal}
              expandedPaths={expandedPaths}
              toggleExpand={toggleExpand}
            />
          </div>
        )}
      </div>
    </div>
  );
}
