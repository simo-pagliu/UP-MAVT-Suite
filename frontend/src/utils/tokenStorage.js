/**
 * Secure token storage utility for admin JWT tokens.
 *
 * Tokens are kept in `sessionStorage` so they are:
 * - Scoped to the current browser tab (not shared across tabs).
 * - Automatically cleared when the tab or browser is closed.
 * - Never written to `localStorage`, which persists indefinitely.
 *
 * An additional layer of obfuscation is applied before writing to storage:
 * the token string is Base64-encoded with a simple XOR using a per-session
 * key derived from `crypto.getRandomValues`.  This does **not** replace
 * proper transport-level security (HTTPS) but it prevents tokens from
 * appearing as plain JWTs in a quick storage inspection.
 *
 * The session key itself is stored in memory only — it is never persisted —
 * so tokens written in one page load cannot be decoded in another.
 */

const ACCESS_TOKEN_KEY = '__adm_at'
const REFRESH_TOKEN_KEY = '__adm_rt'

/** Per-page-load encryption key (32 random bytes, memory-only). */
const SESSION_KEY = (() => {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return buf
})()

/**
 * XOR-obfuscate a UTF-8 string with the per-session key and return a
 * Base64-encoded result, or return the original string if the Web Crypto
 * API is unavailable.
 *
 * @param {string} value - Plain-text string to obfuscate.
 * @returns {string} Base64-encoded obfuscated string.
 */
function obfuscate(value) {
  try {
    const bytes = new TextEncoder().encode(value)
    const out = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ SESSION_KEY[i % SESSION_KEY.length]
    }
    return btoa(String.fromCharCode(...out))
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
    const raw = atob(value)
    const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
    const out = new Uint8Array(bytes.length)
    for (let i = 0; i < bytes.length; i++) {
      out[i] = bytes[i] ^ SESSION_KEY[i % SESSION_KEY.length]
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
 * or cannot be decoded (e.g. because the page was reloaded and the in-memory
 * session key changed).
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
  } catch {
    // Fail silently.
  }
}
