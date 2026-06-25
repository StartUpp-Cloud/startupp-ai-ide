# Lean-up + Semantic Codebase Index — Design

**Date:** 2026-06-25
**Status:** Approved for planning
**Author:** brainstormed with Claude

## Goal

Keep the StartUpp AI IDE lean, fast, and low on memory while removing UI noise, and
add a Cursor-style semantic codebase index that surfaces **relevant file pointers**
(not raw text) to the AI layer.

This work has two parts:

- **Part A** — five focused UX/behavior cleanups.
- **Part B** — a local semantic codebase index.

Non-goals: no new heavy dependencies, no always-on file watchers, no raw-file-text
injection into context windows.

---

## Part A — UX cleanups

### A1. Auto-scroll only on real responses

**Problem:** `ChatPanel.jsx` auto-scrolls on *any* message-count change — including
transient `metadata.transient` / `role:'progress'` status messages and during
streaming. This yanks the user to the bottom while they are trying to read or hunt
for info during a working session.

**Design:**
- Suppress auto-scroll for transient / `role:'progress'` updates entirely.
- Auto-scroll only on: (a) initial session load, (b) a real `user` / `agent` / `error`
  message being appended, and (c) stream-complete of a real response.
- Track whether the user is near the bottom of the scroll container. If the user has
  scrolled up (not near bottom), **never** force-scroll on new content. Instead show a
  small "↓ new response" pill that scrolls to bottom on click.
- The pill appears only when a real (non-transient) message arrives while scrolled up.

**Touch points:** `src/client/src/components/ChatPanel.jsx` — the scroll effects around
lines 1630–1671 (`scrollToBottom`, `scheduleScrollToBottom`) and 2162–2194 (auto-scroll
triggers). Add an `isNearBottom` ref/state and a "new response" pill component.

**Success:** While a job is running and emitting progress, the view does not move. When
the final response lands and the user is at the bottom, it scrolls; if the user scrolled
up, it stays put and shows the pill.

### A2. Fewer status messages — checklist is the only progress UI

**Problem:** Chatty transient `chat-progress` messages ("Asking Claude…",
"delegating…") add noise. The user wants only the checklist while work happens.

**Design:**
- Stop emitting transient `chat-progress` chat messages from
  `agentGateway._addProgressMessage()` and the orchestrator run events.
- Keep: the `agent-status` busy indicator (spinner) and **real errors/warnings**
  (those remain as actual persisted messages).
- "What's being done" is conveyed solely by the `LiveAnalysisPanel` checklist
  (terminal-output analysis), which is unchanged.
- The **final result message** renders exactly as today (no change to result rendering
  or persistence).

**Touch points:**
- `src/server/agentGateway.js` — `_addProgressMessage()` and its call sites; gate/remove
  transient progress emissions while preserving error/warning paths and `agent-status`.
- `src/server/agentOrchestrator.js` — orchestrator run-event progress emissions
  (~lines 1529–1544).
- Frontend: with no transient progress messages arriving, the transient-message render
  path in `ChatPanel.jsx` simply goes quiet; verify no empty-state regressions.

**Success:** During a run the chat shows only the busy indicator + the checklist;
errors still surface; the completed result message appears as before.

### A3. Right panel fully collapsible

**Problem:** `RightPanel` (Scheduler + Container files) is resizable but cannot be
collapsed, costing horizontal space.

**Design:**
- Add a collapse/expand toggle for the right panel; persist collapsed state in
  `localStorage` (alongside the existing `rightPanelWidth`).
- Collapsed = panel content hidden and its grid column removed (width 0), leaving a thin
  rail with an expand control (and/or a TopBar button) to reopen.
- Reuse the existing grid-column width mechanism in `IDE.jsx` (the left panel already
  has collapse logic to mirror).

**Touch points:** `src/client/src/pages/IDE.jsx` (grid template around line 641, right
panel render ~755–762, resizer ~749–752) and
`src/client/src/components/RightPanel.jsx`.

**Success:** A toggle hides/shows the right panel; state survives reload; the chat area
expands to fill the reclaimed space.

### A4. Thinner chat — compact icon session strip

**Problem:** `SessionBubbleDock` shows full session names, consuming width.

**Design:**
- Convert the dock to a compact strip of **small icons** — one per session (letter
  glyph or agent/tool icon), with the full session name shown on hover via tooltip.
- The active session is visually highlighted; click switches sessions as today.
- Icons-only (no inline truncated label) to maximize space reclaimed.

**Touch points:** `src/client/src/components/ChatPanel.jsx` — `SessionBubbleDock`
(~lines 388–565) and its render site (~3823).

**Success:** The session dock is a thin icon strip; hovering reveals names; switching
still works; the chat content area is wider.

### A5. Remove the "Session Files" sidebar panel

**Problem:** The left-sidebar "Session Files" section is redundant and stays empty —
changed files already render inline in each chat response.

**Design:**
- Remove the "Session Files" section markup at `IDE.jsx:576–594`.
- Remove the now-dead `selectedSessionFiles` state and any wiring that exists solely to
  feed that panel.
- **Keep** the inline per-response changed-files list (`ChatMessage.jsx`) — it is the
  feature the user relies on.
- **Keep** `sessionHistory.js` scrollback persistence — it is a separate, working
  feature, out of scope here.
- Verify the `session-file-changes` WebSocket events still feed the inline per-message
  file lists after removing the panel consumer.

