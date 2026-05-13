import { useState, useEffect } from 'react';
import { Plug, RefreshCw, Loader, CheckCircle, XCircle, AlertTriangle, Copy, Terminal, Unplug } from 'lucide-react';

export default function ConnectionManager({ projectId, connection, onConnectionChange }) {
  const [tab, setTab] = useState('cli'); // 'cli' | 'token'
  const [cliInfo, setCliInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Token form
  const [accessToken, setAccessToken] = useState('');
  const [instanceUrl, setInstanceUrl] = useState('');
  const [apiVersion, setApiVersion] = useState('v62.0');

  // CLI form
  const [selectedOrg, setSelectedOrg] = useState('');

  useEffect(() => {
    checkCli();
  }, []);

  const checkCli = async () => {
    try {
      const res = await fetch('/api/salesforce/connection/cli-check');
      const data = await res.json();
      if (data.ok) setCliInfo(data.data);
    } catch { /* ignore */ }
  };

  const connectWithCli = async () => {
    if (!selectedOrg) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/salesforce/connection/cli', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, usernameOrAlias: selectedOrg }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Connection failed');
      setSuccess(`Connected as ${data.data.username}`);
      onConnectionChange?.();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const connectWithToken = async () => {
    if (!accessToken || !instanceUrl) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch('/api/salesforce/connection/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, accessToken, instanceUrl, apiVersion }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Connection failed');
      setSuccess(`Connected as ${data.data.username}`);
      setAccessToken('');
      onConnectionChange?.();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const refreshConnection = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/salesforce/connection/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Refresh failed');
      setSuccess('Connection refreshed');
      onConnectionChange?.();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const disconnect = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/salesforce/connection/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Disconnect failed');
      setSuccess('Disconnected');
      onConnectionChange?.();
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const copyCommand = (cmd) => {
    navigator.clipboard.writeText(cmd);
  };

  const isConnected = connection?.connected === true;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Plug size={24} className="text-sky-400" />
        <h2 className="text-xl font-semibold">Connection Manager</h2>
      </div>

      {/* Current connection status */}
      {isConnected && (
        <div className="mb-6 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle size={16} className="text-emerald-400" />
            <span className="font-medium text-emerald-300">Connected</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm text-surface-300 mb-3">
            <div><span className="text-surface-500">Username:</span> {connection.connection?.username}</div>
            <div><span className="text-surface-500">Instance:</span> {connection.connection?.instanceUrl?.replace('https://', '')}</div>
            <div><span className="text-surface-500">API Version:</span> {connection.connection?.apiVersion}</div>
            <div><span className="text-surface-500">Connected:</span> {connection.connection?.connectedAt ? new Date(connection.connection.connectedAt).toLocaleDateString() : 'N/A'}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={refreshConnection} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-700 hover:bg-surface-600 rounded text-sm transition-colors">
              <RefreshCw size={14} /> Refresh Token
            </button>
            <button onClick={disconnect} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-sm transition-colors">
              <Unplug size={14} /> Disconnect
            </button>
          </div>
        </div>
      )}

      {connection?.tokenExpired && (
        <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-amber-400" />
            <span className="font-medium text-amber-300">Token Expired</span>
          </div>
          <p className="text-sm text-surface-400 mb-3">Your session has expired. Refresh the token using the CLI or enter a new token.</p>
          <button onClick={refreshConnection} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded text-sm">
            <RefreshCw size={14} /> Refresh from CLI
          </button>
        </div>
      )}

      {/* Connection methods */}
      {!isConnected && (
        <>
          <div className="flex gap-1 mb-4 bg-surface-800 rounded-lg p-1">
            <button
              onClick={() => setTab('cli')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${tab === 'cli' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}
            >
              Connect via CLI
            </button>
            <button
              onClick={() => setTab('token')}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${tab === 'token' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}
            >
              Paste Token
            </button>
          </div>

          {tab === 'cli' && (
            <div className="space-y-4">
              {/* CLI status */}
              <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${cliInfo?.cli?.available ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                {cliInfo?.cli?.available ? <CheckCircle size={14} /> : <XCircle size={14} />}
                {cliInfo?.cli?.available ? `Salesforce CLI found: ${cliInfo.cli.version}` : 'Salesforce CLI not found on host'}
              </div>

              {!cliInfo?.cli?.available && (
                <div className="bg-surface-800 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-surface-200">Install Salesforce CLI</h3>
                  <p className="text-sm text-surface-400">Run this command on your machine (not in the container):</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-surface-900 px-3 py-2 rounded text-sm text-sky-300 font-mono">npm install -g @salesforce/cli</code>
                    <button onClick={() => copyCommand('npm install -g @salesforce/cli')} className="p-2 hover:bg-surface-700 rounded" title="Copy">
                      <Copy size={14} className="text-surface-400" />
                    </button>
                  </div>
                </div>
              )}

              {cliInfo?.cli?.available && (
                <>
                  {/* Step 1: Authenticate */}
                  <div className="bg-surface-800 rounded-lg p-4 space-y-3">
                    <h3 className="text-sm font-medium text-surface-200">Step 1: Authenticate an org</h3>
                    <p className="text-sm text-surface-400">Run this on your machine to open the Salesforce login page:</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 bg-surface-900 px-3 py-2 rounded text-sm text-sky-300 font-mono">sf org login web --alias myorg</code>
                      <button onClick={() => copyCommand('sf org login web --alias myorg')} className="p-2 hover:bg-surface-700 rounded">
                        <Copy size={14} className="text-surface-400" />
                      </button>
                    </div>
                    <p className="text-xs text-surface-500">For sandbox: add --instance-url https://test.salesforce.com</p>
                  </div>

                  {/* Step 2: Select org */}
                  <div className="bg-surface-800 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-surface-200">Step 2: Select authenticated org</h3>
                      <button onClick={checkCli} className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
                        <RefreshCw size={12} /> Refresh
                      </button>
                    </div>

                    {cliInfo?.orgs?.length > 0 ? (
                      <>
                        <select
                          value={selectedOrg}
                          onChange={(e) => setSelectedOrg(e.target.value)}
                          className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-200"
                        >
                          <option value="">Select an org...</option>
                          {cliInfo.orgs.map((org) => (
                            <option key={org.username} value={org.username}>
                              {org.alias ? `${org.alias} (${org.username})` : org.username} — {org.orgType}
                              {org.isDefault ? ' [default]' : ''}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={connectWithCli}
                          disabled={!selectedOrg || loading}
                          className="w-full py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                        >
                          {loading ? <Loader size={14} className="animate-spin" /> : <Plug size={14} />}
                          Connect
                        </button>
                      </>
                    ) : (
                      <p className="text-sm text-surface-500">No authenticated orgs found. Complete Step 1 first, then click Refresh.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {tab === 'token' && (
            <div className="space-y-4">
              <div className="bg-surface-800 rounded-lg p-4 space-y-3">
                <h3 className="text-sm font-medium text-surface-200">Manual Token Connection</h3>
                <p className="text-sm text-surface-400">
                  Get your access token from Salesforce Setup &gt; Session Settings, or from your Connected App.
                </p>

                <div>
                  <label className="block text-xs text-surface-400 mb-1">Instance URL</label>
                  <input
                    type="url"
                    value={instanceUrl}
                    onChange={(e) => setInstanceUrl(e.target.value)}
                    placeholder="https://myorg.my.salesforce.com"
                    className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-600"
                  />
                </div>

                <div>
                  <label className="block text-xs text-surface-400 mb-1">Access Token</label>
                  <input
                    type="password"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                    placeholder="00D..."
                    className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-600"
                  />
                </div>

                <div>
                  <label className="block text-xs text-surface-400 mb-1">API Version</label>
                  <input
                    type="text"
                    value={apiVersion}
                    onChange={(e) => setApiVersion(e.target.value)}
                    placeholder="v62.0"
                    className="w-full bg-surface-900 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-600"
                  />
                </div>

                <button
                  onClick={connectWithToken}
                  disabled={!accessToken || !instanceUrl || loading}
                  className="w-full py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <Loader size={14} className="animate-spin" /> : <Plug size={14} />}
                  Connect
                </button>
              </div>

              <div className="bg-surface-800/50 rounded-lg p-4">
                <h4 className="text-xs font-medium text-surface-400 mb-2 flex items-center gap-1"><Terminal size={12} /> Quick way to get a token</h4>
                <div className="space-y-2 text-xs text-surface-500">
                  <p>1. Authenticate via CLI: <code className="text-sky-400">sf org login web</code></p>
                  <p>2. Get the token: <code className="text-sky-400">sf org display --json</code></p>
                  <p>3. Copy <code className="text-sky-400">accessToken</code> and <code className="text-sky-400">instanceUrl</code> from the output</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Messages */}
      {error && (
        <div className="mt-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-center gap-2 text-sm text-red-300">
          <XCircle size={14} /> {error}
        </div>
      )}
      {success && (
        <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 flex items-center gap-2 text-sm text-emerald-300">
          <CheckCircle size={14} /> {success}
        </div>
      )}
    </div>
  );
}
