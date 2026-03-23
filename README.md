# Startupp AI Prompt Maker

A local-first prompt organizer and generator for managing project rules, generating structured prompts, and storing prompt history on your own machine.

## Quick Start

```bash
git clone <repository-url>
cd startupp-ai-prompt-maker
npm run install:all
npm run dev
```

Open the app at http://localhost:5173

The local API runs at http://localhost:55590

Data is stored locally in `data/db.json` (auto-created, gitignored).

This app is intentionally optimized for local or self-hosted use on your own machine. It has no built-in user authentication.

## Features

### Project Management

- **Create Projects**: Define projects with names, descriptions, and custom rules
- **Edit Projects**: Update project details, descriptions, and rules at any time
- **Clone Projects**: Duplicate existing projects with all rules and descriptions intact
- **Project Rules**: Set custom rules and constraints for each project
- **Project Dashboard**: Overview of all your projects

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
2. Select a prompt type from the dropdown
3. Add any additional context or specific details
4. Click "Generate"
5. Review the generated prompt
6. Copy it, or let it auto-save if enabled for that project

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
