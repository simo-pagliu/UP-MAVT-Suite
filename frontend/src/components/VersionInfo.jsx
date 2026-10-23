import { useEffect, useState } from 'react'
import { Link, Text } from '@chakra-ui/react'
import { APP_VERSION } from '../config'
import { changesUrl, compareVersions, displayVersion, fetchLatestRelease } from '../utils/version'

/**
 * The version of this deployment, with the latest version published on GitHub
 * in brackets: "(latest)" when they match, or the newer version and a link to
 * what changed since this one. Without a reply from GitHub only the deployed
 * version is shown.
 */
function VersionInfo() {
  const [latest, setLatest] = useState(null)

  useEffect(() => {
    let isActive = true
    fetchLatestRelease().then((version) => {
      if (isActive) setLatest(version)
    })
    return () => {
      isActive = false
    }
  }, [])

  if (!APP_VERSION) return null
  const deployed = displayVersion(APP_VERSION)
  const comparison = latest ? compareVersions(deployed, latest) : null

  return (
    <Text fontSize="xs" color="gray.500">
      Version {deployed}
      {comparison === 0 && ' (latest)'}
      {comparison !== null && comparison < 0 && (
        <>
          {' '}(latest: {latest},{' '}
          <Link href={changesUrl(deployed, latest)} isExternal color="blue.700">
            see what changed
          </Link>
          )
        </>
      )}
    </Text>
  )
}

export default VersionInfo
