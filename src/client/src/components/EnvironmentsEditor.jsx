import { useState } from "react";
import { Plus, X, Trash2, ChevronDown } from "lucide-react";

/**
 * Reusable editor for a project's environments + test users. Controlled:
 * pass `environments` and an `onChange(nextEnvironments)` handler. Used on the
 * full Edit Project page and in the IDE's quick-edit modal so it's configurable
 * from wherever you are. Passwords are shown masked and preserved unless changed.
 */
export default function EnvironmentsEditor({ environments = [], onChange }) {
  const [open, setOpen] = useState((environments?.length || 0) > 0);
  const envs = environments || [];

  const addEnvironment = () =>
    onChange([...envs, { name: "", baseUrl: "", writesAllowed: true, testUsers: [] }]);
  const updateEnvironment = (i, patch) =>
    onChange(envs.map((e, x) => (x === i ? { ...e, ...patch } : e)));
  const removeEnvironment = (i) => onChange(envs.filter((_, x) => x !== i));
  const addTestUser = (i) =>
    updateEnvironment(i, {
      testUsers: [...(envs[i].testUsers || []), { label: "", username: "", tenantId: "", role: "", password: "" }],
    });
  const updateTestUser = (i, j, patch) =>
    updateEnvironment(i, {
      testUsers: (envs[i].testUsers || []).map((u, x) => (x === j ? { ...u, ...patch } : u)),
    });
  const removeTestUser = (i, j) =>
    updateEnvironment(i, { testUsers: (envs[i].testUsers || []).filter((_, x) => x !== j) });

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-left"
      >
        <div>
          <span className="text-sm font-medium text-surface-200">Environments &amp; Test Users</span>
          {envs.length > 0 && (
            <span className="ml-2 text-xs text-surface-400">({envs.length})</span>
          )}
          <p className="text-hint mt-0.5">
            Let the agent log in and verify changes end-to-end. Passwords are encrypted at rest and never shown to the model.
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-surface-400 transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-surface-700/60 space-y-4">
          {envs.map((env, i) => (
            <div key={i} className="p-3 bg-surface-700/30 rounded-lg space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={env.name || ""}
                  onChange={(e) => updateEnvironment(i, { name: e.target.value })}
                  placeholder="Name (e.g. dev, staging, prod)"
                  className="input !py-2 text-sm flex-1"
                />
                <button type="button" onClick={() => removeEnvironment(i)} className="btn-icon !p-1.5 text-danger-400" title="Remove environment">
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
                      <button type="button" onClick={() => removeTestUser(i, j)} className="btn-icon !p-1 text-danger-400" title="Remove user">
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
  );
}
