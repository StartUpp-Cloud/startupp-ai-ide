import assert from 'node:assert/strict';
import {
  answerFlowQuestion,
  buildFlowQuestionPrompt,
  rankFlowsForQuestion,
  tokenizeFlowQuestion,
} from '../salesforce/salesforceFlowService.js';

const flowIndex = {
  flows: [
    {
      flowName: 'Update_Account_Owner',
      label: 'Update Account Owner',
      status: 'Active',
      processType: 'AutoLaunchedFlow',
      filePath: 'force-app/main/default/flows/Update_Account_Owner.flow-meta.xml',
      references: {
        objects: ['Account'],
        fields: ['OwnerId'],
        apexActions: [],
        subflows: ['Shared_Account_Helper'],
      },
      excerpts: ['11: <object>Account</object>', '13: <field>OwnerId</field>'],
    },
    {
      flowName: 'Notify_Opportunity_Team',
      label: 'Notify Opportunity Team',
      status: 'Active',
      processType: 'RecordTriggeredFlow',
      filePath: 'force-app/main/default/flows/Notify_Opportunity_Team.flow-meta.xml',
      references: {
        objects: ['Opportunity'],
        fields: ['StageName'],
        apexActions: ['SendApexNotification'],
        subflows: [],
      },
      excerpts: ['11: <object>Opportunity</object>'],
    },
  ],
  parseWarnings: [],
  indexedAt: '2026-05-12T00:00:00.000Z',
  cached: false,
};

assert.deepEqual(tokenizeFlowQuestion('Which flows update Account.OwnerId?'), ['update', 'account', 'owner', 'id']);

const ranked = rankFlowsForQuestion(flowIndex.flows, 'Which flows touch Account OwnerId or call Shared_Account_Helper?');
assert.equal(ranked[0].flowName, 'Update_Account_Owner');
assert.ok(ranked[0].matchScore > ranked[1]?.matchScore || ranked.length === 1);

const prompt = buildFlowQuestionPrompt('Find Account owner flows', ranked, flowIndex);
assert.match(prompt, /using only this local metadata/i);
assert.match(prompt, /Do not suggest Salesforce org mutations/i);
assert.match(prompt, /Update_Account_Owner/);

let llmPrompt = '';
const llmResult = await answerFlowQuestion(
  { projectId: 'project-1', cwd: '/workspace/repo' },
  { question: 'Find flows that update Account OwnerId' },
  {
    indexer: async () => flowIndex,
    llm: {
      async generateResponse(input, context) {
        llmPrompt = input;
        assert.equal(context.temperature, 0.1);
        return { response: 'Update_Account_Owner updates Account.OwnerId.', provider: 'test', model: 'stub' };
      },
    },
  },
);

assert.equal(llmResult.llmUsed, true);
assert.equal(llmResult.provider, 'test');
assert.match(llmPrompt, /Update_Account_Owner/);
assert.equal(llmResult.candidates[0].flowName, 'Update_Account_Owner');

const fallbackResult = await answerFlowQuestion(
  { projectId: 'project-1', cwd: '/workspace/repo' },
  { question: 'Find Opportunity notification Apex actions' },
  {
    indexer: async () => flowIndex,
    llm: {
      async generateResponse() {
        throw new Error('LLM unavailable');
      },
    },
  },
);

assert.equal(fallbackResult.llmUsed, false);
assert.match(fallbackResult.answer, /Notify_Opportunity_Team/);
assert.match(fallbackResult.fallbackReason, /LLM unavailable/);

await assert.rejects(
  () => answerFlowQuestion({}, { question: '   ' }, { indexer: async () => flowIndex }),
  /question is required/,
);

console.log('salesforceFlowAi tests passed');
