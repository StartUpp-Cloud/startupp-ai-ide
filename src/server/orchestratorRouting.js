const ORCHESTRATION_INTENT_RE = /\b(implement|fix|debug|build|refactor|migrate|deploy|deployed|test|review|investigate|check|inspect|status|git|changes?|pending|push|pushed|add|update|optimi[sz]e|integrate|rewrite|plan approved|execute the plan)\b/i;

export function shouldOrchestrateRequest({ mode, content, executeReviewedPlan = false }) {
  if (executeReviewedPlan) return true;
  if (mode === 'plan') return false;
  if (mode === 'autonomous') return true;
  const text = String(content || '').trim();
  if (text.length > 180) return true;
  return ORCHESTRATION_INTENT_RE.test(text);
}
