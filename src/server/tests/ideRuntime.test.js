import assert from 'node:assert/strict';
import { checkIdeRuntime, COMPOSE_HINT } from '../ideRuntime.js';

assert.deepEqual(checkIdeRuntime({ SAI_IN_CONTAINER: '1' }), { ok: true });
assert.deepEqual(checkIdeRuntime({ SAI_ALLOW_HOST: '1' }), { ok: true });

const blocked = checkIdeRuntime({});
assert.equal(blocked.ok, false);
assert.match(blocked.message, /npm run pm2:start/);
assert.equal(blocked.message, COMPOSE_HINT);

console.log('ideRuntime tests passed');
