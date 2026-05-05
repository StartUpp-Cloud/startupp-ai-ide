import SchedulerPanel from './SchedulerPanel';
import ContainerFilesPanel from './ContainerFilesPanel';

export default function RightPanel({ projectId, projectPath, selectedTool, containerName }) {
  return (
    <div className="flex flex-col h-full bg-surface-850 border-l border-surface-700">
      {/* Top: Scheduler */}
      <div className="flex-1 min-h-0 overflow-hidden border-b border-surface-700">
        <SchedulerPanel projectId={projectId} projectPath={projectPath} selectedTool={selectedTool} />
      </div>

      {/* Bottom: Container Files */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ContainerFilesPanel projectId={projectId} containerName={containerName} />
      </div>
    </div>
  );
}
