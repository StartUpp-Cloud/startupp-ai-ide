import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Search,
  GitBranch,
  Terminal,
  Globe,
  Table2,
  Plug,
  Loader,
} from 'lucide-react';

import ConnectionManager from './ConnectionManager';
import SchemaExplorer from './SchemaExplorer';
import SoqlStudio from './SoqlStudio';
import FlowAnalyzer from './FlowAnalyzer';
import DebugConsole from './DebugConsole';
import RestExplorer from './RestExplorer';
import DataOperations from './DataOperations';

const SCREENS = [
  { id: 'connect', label: 'Setup', icon: Plug },
  { id: 'schema', label: 'Schema', icon: Database },
  { id: 'soql', label: 'SOQL', icon: Search },
  { id: 'flows', label: 'Flows', icon: GitBranch },
  { id: 'debug', label: 'Debug', icon: Terminal },
  { id: 'rest', label: 'REST', icon: Globe },
  { id: 'data', label: 'Data', icon: Table2 },
];

export default function SalesforceInlineWorkspace({ projectId }) {
  const [activeScreen, setActiveScreen] = useState('connect');
  const [connection, setConnection] = useState(null);
  const [connectionLoading, setConnectionLoading] = useState(true);

  const checkConnection = useCallback(async () => {
    if (!projectId) { setConnection(null); setConnectionLoading(false); return; }
    setConnectionLoading(true);
    try {
      const res = await fetch(`/api/salesforce/connection/status?projectId=${projectId}`);
      const data = await res.json();
      if (data.ok) setConnection(data.data);
    } catch { /* ignore */ }
    setConnectionLoading(false);
  }, [projectId]);

  useEffect(() => { checkConnection(); }, [checkConnection]);

  const handleConnectionChange = () => {
    checkConnection();
  };

  // Connected if legacy connection exists or either environment is connected
  const isConnected = connection?.connected === true;

  const renderScreen = () => {
    const commonProps = { projectId, connection, onConnectionChange: handleConnectionChange };
    switch (activeScreen) {
      case 'connect': return <ConnectionManager {...commonProps} />;
      case 'schema': return <SchemaExplorer {...commonProps} />;
      case 'soql': return <SoqlStudio {...commonProps} />;
      case 'flows': return <FlowAnalyzer {...commonProps} />;
      case 'debug': return <DebugConsole {...commonProps} />;
      case 'rest': return <RestExplorer {...commonProps} />;
      case 'data': return <DataOperations {...commonProps} />;
      default: return <ConnectionManager {...commonProps} />;
    }
  };

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-surface-500 text-sm">
        No project selected
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0%', minHeight: 0, overflow: 'hidden' }}>
      {/* Compact tab bar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-surface-700/50 bg-surface-900/50 overflow-x-auto">
        {SCREENS.map((screen) => {
          const Icon = screen.icon;
          const isActive = activeScreen === screen.id;
          const needsConnection = screen.id !== 'connect' && !isConnected;

          return (
            <button
              key={screen.id}
              onClick={() => setActiveScreen(screen.id)}
              disabled={needsConnection}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-sky-500/20 text-sky-300'
                  : needsConnection
                    ? 'text-surface-600 cursor-not-allowed'
                    : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
              }`}
              title={needsConnection ? 'Connect to an org first' : screen.label}
            >
              <Icon size={12} />
              {screen.label}
            </button>
          );
        })}

        {/* Connection indicator */}
        <div className="ml-auto flex items-center gap-1.5 px-2 text-[10px]">
          {connectionLoading ? (
            <Loader size={10} className="animate-spin text-surface-400" />
          ) : isConnected ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-surface-400 truncate max-w-[150px]">{connection?.connection?.username || 'Connected'}</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-surface-500" />
              <span className="text-surface-500">Not connected</span>
            </>
          )}
        </div>
      </div>

      {/* Screen content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {renderScreen()}
      </div>
    </div>
  );
}
