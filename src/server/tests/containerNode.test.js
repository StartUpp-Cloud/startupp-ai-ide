import assert from 'node:assert/strict';
import {
  NODE_KICKSTART_MAJOR,
  SAI_NVM_MARKER,
  SAI_NODE_KICKSTART_FILE,
  NVM_DIR,
  NPM_GLOBAL_DIR,
  containerNodeShellPrelude,
  buildEnsureNvmCommand,
  buildCodexAppServerCommand,
} from '../containerNode.js';

assert.equal(NODE_KICKSTART_MAJOR, '22');

const prelude = containerNodeShellPrelude();
assert.match(prelude, /unset NPM_CONFIG_PREFIX/);
assert.match(prelude, new RegExp(NVM_DIR.replace(/\//g, '\\/')));
assert.match(prelude, /nvm\.sh/);
assert.match(prelude, new RegExp(NPM_GLOBAL_DIR.replace(/\//g, '\\/')));

const ensure = buildEnsureNvmCommand();
assert.match(ensure, /unset NPM_CONFIG_PREFIX/);
assert.match(ensure, /install\.sh/);
assert.match(ensure, /alias\/default/);
assert.match(ensure, /nvm install/);
assert.match(ensure, /nvm alias default/);
assert.match(ensure, new RegExp(SAI_NODE_KICKSTART_FILE.replace(/\//g, '\\/')));
assert.match(ensure, /npm-global\\\/bin/);
assert.match(ensure, /prefix=.*npm-global/);
assert.match(ensure, /base64 -d/);
assert.match(ensure, new RegExp(SAI_NVM_MARKER));
assert.doesNotMatch(ensure, /export NPM_CONFIG_PREFIX=/);

const alreadyDefault = buildEnsureNvmCommand();
assert.match(alreadyDefault, /if \[ ! -s "\$NVM_DIR\/alias\/default" \]/);

const codexCmd = buildCodexAppServerCommand();
assert.match(codexCmd, /unset NPM_CONFIG_PREFIX/);
assert.match(codexCmd, /command -v codex/);
assert.match(codexCmd, /app-server --stdio/);
assert.doesNotMatch(codexCmd, /export NPM_CONFIG_PREFIX=/);

console.log('containerNode tests passed');
