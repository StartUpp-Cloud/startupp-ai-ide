import assert from 'node:assert/strict';
import { isPlausibleToml, mergeManagedCodexToml } from '../codexToml.js';

assert.equal(isPlausibleToml('# ok\nmodel = "gpt-5"\n'), true);
assert.equal(isPlausibleToml(''), false);
assert.equal(isPlausibleToml('for shortcuts\n\u0000\u0001binary'), false);
assert.equal(isPlausibleToml('bad \uFFFD toml'), false);

const block = '[mcp_servers.context7]\ncommand = "npx"\n';
assert.equal(mergeManagedCodexToml('\x00\x01', block).includes('mcp_servers.context7'), true);
assert.equal(mergeManagedCodexToml('\x00\x01', block).includes('\x00'), false);

const once = mergeManagedCodexToml('# user\nmodel = "gpt-5"\n', block);
const twice = mergeManagedCodexToml(once, '[mcp_servers.other]\ncommand = "npx"\n');
assert.equal((twice.match(/sai-managed-mcp >>>/g) || []).length, 1);
assert.equal(twice.includes('mcp_servers.other'), true);
assert.equal(twice.includes('mcp_servers.context7'), false);
assert.match(twice, /^# user\nmodel = "gpt-5"/);

console.log('codexToml tests passed');
