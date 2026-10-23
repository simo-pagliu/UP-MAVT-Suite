import { describe, it, expect, vi } from 'vitest'
import { changesUrl, compareVersions, fetchLatestRelease, parseVersion } from './version'

const respondWith = (body, ok = true) => vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) }))

describe('parseVersion', () => {
  it('reads plain, v-prefixed and pre-release versions', () => {
    expect(parseVersion('1.2.3')).toEqual({ core: [1, 2, 3], prerelease: '' })
    expect(parseVersion('v1.2.3')).toEqual({ core: [1, 2, 3], prerelease: '' })
    expect(parseVersion('v1.1.0-beta.1')).toEqual({ core: [1, 1, 0], prerelease: 'beta.1' })
  })

  it('rejects anything else', () => {
    expect(parseVersion('latest')).toBeNull()
    expect(parseVersion('')).toBeNull()
    expect(parseVersion(null)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('orders by major, minor and patch numerically', () => {
    expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('v2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.2.0', 'v1.2.0')).toBe(0)
  })

  it('puts a pre-release before its release', () => {
    expect(compareVersions('1.1.0-beta.1', '1.1.0')).toBeLessThan(0)
    expect(compareVersions('1.1.0-beta.2', '1.1.0-beta.10')).toBeLessThan(0)
    expect(compareVersions('1.1.0-beta.1', '1.0.0')).toBeGreaterThan(0)
  })

  it('returns null when a side is not a version', () => {
    expect(compareVersions('1.0.0', 'latest')).toBeNull()
  })
})

describe('changesUrl', () => {
  it('compares the two release tags on GitHub', () => {
    expect(changesUrl('1.1.0', 'v1.2.0'))
      .toBe('https://github.com/simo-pagliu/UP-MAVT-Suite/compare/v1.1.0...v1.2.0')
  })
})

describe('fetchLatestRelease', () => {
  it('returns the latest release version without the v', async () => {
    vi.stubGlobal('fetch', respondWith({ tag_name: 'v1.2.0' }))
    await expect(fetchLatestRelease()).resolves.toBe('1.2.0')
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/simo-pagliu/UP-MAVT-Suite/releases/latest',
      expect.anything(),
    )
  })

  it('asks GitHub once per session while the answer is fresh', async () => {
    vi.stubGlobal('fetch', respondWith({ tag_name: 'v1.2.0' }))
    await fetchLatestRelease()
    await expect(fetchLatestRelease()).resolves.toBe('1.2.0')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('returns null when GitHub fails or answers without a version', async () => {
    await expect(fetchLatestRelease()).resolves.toBeNull() // fetch rejects in tests
    vi.stubGlobal('fetch', respondWith({ message: 'Not Found' }, false))
    await expect(fetchLatestRelease()).resolves.toBeNull()
    vi.stubGlobal('fetch', respondWith({ tag_name: 'nightly' }))
    await expect(fetchLatestRelease()).resolves.toBeNull()
  })
})
