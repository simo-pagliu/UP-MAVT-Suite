import {
  Badge,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormLabel,
  HStack,
  Heading,
  IconButton,
  Input,
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
  VStack,
  useToast,
} from '@chakra-ui/react'
import { DeleteIcon, LockIcon, UnlockIcon, HamburgerIcon, RepeatIcon } from '@chakra-ui/icons'
import axios from 'axios'
import { useEffect, useMemo, useState } from 'react'

const API_URL = 'http://localhost:5000/api'

const generateRandomCode = () => {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i += 1) {
    code += characters.charAt(Math.floor(Math.random() * characters.length))
  }
  return code
}

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

  const steps = [
    { key: 'qi', label: 'QI', done: hasQualitativeIndicators },
    { key: 'vf', label: 'VF', done: hasValueFunctions },
    { key: 'bwt', label: 'PILE-BWT', done: hasBwt },
  ]

  const completed = steps.filter((s) => s.done).length
  const total = steps.length
  const percent = total ? Math.round((completed / total) * 100) : 0

  return {
    hasAlternatives,
    hasQualitativeIndicators,
    hasValueFunctions,
    hasBwt,
    steps,
    percent,
  }
}

function CaseStudyPage({ studySessionId, studyCode, onStudyAccessed, onClearStudy }) {
  const [code, setCode] = useState('')
  const [sessions, setSessions] = useState([])
  const [criteria, setCriteria] = useState([])
  const [loading, setLoading] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [features, setFeatures] = useState({ qi: false, vf: false, bwt: false })
  const [savingFeatures, setSavingFeatures] = useState(false)
  const toast = useToast()

  const canCreateSession = Boolean(studySessionId)

  const loadSessions = async () => {
    if (!studySessionId) return
    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/study-session/${studySessionId}/elicitation-sessions`)
      const data = response.data
      setSessions(Array.isArray(data.sessions) ? data.sessions : [])
      setCriteria(Array.isArray(data.criteria) ? data.criteria : [])
      
      // Also fetch features
      const studyResponse = await axios.get(`${API_URL}/study-session/${studySessionId}`)
      const studyData = studyResponse.data
      if (studyData && studyData.features) {
        setFeatures(studyData.features)
      }
    } catch (error) {
      toast({
        title: 'Error',
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
        description: `${featureName === 'qi' ? 'QI' : featureName === 'vf' ? 'Value Functions' : 'PILE-BWT'} ${newFeatures[featureName] ? 'enabled' : 'disabled'}`,
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      // Revert on error
      setFeatures(features)
      toast({
        title: 'Error',
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
        title: 'Error',
        description: 'Please enter a study code',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/study-session/by-code/${encodeURIComponent(code)}`)
      const data = response.data

      if (!data.exists) {
        toast({
          title: 'Not found',
          description: 'No study session found for this code',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      onStudyAccessed(data._id, data.code || code)
      toast({
        title: 'Study session loaded',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
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
    const newCode = code.trim()
    if (!newCode) {
      toast({
        title: 'Error',
        description: 'Please enter a study code to create',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }
    setLoading(true)
    try {
      const response = await axios.post(`${API_URL}/study-session`, { code: newCode })
      onStudyAccessed(response.data.study_session_id, newCode)
      setCode('')
      toast({
        title: 'Study session created',
        description: `Study code: ${newCode}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
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
    if (!newCode.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a session code',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      await axios.post(`${API_URL}/study-session/${studySessionId}/elicitation-session`, { name: newCode.trim() })
      setNewCode('')
      toast({
        title: 'Session created',
        description: 'Elicitation session is ready for stakeholders',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
      loadSessions()
    } catch (error) {
      toast({
        title: 'Error',
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
        title: 'Error',
        description: error.response?.data?.error || 'Failed to toggle lock',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSession = async (sessionId) => {
    if (!window.confirm('Delete this elicitation session? This cannot be undone.')) return

    setLoading(true)
    try {
      await axios.delete(`${API_URL}/session/${sessionId}`)
      toast({
        title: 'Session deleted',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
      loadSessions()
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to delete session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

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
        title: 'Error',
        description: error.response?.data?.error || 'Failed to download file',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  // If no study session accessed, show access form
  if (!studySessionId) {
    return (
      <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
        <VStack spacing={6} align="stretch">
          <Heading as="h1" size="lg">Case Study</Heading>

          <FormControl>
            <FormLabel>Study session code</FormLabel>
            <HStack>
              <Input
                placeholder="Enter study code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAccess()}
              />
              <Button colorScheme="blue" onClick={handleAccess} isLoading={loading} minW="120px">
                Access
              </Button>
            </HStack>
            <HStack mt={3} spacing={3}>
              <Button colorScheme="blue" variant="solid" onClick={handleCreate} isLoading={loading}>
                Create Study
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
              <Text fontSize="sm" color="gray.600">Study code: {studyCode || '—'}</Text>
              <Button size="xs" variant="outline" onClick={onClearStudy}>
                Change Study
              </Button>
            </HStack>
          </VStack>
          <Button leftIcon={<RepeatIcon />} variant="outline" size="sm" onClick={loadSessions} isLoading={loading}>
            Refresh
          </Button>
        </HStack>

        <Box borderWidth={1} borderRadius="md" p={4} bg="blue.50">
          <VStack spacing={4} align="stretch">
            <Text fontWeight="semibold">Features</Text>
            <Text fontSize="sm" color="gray.600">
              Select which analysis components are required for the elicitation sessions
            </Text>
            <HStack spacing={6}>
              <Checkbox
                isChecked={features.qi}
                onChange={() => handleFeatureToggle('qi')}
                isDisabled={savingFeatures}
              >
                <VStack align="start" spacing={0}>
                  <Text fontWeight="medium">Qualitative Indicators</Text>
                  <Text fontSize="xs" color="gray.600">Requires complete input with alternatives</Text>
                </VStack>
              </Checkbox>
              <Checkbox
                isChecked={features.vf}
                onChange={() => handleFeatureToggle('vf')}
                isDisabled={savingFeatures}
              >
                <VStack align="start" spacing={0}>
                  <Text fontWeight="medium">Value Functions</Text>
                  <Text fontSize="xs" color="gray.600">Criteria with optional min/max</Text>
                </VStack>
              </Checkbox>
              <Checkbox
                isChecked={features.bwt}
                onChange={() => handleFeatureToggle('bwt')}
                isDisabled={savingFeatures}
              >
                <VStack align="start" spacing={0}>
                  <Text fontWeight="medium">PILE-BWT</Text>
                  <Text fontSize="xs" color="gray.600">Criteria with optional min/max</Text>
                </VStack>
              </Checkbox>
            </HStack>
          </VStack>
        </Box>

        <Box borderWidth={1} borderRadius="md" p={4} bg="gray.50">
          <VStack spacing={3} align="stretch">
            <Text fontWeight="semibold">Create elicitation session</Text>
            <HStack>
              <Input
                placeholder="Session code"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
              />
              <Button
                variant="outline"
                onClick={() => setNewCode(generateRandomCode())}
                minW="120px"
              >
                Generate
              </Button>
              <Button
                colorScheme="blue"
                onClick={handleCreateSession}
                isDisabled={!canCreateSession}
                isLoading={loading}
                minW="140px"
              >
                Create
              </Button>
            </HStack>
          </VStack>
        </Box>

        <Box overflowX="auto">
          <Table variant="simple" size="sm">
            <Thead>
              <Tr>
                <Th>Session Code</Th>
                <Th>Progress</Th>
                <Th>Status</Th>
                <Th>Downloads</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {sessionRows.map((session) => (
                <Tr key={session._id}>
                  <Td>{session.name}</Td>
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
                          onClick={() => handleDownload(`/session/${session._id}/qualitative/export`, `qualitative_${session.name}.csv`)}
                          isDisabled={!session.progress.hasQualitativeIndicators}
                        >
                          Qualitative Indicators
                        </MenuItem>
                        <MenuItem
                          onClick={() => handleDownload(`/session/${session._id}/value-functions/export`, `value_functions_${session.name}.csv`)}
                          isDisabled={!session.progress.hasValueFunctions}
                        >
                          Value Functions
                        </MenuItem>
                        <MenuItem
                          onClick={() => handleDownload(`/session/${session._id}/pile/export`, `pile_bwt_${session.name}.csv`)}
                          isDisabled={!session.progress.hasBwt}
                        >
                          PILE-BWT
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
    </Box>
  )
}

export default CaseStudyPage
