import { useState, useEffect, useRef } from 'react';
import { RefreshCw, Server, Box, AlertTriangle } from 'lucide-react';
import { useProjects } from '../contexts/ProjectContext';

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

export default function SystemHealth({ containerName }) {
  const { notify } = useProjects();
  const [health, setHealth] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const detailRef = useRef(null);

  // Restart states
  const [restartingServer, setRestartingServer] = useState(false);
  const [restartingContainer, setRestartingContainer] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(null); // 'server' | 'container' | null

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

  // Handle IDE server restart
  const handleRestartServer = async () => {
    setConfirmRestart(null);
    setRestartingServer(true);

    try {
      const res = await fetch('/api/server/restart', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to initiate restart');

      notify?.('IDE Server restarting...', 'info');

      // Poll for server to come back online
      const checkServer = async (attempts = 0) => {
        if (attempts > 30) {
          notify?.('Server restart timed out. Please refresh manually.', 'error');
          setRestartingServer(false);
          return;
        }

        try {
          const healthRes = await fetch('/api/health');
          if (healthRes.ok) {
            notify?.('IDE Server restarted successfully!', 'success');
            setRestartingServer(false);
            return;
          }
        } catch {
          // Server not ready yet
        }

        setTimeout(() => checkServer(attempts + 1), 1000);
      };

      // Wait for server to shut down, then start polling
      setTimeout(() => checkServer(), 2000);

    } catch (error) {
      notify?.(error.message, 'error');
      setRestartingServer(false);
    }
  };

  // Handle container restart
  const handleRestartContainer = async () => {
    if (!containerName) {
      notify?.('No container associated with this project', 'error');
      return;
    }

    setConfirmRestart(null);
    setRestartingContainer(true);

    try {
      const res = await fetch(`/api/containers/${containerName}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: 10 })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to restart container');
      }

      notify?.('Container restarted successfully!', 'success');
    } catch (error) {
      notify?.(error.message, 'error');
    } finally {
      setRestartingContainer(false);
    }
  };

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

          {/* Restart Actions */}
          <div className="pt-2 border-t border-surface-700/60 space-y-1.5">
            <div className="text-[11px] font-medium text-surface-400 mb-2">Actions</div>

            {/* Restart IDE Server */}
            <button
              onClick={() => setConfirmRestart('server')}
              disabled={restartingServer}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-surface-300 hover:bg-surface-750 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {restartingServer ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Server className="w-3.5 h-3.5" />
              )}
              <span>{restartingServer ? 'Restarting...' : 'Restart IDE Server'}</span>
            </button>

            {/* Restart Container (only show if container exists) */}
            {containerName && (
              <button
                onClick={() => setConfirmRestart('container')}
                disabled={restartingContainer}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[11px] text-surface-300 hover:bg-surface-750 hover:text-surface-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {restartingContainer ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Box className="w-3.5 h-3.5" />
                )}
                <span>{restartingContainer ? 'Restarting...' : 'Restart Container'}</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmRestart && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="fixed inset-0 bg-surface-950/70 backdrop-blur-sm"
            onClick={() => setConfirmRestart(null)}
          />
          <div className="relative bg-surface-800 border border-surface-700 rounded-xl p-4 w-full max-w-sm shadow-modal animate-scale-in">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-yellow-500/15 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-4 h-4 text-yellow-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-surface-100 mb-1">
                  {confirmRestart === 'server' ? 'Restart IDE Server?' : 'Restart Container?'}
                </h3>
                <p className="text-xs text-surface-400">
                  {confirmRestart === 'server'
                    ? 'This will briefly disconnect all terminals and clients. They will reconnect automatically.'
                    : 'This will restart the Docker container. Running processes inside will be terminated.'}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setConfirmRestart(null)}
                className="px-3 py-1.5 text-xs text-surface-300 hover:text-surface-100 hover:bg-surface-750 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmRestart === 'server' ? handleRestartServer : handleRestartContainer}
                className="px-3 py-1.5 text-xs bg-primary-500 text-white hover:bg-primary-600 rounded transition-colors"
              >
                Restart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
