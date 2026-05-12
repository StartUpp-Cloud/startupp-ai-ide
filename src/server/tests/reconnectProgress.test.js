import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const forbiddenMessage = 'Reconnecting and recovering progress...';

const userFacingFiles = [
  'src/server/terminalServer.js',
  'src/client/src/components/ChatPanel.jsx',
  'src/client/src/pages/IDE.jsx',
];

for (const relativePath of userFacingFiles) {
  const source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  assert.equal(
    source.includes(forbiddenMessage),
    false,
    `${relativePath} should not emit the reconnect recovery message to users`,
  );
}

console.log('reconnectProgress tests passed');
