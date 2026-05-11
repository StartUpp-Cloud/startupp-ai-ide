const CSI_FINAL_BYTE = /[\x40-\x7e]/;

function consumeCsiSequence(value, start) {
  let index = start + 2;
  while (index < value.length) {
    if (CSI_FINAL_BYTE.test(value[index])) return index + 1;
    index += 1;
  }
  return start;
}

/**
 * Remove terminal query response escape sequences that xterm can emit as input.
 * These are control answers like device attributes and cursor position reports,
 * not user keystrokes, so forwarding them to the shell can corrupt commands.
 */
export function stripTerminalQueryResponses(value = '') {
  let output = '';
  let index = 0;

  while (index < value.length) {
    const char = value[index];
    const next = value[index + 1];

    if (char === '\x1b' && next === '[') {
      const end = consumeCsiSequence(value, index);
      if (end > index) {
        const sequence = value.slice(index, end);
        if (/^\x1b\[(?:\?|>|)[0-9;]*[cRn]$/.test(sequence)) {
          index = end;
          continue;
        }
      }
    }

    output += char;
    index += 1;
  }

  return output;
}
