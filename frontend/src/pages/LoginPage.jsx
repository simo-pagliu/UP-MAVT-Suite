import { Box, Button, FormControl, FormLabel, Heading, HStack, Input, Text, VStack, useToast, Card, CardBody, CardHeader } from '@chakra-ui/react'
import axios from 'axios'
import { useState } from 'react'

const API_URL = 'http://localhost:5000/api'

function LoginPage({ onLogin }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('access') // 'access' or 'create'
  const toast = useToast()

  const handleDetectAndLogin = async () => {
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
        title: 'Error',
        description: error.response?.data?.error || 'Failed to access session',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      setLoading(false)
    }
  }

  const handleCreatePractitionerSession = async () => {
    if (!code.trim()) {
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
      const response = await axios.post(`${API_URL}/study-session`, { code: code.trim() })
      onLogin(response.data.study_session_id, code.trim(), 'practitioner')
      setCode('')
      toast({
        title: 'Study session created',
        description: `Study code: ${code.trim()}`,
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
      setLoading(false)
    }
  }

  return (
    <Box minH="100vh" bg="gray.100" display="flex" alignItems="center" justifyContent="center" p={4}>
      <Card maxW="md" w="full" boxShadow="lg">
        <CardHeader bg="blue.700" color="white" borderRadius="md 0 0 0">
          <Heading size="lg" letterSpacing="wide">UP-MAVT Suite</Heading>
          <Text fontSize="sm" mt={2} opacity={0.9}>Welcome to the UP-MAVT Suite</Text>
        </CardHeader>
        <CardBody>
          <VStack spacing={6}>
            {/* Tab-like switching between access and create */}
            <HStack width="100%" spacing={2} borderBottom="1px" borderColor="gray.200" pb={4}>
              <Button
                flex={1}
                variant={mode === 'access' ? 'solid' : 'ghost'}
                colorScheme={mode === 'access' ? 'blue' : 'gray'}
                onClick={() => setMode('access')}
                size="sm"
              >
                Access Session
              </Button>
              <Button
                flex={1}
                variant={mode === 'create' ? 'solid' : 'ghost'}
                colorScheme={mode === 'create' ? 'blue' : 'gray'}
                onClick={() => setMode('create')}
                size="sm"
              >
                Create Study
              </Button>
            </HStack>

            {mode === 'access' ? (
              <VStack spacing={4} align="stretch" width="100%">
                <Box>
                  <FormLabel fontWeight="medium" mb={2}>
                    Enter Code
                  </FormLabel>
                  <Text fontSize="sm" color="gray.600" mb={3}>
                    Enter your stakeholder or practitioner session code to continue
                  </Text>
                  <Input
                    placeholder="Enter session code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleDetectAndLogin()}
                    isDisabled={loading}
                  />
                </Box>
                <Button
                  colorScheme="blue"
                  isLoading={loading}
                  onClick={handleDetectAndLogin}
                  width="100%"
                  size="lg"
                >
                  Access
                </Button>
              </VStack>
            ) : (
              <VStack spacing={4} align="stretch" width="100%">
                <Box>
                  <FormLabel fontWeight="medium" mb={2}>
                    Create New Study Session
                  </FormLabel>
                  <Text fontSize="sm" color="gray.600" mb={3}>
                    Enter a unique code for your new practitioner study session
                  </Text>
                  <Input
                    placeholder="Enter new study code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleCreatePractitionerSession()}
                    isDisabled={loading}
                  />
                </Box>
                <Button
                  colorScheme="green"
                  isLoading={loading}
                  onClick={handleCreatePractitionerSession}
                  width="100%"
                  size="lg"
                >
                  Create Study
                </Button>
              </VStack>
            )}
          </VStack>
        </CardBody>
      </Card>
    </Box>
  )
}

export default LoginPage
