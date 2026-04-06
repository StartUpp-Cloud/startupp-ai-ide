import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Puzzle, Download, Trash2, Check, X, ExternalLink, ChevronDown, ChevronRight,
  Search, Filter, Package, Globe, Code, Zap, Shield, Database, Server, Wrench,
} from 'lucide-react';

const CATEGORY_ICONS = {
  testing: Zap,
  deployment: Server,
  database: Database,
  framework: Code,
  security: Shield,
  devops: Server,
  general: Puzzle,
};

const CATEGORY_COLORS = {
  testing: 'text-yellow-400',
  deployment: 'text-blue-400',
  database: 'text-purple-400',
  framework: 'text-green-400',
  security: 'text-red-400',
  devops: 'text-orange-400',
  general: 'text-surface-400',
};

export default function Skills() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [installUrl, setInstallUrl] = useState('');
  const [installError, setInstallError] = useState(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [expandedSkill, setExpandedSkill] = useState(null);
  const [projectSkills, setProjectSkills] = useState({}); // projectId -> [skillIds]

  // Load skills and projects
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [skillsRes, projectsRes] = await Promise.all([
          fetch('/api/skills'),
          fetch('/api/projects'),
        ]);
        const skillsData = await skillsRes.json();
        const projectsData = await projectsRes.json();

        setSkills(Array.isArray(skillsData) ? skillsData : []);
        setProjects(Array.isArray(projectsData) ? projectsData : []);

        // Build project -> active skills map
        const psMap = {};
        for (const p of projectsData) {
          psMap[p.id] = p.activeSkills || [];
        }
        setProjectSkills(psMap);
      } catch (err) {
        console.error('Failed to load skills:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  // Toggle skill for a project
  const toggleSkillForProject = useCallback(async (projectId, skillId, currentlyActive) => {
    const endpoint = currentlyActive ? 'deactivate' : 'activate';
    try {
      await fetch(`/api/skills/project/${projectId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      });

      setProjectSkills(prev => {
        const current = prev[projectId] || [];
        return {
          ...prev,
          [projectId]: currentlyActive
            ? current.filter(id => id !== skillId)
            : [...current, skillId],
        };
      });
    } catch (err) {
      console.error('Failed to toggle skill:', err);
    }
  }, []);

  // Install from URL
  const handleInstall = async () => {
    if (!installUrl.trim()) return;
    setInstalling(true);
    setInstallError(null);

    try {
      const res = await fetch('/api/skills/install-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: installUrl.trim() }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to install skill');
      }

      const newSkill = await res.json();
      setSkills(prev => [...prev, newSkill]);
      setInstallUrl('');
      setShowInstallModal(false);
    } catch (err) {
      setInstallError(err.message);
    } finally {
      setInstalling(false);
    }
  };

  // Uninstall skill
  const handleUninstall = async (skillId) => {
    if (!confirm('Uninstall this skill? It will be removed from all projects.')) return;

    try {
      const res = await fetch(`/api/skills/${skillId}`, { method: 'DELETE' });
      if (res.ok) {
        setSkills(prev => prev.filter(s => s.id !== skillId));
        // Also remove from project skills map
        setProjectSkills(prev => {
          const updated = { ...prev };
          for (const pid of Object.keys(updated)) {
            updated[pid] = updated[pid].filter(id => id !== skillId);
          }
          return updated;
        });
      }
    } catch (err) {
      console.error('Failed to uninstall skill:', err);
    }
  };

  // Filter skills
  const filteredSkills = skills.filter(skill => {
    const matchSearch = !search ||
      skill.name.toLowerCase().includes(search.toLowerCase()) ||
      skill.description?.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || skill.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const categories = ['all', ...new Set(skills.map(s => s.category || 'general'))];

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-900 flex items-center justify-center text-surface-500">
        Loading skills...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-900 text-surface-200">
      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 rounded-lg hover:bg-surface-800 text-surface-400 hover:text-surface-200"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <h1 className="text-xl font-display font-bold flex items-center gap-2">
                <Puzzle size={20} className="text-primary-400" />
                Skills Manager
              </h1>
              <p className="text-xs text-surface-500">
                Install and manage skills for your projects
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowInstallModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-primary-500 hover:bg-primary-600 text-surface-950 rounded-lg text-sm font-medium transition-colors"
          >
            <Download size={14} />
            Install Skill
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-6">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search skills..."
              className="w-full bg-surface-800 border border-surface-700 rounded-lg pl-9 pr-3 py-2 text-sm text-surface-200 outline-none focus:border-primary-500/50"
            />
          </div>

          <div className="flex items-center gap-1.5 bg-surface-800 rounded-lg p-1 border border-surface-700">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded text-xs capitalize transition-colors ${
                  categoryFilter === cat
                    ? 'bg-primary-500/20 text-primary-300'
                    : 'text-surface-400 hover:text-surface-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Skills Grid */}
        <div className="space-y-3">
          {filteredSkills.length === 0 ? (
            <div className="text-center py-12 text-surface-500">
              {search || categoryFilter !== 'all' ? 'No skills match your filters' : 'No skills installed yet'}
            </div>
          ) : (
            filteredSkills.map(skill => {
              const CategoryIcon = CATEGORY_ICONS[skill.category] || Puzzle;
              const categoryColor = CATEGORY_COLORS[skill.category] || 'text-surface-400';
              const isExpanded = expandedSkill === skill.id;

              return (
                <div
                  key={skill.id}
                  className="bg-surface-850 rounded-xl border border-surface-700 overflow-hidden"
                >
                  {/* Skill header */}
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-surface-800/50 transition-colors"
                    onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                  >
                    <div className={`p-2 rounded-lg bg-surface-800 ${categoryColor}`}>
                      <CategoryIcon size={16} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold truncate">{skill.name}</h3>
                        {skill.builtIn && (
                          <span className="px-1.5 py-0.5 bg-surface-700 text-surface-400 text-[9px] uppercase rounded">
                            Built-in
                          </span>
                        )}
                        <span className="text-[10px] text-surface-500">v{skill.version}</span>
                      </div>
                      <p className="text-xs text-surface-500 truncate">{skill.description}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Quick project toggles */}
                      <div className="flex items-center gap-1">
                        {projects.slice(0, 3).map(project => {
                          const isActive = (projectSkills[project.id] || []).includes(skill.id);
                          return (
                            <button
                              key={project.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSkillForProject(project.id, skill.id, isActive);
                              }}
                              title={`${isActive ? 'Deactivate' : 'Activate'} for ${project.name}`}
                              className={`w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold transition-colors ${
                                isActive
                                  ? 'bg-primary-500/20 text-primary-300 border border-primary-500/30'
                                  : 'bg-surface-700/50 text-surface-500 hover:text-surface-300 border border-surface-700'
                              }`}
                            >
                              {project.name.charAt(0).toUpperCase()}
                            </button>
                          );
                        })}
                        {projects.length > 3 && (
                          <span className="text-[10px] text-surface-500">+{projects.length - 3}</span>
                        )}
                      </div>

                      {!skill.builtIn && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUninstall(skill.id);
                          }}
                          className="p-1.5 text-surface-500 hover:text-red-400 rounded hover:bg-surface-700 transition-colors"
                          title="Uninstall"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}

                      {isExpanded ? <ChevronDown size={16} className="text-surface-500" /> : <ChevronRight size={16} className="text-surface-500" />}
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-surface-700 p-4 bg-surface-800/30">
                      <div className="grid grid-cols-2 gap-6">
                        {/* Left: Rules & Conventions */}
                        <div className="space-y-4">
                          {skill.rules && skill.rules.length > 0 && (
                            <div>
                              <h4 className="text-[10px] uppercase text-surface-500 mb-2">Rules</h4>
                              <ul className="space-y-1">
                                {skill.rules.map((rule, i) => (
                                  <li key={i} className="text-xs text-surface-300 flex items-start gap-2">
                                    <span className="text-primary-400 mt-0.5">•</span>
                                    {rule}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {skill.conventions && (
                            <div>
                              <h4 className="text-[10px] uppercase text-surface-500 mb-2">Conventions</h4>
                              <p className="text-xs text-surface-400 whitespace-pre-wrap">{skill.conventions}</p>
                            </div>
                          )}
                        </div>

                        {/* Right: Project toggles */}
                        <div>
                          <h4 className="text-[10px] uppercase text-surface-500 mb-2">Enable for Projects</h4>
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {projects.map(project => {
                              const isActive = (projectSkills[project.id] || []).includes(skill.id);
                              return (
                                <button
                                  key={project.id}
                                  onClick={() => toggleSkillForProject(project.id, skill.id, isActive)}
                                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                                    isActive
                                      ? 'bg-primary-500/10 border border-primary-500/30 text-primary-300'
                                      : 'bg-surface-700/30 border border-surface-700 text-surface-400 hover:text-surface-200'
                                  }`}
                                >
                                  <span className="truncate">{project.name}</span>
                                  {isActive ? <Check size={14} /> : <X size={14} className="opacity-30" />}
                                </button>
                              );
                            })}
                            {projects.length === 0 && (
                              <p className="text-xs text-surface-500">No projects available</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Quick commands & templates */}
                      {(skill.quickCommands?.length > 0 || skill.promptTemplates?.length > 0) && (
                        <div className="mt-4 pt-4 border-t border-surface-700 grid grid-cols-2 gap-4">
                          {skill.quickCommands?.length > 0 && (
                            <div>
                              <h4 className="text-[10px] uppercase text-surface-500 mb-2">Quick Commands</h4>
                              <div className="flex flex-wrap gap-1.5">
                                {skill.quickCommands.map((cmd, i) => (
                                  <span key={i} className="px-2 py-1 bg-surface-700 text-surface-300 text-[10px] rounded font-mono">
                                    /{cmd.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {skill.promptTemplates?.length > 0 && (
                            <div>
                              <h4 className="text-[10px] uppercase text-surface-500 mb-2">Prompt Templates</h4>
                              <div className="flex flex-wrap gap-1.5">
                                {skill.promptTemplates.map((tmpl, i) => (
                                  <span key={i} className="px-2 py-1 bg-surface-700 text-surface-300 text-[10px] rounded">
                                    {tmpl.name}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Meta */}
                      <div className="mt-4 pt-3 border-t border-surface-700 flex items-center gap-4 text-[10px] text-surface-500">
                        <span>Author: {skill.author || 'Unknown'}</span>
                        <span>Category: {skill.category || 'general'}</span>
                        {skill.installedAt && <span>Installed: {new Date(skill.installedAt).toLocaleDateString()}</span>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Built-in skills notice */}
        <div className="mt-8 p-4 bg-surface-850 rounded-xl border border-surface-700">
          <div className="flex items-start gap-3">
            <Package size={16} className="text-surface-500 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-surface-300">About Skills</h3>
              <p className="text-xs text-surface-500 mt-1">
                Skills extend AI capabilities with custom rules, conventions, and commands.
                Built-in skills cannot be uninstalled. Install custom skills from URLs pointing to JSON skill files.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Install Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-850 rounded-xl border border-surface-700 w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-4 border-b border-surface-700">
              <h2 className="text-sm font-semibold flex items-center gap-2">
                <Download size={16} className="text-primary-400" />
                Install Skill from URL
              </h2>
              <button
                onClick={() => { setShowInstallModal(false); setInstallError(null); }}
                className="p-1 text-surface-500 hover:text-surface-200 rounded"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="text-[11px] text-surface-500 uppercase mb-1 block">Skill JSON URL</label>
                <input
                  type="url"
                  value={installUrl}
                  onChange={e => setInstallUrl(e.target.value)}
                  placeholder="https://example.com/skill.json"
                  className="w-full bg-surface-800 border border-surface-700 rounded-lg px-3 py-2 text-sm text-surface-200 outline-none focus:border-primary-500/50"
                  disabled={installing}
                />
              </div>

              {installError && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-300">
                  {installError}
                </div>
              )}

              <div className="text-xs text-surface-500">
                <p className="mb-2">The URL should point to a JSON file with the skill definition:</p>
                <pre className="bg-surface-800 p-2 rounded text-[10px] overflow-x-auto">
{`{
  "name": "My Skill",
  "description": "What this skill does",
  "version": "1.0.0",
  "category": "general",
  "rules": ["Rule 1", "Rule 2"]
}`}
                </pre>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-4 border-t border-surface-700">
              <button
                onClick={() => { setShowInstallModal(false); setInstallError(null); }}
                className="px-3 py-1.5 text-sm text-surface-400 hover:text-surface-200"
              >
                Cancel
              </button>
              <button
                onClick={handleInstall}
                disabled={installing || !installUrl.trim()}
                className="flex items-center gap-2 px-4 py-1.5 bg-primary-500 hover:bg-primary-600 text-surface-950 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {installing ? 'Installing...' : 'Install'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
