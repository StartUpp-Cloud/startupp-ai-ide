import { useState, useEffect, useRef } from 'react';

const POLL_INTERVAL = 5000; // 5 seconds

function formatUptime(seconds) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function getLevel(percent) {
  if (percent >= 85) return { color: 'text-red-400', bg: 'bg-red-500', ring: 'ring-red-500/30', label: 'Critical' };
  if (percent >= 70) return { color: 'text-yellow-400', bg: 'bg-yellow-500', ring: 'ring-yellow-500/30', label: 'High' };
  return { color: 'text-green-400', bg: 'bg-green-500', ring: 'ring-green-500/30', label: 'Normal' };
}

export default function SystemHealth() {
  const [health, setHealth] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const detailRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const poll = () => {
      fetch('/api/system-health')
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (mounted && data) setHealth(data); })
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!showDetail) return;
    const handler = (e) => {
      if (detailRef.current && !detailRef.current.contains(e.target)) setShowDetail(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showDetail]);

  if (!health) return null;

  const mem = getLevel(health.memory.percent);
  const cpu = getLevel(health.cpu.percent);
  // Overall level = whichever is worse
  const overall = health.memory.percent >= health.cpu.percent ? mem : cpu;

  return (
    <div className="relative" ref={detailRef}>
      {/* Compact indicator */}
      <button
        onClick={() => setShowDetail(!showDetail)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-750 transition-colors ${
          overall.label === 'Critical' ? 'animate-pulse' : ''
        }`}
        title={`Memory: ${health.memory.percent}% | CPU: ${health.cpu.percent}%`}
      >
        {/* Tiny bar graph */}
        <div className="flex items-end gap-[2px] h-3.5">
          <div className="w-[3px] rounded-sm bg-surface-700 relative overflow-hidden" style={{ height: '14px' }}>
            <div className={`absolute bottom-0 w-full rounded-sm ${mem.bg}`} style={{ height: `${health.memory.percent}%` }} />
          </div>
          <div className="w-[3px] rounded-sm bg-surface-700 relative overflow-hidden" style={{ height: '14px' }}>
            <div className={`absolute bottom-0 w-full rounded-sm ${cpu.bg}`} style={{ height: `${health.cpu.percent}%` }} />
          </div>
        </div>
        <span className={`text-[10px] font-mono font-medium ${overall.color}`}>
          {health.memory.percent}%
        </span>
      </button>

      {/* Detail popover */}
      {showDetail && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-surface-850 border border-surface-700 rounded-lg shadow-xl z-50 p-3 space-y-3">
          <div className="text-[11px] font-medium text-surface-300 uppercase tracking-wider">System Health</div>

          {/* Memory */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-surface-400">Memory</span>
              <span className={`font-mono font-medium ${mem.color}`}>
                {health.memory.usedGB} / {health.memory.totalGB} GB ({health.memory.percent}%)
              </span>
            </div>
            <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${mem.bg}`} style={{ width: `${health.memory.percent}%` }} />
            </div>
          </div>

          {/* CPU */}
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-surface-400">CPU</span>
              <span className={`font-mono font-medium ${cpu.color}`}>
                {health.cpu.percent}% ({health.cpu.cores} cores)
              </span>
            </div>
            <div className="h-1.5 bg-surface-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${cpu.bg}`} style={{ width: `${health.cpu.percent}%` }} />
            </div>
            <div className="text-[10px] text-surface-600 mt-0.5 font-mono">
              Load: {health.cpu.load1m} / {health.cpu.load5m} (1m/5m)
            </div>
          </div>

          {/* Node process */}
          <div className="pt-2 border-t border-surface-700/60">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-surface-500">IDE Server</span>
              <span className="text-surface-400 font-mono">{health.node.heapMB} MB heap</span>
            </div>
            <div className="flex items-center justify-between text-[11px] mt-0.5">
              <span className="text-surface-500">Uptime</span>
              <span className="text-surface-400 font-mono">{formatUptime(health.uptime)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
