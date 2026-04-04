# Chat-Based Autonomous Agent Restructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual-terminal IDE layout with a centralized chat interface where a local LLM orchestrates external AI tools (Claude, Copilot, etc.) running in hidden shell sessions, presenting progress and results through a searchable, persistent conversation UI.

**Architecture:** The UI becomes a per-project chat thread (like OpenClaw's session model). The local LLM acts as the "gateway agent" that receives user requests, decomposes them, spawns hidden PTY sessions to drive external CLIs, monitors their output, auto-responds to prompts, and streams curated progress back to the chat. Two modes (Plan / Agent) control whether the LLM iterates on a plan before executing or acts autonomously. All chat messages are stored as JSONL per project for full-text search and context replay.

**Tech Stack:** React 18 + xterm.js (hidden) + WebSocket, Node.js + LowDB + node-pty, Ollama/OpenAI local LLM, existing containerManager + ptyManager infrastructure.

---

## Scope & Phasing

This is a large restructuring. It is broken into **4 phases**, each producing working, testable software:

1. **Phase 1: Chat Data Layer & API** — JSONL storage, models, search, REST endpoints
2. **Phase 2: Chat UI & Project Switching** — Replace dual-terminal center panel with chat, keep everything else
3. **Phase 3: Agent Gateway** — Local LLM orchestration loop, hidden shell management, auto-response
4. **Phase 4: Plan Mode & Context Intelligence** — Plan/Agent toggle, context compaction, cross-session memory

Each phase can be deployed independently. Later phases build on earlier ones.

---

## File Structure

### New Files

```
src/server/
  chatStore.js              — JSONL read/write, full-text search, per-project indexing
  agentGateway.js           — Core agent loop: receive task, decompose, drive shells, report
  agentShellPool.js         — Manages hidden PTY sessions for the agent (create, reuse, kill)
  contextCompactor.js       — Summarizes old chat messages to stay within token budgets

src/server/models/
  ChatMessage.js            — Message schema, serialization, validation

src/server/routes/
  chat.js                   — REST + WS endpoints for chat CRUD, search, streaming

src/client/src/components/
  ChatPanel.jsx             — Main chat view: message list, input, mode toggle
  ChatMessage.jsx           — Single message renderer (user, agent, system, progress)
  ChatInput.jsx             — Input area with mode indicator, send button, attachments
  ModeToggle.jsx            — Plan/Agent mode switch
  AgentProgress.jsx         — Task list, progress bars, color-coded status
  InternalConsole.jsx       — Collapsible raw terminal output viewer (debug)
  ProjectChat.jsx           — Wrapper: project selector -> ChatPanel
```

### Modified Files

```
src/client/src/pages/IDE.jsx            — Replace dual-terminal center with ProjectChat
src/client/src/components/TopBar.jsx    — Simplify: remove raw-send, add mode toggle
src/client/src/components/Terminal.jsx  — Keep but make it hideable (agent-only, not user-facing)
src/server/terminalServer.js            — Add chat WS message types alongside terminal ones
src/server/llmProvider.js               — Add agent-specific system prompts and streaming
src/server/autoResponder.js             — Wire into agentGateway instead of terminal UI
src/server/orchestrator.js              — Adapt to work through agentGateway instead of direct PTY
```

### Preserved (No Changes)

```
src/server/containerManager.js          — Docker infra stays as-is
src/server/ptyManager.js                — PTY creation stays, just called by agentShellPool
src/server/models/Project.js            — Project model untouched
src/server/models/Prompt.js             — Prompt history preserved
src/client/src/components/ProjectManagerPanel.jsx  — Left sidebar stays
src/client/src/components/RightPanel.jsx           — Right sidebar stays
src/client/src/contexts/ProjectContext.jsx         — Context provider stays
```

---

## Phase 1: Chat Data Layer & API

### Task 1: Chat Message Model

**Files:**
- Create: `src/server/models/ChatMessage.js`

- [ ] **Step 1: Define the ChatMessage schema**

```javascript
// src/server/models/ChatMessage.js
import { v4 as uuidv4 } from 'uuid';

/**
 * @typedef {'user'|'agent'|'system'|'progress'|'error'} MessageRole
 *
 * @typedef {Object} ChatMessage
 * @property {string}      id        - UUID
 * @property {string}      projectId - Which project this belongs to
 * @property {MessageRole} role      - Who sent it
 * @property {string}      content   - Markdown text content
 * @property {Object|null} metadata  - Role-specific data (tasks, status, tool used, etc.)
 * @property {string}      createdAt - ISO timestamp
 */

export function createMessage({ projectId, role, content, metadata = null }) {
  if (!projectId || !role || content == null) {
    throw new Error('projectId, role, and content are required');
  }
  return {
    id: uuidv4(),
    projectId,
    role,
    content: String(content),
    metadata,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Serialize a message to a single JSONL line.
 */
export function serialize(msg) {
  return JSON.stringify(msg);
}

/**
 * Deserialize a JSONL line to a message object.
 * Returns null for blank/corrupt lines.
 */
export function deserialize(line) {
  if (!line || !line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/models/ChatMessage.js
git commit -m "feat(chat): add ChatMessage model with JSONL serialization"
```

---

### Task 2: JSONL Chat Store

**Files:**
- Create: `src/server/chatStore.js`

- [ ] **Step 1: Implement the JSONL-backed chat store**

This is the core persistence layer. Each project gets its own `.jsonl` file. Messages are append-only. Search is line-by-line (reliable over fast). An in-memory index caches message IDs for pagination.

```javascript
// src/server/chatStore.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMessage, serialize, deserialize } from './models/ChatMessage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.join(__dirname, '../../data/chat');

// Ensure chat directory exists
if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true });
}

class ChatStore {
  constructor() {
    // In-memory index: projectId -> [{ id, offset, length }]
    // Built lazily on first access per project.
    this._index = new Map();
  }

  /**
   * Path to a project's chat file.
   */
  _filePath(projectId) {
    return path.join(CHAT_DIR, `${projectId}.jsonl`);
  }

  /**
   * Append a message to the project's chat log.
   * Returns the created message object.
   */
  addMessage({ projectId, role, content, metadata }) {
    const msg = createMessage({ projectId, role, content, metadata });
    const line = serialize(msg) + '\n';
    const filePath = this._filePath(projectId);

    fs.appendFileSync(filePath, line, 'utf-8');

    // Update in-memory index
    if (this._index.has(projectId)) {
      this._index.get(projectId).push(msg.id);
    }

    return msg;
  }

  /**
   * Get messages for a project with pagination.
   * Returns newest-first by default. `before` is a message ID for cursor pagination.
   */
  getMessages(projectId, { limit = 50, before = null } = {}) {
    const filePath = this._filePath(projectId);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const messages = [];
    for (const line of lines) {
      const msg = deserialize(line);
      if (msg) messages.push(msg);
    }

    if (before) {
      const idx = messages.findIndex(m => m.id === before);
      if (idx > 0) return messages.slice(Math.max(0, idx - limit), idx).reverse();
      return [];
    }

    // Return last `limit` messages, newest first
    return messages.slice(-limit).reverse();
  }

  /**
   * Full-text search across a project's chat.
   * Case-insensitive substring match on content.
   */
  search(projectId, query, { limit = 20 } = {}) {
    const filePath = this._filePath(projectId);
    if (!fs.existsSync(filePath) || !query) return [];

    const lowerQuery = query.toLowerCase();
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    const results = [];

    for (const line of lines) {
      const msg = deserialize(line);
      if (msg && msg.content.toLowerCase().includes(lowerQuery)) {
        results.push(msg);
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  /**
   * Get total message count for a project.
   */
  getCount(projectId) {
    const filePath = this._filePath(projectId);
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').filter(l => l.trim()).length;
  }

  /**
   * Get all messages (for context building / compaction).
   */
  getAllMessages(projectId) {
    return this.getMessages(projectId, { limit: Infinity });
  }

  /**
   * Delete all chat data for a project.
   */
  deleteProject(projectId) {
    const filePath = this._filePath(projectId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    this._index.delete(projectId);
  }
}

export const chatStore = new ChatStore();
export default chatStore;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/chatStore.js
git commit -m "feat(chat): add JSONL-backed ChatStore with search and pagination"
```

---

### Task 3: Chat REST API

**Files:**
- Create: `src/server/routes/chat.js`
- Modify: `src/server/index.js` (add route registration)

- [ ] **Step 1: Create the chat routes**

```javascript
// src/server/routes/chat.js
import express from 'express';
import { chatStore } from '../chatStore.js';

const router = express.Router();

// GET /api/projects/:projectId/chat — Get messages (paginated)
router.get('/:projectId/chat', (req, res) => {
  try {
    const { projectId } = req.params;
    const { limit = 50, before } = req.query;
    const messages = chatStore.getMessages(projectId, {
      limit: parseInt(limit, 10),
      before: before || null,
    });
    res.json({ messages, total: chatStore.getCount(projectId) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:projectId/chat/search — Search messages
router.get('/:projectId/chat/search', (req, res) => {
  try {
    const { projectId } = req.params;
    const { q, limit = 20 } = req.query;
    if (!q) return res.json({ messages: [] });
    const messages = chatStore.search(projectId, q, { limit: parseInt(limit, 10) });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/projects/:projectId/chat — Add a user message
router.post('/:projectId/chat', (req, res) => {
  try {
    const { projectId } = req.params;
    const { content, metadata } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' });
    const msg = chatStore.addMessage({
      projectId,
      role: 'user',
      content: content.trim(),
      metadata,
    });
    res.status(201).json(msg);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

- [ ] **Step 2: Register the route in index.js**

In `src/server/index.js`, add among the other route imports and registrations:

```javascript
import chatRoutes from './routes/chat.js';
// ... inside the route setup section:
app.use('/api/projects', chatRoutes);
```

Find the existing `app.use('/api/projects', projectRoutes)` block and add the chat routes nearby. The chat routes use `/:projectId/chat` so they won't conflict with the project CRUD routes.

- [ ] **Step 3: Wire project deletion to clean up chat data**

In `src/server/routes/projects.js`, inside the `DELETE /:id` handler, add after the container cleanup:

```javascript
// Clean up chat history
const { chatStore } = await import('../chatStore.js');
chatStore.deleteProject(id);
```

- [ ] **Step 4: Commit**

```bash
git add src/server/routes/chat.js src/server/index.js src/server/routes/projects.js
git commit -m "feat(chat): add REST API for chat messages with search"
```

---

## Phase 2: Chat UI & Project Switching

### Task 4: ChatMessage Component

**Files:**
- Create: `src/client/src/components/ChatMessage.jsx`

- [ ] **Step 1: Build the message renderer**

Each message has a role that determines its appearance. User messages are right-aligned. Agent messages are left-aligned with a colored border. System/progress messages are centered and compact.

```jsx
// src/client/src/components/ChatMessage.jsx
import { Bot, User, AlertTriangle, CheckCircle, Loader, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

const ROLE_STYLES = {
  user: {
    align: 'justify-end',
    bubble: 'bg-blue-600/20 border-blue-500/30',
    icon: User,
    label: 'You',
  },
  agent: {
    align: 'justify-start',
    bubble: 'bg-gray-700/40 border-gray-600/30',
    icon: Bot,
    label: 'Agent',
  },
  system: {
    align: 'justify-center',
    bubble: 'bg-yellow-900/20 border-yellow-600/20 text-yellow-300/80 text-sm',
    icon: AlertTriangle,
    label: 'System',
  },
  progress: {
    align: 'justify-start',
    bubble: 'bg-gray-800/30 border-gray-700/20',
    icon: Loader,
    label: 'Progress',
  },
  error: {
    align: 'justify-start',
    bubble: 'bg-red-900/20 border-red-500/30 text-red-300',
    icon: AlertTriangle,
    label: 'Error',
  },
};

export default function ChatMessage({ message }) {
  const [showRaw, setShowRaw] = useState(false);
  const style = ROLE_STYLES[message.role] || ROLE_STYLES.agent;
  const Icon = style.icon;
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Progress messages render task list from metadata
  const tasks = message.metadata?.tasks;
  const tool = message.metadata?.tool;
  const rawOutput = message.metadata?.rawOutput;

  return (
    <div className={`flex ${style.align} mb-3 px-3`}>
      <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${style.bubble}`}>
        {/* Header */}
        <div className="flex items-center gap-2 mb-1 text-xs text-gray-400">
          <Icon size={12} />
          <span>{style.label}</span>
          {tool && <span className="text-purple-400">via {tool}</span>}
          <span className="ml-auto">{time}</span>
        </div>

        {/* Content */}
        <div className="text-sm text-gray-200 whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {/* Task list (progress messages) */}
        {tasks && tasks.length > 0 && (
          <div className="mt-2 space-y-1">
            {tasks.map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {task.status === 'done' && <CheckCircle size={12} className="text-green-400" />}
                {task.status === 'running' && <Loader size={12} className="text-blue-400 animate-spin" />}
                {task.status === 'pending' && <div className="w-3 h-3 rounded-full border border-gray-600" />}
                {task.status === 'failed' && <AlertTriangle size={12} className="text-red-400" />}
                <span className={task.status === 'done' ? 'text-gray-500 line-through' : 'text-gray-300'}>
                  {task.title}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Collapsible raw output */}
        {rawOutput && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="flex items-center gap-1 mt-2 text-xs text-gray-500 hover:text-gray-300"
          >
            {showRaw ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Raw output
          </button>
        )}
        {showRaw && rawOutput && (
          <pre className="mt-1 p-2 bg-black/40 rounded text-xs text-gray-400 overflow-x-auto max-h-48 overflow-y-auto">
            {rawOutput}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/components/ChatMessage.jsx
git commit -m "feat(chat): add ChatMessage component with role-based styling"
```

---

### Task 5: ModeToggle Component

**Files:**
- Create: `src/client/src/components/ModeToggle.jsx`

- [ ] **Step 1: Build the Plan/Agent mode toggle**

```jsx
// src/client/src/components/ModeToggle.jsx
import { Brain, Zap } from 'lucide-react';

export default function ModeToggle({ mode, onChange }) {
  return (
    <div className="flex items-center bg-gray-800 rounded-lg p-0.5 border border-gray-700">
      <button
        onClick={() => onChange('plan')}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
          mode === 'plan'
            ? 'bg-purple-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Brain size={13} />
        Plan
      </button>
      <button
        onClick={() => onChange('agent')}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
          mode === 'agent'
            ? 'bg-green-600 text-white shadow-sm'
            : 'text-gray-400 hover:text-gray-200'
        }`}
      >
        <Zap size={13} />
        Agent
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/components/ModeToggle.jsx
git commit -m "feat(chat): add Plan/Agent mode toggle component"
```

---

### Task 6: ChatInput Component

**Files:**
- Create: `src/client/src/components/ChatInput.jsx`

- [ ] **Step 1: Build the chat input with mode awareness**

```jsx
// src/client/src/components/ChatInput.jsx
import { useState, useRef, useEffect } from 'react';
import { Send, Search, X } from 'lucide-react';

export default function ChatInput({ mode, onSend, onSearch, disabled = false }) {
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const textareaRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [text]);

  const handleSend = () => {
    if (!text.trim() || disabled) return;
    onSend(text.trim());
    setText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSearch = (q) => {
    setSearchQuery(q);
    onSearch?.(q);
  };

  const placeholder = mode === 'plan'
    ? 'Describe what you want to build... (Ctrl+Enter to send)'
    : 'Tell the agent what to do... (Ctrl+Enter to send)';

  return (
    <div className="border-t border-gray-700 bg-gray-900/80 px-3 py-2">
      {/* Search bar */}
      {searching && (
        <div className="flex items-center gap-2 mb-2">
          <Search size={14} className="text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search chat history..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 outline-none focus:border-blue-500"
            autoFocus
          />
          <button onClick={() => { setSearching(false); setSearchQuery(''); handleSearch(''); }}>
            <X size={14} className="text-gray-500 hover:text-gray-300" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2">
        <button
          onClick={() => setSearching(!searching)}
          className="p-1.5 text-gray-500 hover:text-gray-300 rounded"
          title="Search chat (Ctrl+F)"
        >
          <Search size={16} />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 resize-none outline-none focus:border-blue-500 disabled:opacity-50 placeholder:text-gray-600"
        />
        <button
          onClick={handleSend}
          disabled={!text.trim() || disabled}
          className={`p-2 rounded-lg transition-colors ${
            text.trim() && !disabled
              ? mode === 'plan'
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-gray-800 text-gray-600'
          }`}
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/components/ChatInput.jsx
git commit -m "feat(chat): add ChatInput with mode-aware styling and search"
```

---

### Task 7: ChatPanel — Main Chat View

**Files:**
- Create: `src/client/src/components/ChatPanel.jsx`

- [ ] **Step 1: Build the main chat panel**

This is the center of the new UI. It fetches messages from the API, renders them, handles sending, and receives real-time updates via WebSocket.

```jsx
// src/client/src/components/ChatPanel.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import ChatMessage from './ChatMessage';
import ChatInput from './ChatInput';
import ModeToggle from './ModeToggle';
import { MessageSquare, Loader } from 'lucide-react';

export default function ChatPanel({ projectId, wsRef }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState(() => localStorage.getItem('agent-mode') || 'agent');
  const [agentBusy, setAgentBusy] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const messagesEndRef = useRef(null);
  const containerRef = useRef(null);

  // Persist mode preference
  useEffect(() => {
    localStorage.setItem('agent-mode', mode);
  }, [mode]);

  // Load messages when project changes
  useEffect(() => {
    if (!projectId) { setMessages([]); return; }
    setLoading(true);
    setSearchResults(null);
    fetch(`/api/projects/${projectId}/chat?limit=100`)
      .then(r => r.json())
      .then(data => {
        // API returns newest-first, reverse for display
        setMessages((data.messages || []).reverse());
      })
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for real-time chat messages via WebSocket
  useEffect(() => {
    if (!wsRef?.current) return;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'chat-message' && msg.message?.projectId === projectId) {
        setMessages(prev => [...prev, msg.message]);
        if (msg.message.role === 'agent' || msg.message.role === 'error') {
          setAgentBusy(false);
        }
      }
      if (msg.type === 'chat-progress' && msg.projectId === projectId) {
        // Update the last progress message in-place
        setMessages(prev => {
          const copy = [...prev];
          const lastProgressIdx = copy.findLastIndex(m => m.role === 'progress');
          if (lastProgressIdx >= 0 && msg.message) {
            copy[lastProgressIdx] = msg.message;
          } else if (msg.message) {
            copy.push(msg.message);
          }
          return copy;
        });
      }
      if (msg.type === 'agent-status') {
        setAgentBusy(msg.busy);
      }
    };
    const ws = wsRef.current;
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, projectId]);

  const handleSend = useCallback(async (content) => {
    if (!projectId) return;

    // Optimistically add user message
    const optimistic = {
      id: 'pending-' + Date.now(),
      projectId,
      role: 'user',
      content,
      metadata: { mode },
      createdAt: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);
    setAgentBusy(true);

    // Send to server via WebSocket for real-time processing
    if (wsRef?.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat-send',
        projectId,
        content,
        mode,
      }));
    }
  }, [projectId, mode, wsRef]);

  const handleSearch = useCallback(async (query) => {
    if (!query || !projectId) { setSearchResults(null); return; }
    try {
      const r = await fetch(`/api/projects/${projectId}/chat/search?q=${encodeURIComponent(query)}`);
      const data = await r.json();
      setSearchResults(data.messages || []);
    } catch {
      setSearchResults([]);
    }
  }, [projectId]);

  const displayMessages = searchResults || messages;

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600">
        <div className="text-center">
          <MessageSquare size={48} className="mx-auto mb-3 opacity-30" />
          <p>Select a project to start</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-900/90">
        <ModeToggle mode={mode} onChange={setMode} />
        {agentBusy && (
          <div className="flex items-center gap-2 text-xs text-blue-400">
            <Loader size={12} className="animate-spin" />
            Working...
          </div>
        )}
        {searchResults && (
          <span className="text-xs text-gray-500">{searchResults.length} results</span>
        )}
      </div>

      {/* Messages */}
      <div ref={containerRef} className="flex-1 overflow-y-auto py-3">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader size={24} className="animate-spin text-gray-600" />
          </div>
        ) : displayMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            {searchResults ? 'No results found' : 'Start a conversation...'}
          </div>
        ) : (
          displayMessages.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <ChatInput
        mode={mode}
        onSend={handleSend}
        onSearch={handleSearch}
        disabled={agentBusy}
      />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/components/ChatPanel.jsx
git commit -m "feat(chat): add ChatPanel with message display, search, and real-time updates"
```

---

### Task 8: Replace Dual-Terminal Layout with Chat

**Files:**
- Modify: `src/client/src/pages/IDE.jsx`

- [ ] **Step 1: Swap the center panel**

In `IDE.jsx`, the center section currently renders two `<Terminal />` components (main + utility). Replace them with `<ChatPanel />`. Keep the Terminal component available but hidden — it will be used internally by the agent in Phase 3.

Find the center panel section (between left panel resizer and right panel resizer, approximately lines 512-547) and replace:

Old (dual terminal):
```jsx
{/* Main Terminal */}
<Terminal ... />
{/* Utility divider + Terminal */}
<Terminal isUtility={true} ... />
```

New (chat panel):
```jsx
<ChatPanel
  projectId={selectedProjectId}
  wsRef={chatWsRef}
/>
```

Add the WebSocket ref at the top of IDE.jsx component:

```javascript
const chatWsRef = useRef(null);

// Connect chat WebSocket (reuse terminal WS or create dedicated)
useEffect(() => {
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal`;
  const ws = new WebSocket(wsUrl);
  ws.onopen = () => { chatWsRef.current = ws; };
  ws.onclose = () => { chatWsRef.current = null; };
  return () => ws.close();
}, []);
```

Import ChatPanel at the top:
```javascript
import ChatPanel from '../components/ChatPanel';
```

Remove the imports for Terminal (unless kept for a debug toggle — see Task 10).

Remove all terminal-specific state from IDE.jsx:
- `currentSessionId` / `setCurrentSessionId`
- `utilSessionId` / `setUtilSessionId`
- `utilCollapsed` / `setUtilCollapsed`
- Terminal callback functions (`onSendRaw`, etc.)
- Any refs to `window.switchMainSession`

Keep all project/plan/notification state — it's still used.

- [ ] **Step 2: Simplify TopBar**

In `src/client/src/components/TopBar.jsx`, remove the prompt input textarea and the raw-send/AI-send buttons. The TopBar becomes a thin status bar showing:
- Project name
- Current branch
- Plan execution status (if running)
- System health indicator
- Notification slot

Remove props: `onSendRaw`, `onOptimizeAndSend`, `currentSessionId`. The mode toggle and chat input are now in ChatPanel.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/pages/IDE.jsx src/client/src/components/TopBar.jsx
git commit -m "feat(chat): replace dual-terminal center panel with ChatPanel"
```

---

### Task 9: Chat WebSocket Handler (Server)

**Files:**
- Modify: `src/server/terminalServer.js`

- [ ] **Step 1: Add chat message types to the WebSocket handler**

In `terminalServer.js`, inside the `handleMessage` switch statement, add handlers for the new chat message types. For now, the `chat-send` handler persists the user message and sends back a placeholder agent response. Phase 3 will wire this to the real agent gateway.

Add to the switch block in `handleMessage`:

```javascript
case 'chat-send': {
  // User sent a chat message
  const { chatStore } = await import('./chatStore.js');
  const userMsg = chatStore.addMessage({
    projectId: payload.projectId,
    role: 'user',
    content: payload.content,
    metadata: { mode: payload.mode },
  });

  // Broadcast user message to all connected clients
  this.broadcast({
    type: 'chat-message',
    message: userMsg,
  });

  // Phase 3 will replace this with agentGateway.handleTask()
  // For now, echo back a placeholder agent response
  const agentMsg = chatStore.addMessage({
    projectId: payload.projectId,
    role: 'agent',
    content: `Received: "${payload.content}"\n\n*Agent gateway not yet connected. This will be handled by the local LLM in Phase 3.*`,
    metadata: { mode: payload.mode },
  });
  this.broadcast({
    type: 'chat-message',
    message: agentMsg,
  });
  break;
}
```

Also add a `broadcast` method if it doesn't exist (broadcast to ALL connected clients, not just session-attached ones):

```javascript
broadcast(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  for (const client of this.wss.clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(msg);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/terminalServer.js
git commit -m "feat(chat): add chat-send WebSocket handler with placeholder agent response"
```

---

### Task 10: Optional Debug Console Toggle

**Files:**
- Create: `src/client/src/components/InternalConsole.jsx`
- Modify: `src/client/src/pages/IDE.jsx`

- [ ] **Step 1: Create a minimal collapsible terminal viewer**

This is an opt-in debug panel (toggled by a keyboard shortcut or button) that shows the raw terminal output from agent shell sessions. It's not the main UI — just a debug window for power users.

```jsx
// src/client/src/components/InternalConsole.jsx
import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

export default function InternalConsole({ wsRef }) {
  const [open, setOpen] = useState(false);
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    if (!open || !termRef.current || xtermRef.current) return;
    const xterm = new XTerm({
      cursorBlink: false,
      fontSize: 11,
      scrollback: 5000,
      theme: { background: '#0d1117', foreground: '#8b949e' },
      disableStdin: true,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(termRef.current);
    fit.fit();
    xtermRef.current = xterm;
    fitRef.current = fit;

    return () => { xterm.dispose(); xtermRef.current = null; };
  }, [open]);

  // Listen for agent shell output
  useEffect(() => {
    if (!wsRef?.current || !open) return;
    const handler = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'agent-shell-output' && xtermRef.current) {
        xtermRef.current.write(msg.data);
      }
    };
    const ws = wsRef.current;
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, open]);

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1 text-xs text-gray-500 hover:text-gray-300 bg-gray-900/50"
      >
        <Terminal size={12} />
        Internal Console
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      {open && (
        <div ref={termRef} style={{ height: 180 }} className="bg-[#0d1117]" />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add to IDE.jsx**

Below the `<ChatPanel />`, add:

```jsx
<InternalConsole wsRef={chatWsRef} />
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/components/InternalConsole.jsx src/client/src/pages/IDE.jsx
git commit -m "feat(chat): add collapsible internal console for agent shell debugging"
```

---

## Phase 3: Agent Gateway

### Task 11: Agent Shell Pool

**Files:**
- Create: `src/server/agentShellPool.js`

- [ ] **Step 1: Build the hidden shell session manager**

The agent needs PTY sessions to drive CLI tools (Claude, Copilot, etc.) but these sessions are invisible to the user. The shell pool creates, reuses, and kills sessions on behalf of the agent.

```javascript
// src/server/agentShellPool.js
import { ptyManager } from './ptyManager.js';
import { EventEmitter } from 'events';

/**
 * Manages hidden PTY sessions used by the agent gateway.
 * Sessions are keyed by projectId + tool (e.g., "proj123:claude").
 * Reuses sessions when possible to preserve context within a tool.
 */
class AgentShellPool extends EventEmitter {
  constructor() {
    super();
    // Map<string, { sessionId, projectId, tool, createdAt }>
    this.sessions = new Map();
    // Map<sessionId, string> — buffer of recent output per session
    this.outputBuffers = new Map();
  }

  _key(projectId, tool) {
    return `${projectId}:${tool || 'shell'}`;
  }

  /**
   * Get or create a session for a project + tool combination.
   * Returns { sessionId, isNew }.
   */
  async getSession(projectId, tool = 'shell') {
    const key = this._key(projectId, tool);
    const existing = this.sessions.get(key);

    // Check if the existing session is still alive
    if (existing) {
      const session = ptyManager.getSession(existing.sessionId);
      if (session && session.status === 'active') {
        return { sessionId: existing.sessionId, isNew: false };
      }
      // Session died — clean up
      this.sessions.delete(key);
      this.outputBuffers.delete(existing.sessionId);
    }

    // Look up project to get container info
    const { default: Project } = await import('./models/Project.js');
    const project = Project.findById(projectId);
    let containerName = null;
    let workingDir = null;

    if (project?.containerName) {
      containerName = project.containerName;
      const { containerManager } = await import('./containerManager.js');
      const status = containerManager.getContainerStatus(containerName);
      if (!status) throw new Error(`Container ${containerName} does not exist`);
      if (status !== 'running') {
        const started = containerManager.startContainer(containerName);
        if (!started) throw new Error(`Failed to start container ${containerName}`);
      }
      workingDir = containerManager.getWorkDir(containerName) || '/workspace';
    } else if (project?.folderPath) {
      workingDir = project.folderPath;
    }

    // Create a new hidden session (role: 'agent' to avoid conflicting with user sessions)
    const result = ptyManager.createSession({
      projectId,
      cliTool: tool === 'shell' ? null : tool,
      containerName,
      role: 'agent',
      cols: 120,
      rows: 30,
      cwd: workingDir,
    });

    this.sessions.set(key, {
      sessionId: result.sessionId,
      projectId,
      tool,
      createdAt: new Date().toISOString(),
    });
    this.outputBuffers.set(result.sessionId, '');

    // Start CLI tool if not just shell
    if (tool && tool !== 'shell') {
      setTimeout(() => {
        try { ptyManager.startCLI(result.sessionId, tool); } catch {}
      }, 300);
    }

    return { sessionId: result.sessionId, isNew: true };
  }

  /**
   * Write input to a session.
   */
  write(sessionId, data) {
    return ptyManager.write(sessionId, data);
  }

  /**
   * Feed output from a session (called by terminalServer when PTY emits data).
   */
  feedOutput(sessionId, data) {
    const buf = this.outputBuffers.get(sessionId);
    if (buf !== undefined) {
      // Keep last 20KB of output
      const combined = buf + data;
      this.outputBuffers.set(sessionId, combined.slice(-20480));
      this.emit('output', { sessionId, data });
    }
  }

  /**
   * Get recent output from a session.
   */
  getRecentOutput(sessionId) {
    return this.outputBuffers.get(sessionId) || '';
  }

  /**
   * Kill all sessions for a project.
   */
  killProjectSessions(projectId) {
    for (const [key, entry] of this.sessions) {
      if (entry.projectId === projectId) {
        ptyManager.killSession(entry.sessionId);
        this.sessions.delete(key);
        this.outputBuffers.delete(entry.sessionId);
      }
    }
  }

  /**
   * Kill a specific session.
   */
  killSession(sessionId) {
    for (const [key, entry] of this.sessions) {
      if (entry.sessionId === sessionId) {
        ptyManager.killSession(sessionId);
        this.sessions.delete(key);
        this.outputBuffers.delete(sessionId);
        return;
      }
    }
  }
}

export const agentShellPool = new AgentShellPool();
export default agentShellPool;
```

- [ ] **Step 2: Wire PTY output into the shell pool**

In `src/server/terminalServer.js`, in the `ptyManager.on('data', ...)` handler (around line 80-103), add a line to feed output to the agent shell pool:

```javascript
// After the existing broadcastToSession call:
agentShellPool.feedOutput(sessionId, coalesced);
```

Import at top of file:
```javascript
import { agentShellPool } from './agentShellPool.js';
```

- [ ] **Step 3: Commit**

```bash
git add src/server/agentShellPool.js src/server/terminalServer.js
git commit -m "feat(agent): add AgentShellPool for managing hidden PTY sessions"
```

---

### Task 12: Agent Gateway — Core Loop

**Files:**
- Create: `src/server/agentGateway.js`

- [ ] **Step 1: Build the agent gateway**

This is the brain. It receives user tasks from the chat, uses the local LLM to decide what to do, drives the shell pool, monitors output, auto-responds to prompts, and reports progress back to the chat.

```javascript
// src/server/agentGateway.js
import { EventEmitter } from 'events';
import { llmProvider } from './llmProvider.js';
import { chatStore } from './chatStore.js';
import { agentShellPool } from './agentShellPool.js';
import { autoResponder } from './autoResponder.js';

const AGENT_SYSTEM_PROMPT = `You are an autonomous coding agent inside a development IDE. You control shell sessions that run AI coding tools (Claude Code, GitHub Copilot, Aider, etc.).

Your job:
1. Receive a user task/request
2. Decide which tool to use and what prompt to send
3. Monitor the tool's output
4. Auto-respond to the tool's confirmation prompts (yes/no/continue)
5. Report progress and results back to the user

You communicate by returning JSON actions:

ACTIONS:
- {"action":"shell","tool":"claude","input":"the prompt to send"} — Send a prompt to a CLI tool
- {"action":"shell","tool":"shell","input":"npm test"} — Run a shell command
- {"action":"respond","input":"y"} — Respond to a tool's confirmation prompt
- {"action":"report","content":"Status update for the user","tasks":[{"title":"Step 1","status":"done"},{"title":"Step 2","status":"running"}]} — Send a progress update to the user
- {"action":"done","content":"Final summary of what was accomplished"} — Task complete
- {"action":"ask","content":"Question for the user"} — Need user input (ONLY when truly ambiguous)
- {"action":"plan","steps":[{"title":"Step 1","prompt":"..."},{"title":"Step 2","prompt":"..."}]} — Return a plan for user approval (plan mode only)

RULES:
- In agent mode: act autonomously, minimize questions, approve tool requests automatically
- In plan mode: return a plan first, wait for approval, then execute step by step
- Always approve safe operations (file edits, reads, git operations, installs)
- Only ask the user when genuinely ambiguous (multiple valid interpretations)
- Keep progress reports concise but informative
- Use the most appropriate tool for the task (claude for complex coding, shell for commands)

Respond with a single JSON action per turn. No markdown wrapping. Just the JSON object.`;

class AgentGateway extends EventEmitter {
  constructor() {
    super();
    this._running = new Map(); // projectId -> { aborted: boolean }
  }

  /**
   * Handle a user task from the chat.
   * This is the main entry point called by the WebSocket handler.
   */
  async handleTask({ projectId, content, mode, broadcastFn }) {
    // Cancel any existing task for this project
    this._abort(projectId);

    const ctx = { aborted: false };
    this._running.set(projectId, ctx);

    try {
      broadcastFn({ type: 'agent-status', projectId, busy: true });

      // Build context from recent chat history
      const recentMessages = chatStore.getMessages(projectId, { limit: 20 }).reverse();
      const chatContext = recentMessages
        .map(m => `[${m.role}]: ${m.content}`)
        .join('\n');

      const userPrompt = mode === 'plan'
        ? `MODE: PLAN\nThe user wants a plan before execution. Return a "plan" action with steps.\n\nChat context:\n${chatContext}\n\nUser request: ${content}`
        : `MODE: AGENT\nAct autonomously. Execute the task directly.\n\nChat context:\n${chatContext}\n\nUser request: ${content}`;

      // Agent loop — keeps running until done, ask, or error
      let iterations = 0;
      const MAX_ITERATIONS = 30;

      while (!ctx.aborted && iterations < MAX_ITERATIONS) {
        iterations++;

        const llmResponse = await llmProvider.generateResponse(userPrompt, {
          systemPrompt: AGENT_SYSTEM_PROMPT,
          maxTokens: 1000,
          temperature: 0.2,
        });

        if (ctx.aborted) break;

        let action;
        try {
          // Strip markdown code fences if present
          const cleaned = llmResponse.replace(/```json\n?|\n?```/g, '').trim();
          action = JSON.parse(cleaned);
        } catch {
          // LLM returned non-JSON — treat as a report
          this._addAgentMessage(projectId, llmResponse, broadcastFn);
          break;
        }

        switch (action.action) {
          case 'shell': {
            const { sessionId } = await agentShellPool.getSession(projectId, action.tool);

            // Send input to the shell
            const input = action.input.endsWith('\n') ? action.input : action.input + '\n';
            agentShellPool.write(sessionId, input);

            // Wait for output to settle (tool processing)
            const output = await this._waitForOutput(sessionId, ctx);
            if (ctx.aborted) break;

            // Check if the output contains a prompt that needs a response
            const promptMatch = autoResponder.detectPrompt(output, action.tool);
            if (promptMatch) {
              // Auto-respond
              const response = promptMatch.defaultResponse || 'y';
              agentShellPool.write(sessionId, response + '\n');
              await this._waitForOutput(sessionId, ctx, 3000);
            }

            // Report progress
            this._addProgressMessage(projectId, `Running ${action.tool}: ${action.input.slice(0, 100)}...`, broadcastFn);

            // Feed output back to LLM for next decision
            // (the next iteration of the loop will use updated context)
            break;
          }

          case 'respond': {
            // Find the active session and send the response
            for (const [, entry] of agentShellPool.sessions) {
              if (entry.projectId === projectId) {
                agentShellPool.write(entry.sessionId, action.input + '\n');
                break;
              }
            }
            await new Promise(r => setTimeout(r, 1000));
            break;
          }

          case 'report':
            this._addProgressMessage(projectId, action.content, broadcastFn, action.tasks);
            break;

          case 'plan':
            this._addAgentMessage(projectId,
              `**Proposed Plan:**\n\n${action.steps.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}\n\nApprove this plan to begin execution.`,
              broadcastFn,
              { plan: action.steps }
            );
            // Stop loop — wait for user approval
            this._running.delete(projectId);
            broadcastFn({ type: 'agent-status', projectId, busy: false });
            return;

          case 'ask':
            this._addAgentMessage(projectId, action.content, broadcastFn);
            // Stop loop — wait for user answer
            this._running.delete(projectId);
            broadcastFn({ type: 'agent-status', projectId, busy: false });
            return;

          case 'done':
            this._addAgentMessage(projectId, action.content, broadcastFn);
            this._running.delete(projectId);
            broadcastFn({ type: 'agent-status', projectId, busy: false });
            return;

          default:
            this._addAgentMessage(projectId, `Unknown action: ${action.action}`, broadcastFn);
            break;
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        this._addErrorMessage(projectId, 'Agent reached maximum iterations. Stopping.', broadcastFn);
      }
    } catch (error) {
      this._addErrorMessage(projectId, `Agent error: ${error.message}`, broadcastFn);
    } finally {
      this._running.delete(projectId);
      broadcastFn({ type: 'agent-status', projectId, busy: false });
    }
  }

  _abort(projectId) {
    const ctx = this._running.get(projectId);
    if (ctx) ctx.aborted = true;
    this._running.delete(projectId);
  }

  /**
   * Wait for shell output to settle (no new output for `quietMs`).
   */
  _waitForOutput(sessionId, ctx, quietMs = 5000) {
    return new Promise((resolve) => {
      let timeout;
      let output = '';
      const handler = ({ sessionId: sid, data }) => {
        if (sid !== sessionId || ctx.aborted) return;
        output += data;
        clearTimeout(timeout);
        timeout = setTimeout(() => {
          agentShellPool.removeListener('output', handler);
          resolve(output);
        }, quietMs);
      };
      agentShellPool.on('output', handler);
      // Initial timeout in case there's no output at all
      timeout = setTimeout(() => {
        agentShellPool.removeListener('output', handler);
        resolve(output);
      }, quietMs);
    });
  }

  _addAgentMessage(projectId, content, broadcastFn, metadata = null) {
    const msg = chatStore.addMessage({ projectId, role: 'agent', content, metadata });
    broadcastFn({ type: 'chat-message', message: msg });
  }

  _addProgressMessage(projectId, content, broadcastFn, tasks = null) {
    const msg = chatStore.addMessage({ projectId, role: 'progress', content, metadata: { tasks } });
    broadcastFn({ type: 'chat-progress', projectId, message: msg });
  }

  _addErrorMessage(projectId, content, broadcastFn) {
    const msg = chatStore.addMessage({ projectId, role: 'error', content });
    broadcastFn({ type: 'chat-message', message: msg });
  }
}

export const agentGateway = new AgentGateway();
export default agentGateway;
```

- [ ] **Step 2: Commit**

```bash
git add src/server/agentGateway.js
git commit -m "feat(agent): add AgentGateway with LLM-driven agent loop"
```

---

### Task 13: Wire Agent Gateway to WebSocket

**Files:**
- Modify: `src/server/terminalServer.js`

- [ ] **Step 1: Replace placeholder chat handler with real agent gateway**

In `terminalServer.js`, replace the `case 'chat-send'` handler from Task 9 with:

```javascript
case 'chat-send': {
  const { chatStore } = await import('./chatStore.js');
  const { agentGateway } = await import('./agentGateway.js');

  // Persist user message
  const userMsg = chatStore.addMessage({
    projectId: payload.projectId,
    role: 'user',
    content: payload.content,
    metadata: { mode: payload.mode },
  });
  this.broadcast({ type: 'chat-message', message: userMsg });

  // Dispatch to agent gateway (async — runs in background)
  agentGateway.handleTask({
    projectId: payload.projectId,
    content: payload.content,
    mode: payload.mode,
    broadcastFn: (data) => this.broadcast(data),
  }).catch(err => {
    const errMsg = chatStore.addMessage({
      projectId: payload.projectId,
      role: 'error',
      content: `Gateway error: ${err.message}`,
    });
    this.broadcast({ type: 'chat-message', message: errMsg });
  });
  break;
}
```

Also add a handler for agent shell output forwarding (for the internal console):

```javascript
case 'chat-stop': {
  // User wants to stop the current agent task
  const { agentGateway } = await import('./agentGateway.js');
  agentGateway._abort(payload.projectId);
  break;
}
```

- [ ] **Step 2: Forward agent shell output to the debug console**

In the PTY `data` event handler, after `agentShellPool.feedOutput(...)`, broadcast the raw output for the internal console:

```javascript
// Check if this is an agent session
const session = ptyManager.getSession(sessionId);
if (session?.role === 'agent') {
  this.broadcast({
    type: 'agent-shell-output',
    sessionId,
    data: coalesced,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/server/terminalServer.js
git commit -m "feat(agent): wire AgentGateway to chat WebSocket handler"
```

---

## Phase 4: Plan Mode & Context Intelligence

### Task 14: Context Compactor

**Files:**
- Create: `src/server/contextCompactor.js`

- [ ] **Step 1: Build the context compaction service**

When chat history grows too long for the LLM context window, older messages are summarized into a single compaction entry (OpenClaw pattern). The summary is generated by the local LLM.

```javascript
// src/server/contextCompactor.js
import { chatStore } from './chatStore.js';
import { llmProvider } from './llmProvider.js';

const COMPACTION_THRESHOLD = 40; // messages before compaction triggers
const KEEP_RECENT = 15; // always keep last N messages uncompacted

/**
 * Compacts old chat messages into a summary for a project.
 * Called before building context for the agent when message count is high.
 */
export async function compactContext(projectId) {
  const allMessages = chatStore.getMessages(projectId, { limit: 999 }).reverse();

  if (allMessages.length < COMPACTION_THRESHOLD) {
    return null; // No compaction needed
  }

  // Messages to summarize (everything except the most recent KEEP_RECENT)
  const toSummarize = allMessages.slice(0, -KEEP_RECENT);
  const toKeep = allMessages.slice(-KEEP_RECENT);

  // Check if already compacted (first message is a compaction entry)
  if (toSummarize.length === 1 && toSummarize[0].metadata?.isCompaction) {
    return null; // Already compacted
  }

  const conversationText = toSummarize
    .map(m => `[${m.role}] ${m.content.slice(0, 500)}`)
    .join('\n');

  const summary = await llmProvider.generateResponse(
    `Summarize this conversation history into a concise context paragraph. Include key decisions, code changes, bugs found, and current state of the project work. Be specific about file names, features, and outcomes.\n\n${conversationText}`,
    { maxTokens: 500, temperature: 0.1 }
  );

  return {
    summary,
    compactedCount: toSummarize.length,
    recentMessages: toKeep,
  };
}

/**
 * Build the context string for the agent, with compaction if needed.
 */
export async function buildAgentContext(projectId) {
  const messages = chatStore.getMessages(projectId, { limit: 60 }).reverse();

  if (messages.length >= COMPACTION_THRESHOLD) {
    const compaction = await compactContext(projectId);
    if (compaction) {
      const recentText = compaction.recentMessages
        .map(m => `[${m.role}]: ${m.content}`)
        .join('\n');
      return `[CONTEXT SUMMARY (${compaction.compactedCount} older messages)]\n${compaction.summary}\n\n[RECENT MESSAGES]\n${recentText}`;
    }
  }

  return messages.map(m => `[${m.role}]: ${m.content}`).join('\n');
}
```

- [ ] **Step 2: Wire into agentGateway**

In `src/server/agentGateway.js`, replace the inline context building with:

```javascript
import { buildAgentContext } from './contextCompactor.js';

// In handleTask, replace the chatContext building block:
const chatContext = await buildAgentContext(projectId);
```

- [ ] **Step 3: Commit**

```bash
git add src/server/contextCompactor.js src/server/agentGateway.js
git commit -m "feat(agent): add context compaction for long conversations"
```

---

### Task 15: Plan Mode Execution Flow

**Files:**
- Modify: `src/server/agentGateway.js`
- Modify: `src/client/src/components/ChatPanel.jsx`

- [ ] **Step 1: Add plan approval handling to the gateway**

In `agentGateway.js`, add a method to handle plan approval:

```javascript
/**
 * Execute an approved plan step by step.
 */
async executePlan({ projectId, steps, broadcastFn }) {
  const ctx = { aborted: false };
  this._running.set(projectId, ctx);

  try {
    broadcastFn({ type: 'agent-status', projectId, busy: true });

    for (let i = 0; i < steps.length && !ctx.aborted; i++) {
      const step = steps[i];

      // Report progress
      const tasks = steps.map((s, j) => ({
        title: s.title,
        status: j < i ? 'done' : j === i ? 'running' : 'pending',
      }));
      this._addProgressMessage(projectId, `Step ${i + 1}/${steps.length}: ${step.title}`, broadcastFn, tasks);

      // Execute the step
      await this.handleTask({
        projectId,
        content: step.prompt,
        mode: 'agent', // Execute each step in agent mode
        broadcastFn,
      });

      if (ctx.aborted) break;
    }

    if (!ctx.aborted) {
      const tasks = steps.map(s => ({ title: s.title, status: 'done' }));
      this._addProgressMessage(projectId, 'Plan completed successfully.', broadcastFn, tasks);
    }
  } catch (error) {
    this._addErrorMessage(projectId, `Plan execution failed: ${error.message}`, broadcastFn);
  } finally {
    this._running.delete(projectId);
    broadcastFn({ type: 'agent-status', projectId, busy: false });
  }
}
```

- [ ] **Step 2: Add plan approval WebSocket handler**

In `terminalServer.js`, add a new case:

```javascript
case 'chat-approve-plan': {
  const { agentGateway } = await import('./agentGateway.js');
  agentGateway.executePlan({
    projectId: payload.projectId,
    steps: payload.steps,
    broadcastFn: (data) => this.broadcast(data),
  }).catch(console.error);
  break;
}
```

- [ ] **Step 3: Add plan approval button in ChatPanel**

In `ChatPanel.jsx`, when a message has `metadata.plan`, render an "Approve & Execute" button:

```jsx
// Inside ChatMessage.jsx, after the tasks block:
{message.metadata?.plan && (
  <button
    onClick={() => {
      if (wsRef?.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'chat-approve-plan',
          projectId: message.projectId,
          steps: message.metadata.plan,
        }));
      }
    }}
    className="mt-2 px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded-md"
  >
    Approve & Execute Plan
  </button>
)}
```

Note: the `wsRef` prop needs to be threaded through from ChatPanel to ChatMessage. Add it as a prop: `<ChatMessage key={msg.id} message={msg} wsRef={wsRef} />` and update ChatMessage's signature accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/server/agentGateway.js src/server/terminalServer.js src/client/src/components/ChatPanel.jsx src/client/src/components/ChatMessage.jsx
git commit -m "feat(agent): add plan mode with approval flow and step-by-step execution"
```

---

### Task 16: Cross-Session Context Memory

**Files:**
- Modify: `src/server/agentGateway.js`

- [ ] **Step 1: Add context extraction and injection**

After each agent task completes, ask the LLM to extract key learnings into a context summary that gets stored. This context is loaded at the start of each new task, making the agent "remember" across sessions.

In `agentGateway.js`, add after the `done` action handling:

```javascript
// After a successful task completion, extract context for future sessions
try {
  const recentOutput = [];
  for (const [, entry] of agentShellPool.sessions) {
    if (entry.projectId === projectId) {
      recentOutput.push(agentShellPool.getRecentOutput(entry.sessionId));
    }
  }

  const contextExtract = await llmProvider.generateResponse(
    `Extract key technical context from this completed task that would be useful for future tasks on this project. Include: file paths changed, architecture decisions, bugs found, patterns used, dependencies. Be concise (2-3 paragraphs max).\n\nTask: ${content}\n\nTool output summary: ${recentOutput.join('\n').slice(-3000)}`,
    { maxTokens: 300, temperature: 0.1 }
  );

  // Store as a system message (invisible to user but available for context)
  chatStore.addMessage({
    projectId,
    role: 'system',
    content: contextExtract,
    metadata: { isContextMemory: true },
  });
} catch {
  // Non-critical — don't fail the task if context extraction fails
}
```

- [ ] **Step 2: Include context memories in agent prompt**

In the `handleTask` method, when building `chatContext`, filter to include system context memories:

```javascript
// In buildAgentContext or handleTask context building:
const contextMemories = chatStore.search(projectId, '')
  .filter(m => m.metadata?.isContextMemory)
  .slice(-3) // Last 3 context memories
  .map(m => m.content)
  .join('\n\n');

const contextPrefix = contextMemories
  ? `[PROJECT CONTEXT MEMORY]\n${contextMemories}\n\n`
  : '';
```

Prepend this to the `userPrompt` passed to the LLM.

- [ ] **Step 3: Commit**

```bash
git add src/server/agentGateway.js
git commit -m "feat(agent): add cross-session context memory extraction and injection"
```

---

## Summary of Preserved Infrastructure

The following systems remain **unchanged** and continue working:

| System | Status | Notes |
|--------|--------|-------|
| Docker containers | Preserved | agentShellPool uses containerManager as-is |
| PTY manager | Preserved | Shell pool calls ptyManager.createSession() |
| Project CRUD | Preserved | Models, routes, ProjectContext all unchanged |
| LLM provider | Preserved | Used by agentGateway instead of direct terminal |
| Auto-responder patterns | Preserved | Used by agentGateway.detectPrompt() |
| Session history | Preserved | PTY sessions still save scrollback |
| Left sidebar | Preserved | ProjectManagerPanel stays as project navigator |
| Right panel | Preserved | LiveAnalysis, Scheduler, Skills still work |
| Safety system | Preserved | Risk assessment available to agent |
| Activity feed | Preserved | Agent can log activities |
| Prompt history | Preserved | Old prompts still accessible |
| Git manager | Preserved | Available for agent git operations |

---

## Migration Notes

1. **The dual-terminal UI is removed, not deprecated.** Users interact through chat only. The InternalConsole is opt-in for debugging.

2. **Existing terminal sessions (user-facing)** are replaced by agent-managed sessions. The `role: 'agent'` sessions use the same PTY + dtach infrastructure but aren't displayed directly.

3. **The orchestrator** (`orchestrator.js`) is superseded by agentGateway's plan execution but doesn't need to be deleted — it can remain for backward compatibility with any API consumers.

4. **TopBar** becomes a thin status bar. The prompt input, mode toggle, and search are all in ChatPanel now.

5. **Data migration**: No schema changes needed. Chat data is new (JSONL files). Old prompt history remains in LowDB.
