import { describe, it, expect, afterEach } from 'vitest'
import { useState } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChakraProvider } from '@chakra-ui/react'
import SidebarLayout from './SidebarLayout'
import { setViewportWidth } from '../test/matchMedia'

const desktopWidth = window.innerWidth

const renderLayout = (props = {}, children = <p>Main content</p>) =>
  render(
    <ChakraProvider>
      <SidebarLayout
        title="Indicators"
        sidebar={<button type="button">Indicator A</button>}
        activeKey={null}
        {...props}
      >
        {children}
      </SidebarLayout>
    </ChakraProvider>
  )

function Counter() {
  const [count, setCount] = useState(0)
  return <button type="button" onClick={() => setCount((c) => c + 1)}>Count {count}</button>
}

describe('SidebarLayout', () => {
  afterEach(() => {
    setViewportWidth(desktopWidth)
  })

  it('shows sidebar and main side by side on desktop', () => {
    renderLayout({ activeKey: 'a' })
    expect(screen.getByRole('button', { name: 'Indicator A' })).toBeInTheDocument()
    expect(screen.getByText('Main content')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /indicators:/i })).not.toBeInTheDocument()
  })

  it('shows the list inline on mobile while nothing is selected', () => {
    setViewportWidth(375)
    renderLayout()
    expect(screen.getByRole('button', { name: 'Indicator A' })).toBeInTheDocument()
    expect(screen.getByText('Main content')).toBeInTheDocument()
  })

  it('moves the list into a drawer on mobile once something is selected', async () => {
    setViewportWidth(375)
    const { rerender } = renderLayout({ activeKey: 'a', activeLabel: '1. Cost' })
    expect(screen.queryByRole('button', { name: 'Indicator A' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /indicators: 1\. cost/i }))
    expect(await screen.findByRole('button', { name: 'Indicator A' })).toBeInTheDocument()

    // Selecting another item closes the drawer.
    rerender(
      <ChakraProvider>
        <SidebarLayout
          title="Indicators"
          sidebar={<button type="button">Indicator A</button>}
          activeKey="b"
          activeLabel="2. Time"
        >
          <p>Main content</p>
        </SidebarLayout>
      </ChakraProvider>
    )
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Indicator A' })).not.toBeInTheDocument()
    })
  })

  it('keeps the main content mounted when crossing the breakpoint', async () => {
    renderLayout({ activeKey: 'a', activeLabel: '1. Cost' }, <Counter />)
    await userEvent.click(screen.getByRole('button', { name: 'Count 0' }))
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeInTheDocument()

    // e.g. a tablet rotated from landscape to portrait
    act(() => setViewportWidth(768))
    expect(screen.getByRole('button', { name: /indicators: 1\. cost/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeInTheDocument()

    act(() => setViewportWidth(1024))
    expect(screen.queryByRole('button', { name: /indicators: 1\. cost/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Count 1' })).toBeInTheDocument()
  })
})
