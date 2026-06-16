// Orchestration is for genuinely MULTI-STEP work. A single operational command
// ("deploy to dev-1", "check git status", "fix the login bug") should run as a
// normal agent turn — which is now backed by the diligence loop (verify + nudge
// + concise report) — instead of being wrapped in a one-task orchestrator plan
// that just renders a noisy, static "0/1 tasks" indicator.
//
// We therefore orchestrate only when there is real evidence of multiple ordered
// steps, or the caller explicitly opts in (autonomous mode / approved plan).

// Explicit sequencing language that implies ordered, dependent steps.
const SEQUENCE_RE = /(\bthen\b|\band then\b|\bafter that\b|\bafterwards?\b|\bonce (?:that|you|it|the)\b|\bfollowed by\b|\bnext[,:]|\bfinally[,:]|\blastly[,:]|\bstep\s*\d|\bphase\s*\d)/i;

// Two or more enumerated or bulleted items → an explicit step list.
function hasEnumeratedSteps(text) {
  const matches = text.match(/(?:^|\n)\s*(?:\d+[.)]\s+|[-*•]\s+)/g);
  return !!matches && matches.length >= 2;
}

/**
 * Decide whether a request should run through the multi-step orchestrator.
 *
 * @param {{ mode?: string, content?: string, executeReviewedPlan?: boolean }} opts
 * @returns {boolean}
 */
export function shouldOrchestrateRequest({ mode, content, executeReviewedPlan = false }) {
  if (executeReviewedPlan) return true;                        // approved plan → execute as steps
  if (mode === 'plan' || mode === 'plan-review') return false; // planning never auto-executes
  if (mode === 'autonomous') return true;                      // explicit opt-in

  const text = String(content || '').trim();
  if (!text) return false;

  // Explicit multi-step phrasing or an enumerated step list.
  if (SEQUENCE_RE.test(text)) return true;
  if (hasEnumeratedSteps(text)) return true;

  // Very long, detailed asks are typically multi-part even without markers.
  if (text.length > 600) return true;

  // Otherwise: a single command/question → normal diligence-backed turn.
  return false;
}
