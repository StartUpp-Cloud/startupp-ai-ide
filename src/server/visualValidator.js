/**
 * visualValidator — host-side, post-deploy visual validation.
 *
 * The orchestrator runs on the HOST and can reach the deployed domain and drive
 * a real browser (Chrome via CDP) — which the container-bound agent cannot. When
 * the user toggles "validate visually", after the work is done we load the
 * deployed URL, optionally log in with a configured test user, capture a
 * screenshot + console errors + network/HTTP signals, and return a verdict. The
 * orchestrator feeds failures back to the AI agent.
 *
 * Everything is best-effort: if Chrome/CDP isn't available or anything throws,
 * we return { available:false } and the run proceeds untouched. This is the last
 * tier, gated and off by default.
 */

import { WebSocket } from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = path.join(__dirname, '../../data/screenshots');
const CDP_HOST = process.env.CDP_HOST || 'http://localhost:9222';

async function httpJson(url, { method = 'GET', timeoutMs = 5000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, signal: ctrl.signal });
    return res.ok ? await res.json().catch(() => null) : null;
  } catch { return null; } finally { clearTimeout(t); }
}

export async function chromeReachable() {
  return !!(await httpJson(`${CDP_HOST}/json/version`, { timeoutMs: 2500 }));
}

/** Minimal persistent CDP session over a target's WebSocket. */
class CDPSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this._id = 0;
    this._pending = new Map();
    this.events = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      const to = setTimeout(() => reject(new Error('CDP connect timeout')), 8000);
      this.ws.on('open', () => { clearTimeout(to); resolve(); });
      this.ws.on('error', (e) => { clearTimeout(to); reject(e); });
      this.ws.on('message', (raw) => {
        let m; try { m = JSON.parse(raw.toString()); } catch { return; }
        if (m.id && this._pending.has(m.id)) {
          const { resolve: r, reject: j } = this._pending.get(m.id);
          this._pending.delete(m.id);
          m.error ? j(new Error(m.error.message)) : r(m.result);
        } else if (m.method) {
          this.events.push(m);
        }
      });
    });
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      try { this.ws.send(JSON.stringify({ id, method, params })); } catch (e) { reject(e); return; }
      setTimeout(() => { if (this._pending.has(id)) { this._pending.delete(id); reject(new Error(`${method} timeout`)); } }, timeoutMs);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

