import { Bot, User, AlertTriangle, CheckCircle, Loader, ChevronDown, ChevronRight, Info } from 'lucide-react';
import { useState } from 'react';

const ROLE_STYLES = {
  user: { align: 'justify-end', bubble: 'bg-blue-600/20 border-blue-500/30', icon: User, label: 'You' },
  agent: { align: 'justify-start', bubble: 'bg-gray-700/40 border-gray-600/30', icon: Bot, label: 'Agent' },
  system: { align: 'justify-center', bubble: 'bg-yellow-900/20 border-yellow-600/20 text-yellow-300/80 text-sm', icon: Info, label: 'System' },
  progress: { align: 'justify-start', bubble: 'bg-gray-800/30 border-gray-700/20', icon: Loader, label: 'Progress' },
  error: { align: 'justify-start', bubble: 'bg-red-900/20 border-red-500/30 text-red-300', icon: AlertTriangle, label: 'Error' },
};

export default function ChatMessage({ message, wsRef, projectId }) {
  const [showRaw, setShowRaw] = useState(false);
  const style = ROLE_STYLES[message.role] || ROLE_STYLES.agent;
  const Icon = style.icon;
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const tasks = message.metadata?.tasks;
  const tool = message.metadata?.tool;
  const rawOutput = message.metadata?.rawOutput;
  const plan = message.metadata?.plan;

  const handleApprovePlan = () => {
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-approve-plan',
        projectId: projectId || message.projectId,
        steps: plan,
      }));
    }
  };

  return (
    <div className={`flex ${style.align} mb-3 px-3`}>
      <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${style.bubble}`}>
        <div className="flex items-center gap-2 mb-1 text-xs text-gray-400">
          <Icon size={12} />
          <span>{style.label}</span>
          {tool && <span className="text-purple-400">via {tool}</span>}
          <span className="ml-auto">{time}</span>
        </div>

        <div className="text-sm text-gray-200 whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {tasks && tasks.length > 0 && (
          <div className="mt-2 space-y-1">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {task.status === 'done' && <CheckCircle size={12} className="text-green-400" />}
                {task.status === 'running' && <Loader size={12} className="text-blue-400 animate-spin" />}
                {task.status === 'pending' && <div className="w-3 h-3 rounded-full border border-gray-600" />}
                {task.status === 'failed' && <AlertTriangle size={12} className="text-red-400" />}
                <span className={task.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-300'}>
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        )}

        {plan && plan.length > 0 && (
          <div className="mt-2">
            <button onClick={handleApprovePlan} className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-md transition-colors">
              Approve &amp; Execute Plan
            </button>
          </div>
        )}

        {rawOutput && (
          <button onClick={() => setShowRaw(!showRaw)} className="flex items-center gap-1 mt-2 text-xs text-gray-500 hover:text-gray-300">
            {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Raw output
          </button>
        )}
        {showRaw && rawOutput && (
          <pre className="mt-1 p-2 bg-black/40 rounded text-xs text-gray-400 overflow-x-auto max-h-48 overflow-y-auto">
            {rawOutput}
          </pre>
        )}
      </div>
    </div>
  );
}
