import React from 'react'
import ReactDOM from 'react-dom/client'
import { ChakraProvider } from '@chakra-ui/react'
import { BrowserRouter } from 'react-router-dom'
import axios from 'axios'
import App from './App.jsx'
import theme from './theme.js'
import { DEBUG_CONSOLE } from './config'
import './custom.css'

const DEBUG_FLAG = '__UP_MAVT_DEBUG_CONSOLE_ENABLED__'

const setupDebugConsole = () => {
  if (!DEBUG_CONSOLE || window[DEBUG_FLAG]) return
  window[DEBUG_FLAG] = true

  console.info('[UP-MAVT] Browser debug console is enabled (VITE_DEBUG_CONSOLE=true).')

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const cfg = error?.config || {}
      const status = error?.response?.status ?? 'NO_STATUS'
      const method = (cfg.method || 'UNKNOWN').toUpperCase()
      const url = `${cfg.baseURL || ''}${cfg.url || ''}`
      const payload = {
        status,
        method,
        url,
        code: error?.code,
        message: error?.message,
        response: error?.response?.data,
      }
      console.groupCollapsed(`[UP-MAVT][API ERROR] ${status} ${method} ${url}`)
      console.error(payload)
      console.groupEnd()
      return Promise.reject(error)
    },
  )

  window.addEventListener('error', (event) => {
    console.groupCollapsed('[UP-MAVT][UNCAUGHT ERROR]')
    console.error({
      message: event?.message,
      source: event?.filename,
      line: event?.lineno,
      column: event?.colno,
      error: event?.error,
    })
    console.groupEnd()
  })

  window.addEventListener('unhandledrejection', (event) => {
    console.groupCollapsed('[UP-MAVT][UNHANDLED PROMISE REJECTION]')
    console.error(event?.reason)
    console.groupEnd()
  })
}

setupDebugConsole()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChakraProvider theme={theme}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ChakraProvider>
  </React.StrictMode>,
)
