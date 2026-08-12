import { extendTheme, theme as baseTheme } from '@chakra-ui/react'

// `app.*` are the brand/structural colors used throughout theme.js's own component
// overrides (Button, Heading, Table, Tabs, Modal, body). `app.primary` is also used as an
// opaque header/button background, so it stays close to its light-mode value in dark mode
// (a colored header doesn't need to invert); tokens used as *text* or *subtle background*
// (primaryDark, surface*, text, muted, border*) flip for contrast against a dark page.
const semanticApp = {
  bg: { default: '#ffffff', _dark: '#0f1720' },
  surface: { default: '#ffffff', _dark: '#16212c' },
  surfaceMuted: { default: '#f8fafc', _dark: '#1c2934' },
  surfaceStrong: { default: '#edf3f8', _dark: '#22323f' },
  text: { default: '#1f2933', _dark: '#e6edf3' },
  muted: { default: '#5f6f7a', _dark: '#93a4b0' },
  border: { default: '#d7e0e6', _dark: '#2c3e4c' },
  borderStrong: { default: '#b9c8d0', _dark: '#3c5262' },
  primary: { default: '#325D88', _dark: '#3f6f9e' },
  primaryDark: { default: '#244767', _dark: '#9dc4e8' },
  primarySoft: { default: '#e7eef5', _dark: '#1f3347' },
  accent: { default: '#b76b43', _dark: '#d99a72' },
  accentSoft: { default: '#f5e7df', _dark: '#3a2a20' },
}

// The app's brand blue ramp, shadowing Chakra's default `blue.*` so every existing
// `bg="blue.50"` / `color="blue.600"` usage across the page components (info alerts, links,
// badges) automatically follows color mode without touching that component code.
const semanticBlue = {
  50: { default: '#e7eef5', _dark: '#1a2938' },
  100: { default: '#d4e1ed', _dark: '#22364a' },
  200: { default: '#b5cadf', _dark: '#2d4760' },
  300: { default: '#8eabc8', _dark: '#3f6080' },
  400: { default: '#6288ad', _dark: '#5a84a8' },
  500: { default: '#325D88', _dark: '#6fa0c9' },
  600: { default: '#2c537a', _dark: '#8bb4d8' },
  700: { default: '#244767', _dark: '#a8c8e6' },
  800: { default: '#1d3852', _dark: '#c3daf0' },
  900: { default: '#162a3e', _dark: '#dceaf7' },
}

// Chakra's default gray scale, shadowed the same way: the app's page components hardcode
// bg="white" / bg="gray.50" / color="gray.700" etc. everywhere, so overriding the base
// palette (rather than rewriting every usage) is what makes dark mode actually work across
// the app instead of just in the few places using `app.*` tokens directly.
const semanticGray = {
  50: { default: '#f7fafc', _dark: '#1a242e' },
  100: { default: '#edf2f7', _dark: '#232f3b' },
  200: { default: '#e2e8f0', _dark: '#2f3d4a' },
  300: { default: '#cbd5e0', _dark: '#3c4c5b' },
  400: { default: '#a0aec0', _dark: '#5c7080' },
  500: { default: '#718096', _dark: '#8494a3' },
  600: { default: '#4a5568', _dark: '#a8b7c2' },
  700: { default: '#2d3748', _dark: '#c7d3db' },
  800: { default: '#1a202c', _dark: '#e2e8ee' },
  900: { default: '#171923', _dark: '#f0f4f7' },
}

const colors = {
  blue: Object.fromEntries(Object.entries(semanticBlue).map(([k, v]) => [k, v.default])),
}

const focusRing = '0 0 0 3px rgba(50, 93, 136, 0.16)'

