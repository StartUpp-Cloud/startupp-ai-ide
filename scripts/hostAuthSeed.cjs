/**
 * Copy small host CLI auth files into sai-ide at /root/host-auth.
 *
 * The IDE container cannot see Windows $USERPROFILE. Project containers cannot
 * see sai-ide /root either. Seeding here is the bridge: compose-host runs on
 * the real host, then the IDE copies /root/host-auth into a project on demand.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IDE_AUTH_ROOT = '/root/host-auth';

const TOOL_FILES = {
  gh: ['hosts.yml', 'config.yml'],
  wrangler: ['config/default.toml', 'config.toml', 'default.toml'],
  codex: ['auth.json', 'models_cache.json'],
  opencode: ['auth.json', 'mcp-auth.json'],
  claude: ['.credentials.json'],
};

function hostCandidates({ home, appData }) {
  return {
    gh: [
      path.join(home, '.config', 'gh'),
      appData ? path.join(appData, 'GitHub CLI') : null,
    ].filter(Boolean),
    wrangler: [
      path.join(home, '.config', '.wrangler'),
      path.join(home, '.wrangler'),
      appData ? path.join(appData, '.wrangler') : null,
      // Windows npm/xdg: %APPDATA%\xdg.config\.wrangler\config\default.toml
      appData ? path.join(appData, 'xdg.config', '.wrangler') : null,
    ].filter(Boolean),
    codex: [path.join(home, '.codex')],
    opencode: [path.join(home, '.local', 'share', 'opencode')],
    claude: [path.join(home, '.claude')],
  };
}

/**
 * @param {string} tool
 * @param {string} rel
 */
function hostAuthIdeDest(tool, rel) {
  return `${IDE_AUTH_ROOT}/${tool}/${String(rel).replace(/\\/g, '/')}`;
}

/**
 * Live-bind host Wrangler config into sai-ide so a host `wrangler login`
 * shows up without waiting for the next compose seed snapshot.
 * @param {{ home?: string, appData?: string, exists?: Function }} [opts]
 * @returns {string[]} docker run --mount args (empty when no host login file)
 */
function hostAuthMountArgs({
  home = os.homedir(),
  appData = process.env.APPDATA || '',
  exists = fs.existsSync,
} = {}) {
  const wranglerDirs = hostCandidates({ home, appData }).wrangler;
  const wranglerSrc = wranglerDirs.find((dir) => exists(path.join(dir, 'config', 'default.toml')));
  if (!wranglerSrc) return [];
  return [
    '--mount',
    `type=bind,src=${wranglerSrc},dst=${IDE_AUTH_ROOT}/wrangler,readonly`,
  ];
}

/**
 * @param {{ token: string, user: string }} params
 */
function ghHostsContents({ token, user }) {
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

function writeGhHostsFile(filePath, { token, user }) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, ghHostsContents({ token, user }), { encoding: 'utf8', mode: 0o600 });
  return filePath;
}

/**
 * @param {{ home: string, appData?: string, exists?: Function }} opts
 */
function collectHostAuthFiles({
  home,
  appData = '',
  exists = fs.existsSync,
} = {}) {
  const collected = [];
  const candidates = hostCandidates({ home, appData });
  for (const [tool, dirs] of Object.entries(candidates)) {
    const rels = TOOL_FILES[tool] || [];
    for (const dir of dirs) {
      for (const rel of rels) {
        const src = path.join(dir, rel);
        if (!exists(src)) continue;
        collected.push({ tool, rel, src });
      }
    }
  }
  return collected;
}

function runSilent(command, args, extra = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    ...extra,
  });
}

function readHostGhIdentity() {
  const tokenResult = runSilent('gh', ['auth', 'token']);
  const token = String(tokenResult.stdout || '').trim();
  if (tokenResult.status !== 0 || !token) return null;
  const userResult = runSilent('gh', ['api', 'user', '-q', '.login']);
  const user = String(userResult.stdout || '').trim() || 'dev';
  return { token, user };
}

function dockerCp(docker, env, src, dest) {
  const result = runSilent(docker, ['cp', src, dest], { env });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'docker cp failed').trim());
  }
}

/**
 * @param {{
 *   docker?: string,
 *   env?: NodeJS.ProcessEnv,
 *   container?: string,
 *   home?: string,
 *   appData?: string,
 *   log?: Function,
 * }} [opts]
 */
function seedHostAuthIntoIde({
  docker = 'docker',
  env = process.env,
  container = 'sai-ide',
  home = os.homedir(),
  appData = process.env.APPDATA || '',
  log = (msg) => process.stderr.write(`${msg}\n`),
} = {}) {
  const mkdir = runSilent(docker, [
    'exec', container, 'mkdir', '-p',
    `${IDE_AUTH_ROOT}/gh`,
    `${IDE_AUTH_ROOT}/wrangler`,
    `${IDE_AUTH_ROOT}/codex`,
    `${IDE_AUTH_ROOT}/opencode`,
    `${IDE_AUTH_ROOT}/claude`,
  ], { env });
  if (mkdir.status !== 0) {
    log(`host auth seed skipped: ${(mkdir.stderr || mkdir.stdout || 'sai-ide is not running').trim()}`);
    return { ok: false, copied: 0 };
  }

  let copied = 0;
  for (const file of collectHostAuthFiles({ home, appData })) {
    try {
      const dest = hostAuthIdeDest(file.tool, file.rel);
      const destDir = dest.slice(0, dest.lastIndexOf('/'));
      runSilent(docker, ['exec', container, 'mkdir', '-p', destDir], { env });
      dockerCp(docker, env, file.src, `${container}:${dest}`);
      copied += 1;
    } catch (error) {
      log(`host auth seed skipped ${file.tool}/${file.rel}: ${error.message}`);
    }
  }

  try {
    const identity = readHostGhIdentity();
    if (identity) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-gh-seed-'));
      const hostsPath = path.join(tmpDir, 'hosts.yml');
      try {
        writeGhHostsFile(hostsPath, identity);
        dockerCp(docker, env, hostsPath, `${container}:${hostAuthIdeDest('gh', 'hosts.yml')}`);
        copied += 1;
      } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  } catch (error) {
    log(`host auth GitHub token export skipped: ${error.message}`);
  }

  log(`host auth seeded ${copied} file(s) into ${container}:${IDE_AUTH_ROOT}`);
  return { ok: copied > 0, copied };
}

module.exports = {
  IDE_AUTH_ROOT,
  collectHostAuthFiles,
  hostAuthIdeDest,
  hostAuthMountArgs,
  writeGhHostsFile,
  ghHostsContents,
  seedHostAuthIntoIde,
};

if (require.main === module) {
  try {
    seedHostAuthIntoIde();
  } catch (error) {
    console.error(error.message || error);
    process.exit(1);
  }
}
