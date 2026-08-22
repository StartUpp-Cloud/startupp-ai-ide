/** Stable PTY project id for the IDE container's own shell (onboarding / host). */
export const IDE_SHELL_PROJECT_ID = 'ide';

export function isIdeShellProject(projectId) {
  return projectId === IDE_SHELL_PROJECT_ID;
}
