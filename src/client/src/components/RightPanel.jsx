import { useState, useCallback } from 'react';
import LiveAnalysisPanel from './LiveAnalysisPanel';
import SchedulerPanel from './SchedulerPanel';
import { ChevronDown, ChevronUp, GripHorizontal } from 'lucide-react';

/**
 * RightPanel - Container for the right side of the IDE.
 * Vertical split with LiveAnalysisPanel (top) and SchedulerPanel (bottom)
 * with a collapsible/draggable divider.
 */

const SECTION = {
  BOTH: 'both',
  ANALYSIS_ONLY: 'analysis-only',
  SCHEDULER_ONLY: 'scheduler-only',
};

export default function RightPanel({ projectId, projectPath, sessionId }) {
  const [sectionMode, setSectionMode] = useState(SECTION.BOTH);
  const [splitRatio, setSplitRatio] = useState(0.6); // Top panel gets 60%
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useCallback((node) => {
    if (node) containerRefCurrent.current = node;
  }, []);
  const containerRefCurrent = { current: null };

  // Toggle sections
  const toggleAnalysis = useCallback(() => {
    setSectionMode((prev) => {
      if (prev === SECTION.SCHEDULER_ONLY) return SECTION.BOTH;
      if (prev === SECTION.BOTH) return SECTION.SCHEDULER_ONLY;
      return SECTION.BOTH;
    });
  }, []);

  const toggleScheduler = useCallback(() => {
    setSectionMode((prev) => {
      if (prev === SECTION.ANALYSIS_ONLY) return SECTION.BOTH;
      if (prev === SECTION.BOTH) return SECTION.ANALYSIS_ONLY;
      return SECTION.BOTH;
    });
  }, []);

  // Drag handler for the divider
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);

    const startY = e.clientY;
    const startRatio = splitRatio;

    const handleMouseMove = (moveEvent) => {
      const container = containerRefCurrent.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const deltaY = moveEvent.clientY - startY;
      const deltaRatio = deltaY / rect.height;
      const newRatio = Math.max(0.2, Math.min(0.8, startRatio + deltaRatio));
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [splitRatio]);

  const showAnalysis = sectionMode !== SECTION.SCHEDULER_ONLY;
  const showScheduler = sectionMode !== SECTION.ANALYSIS_ONLY;

  return (
    <div
      ref={(node) => {
        containerRefCurrent.current = node;
      }}
      className="flex flex-col h-full bg-surface-850 border-l border-surface-700"
    >
      {/* Top section: Live Analysis */}
      {showAnalysis && (
        <div
          className="flex flex-col min-h-0 overflow-hidden"
          style={{
            flex: showScheduler ? `0 0 ${splitRatio * 100}%` : '1 1 auto',
          }}
        >
          <LiveAnalysisPanel projectId={projectId} sessionId={sessionId} />
        </div>
      )}

      {/* Divider */}
      {showAnalysis && showScheduler && (
        <div
          className={`flex items-center justify-center h-[22px] flex-shrink-0 border-y border-surface-700 cursor-row-resize select-none transition-colors ${
            isDragging ? 'bg-primary-500/20' : 'bg-surface-800 hover:bg-surface-750'
          }`}
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={toggleAnalysis}
              className="p-0.5 rounded hover:bg-surface-700 text-surface-500 hover:text-surface-300 transition-colors"
              title="Toggle analysis panel"
            >
              <ChevronUp className="w-3 h-3" />
            </button>

            <GripHorizontal className="w-4 h-4 text-surface-600" />

            <button
              onClick={toggleScheduler}
              className="p-0.5 rounded hover:bg-surface-700 text-surface-500 hover:text-surface-300 transition-colors"
              title="Toggle scheduler panel"
            >
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>
        </div>
      )}

      {/* Collapsed panel indicator (when one is hidden) */}
      {!showAnalysis && (
        <button
          onClick={toggleAnalysis}
          className="flex items-center justify-center gap-1.5 px-3 py-1 bg-surface-800 border-b border-surface-700 text-surface-500 hover:text-surface-300 hover:bg-surface-750 transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
          <span className="text-[10px]">Show Live Analysis</span>
        </button>
      )}

      {!showScheduler && (
        <button
          onClick={toggleScheduler}
          className="flex items-center justify-center gap-1.5 px-3 py-1 bg-surface-800 border-t border-surface-700 text-surface-500 hover:text-surface-300 hover:bg-surface-750 transition-colors mt-auto"
        >
          <ChevronUp className="w-3 h-3" />
          <span className="text-[10px]">Show Scheduler</span>
        </button>
      )}

      {/* Bottom section: Scheduler */}
      {showScheduler && (
        <div
          className="flex flex-col min-h-0 overflow-hidden"
          style={{
            flex: showAnalysis ? `0 0 ${(1 - splitRatio) * 100}%` : '1 1 auto',
          }}
        >
          <SchedulerPanel projectId={projectId} projectPath={projectPath} />
        </div>
      )}
    </div>
  );
}
