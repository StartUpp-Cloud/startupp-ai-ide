/**
 * mcpRegistry — curated MCP (Model Context Protocol) servers provisioned into
 * every project container so the CLI agents (Claude Code, Codex, OpenCode) have
 * powerful tools available out of the box, regardless of which model is used.
 *
 * Servers are launched via `npx -y <pkg>` so they always pull the latest version
 * and need no pre-install. Keep this list small, high-signal, and broadly safe.
 */

export const MCP_SERVERS = [
  {
    id: 'context7',
    name: 'Context7 (up-to-date docs)',
    description: 'Live, version-accurate documentation & code examples for libraries and frameworks — so agents use the LATEST APIs, not stale training data.',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: {},
    tools: ['claude', 'codex', 'opencode'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: 'Structured step-by-step reasoning tool for harder, multi-step problems.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: {},
    tools: ['claude', 'codex', 'opencode'],
  },
];

export function serversForTool(tool) {
  return MCP_SERVERS.filter((s) => !s.tools || s.tools.includes(tool));
}

/** Claude Code `.mcp.json` shape: { mcpServers: { <id>: { command, args, env } } }. */
export function claudeMcpConfig() {
  const mcpServers = {};
  for (const s of serversForTool('claude')) {
    mcpServers[s.id] = { command: s.command, args: s.args, ...(Object.keys(s.env || {}).length ? { env: s.env } : {}) };
  }
  return { mcpServers };
}

/** OpenCode config `mcp` shape: { <id>: { type: 'local', command: [cmd, ...args], enabled } }. */
export function opencodeMcpConfig() {
  const mcp = {};
  for (const s of serversForTool('opencode')) {
    mcp[s.id] = { type: 'local', command: [s.command, ...s.args], enabled: true, ...(Object.keys(s.env || {}).length ? { environment: s.env } : {}) };
  }
  return mcp;
}

/** Codex `config.toml` [mcp_servers.<id>] TOML block. */
export function codexMcpToml() {
  const lines = [];
  for (const s of serversForTool('codex')) {
    lines.push(`[mcp_servers.${s.id}]`);
    lines.push(`command = ${JSON.stringify(s.command)}`);
    lines.push(`args = [${s.args.map((a) => JSON.stringify(a)).join(', ')}]`);
    const envKeys = Object.keys(s.env || {});
    if (envKeys.length) {
      lines.push(`env = { ${envKeys.map((k) => `${k} = ${JSON.stringify(s.env[k])}`).join(', ')} }`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
