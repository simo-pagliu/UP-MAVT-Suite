import { Box, Button, Heading, VStack, Input, FormControl, FormLabel, Text, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useEffect, useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function QualitativeIndicatorsPage({ sessionId }) {
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)
  const [isSessionLocked, setIsSessionLocked] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (!sessionId) return
    const fetchSession = async () => {
      try {
        const response = await axios.get(`${API_URL}/session/${sessionId}`)
        setIsSessionLocked(response.data?.session_locked || false)
      } catch (error) {
        // Keep unlocked on error
        setIsSessionLocked(false)
      }
    }
    fetchSession()
  }, [sessionId])

  const handleSubmit = async () => {
    if (isSessionLocked) {
      toast({
        title: 'Session locked',
        description: 'This session is locked. You cannot modify qualitative indicators.',
        status: 'warning',
        duration: 3,
        isClosable: true,
      })
      return
    }

    if (value === '') {
      toast({
        title: 'Error',
        description: 'Please enter a number',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      await axios.put(`${API_URL}/session/${sessionId}/qualitative`, {
        value: parseFloat(value)
      })
      toast({
        title: 'Success',
        description: 'Data saved',
        status: 'success',
        duration: 2,
        isClosable: true,
      })
      setValue('')
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to save',
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
        <Heading as="h1" size="lg">Qualitative Indicators</Heading>
        {isSessionLocked && (
          <Text fontSize="sm" color="orange.600">
            Session is locked. Editing is disabled.
          </Text>
        )}
        <FormControl>
          <FormLabel>Enter a number</FormLabel>
          <Input
            type="number"
            placeholder="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            isDisabled={isSessionLocked}
          />
        </FormControl>
        <Button
          colorScheme="blue"
          isLoading={loading}
          onClick={handleSubmit}
          isDisabled={isSessionLocked}
        >
          Save & Continue
        </Button>
      </VStack>
    </Box>
  )
}

export default QualitativeIndicatorsPage
