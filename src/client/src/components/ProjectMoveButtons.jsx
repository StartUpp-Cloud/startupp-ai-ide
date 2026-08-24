import { ChevronDown, ChevronUp } from "lucide-react";

const ProjectMoveButtons = ({
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  upLabel,
  downLabel,
  compact = false,
}) => {
  const btn = compact
    ? "p-0.5 rounded text-surface-500 hover:text-surface-200 hover:bg-surface-600 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-surface-500"
    : "btn-icon !p-1.5 disabled:opacity-30 disabled:pointer-events-auto disabled:hover:bg-transparent";

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={onMoveUp}
        disabled={!canMoveUp}
        className={btn}
        title={upLabel}
        aria-label={upLabel}
      >
        <ChevronUp className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={!canMoveDown}
        className={btn}
        title={downLabel}
        aria-label={downLabel}
      >
        <ChevronDown className={compact ? "w-3 h-3" : "w-3.5 h-3.5"} />
      </button>
    </div>
  );
};

export default ProjectMoveButtons;
