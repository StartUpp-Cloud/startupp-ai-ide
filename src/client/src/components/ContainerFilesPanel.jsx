import { useState, useEffect, useCallback } from 'react';
import {
  FolderOpen, File, RefreshCw, ChevronRight, ChevronDown,
  Plus, Trash2, Pencil, Shield, FolderPlus,
} from 'lucide-react';
import { useFileEditor } from '../contexts/FileEditorContext';

const GIT_STATUS_CONFIG = {
  untracked:  { color: 'text-green-400', bg: 'bg-green-500/10', label: 'U', title: 'Untracked (new file)' },
  modified:   { color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'M', title: 'Modified' },
  deleted:    { color: 'text-red-400', bg: 'bg-red-500/10', label: 'D', title: 'Deleted' },
  renamed:    { color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'R', title: 'Renamed' },
  tracked:    { color: 'text-surface-600', bg: '', label: '', title: 'Tracked' },
};

const CHMOD_PRESETS = ['644', '755', '600', '700', '664', '775'];

function joinPath(dir, name) {
  const base = String(dir || '/workspace').replace(/\/+$/, '');
  const leaf = String(name || '').replace(/^\/+/, '');
  return leaf ? `${base}/${leaf}` : base;
}

function parentPath(dir) {
  const cleaned = String(dir || '/workspace').replace(/\/+$/, '');
  if (cleaned === '/workspace' || cleaned === '/home/dev') return cleaned;
  const idx = cleaned.lastIndexOf('/');
  return idx <= 0 ? '/workspace' : cleaned.slice(0, idx);
}

