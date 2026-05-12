import assert from 'node:assert/strict';
import { flowMatches, parseFlowMetadata } from '../salesforce/salesforceFlowParser.js';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Flow>
  <label>Update Account Owner</label>
  <status>Active</status>
  <processType>AutoLaunchedFlow</processType>
  <recordUpdates>
    <name>Update_Account</name>
    <object>Account</object>
    <inputAssignments>
      <field>OwnerId</field>
    </inputAssignments>
  </recordUpdates>
  <subflows>
    <flowName>Shared_Account_Helper</flowName>
  </subflows>
</Flow>`;

const parsed = parseFlowMetadata(xml, './force-app/main/default/flows/Update_Account_Owner.flow-meta.xml');

assert.equal(parsed.flowName, 'Update_Account_Owner');
assert.equal(parsed.label, 'Update Account Owner');
assert.equal(parsed.status, 'Active');
assert.deepEqual(parsed.references.objects, ['Account']);
assert.deepEqual(parsed.references.fields, ['OwnerId']);
assert.deepEqual(parsed.references.subflows, ['Shared_Account_Helper']);

assert.equal(flowMatches(parsed, { q: 'owner' }), true, 'Free-text search should match label/field');
assert.equal(flowMatches(parsed, { object: 'Account' }), true, 'Object search should match references');
assert.equal(flowMatches(parsed, { field: 'OwnerId' }), true, 'Field search should match references');
assert.equal(flowMatches(parsed, { object: 'Opportunity' }), false, 'Wrong object should not match');

console.log('salesforceFlowParser tests passed');
