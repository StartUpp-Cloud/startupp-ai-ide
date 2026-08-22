/**
 * The IDE process is Linux-only and is meant to run inside the Compose
 * service (`sai-ide`). Native Windows/macOS Node is not a supported runtime.
 */

export const COMPOSE_HINT = `StartUpp AI IDE runs inside Docker, not on the host OS.

  npm run pm2:start
  # development (Vite + nodemon):
  npm run pm2:start -- --dev

Open http://localhost:5173 (dev) or http://localhost:55590 (production).

To force a host process (not supported): SAI_ALLOW_HOST=1`;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkIdeRuntime(env = process.env) {
  if (env.SAI_IN_CONTAINER === '1' || env.SAI_ALLOW_HOST === '1') {
    return { ok: true };
  }
  return { ok: false, message: COMPOSE_HINT };
}

/**
 * Exit the process unless we are in the IDE container (or host is explicitly allowed).
 * @param {NodeJS.ProcessEnv} [env]
 */
export function assertIdeRuntime(env = process.env) {
  const result = checkIdeRuntime(env);
  if (result.ok) return;
  console.error(`\n${result.message}\n`);
  process.exit(1);
}
