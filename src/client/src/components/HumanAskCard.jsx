/**
 * Interactive choice chips for coding-agent asks (AskUserQuestion).
 * Clicking an option (or Use recommended) sends a structured reply via onSubmit.
 */

import { useMemo, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import {
  formatAskReply,
  pickRecommendedOption,
  recommendedSelections,
} from '../../../shared/humanAsk.js';

export default function HumanAskCard({ questions = [], onSubmit }) {
  const items = Array.isArray(questions) ? questions : [];
  const needsPicker = items.length > 1 || items.some((question) => question.multiSelect);
  const defaults = useMemo(() => recommendedSelections(items), [items]);
  const [selections, setSelections] = useState(defaults);
  const [customOpen, setCustomOpen] = useState(false);
  const [extra, setExtra] = useState('');
  const [submitted, setSubmitted] = useState(false);

  if (items.length === 0) return null;

  const submit = (nextSelections = selections, nextExtra = extra) => {
    const text = formatAskReply({ questions: items, selections: nextSelections, extra: nextExtra });
    if (!text || typeof onSubmit !== 'function') return;
    setSubmitted(true);
    onSubmit(text);
  };

  const toggleMulti = (question, label) => {
    setSelections((prev) => {
      const current = Array.isArray(prev[question.id]) ? prev[question.id] : [];
      const next = current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label];
      return { ...prev, [question.id]: next };
    });
  };

  const chooseSingle = (question, label) => {
    const next = { ...selections, [question.id]: label };
    setSelections(next);
    if (!needsPicker && !customOpen) submit(next, extra);
  };

  const canContinue = items.every((question) => {
    const value = selections[question.id];
    if (question.multiSelect) return Array.isArray(value) && value.length > 0;
    return Boolean(value);
  });

  return (
    <div className="mt-1 space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-300">
        <HelpCircle size={12} />
        Needs your input
      </div>
      {items.map((question) => {
        const recommended = pickRecommendedOption(question);
        const selected = selections[question.id];
        return (
          <div key={question.id} className="space-y-1.5">
            {question.header && (
              <div className="text-[10px] font-semibold uppercase tracking-wide text-surface-500">
                {question.header}
              </div>
            )}
            <div className="text-[13px] leading-snug text-surface-100">{question.question}</div>
            {question.multiSelect && (
              <div className="text-[10px] text-surface-500">Select one or more.</div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const isSelected = question.multiSelect
                  ? Array.isArray(selected) && selected.includes(option.label)
                  : selected === option.label;
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={submitted}
                    onClick={() => (
                      question.multiSelect
                        ? toggleMulti(question, option.label)
                        : chooseSingle(question, option.label)
                    )}
                    className={`max-w-full rounded-full border px-2.5 py-1 text-left text-[11px] transition-colors disabled:opacity-60 ${
                      isSelected
                        ? 'border-primary-400/70 bg-primary-500/20 text-primary-100'
                        : option.recommended
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20'
                          : 'border-surface-600/70 bg-surface-900/40 text-surface-200 hover:border-primary-500/40 hover:text-surface-50'
                    }`}
                    title={option.description || option.label}
                  >
                    <span className="font-medium">{option.label}</span>
                    {option.recommended && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-wide text-amber-300">
                        Rec
                      </span>
                    )}
                    {option.description && (
                      <span className="mt-0.5 block truncate text-[10px] font-normal text-surface-400">
                        {option.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {recommended && !question.multiSelect && items.length > 1 && (
              <div className="text-[10px] text-surface-500">
                Recommended: {recommended.label}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-1.5">
        {items.some((question) => pickRecommendedOption(question)) && (
          <button
            type="button"
            disabled={submitted}
            onClick={() => {
              const next = recommendedSelections(items);
              setSelections(next);
              submit(next, extra);
            }}
            className="rounded-md border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-100 hover:bg-amber-500/20 disabled:opacity-60"
          >
            Use recommended
          </button>
        )}
        {(needsPicker || customOpen) && (
          <button
            type="button"
            disabled={submitted || !canContinue}
            onClick={() => submit()}
            className="rounded-md border border-primary-500/50 bg-primary-500/15 px-2.5 py-1 text-[11px] text-primary-100 hover:bg-primary-500/25 disabled:opacity-60"
          >
            Continue
          </button>
        )}
        <button
          type="button"
          disabled={submitted}
          onClick={() => setCustomOpen((value) => !value)}
          className="rounded-md border border-surface-600/70 px-2.5 py-1 text-[11px] text-surface-300 hover:border-surface-500 hover:text-surface-100 disabled:opacity-60"
        >
          Something else
        </button>
      </div>

      {customOpen && (
        <div className="space-y-1.5">
          <textarea
            value={extra}
            disabled={submitted}
            onChange={(event) => setExtra(event.target.value)}
            rows={2}
            placeholder="Custom instructions for the agent…"
            className="w-full rounded-md border border-surface-600 bg-surface-950/70 px-2 py-1.5 text-[12px] text-surface-200 outline-none focus:border-primary-500/50"
          />
          <button
            type="button"
            disabled={submitted || !extra.trim()}
            onClick={() => submit(selections, extra)}
            className="rounded-md border border-primary-500/50 px-2.5 py-1 text-[11px] text-primary-100 hover:bg-primary-500/15 disabled:opacity-60"
          >
            Send custom reply
          </button>
        </div>
      )}
    </div>
  );
}
