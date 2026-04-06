// src/server/models/ChatMessage.js
import { v4 as uuidv4 } from 'uuid';

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

export function serialize(msg) {
  return JSON.stringify(msg);
}

export function deserialize(line) {
  if (!line || !line.trim()) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
