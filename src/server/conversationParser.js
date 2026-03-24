/**
 * Conversation Parser
 * Parses terminal output to extract conversation turns
 * Supports Claude Code, Copilot, and other AI CLI tools
 */

// ANSI escape code stripper
export function stripAnsi(str) {
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
}

// Patterns for detecting conversation turns
const PATTERNS = {
  claude: {
    userPrompt: /^(?:>|❯|\$)\s*(.+)/m,
    assistantStart: /^(?:Claude|Assistant|🤖):/m,
    toolUse: /^(?:Running|Executing|Reading|Writing|Searching):/m,
    thinking: /^(?:Thinking|Analyzing|Processing)\.\.\./m,
  },
  copilot: {
    userPrompt: /^(?:>|❯)\s*(.+)/m,
    assistantStart: /^(?:Copilot|GitHub Copilot):/m,
  },
  aider: {
    userPrompt: /^(?:>|aider>)\s*(.+)/m,
    assistantStart: /^(?:Aider|Assistant):/m,
  },
  generic: {
    userPrompt: /^(?:>|❯|\$|>>>)\s*(.+)/m,
    assistantStart: /^(?:AI|Assistant|Bot|Response):/m,
  },
};

/**
 * Parse a chunk of terminal output and extract conversation entries
 */
export function parseTerminalOutput(text, cliTool = 'generic') {
  const cleanText = stripAnsi(text);
  const patterns = PATTERNS[cliTool] || PATTERNS.generic;
  const entries = [];

  // Split by lines and analyze
  const lines = cleanText.split('\n');
  let currentRole = null;
  let currentContent = [];
  let inCodeBlock = false;

  for (const line of lines) {
    // Track code blocks
    if (line.includes('```')) {
      inCodeBlock = !inCodeBlock;
    }

    // Detect user input (prompt)
    if (!inCodeBlock && patterns.userPrompt?.test(line)) {
      // Save previous entry if exists
      if (currentRole && currentContent.length > 0) {
        entries.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
        });
      }

      const match = line.match(patterns.userPrompt);
      currentRole = 'user';
      currentContent = [match ? match[1] : line];
      continue;
    }

    // Detect assistant response start
    if (!inCodeBlock && patterns.assistantStart?.test(line)) {
      if (currentRole && currentContent.length > 0) {
        entries.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
        });
      }

      currentRole = 'assistant';
      currentContent = [line.replace(patterns.assistantStart, '').trim()];
      continue;
    }

    // Detect tool use
    if (!inCodeBlock && patterns.toolUse?.test(line)) {
      if (currentRole && currentContent.length > 0 && currentRole !== 'tool') {
        entries.push({
          role: currentRole,
          content: currentContent.join('\n').trim(),
        });
      }

      currentRole = 'tool';
      currentContent = [line];
      continue;
    }

    // Continue current entry
    if (currentRole) {
      currentContent.push(line);
    }
  }

  // Save last entry
  if (currentRole && currentContent.length > 0) {
    entries.push({
      role: currentRole,
      content: currentContent.join('\n').trim(),
    });
  }

  return entries.filter(e => e.content.length > 0);
}

/**
 * Buffer manager for accumulating terminal output
 * Useful for detecting complete conversation turns
 */
export class OutputBuffer {
  constructor(cliTool = 'generic') {
    this.cliTool = cliTool;
    this.buffer = '';
    this.lastFlush = Date.now();
    this.flushTimeout = null;
    this.onEntries = null;
  }

  setCLITool(tool) {
    this.cliTool = tool;
  }

  setOnEntries(callback) {
    this.onEntries = callback;
  }

  /**
   * Add data to buffer
   */
  append(data) {
    this.buffer += data;
    this.lastFlush = Date.now();

    // Clear existing timeout
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }

    // Set new flush timeout (parse after 500ms of inactivity)
    this.flushTimeout = setTimeout(() => {
      this.flush();
    }, 500);
  }

  /**
   * Force flush and parse buffer
   */
  flush() {
    if (this.buffer.length === 0) return [];

    const entries = parseTerminalOutput(this.buffer, this.cliTool);

    if (entries.length > 0 && this.onEntries) {
      this.onEntries(entries);
    }

    this.buffer = '';
    return entries;
  }

  /**
   * Clear buffer without parsing
   */
  clear() {
    this.buffer = '';
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
    }
  }
}

/**
 * Detect if text contains a user message being sent
 * (Useful for tracking when user sends input)
 */
export function detectUserInput(text) {
  const cleanText = stripAnsi(text);

  // Check for common patterns that indicate user pressed enter
  const patterns = [
    /\n$/,  // Ends with newline
    /^.+\r?\n$/m,  // Single line with newline
  ];

  return patterns.some(p => p.test(cleanText));
}

/**
 * Extract summary from conversation entries
 */
export function summarizeConversation(entries, maxLength = 200) {
  if (entries.length === 0) return null;

  const userEntries = entries.filter(e => e.role === 'user');
  const assistantEntries = entries.filter(e => e.role === 'assistant');

  const firstUserMessage = userEntries[0]?.content?.substring(0, maxLength) || '';
  const lastAssistantMessage = assistantEntries[assistantEntries.length - 1]?.content?.substring(0, maxLength) || '';

  return {
    topic: firstUserMessage,
    lastResponse: lastAssistantMessage,
    turns: Math.min(userEntries.length, assistantEntries.length),
    totalMessages: entries.length,
  };
}

export default {
  stripAnsi,
  parseTerminalOutput,
  OutputBuffer,
  detectUserInput,
  summarizeConversation,
};
