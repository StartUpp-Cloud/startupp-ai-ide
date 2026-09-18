import assert from 'node:assert/strict';
import {
  DEFAULT_CHAT_APPEARANCE,
  chatAppearanceCssVars,
  normalizeChatAppearance,
} from './chatAppearance.js';

assert.equal(normalizeChatAppearance(null).fontSize, DEFAULT_CHAT_APPEARANCE.fontSize);
assert.equal(normalizeChatAppearance({ fontSize: 12 }).fontSize, 13);
assert.equal(normalizeChatAppearance({ fontSize: 40 }).fontSize, 18);
assert.equal(normalizeChatAppearance({ headingScale: 'nope' }).headingScale, 'large');
assert.equal(normalizeChatAppearance({ lineSpacing: 'relaxed' }).lineSpacing, 'relaxed');
assert.equal(normalizeChatAppearance({ emphasizeHeadings: false }).emphasizeHeadings, false);
assert.equal(normalizeChatAppearance({}).emphasizeHeadings, true);

const vars = chatAppearanceCssVars({ fontSize: 16, headingScale: 'xlarge', lineSpacing: 'relaxed', emphasizeHeadings: true });
assert.equal(vars['--chat-md-size'], '16px');
assert.equal(vars['--chat-md-leading'], '1.9');
assert.equal(vars['--chat-md-h2'], '1.62em');
assert.match(vars['--chat-md-heading-accent'], /3px solid/);

const quiet = chatAppearanceCssVars({ emphasizeHeadings: false, headingScale: 'normal' });
assert.equal(quiet['--chat-md-h2'], '1.2em');
assert.equal(quiet['--chat-md-heading-accent'], '0');

console.log('chatAppearance tests passed');
