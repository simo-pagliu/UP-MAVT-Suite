import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import axios from 'axios'
import LoginPage from './LoginPage'

vi.mock('axios')

const renderLoginPage = (onLogin = vi.fn()) =>
  render(
    <ChakraProvider>
      <LoginPage onLogin={onLogin} onDocumentation={vi.fn()} />
    </ChakraProvider>,
  )

describe('LoginPage – rendering', () => {
  it('renders the title', () => {
    renderLoginPage()
    expect(screen.getByText('UP-MAVT Suite')).toBeInTheDocument()
  })

  it('shows access session input by default', () => {
    renderLoginPage()
    expect(screen.getByPlaceholderText(/enter session code/i)).toBeInTheDocument()
  })

  it('shows descriptive example case-study download links', () => {
    renderLoginPage()
    expect(screen.getByRole('link', { name: /reference case study/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /uncertain case study with two decision makers/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /large hierarchical uncertain case study/i })).toBeInTheDocument()
    expect(screen.getByText(/ordered from the simplest reference case/i)).toBeInTheDocument()
  })
})

describe('LoginPage – access session validation', () => {
  it('shows an error toast when trying to access with an empty code', async () => {
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))
    expect(await screen.findByText(/please enter a session code/i)).toBeInTheDocument()
  })
})

describe('LoginPage – admin access', () => {
  it('calls onLogin with admin role when code is "admin"', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'admin')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))

    expect(onLogin).toHaveBeenCalledWith(null, 'admin', 'admin')
  })

  it('is case-insensitive for admin', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'ADMIN')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))

    expect(onLogin).toHaveBeenCalledWith(null, 'admin', 'admin')
  })
})

describe('LoginPage – access session (API success)', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({
      data: { exists: true, _id: 'sess-1', code: 'CODE1', type: 'stakeholder' },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls onLogin with session id, uuid label and type on success', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'CODE1')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('sess-1', 'sess-1', 'stakeholder'))
  })
})

describe('LoginPage – access session errors', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows not found toast when session does not exist', async () => {
    axios.get.mockResolvedValue({ data: { exists: false } })
    renderLoginPage()
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'UNKNOWN')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))
    expect(await screen.findByText(/no active session is linked to this code/i)).toBeInTheDocument()
  })

  it('shows server error message in a toast', async () => {
    axios.get.mockRejectedValue({ response: { data: { error: 'Server down' } } })
    renderLoginPage()
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'CODE1')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))
    expect(await screen.findByText(/server down/i)).toBeInTheDocument()
  })
})

describe('LoginPage – create/upload case study with email', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('requires email before creating a case study', async () => {
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: /create case study/i }))
    expect(await screen.findByText(/please enter an email address/i)).toBeInTheDocument()
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('creates a case study with contact_email', async () => {
    const onLogin = vi.fn()
    axios.post.mockResolvedValueOnce({ data: { study_session_id: 'study-1', code: 'STUDY123' } })
    renderLoginPage(onLogin)

    await userEvent.type(screen.getByPlaceholderText(/enter email address/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /create case study/i }))

    await waitFor(() => expect(axios.post).toHaveBeenCalled())
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/study-session'),
      expect.objectContaining({ auto_generate: true, contact_email: 'user@example.com' }),
    )
    expect(onLogin).toHaveBeenCalledWith('study-1', 'study-1', 'practitioner')
  })
})

describe('LoginPage – keyboard', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({
      data: { exists: true, _id: 'sess-2', code: 'ENTER1', type: 'stakeholder' },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('submits access form when Enter is pressed in uuid input', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    const input = screen.getByPlaceholderText(/enter session code/i)
    await userEvent.type(input, 'ENTER1{Enter}')

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('sess-2', 'sess-2', 'stakeholder'))
  })
})
