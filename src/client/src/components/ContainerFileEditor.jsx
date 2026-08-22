import { useEffect } from 'react';
import { Save, X, FileText } from 'lucide-react';
import { useFileEditor } from '../contexts/FileEditorContext';

export default function ContainerFileEditor() {
  const { editor, busy, error, saveEditor, closeEditor, updateContent } = useFileEditor() || {};

  useEffect(() => {
    if (!editor) return undefined;
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveEditor?.();
      }
      if (event.key === 'Escape') closeEditor?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor, saveEditor, closeEditor]);

  if (!editor) return null;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-surface-950">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-surface-700 bg-surface-900/80 flex-shrink-0">
        <FileText size={13} className="text-primary-300" />
        <span className="text-[11px] font-mono text-surface-300 truncate flex-1" title={editor.path}>
          {editor.path}
        </span>
        {editor.isNew && <span className="text-[9px] text-primary-300 bg-primary-500/10 px-1 rounded">new</span>}
        <button
          type="button"
          onClick={saveEditor}
          disabled={busy}
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-primary-500/20 text-primary-200 hover:bg-primary-500/30 disabled:opacity-50"
        >
          <Save size={11} />
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={closeEditor}
          className="p-1 text-surface-500 hover:text-surface-200"
          title="Close editor"
        >
          <X size={14} />
        </button>
      </div>
      {error && (
        <div className="px-3 py-1 text-[11px] text-red-400 border-b border-surface-700/50">{error}</div>
      )}
      <textarea
        value={editor.content}
        onChange={(e) => updateContent(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-0 w-full resize-none bg-[#0d1117] px-3 py-2 text-[13px] leading-5 font-mono text-surface-200 outline-none"
      />
    </div>
  );
}
