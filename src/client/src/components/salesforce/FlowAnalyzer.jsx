import { useState, useEffect, useMemo } from 'react';
import { GitBranch, Search, Loader, BarChart3, Users, Sparkles, Filter, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

export default function FlowAnalyzer({ projectId, connection }) {
  const [tab, setTab] = useState('inventory'); // inventory | search | tasks
  const [flows, setFlows] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filters
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [expandedFlow, setExpandedFlow] = useState(null);

  // Task search
  const [assignee, setAssignee] = useState('');
  const [taskResults, setTaskResults] = useState(null);
  const [taskLoading, setTaskLoading] = useState(false);

  // AI explain
  const [aiExplaining, setAiExplaining] = useState(null);
  const [aiExplanation, setAiExplanation] = useState(null);

  useEffect(() => {
    if (connection?.connected) loadFlows();
  }, [connection?.connected]);

  const loadFlows = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/salesforce/flows/counts?projectId=${projectId}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Failed to load flows');
      setCounts(data.data.counts);
      setFlows(data.data.flows || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const searchTasks = async () => {
    if (!assignee.trim()) return;
    setTaskLoading(true);
    setTaskResults(null);
    setError(null);
    try {
      const res = await fetch('/api/salesforce/flows/task-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, assignee }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Search failed');
      setTaskResults(data.data);
    } catch (err) {
      setError(err.message);
    }
    setTaskLoading(false);
  };

  const explainFlow = async (flow) => {
    setAiExplaining(flow.Id);
    setAiExplanation(null);
    try {
      const res = await fetch('/api/salesforce/flows/ai-explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          flowName: flow.DeveloperName,
          flowMetadata: {
            label: flow.MasterLabel,
            processType: flow.ProcessType,
            isActive: !!(flow.IsActive || flow.ActiveVersionId),
            description: flow.Description,
            lastModified: flow.LastModifiedDate,
            lastModifiedBy: flow.LastModifiedBy?.Name,
          },
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error?.message || 'Explanation failed');
      setAiExplanation({ flowId: flow.Id, text: data.data.explanation });
    } catch (err) {
      setError(err.message);
    }
    setAiExplaining(null);
  };

  const filteredFlows = useMemo(() => {
    let list = flows;
    if (statusFilter === 'active') list = list.filter((f) => f.IsActive || f.ActiveVersionId);
    else if (statusFilter === 'inactive') list = list.filter((f) => !f.IsActive && !f.ActiveVersionId);

    if (typeFilter !== 'all') list = list.filter((f) => f.ProcessType === typeFilter);

    if (filter) {
      const q = filter.toLowerCase();
      list = list.filter((f) =>
        f.DeveloperName?.toLowerCase().includes(q) || f.MasterLabel?.toLowerCase().includes(q) || f.Description?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [flows, filter, statusFilter, typeFilter]);

  const processTypes = useMemo(() => [...new Set(flows.map((f) => f.ProcessType).filter(Boolean))], [flows]);

  if (!connection?.connected) {
    return <div className="p-6 text-surface-500">Connect to a Salesforce org to analyze flows.</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-surface-700">
        <div className="flex items-center gap-2 mb-4">
          <GitBranch size={18} className="text-sky-400" />
          <h2 className="text-lg font-semibold">Flow Analyzer</h2>
          <button onClick={loadFlows} className="ml-auto p-1.5 hover:bg-surface-700 rounded" title="Refresh">
            <RefreshCw size={14} className="text-surface-400" />
          </button>
        </div>

        {/* Counts */}
        {counts && (
          <div className="flex gap-3 mb-4">
            <div className="bg-surface-800 rounded-lg px-4 py-2.5 flex-1 text-center">
              <div className="text-2xl font-bold text-surface-200">{counts.total}</div>
              <div className="text-xs text-surface-500">Total</div>
            </div>
            <div className="bg-emerald-500/10 rounded-lg px-4 py-2.5 flex-1 text-center">
              <div className="text-2xl font-bold text-emerald-400">{counts.active}</div>
              <div className="text-xs text-emerald-400/60">Active</div>
            </div>
            <div className="bg-surface-800 rounded-lg px-4 py-2.5 flex-1 text-center">
              <div className="text-2xl font-bold text-surface-400">{counts.inactive}</div>
              <div className="text-xs text-surface-500">Inactive</div>
            </div>
            {Object.entries(counts.byProcessType || {}).slice(0, 4).map(([type, count]) => (
              <div key={type} className="bg-surface-800 rounded-lg px-4 py-2.5 flex-1 text-center">
                <div className="text-2xl font-bold text-violet-300">{count}</div>
                <div className="text-xs text-surface-500 truncate">{type}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-surface-800 rounded-lg p-1">
          <button onClick={() => setTab('inventory')} className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${tab === 'inventory' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}>
            <BarChart3 size={14} className="inline mr-1.5" /> Inventory
          </button>
          <button onClick={() => setTab('tasks')} className={`flex-1 py-1.5 px-3 rounded text-sm font-medium transition-colors ${tab === 'tasks' ? 'bg-sky-500/20 text-sky-300' : 'text-surface-400 hover:text-surface-200'}`}>
            <Users size={14} className="inline mr-1.5" /> Task Assignments
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-8 flex items-center justify-center"><Loader size={20} className="animate-spin text-surface-400" /></div>
        ) : tab === 'inventory' ? (
          <div>
            {/* Filters */}
            <div className="p-3 border-b border-surface-700 flex gap-2 items-center flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search size={14} className="absolute left-2.5 top-2 text-surface-500" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Search flows..."
                  className="w-full bg-surface-800 border border-surface-600 rounded pl-8 pr-3 py-1.5 text-xs text-surface-200 placeholder-surface-600"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-surface-800 border border-surface-600 rounded px-2 py-1.5 text-xs text-surface-200"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-surface-800 border border-surface-600 rounded px-2 py-1.5 text-xs text-surface-200"
              >
                <option value="all">All Types</option>
                {processTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-xs text-surface-500">{filteredFlows.length} flow(s)</span>
            </div>

            {/* Flow list */}
            {filteredFlows.map((flow) => {
              const isActive = !!(flow.IsActive || flow.ActiveVersionId);
              const isExpanded = expandedFlow === flow.Id;
              const explanation = aiExplanation?.flowId === flow.Id ? aiExplanation.text : null;

              return (
                <div key={flow.Id} className="border-b border-surface-800">
                  <button
                    onClick={() => setExpandedFlow(isExpanded ? null : flow.Id)}
                    className="w-full text-left px-4 py-3 hover:bg-surface-800/50 transition-colors flex items-center gap-3"
                  >
                    {isExpanded ? <ChevronDown size={14} className="text-surface-500" /> : <ChevronRight size={14} className="text-surface-500" />}
                    <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-emerald-400' : 'bg-surface-600'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-surface-200 truncate">{flow.MasterLabel || flow.DeveloperName}</div>
                      <div className="text-xs text-surface-500">{flow.DeveloperName}</div>
                    </div>
                    <span className="text-xs text-violet-300 shrink-0">{flow.ProcessType}</span>
                    {flow.LastModifiedDate && (
                      <span className="text-xs text-surface-600 shrink-0">{new Date(flow.LastModifiedDate).toLocaleDateString()}</span>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-4 pb-3 pl-10 space-y-2">
                      <div className="grid grid-cols-2 gap-2 text-xs text-surface-400">
                        <div><span className="text-surface-600">Status:</span> {isActive ? 'Active' : 'Inactive'}</div>
                        <div><span className="text-surface-600">Type:</span> {flow.ProcessType}</div>
                        {flow.LastModifiedBy?.Name && <div><span className="text-surface-600">Modified by:</span> {flow.LastModifiedBy.Name}</div>}
                        {flow.Description && <div className="col-span-2"><span className="text-surface-600">Description:</span> {flow.Description}</div>}
                      </div>

                      <button
                        onClick={() => explainFlow(flow)}
                        disabled={aiExplaining === flow.Id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded text-xs transition-colors"
                      >
                        {aiExplaining === flow.Id ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                        Explain this flow
                      </button>

                      {explanation && (
                        <div className="bg-surface-800 rounded p-3 text-xs text-surface-300 whitespace-pre-wrap">{explanation}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredFlows.length === 0 && !loading && (
              <div className="p-8 text-center text-sm text-surface-500">No flows match your filters.</div>
            )}
          </div>
        ) : tab === 'tasks' ? (
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-surface-200">Find flows that assign tasks to a specific user, queue, or role</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={assignee}
                  onChange={(e) => setAssignee(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchTasks()}
                  placeholder="Enter user name, queue name, or role..."
                  className="flex-1 bg-surface-800 border border-surface-600 rounded-lg px-3 py-2 text-sm text-surface-200 placeholder-surface-600"
                />
                <button
                  onClick={searchTasks}
                  disabled={!assignee.trim() || taskLoading}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:bg-surface-700 disabled:text-surface-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                >
                  {taskLoading ? <Loader size={14} className="animate-spin" /> : <Search size={14} />}
                  Search
                </button>
              </div>
            </div>

            {taskResults && (
              <div className="space-y-3">
                <div className="text-sm text-surface-400">
                  Found {taskResults.matchingFlows?.length || 0} flow(s) matching "{taskResults.assignee}" out of {taskResults.totalFlowsSearched} active flows searched.
                </div>

                {taskResults.matchingFlows?.map((flow) => (
                  <div key={flow.id} className="bg-surface-800 rounded-lg p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${flow.isActive ? 'bg-emerald-400' : 'bg-surface-600'}`} />
                      <span className="text-sm font-medium text-surface-200">{flow.label || flow.name}</span>
                      <span className="text-xs text-violet-300">{flow.processType}</span>
                    </div>
                    <div className="text-xs text-surface-500">{flow.name}</div>
                    {flow.matchReason && <div className="text-xs text-sky-400">{flow.matchReason}</div>}
                    {flow.lastModifiedBy && <div className="text-xs text-surface-600">Modified by {flow.lastModifiedBy} on {new Date(flow.lastModified).toLocaleDateString()}</div>}
                  </div>
                ))}

                {taskResults.matchingFlows?.length === 0 && (
                  <div className="text-sm text-surface-500">No flows found assigning tasks to "{taskResults.assignee}".</div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {error && (
        <div className="p-3 border-t border-red-500/30 bg-red-500/10 text-sm text-red-300">{error}</div>
      )}
    </div>
  );
}
