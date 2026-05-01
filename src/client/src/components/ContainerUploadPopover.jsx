import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Folder, FolderOpen, ChevronRight, ArrowLeft, X, Loader, Check, AlertCircle } from 'lucide-react';

export default function ContainerUploadPopover({ projectId, onClose }) {
  const [containerName, setContainerName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [browsePath, setBrowsePath] = useState('/workspace');
  const [entries, setEntries] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileInputRef = useRef(null);
  const popoverRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  // Fetch project to get containerName
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/projects/${projectId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.containerName) {
          setContainerName(data.containerName);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId]);

  // Browse directory
  const browse = useCallback((dirPath) => {
    if (!containerName) return;
    setBrowseLoading(true);
    setUploadResult(null);
    fetch(`/api/containers/${containerName}/browse?path=${encodeURIComponent(dirPath)}`)
      .then(r => r.ok ? r.json() : { entries: [] })
      .then(data => {
        setBrowsePath(data.path || dirPath);
        setEntries(data.entries || []);
      })
      .catch(() => setEntries([]))
      .finally(() => setBrowseLoading(false));
  }, [containerName]);

  useEffect(() => {
    if (containerName) browse(browsePath);
  }, [containerName]);

  const navigateUp = () => {
    const parent = browsePath.split('/').slice(0, -1).join('/') || '/';
    if (parent.startsWith('/workspace') || parent.startsWith('/home/dev')) {
      browse(parent);
    }
  };

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length || !containerName) return;

    setUploading(true);
    setUploadResult(null);

    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    formData.append('destination', browsePath);

    try {
      const res = await fetch(`/api/containers/${containerName}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        const successCount = data.uploaded?.filter(u => !u.error).length || 0;
        setUploadResult({ success: true, message: `${successCount} file${successCount !== 1 ? 's' : ''} uploaded to ${browsePath}` });
        browse(browsePath); // Refresh listing
      } else {
        setUploadResult({ success: false, message: data.error || 'Upload failed' });
      }
    } catch {
      setUploadResult({ success: false, message: 'Upload failed' });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const folders = entries.filter(e => e.type === 'directory');

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full left-0 mb-2 w-80 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl z-50 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700 bg-surface-850">
        <span className="text-xs font-medium text-surface-300">Upload to Container</span>
        <button onClick={onClose} className="p-0.5 text-surface-500 hover:text-surface-200 transition-colors">
          <X size={14} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader size={18} className="animate-spin text-surface-500" />
        </div>
      ) : !containerName ? (
        <div className="px-3 py-6 text-center text-xs text-surface-500">
          No container linked to this project.
        </div>
      ) : (
        <>
          {/* Breadcrumb path */}
          <div className="flex items-center gap-1 px-3 py-2 border-b border-surface-700/50 bg-surface-850/50">
            {browsePath !== '/workspace' && browsePath !== '/home/dev' && (
              <button onClick={navigateUp} className="p-0.5 text-surface-500 hover:text-surface-200 transition-colors" title="Go up">
                <ArrowLeft size={14} />
              </button>
            )}
            <span className="text-[11px] text-surface-400 font-mono truncate flex-1" title={browsePath}>
              {browsePath}
            </span>
          </div>

          {/* Directory listing */}
          <div className="max-h-48 overflow-y-auto">
            {browseLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader size={16} className="animate-spin text-surface-500" />
              </div>
            ) : folders.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-surface-500">
                No subdirectories
              </div>
            ) : (
              folders.map(entry => (
                <button
                  key={entry.name}
                  onClick={() => browse(`${browsePath}/${entry.name}`)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-700/50 transition-colors group"
                >
                  <FolderOpen size={14} className="text-amber-500/70 flex-shrink-0" />
                  <span className="text-xs text-surface-300 truncate flex-1">{entry.name}</span>
                  <ChevronRight size={12} className="text-surface-600 group-hover:text-surface-400" />
                </button>
              ))
            )}
          </div>

          {/* Upload result */}
          {uploadResult && (
            <div className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] border-t border-surface-700/50 ${
              uploadResult.success ? 'text-green-400' : 'text-red-400'
            }`}>
              {uploadResult.success ? <Check size={12} /> : <AlertCircle size={12} />}
              <span className="truncate">{uploadResult.message}</span>
            </div>
          )}

          {/* Upload button */}
          <div className="px-3 py-2 border-t border-surface-700">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              {uploading ? (
                <><Loader size={14} className="animate-spin" /> Uploading...</>
              ) : (
                <><Upload size={14} /> Upload to {browsePath.split('/').pop() || 'workspace'}</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
