import assert from 'node:assert/strict';
import { NVM_SHELL_PRELUDE, npmGlobalInstall, withNodePath } from './npmShell.js';

assert.match(NVM_SHELL_PRELUDE, /unset NPM_CONFIG_PREFIX/);
assert.match(NVM_SHELL_PRELUDE, /nvm\.sh/);
assert.doesNotMatch(NVM_SHELL_PRELUDE, /NPM_CONFIG_PREFIX=/);

const install = npmGlobalInstall('@openai/codex', 'codex');
assert.match(install, /unset NPM_CONFIG_PREFIX/);
assert.match(install, /npm install -g @openai\/codex/);
assert.doesNotMatch(install, /\.npm-global\/bin:\$PATH/);
assert.doesNotMatch(install, /npm config set prefix/);

const login = withNodePath('codex login');
assert.match(login, /unset NPM_CONFIG_PREFIX/);
assert.match(login, /codex login/);
assert.match(login, /\$HOME\/\.npm-global\/bin/);

console.log('npmShell tests passed');
