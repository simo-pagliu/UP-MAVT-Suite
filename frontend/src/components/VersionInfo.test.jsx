import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ChakraProvider } from '@chakra-ui/react'
import VersionInfo from './VersionInfo'

vi.mock('../config', async (importOriginal) => ({ ...(await importOriginal()), APP_VERSION: '1.1.0' }))

const latestReleaseIs = (tag) => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ tag_name: tag }) })))
}

const renderVersionInfo = () => render(
  <ChakraProvider>
    <VersionInfo />
  </ChakraProvider>
)

describe('VersionInfo', () => {
  it('links to what changed when a newer version is published', async () => {
    latestReleaseIs('v1.2.0')
    renderVersionInfo()
    const link = await screen.findByRole('link', { name: /see what changed/i })
    expect(link).toHaveAttribute('href', 'https://github.com/simo-pagliu/UP-MAVT-Suite/compare/v1.1.0...v1.2.0')
    expect(screen.getByText(/version 1\.1\.0/i)).toHaveTextContent('Version 1.1.0 (latest: 1.2.0, see what changed)')
  })

  it('says it is the latest when the versions match', async () => {
    latestReleaseIs('v1.1.0')
    renderVersionInfo()
    expect(await screen.findByText('Version 1.1.0 (latest)')).toBeInTheDocument()
  })

  it('shows only the deployed version when it is newer than the latest release', async () => {
    latestReleaseIs('v1.0.0')
    renderVersionInfo()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByText('Version 1.1.0')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows only the deployed version when GitHub cannot be reached', async () => {
    renderVersionInfo() // fetch rejects in tests
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.getByText('Version 1.1.0')).toBeInTheDocument()
  })
})
