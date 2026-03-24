import { useState, useEffect, useRef } from 'react';

const CLI_TOOLS = [
  { id: 'claude', name: 'Claude Code', icon: '🤖' },
  { id: 'copilot', name: 'GitHub Copilot', icon: '🐙' },
  { id: 'gemini', name: 'Gemini CLI', icon: '✨' },
  { id: 'aider', name: 'Aider', icon: '👥' },
  { id: 'custom', name: 'Custom Command', icon: '⚡' },
];

export default function CLIExecutor({ isOpen, onClose, prompt }) {
  const [selectedTool, setSelectedTool] = useState('claude');
  const [customCommand, setCustomCommand] = useState('');
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [exitCode, setExitCode] = useState(null);
  const [toolStatus, setToolStatus] = useState({});
  const outputRef = useRef(null);
  const eventSourceRef = useRef(null);

  // Check tool availability on mount
  useEffect(() => {
    if (isOpen) {
      checkToolStatus();
    }
  }, [isOpen]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  const checkToolStatus = async () => {
    for (const tool of CLI_TOOLS) {
      if (tool.id === 'custom') continue;
      try {
        const res = await fetch('/api/cli/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toolId: tool.id }),
        });
        const data = await res.json();
        setToolStatus(prev => ({ ...prev, [tool.id]: data }));
      } catch {
        setToolStatus(prev => ({ ...prev, [tool.id]: { installed: false } }));
      }
    }
  };

  const handleExecute = () => {
    if (isRunning) return;

    setOutput('');
    setExitCode(null);
    setIsRunning(true);

    const params = new URLSearchParams({
      toolId: selectedTool,
      prompt: prompt,
      ...(selectedTool === 'custom' && { customCommand }),
    });

    const eventSource = new EventSource(`/api/cli/stream?${params}`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('start', (e) => {
      const data = JSON.parse(e.data);
      setOutput(prev => prev + `$ ${data.command}\n\n`);
    });

    eventSource.addEventListener('stdout', (e) => {
      const data = JSON.parse(e.data);
      setOutput(prev => prev + data.text);
    });

    eventSource.addEventListener('stderr', (e) => {
      const data = JSON.parse(e.data);
      setOutput(prev => prev + data.text);
    });

    eventSource.addEventListener('end', (e) => {
      const data = JSON.parse(e.data);
      setExitCode(data.exitCode);
      setIsRunning(false);
      eventSource.close();
    });

    eventSource.addEventListener('error', (e) => {
      try {
        const data = JSON.parse(e.data);
        setOutput(prev => prev + `\nError: ${data.message}\n`);
      } catch {
        setOutput(prev => prev + '\nConnection error\n');
      }
      setIsRunning(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      setIsRunning(false);
      eventSource.close();
    };
  };

  const handleStop = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setIsRunning(false);
    setOutput(prev => prev + '\n\n[Stopped by user]\n');
  };

  const handleCopyOutput = () => {
    navigator.clipboard.writeText(output);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-semibold text-white">Execute with CLI</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tool Selection */}
        <div className="p-4 border-b border-gray-700">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Select CLI Tool
          </label>
          <div className="flex flex-wrap gap-2">
            {CLI_TOOLS.map((tool) => {
              const status = toolStatus[tool.id];
              const isInstalled = tool.id === 'custom' || status?.installed;

              return (
                <button
                  key={tool.id}
                  onClick={() => setSelectedTool(tool.id)}
                  disabled={!isInstalled && tool.id !== 'custom'}
                  className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-all ${
                    selectedTool === tool.id
                      ? 'bg-blue-600 text-white'
                      : isInstalled
                      ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
                      : 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <span>{tool.icon}</span>
                  <span>{tool.name}</span>
                  {status && !status.installed && tool.id !== 'custom' && (
                    <span className="text-xs text-red-400">(not installed)</span>
                  )}
                </button>
              );
            })}
          </div>

          {selectedTool === 'custom' && (
            <div className="mt-3">
              <input
                type="text"
                value={customCommand}
                onChange={(e) => setCustomCommand(e.target.value)}
                placeholder="Enter custom command (use {prompt} as placeholder)"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-gray-400 mt-1">
                Example: my-cli --input "{'{prompt}'}"
              </p>
            </div>
          )}
        </div>

        {/* Prompt Preview */}
        <div className="p-4 border-b border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-300">Prompt to Execute</label>
            <span className="text-xs text-gray-500">{prompt.length} chars</span>
          </div>
          <div className="bg-gray-900 rounded-lg p-3 max-h-32 overflow-y-auto">
            <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
              {prompt.substring(0, 500)}{prompt.length > 500 ? '...' : ''}
            </pre>
          </div>
        </div>

        {/* Output */}
        <div className="flex-1 p-4 min-h-0">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-300">Output</label>
            <div className="flex items-center gap-2">
              {exitCode !== null && (
                <span className={`text-xs px-2 py-1 rounded ${
                  exitCode === 0 ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
                }`}>
                  Exit: {exitCode}
                </span>
              )}
              {output && (
                <button
                  onClick={handleCopyOutput}
                  className="text-xs text-gray-400 hover:text-white transition-colors"
                >
                  Copy
                </button>
              )}
            </div>
          </div>
          <div
            ref={outputRef}
            className="bg-gray-900 rounded-lg p-3 h-64 overflow-y-auto font-mono text-sm"
          >
            {output ? (
              <pre className="text-gray-300 whitespace-pre-wrap">{output}</pre>
            ) : (
              <p className="text-gray-500 italic">Output will appear here...</p>
            )}
            {isRunning && (
              <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-1" />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
          >
            Close
          </button>
          {isRunning ? (
            <button
              onClick={handleStop}
              className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <rect x="6" y="6" width="8" height="8" />
              </svg>
              Stop
            </button>
          ) : (
            <button
              onClick={handleExecute}
              disabled={selectedTool === 'custom' && !customCommand}
              className="px-6 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Execute
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
