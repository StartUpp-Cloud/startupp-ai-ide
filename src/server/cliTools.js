/**
 * CLI Tools Configuration
 * Defines available AI CLI tools and how to invoke them
 */

export const CLI_TOOLS = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    command: 'claude',
    args: ['--print'],
    description: 'Anthropic Claude Code CLI',
    installCheck: 'claude --version',
    promptFlag: null, // prompt passed as positional arg
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    command: 'gh',
    args: ['copilot', 'suggest', '-t', 'shell'],
    description: 'GitHub Copilot CLI',
    installCheck: 'gh copilot --version',
    promptFlag: null,
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    command: 'gemini',
    args: [],
    description: 'Google Gemini CLI',
    installCheck: 'gemini --version',
    promptFlag: null,
  },
  aider: {
    id: 'aider',
    name: 'Aider',
    command: 'aider',
    args: ['--message'],
    description: 'AI pair programming CLI',
    installCheck: 'aider --version',
    promptFlag: '--message',
  },
  custom: {
    id: 'custom',
    name: 'Custom Command',
    command: null, // user provides full command
    args: [],
    description: 'Run any custom CLI command',
    installCheck: null,
    promptFlag: null,
  },
};

/**
 * Build the command array for a given tool and prompt
 */
export function buildCommand(toolId, prompt, customCommand = null) {
  if (toolId === 'custom' && customCommand) {
    return { command: customCommand, args: [] };
  }

  const tool = CLI_TOOLS[toolId];
  if (!tool) {
    throw new Error(`Unknown CLI tool: ${toolId}`);
  }

  const args = [...tool.args];

  if (tool.promptFlag) {
    args.push(tool.promptFlag, prompt);
  } else {
    args.push(prompt);
  }

  return { command: tool.command, args };
}

/**
 * Get shell command for the current OS
 */
export function getShellConfig() {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    return {
      shell: 'powershell.exe',
      shellArgs: ['-NoProfile', '-Command'],
    };
  }

  return {
    shell: process.env.SHELL || '/bin/sh',
    shellArgs: ['-c'],
  };
}

/**
 * Sanitize input to prevent command injection
 */
export function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove or escape dangerous characters
  // Allow most characters but escape shell metacharacters
  return input
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

export default CLI_TOOLS;
