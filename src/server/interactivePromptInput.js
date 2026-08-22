const YN_PROMPT_TAIL = /(?:\(|\[)Y\/n(?:\)|\])\s*$/i;

export function isDefaultYesPrompt(promptTail = '') {
  return YN_PROMPT_TAIL.test(String(promptTail).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trimEnd());
}

/**
 * Survey/huh "(Y/n)" confirms often ignore a lone "y" in web PTYs.
 * Map yes to Enter (the default) and no to "n" + Enter.
 */
export function normalizeYnPromptInput(data, promptTail = '') {
  if (data !== 'Y' && data !== 'y' && data !== 'N' && data !== 'n') return data;
  if (!isDefaultYesPrompt(promptTail)) return data;
  if (data === 'n' || data === 'N') return 'n\r';
  return '\r';
}