**Touch points:** `src/client/src/pages/IDE.jsx` (panel + state),
`src/client/src/components/ChatPanel.jsx` (drop the `selectedSessionFiles` plumbing if
it terminates only at that panel).

**Success:** The empty "Session Files" panel is gone; inline changed-files in responses
are unaffected.

---

## Part B — Semantic codebase index

### B0. Principle

Provide the AI layer with a **ranked list of relevant file pointers** for a query —
`{ filePath, lineRange, summary, score }` — **never raw file text**. The CLI agents
already have full filesystem access inside their container and can fetch/read what they
need; the LLM-layer features likewise read via existing APIs. This avoids context-window
bloat and keeps the footprint tiny.

### B1. Storage

- New SQLite table `code_chunks` in the existing `node:sqlite` DB (`/data/app.sqlite`):
  `(id, projectId, filePath, startLine, endLine, summary, embedding BLOB,
  embedModel TEXT, contentHash TEXT, indexedAt INTEGER)`.
- Embedding stored as a `BLOB` (Float32 array). No vector extension; cosine similarity
  computed in JS.
- A small per-project index meta record: `(projectId, embedModel, fileCount,
  chunkCount, lastIndexedAt, status)`.
- Footprint: ~768 floats × 4 bytes ≈ 3 KB/chunk; a few thousand chunks ≈ a few MB.
  Cosine over a few thousand vectors is sub-100ms — acceptable without an ANN library.

### B2. Embeddings provider

- Add `generateEmbedding(text)` (and a batched `generateEmbeddings(texts)`) to
  `src/server/llmProvider.js`.
- Routing: use the **active provider if embedding-capable** (Ollama via `/api/embed`,
  OpenAI via `/v1/embeddings`); otherwise **fall back to local Ollama
  `nomic-embed-text`**. DeepSeek/GitHub/OpenCode have no embeddings → fallback applies.
- Add an `embeddings` sub-config per provider (model name, endpoint reuse) to
  `DEFAULT_LLM_SETTINGS`. API keys reuse the existing encrypted-field mechanism.
- Record the `embedModel` used on each chunk. If the configured embed model changes,
  the index is considered stale and is rebuilt (mixing models in one similarity space is
  invalid).

### B3. Indexing pipeline

- **Enumerate** files with `git ls-files` run in the container via
  `containerManager.execInContainerAsync()` — gitignore-aware, skips `node_modules`/`.git`
  for free. Skip binary and oversized files (size threshold + simple binary sniff).
- **Read** file contents through `containerManager` (per-file `cat`, or batched
  `docker cp … | tar` for large repos — chosen at implementation time based on file
  count).
- **Chunk** by line-windows (e.g. ~60-line windows with small overlap). `summary` is a
  cheap derived descriptor (e.g. leading symbol/heading or first non-blank line); no LLM
  call required for summaries in v1.
- **Embed** each chunk; upsert into `code_chunks` keyed by `(projectId, filePath,
  startLine)` with `contentHash`.
- **Triggers:**
  - *On-open if stale:* when a project is opened and its index is missing or stale
    (model changed, or never built), kick off a build in the background.
  - *Incremental:* on file-change events from the existing file-change tracker
    (`agentGateway` `fileTracker` / `session-file-changes`), re-embed only changed files
    (compare `contentHash`/mtime); delete chunks for removed files.
  - *Manual:* a **Reindex** action forces a full rebuild.
- No always-on filesystem watcher (rejected for footprint reasons).

### B4. Retrieval

- `retrieveRelevant(projectId, query, k = 8)`:
  embed the query → cosine against the project's stored vectors → return the top-k as
  `{ filePath, lineRange, summary, score }`, de-duplicated/merged per file.
- Returns **pointers only**. No file text is read or returned by retrieval.

### B5. Injection

- **CLI agents:** in `agentGateway` context assembly (`_buildToolCommand` /
  `_buildFirstMessagePreamble`), prepend a short block:
  *"Relevant files (semantic index) — read these as needed: …"* followed by the pointer
  list. Bounded to k entries; pointers only.
- **LLM-layer features:** include the same pointer list in the context for planning,
  prompt optimization, and branch review (via `projectContextService` /
  `llmProvider.buildFullSystemPrompt`). Those features read file contents through the
  existing `context.js` / file APIs if they need them.
- Injection is additive and bounded — it does not replace existing static context.

### B6. UI

- Minimal index status in `RightPanel`: indexed file/chunk count, last-indexed time,
  status (idle / indexing / stale), and a **Reindex** button.
- New route(s) under `src/server/routes/` for index status + manual reindex.

### B7. Footprint guardrails (lean)

- Cap indexed file count and per-file size; log (don't silently drop) when caps truncate
  coverage.
- Background indexing runs at low concurrency; incremental updates touch only changed
  files.
- Vectors are the only added at-rest data; a few MB per project.

---

## Documentation fix

`CLAUDE.md` currently states LowDB is the primary database; the actual primary store is
SQLite via `node:sqlite` (`/data/app.sqlite`), with LowDB retained only for legacy
compatibility. Update `CLAUDE.md` to reflect this while we are in here.

---

## Out of scope

- Reworking `sessionHistory.js` scrollback (works; unrelated to the removed UI panel).
- ANN/vector libraries (sqlite-vec, hnswlib, faiss) — brute-force cosine is sufficient
  at this scale.
- LLM-generated chunk summaries (v1 uses cheap derived summaries).
- The planned chat-agent restructure (separate effort).
