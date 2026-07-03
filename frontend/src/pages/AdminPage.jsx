import { useState, useEffect, forwardRef, useImperativeHandle } from 'react'
import {
  Box,
  Heading,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Button,
  useToast,
  Spinner,
  Center,
  Text,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  useDisclosure,
  HStack,
  VStack,
  Input,
  FormControl,
  FormLabel,
  IconButton,
  Badge,
  Tooltip,
  Progress,
} from '@chakra-ui/react'
import { DeleteIcon, DownloadIcon, ArrowUpIcon, ChevronDownIcon, ChevronRightIcon, CopyIcon, LockIcon, UnlockIcon } from '@chakra-ui/icons'
import { useRef, Fragment } from 'react'
import axios from 'axios'
import { API_URL } from '../config'

/**
 * Axios instance that always sends credentials (cookies) so the admin
 * HTTPOnly JWT cookies are included in every request automatically.
 * JavaScript never reads or writes the token values directly.
 */
const adminApi = axios.create({ withCredentials: true })

function AdminPage(props, ref) {
  const [studySessions, setStudySessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleteId, setDeleteId] = useState(null)
  const [deleteType, setDeleteType] = useState('study') // 'study' or 'session'
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [expandedStudies, setExpandedStudies] = useState(new Set())
  const [togglingStudyById, setTogglingStudyById] = useState({})
  const [togglingSessionById, setTogglingSessionById] = useState({})
  const { isOpen, onOpen, onClose } = useDisclosure()
  const cancelRef = useRef()
  const toast = useToast()
  const backupFileInputRef = useRef(null)

  useImperativeHandle(ref, () => ({
    async saveBeforeNavigate() {
      // AdminPage does not have persistent state
    },
  }))

  // On mount, ask the backend whether the stored HTTPOnly cookies are still
  // valid.  If the access token has expired but the refresh token is still
  // valid, a silent refresh is attempted before deciding.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        await adminApi.get(`${API_URL}/admin/verify`)
        setIsAuthenticated(true)
      } catch (verifyError) {
        if (verifyError.response?.status === 401) {
          // Access token may have expired; try a silent refresh.
          try {
            await adminApi.get(`${API_URL}/admin/refresh`)
            setIsAuthenticated(true)
          } catch {
            // Refresh also failed — show the login form.
          }
        }
      } finally {
        setLoading(false)
      }
    }
    checkAuth()
  }, [])

  /**
   * Silently refresh the access token via the refresh cookie.
   * Returns true on success; on failure the user is logged out.
   */
  const refreshAccessToken = async () => {
    try {
      await adminApi.get(`${API_URL}/admin/refresh`)
      return true
    } catch {
      // Refresh token expired or invalid – force re-login.
      setIsAuthenticated(false)
      return false
    }
  }

  /**
   * Execute an Axios request function.  If the request fails with 401,
   * attempt to refresh the access token once and retry.  This keeps the
   * user logged in across access-token expirations without any manual
   * token handling on the frontend.
   */
  const withAuth = async (requestFn) => {
    try {
      return await requestFn()
    } catch (error) {
      if (error.response?.status === 401) {
        const refreshed = await refreshAccessToken()
        if (refreshed) {
          return await requestFn()
        }
        throw error
      }
      throw error
    }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setIsAuthenticating(true)

    try {
      const response = await adminApi.post(`${API_URL}/admin/login`, { password })

      if (response.data.success) {
        setIsAuthenticated(true)
        setPassword('')
      } else {
        toast({
          title: 'Request failed',
          description: 'Invalid password',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
      }
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to authenticate',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleLogout = async () => {
    try {
      await adminApi.get(`${API_URL}/admin/logout`)
    } catch {
      // Proceed with local logout even if the request fails.
    }
    setIsAuthenticated(false)
    setPassword('')
  }

  const fetchSessions = async () => {
    try {
      setLoading(true)
      const response = await axios.get(`${API_URL}/study-sessions`)
      const data = response.data
      setStudySessions(data)
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to load sessions',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) {
      fetchSessions()
    }
  }, [isAuthenticated])

  const handleDeleteClick = (studyId) => {
    setDeleteId(studyId)
    setDeleteType('study')
    onOpen()
  }

  const handleDeleteConfirm = async () => {
    try {
      if (deleteType === 'study') {
        await axios.delete(`${API_URL}/study-session/${deleteId}`)
        toast({
          title: 'Completed',
          description: 'Study session deleted successfully',
          status: 'success',
          duration: 3000,
          isClosable: true,
        })
      } else {
        await axios.delete(`${API_URL}/session/${deleteId}`)
        toast({
          title: 'Completed',
          description: 'Session deleted successfully',
          status: 'success',
          duration: 3000,
          isClosable: true,
        })
      }
      
      fetchSessions()
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || `Failed to delete ${deleteType}`,
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      onClose()
      setDeleteId(null)
    }
  }

  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleString()
  }

  const calculateProgress = (study) => {
    const sessions = Array.isArray(study?.sessions) ? study.sessions : []
    if (sessions.length === 0) {
      return { percentage: 0, sessionDetails: [] }
    }

    let totalSteps = 0
    let completedSteps = 0
    const sessionDetails = []

    sessions.forEach(session => {
      const steps = [
        { key: 'qualitative_indicators', label: 'Qualitative Indicators' },
        { key: 'value_functions', label: 'Quantitative Indicators' },
        { key: 'bwt', label: 'Weight Elicitation' },
      ]

      const sessionSteps = []
      steps.forEach(step => {
        totalSteps++
        const isCompleted = session[step.key] !== null && session[step.key] !== undefined
        if (isCompleted) {
          completedSteps++
        }
        sessionSteps.push({ label: step.label, completed: isCompleted })
      })

      sessionDetails.push({
        label: session?.friendly_name || session?._id || 'Session',
        steps: sessionSteps
      })
    })

    const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0
    
    return { percentage, sessionDetails }
  }

  const toggleExpanded = (studyId) => {
    setExpandedStudies(prev => {
      const newSet = new Set(prev)
      if (newSet.has(studyId)) {
        newSet.delete(studyId)
      } else {
        newSet.add(studyId)
      }
      return newSet
    })
  }

  const calculateSessionProgress = (session) => {
    const steps = [
      { key: 'qualitative_indicators', label: 'Qualitative Indicators' },
      { key: 'value_functions', label: 'Quantitative Indicators' },
      { key: 'bwt', label: 'Weight Elicitation' },
    ]

    const sessionSteps = []
    let completed = 0

    steps.forEach(step => {
      const isCompleted = session[step.key] !== null && session[step.key] !== undefined
      if (isCompleted) completed++
      sessionSteps.push({ label: step.label, completed: isCompleted })
    })

    const percentage = Math.round((completed / steps.length) * 100)
    return { percentage, steps: sessionSteps }
  }

  const handleToggleSessionStatus = async (sessionId) => {
    setTogglingSessionById((prev) => ({ ...prev, [sessionId]: true }))
    try {
      const response = await axios.put(`${API_URL}/session/${sessionId}/lock-session`)

      toast({
        title: 'Completed',
        description: response.data.session_locked ? 'Session locked' : 'Session unlocked',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })

      await fetchSessions()
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to toggle session lock',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setTogglingSessionById((prev) => ({ ...prev, [sessionId]: false }))
    }
  }

  const handleDeleteSession = (sessionId) => {
    setDeleteId(sessionId)
    setDeleteType('session')
    onOpen()
  }

  const handleToggleStatus = async (studyId) => {
    // Find the first session in the study to toggle its lock
    const study = studySessions.find(s => s._id === studyId)
    if (!study || !study.sessions || study.sessions.length === 0) return

    const firstSession = study.sessions[0]
    setTogglingStudyById((prev) => ({ ...prev, [studyId]: true }))
    
    try {
      const response = await axios.put(`${API_URL}/session/${firstSession._id}/lock-session`)

      toast({
        title: 'Completed',
        description: response.data.session_locked ? 'Study locked' : 'Study unlocked',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })

      await fetchSessions()
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to toggle status',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setTogglingStudyById((prev) => ({ ...prev, [studyId]: false }))
    }
  }

  const getStudyLockStatus = (study) => {
    if (!study.sessions || study.sessions.length === 0) return false
    // Check if any session is locked
    return study.sessions.some(s => s.session_locked || s.locked)
  }

  const handleDownloadCaseStudy = (studyId) => {
    window.open(`${API_URL}/study-session/${studyId}/backup/export`, '_blank')
  }

  const buildUuidLink = (uuid) => {
    const url = new URL(window.location.href)
    url.searchParams.set('uuid', uuid)
    return url.toString()
  }

  const handleCopyStudyLink = async (studyId) => {
    if (!studyId) {
      toast({
        title: 'Request failed',
        description: 'No case study ID available to copy',
        status: 'error',
        duration: 2000,
        isClosable: true,
      })
      return
    }

    try {
      await navigator.clipboard.writeText(buildUuidLink(studyId))
      toast({
        title: 'Completed',
        description: 'Case study link copied',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch {
      toast({
        title: 'Request failed',
        description: 'Failed to copy case study link',
        status: 'error',
        duration: 2000,
        isClosable: true,
      })
    }
  }

  const uploadCaseStudy = async (onConflict = 'abort') => {
    const file = backupFileInputRef.current?.files?.[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await axios.post(
        `${API_URL}/study-session/backup/import?on_conflict=${onConflict}&preserve_creator_email=1`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      const importedCountRaw = response.data?.imported_session_count
      const importedCount = Number.isFinite(importedCountRaw)
        ? importedCountRaw
        : (Array.isArray(response.data?.imported_sessions) ? response.data.imported_sessions.length : 0)
      const warnings = Array.isArray(response.data?.warnings)
        ? response.data.warnings.filter((w) => typeof w === 'string' && w.trim().length > 0)
        : []
      const warningSummary = warnings.length > 0 ? ` Warning: ${warnings.join(' ')}` : ''
      toast({
        title: warnings.length > 0 ? 'Case study imported with warnings' : 'Case study imported',
        description: `Study ID: ${response.data?.study_session_id || 'created'}; imported sessions: ${importedCount}.${warningSummary}`,
        status: warnings.length > 0 ? 'warning' : 'success',
        duration: warnings.length > 0 ? 6000 : 3000,
        isClosable: true,
      })
      fetchSessions()
    } catch (error) {
      const message = error.response?.data?.error || 'Failed to import case study'
      if (message.toLowerCase().includes('conflict') && onConflict === 'abort') {
        const shouldRegenerate = window.confirm('Identifier conflict detected. Regenerate identifiers and continue import?')
        if (shouldRegenerate) {
          await uploadCaseStudy('regenerate')
          return
        }
      }
      toast({
        title: 'Request failed',
        description: message,
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      if (backupFileInputRef.current) {
        backupFileInputRef.current.value = ''
      }
    }
  }

  const handleUploadClick = async () => {
    await uploadCaseStudy('abort')
  }

  // Show a spinner while the initial auth / session fetch is in progress
  // (keeps the login form hidden until we know the cookie check has failed)
  if (loading) {
    return (
      <Center h="400px">
        <Spinner size="xl" />
      </Center>
    )
  }

  // Show login form if not authenticated
  if (!isAuthenticated) {
    return (
      <Center h="400px">
        <Box p={8} maxW="md" borderWidth={1} borderRadius="lg" bg="white" boxShadow="md">
          <VStack spacing={4} as="form" onSubmit={handleLogin}>
            <Heading size="lg">Admin Login</Heading>
            <FormControl isRequired>
              <FormLabel>Password</FormLabel>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
              />
            </FormControl>
            <Button
              type="submit"
              colorScheme="blue"
              width="100%"
              isLoading={isAuthenticating}
            >
              Login
            </Button>
          </VStack>
        </Box>
      </Center>
    )
  }

  return (
    <Box p={8}>
      <HStack justify="space-between" mb={6}>
        <Heading>Admin - Manage Sessions</Heading>
        <Button
          leftIcon={<ArrowUpIcon />}
          colorScheme="blue"
          onClick={() => backupFileInputRef.current?.click()}
        >
          Upload Case Study
        </Button>
        <Input
          ref={backupFileInputRef}
          type="file"
          accept=".zip"
          display="none"
          onChange={handleUploadClick}
        />
      </HStack>
      
      {studySessions.length === 0 ? (
        <Text>No study sessions found.</Text>
      ) : (
        <Box overflowX="auto">
          <Table variant="simple" size="md">
            <Thead>
              <Tr>
                <Th width="40px"></Th>
                <Th>Case Study ID</Th>
                <Th>Date Created</Th>
                <Th>Status</Th>
                <Th>Progress</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {studySessions.map((study) => {
                const progress = calculateProgress(study) || { percentage: 0, sessionDetails: [] }
                const isLocked = getStudyLockStatus(study)
                const isExpanded = expandedStudies.has(study._id)

                return (
                  <Fragment key={study._id}>
                    {/* Case Study Row */}
                    <Tr _hover={{ bg: 'gray.50' }} bg="white">
                      <Td>
                        <IconButton
                          aria-label="Expand sessions"
                          icon={isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleExpanded(study._id)}
                          isDisabled={!study.sessions || study.sessions.length === 0}
                        />
                      </Td>
                      <Td>
                        <VStack align="start" spacing={0}>
                          <HStack spacing={1}>
                            <Text fontWeight="bold">{study._id || 'N/A'}</Text>
                            <Tooltip label={study._id ? 'Copy case study link' : 'No case study ID'} hasArrow>
                              <IconButton
                                aria-label="Copy case study link"
                                icon={<CopyIcon />}
                                size="xs"
                                variant="ghost"
                                onClick={() => handleCopyStudyLink(study._id)}
                                isDisabled={!study._id}
                              />
                            </Tooltip>
                          </HStack>
                          {study.title ? <Text fontSize="sm">{study.title}</Text> : null}
                          {study.description ? (
                            <Text fontSize="xs" color="gray.600" noOfLines={2} maxW="360px">
                              {study.description}
                            </Text>
                          ) : null}
                        </VStack>
                      </Td>
                      <Td>{formatDate(study.created_at)}</Td>
                      <Td>
                        <Tooltip
                          label={`Current status: ${isLocked ? 'Locked' : 'Unlocked'}. Click to ${isLocked ? 'unlock' : 'lock'} this case study.`}
                          hasArrow
                        >
                          <Button
                            size="xs"
                            leftIcon={isLocked ? <LockIcon /> : <UnlockIcon />}
                            colorScheme={isLocked ? 'red' : 'green'}
                            variant="solid"
                            aria-label={isLocked ? 'Unlock case study' : 'Lock case study'}
                            onClick={() => handleToggleStatus(study._id)}
                            isLoading={Boolean(togglingStudyById[study._id])}
                            isDisabled={Boolean(togglingStudyById[study._id])}
                          >
                            {isLocked ? 'Click to unlock' : 'Click to lock'}
                          </Button>
                        </Tooltip>
                      </Td>
                      <Td>
                        <Tooltip 
                          label={
                            <VStack align="stretch" spacing={1}>
                              {(Array.isArray(progress?.sessionDetails) ? progress.sessionDetails : []).map((session, idx) => (
                                <Box key={idx}>
                                  <Text fontWeight="bold" fontSize="xs">{session.label}:</Text>
                                  {(Array.isArray(session?.steps) ? session.steps : []).map((step, stepIdx) => (
                                    <Text key={stepIdx} fontSize="xs" pl={2}>
                                      {step.completed ? '✓' : '✗'} {step.label}
                                    </Text>
                                  ))}
                                </Box>
                              ))}
                            </VStack>
                          } 
                          hasArrow 
                          placement="top"
                        >
                          <Box>
                            <HStack spacing={2}>
                              <Progress
                                value={progress.percentage}
                                size="sm"
                                colorScheme={progress.percentage === 100 ? 'green' : 'blue'}
                                width="120px"
                                borderRadius="md"
                              />
                              <Text fontSize="sm" fontWeight="medium" minW="45px">
                                {progress.percentage}%
                              </Text>
                            </HStack>
                          </Box>
                        </Tooltip>
                      </Td>
                      <Td>
                        <HStack spacing={2}>
                          <Tooltip label="Download case study" hasArrow>
                            <IconButton
                              aria-label="Download case study"
                              icon={<DownloadIcon />}
                              size="sm"
                              colorScheme="blue"
                              variant="ghost"
                              onClick={() => handleDownloadCaseStudy(study._id)}
                            />
                          </Tooltip>
                          <Tooltip label="Delete case study" hasArrow>
                            <IconButton
                              aria-label="Delete case study"
                              icon={<DeleteIcon />}
                              size="sm"
                              colorScheme="red"
                              variant="ghost"
                              onClick={() => handleDeleteClick(study._id)}
                            />
                          </Tooltip>
                        </HStack>
                      </Td>
                    </Tr>

                    {/* Elicitation Session Rows */}
                    {isExpanded && study.sessions && study.sessions.map((session) => {
                      const sessionProgress = calculateSessionProgress(session)
                      const sessionLocked = session.session_locked || session.locked

                      return (
                        <Tr 
                          key={session._id} 
                          bg="gray.50" 
                          _hover={{ bg: 'gray.100' }}
                          borderLeft="4px"
                          borderColor="blue.300"
                        >
                          <Td></Td>
                          <Td pl={8} fontSize="sm">
                            <VStack align="start" spacing={0}>
                              <Text color="gray.700">↳ {session.friendly_name || 'Unnamed session'}</Text>
                              <Text color="gray.500" fontSize="xs">ID: {session._id}</Text>
                            </VStack>
                          </Td>
                          <Td fontSize="sm">{formatDate(session.created_at)}</Td>
                          <Td>
                            <Tooltip
                              label={`Current status: ${sessionLocked ? 'Locked' : 'Unlocked'}. Click to ${sessionLocked ? 'unlock' : 'lock'} this session.`}
                              hasArrow
                            >
                              <Button
                                size="xs"
                                leftIcon={sessionLocked ? <LockIcon /> : <UnlockIcon />}
                                colorScheme={sessionLocked ? 'red' : 'green'}
                                variant="solid"
                                aria-label={sessionLocked ? 'Unlock session' : 'Lock session'}
                                onClick={() => handleToggleSessionStatus(session._id)}
                                isLoading={Boolean(togglingSessionById[session._id])}
                                isDisabled={Boolean(togglingSessionById[session._id])}
                              >
                                {sessionLocked ? 'Click to unlock' : 'Click to lock'}
                              </Button>
                            </Tooltip>
                          </Td>
                          <Td>
                            <Tooltip 
                              label={
                                <VStack align="stretch" spacing={0}>
                                  {sessionProgress.steps.map((step, idx) => (
                                    <Text key={idx} fontSize="xs">
                                      {step.completed ? '✓' : '✗'} {step.label}
                                    </Text>
                                  ))}
                                </VStack>
                              } 
                              hasArrow 
                              placement="top"
                            >
                              <Box>
                                <HStack spacing={2}>
                                  <Progress
                                    value={sessionProgress.percentage}
                                    size="sm"
                                    colorScheme={sessionProgress.percentage === 100 ? 'green' : 'blue'}
                                    width="120px"
                                    borderRadius="md"
                                  />
                                  <Text fontSize="xs" fontWeight="medium" minW="45px">
                                    {sessionProgress.percentage}%
                                  </Text>
                                </HStack>
                              </Box>
                            </Tooltip>
                          </Td>
                          <Td>
                            <HStack spacing={2}>
                              <Tooltip label="Delete session" hasArrow>
                                <IconButton
                                  aria-label="Delete session"
                                  icon={<DeleteIcon />}
                                  size="sm"
                                  colorScheme="red"
                                  variant="ghost"
                                  onClick={() => handleDeleteSession(session._id)}
                                />
                              </Tooltip>
                            </HStack>
                          </Td>
                        </Tr>
                      )
                    })}
                  </Fragment>
                )
              })}
            </Tbody>
          </Table>
        </Box>
      )}

      <AlertDialog
        isOpen={isOpen}
        leastDestructiveRef={cancelRef}
        onClose={onClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete {deleteType === 'study' ? 'Case Study' : 'Elicitation Session'}
            </AlertDialogHeader>

            <AlertDialogBody>
              {deleteType === 'study' 
                ? 'Are you sure you want to delete this case study? This will delete all associated sessions and data. This action cannot be undone.'
                : 'Are you sure you want to delete this elicitation session? This action cannot be undone.'
              }
            </AlertDialogBody>

            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose}>
                Cancel
              </Button>
              <Button colorScheme="red" onClick={handleDeleteConfirm} ml={3}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  )
}

export default forwardRef(AdminPage)
