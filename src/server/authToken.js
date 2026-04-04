/**
 * Local API authentication.
 *
 * Generates a random bearer token on first run and stores it in data/.api-token.
 * The frontend reads it from a meta endpoint and includes it in all requests.
 * This prevents other local processes from calling the API.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, '../../data/.api-token');

let _token = null;

/**
 * Get or generate the API token.
 */
export function getToken() {
  if (_token) return _token;

  if (fs.existsSync(TOKEN_PATH)) {
    _token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
    if (_token) return _token;
  }

  // Generate a new token
  _token = crypto.randomBytes(32).toString('hex');
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_PATH, _token, { encoding: 'utf-8', mode: 0o600 });
  return _token;
}

/**
 * Express middleware that validates the bearer token.
 * Skips auth for:
 *   - The token endpoint itself (/api/auth/token)
 *   - Static file serving
 *   - Health check
 *   - WebSocket upgrade (handled separately)
 */
export function authMiddleware(req, res, next) {
  // Skip non-API routes (static files, etc.)
  if (!req.path.startsWith('/api/')) return next();

  // Skip the token endpoint (frontend fetches token from here via same-origin)
  if (req.path === '/api/auth/token') return next();

  // Skip health check
  if (req.path === '/api/health') return next();

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (token !== getToken()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}
