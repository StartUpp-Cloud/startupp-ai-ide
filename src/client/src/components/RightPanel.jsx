import { useState } from 'react';
import SchedulerPanel from './SchedulerPanel';
import ContainerFilesPanel from './ContainerFilesPanel';
import FilesPanel from './FilesPanel';
import CodeIndexStatus from './CodeIndexStatus';

const STORAGE_KEY = 'sai.rightPanel.open';

function loadOpen() {
  try {
    return {
      codeIndex: true,
      schedules: true,
      files: true,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'),
    };
  } catch {
    return { codeIndex: true, schedules: true, files: true };
  }
}

export default function RightPanel({ projectId, projectPath, selectedTool, containerName }) {
  const [open, setOpen] = useState(loadOpen);

  const toggle = (key) => {
    setOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface-850 border-l border-surface-700 md:overflow-hidden">
      <CodeIndexStatus
        projectId={projectId}
        collapsed={!open.codeIndex}
        onToggle={() => toggle('codeIndex')}
      />
      <div className={open.schedules ? 'min-h-[160px] flex-1 overflow-hidden border-b border-surface-700 md:min-h-0' : 'flex-shrink-0 border-b border-surface-700'}>
        <SchedulerPanel
          projectId={projectId}
          projectPath={projectPath}
          selectedTool={selectedTool}
          collapsed={!open.schedules}
          onToggle={() => toggle('schedules')}
        />
      </div>
      <div className={open.files ? 'min-h-[160px] flex-1 overflow-hidden md:min-h-0' : 'flex-shrink-0'}>
        {containerName ? (
          <ContainerFilesPanel
            projectId={projectId}
            containerName={containerName}
            collapsed={!open.files}
            onToggle={() => toggle('files')}
          />
        ) : (
          <FilesPanel
            projectId={projectId}
            project={{ folderPath: projectPath }}
            collapsed={!open.files}
            onToggle={() => toggle('files')}
          />
        )}
      </div>
    </div>
  );
}
