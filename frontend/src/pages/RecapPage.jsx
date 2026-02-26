import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Divider, Heading, HStack, List, ListItem, Text, VStack } from '@chakra-ui/react'
import axios from 'axios'
import { useEffect, useMemo, useState } from 'react'

const API_URL = 'http://localhost:5000/api'

const isInputComplete = (criteria) => {
  if (!Array.isArray(criteria) || criteria.length === 0) return false
  return criteria.every((crit) => {
    if (!crit?.criterion_name || !crit?.unit) return false
    const alts = Array.isArray(crit?.alternatives) ? crit.alternatives : []
    if (alts.length === 0) return false
    return alts.every((alt) => alt?.name)
  })
}

const isQualitativeComplete = (criteria, qualitativeIndicators) => {
  if (!Array.isArray(criteria)) return false
  const qualitativeCriteria = criteria.filter((crit) => crit?.is_qualitative)
  if (qualitativeCriteria.length === 0) return true
  if (!qualitativeIndicators || typeof qualitativeIndicators !== 'object') return false
  return qualitativeCriteria.every((crit) => {
    const name = crit?.criterion_name
    const data = name ? qualitativeIndicators[name] : null
    const ranking = data?.ranking
    const values = data?.values
    return ranking && values && Object.keys(ranking).length > 0 && Object.keys(values).length > 0
  })
}

const isValueFunctionsComplete = (criteria, valueFunctions) => {
  if (!Array.isArray(criteria)) return false
  const criteriaMap = valueFunctions?.criteria || {}
  const nonQualitative = criteria.filter((crit) => !crit?.is_qualitative)
  if (nonQualitative.length === 0) return true
  return nonQualitative.every((crit) => {
    const name = crit?.criterion_name
    const cfg = name ? criteriaMap[name] : null
    const points = Array.isArray(cfg?.points) ? cfg.points : []
    return points.length > 0
  })
}

const isPileBwtComplete = (criteria, bwtData) => {
  if (!Array.isArray(criteria) || criteria.length === 0) return false
  const comparisons = Array.isArray(bwtData?.comparisons) ? bwtData.comparisons : []
  const groupMap = criteria.reduce((acc, crit) => {
    const groupName = crit?.group || 'Ungrouped'
    if (!acc[groupName]) acc[groupName] = []
    acc[groupName].push(crit)
    return acc
  }, {})

  const baseGroups = Object.entries(groupMap).map(([name, groupCriteria]) => ({
    name,
    criteria: groupCriteria,
  }))

  const completedBaseGroups = baseGroups.every(({ name, criteria: groupCriteria }) => {
    const expected = Math.max(1, 2 * groupCriteria.length - 3)
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

  return baseGroups.length > 0 && completedBaseGroups && completedIntraB && completedIntraW
}

function RecapPage({ sessionId, onNavigate }) {
  const [sessionData, setSessionData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchSession = async () => {
      if (!sessionId) return
      setLoading(true)
      try {
        const response = await axios.get(`${API_URL}/session/${sessionId}`)
        setSessionData(response.data)
      } catch {
        setSessionData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchSession()
  }, [sessionId])

  const criteria = Array.isArray(sessionData?.criteria) ? sessionData.criteria : []
  const qualitativeIndicators = sessionData?.qualitative_indicators
  const valueFunctions = sessionData?.value_functions
  const bwt = sessionData?.bwt

  const completion = useMemo(() => {
    return {
      input: isInputComplete(criteria),
      qualitative: isQualitativeComplete(criteria, qualitativeIndicators),
      valueFunctions: isValueFunctionsComplete(criteria, valueFunctions),
      pileBwt: isPileBwtComplete(criteria, bwt),
    }
  }, [criteria, qualitativeIndicators, valueFunctions, bwt])

  const missing = []
  if (!completion.input) missing.push({ key: 'input', label: 'Input Definition', page: 'session-access' })
  if (!completion.qualitative) missing.push({ key: 'qualitative', label: 'Qualitative Indicators', page: 'qualitative' })
  if (!completion.valueFunctions) missing.push({ key: 'value', label: 'Value Functions', page: 'value' })
  if (!completion.pileBwt) missing.push({ key: 'pile', label: 'PILE-BWT', page: 'pile' })

  const isAllComplete = missing.length === 0

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="lg">Recap</Heading>

        {loading && <Text color="gray.600">Checking completion...</Text>}

        {!loading && isAllComplete && (
          <Alert status="success" variant="subtle" borderRadius="md">
            <AlertIcon />
            <VStack align="start" spacing={1}>
              <AlertTitle>All steps complete</AlertTitle>
              <AlertDescription>
                Thank you. Your elicitation is complete and you can safely close this webpage.
              </AlertDescription>
            </VStack>
          </Alert>
        )}

        {!loading && !isAllComplete && (
          <Alert status="warning" variant="subtle" borderRadius="md">
            <AlertIcon />
            <VStack align="start" spacing={1}>
              <AlertTitle>Some steps are still missing</AlertTitle>
              <AlertDescription>
                Please complete the missing sections listed below.
              </AlertDescription>
            </VStack>
          </Alert>
        )}

        {!loading && (
          <>
            <Divider />
            <VStack align="stretch" spacing={3}>
              <Text fontWeight="semibold">Completion checklist</Text>
              <List spacing={2}>
                <ListItem>Input Definition: {completion.input ? 'Complete' : 'Missing'}</ListItem>
                <ListItem>Qualitative Indicators: {completion.qualitative ? 'Complete' : 'Missing'}</ListItem>
                <ListItem>Value Functions: {completion.valueFunctions ? 'Complete' : 'Missing'}</ListItem>
                <ListItem>PILE-BWT: {completion.pileBwt ? 'Complete' : 'Missing'}</ListItem>
              </List>
            </VStack>
          </>
        )}

        {!loading && !isAllComplete && onNavigate && (
          <HStack spacing={3} flexWrap="wrap">
            {missing.map((item) => (
              <Button key={item.key} variant="outline" onClick={() => onNavigate(item.page)}>
                Go to {item.label}
              </Button>
            ))}
          </HStack>
        )}
      </VStack>
    </Box>
  )
}

export default RecapPage
