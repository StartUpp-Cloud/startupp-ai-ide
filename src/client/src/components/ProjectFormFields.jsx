import { useState } from "react";
import { Plus, X, GripVertical, ChevronDown, FolderOpen, Check, Loader2 } from "lucide-react";
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
  const [folderValidation, setFolderValidation] = useState(null); // null | 'validating' | 'valid' | 'invalid'

  const validateFolderPath = async (path) => {
    if (!path.trim()) {
      setFolderValidation(null);
      return;
    }
    try {
      setFolderValidation("validating");
      const res = await fetch("/api/files/validate-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath: path.trim() }),
      });
      const data = await res.json();
      if (data.valid) {
        setFolderValidation("valid");
        // Use the server-resolved absolute path
        if (data.resolvedPath !== path.trim()) {
          handleInputChange("folderPath", data.resolvedPath);
        }
      } else {
        setFolderValidation("invalid");
      }
    } catch {
      setFolderValidation("invalid");
    }
  };

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

      {/* Folder Path */}
      <div>
        <label className="label">
          <FolderOpen className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          Project Folder
        </label>
        <p className="text-hint mb-2">
          Server-side path where the terminal will open
        </p>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={formData.folderPath}
              onChange={(e) => {
                handleInputChange("folderPath", e.target.value);
                setFolderValidation(null);
              }}
              onBlur={(e) => validateFolderPath(e.target.value)}
              className={`input !pr-8 ${
                folderValidation === "invalid" ? "!border-danger-500/50" : ""
              } ${folderValidation === "valid" ? "!border-success-500/50" : ""}`}
              placeholder="/home/user/projects/my-app"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {folderValidation === "validating" && (
                <Loader2 className="w-3.5 h-3.5 text-surface-400 animate-spin" />
              )}
              {folderValidation === "valid" && (
                <Check className="w-3.5 h-3.5 text-success-400" />
              )}
              {folderValidation === "invalid" && (
                <X className="w-3.5 h-3.5 text-danger-400" />
              )}
            </div>
          </div>
        </div>
        {folderValidation === "invalid" && (
          <p className="text-error">
            Path does not exist or is not a directory on the server
          </p>
        )}
        {errors.folderPath && (
          <p className="text-error">{errors.folderPath}</p>
        )}
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
