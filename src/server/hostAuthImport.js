/**
 * Copy host / IDE-container CLI auth files into a project container.
 *
 * Project shells are sibling containers with their own /home/dev volumes.
 * Ubuntu-on-the-metal hid that: browser + gh + the workspace shared one $HOME.
 * Here we copy only the small auth files (never session histories).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyIntoContainer } from './dockerCopy.js';

export const HOST_AUTH_TOOLS = [
  {
    id: 'gh',
    label: 'GitHub',
    destDir: '/home/dev/.config/gh',
    files: ['hosts.yml', 'config.yml'],
    marker: 'hosts.yml',
    sourceRel: [['.config', 'gh']],
  },
  {
    id: 'wrangler',
    label: 'Wrangler',
    destDir: '/home/dev/.config/.wrangler',
    files: ['config/default.toml'],
    marker: 'config/default.toml',
    sourceRel: [['.config', '.wrangler'], ['.wrangler']],
  },
  {
    id: 'codex',
    label: 'Codex',
    destDir: '/home/dev/.codex',
    files: ['auth.json', 'models_cache.json'],
    marker: 'auth.json',
    sourceRel: [['.codex']],
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    destDir: '/home/dev/.local/share/opencode',
    files: ['auth.json', 'mcp-auth.json'],
    marker: 'auth.json',
    sourceRel: [['.local', 'share', 'opencode']],
  },
  {
    id: 'claude',
    label: 'Claude',
    destDir: '/home/dev/.claude',
    files: ['.credentials.json'],
    marker: '.credentials.json',
    sourceRel: [['.claude']],
  },
];

const TOOL_BY_ID = new Map(HOST_AUTH_TOOLS.map((tool) => [tool.id, tool]));

const GH_NO_FILE_TOKEN =
  'GitHub CLI on this host stores the token in a keyring / Credential Manager. Re-export it with Share host auth after the IDE seeds a file token, or run Login to GitHub (device code) in this shell.';

const WRANGLER_MISSING =
  'No Wrangler login found on the host or IDE. Use Login to Cloudflare in this shell (OAuth sidecar on port 8976).';

const WRANGLER_EXPIRED =
  'Host Wrangler OAuth expired and could not be refreshed. Run wrangler login on the host (or Login to Cloudflare in this shell), then click Wrangler again.';

const GH_HOME = '/home/dev';
const GH_GITCONFIG = `${GH_HOME}/.gitconfig`;
const GH_CONFIG_DIR = `${GH_HOME}/.config/gh`;
const GH_CREDENTIAL_HOSTS = ['github.com', 'gist.github.com'];

/**
 * Configure git so HTTPS GitHub remotes use the copied `gh` token.
 *
 * Project containers are `USER dev`. `docker exec` without `-u root` is
 * already that user, so `su`/`chown` fail and a swallowed `gh auth setup-git`
 * never writes `~/.gitconfig`. Write the credential helper directly.
 */
export function ghGitCredentialScript() {
  const hostLoop = GH_CREDENTIAL_HOSTS.map((host) => {
    const key = `credential.https://${host}.helper`;
    return [
      `git config --file ${GH_GITCONFIG} --unset-all ${key} || true`,
      `git config --file ${GH_GITCONFIG} ${key} ""`,
      `git config --file ${GH_GITCONFIG} --add ${key} "!$GH_BIN auth git-credential"`,
    ].join('\n');
  }).join('\n');

  return [
    `export HOME=${GH_HOME}`,
    `export GH_CONFIG_DIR=${GH_CONFIG_DIR}`,
    `export XDG_CONFIG_HOME=${GH_HOME}/.config`,
    'GH_BIN="$(command -v gh || echo /usr/bin/gh)"',
    hostLoop,
    'gh auth setup-git || true',
    `chown dev:dev ${GH_GITCONFIG} 2>/dev/null || true`,
  ].join('\n');
}

/**
 * Same setup, encoded so `execInContainerAsync` quote-escaping cannot
 * drop `!` or nested quotes.
 */
export function buildGhGitCredentialCommand() {
  const b64 = Buffer.from(ghGitCredentialScript(), 'utf8').toString('base64');
  return `echo '${b64}' | base64 -d | bash`;
}

function tomlQuoted(text, key) {
  const match = String(text || '').match(new RegExp(`${key}\\s*=\\s*"(\\S+)"`));
  return match && match[1] && match[1] !== 'null' ? match[1] : '';
}

