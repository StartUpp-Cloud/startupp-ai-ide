import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../contexts/ProjectContext";
import useProjectForm from "../hooks/useProjectForm";
import ProjectFormFields from "../components/ProjectFormFields";
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

  const [step, setStep] = useState("connect"); // 'connect' | 'project'

  // LLM state
  const [llmProvider, setLlmProvider] = useState("ollama");
  const [ollamaModels, setOllamaModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'success' | 'error'
  const [testError, setTestError] = useState("");
  const [llmReady, setLlmReady] = useState(false);

  // OpenAI / DeepSeek
  const [apiKey, setApiKey] = useState("");

  // Project form
  const form = useProjectForm();
  const [showPresets, setShowPresets] = useState(false);
  const [saving, setSaving] = useState(false);

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
      const projectData = {
        name: form.formData.name.trim(),
        description: form.formData.description.trim(),
        rules: form.formData.rules.filter((r) => r.trim()),
        selectedPresets: form.formData.selectedPresets,
        gitUrl: form.formData.gitUrl?.trim() || null,
        containerPorts: form.formData.ports ? form.formData.ports.split(',').map(p => p.trim()).filter(Boolean) : [],
      };

      const newProject = await createProject(projectData);

      // Create container for the project
      try {
        await fetch('/api/containers/build-image', { method: 'POST' });
        const containerRes = await fetch('/api/containers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: newProject.id,
            name: projectData.name,
            gitUrl: projectData.gitUrl,
            ports: projectData.containerPorts,
          }),
        });
        const containerData = await containerRes.json();
        if (containerData.containerName) {
          await fetch(`/api/projects/${newProject.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ containerName: containerData.containerName }),
          });
        }
      } catch { /* container creation is best-effort */ }

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
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary-500 flex items-center justify-center mx-auto mb-4 shadow-glow">
            <span className="text-surface-950 font-display font-bold text-xl">P</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-white">
            Welcome to StartUpp AI IDE
          </h1>
          <p className="text-surface-400 text-sm mt-2">
            Let's get you set up in two quick steps
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            step === "connect"
              ? "bg-primary-500/20 text-primary-300 border border-primary-500/30"
              : "bg-green-500/20 text-green-300 border border-green-500/30"
          }`}>
            {step === "project" ? <Check className="w-3 h-3" /> : <span>1</span>}
            <span>Connect Model</span>
          </div>
          <ArrowRight className="w-4 h-4 text-surface-600" />
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${
            step === "project"
              ? "bg-primary-500/20 text-primary-300 border border-primary-500/30"
              : "bg-surface-800 text-surface-500 border border-surface-700"
          }`}>
            <span>2</span>
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

            {/* OpenAI / DeepSeek: API key */}
            {(llmProvider === "openai" || llmProvider === "deepseek") && (
              <div>
                <label className="label">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => { setApiKey(e.target.value); setTestResult(null); setLlmReady(false); }}
                  className="input"
                  placeholder={`Enter your ${llmProvider === "openai" ? "OpenAI" : "DeepSeek"} API key`}
                />
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
                disabled={testing || (llmProvider === "ollama" && !selectedModel) || ((llmProvider === "openai" || llmProvider === "deepseek") && !apiKey)}
                className="flex-1 btn-secondary flex items-center justify-center gap-2"
              >
                {testing ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Testing...</>
                ) : (
                  <><Sparkles className="w-4 h-4" /> Test Connection</>
                )}
              </button>
              <button
                onClick={() => setStep("project")}
                disabled={!llmReady}
                className="flex-1 btn-primary flex items-center justify-center gap-2"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Create First Project */}
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
                  onClick={() => setStep("connect")}
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
    </div>
  );
}
