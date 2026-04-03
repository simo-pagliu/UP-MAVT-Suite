import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Badge,
  Box,
  Button,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  IconButton,
  Input,
  Select,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Progress,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Text,
  Tooltip,
  VStack,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import { DeleteIcon, LockIcon, UnlockIcon, HamburgerIcon, RepeatIcon, CopyIcon } from '@chakra-ui/icons'
import axios from 'axios'
import { useEffect, useMemo, useRef, useState } from 'react'
import { API_URL } from '../config'

const getCriteriaSignature = (criteriaList) => {
  const normalized = (criteriaList || []).map((crit) => ({
    name: crit?.criterion_name || '',
    unit: crit?.unit || '',
    group: crit?.group || '',
    alternatives: (crit?.alternatives || []).map((alt) => ({
      name: alt?.name || alt?.alternative_name || '',
      value: alt?.value,
    })),
  }))
  return JSON.stringify(normalized)
}

const canonicalizeJson = (value) => {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson)
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalizeJson(value[key])
        return acc
      }, {})
  }
  return value
}

const areSignaturesEquivalent = (savedSignature, currentSignature) => {
  if (!savedSignature || !currentSignature) return false
  try {
    const savedParsed = canonicalizeJson(JSON.parse(savedSignature))
    const currentParsed = canonicalizeJson(JSON.parse(currentSignature))
    return JSON.stringify(savedParsed) === JSON.stringify(currentParsed)
  } catch {
    return savedSignature === currentSignature
  }
}

const buildProgress = (criteria, session) => {
  const list = Array.isArray(criteria) ? criteria : []
  const qualitativeIndicators = session?.qualitative_indicators || {}
  const valueFunctions = session?.value_functions
  const bwtData = session?.bwt
  const currentCriteriaSignature = getCriteriaSignature(list)
  const savedBwtSignature = bwtData?.criteria_signature || null

  const hasAlternatives = list.length > 0 && list.every((crit) => {
    const alts = Array.isArray(crit?.alternatives) ? crit.alternatives : []
    return alts.length > 0 && alts.every((alt) => alt?.name && alt?.value !== undefined && alt?.value !== null)
  })

  const qualitativeCriteria = list.filter((crit) => crit?.is_qualitative)
  const hasQualitativeIndicators = qualitativeCriteria.length === 0 || qualitativeCriteria.every((crit) => {
    const name = crit?.criterion_name
    const data = name ? qualitativeIndicators[name] : null
    const ranking = data?.ranking
    const values = data?.values
    return ranking && values && Object.keys(ranking).length > 0 && Object.keys(values).length > 0
  })

  const vfCriteria = valueFunctions?.criteria || {}
  const nonQualitativeCriteria = list.filter((crit) => !crit?.is_qualitative)
  const hasValueFunctions = nonQualitativeCriteria.length === 0 || nonQualitativeCriteria.every((crit) => {
    const name = crit?.criterion_name
    const cfg = name ? vfCriteria[name] : null
    const points = Array.isArray(cfg?.points) ? cfg.points : []
    return points.length > 0
  })

  const comparisons = Array.isArray(bwtData?.comparisons) ? bwtData.comparisons : []
  const groupMap = list.reduce((acc, crit) => {
    const groupName = crit?.group || 'Ungrouped'
    if (!acc[groupName]) acc[groupName] = []
    acc[groupName].push(crit)
    return acc
  }, {})

  const baseGroups = Object.entries(groupMap).map(([name, criteria]) => ({
    name,
    criteria,
  }))

  const completedBaseGroups = baseGroups.every(({ name, criteria }) => {
    const expected = Math.max(1, 2 * criteria.length - 3)
    const groupComps = comparisons.filter((c) => c?.group === name)
    return groupComps.length >= expected
  })

  const hasMultipleGroups = baseGroups.length > 1
  const intraBExpected = hasMultipleGroups ? Math.max(1, 2 * baseGroups.length - 3) : 0
  const intraWExpected = hasMultipleGroups ? Math.max(1, 2 * baseGroups.length - 3) : 0
  const intraBComps = comparisons.filter((c) => c?.group === 'intra-B')
  const intraWComps = comparisons.filter((c) => c?.group === 'intra-W')
  const completedIntraB = !hasMultipleGroups || intraBComps.length >= intraBExpected
  const completedIntraW = !hasMultipleGroups || intraWComps.length >= intraWExpected

  const hasComparisons = comparisons.length > 0
  const bwtSignatureValid = hasComparisons && areSignaturesEquivalent(savedBwtSignature, currentCriteriaSignature)

  const hasBwt = baseGroups.length > 0 && completedBaseGroups && completedIntraB && completedIntraW && bwtSignatureValid

  const computedWeights = session?.computed_weights || {}
  const weightSpaces = computedWeights.weight_spaces || {}
  const weightSolutions = computedWeights.weight_solutions || {}
  const hasWeights = Boolean(
    (weightSolutions[session._id] && Array.isArray(weightSolutions[session._id]) && weightSolutions[session._id].length > 0) ||
    (weightSpaces[session._id] && typeof weightSpaces[session._id] === 'object' && Object.keys(weightSpaces[session._id]).length > 0)
  )

  const steps = [
    { key: 'qi', label: 'Qualitative Indicators', done: hasQualitativeIndicators },
    { key: 'vf', label: 'Quantitative Indicators', done: hasValueFunctions },
    { key: 'bwt', label: 'Weight Elicitation', done: hasBwt },
  ]

  const completed = steps.filter((s) => s.done).length
  const total = steps.length
  const percent = total ? Math.round((completed / total) * 100) : 0

  return {
    hasAlternatives,
    hasQualitativeIndicators,
    hasValueFunctions,
    hasBwt,
    hasWeights,
    steps,
    percent,
  }
}

