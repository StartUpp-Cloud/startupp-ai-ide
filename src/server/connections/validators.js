import { redactSecrets } from './redaction.js';

async function requestJson(url, { headers = {}, timeout = 10000 } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) {
      return {
        ok: false,
        code: response.status === 401 || response.status === 403 ? 'auth_failed' : 'request_failed',
        message: redactSecrets(json?.error?.message || json?.message || `HTTP ${response.status}`),
      };
    }
    return { ok: true, json };
  } catch (error) {
    return {
      ok: false,
      code: error.name === 'AbortError' ? 'timeout' : 'request_failed',
      message: error.name === 'AbortError' ? 'Validation timed out' : redactSecrets(error.message),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function validateConnection(providerId, fields, config = {}) {
  switch (providerId) {
    case 'openai':
      return validateOpenAI(fields, config);
    case 'anthropic':
      return validateAnthropic(fields, config);
    case 'deepseek':
      return validateDeepSeek(fields, config);
    case 'github':
      return validateGitHub(fields);
    case 'npm':
      return validateNpm(fields);
    case 'huggingface':
      return validateHuggingFace(fields);
    case 'ollama':
      return validateOllama(config);
    case 'custom_env':
      return { ok: true, code: 'validated', message: 'Environment variable is configured' };
    default:
      return { ok: false, code: 'unsupported', message: 'Provider validation is not supported' };
  }
}

async function validateOpenAI(fields, config) {
  const endpoint = (config.endpoint || 'https://api.openai.com/v1').replace(/\/$/, '');
  return requestJson(`${endpoint}/models`, {
    headers: { Authorization: `Bearer ${fields.apiKey}` },
  });
}

async function validateAnthropic(fields) {
  return requestJson('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': fields.apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
}

async function validateDeepSeek(fields, config) {
  const endpoint = (config.endpoint || 'https://api.deepseek.com').replace(/\/$/, '');
  return requestJson(`${endpoint}/models`, {
    headers: { Authorization: `Bearer ${fields.apiKey}` },
  });
}

async function validateGitHub(fields) {
  return requestJson('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${fields.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
}

async function validateNpm(fields) {
  return requestJson('https://registry.npmjs.org/-/whoami', {
    headers: { Authorization: `Bearer ${fields.token}` },
  });
}

async function validateHuggingFace(fields) {
  return requestJson('https://huggingface.co/api/whoami-v2', {
    headers: { Authorization: `Bearer ${fields.token}` },
  });
}

async function validateOllama(config) {
  const endpoint = (config.endpoint || 'http://localhost:11434').replace(/\/$/, '');
  return requestJson(`${endpoint}/api/tags`, { timeout: 5000 });
}
