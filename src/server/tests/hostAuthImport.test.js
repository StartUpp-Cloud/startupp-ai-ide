import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HOST_AUTH_TOOLS,
  buildGhHostsYml,
  ghHostsHasFileToken,
  importHostAuth,
  listHostAuthStatus,
  resolveToolSource,
  wranglerConfigUsable,
} from '../hostAuthImport.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sai-host-auth-'));
const hostAuthDir = path.join(tmp, 'host-auth');
const homedir = path.join(tmp, 'root');
fs.mkdirSync(path.join(hostAuthDir, 'gh'), { recursive: true });
fs.mkdirSync(path.join(hostAuthDir, 'codex'), { recursive: true });
fs.mkdirSync(path.join(homedir, '.codex'), { recursive: true });
fs.mkdirSync(path.join(homedir, '.config', 'gh'), { recursive: true });

const keyringHosts = [
  'github.com:',
  '    git_protocol: https',
  '    users:',
  '        renzodupont:',
  '    user: renzodupont',
  '',
].join('\n');
fs.writeFileSync(path.join(homedir, '.config', 'gh', 'hosts.yml'), keyringHosts);
fs.writeFileSync(path.join(hostAuthDir, 'gh', 'hosts.yml'), buildGhHostsYml({
  token: 'gho_TESTONLYTOKEN',
  user: 'renzodupont',
}));
fs.writeFileSync(path.join(hostAuthDir, 'codex', 'auth.json'), '{"token":"test"}');
fs.writeFileSync(path.join(homedir, '.codex', 'auth.json'), '{"token":"ide"}');

assert.equal(ghHostsHasFileToken(keyringHosts), false);
assert.equal(ghHostsHasFileToken(buildGhHostsYml({ token: 'gho_TESTONLYTOKEN', user: 'dev' })), true);
assert.equal(ghHostsHasFileToken('oauth_token: \n'), false);
assert.equal(wranglerConfigUsable('oauth_token = "ok"\n').ok, true);
assert.equal(wranglerConfigUsable('oauth_token = "ok"\nexpiration_time = "2099-01-01T00:00:00.000Z"\n').ok, true);
assert.equal(wranglerConfigUsable('oauth_token = "ok"\nexpiration_time = "2020-01-01T00:00:00.000Z"\n').ok, false);
assert.match(wranglerConfigUsable('oauth_token = "ok"\nexpiration_time = "2020-01-01T00:00:00.000Z"\n').warning, /expired/i);
assert.equal(
  wranglerConfigUsable('oauth_token = "ok"\nexpiration_time = "2020-01-01T00:00:00.000Z"\nrefresh_token = "r"\n').ok,
  true,
  'access-token expiry is not a logout when Wrangler can refresh',
);
assert.equal(wranglerConfigUsable('refresh_token = "r"\n').ok, true);
assert.equal(
  wranglerConfigUsable(
    'oauth_token = "ok"\nexpiration_time = "2020-01-01T00:00:00.000Z"\nrefresh_token = "r"\nrefresh_token_expiration_time = "2020-01-01T00:00:00.000Z"\n',
  ).ok,
  false,
);

const ghFromBind = resolveToolSource('gh', { homedir, hostAuthDir });
assert.equal(ghFromBind.available, true);
assert.equal(ghFromBind.source, 'bind');
assert.ok(ghFromBind.dir.endsWith(path.join('host-auth', 'gh')));

const ghIdeOnly = resolveToolSource('gh', {
  homedir,
  hostAuthDir: path.join(tmp, 'missing-bind'),
});
assert.equal(ghIdeOnly.available, false);
assert.match(ghIdeOnly.warning, /Credential Manager|keyring|file token/i);

const codex = resolveToolSource('codex', { homedir, hostAuthDir });
assert.equal(codex.available, true);
assert.equal(codex.source, 'bind');

const wranglerMissing = resolveToolSource('wrangler', { homedir, hostAuthDir });
assert.equal(wranglerMissing.available, false);
assert.match(wranglerMissing.warning, /Wrangler/i);

