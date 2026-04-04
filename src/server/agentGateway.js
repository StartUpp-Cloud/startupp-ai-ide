// src/server/agentGateway.js
import { EventEmitter } from 'events';
import { llmProvider } from './llmProvider.js';
import { chatStore } from './chatStore.js';
import { agentShellPool } from './agentShellPool.js';
import { buildAgentContext } from './contextCompactor.js';

const AGENT_SYSTEM_PROMPT = `You are an autonomous coding agent inside a development IDE. You control shell sessions that run AI coding tools (Claude Code, GitHub Copilot, Aider, etc.).

Your job:
1. Receive a user task/request
2. Decide which tool to use and what prompt to send
3. Monitor the tool's output
4. Auto-respond to the tool's confirmation prompts (yes/no/continue)
5. Report progress and results back to the user

You communicate by returning JSON actions:

ACTIONS:
- {"action":"shell","tool":"claude","input":"the prompt to send"} — Send a prompt to a CLI tool
- {"action":"shell","tool":"shell","input":"npm test"} — Run a shell command
- {"action":"respond","input":"y"} — Respond to a tool's confirmation prompt
- {"action":"report","content":"Status update for the user","tasks":[{"title":"Step 1","status":"done"},{"title":"Step 2","status":"running"}]} — Send a progress update
- {"action":"done","content":"Final summary of what was accomplished"} — Task complete
- {"action":"ask","content":"Question for the user"} — Need user input (ONLY when truly ambiguous)
- {"action":"plan","steps":[{"title":"Step 1","prompt":"..."},{"title":"Step 2","prompt":"..."}]} — Return a plan for user approval (plan mode only)

RULES:
- In agent mode: act autonomously, minimize questions, approve tool requests automatically
- In plan mode: return a plan first, wait for approval, then execute step by step
- Always approve safe operations (file edits, reads, git operations, installs)
- Only ask the user when genuinely ambiguous (multiple valid interpretations)
- Keep progress reports concise but informative
- Use the most appropriate tool for the task (claude for complex coding, shell for commands)

Respond with a single JSON action per turn. No markdown wrapping. Just the JSON object.`;

class AgentGateway extends EventEmitter {
  constructor() {
    super();
    this._running = new Map(); // projectId -> { aborted }
  }

