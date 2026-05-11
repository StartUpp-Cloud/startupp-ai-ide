import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, KeyRound, Loader2, PlugZap, RefreshCw, ShieldAlert, Trash2, XCircle } from 'lucide-react';

const TARGETS = [
  { id: 'pty', label: 'Terminals' },
  { id: 'shell-proxy', label: 'Chat Shell' },
  { id: 'agent', label: 'Agents' },
  { id: 'scheduler', label: 'Scheduler' },
  { id: 'container-create', label: 'Container Create' },
];

function statusStyle(status) {
  if (status === 'connected') return 'text-green-300 bg-green-500/10 border-green-500/20';
  if (status === 'validation_failed' || status === 'invalid') return 'text-red-300 bg-red-500/10 border-red-500/20';
  if (status === 'disconnected') return 'text-surface-400 bg-surface-800 border-surface-700';
  return 'text-amber-300 bg-amber-500/10 border-amber-500/20';
}

export default function Connections() {
  const [providers, setProviders] = useState([]);
  const [connections, setConnections] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedProviderId, setSelectedProviderId] = useState('openai');
  const [form, setForm] = useState({
    displayName: '',
    kind: 'application',
    scope: 'workspace',
    projectId: '',
    fields: {},
    nonSecretConfig: {},
    applyTo: ['pty', 'shell-proxy', 'agent', 'scheduler'],
    validateNow: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === selectedProviderId),
    [providers, selectedProviderId],
  );

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedProvider) return;
    const nonSecretConfig = {};
    for (const field of selectedProvider.nonSecretFields || []) {
      nonSecretConfig[field.name] = field.defaultValue || '';
    }
    setForm((current) => ({
      ...current,
      displayName: selectedProvider.name,
      kind: selectedProvider.kind,
      scope: selectedProvider.supportedScopes?.[0] || 'workspace',
      projectId: '',
      fields: {},
      nonSecretConfig,
    }));
  }, [selectedProvider]);

  async function loadData() {
    const [providersRes, connectionsRes, projectsRes] = await Promise.all([
      fetch('/api/connections/providers'),
      fetch('/api/connections'),
      fetch('/api/projects'),
    ]);
    const providersData = await providersRes.json();
    const connectionsData = await connectionsRes.json();
    const projectsData = await projectsRes.json();
    setProviders(providersData.providers || []);
    setConnections(connectionsData.connections || []);
    setProjects(projectsData.projects || projectsData || []);
  }

  function updateSecret(name, value) {
    setForm((current) => ({ ...current, fields: { ...current.fields, [name]: value } }));
  }

  function updateConfig(name, value) {
    setForm((current) => ({ ...current, nonSecretConfig: { ...current.nonSecretConfig, [name]: value } }));
  }

  function toggleTarget(target) {
    setForm((current) => {
      const set = new Set(current.applyTo);
      if (set.has(target)) set.delete(target);
      else set.add(target);
      return { ...current, applyTo: [...set] };
    });
  }

  async function saveConnection(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProviderId,
          displayName: form.displayName,
          kind: form.kind,
          scope: form.scope,
          projectId: form.scope === 'project' ? form.projectId : null,
          fields: form.fields,
          nonSecretConfig: form.nonSecretConfig,
          environment: { applyTo: form.applyTo },
          validateNow: form.validateNow,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save connection');
      setForm((current) => ({ ...current, fields: {} }));
      await loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function action(id, path, method = 'POST') {
    setError('');
    const res = await fetch(`/api/connections/${id}${path}`, { method });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || 'Action failed');
    await loadData();
  }

  return (
    <div className="space-y-6 text-surface-200">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <PlugZap className="w-6 h-6 text-primary-400" />
            Connections
          </h1>
          <p className="text-sm text-surface-400 mt-1">
            Connect API providers and project runtime tokens without using the terminal.
          </p>
        </div>
      </div>

      {error && (
        <div className="border border-red-500/30 bg-red-500/10 text-red-300 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <section className="grid lg:grid-cols-[360px_1fr] gap-6">
        <form onSubmit={saveConnection} className="bg-surface-850 border border-surface-700 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="font-semibold flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary-400" />
              Add Connection
            </h2>
            <p className="text-xs text-surface-500 mt-1">Secrets are encrypted server-side and are never shown after save.</p>
          </div>

          <div>
            <label className="text-xs uppercase text-surface-500 block mb-1">Provider</label>
            <select
              value={selectedProviderId}
              onChange={(event) => setSelectedProviderId(event.target.value)}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary-500/50"
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs uppercase text-surface-500 block mb-1">Display Name</label>
            <input
              value={form.displayName}
              onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
              className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary-500/50"
            />
          </div>

          {selectedProvider?.supportedKinds?.length > 1 && (
            <div>
              <label className="text-xs uppercase text-surface-500 block mb-1">Use As</label>
              <select
                value={form.kind}
                onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value }))}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary-500/50"
              >
                {selectedProvider.supportedKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase text-surface-500 block mb-1">Scope</label>
              <select
                value={form.scope}
                onChange={(event) => setForm((current) => ({ ...current, scope: event.target.value }))}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary-500/50"
              >
                {(selectedProvider?.supportedScopes || ['workspace']).map((scope) => <option key={scope} value={scope}>{scope}</option>)}
              </select>
            </div>
            {form.scope === 'project' && (
              <div>
                <label className="text-xs uppercase text-surface-500 block mb-1">Project</label>
                <select
                  value={form.projectId}
                  onChange={(event) => setForm((current) => ({ ...current, projectId: event.target.value }))}
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary-500/50"
                >
                  <option value="">Select...</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </div>
            )}
          </div>

          {(selectedProvider?.fields || []).map((field) => (
            <div key={field.name}>
              <label className="text-xs uppercase text-surface-500 block mb-1">{field.label}</label>
              <input
                type="password"
                autoComplete="off"
                value={form.fields[field.name] || ''}
                onChange={(event) => updateSecret(field.name, event.target.value)}
                placeholder={field.placeholder || ''}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary-500/50"
              />
            </div>
          ))}

          {(selectedProvider?.nonSecretFields || []).map((field) => (
            <div key={field.name}>
              <label className="text-xs uppercase text-surface-500 block mb-1">{field.label}</label>
              <input
                value={form.nonSecretConfig[field.name] || ''}
                onChange={(event) => updateConfig(field.name, event.target.value)}
                className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary-500/50"
              />
            </div>
          ))}

          {form.kind === 'project-runtime' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-200 flex gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                Project code can read injected environment variables. Only attach secrets to repositories you trust.
              </div>
              <div>
                <label className="text-xs uppercase text-surface-500 block mb-2">Apply To</label>
                <div className="grid grid-cols-2 gap-2">
                  {TARGETS.map((target) => (
                    <label key={target.id} className="flex items-center gap-2 text-xs text-surface-300 bg-surface-800 border border-surface-700 rounded-lg px-2 py-2">
                      <input
                        type="checkbox"
                        checked={form.applyTo.includes(target.id)}
                        onChange={() => toggleTarget(target.id)}
                      />
                      {target.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-sm text-surface-300">
            <input
              type="checkbox"
              checked={form.validateNow}
              onChange={(event) => setForm((current) => ({ ...current, validateNow: event.target.checked }))}
            />
            Validate after save
          </label>

          <button
            type="submit"
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-surface-950 rounded-lg py-2 text-sm font-semibold"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Connection
          </button>
        </form>

        <div className="space-y-3">
          {connections.length === 0 ? (
            <div className="bg-surface-850 border border-surface-700 rounded-2xl p-8 text-center text-surface-500">
              No connections configured yet.
            </div>
          ) : connections.map((connection) => (
            <div key={connection.id} className="bg-surface-850 border border-surface-700 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold">{connection.displayName}</h3>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${statusStyle(connection.status)}`}>{connection.status}</span>
                  </div>
                  <p className="text-xs text-surface-500 mt-1">
                    {connection.providerId} · {connection.kind} · {connection.scope}{connection.projectId ? ` · ${projects.find((p) => p.id === connection.projectId)?.name || connection.projectId}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => action(connection.id, '/validate')} className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700" title="Validate">
                    <RefreshCw className="w-4 h-4 text-surface-300" />
                  </button>
                  <button onClick={() => action(connection.id, '/disconnect')} className="p-2 rounded-lg bg-surface-800 hover:bg-surface-700" title="Disconnect">
                    <XCircle className="w-4 h-4 text-amber-300" />
                  </button>
                  <button onClick={() => action(connection.id, '', 'DELETE')} className="p-2 rounded-lg bg-surface-800 hover:bg-red-500/20" title="Delete">
                    <Trash2 className="w-4 h-4 text-red-300" />
                  </button>
                </div>
              </div>
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                {Object.entries(connection.fields || {}).map(([name, field]) => (
                  <div key={name} className="text-xs bg-surface-800 rounded-lg px-3 py-2 text-surface-400">
                    {name}: {field.present ? field.masked : 'not set'}
                  </div>
                ))}
                {(connection.environment?.variables || []).map((name) => (
                  <div key={name} className="text-xs bg-surface-800 rounded-lg px-3 py-2 text-surface-400">
                    env: {name}
                  </div>
                ))}
              </div>
              {connection.validation?.lastErrorMessage && (
                <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {connection.validation.lastErrorMessage}
                </div>
              )}
              {connection.status === 'connected' && (
                <div className="mt-3 flex items-center gap-1 text-xs text-green-300">
                  <CheckCircle className="w-3.5 h-3.5" /> Validated
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
