import { useState } from 'react'
import { Box, Container, VStack } from '@chakra-ui/react'
import Navigation from './components/Navigation'
import InputPage from './pages/InputPage'
import QualitativeIndicatorsPage from './pages/QualitativeIndicatorsPage'
import ValueFunctionsPage from './pages/ValueFunctionsPage'
import PileBwtPage from './pages/PileBwtPage'
import OutputPage from './pages/OutputPage'
import AdminPage from './pages/AdminPage'

function App() {
  const [currentPage, setCurrentPage] = useState('input')
  const [sessionId, setSessionId] = useState(null)

  const handlePageChange = (page) => {
    setCurrentPage(page)
  }

  const handleSessionCreated = (id) => {
    setSessionId(id)
    setCurrentPage('qualitative')
  }

  return (
    <Box minH="100vh" bg="gray.50">
      <Navigation currentPage={currentPage} onPageChange={handlePageChange} />
      <Container maxW={currentPage === 'admin' ? 'container.xl' : 'lg'} py={8}>
        <VStack spacing={8} align="stretch">
          {currentPage === 'input' && (
            <InputPage onSessionCreated={handleSessionCreated} sessionId={sessionId} />
          )}
          {currentPage === 'qualitative' && sessionId && (
            <QualitativeIndicatorsPage sessionId={sessionId} />
          )}
          {currentPage === 'value' && sessionId && (
            <ValueFunctionsPage sessionId={sessionId} />
          )}
          {currentPage === 'pile' && sessionId && (
            <PileBwtPage sessionId={sessionId} />
          )}
          {currentPage === 'output' && sessionId && (
            <OutputPage sessionId={sessionId} />
          )}
          {currentPage === 'admin' && (
            <AdminPage />
          )}
        </VStack>
      </Container>
    </Box>
  )
}

export default App
