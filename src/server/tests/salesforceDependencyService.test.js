import assert from 'node:assert/strict';
import {
  analyzeMetadataReferences,
  analyzeSalesforceDependency,
  buildDependencyPlanPrompt,
} from '../salesforce/salesforceDependencyService.js';

const files = [
  {
    filePath: './force-app/main/default/objects/Account/fields/Legacy_Field__c.field-meta.xml',
    content: `<CustomField>
  <fullName>Legacy_Field__c</fullName>
  <label>Legacy Field</label>
</CustomField>`,
  },
  {
    filePath: './force-app/main/default/flows/Update_Account.flow-meta.xml',
    content: `<Flow>
  <label>Update Account</label>
  <status>Active</status>
  <recordUpdates>
    <object>Account</object>
    <inputAssignments>
      <field>Legacy_Field__c</field>
    </inputAssignments>
  </recordUpdates>
</Flow>`,
  },
  {
    filePath: './force-app/main/default/classes/AccountSelector.cls',
    content: `public with sharing class AccountSelector {
  public static List<Account> rows() {
    return [SELECT Id, Legacy_Field__c FROM Account];
  }
}`,
  },
  {
    filePath: './force-app/main/default/layouts/Account-Account Layout.layout-meta.xml',
    content: `<Layout>
  <layoutItems>
    <field>Legacy_Field__c</field>
  </layoutItems>
</Layout>`,
  },
  {
    filePath: './force-app/main/default/flows/Account_Only.flow-meta.xml',
    content: `<Flow><recordLookups><object>Account</object></recordLookups></Flow>`,
  },
];

const analysis = analyzeMetadataReferences(files, { objectName: 'Account', fieldName: 'Legacy_Field__c' });

assert.equal(analysis.target.objectName, 'Account');
assert.equal(analysis.target.fieldName, 'Legacy_Field__c');
assert.equal(analysis.referenceCount, 4, 'Object-only references should not be counted for field deletion');
assert.equal(analysis.risk, 'blocking');
assert.equal(analysis.references[0].type, 'fieldDefinition');
assert.equal(analysis.references[0].risk, 'blocking');
assert.ok(analysis.references.some((entry) => entry.type === 'flow' && entry.risk === 'high'));
assert.ok(analysis.references.some((entry) => entry.type === 'apexClass' && entry.risk === 'high'));
assert.ok(analysis.references.some((entry) => entry.type === 'layout' && entry.risk === 'medium'));
assert.ok(analysis.suggestedRemovalOrder.some((step) => step.includes('flow')));
assert.ok(analysis.verificationSteps.some((step) => step.includes('Re-run dependency analysis')));

const prompt = buildDependencyPlanPrompt(analysis);
assert.match(prompt, /Deterministic local metadata evidence/);
assert.match(prompt, /Keep it read-only/);
assert.match(prompt, /Legacy_Field__c/);

let llmPrompt = '';
const llmResult = await analyzeSalesforceDependency(
  { projectId: 'project-1', cwd: '/workspace/repo' },
  { objectName: 'Account', fieldName: 'Legacy_Field__c' },
  {
    indexer: async () => ({ files, parseWarnings: [], indexedAt: '2026-05-12T00:00:00.000Z', cached: false }),
    llm: {
      async generateResponse(input, context) {
        llmPrompt = input;
        assert.equal(context.temperature, 0.1);
        return { response: 'Remove layout, flow, Apex, then field metadata after verification.', provider: 'test', model: 'stub' };
      },
    },
  },
);

assert.equal(llmResult.llmUsed, true);
assert.equal(llmResult.provider, 'test');
assert.match(llmPrompt, /Account\.Legacy_Field__c/);
assert.match(llmResult.plan, /Remove layout/);

const fallbackResult = await analyzeSalesforceDependency(
  { projectId: 'project-1', cwd: '/workspace/repo' },
  { objectName: 'Account', fieldName: 'Legacy_Field__c' },
  {
    indexer: async () => ({ files, parseWarnings: [], indexedAt: '2026-05-12T00:00:00.000Z', cached: false }),
    llm: {
      async generateResponse() {
        throw new Error('LLM unavailable');
      },
    },
  },
);

assert.equal(fallbackResult.llmUsed, false);
assert.match(fallbackResult.plan, /Risk: blocking/);
assert.match(fallbackResult.fallbackReason, /LLM unavailable/);

assert.throws(() => analyzeMetadataReferences(files, { fieldName: 'Legacy_Field__c' }), /objectName is required/);
assert.throws(() => analyzeMetadataReferences(files, { objectName: 'Account' }), /fieldName is required/);

console.log('salesforceDependencyService tests passed');
