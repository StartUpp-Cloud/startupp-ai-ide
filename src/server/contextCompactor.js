// src/server/contextCompactor.js
import { chatStore } from './chatStore.js';
import { llmProvider } from './llmProvider.js';

const COMPACTION_THRESHOLD = 40;
const KEEP_RECENT = 15;

export async function buildAgentContext(projectId, sessionId = null) {
  const messages = chatStore.getMessages(projectId, { sessionId, limit: 200 }).reverse();

  if (messages.length < COMPACTION_THRESHOLD) {
    // Short conversation — return all messages as context
    return messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
  }

  // Long conversation — summarize older messages, keep recent ones intact
  const toSummarize = messages.slice(0, -KEEP_RECENT);
  const recent = messages.slice(-KEEP_RECENT);

  // Check if first message is already a compaction (avoid re-summarizing)
  if (toSummarize.length === 1 && toSummarize[0].metadata?.isCompaction) {
    const recentText = recent.map(m => `[${m.role}]: ${m.content}`).join('\n');
    return `[CONTEXT SUMMARY]\n${toSummarize[0].content}\n\n[RECENT MESSAGES]\n${recentText}`;
  }

  const conversationText = toSummarize
    .map(m => `[${m.role}] ${m.content.slice(0, 500)}`)
    .join('\n');

  let summary;
  try {
    const result = await llmProvider.generateResponse(
      `Summarize this conversation history into a concise context paragraph. Include key decisions, code changes, bugs found, and current state of the project work. Be specific about file names, features, and outcomes.\n\n${conversationText}`,
      { systemPrompt: 'You are a conversation summarizer. Be concise and specific.', maxTokens: 500, temperature: 0.1 }
    );
    summary = result.response;
  } catch {
    // LLM unavailable — fall back to truncated context
    summary = conversationText.slice(-2000);
  }

  const recentText = recent.map(m => `[${m.role}]: ${m.content}`).join('\n');
  return `[CONTEXT SUMMARY (${toSummarize.length} older messages)]\n${summary}\n\n[RECENT MESSAGES]\n${recentText}`;
}