function tomlTimeMs(text, key) {
  const match = String(text || '').match(new RegExp(`${key}\\s*=\\s*"([^"]+)"`));
  if (!match) return null;
  const ms = Date.parse(match[1]);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * @param {{ token: string, user: string }} params
 */
export function buildGhHostsYml({ token, user }) {
  const login = String(user || 'dev').trim() || 'dev';
  const oauth = String(token || '').trim();
  return [
    'github.com:',
    '    git_protocol: https',
    '    users:',
    `        ${login}:`,
    `            oauth_token: ${oauth}`,
    `    user: ${login}`,
    `    oauth_token: ${oauth}`,
    '',
  ].join('\n');
}

/**
 * True when default.toml still has a Wrangler login Wrangler itself can use.
 * `expiration_time` is the short-lived access token (~1h). Wrangler refreshes
 * that with `refresh_token`; treating access expiry as "logged out" is wrong.
 * @param {string} content
 */
export function wranglerConfigUsable(content) {
  const text = String(content || '');
  const hasOauth = Boolean(tomlQuoted(text, 'oauth_token'));
  const hasRefresh = Boolean(tomlQuoted(text, 'refresh_token'));
  if (!hasOauth && !hasRefresh) {
    return { ok: false, warning: WRANGLER_MISSING };
  }

  const now = Date.now();
  const accessExp = tomlTimeMs(text, 'expiration_time');
  const refreshExp = tomlTimeMs(text, 'refresh_token_expiration_time');
  const accessAlive = hasOauth && (accessExp == null || accessExp > now);
  const refreshAlive = hasRefresh && (refreshExp == null || refreshExp > now);
  if (accessAlive || refreshAlive) {
    return { ok: true, warning: null };
  }
  return { ok: false, warning: WRANGLER_EXPIRED };
}

/**
 * True when hosts.yml contains a usable file-backed token (not keyring-only).
 * @param {string} content
 */
export function ghHostsHasFileToken(content) {
  const match = String(content || '').match(/^\s*oauth_token:\s*(\S+)/m);
  return Boolean(match && match[1] && match[1] !== 'null' && match[1] !== '""');
}

function defaultDirs() {
  return {
    homedir: os.homedir(),
    hostAuthDir: process.env.HOST_AUTH_DIR || '/host-auth',
  };
}

function candidateDirs(tool, { homedir, hostAuthDir }) {
  return [
    path.join(hostAuthDir, tool.id),
    path.join(homedir, 'host-auth', tool.id),
    ...tool.sourceRel.map((parts) => path.join(homedir, ...parts)),
  ];
}

function sourceKind(dir, { homedir, hostAuthDir }) {
  const bindRoot = path.resolve(hostAuthDir);
  const seededRoot = path.resolve(homedir, 'host-auth');
  const resolved = path.resolve(dir);
  if (resolved === bindRoot || resolved.startsWith(bindRoot + path.sep)) return 'bind';
  if (resolved === seededRoot || resolved.startsWith(seededRoot + path.sep)) return 'seeded';
  return 'ide';
}

function dirHasAnyFile(dir, existsFn, statFn) {
  if (!existsFn(dir)) return false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.some((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isFile()) return existsFn(full);
      if (entry.isDirectory()) return dirHasAnyFile(full, existsFn, statFn);
      return false;
    });
  } catch {
    try {
      return statFn(dir).isFile();
    } catch {
      return false;
    }
  }
}

function toolReady(tool, dir, { existsFn, readFn }) {
  if (!existsFn(dir)) {
    return { ready: false, warning: tool.id === 'wrangler' ? WRANGLER_MISSING : `${tool.label} login files were not found.` };
  }
  if (tool.id === 'gh') {
    const hosts = path.join(dir, 'hosts.yml');
    if (!existsFn(hosts)) {
      return { ready: false, warning: `${tool.label} hosts.yml was not found.` };
    }
    let content = '';
    try { content = readFn(hosts); } catch { content = ''; }
    if (!ghHostsHasFileToken(content)) {
      return { ready: false, warning: GH_NO_FILE_TOKEN };
    }
    return { ready: true };
  }
  if (tool.marker) {
    const marker = path.join(dir, tool.marker);
    if (!existsFn(marker)) {
      return { ready: false, warning: `${tool.label} ${tool.marker} was not found.` };
    }
    if (tool.id === 'wrangler') {
      let content = '';
      try { content = readFn(marker); } catch { content = ''; }
      const check = wranglerConfigUsable(content);
      if (!check.ok) return { ready: false, warning: check.warning };
    }
    return { ready: true };
  }
  if (!dirHasAnyFile(dir, existsFn, fs.statSync)) {
    return { ready: false, warning: tool.id === 'wrangler' ? WRANGLER_MISSING : `${tool.label} login files were not found.` };
  }
  return { ready: true };
}

/**
 * @param {string} toolId
 * @param {{ homedir?: string, hostAuthDir?: string, existsFn?: Function, readFn?: Function }} [opts]
 */
