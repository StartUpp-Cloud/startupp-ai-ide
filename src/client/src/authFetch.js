/**
 * Authenticated fetch wrapper.
 * Fetches the API token once at startup, then injects it into all /api/ requests.
 */

let _token = null;
let _originalFetch = null;

/**
 * Install the auth fetch wrapper. Call once at app startup.
 */
export function installAuthFetch() {
  _originalFetch = window.fetch.bind(window);

  // Fetch token immediately using the ORIGINAL fetch (not the patched one)
  _originalFetch('/api/auth/token')
    .then(r => r.json())
    .then(data => { _token = data.token; })
    .catch(() => {});

  // Patch window.fetch
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    // Add auth header to /api/ calls (except the token endpoint itself)
    if (_token && url.startsWith('/api/') && !url.startsWith('/api/auth/token')) {
      const headers = new Headers(init.headers || {});
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${_token}`);
      }
      init = { ...init, headers };
    }

    return _originalFetch(input, init);
  };
}

/**
 * Get the current token.
 */
export function getAuthToken() {
  return _token;
}
