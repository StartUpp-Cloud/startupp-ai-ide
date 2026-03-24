# AI Prompt Maker

A local-first tool that automatically appends project-specific guardrails and rules to every AI prompt you generate — so your coding rules, design constraints, and security policies are always in context, every time.

## Why this exists

When working with AI assistants (GitHub Copilot, Cursor, Claude, ChatGPT), you constantly have to re-explain your project rules:

- _"Don't use mocks"_
- _"We use TypeScript strict mode"_
- _"Never expose error details in production"_

AI Prompt Maker stores these rules per project and automatically injects them into every generated prompt. You write your rules once, they're in every prompt forever.

## Quick Start

```bash
git clone https://github.com/your-username/ai-prompt-maker
cd ai-prompt-maker
npm run install:all
npm run dev
```

Open **http://localhost:5173**

The API runs at **http://localhost:55590** — all data is stored locally in `data/db.json` (auto-created, gitignored).

> **No authentication by default.** This tool is designed for local or self-hosted use on your own machine.

## Example Ruleset

Here's a sample ruleset for a React + TypeScript project:

```
1. Always use TypeScript with strict mode enabled
2. Prefer functional components and React hooks over class components
3. Define prop types for all components using TypeScript interfaces
4. Avoid using `any` type — use `unknown` and type guards instead
5. Do not use mocks or stubs — implement the real solution
6. Show the complete implementation, not just the changed parts
7. Consider edge cases and error handling in every implementation
```

## Features

### Core: Guardrails Injection

Every generated prompt automatically includes your project's rules in the correct order. When you copy or save a prompt, the full assembled version (project context + rules + your input) is what goes to the AI.

### Projects

- **Create projects** with custom rules and guidelines
- **Edit, clone, delete** projects at any time
- **Drag to reorder** rules by priority (highest priority rules first)
- **Enable/disable rules** per-session without deleting them (toggle in the project workspace)
- **Start from a preset** — built-in rule templates for React/TypeScript, REST APIs, Cloudflare Workers, Expo, Security, and General AI guardrails

### Global Rules

Rules that apply across **all** projects when toggled on. Good for universal guardrails like _"Never mock implementations"_ or _"Always explain architectural decisions"_. Manage them at **Global Rules** in the nav.

### Quick Prompt Builder

No project setup needed. Go to **Quick Build** in the nav, paste any raw prompt, check which projects' rules to inject, and get the assembled result instantly.

### Prompt Types

Choose from 8 structured prompt types (Bug Fix, Feature Implementation, Code Review, Testing Strategy, etc.) — or use Custom Prompt for free-form input. Each type has a starter template that frames your request.

### Prompt History

- Paginated history of all generated prompts per project
- Inline editing of saved prompts
- Prompt type badge showing what kind of prompt it was
- "View full prompt with context" expander shows the complete assembled prompt

### Export & Import

- **Export project** as JSON (rules + settings) — share with teammates or back up
- **Import project** from JSON — drop someone else's ruleset into your instance
- **Copy as `.cursorrules`** — export rules in the format used by Cursor IDE

### Prompt Settings (per project)

- Auto-save prompts after generation
- Include global rules in this project's prompts
- Drag to reorder the prompt sections (Project Details → Rules → Context, or any order)

## How a Generated Prompt Looks

```
Project: My SaaS App
Description: A React + TypeScript SaaS application with Supabase

Rules:
1. Always use TypeScript with strict mode enabled
2. Prefer functional components and React hooks
3. Do not use mocks — implement the real solution
4. Show the complete implementation, not just changed parts

Feature Implementation:
I want to implement a new feature for my my saas app project. Please provide a comprehensive implementation plan...

Additional Context: Add a dark mode toggle that persists to localStorage
```

## Tech Stack

| Layer    | Tech                               |
| -------- | ---------------------------------- |
| Frontend | React 18, Vite, Tailwind CSS       |
| Backend  | Express.js, LowDB (flat JSON file) |
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
npm run pm2:start
```

See [PM2-DEPLOYMENT.md](PM2-DEPLOYMENT.md) for full production setup.

## Data

All data lives in `data/db.json`. This file is gitignored — your projects and prompts never leave your machine.

To back up your data: copy `data/db.json` somewhere safe.  
To restore: replace `data/db.json` with your backup and restart the server.

## License

MIT

### Smart Prompt Generation

- **Predefined Prompt Types**: Choose from 8 different prompt categories:
  - Requirement Analysis
  - Bug Fix
  - Feature Implementation
  - Code Review
  - Performance Optimization
  - Testing Strategy
  - Documentation
  - Custom Prompt
- **Context-Aware**: Automatically includes project rules, description, and context
- **Smart Templates**: AI-optimized templates that adapt to your project type
- **Prompt Structure Settings**: Reorder `Project details`, `Rules`, and `Context` per project
- **Auto-Save Option**: Save generated prompts automatically per project
- **One-Click Copy**: Copy generated prompts to clipboard instantly
- **Save to Project**: Store generated prompts in your project history

### Prompt Management

- **Search & Filter**: Find specific prompts quickly
- **Pagination**: Navigate through large numbers of prompts
- **Full Context View**: See prompts with all project context included
- **Copy Functionality**: Copy individual prompts or full context

## Usage

### Creating a Project

1. Navigate to the Dashboard
2. Click "Create New Project"
3. Fill in project name, description, and rules
4. Optionally clone from an existing project to use as a template
5. Click "Create Project"

### Editing a Project

1. Open any project from the Dashboard
2. Click the edit icon (pencil) in the project header
3. Modify project details, description, or rules
4. Click "Save Changes"

### Cloning a Project

1. **From Dashboard**: Hover over any project card and click the clone icon
2. **From Project Detail**: Click the clone icon in the project header
3. **From Create Project**: Use the "Clone from Existing Project" option
4. Customize the cloned project name and description
5. All rules and project structure are automatically copied

### Generating Smart Prompts

1. Open a project
2. Optionally configure prompt settings for section order and auto-save
3. Select a prompt type from the dropdown
4. Add any additional context or specific details
5. Click "Generate"
6. Review the generated prompt
7. Copy it, or let it auto-save if enabled for that project

### Managing Prompts

- View all prompts in the project
- Search for specific prompts
- Copy individual prompts or full context
- Navigate through pages of prompts

## API Endpoints

### Projects

- `GET /api/projects` - Get all projects
- `GET /api/projects/:id` - Get project by ID
- `POST /api/projects` - Create new project
- `PUT /api/projects/:id` - Update project
- `DELETE /api/projects/:id` - Delete project

### Prompts

- `GET /api/projects/:id/prompts` - Get prompts for a project
- `POST /api/projects/:id/prompts` - Create new prompt

## Local Usage Model

- Project and prompt data stay in the local JSON database.
- `.env`, `data/`, `logs/`, and build output are gitignored.
- The app is a good fit for personal/local usage or private self-hosting.
- If you expose it directly to the public internet, add authentication first.

## Technology Stack

- **Frontend**: React 18, Vite, Tailwind CSS
- **Backend**: Node.js, Express.js
- **Database**: LowDB (local JSON file)
- **Security**: Helmet.js, CORS, Rate limiting
- **Icons**: Lucide React

## Configuration (Optional)

Copy `env.example` to `.env` to customize:

```bash
PORT=55590              # Server port
NODE_ENV=development    # Environment
```

## PM2 Deployment

For a local self-hosted production-style run with PM2:

```bash
npm run pm2:start:prod
```

See `PM2-DEPLOYMENT.md` for detailed deployment instructions.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.
