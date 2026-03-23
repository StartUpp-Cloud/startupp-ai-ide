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
} from "lucide-react";

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
  });
  const [errors, setErrors] = useState({});

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
      });
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

  const validateForm = () => {
    const newErrors = {};
    if (!formData.name.trim()) newErrors.name = "Project name is required";
    if (!formData.description.trim())
      newErrors.description = "Description is required";
    const validRules = formData.rules.filter((r) => r.trim());
    if (validRules.length === 0)
      newErrors.rules = "At least one rule is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
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

        {/* Rules */}
        <div>
          <label className="label">
            Rules <span className="text-danger-400">*</span>
          </label>
          <div className="space-y-2">
            {formData.rules.map((rule, index) => (
              <div key={index} className="flex items-center gap-2 group">
                <GripVertical className="w-4 h-4 text-surface-600 flex-shrink-0" />
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
