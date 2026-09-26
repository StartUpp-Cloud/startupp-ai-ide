import { RotateCcw, Type } from 'lucide-react';
import { useChatAppearance } from '../contexts/ChatAppearanceContext.jsx';
import {
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CHAT_HEADING_SCALES,
  CHAT_LINE_SPACINGS,
} from '../utils/chatAppearance.js';

export default function ChatAppearanceSettings() {
  const { appearance, cssVars, updateAppearance, resetAppearance } = useChatAppearance();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Type className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-400" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-surface-200">Chat appearance</h3>
            <p className="mt-0.5 text-xs leading-relaxed text-surface-500">
              Font size and heading emphasis for assistant replies. This does not change how the agent writes.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={resetAppearance}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-surface-700 px-2 py-1 text-[11px] text-surface-400 hover:border-surface-600 hover:text-surface-200"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      <div>
        <label className="mb-2 block text-xs text-surface-400">
          Body text ({appearance.fontSize}px)
        </label>
        <input
          type="range"
          min={CHAT_FONT_SIZE_MIN}
          max={CHAT_FONT_SIZE_MAX}
          value={appearance.fontSize}
          onChange={(e) => updateAppearance({ fontSize: parseInt(e.target.value, 10) })}
          className="w-full accent-primary-500"
        />
        <div className="mt-1 flex justify-between text-[10px] text-surface-500">
          <span>Small</span>
          <span>Large</span>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-xs text-surface-400">Headings</label>
        <div className="grid grid-cols-3 gap-2">
          {CHAT_HEADING_SCALES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => updateAppearance({ headingScale: option.id })}
              className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                appearance.headingScale === option.id
                  ? 'border-primary-500/40 bg-primary-500/10 text-primary-200'
                  : 'border-surface-700 bg-surface-800 text-surface-400 hover:text-surface-200'
              }`}
            >
              <div className="text-[12px] font-medium">{option.label}</div>
              <div className="text-[10px] text-surface-500">{option.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="mb-2 block text-xs text-surface-400">Spacing</label>
        <div className="grid grid-cols-3 gap-2">
          {CHAT_LINE_SPACINGS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => updateAppearance({ lineSpacing: option.id })}
              className={`rounded-lg border px-2 py-2 text-left transition-colors ${
                appearance.lineSpacing === option.id
                  ? 'border-primary-500/40 bg-primary-500/10 text-primary-200'
                  : 'border-surface-700 bg-surface-800 text-surface-400 hover:text-surface-200'
              }`}
            >
              <div className="text-[12px] font-medium">{option.label}</div>
              <div className="text-[10px] text-surface-500">{option.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div
        role="button"
        tabIndex={0}
        onClick={() => updateAppearance({ emphasizeHeadings: !appearance.emphasizeHeadings })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            updateAppearance({ emphasizeHeadings: !appearance.emphasizeHeadings });
          }
        }}
        className="flex cursor-pointer items-center justify-between rounded-lg border border-surface-700 bg-surface-800 p-3 hover:border-surface-600"
      >
        <div>
          <span className="text-sm text-surface-300">Emphasize headings</span>
          <p className="text-xs text-surface-500">
            Brighter titles with a left accent so sections scan more easily
          </p>
        </div>
        <span
          className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
            appearance.emphasizeHeadings ? 'bg-primary-500' : 'bg-surface-600'
          }`}
        >
          <span
            className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              appearance.emphasizeHeadings ? 'translate-x-5' : ''
            }`}
          />
        </span>
      </div>

      <div
        className="chat-md rounded-lg border border-surface-700 bg-surface-800 p-3"
        style={cssVars}
        data-emphasize-headings={appearance.emphasizeHeadings ? 'true' : 'false'}
      >
        <div className="mb-2 text-[10px] uppercase tracking-wide text-surface-500">Preview</div>
        <h2 className="chat-md-h2 mt-0 mb-2">Link performance</h2>
        <p className="text-surface-200">
          The report can use existing Resend click events. Enabling tracking later cannot retrofit already delivered emails.
        </p>
        <div className="chat-md-list-row mt-2 flex items-start gap-1.5">
          <span className="mt-0.5 flex-shrink-0 text-primary-400">•</span>
          <span className="text-surface-200">Need from you: confirm whether links group by destination URL or by button placement. Recommended default is destination URL.</span>
        </div>
      </div>
    </div>
  );
}
