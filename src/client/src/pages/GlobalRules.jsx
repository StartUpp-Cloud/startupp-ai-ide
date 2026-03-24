import { useState, useEffect } from "react";
import { useProjects } from "../contexts/ProjectContext";
import {
  Globe,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  AlertTriangle,
  Info,
} from "lucide-react";

const GlobalRules = () => {
  const {
    getGlobalRules,
    createGlobalRule,
    updateGlobalRule,
    deleteGlobalRule,
    notify,
  } = useProjects();

  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newRuleText, setNewRuleText] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState("");
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    try {
      const data = await getGlobalRules();
      setRules(data || []);
    } catch (err) {
      console.error("Failed to load global rules:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newRuleText.trim()) return;
    try {
      setAdding(true);
      const rule = await createGlobalRule({ text: newRuleText.trim() });
      setRules((prev) => [...prev, rule]);
      setNewRuleText("");
    } catch (err) {
      console.error("Failed to add rule:", err);
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (rule) => {
    setEditingId(rule.id);
    setEditingText(rule.text);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async (id) => {
    if (!editingText.trim()) return;
    try {
      const updated = await updateGlobalRule(id, { text: editingText.trim() });
      setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setEditingId(null);
    } catch (err) {
      console.error("Failed to update rule:", err);
    }
  };

  const toggleEnabled = async (rule) => {
    try {
      const updated = await updateGlobalRule(rule.id, {
        enabled: !rule.enabled,
      });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch (err) {
      console.error("Failed to toggle rule:", err);
    }
  };

  const handleDelete = async () => {
    if (!deleteTargetId) return;
    try {
      setDeleting(true);
      await deleteGlobalRule(deleteTargetId);
      setRules((prev) => prev.filter((r) => r.id !== deleteTargetId));
      setDeleteTargetId(null);
    } catch (err) {
      console.error("Failed to delete rule:", err);
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

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Globe className="w-5 h-5 text-primary-400" />
          <h1 className="page-title">Global Rules</h1>
        </div>
        <p className="text-surface-400 text-sm">
          Rules defined here can be included in any project&apos;s prompts.
          Enable &quot;Include global rules&quot; in a project&apos;s prompt
          settings to inject them automatically.
        </p>
      </div>

      {/* Info callout */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-primary-500/5 border border-primary-500/20">
        <Info className="w-4 h-4 text-primary-400 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-surface-300">
          Global rules are prepended before project-specific rules in the
          assembled prompt. Use them for universal guardrails like &ldquo;Never
          mock implementations&rdquo; or security policies that apply across all
          your AI workflows.
        </p>
      </div>

      {/* Add new rule */}
      <div className="card">
        <h3 className="section-title !text-base mb-4">Add a global rule</h3>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text"
            value={newRuleText}
            onChange={(e) => setNewRuleText(e.target.value)}
            className="input flex-1"
            placeholder="e.g. Never use mocks or stubs — implement the real solution"
            maxLength={2000}
          />
          <button
            type="submit"
            disabled={adding || !newRuleText.trim()}
            className="btn-primary flex-shrink-0"
          >
            {adding ? <Spinner /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </form>
      </div>

      {/* Rules list */}
      <div className="card !p-0 overflow-hidden">
        {rules.length === 0 ? (
          <div className="text-center py-12">
            <Globe className="w-10 h-10 text-surface-600 mx-auto mb-3" />
            <p className="text-sm text-surface-400">No global rules yet</p>
            <p className="text-xs text-surface-500 mt-1">
              Add your first global rule above
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-surface-700/60">
            {rules.map((rule) => (
              <li key={rule.id} className="group flex items-start gap-3 p-4">
                {/* Toggle */}
                <button
                  onClick={() => toggleEnabled(rule)}
                  title={
                    rule.enabled === false ? "Enable rule" : "Disable rule"
                  }
                  className={`flex-shrink-0 mt-0.5 w-9 h-5 rounded-full transition-colors duration-200 relative ${
                    rule.enabled === false ? "bg-surface-700" : "bg-primary-500"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${
                      rule.enabled === false ? "left-0.5" : "left-[18px]"
                    }`}
                  />
                </button>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {editingId === rule.id ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className="input !py-1.5 flex-1 text-sm"
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(rule.id);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        maxLength={2000}
                      />
                      <button
                        onClick={() => saveEdit(rule.id)}
                        className="btn-icon !p-1.5 text-success-400"
                        title="Save"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="btn-icon !p-1.5"
                        title="Cancel"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p
                      className={`text-sm leading-relaxed ${
                        rule.enabled === false
                          ? "text-surface-500 line-through"
                          : "text-surface-200"
                      }`}
                    >
                      {rule.text}
                    </p>
                  )}
                </div>

                {/* Actions */}
                {editingId !== rule.id && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={() => startEdit(rule)}
                      className="btn-icon !p-1.5"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteTargetId(rule.id)}
                      className="btn-icon !p-1.5 hover:!text-danger-400 hover:!bg-danger-500/10"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-surface-950/70 backdrop-blur-sm animate-fade-in"
            onClick={() => setDeleteTargetId(null)}
          />
          <div className="relative bg-surface-800 border border-surface-700 rounded-2xl p-6 w-full max-w-md shadow-modal animate-scale-in">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-danger-500/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-danger-400" />
              </div>
              <div>
                <h3 className="section-title mb-1">Delete Global Rule</h3>
                <p className="text-sm text-surface-400">
                  This global rule will be permanently deleted and removed from
                  all projects that include global rules.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setDeleteTargetId(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="btn bg-danger-500 text-white hover:bg-danger-600 active:scale-[0.98]"
              >
                {deleting ? <Spinner /> : <Trash2 className="w-4 h-4" />}
                Delete
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

export default GlobalRules;
