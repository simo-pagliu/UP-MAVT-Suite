import {
  Badge,
  Box,
  Button,
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

const buildProgress = (criteria, session) => {
  const list = Array.isArray(criteria) ? criteria : []
  const qualitativeIndicators = session?.qualitative_indicators || {}
  const valueFunctions = session?.value_functions
  const bwtData = session?.bwt

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

  const hasBwt = baseGroups.length > 0 && completedBaseGroups && completedIntraB && completedIntraW

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

function ManageCaseStudyPage({ studySessionId, studyCode }) {
  const [sessions, setSessions] = useState([])
  const [criteria, setCriteria] = useState([])
  const [loading, setLoading] = useState(false)
  const [newCode, setNewCode] = useState('')
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

  const sessionRows = useMemo(() => {
    return sessions.map((session) => ({
      ...session,
      progress: buildProgress(criteria, session),
    }))
  }, [sessions, criteria])

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
        description: 'Elicitation session is ready for experts',
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

  if (!studySessionId) {
    return (
      <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
        <Heading as="h1" size="lg">Manage Case Study</Heading>
        <Text mt={4} color="gray.600">Access or create a study session first.</Text>
      </Box>
    )
  }

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <HStack justify="space-between" align="center">
          <VStack align="start" spacing={1}>
            <Heading as="h1" size="lg">Manage Case Study</Heading>
            <Text fontSize="sm" color="gray.600">Study code: {studyCode || '—'}</Text>
          </VStack>
          <Button leftIcon={<RepeatIcon />} variant="outline" size="sm" onClick={loadSessions} isLoading={loading}>
            Refresh
          </Button>
        </HStack>

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

export default ManageCaseStudyPage
