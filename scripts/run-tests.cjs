const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_ROOTS = [path.join(ROOT, 'src', 'server', 'tests'), path.join(ROOT, 'src', 'client', 'src', 'utils')];
const TEST_PATTERN = /\.test\.(?:js|cjs|jsx)$/;

function collect(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(fullPath, files);
    else if (TEST_PATTERN.test(entry.name)) files.push(fullPath);
  }
  return files;
}

const tests = TEST_ROOTS.flatMap(root => collect(root)).sort();
if (tests.length === 0) {
  console.error('No tests were found.');
  process.exit(1);
}

let failed = 0;
for (const test of tests) {
  const result = spawnSync(process.execPath, [test], { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) failed++;
}

console.log(`\n${tests.length - failed}/${tests.length} tests passed.`);
process.exit(failed ? 1 : 0);
