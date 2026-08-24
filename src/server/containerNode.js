/**
 * Project-container Node lifecycle.
 *
 * The image ships a kickstart Node (see docker/Dockerfile.dev). nvm lives in
 * the persistent /home/dev volume so a project can `nvm install` / `nvm alias
 * default` without rebuilding. Docker ENV NPM_CONFIG_PREFIX and ~/.npm-global
 * on PATH must not win over nvm — they pin npm's prefix and old global bins.
 *
 * Fresh `bash -lc` is a login, non-interactive shell. Debian's ~/.bashrc
 * returns before nvm unless we load it *above* the interactive-only guard.
 */

export const NODE_KICKSTART_MAJOR = '22';
export const SAI_NODE_KICKSTART_FILE = '/etc/sai-node-kickstart';
export const SAI_NVM_MARKER = 'SAI_NVM_NODE';
export const NVM_DIR = '/home/dev/.nvm';
export const NVM_INSTALL_VERSION = 'v0.40.3';
export const NPM_GLOBAL_DIR = '/home/dev/.npm-global';
export const NODE_ENV_SCRIPT = '/home/dev/.sai/node-env.sh';

function nodeEnvScriptContents() {
  return [
    `#!/bin/bash`,
    `# ${SAI_NVM_MARKER}`,
    'unset NPM_CONFIG_PREFIX',
    `export NVM_DIR="\${NVM_DIR:-$HOME/.nvm}"`,
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    '[ -f .nvmrc ] && nvm use >/dev/null 2>&1 || true',
    '',
  ].join('\n');
}

/** Source nvm and drop the image-level npm prefix. Safe in non-interactive shells. */
export function containerNodeShellPrelude() {
  return [
    'unset NPM_CONFIG_PREFIX',
    `[ -f ${NODE_ENV_SCRIPT} ] && . ${NODE_ENV_SCRIPT}`,
    `export NVM_DIR="\${NVM_DIR:-${NVM_DIR}}"`,
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    `[ -d "${NPM_GLOBAL_DIR}/bin" ] && export PATH="$PATH:${NPM_GLOBAL_DIR}/bin"`,
  ].join('\n') + '\n';
}

/**
 * Idempotent first-boot / restart hook (run as `dev`).
 * Installs nvm if missing, sets default only when unset, and loads nvm for
 * login *and* non-interactive shells (`bash -lc` / `bash -c`).
 */
export function buildEnsureNvmCommand({ kickstartMajor = NODE_KICKSTART_MAJOR } = {}) {
  const encodedEnv = Buffer.from(nodeEnvScriptContents(), 'utf8').toString('base64');
  const loadLine = `[ -f "${NODE_ENV_SCRIPT}" ] && . "${NODE_ENV_SCRIPT}" # ${SAI_NVM_MARKER} load`;
  return [
    `export NVM_DIR="${NVM_DIR}"`,
    'unset NPM_CONFIG_PREFIX',
    `if [ ! -s "$NVM_DIR/nvm.sh" ]; then`,
    `  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_INSTALL_VERSION}/install.sh | bash`,
    'fi',
    'set +e',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    `KICKSTART="${kickstartMajor}"`,
    `if [ -f ${SAI_NODE_KICKSTART_FILE} ]; then KICKSTART=$(tr -d 'v \\n\\r' < ${SAI_NODE_KICKSTART_FILE}); fi`,
    'if [ ! -s "$NVM_DIR/alias/default" ]; then',
    '  nvm install "$KICKSTART"',
    '  nvm alias default "$KICKSTART"',
    'fi',
    'if [ -f "$HOME/.npmrc" ]; then sed -i "/^prefix=.*npm-global/d" "$HOME/.npmrc"; fi',
    `sed -i "/\\.npm-global\\/bin/d" "$HOME/.bashrc" 2>/dev/null || true`,
    'mkdir -p "$HOME/.sai"',
    `echo '${encodedEnv}' | base64 -d > "${NODE_ENV_SCRIPT}"`,
    `chmod 755 "${NODE_ENV_SCRIPT}"`,
    `sed -i "/${SAI_NVM_MARKER}/d" "$HOME/.bashrc" 2>/dev/null || true`,
    `sed -i "/^unset NPM_CONFIG_PREFIX$/d" "$HOME/.bashrc" 2>/dev/null || true`,
    `{ echo '${loadLine}'; cat "$HOME/.bashrc"; } > "$HOME/.bashrc.sai-nvm" && mv "$HOME/.bashrc.sai-nvm" "$HOME/.bashrc"`,
  ].join('\n');
}

/** Resolve `codex` after nvm, with the legacy global bin as fallback. */
export function buildCodexAppServerCommand() {
  return [
    'unset NPM_CONFIG_PREFIX',
    `export NVM_DIR="${NVM_DIR}"`,
    `[ -f ${NODE_ENV_SCRIPT} ] && . ${NODE_ENV_SCRIPT}`,
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
    `export PATH="$PATH:${NPM_GLOBAL_DIR}/bin:/usr/local/bin:/usr/bin:/bin"`,
    'exec "$(command -v codex)" app-server --stdio',
  ].join('; ');
}
