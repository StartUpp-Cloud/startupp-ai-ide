import { useState, useEffect, useCallback, useRef } from 'react';
import {
  TestTube,
  Rocket,
  Database,
  Layers,
  Shield,
  Settings,
  Sparkles,
  Check,
  Plus,
  X,
  ChevronDown,
  ChevronRight,
  Download,
  Trash2,
  ExternalLink,
  BookOpen,
  Terminal,
  Zap,
  Loader2,
  AlertCircle,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';

const CATEGORY_ICONS = {
  testing: TestTube,
  deployment: Rocket,
  database: Database,
  framework: Layers,
  security: Shield,
  devops: Settings,
  general: Sparkles,
};

const CATEGORY_COLORS = {
  testing: 'text-yellow-400',
  deployment: 'text-blue-400',
  database: 'text-emerald-400',
  framework: 'text-purple-400',
  security: 'text-red-400',
  devops: 'text-orange-400',
  general: 'text-primary-400',
};

function getCategoryIcon(category) {
  return CATEGORY_ICONS[category] || CATEGORY_ICONS.general;
}

function getCategoryColor(category) {
  return CATEGORY_COLORS[category] || CATEGORY_COLORS.general;
}

// --- Toggle Switch ---
function ToggleSwitch({ active, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors flex-shrink-0 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${active ? 'bg-green-500' : 'bg-surface-600'}`}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full bg-white transition-transform ${
          active ? 'translate-x-3.5' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// --- Active Skill Row ---
function ActiveSkillRow({ skill, onDeactivate, deactivating }) {
  const CategoryIcon = getCategoryIcon(skill.category);
  const categoryColor = getCategoryColor(skill.category);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-800 transition-colors group">
      <CategoryIcon className={`w-3.5 h-3.5 flex-shrink-0 ${categoryColor}`} />
      <span className="text-xs text-surface-200 truncate flex-1">{skill.name}</span>
      <ToggleSwitch
        active={true}
        onClick={() => onDeactivate(skill.id)}
        disabled={deactivating}
      />
    </div>
  );
}

// --- Skill Card (Available) ---
function SkillCard({ skill, onActivate, onDelete, activating }) {
  const [expanded, setExpanded] = useState(false);
  const CategoryIcon = getCategoryIcon(skill.category);
  const categoryColor = getCategoryColor(skill.category);

  const ruleCount = skill.rules?.length || 0;
  const conventionCount = skill.conventions?.length || 0;
  const templateCount = skill.promptTemplates?.length || 0;
  const commandCount = skill.quickCommands?.length || 0;

  return (
    <div className="border border-surface-700 rounded mx-2 mb-1.5 bg-surface-800/50 overflow-hidden">
      {/* Card header */}
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-surface-750 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <button className="flex-shrink-0">
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-surface-500" />
          ) : (
            <ChevronRight className="w-3 h-3 text-surface-500" />
          )}
        </button>

        <CategoryIcon className={`w-3.5 h-3.5 flex-shrink-0 ${categoryColor}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-surface-200 truncate">
              {skill.name}
            </span>
            <span className={`text-[9px] px-1 py-0.5 rounded ${
              skill.builtIn
                ? 'bg-primary-500/20 text-primary-300'
                : 'bg-emerald-500/20 text-emerald-300'
            }`}>
              {skill.builtIn ? 'Built-in' : 'Custom'}
            </span>
          </div>
          {skill.description && (
            <p className="text-[10px] text-surface-500 truncate mt-0.5">
              {skill.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {ruleCount > 0 && (
            <span className="text-[9px] text-surface-500">
              {ruleCount} rule{ruleCount !== 1 ? 's' : ''}
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onActivate(skill.id);
            }}
            disabled={activating}
            className="px-1.5 py-0.5 text-[10px] bg-primary-500 hover:bg-primary-600 disabled:bg-surface-600 text-white rounded transition-colors"
          >
            {activating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              'Activate'
            )}
          </button>
        </div>
      </div>

      {/* Expanded detail view */}
      {expanded && (
        <div className="px-3 pb-2.5 pt-1 border-t border-surface-700 space-y-2">
          {/* Full description */}
          {skill.description && (
            <p className="text-[11px] text-surface-400 leading-relaxed">
              {skill.description}
            </p>
          )}

          {/* Category badge */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-surface-500">Category:</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded bg-surface-700 ${categoryColor}`}>
              {skill.category || 'general'}
            </span>
          </div>

          {/* Rules list */}
          {ruleCount > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <BookOpen className="w-3 h-3 text-surface-500" />
                <span className="text-[10px] font-medium text-surface-400">
                  Rules ({ruleCount})
                </span>
              </div>
              <div className="space-y-0.5 ml-4">
                {skill.rules.map((rule, idx) => (
                  <p key={idx} className="text-[10px] text-surface-500 leading-snug">
                    {typeof rule === 'string' ? rule : rule.content || rule.description || JSON.stringify(rule)}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Conventions preview */}
          {conventionCount > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Layers className="w-3 h-3 text-surface-500" />
                <span className="text-[10px] font-medium text-surface-400">
                  Conventions ({conventionCount})
                </span>
              </div>
              <div className="space-y-0.5 ml-4">
                {skill.conventions.slice(0, 5).map((conv, idx) => (
                  <p key={idx} className="text-[10px] text-surface-500 leading-snug truncate">
                    {typeof conv === 'string' ? conv : conv.pattern || conv.description || JSON.stringify(conv)}
                  </p>
                ))}
                {conventionCount > 5 && (
                  <p className="text-[10px] text-surface-600 italic">
                    +{conventionCount - 5} more
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Prompt templates */}
          {templateCount > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Zap className="w-3 h-3 text-surface-500" />
                <span className="text-[10px] font-medium text-surface-400">
                  Prompt Templates ({templateCount})
                </span>
              </div>
              <div className="space-y-0.5 ml-4">
                {skill.promptTemplates.map((tmpl, idx) => (
                  <div key={idx} className="flex items-center gap-1">
                    <span className="text-[10px] text-surface-400">
                      {typeof tmpl === 'string' ? tmpl : tmpl.name || tmpl.label || `Template ${idx + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick commands */}
          {commandCount > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Terminal className="w-3 h-3 text-surface-500" />
                <span className="text-[10px] font-medium text-surface-400">
                  Quick Commands ({commandCount})
                </span>
              </div>
              <div className="space-y-0.5 ml-4">
                {skill.quickCommands.map((cmd, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <code className="text-[10px] text-primary-300 bg-surface-900 px-1 py-0.5 rounded">
                      {typeof cmd === 'string' ? cmd : cmd.command || cmd.name || `cmd-${idx + 1}`}
                    </code>
                    {cmd.description && (
                      <span className="text-[10px] text-surface-500 truncate">
                        {cmd.description}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Delete button for custom/user-installed skills */}
          {!skill.builtIn && onDelete && (
            <div className="pt-1 border-t border-surface-700">
              <button
                onClick={() => onDelete(skill.id)}
                className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Uninstall skill
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Category Group ---
function CategoryGroup({ category, skills, onActivate, onDelete, activatingId }) {
  const [collapsed, setCollapsed] = useState(false);
  const CategoryIcon = getCategoryIcon(category);
  const categoryColor = getCategoryColor(category);

  return (
    <div className="mb-1">
      {/* Category header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-surface-800 transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-surface-500" />
        ) : (
          <ChevronDown className="w-3 h-3 text-surface-500" />
        )}
        <CategoryIcon className={`w-3 h-3 ${categoryColor}`} />
        <span className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">
          {category}
        </span>
        <span className="text-[10px] text-surface-600">({skills.length})</span>
      </button>

      {/* Skills in category */}
      {!collapsed && (
        <div className="py-0.5">
          {skills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onActivate={onActivate}
              onDelete={onDelete}
              activating={activatingId === skill.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Install Section ---
function InstallSection({ onInstallUrl, onInstallJson, installing }) {
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileInputRef = useRef(null);

  const handleUrlInstall = () => {
    if (!urlInput.trim()) return;
    onInstallUrl(urlInput.trim());
    setUrlInput('');
    setShowUrlInput(false);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target.result);
        onInstallJson(json);
      } catch {
        console.error('Invalid JSON file');
      }
    };
    reader.readAsText(file);

    // Reset so the same file can be re-selected
    e.target.value = '';
  };

  return (
    <div className="border-t border-surface-700 px-3 py-2 space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <Download className="w-3 h-3 text-surface-500" />
        <span className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">
          Install Skill
        </span>
      </div>

      {/* URL install */}
      {showUrlInput ? (
        <div className="flex gap-1.5">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUrlInstall()}
            placeholder="https://example.com/skill.json"
            className="flex-1 px-2 py-1 text-[11px] bg-surface-900 border border-surface-700 rounded text-surface-200 placeholder-surface-600 focus:ring-1 focus:ring-primary-500 focus:border-primary-500 outline-none"
            autoFocus
          />
          <button
            onClick={handleUrlInstall}
            disabled={installing || !urlInput.trim()}
            className="px-2 py-1 text-[10px] bg-primary-500 hover:bg-primary-600 disabled:bg-surface-600 text-white rounded transition-colors flex items-center gap-1"
          >
            {installing ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <ExternalLink className="w-3 h-3" />
                Install
              </>
            )}
          </button>
          <button
            onClick={() => {
              setShowUrlInput(false);
              setUrlInput('');
            }}
            className="p-1 hover:bg-surface-700 rounded text-surface-500"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            onClick={() => setShowUrlInput(true)}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            Install from URL
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={installing}
            className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] bg-surface-700 hover:bg-surface-600 text-surface-300 rounded transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
            Import JSON
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}

// --- Main Panel ---
export default function SkillsPanel({ projectId }) {
  const [allSkills, setAllSkills] = useState([]);
  const [activeSkillIds, setActiveSkillIds] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [activatingId, setActivatingId] = useState(null);
  const [deactivatingId, setDeactivatingId] = useState(null);
  const [installing, setInstalling] = useState(false);

  // Fetch all skills + active skills for project
  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [allRes, activeRes] = await Promise.all([
        fetch('/api/skills'),
        projectId
          ? fetch(`/api/skills/project/${projectId}`)
          : Promise.resolve(null),
      ]);

      if (!allRes.ok) throw new Error('Failed to load skills');
      const allData = await allRes.json();
      setAllSkills(allData);

      if (activeRes && activeRes.ok) {
        const activeData = await activeRes.json();
        const ids = new Set(activeData.map((s) => s.id));
        setActiveSkillIds(ids);
      } else if (!projectId) {
        setActiveSkillIds(new Set());
      }
    } catch (err) {
      setError(err.message);
      console.error('Failed to load skills:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  // Activate a skill for the project
  const activateSkill = async (skillId) => {
    if (!projectId) return;
    setActivatingId(skillId);

    // Optimistic update
    setActiveSkillIds((prev) => new Set([...prev, skillId]));

    try {
      const res = await fetch(`/api/skills/project/${projectId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      });

      if (!res.ok) {
        // Rollback
        setActiveSkillIds((prev) => {
          const next = new Set(prev);
          next.delete(skillId);
          return next;
        });
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to activate skill');
      }
    } catch (err) {
      // Rollback
      setActiveSkillIds((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
      setError(err.message);
    } finally {
      setActivatingId(null);
    }
  };

  // Deactivate a skill for the project
  const deactivateSkill = async (skillId) => {
    if (!projectId) return;
    setDeactivatingId(skillId);

    // Optimistic update
    setActiveSkillIds((prev) => {
      const next = new Set(prev);
      next.delete(skillId);
      return next;
    });

    try {
      const res = await fetch(`/api/skills/project/${projectId}/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      });

      if (!res.ok) {
        // Rollback
        setActiveSkillIds((prev) => new Set([...prev, skillId]));
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to deactivate skill');
      }
    } catch (err) {
      // Rollback
      setActiveSkillIds((prev) => new Set([...prev, skillId]));
      setError(err.message);
    } finally {
      setDeactivatingId(null);
    }
  };

  // Install from URL
  const installFromUrl = async (url) => {
    setInstalling(true);
    setError(null);

    try {
      const res = await fetch('/api/skills/install-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to install skill from URL');
      }

      // Reload to get the new skill
      await loadSkills();
    } catch (err) {
      setError(err.message);
    } finally {
      setInstalling(false);
    }
  };

  // Install from JSON
  const installFromJson = async (json) => {
    setInstalling(true);
    setError(null);

    try {
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to install skill');
      }

      await loadSkills();
    } catch (err) {
      setError(err.message);
    } finally {
      setInstalling(false);
    }
  };

  // Uninstall a user-installed skill
  const deleteSkill = async (skillId) => {
    if (!confirm('Uninstall this skill? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/skills/${skillId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to uninstall skill');
      }

      setAllSkills((prev) => prev.filter((s) => s.id !== skillId));
      setActiveSkillIds((prev) => {
        const next = new Set(prev);
        next.delete(skillId);
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  // Derived data
  const activeSkills = allSkills.filter((s) => activeSkillIds.has(s.id));
  const availableSkills = allSkills.filter((s) => !activeSkillIds.has(s.id));

  // Group available by category
  const groupedAvailable = availableSkills.reduce((acc, skill) => {
    const cat = skill.category || 'general';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(skill);
    return acc;
  }, {});

  // Sort categories: put categories with known icons first, alphabetically
  const sortedCategories = Object.keys(groupedAvailable).sort((a, b) => {
    const aKnown = a in CATEGORY_ICONS ? 0 : 1;
    const bKnown = b in CATEGORY_ICONS ? 0 : 1;
    if (aKnown !== bKnown) return aKnown - bKnown;
    return a.localeCompare(b);
  });

  // Dismiss error
  const clearError = () => setError(null);

  // No project selected
  if (!projectId) {
    return (
      <div className="flex flex-col h-full bg-surface-850">
        <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-400" />
            <span className="text-sm font-medium text-surface-200">Skills</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <Sparkles className="w-8 h-8 text-surface-600 mx-auto mb-2" />
            <p className="text-xs text-surface-500">
              Select a project first
            </p>
            <p className="text-[10px] text-surface-600 mt-1">
              Skills are activated per project
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Skills</span>
          {allSkills.length > 0 && (
            <span className="text-xs text-surface-500">({allSkills.length})</span>
          )}
        </div>
        <button
          onClick={loadSkills}
          disabled={loading}
          className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
          title="Refresh skills"
        >
          <Settings className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <span className="text-[11px] text-red-400 flex-1">{error}</span>
          <button
            onClick={clearError}
            className="p-0.5 hover:bg-red-500/20 rounded"
          >
            <X className="w-3 h-3 text-red-400" />
          </button>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        {/* Loading state */}
        {loading && allSkills.length === 0 && (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 text-surface-500 animate-spin" />
          </div>
        )}

        {/* Active Skills Section */}
        {activeSkills.length > 0 && (
          <div className="mb-1">
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-surface-700 bg-surface-800/30">
              <Check className="w-3 h-3 text-green-400" />
              <span className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">
                Active
              </span>
              <span className="text-[10px] text-green-400/70">
                ({activeSkills.length})
              </span>
            </div>
            <div className="py-0.5">
              {activeSkills.map((skill) => (
                <ActiveSkillRow
                  key={skill.id}
                  skill={skill}
                  onDeactivate={deactivateSkill}
                  deactivating={deactivatingId === skill.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Available Skills Section */}
        {sortedCategories.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-surface-700 bg-surface-800/30">
              <Plus className="w-3 h-3 text-surface-400" />
              <span className="text-[10px] font-medium text-surface-400 uppercase tracking-wider">
                Available
              </span>
              <span className="text-[10px] text-surface-600">
                ({availableSkills.length})
              </span>
            </div>

            <div className="py-0.5">
              {sortedCategories.map((category) => (
                <CategoryGroup
                  key={category}
                  category={category}
                  skills={groupedAvailable[category]}
                  onActivate={activateSkill}
                  onDelete={deleteSkill}
                  activatingId={activatingId}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && allSkills.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center p-4">
            <Sparkles className="w-8 h-8 text-surface-600 mb-2" />
            <p className="text-xs text-surface-400">No skills available</p>
            <p className="text-[10px] text-surface-500 mt-0.5">
              Install a skill below to get started
            </p>
          </div>
        )}
      </div>

      {/* Install section (always visible at bottom) */}
      <InstallSection
        onInstallUrl={installFromUrl}
        onInstallJson={installFromJson}
        installing={installing}
      />
    </div>
  );
}
