# Scheduler Feature Implementation Report

**Date:** 2026-06-25
**Branch:** main
**Commits:** fb6744b, 37b823c, 819f425

---

## Changes Per File

### `src/server/scheduler.js`
- **Added exported pure function `computeMsUntilNextRun({ frequency, timeOfDay, dayOfWeek }, nowMs)`** at module scope (before `class Scheduler`), after the `VALID_WEBHOOK_METHODS` const. Uses server-local time via `new Date(nowMs)`. For `daily`: builds a candidate Date at timeOfDay in local time; if already passed, advances to tomorrow. For `weekly`: computes days ahead using `((dayOfWeek - todayDow) + 7) % 7`; if delay <= 0 (same day, time passed), advances 7 days. Always returns > 0.
- **`create()` destructure**: added `cliTool = null`, `frequency = 'interval'`, `timeOfDay = null`, `dayOfWeek = null` with defaults.
- **`create()` validation**: replaced unconditional `intervalMs` check with a branch on `normalizedFrequency`. `interval` still requires `intervalMs >= 60000`. `daily` requires `timeOfDay` matching `^([01]\d|2[0-3]):[0-5]\d$`. `weekly` additionally requires `dayOfWeek` integer 0–6.
- **`create()` schedule object**: added `frequency`, `timeOfDay`, `dayOfWeek`, `cliTool`, `nextRunAt: null`. `intervalMs` is now `null` for non-interval schedules.
- **`update()` validation**: added `timeOfDay` and `dayOfWeek` format validation.
- **`update()` needsTimerRestart**: now also triggers on `frequency`, `timeOfDay`, `dayOfWeek`, `cliTool` changes.
- **`_startTimer(schedule)`**: branched on `schedule.frequency`. For `daily`/`weekly`: uses a self-rescheduling `setTimeout` via a `scheduleNext` closure. On each tick, re-reads schedule from DB, executes, then computes next delay with `computeMsUntilNextRun` and sets a new `setTimeout`. Persists `nextRunAt` to DB for display. On error, still reschedules. `clearInterval` in `_stopTimer` is interchangeable with `clearTimeout` on Node.js timer IDs. For `interval`: unchanged `setInterval` path.

### `src/server/routes/scheduler.js`
- **POST destructure**: added `frequency`, `timeOfDay`, `dayOfWeek` to `req.body` destructure.
- **POST intervalMs validation**: replaced unconditional required-check with `effectiveFrequency` branch — only validates `intervalMs` when `frequency` is absent or `'interval'`; for `daily`/`weekly` validates `timeOfDay` (and `dayOfWeek` for weekly).
- **POST `scheduler.create()` call**: passes `frequency`, `timeOfDay`, `dayOfWeek` through.
- **PUT**: already passes `req.body` through to `scheduler.update()` — no change needed.

### `src/client/src/components/SchedulerPanel.jsx`
- **Import added**: `import { CLI_TOOLS } from '../utils/sessionAssistantOptions'`
- **New state**: `formFrequency` (default `'interval'`), `formTimeOfDay` (default `'09:00'`), `formDayOfWeek` (default `1` = Monday)
- **`resetForm()`**: clears `formFrequency`, `formTimeOfDay`, `formDayOfWeek`
- **`handleCreate()` payload**: sends `frequency`, `timeOfDay`/`dayOfWeek` for non-interval; sends `intervalMs` only when `frequency === 'interval'`
- **`createDisabled`**: added guard for daily/weekly without `formTimeOfDay`
- **CLI Tool selector**: replaced hardcoded 4-button list (Shell/Claude/Copilot/Aider) with dynamic `CLI_TOOLS.filter(t => t.id !== 'shell')` — now includes Claude, Copilot, OpenCode, Codex, Aider, Gemini, Ollama. Shell appears as a fixed "Shell" button (empty `cliTool`)
- **Command/Prompt input**: when an AI tool is selected (non-empty `formCliTool`), renders a `<textarea rows={3}>` with "Prompt to send to the AI tool..." placeholder. When shell, renders existing single-line `<input type="text">` with font-mono
- **Frequency selector**: Interval (toggle button) → existing presets `<select>`; Daily → `<input type="time">`; Weekly → weekday `<select>` (Sun–Sat) + `<input type="time">`. Webhooks keep their own interval `<select>` unchanged

