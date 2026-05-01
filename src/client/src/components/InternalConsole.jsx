import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ChevronDown, ChevronUp, Terminal as TerminalIcon, Sparkles, Loader, GripHorizontal, Share2, RotateCcw } from 'lucide-react';
import { stripTerminalQueryResponses } from '../utils/terminalControlFilter';
import '@xterm/xterm/css/xterm.css';

// WebSocket reconnection configuration
const WS_CONFIG = {
  reconnectMinDelay: 1000,
  reconnectMaxDelay: 30000,
  reconnectBackoffMultiplier: 1.5,
  heartbeatInterval: 25000,
  heartbeatTimeout: 60000,
};

const MIN_HEIGHT = 80;
const MAX_HEIGHT = 800;
const DEFAULT_HEIGHT = 180;

const QUICK_COMMANDS = [
  { label: 'Quick commands...', command: '' },
  { label: 'Login to GitHub', command: 'gh auth login --hostname github.com --git-protocol https --web' },
  { label: 'GitHub auth status', command: 'gh auth status' },
  { label: 'Install Claude Code', command: 'npm install -g @anthropic-ai/claude-code' },
  { label: 'Install OpenCode', command: 'npm install -g opencode-ai' },
  { label: 'Install GitHub Copilot extension', command: 'gh extension install github/gh-copilot' },
  { label: 'Install Salesforce CLI', command: 'npm install -g @salesforce/cli' },
  { label: 'Login to Salesforce', command: 'sf org login web' },
  { label: 'Install pnpm', command: 'npm install -g pnpm' },
  { label: 'Install Aider', command: 'pip3 install --user aider-chat' },
  { label: 'Check tool versions', command: 'node -v && npm -v && gh --version && claude --version 2>/dev/null || true && opencode --version 2>/dev/null || true && sf --version 2>/dev/null || true' },
];

function stripTerminalControls(data = '') {
  return String(data)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\x1b[78]/g, '');
}

function detectYesNoPrompt(data) {
  const clean = stripTerminalControls(data);
  const lines = clean.split(/[\r\n]+/).map(line => line.trim()).filter(Boolean);
  const lastLine = lines[lines.length - 1] || '';

  if (/[?:].*(?:\(|\[)[Yy]\/[Nn](?:\)|\])\s*$/.test(lastLine)) {
    return lastLine.slice(-180);
  }

  return null;
}

function getStoredHeight() {
  try {
    const v = parseInt(localStorage.getItem('internalConsoleHeight'), 10);
    if (v >= MIN_HEIGHT && v <= MAX_HEIGHT) return v;
  } catch {}
  return DEFAULT_HEIGHT;
}

/**
 * InternalConsole — a real interactive shell terminal for the selected project.
 * Opens its own WebSocket + PTY session independently from the chat system.
 * Includes visibility-aware reconnection for stability and a drag-to-resize handle.
 */
