import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideProjectImageAction, getProjectDevImageSpec, loadProjectImageManifest } from '../projectDevImage.js';

const ideDockerfile = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../docker/Dockerfile.ide'),
  'utf8',
);
const devDepsStage = ideDockerfile.split('AS dev-deps')[1]?.split('AS development')[0] || '';
assert.match(devDepsStage, /NODE_ENV=development/, 'dev-deps must set NODE_ENV before npm ci');
assert.match(devDepsStage, /npm ci --include=dev/, 'dev-deps must install root devDependencies');

const developmentStage = ideDockerfile.split('AS development')[1] || '';
const copySource = developmentStage.indexOf('COPY . .');
assert.ok(copySource >= 0, 'development stage must copy source after deps');
assert.equal(
  /npm (ci|install)/.test(developmentStage.slice(copySource)),
  false,
  'development must not run npm install after COPY . .',
);

const manifest = loadProjectImageManifest();
assert.equal(typeof manifest.repository, 'string');
assert.match(manifest.repository, /^ghcr\.io\//);
assert.equal(typeof manifest.version, 'string');
assert.equal(manifest.localTag, 'startupp-ai-ide-dev:latest');
assert.equal(manifest.versionLabel, 'org.startupp.image.version');

const projectDockerfile = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../docker/Dockerfile.dev'),
  'utf8',
);
assert.match(projectDockerfile, /^FROM node:22-bookworm AS base$/m, 'project containers must ship Node 22 for current Wrangler');

const spec = getProjectDevImageSpec({});
assert.equal(spec.remoteTag, `${manifest.repository}:${manifest.version}`);
assert.equal(spec.localTag, manifest.localTag);
assert.equal(spec.version, manifest.version);

const overridden = getProjectDevImageSpec({
  SAI_DEV_IMAGE_REPO: 'ghcr.io/example/ide-dev',
  SAI_DEV_IMAGE_VERSION: '9.9.9',
});
assert.equal(overridden.remoteTag, 'ghcr.io/example/ide-dev:9.9.9');
assert.equal(overridden.localTag, manifest.localTag);

assert.equal(decideProjectImageAction({
  hasLocal: true,
  localVersion: '1.3.0',
  desiredVersion: '1.3.0',
}), 'reuse');
assert.equal(decideProjectImageAction({
  hasLocal: true,
  localVersion: '1.2.0',
  desiredVersion: '1.3.0',
}), 'pull');
assert.equal(decideProjectImageAction({
  hasLocal: false,
  desiredVersion: '1.3.0',
}), 'pull');
assert.equal(decideProjectImageAction({
  hasLocal: true,
  localVersion: '',
  desiredVersion: '1.3.0',
}), 'pull');

console.log('projectDevImage tests passed');
