const { existsSync } = require('fs');
const { execSync } = require('child_process');

if (process.platform !== 'linux') process.exit(0);
const sh = 'scripts/fix-pty-permissions.sh';
if (!existsSync(sh)) process.exit(0);

try {
  execSync(`sed -i 's/\\r$//' "${sh}" && bash "${sh}"`, { stdio: 'inherit', shell: '/bin/bash' });
} catch {
  // Best-effort host/macOS permission fix. Never fail image builds.
}
