/**
 * Shared application configuration.
 *
 * The API base URL can be overridden at build time via the VITE_API_URL
 * environment variable (see .env or .env.local).  The fallback value is used
 * for local development without a custom env file.
 */
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const parseBool = (value, defaultValue = false) => {
  if (typeof value !== 'string') return defaultValue
  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return defaultValue
}

/**
 * Enables verbose browser-side diagnostics (API failures + uncaught errors)
 * in DevTools console when set to true.
 */
export const DEBUG_CONSOLE = parseBool(import.meta.env.VITE_DEBUG_CONSOLE, false)
