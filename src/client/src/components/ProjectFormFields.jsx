import { Plus, X, GripVertical, ChevronDown, GitBranch, Key, Globe } from "lucide-react";
import PresetSelector from "./PresetSelector";

const ProjectFormFields = ({
  formData,
  errors,
  draggedRuleIndex,
  setDraggedRuleIndex,
  handleInputChange,
  handleRuleChange,
  addRule,
  removeRule,
  moveRule,
  handlePresetsChange,
  showPresets,
  setShowPresets,
}) => {
  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="label">
          Project Name <span className="text-danger-400">*</span>
        </label>
        <input
          type="text"
          value={formData.name}
          onChange={(e) => handleInputChange("name", e.target.value)}
          className={errors.name ? "input-error" : "input"}
          placeholder="e.g. My SaaS App"
        />
        {errors.name && <p className="text-error">{errors.name}</p>}
      </div>

      {/* Description */}
      <div>
        <label className="label">
          Description <span className="text-danger-400">*</span>
        </label>
        <textarea
          value={formData.description}
          onChange={(e) => handleInputChange("description", e.target.value)}
          rows={3}
          className={`resize-none ${errors.description ? "input-error" : "input"}`}
          placeholder="Describe what this project is about..."
        />
        {errors.description && (
          <p className="text-error">{errors.description}</p>
        )}
      </div>

      {/* Git Repository */}
      <div>
        <label className="label">
          <GitBranch className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          Git Repository URL
        </label>
        <p className="text-hint mb-2">
          The repo will be cloned inside a dedicated Docker container.
          Use HTTPS or SSH format.
        </p>
        <input
          type="text"
          value={formData.gitUrl}
          onChange={(e) => handleInputChange("gitUrl", e.target.value)}
          className="input"
          placeholder="https://github.com/org/repo.git"
        />
        <p className="text-hint mt-1">
          <span className="text-surface-500">Optional</span> — you can also clone manually inside the container later
        </p>
      </div>

      {/* Container Credentials */}
      <div className="space-y-3">
        <label className="label">
          <Key className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          Container Credentials
        </label>
        <p className="text-hint mb-2">
          Each project runs in its own isolated container. Credentials are injected
          as environment variables so the CLI tools inside can authenticate.
          All fields are <span className="text-surface-300">optional</span>.
        </p>

        {/* Anthropic API Key */}
        <div>
          <label className="text-xs text-surface-400 mb-1 block">
            Anthropic API Key <span className="text-surface-600">— optional</span>
          </label>
          <input
            type="password"
            value={formData.anthropicApiKey}
            onChange={(e) => handleInputChange("anthropicApiKey", e.target.value)}
            className="input"
            placeholder="sk-ant-api03-..."
          />
          <p className="text-hint mt-1">
            Used by Claude Code CLI inside the container.
            Get one at{' '}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300 underline">
              console.anthropic.com/settings/keys
            </a>
            . If left empty, you can log in with <code className="text-[11px] bg-surface-800 px-1 rounded">claude</code> inside the terminal.
          </p>
        </div>

        {/* GitHub Token */}
        <div>
          <label className="text-xs text-surface-400 mb-1 block">
            GitHub Token <span className="text-surface-600">— optional</span>
          </label>
          <input
            type="password"
            value={formData.ghToken}
            onChange={(e) => handleInputChange("ghToken", e.target.value)}
            className="input"
            placeholder="ghp_..."
          />
          <p className="text-hint mt-1">
            Used for <code className="text-[11px] bg-surface-800 px-1 rounded">git</code> and{' '}
            <code className="text-[11px] bg-surface-800 px-1 rounded">gh</code> CLI access to private repos.
            Create one at{' '}
            <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noopener noreferrer" className="text-primary-400 hover:text-primary-300 underline">
              github.com/settings/tokens
            </a>
            {' '}with repo scope. If left empty, you can run <code className="text-[11px] bg-surface-800 px-1 rounded">gh auth login</code> inside the terminal.
          </p>
        </div>

        {/* Port Mappings */}
        <div>
          <label className="text-xs text-surface-400 mb-1 block">
            Port Mappings <span className="text-surface-600">— optional</span>
          </label>
          <input
            type="text"
            value={formData.ports}
            onChange={(e) => handleInputChange("ports", e.target.value)}
            className="input"
            placeholder="3000:3000, 8080:8080"
          />
          <p className="text-hint mt-1">
            Expose container ports to your machine so you can access dev servers
            in your browser. Format: <code className="text-[11px] bg-surface-800 px-1 rounded">host:container</code>,
            comma-separated. Leave empty if you don't need to access a dev server.
          </p>
        </div>
      </div>

      {/* Presets */}
      <div className="card">
        <button
          type="button"
          onClick={() => setShowPresets(!showPresets)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-surface-200">
              Preset Rules
            </span>
            {formData.selectedPresets.length > 0 && (
              <span className="badge-primary">
                {formData.selectedPresets.length} selected
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${
              showPresets ? "rotate-180" : ""
            }`}
          />
        </button>

        {showPresets && (
          <div className="mt-4 pt-4 border-t border-surface-700/60">
            <PresetSelector
              selectedPresets={formData.selectedPresets}
              onPresetsChange={handlePresetsChange}
              compact
            />
          </div>
        )}
      </div>

      {/* Rules */}
      <div>
        <label className="label">
          Project-Specific Rules{" "}
          {formData.selectedPresets.length === 0 && (
            <span className="text-danger-400">*</span>
          )}
        </label>
        <p className="text-hint mb-3">
          {formData.selectedPresets.length > 0
            ? "Custom rules specific to this project (in addition to preset rules)"
            : "Define guidelines for every generated prompt"}
        </p>

        <div className="space-y-2">
          {formData.rules.map((rule, index) => (
            <div
              key={index}
              draggable
              onDragStart={() => setDraggedRuleIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggedRuleIndex === null || draggedRuleIndex === index)
                  return;
                moveRule(draggedRuleIndex, index);
                setDraggedRuleIndex(null);
              }}
              onDragEnd={() => setDraggedRuleIndex(null)}
              className={`flex items-center gap-2 group transition-opacity ${
                draggedRuleIndex === index ? "opacity-40" : "opacity-100"
              }`}
            >
              <GripVertical className="w-4 h-4 text-surface-600 flex-shrink-0 cursor-grab active:cursor-grabbing" />
              <span className="text-xs font-mono text-surface-500 w-5 text-right flex-shrink-0">
                {index + 1}
              </span>
              <input
                type="text"
                value={rule}
                onChange={(e) => handleRuleChange(index, e.target.value)}
                className="input !py-2"
                placeholder={`Rule ${index + 1}`}
              />
              {formData.rules.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="btn-icon !p-1.5 opacity-0 group-hover:opacity-100 hover:!text-danger-400 hover:!bg-danger-500/10 transition-all"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRule}
          className="flex items-center gap-1.5 text-sm text-primary-400 hover:text-primary-300 mt-3 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add rule
        </button>

        {errors.rules && <p className="text-error">{errors.rules}</p>}
      </div>
    </div>
  );
};

export default ProjectFormFields;
