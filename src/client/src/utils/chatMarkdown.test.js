import assert from 'node:assert/strict';
import {
  blockNeedsTrailSpace,
  githubLinkLabel,
  linkLabelForUrl,
  listIndentLevel,
  listItemSpacingClass,
  parseInlineTokens,
  parseMarkdownBlocks,
  previewChatText,
  shouldCollapseChatText,
  splitTableRow,
} from './chatMarkdown.js';

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
assert.equal(listItemSpacingClass(report, report.findIndex((block) => block.type === 'bullet' && block.text.includes('CDP'))), 'mb-1');
assert.equal(listItemSpacingClass(report, report.findLastIndex((block) => block.type === 'bullet')), 'mb-2.5');

assert.equal(githubLinkLabel('https://github.com/acme/app/pull/42'), 'PR #42 (acme/app)');
assert.equal(githubLinkLabel('https://github.com/acme/app/issues/9'), 'Issue #9 (acme/app)');
assert.equal(linkLabelForUrl('https://github.com/acme/app/pull/42', 'https://github.com/acme/app/pull/42'), 'PR #42 (acme/app)');
assert.equal(linkLabelForUrl('https://github.com/acme/app/pull/42', 'the open PR'), 'the open PR');

const linked = parseInlineTokens('See https://github.com/acme/app/pull/42 and [docs](https://example.com/guide).');
assert.deepEqual(linked.filter((token) => token.type === 'link').map((token) => token.label), [
  'PR #42 (acme/app)',
  'docs',
]);

const longMessage = ['Please review this.', ...Array.from({ length: 8 }, (_, i) => `Line ${i + 1} of a long request.`)].join('\n');
assert.equal(shouldCollapseChatText('Short note'), false);
assert.equal(shouldCollapseChatText(longMessage), true);
assert.ok(previewChatText(longMessage).length < longMessage.length);

console.log('chatMarkdown tests passed');
