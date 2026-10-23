import { GITHUB_REPO } from '../config'

const LATEST_RELEASE_CACHE_KEY = 'upmavt.latestRelease'
const LATEST_RELEASE_CACHE_MS = 60 * 60 * 1000

/**
 * Parse "1.2.0", "v1.2.0" or "1.2.0-beta.1" into its numeric core and
 * pre-release label. Returns null when the text is not a version.
 */
export const parseVersion = (text) => {
  const match = String(text ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || '',
  }
}

/**
 * Compare two versions: negative when a is older, positive when newer, 0 when
 * equal, null when either is not a version. A pre-release comes before its
 * release (1.1.0-beta.1 < 1.1.0).
 */
export const compareVersions = (a, b) => {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i]
  }
  if (left.prerelease === right.prerelease) return 0
  if (!left.prerelease) return 1
  if (!right.prerelease) return -1
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true })
}

/** Version text without a leading "v" ("v1.2.0" -> "1.2.0"). */
export const displayVersion = (text) => String(text ?? '').trim().replace(/^v/, '')

/** GitHub page of a release tag. */
export const releaseUrl = (version) =>
  `https://github.com/${GITHUB_REPO}/releases/tag/v${displayVersion(version)}`

/** GitHub comparison of everything that changed between two release tags. */
export const changesUrl = (fromVersion, toVersion) =>
  `https://github.com/${GITHUB_REPO}/compare/v${displayVersion(fromVersion)}...v${displayVersion(toVersion)}`

const readCachedRelease = () => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(LATEST_RELEASE_CACHE_KEY) || 'null')
    if (cached && Date.now() - cached.fetchedAt < LATEST_RELEASE_CACHE_MS) return cached.version
  } catch {
    // Storage unavailable or unreadable: fetch again.
  }
  return null
}

const writeCachedRelease = (version) => {
  try {
    sessionStorage.setItem(LATEST_RELEASE_CACHE_KEY, JSON.stringify({ version, fetchedAt: Date.now() }))
  } catch {
    // Storage unavailable: the next page load fetches again.
  }
}

/**
 * The latest published release on GitHub (drafts and pre-releases are not
 * "latest"), e.g. "1.2.0", or null when GitHub cannot be reached. The browser
 * asks GitHub directly; the answer is cached for an hour per browser tab
 * session to stay well within GitHub's anonymous rate limit.
 */
export const fetchLatestRelease = async () => {
  const cached = readCachedRelease()
  if (cached) return cached
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) return null
    const data = await response.json()
    const version = parseVersion(data?.tag_name) ? displayVersion(data.tag_name) : null
    if (version) writeCachedRelease(version)
    return version
  } catch {
    return null
  }
}
