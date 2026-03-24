import { useState, useEffect } from 'react';
import {
  ListTodo,
  Plus,
  Check,
  Circle,
  Clock,
  Trash2,
  ChevronDown,
  ChevronRight,
  Sparkles,
  X,
  GripVertical,
  Flag,
} from 'lucide-react';

const STATUS_ICONS = {
  pending: Circle,
  in_progress: Clock,
  completed: Check,
  skipped: X,
};

const STATUS_COLORS = {
  pending: 'text-surface-400',
  in_progress: 'text-yellow-400',
  completed: 'text-green-400',
  skipped: 'text-surface-500',
};

const PRIORITY_COLORS = {
  low: 'text-surface-500',
  normal: 'text-blue-400',
  high: 'text-orange-400',
  critical: 'text-red-400',
};

export default function PlansPanel({ projectId, sessionId }) {
  const [plans, setPlans] = useState([]);
  const [expandedPlans, setExpandedPlans] = useState({});
  const [loading, setLoading] = useState(false);
  const [showNewPlan, setShowNewPlan] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState('');
  const [newItemText, setNewItemText] = useState({});
  const [extracting, setExtracting] = useState(false);

  // Load plans
  useEffect(() => {
    if (projectId) {
      loadProjectPlans();
    } else if (sessionId) {
      loadSessionPlans();
    } else {
      loadAllPlans();
    }
  }, [projectId, sessionId]);

  const loadAllPlans = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/plans');
      const data = await res.json();
      setPlans(data);
      // Expand first plan by default
      if (data.length > 0) {
        setExpandedPlans({ [data[0].id]: true });
      }
    } catch (error) {
      console.error('Failed to load plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadProjectPlans = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/plans/project/${projectId}`);
      const data = await res.json();
      setPlans(data);
    } catch (error) {
      console.error('Failed to load project plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadSessionPlans = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/plans/session/${sessionId}`);
      const data = await res.json();
      setPlans(data);
    } catch (error) {
      console.error('Failed to load session plans:', error);
    } finally {
      setLoading(false);
    }
  };

  const createPlan = async () => {
    if (!newPlanTitle.trim()) return;

    try {
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newPlanTitle.trim(),
          projectId,
          sessionId,
          items: [],
        }),
      });
      const plan = await res.json();
      setPlans(prev => [plan, ...prev]);
      setExpandedPlans(prev => ({ ...prev, [plan.id]: true }));
      setNewPlanTitle('');
      setShowNewPlan(false);
    } catch (error) {
      console.error('Failed to create plan:', error);
    }
  };

  const addItem = async (planId) => {
    const text = newItemText[planId]?.trim();
    if (!text) return;

    try {
      const res = await fetch(`/api/plans/${planId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: text }),
      });
      const item = await res.json();

      setPlans(prev => prev.map(p =>
        p.id === planId
          ? { ...p, items: [...p.items, item] }
          : p
      ));
      setNewItemText(prev => ({ ...prev, [planId]: '' }));
    } catch (error) {
      console.error('Failed to add item:', error);
    }
  };

  const updateItemStatus = async (planId, itemId, status) => {
    try {
      const res = await fetch(`/api/plans/${planId}/items/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const updatedItem = await res.json();

      setPlans(prev => prev.map(p =>
        p.id === planId
          ? {
              ...p,
              items: p.items.map(i => i.id === itemId ? updatedItem : i),
            }
          : p
      ));
    } catch (error) {
      console.error('Failed to update item:', error);
    }
  };

  const deletePlan = async (planId) => {
    if (!confirm('Delete this plan?')) return;

    try {
      await fetch(`/api/plans/${planId}`, { method: 'DELETE' });
      setPlans(prev => prev.filter(p => p.id !== planId));
    } catch (error) {
      console.error('Failed to delete plan:', error);
    }
  };

  const extractFromClipboard = async () => {
    try {
      setExtracting(true);
      const text = await navigator.clipboard.readText();

      const res = await fetch('/api/plans/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          projectId,
          sessionId,
          save: true,
        }),
      });

      const extracted = await res.json();
      if (extracted.length > 0) {
        setPlans(prev => [...extracted, ...prev]);
        setExpandedPlans(prev => ({ ...prev, [extracted[0].id]: true }));
      } else {
        alert('No plans found in clipboard text');
      }
    } catch (error) {
      console.error('Failed to extract plans:', error);
    } finally {
      setExtracting(false);
    }
  };

  const getProgress = (items) => {
    if (items.length === 0) return 0;
    const completed = items.filter(i => i.status === 'completed' || i.status === 'skipped').length;
    return Math.round((completed / items.length) * 100);
  };

  const cycleStatus = (current) => {
    const order = ['pending', 'in_progress', 'completed', 'skipped'];
    const idx = order.indexOf(current);
    return order[(idx + 1) % order.length];
  };

  return (
    <div className="flex flex-col h-full bg-surface-850">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-primary-400" />
          <span className="text-sm font-medium text-surface-200">Plans</span>
          <span className="text-xs text-surface-500">({plans.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={extractFromClipboard}
            disabled={extracting}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            title="Extract from clipboard"
          >
            <Sparkles className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowNewPlan(true)}
            className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200 transition-colors"
            title="New plan"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* New Plan Form */}
      {showNewPlan && (
        <div className="p-2 border-b border-surface-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={newPlanTitle}
              onChange={(e) => setNewPlanTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createPlan()}
              placeholder="Plan title..."
              className="flex-1 px-2 py-1.5 text-xs bg-surface-800 border border-surface-700 rounded text-surface-200 placeholder-surface-500 focus:ring-1 focus:ring-primary-500"
              autoFocus
            />
            <button
              onClick={createPlan}
              className="px-2 py-1.5 text-xs bg-primary-500 hover:bg-primary-600 text-white rounded"
            >
              Add
            </button>
            <button
              onClick={() => {
                setShowNewPlan(false);
                setNewPlanTitle('');
              }}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Plans List */}
      <div className="flex-1 overflow-y-auto">
        {plans.map((plan) => {
          const isExpanded = expandedPlans[plan.id];
          const progress = getProgress(plan.items);
          const StatusIcon = STATUS_ICONS[plan.status] || Circle;

          return (
            <div key={plan.id} className="border-b border-surface-700">
              {/* Plan Header */}
              <div className="flex items-center gap-2 px-3 py-2 hover:bg-surface-800 transition-colors">
                <button
                  onClick={() =>
                    setExpandedPlans(prev => ({
                      ...prev,
                      [plan.id]: !prev[plan.id],
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

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-surface-200 truncate">
                      {plan.title}
                    </span>
                    <span className="text-[10px] text-surface-500">
                      {plan.items.length} items
                    </span>
                  </div>

                  {/* Progress bar */}
                  {plan.items.length > 0 && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-1 bg-surface-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-surface-500">
                        {progress}%
                      </span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => deletePlan(plan.id)}
                  className="p-1 opacity-0 hover:opacity-100 hover:bg-red-500/20 rounded transition-opacity"
                >
                  <Trash2 className="w-3 h-3 text-red-400" />
                </button>
              </div>

              {/* Plan Items */}
              {isExpanded && (
                <div className="px-3 pb-2 space-y-1">
                  {plan.items.map((item) => {
                    const ItemStatusIcon = STATUS_ICONS[item.status] || Circle;
                    return (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 py-1.5 px-2 bg-surface-800 rounded group"
                      >
                        <button
                          onClick={() =>
                            updateItemStatus(plan.id, item.id, cycleStatus(item.status))
                          }
                          className={`flex-shrink-0 mt-0.5 ${STATUS_COLORS[item.status]}`}
                        >
                          <ItemStatusIcon className="w-3.5 h-3.5" />
                        </button>

                        <span
                          className={`flex-1 text-xs ${
                            item.status === 'completed'
                              ? 'text-surface-500 line-through'
                              : item.status === 'skipped'
                              ? 'text-surface-500 line-through'
                              : 'text-surface-300'
                          }`}
                        >
                          {item.description}
                        </span>

                        {item.priority !== 'normal' && (
                          <Flag
                            className={`w-3 h-3 ${PRIORITY_COLORS[item.priority]}`}
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* Add Item Input */}
                  <div className="flex gap-1 mt-2">
                    <input
                      type="text"
                      value={newItemText[plan.id] || ''}
                      onChange={(e) =>
                        setNewItemText(prev => ({
                          ...prev,
                          [plan.id]: e.target.value,
                        }))
                      }
                      onKeyDown={(e) => e.key === 'Enter' && addItem(plan.id)}
                      placeholder="Add item..."
                      className="flex-1 px-2 py-1 text-[11px] bg-surface-900 border border-surface-700 rounded text-surface-300 placeholder-surface-500 focus:ring-1 focus:ring-primary-500"
                    />
                    <button
                      onClick={() => addItem(plan.id)}
                      className="px-2 py-1 text-[11px] bg-surface-700 hover:bg-surface-600 text-surface-300 rounded"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Empty State */}
        {plans.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-32 text-center p-4">
            <ListTodo className="w-8 h-8 text-surface-600 mb-2" />
            <p className="text-xs text-surface-400">No plans yet</p>
            <p className="text-[10px] text-surface-500">
              Create a plan or extract from AI responses
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
