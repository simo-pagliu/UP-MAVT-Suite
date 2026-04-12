/**
 * Secure token storage utility for admin JWT tokens.
 *
 * Tokens are kept in `sessionStorage` so they are:
 * - Scoped to the current browser tab (not shared across tabs).
 * - Automatically cleared when the tab or browser is closed.
 * - Never written to `localStorage`, which persists indefinitely.
 *
 * An additional layer of obfuscation is applied before writing to storage:
 * the token bytes are XOR-obfuscated then Base64-encoded using a tab-scoped
 * key stored alongside the tokens in `sessionStorage`.  This does **not**
 * replace proper transport-level security (HTTPS) but it prevents tokens
 * from appearing as plain JWTs in a quick storage inspection.
 *
 * Because the obfuscation key is stored in `sessionStorage` alongside the
 * tokens, it survives page reloads within the same tab and is discarded
 * automatically when the tab is closed.
 */

const ACCESS_TOKEN_KEY = '__adm_at'
const REFRESH_TOKEN_KEY = '__adm_rt'
const SESSION_KEY_KEY = '__adm_sk'

/**
 * Return the per-tab obfuscation key from sessionStorage, creating and
 * persisting it if it does not yet exist.
 *
 * @returns {Uint8Array} 32-byte key.
 */
function getOrCreateSessionKey() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY_KEY)
    if (stored) {
      const raw = atob(stored)
      return Uint8Array.from(raw, (c) => c.charCodeAt(0))
    }
  } catch {
    // Fall through to generate a new key.
  }

  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  try {
    sessionStorage.setItem(SESSION_KEY_KEY, btoa(Array.from(buf, (b) => String.fromCharCode(b)).join('')))
  } catch {
    // sessionStorage may be unavailable; carry on with an in-memory key.
  }
  return buf
}

/**
 * XOR-obfuscate a UTF-8 string with the per-tab session key and return a
 * Base64-encoded result, or return the original string if encoding fails.
 *
 * @param {string} value - Plain-text string to obfuscate.
 * @returns {string} Base64-encoded obfuscated string.
 */
function obfuscate(value) {
  try {
    const key = getOrCreateSessionKey()
    const bytes = new TextEncoder().encode(value)
    const out = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ key[i % key.length]
    }
    return btoa(Array.from(out, (b) => String.fromCharCode(b)).join(''))
  } catch {
    return value
  }
}

/**
 * Reverse the obfuscation applied by {@link obfuscate}.
 *
 * @param {string} value - Base64-encoded obfuscated string.
 * @returns {string|null} Original plain-text string, or `null` on failure.
 */
function deobfuscate(value) {
  try {
    const key = getOrCreateSessionKey()
    const raw = atob(value)
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
    const out = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ key[i % key.length]
    }
    return new TextDecoder().decode(out)
  } catch {
    return null
  }
}

/**
 * Persist both JWT tokens to sessionStorage.
 *
 * @param {string} accessToken  - Short-lived JWT access token.
 * @param {string} refreshToken - Long-lived JWT refresh token.
 */
export function storeTokens(accessToken, refreshToken) {
  try {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, obfuscate(accessToken))
    sessionStorage.setItem(REFRESH_TOKEN_KEY, obfuscate(refreshToken))
  } catch {
    // sessionStorage may be unavailable in some privacy modes; fail silently.
  }
}

/**
 * Retrieve the stored JWT tokens from sessionStorage.
 *
 * Returns `{ accessToken: null, refreshToken: null }` if tokens are absent
 * or cannot be decoded.
 *
 * @returns {{ accessToken: string|null, refreshToken: string|null }}
 */
export function loadTokens() {
  try {
    const rawAccess = sessionStorage.getItem(ACCESS_TOKEN_KEY)
    const rawRefresh = sessionStorage.getItem(REFRESH_TOKEN_KEY)
    return {
      accessToken: rawAccess ? deobfuscate(rawAccess) : null,
      refreshToken: rawRefresh ? deobfuscate(rawRefresh) : null,
    }
  } catch {
    return { accessToken: null, refreshToken: null }
  }
}

/**
 * Persist only the access token (e.g. after a silent refresh).
 *
 * @param {string} accessToken - New short-lived JWT access token.
 */
export function updateAccessToken(accessToken) {
  try {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, obfuscate(accessToken))
  } catch {
    // Fail silently.
  }
}

/**
 * Remove all stored admin tokens from sessionStorage.
 */
export function clearTokens() {
  try {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY)
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
    sessionStorage.removeItem(SESSION_KEY_KEY)
  } catch {
    // Fail silently.
  }
}

/**
 * Decode the payload of a JWT without verifying its signature.
 * Used purely to inspect the `exp` claim on the client side; the
 * server always performs authoritative signature verification.
 *
 * @param {string} token - JWT string.
 * @returns {{ exp?: number }|null} Decoded payload, or `null` on failure.
 */
export function decodeTokenPayload(token) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(
      parts[1].length + (4 - (parts[1].length % 4)) % 4,
      '=',
    )
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

/**
 * Return `true` if the JWT token's `exp` claim is in the future.
 *
 * @param {string|null} token - JWT string, or `null`.
 * @returns {boolean}
 */
export function isTokenValid(token) {
  if (!token) return false
  const payload = decodeTokenPayload(token)
  if (!payload || typeof payload.exp !== 'number') return false
  // exp is in seconds; add a 5-second clock-skew buffer.
  return payload.exp > Date.now() / 1000 + 5
}