export function resolveToolSource(toolId, opts = {}) {
  const tool = TOOL_BY_ID.get(toolId);
  const dirs = { ...defaultDirs(), ...opts };
  const existsFn = opts.existsFn || fs.existsSync;
  const readFn = opts.readFn || ((filePath) => fs.readFileSync(filePath, 'utf8'));
  if (!tool) {
    return { id: toolId, label: toolId, available: false, source: null, dir: null, warning: 'Unknown tool', tool: null };
  }

  let lastWarning = tool.id === 'wrangler' ? WRANGLER_MISSING : `${tool.label} login files were not found.`;
  for (const dir of candidateDirs(tool, dirs)) {
    const check = toolReady(tool, dir, { existsFn, readFn });
    if (check.ready) {
      return {
        id: tool.id,
        label: tool.label,
        available: true,
        source: sourceKind(dir, dirs),
        dir,
        warning: null,
        tool,
      };
    }
    if (existsFn(dir) && check.warning) lastWarning = check.warning;
  }
  return {
    id: tool.id,
    label: tool.label,
    available: false,
    source: null,
    dir: null,
    warning: lastWarning,
    tool,
  };
}

/**
 * @param {{ homedir?: string, hostAuthDir?: string }} [opts]
 */
export function listHostAuthStatus(opts = {}) {
  return HOST_AUTH_TOOLS.map((tool) => {
    const resolved = resolveToolSource(tool.id, opts);
    return {
      id: resolved.id,
      label: resolved.label,
      available: resolved.available,
      source: resolved.source,
      warning: resolved.warning,
    };
  });
}

function stageCopyDir(srcDir, files, existsFn) {
  if (!files) return srcDir;
  const present = files.filter((rel) => existsFn(path.join(srcDir, rel)));
  if (present.length === 0) return null;
  // Always stage listed files so we never copy sessions/, cache/, or node_modules.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-auth-stage-'));
  for (const rel of present) {
    const dest = path.join(staging, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(srcDir, rel), dest);
  }
  return staging;
}

/**
 * Copy selected tool auth files into a running project container.
 * @param {{
 *   containerName: string,
 *   tools: string[],
 *   homedir?: string,
 *   hostAuthDir?: string,
 *   copyFn?: Function,
 *   execFn?: Function,
 *   existsFn?: Function,
 * }} params
 */
export async function importHostAuth({
  containerName,
  tools,
  homedir,
  hostAuthDir,
  copyFn = copyIntoContainer,
  execFn,
  existsFn = fs.existsSync,
} = {}) {
  if (!containerName) {
    return { ok: false, imported: [], error: 'Project container is not running' };
  }

  const requested = Array.isArray(tools) && tools.length
    ? tools.map((id) => String(id || '').trim()).filter(Boolean)
    : HOST_AUTH_TOOLS.map((tool) => tool.id);

  const imported = [];
  const dirs = { homedir: homedir || os.homedir(), hostAuthDir: hostAuthDir || process.env.HOST_AUTH_DIR || '/host-auth' };
  const chownTargets = [];
  let copiedAny = false;

  for (const toolId of requested) {
    if (!TOOL_BY_ID.has(toolId)) {
      imported.push({ id: toolId, ok: false, error: `Unknown tool: ${toolId}` });
      continue;
    }
    const resolved = resolveToolSource(toolId, { ...dirs, existsFn });
    if (!resolved.available) {
      imported.push({
        id: resolved.id,
        label: resolved.label,
        ok: false,
        warning: resolved.warning,
      });
      continue;
    }

    const staged = stageCopyDir(resolved.dir, resolved.tool.files, existsFn);
    if (!staged) {
      imported.push({
        id: resolved.id,
        label: resolved.label,
        ok: false,
        warning: resolved.warning || `${resolved.label} login files were not found.`,
      });
      continue;
    }

    try {
      await copyFn(staged, containerName, resolved.tool.destDir);
      chownTargets.push(resolved.tool.destDir);
      copiedAny = true;
      imported.push({
        id: resolved.id,
        label: resolved.label,
        ok: true,
        dest: resolved.tool.destDir,
        source: resolved.source,
      });
    } catch (error) {
      imported.push({
        id: resolved.id,
        label: resolved.label,
        ok: false,
        error: error.message || String(error),
      });
    } finally {
      if (staged !== resolved.dir) {
        try { fs.rmSync(staged, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  if (copiedAny && typeof execFn === 'function') {
    const unique = [...new Set(chownTargets)];
    await execFn(
      containerName,
      `chown -R dev:dev ${unique.join(' ')} 2>/dev/null || true`,
    );
    if (imported.some((item) => item.id === 'gh' && item.ok)) {
      await execFn(containerName, buildGhGitCredentialCommand());
    }
  }

  return {
    ok: imported.some((item) => item.ok),
    imported,
  };
}
