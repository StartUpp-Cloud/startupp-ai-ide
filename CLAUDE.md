# StartUpp AI IDE

## What This Project Is

StartUpp AI IDE is an open-source, self-hosted, AI-assisted development environment that runs in the browser. Each project gets its own isolated Docker container, and users interact with AI coding assistants (Claude Code, Aider, GitHub Copilot) through integrated terminals. A pluggable LLM layer (Ollama, OpenAI, or DeepSeek) provides prompt optimization, terminal output analysis, branch review, planning, and more.

## Tech Stack

- **Frontend:** React 18, Vite, Tailwind CSS, xterm.js, Lucide icons, React Router
- **Backend:** Express.js (ESM), LowDB (flat-file JSON database), node-pty
- **Real-time:** WebSocket (ws) for terminal I/O
- **Containers:** Docker (each project = isolated container with dev tools)
- **LLM:** Ollama / OpenAI / DeepSeek (pluggable provider)
- **Debug:** Chrome DevTools Protocol integration
- **NLP:** `natural` and `compromise` libraries for text processing
- **Integrations:** Slack (@slack/bolt)
- **Process Management:** PM2 (ecosystem.config.cjs)
- **Security:** Helmet, CORS, rate limiting, field encryption at rest

## Project Structure

```
src/server/          - 35+ backend modules (PTY mgmt, container mgmt, LLM provider, scheduler, agent orchestration, safety system, etc.)
src/server/routes/   - 28 Express route files (projects, containers, LLM, branch review, skills, debug, chat, scheduler, slack, etc.)
src/server/models/   - 6 data models: Project, Prompt, Plan, GlobalRule, History, ChatMessage (LowDB-backed)
src/client/src/pages/      - 12 pages: IDE, Dashboard, Onboarding, BranchReview, DebugElement, Skills, Profile, GlobalRules, CreateProject, EditProject, QuickPrompt, ProjectDetail
src/client/src/components/ - 31 UI components: Terminal, TopBar, ChatPanel, LiveAnalysisPanel, SchedulerPanel, NotificationCenter, ProjectManagerPanel, SystemHealth, etc.
src/data/            - Default/seed data
data/                - Runtime data: db.json (LowDB), screenshots, session history, chat logs, job state
docker/              - Dockerfile.dev for building project containers
scripts/             - Utility scripts (PTY permissions fix, Chrome debug launcher)
docs/superpowers/plans/ - Documentation for planned features
```

## Key Features

1. **Containerized Projects** -- Each project gets its own Docker container with persistent volumes for code (`/workspace`) and auth (`/home/dev`), with multi-repo workspace support.
2. **Dual Terminal System** -- Main terminal (for AI assistants) + utility shell, connected via WebSocket/node-pty with 100KB scrollback and session persistence.
3. **LLM-Powered Prompt System** -- Raw send or AI-optimized prompts with project rules/context; Plan Mode breaks goals into autonomous steps.
4. **Branch Review** -- LLM-analyzed git diffs with per-file explanations, impact levels, and color-coded file trees.
5. **Live Terminal Analysis** -- LLM watches terminal output and generates real-time checklists.
6. **Skills/Plugins** -- Installable rule packs (7 built-in: React Testing, Docker Deploy, DB Migrations, Security Audit, TypeScript Strict, REST API Design, Git Workflow) plus custom skills.
7. **Debug Element** -- Chrome DevTools Protocol integration for screenshots, console errors, DOM inspection.
8. **Scheduled Tasks** -- Cron-like tasks with LLM-assisted configuration, running inside containers.
9. **Chat System** -- Per-project chat with unread counts and notifications.
10. **Slack Integration** -- Bot integration via @slack/bolt.
11. **Agent Orchestration** -- Agent gateway, shell pool, auto-responder, and safety system for autonomous AI operations.
12. **Onboarding Wizard** -- 3-step setup: connect AI model, install Docker, create first project.

## Architectural Decisions

- **LowDB (flat JSON file)** as the database -- no external DB dependency, everything in `data/db.json`.
- **No credentials stored** -- all auth handled by native CLI OAuth (Claude, GitHub, npm) persisted in Docker volumes.
- **ESM throughout** (`"type": "module"` in both packages).
- **Server is single source of truth** for terminal sessions; clients attach/detach freely.
- **Field encryption at rest** for sensitive data (`fieldEncryption.js`, `.encryption-salt`).
- **PM2-ready** with ecosystem config for production deployment.
- **Vite dev proxy** forwards `/api` and `/ws` to the Express backend on port 55590.
- Designed as a **localhost/LAN tool** -- rate limiting is relaxed (10,000 req/min).

## Ports

- **Backend (Express):** 55590
- **Frontend (Vite dev):** 5173

## Planned Work

A chat-based autonomous agent restructure is planned (see `docs/superpowers/plans/2026-04-03-chat-agent-restructure.md`), transitioning from the dual-terminal layout to a conversational agent interface while preserving the existing container infrastructure.
