import { describe, it, expect, vi, afterEach } from 'vitest'
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

const mockEmailEnabled = (emailEnabled = true) => {
  axios.get.mockResolvedValueOnce({ data: { email_enabled: emailEnabled } })
}

describe('LoginPage – rendering', () => {
  it('renders the title and initial access/create/upload choices', () => {
    mockEmailEnabled()
    renderLoginPage()
    expect(screen.getByText('UP-MAVT Suite')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /access an existing session/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create a new session/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /upload a case study/i })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/enter session code/i)).not.toBeInTheDocument()
  })
})

describe('LoginPage – access existing session', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('shows access controls after choosing the access flow', async () => {
    mockEmailEnabled()
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: /access an existing session/i }))
    expect(screen.getByPlaceholderText(/enter session code/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /access session/i })).toBeInTheDocument()
  })

  it('shows an error toast when trying to access with an empty code', async () => {
    mockEmailEnabled()
    renderLoginPage()
    await userEvent.click(screen.getByRole('button', { name: /access an existing session/i }))
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))
    expect(await screen.findByText(/please enter a session code/i)).toBeInTheDocument()
  })

  it('calls onLogin with admin role when code is admin', async () => {
    const onLogin = vi.fn()
    mockEmailEnabled()
    renderLoginPage(onLogin)

    await userEvent.click(screen.getByRole('button', { name: /access an existing session/i }))
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'admin')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))

    expect(onLogin).toHaveBeenCalledWith(null, 'admin', 'admin')
  })

  it('keeps admin access case-insensitive', async () => {
    const onLogin = vi.fn()
    mockEmailEnabled()
    renderLoginPage(onLogin)

    await userEvent.click(screen.getByRole('button', { name: /access an existing session/i }))
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'ADMIN')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))

    expect(onLogin).toHaveBeenCalledWith(null, 'admin', 'admin')
  })

  it('calls onLogin with detected session on API success', async () => {
    const onLogin = vi.fn()
    mockEmailEnabled()
    axios.get.mockResolvedValueOnce({
      data: { exists: true, _id: 'sess-1', code: 'CODE1', type: 'stakeholder' },
    })
    renderLoginPage(onLogin)

    await userEvent.click(screen.getByRole('button', { name: /access an existing session/i }))
    await userEvent.type(screen.getByPlaceholderText(/enter session code/i), 'CODE1')
    await userEvent.click(screen.getByRole('button', { name: /access session/i }))

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('sess-1', 'sess-1', 'stakeholder'))
  })
})

describe('LoginPage – create/upload without mandatory email', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new empty session when user declines email sharing', async () => {
    const onLogin = vi.fn()
    mockEmailEnabled()
    axios.post.mockResolvedValueOnce({ data: { study_session_id: 'study-1' } })
    renderLoginPage(onLogin)

    await userEvent.click(screen.getByRole('button', { name: /create a new session/i }))
    await userEvent.click(screen.getByRole('button', { name: /no, continue without email/i }))
    await userEvent.click(screen.getByRole('button', { name: /create new empty session/i }))

    await waitFor(() => expect(axios.post).toHaveBeenCalled())
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/study-session'),
      expect.objectContaining({ auto_generate: true }),
    )
    expect(onLogin).toHaveBeenCalledWith('study-1', 'study-1', 'practitioner')
  })

  it('hides email-sharing consent when email is disabled and creates directly', async () => {
    const onLogin = vi.fn()
    mockEmailEnabled(false)
    axios.post.mockResolvedValueOnce({ data: { study_session_id: 'study-disabled-email' } })
    renderLoginPage(onLogin)

    await userEvent.click(screen.getByRole('button', { name: /create a new session/i }))

    expect(screen.queryByRole('button', { name: /yes, share email/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /no, continue without email/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /create new empty session/i }))

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/study-session'),
        expect.objectContaining({ auto_generate: true }),
      ),
    )
    expect(onLogin).toHaveBeenCalledWith('study-disabled-email', 'study-disabled-email', 'practitioner')
  })

  it('runs email verification when user consents, then creates a session with verified email', async () => {
    const onLogin = vi.fn()
    mockEmailEnabled()
    axios.post
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ data: { verification_token: 'token-123' } })
      .mockResolvedValueOnce({ data: { study_session_id: 'study-2' } })

    renderLoginPage(onLogin)

    await userEvent.click(screen.getByRole('button', { name: /create a new session/i }))
    await userEvent.click(screen.getByRole('button', { name: /yes, share email/i }))
    await userEvent.type(screen.getByPlaceholderText(/email address/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send code/i }))
    await userEvent.type(screen.getByPlaceholderText(/verification code/i), '123456')
    await userEvent.click(screen.getByRole('button', { name: /verify code/i }))
    await userEvent.click(screen.getByRole('button', { name: /create new empty session/i }))

    await waitFor(() =>
      expect(axios.post).toHaveBeenLastCalledWith(
        expect.stringContaining('/study-session'),
        expect.objectContaining({
          auto_generate: true,
          creator_email: 'user@example.com',
          email_verification_token: 'token-123',
        }),
      ),
    )
    expect(onLogin).toHaveBeenCalledWith('study-2', 'study-2', 'practitioner')
  })

  it('submits the email verification request when Enter is pressed in the email field', async () => {
    mockEmailEnabled()
    axios.post.mockResolvedValueOnce({})

    renderLoginPage()

    await userEvent.click(screen.getByRole('button', { name: /create a new session/i }))
    await userEvent.click(screen.getByRole('button', { name: /yes, share email/i }))

    const emailInput = screen.getByPlaceholderText(/email address/i)
    await userEvent.type(emailInput, 'user@example.com{enter}')

    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/email-verification/request'),
        { email: 'user@example.com' },
      ),
    )
  })

  it('uploads a case study without contact email when user declines email sharing', async () => {
    const onLogin = vi.fn()
    mockEmailEnabled()
    axios.post.mockResolvedValueOnce({ data: { study_session_id: 'study-upload' } })
    renderLoginPage(onLogin)

    const fileInput = document.querySelector('input[type="file"]')
    const zipFile = new File(['zip-content'], 'case-study.zip', { type: 'application/zip' })

    await userEvent.click(screen.getByRole('button', { name: /upload a case study/i }))
    await userEvent.click(screen.getByRole('button', { name: /no, continue without email/i }))
    await userEvent.upload(fileInput, zipFile)

    await waitFor(() => expect(axios.post).toHaveBeenCalled())
    expect(onLogin).toHaveBeenCalledWith('study-upload', 'study-upload', 'practitioner')
  })
})
