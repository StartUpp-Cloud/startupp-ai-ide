import { RefreshCw } from 'lucide-react';

function formatAccountReset(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function CodexAccountStatusBar({ status, loading = false, onRefresh, compact = false }) {
  const remaining = status?.tightest?.remainingPercent;
  const windows = Array.isArray(status?.windows) ? status.windows : [];
  const text = windows.length
    ? windows.map((window) => `${window.label} ${window.remainingPercent}%`).join(' · ')
    : (status?.error ? 'Account unknown' : 'Account');
  const tone = remaining == null
    ? 'bg-surface-500'
    : remaining < 15
      ? 'bg-red-500'
      : remaining < 40
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  const title = [
    status?.planLabel,
    text && `${text} left`,
    status?.tightest?.resetsAt ? `resets ${formatAccountReset(status.tightest.resetsAt)}` : '',
    status?.resetCredits ? `${status.resetCredits} reset credit${status.resetCredits === 1 ? '' : 's'}` : '',
    status?.error || '',
  ].filter(Boolean).join(' · ');

  if (!status && !loading) return null;

  return (
    <div
      className={`flex items-center gap-1.5 min-w-0 ${compact ? 'max-w-[200px]' : ''}`}
      title={title || 'Codex account status'}
      aria-label={title || 'Codex account status'}
    >
      <div className={compact ? 'w-12 min-w-[48px]' : 'w-[72px] min-w-[64px]'}>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-700">
          <div
            className={`h-full rounded-full transition-all duration-300 ${tone}`}
            style={{ width: `${Math.max(0, Math.min(100, remaining ?? 0))}%` }}
          />
        </div>
      </div>
      <span className={`truncate text-surface-300 ${compact ? 'max-w-[88px] text-[9px]' : 'max-w-[150px] text-[10px]'}`}>
        {text}
      </span>
      <button
        type="button"
        onClick={() => onRefresh?.()}
        disabled={loading}
        className="rounded p-0.5 text-surface-400 transition-colors hover:text-surface-200 disabled:opacity-50"
        title="Refresh Codex account status"
        aria-label="Refresh Codex account status"
      >
        <RefreshCw size={compact ? 10 : 11} className={loading ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}
