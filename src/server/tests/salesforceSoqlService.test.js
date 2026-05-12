import assert from 'node:assert/strict';
import { validateReadOnlySoql } from '../salesforce/salesforceSoqlValidation.js';

assert.equal(
  validateReadOnlySoql('SELECT Id, Name FROM Account'),
  'SELECT Id, Name FROM Account LIMIT 200',
  'SELECT without limit should get default bounded limit',
);

assert.equal(
  validateReadOnlySoql('SELECT Id FROM Account LIMIT 50'),
  'SELECT Id FROM Account LIMIT 50',
  'SELECT with safe limit should be preserved',
);

assert.throws(
  () => validateReadOnlySoql('DELETE FROM Account'),
  /Only SELECT SOQL queries are allowed/,
  'Non-SELECT SOQL should be blocked',
);

assert.throws(
  () => validateReadOnlySoql('SELECT Id FROM Account; SELECT Id FROM Contact'),
  /Multiple SOQL statements are blocked/,
  'Multiple statements should be blocked',
);

assert.throws(
  () => validateReadOnlySoql('SELECT Id FROM Account LIMIT 5000'),
  /LIMIT must be 2000 or lower/,
  'Over-limit queries should be blocked',
);

console.log('salesforceSoqlService tests passed');
