# IDE UX Cleanups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the IDE leaner and quieter — stop auto-scroll yanking during work, replace status chatter with the checklist only, make the right panel collapsible, shrink the session navigation to icons, and remove the dead "Session Files" panel.

**Architecture:** All changes are surgical edits to existing React components (`ChatPanel.jsx`, `IDE.jsx`, `RightPanel.jsx`) plus one backend guard in `agentGateway.js`. No new files except one backend test. State persistence reuses the existing `localStorage`/`STORAGE_KEYS` pattern.

**Tech Stack:** React 18, Tailwind, Lucide icons (frontend); Express ESM + `node --test` (backend).

## Global Constraints

- Node `>=22.5.0`; ESM only (`import`/`export`, no `require`).
- Frontend has **no test harness** — verify UI tasks by running `npm run dev` and observing; do not add a frontend test framework.
- Backend tests are plain `node --test` files in `src/server/tests/` using `node:assert/strict`, testing pure logic (no live DB).
- Follow existing Tailwind class conventions (`surface-*`, `primary-*` palette) and Lucide icon usage already imported in each file.
- Lint must pass: `cd src/client && npm run lint` (max-warnings 0) for any client file touched.

---

### Task 1: Auto-scroll only on real responses / respect manual scroll-up

**Files:**
- Modify: `src/client/src/components/ChatPanel.jsx` (scroll handler ~1618-1626; busy/stream scroll effect ~2181-2194; message-count effect ~2163-2179)

**Interfaces:**
- Consumes: existing `scrollContainerRef`, `handleScroll`, `scheduleScrollToBottom`, `showJumpBottom`/`setShowJumpBottom`, `agentBusy`, `streamingMessage`.
- Produces: `isNearBottomRef` (a `useRef(true)`) — a ref other scroll effects read to decide whether to auto-scroll.

**Behavior target:** While the agent is working (busy / streaming / progress), the view must NOT move if the user has scrolled up. It only auto-scrolls when the user is already near the bottom. The existing "jump to bottom" pill (`showJumpBottom`) is the escape hatch back.

- [ ] **Step 1: Add the `isNearBottomRef` and update it in `handleScroll`**

Find `handleScroll` (~line 1618) and add the ref just above it, then set it inside:

```jsx
  const isNearBottomRef = useRef(true);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const distFromTop = el.scrollTop;
    isNearBottomRef.current = distFromBottom <= 300;
    setShowJumpBottom(distFromBottom > 300);
    setShowJumpTop(distFromTop > 300);
    if (distFromTop < 120) loadOlderMessages();
  }, [loadOlderMessages]);
```

- [ ] **Step 2: Gate the busy/streaming auto-scroll effect on near-bottom**

Replace the effect at ~2181-2194 with a version that bails when the user scrolled up:

```jsx
  useEffect(() => {
    if (!isVisible) return;
    if (!streamingMessage && !agentBusy && !recoveryStatus.active) return;
    if (!isNearBottomRef.current) return; // user scrolled up to read — don't yank them down

    return scheduleScrollToBottom();
  }, [
    isVisible,
    streamingMessage?.id,
    streamingMessage?.content,
    agentBusy,
    recoveryStatus.active,
    recoveryStatus.message,
    scheduleScrollToBottom,
  ]);
```

- [ ] **Step 3: Gate the message-count auto-scroll for non-initial appends on near-bottom**

Replace the effect at ~2163-2179. Keep initial-load scroll unconditional; only auto-scroll on later appends if near bottom:

```jsx
  // Scroll handling - only when visible and new messages arrive
  useEffect(() => {
    if (!isVisible) return;

    const currentCount = messages.length;
    const prevCount = prevMessageCountRef.current;

    if (suppressNextAutoScrollRef.current) {
      suppressNextAutoScrollRef.current = false;
    } else if (isInitialLoadRef.current && currentCount > 0) {
      scheduleScrollToBottom();
      isInitialLoadRef.current = false;
    } else if (currentCount > prevCount && prevCount > 0 && isNearBottomRef.current) {
      scheduleScrollToBottom();
    }

    prevMessageCountRef.current = currentCount;
  }, [messages, isVisible, scheduleScrollToBottom]);
```

