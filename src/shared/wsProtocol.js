/**
 * Small, backwards-compatible protocol primitives shared by the terminal
 * server and browser client. The legacy top-level `type` field intentionally
 * remains part of every envelope so older panels can keep consuming events.
 */

export const WS_PROTOCOL_NAME = 'startupp-ide-terminal';
export const WS_PROTOCOL_VERSION = 1;

const REQUEST_TYPES = new Set([
  'hello', 'protocol-hello', 'reconcile', 'run-observe',
  'chat-send', 'chat-shell-send', 'chat-stop', 'chat-steer', 'chat-approve-plan',
  'orchestrator-start', 'orchestrator-pause', 'orchestrator-resume',
  'orchestrator-stop', 'orchestrator-approve', 'orchestrator-skip',
  'rename-session', 'kill-session', 'create-session', 'input', 'resize',
  'set-auto-responder', 'send-response', 'run-approve', 'run-reject',
]);

const SIDE_EFFECTING_TYPES = new Set([
  'chat-send', 'chat-shell-send', 'chat-stop', 'chat-steer', 'chat-approve-plan',
  'orchestrator-start', 'orchestrator-pause', 'orchestrator-resume',
  'orchestrator-stop', 'orchestrator-approve', 'orchestrator-skip',
  'rename-session', 'kill-session', 'create-session', 'input', 'resize',
  'set-auto-responder', 'send-response', 'run-approve', 'run-reject',
]);

export function isSideEffectingRequest(type) {
  return SIDE_EFFECTING_TYPES.has(String(type || ''));
}

export function createRequest(type, payload = {}, { requestId = null, idempotencyKey = null } = {}) {
  return {
    kind: 'request',
    protocol: WS_PROTOCOL_NAME,
    protocolVersion: WS_PROTOCOL_VERSION,
    type,
    requestId,
    idempotencyKey,
    payload,
  };
}

export function normalizeRequest(message) {
  const input = message && typeof message === 'object' ? message : {};
  const isEnvelope = input.kind === 'request' || input.protocol === WS_PROTOCOL_NAME;
  const payload = isEnvelope && input.payload && typeof input.payload === 'object'
    ? { ...input.payload }
    : { ...input };

  return {
    type: input.type,
    payload,
    requestId: typeof input.requestId === 'string' ? input.requestId : null,
    idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : null,
    protocolVersion: input.protocolVersion || null,
    enveloped: isEnvelope,
  };
}

export function createResponse(type, payload = {}, { requestId = null, status = 'ok' } = {}) {
  return {
    kind: 'response',
    protocol: WS_PROTOCOL_NAME,
    protocolVersion: WS_PROTOCOL_VERSION,
    type,
    status,
    requestId,
    ...payload,
  };
}

export function createHello({ serverCapabilities = [], stateVersion = 0, eventSeq = 0 } = {}) {
  return {
    kind: 'event',
    protocol: WS_PROTOCOL_NAME,
    protocolVersion: WS_PROTOCOL_VERSION,
    type: 'hello',
    serverCapabilities,
    stateVersion,
    seq: eventSeq,
    acceptedMessageTypes: [...REQUEST_TYPES],
  };
}

export function createEvent(message, { seq = 0, stateVersion = 0, scope = null, scopeVersion = 0 } = {}) {
  return {
    ...message,
    kind: 'event',
    protocol: WS_PROTOCOL_NAME,
    protocolVersion: WS_PROTOCOL_VERSION,
    seq,
    stateVersion,
    scopeVersion,
    scope: scope || undefined,
  };
}

export function isProtocolEvent(message) {
  return message?.kind === 'event' && message?.protocol === WS_PROTOCOL_NAME;
}

export class ProtocolState {
  constructor({ maxEvents = 500 } = {}) {
    this.maxEvents = maxEvents;
    this.seq = 0;
    this.stateVersion = 0;
    this.events = [];
    this.scopedVersions = new Map();
  }

  nextEvent(message, scope = null) {
    this.seq += 1;
    this.stateVersion += 1;
    if (scope) this.scopedVersions.set(scope, (this.scopedVersions.get(scope) || 0) + 1);
    const scopeVersion = scope ? this.scopedVersions.get(scope) : 0;
    const event = createEvent(message, { seq: this.seq, stateVersion: this.stateVersion, scope, scopeVersion });
    this.events.push(event);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
    return event;
  }

  replaySince(lastSeq) {
    const requested = Number.isFinite(Number(lastSeq)) ? Number(lastSeq) : 0;
    const oldest = this.events[0]?.seq || this.seq + 1;
    if (requested < oldest - 1) return { complete: false, events: [] };
    return { complete: true, events: this.events.filter(event => event.seq > requested) };
  }

  snapshot() {
    return { eventSeq: this.seq, stateVersion: this.stateVersion };
  }
}
