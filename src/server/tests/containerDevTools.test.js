import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEV_TOOL_PACKAGES,
  XDG_OPEN_MARKER,
  XDG_OPEN_SCRIPT,
  WRANGLER_OAUTH_PORT,
  buildEnsureDevToolsCommand,
  OAUTH_PROXY_SCRIPT,
  buildOauthPublishCommand,
  oauthSidecarName,
} from '../containerDevTools.js';

assert.ok(DEV_TOOL_PACKAGES.includes('xdg-utils'));
assert.ok(DEV_TOOL_PACKAGES.includes('procps'));
assert.match(XDG_OPEN_SCRIPT, new RegExp(XDG_OPEN_MARKER));
assert.match(XDG_OPEN_SCRIPT, /exit 0/);
assert.match(XDG_OPEN_SCRIPT, /sai-last-open-url/);
assert.match(XDG_OPEN_SCRIPT, new RegExp(String(WRANGLER_OAUTH_PORT)));
assert.match(XDG_OPEN_SCRIPT, /device-code login/);
assert.match(OAUTH_PROXY_SCRIPT, /create_connection/);

const dockerfile = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../docker/Dockerfile.dev'),
  'utf8',
);
for (const pkg of DEV_TOOL_PACKAGES) {
  assert.match(dockerfile, new RegExp(`\\b${pkg}\\b`), `Dockerfile.dev must install ${pkg}`);
}
assert.match(dockerfile, new RegExp(XDG_OPEN_MARKER));

const ensure = buildEnsureDevToolsCommand();
assert.match(ensure, /xdg-utils/);
assert.match(ensure, /base64 -d/);
assert.match(ensure, /\/usr\/local\/bin\/xdg-open/);
assert.match(ensure, /oauth-proxy\.py/);

assert.equal(oauthSidecarName('sai-honeygrid-8db109f3'), 'sai-oauth-sai-honeygrid-8db109f3');
assert.match(
  buildOauthPublishCommand('sai-honeygrid-8db109f3', {
    image: 'startupp-ai-ide-dev:latest',
    targetIp: '172.18.0.4',
  }),
  new RegExp(`-p ${WRANGLER_OAUTH_PORT}:${WRANGLER_OAUTH_PORT}`),
);
assert.match(
  buildOauthPublishCommand('sai-honeygrid-8db109f3', {
    image: 'startupp-ai-ide-dev:latest',
    targetIp: '172.18.0.4',
  }),
  /sai-honeygrid-8db109f3-home/,
);

console.log('containerDevTools tests passed');
