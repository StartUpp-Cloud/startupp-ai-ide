import { useState, useEffect } from "react";
import { useProjects } from "../contexts/ProjectContext";
import { TASK_MODES, getTaskMode } from "../data/taskModes";
import { PRESETS } from "../data/presets";
import { getPresetExample } from "../data/presetExamples";
import {
  Zap,
  Copy,
  Check,
  BookOpen,
  Globe,
  ChevronDown,
  ChevronRight,
  Bug,
  Sparkles,
  RefreshCw,
  Eye,
  Shield,
  TestTube,
  FileText,
  FlaskConical,
  Settings,
  ListChecks,
  Square,
  CheckSquare,
  Code,
} from "lucide-react";

// Icon mapping for task modes
const TASK_MODE_ICONS = {
  Bug,
  Sparkles,
  RefreshCw,
  Eye,
  Zap,
  Shield,
  TestTube,
  FileText,
  FlaskConical,
  Settings,
};

const getTaskModeIcon = (iconName) => TASK_MODE_ICONS[iconName] || Settings;

const PROMPT_SECTION_OPTIONS = [
  { key: "projectDetails", label: "Project details" },
  { key: "rules", label: "Rules" },
  { key: "context", label: "Context" },
];

const QuickPrompt = () => {
  const { projects, getGlobalRules } = useProjects();

  const [rawPrompt, setRawPrompt] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState([]);
  const [includeGlobal, setIncludeGlobal] = useState(false);
  const [includeCodeExamples, setIncludeCodeExamples] = useState(false);
  const [globalRules, setGlobalRules] = useState([]);
  const [assembled, setAssembled] = useState("");
  const [copied, setCopied] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState({});
  const [selectedTaskMode, setSelectedTaskMode] = useState("");
  const [checklistState, setChecklistState] = useState({});
  const [showTaskModeRules, setShowTaskModeRules] = useState(false);

  useEffect(() => {
    loadGlobalRules();
  }, []);

  const loadGlobalRules = async () => {
    try {
      const data = await getGlobalRules();
      setGlobalRules(data || []);
    } catch (err) {
      console.error("Failed to load global rules:", err);
    }
  };

  const toggleProject = (id) => {
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id],
    );
  };

  const toggleExpand = (id) => {
    setExpandedProjects((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const buildPrompt = () => {
    if (!rawPrompt.trim()) return;

    const activeGlobalRules = includeGlobal
      ? globalRules.filter((r) => r.enabled !== false).map((r) => r.text)
      : [];

    const selectedProjects = projects.filter((p) =>
      selectedProjectIds.includes(p.id),
    );

    // Get task mode rules
    const taskMode = selectedTaskMode ? getTaskMode(selectedTaskMode) : null;
    const taskModeRules =
      taskMode && taskMode.id !== "custom" ? taskMode.additionalRules || [] : [];

    // Build unique rules list with examples where available
    const seenRules = new Set();
    const rulesWithExamples = [];

    // Global rules (no examples)
    activeGlobalRules.forEach(rule => {
      if (!seenRules.has(rule)) {
        seenRules.add(rule);
        rulesWithExamples.push({ rule, example: null });
      }
    });

    // Project preset rules (with examples)
    selectedProjects.forEach(project => {
      (project.selectedPresets || []).forEach(presetId => {
        const preset = PRESETS.find(p => p.id === presetId);
        if (preset) {
          preset.rules.forEach((rule, ruleIndex) => {
            if (!seenRules.has(rule)) {
              seenRules.add(rule);
              rulesWithExamples.push({
                rule,
                example: includeCodeExamples ? getPresetExample(presetId, ruleIndex) : null,
              });
            }
          });
        }
      });
    });

    // Project rules (no examples)
    selectedProjects.forEach(project => {
      (project.rules || []).forEach(rule => {
        if (!seenRules.has(rule)) {
          seenRules.add(rule);
          rulesWithExamples.push({ rule, example: null });
        }
      });
    });

    // Task mode rules (no examples)
    taskModeRules.forEach(rule => {
      if (!seenRules.has(rule)) {
        seenRules.add(rule);
        rulesWithExamples.push({ rule, example: null });
      }
    });

    // Format rules with optional examples
    const formatRulesSection = () => {
      if (rulesWithExamples.length === 0) return "";

      const formattedRules = rulesWithExamples.map(({ rule, example }, i) => {
        let ruleText = `${i + 1}. ${rule}`;
        if (example && includeCodeExamples) {
          if (example.good) {
            ruleText += `\n   Example (Good):\n   \`\`\`\n${example.good.split('\n').map(line => '   ' + line).join('\n')}\n   \`\`\``;
          }
          if (example.bad) {
            ruleText += `\n   Example (Bad - Avoid):\n   \`\`\`\n${example.bad.split('\n').map(line => '   ' + line).join('\n')}\n   \`\`\``;
          }
        }
        return ruleText;
      });

      return `Rules:\n${formattedRules.join("\n\n")}`;
    };

    const sections = [];

    if (selectedProjects.length > 0) {
      const names = selectedProjects.map((p) => p.name).join(", ");
      sections.push(
        `Project${selectedProjects.length > 1 ? "s" : ""}: ${names}`,
      );
    }

    const rulesSection = formatRulesSection();
    if (rulesSection) {
      sections.push(rulesSection);
    }

    sections.push(rawPrompt.trim());

    // Add checklist if task mode has one
    if (taskMode && taskMode.checklist && taskMode.checklist.length > 0) {
      sections.push(
        `Before completing, verify:\n${taskMode.checklist.map((item) => `[ ] ${item}`).join("\n")}`,
      );
      // Initialize checklist state
      const initialState = {};
      taskMode.checklist.forEach((_, i) => {
        initialState[i] = false;
      });
      setChecklistState(initialState);
    }

    setAssembled(sections.join("\n\n"));
  };

  const copyAssembled = async () => {
    try {
      await navigator.clipboard.writeText(assembled);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const reset = () => {
    setRawPrompt("");
    setSelectedProjectIds([]);
    setIncludeGlobal(false);
    setIncludeCodeExamples(false);
    setAssembled("");
    setSelectedTaskMode("");
    setChecklistState({});
    setShowTaskModeRules(false);
  };

  const enabledGlobalCount = globalRules.filter(
    (r) => r.enabled !== false,
  ).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-5 h-5 text-primary-400" />
          <h1 className="page-title">Quick Prompt Builder</h1>
        </div>
        <p className="text-surface-400 text-sm">
          Paste any prompt, pick which projects&apos; rules to inject, and get a
          guardrail-enriched prompt instantly — no project setup needed.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: inputs */}
        <div className="space-y-4">
          {/* Task Mode Selection */}
          <div className="card">
            <label className="label mb-3 block">Task Mode (Optional)</label>
            <div className="grid grid-cols-2 gap-2">
              {TASK_MODES.filter((m) => m.id !== "custom").map((mode) => {
                const IconComponent = getTaskModeIcon(mode.icon);
                const isSelected = selectedTaskMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setSelectedTaskMode(isSelected ? "" : mode.id);
                      setShowTaskModeRules(!isSelected);
                    }}
                    className={`flex items-center gap-2 p-2.5 rounded-lg border transition-all text-left ${
                      isSelected
                        ? "border-primary-500 bg-primary-500/10 text-primary-300"
                        : "border-surface-700/60 bg-surface-850/40 text-surface-300 hover:border-surface-600"
                    }`}
                  >
                    <IconComponent
                      className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? "text-primary-400" : "text-surface-500"}`}
                    />
                    <span className="text-xs font-medium truncate">
                      {mode.name}
                    </span>
                  </button>
                );
              })}
            </div>
            {/* Task Mode Rules Preview */}
            {selectedTaskMode && (
              <div className="mt-3 border-t border-surface-700/60 pt-3">
                <button
                  type="button"
                  onClick={() => setShowTaskModeRules(!showTaskModeRules)}
                  className="flex items-center gap-2 text-xs text-surface-400 hover:text-surface-200"
                >
                  <ListChecks className="w-3 h-3" />
                  <span>
                    {getTaskMode(selectedTaskMode)?.additionalRules?.length || 0}{" "}
                    rules,{" "}
                    {getTaskMode(selectedTaskMode)?.checklist?.length || 0}{" "}
                    checklist items
                  </span>
                  {showTaskModeRules ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                </button>
                {showTaskModeRules && (
                  <div className="mt-2 space-y-2">
                    {getTaskMode(selectedTaskMode)?.additionalRules?.length >
                      0 && (
                      <ul className="space-y-1">
                        {getTaskMode(selectedTaskMode).additionalRules.map(
                          (rule, i) => (
                            <li
                              key={i}
                              className="text-xs text-surface-500 flex gap-1.5"
                            >
                              <span className="text-primary-500">•</span>
                              {rule}
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Raw prompt */}
          <div className="card">
            <label className="label mb-3 block">Your prompt</label>
            <textarea
              value={rawPrompt}
              onChange={(e) => setRawPrompt(e.target.value)}
              rows={6}
              className="input resize-none"
              placeholder="Paste or type your prompt here..."
            />
          </div>

          {/* Global rules toggle */}
          <div className="card">
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary-400" />
                <div>
                  <p className="text-sm font-medium text-surface-200">
                    Include global rules
                  </p>
                  <p className="text-xs text-surface-500 mt-0.5">
                    {enabledGlobalCount} active global{" "}
                    {enabledGlobalCount === 1 ? "rule" : "rules"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIncludeGlobal((v) => !v)}
                className={`w-9 h-5 rounded-full transition-colors duration-200 relative flex-shrink-0 ${
                  includeGlobal ? "bg-primary-500" : "bg-surface-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                    includeGlobal ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </label>
          </div>

          {/* Code examples toggle */}
          <div className="card">
            <label className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code className="w-4 h-4 text-primary-400" />
                <div>
                  <p className="text-sm font-medium text-surface-200">
                    Include code examples
                  </p>
                  <p className="text-xs text-surface-500 mt-0.5">
                    Adds good/bad examples for rules that have them
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIncludeCodeExamples((v) => !v)}
                className={`w-9 h-5 rounded-full transition-colors duration-200 relative flex-shrink-0 ${
                  includeCodeExamples ? "bg-primary-500" : "bg-surface-700"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                    includeCodeExamples ? "left-[18px]" : "left-0.5"
                  }`}
                />
              </button>
            </label>
          </div>

          {/* Project selector */}
          {projects.length > 0 && (
            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <BookOpen className="w-4 h-4 text-primary-400" />
                <p className="text-sm font-medium text-surface-200">
                  Inject rules from projects
                </p>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className="border border-surface-700/60 rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-3 py-2">
                      <input
                        type="checkbox"
                        id={`proj-${project.id}`}
                        checked={selectedProjectIds.includes(project.id)}
                        onChange={() => toggleProject(project.id)}
                        className="h-3.5 w-3.5 accent-primary-500 flex-shrink-0"
                      />
                      <label
                        htmlFor={`proj-${project.id}`}
                        className="flex-1 text-sm text-surface-200 cursor-pointer truncate"
                      >
                        {project.name}
                      </label>
                      <span className="text-xs text-surface-500 flex-shrink-0">
                        {project.rules?.length || 0} rules
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleExpand(project.id)}
                        className="text-surface-500 hover:text-surface-300 transition-colors"
                      >
                        {expandedProjects[project.id] ? (
                          <ChevronDown className="w-3.5 h-3.5" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                    {expandedProjects[project.id] &&
                      project.rules?.length > 0 && (
                        <ul className="border-t border-surface-700/60 px-3 py-2 space-y-1">
                          {project.rules.map((rule, i) => (
                            <li
                              key={i}
                              className="text-xs text-surface-400 flex gap-1.5"
                            >
                              <span className="text-surface-600">{i + 1}.</span>
                              {rule}
                            </li>
                          ))}
                        </ul>
                      )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Build button */}
          <button
            onClick={buildPrompt}
            disabled={!rawPrompt.trim()}
            className="btn-primary w-full"
          >
            <Zap className="w-4 h-4" />
            Build Prompt
          </button>
        </div>

        {/* Right column: output */}
        <div className="space-y-4">
          <div className="card flex flex-col" style={{ minHeight: "400px" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-surface-200">
                Assembled prompt
              </p>
              {assembled && (
                <button
                  onClick={copyAssembled}
                  className="btn-primary !py-1 !px-3 !text-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>

            {assembled ? (
              <>
                <div className="flex-1 p-4 bg-surface-850 rounded-lg border border-surface-700/60 overflow-y-auto">
                  <pre className="text-sm text-surface-300 whitespace-pre-wrap font-mono leading-relaxed">
                    {assembled}
                  </pre>
                </div>

                {/* Interactive Checklist */}
                {selectedTaskMode &&
                  getTaskMode(selectedTaskMode)?.checklist?.length > 0 && (
                    <div className="mt-3 p-3 bg-surface-850/50 rounded-lg border border-surface-700/60">
                      <div className="flex items-center gap-2 mb-2">
                        <ListChecks className="w-3.5 h-3.5 text-primary-400" />
                        <span className="text-xs font-medium text-surface-200">
                          Verification Checklist
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {getTaskMode(selectedTaskMode).checklist.map(
                          (item, i) => (
                            <label
                              key={i}
                              className="flex items-center gap-2 cursor-pointer group"
                            >
                              <button
                                type="button"
                                onClick={() =>
                                  setChecklistState((prev) => ({
                                    ...prev,
                                    [i]: !prev[i],
                                  }))
                                }
                                className="flex-shrink-0"
                              >
                                {checklistState[i] ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-success-400" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 text-surface-500 group-hover:text-surface-400" />
                                )}
                              </button>
                              <span
                                className={`text-xs transition-colors ${
                                  checklistState[i]
                                    ? "text-surface-500 line-through"
                                    : "text-surface-300"
                                }`}
                              >
                                {item}
                              </span>
                            </label>
                          ),
                        )}
                      </div>
                      {Object.values(checklistState).filter(Boolean).length ===
                        getTaskMode(selectedTaskMode).checklist.length && (
                        <p className="mt-2 text-xs text-success-400 flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          All items verified!
                        </p>
                      )}
                    </div>
                  )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-8 rounded-lg border border-dashed border-surface-700/60">
                <div className="text-center">
                  <Zap className="w-8 h-8 text-surface-600 mx-auto mb-2" />
                  <p className="text-sm text-surface-500">
                    Your assembled prompt will appear here
                  </p>
                </div>
              </div>
            )}

            {assembled && (
              <div className="mt-3 flex justify-end">
                <button
                  onClick={reset}
                  className="text-xs text-surface-400 hover:text-surface-200 transition-colors"
                >
                  Reset
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickPrompt;