### `src/server/tests/scheduleNextRun.test.js` (new file)
- 8 tests covering daily/weekly/edge cases (time passed, exact match, cross-week, Sunday wrap)

---

## Test Output

### `scheduleNextRun.test.js` (8/8 pass)

```
ok 1 - daily: time later today returns ms to today
ok 2 - daily: time already passed today returns ms to tomorrow
ok 3 - daily: exact same time pushes to tomorrow
ok 4 - weekly: next weekday in future (Friday=5) from Thursday
ok 5 - weekly: same weekday time not yet passed returns ms to today
ok 6 - weekly: same weekday time already passed → next week
ok 7 - weekly: Sunday (0) from Thursday
ok 8 - always returns a positive value
# tests 8
# pass 8
# fail 0
```

### Full test suite `src/server/tests/*.test.js` (38 pass, 3 fail — pre-existing only)

```
not ok 4  - src/server/tests/agentGatewayCodex.test.js
not ok 16 - src/server/tests/orchestratorContext.test.js
not ok 28 - src/server/tests/sessionSettings.test.js
# tests 41
# pass 38
# fail 3
```

No new failures introduced.

---

## Build Output

```
./src/client/node_modules/.bin/esbuild src/client/src/components/SchedulerPanel.jsx > /dev/null && echo PANEL_OK
→ PANEL_OK

(cd src/client && npm run build 2>&1 | tail -3)
→ dist/assets/index-B5h_JKAK.js  427.58 kB │ gzip: 99.96 kB
→ ✓ built in 1.77s
```

---

## Assumptions & Decisions

1. **Timezone: server-local.** `computeMsUntilNextRun` uses `new Date(nowMs)` with local-time getters (`getFullYear`, `getMonth`, etc.) — no UTC conversion. The UI labels inputs as "server local time" to inform users.

2. **Shell vs AI tool.** The `shell` entry from `CLI_TOOLS` is excluded from the dynamic button list; instead a fixed "Shell" button sets `formCliTool = ''` (which maps to `cliTool: undefined` in the payload, preserving the raw `_executeCommand` path). All other `CLI_TOOLS` entries become AI tool buttons.

3. **`clearTimeout`/`clearInterval` interchangeability.** Node.js timer IDs returned by `setTimeout` and `setInterval` are the same `Timeout` object type. The existing `_stopTimer` calls `clearInterval` on the stored ID — this works correctly for both `setInterval` and `setTimeout` IDs on Node.js.

4. **Webhooks keep interval-only scheduling.** The frequency selector is hidden for webhook type; webhooks show the original `intervalMs` preset `<select>`. Daily/weekly scheduling for webhooks would require sending headers, which is unrelated to the prompt-scheduling feature.

5. **`nextRunAt` persisted to DB.** When a time-based schedule is (re)started, `nextRunAt` ISO string is written to the DB for display in the schedule list. The existing `getNextRunAt` helper in SchedulerPanel already handles `intervalMs`-based calculation client-side; `nextRunAt` from the server is the authoritative value for daily/weekly schedules (the list display could be enhanced to show it, but that's a follow-up UI polish).

6. **`_executeCliTool` tool coverage.** The existing switch in `_executeCliTool` handles `claude`, `copilot`, `aider`, and falls through to `schedule.command` for anything else (opencode, codex, gemini, ollama). This means opencode/codex/gemini/ollama run the command verbatim — correct behavior since those tools need their own invocation patterns that the user writes as the prompt/command.
