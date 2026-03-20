import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import axios from 'axios'
import LoginPage from './LoginPage'

vi.mock('axios')

const renderPage = (onLogin = vi.fn()) =>
  render(
    <ChakraProvider>
      <LoginPage onLogin={onLogin} onDocumentation={vi.fn()} />
    </ChakraProvider>,
  )

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requires email before creating a case study', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /create case study/i }))
    expect(await screen.findByText(/please enter an email address/i)).toBeInTheDocument()
    expect(axios.post).not.toHaveBeenCalled()
  })

  it('creates a case study with contact_email', async () => {
    const onLogin = vi.fn()
    axios.post.mockResolvedValueOnce({ data: { study_session_id: 'study-1', code: 'STUDY123' } })
    renderPage(onLogin)
    await userEvent.type(screen.getByPlaceholderText(/enter email address/i), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /create case study/i }))

    await waitFor(() => expect(axios.post).toHaveBeenCalled())
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/study-session'),
      expect.objectContaining({ auto_generate: true, contact_email: 'user@example.com' }),
    )
    expect(onLogin).toHaveBeenCalledWith('study-1', 'STUDY123', 'practitioner')
  })

  it('renders example case study download links', () => {
    renderPage()
    expect(screen.getByRole('link', { name: /download example case study 1/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /download example case study 2/i })).toBeInTheDocument()
  })
})
