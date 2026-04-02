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

    // Handle terminal input - always include sessionId so server doesn't rely on attachment state
    xterm.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'input',
          sessionId: sessionIdRef.current,
          data,
        }));
      } else if (!sessionIdRef.current) {
        // No active session — give user feedback instead of silently dropping input
        xterm.writeln('\x1b[33mNo active session. Click "Start" to create one.\x1b[0m');
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

    if (isUtility) {
      xterm.writeln('\x1b[90m── Utility Shell ──\x1b[0m');
      xterm.writeln('');
    } else {
      xterm.writeln('\x1b[1;34m\u256D\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256E\x1b[0m');
      xterm.writeln('\x1b[1;34m\u2502\x1b[0m   \x1b[1;36mStartUpp AI IDE Terminal\x1b[0m                    \x1b[1;34m\u2502\x1b[0m');
      xterm.writeln('\x1b[1;34m\u2502\x1b[0m   Select a project to start a session          \x1b[1;34m\u2502\x1b[0m');
      xterm.writeln('\x1b[1;34m\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256F\x1b[0m');
      xterm.writeln('');
    }

    return () => {
      resizeObserver.disconnect();
      xterm.dispose();
      xtermRef.current = null;
    };
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal`;
    let mounted = true;
    let reconnectTimer = null;

    const connect = () => {
      if (!mounted) return; // Don't connect if unmounted (StrictMode cleanup)
      setStatus('connecting');
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!mounted) { ws.close(); return; }
        setConnected(true);
        setStatus('connected');
        wsRef.current = ws;

        // Only request session list — the auto-session useEffect handles attach/create
        // to avoid double-attach on reconnection
        ws.send(JSON.stringify({ type: 'list-sessions' }));
      };

      ws.onmessage = (event) => {
        if (!mounted) return;
        const msg = JSON.parse(event.data);
        handleWebSocketMessage(msg);
      };

      ws.onclose = () => {
        if (!mounted) return; // Don't reconnect if component was unmounted
        setConnected(false);
        setStatus('disconnected');
        wsRef.current = null;

        // Reconnect after delay
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
      };
    };

    connect();

    return () => {
      mounted = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
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
        setSessionId(msg.sessionId);
        setSessions(prev => {
          const exists = prev.some(s => s.id === msg.sessionId);
          if (exists) return prev;
          return [...prev, { id: msg.sessionId, projectId: msg.projectId, cliTool: msg.cliTool, name: msg.name || null, status: 'running' }];
        });
        // Track project-session mapping
        if (msg.projectId) {
          projectSessionsRef.current.set(msg.projectId, msg.sessionId);
        }
        onSessionChange?.(msg.sessionId);
        xtermRef.current?.writeln(`\x1b[32m\u25CF Session started\x1b[0m\n`);
        xtermRef.current?.focus();
        break;

      case 'attached':
        setSessionId(msg.session.id);
        onSessionChange?.(msg.session.id);
        // No status message — scrollback replay shows the terminal state
        xtermRef.current?.focus();
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

  // Auto-create or attach session when projectId changes or on initial load
  // Waits for sessionsLoaded so we know about existing server-side sessions before deciding
  useEffect(() => {
    if (!connected || !sessionsLoaded || !wsRef.current) return;

    // For utility terminal: reconnect to stored session if it's still alive, otherwise do nothing
    if (isUtility) {
      if (initialSessionId && sessions.some(s => s.id === initialSessionId)) {
        if (initialSessionId !== sessionIdRef.current) {
          xtermRef.current?.reset();
          wsRef.current.send(JSON.stringify({
            type: 'attach',
            sessionId: initialSessionId,
          }));
        }
      }
      return;
    }

    if (!projectId) return;

    // Priority: initialSessionId (stored from before refresh) > project mapping > create new
    // Check if the stored session is still alive on the server
    const storedStillAlive = initialSessionId && sessions.some(s => s.id === initialSessionId);
    const targetSessionId = storedStillAlive
      ? initialSessionId
      : projectSessionsRef.current.get(projectId);

    if (targetSessionId) {
      if (targetSessionId !== sessionIdRef.current) {
        xtermRef.current?.reset();
        wsRef.current.send(JSON.stringify({
          type: 'attach',
          sessionId: targetSessionId,
        }));
      }
    } else {
      // Create a new session for this project
      xtermRef.current?.reset();
      wsRef.current.send(JSON.stringify({
        type: 'create-session',
        projectId,
        cliTool: null,
        cols: xtermRef.current?.cols || 120,
        rows: xtermRef.current?.rows || 30,
      }));
    }
  }, [projectId, connected, sessionsLoaded, isUtility]);

  // Create new session (manual)
  const createSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    // Clear terminal
    xtermRef.current?.clear();
    xtermRef.current?.writeln('\x1b[36m\u25CF Creating new session...\x1b[0m\n');

    wsRef.current.send(JSON.stringify({
      type: 'create-session',
      projectId,
      cliTool: selectedCLI === 'shell' ? null : selectedCLI,
      cols: xtermRef.current?.cols || 120,
      rows: xtermRef.current?.rows || 30,
    }));
  }, [projectId, selectedCLI]);

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
                <button
                  onClick={killSession}
                  className="px-2 py-0.5 text-[11px] bg-red-600/80 hover:bg-red-600 text-white rounded transition-colors"
                >
                  Kill
                </button>
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
            {/* Main terminal: full toolbar */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {/* Session tabs (inline) */}
              {sessions.length > 1 && (
                <div className="flex items-center gap-0.5 overflow-x-auto mr-2">
                  {sessions.map((s) => {
                    const isActive = s.id === sessionId;
                    const proj = projects.find(p => p.id === s.projectId);
                    const label = s.name || (proj ? proj.name : 'Session');
                    return (
                      <button
                        key={s.id}
                        onClick={() => attachToSession(s.id)}
                        className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded whitespace-nowrap transition-colors ${
                          isActive
                            ? 'bg-blue-500/20 text-blue-300'
                            : 'text-gray-500 hover:text-gray-300 hover:bg-gray-700/50'
                        }`}
                      >
                        <FolderOpen className="w-2.5 h-2.5" />
                        <span className="max-w-20 truncate">{label}</span>
                      </button>
                    );
                  })}
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
                <button
                  onClick={killSession}
                  className="px-2 py-0.5 text-[11px] bg-red-600/80 hover:bg-red-600 text-white rounded transition-colors"
                >
                  Kill
                </button>
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

            {/* Right: auto-respond toggle + settings + status */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setAutoResponderEnabled(prev => !prev)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-all ${
                  autoResponderEnabled
                    ? 'bg-purple-500/25 text-purple-300 border border-purple-500/30'
                    : 'bg-gray-700 text-gray-400 border border-gray-600 hover:border-gray-500'
                }`}
              >
                <Zap className="w-3 h-3" />
                Auto
              </button>

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

      {/* ── AI Action Bar (shown when model suggests a response) ── */}
      {!isUtility && promptSuggestion && (
        <div className={`px-3 py-2 border-b flex-shrink-0 ${
          promptSuggestion.riskLevel === 'critical' || promptSuggestion.riskLevel === 'high'
            ? 'bg-red-950/60 border-red-500/30'
            : promptSuggestion.riskLevel === 'medium'
              ? 'bg-orange-950/40 border-orange-500/20'
              : 'bg-gray-800 border-gray-700'
        }`}>
          {/* What the AI detected */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 min-w-0">
              {promptSuggestion.riskLevel === 'critical' || promptSuggestion.riskLevel === 'high' ? (
                <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              ) : (
                <Bot className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
              )}
              <span className="text-[11px] text-gray-300 truncate">
                {promptSuggestion.pattern?.name || 'AI asking a question'}
              </span>
              {promptSuggestion.confidence && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                  promptSuggestion.confidence >= 0.8 ? 'bg-green-500/20 text-green-300' :
                  promptSuggestion.confidence >= 0.5 ? 'bg-yellow-500/20 text-yellow-300' :
                  'bg-red-500/20 text-red-300'
                }`}>
                  {Math.round(promptSuggestion.confidence * 100)}%
                </span>
              )}
            </div>
            <button onClick={dismissSuggestion} className="p-0.5 hover:bg-gray-700 rounded text-gray-500">
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* What was detected */}
          <p className="text-[10px] text-gray-500 mb-2 truncate">{promptSuggestion.matchedText}</p>

          {/* Risk warnings */}
          {promptSuggestion.riskReasons?.length > 0 && (
            <p className="text-[10px] text-red-400 mb-2">{promptSuggestion.riskReasons.join(' | ')}</p>
          )}

          {/* Quick response buttons */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {promptSuggestion.responses?.map((response, i) => {
              const isSuggested = response === promptSuggestion.suggestedResponse;
              return (
                <button
                  key={i}
                  onClick={() => sendPromptResponse(response)}
                  className={`px-2.5 py-1 text-xs rounded font-medium transition-colors ${
                    isSuggested
                      ? promptSuggestion.riskLevel === 'critical' || promptSuggestion.riskLevel === 'high'
                        ? 'bg-red-500 text-white hover:bg-red-600'
                        : 'bg-purple-500 text-white hover:bg-purple-600'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {response || '(enter)'}
                  {isSuggested && ' \u2190 suggested'}
                </button>
              );
            })}

            {/* Custom response input */}
            <div className="flex items-center gap-1 flex-1 min-w-32">
              <input
                type="text"
                value={customResponse}
                onChange={(e) => setCustomResponse(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customResponse.trim()) {
                    sendPromptResponse(customResponse.trim());
                    setCustomResponse('');
                  }
                }}
                className="flex-1 px-2 py-1 text-xs bg-gray-900 border border-gray-600 rounded text-gray-200 placeholder-gray-500 focus:ring-1 focus:ring-purple-500"
                placeholder="Custom response..."
              />
              <button
                onClick={() => {
                  if (customResponse.trim()) {
                    sendPromptResponse(customResponse.trim());
                    setCustomResponse('');
                  }
                }}
                disabled={!customResponse.trim()}
                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 rounded transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error capture bar */}
      {!isUtility && capturedError && !promptSuggestion && (
        <div className="px-3 py-2 border-b border-red-500/20 bg-red-950/40 flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="text-[11px] text-red-300 truncate">{capturedError.text}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => {
                  // Copy last 2000 chars of terminal output to be used as context
                  if (window._onCaptureTerminalOutput) {
                    window._onCaptureTerminalOutput(terminalOutputBuffer.slice(-2000));
                  }
                  setCapturedError(null);
                }}
                className="px-2 py-0.5 text-[11px] bg-red-600 hover:bg-red-500 text-white rounded transition-colors font-medium"
              >
                Fix this
              </button>
              <button
                onClick={() => setCapturedError(null)}
                className="p-0.5 hover:bg-gray-700 rounded text-gray-500"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

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