fs.mkdirSync(path.join(hostAuthDir, 'wrangler', 'config'), { recursive: true });
fs.mkdirSync(path.join(hostAuthDir, 'wrangler', 'logs'), { recursive: true });
fs.writeFileSync(path.join(hostAuthDir, 'wrangler', 'config', 'default.toml'), 'oauth_token = "test"\nexpiration_time = "2099-01-01T00:00:00.000Z"\n');
fs.writeFileSync(path.join(hostAuthDir, 'wrangler', 'logs', 'wrangler.log'), 'skip\n');

const wrangler = resolveToolSource('wrangler', { homedir, hostAuthDir });
assert.equal(wrangler.available, true);
assert.equal(wrangler.source, 'bind');

const status = listHostAuthStatus({ homedir, hostAuthDir });
assert.deepEqual(status.map((t) => t.id).sort(), HOST_AUTH_TOOLS.map((t) => t.id).sort());
assert.equal(status.find((t) => t.id === 'gh').available, true);
assert.equal(status.find((t) => t.id === 'wrangler').available, true);
assert.ok(!JSON.stringify(status).includes('gho_TESTONLYTOKEN'));

const copied = [];
const execs = [];
const result = await importHostAuth({
  containerName: 'sai-demo',
  tools: ['gh', 'codex', 'wrangler'],
  homedir,
  hostAuthDir,
  copyFn: (localPath, containerName, destPath) => {
    copied.push({ localPath, containerName, destPath });
    assert.ok(fs.existsSync(path.join(localPath, 'config', 'default.toml')) || destPath !== '/home/dev/.config/.wrangler');
    assert.ok(!fs.existsSync(path.join(localPath, 'logs', 'wrangler.log')));
    return destPath;
  },
  execFn: (containerName, command) => {
    execs.push({ containerName, command });
    return '';
  },
});

assert.equal(result.ok, true);
assert.equal(result.imported.find((t) => t.id === 'gh').ok, true);
assert.equal(result.imported.find((t) => t.id === 'codex').ok, true);
assert.equal(result.imported.find((t) => t.id === 'wrangler').ok, true);
assert.equal(copied.length, 3);
assert.ok(copied.every((c) => c.containerName === 'sai-demo'));
assert.ok(copied.some((c) => c.destPath === '/home/dev/.config/gh'));
assert.ok(copied.some((c) => c.destPath === '/home/dev/.codex'));
assert.ok(copied.some((c) => c.destPath === '/home/dev/.config/.wrangler'));
assert.ok(copied.every((c) => !String(c.localPath).includes('sessions')));
assert.ok(execs.some((e) => /chown/.test(e.command) && /dev:dev/.test(e.command)));
assert.ok(execs.some((e) => /gh auth setup-git/.test(e.command)));
assert.ok(!JSON.stringify(result).includes('gho_TESTONLYTOKEN'));

fs.writeFileSync(
  path.join(hostAuthDir, 'wrangler', 'config', 'default.toml'),
  'oauth_token = "test"\nexpiration_time = "2020-01-01T00:00:00.000Z"\nrefresh_token = "r"\n',
);
const wranglerRefreshable = resolveToolSource('wrangler', { homedir, hostAuthDir });
assert.equal(wranglerRefreshable.available, true);

fs.writeFileSync(
  path.join(hostAuthDir, 'wrangler', 'config', 'default.toml'),
  'oauth_token = "test"\nexpiration_time = "2020-01-01T00:00:00.000Z"\n',
);
const wranglerExpired = resolveToolSource('wrangler', { homedir, hostAuthDir });
assert.equal(wranglerExpired.available, false);
assert.match(wranglerExpired.warning, /expired/i);

const skipped = await importHostAuth({
  containerName: 'sai-demo',
  tools: ['nope'],
  homedir,
  hostAuthDir,
  copyFn: () => { throw new Error('should not copy'); },
  execFn: () => '',
});
assert.equal(skipped.ok, false);
assert.match(skipped.imported[0].error, /Unknown tool/i);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('hostAuthImport tests passed');
