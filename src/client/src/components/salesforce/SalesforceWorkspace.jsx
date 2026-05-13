import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Cloud, Database, GitPullRequestArrow, RefreshCw, Search, ShieldAlert, Sparkles, TerminalSquare } from 'lucide-react';

function parseApiError(data, fallback, context = {}) {
  const source = data?.error && typeof data.error === 'object' ? data.error : null;
  return {
    code: source?.code || null,
    message: source?.message || (typeof data?.error === 'string' ? data.error : fallback),
    details: source?.details || null,
    ...context,
  };
}

function friendlyError(error) {
  if (!error) return null;
  const operation = error.details?.operation || error.operation;
  const base = error.message || 'Salesforce action failed';

  if (error.code === 'COMMAND_FAILED' && operation === 'object.list') {
    return {
      title: 'Could not load Salesforce objects',
      message: 'The Salesforce CLI could not list objects for the selected org from the project container.',
      tips: [
        'Refresh Status to confirm the container, Salesforce CLI, and org auth are still ready.',
        'Check that the selected org is not expired, then reconnect it from the Status tab if needed.',
        'If this is a large org or restricted profile, try a guided Schema Summary so the assistant can adjust read-only CLI checks.',
      ],
    };
  }

  if (error.code === 'COMMAND_FAILED') {
    return {
      title: 'Salesforce CLI command failed',
      message: operation ? `The project container could not complete ${operation}.` : base,
      tips: ['Refresh Status to re-check CLI and org auth.', 'Confirm the selected repo and org are correct before trying again.'],
    };
  }

  if (error.code === 'CONTAINER_NOT_RUNNING') {
    return {
      title: 'Project container is not running',
      message: 'Start the project container, then refresh Salesforce Status.',
      tips: ['Salesforce commands run inside the project container, not on the host.'],
    };
  }

  if (error.code === 'PROJECT_CONTAINER_REQUIRED') {
    return {
      title: 'Container required',
      message: 'This project needs a container before Salesforce actions can run.',
      tips: ['Create or start the project container, then return to this panel.'],
    };
  }

  if (error.code === 'INVALID_CONTEXT') {
    return {
      title: 'Workspace context is missing',
      message: base,
      tips: ['Select a repo so Salesforce commands use an explicit working directory.'],
    };
  }

  return {
    title: 'Salesforce action failed',
    message: base,
    tips: ['Review the selected repo and org, then try again.'],
  };
}

const GUIDED_ACTIONS = [
  {
    id: 'org-health',
    title: 'Org Health Snapshot',
    description: 'Summarize connected org status, limits, enabled features, and obvious setup risks.',
    outcome: 'Return a concise health summary with any warnings and the exact read-only commands used.',
    commands: [
      'sf org display --target-org <targetOrg> --verbose --json',
      'sf limits api display --target-org <targetOrg> --json',
      'sf org list --json',
    ],
  },
  {
    id: 'schema-summary',
    title: 'Schema Summary',
    description: 'Inspect key objects and fields so the user can understand the org data model quickly.',
    outcome: 'Return important standard/custom objects, notable required fields, and follow-up questions if the result is too broad.',
    commands: [
      'sf sobject list --target-org <targetOrg> --sobject all --json',
      'sf sobject describe --target-org <targetOrg> --sobject <objectName> --json',
      'sf data query --target-org <targetOrg> --query "SELECT QualifiedApiName, Label, DataType, EntityDefinition.QualifiedApiName FROM FieldDefinition LIMIT 200" --json',
    ],
  },
  {
    id: 'automation-inventory',
    title: 'Automation Inventory',
    description: 'Find local Salesforce automation metadata and use CLI read commands when useful.',
    outcome: 'Return flows/triggers/process automation found, where they live, and any high-risk concentration points.',
    commands: [
      'sf org list metadata --target-org <targetOrg> --metadata-type Flow --json',
      'sf org list metadata --target-org <targetOrg> --metadata-type ApexTrigger --json',
      'Search the selected repo for force-app/**/flows, triggers, and related metadata files.',
    ],
  },
];

