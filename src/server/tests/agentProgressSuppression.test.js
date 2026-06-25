/**
 * Verifies transient progress messages are suppressed (checklist-only UX),
 * while persisted progress and errors still flow.
 */
import assert from 'node:assert/strict';
import { shouldEmitProgress } from '../agentGateway.js';

assert.equal(shouldEmitProgress({ transient: true }), false, 'transient chatter is suppressed');
assert.equal(shouldEmitProgress({ transient: false }), true, 'persisted progress still emits');
assert.equal(shouldEmitProgress({}), true, 'defaults to emitting (non-transient)');
