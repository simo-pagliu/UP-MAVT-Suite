import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import Navigation from '../components/Navigation'

const renderNavigation = (props = {}) => {
  const defaults = {
    isLoggedIn: false,
    currentRole: null,
    currentPage: null,
    onPageChange: vi.fn(),
    sessionId: null,
    studySessionId: null,
    features: { qi: false, vf: false, bwt: false },
    onLogin: vi.fn(),
    onLogout: vi.fn(),
    onDocumentation: vi.fn(),
  }
  return render(
    <ChakraProvider>
      <Navigation {...defaults} {...props} />
    </ChakraProvider>
  )
}

// ---------------------------------------------------------------------------
// Branding
// ---------------------------------------------------------------------------
describe('Navigation – branding', () => {
  it('always renders the application name', () => {
    renderNavigation()
    expect(screen.getByText('UP-MAVT Suite')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Login / Logout button
// ---------------------------------------------------------------------------
describe('Navigation – login / logout', () => {
  it('shows a Login button when not logged in', () => {
    renderNavigation({ isLoggedIn: false })
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /logout/i })).not.toBeInTheDocument()
  })

  it('shows a Logout button when logged in', () => {
    renderNavigation({ isLoggedIn: true, currentRole: 'stakeholder' })
    expect(screen.getByRole('button', { name: /logout/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /login/i })).not.toBeInTheDocument()
  })

  it('calls onLogin when the Login button is clicked', async () => {
    const onLogin = vi.fn()
    renderNavigation({ isLoggedIn: false, onLogin })
    await userEvent.click(screen.getByRole('button', { name: /login/i }))
    expect(onLogin).toHaveBeenCalledOnce()
  })

  it('calls onLogout when the Logout button is clicked', async () => {
    const onLogout = vi.fn()
    renderNavigation({ isLoggedIn: true, currentRole: 'stakeholder', onLogout })
    await userEvent.click(screen.getByRole('button', { name: /logout/i }))
    expect(onLogout).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------
// Navigation items – admin role
// ---------------------------------------------------------------------------
describe('Navigation – admin role', () => {
  it('shows no nav items for the admin role', () => {
    renderNavigation({ isLoggedIn: true, currentRole: 'admin' })
    expect(screen.queryByRole('button', { name: /qualitative/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /value functions/i })).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Navigation items – stakeholder role
// ---------------------------------------------------------------------------
describe('Navigation – stakeholder role', () => {
  it('shows only enabled feature pages (+ Overview)', () => {
    renderNavigation({
      isLoggedIn: true,
      currentRole: 'stakeholder',
      sessionId: 'sess-1',
      features: { qi: true, vf: false, bwt: false },
    })
    expect(screen.getByRole('button', { name: /qualitative indicators/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /value functions/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pile-bwt/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /overview/i })).toBeInTheDocument()
  })

  it('shows all pages when all features enabled', () => {
    renderNavigation({
      isLoggedIn: true,
      currentRole: 'stakeholder',
      sessionId: 'sess-1',
      features: { qi: true, vf: true, bwt: true },
    })
    expect(screen.getByRole('button', { name: /qualitative indicators/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /value functions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pile-bwt/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /overview/i })).toBeInTheDocument()
  })

  it('disables page buttons when sessionId is not set', () => {
    renderNavigation({
      isLoggedIn: true,
      currentRole: 'stakeholder',
      sessionId: null,
      features: { qi: true, vf: true, bwt: true },
    })
    const qiBtn = screen.getByRole('button', { name: /qualitative indicators/i })
    expect(qiBtn).toBeDisabled()
  })

  it('calls onPageChange with the correct page id when a nav button is clicked', async () => {
    const onPageChange = vi.fn()
    renderNavigation({
      isLoggedIn: true,
      currentRole: 'stakeholder',
      sessionId: 'sess-1',
      features: { qi: true, vf: false, bwt: false },
      onPageChange,
    })
    await userEvent.click(screen.getByRole('button', { name: /overview/i }))
    expect(onPageChange).toHaveBeenCalledWith('recap')
  })
})

// ---------------------------------------------------------------------------
// Navigation items – practitioner role
// ---------------------------------------------------------------------------
describe('Navigation – practitioner role', () => {
  it('shows practitioner-specific pages in the required order', () => {
    renderNavigation({
      isLoggedIn: true,
      currentRole: 'practitioner',
      studySessionId: 'study-1',
    })
    const buttons = screen.getAllByRole('button')
    const labels = buttons.map((btn) => btn.textContent)
    const inputIdx = labels.indexOf('Input Definition')
    const manageIdx = labels.indexOf('Manage Case Studies')
    const runIdx = labels.indexOf('Run UP-MAVT')
    expect(inputIdx).toBeGreaterThan(-1)
    expect(manageIdx).toBeGreaterThan(-1)
    expect(runIdx).toBeGreaterThan(-1)
    expect(inputIdx).toBeLessThan(manageIdx)
    expect(manageIdx).toBeLessThan(runIdx)
  })

  it('disables Input Definition and Run UP-MAVT when there is no study session', () => {
    renderNavigation({
      isLoggedIn: true,
      currentRole: 'practitioner',
      studySessionId: null,
    })
    expect(screen.getByRole('button', { name: /input definition/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /run up-mavt/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /manage case studies/i })).not.toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Documentation button
// ---------------------------------------------------------------------------
describe('Navigation – documentation button', () => {
  it('shows the info icon button for logged-in non-admin users', () => {
    renderNavigation({ isLoggedIn: true, currentRole: 'stakeholder' })
    expect(screen.getByRole('button', { name: /documentation/i })).toBeInTheDocument()
  })

  it('does not show the documentation button for admin', () => {
    renderNavigation({ isLoggedIn: true, currentRole: 'admin' })
    expect(screen.queryByRole('button', { name: /documentation/i })).not.toBeInTheDocument()
  })

  it('calls onDocumentation when the info button is clicked', async () => {
    const onDocumentation = vi.fn()
    renderNavigation({
      isLoggedIn: true,
      currentRole: 'practitioner',
      onDocumentation,
    })
    await userEvent.click(screen.getByRole('button', { name: /documentation/i }))
    expect(onDocumentation).toHaveBeenCalledOnce()
  })
})
