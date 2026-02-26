import { useState } from 'react'
import { Box, Container, VStack } from '@chakra-ui/react'
import Navigation from './components/Navigation'
import InputPage from './pages/InputPage'
import QualitativeIndicatorsPage from './pages/QualitativeIndicatorsPage'
import ValueFunctionsPage from './pages/ValueFunctionsPage'
import PileBwtPage from './pages/PileBwtPage'
import AdminPage from './pages/AdminPage'
import SessionAccessPage from './pages/SessionAccessPage'
import CaseStudyPage from './pages/CaseStudyPage'
import RunUpMavtPage from './pages/RunUpMavtPage'
import RecapPage from './pages/RecapPage'

function App() {
  const [activeRole, setActiveRole] = useState('expert')
  const [expertPage, setExpertPage] = useState('session-access')
  const [practitionerPage, setPractitionerPage] = useState('case-study')
  const [isAdminView, setIsAdminView] = useState(false)
  const [lastView, setLastView] = useState({ role: 'expert', page: 'session-access' })
  const [sessionId, setSessionId] = useState(null)
  const [sessionCode, setSessionCode] = useState('')
  const [studySessionId, setStudySessionId] = useState(null)
  const [studyCode, setStudyCode] = useState('')

  const handleRoleChange = (role) => {
    setActiveRole(role)
    setIsAdminView(false)
  }

  const handlePageChange = (page) => {
    if (activeRole === 'expert') {
      setExpertPage(page)
    } else {
      setPractitionerPage(page)
    }
    setIsAdminView(false)
  }

  const handleAdminToggle = () => {
    if (isAdminView) {
      setIsAdminView(false)
      setActiveRole(lastView.role)
      if (lastView.role === 'expert') {
        setExpertPage(lastView.page)
      } else {
        setPractitionerPage(lastView.page)
      }
      return
    }

    setLastView({ role: activeRole, page: activeRole === 'expert' ? expertPage : practitionerPage })
    setIsAdminView(true)
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

  const currentPage = activeRole === 'expert' ? expertPage : practitionerPage

  return (
    <Box minH="100vh" bg="gray.50">
      <Navigation
        activeRole={activeRole}
        onRoleChange={handleRoleChange}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        sessionId={sessionId}
        studySessionId={studySessionId}
        isAdminView={isAdminView}
        onAdminToggle={handleAdminToggle}
      />
      <Container maxW="container.xl" py={8}>
        <VStack spacing={8} align="stretch">
          {isAdminView && <AdminPage />}

          {!isAdminView && activeRole === 'expert' && currentPage === 'session-access' && (
            <SessionAccessPage
              onSessionAccessed={handleSessionAccessed}
              onClearSession={handleSessionCleared}
              sessionCode={sessionCode}
            />
          )}
          {!isAdminView && activeRole === 'expert' && currentPage === 'qualitative' && sessionId && (
            <QualitativeIndicatorsPage sessionId={sessionId} />
          )}
          {!isAdminView && activeRole === 'expert' && currentPage === 'value' && sessionId && (
            <ValueFunctionsPage sessionId={sessionId} />
          )}
          {!isAdminView && activeRole === 'expert' && currentPage === 'pile' && sessionId && (
            <PileBwtPage sessionId={sessionId} onPageChange={handlePageChange} />
          )}
          {!isAdminView && activeRole === 'expert' && currentPage === 'recap' && sessionId && (
            <RecapPage sessionId={sessionId} onNavigate={handlePageChange} />
          )}

          {!isAdminView && activeRole === 'practitioner' && currentPage === 'case-study' && (
            <CaseStudyPage
              studySessionId={studySessionId}
              studyCode={studyCode}
              onStudyAccessed={handleStudySessionAccessed}
              onClearStudy={handleStudySessionCleared}
            />
          )}
          {!isAdminView && activeRole === 'practitioner' && currentPage === 'input-definition' && (
            <InputPage studySessionId={studySessionId} />
          )}
          {!isAdminView && activeRole === 'practitioner' && currentPage === 'run-up-mavt' && studySessionId && (
            <RunUpMavtPage studySessionId={studySessionId} onNavigate={handlePageChange} />
          )}
        </VStack>
      </Container>
    </Box>
  )
}

export default App
