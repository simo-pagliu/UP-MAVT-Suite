// jsdom has no matchMedia, and Chakra's useBreakpointValue / useMediaQuery need it.
// Width queries are evaluated against window.innerWidth (jsdom default: 1024, i.e. the
// desktop layout). Any other media feature (hover, pointer, …) reports false.
const toPx = (value, unit) => (unit === 'em' || unit === 'rem' ? value * 16 : value)

const evaluateMediaQuery = (query) => {
  const conditions = query.match(/\([^()]*\)/g) || []
  if (conditions.length === 0) return false
  const width = window.innerWidth
  return conditions.every((condition) => {
    const match = condition.match(/^\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)$/)
    if (!match) return false
    const px = toPx(Number(match[2]), match[3])
    return match[1] === 'min' ? width >= px : width <= px
  })
}

const liveQueries = new Set()

export function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query) => {
      const listeners = new Set()
      const mql = {
        media: query,
        get matches() {
          return evaluateMediaQuery(query)
        },
        onchange: null,
        addListener: (fn) => listeners.add(fn),
        removeListener: (fn) => listeners.delete(fn),
        addEventListener: (_type, fn) => listeners.add(fn),
        removeEventListener: (_type, fn) => listeners.delete(fn),
        dispatchEvent: () => false,
        listeners,
      }
      liveQueries.add(mql)
      return mql
    },
  })
}

/**
 * Changes the emulated viewport width and notifies subscribed media queries,
 * like a real window resize or device rotation. Wrap in act() when components are mounted.
 */
export function setViewportWidth(width) {
  window.innerWidth = width
  liveQueries.forEach((mql) => {
    const event = { media: mql.media, matches: mql.matches }
    mql.listeners.forEach((fn) => fn(event))
  })
}
