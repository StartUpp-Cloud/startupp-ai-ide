import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const FileEditorContext = createContext(null);

export function FileEditorProvider({ children }) {
  const [editor, setEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveGeneration, setSaveGeneration] = useState(0);

  const closeEditor = useCallback(() => {
    setEditor(null);
    setError('');
  }, []);

  const openEditor = useCallback(async ({ containerName, path, isNew = false, content = '' }) => {
    setError('');
    if (!containerName || !path) return;
    if (isNew) {
      setEditor({ containerName, path, content, isNew: true });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/containers/${containerName}/file?path=${encodeURIComponent(path)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.binary) {
        setError('Binary file — open it in the terminal instead.');
        return;
      }
      setEditor({
        containerName,
        path: data.path,
        content: data.content || '',
        mode: data.mode,
        isNew: false,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, []);

  const saveEditor = useCallback(async () => {
    if (!editor) return false;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/containers/${editor.containerName}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: editor.path, content: editor.content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText);
      setEditor((prev) => (prev ? { ...prev, isNew: false } : prev));
      setSaveGeneration((n) => n + 1);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  }, [editor]);

  const updateContent = useCallback((content) => {
    setEditor((prev) => (prev ? { ...prev, content } : prev));
  }, []);

  const value = useMemo(() => ({
    editor,
    busy,
    error,
    saveGeneration,
    openEditor,
    saveEditor,
    closeEditor,
    updateContent,
    setError,
  }), [editor, busy, error, saveGeneration, openEditor, saveEditor, closeEditor, updateContent]);

  return (
    <FileEditorContext.Provider value={value}>
      {children}
    </FileEditorContext.Provider>
  );
}

export function useFileEditor() {
  return useContext(FileEditorContext);
}