export default function SalesforceWorkspace({ project, containerRepos = [], onProjectUpdated, onRunGuidedAction }) {
  const [activeTab, setActiveTab] = useState('status');
  const [repoPath, setRepoPath] = useState('');
  const [status, setStatus] = useState(null);
  const [objects, setObjects] = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedObject, setSelectedObject] = useState('');
  const [describe, setDescribe] = useState(null);
  const [soql, setSoql] = useState('SELECT Id, Name FROM Account');
  const [queryResult, setQueryResult] = useState(null);
  const [flowQuery, setFlowQuery] = useState('');
  const [flowResults, setFlowResults] = useState([]);
  const [filter, setFilter] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [authAlias, setAuthAlias] = useState('default-org');
  const [setupMessage, setSetupMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState('');
  const [error, setError] = useState(null);

  const isSalesforce = project?.stack === 'salesforce';
  const repos = useMemo(() => containerRepos.filter((repo) => repo.isGitRepo), [containerRepos]);
  const orgs = status?.orgs || [];
  const cliAvailable = status?.cli?.available === true;
  const orgConnected = status?.auth?.connected === true || orgs.some((org) => !org.isExpired);
  const safeAlias = authAlias.trim() || 'default-org';
  const hostLoginCommand = `sf org login web --alias ${safeAlias} --set-default`;
  const hostTokenCommand = `sf org display --target-org ${safeAlias} --verbose --json`;
  const selectedOrgSummary = orgs.find((org) => org.targetOrg === selectedOrg || org.username === selectedOrg);
  const selectedRepo = repos.find((repo) => repo.path === repoPath);
  const selectedOrgLabel = selectedOrgSummary?.alias || selectedOrgSummary?.usernameRedacted || (selectedOrg ? 'Selected org' : 'No org selected');
  const selectedProjectLabel = project?.name || project?.id || 'Current project';
  const filteredObjects = objects.filter((name) => name.toLowerCase().includes(filter.toLowerCase())).slice(0, 200);
  const tabs = [
    { id: 'status', label: 'Status', icon: Cloud },
    { id: 'objects', label: 'Objects', icon: Database },
    { id: 'soql', label: 'SOQL', icon: TerminalSquare },
    { id: 'flows', label: 'Flows', icon: GitPullRequestArrow },
  ];

  function beginLoading(label) {
    setLoading(true);
    setLoadingLabel(label);
    setError(null);
  }

  function finishLoading() {
    setLoading(false);
    setLoadingLabel('');
  }

  function assertOk(response, data, fallback, context) {
    if (!response.ok || !data.ok) throw parseApiError(data, fallback, context);
  }

  useEffect(() => {
    if (!repoPath && repos.length === 1) setRepoPath(repos[0].path);
  }, [repos, repoPath]);

  useEffect(() => {
    if (!project?.id || !isSalesforce) return;
    loadStatus();
  }, [project?.id, isSalesforce, repoPath]);

  useEffect(() => {
    const defaultOrg = status?.selectedOrg?.targetOrg || orgs.find((org) => org.isDefault)?.targetOrg || orgs[0]?.targetOrg || '';
    if (!selectedOrg && defaultOrg) setSelectedOrg(defaultOrg);
  }, [status, orgs, selectedOrg]);

  async function markSalesforce() {
    beginLoading('Enabling Salesforce mode...');
    try {
      const response = await fetch('/api/salesforce/project-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, stack: 'salesforce' }),
      });
      const data = await response.json();
      assertOk(response, data, 'Failed to update project stack', { action: 'Enable Salesforce mode' });
      onProjectUpdated?.(data.data.project);
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function detectAndApply() {
    beginLoading('Detecting Salesforce project metadata...');
    try {
      const response = await fetch('/api/salesforce/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, repoPath: repoPath || undefined, persist: true }),
      });
      const data = await response.json();
      assertOk(response, data, 'Salesforce detection failed', { action: 'Detect Salesforce project' });
      await loadStatus();
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function loadStatus() {
    if (!project?.id) return;
    beginLoading('Checking Salesforce status...');
    try {
      const params = new URLSearchParams({ projectId: project.id });
      if (repoPath) params.set('repoPath', repoPath);
      const response = await fetch(`/api/salesforce/status?${params}`);
      const data = await response.json();
      assertOk(response, data, 'Salesforce status failed', { action: 'Refresh Status' });
      setStatus(data.data);
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function installCli() {
    if (!project?.id) return;
    beginLoading('Installing Salesforce CLI in the container...');
    setSetupMessage('');
    try {
      const response = await fetch('/api/salesforce/cli/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, repoPath: repoPath || undefined }),
      });
      const data = await response.json();
      assertOk(response, data, 'Salesforce CLI install failed', { action: 'Install Salesforce CLI' });
      setSetupMessage(`Salesforce CLI ready${data.data?.version ? `: ${data.data.version}` : ''}`);
      await loadStatus();
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function importAuthUrl() {
    if (!repoPath || !authUrl.trim()) return;
    beginLoading('Importing org auth into the container...');
    setSetupMessage('');
    try {
      const response = await fetch('/api/salesforce/auth/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, repoPath, authUrl, alias: safeAlias, setDefault: true }),
      });
      const data = await response.json();
      assertOk(response, data, 'Salesforce auth import failed', { action: 'Import Salesforce auth' });
      setAuthUrl('');
      setSetupMessage('Salesforce org imported into the project container. Actions can now use the CLI safely.');
      await loadStatus();
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function loadObjects() {
    if (!repoPath || !selectedOrg) return;
    beginLoading('Loading Salesforce objects...');
    try {
      const params = new URLSearchParams({ projectId: project.id, repoPath, targetOrg: selectedOrg });
      const response = await fetch(`/api/salesforce/objects?${params}`);
      const data = await response.json();
      assertOk(response, data, 'Object list failed', { action: 'Load Objects', operation: 'object.list' });
      setObjects(data.data.objects || []);
      setDescribe(null);
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function loadDescribe(objectName) {
    if (!repoPath || !selectedOrg || !objectName) return;
    setSelectedObject(objectName);
    beginLoading(`Loading ${objectName} fields...`);
    try {
      const params = new URLSearchParams({ projectId: project.id, repoPath, targetOrg: selectedOrg });
      const response = await fetch(`/api/salesforce/objects/${encodeURIComponent(objectName)}?${params}`);
      const data = await response.json();
      assertOk(response, data, 'Object describe failed', { action: 'Describe Object', operation: 'object.describe' });
      setDescribe(data.data.describe);
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function runSoql() {
    if (!repoPath || !selectedOrg || !soql.trim()) return;
    beginLoading('Running read-only SOQL query...');
    try {
      const response = await fetch('/api/salesforce/soql/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: project.id, repoPath, targetOrg: selectedOrg, query: soql }),
      });
      const data = await response.json();
      assertOk(response, data, 'SOQL query failed', { action: 'Run SOQL', operation: 'soql.query' });
      setSoql(data.data.query);
      setQueryResult(data.data);
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  async function searchFlows() {
    if (!repoPath) return;
    beginLoading('Searching local Salesforce flows...');
    try {
      const params = new URLSearchParams({ projectId: project.id, repoPath });
      if (flowQuery.trim()) params.set('q', flowQuery.trim());
      const response = await fetch(`/api/salesforce/flows/search?${params}`);
      const data = await response.json();
      assertOk(response, data, 'Flow search failed', { action: 'Search Flows' });
      setFlowResults(data.data.results || []);
    } catch (err) {
      setError(err);
    } finally {
      finishLoading();
    }
  }

  function runGuidedAction(action) {
    if (!action || !repoPath || !selectedOrg || !onRunGuidedAction) return;
    const targetOrgLabel = selectedOrgSummary?.alias || selectedOrgSummary?.usernameRedacted || selectedOrg;
    const targetOrgValue = selectedOrgSummary?.targetOrg || selectedOrg;
    const prompt = `Salesforce guided action: ${action.title}

IDE-selected workspace context:
- projectId: ${project.id}
- repoPath: ${repoPath}
- worktreePath: ${selectedRepo?.worktreePath || repoPath}
- branch: ${selectedRepo?.branch || 'unknown'}
- selected Salesforce org: ${targetOrgLabel}
- targetOrg value for sf commands: ${targetOrgValue}

Working directory instructions:
- Run Salesforce CLI commands inside the selected project Docker container, not on the host.
- Use the selected repo/worktree above as the working directory.
- Keep this read-only. Do not deploy, mutate data, execute anonymous Apex, open OAuth UI, or remediate automatically.

Goal:
${action.description}

Useful read-only commands to consider, adapting as needed:
${action.commands.map((command) => `- ${command.replaceAll('<targetOrg>', targetOrgValue)}`).join('\n')}

Run one or more safe Salesforce CLI/read-only repo inspection commands until you have a useful result. If a command fails or the result is too broad, adjust with another safe read-only command rather than stopping at the first failure. ${action.outcome}`;

    onRunGuidedAction(prompt);
  }

  if (!project) return null;

  if (!isSalesforce) {
    return (
      <div className="h-full overflow-auto p-3 space-y-3 text-xs bg-surface-850">
        <div className="flex items-center gap-2 text-surface-200 font-medium">
          <Cloud className="w-4 h-4 text-sky-400" />
          Salesforce
        </div>
        <p className="text-surface-500 leading-relaxed">
          Enable Salesforce mode to inspect org schema, discover CLI auth state, and build Salesforce-aware tooling for this project.
        </p>
        {repos.length > 0 && (
          <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)} className="select text-xs">
            <option value="">Select repo for detection...</option>
            {repos.map((repo) => <option key={repo.path} value={repo.path}>{repo.name}</option>)}
          </select>
        )}
        <div className="flex gap-2">
          <button onClick={markSalesforce} disabled={loading} className="btn-primary text-xs py-1.5 px-2">Enable</button>
          <button onClick={detectAndApply} disabled={loading} className="btn-secondary text-xs py-1.5 px-2">Detect</button>
        </div>
        {loading && <LoadingState label={loadingLabel || 'Working...'} />}
        {error && <SalesforceError error={error} projectName={selectedProjectLabel} repoPath={repoPath} orgLabel={selectedOrgLabel} />}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3 space-y-3 text-xs bg-surface-850">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-surface-200 font-medium">
          <Cloud className="w-4 h-4 text-sky-400" />
          Salesforce
        </div>
        <button onClick={loadStatus} disabled={loading} className="p-1 rounded hover:bg-surface-700 text-surface-400">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <select value={repoPath} onChange={(e) => setRepoPath(e.target.value)} className="select text-xs">
        <option value="">Select repo...</option>
        {repos.map((repo) => <option key={repo.path} value={repo.path}>{repo.name}</option>)}
      </select>

      {loading && <LoadingState label={loadingLabel || 'Working...'} />}

      {selectedOrgSummary?.orgType && ['production', 'unknown'].includes(selectedOrgSummary.orgType) && (
        <div className="flex items-start gap-2 p-2 rounded border border-yellow-500/30 bg-yellow-500/10 text-yellow-300">
          <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>{selectedOrgSummary.orgType === 'production' ? 'Production org selected. MVP operations are read-only.' : 'Unknown org type. Treat this org as high risk.'}</span>
        </div>
      )}

      <div className="flex items-center gap-1 rounded-md border border-surface-700 bg-surface-900/60 p-0.5 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-sky-600 text-white'
                  : 'text-surface-400 hover:text-surface-200 hover:bg-surface-800'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === 'status' && (
        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <StatusPill label="CLI" value={status?.cli?.available ? status.cli.version || 'ready' : 'missing'} ok={status?.cli?.available} />
            <StatusPill label="Org" value={orgConnected ? `${orgs.filter((org) => !org.isExpired).length} connected` : 'not connected'} ok={orgConnected} />
            <StatusPill label="Detect" value={status?.detection?.detectedStack || 'unknown'} ok={status?.detection?.detectedStack === 'salesforce'} />
            <StatusPill label="Container" value={status?.container?.name || 'required'} ok={status?.container?.running} />
          </div>
          {!cliAvailable && (
            <SetupCard title="1. Install Salesforce CLI in this project container">
              <p className="text-surface-500 leading-relaxed">Actions run inside the selected project Docker container. Install the CLI there before checking org data.</p>
              <button onClick={installCli} disabled={loading} className="btn-primary text-xs py-1.5 px-2 w-full">
                Install Salesforce CLI
              </button>
            </SetupCard>
          )}
          {cliAvailable && !orgConnected && (
            <SetupCard title="2. Connect an org with a host token">
              <p className="text-surface-500 leading-relaxed">Authenticate on your host browser, copy the SFDX auth URL, then paste it here. The app imports it into the CLI inside this container and does not save it to project records.</p>
              <label className="block space-y-1">
                <span className="text-surface-400">Alias</span>
                <input value={authAlias} onChange={(e) => setAuthAlias(e.target.value)} className="input text-xs font-mono" placeholder="default-org" />
              </label>
              <CopyCommand label="Host step 1" command={hostLoginCommand} />
              <CopyCommand label="Host step 2" command={hostTokenCommand} />
              <p className="text-surface-500 leading-relaxed">From the JSON output, copy <span className="font-mono text-surface-300">result.sfdxAuthUrl</span>. You can also paste the whole JSON output below.</p>
              <textarea
                value={authUrl}
                onChange={(e) => setAuthUrl(e.target.value)}
                rows={4}
                className="input text-xs font-mono resize-none"
                placeholder="force://... or full sf org display JSON"
              />
              <button onClick={importAuthUrl} disabled={!repoPath || !authUrl.trim() || loading} className="btn-primary text-xs py-1.5 px-2 w-full">
                Import Auth Into Container
              </button>
              {!repoPath && <p className="text-yellow-300">Select a repo first so the import uses explicit workspace context.</p>}
            </SetupCard>
          )}
          {cliAvailable && orgConnected && (
            <SetupCard title="Ready for guided actions">
              <p className="text-green-300">Salesforce CLI and org auth are ready. Pick a safe read-only action and the assistant will run the needed CLI checks through the existing orchestrator flow.</p>
            </SetupCard>
          )}
          {setupMessage && <p className="rounded border border-green-500/30 bg-green-500/10 p-2 text-green-300">{setupMessage}</p>}
          {status?.warnings?.map((warning) => <p key={warning} className="text-yellow-300">{warning}</p>)}
          {!repoPath && <p className="text-surface-500">Select a repo to keep Salesforce workspace context explicit.</p>}
          {!status && !loading && (
            <EmptyState title="Status has not loaded yet" message="Refresh Status to check the container, Salesforce CLI, and connected orgs." />
          )}
        </section>
      )}

      {cliAvailable && orgConnected && (
        <section className="space-y-2 border-t border-surface-700 pt-3">
          <div className="flex items-center gap-2 text-surface-200 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            Guided Actions
          </div>
          <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} className="select text-xs" disabled={orgs.length === 0}>
            <option value="">Select org...</option>
            {orgs.map((org) => <option key={org.targetOrg} value={org.targetOrg}>{org.alias || org.usernameRedacted} {org.isDefault ? '(default)' : ''}</option>)}
          </select>
          <div className="space-y-2">
            {GUIDED_ACTIONS.map((action) => (
              <button
                key={action.id}
                onClick={() => runGuidedAction(action)}
                disabled={!repoPath || !selectedOrg || loading || !onRunGuidedAction}
                className="w-full text-left rounded border border-surface-700 bg-surface-900/50 p-2 hover:border-sky-500/60 disabled:opacity-50 disabled:hover:border-surface-700"
              >
                <div className="text-surface-200 font-medium">{action.title}</div>
                <div className="text-surface-500 leading-relaxed mt-0.5">{action.description}</div>
              </button>
            ))}
          </div>
          {!repoPath && <p className="text-yellow-300">Select a repo so the orchestrator request includes explicit workspace context.</p>}
        </section>
      )}

      {activeTab === 'objects' && (
      <section className="space-y-2">
        <div className="flex items-center gap-2 text-surface-300 font-medium">
          <Database className="w-3.5 h-3.5" />
          Objects
        </div>
        <select value={selectedOrg} onChange={(e) => setSelectedOrg(e.target.value)} className="select text-xs" disabled={orgs.length === 0}>
          <option value="">Select org...</option>
          {orgs.map((org) => <option key={org.targetOrg} value={org.targetOrg}>{org.alias || org.usernameRedacted} {org.isDefault ? '(default)' : ''}</option>)}
        </select>
        <button onClick={loadObjects} disabled={!repoPath || !selectedOrg || loading} className="btn-secondary text-xs py-1.5 px-2 w-full">
          {loading && loadingLabel.includes('objects') ? 'Loading Objects...' : 'Load Objects'}
        </button>
        {(!repoPath || !selectedOrg) && (
          <EmptyState title="Choose a repo and org" message="Object browsing needs explicit workspace and target org context before it can run a read-only CLI command." />
        )}
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-2.5 text-surface-500" />
          <input value={filter} onChange={(e) => setFilter(e.target.value)} className="input text-xs pl-7" placeholder="Search objects" />
        </div>
        <div className="max-h-40 overflow-auto border border-surface-700 rounded">
          {filteredObjects.map((name) => (
            <button key={name} onClick={() => loadDescribe(name)} className={`block w-full text-left px-2 py-1 hover:bg-surface-750 ${selectedObject === name ? 'text-sky-300 bg-surface-800' : 'text-surface-300'}`}>
              {name}
            </button>
          ))}
          {objects.length === 0 && !loading && <div className="p-2 text-surface-500">No objects loaded yet. Select an org, then Load Objects.</div>}
          {objects.length > 0 && filteredObjects.length === 0 && <div className="p-2 text-surface-500">No objects match "{filter}".</div>}
        </div>
      </section>
      )}

      {activeTab === 'objects' && describe && (
        <section className="space-y-2 border-t border-surface-700 pt-3">
          <div className="text-surface-200 font-medium">{describe.name || selectedObject}</div>
          <div className="text-surface-500">{describe.label}</div>
          <div className="max-h-56 overflow-auto border border-surface-700 rounded">
            {(describe.fields || []).slice(0, 200).map((field) => (
              <div key={field.name} className="px-2 py-1 border-b border-surface-800 last:border-0">
                <div className="text-surface-200 font-mono">{field.name}</div>
                <div className="text-surface-500">{field.label} · {field.type}{field.nillable === false ? ' · required' : ''}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'soql' && (
      <section className="space-y-2 border-t border-surface-700 pt-3">
        <div className="text-surface-200 font-medium">SOQL Builder</div>
        <textarea
          value={soql}
          onChange={(e) => setSoql(e.target.value)}
          rows={4}
          className="input text-xs font-mono resize-none"
          placeholder="SELECT Id, Name FROM Account"
        />
        <button onClick={runSoql} disabled={!repoPath || !selectedOrg || loading} className="btn-primary text-xs py-1.5 px-2 w-full">
          {loading && loadingLabel.includes('SOQL') ? 'Running Query...' : 'Run Read-Only Query'}
        </button>
        {(!repoPath || !selectedOrg) && (
          <EmptyState title="Select a repo and org first" message="SOQL queries are read-only, but they still need an explicit workspace and target org." />
        )}
        {queryResult && (
          <div className="space-y-1">
            <div className="text-surface-500">{queryResult.totalSize} row(s)</div>
            <div className="max-h-48 overflow-auto border border-surface-700 rounded">
              <table className="min-w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-surface-850 text-surface-400">
                  <tr>{queryResult.columns.map((column) => <th key={column} className="px-2 py-1 border-b border-surface-700">{column}</th>)}</tr>
                </thead>
                <tbody>
                  {queryResult.rows.slice(0, 100).map((row, index) => (
                    <tr key={index} className="border-b border-surface-800 last:border-0">
                      {queryResult.columns.map((column) => <td key={column} className="px-2 py-1 text-surface-300 font-mono">{String(row[column] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      )}

      {activeTab === 'flows' && (
      <section className="space-y-2 border-t border-surface-700 pt-3">
        <div className="flex items-center gap-2 text-surface-200 font-medium">
          <GitPullRequestArrow className="w-3.5 h-3.5" />
          Flow Search
        </div>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-2.5 text-surface-500" />
          <input
            value={flowQuery}
            onChange={(e) => setFlowQuery(e.target.value)}
            className="input text-xs pl-7"
            placeholder="Search flow name, object, field, action"
          />
        </div>
        <button onClick={searchFlows} disabled={!repoPath || loading} className="btn-secondary text-xs py-1.5 px-2 w-full">
          {loading && loadingLabel.includes('flows') ? 'Searching Flows...' : 'Search Local Flows'}
        </button>
        {!repoPath && <EmptyState title="Select a repo first" message="Flow search reads local metadata from the selected project workspace." />}
        <div className="max-h-56 overflow-auto border border-surface-700 rounded">
          {flowResults.map((flow) => (
            <div key={`${flow.filePath}-${flow.fileHash}`} className="px-2 py-1.5 border-b border-surface-800 last:border-0">
              <div className="text-surface-200 font-medium">{flow.label || flow.flowName}</div>
              <div className="text-surface-500 font-mono truncate">{flow.filePath}</div>
              <div className="text-surface-500">
                {[...(flow.references?.objects || []), ...(flow.references?.fields || [])].slice(0, 4).join(' · ')}
              </div>
              {(flow.excerpts || []).slice(0, 2).map((line) => (
                <div key={line} className="text-[10px] text-surface-600 font-mono truncate">{line}</div>
              ))}
            </div>
          ))}
          {flowResults.length === 0 && !loading && <div className="p-2 text-surface-500">No flow results loaded. Search with a flow name, object, field, or leave blank to index local flows.</div>}
        </div>
      </section>
      )}

      {error && <SalesforceError error={error} projectName={selectedProjectLabel} repoPath={repoPath} orgLabel={selectedOrgLabel} />}
    </div>
  );
}

function LoadingState({ label }) {
  return (
    <div className="flex items-center gap-2 rounded border border-sky-500/30 bg-sky-500/10 p-2 text-sky-200">
      <RefreshCw className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="rounded border border-surface-700 bg-surface-900/40 p-2 text-surface-400">
      <div className="text-surface-200 font-medium">{title}</div>
      <div className="mt-0.5 leading-relaxed">{message}</div>
    </div>
  );
}

function SalesforceError({ error, projectName, repoPath, orgLabel }) {
  const friendly = friendlyError(error);
  if (!friendly) return null;

  return (
    <div className="space-y-2 rounded border border-danger-500/30 bg-danger-500/10 p-2 text-danger-400">
      <div className="flex items-start gap-2">
        <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-danger-400" />
        <div>
          <div className="font-medium text-danger-400">{friendly.title}</div>
          <div className="mt-0.5 leading-relaxed text-danger-400/90">{friendly.message}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-1 rounded bg-surface-950/50 p-2 text-[11px] text-surface-400">
        <div><span className="text-surface-500">Project:</span> {projectName}</div>
        <div><span className="text-surface-500">Repo:</span> {repoPath || 'None selected'}</div>
        <div><span className="text-surface-500">Org:</span> {orgLabel}</div>
        {error.code && <div><span className="text-surface-500">Code:</span> {error.code}</div>}
      </div>
      {friendly.tips?.length > 0 && (
        <div className="space-y-1 text-danger-400/90">
          {friendly.tips.map((tip) => <div key={tip}>- {tip}</div>)}
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, value, ok }) {
  return (
    <div className="rounded border border-surface-700 bg-surface-900/50 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-surface-500">{label}</div>
      <div className={ok ? 'text-green-300 truncate' : 'text-yellow-300 truncate'}>{value}</div>
    </div>
  );
}

function SetupCard({ title, children }) {
  return (
    <div className="space-y-2 rounded border border-surface-700 bg-surface-900/50 p-2">
      <div className="text-surface-200 font-medium">{title}</div>
      {children}
    </div>
  );
}

function CopyCommand({ label, command }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="text-surface-400">{label}</div>
      <button onClick={copy} className="w-full text-left rounded border border-surface-700 bg-surface-950 px-2 py-1.5 font-mono text-[11px] text-sky-300 hover:border-sky-500/60">
        {command}
      </button>
      {copied && <div className="text-green-300">Copied</div>}
    </div>
  );
}
