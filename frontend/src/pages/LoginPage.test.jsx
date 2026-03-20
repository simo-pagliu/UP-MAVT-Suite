import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import axios from 'axios'
import LoginPage from '../pages/LoginPage'

vi.mock('axios')

const renderLoginPage = (onLogin = vi.fn()) =>
  render(
    <ChakraProvider>
      <LoginPage onLogin={onLogin} />
    </ChakraProvider>
  )

// ---------------------------------------------------------------------------
// Initial rendering
// ---------------------------------------------------------------------------
describe('LoginPage – rendering', () => {
  it('renders the title', () => {
    renderLoginPage()
    expect(screen.getByText('UP-MAVT Suite')).toBeInTheDocument()
  })

  it('shows Access Session tab by default', () => {
    renderLoginPage()
    expect(screen.getByPlaceholderText(/enter session code or uuid/i)).toBeInTheDocument()
  })

  it('shows Create Study tab when the Create Study button is clicked', async () => {
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: /create study/i }))
    expect(screen.getByPlaceholderText(/enter new study code/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Access Session – validation
// ---------------------------------------------------------------------------
describe('LoginPage – access session validation', () => {
  it('shows an error toast when trying to access with an empty code', async () => {
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: /^access$/i }))
    expect(await screen.findByText(/please enter a session code/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Access Session – admin shortcut
// ---------------------------------------------------------------------------
describe('LoginPage – admin access', () => {
  it('calls onLogin with admin role when code is "admin"', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'admin')
    await userEvent.click(screen.getByRole('button', { name: /^access$/i }))

    expect(onLogin).toHaveBeenCalledWith(null, 'admin', 'admin')
  })

  it('is case-insensitive for admin', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'ADMIN')
    await userEvent.click(screen.getByRole('button', { name: /^access$/i }))

    expect(onLogin).toHaveBeenCalledWith(null, 'admin', 'admin')
  })
})

// ---------------------------------------------------------------------------
// Access Session – successful stakeholder/practitioner login
// ---------------------------------------------------------------------------
describe('LoginPage – access session (API success)', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({
      data: { exists: true, _id: 'sess-1', code: 'CODE1', type: 'stakeholder' },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls onLogin with the session id, code, and type on success', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'CODE1')
    await userEvent.click(screen.getByRole('button', { name: /^access$/i }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('sess-1', 'CODE1', 'stakeholder'))
  })

  it('shows a success toast after login', async () => {
    renderLoginPage()
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'CODE1')
    await userEvent.click(screen.getByRole('button', { name: /^access$/i }))

    expect(await screen.findByText(/session loaded/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Access Session – session not found
// ---------------------------------------------------------------------------
describe('LoginPage – access session (not found)', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({ data: { exists: false } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows a "Not found" error toast when session does not exist', async () => {
    renderLoginPage()
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'UNKNOWN')
    await userEvent.click(screen.getByRole('button', { name: /^access$/i }))

    expect(await screen.findByText(/no session found/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Access Session – network error
// ---------------------------------------------------------------------------
describe('LoginPage – access session (network error)', () => {
  beforeEach(() => {
    axios.get.mockRejectedValue({ response: { data: { error: 'Server down' } } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows the server error message in a toast', async () => {
    renderLoginPage()
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'CODE1')
    await userEvent.click(screen.getByRole('button', { name: /^access$/i }))

    expect(await screen.findByText(/server down/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Create Study – validation
// ---------------------------------------------------------------------------
describe('LoginPage – create study validation', () => {
  it('shows an error toast when trying to create with an empty code', async () => {
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: /create study/i }))
    // Now we are on the "create" tab – click the "Create Study" submit button
    await userEvent.click(screen.getAllByRole('button', { name: /create study/i })[1])
    expect(await screen.findByText(/please enter a study code/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Create Study – success
// ---------------------------------------------------------------------------
describe('LoginPage – create study (API success)', () => {
  beforeEach(() => {
    axios.post.mockResolvedValue({ data: { study_session_id: 'study-1' } })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('calls onLogin with practitioner role on success', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    await userEvent.click(screen.getByRole('button', { name: /create study/i }))
    await userEvent.type(screen.getByPlaceholderText(/enter new study code/i), 'NEWSTUDY')
    await userEvent.click(screen.getAllByRole('button', { name: /create study/i })[1])

    await waitFor(() =>
      expect(onLogin).toHaveBeenCalledWith('study-1', 'NEWSTUDY', 'practitioner')
    )
  })
})

// ---------------------------------------------------------------------------
// Keyboard interaction
// ---------------------------------------------------------------------------
describe('LoginPage – keyboard', () => {
  beforeEach(() => {
    axios.get.mockResolvedValue({
      data: { exists: true, _id: 'sess-2', code: 'ENTER1', type: 'stakeholder' },
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('submits the access form when Enter is pressed in the code input', async () => {
    const onLogin = vi.fn()
    renderLoginPage(onLogin)

    const input = screen.getByPlaceholderText(/enter session code/i)
    await userEvent.type(input, 'ENTER1{Enter}')

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('sess-2', 'ENTER1', 'stakeholder'))
  })
})