function CaseStudyPage({ studySessionId, onStudyAccessed, onClearStudy }) {
  const [code, setCode] = useState('')
  const [sessions, setSessions] = useState([])
  const [friendlyNames, setFriendlyNames] = useState({})
  const [criteria, setCriteria] = useState([])
  const [loading, setLoading] = useState(false)
  const [savingFriendlyNameById, setSavingFriendlyNameById] = useState({})
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure()
  const deleteCancelRef = useRef()
  const friendlyNameAutoSaveTimersRef = useRef({})
  const toast = useToast()

  const canCreateSession = Boolean(studySessionId)

  const loadSessions = async () => {
    if (!studySessionId) return
    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/elicitation-sessions`)
      const data = response.data
      const loadedSessions = Array.isArray(data.sessions) ? data.sessions : []
      setSessions(loadedSessions)
      setFriendlyNames(
        loadedSessions.reduce((acc, session) => {
          acc[session._id] = session.friendly_name || ''
          return acc
        }, {})
      )
      setCriteria(Array.isArray(data.criteria) ? data.criteria : [])
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
    loadSessions()
  }, [studySessionId])

  const handleFeatureToggle = async (featureName) => {
    const newFeatures = { ...features, [featureName]: !features[featureName] }
    setFeatures(newFeatures)
    
    // Save to backend
    setSavingFeatures(true)
    try {
      await axios.patch(`${API_URL}/study-session/${studySessionId}`, {
        features: newFeatures
      })
      toast({
        title: 'Features updated',
        description: `${featureName === 'qi' ? 'Qualitative Indicators' : featureName === 'vf' ? 'Quantitative Indicators' : 'Weight Elicitation'} ${newFeatures[featureName] ? 'enabled' : 'disabled'}`,
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      // Revert on error
      setFeatures(features)
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to update features',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setSavingFeatures(false)
    }
  }

  const sessionRows = useMemo(() => {
    return sessions.map((session) => ({
      ...session,
      progress: buildProgress(criteria, session),
    }))
  }, [sessions, criteria])

  const handleAccess = async () => {
    if (!code.trim()) {
      toast({
        title: 'Request failed',
        description: 'Please enter a study UUID',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/session/detect/${encodeURIComponent(code)}`)
      const data = response.data

      if (!data.exists || data.type !== 'practitioner') {
        toast({
          title: 'Not found',
          description: 'No study session found for this UUID',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      onStudyAccessed(data._id, null)
      toast({
        title: 'Study session loaded',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to access study session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    setLoading(true)
    try {
      const response = await axios.post(`${API_URL}/study-session`, { auto_generate: true })
      const createdStudyId = response.data?.study_session_id || ''
      onStudyAccessed(createdStudyId, null)
      toast({
        title: 'Study session created',
        description: `Study ID: ${createdStudyId}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to create study session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCreateSession = async () => {
    setLoading(true)
    try {
      const response = await axios.post(`${API_URL}/study-session/${studySessionId}/elicitation-session`, { auto_generate: true })
      toast({
        title: 'Session created',
        description: `Session ID: ${response.data?.session_id || 'generated'}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      loadSessions()
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to create session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleToggleLock = async (sessionId, isLocked) => {
    setLoading(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/lock-session`)
      toast({
        title: isLocked ? 'Session unlocked' : 'Session locked',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
      loadSessions()
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to toggle lock',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSession = (sessionId) => {
    setPendingDeleteId(sessionId)
    onDeleteOpen()
  }

  const handleDeleteSessionConfirm = async () => {
    setLoading(true)
    onDeleteClose()
    try {
      await axios.delete(`${API_URL}/session/${pendingDeleteId}`)
      toast({
        title: 'Session deleted',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
      loadSessions()
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to delete session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
      setPendingDeleteId(null)
    }
  }

  const handleSaveFriendlyName = async (sessionId, valueOverride = null) => {
    setSavingFriendlyNameById((prev) => ({ ...prev, [sessionId]: true }))
    try {
      const friendlyName = (valueOverride ?? friendlyNames[sessionId] ?? '').trim()
      const currentFriendlyName = String(
        sessions.find((session) => session._id === sessionId)?.friendly_name || ''
      ).trim()

      if (friendlyName === currentFriendlyName) {
        return
      }

      await axios.put(`${API_URL}/session/${sessionId}/friendly-name`, {
        friendly_name: friendlyName,
      })

      setSessions((prev) => prev.map((session) => (
        session._id === sessionId
          ? { ...session, friendly_name: friendlyName }
          : session
      )))

      setFriendlyNames((prev) => ({ ...prev, [sessionId]: friendlyName }))
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to save friendly name',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setSavingFriendlyNameById((prev) => ({ ...prev, [sessionId]: false }))
    }
  }

  const scheduleFriendlyNameAutoSave = (sessionId, value) => {
    if (friendlyNameAutoSaveTimersRef.current[sessionId]) {
      clearTimeout(friendlyNameAutoSaveTimersRef.current[sessionId])
    }

    friendlyNameAutoSaveTimersRef.current[sessionId] = setTimeout(() => {
      handleSaveFriendlyName(sessionId, value)
    }, 600)
  }

  const flushFriendlyNameAutoSave = (sessionId, value) => {
    if (friendlyNameAutoSaveTimersRef.current[sessionId]) {
      clearTimeout(friendlyNameAutoSaveTimersRef.current[sessionId])
      delete friendlyNameAutoSaveTimersRef.current[sessionId]
    }
    handleSaveFriendlyName(sessionId, value)
  }

  const handleFriendlyNameChange = (sessionId, value) => {
    setFriendlyNames((prev) => ({ ...prev, [sessionId]: value }))
    scheduleFriendlyNameAutoSave(sessionId, value)
  }

  useEffect(() => {
    return () => {
      Object.values(friendlyNameAutoSaveTimersRef.current).forEach((timerId) => clearTimeout(timerId))
      friendlyNameAutoSaveTimersRef.current = {}
    }
  }, [])

  const handleDownload = async (endpoint, filename) => {
    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}${endpoint}`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      link.parentNode.removeChild(link)
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to download file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const buildUuidLink = (uuid) => {
    const url = new URL(window.location.href)
    url.searchParams.set('uuid', uuid)
    return url.toString()
  }

  const copyUuidLink = async (uuid, entityLabel) => {
    if (!uuid) {
      toast({
        title: 'Request failed',
        description: `No ${entityLabel} ID available to copy`,
        status: 'error',
        duration: 2000,
        isClosable: true,
      })
      return
    }

    try {
      await navigator.clipboard.writeText(buildUuidLink(uuid))
      toast({
        title: 'Completed',
        description: `${entityLabel} link copied`,
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch {
      toast({
        title: 'Request failed',
        description: `Failed to copy ${entityLabel} link`,
        status: 'error',
        duration: 2000,
        isClosable: true,
      })
    }
  }

  const handleCopyStudyLink = async () => {
    await copyUuidLink(studySessionId, 'Study')
  }

  const handleCopySessionLink = async (sessionId) => {
    await copyUuidLink(sessionId, 'Session')
  }

  // If no study session accessed, show access form
  if (!studySessionId) {
    return (
      <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
        <VStack spacing={6} align="stretch">
          <Heading as="h1" size="lg">Case Study</Heading>

          <FormControl>
            <FormLabel>Study session UUID</FormLabel>
            <HStack>
              <Input
                placeholder="Enter study UUID"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAccess()}
              />
              <Button colorScheme="blue" onClick={handleAccess} isLoading={loading} minW="120px">
                Access
              </Button>
            </HStack>
            <HStack mt={3} spacing={3}>
              <Button colorScheme="blue" variant="solid" onClick={handleCreate} isLoading={loading}>
                Create New
              </Button>
            </HStack>
          </FormControl>

          <Text fontSize="sm" color="gray.600">
            Practitioners create or access a study session, then define the input and manage elicitation sessions.
          </Text>
        </VStack>
      </Box>
    )
  }

  // If study session accessed, show manage view
  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <HStack justify="space-between" align="center">
          <VStack align="start" spacing={1}>
            <Heading as="h1" size="lg">Case Study</Heading>
            <HStack spacing={3}>
              <HStack spacing={1}>
                <Text fontSize="sm" color="gray.600">Study ID: {studySessionId || '—'}</Text>
                <Tooltip label={studySessionId ? 'Copy study ID' : 'No study ID'} hasArrow>
                  <IconButton
                    aria-label="Copy study link"
                    icon={<CopyIcon />}
                    size="xs"
                    variant="ghost"
                    onClick={handleCopyStudyLink}
                    isDisabled={!studySessionId}
                  />
                </Tooltip>
              </HStack>
              <Button size="xs" variant="outline" onClick={onClearStudy}>
                Change Study
              </Button>
            </HStack>
          </VStack>
          <HStack>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDownload(`/study-session/${studySessionId}/backup/export`, `case_study_${studySessionId}.zip`)}
              isLoading={loading}
            >
              Download case study ZIP
            </Button>
            <Button leftIcon={<RepeatIcon />} variant="outline" size="sm" onClick={loadSessions} isLoading={loading}>
              Refresh
            </Button>
          </HStack>
        </HStack>

        <Box borderWidth={1} borderRadius="md" p={4} bg="gray.50">
          <VStack spacing={3} align="stretch">
            <Text fontWeight="semibold">Create elicitation session</Text>
            <Text fontSize="sm" color="gray.600">Session ID is generated automatically.</Text>
            <Button
              colorScheme="blue"
              onClick={handleCreateSession}
              isDisabled={!canCreateSession}
              isLoading={loading}
              w="fit-content"
            >
              Create New
            </Button>
          </VStack>
        </Box>

        <Box overflowX="auto">
          <Table variant="simple" size="sm">
            <Thead>
              <Tr>
                <Th>Session ID</Th>
                <Th>Friendly Name</Th>
                <Th>Progress</Th>
                <Th>Status</Th>
                <Th>Downloads</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sessionRows.map((session) => (
                <Tr key={session._id}>
                  <Td>
                    <HStack spacing={1}>
                      <Text>{session._id || 'N/A'}</Text>
                      <Tooltip label={session._id ? 'Copy session link' : 'No session ID'} hasArrow>
                        <IconButton
                          aria-label="Copy session link"
                          icon={<CopyIcon />}
                          size="xs"
                          variant="ghost"
                          onClick={() => handleCopySessionLink(session._id)}
                          isDisabled={!session._id}
                        />
                      </Tooltip>
                    </HStack>
                  </Td>
                  <Td>
                    <HStack spacing={2}>
                      <Input
                        size="sm"
                        value={friendlyNames[session._id] || ''}
                        onChange={(e) => handleFriendlyNameChange(session._id, e.target.value)}
                        onBlur={(e) => flushFriendlyNameAutoSave(session._id, e.target.value)}
                        placeholder="Add friendly name"
                      />
                    </HStack>
                  </Td>
                  <Td minW="200px">
                    <VStack align="stretch" spacing={2}>
                      <Progress value={session.progress.percent} size="sm" borderRadius="full" />
                      <HStack spacing={2}>
                        {session.progress.steps.map((step) => (
                          <Badge key={step.key} colorScheme={step.done ? 'green' : 'gray'}>
                            {step.label}
                          </Badge>
                        ))}
                      </HStack>
                    </VStack>
                  </Td>
                  <Td>
                    <Badge colorScheme={session.session_locked ? 'red' : 'green'}>
                      {session.session_locked ? 'Locked' : 'Active'}
                    </Badge>
                  </Td>
                  <Td>
                    <Menu>
                      <MenuButton as={IconButton} icon={<HamburgerIcon />} variant="ghost" size="sm" aria-label="Download options" />
                      <MenuList>
                        <MenuItem
                          onClick={() => handleDownload(`/session/${session._id}/qualitative/export`, `qualitative_${session._id}.csv`)}
                          isDisabled={!session.progress.hasQualitativeIndicators}
                        >
                          Qualitative Indicators
                        </MenuItem>
                        <MenuItem
                          onClick={() => handleDownload(`/session/${session._id}/value-functions/export`, `value_functions_${session._id}.csv`)}
                          isDisabled={!session.progress.hasValueFunctions}
                        >
                          Quantitative Indicators
                        </MenuItem>
                        <MenuItem
                          onClick={() => handleDownload(`/session/${session._id}/export-input-data`, `input_data_${session._id}.csv`)}
                          isDisabled={!session.progress.hasQualitativeIndicators}
                        >
                          Input Data
                        </MenuItem>
                        <MenuItem
                          onClick={() => handleDownload(`/session/${session._id}/pile/export`, `pile_bwt_${session._id}.csv`)}
                          isDisabled={!session.progress.hasBwt}
                        >
                          Weight Elicitation
                        </MenuItem>
                        <MenuItem
                          onClick={() => handleDownload(`/session/${session._id}/pile/export-debug`, `pile_bwt_debug_a_values_${session._id}.csv`)}
                          isDisabled={!session.progress.hasBwt || !session.progress.hasValueFunctions}
                        >
                          DEBUG - a values
                        </MenuItem>
                        <MenuItem
                          onClick={() => handleDownload(`/study-session/${studySessionId}/weight-solutions/${session._id}/export`, `weight_solutions_${session._id}.csv`)}
                          isDisabled={!session.progress.hasWeights}
                        >
                          Weight Solutions
                        </MenuItem>
                      </MenuList>
                    </Menu>
                  </Td>
                  <Td>
                    <HStack spacing={2}>
                      <IconButton
                        aria-label={session.session_locked ? 'Unlock session' : 'Lock session'}
                        icon={session.session_locked ? <UnlockIcon /> : <LockIcon />}
                        size="sm"
                        variant="ghost"
                        onClick={() => handleToggleLock(session._id, session.session_locked)}
                      />
                      <IconButton
                        aria-label="Delete session"
                        icon={<DeleteIcon />}
                        size="sm"
                        variant="ghost"
                        colorScheme="red"
                        onClick={() => handleDeleteSession(session._id)}
                      />
                    </HStack>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      </VStack>

      <AlertDialog
        isOpen={isDeleteOpen}
        leastDestructiveRef={deleteCancelRef}
        onClose={onDeleteClose}
      >
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              Delete Session
            </AlertDialogHeader>
            <AlertDialogBody>
              Are you sure you want to delete this elicitation session? This action cannot be undone.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={deleteCancelRef} onClick={onDeleteClose}>
                Cancel
              </Button>
              <Button colorScheme="red" onClick={handleDeleteSessionConfirm} ml={3}>
                Delete
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  )
}

export default CaseStudyPage