function breadcrumbParts(dir) {
  const cleaned = String(dir || '/workspace').replace(/\/+$/, '');
  const parts = cleaned.split('/').filter(Boolean);
  const crumbs = [];
  let acc = '';
  for (const part of parts) {
    acc += `/${part}`;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

function FileEntry({ entry, selected, onOpen, onEdit, onDelete, onChmod, onCreateIn }) {
  const isDir = entry.type === 'directory';
  const status = GIT_STATUS_CONFIG[entry.gitStatus] || GIT_STATUS_CONFIG.tracked;
  const isHighlighted = entry.gitStatus === 'untracked' || entry.gitStatus === 'modified';

  return (
    <div
      className={`group flex items-center gap-1 px-2 py-0.5 hover:bg-surface-700/30 transition-colors ${
        selected ? 'bg-primary-500/15 ring-1 ring-inset ring-primary-500/30' : isHighlighted ? 'bg-surface-800/50' : ''
      }`}
      title={`${entry.name} — ${status.title}`}
    >
      {isDir ? (
        <ChevronRight size={10} className="text-surface-500 flex-shrink-0" />
      ) : (
        <span className="w-[10px]" />
      )}
      {isDir ? (
        <FolderOpen size={12} className="text-amber-500/70 flex-shrink-0" />
      ) : (
        <File size={11} className="text-surface-500 flex-shrink-0" />
      )}
      <button
        type="button"
        onClick={onOpen}
        className={`text-[11px] font-mono truncate flex-1 text-left ${
          selected ? 'text-primary-200' : isHighlighted ? status.color : 'text-surface-300'
        }`}
      >
        {entry.name.split('/').pop()}
      </button>
      {status.label && (
        <span className={`px-1 py-0 rounded text-[9px] font-bold flex-shrink-0 ${status.color} ${status.bg}`}>
          {status.label}
        </span>
      )}
      <span className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
        {isDir && (
          <button type="button" onClick={onCreateIn} className="p-0.5 text-surface-500 hover:text-primary-300" title="New file in this folder">
            <Plus size={10} />
          </button>
        )}
        {!isDir && (
          <button type="button" onClick={onEdit} className="p-0.5 text-surface-500 hover:text-primary-300" title="Edit">
            <Pencil size={10} />
          </button>
        )}
        <button type="button" onClick={onChmod} className="p-0.5 text-surface-500 hover:text-amber-300" title="Permissions">
          <Shield size={10} />
        </button>
        <button type="button" onClick={onDelete} className="p-0.5 text-surface-500 hover:text-red-400" title="Delete">
          <Trash2 size={10} />
        </button>
      </span>
    </div>
  );
}

export default function ContainerFilesPanel({ containerName, collapsed = false, onToggle }) {
  const fileEditor = useFileEditor();
  const [files, setFiles] = useState(null);
  const [loading, setLoading] = useState(false);
  const [browsePath, setBrowsePath] = useState('/workspace');
  const [gitStatusCount, setGitStatusCount] = useState(0);
  const [error, setError] = useState('');
  const [createDialog, setCreateDialog] = useState(null);
  const [chmodDialog, setChmodDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const fetchFiles = useCallback((dirPath) => {
    if (!containerName) return;
    const target = dirPath || browsePath || '/workspace';
    setLoading(true);
    fetch(`/api/containers/${containerName}/files?path=${encodeURIComponent(target)}&depth=1`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || r.statusText);
        return data;
      })
      .then((data) => {
        setError('');
        setFiles(data.files);
        setBrowsePath(data.path);
        setGitStatusCount(data.gitStatusCount || 0);
      })
      .catch((err) => setError(err.message || 'Could not list files'))
      .finally(() => setLoading(false));
  }, [containerName, browsePath]);

  useEffect(() => {
    fetchFiles('/workspace');
  }, [containerName]);

  useEffect(() => {
    if (!containerName) return undefined;
    const interval = setInterval(() => fetchFiles(browsePath), 15000);
    return () => clearInterval(interval);
  }, [containerName, browsePath, fetchFiles]);

  useEffect(() => {
    if (!fileEditor?.saveGeneration) return;
    fetchFiles(browsePath);
  }, [fileEditor?.saveGeneration]);

  const api = async (url, options) => {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  };

  const openFile = (path) => {
    fileEditor?.openEditor({ containerName, path });
  };

  const createEntry = async () => {
    const name = createDialog?.name?.trim();
    if (!name) return;
    const dest = joinPath(createDialog.parent || browsePath, name);
    try {
      setBusy(true);
      setError('');
      await api(`/api/containers/${containerName}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dest, type: createDialog.type }),
      });
      setCreateDialog(null);
      if (createDialog.type === 'file') {
        await fileEditor?.openEditor({ containerName, path: dest, isNew: true, content: '' });
      }
      fetchFiles(createDialog.parent || browsePath);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const deleteEntry = async (entry) => {
    const dest = joinPath(browsePath, entry.name);
    if (!window.confirm(`Delete ${entry.type === 'directory' ? 'folder' : 'file'} ${dest}?`)) return;
    try {
      setBusy(true);
      await api(
        `/api/containers/${containerName}/file?path=${encodeURIComponent(dest)}&type=${entry.type === 'directory' ? 'directory' : 'file'}`,
        { method: 'DELETE' },
      );
      if (fileEditor?.editor?.path === dest) fileEditor.closeEditor();
      fetchFiles(browsePath);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const applyChmod = async () => {
    if (!chmodDialog?.path || !chmodDialog.mode) return;
    try {
      setBusy(true);
      await api(`/api/containers/${containerName}/file/chmod`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: chmodDialog.path, mode: chmodDialog.mode }),
      });
      setChmodDialog(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const visibleFiles = (files || []).filter((f) => !f.name.includes('/'));
  const untrackedCount = visibleFiles.filter((f) => f.gitStatus === 'untracked').length;
  const modifiedCount = visibleFiles.filter((f) => f.gitStatus === 'modified').length;
  const crumbs = breadcrumbParts(browsePath);
  const canGoUp = browsePath !== '/workspace' && browsePath !== '/home/dev';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-surface-700 flex-shrink-0">
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 text-left min-w-0"
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronRight size={13} className="text-surface-500" /> : <ChevronDown size={13} className="text-surface-500" />}
          <FolderOpen size={13} className="text-surface-400" />
          <span className="text-[11px] font-medium text-surface-300 truncate">Container Files</span>
        </button>

        {!collapsed && gitStatusCount > 0 && (
          <div className="flex items-center gap-1.5">
            {untrackedCount > 0 && (
              <span className="text-[9px] text-green-400 bg-green-500/10 px-1 rounded">+{untrackedCount}</span>
            )}
            {modifiedCount > 0 && (
              <span className="text-[9px] text-yellow-400 bg-yellow-500/10 px-1 rounded">~{modifiedCount}</span>
            )}
          </div>
        )}

        {!collapsed && (
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setCreateDialog({ type: 'file', name: '', parent: browsePath })}
              className="p-1 text-surface-500 hover:text-surface-200 rounded"
              title="New file in this folder"
            >
              <Plus size={11} />
            </button>
            <button
              type="button"
              onClick={() => setCreateDialog({ type: 'directory', name: '', parent: browsePath })}
              className="p-1 text-surface-500 hover:text-surface-200 rounded"
              title="New folder here"
            >
              <FolderPlus size={11} />
            </button>
            <button
              type="button"
              onClick={() => fetchFiles(browsePath)}
              disabled={loading}
              className="p-1 text-surface-500 hover:text-surface-200 rounded disabled:opacity-40"
              title="Refresh"
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}
      </div>

      {!collapsed && (
      <>
      <div className="px-2 py-1 border-b border-surface-700/50 bg-surface-850/50 flex items-center gap-1 flex-wrap">
        {crumbs.map((crumb, index) => (
          <span key={crumb.path} className="flex items-center gap-1 min-w-0">
            {index > 0 && <span className="text-surface-600 text-[10px]">/</span>}
            <button
              type="button"
              onClick={() => fetchFiles(crumb.path)}
              className={`text-[10px] font-mono truncate max-w-[7rem] ${
                crumb.path === browsePath ? 'text-primary-300' : 'text-surface-500 hover:text-surface-300'
              }`}
            >
              {crumb.label}
            </button>
          </span>
        ))}
      </div>

      {error && (
        <div className="px-3 py-1 text-[10px] text-red-400 border-b border-surface-700/50">{error}</div>
      )}

      {createDialog && (
        <div className="px-3 py-2 border-b border-surface-700 space-y-1.5 bg-surface-900/40">
          <p className="text-[10px] text-surface-400">
            {createDialog.type === 'directory' ? 'New folder in' : 'New file in'} {createDialog.parent || browsePath}
          </p>
          <input
            value={createDialog.name}
            onChange={(e) => setCreateDialog({ ...createDialog, name: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') createEntry(); }}
            placeholder={createDialog.type === 'directory' ? 'src' : 'notes.md'}
            className="w-full px-2 py-1 text-[11px] bg-surface-800 border border-surface-700 rounded text-surface-200"
            autoFocus
          />
          <div className="flex gap-1">
            <button type="button" onClick={createEntry} disabled={busy} className="px-2 py-0.5 text-[10px] rounded bg-primary-500/20 text-primary-200">Create</button>
            <button type="button" onClick={() => setCreateDialog(null)} className="px-2 py-0.5 text-[10px] rounded text-surface-400">Cancel</button>
          </div>
        </div>
      )}

      {chmodDialog && (
        <div className="px-3 py-2 border-b border-surface-700 space-y-1.5 bg-surface-900/40">
          <p className="text-[10px] text-surface-400 truncate">Permissions · {chmodDialog.path}</p>
          <div className="flex flex-wrap gap-1">
            {CHMOD_PRESETS.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setChmodDialog({ ...chmodDialog, mode })}
                className={`px-1.5 py-0.5 text-[10px] font-mono rounded ${chmodDialog.mode === mode ? 'bg-amber-500/20 text-amber-200' : 'bg-surface-800 text-surface-400'}`}
              >
                {mode}
              </button>
            ))}
          </div>
          <input
            value={chmodDialog.mode}
            onChange={(e) => setChmodDialog({ ...chmodDialog, mode: e.target.value })}
            className="w-20 px-2 py-1 text-[11px] font-mono bg-surface-800 border border-surface-700 rounded text-surface-200"
          />
          <div className="flex gap-1">
            <button type="button" onClick={applyChmod} disabled={busy} className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 text-amber-200">chmod</button>
            <button type="button" onClick={() => setChmodDialog(null)} className="px-2 py-0.5 text-[10px] rounded text-surface-400">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {!containerName ? (
          <div className="px-3 py-6 text-center text-[11px] text-surface-500">No container linked</div>
        ) : !files ? (
          <div className="px-3 py-6 text-center text-[11px] text-surface-500">{loading ? 'Loading...' : 'No files found'}</div>
        ) : (
          <div className="py-1">
            {canGoUp && (
              <button
                type="button"
                onClick={() => fetchFiles(parentPath(browsePath))}
                className="flex items-center gap-1 w-full px-2 py-0.5 text-[11px] font-mono text-surface-500 hover:bg-surface-700/30 hover:text-surface-300"
              >
                <ChevronRight size={10} className="-rotate-180" />
                ..
              </button>
            )}
            {visibleFiles.length === 0 ? (
              <div className="px-3 py-6 text-center text-[11px] text-surface-500">Empty folder</div>
            ) : visibleFiles.map((entry) => {
              const dest = joinPath(browsePath, entry.name);
              const isDir = entry.type === 'directory';
              return (
                <FileEntry
                  key={entry.name}
                  entry={entry}
                  selected={false}
                  onOpen={() => (isDir ? fetchFiles(dest) : openFile(dest))}
                  onCreateIn={() => setCreateDialog({ type: 'file', name: '', parent: dest })}
                  onEdit={() => openFile(dest)}
                  onDelete={() => deleteEntry(entry)}
                  onChmod={() => setChmodDialog({ path: dest, mode: '644' })}
                />
              );
            })}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  );
}
