import { Brain, Zap } from 'lucide-react';

export default function ModeToggle({ mode, onChange, compact = false, disabled = false }) {
  const buttonClass = compact
    ? 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50'
    : 'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50';
  const iconSize = compact ? 11 : 13;
  const effectiveMode = mode === 'autonomous' ? 'agent' : mode;

  return (
    <div className={`flex items-center bg-gray-800 rounded-lg p-0.5 border border-gray-700 ${compact ? 'rounded-md' : ''}`}>
      <button
        disabled={disabled}
        onClick={() => onChange('plan')}
        className={`${buttonClass} ${
          effectiveMode === 'plan'
            ? 'bg-purple-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Plan first: inspect, propose a structured plan, wait for approval"
      >
        <Brain size={iconSize} />
        {!compact && 'Plan'}
      </button>
      <button
        disabled={disabled}
        onClick={() => onChange('agent')}
        className={`${buttonClass} ${
          effectiveMode === 'agent'
            ? 'bg-green-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
        title="Do the work at full effort and report back like a teammate"
      >
        <Zap size={iconSize} />
        {!compact && 'Agent'}
      </button>
    </div>
  );
}
