import { Box, Button, Divider, FormLabel, Heading, HStack, Input, Link, Text, VStack, useToast } from '@chakra-ui/react'
import axios from 'axios'
import { useState } from 'react'
import { API_URL } from '../config'

function LoginPage({ onLogin, onDocumentation }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const handleDetectAndLogin = async () => {
    if (!code.trim()) {
      toast({
        title: 'Request failed',
        description: 'Please enter a session code',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    // Check for admin access
    if (code.trim().toLowerCase() === 'admin') {
      onLogin(null, 'admin', 'admin')
      toast({
        title: 'Admin access',
        description: 'Welcome to admin panel',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
      return
    }

    setLoading(true)
    try {
      const response = await axios.get(`${API_URL}/session/detect/${encodeURIComponent(code)}`)
      const data = response.data

      if (!data.exists) {
        toast({
          title: 'Not found',
          description: 'No session found for this code',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        setLoading(false)
        return
      }

      // Login with detected type
      onLogin(data._id, data.code, data.type)
      toast({
        title: 'Session loaded',
        description: `${data.type === 'stakeholder' ? 'Stakeholder' : 'Practitioner'} session ready`,
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to access session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      setLoading(false)
    }
  }

  const handleCreatePractitionerSession = async () => {
    setLoading(true)
    try {
      const response = await axios.post(`${API_URL}/study-session`, { auto_generate: true })
      const generatedCode = response.data?.code || ''
      onLogin(response.data.study_session_id, generatedCode, 'practitioner')
      toast({
        title: 'Study session created',
        description: `Study code: ${generatedCode}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to create study session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      setLoading(false)
    }
  }

  return (
    <Box minH="100vh" bg="white" borderWidth={1} borderRadius="lg" p={10}>
      <VStack maxW="900px" mx="auto" align="stretch" spacing={8}>
        <VStack align="stretch" spacing={3}>
          <Heading size="lg" letterSpacing="wide">UP-MAVT Suite</Heading>
          <Text color="gray.700">
            This suite supports stakeholder elicitation and practitioner analysis using Qualitative Indicators,
            Value Functions, and Weight Elicitation.
          </Text>
          <Text color="gray.600" fontSize="sm">
            Use a session code to continue an existing session, or create a new case study as a practitioner.
          </Text>
        </VStack>

        <Divider />

        <VStack spacing={4} align="stretch" width="100%">
          <Box>
            <FormLabel fontWeight="medium" mb={2}>
              Access existing session
            </FormLabel>
            <Input
              placeholder="Enter session code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDetectAndLogin()}
              isDisabled={loading}
            />
          </Box>
          <Button
            colorScheme="blue"
            isLoading={loading}
            onClick={handleDetectAndLogin}
            width="fit-content"
          >
            Access session
          </Button>
        </VStack>

        <Divider />

        <VStack spacing={3} align="stretch">
          <Text fontWeight="medium">Create new case study</Text>
          <Text fontSize="sm" color="gray.600">
            A unique alphanumeric study code is generated automatically.
          </Text>
          <Button
            colorScheme="green"
            isLoading={loading}
            onClick={handleCreatePractitionerSession}
            width="fit-content"
          >
            Create new
          </Button>
        </VStack>

        <Divider />

        <HStack>
          <Link color="blue.600" onClick={onDocumentation}>
            Open documentation
          </Link>
        </HStack>
      </VStack>
    </Box>
  )
}

export default LoginPage
