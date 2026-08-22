import assert from 'node:assert/strict';
import {
  assertContainerPath,
  assertChmodMode,
  createDirectoryCommand,
  createFileCommand,
  deletePathCommand,
  chmodCommand,
  writeFileCommand,
  listDirectoryCommand,
  isLikelyText,
} from '../containerFs.js';

assert.equal(assertContainerPath('/workspace/app/main.js'), '/workspace/app/main.js');
assert.equal(assertContainerPath('/home/dev/.codex/config.toml'), '/home/dev/.codex/config.toml');
assert.throws(() => assertContainerPath('/etc/passwd'), /workspace/);
assert.throws(() => assertContainerPath('/workspace/../etc/passwd'), /workspace/);
assert.equal(assertChmodMode('644'), '644');
assert.throws(() => assertChmodMode('999'), /octal/);

assert.match(createDirectoryCommand('/workspace/src'), /mkdir -p '\/workspace\/src'/);
assert.match(createFileCommand('/workspace/src/a.txt'), /install -m 644/);
assert.match(deletePathCommand('/workspace/src/a.txt', false), /^rm -f /);
assert.match(deletePathCommand('/workspace/src', true), /^rm -rf /);
assert.throws(() => deletePathCommand('/workspace', true), /root/);
assert.match(chmodCommand('/workspace/a.txt', '755'), /chmod 755 '\/workspace\/a\.txt'/);
assert.match(writeFileCommand('/workspace/a.txt', 'aGVsbG8='), /base64 -d/);
assert.throws(() => writeFileCommand('/workspace/a.txt', '%%%'), /base64/);
assert.match(listDirectoryCommand('/workspace/honeygrid/apps/fullstack', 1), /maxdepth 1/);
assert.match(listDirectoryCommand('/workspace/honeygrid/apps/fullstack', 1), /'\/workspace\/honeygrid\/apps\/fullstack'/);
assert.throws(() => listDirectoryCommand('/etc/passwd', 1), /workspace/);

assert.equal(isLikelyText(Buffer.from('hello\n')), true);
assert.equal(isLikelyText(Buffer.from([0, 1, 2, 3])), false);

console.log('containerFs tests passed');
