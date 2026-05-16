import { BUILD_INFO, buildInfoTitle } from '../utils/buildInfo';

export default function VersionBadge({ className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-surface-700/70 bg-surface-950/60 px-2 py-0.5 font-mono text-[10px] text-surface-400 ${className}`}
      title={buildInfoTitle()}
    >
      v{BUILD_INFO.release}+{BUILD_INFO.commit}
    </span>
  );
}
