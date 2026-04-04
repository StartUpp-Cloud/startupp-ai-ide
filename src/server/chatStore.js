// src/server/chatStore.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createMessage, serialize, deserialize } from './models/ChatMessage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHAT_DIR = path.join(__dirname, '../../data/chat');

if (!fs.existsSync(CHAT_DIR)) {
  fs.mkdirSync(CHAT_DIR, { recursive: true });
}

class ChatStore {
  _filePath(projectId) {
    return path.join(CHAT_DIR, `${projectId}.jsonl`);
  }

  addMessage({ projectId, role, content, metadata }) {
    const msg = createMessage({ projectId, role, content, metadata });
    const line = serialize(msg) + '\n';
    fs.appendFileSync(this._filePath(projectId), line, 'utf-8');
    return msg;
  }

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

    return messages.slice(-limit).reverse();
  }

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

  getCount(projectId) {
    const filePath = this._filePath(projectId);
    if (!fs.existsSync(filePath)) return 0;
    return fs.readFileSync(filePath, 'utf-8').split('\n').filter(l => l.trim()).length;
  }

  getAllMessages(projectId) {
    return this.getMessages(projectId, { limit: Infinity });
  }

  deleteProject(projectId) {
    const filePath = this._filePath(projectId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export const chatStore = new ChatStore();
export default chatStore;