- [ ] **Step 4: Reset `isNearBottomRef` to true on session/project switch**

In the session-reset effect (~1673, the one that sets `messagesLoadedRef.current = false` etc.), add a line so a freshly opened session starts anchored to the bottom:

```jsx
    suppressNextAutoScrollRef.current = false;
    isNearBottomRef.current = true;
```

(Add the `isNearBottomRef.current = true;` line right after the existing `suppressNextAutoScrollRef.current = false;` line.)

- [ ] **Step 5: Verify by running the app**

Run: `npm run dev`
Then in the browser:
1. Open a project chat and send a prompt that triggers a long agent run.
2. While it works and emits progress, scroll UP in the chat.
Expected: the view STAYS where you scrolled; a "jump to bottom" chevron pill appears. When you click the pill it returns to the bottom. When you are already at the bottom, new content auto-scrolls as before.

- [ ] **Step 6: Lint and commit**

```bash
cd src/client && npm run lint && cd ../..
git add src/client/src/components/ChatPanel.jsx
git commit -m "fix(chat): only auto-scroll when near bottom, never yank during work"
```

---

### Task 2: Suppress transient status chatter — checklist is the only progress UI

**Files:**
- Create: `src/server/tests/agentProgressSuppression.test.js`
- Modify: `src/server/agentGateway.js` (`_addProgressMessage` ~3702-3736)

**Interfaces:**
- Consumes: existing `_addProgressMessage(projectId, sessionId, content, broadcastFn, tasks, { transient })`.
- Produces: a module-level pure helper `shouldEmitProgress({ transient })` exported for test, returning `false` for transient messages.

**Behavior target:** During work, no chatty "Sending to X…/delegating…" lines. Only the live checklist (`chat-checks` → `liveChecks`) and the busy spinner (`agent-status`) show progress. Persisted (non-transient) progress and errors are unaffected. The final result message is unchanged.

- [ ] **Step 1: Write the failing test**

Create `src/server/tests/agentProgressSuppression.test.js`:

```js
/**
 * Verifies transient progress messages are suppressed (checklist-only UX),
 * while persisted progress and errors still flow.
 */
import assert from 'node:assert/strict';
import { shouldEmitProgress } from '../agentGateway.js';

assert.equal(shouldEmitProgress({ transient: true }), false, 'transient chatter is suppressed');
assert.equal(shouldEmitProgress({ transient: false }), true, 'persisted progress still emits');
assert.equal(shouldEmitProgress({}), true, 'defaults to emitting (non-transient)');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/server/tests/agentProgressSuppression.test.js`
Expected: FAIL — `shouldEmitProgress` is not exported / not a function.

- [ ] **Step 3: Add the pure helper and export it**

At the top level of `src/server/agentGateway.js` (near the other module-level helpers like `shouldSuppressAgentProgress`), add and export:

```js
export function shouldEmitProgress({ transient = false } = {}) {
  // Transient progress is chatter ("Sending to X…", "delegating…"). The live
  // checklist + busy spinner convey work-in-progress, so we drop transient lines.
  return transient !== true;
}
```

- [ ] **Step 4: Use the helper to short-circuit transient emission**

In `_addProgressMessage`, replace the transient branch (the `if (transient) { ... broadcastFn(...) ; return; }` block at ~3720-3733) with an early return that emits nothing:

```js
    if (transient) {
      // Suppressed: the live checklist (chat-checks) + busy spinner are the only
      // work-in-progress UI. We no longer broadcast transient status chatter.
      if (!shouldEmitProgress({ transient })) return;
    }
    const msg = chatStore.addMessage({ projectId, sessionId, role: 'progress', content, metadata: { tasks, live: true, transient: false } });
    broadcastFn({ type: 'chat-progress', projectId, message: msg });
```

