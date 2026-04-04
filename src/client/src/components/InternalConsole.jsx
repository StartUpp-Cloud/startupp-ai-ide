import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

export default function InternalConsole({ wsRef }) {
  const [open, setOpen] = useState(false);
  const termRef = useRef(null);
  const xtermRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    if (!open || !termRef.current || xtermRef.current) return;
    const xterm = new XTerm({
      cursorBlink: false,
      fontSize: 11,
      scrollback: 5000,
      theme: { background: '#0d1117', foreground: '#8b949e' },
      disableStdin: true,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.open(termRef.current);
    fit.fit();
    xtermRef.current = xterm;
    fitRef.current = fit;

    return () => { xterm.dispose(); xtermRef.current = null; };
  }, [open]);

  useEffect(() => {
    if (!wsRef?.current || !open) return;
    const handler = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'agent-shell-output' && xtermRef.current) {
        xtermRef.current.write(msg.data);
      }
    };
    const ws = wsRef.current;
    ws.addEventListener('message', handler);
    return () => ws.removeEventListener('message', handler);
  }, [wsRef, open]);

  return (
    <div className="border-t border-gray-800">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1 text-xs text-gray-500 hover:text-gray-300 bg-gray-900/50"
      >
        <Terminal size={12} />
        Internal Console
        {open ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
      {open && (
        <div ref={termRef} style={{ height: 180 }} className="bg-[#0d1117]" />
      )}
    </div>
  );
}
