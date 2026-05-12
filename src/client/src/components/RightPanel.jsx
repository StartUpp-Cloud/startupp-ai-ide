import SchedulerPanel from './SchedulerPanel';
import ContainerFilesPanel from './ContainerFilesPanel';
import SalesforceWorkspace from './salesforce/SalesforceWorkspace';

export default function RightPanel({ projectId, projectPath, selectedTool, containerName, selectedProject, containerRepos, onProjectUpdated }) {
  return (
    <div className="flex flex-col h-full bg-surface-850 border-l border-surface-700">
      {/* Top: Scheduler */}
      <div className="flex-1 min-h-0 overflow-hidden border-b border-surface-700">
        {selectedProject?.stack === 'salesforce' ? (
          <SalesforceWorkspace
            project={selectedProject}
            containerRepos={containerRepos}
            onProjectUpdated={onProjectUpdated}
          />
        ) : (
          <SchedulerPanel projectId={projectId} projectPath={projectPath} selectedTool={selectedTool} />
        )}
      </div>

      {/* Bottom: Container Files */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ContainerFilesPanel projectId={projectId} containerName={containerName} />
      </div>
    </div>
  );
}