(The `shouldEmitProgress` guard always returns for transient, so transient messages produce no broadcast and are never persisted. Non-transient messages persist + broadcast exactly as before.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test src/server/tests/agentProgressSuppression.test.js`
Expected: PASS (3 assertions).

- [ ] **Step 6: Verify the full suite still passes**

Run: `node --test src/server/tests/`
Expected: all existing tests still pass (no regressions).

- [ ] **Step 7: Verify in the app that the checklist still appears**

Run: `npm run dev`. Trigger an agent run.
Expected: no "Sending to claude…/delegating…" status bubbles appear during work; the live checklist still updates; errors still appear; the final response renders normally.

- [ ] **Step 8: Commit**

```bash
git add src/server/agentGateway.js src/server/tests/agentProgressSuppression.test.js
git commit -m "feat(chat): suppress transient status chatter, checklist-only progress"
```

---

### Task 3: Make the right panel fully collapsible

**Files:**
- Modify: `src/client/src/pages/IDE.jsx` (`STORAGE_KEYS` ~26-32; state ~161-167; persistence effect ~259-264; grid template ~639-641; right panel render ~748-762)

**Interfaces:**
- Consumes: existing `rightPanelWidth`, the grid `gridTemplateColumns`, `PanelRightOpen`/`PanelRightClose` (already imported, used in mobile drawer).
- Produces: `rightPanelCollapsed` state + `STORAGE_KEYS.RIGHT_PANEL_COLLAPSED` persisted flag.

- [ ] **Step 1: Add the storage key**

In `STORAGE_KEYS` (~line 26):

```jsx
const STORAGE_KEYS = {
  SELECTED_PROJECT: 'ide-selected-project',
  LEFT_PANEL_WIDTH: 'ide-left-panel-width',
  RIGHT_PANEL_WIDTH: 'ide-right-panel-width',
  LEFT_PANEL_COLLAPSED: 'ide-left-collapsed',
  RIGHT_PANEL_COLLAPSED: 'ide-right-collapsed',
  FORCE_MOBILE_LAYOUT: 'ide-force-mobile-layout',
};
```

- [ ] **Step 2: Add the collapsed state (mirror `leftPanelCollapsed`)**

After the `leftPanelCollapsed` state declaration (~line 165-167):

```jsx
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL_COLLAPSED) === 'true';
  });
```

- [ ] **Step 3: Persist it (mirror the left-collapsed effect)**

After the `LEFT_PANEL_COLLAPSED` persistence effect (~263-264):

```jsx
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.RIGHT_PANEL_COLLAPSED, rightPanelCollapsed.toString());
  }, [rightPanelCollapsed]);
```

- [ ] **Step 4: Update the grid template to drop the right column when collapsed**

Replace the `gridTemplateColumns` expression (~639-641) with one whose right segment becomes `auto` (thin rail) when collapsed:

```jsx
          gridTemplateColumns: isMobileLayout
            ? '1fr'
            : `${leftPanelCollapsed ? 'auto' : `${leftPanelWidth}px 4px`} 1fr ${rightPanelCollapsed ? 'auto' : `4px ${rightPanelWidth}px`}`,
```

- [ ] **Step 5: Hide the resizer + render a collapsed rail with an expand button**

Replace the right resizer + right panel block (~748-762) with:

```jsx
        {/* Right resizer (hidden when collapsed) */}
        {!isMobileLayout && !rightPanelCollapsed && <div
          className="bg-surface-700 hover:bg-primary-500 cursor-col-resize transition-colors"
          onMouseDown={() => setIsResizing('right')}
        />}

        {/* ── Right Panel ── */}
        {!isMobileLayout && (rightPanelCollapsed ? (
          <div className="flex flex-col items-center py-2 px-1 bg-surface-850 border-l border-surface-700">
            <button
              onClick={() => setRightPanelCollapsed(false)}
              className="p-1.5 hover:bg-surface-700 rounded text-surface-400 hover:text-surface-200"
              title="Show tools panel"
            >
              <PanelRightOpen className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="relative overflow-hidden">
            <button
              onClick={() => setRightPanelCollapsed(true)}
              className="absolute right-1 top-1 z-10 p-1 rounded text-surface-500 hover:bg-surface-700 hover:text-surface-200"
              title="Collapse tools panel"
            >
              <PanelRightClose className="w-3.5 h-3.5" />
            </button>
            <RightPanel
              projectId={selectedProjectId}
              projectPath={selectedProject?.folderPath}
              selectedTool={selectedTool}
              containerName={selectedProject?.containerName}
            />
          </div>
        ))}
