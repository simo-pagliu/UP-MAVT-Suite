import {
  Box,
  Button,
  Divider,
  FormLabel,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  Link,
  SimpleGrid,
  Text,
  VStack,
  useToast,
} from '@chakra-ui/react'
import axios from 'axios'
import { useRef, useState } from 'react'
import { API_URL } from '../config'

function LoginPage({ onLogin, onDocumentation }) {
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const uploadFileRef = useRef(null)
  const toast = useToast()

  const validateEmail = () => {
    if (!email.trim()) {
      toast({
        title: 'Request failed',
        description: 'Please enter an email address',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return false
    }
    return true
  }

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
    if (!validateEmail()) return
    setLoading(true)
    try {
      const response = await axios.post(`${API_URL}/study-session`, {
        auto_generate: true,
        contact_email: email.trim(),
      })
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

  const handleUploadCaseStudy = async () => {
    if (!validateEmail()) return
    const file = uploadFileRef.current?.files?.[0]
    if (!file) return
    setLoading(true)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('contact_email', email.trim())
    try {
      const response = await axios.post(
        `${API_URL}/study-session/backup/import?on_conflict=regenerate`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      const generatedCode = response.data?.code || ''
      onLogin(response.data.study_session_id, generatedCode, 'practitioner')
      toast({
        title: 'Case study uploaded',
        description: `Study code: ${generatedCode}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        title: 'Request failed',
        description: error.response?.data?.error || 'Failed to upload case study',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      if (uploadFileRef.current) {
        uploadFileRef.current.value = ''
      }
      setLoading(false)
    }
  }

  return (
    <Box minH={{ base: 'calc(100vh - 68px)', md: 'calc(100vh - 72px)' }} display="flex" flexDirection="column">
      <Grid templateColumns={{ base: '1fr', lg: '1.2fr 1fr' }} flex="1">
        <GridItem p={{ base: 6, md: 10 }} bg="white">
          <VStack align="stretch" spacing={6}>
            <VStack align="stretch" spacing={3}>
              <Heading size="xl" lineHeight="1.2">
                UP-MAVT Suite
              </Heading>
              <Text color="gray.700" fontSize="lg">
                A complete solution for multi-criteria group decision analysis under uncertainty
              </Text>
            </VStack>

            <SimpleGrid columns={1} spacing={4}>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>1. Define context</Text>
                <Text fontSize="sm" color="gray.600">
                  Practitioners create a case study and define the indicator structure.
                </Text>
              </Box>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>2. Elicit preferences</Text>
                <Text fontSize="sm" color="gray.600">
                  Stakeholders complete qualitative, value-function, and weight elicitation steps.
                </Text>
              </Box>
              <Box bg="blue.50" borderRadius="md" p={4} borderWidth={1} borderColor="blue.100">
                <Text fontWeight="semibold" mb={1}>3. Review outcomes</Text>
                <Text fontSize="sm" color="gray.600">
                  The team compares results and consolidates evidence for final decisions.
                </Text>
              </Box>
            </SimpleGrid>

            <HStack spacing={5} wrap="wrap">
              <Link
                href="https://example.org/publication-upmavt"
                isExternal
                color="blue.700"
                fontWeight="semibold"
              >
                Read the publication (placeholder)
              </Link>
            </HStack>
            <VStack align="start" spacing={1}>
              <Text fontWeight="semibold">Example case studies</Text>
              <Link href={`${API_URL}/example-case-study/1`} color="blue.700">
                Download example case study 1
              </Link>
              <Link href={`${API_URL}/example-case-study/2`} color="blue.700">
                Download example case study 2
              </Link>
            </VStack>
          </VStack>
        </GridItem>

        <GridItem p={{ base: 6, md: 10 }} bg="white">
          <VStack spacing={6} align="stretch">
            <Box>
              <Heading size="md" mb={2}>Access Existing Session</Heading>
              <Text color="gray.600" fontSize="sm">
                Enter your assigned session code to continue elicitation, or create a new case study if you are
                initiating a practitioner workflow.
              </Text>
            </Box>

            <Box>
              <FormLabel fontWeight="medium" mb={2}>
                Session code
              </FormLabel>
              <HStack spacing={3}>
                <Input
                  placeholder="Enter session code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDetectAndLogin()}
                  isDisabled={loading}
                  bg="white"
                  w="50%"
                />
                <Button colorScheme="blue" isLoading={loading} onClick={handleDetectAndLogin} w="50%">
                  Access session
                </Button>
              </HStack>
            </Box>

            <Divider />

            <VStack spacing={3} align="stretch">
              <FormLabel fontWeight="medium" mb={0}>
                Email address
              </FormLabel>
              <Input
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                isDisabled={loading}
                bg="white"
              />
              <Button colorScheme="blue" isLoading={loading} onClick={handleCreatePractitionerSession}>
                Create case study
              </Button>
              <Button
                variant="outline"
                colorScheme="blue"
                isLoading={loading}
                onClick={() => uploadFileRef.current?.click()}
              >
                Upload case study (.zip)
              </Button>
              <Input
                ref={uploadFileRef}
                type="file"
                accept=".zip"
                display="none"
                onChange={handleUploadCaseStudy}
              />
            </VStack>
          </VStack>
        </GridItem>
      </Grid>

      <Box borderTopWidth={1} borderColor="gray.200" bg="gray.100" px={{ base: 6, md: 10 }} py={5} mt="auto">
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Software documentation</Text>
            <Link color="blue.700" onClick={onDocumentation}>Open software documentation</Link>
          </VStack>

          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Disclaimers</Text>
            <Text fontSize="sm" color="gray.600">For research and decision-support use only.</Text>
            <Text fontSize="sm" color="gray.600">No warranty or guarantee of fitness for purpose.</Text>
          </VStack>

          <VStack align="start" spacing={1}>
            <Text fontWeight="semibold">Legal and policy links</Text>
            <Link href="https://example.org/terms" isExternal color="blue.700">Terms of use (placeholder)</Link>
            <Link href="https://example.org/privacy" isExternal color="blue.700">Privacy notice (placeholder)</Link>
          </VStack>
        </SimpleGrid>
      </Box>
    </Box>
  )
}

export default LoginPage
