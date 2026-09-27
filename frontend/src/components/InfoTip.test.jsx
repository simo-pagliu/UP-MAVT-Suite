import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import InfoTip from './InfoTip'

describe('InfoTip', () => {
  // The test matchMedia stub reports no hover capability, i.e. a touch device.
  it('opens its help text on tap', async () => {
    render(
      <ChakraProvider>
        <InfoTip label="Explains the threshold" ariaLabel="About the threshold" />
      </ChakraProvider>
    )
    expect(screen.queryByText('Explains the threshold')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /about the threshold/i }))
    expect(await screen.findByText('Explains the threshold')).toBeInTheDocument()
  })

  it('accepts a custom trigger', async () => {
    render(
      <ChakraProvider>
        <InfoTip label="Weight 0.42">
          <button type="button">marker</button>
        </InfoTip>
      </ChakraProvider>
    )
    await userEvent.click(screen.getByRole('button', { name: 'marker' }))
    expect(await screen.findByText('Weight 0.42')).toBeInTheDocument()
  })
})
