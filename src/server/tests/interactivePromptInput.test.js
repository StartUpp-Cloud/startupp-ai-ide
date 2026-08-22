import assert from 'node:assert/strict';
import { isDefaultYesPrompt, normalizeYnPromptInput } from '../interactivePromptInput.js';

assert.equal(isDefaultYesPrompt('Authenticate Git with your GitHub credentials? (Y/n)'), true);
assert.equal(isDefaultYesPrompt('Overwrite file? [Y/n]'), true);
assert.equal(isDefaultYesPrompt('Continue? (y/n)'), true);
assert.equal(isDefaultYesPrompt('dev@box:/workspace$'), false);

assert.equal(normalizeYnPromptInput('y', '? Authenticate Git with your GitHub credentials? (Y/n)'), '\r');
assert.equal(normalizeYnPromptInput('Y', '? Authenticate Git with your GitHub credentials? (Y/n)'), '\r');
assert.equal(normalizeYnPromptInput('n', '? Authenticate Git with your GitHub credentials? (Y/n)'), 'n\r');
assert.equal(normalizeYnPromptInput('y', 'dev@box:/workspace$'), 'y');
assert.equal(normalizeYnPromptInput('\r', '? (Y/n)'), '\r');

console.log('interactivePromptInput tests passed');