```

- [ ] **Step 6: Verify in the app**

Run: `npm run dev`. Click the collapse (`PanelRightClose`) button on the right panel.
Expected: the panel collapses to a thin rail with an expand button; the chat area widens to fill the space; reloading the page preserves the collapsed state.

- [ ] **Step 7: Lint and commit**

```bash
cd src/client && npm run lint && cd ../..
git add src/client/src/pages/IDE.jsx
git commit -m "feat(ide): make right tools panel collapsible with persisted state"
```

---

### Task 4: Compact icon-only session navigation

**Files:**
- Modify: `src/client/src/components/ChatPanel.jsx` (`SessionBubble` component ~240-386)

**Interfaces:**
- Consumes: existing `SessionBubble` props (`session`, `active`, `onOpen`, `onCollapse`, `onDelete`, `collapsed`, etc.) and Lucide icons already imported (`MessageCircle`, `Pin`, `X`).
- Produces: a new `iconOnly` boolean prop on `SessionBubble`; when true it renders a single small icon button with the session name as a `title` tooltip. `MainThreadSessionBubbles` passes `iconOnly` and lays the bubbles out in a horizontal wrap row.

**Behavior target:** Session navigation near the composer shows small icons (one per session) instead of full-name cards. Hover reveals the full name; click switches; active session highlighted; unread shows a dot.

- [ ] **Step 1: Add an `iconOnly` early-return render to `SessionBubble`**

In `SessionBubble({ ... })`, add `iconOnly = false` to the destructured props, and immediately after computing `name`/`status` (after line ~261, before the existing `return`) insert:

```jsx
  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={() => { if (!editing) onOpen?.(session); }}
        title={name}
        className={`relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors ${
          active
            ? 'border-primary-500/45 bg-primary-500/15 text-primary-200'
            : session?.pinned
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'
            : 'border-surface-700/55 bg-surface-850/75 text-surface-400 hover:border-surface-600 hover:bg-surface-800/80'
        }`}
      >
        {session?.pinned ? <Pin size={13} className="-rotate-45" /> : <MessageCircle size={14} />}
        {session?.hasUnread && !active && (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-primary-500 ring-2 ring-surface-900" />
        )}
        <span className={`absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${status.color} ${status.pulse ? 'animate-pulse' : ''}`} />
      </button>
    );
  }
```

- [ ] **Step 2: Pass `iconOnly` and a row layout from `MainThreadSessionBubbles`**

In `MainThreadSessionBubbles`, update `renderBubble` (~590-608) to pass `iconOnly`:

```jsx
  const renderBubble = (session) => (
    <SessionBubble
      key={session.id}
      session={session}
      active={session.id === activeSessionId}
      editing={editingSessionId === session.id}
      editingName={editingName}
      editInputRef={editInputRef}
      onEditingNameChange={onEditingNameChange}
      onFinishEditing={onFinishEditing}
      onCancelEditing={onCancelEditing}
      onOpen={onOpenSession}
      onCollapse={onCollapseSession}
      onTogglePin={onTogglePin}
      onStartEditing={onStartEditing}
      onDelete={onDeleteSession}
      compactPreview
      collapsed={collapsed}
      iconOnly
    />
  );
```

- [ ] **Step 3: Switch the bubble containers from `space-y-2` (stacked cards) to a wrapped icon row**

In `MainThreadSessionBubbles`'s `return` (~618-628), replace the two `space-y-2` wrappers with horizontal flex-wrap rows:

```jsx
      <div className="flex flex-wrap items-center gap-1.5">
        {normalSessions.map(renderBubble)}
        {pinnedSessions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-l border-surface-800/80 pl-1.5">
            {pinnedSessions.map(renderBubble)}
          </div>
        )}
      </div>
