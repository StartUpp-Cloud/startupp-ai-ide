export function isUnsafeAutoConfirmPrompt(text) {
  return /\b(force\s+push|--force(?:-with-lease)?|delete|remove|destroy|drop\s+(?:table|database|db)|rm\s+-rf|git\s+reset\s+--hard|git\s+clean\s+-[\w-]*[fd]|irreversible|credential|credentials|secret|secrets|token|password|private\s+key)\b/i.test(text);
}

export function looksLikePrompt(text) {
  const lastBit = text.slice(-300);
  return /\?\s*$/.test(lastBit) || /\[.*\]\s*$/.test(lastBit) || /:\s*$/.test(lastBit);
}

export function isSafeOrchestratedPrompt(text) {
  return /\b(git\s+push|push(?:ed)?\b|deploy(?:ment|ed)?\b|git\s+status|status\b|changes?\b|pending\b)\b/i.test(text);
}

export function orchestratedAutoConfirm(text) {
  const lastBit = text.slice(-500);
  if (!looksLikePrompt(lastBit) || isUnsafeAutoConfirmPrompt(lastBit)) return null;
  if (isSafeOrchestratedPrompt(lastBit)) return 'y';
  return null;
}
