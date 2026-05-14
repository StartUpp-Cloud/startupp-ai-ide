import { useState, useEffect, useCallback } from 'react';
import { Plug, RefreshCw, Loader, CheckCircle, XCircle, AlertTriangle, Copy, Unplug, Cloud, Server, Monitor } from 'lucide-react';

function StatusBadge({ ok, label, detail }) {
  return (
    <div className={`flex items-center gap-2 p-2.5 rounded-lg text-sm ${ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
      {ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
      <span className="font-medium">{label}</span>
      {detail && <span className="text-xs opacity-70 ml-auto">{detail}</span>}
    </div>
  );
}

function EnvironmentCard({ envType, envLabel, status, hostOrgs, onConnect, onDisconnect, onRefresh, loading, loadingEnv }) {
  const [selectedOrg, setSelectedOrg] = useState('');
  const isLoading = loading && loadingEnv === envType;

  const isConnected = status?.connected === true;
  const isExpired = status?.tokenExpired === true;

  return (
    <div className="bg-surface-800/60 border border-surface-700/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cloud size={16} className={envType === 'sandbox' ? 'text-amber-400' : 'text-sky-400'} />
          <h3 className="text-sm font-semibold">{envLabel}</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-700 text-surface-400 font-mono">
            {envType === 'sandbox' ? 'my-sandbox' : 'production'}
          </span>
        </div>
        {isConnected && (
          <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Connected
          </span>
        )}
        {isExpired && (
          <span className="flex items-center gap-1.5 text-[11px] text-amber-400">
            <AlertTriangle size={11} />
            Expired
          </span>
        )}
      </div>

      {isConnected ? (
        <div>
          <div className="grid grid-cols-2 gap-1.5 text-[12px] text-surface-300 mb-3">
            <div><span className="text-surface-500">User:</span> {status.username}</div>
            <div><span className="text-surface-500">Instance:</span> {status.instanceUrl?.replace('https://', '')}</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onRefresh(envType)}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface-700 hover:bg-surface-600 rounded text-xs transition-colors disabled:opacity-50"
            >
              {isLoading ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Refresh
            </button>
            <button
              onClick={() => onDisconnect(envType)}
              disabled={loading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-300 rounded text-xs transition-colors disabled:opacity-50"
            >
              <Unplug size={12} /> Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div>
          {isExpired && (
            <div className="mb-3 flex items-center gap-2 p-2 rounded bg-amber-500/10 text-amber-300 text-xs">
              <AlertTriangle size={12} />
              <span>Token expired for {status.username}.</span>
              <button
                onClick={() => onRefresh(envType)}
                disabled={loading}
                className="ml-auto underline hover:no-underline"
              >
                Refresh
              </button>
            </div>
          )}
          <p className="text-xs text-surface-400 mb-2">
            Select the host org to connect as <span className="font-mono text-sky-300">{envType === 'sandbox' ? 'my-sandbox' : 'production'}</span> in the container:
          </p>
          <div className="flex gap-2">
            <select
              value={selectedOrg}
              onChange={(e) => setSelectedOrg(e.target.value)}
              className="flex-1 bg-surface-900 border border-surface-600 rounded px-2.5 py-1.5 text-xs text-surface-200"
            >
              <option value="">Select an org...</option>
              {hostOrgs.map((org) => (
                <option key={org.username} value={org.username}>
                  {org.alias ? `${org.alias} (${org.username})` : org.username} -- {org.orgType}
                </option>
              ))}
            </select>
            <button
              onClick={() => { onConnect(envType, selectedOrg); setSelectedOrg(''); }}
              disabled={!selectedOrg || loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded text-xs font-medium transition-colors"
            >
              {isLoading ? <Loader size={12} className="animate-spin" /> : <Plug size={12} />}
              Connect
            </button>
          </div>
          {hostOrgs.length === 0 && (
            <p className="text-[11px] text-surface-500 mt-2">No orgs found on host. Authenticate first (see above), then refresh.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConnectionManager({ projectId, onConnectionChange }) {
  const [setup, setSetup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [loadingEnv, setLoadingEnv] = useState(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const fetchSetupStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await fetch(`/api/salesforce/connection/setup-status?projectId=${projectId}`);
      const data = await res.json();
      if (data.ok) setSetup(data.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId]);

  useEffect(() => { fetchSetupStatus(); }, [fetchSetupStatus]);

  const copyCommand = (cmd) => {
    navigator.clipboard.writeText(cmd);
  };

  const connectEnv = async (envType, hostUsernameOrAlias) => {
    if (!hostUsernameOrAlias) return;
    setActionLoading(true);
    setLoadingEnv(envType);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/salesforce/connection/connect-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, envType, hostUsernameOrAlias }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Connection failed');
      setSuccess(`${envType === 'sandbox' ? 'Sandbox' : 'Production'} connected as ${data.data.username}`);
      await fetchSetupStatus();
      onConnectionChange?.();
    } catch (err) {
      setError(err.message);
    }
    setActionLoading(false);
    setLoadingEnv(null);
  };

  const disconnectEnv = async (envType) => {
    setActionLoading(true);
    setLoadingEnv(envType);
    setError(null);
    try {
      const res = await fetch('/api/salesforce/connection/disconnect-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, envType }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Disconnect failed');
      setSuccess(`${envType === 'sandbox' ? 'Sandbox' : 'Production'} disconnected`);
      await fetchSetupStatus();
      onConnectionChange?.();
    } catch (err) {
      setError(err.message);
    }
    setActionLoading(false);
    setLoadingEnv(null);
  };

  const refreshEnv = async (envType) => {
    setActionLoading(true);
    setLoadingEnv(envType);
    setError(null);
    try {
      const res = await fetch('/api/salesforce/connection/refresh-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, envType }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Refresh failed');
      setSuccess(`${envType === 'sandbox' ? 'Sandbox' : 'Production'} token refreshed`);
      await fetchSetupStatus();
      onConnectionChange?.();
    } catch (err) {
      setError(err.message);
    }
    setActionLoading(false);
    setLoadingEnv(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader size={20} className="animate-spin text-surface-500" />
      </div>
    );
  }

  const hostCliOk = setup?.hostCli?.available === true;
  const containerCliOk = setup?.containerCli?.available === true;
  const hasContainer = setup?.hasContainer === true;

  return (
    <div className="p-4 max-w-2xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Plug size={18} className="text-sky-400" />
        <h2 className="text-base font-semibold">Salesforce Setup</h2>
        <button
          onClick={() => { setLoading(true); fetchSetupStatus(); }}
          className="ml-auto flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300"
        >
          <RefreshCw size={11} /> Refresh
        </button>
      </div>

      {/* Prerequisites checklist */}
      <div className="space-y-2">
        <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wide">Prerequisites</h3>
        <StatusBadge
          ok={hostCliOk}
          label="Salesforce CLI on host"
          detail={hostCliOk ? setup.hostCli.version?.split('\n')[0] : null}
        />
        {!hostCliOk && (
          <div className="ml-6 bg-surface-800 rounded-lg p-3 space-y-2">
            <p className="text-xs text-surface-400">Install on your machine (not in the container):</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-surface-900 px-2.5 py-1.5 rounded text-xs text-sky-300 font-mono">npm install -g @salesforce/cli</code>
              <button onClick={() => copyCommand('npm install -g @salesforce/cli')} className="p-1.5 hover:bg-surface-700 rounded" title="Copy">
                <Copy size={12} className="text-surface-400" />
              </button>
            </div>
          </div>
        )}

        <StatusBadge ok={hasContainer} label="Project container" detail={hasContainer ? 'Running' : 'No container'} />
      </div>

      {/* Auth instructions */}
      {hostCliOk && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wide">Authenticate Orgs on Host</h3>
          <div className="bg-surface-800 rounded-lg p-3 space-y-2.5">
            <p className="text-xs text-surface-400">
              Run these on your machine to authenticate. The connection will be transferred to the container automatically.
            </p>
            <div className="space-y-2">
              <div>
                <label className="text-[10px] text-surface-500 uppercase tracking-wide">Production</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="flex-1 bg-surface-900 px-2.5 py-1.5 rounded text-xs text-sky-300 font-mono">sf org login web</code>
                  <button onClick={() => copyCommand('sf org login web')} className="p-1.5 hover:bg-surface-700 rounded">
                    <Copy size={12} className="text-surface-400" />
                  </button>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-surface-500 uppercase tracking-wide">Sandbox</label>
                <div className="flex items-center gap-2 mt-0.5">
                  <code className="flex-1 bg-surface-900 px-2.5 py-1.5 rounded text-xs text-sky-300 font-mono">sf org login web --instance-url https://test.salesforce.com</code>
                  <button onClick={() => copyCommand('sf org login web --instance-url https://test.salesforce.com')} className="p-1.5 hover:bg-surface-700 rounded">
                    <Copy size={12} className="text-surface-400" />
                  </button>
                </div>
              </div>
            </div>
            <p className="text-[10px] text-surface-500">
              After authenticating, click Refresh above to see your orgs.
            </p>
          </div>

          {/* Host orgs summary */}
          {setup?.hostOrgs?.length > 0 && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-800/50 text-xs text-surface-400">
              <Monitor size={12} />
              <span>{setup.hostOrgs.length} org{setup.hostOrgs.length !== 1 ? 's' : ''} authenticated on host</span>
            </div>
          )}
        </div>
      )}

      {/* Environment connections */}
      {hostCliOk && hasContainer && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium text-surface-400 uppercase tracking-wide">Environments</h3>
          <EnvironmentCard
            envType="sandbox"
            envLabel="Sandbox"
            status={setup?.environments?.sandbox}
            hostOrgs={setup?.hostOrgs || []}
            onConnect={connectEnv}
            onDisconnect={disconnectEnv}
            onRefresh={refreshEnv}
            loading={actionLoading}
            loadingEnv={loadingEnv}
          />
          <EnvironmentCard
            envType="production"
            envLabel="Production"
            status={setup?.environments?.production}
            hostOrgs={setup?.hostOrgs || []}
            onConnect={connectEnv}
            onDisconnect={disconnectEnv}
            onRefresh={refreshEnv}
            loading={actionLoading}
            loadingEnv={loadingEnv}
          />
        </div>
      )}

      {/* Messages */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 flex items-center gap-2 text-xs text-red-300">
          <XCircle size={13} /> {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-2.5 flex items-center gap-2 text-xs text-emerald-300">
          <CheckCircle size={13} /> {success}
        </div>
      )}
    </div>
  );
}
