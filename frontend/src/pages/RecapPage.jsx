import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Divider, Heading, HStack, List, ListItem, Text, VStack } from '@chakra-ui/react'
import axios from 'axios'
import { useEffect, useMemo, useState } from 'react'
import { API_URL } from '../config'
import {
  isInputComplete,
  isQualitativeComplete,
  isValueFunctionsComplete,
  isPileBwtComplete,
} from '../utils/sessionUtils'

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

  const getStatusLabel = (isComplete) => (isComplete ? 'Complete' : 'Missing required criteria')

  const missing = []
  if (!completion.qualitative) missing.push({ key: 'qualitative', label: 'Qualitative Indicators', page: 'qualitative' })
  if (!completion.valueFunctions) missing.push({ key: 'value', label: 'Value Functions', page: 'value' })
  if (!completion.pileBwt) missing.push({ key: 'pile', label: 'PILE-BWT', page: 'pile' })

  const isAllComplete = missing.length === 0

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="lg">Overview</Heading>

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
                <ListItem>Input Definition: {getStatusLabel(completion.input)}</ListItem>
                <ListItem>Qualitative Indicators: {getStatusLabel(completion.qualitative)}</ListItem>
                <ListItem>Value Functions: {getStatusLabel(completion.valueFunctions)}</ListItem>
                <ListItem>PILE-BWT: {getStatusLabel(completion.pileBwt)}</ListItem>
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
