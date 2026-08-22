import path from 'node:path';
import { posixQuote } from './dockerCopy.js';

export const CONTAINER_FS_ROOTS = ['/workspace', '/home/dev'];
export const CONTAINER_FILE_MAX_BYTES = 256 * 1024;

export function assertContainerPath(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Path is required');
  const resolved = path.posix.resolve('/', raw);
  if (resolved.includes('\0')) throw new Error('Invalid path');
  const allowed = CONTAINER_FS_ROOTS.some((root) => resolved === root || resolved.startsWith(`${root}/`));
  if (!allowed) throw new Error('Path must stay inside /workspace or /home/dev');
  return resolved;
}

export function assertChmodMode(mode) {
  const value = String(mode || '').trim();
  if (!/^[0-7]{3,4}$/.test(value)) throw new Error('Mode must be an octal like 644 or 0755');
  return value;
}

export function createDirectoryCommand(dirPath) {
  const dest = assertContainerPath(dirPath);
  return `mkdir -p ${posixQuote(dest)} && chown dev:dev ${posixQuote(dest)}`;
}

export function createFileCommand(filePath) {
  const dest = assertContainerPath(filePath);
  const dir = path.posix.dirname(dest);
  return `mkdir -p ${posixQuote(dir)} && if [ ! -e ${posixQuote(dest)} ]; then install -m 644 -o dev -g dev /dev/null ${posixQuote(dest)}; fi`;
}

export function deletePathCommand(targetPath, isDirectory) {
  const dest = assertContainerPath(targetPath);
  if (CONTAINER_FS_ROOTS.includes(dest)) throw new Error('Refusing to delete a workspace root');
  return isDirectory ? `rm -rf ${posixQuote(dest)}` : `rm -f ${posixQuote(dest)}`;
}

export function chmodCommand(targetPath, mode) {
  const dest = assertContainerPath(targetPath);
  const octal = assertChmodMode(mode);
  return `chmod ${octal} ${posixQuote(dest)}`;
}

export function readFileCommand(filePath) {
  const dest = assertContainerPath(filePath);
  return `if [ ! -f ${posixQuote(dest)} ]; then echo MISSING; exit 0; fi; stat -c '%s %a' ${posixQuote(dest)}; echo '---'; base64 ${posixQuote(dest)}`;
}

export function writeFileCommand(filePath, base64Content) {
  const dest = assertContainerPath(filePath);
  const dir = path.posix.dirname(dest);
  const payload = String(base64Content || '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.replace(/\s/g, ''))) {
    throw new Error('Content must be base64');
  }
  return `mkdir -p ${posixQuote(dir)} && printf '%s' ${posixQuote(payload)} | base64 -d > ${posixQuote(dest)} && chown dev:dev ${posixQuote(dest)}`;
}

export function listDirectoryCommand(dirPath, depth = 1) {
  const dest = assertContainerPath(dirPath);
  const maxDepth = Math.min(Math.max(parseInt(depth, 10) || 1, 1), 3);
  return `find ${posixQuote(dest)} -maxdepth ${maxDepth} -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.git' -not -name '.git' -printf '%y|%s|%P\\n' 2>/dev/null | head -500`;
}

export function isLikelyText(buffer) {
  if (!buffer || buffer.length === 0) return true;
  if (buffer.includes(0)) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  let weird = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) weird += 1;
  }
  return weird / sample.length < 0.05;
}
