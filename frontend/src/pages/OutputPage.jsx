import { Box, Button, Heading, VStack, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function OutputPage({ sessionId }) {
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleDownload = async () => {
    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/session/${sessionId}/export`, {
        responseType: 'blob'
      })
      
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', `results_${sessionId}.csv`)
      document.body.appendChild(link)
      link.click()
      link.parentChild.removeChild(link)
      
      toast({
        title: 'Success',
        description: 'File downloaded',
        status: 'success',
        duration: 2,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to download',
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
        <Button
          colorScheme="green"
          size="lg"
          isLoading={loading}
          onClick={handleDownload}
        >
          Download Results as CSV
        </Button>
      </VStack>
    </Box>
  )
}

export default OutputPage
