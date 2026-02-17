import { Box, Button, FormControl, FormLabel, Heading, HStack, Input, Text, VStack, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function SessionAccessPage({ onSessionAccessed, onClearSession, sessionCode }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleAccess = async () => {
    if (!code.trim()) {
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
      const response = await axios.get(`${API_URL}/session/by-name/${encodeURIComponent(code)}`)
      const data = response.data

      if (!data.exists) {
        toast({
          title: 'Not found',
          description: 'No elicitation session found for this code',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }

      onSessionAccessed(data._id, data.name || code)
      toast({
        title: 'Session loaded',
        description: 'Elicitation session ready',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description: error.response?.data?.error || 'Failed to access session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="lg">Session Access</Heading>

        {sessionCode ? (
          <HStack justify="space-between" align="center">
            <Text fontSize="sm" fontWeight="medium">Session Code: {sessionCode}</Text>
            <Button size="sm" variant="outline" onClick={onClearSession}>
              Change
            </Button>
          </HStack>
        ) : (
          <FormControl>
            <FormLabel>Elicitation session code</FormLabel>
            <HStack>
              <Input
                placeholder="Enter session code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAccess()}
              />
              <Button colorScheme="blue" onClick={handleAccess} isLoading={loading} minW="120px">
                Access
              </Button>
            </HStack>
          </FormControl>
        )}

        <Text fontSize="sm" color="gray.600">
          Experts can only access existing elicitation sessions.
        </Text>
      </VStack>
    </Box>
  )
}

export default SessionAccessPage
