# Coding assistant harness: StartUpp AI IDE and OpenClaw

This note records the useful lessons from comparing StartUpp AI IDE's coding
assistant harness with OpenClaw's current Gateway architecture. It is a product
roadmap, not a proposal to copy OpenClaw's personal-assistant channels or device
features into the IDE.

## What StartUpp already does well

- Coding-first isolation: projects run in Docker containers with persistent
  terminal and CLI-agent sessions.
- Durable execution: orchestrator runs, tasks, progress, retries, liveness,
  and restart recovery are persisted in SQLite.
- Coding workflow: plan review, worktrees, branch review, context compaction,
  skills, attachments, model/tool selection, and concise verification reports.
- User control: child sessions, steering, stop/resume flows, agent questions,
  and a read-only Ask mode are already present.
- Local-first operation: the app can use Claude, Codex, OpenCode, Aider, or
  Ollama inside the project environment instead of requiring a hosted control
  plane.

## What OpenClaw makes more explicit

OpenClaw's Gateway is a long-lived control plane shared by its UI, CLI, and
channels. Its clients use a typed WebSocket request/response/event protocol,
with a connect handshake, capability discovery, sequence/state metadata, and
an accepted-then-final lifecycle for agent runs. It also requires idempotency
keys for side-effecting methods and documents refresh behavior after event
sequence gaps. See the [Gateway architecture](https://docs.openclaw.ai/concepts/architecture)
and [Gateway runbook](https://docs.openclaw.ai/gateway).

Its capabilities model also separates three concerns that are currently more
closely coupled in this IDE:

1. Tools are typed actions exposed to the model.
2. Skills are instruction packs loaded according to precedence and allowlists.
3. Plugins package runtime code, tools, providers, channels, hooks, and skills.

That separation makes policy, discovery, and installation easier to reason
about. See the [capabilities overview](https://docs.openclaw.ai/tools) and
[skills documentation](https://docs.openclaw.ai/tools/skills).

OpenClaw's Control UI also has a useful observation pattern: a compact run
headline, expandable progress rail, and a read-only companion thread that can
answer questions about a running session without interrupting the main agent.
The [Control UI documentation](https://docs.openclaw.ai/web/control-ui) describes
this as bounded, ephemeral session observation rather than another durable chat
transcript.

Finally, OpenClaw treats operations and trust boundaries as product features:
health/readiness checks, doctor/audit commands, explicit sandbox and tool
policies, device pairing, and a clear warning that one gateway is a single
operator trust boundary. See its [security model](https://docs.openclaw.ai/gateway/security).

## Recommended implementation order

### P0 — make the existing harness protocol-grade

Add a small versioned WebSocket envelope shared by the terminal server and
client:

- `connect` / `hello` handshake with protocol version and server capabilities.
- Typed `request`, `response`, and `event` messages with request IDs.
- Monotonic event sequence and state version per project/session.
- `accepted` acknowledgement followed by a final run result.
- Client reconciliation after reconnect or a sequence gap.
- Idempotency keys for send, stop, approve, steer, and session mutations.

This is the highest-value gap because it improves reliability without changing
the coding model or adding another agent. It should be introduced behind an
internal protocol adapter so existing clients can migrate incrementally.

### P0 — make approvals and tool policy explicit

Represent each run's effective policy as data: allowed tools, filesystem scope,
network scope, container boundary, approval mode, and whether a command may be
auto-confirmed. Show the policy beside the composer and require a structured
approval event for escalations. Keep the default local workflow fast, but make
the dangerous boundary visible and auditable.

### P1 — add a bounded companion rail

Build on the existing child-session model with a read-only “Ask about this run”
rail. It should receive a bounded snapshot of the selected run, expose current
plan/check status, and never share the main agent's write tools. Keep it
ephemeral and clear it on reset, expiry, or restart. This gives developers
explanation and triage without interrupting a long coding task.

### P1 — ship an operator-grade health surface

Add a single diagnostics view/command for server health, container readiness,
agent availability, active runs, stale sessions, recent retries, and a redacted
export. Include an audit trail for approvals, tool calls, and run outcomes. The
existing liveness and recovery work provides the data sources; the missing piece
is a coherent operator surface.

### P2 — evolve skills into capability packages

Keep the current project skills, but define a manifest and lifecycle for skills
that need tools, configuration, or hooks. Add project/user precedence,
allowlisting, version pinning, and a review step before install. A marketplace
or remote channel should come after the local contract is stable.

### Defer unless the product direction changes

Messaging-channel fan-out, device nodes, voice, screen control, and public
remote gateway exposure are valuable for a personal assistant, but they do not
directly improve the core in-IDE coding loop. They also expand the security and
support surface substantially.

## Product principle

The best lesson is not “add more agent features.” It is to make a long-running
coding run feel dependable: one visible state machine, clear approvals, safe
reconnect, recoverable progress, and a small read-only surface for questions.
That preserves the IDE's coding focus while adopting the strongest parts of
OpenClaw's control-plane design.

## Delivered in 1.1.0.5

The first reliability tranche is now implemented behind the existing terminal
transport:

- WebSocket `hello` handshakes advertise protocol version/capabilities, mutating
  requests receive accepted acknowledgements, events carry monotonic sequence
  and state-version metadata, and reconnects replay or request reconciliation.
- Autonomous runs persist their effective tool/filesystem/network/container
  policy. High-risk runs pause for a structured approval or rejection event;
  approvals are recorded in the operator activity feed.
- The active run UI includes a compact, read-only observer rail with bounded
  snapshots and no write tools. The health popover also includes active/stale
  run counts, recovery attempts, open sessions, Docker status, and recent policy
  events. The same data is available at `GET /api/diagnostics`.
- Unit coverage for the protocol, policy escalation, and bounded diagnostics is
  included in the repository test command.

The remaining P2 skill-package lifecycle work stays deliberately separate from
the transport and policy contracts so it can be added without another protocol
migration.
