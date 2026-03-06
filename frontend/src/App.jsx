import { useState, useEffect } from 'react'
import { Box, Container, VStack } from '@chakra-ui/react'
import axios from 'axios'
import { API_URL } from './config'
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
  const [practitionerPage, setPractitionerPage] = useState('input-definition')
  const [showDocumentation, setShowDocumentation] = useState(false)

  // Stakeholder session credentials (for loading specific sessions)
  const [sessionId, setSessionId] = useState(null)
  const [sessionCode, setSessionCode] = useState('')
  const [features, setFeatures] = useState({ qi: false, vf: false, bwt: false })

  // Practitioner session credentials
  const [studySessionId, setStudySessionId] = useState(null)
  const [studyCode, setStudyCode] = useState('')

  /**
   * Fetches the enabled feature flags (qi, vf, bwt) for a given stakeholder
   * session by first resolving its parent study session and then reading the
   * `features` field from that study session document.
   *
   * @param {string} sessionId - The stakeholder elicitation session ID.
   */
  const fetchSessionFeatures = async (sessionId) => {
    try {
      const { data } = await axios.get(`${API_URL}/session/${sessionId}`)
      // Get the study session ID and fetch features from there
      if (data.study_session_id) {
        const { data: studyData } = await axios.get(`${API_URL}/study-session/${data.study_session_id}`)
        if (studyData.features) {
          setFeatures(studyData.features)
        }
      }
    } catch (error) {
      console.error('Failed to fetch features:', error)
    }
  }

  /**
   * Called by LoginPage on successful authentication.  Updates the shared
   * session state, routes to the correct landing page for the role, and — for
   * stakeholders — fetches the feature flags.
   *
   * @param {string|null} id   - Session ID (stakeholder) or study-session ID (practitioner). Null for admin.
   * @param {string}      code - Human-readable session code.
   * @param {'stakeholder'|'practitioner'|'admin'} role - Authenticated role.
   */
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
      // Fetch features for this session
      fetchSessionFeatures(id)
    } else if (role === 'practitioner') {
      // For practitioner, the id is the study session id
      setStudySessionId(id)
      setStudyCode(code)
      setPractitionerPage('input-definition')
    }
    // For admin role, no additional setup needed
  }

  /** Resets all session state and returns to the login screen. */
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
    setPractitionerPage('input-definition')
    setShowDocumentation(false)
    setFeatures({ qi: false, vf: false, bwt: false })
  }

  /**
   * Switches the active page for the current role and hides the documentation
   * panel if it is visible.
   *
   * @param {string} page - The page identifier to navigate to.
   */
  const handlePageChange = (page) => {
    if (currentRole === 'stakeholder') {
      setStakeholderPage(page)
    } else {
      setPractitionerPage(page)
    }
    setShowDocumentation(false)
  }

  /** Toggles the documentation overlay on/off. */
  const handleDocumentation = () => {
    setShowDocumentation(!showDocumentation)
  }

  /**
   * Stores the accessed stakeholder session and immediately fetches its
   * feature flags so the navigation reflects the correct enabled steps.
   *
   * @param {string}      id   - Stakeholder elicitation session ID.
   * @param {string|null} code - Session code (may be empty for admin-created sessions).
   */
  const handleSessionAccessed = (id, code) => {
    setSessionId(id)
    setSessionCode(code || '')
    // Fetch features for this session
    fetchSessionFeatures(id)
  }

  /** Clears the active stakeholder session and resets feature flags. */
  const handleSessionCleared = () => {
    setSessionId(null)
    setSessionCode('')
    setFeatures({ qi: false, vf: false, bwt: false })
  }

  /**
   * Stores the accessed practitioner study session.
   *
   * @param {string}      id   - Study session ID.
   * @param {string|null} code - Study code displayed in the UI.
   */
  const handleStudySessionAccessed = (id, code) => {
    setStudySessionId(id)
    setStudyCode(code || '')
  }

  /** Clears the active practitioner study session. */
  const handleStudySessionCleared = () => {
    setStudySessionId(null)
    setStudyCode('')
  }

  const currentPage = currentRole === 'stakeholder' ? stakeholderPage : practitionerPage

  // Reset page if current page becomes disabled due to feature changes
  useEffect(() => {
    if (currentRole === 'stakeholder' && features) {
      const isCurrentPageDisabled = 
        (stakeholderPage === 'qualitative' && !features.qi) ||
        (stakeholderPage === 'value' && !features.vf) ||
        (stakeholderPage === 'pile' && !features.bwt)
      
      if (isCurrentPageDisabled) {
        // Switch to recap or the first enabled feature page
        setStakeholderPage('recap')
      }
    }
  }, [features, stakeholderPage, currentRole])

  return (
    <Box minH="100vh" bg="gray.50">
      <Navigation
        isLoggedIn={isLoggedIn}
        currentRole={currentRole}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        sessionId={sessionId}
        studySessionId={studySessionId}
        features={features}
        onLogin={() => handleLogout()} // Show login page by logging out
        onLogout={handleLogout}
        onDocumentation={handleDocumentation}
      />
      <Container maxW="container.xl" py={8}>
        <VStack spacing={8} align="stretch">
          {/* Login Page - Landing page */}
          {!isLoggedIn && <LoginPage onLogin={handleLogin} onDocumentation={handleDocumentation} />}

          {/* Admin Page */}
          {isLoggedIn && currentRole === 'admin' && <AdminPage />}

          {/* Documentation Page */}
          {isLoggedIn && currentRole !== 'admin' && showDocumentation && <DocumentationPage />}

          {/* Stakeholder Pages */}
          {isLoggedIn && currentRole === 'stakeholder' && !showDocumentation && (
            <>
              {currentPage === 'qualitative' && sessionId && features.qi && (
                <QualitativeIndicatorsPage sessionId={sessionId} />
              )}
              {currentPage === 'value' && sessionId && features.vf && (
                <ValueFunctionsPage sessionId={sessionId} />
              )}
              {currentPage === 'pile' && sessionId && features.bwt && (
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
