/**
 * Field-level encryption for sensitive values stored in db.json.
 *
 * Derives a machine-specific key from hostname + username + a stable salt
 * stored in data/.encryption-salt. This means the data is only decryptable
 * on the same machine by the same OS user.
 *
 * Encrypted values are prefixed with "enc:" so we can detect them.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SALT_PATH = path.join(__dirname, '../../data/.encryption-salt');
const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:';
const VERSIONED_PREFIX = 'enc:v1:';

let _key = null;

function getKey() {
  if (_key) return _key;

  // Get or create a stable salt
  let salt;
  if (fs.existsSync(SALT_PATH)) {
    salt = fs.readFileSync(SALT_PATH, 'utf-8').trim();
  } else {
    salt = crypto.randomBytes(16).toString('hex');
    const dir = path.dirname(SALT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(SALT_PATH, salt, { encoding: 'utf-8', mode: 0o600 });
  }

  // Derive key from machine identity + salt
  const identity = `${os.hostname()}:${os.userInfo().username}:${salt}`;
  _key = crypto.scryptSync(identity, salt, 32);
  return _key;
}

/**
 * Encrypt a plaintext string. Returns "enc:<base64>" or the original if empty.
 */
export function encrypt(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') return plaintext;
  // Don't double-encrypt
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();

  // Pack: iv + tag + ciphertext, all base64
  const packed = Buffer.concat([iv, tag, Buffer.from(encrypted, 'base64')]).toString('base64');
  return VERSIONED_PREFIX + packed;
}

/**
 * Decrypt an "enc:<base64>" string. Returns plaintext or the original if not encrypted.
 */
export function decrypt(value) {
  const result = decryptWithResult(value);
  return result.ok ? result.value : '';
}

/**
 * Decrypt an encrypted value and preserve failure information for callers that
 * must fail closed instead of treating decrypt failures as empty credentials.
 */
export function decryptWithResult(value) {
  if (!value || typeof value !== 'string') return { ok: true, value, encrypted: false };
  if (!value.startsWith(PREFIX)) return { ok: true, value, encrypted: false };

  try {
    const key = getKey();
    const raw = value.startsWith(VERSIONED_PREFIX)
      ? value.slice(VERSIONED_PREFIX.length)
      : value.slice(PREFIX.length);
    const packed = Buffer.from(raw, 'base64');
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);

    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return { ok: true, value: decrypted, encrypted: true };
  } catch (error) {
    return { ok: false, value: '', encrypted: true, errorCode: 'decrypt_failed', error };
  }
}

/**
 * Check if a value is encrypted.
 */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
