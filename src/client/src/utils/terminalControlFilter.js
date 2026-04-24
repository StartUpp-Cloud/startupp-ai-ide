export function stripTerminalQueryResponses(data) {
  return data
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1bP[\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[\??\d+(?:;\d+)*R/g, '')
    .replace(/\x1b\[\??\d+(?:;\d+)*\$[yY]/g, '')
    .replace(/\x1b\[>[\d;]*c/g, '')
    .replace(/\x1b\[\?[\d;]*c/g, '');
}
