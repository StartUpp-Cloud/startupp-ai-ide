import { Brain, Zap } from 'lucide-react';

export default function ModeToggle({ mode, onChange }) {
  return (
    <div className="flex items-center bg-gray-800 rounded-lg p-0.5 border border-gray-700">
      <button
        onClick={() => onChange('plan')}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
          mode === 'plan'
            ? 'bg-purple-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Brain size={13} />
        Plan
      </button>
      <button
        onClick={() => onChange('agent')}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
          mode === 'agent'
            ? 'bg-green-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Zap size={13} />
        Agent
      </button>
    </div>
  );
}
