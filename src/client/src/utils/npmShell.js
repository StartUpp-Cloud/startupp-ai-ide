/**
 * Shell helpers for project-container Node/nvm.
 * Keep global npm installs on the active nvm Node — do not pin ~/.npm-global.
 */

export const NVM_SHELL_PRELUDE = [
  'unset NPM_CONFIG_PREFIX',
  'export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"',
  '[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"',
  'hash -r',
].join('; ');

export function npmGlobalInstall(pkg, bin) {
  return `${NVM_SHELL_PRELUDE}; npm install -g ${pkg} && hash -r && command -v ${bin} && ${bin} --version`;
}

export function withNodePath(cmd) {
  return `${NVM_SHELL_PRELUDE}; export PATH="$PATH:$HOME/.npm-global/bin"; ${cmd}`;
}
