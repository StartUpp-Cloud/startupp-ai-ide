import { containerManager } from '../containerManager.js';

export const SALESFORCE_DETECTOR_VERSION = 'salesforce-detector-v1';

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

const SIGNALS = [
  { label: 'sfdx-project.json', test: "test -f sfdx-project.json", weight: 0.35 },
  { label: '.sf config', test: "test -d .sf", weight: 0.2 },
  { label: 'force-app/main/default', test: "test -d force-app/main/default", weight: 0.25 },
  { label: 'manifest/package.xml', test: "test -f manifest/package.xml", weight: 0.25 },
  { label: 'Apex class metadata', test: "find . -path './.git' -prune -o -name '*.cls-meta.xml' -print -quit | grep -q .", weight: 0.15 },
  { label: 'Apex trigger metadata', test: "find . -path './.git' -prune -o -name '*.trigger-meta.xml' -print -quit | grep -q .", weight: 0.15 },
  { label: 'Flow metadata', test: "find . -path './.git' -prune -o -name '*.flow-meta.xml' -print -quit | grep -q .", weight: 0.15 },
  { label: 'Object field metadata', test: "find . -path './.git' -prune -o -path '*/objects/*/fields/*.field-meta.xml' -print -quit | grep -q .", weight: 0.15 },
];

async function runTest(containerName, cwd, test) {
  const output = await containerManager.execInContainerAsync(
    containerName,
    `cd ${shellQuote(cwd)} && (${test}) && echo yes || true`,
    { timeout: 8000, maxBuffer: 64 * 1024 },
  );
  return output?.trim() === 'yes';
}

async function listDirs(containerName, cwd, command) {
  const output = await containerManager.execInContainerAsync(
    containerName,
    `cd ${shellQuote(cwd)} && ${command}`,
    { timeout: 8000, maxBuffer: 256 * 1024 },
  );
  return output ? output.split('\n').map((line) => line.trim()).filter(Boolean) : [];
}

export async function detectSalesforceProject(context) {
  const matched = [];
  let confidence = 0;

  for (const signal of SIGNALS) {
    if (await runTest(context.containerName, context.cwd, signal.test)) {
      matched.push(signal.label);
      confidence += signal.weight;
    }
  }

  confidence = Math.min(1, Number(confidence.toFixed(2)));
  const metadataRoots = await listDirs(
    context.containerName,
    context.cwd,
    "find . -path './.git' -prune -o -path '*/main/default' -type d -print 2>/dev/null | sed 's#^./##' | head -20",
  );
  const packageDirectories = await listDirs(
    context.containerName,
    context.cwd,
    "node -e \"try{const p=require('./sfdx-project.json'); console.log((p.packageDirectories||[]).map(d=>d.path).filter(Boolean).join('\\n'))}catch{}\"",
  );

  return {
    detectedStack: confidence >= 0.55 ? 'salesforce' : 'generic',
    confidence,
    signals: matched,
    detectedAt: new Date().toISOString(),
    detectorVersion: SALESFORCE_DETECTOR_VERSION,
    repoPath: context.worktreePath || context.repoPath || context.cwd,
    metadataRoots,
    packageDirectories,
  };
}
