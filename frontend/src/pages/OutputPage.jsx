import { Box, Button, Heading, HStack, Text, VStack, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useEffect, useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function OutputPage({ sessionId }) {
  const [loading, setLoading] = useState(false)
  const [sessionName, setSessionName] = useState('')
  const toast = useToast()

  useEffect(() => {
    const fetchSessionName = async () => {
      if (!sessionId) return
      try {
        const response = await axios.get(`${API_URL}/session/${sessionId}`)
        const name = response?.data?.name
        if (name) setSessionName(name)
      } catch {
        // Silent fail: fallback to sessionId in filenames
      }
    }

    fetchSessionName()
  }, [sessionId])

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
        </VStack>

        <VStack spacing={4} align="stretch">
          <Text fontWeight="semibold">Value Functions</Text>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              colorScheme="green"
              size="md"
              isLoading={loading}
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
        </VStack>

        <VStack spacing={4} align="stretch">
          <Text fontWeight="semibold">PILE-BWT</Text>
          <HStack spacing={3} flexWrap="wrap">
            <Button
              colorScheme="green"
              size="md"
              isLoading={loading}
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
        </VStack>
      </VStack>
    </Box>
  )
}

export default OutputPage
