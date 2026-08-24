/**
 * Headless-dev tools every project container should have.
 * New images bake these in; existing containers get them on start.
 */

export const DEV_TOOL_PACKAGES = [
  'xdg-utils',
  'ca-certificates',
  'unzip',
  'zip',
  'procps',
  'file',
];

export const XDG_OPEN_MARKER = 'SAI_HEADLESS_XDG_OPEN';
export const WRANGLER_OAUTH_PORT = 8976;

export const XDG_OPEN_SCRIPT = `#!/bin/sh
# ${XDG_OPEN_MARKER}
url="\${1:-}"
if [ -z "$url" ]; then
  echo "xdg-open: missing URL" >&2
  exit 1
fi
printf '%s\\n' "$url" > "\${HOME:-/tmp}/.sai-last-open-url" 2>/dev/null || true
echo
echo "Open this URL in your computer browser:"
echo "$url"
echo "Keep this terminal open until login finishes."
echo
case "$url" in
  *://127.0.0.1:${WRANGLER_OAUTH_PORT}*|*://localhost:${WRANGLER_OAUTH_PORT}*|*://[::1]:${WRANGLER_OAUTH_PORT}*)
    exit 0
    ;;
  *://127.0.0.1:*|*://localhost:*|*://[::1]:*)
    echo "This login callback is localhost inside the container and cannot reach your computer."
    echo "Use a device-code login (for GitHub: run Login to GitHub, not a --web flow)."
    exit 1
    ;;
esac
exit 0
`;

export const OAUTH_PROXY_SCRIPT = `#!/usr/bin/env python3
import socket, threading, sys
target, port = sys.argv[1], int(sys.argv[2])

def pipe(left, right):
    try:
        while True:
            data = left.recv(65536)
            if not data:
                break
            right.sendall(data)
    except Exception:
        pass
    finally:
        try:
            left.close()
            right.close()
        except Exception:
            pass

server = socket.socket()
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", port))
server.listen(16)
while True:
    client, _ = server.accept()
    upstream = socket.create_connection((target, port))
    threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
    threading.Thread(target=pipe, args=(upstream, client), daemon=True).start()
`;

export function buildEnsureDevToolsCommand() {
  const packages = DEV_TOOL_PACKAGES.join(' ');
  const encodedOpen = Buffer.from(XDG_OPEN_SCRIPT, 'utf8').toString('base64');
  const encodedProxy = Buffer.from(OAUTH_PROXY_SCRIPT, 'utf8').toString('base64');
  return [
    'set -e',
    'need=0',
    `for pkg in ${packages}; do dpkg -s "$pkg" >/dev/null 2>&1 || need=1; done`,
    'if [ "$need" = 1 ]; then apt-get update -qq && apt-get install -y -qq --no-install-recommends ' + packages + '; fi',
    `echo '${encodedOpen}' | base64 -d > /usr/local/bin/xdg-open`,
    'chmod 755 /usr/local/bin/xdg-open',
    'ln -sfn /usr/local/bin/xdg-open /usr/local/bin/x-www-browser',
    'install -d -m 0755 -o dev -g dev /home/dev/.local/bin /home/dev/.sai',
    `echo '${encodedProxy}' | base64 -d > /home/dev/.sai/oauth-proxy.py`,
    'chmod 755 /home/dev/.sai/oauth-proxy.py',
    'chown dev:dev /home/dev/.sai/oauth-proxy.py',
  ].join('; ');
}

export function oauthSidecarName(containerName) {
  return `sai-oauth-${String(containerName || '').replace(/[^a-zA-Z0-9_.-]/g, '')}`.slice(0, 63);
}

export function buildOauthPublishCommand(containerName, { image, port = WRANGLER_OAUTH_PORT, targetIp } = {}) {
  if (!containerName || !image || !targetIp) throw new Error('containerName, image, and targetIp are required');
  const name = oauthSidecarName(containerName);
  return [
    'docker run -d --rm',
    `--name ${name}`,
    `-p ${port}:${port}`,
    `-v ${containerName}-home:/home/dev:ro`,
    image,
    'python3 /home/dev/.sai/oauth-proxy.py',
    targetIp,
    String(port),
  ].join(' ');
}
