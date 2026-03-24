import { useState, useEffect } from "react";
import { useProjects } from "../contexts/ProjectContext";
import {
  Zap,
  Copy,
  Check,
  BookOpen,
  Globe,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

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
  const [globalRules, setGlobalRules] = useState([]);
  const [assembled, setAssembled] = useState("");
  const [copied, setCopied] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState({});

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

    const allRules = [
      ...activeGlobalRules,
      ...selectedProjects.flatMap((p) => p.rules || []),
    ];

    // Deduplicate rules
    const uniqueRules = [...new Set(allRules)];

    const sections = [];

    if (selectedProjects.length > 0) {
      const names = selectedProjects.map((p) => p.name).join(", ");
      sections.push(
        `Project${selectedProjects.length > 1 ? "s" : ""}: ${names}`,
      );
    }

    if (uniqueRules.length > 0) {
      sections.push(
        `Rules:\n${uniqueRules.map((rule, i) => `${i + 1}. ${rule}`).join("\n")}`,
      );
    }

    sections.push(rawPrompt.trim());

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
    setAssembled("");
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
              <div className="flex-1 p-4 bg-surface-850 rounded-lg border border-surface-700/60 overflow-y-auto">
                <pre className="text-sm text-surface-300 whitespace-pre-wrap font-mono leading-relaxed">
                  {assembled}
                </pre>
              </div>
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
