/**
 * Diligence — the quality/completion loop for autonomous coding agents.
 *
 * The same model behind Claude Code / Codex / OpenCode behaves very differently
 * depending on the harness wrapped around it. A bare CLI ends a turn the moment
 * the model emits a stop token — nobody asks "did you actually finish? did you
 * run the tests?". This module manufactures the persistence that the desktop /
 * web harnesses get for free, in a tool-agnostic way:
 *
 *   1. CURATE  — buildOperatingContract() injects a strong engineering doctrine
 *                into the agent's first message (take your time → plan →
 *                implement → VERIFY with tests/e2e → assert quality → report).
 *   2. ASSERT  — evaluateCompletion() runs a skeptical LLM "completion gate" over
 *                the agent's output to decide whether the work is genuinely done
 *                AND verified, not merely described.
 *   3. NUDGE   — buildNudgeMessage() turns an unmet verdict into a direct,
 *                actionable continuation prompt that is fed back to the same
 *                CLI session, looping until the gate passes or a budget is hit.
 *   4. REPORT  — the doctrine mandates a fixed report structure, so the final
 *                user-facing message is clean and follow-up-friendly, and the
 *                verdict is attached as metadata the client renders as a strip.
 *
 * The gateway owns the loop; this module owns the policy.
 */

import { llmProvider } from './llmProvider.js';
import { getDB } from './db.js';

const DEFAULT_DILIGENCE_SETTINGS = {
  enabled: true,
  // How many follow-up "you're not done yet" rounds we are willing to drive
  // before giving up and surfacing whatever we have. Keep small — each round is
  // a full agent turn.
  maxNudges: 2,
  // Nudge when new logic appears to have shipped without any validation run.
  requireVerification: true,
  // Verdict confidence at/above which we trust a "done" without re-checking.
  minConfidence: 0.7,
  // Tools the loop is allowed to drive. Weak local models (ollama) and Aider's
  // direct-edit format are intentionally excluded — the loop would just churn.
  tools: ['claude', 'codex', 'opencode', 'copilot'],
};

export function getDiligenceSettings() {
  try {
    const db = getDB();
    return { ...DEFAULT_DILIGENCE_SETTINGS, ...(db.data?.diligenceSettings || {}) };
  } catch {
    return { ...DEFAULT_DILIGENCE_SETTINGS };
  }
}

export async function updateDiligenceSettings(updates = {}) {
  const db = getDB();
  if (!db.data.diligenceSettings) db.data.diligenceSettings = { ...DEFAULT_DILIGENCE_SETTINGS };
  Object.assign(db.data.diligenceSettings, updates);
  await db.write();
  return getDiligenceSettings();
}

/** Plan/review modes never edit or verify, so the loop is a no-op there. */
function isAgentMode(mode) {
  return mode !== 'plan' && mode !== 'plan-review';
}

/** Whether the curate→nudge loop should run for a given tool + mode. */
export function diligenceAppliesTo(tool, mode, settings = getDiligenceSettings()) {
  return !!settings.enabled && isAgentMode(mode) && settings.tools.includes(tool);
}

/**
 * The Engineering Diligence Contract — the doctrine prepended to the agent's
 * first message. It does double duty: it raises effort/persistence, and its
 * REPORT section defines the exact structure that both the user-facing message
 * and the completion gate are checked against.
 *
 * Returns '' for plan modes or tools we don't drive, so callers can inject it
 * unconditionally.
 */
