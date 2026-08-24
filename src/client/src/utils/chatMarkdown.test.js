import assert from 'node:assert/strict';
import { blockNeedsTrailSpace, listIndentLevel, parseMarkdownBlocks, splitTableRow } from './chatMarkdown.js';

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

const report = parseMarkdownBlocks([
  '## Outcome',
  'Shipped the compact chat report.',
  '',
  '## Details',
  '- Removed CDP debug pages.',
  '- Back/Close are icon-only.',
  '',
  'Next step is the OpenClaw roadmap.',
].join('\n'));

assert.equal(blockNeedsTrailSpace(report, 0), false, 'headings manage their own spacing');
assert.equal(blockNeedsTrailSpace(report, 1), true, 'paragraphs need space after the last line');
assert.equal(blockNeedsTrailSpace(report, report.findIndex((block) => block.type === 'bullet' && block.text.includes('CDP'))), false);
assert.equal(blockNeedsTrailSpace(report, report.findLastIndex((block) => block.type === 'bullet')), true);
assert.equal(blockNeedsTrailSpace(report, report.length - 1), true);

console.log('chatMarkdown tests passed');
