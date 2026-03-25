/**
 * Quick test for Smart Engine
 */

import { smartEngine, INTENTS } from '../smartEngine.js';

async function runTests() {
  console.log('Initializing smart engine...');
  await smartEngine.init();
  console.log('Smart engine initialized.\n');

  const testCases = [
    // Approval tests
    {
      text: 'Allow me to read the file src/index.ts?',
      expectedIntent: INTENTS.APPROVAL,
      description: 'Read permission request',
    },
    {
      text: 'Allow Claude to edit package.json? [Y/n]',
      expectedIntent: INTENTS.APPROVAL,
      description: 'File edit approval',
    },
    {
      text: 'Can I run npm install?',
      expectedIntent: INTENTS.APPROVAL,
      description: 'Execute permission',
    },

    // Choice tests
    {
      text: 'Should I use TypeScript or JavaScript?',
      expectedIntent: INTENTS.CHOICE,
      description: 'Language choice',
    },
    {
      text: 'Which directory should I create the file in: src or lib?',
      expectedIntent: INTENTS.CHOICE,
      description: 'Directory choice',
    },

    // Confirmation tests
    {
      text: 'Continue? [press Enter]',
      expectedIntent: INTENTS.CONFIRMATION,
      description: 'Simple continue',
    },
    {
      text: 'Is this correct? [Y/n]',
      expectedIntent: INTENTS.CONFIRMATION,
      description: 'Correctness check',
    },

    // Information tests
    {
      text: 'What is the project name?',
      expectedIntent: INTENTS.INFORMATION,
      description: 'Project info request',
    },
    {
      text: 'What path should I use for the config file?',
      expectedIntent: INTENTS.INFORMATION,
      description: 'Path info request',
    },

    // Completion tests
    {
      text: 'Done! All files have been updated.',
      expectedIntent: INTENTS.COMPLETION,
      description: 'Task complete',
    },
    {
      text: 'Let me know if you need anything else.',
      expectedIntent: INTENTS.COMPLETION,
      description: 'Offer more help',
    },

    // Error tests
    {
      text: 'Error: File not found. Retry?',
      expectedIntent: INTENTS.ERROR,
      description: 'Error with retry',
    },
  ];

  console.log('Running intent classification tests...\n');
  console.log('='.repeat(70));

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    const result = smartEngine.classifyIntent(test.text);
    const success = result.intent === test.expectedIntent;

    if (success) {
      passed++;
      console.log(`\x1b[32m✓\x1b[0m ${test.description}`);
    } else {
      failed++;
      console.log(`\x1b[31m✗\x1b[0m ${test.description}`);
      console.log(`  Expected: ${test.expectedIntent}, Got: ${result.intent}`);
    }
    console.log(`  Text: "${test.text.slice(0, 50)}..."`);
    console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    console.log('');
  }

  console.log('='.repeat(70));
  console.log(`\nResults: ${passed} passed, ${failed} failed`);

  // Test question parsing
  console.log('\n\nTesting question parsing...\n');

  const parseTests = [
    'Should I use "react" or "vue"?',
    'Create the file in ./src/components/Button.tsx',
    'Allow me to run `npm install express`?',
  ];

  for (const text of parseTests) {
    const parsed = smartEngine.parseQuestion(text);
    console.log(`Text: ${text}`);
    console.log(`  Quoted: ${JSON.stringify(parsed.quoted)}`);
    console.log(`  Paths: ${JSON.stringify(parsed.paths)}`);
    console.log(`  Options: ${JSON.stringify(parsed.options)}`);
    console.log(`  Extensions: ${JSON.stringify(parsed.extensions)}`);
    console.log('');
  }

  // Test full analysis
  console.log('\nTesting full analysis...\n');

  const analysis = smartEngine.analyze(
    'Should I use TypeScript or JavaScript for this project?',
    { projectPath: process.cwd() }
  );

  console.log('Analysis result:');
  console.log(JSON.stringify(analysis, null, 2));
}

runTests().catch(console.error);
