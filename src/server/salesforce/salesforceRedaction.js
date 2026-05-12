import { redactSecrets } from '../connections/redaction.js';

const SALESFORCE_PATTERNS = [
  /\b00D[A-Za-z0-9]{12,15}\b/g,
  /\b005[A-Za-z0-9]{12,15}\b/g,
  /https:\/\/[a-zA-Z0-9.-]+\.(?:my\.salesforce|lightning\.force)\.com[^\s"']*/g,
  /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}\b/gi,
  /(sid=)[A-Za-z0-9.!_-]+/gi,
  /("?(?:accessToken|refreshToken|sessionId)"?\s*[:=]\s*")[^"]+(")/gi,
];

export function redactSalesforceText(input) {
  if (input === null || input === undefined) return input;
  let text = redactSecrets(String(input));
  for (const pattern of SALESFORCE_PATTERNS) {
    text = text.replace(pattern, (...args) => {
      if (args.length >= 4 && typeof args[1] === 'string' && typeof args[2] === 'string') {
        return `${args[1]}[REDACTED]${args[2]}`;
      }
      if (args[1] && String(args[0]).startsWith(args[1])) return `${args[1]}[REDACTED]`;
      return '[REDACTED]';
    });
  }
  return text;
}

export function redactSalesforceObject(value) {
  if (typeof value === 'string') return redactSalesforceText(value);
  if (Array.isArray(value)) return value.map(redactSalesforceObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redactSalesforceObject(item)]),
    );
  }
  return value;
}

export function redactUsername(username) {
  if (!username || typeof username !== 'string') return username || null;
  const [local, domain] = username.split('@');
  if (!domain) return '[REDACTED]';
  return `${local.slice(0, 2)}***@${domain}`;
}
