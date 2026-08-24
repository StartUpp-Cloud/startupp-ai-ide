import assert from 'node:assert/strict';
import { listIndentLevel, parseMarkdownBlocks, splitTableRow } from './chatMarkdown.js';

assert.equal(listIndentLevel(''), 0);
assert.equal(listIndentLevel('  '), 1);
assert.equal(listIndentLevel('    '), 2);
assert.equal(listIndentLevel('\t'), 1);

assert.deepEqual(splitTableRow('| Accounts | Leads |'), ['Accounts', 'Leads']);

const bullets = parseMarkdownBlocks([
  'Done.',
  '- parent',
  '',
  '  - child',
  '    - grandchild',
].join('\n'));

assert.equal(bullets[0].type, 'p');
assert.deepEqual(bullets[1], { type: 'bullet', indent: 0, text: 'parent' });
assert.equal(bullets.some((block) => block.type === 'gap'), false, 'blank lines between bullets should collapse');
assert.deepEqual(bullets[2], { type: 'bullet', indent: 1, text: 'child' });
assert.deepEqual(bullets[3], { type: 'bullet', indent: 2, text: 'grandchild' });

const table = parseMarkdownBlocks([
  '| Object | Access |',
  '| --- | --- |',
  '| Accounts | Read |',
  '| Leads | Write |',
].join('\n'));

assert.equal(table[0].type, 'table');
assert.deepEqual(table[0].headers, ['Object', 'Access']);
assert.deepEqual(table[0].rows, [['Accounts', 'Read'], ['Leads', 'Write']]);

console.log('chatMarkdown tests passed');
