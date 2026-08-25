/**
 * Deterministic context-pack selection for orchestrated coding-agent handoffs.
 * No LLM — pick skill tags from the original user goal so smaller models
 * are not flooded with every default-on skill pack on every round.
 */

const SKILL_TAG_RULES = [
  { tags: ['frontend', 'react', 'ui'], pattern: /\b(react|jsx|tsx|tailwind|css|frontend|layout|components?|ui\/ux)\b|\bui\b|\bux\b/i },
  { tags: ['testing'], pattern: /\b(tests?|testing|spec|coverage|jest|vitest|playwright)\b/i },
  { tags: ['deployment', 'devops'], pattern: /\b(deploy(?:ment|ing)?|docker|kubernetes|ci\/cd|cloudflare|wrangler)\b/i },
  { tags: ['database'], pattern: /\b(database|migration|schema|sql|prisma|postgres|sqlite)\b/i },
  { tags: ['security'], pattern: /\b(security|auth(?:entication)?|vulnerability|owasp|csrf|xss)\b/i },
  { tags: ['api'], pattern: /\b(apis?|endpoints?|graphql|rest(?:ful)?)\b/i },
  { tags: ['git'], pattern: /\b(git|github|commit|branch|merge|pull requests?|prs?)\b/i },
  { tags: ['typescript'], pattern: /\b(typescript|typecheck)\b/i },
];

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function inferSkillTags(text) {
  const source = String(text || '');
  if (!source.trim()) return [];
  const tags = [];
  for (const rule of SKILL_TAG_RULES) {
    if (!rule.pattern.test(source)) continue;
    for (const tag of rule.tags) {
      if (!tags.includes(tag)) tags.push(tag);
    }
  }
  return tags;
}

/**
 * True when a skill's id/name/category/tags overlap the selected task tags.
 */
export function skillMatchesTags(skill, taskTags = []) {
  if (!skill || !taskTags.length) return false;
  const haystack = [
    skill.id,
    skill.name,
    skill.category,
    ...(Array.isArray(skill.tags) ? skill.tags : []),
  ].filter(Boolean).map((part) => String(part).toLowerCase());

  return taskTags.some((tag) => {
    const needle = String(tag || '').toLowerCase().trim();
    if (!needle) return false;
    const boundary = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(needle)}(?:[^a-z0-9]|$)`);
    return haystack.some((part) => part === needle || boundary.test(part));
  });
}
