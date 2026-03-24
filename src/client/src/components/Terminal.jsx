import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

const CLI_TOOLS = [
  { id: 'shell', name: 'Shell', icon: '>' },
  { id: 'claude', name: 'Claude Code', icon: '🤖' },
  { id: 'copilot', name: 'GitHub Copilot', icon: '🐙' },
  { id: 'aider', name: 'Aider', icon: '👥' },
];

export default function Terminal({ projectId, onSessionChange }) {
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
  const [selectedCLI, setSelectedCLI] = useState('shell');
  const [status, setStatus] = useState('disconnected');

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

    // Handle terminal input - use ref to get current sessionId
    xterm.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
        wsRef.current.send(JSON.stringify({
          type: 'input',
          data,
        }));
      }
    });

    // Handle resize - use ref to get current sessionId
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN && sessionIdRef.current) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            cols: xterm.cols,
            rows: xterm.rows,
          }));
        }
      }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(terminalRef.current);

    xterm.writeln('\x1b[1;34m╭──────────────────────────────────────────────╮\x1b[0m');
    xterm.writeln('\x1b[1;34m│\x1b[0m   \x1b[1;36mAI Prompt IDE Terminal\x1b[0m                      \x1b[1;34m│\x1b[0m');
    xterm.writeln('\x1b[1;34m│\x1b[0m   Select a CLI tool and create a session     \x1b[1;34m│\x1b[0m');
    xterm.writeln('\x1b[1;34m╰──────────────────────────────────────────────╯\x1b[0m');
    xterm.writeln('');

    return () => {
      resizeObserver.disconnect();
      xterm.dispose();
      xtermRef.current = null;
    };
  }, []);

  // Connect to WebSocket
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:55590/ws/terminal`;

    const connect = () => {
      setStatus('connecting');
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setConnected(true);
        setStatus('connected');
        wsRef.current = ws;

        // Request session list
        ws.send(JSON.stringify({ type: 'list-sessions' }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleWebSocketMessage(msg);
      };

      ws.onclose = () => {
        setConnected(false);
        setStatus('disconnected');
        wsRef.current = null;

        // Reconnect after delay
        setTimeout(connect, 3000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
      };
    };

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Handle WebSocket messages
  const handleWebSocketMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'connected':
        xtermRef.current?.writeln('\x1b[32m● Connected to terminal server\x1b[0m\n');
        break;

      case 'session-created':
        setSessionId(msg.sessionId);
        setSessions(prev => [...prev, msg]);
        onSessionChange?.(msg.sessionId);
        xtermRef.current?.writeln(`\x1b[32m● Session created: ${msg.sessionId}\x1b[0m\n`);
        break;

      case 'attached':
        setSessionId(msg.session.id);
        xtermRef.current?.writeln(`\x1b[32m● Attached to session: ${msg.session.id}\x1b[0m\n`);
        break;

      case 'output':
        xtermRef.current?.write(msg.data);
        break;

      case 'exit':
        xtermRef.current?.writeln(`\n\x1b[33m● Session exited (code: ${msg.exitCode})\x1b[0m`);
        if (msg.sessionId === sessionId) {
          setSessionId(null);
        }
        break;

      case 'sessions-list':
        setSessions(msg.sessions);
        break;

      case 'error':
        xtermRef.current?.writeln(`\x1b[31m✗ Error: ${msg.error}\x1b[0m`);
        break;

      case 'cli-started':
        xtermRef.current?.writeln(`\x1b[32m● Started ${msg.cliTool}\x1b[0m\n`);
        break;

      case 'session-terminated':
        if (msg.sessionId === sessionId) {
          setSessionId(null);
          xtermRef.current?.writeln('\n\x1b[33m● Session terminated\x1b[0m');
        }
        setSessions(prev => prev.filter(s => s.id !== msg.sessionId));
        break;
    }
  }, [sessionId, onSessionChange]);

  // Create new session
  const createSession = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }

    // Clear terminal
    xtermRef.current?.clear();
    xtermRef.current?.writeln('\x1b[36m● Creating new session...\x1b[0m\n');

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

  // Start CLI in current session
  const startCLI = useCallback((cliTool) => {
    if (!sessionId || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({
      type: 'start-cli',
      sessionId,
      cliTool,
    }));
  }, [sessionId]);

  // Send text to terminal (for prompt maker integration)
  const sendToTerminal = useCallback((text) => {
    if (!sessionId || !wsRef.current) return;

    wsRef.current.send(JSON.stringify({
      type: 'input',
      data: text,
    }));
  }, [sessionId]);

  // Expose sendToTerminal method
  useEffect(() => {
    if (window) {
      window.sendToTerminal = sendToTerminal;
    }
  }, [sendToTerminal]);

  return (
    <div className="flex flex-col h-full bg-[#1a1b26] rounded-lg overflow-hidden border border-gray-700">
      {/* Terminal toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800/50 border-b border-gray-700">
        <div className="flex items-center gap-2">
          {/* CLI selector */}
          <select
            value={selectedCLI}
            onChange={(e) => setSelectedCLI(e.target.value)}
            disabled={!!sessionId}
            className="px-2 py-1 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            {CLI_TOOLS.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.icon} {tool.name}
              </option>
            ))}
          </select>

          {/* New session button */}
          <button
            onClick={createSession}
            disabled={!connected}
            className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            {sessionId ? 'New Session' : 'Start'}
          </button>

          {/* Kill session button */}
          {sessionId && (
            <button
              onClick={killSession}
              className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            >
              Kill
            </button>
          )}

          {/* Quick CLI buttons when in shell */}
          {sessionId && selectedCLI === 'shell' && (
            <div className="flex items-center gap-1 ml-2 pl-2 border-l border-gray-600">
              {CLI_TOOLS.filter(t => t.id !== 'shell').map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => startCLI(tool.id)}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
                  title={`Start ${tool.name}`}
                >
                  {tool.icon}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {sessionId && (
            <span className="text-xs text-gray-400 font-mono truncate max-w-32">
              {sessionId.substring(0, 16)}...
            </span>
          )}
          <div className={`w-2 h-2 rounded-full ${
            status === 'connected' ? 'bg-green-500' :
            status === 'connecting' ? 'bg-yellow-500 animate-pulse' :
            status === 'error' ? 'bg-red-500' :
            'bg-gray-500'
          }`} title={status} />
        </div>
      </div>

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 p-2"
        style={{ minHeight: '300px' }}
      />
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
