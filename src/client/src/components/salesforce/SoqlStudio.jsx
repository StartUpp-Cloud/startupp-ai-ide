import { useState } from 'react';
import { Search, Play, Sparkles, Loader, Copy, Download, History, X } from 'lucide-react';

export default function SoqlStudio({ projectId, connection }) {
  const [query, setQuery] = useState('SELECT Id, Name FROM Account LIMIT 10');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // AI builder
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Query history
  const [history, setHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sf_soql_history') || '[]');
    } catch { return []; }
  });
  const [showHistory, setShowHistory] = useState(false);

  const runQuery = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/salesforce/soql/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, query }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Query failed');
      setResult(data.data);

      // Save to history
      const newHistory = [{ query: query.trim(), timestamp: Date.now() }, ...history.filter((h) => h.query !== query.trim())].slice(0, 50);
      setHistory(newHistory);
      localStorage.setItem('sf_soql_history', JSON.stringify(newHistory));
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const buildWithAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/salesforce/soql/ai-build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, naturalLanguage: aiPrompt }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'AI generation failed');
      setQuery(data.data.soql);
      setAiPrompt('');
    } catch (err) {
      setError(err.message);
    }
    setAiLoading(false);
  };

  const exportCsv = () => {
    if (!result?.rows?.length) return;
    const headers = result.columns.join(',');
    const rows = result.rows.map((row) =>
      result.columns.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(',')
    );
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'query_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!connection?.connected) {
    return <div className="p-6 text-surface-500">Connect to a Salesforce org to run SOQL queries.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-surface-700 space-y-3">
        <div className="flex items-center gap-2">
          <Search size={18} className="text-sky-400" />
          <h2 className="text-lg font-semibold">SOQL Studio</h2>
        </div>

        {/* AI Builder */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Sparkles size={14} className="absolute left-3 top-2.5 text-violet-400" />
            <input
              type="text"
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && buildWithAi()}
              placeholder="Describe your query in plain English... (e.g., 'All contacts created this month with email')"
              className="w-full bg-surface-800 border border-surface-600 rounded-lg pl-9 pr-3 py-2 text-sm text-surface-200 placeholder-surface-600"
            />
          </div>
          <button
            onClick={buildWithAi}
            disabled={!aiPrompt.trim() || aiLoading}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {aiLoading ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate
          </button>
        </div>

        {/* Query editor */}
        <div className="relative">
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runQuery(); }}
            rows={4}
            className="w-full bg-surface-800 border border-surface-600 rounded-lg px-4 py-3 text-sm font-mono text-sky-300 placeholder-surface-600 resize-y"
            placeholder="SELECT Id, Name FROM Account LIMIT 10"
          />
          <div className="absolute bottom-2 right-2 text-[10px] text-surface-600">Ctrl+Enter to run</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={runQuery}
            disabled={!query.trim() || loading}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
            Run Query
          </button>

          <button
            onClick={() => setShowHistory(!showHistory)}
            className={`px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${showHistory ? 'bg-sky-500/20 text-sky-300' : 'bg-surface-800 text-surface-400 hover:text-surface-200'}`}
          >
            <History size={14} /> History
          </button>

          {result?.rows?.length > 0 && (
            <>
              <button onClick={exportCsv} className="px-3 py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg text-sm flex items-center gap-1.5">
                <Download size={14} /> Export CSV
              </button>
              <button onClick={() => navigator.clipboard.writeText(query)} className="px-3 py-2 bg-surface-800 hover:bg-surface-700 text-surface-300 rounded-lg text-sm flex items-center gap-1.5">
                <Copy size={14} /> Copy Query
              </button>
            </>
          )}
        </div>
      </div>

      {/* History dropdown */}
      {showHistory && history.length > 0 && (
        <div className="border-b border-surface-700 bg-surface-900 max-h-48 overflow-y-auto">
          {history.map((h, i) => (
            <button
              key={i}
              onClick={() => { setQuery(h.query); setShowHistory(false); }}
              className="w-full text-left px-4 py-2 text-xs font-mono text-surface-300 hover:bg-surface-800 border-b border-surface-800 truncate"
            >
              <span className="text-surface-500 mr-2">{new Date(h.timestamp).toLocaleTimeString()}</span>
              {h.query}
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="m-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
            <X size={14} /> {error}
          </div>
        )}

        {result && (
          <div className="p-4">
            <div className="flex items-center gap-3 mb-3 text-sm text-surface-400">
              <span>{result.totalSize} record(s)</span>
              {result.done === false && <span className="text-amber-400">More records available</span>}
              <span className="text-xs">{result.columns?.length || 0} columns</span>
            </div>

            {result.rows?.length > 0 ? (
              <div className="overflow-x-auto border border-surface-700 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-surface-800 sticky top-0">
                    <tr>
                      {result.columns.map((col) => (
                        <th key={col} className="text-left px-3 py-2 font-medium text-surface-400 whitespace-nowrap">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i} className="border-t border-surface-800 hover:bg-surface-800/50">
                        {result.columns.map((col) => (
                          <td key={col} className="px-3 py-2 text-surface-300 whitespace-nowrap max-w-xs truncate">
                            {row[col] !== null && row[col] !== undefined ? (
                              typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col])
                            ) : (
                              <span className="text-surface-600 italic">null</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-surface-500">No records found.</div>
            )}
          </div>
        )}

        {!result && !error && !loading && (
          <div className="flex-1 flex items-center justify-center p-8 text-surface-600 text-sm">
            Write a SOQL query above or use the AI builder to generate one.
          </div>
        )}
      </div>
    </div>
  );
}
