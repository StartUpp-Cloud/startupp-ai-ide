# Troubleshooting

## Terminal Prompts Ignore Single-Key Answers

### Symptom

Interactive CLIs can appear stuck on prompts that expect a single keypress, for example:

```text
? Authenticate Git with your GitHub credentials? (Y/n)
```

The terminal may still accept other input, but pressing `y`, `n`, or clicking a Yes/No helper does not advance the prompt.

### Root Cause

Browser terminals are not plain text boxes. `xterm.js` emits both user keystrokes and terminal control/query responses through `onData()`. Interactive programs such as GitHub CLI, shell prompts, full-screen TUIs, and prompt libraries may depend on the exact byte stream that a real terminal sends.

The IDE previously buffered input for a few milliseconds and removed terminal query responses before forwarding input to the server. That made the terminal less faithful than a real PTY and could break cbreak/raw-mode prompts. In practice, this caused `gh auth login` to remain stuck at the `Y/n` authentication prompt.

### Current Behavior

Terminal input is forwarded unchanged:

```text
xterm.js onData() -> WebSocket input message -> terminalServer.handleInput() -> ptyManager.write() -> node-pty/docker exec
```

Do not filter, debounce, coalesce, normalize, or rewrite interactive terminal input on the client. The PTY is the correct place for terminal semantics, and application prompts should receive the exact bytes emitted by `xterm.js`.

### Affected Code Paths

- `src/client/src/components/InternalConsole.jsx` forwards embedded Shell input directly.
- `src/client/src/components/Terminal.jsx` forwards the main terminal input directly.
- `src/server/terminalServer.js` writes incoming `input` payloads directly to `ptyManager.write()`.
- `src/server/ptyManager.js` writes directly to the node-pty process.

### Regression Test

Run this inside the IDE Shell:

```bash
bash -lc 'read -rsn1 -p "key? " k; printf "\n[%q]\n" "$k"'
```

Press `y`. Expected output:

```text
[y]
```

Then verify GitHub CLI login can pass the single-key prompt:

```bash
gh auth login --hostname github.com --git-protocol https --web
```

When asked `? Authenticate Git with your GitHub credentials? (Y/n)`, pressing `y` should advance to the next step.

### Implementation Rule

If terminal control sequences create visible noise, fix display handling or terminal initialization separately. Do not strip anything from `xterm.onData()` before it reaches the PTY, because that changes the behavior of interactive programs.