  async handleTask({ projectId, content, mode, broadcastFn }) {
    this._abort(projectId);

    const ctx = { aborted: false };
    this._running.set(projectId, ctx);

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });

      // Build context from recent chat history
      const chatContext = await buildAgentContext(projectId);

      const modeInstruction = mode === 'plan'
        ? 'MODE: PLAN — Return a "plan" action with steps before executing anything.'
        : 'MODE: AGENT — Act autonomously. Execute the task directly.';

      let iterations = 0;
      const MAX_ITERATIONS = 30;
      let lastShellOutput = '';

      while (!ctx.aborted && iterations < MAX_ITERATIONS) {
        iterations++;

        const userPrompt = iterations === 1
          ? `${modeInstruction}\n\nChat context:\n${chatContext}\n\nUser request: ${content}`
          : `${modeInstruction}\n\nShell output from last action:\n${lastShellOutput.slice(-3000)}\n\nDecide what to do next.`;

        let llmResponse;
        try {
          const result = await llmProvider.generateResponse(userPrompt, {
            systemPrompt: AGENT_SYSTEM_PROMPT,
            maxTokens: 1000,
            temperature: 0.2,
          });
          llmResponse = result.response;
        } catch (err) {
          this._addErrorMessage(projectId, `LLM error: ${err.message}`, broadcastFn);
          break;
        }

        if (ctx.aborted) break;

        let action;
        try {
          const cleaned = llmResponse.replace(/```json\n?|\n?```/g, '').trim();
          action = JSON.parse(cleaned);
        } catch {
          // LLM returned non-JSON — treat as a direct response
          this._addAgentMessage(projectId, llmResponse, broadcastFn);
          break;
        }

        switch (action.action) {
          case 'shell': {
            let sessionId;
            try {
              const sess = await agentShellPool.getSession(projectId, action.tool);
              sessionId = sess.sessionId;
            } catch (err) {
              this._addErrorMessage(projectId, `Failed to get shell session: ${err.message}`, broadcastFn);
              this._finish(projectId, broadcastFn);
              return;
            }

            const input = action.input.endsWith('\n') ? action.input : action.input + '\n';
            agentShellPool.write(sessionId, input);

            // Wait for output to settle
            lastShellOutput = await this._waitForOutput(sessionId, ctx);
            if (ctx.aborted) break;

            // Check for confirmation prompts and auto-respond
            try {
              const { autoResponder } = await import('./autoResponder.js');
              const promptMatch = autoResponder.detectPrompt?.(lastShellOutput, action.tool);
              if (promptMatch) {
                const response = promptMatch.defaultResponse || 'y';
                agentShellPool.write(sessionId, response + '\n');
                const moreOutput = await this._waitForOutput(sessionId, ctx, 3000);
                lastShellOutput += moreOutput;
              }
            } catch {}

            this._addProgressMessage(projectId,
              `Running ${action.tool}: ${action.input.slice(0, 100)}${action.input.length > 100 ? '...' : ''}`,
              broadcastFn);
            break;
          }

          case 'respond': {
            for (const [, entry] of agentShellPool.sessions) {
              if (entry.projectId === projectId) {
                agentShellPool.write(entry.sessionId, action.input + '\n');
                break;
              }
            }
            lastShellOutput = '';
            await new Promise(r => setTimeout(r, 1000));
            break;
          }

          case 'report':
            this._addProgressMessage(projectId, action.content, broadcastFn, action.tasks);
            // Continue loop — report is informational, not terminal
            break;

          case 'plan':
            this._addAgentMessage(projectId,
              `**Proposed Plan:**\n\n${action.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}\n\nApprove this plan to begin execution.`,
              broadcastFn,
              { plan: action.steps });
            this._finish(projectId, broadcastFn);
            return;

          case 'ask':
            this._addAgentMessage(projectId, action.content, broadcastFn);
            this._finish(projectId, broadcastFn);
            return;

          case 'done':
            this._addAgentMessage(projectId, action.content, broadcastFn);
            this._finish(projectId, broadcastFn);
            return;

          default:
            this._addAgentMessage(projectId, llmResponse, broadcastFn);
            this._finish(projectId, broadcastFn);
            return;
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        this._addErrorMessage(projectId, 'Agent reached maximum iterations. Stopping.', broadcastFn);
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Agent error: ${error.message}`, broadcastFn);
    } finally {
      this._finish(projectId, broadcastFn);
    }
  }

  _abort(projectId) {
    const ctx = this._running.get(projectId);
    if (ctx) ctx.aborted = true;
    this._running.delete(projectId);
  }

  _finish(projectId, broadcastFn) {
    this._running.delete(projectId);
    broadcastFn({ type: 'agent-status', projectId, busy: false });
  }

  _waitForOutput(sessionId, ctx, quietMs = 5000) {
    return new Promise((resolve) => {
      let timeout;
      let output = '';
      const handler = ({ sessionId: sid, data }) => {
        if (sid !== sessionId || ctx.aborted) return;
        output += data;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          agentShellPool.removeListener('output', handler);
          resolve(output);
        }, quietMs);
      };
      agentShellPool.on('output', handler);
      timeout = setTimeout(() => {
        agentShellPool.removeListener('output', handler);
        resolve(output);
      }, quietMs);
    });
  }

  _addAgentMessage(projectId, content, broadcastFn, metadata = null) {
    const msg = chatStore.addMessage({ projectId, role: 'agent', content, metadata });
    broadcastFn({ type: 'chat-message', message: msg });
  }

  _addProgressMessage(projectId, content, broadcastFn, tasks = null) {
    const msg = chatStore.addMessage({ projectId, role: 'progress', content, metadata: { tasks } });
    broadcastFn({ type: 'chat-progress', projectId, message: msg });
  }

  _addErrorMessage(projectId, content, broadcastFn) {
    const msg = chatStore.addMessage({ projectId, role: 'error', content });
    broadcastFn({ type: 'chat-message', message: msg });
  }
}

export const agentGateway = new AgentGateway();
export default agentGateway;