const theme = extendTheme({
  config: {
    initialColorMode: 'light',
    useSystemColorMode: false,
  },
  colors,
  semanticTokens: {
    colors: {
      app: semanticApp,
      white: { default: '#ffffff', _dark: '#16212c' },
      blue: semanticBlue,
      gray: semanticGray,
    },
  },
  fonts: {
    heading: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    body: '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  styles: {
    global: {
      html: {
        scrollBehavior: 'smooth',
      },
      body: {
        bg: 'app.bg',
        color: 'app.text',
        fontSize: '15px',
        lineHeight: 1.55,
        letterSpacing: 0,
      },
      a: {
        color: 'app.primary',
        fontWeight: 600,
        textUnderlineOffset: '0.18em',
        _hover: {
          color: 'app.accent',
        },
      },
      'h1, h2, h3, h4, h5, h6': {
        color: 'app.primaryDark',
        fontWeight: 700,
        letterSpacing: 0,
      },
    },
  },
  shadows: {
    sm: '0 2px 8px rgba(31, 41, 51, 0.07)',
    md: '0 12px 32px rgba(31, 41, 51, 0.10)',
  },
  radii: {
    md: '6px',
    lg: '8px',
  },
  components: {
    Button: {
      baseStyle: {
        borderRadius: '6px',
        fontWeight: 600,
        letterSpacing: 0,
        boxShadow: 'none',
        _focusVisible: {
          boxShadow: focusRing,
        },
      },
      variants: {
        solid: (props) => {
          if (props.colorScheme !== 'blue') return {}
          return {
            bg: 'app.primary',
            color: 'white',
            borderColor: 'app.primary',
            _hover: {
              bg: 'app.primaryDark',
              borderColor: 'app.primaryDark',
              _disabled: {
                bg: 'app.primary',
              },
            },
            _active: {
              bg: 'app.primaryDark',
            },
          }
        },
        outline: (props) => {
          if (props.colorScheme && props.colorScheme !== 'blue') return {}
          return {
            color: 'app.primaryDark',
            borderColor: 'app.borderStrong',
            _hover: {
              bg: 'app.primary',
              borderColor: 'app.primary',
              color: 'white',
            },
            _active: {
              bg: 'app.primaryDark',
              borderColor: 'app.primaryDark',
              color: 'white',
            },
          }
        },
        ghost: {
          color: 'app.primaryDark',
          _hover: {
            bg: 'app.primarySoft',
          },
          _active: {
            bg: 'app.primarySoft',
          },
        },
      },
    },
    Heading: {
      baseStyle: {
        color: 'app.primaryDark',
        letterSpacing: 0,
      },
    },
    Input: {
      variants: {
        outline: {
          field: {
            borderColor: 'app.border',
            borderRadius: '6px',
            color: 'app.text',
            _focusVisible: {
              borderColor: 'app.primary',
              boxShadow: focusRing,
            },
          },
        },
      },
    },
    Textarea: {
      variants: {
        outline: {
          field: {
            borderColor: 'app.border',
            borderRadius: '6px',
            color: 'app.text',
            _focusVisible: {
              borderColor: 'app.primary',
              boxShadow: focusRing,
            },
          },
        },
      },
    },
    Select: {
      variants: {
        outline: {
          field: {
            borderColor: 'app.border',
            borderRadius: '6px',
            color: 'app.text',
            _focusVisible: {
              borderColor: 'app.primary',
              boxShadow: focusRing,
            },
          },
        },
      },
    },
    Checkbox: {
      baseStyle: {
        control: {
          borderColor: 'app.borderStrong',
          borderRadius: '4px',
          _checked: {
            bg: 'app.primary',
            borderColor: 'app.primary',
            _hover: {
              bg: 'app.primary',
              borderColor: 'app.primary',
            },
          },
          _focusVisible: {
            boxShadow: focusRing,
          },
        },
        label: {
          color: 'app.text',
          fontWeight: 600,
        },
      },
    },
    // Chakra's built-in Badge/Alert theming picks a *different, fixed gray/blue shade number*
    // per color mode (e.g. bg: mode('gray.100','gray.800')) expecting those raw shades to stay
    // constant - but the gray/blue semantic tokens above make every shade reactive instead, so
    // a "gray" (default) or "blue" badge doubles up and resolves to unreadable low-contrast
    // text. Only those two color schemes are patched here, using the single-flip `app.*`
    // tokens; every other color scheme (green, orange, red, purple, teal, ...) is untouched by
    // the semantic tokens above, so Chakra's own default formula (reused via `baseTheme`)
    // already renders correctly in both modes.
    Badge: {
      variants: {
        subtle: (props) => {
          const { colorScheme: c } = props
          if (!c || c === 'gray') return { bg: 'app.surfaceStrong', color: 'app.text' }
          if (c === 'blue') return { bg: 'app.primarySoft', color: 'app.primaryDark' }
          return baseTheme.components.Badge.variants.subtle(props)
        },
        solid: (props) => {
          const { colorScheme: c } = props
          if (!c || c === 'gray') return { bg: 'app.borderStrong', color: 'app.text' }
          if (c === 'blue') return { bg: 'app.primary', color: '#ffffff' }
          return baseTheme.components.Badge.variants.solid(props)
        },
        outline: (props) => {
          const { colorScheme: c } = props
          if (!c || c === 'gray') return { color: 'app.text', boxShadow: 'inset 0 0 0px 1px app.borderStrong' }
          if (c === 'blue') return { color: 'app.primaryDark', boxShadow: 'inset 0 0 0px 1px app.primary' }
          return baseTheme.components.Badge.variants.outline(props)
        },
      },
    },
    Table: {
      variants: {
        simple: {
          th: {
            bg: 'app.surfaceStrong',
            color: 'app.primaryDark',
            borderColor: 'app.border',
            fontWeight: 700,
            letterSpacing: 0,
            textTransform: 'none',
          },
          td: {
            borderColor: 'app.border',
            color: 'app.text',
          },
        },
      },
    },
    Tabs: {
      variants: {
        'soft-rounded': {
          tab: {
            borderRadius: '6px',
            color: 'app.primaryDark',
            fontWeight: 600,
            _selected: {
              bg: 'app.primarySoft',
              color: 'app.primaryDark',
            },
            _focusVisible: {
              boxShadow: focusRing,
            },
          },
        },
      },
    },
    Modal: {
      baseStyle: {
        dialog: {
          borderRadius: '8px',
          borderWidth: '1px',
          borderColor: 'app.border',
          boxShadow: 'md',
          bg: 'app.surface',
        },
        header: {
          bg: 'app.surfaceMuted',
          color: 'app.primaryDark',
          borderBottomWidth: '1px',
          borderColor: 'app.border',
        },
        footer: {
          bg: 'app.surfaceMuted',
          borderTopWidth: '1px',
          borderColor: 'app.border',
        },
      },
    },
  },
})

export default theme
