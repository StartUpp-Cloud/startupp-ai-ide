import SchedulerPanel from './SchedulerPanel';

export default function RightPanel({ projectId, projectPath, selectedTool }) {
  return (
    <div className="flex flex-col h-full bg-surface-850 border-l border-surface-700">
      <SchedulerPanel projectId={projectId} projectPath={projectPath} selectedTool={selectedTool} />
    </div>
  );
}
