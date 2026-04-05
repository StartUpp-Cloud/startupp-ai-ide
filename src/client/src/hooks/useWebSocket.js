/**
 * useWebSocket - Robust WebSocket connection manager with auto-recovery.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Visibility-based reconnection (reconnects when tab becomes visible)
 * - Heartbeat/ping-pong health monitoring
 * - Connection status tracking
 * - Project switch detection with immediate reconnection
 *
 * Usage:
 *   const { ws, status, isConnected } = useWebSocket('/ws/terminal', {
 *     onMessage: (msg) => handleMessage(msg),
 *     onStatusChange: (status) => console.log('Status:', status),
 *   });
 */

import { useEffect, useRef, useState, useCallback } from 'react';

// Connection states
export const WS_STATUS = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
};

// Default configuration
const DEFAULT_CONFIG = {
  // Reconnection settings
  reconnectMinDelay: 1000,      // Start with 1 second
  reconnectMaxDelay: 30000,     // Max 30 seconds
  reconnectBackoffMultiplier: 1.5,
  maxReconnectAttempts: Infinity, // Never give up

  // Heartbeat settings
  heartbeatInterval: 25000,     // Send ping every 25 seconds
  heartbeatTimeout: 60000,      // Consider dead after 60 seconds without response

  // Visibility settings
  reconnectOnVisible: true,     // Reconnect when tab becomes visible
  checkOnFocus: true,           // Check connection when window gains focus
};

/**
 * Build WebSocket URL from path
 */
function buildWsUrl(path) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}

/**
 * Main WebSocket hook with robust reconnection and health monitoring
 */
