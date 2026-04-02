import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useProjects } from "../contexts/ProjectContext";
import useProjectForm from "../hooks/useProjectForm";
import ProjectFormFields from "./ProjectFormFields";
import {
  FolderOpen,
  Plus,
  Search,
  X,
  ChevronRight,
  ChevronDown,
  BookOpen,
  Layers,
  Pencil,
  Copy as CloneIcon,
  Trash2,
  Upload,
  Download,
  AlertTriangle,
} from "lucide-react";

const Spinner = () => (
  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
);

const Modal = ({ children, onClose }) =>
  createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-surface-950/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative bg-surface-800 border border-surface-700 rounded-2xl p-6 w-full max-w-lg shadow-modal animate-scale-in max-h-[85vh] overflow-y-auto">
        {children}
      </div>
    </div>,
    document.body,
  );

export default function ProjectManagerPanel({
  selectedProjectId,
  onSelectProject,
  onProjectChanged,
}) {
  const {
    projects,
    createProject,
    updateProject,
    deleteProject,
    cloneProject,
    getProject,
    notify,
  } = useProjects();

  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState({});

  // Modal state
  const [activeModal, setActiveModal] = useState(null); // 'create' | 'edit' | 'clone' | 'delete'
  const [targetProject, setTargetProject] = useState(null);
  const [saving, setSaving] = useState(false);

  // Clone form
  const [cloneFormData, setCloneFormData] = useState({ name: "", description: "" });

  // Import ref
  const importRef = useRef(null);

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // ── Handlers ──

  const handleCreate = () => {
    setTargetProject(null);
    setActiveModal("create");
  };

  const handleEdit = async (project, e) => {
    e.stopPropagation();
    try {
      const full = await getProject(project.id);
      setTargetProject(full);
      setActiveModal("edit");
    } catch {
      notify("Failed to load project", "error");
    }
  };

  const handleClone = (project, e) => {
    e.stopPropagation();
    setTargetProject(project);
    setCloneFormData({
      name: `${project.name} (Copy)`,
      description: project.description,
    });
    setActiveModal("clone");
  };

  const handleDelete = (project, e) => {
    e.stopPropagation();
    setTargetProject(project);
    setActiveModal("delete");
  };

  const handleExport = async (project, e) => {
    e.stopPropagation();
    try {
      const full = await getProject(project.id);
      const exportData = {
        exportedAt: new Date().toISOString(),
        project: {
          name: full.name,
          description: full.description,
          rules: full.rules,
          selectedPresets: full.selectedPresets,
          promptSettings: full.promptSettings,
        },
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${full.name.replace(/\s+/g, "-").toLowerCase()}-export.json`;
      a.click();
      URL.revokeObjectURL(url);
      notify("Project exported");
    } catch {
      notify("Failed to export project", "error");
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      setSaving(true);
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.project?.name || !data.project?.rules) {
        notify("Invalid export file format", "error");
        return;
      }
      const { name, description, rules, promptSettings, selectedPresets } =
        data.project;
      const newProject = await createProject({
        name,
        description,
        rules,
        promptSettings,
        selectedPresets,
      });
      onSelectProject(newProject.id);
    } catch {
      notify("Failed to import project — invalid JSON file", "error");
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setActiveModal(null);
    setTargetProject(null);
    setSaving(false);
  };

  // ── Modals ──

  const renderCreateModal = () => <CreateModal onClose={closeModal} onCreated={(id) => { closeModal(); onSelectProject(id); }} />;

  const renderEditModal = () => (
    <EditModal
      project={targetProject}
      onClose={closeModal}
      onSaved={() => {
        closeModal();
        if (onProjectChanged) onProjectChanged();
      }}
    />
  );

  const renderCloneModal = () => (
    <Modal onClose={closeModal}>
      <h3 className="section-title mb-1">Clone Project</h3>
      <p className="text-sm text-surface-400 mb-5">
        Create a copy of{" "}
        <strong className="text-surface-200">{targetProject.name}</strong>
      </p>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            setSaving(true);
            const cloned = await cloneProject(targetProject.id, {
              name: cloneFormData.name.trim() || undefined,
              description: cloneFormData.description.trim() || undefined,
            });
            closeModal();
            onSelectProject(cloned.id);
          } catch {
            // context handles notification
          } finally {
            setSaving(false);
          }
        }}
        className="space-y-4"
      >
        <div>
          <label className="label">Name</label>
          <input
            type="text"
            value={cloneFormData.name}
            onChange={(e) =>
              setCloneFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            className="input"
            placeholder="Project name"
          />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea
            value={cloneFormData.description}
            onChange={(e) =>
              setCloneFormData((prev) => ({
                ...prev,
                description: e.target.value,
              }))
            }
            rows={3}
            className="input resize-none"
            placeholder="Project description"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={closeModal} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (
              <>
                <Spinner /> Cloning...
              </>
            ) : (
              <>
                <CloneIcon className="w-4 h-4" /> Clone
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );

  const renderDeleteModal = () => (
    <Modal onClose={closeModal}>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-danger-500/15 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="w-5 h-5 text-danger-400" />
        </div>
        <div>
          <h3 className="section-title mb-1">Delete Project</h3>
          <p className="text-sm text-surface-400">
            This will permanently delete{" "}
            <strong className="text-surface-200">{targetProject.name}</strong>{" "}
            and all its prompts. This cannot be undone.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-6">
        <button onClick={closeModal} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={async () => {
            try {
              setSaving(true);
              await deleteProject(targetProject.id);
              if (selectedProjectId === targetProject.id) {
                onSelectProject(null);
              }
              closeModal();
            } catch {
              // context handles notification
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="btn bg-danger-500 text-white hover:bg-danger-600 active:scale-[0.98]"
        >
          {saving ? (
            <>
              <Spinner /> Deleting...
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4" /> Delete
            </>
          )}
        </button>
      </div>
    </Modal>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Action bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-surface-700/60">
        {showSearch ? (
          <div className="flex-1 flex items-center gap-1">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search..."
              className="flex-1 px-2 py-1 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 focus:ring-1 focus:ring-primary-500"
              autoFocus
            />
            <button
              onClick={() => {
                setShowSearch(false);
                setSearchTerm("");
              }}
              className="p-1 hover:bg-surface-700 rounded text-surface-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setShowSearch(true)}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
              title="Search projects"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCreate}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
              title="New project"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <label
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 cursor-pointer"
              title="Import project"
            >
              <Upload className="w-3.5 h-3.5" />
              <input
                ref={importRef}
                type="file"
                accept=".json"
                onChange={handleImport}
                className="hidden"
              />
            </label>
          </>
        )}
      </div>

      {/* Project list */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredProjects.map((project) => (
          <div key={project.id} className="group">
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                onSelectProject(project.id);
                setExpandedProjects((prev) => ({
                  ...prev,
                  [project.id]: !prev[project.id],
                }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectProject(project.id);
                  setExpandedProjects((prev) => ({
                    ...prev,
                    [project.id]: !prev[project.id],
                  }));
                }
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-750 transition-colors cursor-pointer select-none ${
                selectedProjectId === project.id
                  ? "bg-primary-500/10 text-primary-300"
                  : "text-surface-300"
              }`}
            >
              {expandedProjects[project.id] ? (
                <ChevronDown className="w-3 h-3 text-surface-500 flex-shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-surface-500 flex-shrink-0" />
              )}
              <FolderOpen className="w-4 h-4 text-surface-400 flex-shrink-0" />
              <span className="text-sm truncate flex-1">{project.name}</span>

              {/* Hover actions */}
              <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={(e) => handleEdit(project, e)}
                  className="p-0.5 hover:bg-surface-600 rounded text-surface-500 hover:text-surface-200"
                  title="Edit"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => handleClone(project, e)}
                  className="p-0.5 hover:bg-surface-600 rounded text-surface-500 hover:text-surface-200"
                  title="Clone"
                >
                  <CloneIcon className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => handleExport(project, e)}
                  className="p-0.5 hover:bg-surface-600 rounded text-surface-500 hover:text-surface-200"
                  title="Export"
                >
                  <Download className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => handleDelete(project, e)}
                  className="p-0.5 hover:bg-surface-600 rounded text-surface-500 hover:text-danger-400"
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>

            {expandedProjects[project.id] && (
              <div className="pl-8 pr-2 py-1 space-y-1">
                {project.rules?.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-surface-500">
                    <BookOpen className="w-3 h-3" />
                    <span>{project.rules.length} rules</span>
                  </div>
                )}
                {project.selectedPresets?.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-surface-500">
                    <Layers className="w-3 h-3" />
                    <span>{project.selectedPresets.length} presets</span>
                  </div>
                )}
                {project.description && (
                  <p className="text-xs text-surface-500 line-clamp-2">
                    {project.description}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}

        {filteredProjects.length === 0 && (
          <div className="px-3 py-8 text-center">
            <FolderOpen className="w-8 h-8 text-surface-600 mx-auto mb-2" />
            <p className="text-sm text-surface-500 mb-3">
              {searchTerm ? "No matches" : "No projects yet"}
            </p>
            {!searchTerm && (
              <button
                onClick={handleCreate}
                className="text-xs text-primary-400 hover:text-primary-300 flex items-center gap-1 mx-auto"
              >
                <Plus className="w-3 h-3" />
                Create Project
              </button>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {activeModal === "create" && renderCreateModal()}
      {activeModal === "edit" && targetProject && renderEditModal()}
      {activeModal === "clone" && targetProject && renderCloneModal()}
      {activeModal === "delete" && targetProject && renderDeleteModal()}
    </div>
  );
}

// ── Create Modal (uses hook internally) ──

function CreateModal({ onClose, onCreated }) {
  const { createProject, projects } = useProjects();
  const form = useProjectForm();
  const [saving, setSaving] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showCloneOptions, setShowCloneOptions] = useState(false);

  const handleCloneFrom = (projectId) => {
    if (!projectId) return;
    const project = projects.find((p) => p.id === projectId);
    if (project) {
      form.populateFromProject(project);
      form.handleInputChange("name", `${project.name} (Copy)`);
      setShowCloneOptions(false);
    }
  };

  const handleSubmit = async (e) => {
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

      // Create a Docker container for the project
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
      } catch {
        // Container creation is best-effort
      }

      onCreated(newProject.id);
    } catch {
      // context handles notification
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="section-title mb-4">New Project</h3>

      {/* Clone from existing */}
      {projects.length > 0 && (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setShowCloneOptions(!showCloneOptions)}
            className="flex items-center gap-2 text-sm text-surface-400 hover:text-surface-200"
          >
            <CloneIcon className="w-3.5 h-3.5 text-primary-400" />
            <span>Start from an existing project</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showCloneOptions ? "rotate-180" : ""}`}
            />
          </button>
          {showCloneOptions && (
            <select
              onChange={(e) => handleCloneFrom(e.target.value)}
              className="select mt-2 w-full"
              defaultValue=""
            >
              <option value="">Choose a project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.rules?.length || 0} rules)
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <ProjectFormFields
          {...form}
          showPresets={showPresets}
          setShowPresets={setShowPresets}
        />

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-surface-700/60">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (
              <>
                <Spinner /> Creating...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" /> Create
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Edit Modal (uses hook internally) ──

function EditModal({ project, onClose, onSaved }) {
  const { updateProject } = useProjects();
  const form = useProjectForm({
    name: project.name,
    description: project.description,
    rules: project.rules?.length > 0 ? [...project.rules] : [""],
    selectedPresets: project.selectedPresets || [],
    gitUrl: project.gitUrl || "",
    ports: (project.containerPorts || []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [showPresets, setShowPresets] = useState(
    (project.selectedPresets?.length || 0) > 0,
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.validateForm()) return;
    try {
      setSaving(true);
      await updateProject(project.id, {
        name: form.formData.name.trim(),
        description: form.formData.description.trim(),
        rules: form.formData.rules.filter((r) => r.trim()),
        selectedPresets: form.formData.selectedPresets,
        gitUrl: form.formData.gitUrl?.trim() || null,
        containerPorts: form.formData.ports ? form.formData.ports.split(',').map(p => p.trim()).filter(Boolean) : [],
      });
      onSaved();
    } catch {
      // context handles notification
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <h3 className="section-title mb-4">Edit Project</h3>
      <form onSubmit={handleSubmit}>
        <ProjectFormFields
          {...form}
          showPresets={showPresets}
          setShowPresets={setShowPresets}
        />

        <div className="flex justify-end gap-2 pt-4 mt-4 border-t border-surface-700/60">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? (
              <>
                <Spinner /> Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
