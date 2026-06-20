/**
 * mcpProvisioner — installs the curated MCP servers into a project container's
 * CLI tool configs (Claude Code, Codex, OpenCode), non-destructively and
 * idempotently. Runs on container create/start and via an on-demand endpoint so
 * EXISTING containers get them too. Best-effort: failures never block the agent.
 *
 * Strategy: writes are done by a tiny node script executed INSIDE the container
 * (node is installed there), so we can merge JSON / manage a marked TOML block
 * without clobbering the user's existing config.
 */

import { containerManager } from './containerManager.js';
import { claudeMcpConfig, opencodeMcpConfig, codexMcpToml } from './mcpRegistry.js';

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

/** Deep-merge a JSON patch into a file inside the container (creates if absent). */
async function mergeJsonInContainer(containerName, filePath, patchObj) {
  const script = `
const fs=require('fs'),path=require('path');
const p=process.argv[1];
const patch=JSON.parse(Buffer.from(process.argv[2],'base64').toString('utf8'));
let cur={};try{cur=JSON.parse(fs.readFileSync(p,'utf8'))||{}}catch{}
const merge=(a,b)=>{for(const k of Object.keys(b)){const v=b[k];if(v&&typeof v==='object'&&!Array.isArray(v)){a[k]=merge(a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k])?a[k]:{},v)}else{a[k]=v}}return a};
const out=merge(cur,patch);
fs.mkdirSync(path.dirname(p),{recursive:true});
fs.writeFileSync(p,JSON.stringify(out,null,2));
`;
  const cmd = `echo ${b64(script)} | base64 -d > /tmp/_sai_mcp_merge.js && node /tmp/_sai_mcp_merge.js '${filePath}' ${b64(JSON.stringify(patchObj))}; rm -f /tmp/_sai_mcp_merge.js`;
  return containerManager.execInContainerAsync(containerName, cmd, { timeout: 15000 });
}

/** Replace a managed marker block in ~/.codex/config.toml (creates file if absent). */
async function updateCodexToml(containerName, tomlBlock) {
  const script = `
const fs=require('fs'),path=require('path');
const p=(process.env.HOME||'/home/dev')+'/.codex/config.toml';
const block=Buffer.from(process.argv[1],'base64').toString('utf8');
const START='# >>> sai-managed-mcp >>>',END='# <<< sai-managed-mcp <<<';
let cur='';try{cur=fs.readFileSync(p,'utf8')}catch{}
const esc=s=>s.replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');
cur=cur.replace(new RegExp(esc(START)+'[\\\\s\\\\S]*?'+esc(END),'g'),'').replace(/\\n{3,}/g,'\\n\\n').trim();
const out=(cur?cur+'\\n\\n':'')+START+'\\n'+block.trim()+'\\n'+END+'\\n';
fs.mkdirSync(path.dirname(p),{recursive:true});
fs.writeFileSync(p,out);
`;
  const cmd = `echo ${b64(script)} | base64 -d > /tmp/_sai_codex_mcp.js && node /tmp/_sai_codex_mcp.js ${b64(tomlBlock)}; rm -f /tmp/_sai_codex_mcp.js`;
  return containerManager.execInContainerAsync(containerName, cmd, { timeout: 15000 });
}

/**
 * Provision all curated MCP servers into a container's tool configs.
 * @returns {Promise<{ ok: boolean, results: object }>}
 */
export async function provisionContainerMcp(containerName) {
  if (!containerName) return { ok: false, results: {} };
  const results = {};
  // Claude Code — project-scoped .mcp.json at /workspace (found from any worktree below it).
  try {
    await mergeJsonInContainer(containerName, '/workspace/.mcp.json', claudeMcpConfig());
    results.claude = 'ok';
  } catch (err) { results.claude = `err: ${err.message}`; }

  // OpenCode — project-scoped opencode.json mcp section (separate from the
  // harness-managed Ollama provider config so it survives restarts).
  try {
    await mergeJsonInContainer(containerName, '/workspace/opencode.json', {
      $schema: 'https://opencode.ai/config.json',
      mcp: opencodeMcpConfig(),
    });
    results.opencode = 'ok';
  } catch (err) { results.opencode = `err: ${err.message}`; }

  // Codex — managed block in ~/.codex/config.toml.
  try {
    await updateCodexToml(containerName, codexMcpToml());
    results.codex = 'ok';
  } catch (err) { results.codex = `err: ${err.message}`; }

  // Best-effort ownership fix so the dev user can read the project files.
  try {
    await containerManager.execInContainerAsync(containerName, `chown dev:dev /workspace/.mcp.json /workspace/opencode.json 2>/dev/null || true`);
  } catch {}

  const ok = Object.values(results).some((v) => v === 'ok');
  return { ok, results };
}
