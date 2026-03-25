import { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  Plus,
  Play,
  Pause,
  Check,
  Circle,
  Clock,
  X,
  ChevronDown,
  ChevronRight,
  Trash2,
  AlertCircle,
  RefreshCw,
  Rocket,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  GitCommit,
  TestTube,
  Code,
  ListTodo,
} from 'lucide-react';

// Workflow step icons
const STEP_ICONS = {
  plan: ListTodo,
  code: Code,
  test: TestTube,
  commit: GitCommit,
};

// Status icons and colors
const STATUS_CONFIG = {
  pending: { icon: Circle, color: 'text-surface-400', bg: 'bg-surface-700' },
  planning: { icon: ListTodo, color: 'text-blue-400', bg: 'bg-blue-500/20' },
  coding: { icon: Code, color: 'text-purple-400', bg: 'bg-purple-500/20' },
  testing: { icon: TestTube, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  committing: { icon: GitCommit, color: 'text-orange-400', bg: 'bg-orange-500/20' },
  completed: { icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/20' },
  failed: { icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/20' },
  paused: { icon: Pause, color: 'text-surface-400', bg: 'bg-surface-600' },
};

const COMPLEXITY_COLORS = {
  low: 'text-green-400 bg-green-500/20',
  medium: 'text-yellow-400 bg-yellow-500/20',
  high: 'text-red-400 bg-red-500/20',
};

export default function BigProjectPanel({ projectId, projectPath, cliTool, onLaunchTerminal }) {
  const [bigProjects, setBigProjects] = useState([]);
  const [expandedProjects, setExpandedProjects] = useState({});
  const [expandedIterations, setExpandedIterations] = useState({});
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newDescription, setNewDescription] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  // Load big projects
  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', projectId);

      const res = await fetch(`/api/big-projects?${params}`);
      const data = await res.json();
      setBigProjects(data);

      // Expand first project if any
      if (data.length > 0 && Object.keys(expandedProjects).length === 0) {
        setExpandedProjects({ [data[0].id]: true });
      }
    } catch (error) {
      console.error('Failed to load big projects:', error);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Preview breakdown
  const previewBreakdown = async () => {
    if (!newDescription.trim()) return;

    try {
      setPreviewing(true);
      const res = await fetch('/api/big-projects/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newDescription.trim(),
          projectPath,
        }),
      });

      if (!res.ok) throw new Error('Failed to preview');
      const data = await res.json();
      setPreviewData(data);
    } catch (error) {
      console.error('Preview failed:', error);
      alert('Failed to generate preview: ' + error.message);
    } finally {
      setPreviewing(false);
    }
  };

  // Create project
  const createProject = async () => {
    if (!newDescription.trim()) return;

    try {
      setCreating(true);
      const res = await fetch('/api/big-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: newDescription.trim(),
          projectId,
          projectPath,
          cliTool: cliTool || 'claude',
        }),
      });

      if (!res.ok) throw new Error('Failed to create project');
      const project = await res.json();

      setBigProjects(prev => [project, ...prev]);
      setExpandedProjects(prev => ({ ...prev, [project.id]: true }));
      setNewDescription('');
      setPreviewData(null);
      setShowNewProject(false);
    } catch (error) {
      console.error('Create failed:', error);
      alert('Failed to create project: ' + error.message);
    } finally {
      setCreating(false);
    }
  };

  // Start/resume project
  const startProject = async (id) => {
    try {
      const res = await fetch(`/api/big-projects/${id}/start`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Failed to start');
      const result = await res.json();

      // Update local state
      setBigProjects(prev =>
        prev.map(p => (p.id === id ? { ...result.project, progress: p.progress } : p))
      );

      // Launch terminal with the iteration prompt
      if (onLaunchTerminal && result.prompt) {
        onLaunchTerminal({
          prompt: result.prompt,
          projectId: result.project.projectId,
          bigProjectId: id,
          iterationId: result.nextIteration?.id,
        });
      }
    } catch (error) {
      console.error('Start failed:', error);
      alert('Failed to start: ' + error.message);
    }
  };

  // Pause project
  const pauseProject = async (id) => {
    try {
      const res = await fetch(`/api/big-projects/${id}/pause`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Failed to pause');
      const project = await res.json();

      setBigProjects(prev => prev.map(p => (p.id === id ? { ...project, progress: p.progress } : p)));
    } catch (error) {
      console.error('Pause failed:', error);
    }
  };

  // Start specific iteration
  const startIteration = async (projectId, iterationId) => {
    try {
      const res = await fetch(`/api/big-projects/${projectId}/iterations/${iterationId}/start`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Failed to start iteration');
      const result = await res.json();

      // Update local state
      setBigProjects(prev =>
        prev.map(p => (p.id === projectId ? result.project : p))
      );

      // Launch terminal with the iteration prompt
      if (onLaunchTerminal && result.prompt) {
        onLaunchTerminal({
          prompt: result.prompt,
          projectId: result.project.projectId,
          bigProjectId: projectId,
          iterationId: iterationId,
          workflowStep: result.workflowStep,
        });
      }
    } catch (error) {
      console.error('Start iteration failed:', error);
      alert('Failed to start iteration: ' + error.message);
    }
  };

  // Advance workflow
  const advanceWorkflow = async (projectId, iterationId, notes = '') => {
    try {
      const res = await fetch(`/api/big-projects/${projectId}/iterations/${iterationId}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });

      if (!res.ok) throw new Error('Failed to advance');
      const result = await res.json();

      setBigProjects(prev =>
        prev.map(p => (p.id === projectId ? result.project : p))
      );

      // Launch terminal with next step prompt
      if (onLaunchTerminal && result.prompt) {
        onLaunchTerminal({
          prompt: result.prompt,
          projectId: result.project.projectId,
          bigProjectId: projectId,
          iterationId: iterationId,
          workflowStep: result.workflowStep,
        });
      }

      return result;
    } catch (error) {
      console.error('Advance failed:', error);
      alert('Failed to advance: ' + error.message);
    }
  };

  // Complete iteration
  const completeIteration = async (projectId, iterationId) => {
    try {
      const res = await fetch(`/api/big-projects/${projectId}/iterations/${iterationId}/complete`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Failed to complete');
      const result = await res.json();

      setBigProjects(prev =>
        prev.map(p => (p.id === projectId ? result.project : p))
      );

      // If there's a next iteration, optionally start it
      if (result.nextIteration && !result.isProjectComplete) {
        const shouldContinue = confirm(
          `Iteration completed! Start next iteration: "${result.nextIteration.title}"?`
        );
        if (shouldContinue) {
          await startIteration(projectId, result.nextIteration.id);
        }
      } else if (result.isProjectComplete) {
        alert('Project completed successfully!');
      }
    } catch (error) {
      console.error('Complete failed:', error);
    }
  };

  // Retry failed iteration
  const retryIteration = async (projectId, iterationId) => {
    try {
      const res = await fetch(`/api/big-projects/${projectId}/iterations/${iterationId}/retry`, {
        method: 'POST',
      });

      if (!res.ok) throw new Error('Failed to retry');
      const result = await res.json();

      setBigProjects(prev =>
        prev.map(p => (p.id === projectId ? result.project : p))
      );

      if (onLaunchTerminal && result.prompt) {
        onLaunchTerminal({
          prompt: result.prompt,
          projectId: result.project.projectId,
          bigProjectId: projectId,
          iterationId: iterationId,
        });
      }
    } catch (error) {
      console.error('Retry failed:', error);
    }
  };

  // Delete project
  const deleteProject = async (id) => {
    if (!confirm('Delete this big project? This cannot be undone.')) return;

    try {
      await fetch(`/api/big-projects/${id}`, { method: 'DELETE' });
      setBigProjects(prev => prev.filter(p => p.id !== id));
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  // Render workflow steps
  const renderWorkflowSteps = (iteration) => {
    const steps = ['plan', 'code', 'test', 'commit'];
    const currentIdx = iteration.workflowStep ? steps.indexOf(iteration.workflowStep) : -1;

    return (
      <div className="flex items-center gap-1 mt-2">
        {steps.map((step, idx) => {
          const StepIcon = STEP_ICONS[step];
          const isComplete = currentIdx > idx;
          const isCurrent = currentIdx === idx;
          const isPending = currentIdx < idx;

          return (
            <div key={step} className="flex items-center">
              <div
                className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] ${
                  isComplete
                    ? 'bg-green-500/20 text-green-400'
                    : isCurrent
                    ? 'bg-primary-500/20 text-primary-400'
                    : 'bg-surface-700 text-surface-500'
                }`}
              >
                <StepIcon className="w-3 h-3" />
                <span className="capitalize">{step}</span>
              </div>
              {idx < steps.length - 1 && (
                <ArrowRight className={`w-3 h-3 mx-0.5 ${
                  isComplete ? 'text-green-400' : 'text-surface-600'
                }`} />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Big Projects</span>
          <span className="text-xs text-surface-500">({bigProjects.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => loadProjects()}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowNewProject(true)}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            title="New big project"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* New Project Form */}
      {showNewProject && (
        <div className="p-3 border-b border-surface-700 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-surface-300">New Big Project</span>
            <button
              onClick={() => {
                setShowNewProject(false);
                setNewDescription('');
                setPreviewData(null);
              }}
              className="p-1 hover:bg-surface-700 rounded text-surface-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <textarea
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Describe your project in detail. List features, requirements, and any technical specifications..."
            className="w-full h-32 px-2 py-2 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-primary-500 resize-none"
          />

          <div className="flex gap-2">
            <button
              onClick={previewBreakdown}
              disabled={previewing || !newDescription.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface-700 hover:bg-surface-600 disabled:opacity-50 text-surface-200 rounded transition-colors"
            >
              {previewing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <FileText className="w-3 h-3" />
              )}
              Preview
            </button>
            <button
              onClick={createProject}
              disabled={creating || !newDescription.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 disabled:opacity-50 text-white rounded transition-colors"
            >
              {creating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Rocket className="w-3 h-3" />
              )}
              Create
            </button>
          </div>

          {/* Preview */}
          {previewData && (
            <div className="mt-3 p-3 bg-surface-800 rounded border border-surface-700">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-surface-200">
                  {previewData.projectTitle}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  COMPLEXITY_COLORS[previewData.estimatedComplexity] || 'text-surface-400 bg-surface-700'
                }`}>
                  {previewData.estimatedComplexity} complexity
                </span>
              </div>
              <p className="text-[11px] text-surface-400 mb-2">{previewData.projectSummary}</p>
              <div className="text-[10px] text-surface-500">
                {previewData.totalIterations} iterations planned
              </div>
              <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                {previewData.iterations?.map((iter, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[10px]">
                    <span className="w-4 h-4 flex items-center justify-center bg-surface-700 rounded text-surface-400">
                      {iter.order}
                    </span>
                    <span className="text-surface-300">{iter.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto">
        {bigProjects.map((project) => {
          const isExpanded = expandedProjects[project.id];
          const statusConfig = STATUS_CONFIG[project.status] || STATUS_CONFIG.pending;
          const StatusIcon = statusConfig.icon;
          const progress = project.progress || { percentComplete: 0 };

          return (
            <div key={project.id} className="border-b border-surface-700">
              {/* Project Header */}
              <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-800 transition-colors">
                <button
                  onClick={() =>
                    setExpandedProjects(prev => ({
                      ...prev,
                      [project.id]: !prev[project.id],
                    }))
                  }
                  className="flex-shrink-0"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3 h-3 text-surface-500" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-surface-500" />
                  )}
                </button>

                <div className={`p-1 rounded ${statusConfig.bg}`}>
                  <StatusIcon className={`w-3 h-3 ${statusConfig.color}`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-surface-200 truncate">
                      {project.title}
                    </span>
                    <span className={`text-[9px] px-1 py-0.5 rounded ${
                      COMPLEXITY_COLORS[project.estimatedComplexity] || ''
                    }`}>
                      {project.estimatedComplexity}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1 bg-surface-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 transition-all"
                        style={{ width: `${progress.percentComplete}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-surface-500">
                      {progress.completed || 0}/{project.totalIterations}
                    </span>
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1">
                  {project.isRunning ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        pauseProject(project.id);
                      }}
                      className="p-1.5 hover:bg-yellow-500/20 rounded text-yellow-400"
                      title="Pause"
                    >
                      <Pause className="w-3 h-3" />
                    </button>
                  ) : project.status !== 'completed' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startProject(project.id);
                      }}
                      className="p-1.5 hover:bg-green-500/20 rounded text-green-400"
                      title="Start/Resume"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteProject(project.id);
                    }}
                    className="p-1 opacity-0 hover:opacity-100 hover:bg-red-500/20 rounded transition-opacity"
                    title="Delete"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </div>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-[11px] text-surface-400 pl-6">
                    {project.summary}
                  </p>

                  {/* Iterations */}
                  <div className="pl-6 space-y-2">
                    {project.iterations?.map((iteration) => {
                      const iterStatus = STATUS_CONFIG[iteration.status] || STATUS_CONFIG.pending;
                      const IterIcon = iterStatus.icon;
                      const isIterExpanded = expandedIterations[iteration.id];

                      return (
                        <div
                          key={iteration.id}
                          className={`bg-surface-800 rounded border ${
                            iteration.status === 'failed'
                              ? 'border-red-500/30'
                              : 'border-surface-700'
                          }`}
                        >
                          {/* Iteration Header */}
                          <div
                            className="flex items-center gap-2 p-2 cursor-pointer hover:bg-surface-750"
                            onClick={() =>
                              setExpandedIterations(prev => ({
                                ...prev,
                                [iteration.id]: !prev[iteration.id],
                              }))
                            }
                          >
                            <button className="flex-shrink-0">
                              {isIterExpanded ? (
                                <ChevronDown className="w-3 h-3 text-surface-500" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-surface-500" />
                              )}
                            </button>

                            <span className="w-5 h-5 flex items-center justify-center bg-surface-700 rounded text-[10px] text-surface-400">
                              {iteration.order}
                            </span>

                            <IterIcon className={`w-3.5 h-3.5 ${iterStatus.color}`} />

                            <span className="flex-1 text-xs text-surface-200 truncate">
                              {iteration.title}
                            </span>

                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${iterStatus.bg} ${iterStatus.color}`}>
                              {iteration.status}
                            </span>

                            {/* Iteration actions */}
                            {iteration.status === 'pending' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startIteration(project.id, iteration.id);
                                }}
                                className="p-1 hover:bg-green-500/20 rounded text-green-400"
                                title="Start iteration"
                              >
                                <Play className="w-3 h-3" />
                              </button>
                            )}

                            {iteration.status === 'failed' && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  retryIteration(project.id, iteration.id);
                                }}
                                className="p-1 hover:bg-yellow-500/20 rounded text-yellow-400"
                                title="Retry iteration"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                            )}

                            {['planning', 'coding', 'testing', 'committing'].includes(iteration.status) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  advanceWorkflow(project.id, iteration.id);
                                }}
                                className="p-1 hover:bg-primary-500/20 rounded text-primary-400"
                                title="Advance to next step"
                              >
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>

                          {/* Iteration Details */}
                          {isIterExpanded && (
                            <div className="px-3 pb-3 pt-1 border-t border-surface-700 space-y-2">
                              <p className="text-[11px] text-surface-400">
                                {iteration.description}
                              </p>

                              {/* Workflow steps */}
                              {iteration.status !== 'pending' &&
                                iteration.status !== 'completed' &&
                                renderWorkflowSteps(iteration)}

                              {/* Tasks */}
                              <div>
                                <span className="text-[10px] font-medium text-surface-500 uppercase">
                                  Tasks
                                </span>
                                <ul className="mt-1 space-y-0.5">
                                  {iteration.tasks?.map((task, idx) => (
                                    <li
                                      key={idx}
                                      className="flex items-start gap-1.5 text-[11px] text-surface-300"
                                    >
                                      <Circle className="w-2 h-2 mt-1 text-surface-500" />
                                      {task}
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              {/* Acceptance Criteria */}
                              <div>
                                <span className="text-[10px] font-medium text-surface-500 uppercase">
                                  Acceptance Criteria
                                </span>
                                <ul className="mt-1 space-y-0.5">
                                  {iteration.acceptanceCriteria?.map((criteria, idx) => (
                                    <li
                                      key={idx}
                                      className="flex items-start gap-1.5 text-[11px] text-surface-300"
                                    >
                                      <Check className="w-2 h-2 mt-1 text-surface-500" />
                                      {criteria}
                                    </li>
                                  ))}
                                </ul>
                              </div>

                              {/* Action buttons */}
                              {['planning', 'coding', 'testing'].includes(iteration.status) && (
                                <div className="flex items-center gap-2 pt-2">
                                  <button
                                    onClick={() => advanceWorkflow(project.id, iteration.id)}
                                    className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-primary-500 hover:bg-primary-600 text-white rounded"
                                  >
                                    <ArrowRight className="w-3 h-3" />
                                    Next Step
                                  </button>
                                </div>
                              )}

                              {iteration.status === 'committing' && (
                                <div className="flex items-center gap-2 pt-2">
                                  <button
                                    onClick={() => completeIteration(project.id, iteration.id)}
                                    className="flex items-center gap-1.5 px-2 py-1 text-[10px] bg-green-500 hover:bg-green-600 text-white rounded"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    Complete Iteration
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Technical Notes */}
                  {project.technicalNotes && (
                    <div className="pl-6 mt-2">
                      <span className="text-[10px] font-medium text-surface-500">
                        Technical Notes
                      </span>
                      <p className="text-[11px] text-surface-400 mt-0.5">
                        {project.technicalNotes}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty State */}
        {bigProjects.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-40 text-center p-4">
            <Layers className="w-10 h-10 text-surface-600 mb-3" />
            <p className="text-sm text-surface-400">No big projects yet</p>
            <p className="text-xs text-surface-500 mt-1 max-w-[200px]">
              Create a big project to break down complex tasks into manageable iterations
            </p>
            <button
              onClick={() => setShowNewProject(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 mt-3 text-xs bg-primary-500 hover:bg-primary-600 text-white rounded transition-colors"
            >
              <Plus className="w-3 h-3" />
              New Big Project
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && bigProjects.length === 0 && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 text-primary-400 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
