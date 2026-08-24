/**
 * Project-container Node lifecycle.
 *
 * The image ships a kickstart Node (see docker/Dockerfile.dev). nvm lives in
 * the persistent /home/dev volume so a project can `nvm install` / `nvm alias
 * default` without rebuilding. Docker ENV NPM_CONFIG_PREFIX and ~/.npm-global
 * on PATH must not win over nvm — they pin npm's prefix and old global bins.
 */

export const NODE_KICKSTART_MAJOR = '22';
export const SAI_NODE_KICKSTART_FILE = '/etc/sai-node-kickstart';
export const SAI_NVM_MARKER = 'SAI_NVM_NODE';
export const NVM_DIR = '/home/dev/.nvm';
export const NVM_INSTALL_VERSION = 'v0.40.3';
export const NPM_GLOBAL_DIR = '/home/dev/.npm-global';

/** Source nvm and drop the image-level npm prefix. Safe in non-interactive shells. */
export function containerNodeShellPrelude() {
  return [
    'unset NPM_CONFIG_PREFIX',
    `export NVM_DIR="\${NVM_DIR:-${NVM_DIR}}"`,
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    `[ -d "${NPM_GLOBAL_DIR}/bin" ] && export PATH="$PATH:${NPM_GLOBAL_DIR}/bin"`,
  ].join('\n') + '\n';
}

function bashrcSnippet() {
  return [
    `# ${SAI_NVM_MARKER}`,
    'unset NPM_CONFIG_PREFIX',
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
    '[ -f .nvmrc ] && nvm use >/dev/null 2>&1 || true',
  ].join('\n');
}

/**
 * Idempotent first-boot / restart hook (run as `dev`).
 * Installs nvm if missing, sets default only when unset, and stops
 * ~/.npm-global from shadowing the active Node.
 */
export function buildEnsureNvmCommand({ kickstartMajor = NODE_KICKSTART_MAJOR } = {}) {
  const encoded = Buffer.from(`${bashrcSnippet()}\n`, 'utf8').toString('base64');
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
    `grep -qF "${SAI_NVM_MARKER}" "$HOME/.bashrc" 2>/dev/null || echo '${encoded}' | base64 -d >> "$HOME/.bashrc"`,
  ].join('\n');
}

/** Resolve `codex` after nvm, with the legacy global bin as fallback. */
export function buildCodexAppServerCommand() {
  return [
    'unset NPM_CONFIG_PREFIX',
    `export NVM_DIR="${NVM_DIR}"`,
    '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null 2>&1',
    `export PATH="$PATH:${NPM_GLOBAL_DIR}/bin:/usr/local/bin:/usr/bin:/bin"`,
    'exec "$(command -v codex)" app-server --stdio',
  ].join('; ');
}
