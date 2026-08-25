/**
 * Deterministic, human-readable titles for orchestrator plan steps.
 * Keeps content generation in the CLI agents — this only names the work.
 */

const GENERIC_STEP_RE = /^(?:step|part|phase|task)\s*\d+\s*$/i;
const STEP_PREFIX_RE = /^(?:step|part|phase|task)\s*\d+\s*[:.)\-–—]\s*/i;

export function stripGenericStepPrefix(text) {
  return String(text || '')
    .replace(/[*_`#]+/g, '')
    .replace(STEP_PREFIX_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deriveTaskTitle(text, index = 0) {
  const fallback = `Work on request (${index + 1})`;
  const cleaned = stripGenericStepPrefix(text);
  if (!cleaned || GENERIC_STEP_RE.test(cleaned)) return fallback;

  const firstLine = cleaned.split('\n').map((line) => line.trim()).find(Boolean) || cleaned;
  const sentence = firstLine.match(/^.{8,80}?(?:[.!?:]|$)/);
  let title = (sentence ? sentence[0] : firstLine).replace(/\s+/g, ' ').trim();
  title = title.replace(/[.]+$/, '').trim();
  if (title.length > 72) title = `${title.slice(0, 71).trimEnd()}…`;
  if (title.length < 4) return fallback;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/**
 * Split a goal into sub-tasks from the user's own numbered/bulleted steps.
 * Returns null when the goal is not an explicit list of 2+ items.
 */
export function heuristicDecomposeGoal(goal) {
  const source = String(goal || '');
  const itemStart = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/;
  const items = [];
  let current = null;
  for (const line of source.split('\n')) {
    const match = line.match(itemStart);
    if (match) {
      if (current) items.push(current);
      current = match[1].trim();
    } else if (current && line.trim()) {
      current += ` ${line.trim()}`;
    }
  }
  if (current) items.push(current);

  const cleaned = items.map((item) => item.trim()).filter((item) => item.length > 3);
  if (cleaned.length < 2) return null;

  return cleaned.slice(0, 5).map((item, i, arr) => ({
    title: deriveTaskTitle(item, i),
    parallelSafe: false,
    prompt: `This is part ${i + 1} of ${arr.length} of the user's overall request. Focus ONLY on your part; later phases consolidate and validate all parts together.\n\nOVERALL REQUEST:\n${source}\n\nYOUR PART:\n${item}`,
  }));
}
