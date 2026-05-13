import { useState, useEffect } from 'react';
import { Terminal, Play, Loader, FileText, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, X } from 'lucide-react';

export default function DebugConsole({ projectId, connection }) {
  const [tab, setTab] = useState('apex'); // apex | logs
  const [apexCode, setApexCode] = useState('System.debug(\'Hello from Workbench!\');');
  const [apexResult, setApexResult] = useState(null);
  const [apexLoading, setApexLoading] = useState(false);

  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);
  const [logBody, setLogBody] = useState(null);
  const [logBodyLoading, setLogBodyLoading] = useState(false);

  const [error, setError] = useState(null);

  useEffect(() => {
    if (connection?.connected && tab === 'logs') loadLogs();
  }, [connection?.connected, tab]);

  const executeApex = async () => {
    if (!apexCode.trim()) return;
    setApexLoading(true);
    setApexResult(null);
    setError(null);
    try {
      const res = await fetch('/api/salesforce/debug/execute-apex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, code: apexCode }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Execution failed');
      setApexResult(data.data);
    } catch (err) {
      setError(err.message);
    }
    setApexLoading(false);
  };

  const loadLogs = async () => {
    setLogsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/salesforce/debug/logs?projectId=${projectId}&limit=30`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Failed to load logs');
      setLogs(data.data.records || []);
    } catch (err) {
      setError(err.message);
    }
    setLogsLoading(false);
  };

  const viewLogBody = async (logId) => {
    if (selectedLog === logId) {
      setSelectedLog(null);
      setLogBody(null);
      return;
    }
    setSelectedLog(logId);
    setLogBodyLoading(true);
    setLogBody(null);
    try {
      const res = await fetch(`/api/salesforce/debug/logs/${logId}?projectId=${projectId}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Failed to load log body');
      setLogBody(data.data.body);
    } catch (err) {
      setError(err.message);
    }
    setLogBodyLoading(false);
  };

  if (!connection?.connected) {
    return <div className="p-6 text-surface-500">Connect to a Salesforce org to use the debug console.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-surface-700">
        <div className="flex items-center gap-2 mb-4">
          <Terminal size={18} className="text-sky-400" />
          <h2 className="text-lg font-semibold">Debug Console</h2>
        </div>

        <div className="flex gap-1 bg-surface-800 rounded-lg p-1">
          <button onClick={() => setTab('apex')} className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${tab === 'apex' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}>
            <Play size={14} className="inline mr-1.5" /> Execute Anonymous
          </button>
          <button onClick={() => setTab('logs')} className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${tab === 'logs' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}>
            <FileText size={14} className="inline mr-1.5" /> Debug Logs
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'apex' ? (
          <div className="p-4 space-y-4">
            <div>
              <label className="block text-xs text-surface-400 mb-1">Apex Code</label>
              <textarea
                value={apexCode}
                onChange={(e) => setApexCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) executeApex(); }}
                rows={10}
                className="w-full bg-surface-800 border border-surface-600 rounded-lg px-4 py-3 text-sm font-mono text-emerald-300 placeholder-surface-600 resize-y"
                placeholder="System.debug('Hello World!');"
              />
              <div className="text-xs text-surface-600 mt-1">Ctrl+Enter to execute</div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={executeApex}
                disabled={!apexCode.trim() || apexLoading}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {apexLoading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
                Execute
              </button>
            </div>

            {apexResult && (
              <div className={`rounded-lg p-4 ${apexResult.success ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {apexResult.success ? (
                    <><CheckCircle size={16} className="text-emerald-400" /><span className="font-medium text-emerald-300">Execution Successful</span></>
                  ) : apexResult.compiled === false ? (
                    <><X size={16} className="text-red-400" /><span className="font-medium text-red-300">Compilation Error</span></>
                  ) : (
                    <><AlertTriangle size={16} className="text-red-400" /><span className="font-medium text-red-300">Runtime Error</span></>
                  )}
                </div>

                {apexResult.compileProblem && (
                  <div className="text-sm text-red-300 mb-2">
                    <span className="text-surface-500">Line {apexResult.line}, Col {apexResult.column}:</span> {apexResult.compileProblem}
                  </div>
                )}

                {apexResult.exceptionMessage && (
                  <div className="text-sm text-red-300 mb-2">{apexResult.exceptionMessage}</div>
                )}

                {apexResult.exceptionStackTrace && (
                  <pre className="text-xs text-surface-400 bg-surface-900 rounded p-2 overflow-x-auto mt-2">{apexResult.exceptionStackTrace}</pre>
                )}
              </div>
            )}
          </div>
        ) : tab === 'logs' ? (
          <div>
            <div className="p-3 border-b border-surface-700 flex items-center gap-2">
              <span className="text-sm text-surface-400">{logs.length} log(s)</span>
              <button onClick={loadLogs} className="ml-auto p-1.5 hover:bg-surface-700 rounded" title="Refresh">
                <RefreshCw size={14} className={`text-surface-400 ${logsLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {logsLoading && logs.length === 0 ? (
              <div className="p-8 flex items-center justify-center"><Loader size={20} className="animate-spin text-surface-400" /></div>
            ) : logs.length === 0 ? (
              <div className="p-8 text-center text-sm text-surface-500">No debug logs found. Execute some Apex to generate logs.</div>
            ) : (
              logs.map((log) => (
                <div key={log.Id} className="border-b border-surface-800">
                  <button
                    onClick={() => viewLogBody(log.Id)}
                    className="w-full text-left px-4 py-2.5 hover:bg-surface-800/50 transition-colors flex items-center gap-3 text-xs"
                  >
                    {selectedLog === log.Id ? <ChevronDown size={12} className="text-surface-500" /> : <ChevronRight size={12} className="text-surface-500" />}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${log.Status === 'Success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      {log.Status}
                    </span>
                    <span className="text-surface-300 truncate flex-1">{log.Operation}</span>
                    <span className="text-surface-500 shrink-0">{log.DurationMilliseconds}ms</span>
                    <span className="text-surface-600 shrink-0">{log.LogLength ? `${Math.round(log.LogLength / 1024)}KB` : ''}</span>
                    <span className="text-surface-600 shrink-0">{log.StartTime ? new Date(log.StartTime).toLocaleTimeString() : ''}</span>
                  </button>

                  {selectedLog === log.Id && (
                    <div className="px-4 pb-3 pl-10">
                      {logBodyLoading ? (
                        <div className="flex items-center gap-2 text-sm text-surface-400"><Loader size={14} className="animate-spin" /> Loading log...</div>
                      ) : logBody ? (
                        <pre className="bg-surface-900 rounded p-3 text-xs text-surface-300 overflow-x-auto max-h-96 overflow-y-auto font-mono whitespace-pre-wrap">{logBody}</pre>
                      ) : null}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>

      {error && (
        <div className="p-3 border-t border-red-500/30 bg-red-500/10 text-sm text-red-300 flex items-center gap-2">
          <X size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs hover:text-red-200">dismiss</button>
        </div>
      )}
    </div>
  );
}