export function useWebSocket(path, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };

  const wsRef = useRef(null);
  const mountedRef = useRef(true);
  const reconnectTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const reconnectAttemptsRef = useRef(0);
  const currentDelayRef = useRef(config.reconnectMinDelay);
  const isReconnectingRef = useRef(false);
  const wasConnectedRef = useRef(false);

  const [status, setStatus] = useState(WS_STATUS.DISCONNECTED);
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // Update status and notify callback
  const updateStatus = useCallback((newStatus) => {
    setStatus(newStatus);
    setIsConnected(newStatus === WS_STATUS.CONNECTED);
    config.onStatusChange?.(newStatus);
  }, [config.onStatusChange]);

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  // Start heartbeat monitoring
  const startHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
    }

    heartbeatTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      const timeSinceActivity = Date.now() - lastActivityRef.current;

      // Check for stale connection
      if (timeSinceActivity > config.heartbeatTimeout) {
        console.warn(`[WebSocket] No activity for ${Math.round(timeSinceActivity / 1000)}s - reconnecting`);
        ws.close(4000, 'Heartbeat timeout');
        return;
      }

      // Send ping
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch (err) {
        console.warn('[WebSocket] Failed to send ping:', err);
      }
    }, config.heartbeatInterval);
  }, [config.heartbeatInterval, config.heartbeatTimeout]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    // Don't connect if already connected or connecting
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      return;
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Clean up existing connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    const isReconnect = wasConnectedRef.current;
    updateStatus(isReconnect ? WS_STATUS.RECONNECTING : WS_STATUS.CONNECTING);

    const wsUrl = buildWsUrl(path);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }

      console.log('[WebSocket] Connected');
      wsRef.current = ws;
      wasConnectedRef.current = true;
      lastActivityRef.current = Date.now();

      // Reset reconnection state
      reconnectAttemptsRef.current = 0;
      currentDelayRef.current = config.reconnectMinDelay;
      isReconnectingRef.current = false;
      setReconnectAttempt(0);

      updateStatus(WS_STATUS.CONNECTED);
      startHeartbeat();

      // Notify connection established
      config.onConnect?.();
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;

      lastActivityRef.current = Date.now();

      try {
        const msg = JSON.parse(event.data);

        // Handle pong internally (don't pass to handler)
        if (msg.type === 'pong') return;

        config.onMessage?.(msg, ws);
      } catch (err) {
        console.warn('[WebSocket] Failed to parse message:', err);
      }
    };

    ws.onclose = (event) => {
      if (!mountedRef.current) return;

      console.log(`[WebSocket] Closed (code: ${event.code}, reason: ${event.reason || 'none'})`);
      wsRef.current = null;
      clearTimers();

      // Only auto-reconnect if:
      // 1. We were previously connected (not initial connection failure)
      // 2. Or this is a reconnection attempt
      // 3. And we haven't exceeded max attempts
      const shouldReconnect = wasConnectedRef.current || isReconnectingRef.current;

      if (shouldReconnect && reconnectAttemptsRef.current < config.maxReconnectAttempts) {
        scheduleReconnect();
      } else {
        updateStatus(WS_STATUS.DISCONNECTED);
      }
    };

    ws.onerror = (error) => {
      console.warn('[WebSocket] Error:', error);
      updateStatus(WS_STATUS.ERROR);
      // onclose will fire after this
    };
  }, [path, config, updateStatus, startHeartbeat, clearTimers]);

  // Schedule reconnection with exponential backoff
  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) return; // Already scheduled

    isReconnectingRef.current = true;
    reconnectAttemptsRef.current++;
    setReconnectAttempt(reconnectAttemptsRef.current);

    const delay = currentDelayRef.current;
    console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);

    updateStatus(WS_STATUS.RECONNECTING);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;

      // Increase delay for next attempt (exponential backoff)
      currentDelayRef.current = Math.min(
        currentDelayRef.current * config.reconnectBackoffMultiplier,
        config.reconnectMaxDelay
      );

      connect();
    }, delay);
  }, [config.reconnectBackoffMultiplier, config.reconnectMaxDelay, connect, updateStatus]);

  // Force reconnect (resets backoff)
  const forceReconnect = useCallback(() => {
    console.log('[WebSocket] Force reconnecting');
    clearTimers();

    // Reset backoff
    reconnectAttemptsRef.current = 0;
    currentDelayRef.current = config.reconnectMinDelay;
    isReconnectingRef.current = false;

    // Close existing connection
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }

    // Connect immediately
    connect();
  }, [clearTimers, config.reconnectMinDelay, connect]);

  // Check connection health and reconnect if needed
  const checkConnection = useCallback(() => {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[WebSocket] Connection check failed - reconnecting');
      forceReconnect();
      return false;
    }

    // Also check if we haven't received anything in a while
    const timeSinceActivity = Date.now() - lastActivityRef.current;
    if (timeSinceActivity > config.heartbeatTimeout) {
      console.log('[WebSocket] Connection stale - reconnecting');
      forceReconnect();
      return false;
    }

    return true;
  }, [config.heartbeatTimeout, forceReconnect]);

  // Send message helper
  const send = useCallback((data) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Cannot send - not connected');
      return false;
    }

    try {
      ws.send(typeof data === 'string' ? data : JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('[WebSocket] Send failed:', err);
      return false;
    }
  }, []);

  // Visibility change handler
  useEffect(() => {
    if (!config.reconnectOnVisible) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[WebSocket] Tab became visible - checking connection');

        // Small delay to let the browser settle
        setTimeout(() => {
          if (!mountedRef.current) return;
          checkConnection();
        }, 100);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [config.reconnectOnVisible, checkConnection]);

  // Window focus handler
  useEffect(() => {
    if (!config.checkOnFocus) return;

    const handleFocus = () => {
      console.log('[WebSocket] Window focused - checking connection');
      // Delay to avoid rapid checks
      setTimeout(() => {
        if (!mountedRef.current) return;
        checkConnection();
      }, 200);
    };

    window.addEventListener('focus', handleFocus);

    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [config.checkOnFocus, checkConnection]);

  // Initial connection
  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      clearTimers();

      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Component unmounted');
        } catch {}
        wsRef.current = null;
      }
    };
  }, [path]); // Only reconnect if path changes

  return {
    ws: wsRef.current,
    wsRef,
    status,
    isConnected,
    reconnectAttempt,
    send,
    forceReconnect,
    checkConnection,
  };
}

/**
 * Shared WebSocket instance for IDE-wide use.
 * This ensures only one WebSocket connection is used across all components.
 */
let sharedWsInstance = null;
let sharedWsListeners = new Set();
let sharedWsStatus = WS_STATUS.DISCONNECTED;

/**
 * Create/get shared WebSocket connection for the IDE
 */
export function getSharedWebSocket(path = '/ws/terminal') {
  if (sharedWsInstance && sharedWsInstance.readyState === WebSocket.OPEN) {
    return sharedWsInstance;
  }
  return null;
}

/**
 * Hook to access the shared IDE WebSocket
 * This is for components that need to share a single connection (IDE.jsx, ChatPanel, etc.)
 */
export function useSharedWebSocket() {
  const [status, setStatus] = useState(sharedWsStatus);

  useEffect(() => {
    const listener = (newStatus) => setStatus(newStatus);
    sharedWsListeners.add(listener);
    return () => sharedWsListeners.delete(listener);
  }, []);

  return {
    ws: sharedWsInstance,
    status,
    isConnected: status === WS_STATUS.CONNECTED,
  };
}

export default useWebSocket;
