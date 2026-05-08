import { extendTheme } from '@chakra-ui/react'

const colors = {
  app: {
    bg: '#ffffff',
    surface: '#ffffff',
    surfaceMuted: '#f8fafc',
    surfaceStrong: '#edf3f8',
    text: '#1f2933',
    muted: '#5f6f7a',
    border: '#d7e0e6',
    borderStrong: '#b9c8d0',
    primary: '#325D88',
    primaryDark: '#244767',
    primarySoft: '#e7eef5',
    accent: '#b76b43',
    accentSoft: '#f5e7df',
  },
  blue: {
    50: '#e7eef5',
    100: '#d4e1ed',
    200: '#b5cadf',
    300: '#8eabc8',
    400: '#6288ad',
    500: '#325D88',
    600: '#2c537a',
    700: '#244767',
    800: '#1d3852',
    900: '#162a3e',
  },
}

const focusRing = '0 0 0 3px rgba(50, 93, 136, 0.16)'

const theme = extendTheme({
  colors,
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
            borderColor: '#e6edf1',
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