export default function InternalConsole({ projectId, chatWsRef, activeChatSessionId }) {
  const [open, setOpen] = useState(true);
  const [connected, setConnected] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(getStoredHeight);
  const [shareStatus, setShareStatus] = useState(null); // null | 'sending' | 'sent'
  const [sessionResetKey, setSessionResetKey] = useState(0);
  const [restarting, setRestarting] = useState(false);
  const [promptAction, setPromptAction] = useState(null);
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const sessionIdRef = useRef(null);
  const prevProjectIdRef = useRef(null);
  const mountedRef = useRef(true);
  const forceNewSessionRef = useRef(false);
  const promptResponseFallbackRef = useRef(null);

  /**
   * Capture the visible terminal buffer text (last N lines).
   */
  const captureTerminalOutput = useCallback((maxLines = 200) => {
    const xterm = xtermRef.current;
    if (!xterm) return '';

    const buffer = xterm.buffer.active;
    const totalRows = buffer.length;
    const startRow = Math.max(0, totalRows - maxLines);
    const lines = [];

    for (let i = startRow; i < totalRows; i++) {
      const line = buffer.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }

    // Trim trailing empty lines
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    return lines.join('\n');
  }, []);

  /**
   * Share terminal output to the active chat session.
   */
  const handleShareToAgent = useCallback(() => {
    const ws = chatWsRef?.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !projectId || !activeChatSessionId) return;

    const content = captureTerminalOutput();
    if (!content.trim()) return;

    setShareStatus('sending');
    ws.send(JSON.stringify({
      type: 'chat-share-terminal',
      projectId,
      sessionId: activeChatSessionId,
      content,
    }));

    setShareStatus('sent');
    setTimeout(() => setShareStatus(null), 2000);
  }, [chatWsRef, projectId, activeChatSessionId, captureTerminalOutput]);

  const handleRestartConsole = useCallback((e) => {
    e?.stopPropagation();
    if (!projectId || restarting) return;

    forceNewSessionRef.current = true;
    setRestarting(true);
    setConnected(false);

    const ws = wsRef.current;
    const sessionId = sessionIdRef.current;
    if (ws?.readyState === WebSocket.OPEN && sessionId) {
      try { ws.send(JSON.stringify({ type: 'kill-session', sessionId })); } catch {}
    }

    try { ws?.close(); } catch {}
    try { xtermRef.current?.clear(); } catch {}
    prevProjectIdRef.current = null;
    sessionIdRef.current = null;
    if (promptResponseFallbackRef.current) {
      clearTimeout(promptResponseFallbackRef.current);
      promptResponseFallbackRef.current = null;
    }
    setPromptAction(null);
    setSessionResetKey((key) => key + 1);
  }, [projectId, restarting]);

  const sendPromptResponse = useCallback((response, action = null) => {
    const targetSessionId = action?.sessionId || sessionIdRef.current;
    const ws = wsRef.current;
    if (!targetSessionId || ws?.readyState !== WebSocket.OPEN) return;

    const promptText = action?.text || '';

    ws.send(JSON.stringify({
      type: 'send-response',
      sessionId: targetSessionId,
      response,
      promptText,
    }));

    if (promptResponseFallbackRef.current) clearTimeout(promptResponseFallbackRef.current);
    promptResponseFallbackRef.current = setTimeout(() => {
      promptResponseFallbackRef.current = null;
      if (wsRef.current?.readyState !== WebSocket.OPEN) return;

      const defaultYes = /(?:\(|\[)Y\/n(?:\)|\])\s*$/i.test(promptText);
      const data = response === 'y' && defaultYes ? '\r' : `${response}\r`;
      wsRef.current.send(JSON.stringify({ type: 'input', sessionId: targetSessionId, data }));
    }, 250);

    setPromptAction(null);
    xtermRef.current?.focus();
  }, []);

  // Drag-to-resize state
  const dragRef = useRef({ active: false, startY: 0, startHeight: 0 });

  const handleResizeMouseDown = useCallback((e) => {
    e.preventDefault();
    dragRef.current = { active: true, startY: e.clientY, startHeight: consoleHeight };

    const onMouseMove = (moveEvent) => {
      if (!dragRef.current.active) return;
      // Dragging up increases height (console grows upward)
      const delta = dragRef.current.startY - moveEvent.clientY;
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragRef.current.startHeight + delta));
      setConsoleHeight(newHeight);
      // Refit xterm during drag for live feedback
      try { fitRef.current?.fit(); } catch {}
    };

    const onMouseUp = () => {
      dragRef.current.active = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Persist and final fit
      setConsoleHeight(h => {
        try { localStorage.setItem('internalConsoleHeight', String(h)); } catch {}
        return h;
      });
      setTimeout(() => { try { fitRef.current?.fit(); } catch {} }, 50);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [consoleHeight]);

  // Create xterm + WS + session when opened
  useEffect(() => {
    if (!open || !projectId || !termRef.current) return;

    // Avoid re-init if same project and already connected
    if (xtermRef.current && prevProjectIdRef.current === projectId && wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    // Clean up previous
    if (xtermRef.current) { xtermRef.current.dispose(); xtermRef.current = null; }
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
    sessionIdRef.current = null;
    prevProjectIdRef.current = projectId;
    mountedRef.current = true;

    // Create xterm
    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 11,
      scrollback: 5000,
      fontFamily: '"JetBrains Mono", "Fira Code", Menlo, Monaco, monospace',
      theme: { background: '#0d1117', foreground: '#c9d1d9', cursor: '#c9d1d9' },
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(termRef.current);
    fit.fit();
    xtermRef.current = xterm;
    fitRef.current = fit;

    // WebSocket connection state
    let reconnectTimer = null;
    let heartbeatInterval = null;
    let lastPong = Date.now();
    let reconnectDelay = WS_CONFIG.reconnectMinDelay;
    let wasConnected = false;

    // Connect WebSocket
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal`;

    const connect = () => {
      if (!mountedRef.current) return;

      // Don't connect if already connected or connecting
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
      if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }

        setConnected(true);
        wasConnected = true;
        lastPong = Date.now();
        reconnectDelay = WS_CONFIG.reconnectMinDelay;

        // Create a session for this project
        ws.send(JSON.stringify({
          type: 'create-session',
          projectId,
          role: 'utility',
          cliTool: null,
          cols: xterm.cols || 120,
          rows: xterm.rows || 12,
          forceNew: forceNewSessionRef.current,
        }));
        forceNewSessionRef.current = false;

        // Start heartbeat
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;

          if (Date.now() - lastPong > WS_CONFIG.heartbeatTimeout) {
            console.warn('[InternalConsole] WebSocket heartbeat timeout — reconnecting');
            ws.close(4000, 'Heartbeat timeout');
            return;
          }

          try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
        }, WS_CONFIG.heartbeatInterval);
      };

      ws.onmessage = (event) => {
        if (!mountedRef.current) return;
        lastPong = Date.now();
        const msg = JSON.parse(event.data);

        if (msg.type === 'session-created' && !sessionIdRef.current) {
          sessionIdRef.current = msg.sessionId;
          setRestarting(false);
          // Attach
          ws.send(JSON.stringify({ type: 'attach', sessionId: msg.sessionId }));
        }

        if (msg.type === 'error') {
          setRestarting(false);
        }

        if (msg.type === 'output' && msg.sessionId === sessionIdRef.current) {
          xterm.write(msg.data);
          const promptText = detectYesNoPrompt(msg.data);
          if (promptText) {
            setPromptAction({ text: promptText, responses: ['y', 'n'], sessionId: msg.sessionId });
          }
        }

        if (msg.type === 'prompt-detected' && msg.sessionId === sessionIdRef.current) {
          const responses = msg.responses || [];
          const matchedText = msg.matchedText || '';
          const isYesNoPrompt = responses.includes('y') && responses.includes('n')
            || /(?:\(|\[)[Yy]\/[Nn](?:\)|\])/.test(matchedText);

          if (isYesNoPrompt) {
            setPromptAction({
              text: stripTerminalControls(matchedText).trim().slice(-180),
              responses: ['y', 'n'],
              sessionId: msg.sessionId,
            });
          }
        }

        if (msg.type === 'response-sent' || msg.type === 'auto-response-sent') {
          if (promptResponseFallbackRef.current) {
            clearTimeout(promptResponseFallbackRef.current);
            promptResponseFallbackRef.current = null;
          }
          setPromptAction(null);
        }
      };

      ws.onclose = (event) => {
        if (!mountedRef.current) return;
        setConnected(false);
        wsRef.current = null;
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }

        // Auto-reconnect if we were previously connected
        if (wasConnected) {
          console.log(`[InternalConsole] WebSocket closed (code: ${event.code}) - reconnecting in ${reconnectDelay}ms`);
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            reconnectDelay = Math.min(reconnectDelay * WS_CONFIG.reconnectBackoffMultiplier, WS_CONFIG.reconnectMaxDelay);
            connect();
          }, reconnectDelay);
        }
      };

      ws.onerror = () => {
        setConnected(false);
        setRestarting(false);
      };
    };

    // Check connection health
    const checkConnection = () => {
      if (!mountedRef.current) return;

      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.log('[InternalConsole] Connection check failed - reconnecting');
        reconnectDelay = WS_CONFIG.reconnectMinDelay;
        connect();
        return;
      }

      // Check if connection is stale
      const timeSinceActivity = Date.now() - lastPong;
      if (timeSinceActivity > WS_CONFIG.heartbeatTimeout) {
        console.log('[InternalConsole] Connection stale - reconnecting');
        ws.close(4000, 'Stale connection');
      }
    };

    // Visibility change handler
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[InternalConsole] Tab became visible - checking connection');
        setTimeout(checkConnection, 100);
      }
    };

    // Window focus handler
    const handleFocus = () => {
      console.log('[InternalConsole] Window focused - checking connection');
      setTimeout(checkConnection, 200);
    };

    // Add visibility and focus listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);

    connect();

    // Forward keyboard input, filtering terminal query responses emitted by xterm itself.
    let inputBuf = '';
    let inputTimer = null;

    xterm.onData((data) => {
      if (!sessionIdRef.current) return;
      inputBuf += data;

      if (inputTimer) clearTimeout(inputTimer);
      inputTimer = setTimeout(() => {
        const cleaned = stripTerminalQueryResponses(inputBuf);
        inputBuf = '';

        const wsReady = wsRef.current?.readyState === WebSocket.OPEN;
        if (!cleaned || !wsReady) return;
        wsRef.current.send(JSON.stringify({ type: 'input', sessionId: sessionIdRef.current, data: cleaned }));
        if (cleaned.includes('\r') || cleaned.includes('\n') || /^[YyNn]$/.test(cleaned)) {
          setPromptAction(null);
        }
      }, 3);
    });

    // Forward resize
    xterm.onResize(({ cols, rows }) => {
      if (sessionIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'resize', sessionId: sessionIdRef.current, cols, rows }));
      }
    });

    // Refit on window resize
    const resizeHandler = () => fit.fit();
    window.addEventListener('resize', resizeHandler);

    return () => {
      mountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('resize', resizeHandler);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (inputTimer) clearTimeout(inputTimer);
      if (promptResponseFallbackRef.current) {
        clearTimeout(promptResponseFallbackRef.current);
        promptResponseFallbackRef.current = null;
      }
      xterm.dispose();
      xtermRef.current = null;
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.close();
      wsRef.current = null;
      sessionIdRef.current = null;
    };
  }, [open, projectId, sessionResetKey]);

  // Refit xterm when height changes (after drag)
  useEffect(() => {
    if (open && fitRef.current) {
      try { fitRef.current.fit(); } catch {}
    }
  }, [consoleHeight, open]);

  return (
    <div className="border-t border-surface-700 flex-shrink-0">
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs transition-colors ${
          open
            ? 'text-surface-500 hover:text-surface-200 bg-surface-850/50'
            : 'text-surface-300 hover:text-surface-100 bg-surface-800 hover:bg-surface-750'
        }`}
      >
        <TerminalIcon size={open ? 12 : 14} className={open ? '' : 'text-primary-400'} />
        Internal Console
        {open && (
          <div
            className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}
            title={connected ? 'Connected' : restarting ? 'Restarting...' : 'Connecting...'}
          />
        )}
        <span className="flex-1" />
        {open && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleRestartConsole}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleRestartConsole(e);
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-surface-400 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
            title="Terminate this bottom console and start a fresh session"
          >
            <RotateCcw size={10} className={restarting ? 'animate-spin' : ''} />
            {restarting ? 'Restarting...' : 'New session'}
          </span>
        )}
        {open ? <ChevronDown size={12} /> : <ChevronUp size={14} className="text-primary-400" />}
      </button>
      {open && connected && activeChatSessionId && (
        <button
          onClick={(e) => { e.stopPropagation(); handleShareToAgent(); }}
          disabled={shareStatus === 'sending'}
          className={`flex items-center gap-1 px-2 py-1 text-[10px] transition-colors border-b border-surface-700/50 ${
            shareStatus === 'sent'
              ? 'text-green-400 bg-green-500/10'
              : 'text-surface-400 hover:text-primary-300 hover:bg-surface-800 bg-surface-850/50'
          }`}
          title="Share terminal output with the AI agent"
        >
          <Share2 size={10} />
          {shareStatus === 'sent' ? 'Shared!' : 'Share to Agent'}
        </button>
      )}

      {open && (
        <>
          {/* Drag-to-resize handle */}
          <div
            onMouseDown={handleResizeMouseDown}
            className="flex items-center justify-center h-2 bg-surface-800 hover:bg-surface-700 cursor-ns-resize border-b border-surface-700/50 group select-none"
            title="Drag to resize console"
          >
            <GripHorizontal size={12} className="text-surface-600 group-hover:text-surface-400 transition-colors" />
          </div>

          {/* Terminal canvas */}
          <div ref={termRef} style={{ height: consoleHeight }} className="bg-[#0d1117]" />

          {promptAction && (
            <div className="flex items-center gap-2 px-2 py-1 bg-amber-500/10 border-t border-amber-500/20 text-[11px] text-amber-100">
              <span className="text-amber-300 font-medium">Terminal needs input</span>
              <span className="truncate text-amber-100/80 flex-1" title={promptAction.text}>{promptAction.text}</span>
              <button
                onClick={() => sendPromptResponse('y', promptAction)}
                className="px-2 py-0.5 rounded bg-green-600/80 hover:bg-green-600 text-white font-medium transition-colors"
              >
                Yes
              </button>
              <button
                onClick={() => sendPromptResponse('n', promptAction)}
                className="px-2 py-0.5 rounded bg-red-600/80 hover:bg-red-600 text-white font-medium transition-colors"
              >
                No
              </button>
              <button
                onClick={() => setPromptAction(null)}
                className="px-1.5 py-0.5 rounded text-amber-200/70 hover:text-amber-100 hover:bg-amber-500/10 transition-colors"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* AI command builder */}
          <CommandBuilder
            onRun={(cmd) => {
              if (sessionIdRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'input', sessionId: sessionIdRef.current, data: cmd + '\n' }));
              }
            }}
          />
        </>
      )}
    </div>
  );
}

