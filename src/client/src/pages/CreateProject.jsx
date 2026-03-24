import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProjects } from "../contexts/ProjectContext";
import {
  ArrowLeft,
  Plus,
  X,
  Copy as CloneIcon,
  ChevronDown,
  GripVertical,
} from "lucide-react";
import PresetSelector from "../components/PresetSelector";

const CreateProject = () => {
  const navigate = useNavigate();
  const { createProject, projects } = useProjects();
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    rules: [""],
    selectedPresets: [],
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [showCloneOptions, setShowCloneOptions] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [draggedRuleIndex, setDraggedRuleIndex] = useState(null);

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: "" }));
  };

  const handleRuleChange = (index, value) => {
    const newRules = [...formData.rules];
    newRules[index] = value;
    setFormData((prev) => ({ ...prev, rules: newRules }));
  };

  const addRule = () => {
    setFormData((prev) => ({ ...prev, rules: [...prev.rules, ""] }));
  };

  const removeRule = (index) => {
    if (formData.rules.length > 1) {
      const newRules = formData.rules.filter((_, i) => i !== index);
      setFormData((prev) => ({ ...prev, rules: newRules }));
    }
  };

  const moveRule = (fromIndex, toIndex) => {
    const newRules = [...formData.rules];
    const [moved] = newRules.splice(fromIndex, 1);
    newRules.splice(toIndex, 0, moved);
    setFormData((prev) => ({ ...prev, rules: newRules }));
  };

  const handlePresetsChange = (presets) => {
    setFormData((prev) => ({ ...prev, selectedPresets: presets }));
  };

  const handleCloneFromProject = (projectId) => {
    if (!projectId) return;
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      setFormData({
        name: `${project.name} (Copy)`,
        description: project.description,
        rules: project.rules.length > 0 ? [...project.rules] : [""],
        selectedPresets: project.selectedPresets || [],
      });
      setShowCloneOptions(false);
    }
  };

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Project name is required";
    if (!formData.description.trim())
      newErrors.description = "Description is required";
    const validRules = formData.rules.filter((r) => r.trim());
    const hasPresets = formData.selectedPresets.length > 0;
    // Allow projects with either custom rules OR selected presets
    if (validRules.length === 0 && !hasPresets)
      newErrors.rules = "Add at least one rule or select a preset";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setSaving(true);
      const projectData = {
        name: formData.name,
        description: formData.description,
        rules: formData.rules.filter((r) => r.trim()),
        selectedPresets: formData.selectedPresets,
      };
      const newProject = await createProject(projectData);
      navigate(`/project/${newProject.id}`);
    } catch (error) {
      console.error("Failed to create project:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate(-1)} className="btn-icon">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="page-title">New Project</h1>
          <p className="text-surface-400 text-sm mt-0.5">
            Set up rules and guidelines for your AI prompts
          </p>
        </div>
      </div>

      {/* Clone from existing */}
      {projects.length > 0 && (
        <div className="card mb-6">
          <button
            type="button"
            onClick={() => setShowCloneOptions(!showCloneOptions)}
            className="flex items-center justify-between w-full text-left"
          >
            <div className="flex items-center gap-2">
              <CloneIcon className="w-4 h-4 text-primary-400" />
              <span className="text-sm font-medium text-surface-200">
                Start from an existing project
              </span>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-surface-400 transition-transform duration-200 ${
                showCloneOptions ? "rotate-180" : ""
              }`}
            />
          </button>

          {showCloneOptions && (
            <div className="mt-4 pt-4 border-t border-surface-700/60">
              <select
                onChange={(e) => handleCloneFromProject(e.target.value)}
                className="select"
                defaultValue=""
              >
                <option value="">Choose a project...</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.rules?.length || 0} rules)
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Preset Composition */}
      <div className="card mb-6">
        <button
          type="button"
          onClick={() => setShowPresets(!showPresets)}
          className="flex items-center justify-between w-full text-left"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-surface-200">
              Add Rules from Presets
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
            />
          </div>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Name */}
        <div>
          <label htmlFor="name" className="label">
            Project Name <span className="text-danger-400">*</span>
          </label>
          <input
            type="text"
            id="name"
            value={formData.name}
            onChange={(e) => handleInputChange("name", e.target.value)}
            className={errors.name ? "input-error" : "input"}
            placeholder="e.g. My SaaS App"
          />
          {errors.name && <p className="text-error">{errors.name}</p>}
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="label">
            Description <span className="text-danger-400">*</span>
          </label>
          <textarea
            id="description"
            value={formData.description}
            onChange={(e) => handleInputChange("description", e.target.value)}
            rows={4}
            className={`resize-none ${errors.description ? "input-error" : "input"}`}
            placeholder="Describe what this project is about and what kind of AI prompts you'll create..."
          />
          {errors.description && (
            <p className="text-error">{errors.description}</p>
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
              ? "Add custom rules specific to this project (in addition to preset rules)"
              : "Define guidelines that will be included in every generated prompt"}
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

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t border-surface-700/60">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (
              <>
                <Spinner />
                Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Create Project
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

const Spinner = () => (
  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
);

export default CreateProject;
