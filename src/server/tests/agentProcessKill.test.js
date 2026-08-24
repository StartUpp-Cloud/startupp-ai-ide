import assert from 'node:assert/strict';
import {
  buildContainerKillArgs,
  extractInnerPid,
  killRegisteredAgentProcesses,
  stripInnerPidLines,
} from '../agentProcessKill.js';

const marker = 'SAI_INNER_PID_abc';
assert.equal(extractInnerPid(`foo\n${marker}:4321\nbar`, marker), 4321);
assert.equal(extractInnerPid('no pid here', marker), null);
assert.equal(
  stripInnerPidLines(`SAI_INNER_PID_abc:1166\n{"type":"thread.started"}\n`),
  '{"type":"thread.started"}\n',
);

const args = buildContainerKillArgs('sai-honeygrid-8db109f3', 4321);
assert.deepEqual(args.slice(0, 3), ['exec', 'sai-honeygrid-8db109f3', 'bash']);
assert.match(args.at(-1), /kill -TERM -- -4321/);
assert.match(args.at(-1), /kill -KILL -- -4321/);

const killed = [];
const execs = [];
killRegisteredAgentProcesses({
  processes: [
    {
      child: { killed: false, kill(signal) { killed.push(signal); } },
      containerName: 'sai-honeygrid-8db109f3',
      innerPid: 99,
    },
  ],
  execFn: (cmd) => { execs.push(cmd); },
  now: () => 0,
  later: () => {},
});

assert.deepEqual(killed, ['SIGTERM']);
assert.equal(execs.length, 1);
assert.match(execs[0], /docker exec sai-honeygrid-8db109f3/);

console.log('agentProcessKill tests passed');
