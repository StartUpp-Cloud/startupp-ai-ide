import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Zap, X, MessageSquare, Bot, Brain, Sparkles, Cpu, Settings, Shield, AlertTriangle, FolderOpen } from 'lucide-react';
import LLMSettingsPanel from './LLMSettingsPanel';
import '@xterm/xterm/css/xterm.css';

const CLI_TOOLS = [
  { id: 'shell', name: 'Shell', icon: '>' },
  { id: 'claude', name: 'Claude Code', icon: '\u{1F916}' },
  { id: 'copilot', name: 'GitHub Copilot', icon: '\u{1F419}' },
  { id: 'aider', name: 'Aider', icon: '\u{1F465}' },
];

export default function Terminal({ projectId, projects = [], onSessionChange, onSessionsChange, initialSessionId = null, isUtility = false }) {
  const terminalRef = useRef(null);
  const xtermRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const sessionIdRef = useRef(null);

  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);

  // Keep sessionIdRef in sync with sessionId state
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedCLI, setSelectedCLI] = useState('shell');
  const [status, setStatus] = useState('disconnected');

  // Auto-responder state
  const [promptSuggestion, setPromptSuggestion] = useState(null);
  const [autoResponderEnabled, setAutoResponderEnabled] = useState(true);

  // Error auto-capture state
  const [capturedError, setCapturedError] = useState(null); // { text, timestamp }
  const [terminalOutputBuffer, setTerminalOutputBuffer] = useState(''); // Recent output for context capture

  // Settings panel state
  const [showLLMSettings, setShowLLMSettings] = useState(false);

  // Track project-to-session mapping (projectId -> sessionId)
  const projectSessionsRef = useRef(new Map());
  // No pendingCreateRef needed — server sends session-created only to the requesting client

  // Report full sessions list to parent whenever it changes
  useEffect(() => {
    if (onSessionsChange && !isUtility) {
      onSessionsChange(sessions);
    }
  }, [sessions, onSessionsChange, isUtility]);

  // Expose switchMainSession for external session switching (e.g. from SessionManager)
  useEffect(() => {
    if (!isUtility) {
      window.switchMainSession = (targetId) => {
        if (!wsRef.current || !targetId) return;
        xtermRef.current?.reset();
        wsRef.current.send(JSON.stringify({ type: 'attach', sessionId: targetId }));
      };
    }
  }, [isUtility]);

  // Initialize xterm
  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const xterm = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1b26',
        foreground: '#c0caf5',
        cursor: '#c0caf5',
        cursorAccent: '#1a1b26',
        selectionBackground: '#33467c',
        black: '#15161e',
        red: '#f7768e',
        green: '#9ece6a',
        yellow: '#e0af68',
        blue: '#7aa2f7',
        magenta: '#bb9af7',
        cyan: '#7dcfff',
        white: '#a9b1d6',
        brightBlack: '#414868',
        brightRed: '#f7768e',
        brightGreen: '#9ece6a',
        brightYellow: '#e0af68',
        brightBlue: '#7aa2f7',
        brightMagenta: '#bb9af7',
        brightCyan: '#7dcfff',
        brightWhite: '#c0caf5',
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);

    xterm.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Suppress DA query response: write a reset sequence after xterm processes it
    // This is synchronous — xterm.open() triggers the DA, reset() flushes it
    xterm.write('\x1b[2J\x1b[H'); // Clear screen + cursor home

    // Handle terminal input - only send when session is attached
    xterm.onData((data) => {
      // Block ALL input until a session is attached — prevents DA response from appearing
      if (!sessionIdRef.current) return;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'input',
          sessionId: sessionIdRef.current,
          data,
        }));
      }
    });

    // Handle resize - always include sessionId
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            sessionId: sessionIdRef.current,
            cols: xterm.cols,
            rows: xterm.rows,
          }));
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    // No banner — session auto-connects and scrollback replays the terminal state

    return () => {
      resizeObserver.disconnect();
      xterm.dispose();
      xtermRef.current = null;
    };
  }, []);

  // Connect to WebSocket with heartbeat and auto-recovery
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
    let mounted = true;
    let reconnectTimer = null;
    let heartbeatInterval = null;
    let lastPong = Date.now();

    const connect = () => {
      if (!mounted) return;
      setStatus('connecting');
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!mounted) { ws.close(); return; }
        setConnected(true);
        setStatus('connected');
        wsRef.current = ws;
        lastPong = Date.now();

        // Request session list (for SessionManager in the sidebar)
        ws.send(JSON.stringify({ type: 'list-sessions' }));

        // Immediately request sessions for current project if we have one
        // This handles both initial load and WS reconnection
        if (projectId) {
          const role = isUtility ? 'utility' : 'main';
          ws.send(JSON.stringify({ type: 'get-project-sessions', projectId, role }));
        }

        // Start heartbeat — ping every 30s, check for dead connection
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(() => {
          if (!ws || ws.readyState !== WebSocket.OPEN) return;

          // If no message received in 60s, connection is probably dead
          if (Date.now() - lastPong > 60000) {
            console.warn('WebSocket heartbeat timeout — reconnecting');
            ws.close();
            return;
          }

          // Send a ping (server ignores unknown message types gracefully)
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch {}
        }, 30000);
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        lastPong = Date.now(); // Any message counts as proof of life
        const msg = JSON.parse(event.data);
        handleWebSocketMessage(msg);
      };

      ws.onclose = () => {
        if (!mounted) return;
        setConnected(false);
        setStatus('disconnected');
        wsRef.current = null;
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }

        // Reconnect after delay
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setStatus('error');
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Handle WebSocket messages - use sessionIdRef to avoid stale closure
  const handleWebSocketMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'connected':
        // Silent — the status dot in the toolbar shows connection state
        break;

      case 'session-created':
        // Server sends this only to the client that requested the session
        setSessionId(msg.sessionId);
        sessionIdRef.current = msg.sessionId; // Sync immediately — don't wait for useEffect
        onSessionChange?.(msg.sessionId);
        // Don't reset — already cleared in project-sessions handler.
        setTimeout(() => {
          fitAddonRef.current?.fit();
          xtermRef.current?.focus();
        }, 50);
        setSessions(prev => {
          const exists = prev.some(s => s.id === msg.sessionId);
          if (exists) return prev;
          return [...prev, { id: msg.sessionId, projectId: msg.projectId, cliTool: msg.cliTool, name: msg.name || null, status: 'running' }];
        });
        if (msg.projectId) {
          projectSessionsRef.current.set(msg.projectId, msg.sessionId);
        }
        break;

      case 'attached':
        setSessionId(msg.session.id);
        sessionIdRef.current = msg.session.id; // Sync immediately — don't wait for useEffect
        onSessionChange?.(msg.session.id);
        // Don't reset here — project-sessions handler already cleared the screen.
        // The server sends scrollback as 'output' messages right after this.
        // Just fit and focus after a tick to ensure correct dimensions.
        setTimeout(() => {
          fitAddonRef.current?.fit();
          xtermRef.current?.focus();
        }, 50);
        break;

      case 'output':
        xtermRef.current?.write(msg.data);

        // Dispatch event for LiveAnalysisPanel to consume (main terminal only)
        if (!isUtility) {
          window.dispatchEvent(new CustomEvent('terminal-output', {
            detail: { sessionId: msg.sessionId, data: msg.data },
          }));
        }

        // Buffer recent output for context capture (keep last 5000 chars)
        setTerminalOutputBuffer(prev => {
          const updated = prev + (msg.data || '');
          return updated.length > 5000 ? updated.slice(-5000) : updated;
        });

        // Auto-detect errors in output (only for main terminal)
        if (!isUtility) {
          const cleanData = (msg.data || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // strip ANSI
          const errorPatterns = [
            /Error:/i, /FAILED/i, /fatal:/i, /panic:/i,
            /Traceback \(most recent/i, /SyntaxError/i, /TypeError/i,
            /ReferenceError/i, /Cannot find module/i, /ENOENT/i,
            /Build failed/i, /Compilation failed/i,
          ];
          if (errorPatterns.some(p => p.test(cleanData))) {
            // Debounce: only capture if no recent capture (5s cooldown)
            setCapturedError(prev => {
              if (prev && Date.now() - prev.timestamp < 5000) return prev;
              return { text: cleanData.trim().slice(0, 500), timestamp: Date.now() };
            });
            // Auto-dismiss after 15 seconds
            setTimeout(() => setCapturedError(prev => {
              if (prev && Date.now() - prev.timestamp >= 14000) return null;
              return prev;
            }), 15000);

            // Notify IDE of error event
            window.dispatchEvent(new CustomEvent('session-error', {
              detail: { sessionId: msg.sessionId, text: cleanData.trim().slice(0, 200) },
            }));
          }
        }
        break;

      case 'exit':
        xtermRef.current?.writeln(`\n\x1b[33m\u25CF Session exited (code: ${msg.exitCode})\x1b[0m`);
        // Use ref to get current sessionId value
        if (msg.sessionId === sessionIdRef.current) {
          setSessionId(null);
          onSessionChange?.(null);
        }
        // Remove from project mapping
        for (const [pid, sid] of projectSessionsRef.current.entries()) {
          if (sid === msg.sessionId) {
            projectSessionsRef.current.delete(pid);
            break;
          }
        }
        setSessions(prev => prev.filter(s => s.id !== msg.sessionId));
        break;

      case 'sessions-list':
        setSessions(msg.sessions);
        // Rebuild project-session mapping from server state
        const map = projectSessionsRef.current;
        map.clear();
        for (const s of msg.sessions) {
          if (s.projectId) {
            map.set(s.projectId, s.id);
          }
        }
        setSessionsLoaded(true);
        break;

      case 'session-renamed':
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, name: msg.name } : s
        ));
        break;

      case 'project-sessions': {
        // Server returns sessions filtered by project + role
        const activeSessions = (msg.sessions || []).filter(s => s.status === 'active');

        // Reset NOW — right before we attach/create, so no gap for DA garbage
        xtermRef.current?.reset();

        if (activeSessions.length > 0) {
          // Reattach to the most recent active session for this role
          const target = activeSessions[activeSessions.length - 1];
          wsRef.current?.send(JSON.stringify({ type: 'attach', sessionId: target.id }));
        } else {
          // No session for this project + role — create one
          wsRef.current?.send(JSON.stringify({
            type: 'create-session',
            projectId: msg.projectId,
            role: msg.role || (isUtility ? 'utility' : 'main'),
            cliTool: null,
            cols: xtermRef.current?.cols || 120,
            rows: xtermRef.current?.rows || 30,
          }));
        }
        break;
      }

      case 'error':
        xtermRef.current?.writeln(`\x1b[31m\u2717 Error: ${msg.error}\x1b[0m`);
        break;

      case 'cli-started':
        xtermRef.current?.writeln(`\x1b[32m\u25CF Started ${msg.cliTool}\x1b[0m\n`);
        break;

      case 'session-terminated':
        // Use ref to get current sessionId value
        if (msg.sessionId === sessionIdRef.current) {
          setSessionId(null);
          onSessionChange?.(null);
          xtermRef.current?.writeln('\n\x1b[33m\u25CF Session terminated\x1b[0m');
        }
        // Remove from project mapping
        for (const [pid, sid] of projectSessionsRef.current.entries()) {
          if (sid === msg.sessionId) {
            projectSessionsRef.current.delete(pid);
            break;
          }
        }
        setSessions(prev => prev.filter(s => s.id !== msg.sessionId));
        break;

      case 'session-killed':
        // Session was killed, clear it
        if (msg.sessionId === sessionIdRef.current) {
          setSessionId(null);
          onSessionChange?.(null);
        }
        break;

      case 'prompt-detected':
        // AI is asking a question - show suggestion
        if (msg.action !== 'auto' && autoResponderEnabled) {
          setPromptSuggestion({
            pattern: msg.pattern,
            responses: msg.responses,
            suggestedResponse: msg.suggestedResponse,
            matchedText: msg.matchedText,
            // Smart engine fields
            smartEngine: msg.smartEngine,
            confidence: msg.confidence,
            reasoning: msg.reasoning,
            projectContext: msg.projectContext,
            // LLM fields
            llmGenerated: msg.llmGenerated,
            llmProvider: msg.llmProvider,
            llmModel: msg.llmModel,
            // Security fields
            requiresConfirmation: msg.requiresConfirmation,
            riskLevel: msg.riskLevel,
            riskReasons: msg.riskReasons,
          });
          // Auto-dismiss after 30 seconds
          setTimeout(() => {
            setPromptSuggestion(prev =>
              prev?.matchedText === msg.matchedText ? null : prev
            );
          }, 30000);

          // Notify IDE of input-needed event
          if (!isUtility) {
            window.dispatchEvent(new CustomEvent('session-needs-input', {
              detail: { sessionId: msg.sessionId || sessionIdRef.current, text: msg.matchedText },
            }));
          }
        }
        break;

      case 'llm-error':
        // LLM request failed - show error in terminal
        xtermRef.current?.writeln(`\x1b[33m[LLM] ${msg.error}\x1b[0m`);
        break;

      case 'auto-response-sent':
        // Notify user of auto-response
        xtermRef.current?.writeln(`\x1b[90m[Auto] Sent: ${msg.response || '(enter)'}\x1b[0m`);
        setPromptSuggestion(null);
        break;

      case 'response-sent':
        setPromptSuggestion(null);
        break;
    }
  }, [onSessionChange, autoResponderEnabled, isUtility]);

  // Track previous projectId to detect switches
  const prevProjectIdRef = useRef(null);

  // When projectId changes: ask the server for sessions for this project + role.
  // The server response (project-sessions) triggers attach or create.
  useEffect(() => {
    if (!connected || !wsRef.current || !projectId) return;

    // Only act on actual project changes (not re-renders)
    if (prevProjectIdRef.current === projectId) return;
    prevProjectIdRef.current = projectId;

    // Clear local session state — old session keeps running on the server
    setSessionId(null);
    sessionIdRef.current = null;

    const role = isUtility ? 'utility' : 'main';
    wsRef.current.send(JSON.stringify({ type: 'get-project-sessions', projectId, role }));
  }, [projectId, connected, isUtility]);

  // Create new session (manual)
  const createSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    // Clear terminal
    xtermRef.current?.reset();

    wsRef.current.send(JSON.stringify({
      type: 'create-session',
      projectId,
      role: isUtility ? 'utility' : 'main',
      cliTool: selectedCLI === 'shell' ? null : selectedCLI,
      cols: xtermRef.current?.cols || 120,
      rows: xtermRef.current?.rows || 30,
    }));
  }, [projectId, selectedCLI, isUtility]);

  // Kill current session
  const killSession = useCallback(() => {
    if (!sessionId || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({
      type: 'kill-session',
      sessionId,
    }));
  }, [sessionId]);

  // Attach to an existing session (for session tab switching)
  const attachToSession = useCallback((targetSessionId) => {
    if (!wsRef.current || targetSessionId === sessionIdRef.current) return;

    xtermRef.current?.clear();
    wsRef.current.send(JSON.stringify({
      type: 'attach',
      sessionId: targetSessionId,
    }));
  }, []);

  // Start CLI in current session
  const startCLI = useCallback((cliTool) => {
    if (!sessionId || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({
      type: 'start-cli',
      sessionId,
      cliTool,
    }));
  }, [sessionId]);

  // Send text to terminal (for AI prompt integration)
  const sendToTerminal = useCallback((text) => {
    if (!sessionId || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({
      type: 'input',
      sessionId,
      data: text,
    }));
  }, [sessionId]);

  // Send response to detected prompt
  const sendPromptResponse = useCallback((response) => {
    if (!sessionIdRef.current || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({
      type: 'send-response',
      sessionId: sessionIdRef.current,
      response,
    }));
    setPromptSuggestion(null);
  }, []);

  // Dismiss prompt suggestion
  const dismissSuggestion = useCallback(() => {
    setPromptSuggestion(null);
  }, []);

  // Expose sendToTerminal method
  useEffect(() => {
    if (!window) return;
    if (isUtility) {
      window.sendUtilTerminal = sendToTerminal;
    } else {
      window.sendToTerminal = sendToTerminal;
    }
  }, [sendToTerminal, isUtility]);

  // Expose terminal output capture for "Fix this" integration
  useEffect(() => {
    if (window && !isUtility) {
      window._getTerminalOutput = () => terminalOutputBuffer;
    }
  }, [terminalOutputBuffer, isUtility]);

  // Custom response input state
  const [customResponse, setCustomResponse] = useState('');
  const [terminalFocused, setTerminalFocused] = useState(false);

  // AI command helper state (utility terminal only)
  const [aiCommandQuery, setAiCommandQuery] = useState('');
  const [aiCommandResult, setAiCommandResult] = useState(null); // { command, generating }
  const [aiCommandGenerating, setAiCommandGenerating] = useState(false);

  const handleAiCommandGenerate = async () => {
    if (!aiCommandQuery.trim() || aiCommandGenerating) return;
    setAiCommandGenerating(true);
    setAiCommandResult(null);
    try {
      const res = await fetch('/api/llm/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiCommandQuery.trim(),
          context: {
            systemPrompt: 'You are a shell command expert. Given a natural language description, return ONLY the exact shell command to run. No explanation, no markdown, no quotes around the command. Just the command itself. If multiple commands are needed, separate them with && on one line.',
            maxTokens: 200,
            temperature: 0.1,
          },
        }),
      });
      const data = await res.json();
      if (data.response) {
        const cmd = data.response.replace(/<think>[\s\S]*?<\/think>/g, '').trim().split('\n')[0];
        setAiCommandResult(cmd);
      }
    } catch {
      setAiCommandResult(null);
    } finally {
      setAiCommandGenerating(false);
    }
  };

  const handleAiCommandSend = () => {
    if (!aiCommandResult || !sessionIdRef.current || !wsRef.current) return;
    // Write directly to the WS to avoid any stale closure issues with sendToTerminal
    wsRef.current.send(JSON.stringify({
      type: 'input',
      sessionId: sessionIdRef.current,
      data: aiCommandResult + '\n',
    }));
    setAiCommandQuery('');
    setAiCommandResult(null);
    xtermRef.current?.focus();
  };

  return (
    <div
      className={`flex flex-col h-full bg-[#1a1b26] rounded-lg overflow-hidden border transition-colors ${
        terminalFocused ? 'border-primary-500/50' : 'border-gray-700'
      }`}
      onFocus={() => setTerminalFocused(true)}
      onBlur={(e) => {
        // Only unfocus if focus left the entire terminal container
        if (!e.currentTarget.contains(e.relatedTarget)) setTerminalFocused(false);
      }}
    >
      {/* ── Top Control Bar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800/80 border-b border-gray-700 flex-shrink-0">
        {isUtility ? (
          <div className="flex flex-col gap-1 w-full">
            {/* Row 1: session controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={createSession}
                disabled={!connected}
                className="px-2 py-0.5 text-[11px] bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
              >
                {sessionId ? 'New Shell' : 'Start Shell'}
              </button>

              {sessionId && (
                <>
                  <button
                    onClick={() => {
                      xtermRef.current?.reset();
                      xtermRef.current?.focus();
                      // Also clear server-side scrollback so reconnect doesn't replay old content
                      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
                        wsRef.current.send(JSON.stringify({ type: 'clear-scrollback', sessionId: sessionIdRef.current }));
                      }
                    }}
                    className="px-2 py-0.5 text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                    title="Clear"
                  >
                    Clear
                  </button>
                  <button
                    onClick={killSession}
                    className="px-2 py-0.5 text-[11px] bg-red-600/80 hover:bg-red-600 text-white rounded transition-colors"
                  >
                    Kill
                  </button>
                </>
              )}

              <div className="flex-1" />
              <div className={`w-2 h-2 rounded-full ${
                status === 'connected' ? 'bg-green-500' :
                status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                status === 'error' ? 'bg-red-500' :
                'bg-gray-500'
              }`} title={status} />
            </div>

            {/* Row 2: AI command helper */}
            {sessionId && (
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-purple-400 flex-shrink-0" />
                <input
                  type="text"
                  value={aiCommandQuery}
                  onChange={(e) => { setAiCommandQuery(e.target.value); setAiCommandResult(null); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (aiCommandResult) handleAiCommandSend();
                      else handleAiCommandGenerate();
                    }
                    if (e.key === 'Escape') { setAiCommandQuery(''); setAiCommandResult(null); }
                  }}
                  placeholder="Describe a command... (e.g. find large files)"
                  className="flex-1 px-2 py-0.5 text-[11px] bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50 outline-none"
                />
                {aiCommandResult ? (
                  <>
                    <code className="px-1.5 py-0.5 text-[11px] bg-purple-500/10 text-purple-300 border border-purple-500/20 rounded truncate max-w-[200px]" title={aiCommandResult}>
                      {aiCommandResult}
                    </code>
                    <button
                      onClick={handleAiCommandSend}
                      className="px-2 py-0.5 text-[10px] bg-green-600 hover:bg-green-700 text-white rounded transition-colors font-medium"
                    >
                      Run
                    </button>
                    <button
                      onClick={() => setAiCommandResult(null)}
                      className="p-0.5 text-gray-500 hover:text-gray-300"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleAiCommandGenerate}
                    disabled={!aiCommandQuery.trim() || aiCommandGenerating}
                    className="px-2 py-0.5 text-[10px] bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors font-medium"
                  >
                    {aiCommandGenerating ? '...' : 'Ask'}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Main terminal: toolbar */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Active project name */}
              {projectId && (
                <div className="flex items-center gap-1.5 px-2 py-0.5 bg-primary-500/10 border border-primary-500/20 rounded text-[11px] text-primary-300 font-medium truncate max-w-40 flex-shrink-0">
                  <FolderOpen className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{projects.find(p => p.id === projectId)?.name || 'Project'}</span>
                </div>
              )}

              <select
                value={selectedCLI}
                onChange={(e) => setSelectedCLI(e.target.value)}
                disabled={!!sessionId}
                className="px-2 py-0.5 text-[11px] bg-gray-700 border border-gray-600 rounded text-gray-200 disabled:opacity-50"
              >
                {CLI_TOOLS.map((tool) => (
                  <option key={tool.id} value={tool.id}>{tool.icon} {tool.name}</option>
                ))}
              </select>

              <button
                onClick={createSession}
                disabled={!connected}
                className="px-2 py-0.5 text-[11px] bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
              >
                {sessionId ? 'New' : 'Start'}
              </button>

              {sessionId && (
                <>
                  <button
                    onClick={() => {
                      xtermRef.current?.reset();
                      xtermRef.current?.focus();
                      // Also clear server-side scrollback so reconnect doesn't replay old content
                      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
                        wsRef.current.send(JSON.stringify({ type: 'clear-scrollback', sessionId: sessionIdRef.current }));
                      }
                    }}
                    className="px-2 py-0.5 text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                    title="Clear terminal screen"
                  >
                    Clear
                  </button>
                  <button
                    onClick={killSession}
                    className="px-2 py-0.5 text-[11px] bg-red-600/80 hover:bg-red-600 text-white rounded transition-colors"
                  >
                    Kill
                  </button>
                </>
              )}

              {sessionId && selectedCLI === 'shell' && (
                <div className="flex items-center gap-0.5 ml-1 pl-1 border-l border-gray-600">
                  {CLI_TOOLS.filter(t => t.id !== 'shell').map((tool) => (
                    <button
                      key={tool.id}
                      onClick={() => startCLI(tool.id)}
                      className="px-1.5 py-0.5 text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                      title={`Start ${tool.name}`}
                    >
                      {tool.icon}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Right: settings + status */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowLLMSettings(true)}
                className="p-1 rounded bg-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-600 transition-colors"
                title="LLM Settings"
              >
                <Cpu className="w-3 h-3" />
              </button>

              <div className={`w-2 h-2 rounded-full ${
                status === 'connected' ? 'bg-green-500' :
                status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                status === 'error' ? 'bg-red-500' :
                'bg-gray-500'
              }`} title={status} />
            </div>
          </>
        )}
      </div>

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 p-2"
        style={{ minHeight: isUtility ? '120px' : '300px' }}
        onClick={() => xtermRef.current?.focus()}
      />

      {/* LLM Settings Panel */}
      {!isUtility && (
        <LLMSettingsPanel
          isOpen={showLLMSettings}
          onClose={() => setShowLLMSettings(false)}
        />
      )}
    </div>
  );
}

// Export a hook for external components to send to terminal
export function useTerminal() {
  const sendToTerminal = useCallback((text) => {
    if (window.sendToTerminal) {
      window.sendToTerminal(text);
    }
  }, []);

  return { sendToTerminal };
}
