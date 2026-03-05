/**
 * Shared application configuration.
 *
 * The API base URL can be overridden at build time via the VITE_API_URL
 * environment variable (see .env or .env.local).  The fallback value is used
 * for local development without a custom env file.
 */
export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
