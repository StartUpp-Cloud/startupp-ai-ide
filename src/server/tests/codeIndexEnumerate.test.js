import assert from 'node:assert/strict';
import { parseGitLsFiles } from '../codeIndex.js';

const stdout = [
  'src/app.js',
  'src/util.ts',
  'README.md',
  'image.png',
  'src/styles.css',
  'package-lock.json',
].join('\n');

const files = parseGitLsFiles(stdout, {
  maxFiles: 1000,
  allowExt: ['.js', '.ts', '.tsx', '.jsx', '.py', '.md'],
});
assert.deepEqual(files, ['src/app.js', 'src/util.ts', 'README.md'], 'keeps only allowed source extensions');

// respects maxFiles cap
const many = Array.from({ length: 50 }, (_, i) => `f${i}.js`).join('\n');
assert.equal(parseGitLsFiles(many, { maxFiles: 10, allowExt: ['.js'] }).length, 10, 'caps at maxFiles');

// tolerates blank lines / whitespace
assert.deepEqual(parseGitLsFiles('  a.js \n\n b.js \n', { maxFiles: 100, allowExt: ['.js'] }), ['a.js', 'b.js']);
