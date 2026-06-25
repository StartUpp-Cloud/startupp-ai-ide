import { useEffect, useState, useCallback } from 'react';
import { Database, RefreshCw } from 'lucide-react';

export default function CodeIndexStatus({ projectId }) {
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}/code-index`)
      .then(r => r.json())
      .then(setMeta)
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const reindex = async () => {
    if (!projectId) return;
    setBusy(true);
    try {
      await fetch(`/api/projects/${projectId}/code-index/reindex`, { method: 'POST' });
    } finally {
      setBusy(false);
      load();
    }
  };

  if (!projectId) return null;
  const status = meta?.status || 'none';
  return (
    <div className="flex items-center gap-2 border-b border-surface-700 bg-surface-900/40 px-3 py-2 text-[11px] text-surface-300">
      <Database className="h-3.5 w-3.5 text-primary-400" />
      <span className="font-medium">Code index</span>
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${status === 'ready' ? 'bg-green-500/10 text-green-400' : status === 'indexing' ? 'bg-amber-500/10 text-amber-300' : 'bg-surface-700/60 text-surface-400'}`}>
        {status}
      </span>
      {meta?.chunkCount != null && status !== 'none' && (
        <span className="text-surface-500">{meta.fileCount} files · {meta.chunkCount} chunks</span>
      )}
      <button
        onClick={reindex}
        disabled={busy || status === 'indexing'}
        className="ml-auto flex items-center gap-1 rounded p-1 text-surface-400 hover:bg-surface-700 hover:text-surface-200 disabled:opacity-40"
        title="Reindex codebase"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${busy || status === 'indexing' ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
