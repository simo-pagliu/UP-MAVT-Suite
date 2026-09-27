import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import { TierlistPhase } from './QualitativeIndicatorsPage'

const renderTierlist = (props = {}) => {
  const onRankingChange = vi.fn()
  render(
    <ChakraProvider>
      <TierlistPhase
        alternatives={['A', 'B', 'C']}
        onComplete={vi.fn()}
        onRankingChange={onRankingChange}
        {...props}
      />
    </ChakraProvider>
  )
  return { onRankingChange, lastRanking: () => onRankingChange.mock.calls.at(-1)[0] }
}

describe('TierlistPhase – tap to place', () => {
  it('starts with one alternative per rank', () => {
    const { lastRanking } = renderTierlist()
    expect(lastRanking()).toEqual({ A: 0, B: 1, C: 2 })
  })

  it('moves a tapped alternative into the tapped tier', async () => {
    const { lastRanking } = renderTierlist()
    await userEvent.click(screen.getByRole('button', { name: 'C' }))
    expect(screen.getByRole('status')).toHaveTextContent(/moving c/i)

    await userEvent.click(screen.getByRole('group', { name: 'Rank 1' }))
    expect(lastRanking()).toEqual({ A: 0, C: 0, B: 1 })
    expect(within(screen.getByRole('group', { name: 'Rank 1' })).getByRole('button', { name: 'C' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('creates a new top rank with the + button', async () => {
    const { lastRanking } = renderTierlist()
    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    await userEvent.click(screen.getByRole('button', { name: /new top rank/i }))
    expect(lastRanking()).toEqual({ B: 0, A: 1, C: 2 })
  })

  it('creates a new rank between two tiers', async () => {
    const { lastRanking } = renderTierlist({ initialRanking: { A: 0, B: 0, C: 1 } })
    await userEvent.click(screen.getByRole('button', { name: 'B' }))
    await userEvent.click(screen.getByRole('button', { name: /between rank 1 and rank 2/i }))
    expect(lastRanking()).toEqual({ A: 0, B: 1, C: 2 })
  })

  it('cancels when the picked alternative is tapped again', async () => {
    const { onRankingChange } = renderTierlist()
    const callsBefore = onRankingChange.mock.calls.length
    await userEvent.click(screen.getByRole('button', { name: 'A' }))
    await userEvent.click(screen.getByRole('button', { name: 'A' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    // Tapping a tier with nothing picked up changes nothing.
    await userEvent.click(screen.getByRole('group', { name: 'Rank 3' }))
    expect(onRankingChange.mock.calls.length).toBe(callsBefore)
  })
})
