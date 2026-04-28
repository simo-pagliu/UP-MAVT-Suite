import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ChakraProvider } from '@chakra-ui/react'
import axios from 'axios'
import ValueFunctionsPage from './ValueFunctionsPage'

vi.mock('axios')

describe('ValueFunctionsPage empty state', () => {
  beforeEach(() => {
    axios.get.mockReset()
  })

  it('shows a clear empty state when all criteria are qualitative', async () => {
    axios.get.mockResolvedValueOnce({
      data: {
        criteria: [
          {
            criterion_name: 'Quality',
            is_qualitative: true,
            alternatives: [{ name: 'A', value: '' }],
          },
        ],
        value_functions: { criteria: {} },
      },
    })

    render(
      <ChakraProvider>
        <ValueFunctionsPage sessionId="sess-1" />
      </ChakraProvider>
    )

    await waitFor(() => {
      expect(screen.getByText(/no quantitative indicators have been marked in the input/i)).toBeInTheDocument()
    })
  })
})