function waitMs(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Generic best-effort login: fill the first email/username + password fields and
// submit. Works for standard forms; failures are non-fatal (we still validate
// whatever page renders).
const LOGIN_SCRIPT = (username, password) => `
(() => {
  const u = ${JSON.stringify(username)}, p = ${JSON.stringify(password)};
  const q = (sels) => sels.map(s => document.querySelector(s)).find(Boolean);
  const userEl = q(['input[type=email]','input[name*=email i]','input[name*=user i]','input[autocomplete=username]','input[type=text]']);
  const passEl = q(['input[type=password]','input[name*=pass i]','input[autocomplete=current-password]']);
  if (!passEl) return 'no-password-field';
  if (userEl) { userEl.focus(); userEl.value = u; userEl.dispatchEvent(new Event('input',{bubbles:true})); userEl.dispatchEvent(new Event('change',{bubbles:true})); }
  passEl.focus(); passEl.value = p; passEl.dispatchEvent(new Event('input',{bubbles:true})); passEl.dispatchEvent(new Event('change',{bubbles:true}));
  const form = passEl.closest('form');
  const btn = (form||document).querySelector('button[type=submit], input[type=submit], button');
  if (btn) { btn.click(); return 'clicked'; }
  if (form) { form.submit(); return 'submitted'; }
  return 'filled-no-submit';
})()
`;

/**
 * Load a URL (optionally logging in), and return validation evidence.
 * @returns {Promise<object>} { available, passed, url, httpStatus, title, blank,
 *   consoleErrors[], failedRequests[], loginResult, screenshotPath, summary }
 */
// Recipe-based login: use the project-configured selectors. More reliable than
// the generic heuristic for custom/SSO-ish forms.
const RECIPE_LOGIN_SCRIPT = (recipe, username, password) => `
(() => {
  const u = ${JSON.stringify(username)}, p = ${JSON.stringify(password)};
  const uSel = ${JSON.stringify(recipe.usernameSelector || '')};
  const pSel = ${JSON.stringify(recipe.passwordSelector || '')};
  const sSel = ${JSON.stringify(recipe.submitSelector || '')};
  const fire = (el) => { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
  const uEl = uSel ? document.querySelector(uSel) : null;
  const pEl = pSel ? document.querySelector(pSel) : null;
  if (uEl) { uEl.focus(); uEl.value = u; fire(uEl); }
  if (pEl) { pEl.focus(); pEl.value = p; fire(pEl); }
  if (!pEl) return 'password-field-not-found';
  const btn = sSel ? document.querySelector(sSel) : ((pEl.closest('form')||document).querySelector('button[type=submit], input[type=submit], button'));
  if (btn) { btn.click(); return 'clicked'; }
  const form = pEl.closest('form'); if (form) { form.submit(); return 'submitted'; }
  return 'filled-no-submit';
})()
`;

function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

export async function validateDeployedUrl({ url, username = null, password = null, label = 'page', goal = null, loginRecipe = null }) {
  if (!url) return { available: false, reason: 'no url' };
  if (!(await chromeReachable())) return { available: false, reason: 'chrome/CDP not reachable on host' };

  let target = await httpJson(`${CDP_HOST}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  if (!target?.webSocketDebuggerUrl) target = await httpJson(`${CDP_HOST}/json/new?${encodeURIComponent('about:blank')}`, { method: 'GET' });
  if (!target?.webSocketDebuggerUrl) return { available: false, reason: 'could not open a tab' };

  const sess = new CDPSession(target.webSocketDebuggerUrl);
  const evidence = { available: true, url, consoleErrors: [], failedRequests: [], httpStatus: null, title: '', blank: true, loginResult: null, screenshotPath: null };
  try {
    await sess.connect();
    await sess.send('Page.enable').catch(() => {});
    await sess.send('Runtime.enable').catch(() => {});
    await sess.send('Log.enable').catch(() => {});
    await sess.send('Network.enable').catch(() => {});

    const navAndSettle = async (target) => {
      await sess.send('Page.navigate', { url: target }).catch(() => {});
      // settle: wait for load event or timeout
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (sess.events.some((e) => e.method === 'Page.loadEventFired')) break;
        await waitMs(250);
      }
      await waitMs(1200); // let client-side render/XHR settle
    };

    sess.events.length = 0;
    await navAndSettle(url);

    // Capture top-level HTTP status for the document.
    const mainDoc = sess.events.filter((e) => e.method === 'Network.responseReceived' && e.params?.type === 'Document').pop();
    if (mainDoc) evidence.httpStatus = mainDoc.params?.response?.status ?? null;

    // Optional login, then re-navigate to the target page.
    if (username && password) {
      // If a login path is configured, go there first.
      if (loginRecipe?.path) {
        try { sess.events.length = 0; await navAndSettle(new URL(loginRecipe.path, url).href); } catch {}
      }
      const expression = loginRecipe?.passwordSelector
        ? RECIPE_LOGIN_SCRIPT(loginRecipe, username, password)
        : LOGIN_SCRIPT(username, password);
      const r = await sess.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).catch(() => null);
      evidence.loginResult = r?.result?.value || 'login-eval-failed';
      await waitMs(2500);
      // Wait for a success marker if configured.
      if (loginRecipe?.successSelector) {
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const ok = await sess.send('Runtime.evaluate', { expression: `!!document.querySelector(${JSON.stringify(loginRecipe.successSelector)})`, returnByValue: true }).catch(() => null);
          if (ok?.result?.value) break;
          await waitMs(400);
        }
      }
      sess.events.length = 0;
      await navAndSettle(url);
    }

    // Console errors + uncaught exceptions.
    for (const e of sess.events) {
      if (e.method === 'Log.entryAdded' && e.params?.entry?.level === 'error') {
        evidence.consoleErrors.push({ text: e.params.entry.text, url: e.params.entry.url });
      }
      if (e.method === 'Runtime.exceptionThrown') {
        const ex = e.params?.exceptionDetails;
        evidence.consoleErrors.push({ text: ex?.exception?.description || ex?.text || 'Uncaught exception', url: ex?.url });
      }
      if (e.method === 'Network.responseReceived' && (e.params?.response?.status >= 500)) {
        evidence.failedRequests.push({ url: e.params.response.url, status: e.params.response.status });
      }
      if (e.method === 'Network.loadingFailed' && e.params?.type !== 'Image') {
        evidence.failedRequests.push({ url: e.params?.request?.url, error: e.params?.errorText });
      }
    }

    const title = await sess.send('Runtime.evaluate', { expression: 'document.title', returnByValue: true }).catch(() => null);
    evidence.title = title?.result?.value || '';
    const bodyLen = await sess.send('Runtime.evaluate', { expression: '((document.body&&document.body.innerText)||"").trim().length', returnByValue: true }).catch(() => null);
    evidence.blank = (bodyLen?.result?.value || 0) < 20;

    // Screenshot.
    const shot = await sess.send('Page.captureScreenshot', { format: 'png' }).catch(() => null);
    if (shot?.data) {
      try {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
        const filename = `validate-${label.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}.png`;
        const filePath = path.join(SCREENSHOTS_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
        evidence.screenshotPath = `data/screenshots/${filename}`;
      } catch {}
    }

    await sess.send('Target.closeTarget', { targetId: target.id }).catch(() => {});

    // Vision assessment: does the page actually implement the request? Uses a
    // vision-capable model if one is configured (best-effort; skipped otherwise).
    if (goal && shot?.data) {
      try {
        const { llmProvider } = await import('./llmProvider.js');
        const sys = 'You are a meticulous QA reviewer. You receive a screenshot of a web page that was just changed/deployed, plus the change that was requested. Decide whether the page CORRECTLY and COMPLETELY implements the request and looks visually correct (no broken layout, error/empty states, or missing elements). Respond with ONLY JSON: {"matches": true|false, "confidence": 0.0, "issues": ["specific, actionable problems"], "notes": "one short sentence"}.';
        const prompt = `REQUESTED CHANGE:\n${String(goal).slice(0, 1800)}\n\nDoes the page in the screenshot correctly and completely implement this? Be specific about anything missing, wrong, or broken. If it clearly does, matches=true with an empty issues list.`;
        const vr = await llmProvider.generateVisionResponse({ prompt, systemPrompt: sys, imageBase64: shot.data, maxTokens: 600 });
        if (vr?.response) {
          const parsed = extractJson(vr.response);
          if (parsed) {
            evidence.intentMatch = {
              assessed: true,
              matches: parsed.matches !== false,
              confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
              issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8).map(String) : [],
              notes: String(parsed.notes || '').slice(0, 300),
            };
          }
        } else {
          evidence.intentMatch = { assessed: false, reason: vr?.error || 'no vision provider' };
        }
      } catch (e) {
        evidence.intentMatch = { assessed: false, reason: e.message };
      }
    }
  } catch (err) {
    evidence.error = err.message;
  } finally {
    sess.close();
  }

  // Verdict: deterministic (loads, not blank, no console errors / 5xx) AND, when
  // a vision model assessed it, that the page matches the request.
  const httpOk = evidence.httpStatus == null || (evidence.httpStatus >= 200 && evidence.httpStatus < 400);
  const deterministicPass = httpOk && !evidence.blank && evidence.consoleErrors.length === 0 && evidence.failedRequests.length === 0;
  const intentOk = !evidence.intentMatch?.assessed || evidence.intentMatch.matches !== false;
  evidence.passed = deterministicPass && intentOk;
  const intentIssues = evidence.intentMatch?.assessed && !evidence.intentMatch.matches
    ? `doesn't match the request (${(evidence.intentMatch.issues || []).slice(0, 2).join('; ') || evidence.intentMatch.notes || 'visual mismatch'})`
    : null;
  evidence.summary = evidence.passed
    ? `Loaded cleanly${evidence.title ? ` ("${evidence.title}")` : ''}, no errors${evidence.intentMatch?.assessed ? ', and matches the request' : ''}.`
    : [
        !httpOk ? `HTTP ${evidence.httpStatus}` : null,
        evidence.blank ? 'page rendered blank/empty' : null,
        evidence.consoleErrors.length ? `${evidence.consoleErrors.length} console error(s)` : null,
        evidence.failedRequests.length ? `${evidence.failedRequests.length} failed request(s)` : null,
        intentIssues,
      ].filter(Boolean).join('; ');
  return evidence;
}

/** Format evidence into actionable feedback for the AI agent. */
export function buildVisualFeedback(evidence, url) {
  const lines = [`VISUAL VALIDATION FAILED for the deployed change at ${url}.`, '', `Result: ${evidence.summary}`];
  if (evidence.httpStatus && (evidence.httpStatus < 200 || evidence.httpStatus >= 400)) lines.push(`- Top-level HTTP status: ${evidence.httpStatus}`);
  if (evidence.blank) lines.push('- The page rendered blank or nearly empty (likely a JS crash or failed build/asset).');
  if (evidence.loginResult && evidence.loginResult !== 'clicked' && evidence.loginResult !== 'submitted') lines.push(`- Automated login result: ${evidence.loginResult} (could not complete login automatically).`);
  for (const e of (evidence.consoleErrors || []).slice(0, 10)) lines.push(`- Console error: ${e.text}${e.url ? ` (${e.url})` : ''}`);
  for (const f of (evidence.failedRequests || []).slice(0, 10)) lines.push(`- Failed request: ${f.url || ''} ${f.status || f.error || ''}`);
  if (evidence.intentMatch?.assessed && !evidence.intentMatch.matches) {
    lines.push('- A visual review of the screenshot says the page does NOT correctly implement the request:');
    for (const issue of (evidence.intentMatch.issues || []).slice(0, 8)) lines.push(`    • ${issue}`);
    if (evidence.intentMatch.notes) lines.push(`    (${evidence.intentMatch.notes})`);
  }
  lines.push('', 'Investigate the root cause and FIX it so the deployed page loads cleanly, with no console errors, and correctly implements the request. Re-deploy if your fix requires it; it will be re-validated.');
  return lines.join('\n');
}
