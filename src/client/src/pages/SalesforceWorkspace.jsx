import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useProjects } from '../contexts/ProjectContext';
import {
  ArrowLeft,
  Cloud,
  Database,
  Search,
  GitBranch,
  Terminal,
  Globe,
  Table2,
  Plug,
  ChevronRight,
  Loader,
} from 'lucide-react';

import ConnectionManager from '../components/salesforce/ConnectionManager';
import SchemaExplorer from '../components/salesforce/SchemaExplorer';
import SoqlStudio from '../components/salesforce/SoqlStudio';
import FlowAnalyzer from '../components/salesforce/FlowAnalyzer';
import DebugConsole from '../components/salesforce/DebugConsole';
import RestExplorer from '../components/salesforce/RestExplorer';
import DataOperations from '../components/salesforce/DataOperations';

const SCREENS = [
  { id: 'connect', label: 'Connection', icon: Plug, description: 'Manage org connections' },
  { id: 'schema', label: 'Schema', icon: Database, description: 'Browse objects & fields' },
  { id: 'soql', label: 'SOQL', icon: Search, description: 'Query editor & AI builder' },
  { id: 'flows', label: 'Flows', icon: GitBranch, description: 'Flow analyzer & search' },
  { id: 'debug', label: 'Debug', icon: Terminal, description: 'Execute Apex & logs' },
  { id: 'rest', label: 'REST', icon: Globe, description: 'REST API explorer' },
  { id: 'data', label: 'Data', icon: Table2, description: 'Records & bulk ops' },
];

export default function SalesforceWorkspace() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projects } = useProjects();

  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    return searchParams.get('projectId') || localStorage.getItem('sf_selectedProjectId') || '';
  });
  const [activeScreen, setActiveScreen] = useState(() => {
    return searchParams.get('screen') || 'connect';
  });
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(false);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  // Persist selections
  useEffect(() => {
    if (selectedProjectId) localStorage.setItem('sf_selectedProjectId', selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    const params = {};
    if (selectedProjectId) params.projectId = selectedProjectId;
    if (activeScreen !== 'connect') params.screen = activeScreen;
    setSearchParams(params, { replace: true });
  }, [selectedProjectId, activeScreen, setSearchParams]);

  // Check connection status when project changes
  const checkConnection = useCallback(async () => {
    if (!selectedProjectId) { setConnection(null); return; }
    setConnectionLoading(true);
    try {
      const res = await fetch(`/api/salesforce/connection/status?projectId=${selectedProjectId}`);
      const data = await res.json();
      if (data.ok) setConnection(data.data);
    } catch { /* ignore */ }
    setConnectionLoading(false);
  }, [selectedProjectId]);

  useEffect(() => { checkConnection(); }, [checkConnection]);

  const handleScreenChange = (screenId) => {
    setActiveScreen(screenId);
  };

  const handleConnectionChange = () => {
    checkConnection();
  };

  const isConnected = connection?.connected === true;

  const renderScreen = () => {
    const commonProps = { projectId: selectedProjectId, connection, onConnectionChange: handleConnectionChange };

    switch (activeScreen) {
      case 'connect':
        return <ConnectionManager {...commonProps} />;
      case 'schema':
        return <SchemaExplorer {...commonProps} />;
      case 'soql':
        return <SoqlStudio {...commonProps} />;
      case 'flows':
        return <FlowAnalyzer {...commonProps} />;
      case 'debug':
        return <DebugConsole {...commonProps} />;
      case 'rest':
        return <RestExplorer {...commonProps} />;
      case 'data':
        return <DataOperations {...commonProps} />;
      default:
        return <ConnectionManager {...commonProps} />;
    }
  };

  return (
    <div className="min-h-screen bg-surface-950 text-surface-100 flex flex-col">
      {/* Header */}
      <header className="bg-surface-900 border-b border-surface-700 px-4 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="p-1.5 rounded-lg hover:bg-surface-800 text-surface-400 hover:text-surface-200 transition-colors"
          title="Back to IDE"
        >
          <ArrowLeft size={18} />
        </button>

        <div className="flex items-center gap-2">
          <Cloud size={20} className="text-sky-400" />
          <h1 className="text-lg font-semibold text-surface-100">Salesforce Workbench</h1>
        </div>

        {/* Project selector */}
        <select
          value={selectedProjectId}
          onChange={(e) => setSelectedProjectId(e.target.value)}
          className="ml-4 bg-surface-800 border border-surface-600 rounded-lg px-3 py-1.5 text-sm text-surface-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          <option value="">Select project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* Connection indicator */}
        {selectedProjectId && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            {connectionLoading ? (
              <Loader size={14} className="animate-spin text-surface-400" />
            ) : isConnected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-surface-300">{connection?.connection?.username || 'Connected'}</span>
                <span className="text-surface-500">|</span>
                <span className="text-surface-400 text-xs">{connection?.connection?.instanceUrl?.replace('https://', '')}</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-surface-500" />
                <span className="text-surface-400">Not connected</span>
              </>
            )}
          </div>
        )}
      </header>

      {!selectedProjectId ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Cloud size={48} className="mx-auto mb-4 text-surface-600" />
            <h2 className="text-xl font-semibold text-surface-300 mb-2">Select a Project</h2>
            <p className="text-surface-500">Choose a project from the dropdown above to get started.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <nav className="w-52 bg-surface-900 border-r border-surface-700 flex flex-col py-2">
            {SCREENS.map((screen) => {
              const Icon = screen.icon;
              const isActive = activeScreen === screen.id;
              const needsConnection = screen.id !== 'connect' && !isConnected;

              return (
                <button
                  key={screen.id}
                  onClick={() => handleScreenChange(screen.id)}
                  disabled={needsConnection}
                  className={`flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    isActive
                      ? 'bg-sky-500/10 text-sky-400 border-r-2 border-sky-400'
                      : needsConnection
                        ? 'text-surface-600 cursor-not-allowed'
                        : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
                  }`}
                  title={needsConnection ? 'Connect to an org first' : screen.description}
                >
                  <Icon size={16} />
                  <span className="text-sm font-medium">{screen.label}</span>
                  {isActive && <ChevronRight size={14} className="ml-auto" />}
                </button>
              );
            })}
          </nav>

          {/* Main content */}
          <main className="flex-1 overflow-auto">
            {renderScreen()}
          </main>
        </div>
      )}
    </div>
  );
}
