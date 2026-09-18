import assert from 'node:assert/strict';
import {
  collectAskQuestionsFromOutput,
  extractAsksFromContent,
  formatAskMarkdown,
  formatAskReply,
  normalizeAskQuestions,
  pickRecommendedOption,
  recommendedSelections,
} from '../../shared/humanAsk.js';

const questions = normalizeAskQuestions([
  {
    question: 'Where should docs live?',
    header: 'Docs location',
    options: [
      { label: 'Root docs/', description: 'Use root docs for cross-project docs' },
      { label: 'Repo docs/', description: 'Keep repo-specific docs in each repo' },
    ],
  },
  {
    question: 'Confirm these folders should be deleted: old-app/, tmp-repo/?',
    header: 'Remove items',
    options: [
      { label: 'Archive first', description: 'Move to archive/ before deletion', recommended: true },
      { label: 'Delete now', description: 'Remove permanently' },
    ],
  },
]);

assert.equal(questions.length, 2);
assert.equal(pickRecommendedOption(questions[0]).label, 'Root docs/');
assert.equal(pickRecommendedOption(questions[1]).label, 'Archive first');
assert.equal(questions[0].options[0].recommended, true);
assert.equal(questions[1].options[0].recommended, true);

const markdown = formatAskMarkdown(questions);
assert.match(markdown, /The coding agent needs your input/i);
assert.match(markdown, /Where should docs live\?/);
assert.match(markdown, /Root docs\/.*cross-project docs.*recommended/i);
assert.match(markdown, /Archive first.*recommended/i);

const parsedBack = extractAsksFromContent(markdown);
assert.equal(parsedBack.length, 2);
assert.equal(parsedBack[0].header, 'Docs location');
assert.equal(parsedBack[0].options[0].recommended, true);
assert.equal(parsedBack[1].options[0].label, 'Archive first');

const reply = formatAskReply({
  questions,
  selections: { [questions[0].id]: 'Root docs/', [questions[1].id]: 'Archive first' },
});
assert.match(reply, /Docs location: Root docs\//);
assert.match(reply, /Remove items: Archive first/);
assert.match(reply, /Please continue from these choices/);

const rec = recommendedSelections(questions);
assert.equal(rec[questions[0].id], 'Root docs/');
assert.equal(rec[questions[1].id], 'Archive first');

const fromStream = collectAskQuestionsFromOutput([
  JSON.stringify({
    type: 'assistant',
    message: {
      content: [{
        type: 'tool_use',
        name: 'AskUserQuestion',
        input: {
          questions: [{
            question: 'Ship to staging now?',
            header: 'Deploy',
            options: [
              { label: 'Yes', description: 'Recommended safe default' },
              { label: 'No', description: 'Wait for review' },
            ],
          }],
        },
      }],
    },
  }),
].join('\n'));
assert.equal(fromStream.length, 1);
assert.equal(fromStream[0].header, 'Deploy');
assert.equal(fromStream[0].options[0].recommended, true);

console.log('humanAsk tests passed');
