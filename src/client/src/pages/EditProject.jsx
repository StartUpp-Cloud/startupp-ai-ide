import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useProjects } from "../contexts/ProjectContext";
import {
  ArrowLeft,
  Save,
  Trash2,
  Plus,
  X,
  GripVertical,
  AlertTriangle,
  ChevronDown,
} from "lucide-react";
import PresetSelector from "../components/PresetSelector";

const EditProject = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getProject, updateProject, deleteProject } = useProjects();

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    rules: [""],
    selectedPresets: [],
    environments: [],
  });
  const [errors, setErrors] = useState({});
  const [draggedRuleIndex, setDraggedRuleIndex] = useState(null);
  const [showPresets, setShowPresets] = useState(false);
  const [showEnvironments, setShowEnvironments] = useState(false);

  useEffect(() => {
    loadProject();
  }, [id]);

  const loadProject = async () => {
    try {
      const projectData = await getProject(id);
      setProject(projectData);
      setFormData({
        name: projectData.name,
        description: projectData.description,
        rules: projectData.rules.length > 0 ? projectData.rules : [""],
        selectedPresets: projectData.selectedPresets || [],
        environments: projectData.environments || [],
      });
      // Auto-expand presets section if project has presets
      if (projectData.selectedPresets?.length > 0) {
        setShowPresets(true);
      }
      if (projectData.environments?.length > 0) {
        setShowEnvironments(true);
      }
    } catch (error) {
      console.error("Failed to load project:", error);
    } finally {
      setLoading(false);
    }
  };

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

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Project name is required";
    if (!formData.description.trim())
      newErrors.description = "Description is required";
    const validRules = formData.rules.filter((r) => r.trim());
    const hasPresets = formData.selectedPresets.length > 0;
    if (validRules.length === 0 && !hasPresets)
      newErrors.rules = "Add at least one rule or select a preset";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ── Environments & test users ──
  const setEnvs = (environments) =>
    setFormData((prev) => ({ ...prev, environments }));
  const addEnvironment = () =>
    setEnvs([...(formData.environments || []), { name: "", baseUrl: "", writesAllowed: true, testUsers: [] }]);
  const updateEnvironment = (i, patch) => {
    const envs = [...formData.environments];
    envs[i] = { ...envs[i], ...patch };
    setEnvs(envs);
  };
  const removeEnvironment = (i) =>
    setEnvs(formData.environments.filter((_, x) => x !== i));
  const addTestUser = (i) => {
    const envs = [...formData.environments];
    envs[i] = { ...envs[i], testUsers: [...(envs[i].testUsers || []), { label: "", username: "", tenantId: "", role: "", password: "" }] };
    setEnvs(envs);
  };
  const updateTestUser = (i, j, patch) => {
    const envs = [...formData.environments];
    const users = [...(envs[i].testUsers || [])];
    users[j] = { ...users[j], ...patch };
    envs[i] = { ...envs[i], testUsers: users };
    setEnvs(envs);
  };
  const removeTestUser = (i, j) => {
    const envs = [...formData.environments];
    envs[i] = { ...envs[i], testUsers: envs[i].testUsers.filter((_, x) => x !== j) };
    setEnvs(envs);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setSaving(true);
      await updateProject(id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        rules: formData.rules.filter((r) => r.trim()),
        selectedPresets: formData.selectedPresets,
        environments: formData.environments,
      });
      navigate(`/project/${id}`);
    } catch (error) {
      console.error("Failed to update project:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteProject = async () => {
    try {
      setDeleting(true);
      await deleteProject(id);
      navigate("/");
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="text-center py-16">
        <p className="text-danger-400 mb-4">Project not found</p>
        <button onClick={() => navigate("/")} className="btn-primary">
          Back to Projects
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={() => navigate(`/project/${id}`)} className="btn-icon">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="page-title">Edit Project</h1>
          <p className="text-surface-400 text-sm mt-0.5">
            Update details and rules for{" "}
            <span className="text-surface-200">{project.name}</span>
          </p>
        </div>
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
            placeholder="Enter project name"
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
            placeholder="Describe your project"
          />
          {errors.description && (
            <p className="text-error">{errors.description}</p>
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

        {/* Environments & Test Users */}
        <div className="card">
          <button
            type="button"
            onClick={() => setShowEnvironments(!showEnvironments)}
            className="flex items-center justify-between w-full text-left"
          >
            <div>
              <span className="text-sm font-medium text-surface-200">
                Environments &amp; Test Users
              </span>
              <p className="text-hint mt-0.5">
                Let the agent log in and verify changes end-to-end. Passwords are encrypted at rest and never shown to the model.
              </p>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-surface-400 transition-transform flex-shrink-0 ${showEnvironments ? "rotate-180" : ""}`}
            />
          </button>

          {showEnvironments && (
            <div className="mt-4 pt-4 border-t border-surface-700/60 space-y-4">
              {(formData.environments || []).map((env, i) => (
                <div key={i} className="p-3 bg-surface-700/30 rounded-lg space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={env.name || ""}
                      onChange={(e) => updateEnvironment(i, { name: e.target.value })}
                      placeholder="Name (e.g. dev, staging, prod)"
                      className="input !py-2 text-sm flex-1"
                    />
                    <button type="button" onClick={() => removeEnvironment(i)} className="btn-icon !p-1.5 text-danger-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <input
                    type="url"
                    value={env.baseUrl || ""}
                    onChange={(e) => updateEnvironment(i, { baseUrl: e.target.value })}
                    placeholder="Base URL (e.g. https://dev.example.com)"
                    className="input !py-2 text-sm w-full"
                  />
                  <label className="flex items-center gap-2 text-sm text-surface-300">
                    <input
                      type="checkbox"
                      checked={env.writesAllowed !== false}
                      onChange={(e) => updateEnvironment(i, { writesAllowed: e.target.checked })}
                    />
                    Writes allowed (uncheck for read-only — blocks create/update/delete, recommended for prod)
                  </label>

                  <div className="space-y-2">
                    <div className="text-xs text-surface-400">Test users</div>
                    {(env.testUsers || []).map((u, j) => (
                      <div key={j} className="grid grid-cols-2 gap-2 items-center sm:grid-cols-5">
                        <input type="text" value={u.label || ""} onChange={(e) => updateTestUser(i, j, { label: e.target.value })} placeholder="label" className="input !py-1.5 text-xs" />
                        <input type="text" value={u.username || ""} onChange={(e) => updateTestUser(i, j, { username: e.target.value })} placeholder="username/email" className="input !py-1.5 text-xs" />
                        <input type="text" value={u.tenantId || ""} onChange={(e) => updateTestUser(i, j, { tenantId: e.target.value })} placeholder="tenantId" className="input !py-1.5 text-xs" />
                        <input type="password" value={u.password || ""} onChange={(e) => updateTestUser(i, j, { password: e.target.value })} placeholder={u.hasSecret ? "•••• (stored)" : "password"} className="input !py-1.5 text-xs" />
                        <div className="flex items-center gap-1">
                          <input type="text" value={u.role || ""} onChange={(e) => updateTestUser(i, j, { role: e.target.value })} placeholder="role" className="input !py-1.5 text-xs flex-1" />
                          <button type="button" onClick={() => removeTestUser(i, j)} className="btn-icon !p-1 text-danger-400">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => addTestUser(i)} className="flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300">
                      <Plus className="w-3 h-3" />
                      Add test user
                    </button>
                  </div>
                  <p className="text-hint">
                    Tip: add ≥2 users with different <span className="font-mono">tenantId</span> values to enable the cross-tenant isolation probe.
                  </p>
                </div>
              ))}
              <button type="button" onClick={addEnvironment} className="flex items-center gap-1.5 text-sm text-primary-400 hover:text-primary-300">
                <Plus className="w-3.5 h-3.5" />
                Add environment
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-4 border-t border-surface-700/60">
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="btn-danger"
          >
            <Trash2 className="w-4 h-4" />
            Delete Project
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => navigate(`/project/${id}`)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? (
                <>
                  <Spinner />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-surface-950/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setShowDeleteModal(false)}
          />
          <div className="relative bg-surface-800 border border-surface-700 rounded-2xl p-6 w-full max-w-md shadow-modal animate-scale-in">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-danger-500/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-danger-400" />
              </div>
              <div>
                <h3 className="section-title mb-1">Delete Project</h3>
                <p className="text-sm text-surface-400">
                  This will permanently delete{" "}
                  <strong className="text-surface-200">{project.name}</strong>{" "}
                  and all its prompts. This cannot be undone.
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteProject}
                disabled={deleting}
                className="btn bg-danger-500 text-white hover:bg-danger-600 active:scale-[0.98]"
              >
                {deleting ? (
                  <>
                    <Spinner />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Spinner = () => (
  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
);

export default EditProject;
