import { useState, useEffect } from 'react';
import {
  X,
  MessageSquare,
  Hash,
  CheckCircle,
  AlertCircle,
  Loader,
  ExternalLink,
  ChevronRight,
  Plug,
  Unplug,
  Send,
  Link2,
  Trash2,
} from 'lucide-react';

const SETUP_STEPS = [
  {
    num: '1',
    title: 'Create a Slack App',
    detail: (
      <>
        Go to{' '}
        <a
          href="https://api.slack.com/apps"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-400 underline inline-flex items-center gap-0.5"
        >
          api.slack.com/apps <ExternalLink size={10} />
        </a>{' '}
        and click <strong>"Create New App"</strong> &rarr; <strong>"From scratch"</strong>. Give it a name
        (e.g. "StartUpp IDE") and pick your workspace.
      </>
    ),
  },
  {
    num: '2',
    title: 'Enable Socket Mode',
    detail: (
      <>
        In the left sidebar go to <strong>Socket Mode</strong> and toggle it <strong>ON</strong>. It will
        ask you to generate an <strong>App-Level Token</strong> &mdash; name it anything (e.g. "socket") and
        add the scope <code className="text-xs bg-surface-800 px-1 rounded">connections:write</code>. Copy
        the <code className="text-xs bg-surface-800 px-1 rounded">xapp-...</code> token.
      </>
    ),
  },
  {
    num: '3',
    title: 'Add Bot Scopes',
    detail: (
      <>
        Go to <strong>OAuth &amp; Permissions</strong> and add these <strong>Bot Token Scopes</strong>:
        <div className="flex flex-wrap gap-1 mt-1">
          {['channels:history', 'channels:read', 'channels:manage', 'chat:write', 'groups:history', 'groups:read'].map(
            (s) => (
              <code key={s} className="text-[10px] bg-surface-800 px-1.5 py-0.5 rounded text-primary-300">
                {s}
              </code>
            ),
          )}
        </div>
      </>
    ),
  },
  {
    num: '4',
    title: 'Enable Events',
    detail: (
      <>
        Go to <strong>Event Subscriptions</strong>, toggle <strong>ON</strong>, and under{' '}
        <strong>Subscribe to bot events</strong> add:
        <div className="flex flex-wrap gap-1 mt-1">
          {['message.channels', 'message.groups'].map((s) => (
            <code key={s} className="text-[10px] bg-surface-800 px-1.5 py-0.5 rounded text-primary-300">
              {s}
            </code>
          ))}
        </div>
      </>
    ),
  },
  {
    num: '5',
    title: 'Install to Workspace',
    detail: (
      <>
        Go to <strong>Install App</strong> and click <strong>"Install to Workspace"</strong>. Authorize, then
        copy the <strong>Bot User OAuth Token</strong> (
        <code className="text-xs bg-surface-800 px-1 rounded">xoxb-...</code>).
      </>
    ),
  },
  {
    num: '6',
    title: 'Invite the bot to channels',
    detail: (
      <>
        In Slack, create or pick a channel for each project, then type{' '}
        <code className="text-xs bg-surface-800 px-1 rounded">/invite @YourBotName</code> so the bot can
        read and write in that channel.
      </>
    ),
  },
];

