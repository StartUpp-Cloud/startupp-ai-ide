import express from "express";
import { WebSocket } from "ws";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Screenshots directory — stored under project data root
const SCREENSHOTS_DIR = path.join(__dirname, "../../../data/screenshots");
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const CDP_HOST = process.env.CDP_HOST || "http://localhost:9222";
const CDP_TIMEOUT = 10000; // 10 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a single CDP command over the tab's WebSocket debug URL.
 * Opens a connection, sends one command, waits for the matching response,
 * then closes the socket.
 */
async function sendCDPCommand(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP command "${method}" timed out after ${CDP_TIMEOUT}ms`));
    }, CDP_TIMEOUT);

    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.id === 1) {
          clearTimeout(timeout);
          ws.close();
          if (msg.error) {
            reject(new Error(msg.error.message));
          } else {
            resolve(msg.result);
          }
        }
        // Ignore events / other messages
      } catch (parseErr) {
        clearTimeout(timeout);
        ws.close();
        reject(parseErr);
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Open a CDP WebSocket, enable one or more domains, collect events for a
 * fixed duration, then close the socket.
 *
 * @param {string}   wsUrl      - Tab WebSocket debug URL
 * @param {string[]} enableCmds - CDP methods to call on open (e.g. ["Runtime.enable"])
 * @param {number}   durationMs - How long to listen for events
 * @param {function} eventFilter - (msg) => truthy value to keep, or falsy to skip
 * @returns {Promise<Array>} collected events that passed the filter
 */
async function collectCDPEvents(wsUrl, enableCmds, durationMs, eventFilter) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const collected = [];
    let cmdId = 0;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("CDP event collection timed out"));
    }, durationMs + CDP_TIMEOUT);

    ws.on("open", () => {
      // Send all enable commands
      for (const method of enableCmds) {
        ws.send(JSON.stringify({ id: ++cmdId, method, params: {} }));
      }
      // After the listening window, close and resolve
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        resolve(collected);
      }, durationMs);
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const value = eventFilter(msg);
        if (value) {
          collected.push(value);
        }
      } catch {
        // Ignore unparseable frames
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Fetch JSON from the CDP HTTP debug endpoint.
 */
async function cdpFetch(urlPath) {
  const url = `${CDP_HOST}${urlPath}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`CDP HTTP ${res.status}: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Resolve a tab's WebSocket debug URL from either an explicit wsUrl or a tabId.
 */
async function resolveWsUrl(body) {
  if (body.wsUrl) return body.wsUrl;
  if (body.tabId) {
    const tabs = await cdpFetch("/json");
    const tab = tabs.find((t) => t.id === body.tabId);
    if (!tab) throw new Error(`Tab ${body.tabId} not found`);
    return tab.webSocketDebuggerUrl;
  }
  throw new Error("Either wsUrl or tabId is required");
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/debug/status
 * Check whether Chrome is running with remote debugging enabled.
 */
router.get("/status", async (req, res) => {
  try {
    const version = await cdpFetch("/json/version");
    res.json({
      connected: true,
      browser: version.Browser || version.browser || null,
      protocolVersion: version["Protocol-Version"] || null,
      userAgent: version["User-Agent"] || null,
      wsUrl: version.webSocketDebuggerUrl || null,
    });
  } catch (err) {
    const platform = os.platform();
    const hint = platform === 'darwin'
      ? 'Launch Chrome: /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222'
      : platform === 'win32'
        ? 'Launch Chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222'
        : 'Launch Chrome: google-chrome --remote-debugging-port=9222  (or run ./scripts/launch-chrome-debug.sh)';

    res.json({
      connected: false,
      error: err.message,
      hint,
      serverOS: platform,
    });
  }
});

/**
 * GET /api/debug/tabs
 * List open Chrome tabs (pages only).
 */
router.get("/tabs", async (req, res) => {
  try {
    const all = await cdpFetch("/json");
    const tabs = all
      .filter((t) => t.type === "page")
      .map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        faviconUrl: t.faviconUrl || null,
        wsUrl: t.webSocketDebuggerUrl,
      }));
    res.json({ tabs });
  } catch (err) {
    res.status(502).json({
      error: "Failed to list Chrome tabs",
      message: err.message,
      hint: "Is Chrome running with --remote-debugging-port=9222?",
    });
  }
});

/**
 * POST /api/debug/screenshot
 * Capture a PNG screenshot of the specified tab.
 *
 * Body: { tabId } or { wsUrl }
 */
router.post("/screenshot", async (req, res) => {
  try {
    const wsUrl = await resolveWsUrl(req.body);

    const result = await sendCDPCommand(wsUrl, "Page.captureScreenshot", {
      format: "png",
      quality: 80,
    });

    if (!result || !result.data) {
      return res.status(500).json({ error: "No screenshot data returned from Chrome" });
    }

    // Save to disk
    const timestamp = Date.now();
    const filename = `screenshot-${timestamp}.png`;
    const filePath = path.join(SCREENSHOTS_DIR, filename);
    fs.writeFileSync(filePath, Buffer.from(result.data, "base64"));

    res.json({
      path: `data/screenshots/${filename}`,
      filename,
      base64: result.data,
    });
  } catch (err) {
    res.status(500).json({
      error: "Failed to capture screenshot",
      message: err.message,
    });
  }
});

/**
 * POST /api/debug/console-errors
 * Capture recent console errors from a tab.
 *
 * Body: { wsUrl } or { tabId }
 *
 * Strategy:
 *  1. Enable Runtime + Log domains
 *  2. Collect Log.entryAdded events with level "error" for 2 seconds
 *  3. Also run Runtime.evaluate to grab any errors the page stored itself
 *  4. Return merged list
 */
router.post("/console-errors", async (req, res) => {
  try {
    const wsUrl = await resolveWsUrl(req.body);

    // --- Phase 1: Collect live error events for 2 seconds ---
    const LISTEN_MS = 2000;
    const liveErrors = await collectCDPEvents(
      wsUrl,
      ["Runtime.enable", "Log.enable"],
      LISTEN_MS,
      (msg) => {
        // Log.entryAdded with level "error"
        if (
          msg.method === "Log.entryAdded" &&
          msg.params?.entry?.level === "error"
        ) {
          const e = msg.params.entry;
          return {
            source: "log",
            text: e.text,
            url: e.url || null,
            line: e.lineNumber || null,
            timestamp: e.timestamp || null,
          };
        }
        // Runtime.exceptionThrown
        if (msg.method === "Runtime.exceptionThrown") {
          const ex = msg.params?.exceptionDetails;
          return {
            source: "exception",
            text:
              ex?.exception?.description ||
              ex?.text ||
              "Unknown runtime exception",
            url: ex?.url || null,
            line: ex?.lineNumber || null,
            column: ex?.columnNumber || null,
            timestamp: msg.params?.timestamp || null,
          };
        }
        return null;
      },
    );

    // --- Phase 2: Evaluate for any page-level captured errors ---
    let pageErrors = [];
    try {
      const evalResult = await sendCDPCommand(wsUrl, "Runtime.evaluate", {
        expression: `
          (function() {
            try {
              return JSON.stringify(window.__capturedErrors || []);
            } catch(e) {
              return '[]';
            }
          })()
        `,
        returnByValue: true,
      });
      if (evalResult?.result?.value) {
        const parsed = JSON.parse(evalResult.result.value);
        if (Array.isArray(parsed)) {
          pageErrors = parsed.map((e) => ({
            source: "page",
            text: typeof e === "string" ? e : e.message || JSON.stringify(e),
            url: e.url || null,
            line: e.line || null,
            timestamp: e.timestamp || null,
          }));
        }
      }
    } catch {
      // Non-critical — page may not expose __capturedErrors
    }

    const errors = [...liveErrors, ...pageErrors];
    res.json({ errors, count: errors.length });
  } catch (err) {
    res.status(500).json({
      error: "Failed to capture console errors",
      message: err.message,
    });
  }
});

/**
 * POST /api/debug/element-at-point
 * Identify the DOM element at the given viewport coordinates.
 *
 * Body: { wsUrl (or tabId), x, y }
 *
 * Uses Runtime.evaluate with document.elementFromPoint to avoid heavy
 * DOM domain setup. Returns selector, tag, attributes, bounding rect, etc.
 */
router.post("/element-at-point", async (req, res) => {
  try {
    const wsUrl = await resolveWsUrl(req.body);
    const { x, y } = req.body;

    if (x == null || y == null) {
      return res.status(400).json({ error: "x and y coordinates are required" });
    }

    const script = `
      (function() {
        var el = document.elementFromPoint(${Number(x)}, ${Number(y)});
        if (!el) return JSON.stringify(null);

        function getSelector(node) {
          if (node.id) return '#' + CSS.escape(node.id);
          var parts = [];
          while (node && node.nodeType === 1) {
            var seg = node.tagName.toLowerCase();
            if (node.id) {
              parts.unshift('#' + CSS.escape(node.id));
              break;
            }
            if (node.className && typeof node.className === 'string') {
              var cls = node.className.trim().split(/\\s+/).filter(Boolean);
              if (cls.length) seg += '.' + cls.map(function(c){ return CSS.escape(c); }).join('.');
            }
            var parent = node.parentElement;
            if (parent) {
              var siblings = Array.from(parent.children).filter(function(c){ return c.tagName === node.tagName; });
              if (siblings.length > 1) seg += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
            }
            parts.unshift(seg);
            node = node.parentElement;
          }
          return parts.join(' > ');
        }

        var rect = el.getBoundingClientRect();
        return JSON.stringify({
          selector: getSelector(el),
          tagName: el.tagName.toLowerCase(),
          id: el.id || null,
          classes: el.className ? el.className.trim().split(/\\s+/).filter(Boolean) : [],
          text: (el.textContent || '').trim().slice(0, 200),
          outerHTML: el.outerHTML.slice(0, 2000),
          attributes: Array.from(el.attributes).reduce(function(acc, a) { acc[a.name] = a.value; return acc; }, {}),
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
        });
      })()
    `;

    const result = await sendCDPCommand(wsUrl, "Runtime.evaluate", {
      expression: script,
      returnByValue: true,
    });

    if (!result?.result?.value) {
      return res.status(404).json({
        error: "No element found at the given coordinates",
        x,
        y,
      });
    }

    const element = JSON.parse(result.result.value);
    if (!element) {
      return res.status(404).json({
        error: "No element found at the given coordinates",
        x,
        y,
      });
    }

    res.json(element);
  } catch (err) {
    res.status(500).json({
      error: "Failed to inspect element",
      message: err.message,
    });
  }
});

/**
 * POST /api/debug/full-capture
 * Convenience endpoint: screenshot + console errors in one call.
 *
 * Body: { tabId } or { wsUrl }
 */
router.post("/full-capture", async (req, res) => {
  try {
    const wsUrl = await resolveWsUrl(req.body);

    // Resolve tab metadata
    let tabMeta = null;
    try {
      const tabs = await cdpFetch("/json");
      // Match by wsUrl or tabId
      tabMeta = tabs.find(
        (t) =>
          t.webSocketDebuggerUrl === wsUrl || t.id === req.body.tabId,
      );
    } catch {
      // Non-critical
    }

    // Run screenshot and console-error capture in parallel
    const [screenshotResult, errorsResult] = await Promise.allSettled([
      (async () => {
        const result = await sendCDPCommand(wsUrl, "Page.captureScreenshot", {
          format: "png",
          quality: 80,
        });
        if (!result?.data) throw new Error("Empty screenshot");
        const timestamp = Date.now();
        const filename = `screenshot-${timestamp}.png`;
        const filePath = path.join(SCREENSHOTS_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(result.data, "base64"));
        return { path: `data/screenshots/${filename}`, filename, base64: result.data };
      })(),
      (async () => {
        const LISTEN_MS = 2000;
        const liveErrors = await collectCDPEvents(
          wsUrl,
          ["Runtime.enable", "Log.enable"],
          LISTEN_MS,
          (msg) => {
            if (
              msg.method === "Log.entryAdded" &&
              msg.params?.entry?.level === "error"
            ) {
              const e = msg.params.entry;
              return { source: "log", text: e.text, url: e.url || null, line: e.lineNumber || null };
            }
            if (msg.method === "Runtime.exceptionThrown") {
              const ex = msg.params?.exceptionDetails;
              return {
                source: "exception",
                text: ex?.exception?.description || ex?.text || "Unknown exception",
                url: ex?.url || null,
                line: ex?.lineNumber || null,
              };
            }
            return null;
          },
        );
        return liveErrors;
      })(),
    ]);

    const screenshot =
      screenshotResult.status === "fulfilled"
        ? screenshotResult.value
        : { error: screenshotResult.reason?.message || "Screenshot failed" };

    const errors =
      errorsResult.status === "fulfilled"
        ? errorsResult.value
        : [];

    res.json({
      screenshot,
      errors,
      tab: tabMeta
        ? { title: tabMeta.title, url: tabMeta.url, id: tabMeta.id }
        : null,
    });
  } catch (err) {
    res.status(500).json({
      error: "Full capture failed",
      message: err.message,
    });
  }
});

export default router;
