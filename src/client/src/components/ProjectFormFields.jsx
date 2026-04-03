import { useState } from "react";
import { Plus, X, GripVertical, ChevronDown, Terminal as TerminalIcon } from "lucide-react";
import PresetSelector from "./PresetSelector";
import { PRESETS } from "../data/presets";

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
  const [excludedPresetRules, setExcludedPresetRules] = useState(
    formData.excludedPresetRules || []
  );
  const [showPresetRules, setShowPresetRules] = useState(false);

  // Sync excluded rules back to formData
  const togglePresetRule = (ruleText) => {
    const next = excludedPresetRules.includes(ruleText)
      ? excludedPresetRules.filter(r => r !== ruleText)
      : [...excludedPresetRules, ruleText];
    setExcludedPresetRules(next);
    handleInputChange("excludedPresetRules", next);
  };

  // Get all rules from selected presets
  const presetRules = [];
  (formData.selectedPresets || []).forEach(presetId => {
    const preset = PRESETS.find(p => p.id === presetId);
    if (preset) {
      preset.rules.forEach(rule => {
        if (!presetRules.some(r => r.text === rule)) {
          presetRules.push({ text: rule, presetName: preset.name, presetId: preset.id });
        }
      });
    }
  });

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

      {/* Port Mappings */}
      <div>
        <label className="label">
          Port Mappings <span className="text-surface-600 text-xs font-normal">— optional</span>
        </label>
        <input
          type="text"
          value={formData.ports}
          onChange={(e) => handleInputChange("ports", e.target.value)}
          className="input"
          placeholder="3000:3000, 8080:8080"
        />
        <p className="text-hint mt-1">
          Expose container ports for dev servers. Leave empty if not needed.
        </p>
      </div>

      {/* Getting started guide */}
      <div className="p-3 bg-surface-800/50 border border-surface-700 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <TerminalIcon className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Getting started</span>
        </div>
        <p className="text-xs text-surface-400 mb-2">
          Your project runs in an isolated container. After creating it,
          use the terminal to set up your tools and clone your repos:
        </p>
        <div className="space-y-1.5 text-[11px] font-mono">
          <div className="flex items-start gap-2">
            <span className="text-green-400 mt-px">$</span>
            <div>
              <code className="text-surface-300">gh auth login</code>
              <span className="text-surface-600 ml-2">— connect GitHub</span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-green-400 mt-px">$</span>
            <div>
              <code className="text-surface-300">git clone https://github.com/org/repo.git</code>
              <span className="text-surface-600 ml-2">— clone your code</span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-green-400 mt-px">$</span>
            <div>
              <code className="text-surface-300">claude</code>
              <span className="text-surface-600 ml-2">— connect Claude Code</span>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-green-400 mt-px">$</span>
            <div>
              <code className="text-surface-300">npm login</code>
              <span className="text-surface-600 ml-2">— connect npm (if needed)</span>
            </div>
          </div>
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

      {/* Preset rules with individual toggles */}
      {presetRules.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowPresetRules(!showPresetRules)}
            className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200 transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showPresetRules ? 'rotate-180' : ''}`} />
            <span>{presetRules.length} preset rules</span>
            {excludedPresetRules.length > 0 && (
              <span className="text-yellow-400">({excludedPresetRules.length} excluded)</span>
            )}
          </button>

          {showPresetRules && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {presetRules.map((rule, i) => {
                const excluded = excludedPresetRules.includes(rule.text);
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors ${
                      excluded ? 'opacity-50 line-through' : 'hover:bg-surface-800'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!excluded}
                      onChange={() => togglePresetRule(rule.text)}
                      className="accent-primary-500 mt-0.5 flex-shrink-0"
                    />
                    <span className="text-surface-300 flex-1">{rule.text}</span>
                    <span className="text-[10px] text-surface-600 flex-shrink-0">{rule.presetName}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Custom Rules */}
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
