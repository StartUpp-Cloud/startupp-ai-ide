import assert from 'node:assert/strict';
import { formatGoalContract, normalizeGoalContract } from '../goalContract.js';

const contract = normalizeGoalContract({
  content: 'Implement the login flow',
  acceptanceCriteria: ['Users can sign in', 'Tests pass'],
  verificationCommands: ['npm test'],
  targetWorkspace: '/workspace/app',
});

assert.equal(contract.version, 1);
assert.equal(contract.objective, 'Implement the login flow');
assert.deepEqual(contract.acceptanceCriteria, ['Users can sign in', 'Tests pass']);
assert.deepEqual(contract.verificationCommands, ['npm test']);
assert.equal(contract.criteriaSpecified, true);
assert.match(formatGoalContract(contract), /Target workspace: \/workspace\/app/);

const empty = normalizeGoalContract({ content: '  ' });
assert.equal(empty.criteriaSpecified, false);
assert.match(formatGoalContract(empty), /Acceptance criteria: \(not specified/);

console.log('goalContract tests passed');
