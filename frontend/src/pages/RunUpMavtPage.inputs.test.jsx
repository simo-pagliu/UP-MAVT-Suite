import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import { BufferedNumberInput } from './RunUpMavtPage'

const formatAdjustment = (value) => Number(value).toFixed(1)

function ConfidenceAdjustment({ onCommit }) {
  const [value, setValue] = useState(0)
  return (
    <BufferedNumberInput
      value={value}
      onChange={(next) => {
        setValue(next)
        onCommit(next)
      }}
      min={-4}
      max={4}
      step={0.1}
      precision={1}
      format={formatAdjustment}
    />
  )
}

describe('BufferedNumberInput', () => {
  it('lets a negative value be typed from scratch', async () => {
    const onCommit = vi.fn()
    render(
      <ChakraProvider>
        <ConfidenceAdjustment onCommit={onCommit} />
      </ChakraProvider>
    )
    const input = screen.getByRole('spinbutton')

    await userEvent.clear(input)
    await userEvent.type(input, '-1.5')

    expect(input).toHaveValue('-1.5')
    expect(onCommit).toHaveBeenLastCalledWith(-1.5)
  })

  it('clamps to the range and reformats once the field loses focus', async () => {
    const onCommit = vi.fn()
    render(
      <ChakraProvider>
        <ConfidenceAdjustment onCommit={onCommit} />
      </ChakraProvider>
    )
    const input = screen.getByRole('spinbutton')

    await userEvent.clear(input)
    await userEvent.type(input, '7')
    await userEvent.tab()

    expect(onCommit).toHaveBeenLastCalledWith(4)
    expect(input).toHaveValue('4.0')
  })
})
