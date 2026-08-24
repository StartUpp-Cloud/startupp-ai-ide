const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  collectHostAuthFiles,
  hostAuthIdeDest,
  hostAuthMountArgs,
  writeGhHostsFile,
} = require('../../../scripts/hostAuthSeed.cjs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-host-auth-seed-'));
const home = path.join(tmp, 'home');
const appData = path.join(tmp, 'appdata');
fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
fs.mkdirSync(path.join(home, '.local', 'share', 'opencode'), { recursive: true });
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
fs.mkdirSync(path.join(appData, 'GitHub CLI'), { recursive: true });
fs.mkdirSync(path.join(appData, 'xdg.config', '.wrangler', 'config'), { recursive: true });
fs.mkdirSync(path.join(appData, 'xdg.config', '.wrangler', 'logs'), { recursive: true });
fs.writeFileSync(path.join(appData, 'xdg.config', '.wrangler', 'config', 'default.toml'), 'oauth_token = "test"\n');
fs.writeFileSync(path.join(appData, 'xdg.config', '.wrangler', 'logs', 'wrangler.log'), 'skip\n');
fs.mkdirSync(path.join(home, '.codex', 'sessions'), { recursive: true });
fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{"ok":true}');
fs.writeFileSync(path.join(home, '.codex', 'sessions', 'big.json'), '{"skip":true}');
fs.writeFileSync(path.join(home, '.local', 'share', 'opencode', 'auth.json'), '{"ok":true}');
fs.writeFileSync(path.join(home, '.claude', '.credentials.json'), '{"ok":true}');
fs.writeFileSync(path.join(appData, 'GitHub CLI', 'hosts.yml'), 'github.com:\n    user: demo\n');
fs.writeFileSync(path.join(appData, 'GitHub CLI', 'config.yml'), 'git_protocol: https\n');

const files = collectHostAuthFiles({
  home,
  appData,
  exists: fs.existsSync,
});

assert.ok(files.some((f) => f.tool === 'codex' && f.rel === 'auth.json'));
assert.ok(!files.some((f) => String(f.rel).includes('sessions')));
assert.ok(files.some((f) => f.tool === 'opencode' && f.rel === 'auth.json'));
assert.ok(files.some((f) => f.tool === 'claude' && f.rel === '.credentials.json'));
assert.ok(files.some((f) => f.tool === 'gh' && f.rel === 'hosts.yml'));
assert.ok(files.some((f) => f.tool === 'wrangler' && f.rel === 'config/default.toml'));
assert.ok(!files.some((f) => String(f.rel).includes('logs')));
assert.equal(hostAuthIdeDest('codex', 'auth.json'), '/root/host-auth/codex/auth.json');

const wranglerHost = path.join(appData, 'xdg.config', '.wrangler');
const mounts = hostAuthMountArgs({ home, appData, exists: fs.existsSync });
assert.equal(mounts.length, 2);
assert.equal(mounts[0], '--mount');
assert.match(mounts[1], /type=bind/);
assert.match(mounts[1], /readonly/);
assert.ok(mounts[1].includes(wranglerHost) || mounts[1].includes(wranglerHost.replace(/\\/g, '/')));
assert.match(mounts[1], /dst=\/root\/host-auth\/wrangler/);

const hostsPath = path.join(tmp, 'hosts.yml');
writeGhHostsFile(hostsPath, { token: 'gho_TESTONLYTOKEN', user: 'demo' });
const written = fs.readFileSync(hostsPath, 'utf8');
assert.match(written, /oauth_token:\s+gho_TESTONLYTOKEN/);
assert.match(written, /user:\s+demo/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('hostAuthSeed tests passed');
