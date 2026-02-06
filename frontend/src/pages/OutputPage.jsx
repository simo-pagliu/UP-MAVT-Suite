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

  const qualitativeIndicators = sessionData?.qualitative_indicators || {}
  const qualitativeCriteria = criteriaList.filter((crit) => crit?.is_qualitative)
  const hasQualitativeIndicators = qualitativeCriteria.length === 0 || qualitativeCriteria.every((crit) => {
    const name = crit?.criterion_name
    const data = name ? qualitativeIndicators[name] : null
    const ranking = data?.ranking
    const values = data?.values
    return ranking && values && Object.keys(ranking).length > 0 && Object.keys(values).length > 0
  })

  const valueFunctions = sessionData?.value_functions
  const vfCriteria = valueFunctions?.criteria || {}
  const nonQualitativeCriteria = criteriaList.filter((crit) => !crit?.is_qualitative)
  const hasValueFunctions = nonQualitativeCriteria.length === 0 || nonQualitativeCriteria.every((crit) => {
    const name = crit?.criterion_name
    const cfg = name ? vfCriteria[name] : null
    const points = Array.isArray(cfg?.points) ? cfg.points : []
    return points.length > 0
  })

  const hasAlternativesExport = hasAlternatives && hasQualitativeIndicators && hasValueFunctions

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
  const hasMainExports = hasAlternativesExport && hasBwt

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
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="lg">Output</Heading>

        <VStack spacing={4} align="stretch">
          <Text fontWeight="semibold">Main Downloads</Text>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              size="md"
              isLoading={loading}
              isDisabled={!hasAlternativesExport}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/export-input`,
                filename: `alternatives_${sessionName || sessionId}.csv`,
                successMessage: 'Alternatives CSV downloaded',
                errorMessage: 'Failed to download alternatives CSV',
              })}
            >
              Alternatives
            </Button>
            <Button
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
              Value Functions
            </Button>
            <Button
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
              PILE-BWT
            </Button>
            <Button
              size="md"
              isLoading={loading}
              isDisabled={!hasMainExports}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/export-all`,
                filename: `outputs_${sessionName || sessionId}.zip`,
                successMessage: 'Outputs ZIP downloaded',
                errorMessage: 'Failed to download outputs ZIP',
              })}
            >
              Download All (ZIP)
            </Button>
          </HStack>
          {!hasMainExports && (
            <Text fontSize="sm" color="gray.500">
              Complete input, qualitative indicators, value functions, and PILE-BWT to enable all downloads.
            </Text>
          )}
        </VStack>

        <VStack spacing={4} align="stretch">
          <Text fontWeight="semibold">Raw Data</Text>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              size="md"
              isLoading={loading}
              isDisabled={!hasAlternatives}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/export-input-raw`,
                filename: `input_raw_${sessionName || sessionId}.csv`,
                successMessage: 'Input table CSV downloaded',
                errorMessage: 'Failed to download input table CSV',
              })}
            >
              Input Table
            </Button>
            <Button
              size="md"
              isLoading={loading}
              isDisabled={!hasQualitativeIndicators}
              onClick={() => handleDownload({
                endpoint: `/session/${sessionId}/qualitative/export`,
                filename: `qualitative_indicators_${sessionName || sessionId}.csv`,
                successMessage: 'Qualitative indicators CSV downloaded',
                errorMessage: 'Failed to download qualitative indicators CSV',
              })}
            >
              Qualitative Indicators
            </Button>
          </HStack>
          {(!hasAlternatives || !hasQualitativeIndicators) && (
            <Text fontSize="sm" color="gray.500">
              Complete input data and qualitative indicators to enable raw downloads.
            </Text>
          )}
        </VStack>
      </VStack>
    </Box>
  )
}

export default OutputPage
