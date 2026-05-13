import { useState } from 'react';
import { Globe, Play, Loader, Copy, X } from 'lucide-react';

const COMMON_ENDPOINTS = [
  { label: 'API Versions', path: '/services/data/' },
  { label: 'Org Limits', path: '/limits' },
  { label: 'SObjects', path: '/sobjects' },
  { label: 'Recent Items', path: '/recent' },
  { label: 'Search (SOSL)', path: '/search?q=FIND+{test}' },
  { label: 'Tooling Query', path: '/tooling/query?q=SELECT+Id,Name+FROM+ApexClass+LIMIT+5' },
];

export default function RestExplorer({ projectId, connection }) {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/services/data/');
  const [body, setBody] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const sendRequest = async () => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      let parsedBody = undefined;
      if (['POST', 'PATCH', 'PUT'].includes(method) && body.trim()) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          throw new Error('Request body must be valid JSON');
        }
      }

      const res = await fetch('/api/salesforce/rest/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, method, path, body: parsedBody }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Request failed');
      setResult(data.data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const copyResult = () => {
    if (result?.body) {
      navigator.clipboard.writeText(JSON.stringify(result.body, null, 2));
    }
  };

  if (!connection?.connected) {
    return <div className="p-6 text-surface-500">Connect to a Salesforce org to use the REST explorer.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-surface-700 space-y-3">
        <div className="flex items-center gap-2">
          <Globe size={18} className="text-sky-400" />
          <h2 className="text-lg font-semibold">REST Explorer</h2>
        </div>

        {/* Quick endpoints */}
        <div className="flex gap-1.5 flex-wrap">
          {COMMON_ENDPOINTS.map((ep) => (
            <button
              key={ep.path}
              onClick={() => { setPath(ep.path); setMethod('GET'); }}
              className="px-2 py-1 bg-surface-800 hover:bg-surface-700 text-xs text-surface-400 hover:text-surface-200 rounded transition-colors"
            >
              {ep.label}
            </button>
          ))}
        </div>

        {/* Request builder */}
        <div className="flex gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className="bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-200 font-medium w-28"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PATCH">PATCH</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
          </select>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendRequest()}
            placeholder="/services/data/v62.0/..."
            className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm font-mono text-sky-300 placeholder-surface-600"
          />
          <button
            onClick={sendRequest}
            disabled={!path.trim() || loading}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
            Send
          </button>
        </div>

        {/* Body input for POST/PATCH/PUT */}
        {['POST', 'PATCH', 'PUT'].includes(method) && (
          <div>
            <label className="block text-xs text-surface-400 mb-1">Request Body (JSON)</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full bg-surface-800 border border-surface-600 rounded-lg px-4 py-3 text-sm font-mono text-surface-200 placeholder-surface-600 resize-y"
              placeholder='{"Name": "Test Account"}'
            />
          </div>
        )}
      </div>

      {/* Response */}
      <div className="flex-1 overflow-auto">
        {error && (
          <div className="m-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300 flex items-center gap-2">
            <X size={14} /> {error}
          </div>
        )}

        {result && (
          <div className="p-4 space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <span className={`px-2 py-0.5 rounded font-mono font-medium ${result.status >= 200 && result.status < 300 ? 'bg-emerald-500/20 text-emerald-300' : result.status >= 400 ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/20 text-amber-300'}`}>
                {result.status}
              </span>
              <span className="text-surface-500">{result.durationMs}ms</span>
              <button onClick={copyResult} className="ml-auto px-2 py-1 bg-surface-800 hover:bg-surface-700 text-surface-400 rounded text-xs flex items-center gap-1">
                <Copy size={12} /> Copy
              </button>
            </div>

            <pre className="bg-surface-800 rounded-lg p-4 text-xs font-mono text-surface-300 overflow-x-auto max-h-[calc(100vh-400px)] overflow-y-auto whitespace-pre-wrap">
              {result.body !== null ? JSON.stringify(result.body, null, 2) : '(empty response)'}
            </pre>
          </div>
        )}

        {!result && !error && !loading && (
          <div className="flex items-center justify-center p-8 text-surface-600 text-sm">
            Select an endpoint or enter a custom path to send a request.
          </div>
        )}
      </div>
    </div>
  );
}