export function buildOperatingContract({ tool, mode } = {}) {
  const settings = getDiligenceSettings();
  if (!settings.enabled || !isAgentMode(mode) || !settings.tools.includes(tool)) return '';

  return [
    'ENGINEERING DILIGENCE CONTRACT — follow this on this turn and every follow-up turn:',
    '',
    '1. UNDERSTAND — Before editing, read the relevant code, tests, and conventions. Restate the goal and the acceptance criteria to yourself. Use the maximum practical reasoning depth.',
    '2. PLAN — Outline the steps and the edge cases you must handle. Prefer a complete first pass over a fast, shallow one.',
    '3. IMPLEMENT — Make changes coherent with existing patterns. Keep working through reasonable follow-up fixes; do not stop at a partial answer or after merely describing changes.',
    '4. VERIFY — Mandatory, not optional. Use every tool available to PROVE the change works:',
    "   - Run the project's typecheck / lint / build.",
    '   - Run the relevant unit/integration tests. If new logic has no test, WRITE one, then run it.',
    '   - For user-facing or UI features, run end-to-end checks (e.g. Playwright) when available.',
    '   - Actually execute the commands and read the output. NEVER claim something passes without running it.',
    '   - If a validation genuinely cannot be run, state exactly which one and why.',
    "5. ASSERT QUALITY — Re-read your own diff. Check error handling, edge cases, security, and that you didn't break existing behavior or leave debug/dead code behind.",
    '6. FOLLOW THE RULES — Honor CLAUDE.md / AGENTS.md / project rules / skills above your own defaults. If a rule grants STANDING APPROVAL for an action (e.g. "always approved to deploy to dev-1", "always deploy changes to the dev-1 worker"), perform that action as part of completing the task — do not pause to ask for confirmation or list it as a deferred "next step".',
    '7. REPORT — End every turn with EXACTLY this structure (Markdown), so the human can follow up easily:',
    '',
    '## Summary',
    '<2-4 sentences: what you did and why>',
    '',
    '## Changes',
    '- `path/to/file` — what changed and why',
    '',
    '## Verification',
    '- <command you ran> → <real result, e.g. ✅ 12/12 passed · ❌ failing · not run because …>',
    '',
    '## Quality',
    '- <edge cases handled, risks, assumptions, follow-ups — or "none">',
    '',
    '## Next',
    '- <ready for review, or the concrete next step / decision you need from the user>',
    '',
    'Do not declare the task complete until VERIFY has actually been performed. Take the time you need to get it right.',
  ].join('\n');
}

// ── Completion gate ─────────────────────────────────────────────────────────

const VERDICT_SYSTEM_PROMPT = `You are a strict senior engineer acting as a COMPLETION GATE for an autonomous coding agent.
Given the user's GOAL and the agent's TRANSCRIPT (its output for this turn), decide whether the work is GENUINELY complete AND verified.

Be skeptical. The agent is "done" ONLY if ALL of these hold:
- The requested work is actually implemented in code — not merely described, planned, or promised.
- The agent RAN verification (tests, build, typecheck, or an explicit run/e2e) and reported REAL results — not a bare claim of success.
- There is nothing the agent said it would do but did not, and no obvious missing piece for the stated goal.

Return ONLY valid JSON, no prose, with this exact shape:
{
  "done": boolean,
  "confidence": 0.0,
  "headline": "one-line status, <= 90 chars",
  "completed": ["short bullets of what was actually done AND verified"],
  "outstanding": ["specific things still missing or unverified — empty array if done"],
  "verification": { "ran": boolean, "passed": true, "kind": "tests|build|typecheck|e2e|manual|none", "details": "short" },
  "nudge": "if not done: a direct, specific instruction telling the agent exactly what to finish and verify next; empty string if done"
}

Rules:
- If the agent only described changes with no evidence of running them: done=false, verification.ran=false.
- If new logic/feature was added but no test or validation was run: done=false, and the nudge MUST require running (or writing then running) the relevant tests/build.
- If PROJECT RULES are provided and the agent deferred or skipped an action that a rule REQUIRES or grants STANDING APPROVAL for (e.g. a rule says "always deploy to dev-1" but the agent said deploy is an optional next step): done=false, and the nudge MUST instruct the agent to perform that action now per the rule.
- "passed" is true/false/null (null when nothing was run).
- Keep bullets concise. The nudge must be actionable and name the specific gap. Do not invent work the user did not ask for.`;

