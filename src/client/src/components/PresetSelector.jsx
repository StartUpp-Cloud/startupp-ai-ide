import { useState } from "react";
import {
  Layers,
  ChevronDown,
  ChevronRight,
  Check,
  Info,
} from "lucide-react";
import { PRESETS } from "../data/presets";

/**
 * PresetSelector - Multi-select component for combining presets
 *
 * Props:
 * - selectedPresets: string[] - Array of selected preset IDs
 * - onPresetsChange: (presets: string[]) => void - Callback when selection changes
 * - showRuleCounts: boolean - Show rule counts for each preset (default: true)
 * - compact: boolean - Use compact layout (default: false)
 */
const PresetSelector = ({
  selectedPresets = [],
  onPresetsChange,
  showRuleCounts = true,
  compact = false,
}) => {
  const [expandedPresets, setExpandedPresets] = useState({});

  const togglePreset = (presetId) => {
    const newSelection = selectedPresets.includes(presetId)
      ? selectedPresets.filter((id) => id !== presetId)
      : [...selectedPresets, presetId];
    onPresetsChange(newSelection);
  };

  const toggleExpanded = (presetId, e) => {
    e.stopPropagation();
    setExpandedPresets((prev) => ({
      ...prev,
      [presetId]: !prev[presetId],
    }));
  };

  // Calculate total rules from selected presets
  const totalSelectedRules = selectedPresets.reduce((count, presetId) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    return count + (preset?.rules?.length || 0);
  }, 0);

  // Get unique rules (for display purposes)
  const getUniqueRulesCount = () => {
    const allRules = selectedPresets.flatMap((presetId) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      return preset?.rules || [];
    });
    return new Set(allRules).size;
  };

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-medium text-surface-200">
              Presets
            </span>
          </div>
          {selectedPresets.length > 0 && (
            <span className="text-xs text-primary-400">
              {selectedPresets.length} selected ({getUniqueRulesCount()} rules)
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => {
            const isSelected = selectedPresets.includes(preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => togglePreset(preset.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isSelected
                    ? "bg-primary-500/20 text-primary-300 border border-primary-500/40"
                    : "bg-surface-800 text-surface-400 border border-surface-700 hover:border-surface-600"
                }`}
              >
                {isSelected && <Check className="w-3 h-3 inline mr-1" />}
                {preset.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">
            Compose from Presets
          </span>
        </div>
        {selectedPresets.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="badge-primary">
              {selectedPresets.length} preset{selectedPresets.length !== 1 ? "s" : ""}
            </span>
            <span className="text-xs text-surface-400">
              {getUniqueRulesCount()} unique rules
            </span>
          </div>
        )}
      </div>

      {/* Info text */}
      <p className="text-xs text-surface-500 flex items-start gap-1.5">
        <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
        Select multiple presets to combine their rules. Duplicate rules are automatically removed.
      </p>

      {/* Preset list */}
      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {PRESETS.map((preset) => {
          const isSelected = selectedPresets.includes(preset.id);
          const isExpanded = expandedPresets[preset.id];

          return (
            <div
              key={preset.id}
              className={`border rounded-lg overflow-hidden transition-all ${
                isSelected
                  ? "border-primary-500/40 bg-primary-500/5"
                  : "border-surface-700/60 bg-surface-850/40"
              }`}
            >
              {/* Preset header */}
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-surface-800/30 transition-colors"
                onClick={() => togglePreset(preset.id)}
              >
                {/* Checkbox */}
                <div
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected
                      ? "bg-primary-500 border-primary-500"
                      : "border-surface-600 hover:border-surface-500"
                  }`}
                >
                  {isSelected && <Check className="w-3 h-3 text-white" />}
                </div>

                {/* Preset info */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      isSelected ? "text-primary-200" : "text-surface-200"
                    }`}
                  >
                    {preset.name}
                  </p>
                  <p className="text-xs text-surface-500 truncate">
                    {preset.description}
                  </p>
                </div>

                {/* Rule count & expand button */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {showRuleCounts && (
                    <span className="text-xs text-surface-500">
                      {preset.rules.length} rules
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => toggleExpanded(preset.id, e)}
                    className="p-1 text-surface-500 hover:text-surface-300 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Expanded rules list */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-0">
                  <div className="border-t border-surface-700/60 pt-3 space-y-1.5 max-h-48 overflow-y-auto">
                    {preset.rules.map((rule, index) => (
                      <div
                        key={index}
                        className="flex gap-2 text-xs"
                      >
                        <span className="text-surface-600 flex-shrink-0">
                          {index + 1}.
                        </span>
                        <span className="text-surface-400">{rule}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected presets summary */}
      {selectedPresets.length > 0 && (
        <div className="p-3 bg-surface-850 rounded-lg border border-surface-700/60">
          <p className="text-xs font-medium text-surface-300 mb-2">
            Selected presets will add these rules to your project:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selectedPresets.map((presetId) => {
              const preset = PRESETS.find((p) => p.id === presetId);
              return (
                <span
                  key={presetId}
                  className="px-2 py-0.5 rounded bg-primary-500/15 text-primary-400 text-xs"
                >
                  {preset?.name} ({preset?.rules?.length || 0})
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Helper function to get all unique rules from selected presets
 */
export const getPresetRules = (selectedPresetIds) => {
  const allRules = selectedPresetIds.flatMap((presetId) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    return preset?.rules || [];
  });
  // Return unique rules while preserving order
  return [...new Set(allRules)];
};

/**
 * Helper function to combine preset rules with project rules (deduped)
 */
export const combineRules = (presetIds, projectRules) => {
  const presetRules = getPresetRules(presetIds);
  const allRules = [...presetRules, ...projectRules];
  return [...new Set(allRules)];
};

export default PresetSelector;
