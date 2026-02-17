import { Box, Button, FormControl, FormLabel, Heading, HStack, Input, Text, VStack, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function StudyAccessPage({ onStudyAccessed, onClearStudy, studyCode }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

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

  return (
    <Box bg="white" p={6} borderRadius="lg" boxShadow="sm">
      <VStack spacing={6} align="stretch">
        <Heading as="h1" size="lg">Study Access</Heading>

        {studyCode ? (
          <HStack justify="space-between" align="center">
            <Text fontSize="sm" fontWeight="medium">Study Code: {studyCode}</Text>
            <Button size="sm" variant="outline" onClick={onClearStudy}>
              Change
            </Button>
          </HStack>
        ) : (
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
        )}

        <Text fontSize="sm" color="gray.600">
          Practitioners create or access a study session, then define the input.
        </Text>
      </VStack>
    </Box>
  )
}

export default StudyAccessPage