```

- [ ] **Step 4: Verify in the app**

Run: `npm run dev`. Open a main-thread chat with several sessions.
Expected: sessions render as a compact row of small icons; hovering shows the full name tooltip; the active one is highlighted; unread shows a dot; clicking an icon switches sessions. The chat content area is visibly wider/cleaner.

- [ ] **Step 5: Lint and commit**

```bash
cd src/client && npm run lint && cd ../..
git add src/client/src/components/ChatPanel.jsx
git commit -m "feat(chat): compact icon-only session navigation"
```

---

### Task 5: Remove the dead "Session Files" sidebar panel

**Files:**
- Modify: `src/client/src/pages/IDE.jsx` (panel markup ~576-594; `selectedSessionFiles` state ~214; `setSelectedSessionFiles` callback wiring ~730-732)
- Modify: `src/client/src/components/ChatPanel.jsx` (drop `onSelectedSessionFilesChange` prop only if it terminates solely at the removed panel)

**Interfaces:**
- Consumes: `selectedSessionFiles` state and the `onSelectedSessionFilesChange` callback passed to `ChatPanel`.
- Produces: nothing — this is a removal. The inline per-response changed-files list in `ChatMessage.jsx` is untouched.

- [ ] **Step 1: Delete the "Session Files" panel markup**

Remove the entire block at `IDE.jsx:576-594` (the `{/* Selected session changed files */}` `<div>` … through its closing `</div>`).

- [ ] **Step 2: Remove the now-unused state**

Delete the `selectedSessionFiles` state declaration (~line 214):

```jsx
  const [selectedSessionFiles, setSelectedSessionFiles] = useState([]);
```

- [ ] **Step 3: Remove the callback wiring on `<ChatPanel>`**

Delete the `onSelectedSessionFilesChange` prop passed to `ChatPanel` (~730-732):

```jsx
                    onSelectedSessionFilesChange={(sessionId, files) => {
                      if (projectId === selectedProjectId) setSelectedSessionFiles(sessionId ? (files || []) : []);
                    }}
```

- [ ] **Step 4: Check whether `ChatPanel` still needs the prop**

Run: `grep -n "onSelectedSessionFilesChange" src/client/src/components/ChatPanel.jsx`
- If the only references are receiving/calling the prop to push data outward (no other consumer), remove those references so no dead callback fires.
- If it is interwoven with other logic, leave the `ChatPanel` side alone — removing the IDE consumer is sufficient. Note which you did in the commit message.

- [ ] **Step 5: Verify the build has no unused-variable lint errors and the app runs**

Run: `cd src/client && npm run lint && cd ..` then `npm run dev`.
Expected: lint passes (no `selectedSessionFiles is defined but never used`); the left sidebar no longer shows the empty "Session Files" section; changed files still appear inline inside each agent response.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/pages/IDE.jsx src/client/src/components/ChatPanel.jsx
git commit -m "chore(ide): remove redundant empty Session Files sidebar panel"
```

---

### Task 6: Fix stale CLAUDE.md database note

**Files:**
- Modify: `CLAUDE.md` (Tech Stack + Architectural Decisions sections)

- [ ] **Step 1: Update the Tech Stack line**

In `CLAUDE.md`, change the backend storage description from LowDB-as-primary to SQLite-as-primary. Replace the `LowDB (flat-file JSON database)` reference in the **Backend** bullet with:

```markdown
- **Backend:** Express.js (ESM), SQLite (`node:sqlite`, primary store at `data/app.sqlite`; LowDB retained only for legacy compatibility), node-pty
```

- [ ] **Step 2: Update the Architectural Decisions bullet**

Replace the `**LowDB (flat JSON file)** as the database -- ...` bullet with:

```markdown
- **SQLite via Node's built-in `node:sqlite`** is the primary store (`data/app.sqlite`); no external DB service. A legacy LowDB JSON layer remains for backward compatibility only.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: correct CLAUDE.md — SQLite is the primary store, not LowDB"
```

---

## Self-Review

- **Spec coverage:** A1→Task 1, A2→Task 2, A3→Task 3, A4→Task 4, A5→Task 5, CLAUDE.md fix→Task 6. All Part A spec items covered.
- **Placeholders:** none — every code step shows concrete code; verification steps give exact commands and expected observations.
- **Type/name consistency:** `isNearBottomRef` (Task 1), `shouldEmitProgress` (Task 2), `rightPanelCollapsed`/`RIGHT_PANEL_COLLAPSED` (Task 3), `iconOnly` (Task 4), `selectedSessionFiles`/`onSelectedSessionFilesChange` (Task 5) used consistently within and across tasks.
- **Note:** Frontend verification is manual (run-the-app) by design — no client test harness exists; the one automated test (Task 2) covers the backend pure logic.
