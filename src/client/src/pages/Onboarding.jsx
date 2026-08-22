import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../contexts/ProjectContext";
import useProjectForm from "../hooks/useProjectForm";
import ProjectFormFields from "../components/ProjectFormFields";
import InternalConsole from "../components/InternalConsole";
import {
  Cpu,
  Check,
  Loader2,
  ArrowRight,
  Server,
  Sparkles,
  FolderOpen,
  AlertCircle,
  RefreshCw,
} from "lucide-react";

const STEPS = ["connect", "project"];

export default function Onboarding({ onSetupComplete }) {
  const navigate = useNavigate();
  const { createProject } = useProjects();

  const [step, setStep] = useState("connect"); // 'connect' | 'docker' | 'project'

  // Docker state
  const [dockerAvailable, setDockerAvailable] = useState(null); // null=checking, true, false
  const [dockerChecking, setDockerChecking] = useState(false);
  // LLM state
  const [llmProvider, setLlmProvider] = useState("ollama");
  const [ollamaModels, setOllamaModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'success' | 'error'
  const [testError, setTestError] = useState("");
  const [llmReady, setLlmReady] = useState(false);

  // OpenAI / DeepSeek / GitHub (PAT reuses apiKey)
  const [apiKey, setApiKey] = useState("");
  // GitHub Models (Copilot) + OpenCode CLI
  const [githubModel, setGithubModel] = useState("openai/gpt-4o-mini");
  const [opencodeModel, setOpencodeModel] = useState("");
  const [codexModel, setCodexModel] = useState("");

  // Project form
  const form = useProjectForm();
  const [showPresets, setShowPresets] = useState(false);
  const [saving, setSaving] = useState(false);

  // Check Docker availability when entering docker step
  useEffect(() => {
    if (step !== 'docker') return;
    const checkDocker = async () => {
      setDockerChecking(true);
      try {
        const res = await fetch('/api/containers/status');
        const data = await res.json();
        setDockerAvailable(data.dockerAvailable === true);
      } catch {
        setDockerAvailable(false);
      } finally {
        setDockerChecking(false);
      }
    };
    checkDocker();
    // Poll every 5 seconds while on this step
    const interval = setInterval(checkDocker, 5000);
    return () => clearInterval(interval);
  }, [step]);

  // Load Ollama models on mount
  useEffect(() => {
    if (llmProvider === "ollama") {
      loadOllamaModels();
    }
  }, [llmProvider]);

  const loadOllamaModels = async () => {
    try {
      setLoadingModels(true);
      const res = await fetch("/api/llm/ollama/models");
      const data = await res.json();
      setOllamaModels(data.models || []);
      if (data.models?.length > 0 && !selectedModel) {
        setSelectedModel(data.models[0].name);
      }
    } catch {
      setOllamaModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleTestConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      setTestError("");

      // Step 1: Enable LLM and set provider
      await fetch("/api/llm/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, provider: llmProvider }),
      });

      // Step 2: Configure the specific provider
      if (llmProvider === "ollama" && selectedModel) {
        await fetch("/api/llm/ollama/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: selectedModel }),
        });
      } else if (llmProvider === "openai" && apiKey) {
        await fetch("/api/llm/openai/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });
      } else if (llmProvider === "deepseek" && apiKey) {
        await fetch("/api/llm/deepseek/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey }),
        });
      } else if (llmProvider === "github" && apiKey) {
        await fetch("/api/llm/github/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, model: githubModel || undefined }),
        });
      } else if (llmProvider === "opencode") {
        await fetch("/api/llm/opencode/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: opencodeModel }),
        });
      } else if (llmProvider === "codex") {
        await fetch("/api/llm/codex/config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: codexModel }),
        });
      }

      // Step 3: Test the connection
      const testRes = await fetch("/api/llm/test", { method: "POST" });
      const testData = await testRes.json();

      if (testRes.ok && testData.success) {
        setTestResult("success");
        setLlmReady(true);
      } else {
        throw new Error(testData.error || testData.message || "Test failed");
      }
    } catch (err) {
      setTestResult("error");
      setTestError(err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!form.validateForm()) return;
    try {
      setSaving(true);
      const isHost = form.formData.runtime === "host";
      const projectData = {
        name: form.formData.name.trim(),
        description: form.formData.description.trim(),
        rules: form.formData.rules.filter((r) => r.trim()),
        selectedPresets: form.formData.selectedPresets,
        excludedPresetRules: form.formData.excludedPresetRules || [],
        runtime: isHost ? "host" : "container",
        folderPath: isHost ? form.formData.folderPath.trim() : null,
        containerPorts: isHost ? [] : (form.formData.ports ? form.formData.ports.split(',').map(p => p.trim()).filter(Boolean) : []),
      };

      const newProject = await createProject(projectData);

      // Unlock the setup gate, then navigate to IDE
      onSetupComplete?.();
      navigate("/");
    } catch {
      // context handles notification
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-900 flex items-center justify-center p-4">
      <div className="w-full max-w-6xl">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-primary-500 flex items-center justify-center mx-auto mb-4 shadow-glow">
            <span className="text-surface-950 font-display font-bold text-xl">P</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">
            Welcome to StartUpp AI IDE
          </h1>
          <p className="text-surface-400 text-sm mt-2">
            Connect a model, then install and authenticate it in the IDE container shell
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 items-stretch">
        <div>
        {/* Progress */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            step === "connect"
              ? "bg-primary-500/20 text-primary-300 border border-primary-500/30"
              : "bg-green-500/20 text-green-300 border border-green-500/30"
          }`}>
            {step !== "connect" ? <Check className="w-3 h-3" /> : <span>1</span>}
            <span>AI Model</span>
          </div>
          <ArrowRight className="w-3 h-3 text-surface-600" />
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            step === "docker"
              ? "bg-primary-500/20 text-primary-300 border border-primary-500/30"
              : step === "project"
                ? "bg-green-500/20 text-green-300 border border-green-500/30"
                : "bg-surface-800 text-surface-500 border border-surface-700"
          }`}>
            {step === "project" ? <Check className="w-3 h-3" /> : <span>2</span>}
            <span>Docker</span>
          </div>
          <ArrowRight className="w-3 h-3 text-surface-600" />
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            step === "project"
              ? "bg-primary-500/20 text-primary-300 border border-primary-500/30"
              : "bg-surface-800 text-surface-500 border border-surface-700"
          }`}>
            <span>3</span>
            <span>First Project</span>
          </div>
        </div>

        {/* Step 1: Connect Model */}
        {step === "connect" && (
          <div className="card space-y-5 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center">
                <Cpu className="w-5 h-5 text-primary-400" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-white">Connect an AI Model</h2>
                <p className="text-xs text-surface-400">
                  This model will generate prompts and plans for you
                </p>
              </div>
            </div>

            {/* Provider selector */}
            <div>
              <label className="label">Provider</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "ollama", name: "Ollama", desc: "Local" },
                  { id: "openai", name: "OpenAI", desc: "Cloud" },
                  { id: "deepseek", name: "DeepSeek", desc: "Cloud" },
                  { id: "github", name: "GitHub Models", desc: "Copilot" },
                  { id: "opencode", name: "OpenCode", desc: "CLI" },
                  { id: "codex", name: "Codex", desc: "CLI" },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setLlmProvider(p.id);
                      setTestResult(null);
                      setLlmReady(false);
                    }}
                    className={`p-3 rounded-lg border text-center transition-all ${
                      llmProvider === p.id
                        ? "bg-primary-500/10 border-primary-500/30 text-primary-300"
                        : "bg-surface-850 border-surface-700 text-surface-300 hover:border-surface-600"
                    }`}
                  >
                    <Server className="w-4 h-4 mx-auto mb-1" />
                    <div className="text-xs font-medium">{p.name}</div>
                    <div className="text-[10px] text-surface-500">{p.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Ollama: model selector */}
            {llmProvider === "ollama" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="label !mb-0">Model</label>
                  <button
                    onClick={loadOllamaModels}
                    disabled={loadingModels}
                    className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingModels ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
                {ollamaModels.length > 0 ? (
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="select w-full"
                  >
                    {ollamaModels.map((m) => (
                      <option key={m.name} value={m.name}>
                        {m.name} ({(m.size / 1e9).toFixed(1)}GB)
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-3 bg-surface-850 rounded-lg border border-surface-700 text-xs text-surface-400">
                    {loadingModels ? (
                      <span className="flex items-center gap-2">
                        <Loader2 className="w-3 h-3 animate-spin" /> Loading models...
                      </span>
                    ) : (
                      <>
                        No models found. Make sure Ollama is running and pull a model:
                        <code className="block mt-1 text-primary-300">ollama pull qwen3.5:9b</code>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* OpenAI / DeepSeek / GitHub: API key (or PAT) */}
            {(llmProvider === "openai" || llmProvider === "deepseek" || llmProvider === "github") && (
              <div>
                <label className="label">
                  {llmProvider === "github" ? "GitHub Token (PAT with Copilot access)" : "API Key"}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setTestResult(null); setLlmReady(false); }}
                  className="input"
                  placeholder={
                    llmProvider === "openai" ? "Enter your OpenAI API key"
                      : llmProvider === "deepseek" ? "Enter your DeepSeek API key"
                      : "ghp_… (GitHub token with Copilot access)"
                  }
                />
                {llmProvider === "github" && (
                  <p className="text-[11px] text-surface-500 mt-1">Free with a GitHub Copilot subscription — runs on GitHub Models.</p>
                )}
              </div>
            )}

            {/* GitHub Models: model */}
            {llmProvider === "github" && (
              <div>
                <label className="label">Model</label>
                <input
                  type="text"
                  value={githubModel}
                  onChange={(e) => { setGithubModel(e.target.value); setTestResult(null); setLlmReady(false); }}
                  className="input"
                  placeholder="openai/gpt-4o-mini"
                />
                <p className="text-[11px] text-surface-500 mt-1">e.g. openai/gpt-4o, openai/gpt-4o-mini, meta-llama/Llama-4-Scout-17B-16E-Instruct</p>
              </div>
            )}

            {/* OpenCode CLI: optional model */}
            {llmProvider === "opencode" && (
              <div>
                <label className="label">Model <span className="text-surface-600 text-xs font-normal">— optional</span></label>
                <input
                  type="text"
                  value={opencodeModel}
                  onChange={(e) => { setOpencodeModel(e.target.value); setTestResult(null); setLlmReady(false); }}
                  className="input"
                  placeholder="leave blank to use OpenCode's default"
                />
                <p className="text-[11px] text-surface-500 mt-1">
                  Uses the local <code className="text-primary-300">opencode</code> CLI as the orchestrator model.
                  Install it from the terminal quick commands on the right if it isn't available yet.
                </p>
              </div>
            )}

            {llmProvider === "codex" && (
              <div>
                <label className="label">Model <span className="text-surface-600 text-xs font-normal">— optional</span></label>
                <input
                  type="text"
                  value={codexModel}
                  onChange={(e) => { setCodexModel(e.target.value); setTestResult(null); setLlmReady(false); }}
                  className="input"
                  placeholder="leave blank to use Codex's default"
                />
                <p className="text-[11px] text-surface-500 mt-1">
                  Uses the <code className="text-primary-300">codex</code> CLI as the orchestrator. The same CLI can be selected as the coding agent in chat.
                  Authenticate with <code className="text-primary-300">codex</code> in the terminal on the right.
                </p>
              </div>
            )}

            {/* Test result */}
            {testResult === "success" && (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400">
                <Check className="w-4 h-4" />
                Model connected successfully!
              </div>
            )}
            {testResult === "error" && (
              <div className="flex items-start gap-2 p-3 bg-danger-500/10 border border-danger-500/20 rounded-lg text-xs text-danger-400">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>{testError}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleTestConnection}
                disabled={testing || (llmProvider === "ollama" && !selectedModel) || ((llmProvider === "openai" || llmProvider === "deepseek" || llmProvider === "github") && !apiKey)}
                className="flex-1 btn-secondary flex items-center justify-center gap-2"
              >
                {testing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Test Connection</>
                )}
              </button>
              <button
                onClick={() => setStep("docker")}
                disabled={!llmReady}
                className="flex-1 btn-primary flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Docker Setup */}
        {step === "docker" && (
          <div className="card space-y-5 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                dockerAvailable ? 'bg-green-500/15' : 'bg-surface-800'
              }`}>
                <Server className="w-5 h-5 text-primary-400" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-white">Docker Setup</h2>
                <p className="text-xs text-surface-400">
                  Each project runs in an isolated container
                </p>
              </div>
            </div>

            {dockerChecking && dockerAvailable === null ? (
              <div className="flex items-center gap-2 p-3 bg-surface-800 rounded-lg text-xs text-surface-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Checking Docker availability...
              </div>
            ) : dockerAvailable ? (
              <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-xs text-green-400">
                <Check className="w-4 h-4" />
                Docker engine is reachable. Project containers will be created as siblings of this IDE.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-300">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  Docker engine is not reachable from the IDE container
                </div>
                <p className="text-xs text-surface-400">
                  The IDE already runs in Docker. Start the engine on the host (Docker Desktop or dockerd), then this check will pass.
                </p>
                <div className="bg-surface-900 rounded-lg p-3 font-mono text-[11px] space-y-1">
                  <p className="text-surface-500"># Host machine</p>
                  <p className="text-green-300">docker info</p>
                  <p className="text-surface-500 mt-2"># If that fails, start Docker Desktop or:</p>
                  <p className="text-green-300">sudo systemctl start docker</p>
                </div>
                <p className="text-[10px] text-surface-500 mt-2">
                  This page auto-checks every 5 seconds.
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep("connect")}
                className="btn-secondary"
              >
                Back
              </button>
              <button
                onClick={() => setStep("project")}
                className="flex-1 btn-primary flex items-center justify-center gap-2"
              >
                {dockerAvailable ? 'Continue' : 'Skip for now'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {!dockerAvailable && (
              <p className="text-[10px] text-surface-500 text-center">
                Container projects need a running Docker engine. You can continue and provision them once it is up.
              </p>
            )}
          </div>
        )}

        {/* Step 3: Create First Project */}
        {step === "project" && (
          <div className="card space-y-5 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-500/15 flex items-center justify-center">
                <FolderOpen className="w-5 h-5 text-primary-400" />
              </div>
              <div>
                <h2 className="font-display font-semibold text-white">Create Your First Project</h2>
                <p className="text-xs text-surface-400">
                  Set up a project to start generating AI prompts
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateProject}>
              <ProjectFormFields
                {...form}
                showPresets={showPresets}
                setShowPresets={setShowPresets}
              />

              <div className="flex gap-3 pt-5 mt-5 border-t border-surface-700/60">
                <button
                  type="button"
                  onClick={() => setStep("docker")}
                  className="btn-secondary"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 btn-primary flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Create & Start</>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
        </div>
        <div className="card p-0 overflow-hidden min-h-[28rem] flex flex-col">
          <div className="px-3 pt-3 pb-1">
            <p className="text-xs font-medium text-surface-200">IDE container shell</p>
            <p className="text-[11px] text-surface-500 mt-0.5">
              Install and log in to Codex, Claude, or another CLI here, then test the connection. This is the orchestrator environment — not a project container.
            </p>
          </div>
          <InternalConsole embedded hostShell />
        </div>
        </div>
      </div>
    </div>
  );
}
