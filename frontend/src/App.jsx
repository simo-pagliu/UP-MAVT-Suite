import { useState } from 'react'
import { Box, Container, VStack } from '@chakra-ui/react'
import Navigation from './components/Navigation'
import LoginPage from './pages/LoginPage'
import DocumentationPage from './pages/DocumentationPage'
import InputPage from './pages/InputPage'
import QualitativeIndicatorsPage from './pages/QualitativeIndicatorsPage'
import ValueFunctionsPage from './pages/ValueFunctionsPage'
import PileBwtPage from './pages/PileBwtPage'
import AdminPage from './pages/AdminPage'
import CaseStudyPage from './pages/CaseStudyPage'
import RunUpMavtPage from './pages/RunUpMavtPage'
import RecapPage from './pages/RecapPage'

function App() {
  // Login state
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [currentRole, setCurrentRole] = useState(null) // 'stakeholder' or 'practitioner'
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [currentCode, setCurrentCode] = useState('')
  
  // Page navigation
  const [stakeholderPage, setStakeholderPage] = useState('qualitative')
  const [practitionerPage, setPractitionerPage] = useState('case-study')
  const [showDocumentation, setShowDocumentation] = useState(false)

  // Stakeholder session credentials (for loading specific sessions)
  const [sessionId, setSessionId] = useState(null)
  const [sessionCode, setSessionCode] = useState('')

  // Practitioner session credentials
  const [studySessionId, setStudySessionId] = useState(null)
  const [studyCode, setStudyCode] = useState('')

  const handleLogin = (id, code, role) => {
    setIsLoggedIn(true)
    setCurrentRole(role)
    setCurrentSessionId(id)
    setCurrentCode(code)
    setShowDocumentation(false)
    
    if (role === 'stakeholder') {
      // For stakeholder, the id is the session id
      setSessionId(id)
      setSessionCode(code)
      setStakeholderPage('qualitative')
    } else if (role === 'practitioner') {
      // For practitioner, the id is the study session id
      setStudySessionId(id)
      setStudyCode(code)
      setPractitionerPage('case-study')
    }
    // For admin role, no additional setup needed
  }

  const handleLogout = () => {
    setIsLoggedIn(false)
    setCurrentRole(null)
    setCurrentSessionId(null)
    setCurrentCode('')
    setSessionId(null)
    setSessionCode('')
    setStudySessionId(null)
    setStudyCode('')
    setStakeholderPage('qualitative')
    setPractitionerPage('case-study')
    setShowDocumentation(false)
  }

  const handlePageChange = (page) => {
    if (currentRole === 'stakeholder') {
      setStakeholderPage(page)
    } else {
      setPractitionerPage(page)
    }
    setShowDocumentation(false)
  }

  const handleDocumentation = () => {
    setShowDocumentation(!showDocumentation)
  }

  const handleSessionAccessed = (id, code) => {
    setSessionId(id)
    setSessionCode(code || '')
  }

  const handleSessionCleared = () => {
    setSessionId(null)
    setSessionCode('')
  }

  const handleStudySessionAccessed = (id, code) => {
    setStudySessionId(id)
    setStudyCode(code || '')
  }

  const handleStudySessionCleared = () => {
    setStudySessionId(null)
    setStudyCode('')
  }

  const currentPage = currentRole === 'stakeholder' ? stakeholderPage : practitionerPage

  return (
    <Box minH="100vh" bg="gray.50">
      <Navigation
        isLoggedIn={isLoggedIn}
        currentRole={currentRole}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        sessionId={sessionId}
        studySessionId={studySessionId}
        onLogin={() => handleLogout()} // Show login page by logging out
        onLogout={handleLogout}
        onDocumentation={handleDocumentation}
      />
      <Container maxW="container.xl" py={8}>
        <VStack spacing={8} align="stretch">
          {/* Login Page - Landing page */}
          {!isLoggedIn && <LoginPage onLogin={handleLogin} />}

          {/* Admin Page */}
          {isLoggedIn && currentRole === 'admin' && <AdminPage />}

          {/* Documentation Page */}
          {isLoggedIn && currentRole !== 'admin' && showDocumentation && <DocumentationPage />}

          {/* Stakeholder Pages */}
          {isLoggedIn && currentRole === 'stakeholder' && !showDocumentation && (
            <>
              {currentPage === 'qualitative' && sessionId && (
                <QualitativeIndicatorsPage sessionId={sessionId} />
              )}
              {currentPage === 'value' && sessionId && (
                <ValueFunctionsPage sessionId={sessionId} />
              )}
              {currentPage === 'pile' && sessionId && (
                <PileBwtPage sessionId={sessionId} onPageChange={handlePageChange} />
              )}
              {currentPage === 'recap' && sessionId && (
                <RecapPage sessionId={sessionId} onNavigate={handlePageChange} />
              )}
            </>
          )}

          {/* Practitioner Pages */}
          {isLoggedIn && currentRole === 'practitioner' && !showDocumentation && (
            <>
              {currentPage === 'case-study' && (
                <CaseStudyPage
                  studySessionId={studySessionId}
                  studyCode={studyCode}
                  onStudyAccessed={handleStudySessionAccessed}
                  onClearStudy={handleStudySessionCleared}
                />
              )}
              {currentPage === 'input-definition' && (
                <InputPage studySessionId={studySessionId} />
              )}
              {currentPage === 'run-up-mavt' && studySessionId && (
                <RunUpMavtPage studySessionId={studySessionId} onNavigate={handlePageChange} />
              )}
            </>
          )}
        </VStack>
      </Container>
    </Box>
  )
}

export default App
