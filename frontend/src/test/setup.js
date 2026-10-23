import '@testing-library/jest-dom'
import { beforeEach, vi } from 'vitest'
import { installMatchMedia } from './matchMedia'

// Use setViewportWidth() from './matchMedia' to test the mobile layout.
installMatchMedia()

// Tests never reach the network (e.g. the login page's GitHub release lookup):
// fetch fails unless a test stubs it, and nothing is cached between tests.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Network access is disabled in tests'))))
  sessionStorage.clear()
})