export default function SlackSetupPanel({ isOpen, onClose, projects }) {
  const [tab, setTab] = useState('guide'); // 'guide' | 'connect' | 'channels'
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Token inputs
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');

  // Channel mapping inputs
  const [selectedProject, setSelectedProject] = useState('');
  const [channelId, setChannelId] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchSettings();
      fetchStatus();
    }
  }, [isOpen]);

  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/slack/settings');
      const data = await res.json();
      setSettings(data);
    } catch {}
  };

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/slack/status');
      const data = await res.json();
      setStatus(data);
    } catch {}
  };

  const flash = (msg, type = 'success') => {
    if (type === 'error') { setError(msg); setSuccess(''); }
    else { setSuccess(msg); setError(''); }
    setTimeout(() => { setError(''); setSuccess(''); }, 4000);
  };

  const saveTokens = async () => {
    setLoading(true);
    try {
      const body = { enabled: true };
      if (botToken) body.botToken = botToken;
      if (appToken) body.appToken = appToken;
      const res = await fetch('/api/slack/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await fetchSettings();
      setBotToken('');
      setAppToken('');
      flash('Tokens saved');
    } catch (err) {
      flash(err.message, 'error');
    }
    setLoading(false);
  };

  const toggleConnection = async () => {
    setLoading(true);
    const endpoint = status?.connected ? '/api/slack/disconnect' : '/api/slack/connect';
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).message);
      await fetchStatus();
      flash(status?.connected ? 'Disconnected' : 'Connected');
    } catch (err) {
      flash(err.message, 'error');
    }
    setLoading(false);
  };

  const mapChannel = async () => {
    if (!selectedProject || !channelId.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/slack/map-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: selectedProject, channelId: channelId.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      await fetchSettings();
      setChannelId('');
      flash('Channel mapped');
    } catch (err) {
      flash(err.message, 'error');
    }
    setLoading(false);
  };

  const unmapChannel = async (projectId) => {
    setLoading(true);
    try {
      await fetch(`/api/slack/map-channel/${projectId}`, { method: 'DELETE' });
      await fetchSettings();
      flash('Channel unmapped');
    } catch (err) {
      flash(err.message, 'error');
    }
    setLoading(false);
  };

  const testMessage = async (projectId) => {
    try {
      const res = await fetch('/api/slack/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) throw new Error((await res.json()).message || 'Test failed');
      flash('Test message sent!');
    } catch (err) {
      flash(err.message, 'error');
    }
  };

  if (!isOpen) return null;

  const tabs = [
    { id: 'guide', label: 'Setup Guide' },
    { id: 'connect', label: 'Connect' },
    { id: 'channels', label: 'Channels' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-850 border border-surface-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#4A154B]" />
            <h2 className="text-lg font-semibold text-surface-100">Slack Integration</h2>
            {status?.connected && (
              <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded-full font-medium">
                Connected
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-700 rounded-lg transition-colors text-surface-400 hover:text-surface-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 bg-surface-800/50">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? 'text-primary-400 border-b-2 border-primary-400'
                  : 'text-surface-400 hover:text-surface-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Feedback */}
        {(error || success) && (
          <div
            className={`mx-4 mt-3 px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
              error ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-green-500/10 text-green-400 border border-green-500/20'
            }`}
          >
            {error ? <AlertCircle size={12} /> : <CheckCircle size={12} />}
            {error || success}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'guide' && <GuideTab />}
          {tab === 'connect' && (
            <ConnectTab
              settings={settings}
              status={status}
              botToken={botToken}
              appToken={appToken}
              onBotTokenChange={setBotToken}
              onAppTokenChange={setAppToken}
              onSave={saveTokens}
              onToggle={toggleConnection}
              loading={loading}
            />
          )}
          {tab === 'channels' && (
            <ChannelsTab
              settings={settings}
              status={status}
              projects={projects || []}
              selectedProject={selectedProject}
              channelId={channelId}
              onProjectChange={setSelectedProject}
              onChannelIdChange={setChannelId}
              onMap={mapChannel}
              onUnmap={unmapChannel}
              onTest={testMessage}
              loading={loading}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Guide Tab ──────────────────────────────────────────────────────────────

function GuideTab() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-surface-100 mb-1">How Slack Integration Works</h3>
        <p className="text-sm text-surface-400 leading-relaxed">
          Each project maps to a Slack channel. When you send a message in the channel, a new chat session
          starts and the AI responds <strong>in a thread</strong>. Reply to that thread to continue the
          conversation. Everything is mirrored in the IDE in real-time.
        </p>
      </div>

      <div className="bg-surface-800/50 border border-surface-700/50 rounded-lg p-3 space-y-1.5">
        <div className="flex items-center gap-2 text-sm text-surface-300">
          <Hash size={14} className="text-surface-500" />
          <strong>#my-project</strong>
          <span className="text-surface-500">=</span>
          <span>Project</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-surface-300 pl-6">
          <ChevronRight size={12} className="text-surface-500" />
          <span className="text-surface-500">Thread</span>
          <span className="text-surface-500">=</span>
          <span>Chat Session</span>
        </div>
      </div>

      <h3 className="text-base font-semibold text-surface-100 pt-2">Setup Steps</h3>
      <div className="space-y-3">
        {SETUP_STEPS.map((step) => (
          <div key={step.num} className="flex gap-3">
            <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-500/20 border border-primary-500/40 flex items-center justify-center">
              <span className="text-xs font-bold text-primary-400">{step.num}</span>
            </div>
            <div>
              <h4 className="text-sm font-medium text-surface-200">{step.title}</h4>
              <div className="text-xs text-surface-400 leading-relaxed mt-0.5">{step.detail}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-primary-500/5 border border-primary-500/20 rounded-lg p-3 mt-2">
        <p className="text-xs text-primary-300 leading-relaxed">
          <strong>Free plan?</strong> No problem. Socket Mode, bot messages, and channel events are all
          available on free Slack workspaces. The only limit is 90-day message history, which doesn't
          affect this integration.
        </p>
      </div>
    </div>
  );
}

// ─── Connect Tab ────────────────────────────────────────────────────────────

function ConnectTab({ settings, status, botToken, appToken, onBotTokenChange, onAppTokenChange, onSave, onToggle, loading }) {
  const hasTokens = settings?.botToken === '***configured***' && settings?.appToken === '***configured***';

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-surface-100">Bot Tokens</h3>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-surface-400 mb-1">Bot User OAuth Token (xoxb-...)</label>
          <input
            type="password"
            value={botToken}
            onChange={(e) => onBotTokenChange(e.target.value)}
            placeholder={settings?.botToken || 'xoxb-...'}
            className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 focus:outline-none focus:border-primary-500"
          />
        </div>
        <div>
          <label className="block text-xs text-surface-400 mb-1">App-Level Token (xapp-...)</label>
          <input
            type="password"
            value={appToken}
            onChange={(e) => onAppTokenChange(e.target.value)}
            placeholder={settings?.appToken || 'xapp-...'}
            className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 focus:outline-none focus:border-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSave}
            disabled={loading || (!botToken && !appToken)}
            className="px-3 py-1.5 text-sm font-medium bg-primary-500/20 hover:bg-primary-500/30 border border-primary-500/30 text-surface-200 rounded-lg transition-colors disabled:opacity-40"
          >
            {loading ? <Loader size={14} className="animate-spin" /> : 'Save Tokens'}
          </button>
          {hasTokens && <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12} /> Configured</span>}
        </div>
      </div>

      <div className="border-t border-surface-700 pt-4">
        <h3 className="text-base font-semibold text-surface-100 mb-2">Connection</h3>
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            disabled={loading || !hasTokens}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors border ${
              status?.connected
                ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                : 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
            } disabled:opacity-40`}
          >
            {loading ? (
              <Loader size={14} className="animate-spin" />
            ) : status?.connected ? (
              <Unplug size={14} />
            ) : (
              <Plug size={14} />
            )}
            {status?.connected ? 'Disconnect' : 'Connect'}
          </button>
          <span className="text-xs text-surface-500">
            {status?.connected
              ? `Active sessions: ${status.activeSessions || 0}`
              : 'Not connected'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Channels Tab ───────────────────────────────────────────────────────────

function ChannelsTab({ settings, status, projects, selectedProject, channelId, onProjectChange, onChannelIdChange, onMap, onUnmap, onTest, loading }) {
  const channelMap = settings?.channelMap || {};
  const mappedProjectIds = Object.keys(channelMap);
  const unmappedProjects = projects.filter((p) => !channelMap[p.id]);

  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-surface-100">Channel Mappings</h3>
      <p className="text-xs text-surface-400">
        Map each project to a Slack channel. To find a channel ID, right-click the channel in Slack &rarr;{' '}
        <strong>View channel details</strong> &rarr; copy the ID at the bottom.
      </p>

      {/* Existing mappings */}
      {mappedProjectIds.length > 0 && (
        <div className="space-y-2">
          {mappedProjectIds.map((pid) => {
            const project = projects.find((p) => p.id === pid);
            return (
              <div
                key={pid}
                className="flex items-center justify-between bg-surface-800/50 border border-surface-700/50 rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2 text-sm">
                  <Link2 size={12} className="text-primary-400" />
                  <span className="text-surface-200 font-medium">{project?.name || pid}</span>
                  <span className="text-surface-600">&rarr;</span>
                  <code className="text-xs text-surface-400 bg-surface-800 px-1.5 py-0.5 rounded">{channelMap[pid]}</code>
                </div>
                <div className="flex items-center gap-1">
                  {status?.connected && (
                    <button
                      onClick={() => onTest(pid)}
                      className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-green-400 transition-colors"
                      title="Send test message"
                    >
                      <Send size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => onUnmap(pid)}
                    className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-red-400 transition-colors"
                    title="Remove mapping"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new mapping */}
      {unmappedProjects.length > 0 && (
        <div className="bg-surface-800/30 border border-surface-700/50 rounded-lg p-3 space-y-2">
          <label className="text-xs text-surface-400">Add mapping</label>
          <div className="flex gap-2">
            <select
              value={selectedProject}
              onChange={(e) => onProjectChange(e.target.value)}
              className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5 text-sm text-surface-200 focus:outline-none focus:border-primary-500"
            >
              <option value="">Select project...</option>
              {unmappedProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={channelId}
              onChange={(e) => onChannelIdChange(e.target.value)}
              placeholder="Channel ID (C0...)"
              className="flex-1 bg-surface-800 border border-surface-700 rounded-lg px-2 py-1.5 text-sm text-surface-200 focus:outline-none focus:border-primary-500"
            />
            <button
              onClick={onMap}
              disabled={loading || !selectedProject || !channelId.trim()}
              className="px-3 py-1.5 text-sm font-medium bg-primary-500/20 hover:bg-primary-500/30 border border-primary-500/30 text-surface-200 rounded-lg transition-colors disabled:opacity-40"
            >
              Map
            </button>
          </div>
        </div>
      )}

      {projects.length === 0 && (
        <p className="text-xs text-surface-500 italic">No projects yet. Create a project first.</p>
      )}
    </div>
  );
}
