import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useProjects } from "../contexts/ProjectContext";
import {
  ArrowLeft,
  Plus,
  Search,
  Copy,
  Check,
  MessageSquare,
  Calendar,
  Pencil,
  Sparkles,
  Copy as CloneIcon,
  Trash2,
  ChevronDown,
  ChevronRight,
  BookOpen,
  GripVertical,
  X,
  AlertTriangle,
  Globe,
  Download,
  Upload,
  Save,
} from "lucide-react";

const PROMPT_SECTION_OPTIONS = [
  { key: "projectDetails", label: "Project details" },
  { key: "rules", label: "Rules" },
  { key: "context", label: "Context" },
];

const LEGACY_TO_GROUPED_SECTION = {
  projectName: "projectDetails",
  projectDescription: "projectDetails",
  projectRules: "rules",
  promptTemplate: "context",
  additionalContext: "context",
  userPrompt: "context",
};

const DEFAULT_PROMPT_SETTINGS = {
  autoSavePrompts: false,
  promptStructure: PROMPT_SECTION_OPTIONS.map((section) => section.key),
};

const normalizePromptSettings = (settings) => {
  const structure = Array.isArray(settings?.promptStructure)
    ? settings.promptStructure.map(
        (section) => LEGACY_TO_GROUPED_SECTION[section] || section,
      )
    : [];
  const deduped = [...new Set(structure)].filter((key) =>
    PROMPT_SECTION_OPTIONS.some((section) => section.key === key),
  );
  const missing = PROMPT_SECTION_OPTIONS.map((section) => section.key).filter(
    (key) => !deduped.includes(key),
  );

  return {
    autoSavePrompts:
      typeof settings?.autoSavePrompts === "boolean"
        ? settings.autoSavePrompts
        : DEFAULT_PROMPT_SETTINGS.autoSavePrompts,
    promptStructure: [...deduped, ...missing],
  };
};

const reorderSections = (list, fromIndex, toIndex) => {
  const next = [...list];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};

const ProjectDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    getProject,
    createPrompt,
    getPrompts,
    cloneProject,
    deleteProject,
    deletePrompt,
    updateProject,
    updatePrompt,
    notify,
    getGlobalRules,
  } = useProjects();

  const [project, setProject] = useState(null);
  const [prompts, setPrompts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [promptText, setPromptText] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [copiedPrompt, setCopiedPrompt] = useState(null);
  const [selectedPromptType, setSelectedPromptType] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [showGeneratedPrompt, setShowGeneratedPrompt] = useState(false);
  const [showRules, setShowRules] = useState(true);
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeletePromptModal, setShowDeletePromptModal] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState(null);
  const [cloneFormData, setCloneFormData] = useState({
    name: "",
    description: "",
  });
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [draggedSection, setDraggedSection] = useState(null);
  const [autoSavedGenerated, setAutoSavedGenerated] = useState(false);
  const [promptSettings, setPromptSettings] = useState(DEFAULT_PROMPT_SETTINGS);
  const [globalRules, setGlobalRules] = useState([]);
  const [editingPromptId, setEditingPromptId] = useState(null);
  const [editingPromptText, setEditingPromptText] = useState("");

  const promptTypes = [
    {
      value: "requirement",
      label: "Requirement Analysis",
      template:
        "Please analyze the following requirement for my {projectType} project and provide a detailed breakdown of the technical specifications, implementation approach, and potential challenges. Consider the project rules and constraints when formulating your response.",
    },
    {
      value: "fix",
      label: "Bug Fix",
      template:
        "I need help fixing a bug in my {projectType} project. Please analyze the issue and provide a step-by-step solution that follows the project rules and best practices. Include code examples and testing recommendations.",
    },
    {
      value: "feature",
      label: "Feature Implementation",
      template:
        "I want to implement a new feature for my {projectType} project. Please provide a comprehensive implementation plan, including architecture considerations, code structure, and integration points that align with the existing project rules.",
    },
    {
      value: "review",
      label: "Code Review",
      template:
        "Please review this code for my {projectType} project and provide feedback on code quality, adherence to project rules, potential improvements, and any security or performance concerns.",
    },
    {
      value: "optimization",
      label: "Performance Optimization",
      template:
        "I need to optimize the performance of my {projectType} project. Please analyze the current implementation and suggest specific optimizations that maintain code quality while improving speed, memory usage, or scalability.",
    },
    {
      value: "testing",
      label: "Testing Strategy",
      template:
        "Please help me develop a comprehensive testing strategy for my {projectType} project. Consider unit tests, integration tests, and end-to-end tests that ensure the project rules are properly enforced.",
    },
    {
      value: "documentation",
      label: "Documentation",
      template:
        "I need help creating comprehensive documentation for my {projectType} project. Please suggest a documentation structure and how to document the project rules and implementation details effectively.",
    },
    { value: "custom", label: "Custom Prompt", template: "" },
  ];

  useEffect(() => {
    loadProject();
    loadPrompts();
    loadGlobalRules();
  }, [id]);

  const loadGlobalRules = async () => {
    try {
      const data = await getGlobalRules();
      setGlobalRules(data || []);
    } catch (error) {
      console.error("Failed to load global rules:", error);
    }
  };

  const loadProject = async () => {
    try {
      const data = await getProject(id);
      if (!data) { navigate("/"); return; }
      setProject(data);
      setPromptSettings(normalizePromptSettings(data.promptSettings));
    } catch {
      navigate("/");
    }
  };

  const loadPrompts = async (page = 1, search = "") => {
    try {
      const data = await getPrompts(id, page, 10, search);
      setPrompts(data.prompts || []);
      setTotalPages(data.totalPages || 1);
      setCurrentPage(page);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    loadPrompts(1, searchTerm);
  };

  const generateFullPrompt = (prompt) => {
    if (!project) return prompt.text;

    const disabledIndices = promptSettings.disabledRuleIndices || [];
    const projectRules = (project.rules || []).filter(
      (_, i) => !disabledIndices.includes(i),
    );
    const activeGlobalRules = promptSettings.includeGlobalRules
      ? globalRules.filter((r) => r.enabled !== false).map((r) => r.text)
      : [];
    const allRules = [...activeGlobalRules, ...projectRules];

    const sections = {
      projectDetails:
        project.name || project.description
          ? `Project: ${project.name}\nDescription: ${project.description}`
          : "",
      rules:
        allRules.length > 0
          ? `Rules:\n${allRules.map((rule, i) => `${i + 1}. ${rule}`).join("\n")}`
          : "",
      context: `User Prompt: ${prompt.text}`,
    };

    return promptSettings.promptStructure
      .map((key) => sections[key])
      .filter(Boolean)
      .join("\n\n");
  };

  const copyToClipboard = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPrompt(key);
      setTimeout(() => setCopiedPrompt(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const savePromptText = async (text) => {
    const newPrompt = await createPrompt(id, {
      text,
      projectId: id,
      promptType: selectedPromptType || null,
    });

    setPrompts((prev) => [newPrompt, ...prev]);
    setProject((prev) =>
      prev
        ? {
            ...prev,
            promptCount: (prev.promptCount || 0) + 1,
          }
        : prev,
    );

    return newPrompt;
  };

  const generateSmartPrompt = async () => {
    if (!selectedPromptType || !project) return;
    const pt = promptTypes.find((t) => t.value === selectedPromptType);
    if (!pt) return;

    const templateText =
      selectedPromptType === "custom"
        ? promptText
        : pt.template.replace(/{projectType}/g, project.name.toLowerCase());

    const contextText =
      selectedPromptType === "custom"
        ? promptText
        : promptText
          ? `${templateText}\n\nAdditional Context: ${promptText}`
          : templateText;

    const disabledIndices = promptSettings.disabledRuleIndices || [];
    const projectRules = (project.rules || []).filter(
      (_, i) => !disabledIndices.includes(i),
    );
    const activeGlobalRules = promptSettings.includeGlobalRules
      ? globalRules.filter((r) => r.enabled !== false).map((r) => r.text)
      : [];
    const allRules = [...activeGlobalRules, ...projectRules];

    const sections = {
      projectDetails:
        project.name || project.description
          ? `Project: ${project.name}\nDescription: ${project.description}`
          : "",
      rules:
        allRules.length > 0
          ? `Project Rules:\n${allRules.map((rule, i) => `${i + 1}. ${rule}`).join("\n")}`
          : "",
      context: contextText,
    };

    const smart = promptSettings.promptStructure
      .map((key) => sections[key])
      .filter(Boolean)
      .join("\n\n");

    setGeneratedPrompt(smart);
    setShowGeneratedPrompt(true);

    if (promptSettings.autoSavePrompts) {
      try {
        await savePromptText(smart);
        setAutoSavedGenerated(true);
      } catch (error) {
        setAutoSavedGenerated(false);
        console.error("Failed to create prompt:", error);
      }
    } else {
      setAutoSavedGenerated(false);
    }
  };

  const createPromptFromGenerated = async () => {
    if (!generatedPrompt.trim()) return;
    try {
      await savePromptText(generatedPrompt);
      resetPromptGeneration();
    } catch (error) {
      console.error("Failed to create prompt:", error);
    }
  };

  const resetPromptGeneration = () => {
    setSelectedPromptType("");
    setPromptText("");
    setGeneratedPrompt("");
    setShowGeneratedPrompt(false);
    setAutoSavedGenerated(false);
  };

  const savePromptSettings = async () => {
    try {
      setSettingsSaving(true);
      const updatedProject = await updateProject(id, {
        promptSettings,
      });
      setProject(updatedProject);
      setPromptSettings(normalizePromptSettings(updatedProject.promptSettings));
      notify("Prompt settings saved");
    } catch (error) {
      console.error("Failed to save prompt settings:", error);
    } finally {
      setSettingsSaving(false);
    }
  };

  const toggleRuleEnabled = async (index) => {
    const current = promptSettings.disabledRuleIndices || [];
    const newDisabled = current.includes(index)
      ? current.filter((i) => i !== index)
      : [...current, index];
    const newSettings = { ...promptSettings, disabledRuleIndices: newDisabled };
    setPromptSettings(newSettings);
    try {
      const updated = await updateProject(id, { promptSettings: newSettings });
      setProject(updated);
    } catch (error) {
      setPromptSettings(promptSettings);
      console.error("Failed to toggle rule:", error);
    }
  };

  const exportProject = () => {
    if (!project) return;
    const exportData = {
      version: 1,
      project: {
        name: project.name,
        description: project.description,
        rules: project.rules,
        promptSettings: project.promptSettings,
      },
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, "-").toLowerCase()}-prompt-rules.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify("Project exported");
  };

  const exportAsCursorrules = () => {
    if (!project) return;
    const lines = [
      `# ${project.name}`,
      `# ${project.description}`,
      "",
      "## Rules",
      "",
      ...project.rules.map((rule) => `- ${rule}`),
    ];
    const text = lines.join("\n");
    copyToClipboard(text, "cursorrules");
    notify("Copied as .cursorrules format");
  };

  const startEditingPrompt = (prompt) => {
    setEditingPromptId(prompt.id);
    setEditingPromptText(prompt.text);
  };

  const cancelEditingPrompt = () => {
    setEditingPromptId(null);
    setEditingPromptText("");
  };

  const savePromptEdit = async (promptId) => {
    if (!editingPromptText.trim()) return;
    try {
      const updated = await updatePrompt(id, promptId, {
        text: editingPromptText.trim(),
      });
      setPrompts((prev) => prev.map((p) => (p.id === promptId ? updated : p)));
      setEditingPromptId(null);
      setEditingPromptText("");
    } catch (error) {
      console.error("Failed to update prompt:", error);
    }
  };

  const movePromptSection = (fromIndex, toIndex) => {
    setPromptSettings((prev) => ({
      ...prev,
      promptStructure: reorderSections(
        prev.promptStructure,
        fromIndex,
        toIndex,
      ),
    }));
  };

  const handleCloneProject = async (e) => {
    e.preventDefault();
    try {
      setCloning(true);
      const cloned = await cloneProject(id, {
        name: cloneFormData.name.trim() || undefined,
        description: cloneFormData.description.trim() || undefined,
      });
      navigate(`/project/${cloned.id}`);
    } catch (error) {
      console.error("Failed to clone:", error);
    } finally {
      setCloning(false);
      setShowCloneModal(false);
    }
  };

  const handleDeleteProject = async () => {
    try {
      setDeleting(true);
      await deleteProject(id);
      navigate("/");
    } catch (error) {
      console.error("Failed to delete:", error);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeletePrompt = async () => {
    if (!promptToDelete) return;
    try {
      setDeleting(true);
      await deletePrompt(id, promptToDelete.id);
      setPrompts((prev) => prev.filter((p) => p.id !== promptToDelete.id));
      setShowDeletePromptModal(false);
      setPromptToDelete(null);
    } catch (error) {
      console.error("Failed to delete prompt:", error);
    } finally {
      setDeleting(false);
    }
  };

  const openCloneModal = () => {
    setCloneFormData({
      name: `${project.name} (Copy)`,
      description: project.description,
    });
    setShowCloneModal(true);
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
    <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button onClick={() => navigate("/")} className="btn-icon mt-1">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="page-title truncate">{project.name}</h1>
          <p className="text-surface-400 text-sm mt-1 line-clamp-2">
            {project.description}
          </p>
          <div className="flex items-center gap-3 mt-3">
            <span className="badge-primary">
              <BookOpen className="w-3 h-3" />
              {project.rules?.length || 0} rules
            </span>
            <span className="badge-surface">
              <MessageSquare className="w-3 h-3" />
              {project.promptCount || 0} prompts
            </span>
            <span className="text-xs text-surface-500 flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {project.createdAt
                ? new Date(project.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "No date"}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={exportProject}
            className="btn-icon"
            title="Export project as JSON"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={exportAsCursorrules}
            className="btn-icon"
            title="Copy as .cursorrules"
          >
            <Upload className="w-4 h-4" />
          </button>
          <Link to={`/project/${id}/edit`} className="btn-icon" title="Edit">
            <Pencil className="w-4 h-4" />
          </Link>
          <button onClick={openCloneModal} className="btn-icon" title="Clone">
            <CloneIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="btn-icon hover:!text-danger-400 hover:!bg-danger-500/10"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Rules Section */}
      {project.rules?.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <button
            onClick={() => setShowRules(!showRules)}
            className="flex items-center justify-between w-full p-4 hover:bg-surface-750/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary-400" />
              <span className="section-title !text-base">Project Rules</span>
              <span className="badge-surface ml-1">{project.rules.length}</span>
            </div>
            {showRules ? (
              <ChevronDown className="w-4 h-4 text-surface-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-surface-400" />
            )}
          </button>

          {showRules && (
            <div className="px-4 pb-4 space-y-2">
              {project.rules.map((rule, index) => {
                const disabled = (
                  promptSettings.disabledRuleIndices || []
                ).includes(index);
                return (
                  <div
                    key={index}
                    className={`flex items-start gap-3 py-2 px-3 rounded-lg transition-colors ${
                      disabled
                        ? "bg-surface-850/20 opacity-50"
                        : "bg-surface-850/50"
                    }`}
                  >
                    <span className="flex-shrink-0 w-5 h-5 rounded bg-primary-500/15 text-primary-400 text-[11px] font-mono font-medium flex items-center justify-center mt-0.5">
                      {index + 1}
                    </span>
                    <p
                      className={`text-sm leading-relaxed flex-1 ${disabled ? "line-through text-surface-500" : "text-surface-300"}`}
                    >
                      {rule}
                    </p>
                    <button
                      onClick={() => toggleRuleEnabled(index)}
                      title={disabled ? "Enable rule" : "Disable rule"}
                      className={`flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-200 relative ${
                        disabled ? "bg-surface-700" : "bg-primary-500"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                          disabled ? "left-0.5" : "left-[18px]"
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-400" />
            <h3 className="section-title !text-base">Prompt Settings</h3>
          </div>
          <button
            type="button"
            onClick={savePromptSettings}
            disabled={settingsSaving}
            className="btn-secondary !py-1.5"
          >
            {settingsSaving ? (
              <>
                <Spinner />
                Saving...
              </>
            ) : (
              "Save settings"
            )}
          </button>
        </div>

        <label className="flex items-center justify-between p-3 rounded-lg border border-surface-700/60 bg-surface-850/40 mb-4">
          <span className="text-sm text-surface-200">
            Auto-save prompts after generation
          </span>
          <input
            type="checkbox"
            checked={promptSettings.autoSavePrompts}
            onChange={(e) =>
              setPromptSettings((prev) => ({
                ...prev,
                autoSavePrompts: e.target.checked,
              }))
            }
            className="h-4 w-4 accent-primary-500"
          />
        </label>

        <label className="flex items-center justify-between p-3 rounded-lg border border-surface-700/60 bg-surface-850/40 mb-4">
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-primary-400" />
            <span className="text-sm text-surface-200">
              Include global rules in generated prompts
            </span>
          </div>
          <input
            type="checkbox"
            checked={promptSettings.includeGlobalRules || false}
            onChange={(e) =>
              setPromptSettings((prev) => ({
                ...prev,
                includeGlobalRules: e.target.checked,
              }))
            }
            className="h-4 w-4 accent-primary-500"
          />
        </label>

        <p className="text-xs text-surface-400 mb-2">
          Drag sections to set the final prompt order.
        </p>
        <div className="space-y-2">
          {promptSettings.promptStructure.map((sectionKey, index) => {
            const section = PROMPT_SECTION_OPTIONS.find(
              (item) => item.key === sectionKey,
            );
            return (
              <div
                key={sectionKey}
                draggable
                onDragStart={() => setDraggedSection(sectionKey)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (!draggedSection || draggedSection === sectionKey) return;
                  const from =
                    promptSettings.promptStructure.indexOf(draggedSection);
                  const to = promptSettings.promptStructure.indexOf(sectionKey);
                  if (from < 0 || to < 0) return;
                  movePromptSection(from, to);
                  setDraggedSection(null);
                }}
                onDragEnd={() => setDraggedSection(null)}
                className="flex items-center gap-3 p-3 rounded-lg border border-surface-700/60 bg-surface-850/40"
              >
                <GripVertical className="w-4 h-4 text-surface-500 cursor-grab" />
                <span className="text-xs font-mono text-surface-500 w-5 text-right">
                  {index + 1}
                </span>
                <span className="text-sm text-surface-200 flex-1">
                  {section?.label || sectionKey}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create Prompt Section */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-4 h-4 text-primary-400" />
          <h3 className="section-title !text-base">Generate Prompt</h3>
        </div>

        {!showGeneratedPrompt ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              generateSmartPrompt();
            }}
            className="space-y-4"
          >
            <div>
              <label className="label">Prompt Type</label>
              <select
                value={selectedPromptType}
                onChange={(e) => setSelectedPromptType(e.target.value)}
                className="select"
                required
              >
                <option value="">Select a type...</option>
                {promptTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Additional Context</label>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={3}
                className="input resize-none"
                placeholder="Add specific details, requirements, or context..."
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!selectedPromptType}
                className="btn-primary"
              >
                <Sparkles className="w-4 h-4" />
                Generate
              </button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="p-4 bg-surface-850 rounded-lg border border-surface-700/60 max-h-80 overflow-y-auto">
              <pre className="text-sm text-surface-300 whitespace-pre-wrap font-mono leading-relaxed">
                {generatedPrompt}
              </pre>
            </div>

            <div className="flex items-center justify-between">
              <button
                onClick={resetPromptGeneration}
                className="text-sm text-surface-400 hover:text-surface-200 transition-colors"
              >
                Start over
              </button>
              <div className="flex gap-2">
                {!promptSettings.autoSavePrompts ? (
                  <button
                    onClick={createPromptFromGenerated}
                    className="btn-secondary"
                  >
                    <Plus className="w-4 h-4" />
                    Save
                  </button>
                ) : (
                  <span className="text-xs text-success-400 px-3 py-2 rounded-lg bg-success-500/10 border border-success-500/20">
                    {autoSavedGenerated
                      ? "Saved automatically"
                      : "Auto-save enabled"}
                  </span>
                )}
                <button
                  onClick={() => copyToClipboard(generatedPrompt, "generated")}
                  className="btn-primary"
                >
                  {copiedPrompt === "generated" ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Prompt History */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-surface-400" />
            <h3 className="section-title !text-base">Prompt History</h3>
          </div>

          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-surface-500" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input !pl-8 !py-1.5 !text-xs w-48"
              />
            </div>
          </form>
        </div>

        {prompts.length === 0 ? (
          <div className="text-center py-10">
            <MessageSquare className="w-10 h-10 text-surface-600 mx-auto mb-3" />
            <p className="text-sm text-surface-400">No prompts yet</p>
            <p className="text-xs text-surface-500 mt-1">
              Generate your first prompt above
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {prompts.map((prompt) => (
              <div
                key={prompt.id}
                className="group border border-surface-700/60 rounded-lg p-4 hover:border-surface-600/60 transition-colors"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 text-xs text-surface-500 flex-wrap">
                    <Calendar className="w-3 h-3" />
                    <span>
                      {prompt.createdAt
                        ? new Date(prompt.createdAt).toLocaleDateString(
                            "en-US",
                            { month: "short", day: "numeric", year: "numeric" },
                          )
                        : "No date"}
                    </span>
                    {prompt.promptType && (
                      <span className="px-1.5 py-0.5 rounded bg-primary-500/15 text-primary-400 font-medium">
                        {promptTypes.find((t) => t.value === prompt.promptType)
                          ?.label || prompt.promptType}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEditingPrompt(prompt)}
                      className="btn-icon !p-1.5"
                      title="Edit prompt"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() =>
                        copyToClipboard(generateFullPrompt(prompt), prompt.id)
                      }
                      className="btn-icon !p-1.5"
                      title="Copy with context"
                    >
                      {copiedPrompt === prompt.id ? (
                        <Check className="w-3.5 h-3.5 text-success-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setPromptToDelete(prompt);
                        setShowDeletePromptModal(true);
                      }}
                      className="btn-icon !p-1.5 hover:!text-danger-400 hover:!bg-danger-500/10"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {editingPromptId === prompt.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editingPromptText}
                      onChange={(e) => setEditingPromptText(e.target.value)}
                      rows={4}
                      className="input resize-none text-sm !py-2"
                      autoFocus
                    />
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={cancelEditingPrompt}
                        className="btn-secondary !py-1 !px-3 !text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => savePromptEdit(prompt.id)}
                        className="btn-primary !py-1 !px-3 !text-xs"
                      >
                        <Save className="w-3 h-3" />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-surface-200 mb-3 line-clamp-3">
                      {prompt.text}
                    </p>

                    <details className="group/details">
                      <summary className="cursor-pointer text-xs text-primary-400 hover:text-primary-300 font-medium transition-colors">
                        View full prompt with context
                      </summary>
                      <div className="mt-3 p-3 bg-surface-850 rounded-lg border border-surface-700/60 max-h-60 overflow-y-auto">
                        <pre className="text-xs text-surface-400 whitespace-pre-wrap font-mono leading-relaxed">
                          {generateFullPrompt(prompt)}
                        </pre>
                      </div>
                    </details>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6 pt-4 border-t border-surface-700/60">
            <button
              onClick={() => loadPrompts(currentPage - 1, searchTerm)}
              disabled={currentPage === 1}
              className="btn-secondary !py-1.5 !px-3 !text-xs"
            >
              Previous
            </button>
            <span className="text-xs text-surface-400">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => loadPrompts(currentPage + 1, searchTerm)}
              disabled={currentPage === totalPages}
              className="btn-secondary !py-1.5 !px-3 !text-xs"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Clone Modal */}
      {showCloneModal && (
        <Modal onClose={() => setShowCloneModal(false)}>
          <h3 className="section-title mb-1">Clone Project</h3>
          <p className="text-sm text-surface-400 mb-5">
            Create a copy of{" "}
            <strong className="text-surface-200">{project.name}</strong>
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

      {/* Delete Project Modal */}
      {showDeleteModal && (
        <Modal onClose={() => setShowDeleteModal(false)}>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-danger-500/15 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-danger-400" />
            </div>
            <div>
              <h3 className="section-title mb-1">Delete Project</h3>
              <p className="text-sm text-surface-400">
                This will permanently delete{" "}
                <strong className="text-surface-200">{project.name}</strong> and
                all its prompts. This cannot be undone.
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

      {/* Delete Prompt Modal */}
      {showDeletePromptModal && promptToDelete && (
        <Modal onClose={() => setShowDeletePromptModal(false)}>
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-danger-500/15 flex items-center justify-center flex-shrink-0">
              <Trash2 className="w-5 h-5 text-danger-400" />
            </div>
            <div>
              <h3 className="section-title mb-1">Delete Prompt</h3>
              <p className="text-sm text-surface-400">
                This prompt will be permanently deleted. This cannot be undone.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={() => setShowDeletePromptModal(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={handleDeletePrompt}
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

export default ProjectDetail;
