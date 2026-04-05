import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ChevronDown, ChevronUp, Terminal as TerminalIcon } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

/**
 * InternalConsole — a real interactive shell terminal for the selected project.
 * Opens its own WebSocket + PTY session independently from the chat system.
 */
export default function InternalConsole({ projectId }) {
  const [open, setOpen] = useState(false);
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);
  const wsRef = useRef(null);
  const sessionIdRef = useRef(null);
  const prevProjectIdRef = useRef(null);

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

    // Connect WebSocket
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/terminal`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      // Create a session for this project
      ws.send(JSON.stringify({
        type: 'create-session',
        projectId,
        role: 'utility',
        cliTool: null,
        cols: xterm.cols || 120,
        rows: xterm.rows || 12,
      }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.type === 'session-created' && !sessionIdRef.current) {
        sessionIdRef.current = msg.sessionId;
        // Attach
        ws.send(JSON.stringify({ type: 'attach', sessionId: msg.sessionId }));
      }

      if (msg.type === 'output' && msg.sessionId === sessionIdRef.current) {
        xterm.write(msg.data);
      }
    };

    // Forward keyboard input
    xterm.onData((data) => {
      if (sessionIdRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', sessionId: sessionIdRef.current, data }));
      }
    });

    // Forward resize
    xterm.onResize(({ cols, rows }) => {
      if (sessionIdRef.current && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', sessionId: sessionIdRef.current, cols, rows }));
      }
    });

    // Refit on window resize
    const resizeHandler = () => fit.fit();
    window.addEventListener('resize', resizeHandler);

    return () => {
      window.removeEventListener('resize', resizeHandler);
      xterm.dispose();
      xtermRef.current = null;
      if (ws.readyState === WebSocket.OPEN) ws.close();
      wsRef.current = null;
      sessionIdRef.current = null;
    };
  }, [open, projectId]);

  return (
    <div className="border-t border-surface-700 flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1 text-xs text-surface-500 hover:text-surface-200 bg-surface-850/50 transition-colors"
      >
        <TerminalIcon size={12} />
        Internal Console
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      {open && (
        <div ref={termRef} style={{ height: 200 }} className="bg-[#0d1117]" />
      )}
    </div>
  );
}
