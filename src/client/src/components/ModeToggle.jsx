import { Brain, Rocket, Zap } from 'lucide-react';

export default function ModeToggle({ mode, onChange, compact = false, disabled = false }) {
  const buttonClass = compact
    ? 'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50'
    : 'flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50';
  const iconSize = compact ? 11 : 13;

  return (
    <div className={`flex items-center bg-gray-800 rounded-lg p-0.5 border border-gray-700 ${compact ? 'rounded-md' : ''}`}>
      <button
        disabled={disabled}
        onClick={() => onChange('plan')}
        className={`${buttonClass} ${
          mode === 'plan'
            ? 'bg-purple-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Brain size={iconSize} />
        {!compact && 'Plan'}
      </button>
      <button
        disabled={disabled}
        onClick={() => onChange('agent')}
        className={`${buttonClass} ${
          mode === 'agent'
            ? 'bg-green-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Zap size={iconSize} />
        {!compact && 'Agent'}
      </button>
      <button
        disabled={disabled}
        onClick={() => onChange('autonomous')}
        className={`${buttonClass} ${
          mode === 'autonomous'
            ? 'bg-blue-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Rocket size={iconSize} />
        {!compact && 'Autonomous'}
      </button>
    </div>
  );
}
