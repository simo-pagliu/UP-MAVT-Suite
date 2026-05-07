import { useState, useEffect, useCallback } from 'react'
import { Box, Center, Spinner, useToast } from '@chakra-ui/react'
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
  const [isRestoringSession, setIsRestoringSession] = useState(true)
  
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

  const toast = useToast()

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
    * @param {string}      code - Session identifier label.
   * @param {'stakeholder'|'practitioner'|'admin'} role - Authenticated role.
   */
  const handleLogin = useCallback((id, code, role) => {
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
      setPractitionerPage('input-definition')
    }
    // For admin role, no additional setup needed
  // fetchSessionFeatures is stable (only calls setState setters internally)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Resets all session state and returns to the login screen. */
  const handleLogout = async () => {
    if (currentRole === 'admin') {
      // Clear the HTTPOnly admin JWT cookies on the server side so the
      // auto-restore effect on next page load does not re-authenticate.
      try {
        await axios.get(`${API_URL}/admin/logout`, { withCredentials: true })
      } catch {
        // Proceed with local logout even if the request fails.
      }
    }
    setIsLoggedIn(false)
    setCurrentRole(null)
    setCurrentSessionId(null)
    setCurrentCode('')
    setSessionId(null)
    setSessionCode('')
    setStudySessionId(null)
    setStakeholderPage('qualitative')
    setPractitionerPage('input-definition')
    setShowDocumentation(false)
    setFeatures({ qi: false, vf: false, bwt: false })
  }

  /**
   * When the admin is logged in, register a beforeunload handler so that
   * closing the tab or doing a hard refresh (Ctrl+F5) clears the HTTPOnly
   * admin JWT cookies.  fetch() with keepalive:true is used because it
   * supports credentials (unlike navigator.sendBeacon) and is guaranteed to
   * complete even after the page begins unloading.
   */
  useEffect(() => {
    if (currentRole !== 'admin') return

    const handleBeforeUnload = () => {
      fetch(`${API_URL}/admin/logout`, {
        method: 'GET',
        credentials: 'include',
        keepalive: true,
      })
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [currentRole])

  /**
   * On mount, check whether a valid admin session cookie is present.
   * If the access token has expired, attempt a silent refresh.
   * On success the admin dashboard is restored; on failure the login page
   * is shown as normal.  Skipped when a ?uuid= param is present because
   * the UUID effect handles that login path.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('uuid')) {
      setIsRestoringSession(false)
      return
    }

    const restoreAdminSession = async () => {
      const adminAxios = axios.create({ withCredentials: true })
            try {
        await adminAxios.get(`${API_URL}/admin/verify`)
        handleLogin(null, 'admin', 'admin')
      } catch (verifyError) {
        if (verifyError.response?.status === 401) {
          try {
            await adminAxios.get(`${API_URL}/admin/refresh`)
            handleLogin(null, 'admin', 'admin')
          } catch {
            // Refresh also failed — show login page
          }
        }
      } finally {
        setIsRestoringSession(false)
      }
    }
    restoreAdminSession()
  // handleLogin is stable (useCallback with no deps that change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  /** Handles clicking the UP-MAVT Suite logo to return to homepage */
  const handleLogoClick = () => {
    if (isLoggedIn) {
      handleLogout()
    } else {
      setShowDocumentation(false)
    }
  }

  /**
   * Stores the accessed stakeholder session and immediately fetches its
   * feature flags so the navigation reflects the correct enabled steps.
   *
   * @param {string}      id   - Stakeholder elicitation session ID.
    * @param {string|null} code - Session identifier label.
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
   * @param {string|null} code - Deprecated legacy code (ignored).
   */
  const handleStudySessionAccessed = (id, code) => {
    setStudySessionId(id)
  }

  /** Clears the active practitioner study session. */
  const handleStudySessionCleared = () => {
    setStudySessionId(null)
  }

  /**
   * On mount, check for a ?uuid= query parameter and auto-login if present.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const uuid = params.get('uuid')
    if (!uuid) return

    axios.get(`${API_URL}/session/detect/${encodeURIComponent(uuid)}`)
      .then(({ data }) => {
        if (data.exists) {
          handleLogin(data._id, data._id, data.type)
          // Remove the uuid param from the URL without triggering a reload
          const url = new URL(window.location.href)
          url.searchParams.delete('uuid')
          window.history.replaceState({}, '', url.toString())
        } else {
          toast({
            title: 'Session not found',
            description: 'The link UUID did not match any session.',
            status: 'error',
            duration: 5000,
            isClosable: true,
          })
        }
      })
      .catch(() => {
        toast({
          title: 'Auto-login failed',
          description: 'Could not load the session from the link UUID.',
          status: 'error',
          duration: 5000,
          isClosable: true,
        })
      })
  }, [handleLogin, toast])

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
    <Box minH="100vh" bg="app.bg">
      <Navigation
        onLogoClick={handleLogoClick}
        isLoggedIn={isLoggedIn}
        currentRole={currentRole}
        currentPage={currentPage}
        onPageChange={handlePageChange}
        sessionId={sessionId}
        studySessionId={studySessionId}
        features={features}
        onLogout={handleLogout}
        onDocumentation={handleDocumentation}
      />
      {/* Checking for a persisted admin session on first load */}
      {isRestoringSession && (
        <Center h="calc(100vh - 72px)">
          <Spinner size="xl" />
        </Center>
      )}

      {/* Login/Documentation for unauthenticated users */}
      {!isRestoringSession && !isLoggedIn && !showDocumentation && (
        <LoginPage onLogin={handleLogin} onDocumentation={handleDocumentation} />
      )}

      {!isRestoringSession && !isLoggedIn && showDocumentation && (
        <Box py={8} px={{ base: 4, md: 8 }}>
          <DocumentationPage />
        </Box>
      )}

      {!isRestoringSession && isLoggedIn && (
        <Box py={8} px={{ base: 4, md: 8 }}>
          {/* Admin Page */}
          {currentRole === 'admin' && <AdminPage />}

          {/* Documentation Page */}
          {currentRole !== 'admin' && showDocumentation && <DocumentationPage />}

          {/* Stakeholder Pages */}
          {currentRole === 'stakeholder' && !showDocumentation && (
            <>
              {currentPage === 'qualitative' && sessionId && features.qi && (
                <QualitativeIndicatorsPage sessionId={sessionId} onPageChange={handlePageChange} />
              )}
              {currentPage === 'value' && sessionId && features.vf && (
                <ValueFunctionsPage sessionId={sessionId} onPageChange={handlePageChange} />
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
          {currentRole === 'practitioner' && !showDocumentation && (
            <>
              {currentPage === 'case-study' && (
                <CaseStudyPage
                  studySessionId={studySessionId}
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
        </Box>
      )}
    </Box>
  )
}

export default App
