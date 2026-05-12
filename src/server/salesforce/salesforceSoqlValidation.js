import { SalesforceApiError } from './salesforceErrors.js';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;

function limitFromQuery(query) {
  const match = query.match(/\blimit\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export function validateReadOnlySoql(query, { maxLimit = MAX_LIMIT } = {}) {
  if (!query || typeof query !== 'string') {
    throw new SalesforceApiError('INVALID_SOQL', 'SOQL query is required', 400);
  }
  const trimmed = query.trim();
  if (!/^select\b/i.test(trimmed)) {
    throw new SalesforceApiError('SOQL_NOT_READ_ONLY', 'Only SELECT SOQL queries are allowed', 400);
  }
  if (trimmed.includes(';')) {
    throw new SalesforceApiError('SOQL_MULTIPLE_STATEMENTS_BLOCKED', 'Multiple SOQL statements are blocked', 400);
  }
  if (/\b(insert|update|upsert|delete|undelete|merge|apex|anonymous)\b/i.test(trimmed)) {
    throw new SalesforceApiError('SOQL_NOT_READ_ONLY', 'Only read-only SELECT SOQL queries are allowed', 400);
  }

  const existingLimit = limitFromQuery(trimmed);
  if (existingLimit && existingLimit > maxLimit) {
    throw new SalesforceApiError('SOQL_LIMIT_TOO_HIGH', `SOQL LIMIT must be ${maxLimit} or lower`, 400);
  }
  return existingLimit ? trimmed : `${trimmed} LIMIT ${Math.min(DEFAULT_LIMIT, maxLimit)}`;
}
