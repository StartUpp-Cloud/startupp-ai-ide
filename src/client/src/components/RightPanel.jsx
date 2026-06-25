import SchedulerPanel from './SchedulerPanel';
import ContainerFilesPanel from './ContainerFilesPanel';
import CodeIndexStatus from './CodeIndexStatus';

export default function RightPanel({ projectId, projectPath, selectedTool, containerName }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface-850 border-l border-surface-700 md:overflow-hidden">
      <CodeIndexStatus projectId={projectId} />
      {/* Top: Scheduler */}
      <div className="min-h-[320px] flex-1 overflow-hidden border-b border-surface-700 md:min-h-0">
        <SchedulerPanel projectId={projectId} projectPath={projectPath} selectedTool={selectedTool} />
      </div>

      {/* Bottom: Container Files */}
      <div className="min-h-[320px] flex-1 overflow-hidden md:min-h-0">
        <ContainerFilesPanel projectId={projectId} containerName={containerName} />
      </div>
    </div>
  );
}
