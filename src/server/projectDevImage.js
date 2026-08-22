import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../docker/project-image.json');

export function loadProjectImageManifest(filePath = MANIFEST_PATH) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Versioned project-container image. Prefer a CI-published pull; local tag stays
 * stable so existing `docker run` call sites do not change.
 */
export function getProjectDevImageSpec(env = process.env, manifest = loadProjectImageManifest()) {
  const repository = env.SAI_DEV_IMAGE_REPO || manifest.repository;
  const version = env.SAI_DEV_IMAGE_VERSION || manifest.version;
  return {
    repository,
    version,
    remoteTag: `${repository}:${version}`,
    localTag: manifest.localTag,
    versionLabel: manifest.versionLabel,
  };
}

/**
 * reuse = local image already matches the published version.
 * pull = fetch the versioned tag (then fall back to a local build if pull fails).
 */
export function decideProjectImageAction({ hasLocal = false, localVersion = '', desiredVersion } = {}) {
  if (hasLocal && localVersion && localVersion === desiredVersion) return 'reuse';
  return 'pull';
}
