import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ChevronDown, ChevronUp, Terminal as TerminalIcon, Sparkles, Loader } from 'lucide-react';
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
        <>
          <div ref={termRef} style={{ height: 180 }} className="bg-[#0d1117]" />
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

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-surface-850 border-t border-surface-700/50">
      <Sparkles size={12} className="text-primary-400 flex-shrink-0" />
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
