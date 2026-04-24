import { useState, useEffect, useCallback } from 'react';
import {
  X,
  Settings,
  Cpu,
  Check,
  AlertCircle,
  RefreshCw,
  Zap,
  Brain,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Server,
  Key,
  Sliders,
  TestTube,
  Loader2,
  Shield,
  AlertTriangle,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

const API_BASE = '/api';

export default function LLMSettingsPanel({ isOpen, onClose }) {
  const [settings, setSettings] = useState(null);
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState([]);
  const [opencodeModels, setOpencodeModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [activeTab, setActiveTab] = useState('general');

  // Load settings on open
  useEffect(() => {
    if (isOpen) {
      loadSettings();
      loadHealth();
      loadOllamaModels();
      loadOpenCodeModels();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/llm/settings`);
      const data = await res.json();
      setSettings(data);
    } catch (error) {
      console.error('Failed to load LLM settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/llm/health`);
      const data = await res.json();
      setHealth(data);
    } catch (error) {
      console.error('Failed to check health:', error);
    }
  };

  const loadOllamaModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/llm/ollama/models`);
      const data = await res.json();
      setModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadOpenCodeModels = async () => {
    try {
      const res = await fetch(`${API_BASE}/llm/opencode/models`);
      const data = await res.json();
      setOpencodeModels(data.models || []);
    } catch (error) {
      console.error('Failed to load OpenCode models:', error);
      setOpencodeModels([]);
    }
  };

  const saveSettings = async (updates) => {
    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/llm/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      setSettings(data);
      // Refresh health after settings change
      loadHealth();
    } catch (error) {
      console.error('Failed to save settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveOllamaConfig = async (updates) => {
    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/llm/ollama/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await res.json();
      await loadSettings();
      loadHealth();
    } catch (error) {
      console.error('Failed to save Ollama config:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveOpenAIConfig = async (updates) => {
    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/llm/openai/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await res.json();
      await loadSettings();
      loadHealth();
    } catch (error) {
      console.error('Failed to save OpenAI config:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveDeepSeekConfig = async (updates) => {
    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/llm/deepseek/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await res.json();
      await loadSettings();
      loadHealth();
    } catch (error) {
      console.error('Failed to save DeepSeek config:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveGitHubConfig = async (updates) => {
    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/llm/github/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await res.json();
      await loadSettings();
      loadHealth();
    } catch (error) {
      console.error('Failed to save GitHub config:', error);
    } finally {
      setSaving(false);
    }
  };

  const saveOpenCodeConfig = async (updates) => {
    try {
      setSaving(true);
      const res = await fetch(`${API_BASE}/llm/opencode/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await res.json();
      await loadSettings();
      loadHealth();
    } catch (error) {
      console.error('Failed to save OpenCode config:', error);
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      const res = await fetch(`${API_BASE}/llm/test`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setTestResult({ error: data.message || data.error || `Test failed (${res.status})` });
        return;
      }
      setTestResult(data);
    } catch (error) {
      setTestResult({ error: error.message });
    } finally {
      setTesting(false);
    }
  };

  const pullModel = async (modelName) => {
    try {
      const res = await fetch(`${API_BASE}/llm/ollama/pull`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelName }),
      });
      await res.json();
      loadOllamaModels();
    } catch (error) {
      console.error('Failed to pull model:', error);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface-850 border border-surface-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-700 bg-surface-800">
          <div className="flex items-center gap-2">
            <Cpu className="w-5 h-5 text-green-400" />
            <h2 className="text-lg font-semibold text-surface-100">LLM Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-surface-700 rounded-lg transition-colors text-surface-400 hover:text-surface-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-surface-700 overflow-x-auto">
          {[
            { id: 'general', label: 'General', icon: Settings },
            { id: 'security', label: 'Security', icon: Shield },
            { id: 'ollama', label: 'Ollama', icon: Server },
            { id: 'openai', label: 'OpenAI', icon: Key },
            { id: 'opencode', label: 'OpenCode', icon: Sparkles },
            { id: 'deepseek', label: 'DeepSeek', icon: Brain },
            { id: 'github', label: 'GitHub', icon: Sparkles },
            { id: 'advanced', label: 'Advanced', icon: Sliders },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-primary-400 border-b-2 border-primary-500 bg-primary-500/5'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-750'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-surface-400" />
            </div>
          ) : (
            <>
              {/* General Tab */}
              {activeTab === 'general' && settings && (
                <div className="space-y-6">
                  {/* Enable/Disable */}
                  <div className="flex items-center justify-between p-4 bg-surface-800 rounded-lg border border-surface-700">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg ${settings.enabled ? 'bg-green-500/20' : 'bg-surface-700'}`}>
                        <Zap className={`w-5 h-5 ${settings.enabled ? 'text-green-400' : 'text-surface-500'}`} />
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-surface-200">LLM Integration</h3>
                        <p className="text-xs text-surface-500">
                          Use LLM as fallback when smart engine confidence is low
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => saveSettings({ enabled: !settings.enabled })}
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        settings.enabled ? 'bg-green-500' : 'bg-surface-600'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                          settings.enabled ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* Provider Selection */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      LLM Provider
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={() => saveSettings({ provider: 'ollama' })}
                        className={`p-4 rounded-lg border text-left transition-all ${
                          settings.provider === 'ollama'
                            ? 'border-green-500 bg-green-500/10'
                            : 'border-surface-700 bg-surface-800 hover:border-surface-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Server className={`w-5 h-5 ${settings.provider === 'ollama' ? 'text-green-400' : 'text-surface-400'}`} />
                          <span className={`font-medium ${settings.provider === 'ollama' ? 'text-green-300' : 'text-surface-300'}`}>
                            Ollama
                          </span>
                          {settings.provider === 'ollama' && (
                            <Check className="w-4 h-4 text-green-400 ml-auto" />
                          )}
                        </div>
                        <p className="text-xs text-surface-500">
                          Local LLM - Free, private, no API key needed
                        </p>
                      </button>

                      <button
                        onClick={() => saveSettings({ provider: 'openai' })}
                        className={`p-4 rounded-lg border text-left transition-all ${
                          settings.provider === 'openai'
                            ? 'border-blue-500 bg-blue-500/10'
                            : 'border-surface-700 bg-surface-800 hover:border-surface-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Key className={`w-5 h-5 ${settings.provider === 'openai' ? 'text-blue-400' : 'text-surface-400'}`} />
                          <span className={`font-medium ${settings.provider === 'openai' ? 'text-blue-300' : 'text-surface-300'}`}>
                            OpenAI
                          </span>
                          {settings.provider === 'openai' && (
                            <Check className="w-4 h-4 text-blue-400 ml-auto" />
                          )}
                        </div>
                        <p className="text-xs text-surface-500">
                          Cloud API - Requires API key, usage costs apply
                        </p>
                      </button>

                      <button
                        onClick={() => saveSettings({ provider: 'deepseek' })}
                        className={`p-4 rounded-lg border text-left transition-all ${
                          settings.provider === 'deepseek'
                            ? 'border-purple-500 bg-purple-500/10'
                            : 'border-surface-700 bg-surface-800 hover:border-surface-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Brain className={`w-5 h-5 ${settings.provider === 'deepseek' ? 'text-purple-400' : 'text-surface-400'}`} />
                          <span className={`font-medium ${settings.provider === 'deepseek' ? 'text-purple-300' : 'text-surface-300'}`}>
                            DeepSeek
                          </span>
                          {settings.provider === 'deepseek' && (
                            <Check className="w-4 h-4 text-purple-400 ml-auto" />
                          )}
                        </div>
                        <p className="text-xs text-surface-500">
                          Affordable API - Great for code tasks
                        </p>
                      </button>

                      <button
                        onClick={() => saveSettings({ provider: 'github' })}
                        className={`p-4 rounded-lg border text-left transition-all ${
                          settings.provider === 'github'
                            ? 'border-emerald-500 bg-emerald-500/10'
                            : 'border-surface-700 bg-surface-800 hover:border-surface-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className={`w-5 h-5 ${settings.provider === 'github' ? 'text-emerald-400' : 'text-surface-400'}`} />
                          <span className={`font-medium ${settings.provider === 'github' ? 'text-emerald-300' : 'text-surface-300'}`}>
                            GitHub Copilot
                          </span>
                          {settings.provider === 'github' && (
                            <Check className="w-4 h-4 text-emerald-400 ml-auto" />
                          )}
                        </div>
                        <p className="text-xs text-surface-500">
                          Free with Copilot - GPT-4o, Llama & more
                        </p>
                      </button>

                      <button
                        onClick={() => saveSettings({ provider: 'opencode' })}
                        className={`p-4 rounded-lg border text-left transition-all ${
                          settings.provider === 'opencode'
                            ? 'border-violet-500 bg-violet-500/10'
                            : 'border-surface-700 bg-surface-800 hover:border-surface-600'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Sparkles className={`w-5 h-5 ${settings.provider === 'opencode' ? 'text-violet-400' : 'text-surface-400'}`} />
                          <span className={`font-medium ${settings.provider === 'opencode' ? 'text-violet-300' : 'text-surface-300'}`}>
                            OpenCode
                          </span>
                          {settings.provider === 'opencode' && (
                            <Check className="w-4 h-4 text-violet-400 ml-auto" />
                          )}
                        </div>
                        <p className="text-xs text-surface-500">
                          Headless CLI - Reuse OpenCode subscriptions and auth
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* Health Status */}
                  <div className="p-4 bg-surface-800 rounded-lg border border-surface-700">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-surface-300">Connection Status</h3>
                      <button
                        onClick={loadHealth}
                        className="p-1 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    {health ? (
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${health.available ? 'bg-green-500' : 'bg-red-500'}`} />
                        <span className={`text-sm ${health.available ? 'text-green-400' : 'text-red-400'}`}>
                          {health.available ? 'Connected' : 'Disconnected'}
                        </span>
                        {health.error && (
                          <span className="text-xs text-surface-500 truncate flex-1">
                            {health.error}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-surface-500">Checking...</span>
                    )}
                  </div>

                  {/* Test Connection */}
                  {settings.enabled && (
                    <div className="p-4 bg-surface-800 rounded-lg border border-surface-700">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-surface-300">Test Connection</h3>
                        <button
                          onClick={testConnection}
                          disabled={testing || !health?.available}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded transition-colors"
                        >
                          {testing ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <TestTube className="w-3 h-3" />
                          )}
                          Test
                        </button>
                      </div>
                      {testResult && (
                        <div className={`p-3 rounded text-sm ${
                          testResult.error
                            ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                            : 'bg-green-500/10 border border-green-500/30 text-green-400'
                        }`}>
                          {testResult.error ? (
                            <div className="flex items-center gap-2">
                              <AlertCircle className="w-4 h-4" />
                              {testResult.error}
                            </div>
                          ) : (
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <Check className="w-4 h-4" />
                                Test successful!
                              </div>
                              <div className="text-xs text-surface-400 mt-1">
                                Response: "{testResult.response}" (via {testResult.provider}/{testResult.model})
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Security Tab */}
              {activeTab === 'security' && settings && (
                <div className="space-y-6">
                  {/* Auto-Respond Section */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Zap className="w-4 h-4 text-yellow-400" />
                      <label className="text-sm font-medium text-surface-300">
                        Auto-Response
                      </label>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center justify-between p-3 bg-surface-800 rounded-lg border border-surface-700 cursor-pointer hover:border-surface-600">
                        <div>
                          <span className="text-sm text-surface-300">Enable auto-respond</span>
                          <p className="text-xs text-surface-500">
                            Automatically send responses when confidence is high
                          </p>
                        </div>
                        <button
                          onClick={() => saveSettings({ autoRespondEnabled: !settings.autoRespondEnabled })}
                          className={`relative w-11 h-6 rounded-full transition-colors ${
                            settings.autoRespondEnabled ? 'bg-yellow-500' : 'bg-surface-600'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                              settings.autoRespondEnabled ? 'translate-x-5' : ''
                            }`}
                          />
                        </button>
                      </label>

                      <div>
                        <label className="block text-xs text-surface-400 mb-2">
                          Auto-respond threshold
                        </label>
                        <div className="flex items-center gap-4">
                          <input
                            type="range"
                            min="70"
                            max="100"
                            value={(settings.autoRespondThreshold || 0.9) * 100}
                            onChange={(e) => saveSettings({ autoRespondThreshold: parseInt(e.target.value) / 100 })}
                            className="flex-1 accent-yellow-500"
                            disabled={!settings.autoRespondEnabled}
                          />
                          <span className="text-sm text-surface-300 w-12 text-right">
                            {Math.round((settings.autoRespondThreshold || 0.9) * 100)}%
                          </span>
                        </div>
                        <p className="text-xs text-surface-500 mt-1">
                          Only auto-respond when confidence is at or above this level
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Security Controls */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Shield className="w-4 h-4 text-red-400" />
                      <label className="text-sm font-medium text-surface-300">
                        Security Controls
                      </label>
                    </div>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700 cursor-pointer hover:border-surface-600">
                        <input
                          type="checkbox"
                          checked={settings.blockCriticalWithoutConfirm !== false}
                          onChange={(e) => saveSettings({ blockCriticalWithoutConfirm: e.target.checked })}
                          className="accent-red-500"
                        />
                        <div>
                          <span className="text-sm text-surface-300">Block critical operations</span>
                          <p className="text-xs text-surface-500">
                            Always require confirmation for rm -rf, force push, etc.
                          </p>
                        </div>
                      </label>

                      <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700 cursor-pointer hover:border-surface-600">
                        <input
                          type="checkbox"
                          checked={settings.requireConfirmationForHighRisk !== false}
                          onChange={(e) => saveSettings({ requireConfirmationForHighRisk: e.target.checked })}
                          className="accent-orange-500"
                        />
                        <div>
                          <span className="text-sm text-surface-300">Confirm high-risk actions</span>
                          <p className="text-xs text-surface-500">
                            Require confirmation for sudo, git reset, database drops
                          </p>
                        </div>
                      </label>

                      <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700 cursor-pointer hover:border-surface-600">
                        <input
                          type="checkbox"
                          checked={settings.createRollbackPoints !== false}
                          onChange={(e) => saveSettings({ createRollbackPoints: e.target.checked })}
                          className="accent-blue-500"
                        />
                        <div className="flex items-center gap-2">
                          <RotateCcw className="w-3.5 h-3.5 text-blue-400" />
                          <div>
                            <span className="text-sm text-surface-300">Create rollback points</span>
                            <p className="text-xs text-surface-500">
                              Track git state before risky operations for easy undo
                            </p>
                          </div>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Risk Levels Explanation */}
                  <div className="p-4 bg-surface-800 rounded-lg border border-surface-700">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="w-4 h-4 text-surface-400" />
                      <span className="text-sm font-medium text-surface-300">Risk Levels</span>
                    </div>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        <span className="text-surface-400">Safe:</span>
                        <span className="text-surface-500">Read operations, simple confirmations</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                        <span className="text-surface-400">Low:</span>
                        <span className="text-surface-500">File writes, git commits, npm install</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-yellow-500"></span>
                        <span className="text-surface-400">Medium:</span>
                        <span className="text-surface-500">Recursive delete, global installs</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                        <span className="text-surface-400">High:</span>
                        <span className="text-surface-500">Force push, sudo, database drops</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500"></span>
                        <span className="text-surface-400">Critical:</span>
                        <span className="text-surface-500">rm -rf /, credential exposure, remote code exec</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Ollama Tab */}
              {activeTab === 'ollama' && settings && (
                <div className="space-y-6">
                  {/* Endpoint */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Ollama Endpoint
                    </label>
                    <input
                      type="text"
                      value={settings.ollama?.endpoint || ''}
                      onChange={(e) => saveOllamaConfig({ endpoint: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                      placeholder="http://localhost:11434"
                    />
                    <p className="text-xs text-surface-500 mt-1">
                      Default: http://localhost:11434
                    </p>
                  </div>

                  {/* Model Selection */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Model
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={settings.ollama?.model || ''}
                        onChange={(e) => saveOllamaConfig({ model: e.target.value })}
                        className="flex-1 px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                      >
                        <option value="">Select a model</option>
                        {models.map((model) => (
                          <option key={model.name} value={model.name}>
                            {model.name}
                          </option>
                        ))}
                        {!models.some(m => m.name === settings.ollama?.model) && settings.ollama?.model && (
                          <option value={settings.ollama.model}>
                            {settings.ollama.model} (not installed)
                          </option>
                        )}
                      </select>
                      <button
                        onClick={loadOllamaModels}
                        className="px-3 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg transition-colors"
                      >
                        <RefreshCw className="w-4 h-4 text-surface-400" />
                      </button>
                    </div>
                  </div>

                  {/* Available Models */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium text-surface-300">
                        Available Models
                      </label>
                      <a
                        href="https://ollama.com/library"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300"
                      >
                        Browse models
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="bg-surface-800 border border-surface-700 rounded-lg divide-y divide-surface-700 max-h-48 overflow-y-auto">
                      {models.length > 0 ? (
                        models.map((model) => (
                          <div
                            key={model.name}
                            className={`flex items-center justify-between px-3 py-2 ${
                              model.name === settings.ollama?.model ? 'bg-green-500/10' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Brain className="w-4 h-4 text-surface-500" />
                              <span className="text-sm text-surface-300">{model.name}</span>
                              {model.name === settings.ollama?.model && (
                                <span className="text-xs px-1.5 py-0.5 bg-green-500/20 text-green-400 rounded">
                                  Active
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-surface-500">
                              {model.size ? `${(model.size / 1e9).toFixed(1)}GB` : ''}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="px-3 py-4 text-center text-surface-500 text-sm">
                          {health?.available ? 'No models installed' : 'Ollama not connected'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Suggested Models */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Suggested Models
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { name: 'llama3.2', desc: 'Fast, good for quick responses' },
                        { name: 'mistral', desc: 'Balanced performance' },
                        { name: 'codellama', desc: 'Optimized for code' },
                        { name: 'phi3', desc: 'Lightweight, fast' },
                      ].map((suggestion) => {
                        const isInstalled = models.some(m => m.name.startsWith(suggestion.name));
                        return (
                          <button
                            key={suggestion.name}
                            onClick={() => {
                              if (isInstalled) {
                                saveOllamaConfig({ model: suggestion.name });
                              } else {
                                pullModel(suggestion.name);
                              }
                            }}
                            className="flex items-center justify-between p-2 bg-surface-800 border border-surface-700 rounded-lg hover:border-surface-600 text-left"
                          >
                            <div>
                              <span className="text-sm text-surface-300">{suggestion.name}</span>
                              <p className="text-xs text-surface-500">{suggestion.desc}</p>
                            </div>
                            {isInstalled ? (
                              <Check className="w-4 h-4 text-green-400" />
                            ) : (
                              <Download className="w-4 h-4 text-surface-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Timeout */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={settings.ollama?.timeout || 30000}
                      onChange={(e) => saveOllamaConfig({ timeout: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                </div>
              )}

              {/* OpenAI Tab */}
              {activeTab === 'openai' && settings && (
                <div className="space-y-6">
                  {/* API Key */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={settings.openai?.apiKey ? '***configured***' : 'sk-...'}
                        className="w-full px-3 py-2 pr-20 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="p-1 hover:bg-surface-700 rounded"
                        >
                          {showApiKey ? (
                            <EyeOff className="w-4 h-4 text-surface-500" />
                          ) : (
                            <Eye className="w-4 h-4 text-surface-500" />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            if (apiKeyInput) {
                              saveOpenAIConfig({ apiKey: apiKeyInput });
                              setApiKeyInput('');
                            }
                          }}
                          disabled={!apiKeyInput}
                          className="px-2 py-1 text-xs bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      Get your API key from{' '}
                      <a
                        href="https://platform.openai.com/api-keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-400 hover:underline"
                      >
                        OpenAI Dashboard
                      </a>
                    </p>
                  </div>

                  {/* Model */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Model
                    </label>
                    <select
                      value={settings.openai?.model || 'gpt-4o-mini'}
                      onChange={(e) => saveOpenAIConfig({ model: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                    >
                      <option value="gpt-4o-mini">GPT-4o Mini (Recommended)</option>
                      <option value="gpt-4o">GPT-4o</option>
                      <option value="gpt-4-turbo">GPT-4 Turbo</option>
                      <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                    </select>
                  </div>

                  {/* Endpoint (for custom/compatible APIs) */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      API Endpoint
                    </label>
                    <input
                      type="text"
                      value={settings.openai?.endpoint || ''}
                      onChange={(e) => saveOpenAIConfig({ endpoint: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                      placeholder="https://api.openai.com/v1"
                    />
                    <p className="text-xs text-surface-500 mt-1">
                      Change this for OpenAI-compatible APIs (Azure, local, etc.)
                    </p>
                  </div>

                  {/* Timeout */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={settings.openai?.timeout || 30000}
                      onChange={(e) => saveOpenAIConfig({ timeout: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                </div>
              )}

              {/* OpenCode Tab */}
              {activeTab === 'opencode' && settings && (
                <div className="space-y-6">
                  <div className="p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                    <h3 className="text-sm font-semibold text-violet-300 mb-1">Use OpenCode as orchestrator</h3>
                    <p className="text-[12px] text-surface-400">
                      The IDE calls your authenticated OpenCode CLI headlessly, so users can reuse providers and subscriptions already connected in OpenCode.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Model
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={settings.opencode?.model || ''}
                        onChange={(e) => saveOpenCodeConfig({ model: e.target.value })}
                        className="flex-1 px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                      >
                        <option value="">OpenCode default</option>
                        {opencodeModels.map((model) => (
                          <option key={model.id || model.name} value={model.id || model.name}>
                            {model.id || model.name}
                          </option>
                        ))}
                        {settings.opencode?.model && !opencodeModels.some(m => (m.id || m.name) === settings.opencode.model) && (
                          <option value={settings.opencode.model}>
                            {settings.opencode.model} (current)
                          </option>
                        )}
                      </select>
                      <button
                        onClick={loadOpenCodeModels}
                        className="px-3 py-2 bg-surface-700 hover:bg-surface-600 rounded-lg transition-colors"
                      >
                        <RefreshCw className="w-4 h-4 text-surface-400" />
                      </button>
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      Loaded dynamically from <code className="text-surface-400">opencode models</code>. Configure providers with <code className="text-surface-400">opencode providers</code> in a terminal.
                    </p>
                  </div>

                  <div className="bg-surface-800 border border-surface-700 rounded-lg divide-y divide-surface-700 max-h-56 overflow-y-auto">
                    {opencodeModels.length > 0 ? (
                      opencodeModels.map((model) => {
                        const id = model.id || model.name;
                        return (
                          <div
                            key={id}
                            className={`flex items-center justify-between px-3 py-2 ${
                              id === settings.opencode?.model ? 'bg-violet-500/10' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
                              <span className="text-sm text-surface-300 truncate">{id}</span>
                              {id === settings.opencode?.model && (
                                <span className="text-xs px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">
                                  Active
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-surface-500 ml-3">
                              {model.provider || id?.split('/')[0]}
                            </span>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-3 py-4 text-center text-surface-500 text-sm">
                        No OpenCode models found. Make sure the OpenCode CLI is installed and authenticated.
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={settings.opencode?.timeout || 60000}
                      onChange={(e) => saveOpenCodeConfig({ timeout: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                </div>
              )}

              {/* DeepSeek Tab */}
              {activeTab === 'deepseek' && settings && (
                <div className="space-y-6">
                  {/* API Key */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      API Key
                    </label>
                    <div className="relative">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder={settings.deepseek?.apiKey ? '***configured***' : 'sk-...'}
                        className="w-full px-3 py-2 pr-20 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="p-1 hover:bg-surface-700 rounded"
                        >
                          {showApiKey ? (
                            <EyeOff className="w-4 h-4 text-surface-500" />
                          ) : (
                            <Eye className="w-4 h-4 text-surface-500" />
                          )}
                        </button>
                        <button
                          onClick={() => {
                            if (apiKeyInput) {
                              saveDeepSeekConfig({ apiKey: apiKeyInput });
                              setApiKeyInput('');
                            }
                          }}
                          disabled={!apiKeyInput}
                          className="px-2 py-1 text-xs bg-primary-500 hover:bg-primary-600 disabled:bg-surface-700 disabled:cursor-not-allowed text-white rounded"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      Get your API key from{' '}
                      <a
                        href="https://platform.deepseek.com/api_keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-400 hover:underline"
                      >
                        DeepSeek Platform
                      </a>
                    </p>
                  </div>

                  {/* Model */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Model
                    </label>
                    <select
                      value={settings.deepseek?.model || 'deepseek-chat'}
                      onChange={(e) => saveDeepSeekConfig({ model: e.target.value })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                    >
                      <option value="deepseek-chat">DeepSeek Chat (Recommended)</option>
                      <option value="deepseek-coder">DeepSeek Coder</option>
                      <option value="deepseek-reasoner">DeepSeek Reasoner (R1)</option>
                    </select>
                    <p className="text-xs text-surface-500 mt-1">
                      DeepSeek Chat is great for general tasks, Coder is optimized for code
                    </p>
                  </div>

                  {/* Pricing Info */}
                  <div className="p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-4 h-4 text-purple-400" />
                      <span className="text-sm font-medium text-purple-300">DeepSeek Pricing</span>
                    </div>
                    <div className="text-xs text-surface-400 space-y-1">
                      <p>DeepSeek offers very competitive pricing:</p>
                      <ul className="list-disc list-inside ml-2 text-surface-500">
                        <li>~$0.14 per 1M input tokens</li>
                        <li>~$0.28 per 1M output tokens</li>
                        <li>Much cheaper than GPT-4 for similar quality</li>
                      </ul>
                    </div>
                  </div>

                  {/* Timeout */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Timeout (ms)
                    </label>
                    <input
                      type="number"
                      value={settings.deepseek?.timeout || 60000}
                      onChange={(e) => saveDeepSeekConfig({ timeout: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                    />
                    <p className="text-xs text-surface-500 mt-1">
                      DeepSeek can be slower than other providers, recommended: 60000ms
                    </p>
                  </div>
                </div>
              )}

              {/* GitHub Models Tab */}
              {activeTab === 'github' && settings && (
                <div className="space-y-6">
                  <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                    <h3 className="text-sm font-semibold text-green-300 mb-1">Free with GitHub Copilot</h3>
                    <p className="text-[12px] text-surface-400">
                      Use GPT-4o, GPT-4o-mini, or Llama models for free through GitHub Models API.
                      Requires a GitHub PAT with the "copilot" scope.
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">GitHub Token (PAT)</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        id="github-token-input"
                        defaultValue=""
                        placeholder={settings.github?.apiKey ? '••••••••(configured — paste new to replace)' : 'ghp_xxxxxxxxxxxxxxxxxxxx'}
                        className="flex-1 px-3 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-200 text-sm font-mono placeholder-surface-600 focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none"
                      />
                      <button
                        onClick={() => {
                          const input = document.getElementById('github-token-input');
                          if (input?.value?.trim()) {
                            saveGitHubConfig({ apiKey: input.value.trim() });
                            input.value = '';
                          }
                        }}
                        className="px-3 py-2 bg-primary-500 hover:bg-primary-600 text-surface-950 rounded-lg text-sm font-medium transition-colors"
                      >
                        Save
                      </button>
                    </div>
                    <p className="text-[11px] text-surface-500 mt-1">
                      Create at github.com/settings/tokens → Fine-grained → "copilot" permission
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">Model</label>
                    <select
                      value={settings.github?.model || 'openai/gpt-4o-mini'}
                      onChange={(e) => saveGitHubConfig({ model: e.target.value })}
                      className="w-full px-3 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-200 text-sm focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none"
                    >
                      <option value="openai/gpt-4o-mini">GPT-4o Mini (Fast, recommended)</option>
                      <option value="openai/gpt-4o">GPT-4o (Powerful)</option>
                      <option value="openai/o4-mini">o4-mini (Reasoning)</option>
                      <option value="meta-llama/Llama-4-Scout-17B-16E-Instruct">Llama 4 Scout 17B</option>
                      <option value="meta-llama/Llama-4-Maverick-17B-128E-Instruct">Llama 4 Maverick 17B</option>
                      <option value="mistralai/mistral-small-2503">Mistral Small</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">API Endpoint</label>
                    <input
                      type="text"
                      value={settings.github?.endpoint || 'https://models.github.ai/inference'}
                      onChange={(e) => saveGitHubConfig({ endpoint: e.target.value })}
                      className="w-full px-3 py-2.5 bg-surface-800 border border-surface-700 rounded-lg text-surface-200 text-sm font-mono placeholder-surface-600 focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Advanced Tab */}
              {activeTab === 'advanced' && settings && (
                <div className="space-y-6">
                  {/* When to use LLM */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-3">
                      When to use LLM
                    </label>
                    <div className="space-y-3">
                      <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700 cursor-pointer hover:border-surface-600">
                        <input
                          type="checkbox"
                          checked={settings.useForLowConfidence}
                          onChange={(e) => saveSettings({ useForLowConfidence: e.target.checked })}
                          className="accent-primary-500"
                        />
                        <div>
                          <span className="text-sm text-surface-300">Low confidence responses</span>
                          <p className="text-xs text-surface-500">
                            When smart engine confidence is below threshold
                          </p>
                        </div>
                      </label>

                      <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700 cursor-pointer hover:border-surface-600">
                        <input
                          type="checkbox"
                          checked={settings.useForUnknownIntent}
                          onChange={(e) => saveSettings({ useForUnknownIntent: e.target.checked })}
                          className="accent-primary-500"
                        />
                        <div>
                          <span className="text-sm text-surface-300">Unknown intents</span>
                          <p className="text-xs text-surface-500">
                            When smart engine can't classify the question
                          </p>
                        </div>
                      </label>

                      <label className="flex items-center gap-3 p-3 bg-surface-800 rounded-lg border border-surface-700 cursor-pointer hover:border-surface-600">
                        <input
                          type="checkbox"
                          checked={settings.useForInformationRequests}
                          onChange={(e) => saveSettings({ useForInformationRequests: e.target.checked })}
                          className="accent-primary-500"
                        />
                        <div>
                          <span className="text-sm text-surface-300">Information requests</span>
                          <p className="text-xs text-surface-500">
                            When AI asks for specific information (paths, names, etc.)
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Confidence Threshold */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-2">
                      Confidence Threshold
                    </label>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={(settings.confidenceThreshold || 0.5) * 100}
                        onChange={(e) => saveSettings({ confidenceThreshold: parseInt(e.target.value) / 100 })}
                        className="flex-1 accent-primary-500"
                      />
                      <span className="text-sm text-surface-300 w-12 text-right">
                        {Math.round((settings.confidenceThreshold || 0.5) * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-surface-500 mt-1">
                      Use LLM when smart engine confidence is below this threshold
                    </p>
                  </div>

                  {/* Response Settings */}
                  <div>
                    <label className="block text-sm font-medium text-surface-300 mb-3">
                      Response Settings
                    </label>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs text-surface-400 mb-1">Max Tokens</label>
                        <input
                          type="number"
                          value={settings.maxTokens || 150}
                          onChange={(e) => saveSettings({ maxTokens: parseInt(e.target.value) })}
                          className="w-full px-3 py-2 text-sm bg-surface-800 border border-surface-700 rounded-lg text-surface-200 focus:ring-1 focus:ring-primary-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs text-surface-400 mb-1">
                          Temperature ({settings.temperature || 0.3})
                        </label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={(settings.temperature || 0.3) * 100}
                          onChange={(e) => saveSettings({ temperature: parseInt(e.target.value) / 100 })}
                          className="w-full accent-primary-500"
                        />
                        <p className="text-xs text-surface-500 mt-1">
                          Lower = more deterministic, Higher = more creative
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-surface-700 bg-surface-800">
          <div className="flex items-center gap-2 text-xs text-surface-500">
            {saving && (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Saving...
              </>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-surface-700 hover:bg-surface-600 text-surface-200 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
