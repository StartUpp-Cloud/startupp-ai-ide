import assert from 'node:assert/strict';
import { containerDestDir, posixQuote } from '../dockerCopy.js';

assert.equal(posixQuote("foo"), "'foo'");
assert.equal(posixQuote("a'b"), `'a'\\''b'`);
assert.equal(containerDestDir('/workspace/.uploads/file.txt'), '/workspace/.uploads');
assert.equal(containerDestDir('/home/dev/.ssh/id_rsa'), '/home/dev/.ssh');
assert.equal(containerDestDir('/workspace'), '/');

console.log('dockerCopy tests passed');
