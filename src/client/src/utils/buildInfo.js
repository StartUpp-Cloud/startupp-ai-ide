export const BUILD_INFO = {
  release: import.meta.env.VITE_APP_RELEASE || 'dev',
  commit: import.meta.env.VITE_GIT_SHA || 'local',
  builtAt: import.meta.env.VITE_BUILD_TIME || '',
};

export function buildInfoTitle() {
  const parts = [`Release ${BUILD_INFO.release}`, `Commit ${BUILD_INFO.commit}`];
  if (BUILD_INFO.builtAt) parts.push(`Built ${BUILD_INFO.builtAt}`);
  return parts.join(' | ');
}
