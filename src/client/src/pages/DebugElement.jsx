import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Camera, Monitor, MousePointer, AlertCircle, Copy, Check,
  Paperclip, RefreshCw, Loader2, ExternalLink, XCircle, Terminal, Image,
  Upload, Zap, Chrome,
} from 'lucide-react';

// ─── Constants ───────────────────────────────────────────────────────────────

const CONNECTION_STATUS = {
  checking: 'checking',
  connected: 'connected',
  disconnected: 'disconnected',
};

const CAPTURE_STATUS = {
  idle: 'idle',
  capturing: 'capturing',
  done: 'done',
  error: 'error',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function formatCopyText({ url, screenshotPath, element, consoleErrors }) {
  const lines = ['## Debug Capture'];
  if (url) lines.push(`URL: ${url}`);
  if (screenshotPath) lines.push(`Screenshot: ${screenshotPath}`);

  if (element) {
    lines.push('', '### Selected Element');
    if (element.selector) lines.push(`Selector: ${element.selector}`);
    if (element.tag) lines.push(`Tag: ${element.tag}`);
    if (element.classes?.length) lines.push(`Classes: ${element.classes.join(', ')}`);
    if (element.text) lines.push(`Text: "${truncate(element.text, 200)}"`);
  }

  if (consoleErrors?.length > 0) {
    lines.push('', `### Console Errors (${consoleErrors.length})`);
    consoleErrors.forEach((err, i) => {
      lines.push(`${i + 1}. ${err.text || err.message || err}`);
    });
  }

  return lines.join('\n');
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DebugElement() {
  const navigate = useNavigate();
  const imgRef = useRef(null);

  // Connection
  const [connectionStatus, setConnectionStatus] = useState(CONNECTION_STATUS.checking);

  // Tabs
  const [tabs, setTabs] = useState([]);
  const [selectedTab, setSelectedTab] = useState(null);

  // Capture
  const [captureStatus, setCaptureStatus] = useState(CAPTURE_STATUS.idle);
  const [captureError, setCaptureError] = useState(null);
  const [screenshot, setScreenshot] = useState(null); // base64 data URL
  const [screenshotPath, setScreenshotPath] = useState(null);
  const [screenshotDimensions, setScreenshotDimensions] = useState({ width: 0, height: 0 });
  const [consoleErrors, setConsoleErrors] = useState([]);
  const [pageUrl, setPageUrl] = useState('');

  // Element inspection
  const [inspecting, setInspecting] = useState(false);
  const [selectedElement, setSelectedElement] = useState(null);
  const [clickMarker, setClickMarker] = useState(null); // { x, y } relative to displayed image (%)

  // Manual capture mode
  const [manualMode, setManualMode] = useState(false);
  const [manualScreenshot, setManualScreenshot] = useState(null); // data URL
  const [manualUrl, setManualUrl] = useState('');
  const [manualErrors, setManualErrors] = useState('');
  const [launchingChrome, setLaunchingChrome] = useState(false);
  const [launchMessage, setLaunchMessage] = useState(null);

  // UI
  const [copied, setCopied] = useState(false);

  // ── Connection check ────────────────────────────────────────────────────

  const checkConnection = useCallback(async () => {
    setConnectionStatus(CONNECTION_STATUS.checking);
    try {
      const res = await fetch('/api/debug/status');
      if (!res.ok) throw new Error('Status check failed');
      const data = await res.json();
      if (data.connected) {
        setConnectionStatus(CONNECTION_STATUS.connected);
        fetchTabs();
      } else {
        setConnectionStatus(CONNECTION_STATUS.disconnected);
      }
    } catch {
      setConnectionStatus(CONNECTION_STATUS.disconnected);
    }
  }, []);

  const fetchTabs = useCallback(async () => {
    try {
      const res = await fetch('/api/debug/tabs');
      if (!res.ok) throw new Error('Failed to fetch tabs');
      const data = await res.json();
      setTabs(data.tabs || []);
    } catch {
      setTabs([]);
    }
  }, []);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // ── Capture ─────────────────────────────────────────────────────────────

  const runCapture = useCallback(async (tab) => {
    if (!tab?.wsUrl) return;

    setCaptureStatus(CAPTURE_STATUS.capturing);
    setCaptureError(null);
    setSelectedElement(null);
    setClickMarker(null);

    try {
      const res = await fetch('/api/debug/full-capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wsUrl: tab.wsUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Capture failed (${res.status})`);
      }

      const data = await res.json();

      setScreenshot(data.screenshot ? `data:image/png;base64,${data.screenshot}` : null);
      setScreenshotPath(data.screenshotPath || null);
      setConsoleErrors(data.consoleErrors || []);
      setPageUrl(data.url || tab.url || '');
      setCaptureStatus(CAPTURE_STATUS.done);

      // Get natural image dimensions once it loads
      if (data.screenshot) {
        const img = new window.Image();
        img.onload = () => {
          setScreenshotDimensions({ width: img.naturalWidth, height: img.naturalHeight });
        };
        img.src = `data:image/png;base64,${data.screenshot}`;
      }
    } catch (err) {
      setCaptureError(err.message);
      setCaptureStatus(CAPTURE_STATUS.error);
    }
  }, []);

  // Auto-capture when a tab is selected
  useEffect(() => {
    if (selectedTab) {
      runCapture(selectedTab);
    }
  }, [selectedTab, runCapture]);

  // ── Element inspection ──────────────────────────────────────────────────

  const handleScreenshotClick = useCallback(async (e) => {
    if (!imgRef.current || !selectedTab?.wsUrl || !screenshot) return;

    const rect = imgRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    // Scale to actual screenshot pixel dimensions
    const scaleX = screenshotDimensions.width / rect.width;
    const scaleY = screenshotDimensions.height / rect.height;
    const x = Math.round(relX * scaleX);
    const y = Math.round(relY * scaleY);

    // Show click marker as percentage for responsive positioning
    setClickMarker({
      left: (relX / rect.width) * 100,
      top: (relY / rect.height) * 100,
    });

    setInspecting(true);
    setSelectedElement(null);

    try {
      const res = await fetch('/api/debug/element-at-point', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wsUrl: selectedTab.wsUrl, x, y }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to inspect element');
      }

      const data = await res.json();
      setSelectedElement(data);
    } catch (err) {
      setSelectedElement({ error: err.message });
    } finally {
      setInspecting(false);
    }
  }, [selectedTab, screenshot, screenshotDimensions]);

  // ── Actions ─────────────────────────────────────────────────────────────

  const handleCopyAll = useCallback(async () => {
    const text = formatCopyText({
      url: pageUrl,
      screenshotPath,
      element: selectedElement,
      consoleErrors,
    });

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [pageUrl, screenshotPath, selectedElement, consoleErrors]);

  const handleAttachToIDE = useCallback(() => {
    const payload = {
      type: 'debug-capture',
      timestamp: new Date().toISOString(),
      url: pageUrl,
      screenshotPath,
      screenshot,
      element: selectedElement,
      consoleErrors,
    };

    // Try postMessage to opener first, fall back to localStorage
    if (window.opener) {
      window.opener.postMessage({ action: 'debug-capture', payload }, '*');
    }

    localStorage.setItem('debug-capture', JSON.stringify(payload));
    navigate('/');
  }, [pageUrl, screenshotPath, screenshot, selectedElement, consoleErrors, navigate]);

  // ── Launch Chrome ──────────────────────────────────────────────────────

  const launchChrome = useCallback(async () => {
    setLaunchingChrome(true);
    setLaunchMessage(null);
    try {
      const res = await fetch('/api/debug/launch-chrome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok) {
        setLaunchMessage({ type: 'success', text: data.message });
        // Re-check connection after a moment
        setTimeout(checkConnection, 2000);
      } else {
        setLaunchMessage({ type: 'error', text: data.message || data.error });
      }
    } catch (err) {
      setLaunchMessage({ type: 'error', text: err.message });
    } finally {
      setLaunchingChrome(false);
    }
  }, [checkConnection]);

  // ── Manual capture helpers ────────────────────────────────────────────

  const handleManualPaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => setManualScreenshot(ev.target.result);
        reader.readAsDataURL(file);
        return;
      }
    }
  }, []);

  const handleManualDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file?.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setManualScreenshot(ev.target.result);
      reader.readAsDataURL(file);
    }
  }, []);

  const handleManualFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file?.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setManualScreenshot(ev.target.result);
      reader.readAsDataURL(file);
    }
  }, []);

  const handleManualAttach = useCallback(async () => {
    // Save screenshot server-side if present
    let savedPath = null;
    if (manualScreenshot) {
      try {
        const res = await fetch('/api/debug/save-screenshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ screenshot: manualScreenshot }),
        });
        const data = await res.json();
        savedPath = data.path;
      } catch {}
    }

    const errors = manualErrors.trim()
      ? manualErrors.trim().split('\n').map(line => ({ text: line }))
      : [];

    const payload = {
      type: 'debug-capture',
      timestamp: new Date().toISOString(),
      url: manualUrl,
      screenshotPath: savedPath,
      screenshot: manualScreenshot,
      element: null,
      consoleErrors: errors,
    };

    if (window.opener) {
      window.opener.postMessage({ action: 'debug-capture', payload }, '*');
    }
    localStorage.setItem('debug-capture', JSON.stringify(payload));
    navigate('/');
  }, [manualScreenshot, manualUrl, manualErrors, navigate]);

  const handleManualCopy = useCallback(async () => {
    const errors = manualErrors.trim()
      ? manualErrors.trim().split('\n').map(line => ({ text: line }))
      : [];
    const text = formatCopyText({
      url: manualUrl,
      screenshotPath: null,
      element: null,
      consoleErrors: errors,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [manualUrl, manualErrors]);

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-950 text-surface-100 flex flex-col">
      {/* ── Header ── */}
      <header className="flex-shrink-0 border-b border-surface-700/60 bg-surface-900/80 backdrop-blur-md">
        <div className="flex items-center justify-between px-5 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="btn-ghost !px-2.5 !py-1.5 !gap-1.5 !text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to IDE
            </button>

            <div className="h-5 w-px bg-surface-700" />

            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
                <Monitor className="w-3.5 h-3.5 text-white" />
              </div>
              <h1 className="font-display font-semibold text-white text-base tracking-tight">
                Debug Element
              </h1>
            </div>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2">
            {connectionStatus === CONNECTION_STATUS.checking && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-800 rounded-lg">
                <Loader2 className="w-3.5 h-3.5 text-surface-400 animate-spin" />
                <span className="text-xs text-surface-400">Checking...</span>
              </div>
            )}
            {connectionStatus === CONNECTION_STATUS.connected && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-xs font-medium text-emerald-300">Chrome Connected</span>
              </div>
            )}
            {connectionStatus === CONNECTION_STATUS.disconnected && (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                  <div className="w-2 h-2 rounded-full bg-rose-400" />
                  <span className="text-xs font-medium text-rose-300">Not Connected</span>
                </div>
                <button
                  onClick={checkConnection}
                  className="btn-ghost !px-2 !py-1.5"
                  title="Retry connection"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Disconnected state ── */}
      {connectionStatus === CONNECTION_STATUS.disconnected && !manualMode && (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-lg text-center space-y-6">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-surface-800 border border-surface-700 flex items-center justify-center">
              <Monitor className="w-8 h-8 text-surface-400" />
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold text-white mb-2">
                Debug Element
              </h2>
              <p className="text-sm text-surface-400 leading-relaxed">
                Capture screenshots, inspect elements, and collect console errors from your app.
              </p>
            </div>

            {/* Option 1: Auto-launch Chrome */}
            <div className="bg-surface-900 border border-surface-700 rounded-lg p-5 text-left space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary-400" />
                <span className="text-sm font-medium text-surface-200">Auto-connect to Chrome</span>
              </div>
              <p className="text-xs text-surface-400">
                Launches Chrome with remote debugging for live element inspection and screenshots.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={launchChrome}
                  disabled={launchingChrome}
                  className="btn-primary !px-4 !py-2 !text-sm"
                >
                  {launchingChrome ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Launching...</>
                  ) : (
                    <><Monitor className="w-4 h-4" /> Launch Chrome</>
                  )}
                </button>
                <button
                  onClick={checkConnection}
                  className="btn-ghost !px-3 !py-2 !text-sm"
                  title="Check if Chrome is already running with debugging"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              </div>
              {launchMessage && (
                <p className={`text-xs ${launchMessage.type === 'error' ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {launchMessage.text}
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-surface-700" />
              <span className="text-xs text-surface-500 font-medium">or</span>
              <div className="flex-1 h-px bg-surface-700" />
            </div>

            {/* Option 2: Manual capture */}
            <div className="bg-surface-900 border border-surface-700 rounded-lg p-5 text-left space-y-3">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-cyan-400" />
                <span className="text-sm font-medium text-surface-200">Manual Capture</span>
              </div>
              <p className="text-xs text-surface-400">
                Paste a screenshot and console errors manually — no Chrome setup required.
              </p>
              <button
                onClick={() => setManualMode(true)}
                className="btn-secondary !px-4 !py-2 !text-sm"
              >
                <Camera className="w-4 h-4" />
                Open Manual Capture
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manual capture mode ── */}
      {manualMode && connectionStatus !== CONNECTION_STATUS.connected && (
        <div className="flex-1 flex min-h-0">
          {/* Left: screenshot drop zone */}
          <div
            className="flex-1 min-w-0 flex flex-col border-r border-surface-700/60"
            onPaste={handleManualPaste}
            onDrop={handleManualDrop}
            onDragOver={(e) => e.preventDefault()}
          >
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-surface-900/40 border-b border-surface-700/40">
              <div className="flex items-center gap-2">
                <Camera className="w-3.5 h-3.5 text-surface-500" />
                <span className="text-xs font-medium text-surface-400">Screenshot</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setManualMode(false)}
                  className="btn-ghost !px-2 !py-1 !text-xs"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Back
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-auto p-4 flex items-center justify-center">
              {manualScreenshot ? (
                <div className="relative inline-block">
                  <img
                    src={manualScreenshot}
                    alt="Manual screenshot"
                    className="max-w-full h-auto rounded-lg border border-surface-700/60 shadow-card"
                    draggable={false}
                  />
                  <button
                    onClick={() => setManualScreenshot(null)}
                    className="absolute top-2 right-2 p-1 bg-surface-900/80 border border-surface-700 rounded-lg hover:bg-surface-800 transition-colors"
                  >
                    <X className="w-4 h-4 text-surface-400" />
                  </button>
                </div>
              ) : (
                <div className="text-center space-y-4 max-w-sm">
                  <div className="w-20 h-20 mx-auto rounded-2xl bg-surface-800 border-2 border-dashed border-surface-600 flex items-center justify-center">
                    <Upload className="w-8 h-8 text-surface-500" />
                  </div>
                  <div>
                    <p className="text-sm text-surface-300 font-medium mb-1">
                      Paste or drop a screenshot
                    </p>
                    <p className="text-xs text-surface-500">
                      Press <kbd className="px-1.5 py-0.5 bg-surface-800 border border-surface-600 rounded text-[10px] font-mono">Ctrl+V</kbd> to paste from clipboard, or drag an image file here
                    </p>
                  </div>
                  <label className="btn-secondary !px-4 !py-2 !text-sm cursor-pointer inline-flex items-center gap-2">
                    <Image className="w-4 h-4" />
                    Choose File
                    <input type="file" accept="image/*" className="hidden" onChange={handleManualFileSelect} />
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Right: URL + errors + actions */}
          <div className="w-[380px] flex-shrink-0 flex flex-col bg-surface-900/30 overflow-y-auto">
            <div className="p-4 space-y-5">
              {/* URL */}
              <section>
                <label className="text-[10px] text-surface-500 uppercase tracking-wider block mb-1.5">
                  Page URL
                </label>
                <input
                  type="text"
                  value={manualUrl}
                  onChange={(e) => setManualUrl(e.target.value)}
                  placeholder="http://localhost:3000/page"
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-850 border border-surface-700 rounded-lg text-surface-200 placeholder-surface-600 focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none"
                />
              </section>

              <div className="border-t border-surface-700/60" />

              {/* Console errors */}
              <section>
                <div className="flex items-center gap-2 mb-1.5">
                  <Terminal className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-[10px] text-surface-500 uppercase tracking-wider">
                    Console Errors
                  </span>
                </div>
                <textarea
                  value={manualErrors}
                  onChange={(e) => setManualErrors(e.target.value)}
                  rows={8}
                  placeholder="Paste console errors here (one per line)..."
                  className="w-full px-3 py-2 text-[11px] font-mono bg-surface-850 border border-surface-700 rounded-lg text-rose-300 placeholder-surface-600 focus:ring-1 focus:ring-primary-500/50 focus:border-primary-500/50 outline-none resize-none leading-relaxed"
                />
              </section>

              <div className="border-t border-surface-700/60" />

              {/* Actions */}
              <section>
                <h3 className="text-xs font-semibold text-surface-300 uppercase tracking-wider mb-3">
                  Actions
                </h3>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleManualCopy}
                    className="btn-secondary !text-xs !px-3 !py-2"
                  >
                    {copied ? (
                      <><Check className="w-3.5 h-3.5 text-emerald-400" /><span className="text-emerald-300">Copied!</span></>
                    ) : (
                      <><Copy className="w-3.5 h-3.5" />Copy All</>
                    )}
                  </button>
                  <button
                    onClick={handleManualAttach}
                    disabled={!manualScreenshot && !manualErrors.trim()}
                    className="btn-primary !text-xs !px-3 !py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Attach to IDE
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* ── Connected state ── */}
      {connectionStatus === CONNECTION_STATUS.connected && (
        <>
          {/* ── Tab bar ── */}
          <div className="flex-shrink-0 border-b border-surface-700/60 bg-surface-900/50">
            <div className="flex items-center gap-2 px-5 py-3 overflow-x-auto">
              <span className="text-[11px] font-medium text-surface-500 uppercase tracking-wider flex-shrink-0">
                Open Tabs
              </span>
              <div className="h-4 w-px bg-surface-700 flex-shrink-0" />

              {tabs.length === 0 && (
                <span className="text-xs text-surface-500 italic">No inspectable tabs found</span>
              )}

              {tabs.map((tab, idx) => {
                const isSelected = selectedTab?.id === tab.id;
                return (
                  <button
                    key={tab.id || idx}
                    onClick={() => setSelectedTab(tab)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left flex-shrink-0 max-w-[280px] transition-all duration-150 ${
                      isSelected
                        ? 'bg-primary-500/10 border-primary-500/30 text-primary-200'
                        : 'bg-surface-800 border-surface-700 text-surface-300 hover:border-surface-600 hover:text-surface-200'
                    }`}
                  >
                    {tab.favIconUrl ? (
                      <img
                        src={tab.favIconUrl}
                        alt=""
                        className="w-4 h-4 rounded flex-shrink-0"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 text-surface-500" />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium truncate">
                        {truncate(tab.title, 35)}
                      </div>
                      <div className="text-[10px] text-surface-500 truncate">
                        {truncate(tab.url, 45)}
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* Refresh tabs */}
              <button
                onClick={fetchTabs}
                className="btn-ghost !p-2 flex-shrink-0"
                title="Refresh tab list"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ── No tab selected ── */}
          {!selectedTab && (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center space-y-3">
                <MousePointer className="w-10 h-10 text-surface-600 mx-auto" />
                <p className="text-sm text-surface-400">Select a tab above to begin debugging</p>
              </div>
            </div>
          )}

          {/* ── Main content ── */}
          {selectedTab && (
            <div className="flex-1 flex min-h-0">
              {/* Left panel — Screenshot */}
              <div className="flex-1 min-w-0 flex flex-col border-r border-surface-700/60">
                {/* Screenshot toolbar */}
                <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 bg-surface-900/40 border-b border-surface-700/40">
                  <div className="flex items-center gap-2">
                    <Camera className="w-3.5 h-3.5 text-surface-500" />
                    <span className="text-xs font-medium text-surface-400">Screenshot</span>
                    {captureStatus === CAPTURE_STATUS.done && pageUrl && (
                      <span className="text-[10px] text-surface-500 font-mono truncate max-w-[300px]">
                        {pageUrl}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => runCapture(selectedTab)}
                      disabled={captureStatus === CAPTURE_STATUS.capturing}
                      className="btn-ghost !px-2 !py-1 !text-xs !gap-1"
                      title="Re-capture"
                    >
                      {captureStatus === CAPTURE_STATUS.capturing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      Re-capture
                    </button>
                  </div>
                </div>

                {/* Screenshot area */}
                <div className="flex-1 min-h-0 overflow-auto p-4 flex items-start justify-center">
                  {captureStatus === CAPTURE_STATUS.capturing && (
                    <div className="flex flex-col items-center justify-center gap-3 py-20">
                      <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
                      <p className="text-sm text-surface-400">Capturing page...</p>
                    </div>
                  )}

                  {captureStatus === CAPTURE_STATUS.error && (
                    <div className="flex flex-col items-center justify-center gap-3 py-20 max-w-sm text-center">
                      <AlertCircle className="w-8 h-8 text-rose-400" />
                      <p className="text-sm text-rose-300">{captureError || 'Capture failed'}</p>
                      <button
                        onClick={() => runCapture(selectedTab)}
                        className="btn-secondary !text-xs !px-4 !py-1.5"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Try Again
                      </button>
                    </div>
                  )}

                  {captureStatus === CAPTURE_STATUS.done && screenshot && (
                    <div className="relative inline-block cursor-crosshair group" onClick={handleScreenshotClick}>
                      <img
                        ref={imgRef}
                        src={screenshot}
                        alt="Page screenshot"
                        className="max-w-full h-auto rounded-lg border border-surface-700/60 shadow-card transition-shadow group-hover:shadow-card-hover"
                        draggable={false}
                      />

                      {/* Click marker overlay */}
                      {clickMarker && (
                        <div
                          className="absolute w-6 h-6 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ left: `${clickMarker.left}%`, top: `${clickMarker.top}%` }}
                        >
                          <div className="w-full h-full rounded-full border-2 border-primary-400 bg-primary-400/20 animate-scale-in" />
                          <div className="absolute inset-0 rounded-full border-2 border-primary-400/50 animate-ping" />
                        </div>
                      )}

                      {/* Inspecting indicator */}
                      {inspecting && (
                        <div className="absolute inset-0 bg-surface-950/30 rounded-lg flex items-center justify-center">
                          <div className="flex items-center gap-2 bg-surface-900/90 border border-surface-700 rounded-lg px-4 py-2">
                            <Loader2 className="w-4 h-4 text-primary-400 animate-spin" />
                            <span className="text-xs text-surface-300">Inspecting element...</span>
                          </div>
                        </div>
                      )}

                      {/* Hint overlay */}
                      {!clickMarker && !inspecting && (
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                          <div className="flex items-center gap-2 bg-surface-950/80 border border-surface-700 rounded-lg px-3 py-2 backdrop-blur-sm">
                            <MousePointer className="w-3.5 h-3.5 text-primary-400" />
                            <span className="text-xs text-surface-300">Click to inspect element</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {captureStatus === CAPTURE_STATUS.done && !screenshot && (
                    <div className="flex flex-col items-center justify-center gap-3 py-20">
                      <Image className="w-8 h-8 text-surface-600" />
                      <p className="text-sm text-surface-500">No screenshot available</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right panel — Captured info */}
              <div className="w-[380px] flex-shrink-0 flex flex-col bg-surface-900/30 overflow-y-auto">
                <div className="p-4 space-y-5">
                  {/* ── Element info ── */}
                  <section>
                    <div className="flex items-center gap-2 mb-3">
                      <MousePointer className="w-3.5 h-3.5 text-primary-400" />
                      <h3 className="text-xs font-semibold text-surface-300 uppercase tracking-wider">
                        Element
                      </h3>
                      {!selectedElement && !inspecting && (
                        <span className="text-[10px] text-surface-500 ml-auto">Click on screenshot</span>
                      )}
                    </div>

                    {inspecting && (
                      <div className="flex items-center gap-2 p-3 bg-surface-800 border border-surface-700 rounded-lg">
                        <Loader2 className="w-3.5 h-3.5 text-primary-400 animate-spin" />
                        <span className="text-xs text-surface-400">Inspecting...</span>
                      </div>
                    )}

                    {!inspecting && selectedElement && !selectedElement.error && (
                      <div className="space-y-2">
                        <InfoRow label="Selector" value={selectedElement.selector} mono />
                        <InfoRow label="Tag" value={selectedElement.tag} />
                        {selectedElement.classes?.length > 0 && (
                          <InfoRow label="Classes" value={selectedElement.classes.join(', ')} mono />
                        )}
                        {selectedElement.id && (
                          <InfoRow label="ID" value={selectedElement.id} mono />
                        )}
                        {selectedElement.text && (
                          <InfoRow label="Text" value={truncate(selectedElement.text, 150)} />
                        )}
                        {selectedElement.outerHTML && (
                          <div>
                            <span className="text-[10px] text-surface-500 uppercase tracking-wider block mb-1">
                              HTML
                            </span>
                            <pre className="text-[11px] font-mono text-surface-300 bg-surface-850 border border-surface-700 rounded-md p-2.5 overflow-x-auto max-h-32 whitespace-pre-wrap break-all leading-relaxed">
                              {truncate(selectedElement.outerHTML, 500)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}

                    {!inspecting && selectedElement?.error && (
                      <div className="flex items-start gap-2 p-3 bg-rose-500/5 border border-rose-500/20 rounded-lg">
                        <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 flex-shrink-0" />
                        <span className="text-xs text-rose-300">{selectedElement.error}</span>
                      </div>
                    )}

                    {!inspecting && !selectedElement && captureStatus === CAPTURE_STATUS.done && (
                      <div className="p-3 bg-surface-800 border border-surface-700/60 rounded-lg">
                        <p className="text-xs text-surface-500 text-center">
                          Click anywhere on the screenshot to inspect an element
                        </p>
                      </div>
                    )}
                  </section>

                  {/* ── Divider ── */}
                  {captureStatus === CAPTURE_STATUS.done && (
                    <div className="border-t border-surface-700/60" />
                  )}

                  {/* ── Console errors ── */}
                  {captureStatus === CAPTURE_STATUS.done && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <Terminal className="w-3.5 h-3.5 text-rose-400" />
                        <h3 className="text-xs font-semibold text-surface-300 uppercase tracking-wider">
                          Console Errors
                        </h3>
                        {consoleErrors.length > 0 && (
                          <span className="ml-auto text-[10px] font-medium text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded">
                            {consoleErrors.length}
                          </span>
                        )}
                      </div>

                      {consoleErrors.length === 0 ? (
                        <div className="p-3 bg-surface-800 border border-surface-700/60 rounded-lg">
                          <p className="text-xs text-surface-500 text-center">
                            No console errors detected
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-60 overflow-y-auto">
                          {consoleErrors.map((err, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2 p-2.5 bg-rose-500/5 border border-rose-500/15 rounded-md"
                            >
                              <XCircle className="w-3 h-3 text-rose-400 mt-0.5 flex-shrink-0" />
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-mono text-rose-300 break-all leading-relaxed">
                                  {err.text || err.message || String(err)}
                                </p>
                                {err.source && (
                                  <p className="text-[10px] font-mono text-surface-500 mt-0.5">
                                    {err.source}
                                    {err.line ? `:${err.line}` : ''}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  )}

                  {/* ── Divider ── */}
                  {captureStatus === CAPTURE_STATUS.done && (
                    <div className="border-t border-surface-700/60" />
                  )}

                  {/* ── Actions ── */}
                  {captureStatus === CAPTURE_STATUS.done && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-xs font-semibold text-surface-300 uppercase tracking-wider">
                          Actions
                        </h3>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={handleCopyAll}
                          className="btn-secondary !text-xs !px-3 !py-2"
                        >
                          {copied ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span className="text-emerald-300">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              Copy All
                            </>
                          )}
                        </button>

                        <button
                          onClick={handleAttachToIDE}
                          className="btn-secondary !text-xs !px-3 !py-2"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                          Attach to IDE
                        </button>

                        {screenshotPath && (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(screenshotPath);
                            }}
                            className="btn-ghost !text-xs !px-3 !py-2"
                            title={screenshotPath}
                          >
                            <Image className="w-3.5 h-3.5" />
                            Screenshot Saved
                          </button>
                        )}
                      </div>

                      {screenshotPath && (
                        <p className="text-[10px] font-mono text-surface-500 mt-2 break-all">
                          {screenshotPath}
                        </p>
                      )}
                    </section>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function InfoRow({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-[10px] text-surface-500 uppercase tracking-wider block mb-0.5">
        {label}
      </span>
      <p className={`text-[12px] leading-relaxed break-all ${
        mono ? 'font-mono text-primary-300' : 'text-surface-200'
      }`}>
        {value}
      </p>
    </div>
  );
}
