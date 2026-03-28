# StartUpp AI IDE

An AI-assisted development environment that connects to local or cloud LLMs to generate prompts, execute multi-step plans, and manage terminal sessions across your projects — all from a single IDE interface.

## Why this exists

AI coding assistants (Claude Code, GitHub Copilot, Aider) are powerful but need structured prompts with project context. StartUpp AI IDE:

- **Stores project rules** that get injected into every prompt automatically
- **Uses your connected LLM** (Ollama, OpenAI, DeepSeek) to draft prompts from plain-language descriptions
- **Breaks big goals into plans** with sequential steps that execute one after another
- **Manages terminal sessions** per project, with an AI auto-responder that handles routine CLI questions
- **Runs on your network** — accessible from any machine on your LAN

## Quick Start

```bash
git clone https://github.com/StartUpp-Cloud/startupp-ai-ide.git
cd startupp-ai-ide
npm run install:all
npm run dev
```

Open **http://localhost:5173**

On first launch, the onboarding wizard will guide you to:
1. Connect an AI model (Ollama recommended for local use)
2. Create your first project

## Features

### AI-Assisted Prompt Generation

Describe what you want in plain language. The connected LLM drafts a detailed, actionable prompt using your project's context, rules, and presets. Review, edit, and send to the terminal.

### Plan Mode

Describe a big goal. The LLM breaks it into sequential steps with individual prompts. Execute them one at a time with safety gates between steps. Skip, pause, or send custom responses at any point.

### Integrated Terminal

- One terminal session per project, opening in the project's configured folder
- Session tabs for switching between projects
- Quick-launch buttons for Claude Code, GitHub Copilot, and Aider
- Full xterm.js terminal with WebSocket streaming

### AI Auto-Responder

The connected LLM automatically handles routine CLI questions (y/n confirmations, file approvals, etc.) based on your project context and rules. Features:

- **Persistent control bar** showing detected questions with confidence levels
- **Quick response buttons** for suggested answers
- **Custom response input** for manual overrides
- **Toggle on/off** with the "Auto" button
- **Risk-based guardrails** — high-risk operations always require human confirmation

### Project Management

- Create projects with name, description, rules, presets, and a workspace folder path
- Edit, clone, import/export, and delete projects from the IDE sidebar
- Drag-and-drop rule reordering
- Preset rule templates (React/TypeScript, REST APIs, Security, etc.)

### Global Rules

Rules that apply across all projects. Manage at **Global Rules** in the nav.

### Network Access

The IDE is accessible from any computer on your local network. Both the frontend and terminal sessions work over the network — the terminal runs on the server machine.

## Tech Stack

| Layer    | Tech                               |
| -------- | ---------------------------------- |
| Frontend | React 18, Vite, Tailwind CSS       |
| Backend  | Express.js, LowDB (flat JSON file) |
| Terminal | node-pty, xterm.js, WebSocket      |
| LLM      | Ollama / OpenAI / DeepSeek         |
| UI icons | Lucide React                       |
| Runtime  | Node.js 18+                        |

## Scripts

| Command               | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `npm run dev`         | Start both client (port 5173) and server (port 55590)  |
| `npm run build`       | Build React app into `src/client/dist/`                |
| `npm start`           | Run server only (serves built React app in production) |
| `npm run install:all` | Install dependencies for both root and client          |

## Production (PM2)

```bash
npm run build
npm run pm2:start:prod
```

See [PM2-DEPLOYMENT.md](PM2-DEPLOYMENT.md) for full production setup.

## Data

All data lives in `data/db.json`. This file is gitignored — your projects, prompts, and LLM settings never leave your machine.

To back up: copy `data/db.json` somewhere safe.
To restore: replace `data/db.json` with your backup and restart the server.

## API Endpoints

### Projects
- `GET /api/projects` - List all projects
- `GET /api/projects/:id` - Get project by ID
- `POST /api/projects` - Create project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project
- `POST /api/projects/:id/clone` - Clone project

### LLM
- `GET /api/llm/settings` - Get LLM configuration
- `GET /api/llm/health` - Check LLM provider health
- `POST /api/llm/generate-prompt` - AI-assisted prompt generation
- `POST /api/llm/generate-plan` - AI-assisted plan generation
- `POST /api/llm/test` - Test LLM connection
- `GET /api/llm/ollama/models` - List available Ollama models

### Setup
- `GET /api/setup-status` - Check onboarding completion status

## Configuration

Copy `.env.example` to `.env` to customize:

```bash
PORT=55590              # Server port
NODE_ENV=development    # Environment
```

## License

MIT
