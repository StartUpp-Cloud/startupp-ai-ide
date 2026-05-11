import { listConnections } from '../sqliteStore.js';
import { decryptWithResult } from '../fieldEncryption.js';

const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bnpm_[A-Za-z0-9_-]{16,}\b/g,
  /\bhf_[A-Za-z0-9]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/g,
  /\bxapp-[A-Za-z0-9-]{16,}\b/g,
  /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|GITHUB_TOKEN|GH_TOKEN|NPM_TOKEN|NODE_AUTH_TOKEN|HF_TOKEN|HUGGINGFACE_HUB_TOKEN)=([^\s'"`]+)/g,
  /("(?:apiKey|token|secret|password)"\s*:\s*")[^"]+(")/gi,
  /(Authorization:\s*Bearer\s+)[^\s]+/gi,
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getKnownSecrets() {
  const secrets = [];
  try {
    for (const connection of listConnections({ includeDisconnected: false })) {
      for (const encrypted of Object.values(connection.encryptedFields || {})) {
        const result = decryptWithResult(encrypted);
        if (result.ok && typeof result.value === 'string' && result.value.length >= 8) {
          secrets.push(result.value);
        }
      }
    }
  } catch {
    // Redaction must never break the caller.
  }
  return [...new Set(secrets)];
}

export function redactSecrets(input, { extraSecrets = [], includeKnownSecrets = true } = {}) {
  if (input === null || input === undefined) return input;
  let text = String(input);
  const secrets = includeKnownSecrets ? getKnownSecrets() : [];
  for (const secret of [...secrets, ...extraSecrets]) {
    if (typeof secret === 'string' && secret.length >= 8) {
      text = text.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
    }
  }
  for (const pattern of TOKEN_PATTERNS) {
    text = text.replace(pattern, (...args) => {
      if (args.length >= 4 && typeof args[1] === 'string' && typeof args[2] === 'string') {
        return `${args[1]}[REDACTED]${args[2]}`;
      }
      if (args[0]?.includes('=')) return args[0].replace(/=.*/, '=[REDACTED]');
      if (/Authorization:/i.test(args[0])) return args[0].replace(/Bearer\s+\S+/i, 'Bearer [REDACTED]');
      return '[REDACTED]';
    });
  }
  return text;
}

export function redactObject(value) {
  if (typeof value === 'string') return redactSecrets(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactObject(item)]));
  }
  return value;
}
