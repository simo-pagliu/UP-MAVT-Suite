import { Box, Button, Heading, HStack, Text, VStack, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useEffect, useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function OutputPage({ sessionId }) {
  const [loading, setLoading] = useState(false)
  const [sessionName, setSessionName] = useState('')
  const [sessionData, setSessionData] = useState(null)
  const toast = useToast()

  useEffect(() => {
    const fetchSessionData = async () => {
      if (!sessionId) return
      try {
        const response = await axios.get(`${API_URL}/session/${sessionId}`)
        const data = response?.data
        const name = data?.name
        if (name) setSessionName(name)
        if (data) setSessionData(data)
      } catch {
        // Silent fail: fallback to sessionId in filenames
      }
    }

    fetchSessionData()
  }, [sessionId])

  const criteriaList = Array.isArray(sessionData?.criteria) ? sessionData.criteria : []
  const hasAlternatives = criteriaList.length > 0 && criteriaList.every((crit) => {
    const alts = Array.isArray(crit?.alternatives) ? crit.alternatives : []
    return alts.length > 0 && alts.every((alt) => alt?.name && alt?.value !== undefined && alt?.value !== null)
  })

  const valueFunctions = sessionData?.value_functions
  const vfCriteria = valueFunctions?.criteria || {}
  const hasValueFunctions = criteriaList.length > 0 && criteriaList.every((crit) => {
    const name = crit?.criterion_name
    const cfg = name ? vfCriteria[name] : null
    const points = Array.isArray(cfg?.points) ? cfg.points : []
    return points.length > 0
  })

  const bwtData = sessionData?.bwt
  const comparisons = Array.isArray(bwtData?.comparisons) ? bwtData.comparisons : []
  const groupMap = criteriaList.reduce((acc, crit) => {
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
  const intraBCount = baseGroups.length
  const intraWCount = baseGroups.length

  const intraBExpected = hasMultipleGroups ? Math.max(1, 2 * intraBCount - 3) : 0
  const intraWExpected = hasMultipleGroups ? Math.max(1, 2 * intraWCount - 3) : 0

  const intraBComps = comparisons.filter((c) => c?.group === 'intra-B')
  const intraWComps = comparisons.filter((c) => c?.group === 'intra-W')

  const completedIntraB = !hasMultipleGroups || intraBComps.length >= intraBExpected
  const completedIntraW = !hasMultipleGroups || intraWComps.length >= intraWExpected

  const hasBwt = baseGroups.length > 0 && completedBaseGroups && completedIntraB && completedIntraW

  const handleDownload = async ({ endpoint, filename, successMessage, errorMessage }) => {
    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}${endpoint}`, {
        responseType: 'blob'
      })
      
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      link.parentNode.removeChild(link)
      
      toast({
        title: 'Success',
        description: successMessage,
        status: 'success',
        duration: 2,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || errorMessage,
        status: 'error',
        duration: 3,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box bg="white" p={8} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="lg">Output</Heading>

        <VStack spacing={4} align="stretch">
          <Text fontWeight="semibold">Alternatives</Text>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              colorScheme="green"
              size="md"
              isLoading={loading}
              isDisabled={!hasAlternatives}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/export-input`,
                filename: `alternatives_${sessionName || sessionId}.csv`,
                successMessage: 'Alternatives CSV downloaded',
                errorMessage: 'Failed to download alternatives CSV',
              })}
            >
              Download CSV
            </Button>
            <Button
              colorScheme="blue"
              size="md"
              isLoading={loading}
              isDisabled={!hasAlternatives}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/export-input-json`,
                filename: `alternatives_${sessionName || sessionId}.json`,
                successMessage: 'Alternatives JSON downloaded',
                errorMessage: 'Failed to download alternatives JSON',
              })}
            >
              Download JSON
            </Button>
          </HStack>
          {!hasAlternatives && (
            <Text fontSize="sm" color="gray.500">
              Complete the input step to enable downloads.
            </Text>
          )}
        </VStack>

        <VStack spacing={4} align="stretch">
          <Text fontWeight="semibold">Value Functions</Text>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              colorScheme="green"
              size="md"
              isLoading={loading}
              isDisabled={!hasValueFunctions}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/value-functions/export`,
                filename: `value_functions_${sessionName || sessionId}.csv`,
                successMessage: 'Value functions CSV downloaded',
                errorMessage: 'Failed to download value functions CSV',
              })}
            >
              Download CSV
            </Button>
            <Button
              colorScheme="blue"
              size="md"
              isLoading={loading}
              isDisabled={!hasValueFunctions}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/value-functions/export-json`,
                filename: `value_functions_${sessionName || sessionId}.json`,
                successMessage: 'Value functions JSON downloaded',
                errorMessage: 'Failed to download value functions JSON',
              })}
            >
              Download JSON
            </Button>
          </HStack>
          {!hasValueFunctions && (
            <Text fontSize="sm" color="gray.500">
              Complete the value functions step to enable downloads.
            </Text>
          )}
        </VStack>

        <VStack spacing={4} align="stretch">
          <Text fontWeight="semibold">PILE-BWT</Text>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              colorScheme="green"
              size="md"
              isLoading={loading}
              isDisabled={!hasBwt}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/pile/export`,
                filename: `pile_bwt_${sessionName || sessionId}.csv`,
                successMessage: 'PILE-BWT CSV downloaded',
                errorMessage: 'Failed to download PILE-BWT CSV',
              })}
            >
              Download CSV
            </Button>
            <Button
              colorScheme="blue"
              size="md"
              isLoading={loading}
              isDisabled={!hasBwt}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/pile/export-json`,
                filename: `pile_bwt_${sessionName || sessionId}.json`,
                successMessage: 'PILE-BWT JSON downloaded',
                errorMessage: 'Failed to download PILE-BWT JSON',
              })}
            >
              Download JSON
            </Button>
          </HStack>
          {!hasBwt && (
            <Text fontSize="sm" color="gray.500">
              Complete the PILE-BWT step to enable downloads.
            </Text>
          )}
        </VStack>
      </VStack>
    </Box>
  )
}

export default OutputPage
