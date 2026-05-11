const ENV_TARGETS = ['pty', 'shell-proxy', 'agent', 'scheduler', 'container-create'];

export const DANGEROUS_ENV_NAMES = new Set([
  'PATH',
  'HOME',
  'SHELL',
  'NODE_OPTIONS',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'BASH_ENV',
  'ENV',
  'PROMPT_COMMAND',
  'GIT_SSH_COMMAND',
  'DOCKER_HOST',
  'DOCKER_CONFIG',
  'npm_config_userconfig',
  'NPM_CONFIG_USERCONFIG',
]);

export const RISKY_ENV_NAMES = new Set([
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'SSL_CERT_FILE',
  'REQUESTS_CA_BUNDLE',
  'GIT_CONFIG_GLOBAL',
]);

export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]{1,100}$/;

function secretField(name, label, placeholder) {
  return { name, label, secret: true, required: true, placeholder };
}

function textField(name, label, defaultValue = '') {
  return { name, label, secret: false, required: false, defaultValue };
}

function envVariable(name, sourceField, targets = ENV_TARGETS) {
  return { name, sourceField, targets };
}

export const connectionProviders = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    category: 'ai',
    kind: 'application',
    supportedKinds: ['application', 'project-runtime'],
    supportedScopes: ['workspace', 'project'],
    docsUrl: 'https://platform.openai.com/api-keys',
    fields: [secretField('apiKey', 'API Key', 'sk-...')],
    nonSecretFields: [
      textField('endpoint', 'Endpoint', 'https://api.openai.com/v1'),
      textField('model', 'Model', 'gpt-4o-mini'),
    ],
    defaultEnvironment: { variables: [envVariable('OPENAI_API_KEY', 'apiKey')] },
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    category: 'ai',
    kind: 'application',
    supportedKinds: ['application', 'project-runtime'],
    supportedScopes: ['workspace', 'project'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
    fields: [secretField('apiKey', 'API Key', 'sk-ant-...')],
    nonSecretFields: [textField('model', 'Model', 'claude-sonnet-4-5')],
    defaultEnvironment: { variables: [envVariable('ANTHROPIC_API_KEY', 'apiKey')] },
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'ai',
    kind: 'application',
    supportedKinds: ['application', 'project-runtime'],
    supportedScopes: ['workspace', 'project'],
    docsUrl: 'https://platform.deepseek.com/api_keys',
    fields: [secretField('apiKey', 'API Key', 'sk-...')],
    nonSecretFields: [
      textField('endpoint', 'Endpoint', 'https://api.deepseek.com'),
      textField('model', 'Model', 'deepseek-chat'),
    ],
    defaultEnvironment: { variables: [envVariable('DEEPSEEK_API_KEY', 'apiKey')] },
  },
  github: {
    id: 'github',
    name: 'GitHub Token',
    category: 'git',
    kind: 'project-runtime',
    supportedKinds: ['application', 'project-runtime'],
    supportedScopes: ['workspace', 'project'],
    docsUrl: 'https://github.com/settings/tokens',
    fields: [secretField('token', 'Personal Access Token', 'github_pat_...')],
    nonSecretFields: [textField('purpose', 'Purpose', 'GitHub API and git tooling')],
    defaultEnvironment: { variables: [envVariable('GITHUB_TOKEN', 'token'), envVariable('GH_TOKEN', 'token')] },
  },
  npm: {
    id: 'npm',
    name: 'npm Token',
    category: 'package-manager',
    kind: 'project-runtime',
    supportedKinds: ['project-runtime'],
    supportedScopes: ['workspace', 'project'],
    docsUrl: 'https://www.npmjs.com/settings/tokens',
    fields: [secretField('token', 'Automation Token', 'npm_...')],
    nonSecretFields: [],
    defaultEnvironment: { variables: [envVariable('NPM_TOKEN', 'token'), envVariable('NODE_AUTH_TOKEN', 'token')] },
  },
  huggingface: {
    id: 'huggingface',
    name: 'Hugging Face',
    category: 'ai',
    kind: 'project-runtime',
    supportedKinds: ['project-runtime'],
    supportedScopes: ['workspace', 'project'],
    docsUrl: 'https://huggingface.co/settings/tokens',
    fields: [secretField('token', 'Access Token', 'hf_...')],
    nonSecretFields: [],
    defaultEnvironment: { variables: [envVariable('HF_TOKEN', 'token'), envVariable('HUGGINGFACE_HUB_TOKEN', 'token')] },
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    category: 'local',
    kind: 'local',
    supportedKinds: ['local'],
    supportedScopes: ['workspace'],
    docsUrl: 'https://ollama.com',
    fields: [],
    nonSecretFields: [textField('endpoint', 'Endpoint', 'http://localhost:11434')],
    defaultEnvironment: { variables: [] },
  },
  custom_env: {
    id: 'custom_env',
    name: 'Custom Environment Variable',
    category: 'custom',
    kind: 'project-runtime',
    supportedKinds: ['project-runtime'],
    supportedScopes: ['workspace', 'project'],
    fields: [secretField('value', 'Value', '')],
    nonSecretFields: [textField('name', 'Variable Name', '')],
    defaultEnvironment: { variables: [] },
  },
};

export function getProvider(providerId) {
  return connectionProviders[providerId] || null;
}

export function listProviders() {
  return Object.values(connectionProviders).map((provider) => ({
    ...provider,
    fields: provider.fields.map((field) => ({ ...field, secret: !!field.secret })),
  }));
}
