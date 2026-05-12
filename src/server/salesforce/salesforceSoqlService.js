import { runSalesforceOperation } from './salesforceCommandService.js';
import { validateReadOnlySoql } from './salesforceSoqlValidation.js';

export { validateReadOnlySoql } from './salesforceSoqlValidation.js';

export async function runReadOnlySoql(context, targetOrg, query, options = {}) {
  const safeQuery = validateReadOnlySoql(query, options);
  const result = await runSalesforceOperation(context, 'soql.query', { targetOrg, query: safeQuery });
  const payload = result.json?.result || result.json || {};
  return {
    query: safeQuery,
    records: Array.isArray(payload.records) ? payload.records : [],
    totalSize: payload.totalSize || 0,
    done: payload.done !== false,
    auditId: result.auditId,
  };
}
