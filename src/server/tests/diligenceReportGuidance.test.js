import assert from 'node:assert/strict';
import { FINAL_REPORT_GUIDANCE, buildOperatingContract } from '../diligence.js';

assert.doesNotMatch(
  FINAL_REPORT_GUIDANCE,
  /Write the FINAL message in past tense/i,
  'Final reports must not be forced into past tense',
);
assert.doesNotMatch(
  FINAL_REPORT_GUIDANCE,
  /this shape/i,
  'Final reports must not prescribe a fixed markdown template',
);
assert.doesNotMatch(
  FINAL_REPORT_GUIDANCE,
  /##\s*Outcome/,
  'Final reports must not require Outcome/Details headings',
);
assert.match(
  FINAL_REPORT_GUIDANCE,
  /Choose the shape from THIS turn/i,
  'The agent should pick a report shape from the conversation, not a preset layout',
);
assert.match(
  FINAL_REPORT_GUIDANCE,
  /Match tense to what is actually true/i,
);
assert.match(
  FINAL_REPORT_GUIDANCE,
  /need something from the user/i,
);
assert.match(
  FINAL_REPORT_GUIDANCE,
  /recommended safe default/i,
);
assert.match(
  FINAL_REPORT_GUIDANCE,
  /show choices as buttons/i,
);
assert.match(
  FINAL_REPORT_GUIDANCE,
  /findings, recommendations/i,
);

const contract = buildOperatingContract({ tool: 'claude', mode: 'agent' });
assert.match(contract, /Choose the shape from THIS turn/i);
assert.match(contract, /need something from the user/i);

console.log('diligenceReportGuidance tests passed');
