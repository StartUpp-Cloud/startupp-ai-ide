/**
 * Authenticated fetch wrapper.
 *
 * Fetches the API token from /api/auth/token on first call (same-origin only),
 * then injects the Authorization header into all subsequent /api/ requests.
 *
 * Usage: import and call installAuthFetch() once at app startup.
 * All existing fetch() calls will automatically include the token.
 */

let _token = null;
let _tokenPromise = null;

async function ensureToken() {
  if (_token) return _token;
  if (_tokenPromise) return _tokenPromise;

  _tokenPromise = fetch('/api/auth/token')
    .then(r => r.json())
    .then(data => {
      _token = data.token;
      _tokenPromise = null;
      return _token;
    })
    .catch(() => {
      _tokenPromise = null;
      return null;
    });

  return _tokenPromise;
}

/**
 * Monkey-patches window.fetch to inject the auth token on /api/ requests.
 * Call once during app initialization (e.g., in main.jsx or App.jsx).
 */
export function installAuthFetch() {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    // Only add auth to our API calls
    if (url.startsWith('/api/') && !url.startsWith('/api/auth/token')) {
      const token = await ensureToken();
      if (token) {
        const headers = new Headers(init.headers || {});
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        init = { ...init, headers };
      }
    }

    return originalFetch(input, init);
  };
}

/**
 * Get the current token (for WebSocket auth or manual use).
 */
export async function getAuthToken() {
  return ensureToken();
}
