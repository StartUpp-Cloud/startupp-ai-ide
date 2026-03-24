import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProjects } from "../contexts/ProjectContext";
import {
  Plus,
  Search,
  FolderOpen,
  Calendar,
  MessageSquare,
  Copy as CloneIcon,
  Pencil,
  Trash2,
  BookOpen,
  X,
  AlertTriangle,
  Upload,
} from "lucide-react";

const Dashboard = () => {
  const {
    projects,
    loading,
    error,
    cloneProject,
    deleteProject,
    createProject,
    notify,
  } = useProjects();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedProject, setSelectedProject] = useState(null);
  const [cloneFormData, setCloneFormData] = useState({
    name: "",
    description: "",
  });
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so same file can be imported again if needed
    e.target.value = "";
    try {
      setImporting(true);
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.project?.name || !data.project?.rules) {
        notify("Invalid export file format", "error");
        return;
      }
      const { name, description, rules, promptSettings } = data.project;
      const newProject = await createProject({
        name,
        description,
        rules,
        promptSettings,
      });
      navigate(`/project/${newProject.id}`);
    } catch (err) {
      notify("Failed to import project — invalid JSON file", "error");
    } finally {
      setImporting(false);
    }
  };

  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      project.description.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const totalPrompts = projects.reduce(
    (sum, p) => sum + (p.promptCount || 0),
    0,
  );

  const openCloneModal = (project, e) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedProject(project);
    setCloneFormData({
      name: `${project.name} (Copy)`,
      description: project.description,
    });
    setShowCloneModal(true);
  };

  const openDeleteModal = (project, e) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedProject(project);
    setShowDeleteModal(true);
  };

  const handleCloneProject = async (e) => {
    e.preventDefault();
    try {
      setCloning(true);
      const clonedProject = await cloneProject(selectedProject.id, {
        name: cloneFormData.name.trim() || undefined,
        description: cloneFormData.description.trim() || undefined,
      });
      setShowCloneModal(false);
      setSelectedProject(null);
      navigate(`/project/${clonedProject.id}`);
    } catch (error) {
      console.error("Failed to clone project:", error);
    } finally {
      setCloning(false);
    }
  };

  const handleDeleteProject = async () => {
    try {
      setDeleting(true);
      await deleteProject(selectedProject.id);
      setShowDeleteModal(false);
      setSelectedProject(null);
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setDeleting(false);
    }
  };

  if (loading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
          <span className="text-sm text-surface-400">Loading projects...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <AlertTriangle className="w-10 h-10 text-danger-400 mx-auto mb-3" />
        <p className="text-danger-400 mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="btn-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="text-surface-400 text-sm mt-1.5">
            {projects.length} {projects.length === 1 ? "project" : "projects"}
            <span className="text-surface-600 mx-1.5">&middot;</span>
            {totalPrompts} {totalPrompts === 1 ? "prompt" : "prompts"}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Import button */}
          <label
            className={`btn-secondary cursor-pointer !py-1.5 !px-3 !text-xs !gap-1.5 ${importing ? "opacity-50 pointer-events-none" : ""}`}
          >
            <Upload className="w-3.5 h-3.5" />
            {importing ? "Importing..." : "Import"}
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </label>

          {/* Search */}
          {projects.length > 0 && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 w-4 h-4" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input !pl-9 !py-2"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5 text-surface-400" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="text-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center mx-auto mb-5">
            <FolderOpen className="w-7 h-7 text-surface-500" />
          </div>
          <h3 className="font-display text-lg font-semibold text-white mb-2">
            {searchTerm ? "No matches found" : "No projects yet"}
          </h3>
          <p className="text-surface-400 text-sm mb-8 max-w-sm mx-auto">
            {searchTerm
              ? "Try different search terms"
              : "Create your first project to start managing AI prompts with custom rules"}
          </p>
          {!searchTerm && (
            <Link to="/project/new" className="btn-primary">
              <Plus className="w-4 h-4" />
              Create Project
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProjects.map((project, i) => (
            <div
              key={project.id}
              className="animate-slide-up opacity-0 [animation-fill-mode:forwards]"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <Link
                to={`/project/${project.id}`}
                className="card-interactive group block"
              >
                {/* Card Header */}
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center flex-shrink-0 shadow-glow/50">
                    <span className="text-surface-950 font-display font-bold text-sm">
                      {project.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display font-semibold text-white truncate group-hover:text-primary-400 transition-colors">
                      {project.name}
                    </h3>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="badge-primary">
                        <BookOpen className="w-3 h-3" />
                        {project.rules?.length || 0} rules
                      </span>
                      <span className="badge-surface">
                        <MessageSquare className="w-3 h-3" />
                        {project.promptCount || 0}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-surface-400 text-sm leading-relaxed line-clamp-2 mb-4">
                  {project.description}
                </p>

                {/* Footer */}
                <div className="flex items-center justify-between pt-3 border-t border-surface-700/60">
                  <div className="flex items-center gap-1.5 text-xs text-surface-500">
                    <Calendar className="w-3 h-3" />
                    <span>
                      {project.createdAt
                        ? new Date(project.createdAt).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric" },
                          )
                        : "No date"}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        navigate(`/project/${project.id}/edit`);
                      }}
                      className="btn-icon !p-1.5"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => openCloneModal(project, e)}
                      className="btn-icon !p-1.5"
                      title="Clone"
                    >
                      <CloneIcon className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => openDeleteModal(project, e)}
                      className="btn-icon !p-1.5 hover:!text-danger-400 hover:!bg-danger-500/10"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}

      {/* Clone Modal */}
      {showCloneModal && selectedProject && (
        <Modal onClose={() => setShowCloneModal(false)}>
          <h3 className="section-title mb-1">Clone Project</h3>
          <p className="text-sm text-surface-400 mb-5">
            Create a copy of{" "}
            <strong className="text-surface-200">{selectedProject.name}</strong>
          </p>

          <form onSubmit={handleCloneProject} className="space-y-4">
            <div>
              <label className="label">Name</label>
              <input
                type="text"
                value={cloneFormData.name}
                onChange={(e) =>
                  setCloneFormData((prev) => ({
                    ...prev,
                    name: e.target.value,
                  }))
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
              <button
                type="button"
                onClick={() => setShowCloneModal(false)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button type="submit" disabled={cloning} className="btn-primary">
                {cloning ? (
                  <>
                    <Spinner />
                    Cloning...
                  </>
                ) : (
                  <>
                    <CloneIcon className="w-4 h-4" />
                    Clone
                  </>
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && selectedProject && (
        <Modal onClose={() => setShowDeleteModal(false)}>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-danger-500/15 flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-5 h-5 text-danger-400" />
            </div>
            <div>
              <h3 className="section-title mb-1">Delete Project</h3>
              <p className="text-sm text-surface-400">
                This will permanently delete{" "}
                <strong className="text-surface-200">
                  {selectedProject.name}
                </strong>{" "}
                and all its prompts. This action cannot be undone.
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
        </Modal>
      )}
    </div>
  );
};

/* ── Shared sub-components ── */

const Modal = ({ children, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      className="fixed inset-0 bg-surface-950/70 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    />
    <div className="relative bg-surface-800 border border-surface-700 rounded-2xl p-6 w-full max-w-md shadow-modal animate-scale-in">
      {children}
    </div>
  </div>
);

const Spinner = () => (
  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
);

export default Dashboard;
