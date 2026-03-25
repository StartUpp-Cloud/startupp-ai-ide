/**
 * Quick test for LLM Provider
 */

import { llmProvider } from '../llmProvider.js';

async function runTests() {
  console.log('Testing LLM Provider...\n');

  // Test 1: Default settings
  console.log('1. Checking default settings...');
  const settings = llmProvider.getSettings();
  console.log(`   Provider: ${settings.provider}`);
  console.log(`   Enabled: ${settings.enabled}`);
  console.log(`   Ollama endpoint: ${settings.ollama.endpoint}`);
  console.log(`   Ollama model: ${settings.ollama.model}`);
  console.log('   ✓ Default settings loaded\n');

  // Test 2: Check Ollama health (may fail if Ollama not running)
  console.log('2. Checking Ollama health...');
  const health = await llmProvider.checkOllamaHealth();
  console.log(`   Available: ${health.available}`);
  if (health.error) {
    console.log(`   Error: ${health.error}`);
  }
  if (health.models) {
    console.log(`   Models found: ${health.models.length}`);
    health.models.forEach(m => console.log(`     - ${m}`));
  }
  console.log('');

  // Test 3: Update settings
  console.log('3. Testing settings update...');
  await llmProvider.updateSettings({
    enabled: true,
    confidenceThreshold: 0.6,
  });
  const updated = llmProvider.getSettings();
  console.log(`   Enabled now: ${updated.enabled}`);
  console.log(`   Confidence threshold: ${updated.confidenceThreshold}`);
  console.log('   ✓ Settings updated\n');

  // Test 4: Should use LLM logic
  console.log('4. Testing shouldUseLLM logic...');

  // Case A: Low confidence
  const lowConfResult = { confidence: 0.3, intent: 'approval' };
  const useLLMLow = llmProvider.shouldUseLLM(lowConfResult);
  console.log(`   Low confidence (0.3): ${useLLMLow ? 'use LLM' : 'skip'}`);

  // Case B: High confidence
  const highConfResult = { confidence: 0.9, intent: 'approval' };
  const useLLMHigh = llmProvider.shouldUseLLM(highConfResult);
  console.log(`   High confidence (0.9): ${useLLMHigh ? 'use LLM' : 'skip'}`);

  // Case C: Unknown intent
  const unknownResult = { confidence: 0.5, intent: 'unknown' };
  const useLLMUnknown = llmProvider.shouldUseLLM(unknownResult);
  console.log(`   Unknown intent: ${useLLMUnknown ? 'use LLM' : 'skip'}`);

  // Case D: Information request
  const infoResult = { confidence: 0.7, intent: 'information' };
  const useLLMInfo = llmProvider.shouldUseLLM(infoResult);
  console.log(`   Information request: ${useLLMInfo ? 'use LLM' : 'skip'}`);

  console.log('   ✓ shouldUseLLM logic working\n');

  // Test 5: Response cleaning
  console.log('5. Testing response cleaning...');
  const testResponses = [
    { input: '"yes"', expected: 'y' },
    { input: "'yes'", expected: 'y' },
    { input: 'Response: y', expected: 'y' },
    { input: 'NO', expected: 'n' },
    { input: '  typescript  ', expected: 'typescript' },
    { input: 'Answer: continue', expected: 'continue' },
  ];

  for (const test of testResponses) {
    const cleaned = llmProvider.cleanResponse(test.input);
    const pass = cleaned === test.expected;
    console.log(`   "${test.input}" -> "${cleaned}" ${pass ? '✓' : `✗ (expected: ${test.expected})`}`);
  }
  console.log('');

  // Test 6: System prompt building
  console.log('6. Testing prompt building...');
  const context = {
    projectContext: {
      mainLanguage: 'typescript',
      framework: 'react',
      hasTypeScript: true,
      testFramework: 'jest',
    },
    intent: 'choice',
    options: ['typescript', 'javascript'],
  };

  const systemPrompt = llmProvider.buildSystemPrompt(context);
  console.log(`   System prompt includes project context: ${systemPrompt.includes('typescript')}`);

  const userPrompt = llmProvider.buildUserPrompt('TypeScript or JavaScript?', context);
  console.log(`   User prompt includes options: ${userPrompt.includes('typescript, javascript')}`);
  console.log('   ✓ Prompt building working\n');

  // Test 7: If Ollama available, test generation
  if (health.available) {
    console.log('7. Testing actual LLM generation...');
    try {
      const result = await llmProvider.generateResponse('Continue? [Y/n]', {
        intent: 'confirmation',
        options: ['y', 'n'],
      });
      console.log(`   Response: "${result.response}"`);
      console.log(`   Provider: ${result.provider}`);
      console.log(`   Model: ${result.model}`);
      console.log('   ✓ LLM generation successful\n');
    } catch (error) {
      console.log(`   ✗ LLM generation failed: ${error.message}\n`);
    }
  } else {
    console.log('7. Skipping LLM generation test (Ollama not available)\n');
  }

  // Disable LLM for cleanup
  await llmProvider.updateSettings({ enabled: false });

  console.log('='.repeat(50));
  console.log('LLM Provider tests completed!');
}

runTests().catch(console.error);
