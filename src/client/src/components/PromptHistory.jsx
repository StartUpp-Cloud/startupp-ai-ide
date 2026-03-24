import { useState } from "react";
import {
  History,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Equal,
  X,
  ArrowLeft,
  Clock,
  GitCompare,
} from "lucide-react";
import { computeDiff, getDiffStats, formatVersionDate } from "../utils/diff";

/**
 * PromptHistory - Shows version history and diffs for a prompt
 *
 * Props:
 * - prompt: The prompt object with versions array
 * - onClose: Callback to close the history view
 */
const PromptHistory = ({ prompt, onClose }) => {
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  const versions = prompt.versions || [];
  const hasVersions = versions.length > 0;

  // Get the text to compare (selected version vs current or vs next version)
  const getComparisonTexts = () => {
    if (!selectedVersion) return null;

    const versionIndex = versions.findIndex(
      (v) => v.editedAt === selectedVersion.editedAt
    );

    // Compare selected version with the next version (or current if it's the last)
    const oldText = selectedVersion.text;
    const newText =
      versionIndex === versions.length - 1
        ? prompt.text // Compare with current
        : versions[versionIndex + 1].text; // Compare with next version

    return { oldText, newText };
  };

  const comparison = selectedVersion ? getComparisonTexts() : null;
  const diff = comparison ? computeDiff(comparison.oldText, comparison.newText) : null;
  const stats = diff ? getDiffStats(diff) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-surface-950/70 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      <div className="relative bg-surface-800 border border-surface-700 rounded-2xl w-full max-w-4xl max-h-[85vh] shadow-modal animate-scale-in flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-surface-700/60">
          <div className="flex items-center gap-3">
            {selectedVersion && showDiff ? (
              <button
                onClick={() => {
                  setShowDiff(false);
                  setSelectedVersion(null);
                }}
                className="btn-icon"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : null}
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary-400" />
              <h3 className="section-title">
                {showDiff ? "Version Comparison" : "Prompt History"}
              </h3>
            </div>
            {hasVersions && !showDiff && (
              <span className="badge-surface text-xs">
                {versions.length} version{versions.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
          <button onClick={onClose} className="btn-icon">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {!hasVersions ? (
            <div className="text-center py-12">
              <History className="w-12 h-12 text-surface-600 mx-auto mb-3" />
              <p className="text-surface-400">No version history yet</p>
              <p className="text-xs text-surface-500 mt-1">
                Edit this prompt to start tracking changes
              </p>
            </div>
          ) : showDiff && diff ? (
            /* Diff View */
            <div className="space-y-4">
              {/* Stats */}
              <div className="flex items-center gap-4 p-3 bg-surface-850 rounded-lg border border-surface-700/60">
                <div className="flex items-center gap-1.5 text-success-400">
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">{stats.additions}</span>
                  <span className="text-xs text-surface-500">added</span>
                </div>
                <div className="flex items-center gap-1.5 text-danger-400">
                  <Minus className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">{stats.deletions}</span>
                  <span className="text-xs text-surface-500">removed</span>
                </div>
                <div className="flex items-center gap-1.5 text-surface-400">
                  <Equal className="w-3.5 h-3.5" />
                  <span className="text-sm font-medium">{stats.unchanged}</span>
                  <span className="text-xs text-surface-500">unchanged</span>
                </div>
              </div>

              {/* Diff display */}
              <div className="bg-surface-900 rounded-lg border border-surface-700/60 overflow-hidden">
                <div className="p-2 bg-surface-850 border-b border-surface-700/60 flex items-center justify-between">
                  <span className="text-xs text-surface-400">
                    {formatVersionDate(selectedVersion.editedAt)} → {" "}
                    {selectedVersion === versions[versions.length - 1]
                      ? "Current"
                      : formatVersionDate(
                          versions[
                            versions.findIndex(
                              (v) => v.editedAt === selectedVersion.editedAt
                            ) + 1
                          ].editedAt
                        )}
                  </span>
                </div>
                <div className="p-3 font-mono text-xs overflow-x-auto">
                  {diff.map((item, index) => (
                    <div
                      key={index}
                      className={`flex gap-2 py-0.5 px-2 -mx-2 ${
                        item.type === "add"
                          ? "bg-success-500/10 text-success-300"
                          : item.type === "remove"
                            ? "bg-danger-500/10 text-danger-300"
                            : "text-surface-400"
                      }`}
                    >
                      <span
                        className={`w-4 flex-shrink-0 ${
                          item.type === "add"
                            ? "text-success-500"
                            : item.type === "remove"
                              ? "text-danger-500"
                              : "text-surface-600"
                        }`}
                      >
                        {item.type === "add" ? "+" : item.type === "remove" ? "-" : " "}
                      </span>
                      <span className="whitespace-pre-wrap break-all">
                        {item.value || " "}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Version List */
            <div className="space-y-2">
              {/* Current version */}
              <div className="p-3 rounded-lg border border-primary-500/30 bg-primary-500/5">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="badge-primary text-xs">Current</span>
                    <span className="text-xs text-surface-500">
                      {formatVersionDate(prompt.updatedAt)}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-surface-300 line-clamp-3 font-mono">
                  {prompt.text}
                </p>
              </div>

              {/* Previous versions */}
              {[...versions].reverse().map((version, index) => {
                const actualIndex = versions.length - 1 - index;
                return (
                  <div
                    key={version.editedAt}
                    className="p-3 rounded-lg border border-surface-700/60 bg-surface-850/50 hover:border-surface-600 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-surface-500">
                          <Clock className="w-3 h-3 inline mr-1" />
                          {formatVersionDate(version.editedAt)}
                        </span>
                        <span className="text-xs text-surface-600">
                          v{actualIndex + 1}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedVersion(version);
                          setShowDiff(true);
                        }}
                        className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 transition-colors"
                      >
                        <GitCompare className="w-3 h-3" />
                        View diff
                      </button>
                    </div>
                    <p className="text-sm text-surface-400 line-clamp-2 font-mono">
                      {version.text}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-surface-700/60 flex justify-end">
          <button onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default PromptHistory;