function clamp01(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Evidence-based heuristic used when the LLM layer is unavailable or errors. */
function heuristicVerdict(transcript, settings) {
  const text = String(transcript || '');
  const ranVerification = /(\bPASS\b|\bFAIL\b|\d+\s+pass|passed|failing|\btsc\b|type-?check|build (succeeded|failed|complete)|vitest|jest|pytest|playwright|npm (run )?test|yarn test|pnpm test|coverage|✓|✔)/i.test(text);
  const hasReport = /##\s*Verification/i.test(text) || /##\s*Summary/i.test(text);
  const looksIncomplete = /(TODO|not implemented|next step|i (will|'ll)|let me know if|placeholder|stub)/i.test(text);

  const done = hasReport && (!settings.requireVerification || ranVerification) && !looksIncomplete;
  const outstanding = [];
  if (settings.requireVerification && !ranVerification) outstanding.push('No test/build/typecheck output is visible — verification was not actually run.');
  if (!hasReport) outstanding.push('Missing the structured report (## Summary / ## Verification / ## Next).');
  if (looksIncomplete) outstanding.push('The output reads as partial or describes work still to be done.');

  return {
    done,
    confidence: done ? 0.6 : 0.55,
    headline: done ? 'Looks complete and verified' : 'Likely incomplete or unverified',
    completed: [],
    outstanding,
    verification: { ran: ranVerification, passed: ranVerification ? null : null, kind: ranVerification ? 'tests' : 'none', details: '' },
    nudge: outstanding.length
      ? `Finish the remaining work and then actually run the relevant validation. Specifically: ${outstanding.join(' ')}`
      : '',
    source: 'heuristic',
  };
}

/**
 * Run the completion gate over the agent's output for this turn.
 *
 * @returns {Promise<object>} verdict — see VERDICT_SYSTEM_PROMPT shape, plus
 *   a `source` field ('llm' | 'heuristic').
 */
export async function evaluateCompletion({ goal, transcript, changedFiles = [], rules = '', settings = getDiligenceSettings() } = {}) {
  const tail = String(transcript || '').slice(-7000);
  const filesLine = changedFiles.length
    ? changedFiles.slice(0, 40).map((f) => (typeof f === 'string' ? f : f.path)).filter(Boolean).join(', ')
    : '(none reported)';

  // Without a configured LLM layer we fall back to evidence heuristics so the
  // gate still does something useful rather than silently passing everything.
  let llmEnabled = false;
  try { llmEnabled = !!llmProvider.getSettings?.().enabled; } catch { llmEnabled = false; }
  if (!llmEnabled) return heuristicVerdict(tail, settings);

  const userPrompt = [
    `GOAL:\n${String(goal || '').slice(0, 2000)}`,
    rules ? `\nPROJECT RULES (must be satisfied):\n${String(rules).slice(0, 1500)}` : '',
    `\nCHANGED FILES: ${filesLine}`,
    `\nTRANSCRIPT (the agent's output for this turn, tail):\n${tail}`,
  ].filter(Boolean).join('\n');

  try {
    const result = await llmProvider.generateResponse(userPrompt, {
      systemPrompt: VERDICT_SYSTEM_PROMPT,
      maxTokens: 700,
      temperature: 0.1,
    });
    const parsed = extractJson(result?.response);
    if (!parsed) return heuristicVerdict(tail, settings);

    const verification = parsed.verification && typeof parsed.verification === 'object' ? parsed.verification : {};
    let done = !!parsed.done;
    // Guardrail: never accept "done" with high confidence if verification was
    // required but provably not run.
    if (done && settings.requireVerification && verification.ran === false) done = false;
    if (done && clamp01(parsed.confidence) < settings.minConfidence) done = false;

    return {
      done,
      confidence: clamp01(parsed.confidence),
      headline: String(parsed.headline || (done ? 'Complete and verified' : 'Not yet complete')).slice(0, 90),
      completed: Array.isArray(parsed.completed) ? parsed.completed.slice(0, 8).map(String) : [],
      outstanding: Array.isArray(parsed.outstanding) ? parsed.outstanding.slice(0, 8).map(String) : [],
      verification: {
        ran: !!verification.ran,
        passed: verification.passed === true ? true : verification.passed === false ? false : null,
        kind: typeof verification.kind === 'string' ? verification.kind : 'none',
        details: String(verification.details || '').slice(0, 240),
      },
      nudge: String(parsed.nudge || '').slice(0, 1200),
      source: 'llm',
    };
  } catch (err) {
    console.warn('[diligence] completion gate LLM call failed, using heuristic:', err.message);
    return heuristicVerdict(tail, settings);
  }
}

// ── Report parsing ───────────────────────────────────────────────────────────

const REPORT_SECTIONS = ['Summary', 'Changes', 'Verification', 'Quality', 'Next'];
// Matches a section header line in any of the shapes models emit:
//   "## Summary", "**Summary**", "Summary:", "### Verification"
const SECTION_HEADER_RE = new RegExp(
  `^\\s*(?:#{1,4}\\s*)?\\*{0,2}\\s*(${REPORT_SECTIONS.join('|')})\\s*\\*{0,2}\\s*:?\\s*$`,
  'i',
);

/** Classify a single verification line into a check status. */
function classifyCheck(text) {
  if (/(❌|✗|✘|\bfail(ed|ing|ure)?\b|\berror\b|\bnon-?zero\b|did not pass)/i.test(text)) return 'fail';
  if (/(not run|could not|couldn'?t|unable to|skipped|n\/a\b|blocked)/i.test(text)) return 'skip';
  if (/(✅|✔|✓|\bpass(ed|es)?\b|\bsuccess(ful|fully)?\b|\bok\b|HTTP\/?\d?\s*200|\bclean\b|up to date|completed)/i.test(text)) return 'pass';
  return 'info';
}

/** Parse a bullet list block into individual check items. */
function parseChecks(block) {
  const checks = [];
  for (const raw of block.split('\n')) {
    const line = raw.replace(/^\s*[-*•·]\s+/, (m) => (m === raw ? raw : '')); // only strip if it was a bullet
    const isBullet = /^\s*[-*•·]\s+/.test(raw);
    const text = isBullet ? raw.replace(/^\s*[-*•·]\s+/, '').trim() : raw.trim();
    if (!text) continue;
    if (!isBullet && checks.length) {
      // Continuation line for the previous check (wrapped result).
      checks[checks.length - 1].result = `${checks[checks.length - 1].result} ${text}`.trim();
      continue;
    }
    if (!isBullet) continue;
    // Split "command → result" (also handles -> and :)
    const m = text.split(/\s*(?:→|->)\s*/);
    let label = m[0].trim();
    let result = m.slice(1).join(' → ').trim();
    label = label.replace(/^`|`$/g, '');
    checks.push({ label, result, status: classifyCheck(text) });
  }
  return checks;
}

/**
 * Split an agent's turn output into the human-facing structured report and the
 * preceding reasoning narration ("activity"), and pull the Verification block
 * out as discrete checks. Graceful: if no recognizable report is present,
 * `hasReport` is false and `body` is the original text unchanged.
 *
 * When the output contains multiple report blocks (e.g. after diligence nudge
 * rounds), the LAST one wins — it reflects the final state of the work.
 *
 * @returns {{ hasReport: boolean, activity: string, body: string, summary: string,
 *   checks: Array<{label:string,result:string,status:string}> }}
 */
export function parseAgentReport(text) {
  const src = String(text || '');
  const lines = src.split('\n');

  // Locate every section header and where it sits.
  const headers = [];
  lines.forEach((line, i) => {
    const m = line.match(SECTION_HEADER_RE);
    if (m) headers.push({ name: m[1].replace(/^\w/, (c) => c.toUpperCase()), line: i });
  });

  // Find the start of the LAST report block — the last "Summary" header, or the
  // earliest header of the last contiguous run if Summary is absent.
  const summaryIdxs = headers.filter((h) => /^summary$/i.test(h.name));
  const startHeader = summaryIdxs.length ? summaryIdxs[summaryIdxs.length - 1] : null;
  if (!startHeader) {
    return { hasReport: false, activity: '', body: src, summary: '', checks: [] };
  }

  const activity = lines.slice(0, startHeader.line).join('\n').trim();
  const reportHeaders = headers.filter((h) => h.line >= startHeader.line);

  // Carve the report into sections.
  const sections = {};
  reportHeaders.forEach((h, i) => {
    const end = i + 1 < reportHeaders.length ? reportHeaders[i + 1].line : lines.length;
    sections[h.name.toLowerCase()] = lines.slice(h.line + 1, end).join('\n').trim();
  });

  const checks = sections.verification ? parseChecks(sections.verification) : [];

  // Rebuild the body markdown WITHOUT the Verification block (rendered as checks
  // separately), preserving the other sections in order.
  const bodyParts = [];
  reportHeaders.forEach((h, i) => {
    if (/^verification$/i.test(h.name)) return;
    const end = i + 1 < reportHeaders.length ? reportHeaders[i + 1].line : lines.length;
    bodyParts.push(lines.slice(h.line, end).join('\n').trim());
  });

  return {
    hasReport: true,
    activity,
    body: bodyParts.join('\n\n').trim(),
    summary: sections.summary || '',
    checks,
  };
}

/** Pull the first JSON object out of a model response (handles code fences). */
function extractJson(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

/**
 * Turn an unmet verdict into a direct continuation prompt fed back to the same
 * CLI session. Deliberately terse and imperative — the agent already has the
 * full context; we only point it at the gap.
 */
export function buildNudgeMessage(verdict) {
  const lines = [
    'Your previous turn is NOT complete yet. Before this task can be considered done, address the following:',
    '',
  ];
  const outstanding = (verdict?.outstanding || []).filter(Boolean);
  if (outstanding.length) {
    outstanding.forEach((o) => lines.push(`- ${o}`));
    lines.push('');
  }
  if (verdict?.nudge) {
    lines.push(verdict.nudge, '');
  }
  lines.push(
    'Do NOT restate what you already did. Finish the remaining work, then ACTUALLY RUN the relevant validation (tests / build / typecheck / e2e — write a test first if none exists) and report the real command output. End with the standard ## Summary / ## Changes / ## Verification / ## Quality / ## Next report.',
  );
  return lines.join('\n');
}
