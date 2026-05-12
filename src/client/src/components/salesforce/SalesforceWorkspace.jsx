import { useEffect, useMemo, useState } from 'react';
import { Cloud, Database, GitPullRequestArrow, RefreshCw, Search, ShieldAlert } from 'lucide-react';

function envelopeError(data, fallback) {
  return data?.error?.message || data?.error || fallback;
}

export default function SalesforceWorkspace({ project, containerRepos = [], onProjectUpdated }) {
  const [repoPath, setRepoPath] = useState('');
  const [status, setStatus] = useState(null);
  const [objects, setObjects] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedObject, setSelectedObject] = useState('');
  const [describe, setDescribe] = useState(null);
  const [soql, setSoql] = useState('SELECT Id, Name FROM Account');
  const [queryResult, setQueryResult] = useState(null);
  const [flowQuery, setFlowQuery] = useState('');
  const [flowResults, setFlowResults] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isSalesforce = project?.stack === 'salesforce';
  const repos = useMemo(() => containerRepos.filter((repo) => repo.isGitRepo), [containerRepos]);
  const orgs = status?.orgs || [];
  const selectedOrgSummary = orgs.find((org) => org.username === selectedOrg);
  const filteredObjects = objects.filter((name) => name.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);

  useEffect(() => {
    if (!repoPath && repos.length === 1) setRepoPath(repos[0].path);
  }, [repos, repoPath]);

  useEffect(() => {
    if (!project?.id || !isSalesforce) return;
    loadStatus();
  }, [project?.id, isSalesforce, repoPath]);

  useEffect(() => {
    const defaultOrg = status?.selectedOrg?.username || orgs.find((org) => org.isDefault)?.username || orgs[0]?.username || '';
    if (!selectedOrg && defaultOrg) setSelectedOrg(defaultOrg);
  }, [status, orgs, selectedOrg]);

  async function markSalesforce() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/salesforce/project-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, stack: 'salesforce' }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(envelopeError(data, 'Failed to update project stack'));
      onProjectUpdated?.(data.data.project);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function detectAndApply() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/salesforce/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, repoPath: repoPath || undefined, persist: true }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(envelopeError(data, 'Salesforce detection failed'));
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatus() {
    if (!project?.id) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ projectId: project.id });
      if (repoPath) params.set('repoPath', repoPath);
      const response = await fetch(`/api/salesforce/status?${params}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(envelopeError(data, 'Salesforce status failed'));
      setStatus(data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadObjects() {
    if (!repoPath || !selectedOrg) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ projectId: project.id, repoPath, targetOrg: selectedOrg });
      const response = await fetch(`/api/salesforce/objects?${params}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(envelopeError(data, 'Object list failed'));
      setObjects(data.data.objects || []);
      setDescribe(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadDescribe(objectName) {
    if (!repoPath || !selectedOrg || !objectName) return;
    setSelectedObject(objectName);
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ projectId: project.id, repoPath, targetOrg: selectedOrg });
      const response = await fetch(`/api/salesforce/objects/${encodeURIComponent(objectName)}?${params}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(envelopeError(data, 'Object describe failed'));
      setDescribe(data.data.describe);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function runSoql() {
    if (!repoPath || !selectedOrg || !soql.trim()) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/salesforce/soql/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, repoPath, targetOrg: selectedOrg, query: soql }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(envelopeError(data, 'SOQL query failed'));
      setSoql(data.data.query);
      setQueryResult(data.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function searchFlows() {
    if (!repoPath) return;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ projectId: project.id, repoPath });
      if (flowQuery.trim()) params.set('q', flowQuery.trim());
      const response = await fetch(`/api/salesforce/flows/search?${params}`);
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(envelopeError(data, 'Flow search failed'));
      setFlowResults(data.data.results || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!project) return null;

  if (!isSalesforce) {
    return (
      <div className="h-full overflow-auto p-3 space-y-3 text-xs">
        <div className="flex items-center gap-2 text-surface-200 font-medium">
          <Cloud className="w-4 h-4 text-sky-400" />
          Salesforce
        </div>
        <p className="text-surface-500 leading-relaxed">
          Enable Salesforce mode to inspect org schema, discover CLI auth state, and build Salesforce-aware tooling for this project.
        </p>
        {repos.length > 0 && (
          <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)} className="select text-xs">
            <option value="">Select repo for detection...</option>
            {repos.map((repo) => <option key={repo.path} value={repo.path}>{repo.name}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <button onClick={markSalesforce} disabled={loading} className="btn-primary text-xs py-1.5 px-2">Enable</button>
          <button onClick={detectAndApply} disabled={loading} className="btn-secondary text-xs py-1.5 px-2">Detect</button>
        </div>
        {error && <p className="text-danger-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3 space-y-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-surface-200 font-medium">
          <Cloud className="w-4 h-4 text-sky-400" />
          Salesforce
        </div>
        <button onClick={loadStatus} disabled={loading} className="p-1 rounded hover:bg-surface-700 text-surface-400">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)} className="select text-xs">
        <option value="">Select repo...</option>
        {repos.map((repo) => <option key={repo.path} value={repo.path}>{repo.name}</option>)}
      </select>

      <div className="grid grid-cols-2 gap-2">
        <StatusPill label="CLI" value={status?.cli?.available ? status.cli.version || 'ready' : 'missing'} ok={status?.cli?.available} />
        <StatusPill label="Detect" value={status?.detection?.detectedStack || 'unknown'} ok={status?.detection?.detectedStack === 'salesforce'} />
      </div>

      {selectedOrgSummary?.orgType && ['production', 'unknown'].includes(selectedOrgSummary.orgType) && (
        <div className="flex items-start gap-2 p-2 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-300">
          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{selectedOrgSummary.orgType === 'production' ? 'Production org selected. MVP operations are read-only.' : 'Unknown org type. Treat this org as high risk.'}</span>
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-surface-300 font-medium">
          <Database className="w-3.5 h-3.5" />
          Objects
        </div>
        <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} className="select text-xs" disabled={orgs.length === 0}>
          <option value="">Select org...</option>
          {orgs.map((org) => <option key={org.username} value={org.username}>{org.alias || org.usernameRedacted} {org.isDefault ? '(default)' : ''}</option>)}
        </select>
        <button onClick={loadObjects} disabled={!repoPath || !selectedOrg || loading} className="btn-secondary text-xs py-1.5 px-2 w-full">
          Load Objects
        </button>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-2.5 text-surface-500" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} className="input text-xs pl-7" placeholder="Search objects" />
        </div>
        <div className="max-h-40 overflow-auto border border-surface-700 rounded">
          {filteredObjects.map((name) => (
            <button key={name} onClick={() => loadDescribe(name)} className={`block w-full text-left px-2 py-1 hover:bg-surface-750 ${selectedObject === name ? 'text-sky-300 bg-surface-800' : 'text-surface-300'}`}>
              {name}
            </button>
          ))}
          {objects.length === 0 && <div className="p-2 text-surface-500">No objects loaded.</div>}
        </div>
      </section>

      {describe && (
        <section className="space-y-2 border-t border-surface-700 pt-3">
          <div className="text-surface-200 font-medium">{describe.name || selectedObject}</div>
          <div className="text-surface-500">{describe.label}</div>
          <div className="max-h-56 overflow-auto border border-surface-700 rounded">
            {(describe.fields || []).slice(0, 200).map((field) => (
              <div key={field.name} className="px-2 py-1 border-b border-surface-800 last:border-0">
                <div className="text-surface-200 font-mono">{field.name}</div>
                <div className="text-surface-500">{field.label} · {field.type}{field.nillable === false ? ' · required' : ''}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2 border-t border-surface-700 pt-3">
        <div className="text-surface-200 font-medium">SOQL Builder</div>
        <textarea
          value={soql}
          onChange={(e) => setSoql(e.target.value)}
          rows={4}
          className="input text-xs font-mono resize-none"
          placeholder="SELECT Id, Name FROM Account"
        />
        <button onClick={runSoql} disabled={!repoPath || !selectedOrg || loading} className="btn-primary text-xs py-1.5 px-2 w-full">
          Run Read-Only Query
        </button>
        {queryResult && (
          <div className="space-y-1">
            <div className="text-surface-500">{queryResult.totalSize} row(s)</div>
            <div className="max-h-48 overflow-auto border border-surface-700 rounded">
              <table className="min-w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-surface-850 text-surface-400">
                  <tr>{queryResult.columns.map((column) => <th key={column} className="px-2 py-1 border-b border-surface-700">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {queryResult.rows.slice(0, 100).map((row, index) => (
                    <tr key={index} className="border-b border-surface-800 last:border-0">
                      {queryResult.columns.map((column) => <td key={column} className="px-2 py-1 text-surface-300 font-mono">{String(row[column] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2 border-t border-surface-700 pt-3">
        <div className="flex items-center gap-2 text-surface-200 font-medium">
          <GitPullRequestArrow className="w-3.5 h-3.5" />
          Flow Search
        </div>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-2.5 text-surface-500" />
          <input
            value={flowQuery}
            onChange={(e) => setFlowQuery(e.target.value)}
            className="input text-xs pl-7"
            placeholder="Search flow name, object, field, action"
          />
        </div>
        <button onClick={searchFlows} disabled={!repoPath || loading} className="btn-secondary text-xs py-1.5 px-2 w-full">
          Search Local Flows
        </button>
        <div className="max-h-56 overflow-auto border border-surface-700 rounded">
          {flowResults.map((flow) => (
            <div key={`${flow.filePath}-${flow.fileHash}`} className="px-2 py-1.5 border-b border-surface-800 last:border-0">
              <div className="text-surface-200 font-medium">{flow.label || flow.flowName}</div>
              <div className="text-surface-500 font-mono truncate">{flow.filePath}</div>
              <div className="text-surface-500">
                {[...(flow.references?.objects || []), ...(flow.references?.fields || [])].slice(0, 4).join(' · ')}
              </div>
              {(flow.excerpts || []).slice(0, 2).map((line) => (
                <div key={line} className="text-[10px] text-surface-600 font-mono truncate">{line}</div>
              ))}
            </div>
          ))}
          {flowResults.length === 0 && <div className="p-2 text-surface-500">No flow results loaded.</div>}
        </div>
      </section>

      {status?.warnings?.map((warning) => <p key={warning} className="text-yellow-300">{warning}</p>)}
      {error && <p className="text-danger-400">{error}</p>}
    </div>
  );
}

function StatusPill({ label, value, ok }) {
  return (
    <div className="rounded border border-surface-700 bg-surface-900/50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-surface-500">{label}</div>
      <div className={ok ? 'text-green-300 truncate' : 'text-yellow-300 truncate'}>{value}</div>
    </div>
  );
}