/**
 * Natural language → shell command builder.
 * Uses the local LLM to generate commands from descriptions.
 */
function CommandBuilder({ onRun }) {
  const [query, setQuery] = useState('');
  const [quickCommand, setQuickCommand] = useState('');
  const [generating, setGenerating] = useState(false);
  const [suggestion, setSuggestion] = useState(null);

  const handleGenerate = async () => {
    if (!query.trim() || generating) return;
    setGenerating(true);
    setSuggestion(null);
    try {
      const res = await fetch('/api/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: `Generate a single shell command for: "${query.trim()}". Return ONLY the command, nothing else. No explanation, no markdown, no backticks.`,
          context: { maxTokens: 100, temperature: 0.1 },
        }),
      });
      const data = await res.json();
      if (data.response) {
        setSuggestion(data.response.trim().replace(/^`+|`+$/g, ''));
      }
    } catch {}
    setGenerating(false);
  };

  const handleRun = () => {
    if (suggestion) {
      onRun(suggestion);
      setSuggestion(null);
      setQuery('');
    }
  };

  const handleQuickRun = () => {
    if (!quickCommand) return;
    onRun(quickCommand);
    setQuickCommand('');
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-surface-850 border-t border-surface-700/50">
      <Sparkles size={12} className="text-primary-400 flex-shrink-0" />
      <select
        value={quickCommand}
        onChange={(e) => setQuickCommand(e.target.value)}
        className="max-w-[170px] bg-surface-800 border border-surface-700 rounded px-1.5 py-0.5 text-[10px] text-surface-300 outline-none focus:border-primary-500/50"
        title="Run a common setup command"
      >
        {QUICK_COMMANDS.map((item) => (
          <option key={item.label} value={item.command}>{item.label}</option>
        ))}
      </select>
      <button
        onClick={handleQuickRun}
        disabled={!quickCommand}
        className="px-1.5 py-0.5 rounded text-[10px] text-primary-300 hover:text-primary-200 hover:bg-primary-500/10 disabled:text-surface-600 disabled:hover:bg-transparent"
        title={quickCommand || 'Select a quick command first'}
      >
        Run
      </button>
      <input
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setSuggestion(null); }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestion) handleRun();
            else handleGenerate();
          }
        }}
        placeholder="Describe a command... (Enter to generate)"
        className="flex-1 bg-transparent text-[11px] text-surface-300 outline-none placeholder:text-surface-600"
      />
      {suggestion && (
        <div className="flex items-center gap-1">
          <code className="text-[10px] text-primary-300 bg-surface-800 px-1.5 py-0.5 rounded font-mono max-w-[200px] truncate">{suggestion}</code>
          <button onClick={handleRun} className="text-[10px] text-green-400 hover:text-green-300 px-1">Run</button>
          <button onClick={() => setSuggestion(null)} className="text-[10px] text-surface-500 hover:text-surface-300 px-1">✕</button>
        </div>
      )}
      {generating && <Loader size={10} className="animate-spin text-primary-400" />}
    </div>
  );
}
